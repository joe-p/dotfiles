import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Dynamic model catalogs for any provider in models.json that opts in with
 * `"dynamicModels": true`.
 *
 * The provider endpoint (baseUrl, api, headers, auth, etc.) stays in
 * models.json / auth.json. This extension only supplies the model catalog by
 * querying the OpenAI-compatible `/models` endpoint and, when available, the
 * LiteLLM-style `/model/info` metadata endpoint.
 *
 * Discovered catalogs are persisted per provider so models discovered during an
 * earlier run remain available when the endpoint is offline.
 *
 * `dynamicModels` may also be an object for non-default endpoints:
 *
 *   "dynamicModels": {
 *     "modelsPath": "/models",
 *     "modelInfoPath": "/model/info"
 *   }
 */

const MODELS_FILENAME = "models.json";
const AUTH_FILENAME = "auth.json";
const CATALOG_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const DUMMY_API_KEY = "dummy";

type InputModality = "text" | "image";

interface DynamicModel {
  type: "chat";
  id: string;
  name: string;
  baseUrl: string;
  reasoning: boolean;
  input: InputModality[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

interface CatalogCache {
  baseUrl: string;
  checkedAt: number;
  models: DynamicModel[];
}

interface RefreshContext {
  credential?: { type?: string; key?: string };
  stored?: { models?: unknown[]; checkedAt?: number };
  publish(publication: {
    persist?: { models: DynamicModel[]; checkedAt: number };
    update?: () => void;
  }): Promise<boolean>;
  allowNetwork: boolean;
  force?: boolean;
  signal: AbortSignal;
  baseUrl?: string;
}

interface RegisterProviderConfig {
  name?: string;
  apiKey?: string;
  api?: string;
  refreshModels?(context: RefreshContext): Promise<DynamicModel[]>;
}

interface DynamicModelsOptions {
  modelsPath: string;
  modelInfoPath: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
}

interface DynamicProviderDefinition {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  configuredApiKey?: string;
  authKey?: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  modelsPath: string;
  modelInfoPath: string;
}

const catalogCaches = new Map<string, CatalogCache>();

// Pi caches the extension factory per cwd, so this module is only imported once and
// its top-level state survives session replacement (/new, /fork, resume, reload).
// Each replacement builds a brand-new model runtime, and provider registrations
// only land in the runtime that was active when registerProvider() was called.
// Keying the duplicate-registration guard by the extension API instance (one per
// session) re-registers providers for the new runtime; a module-wide map would
// skip that and leave the new runtime without the dynamic catalogs.
const registrationsByApi = new WeakMap<ExtensionAPI, Map<string, string>>();

function registrationsFor(pi: ExtensionAPI): Map<string, string> {
  let registrations = registrationsByApi.get(pi);
  if (!registrations) {
    registrations = new Map();
    registrationsByApi.set(pi, registrations);
  }
  return registrations;
}

function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) {
    return join(homedir(), ".pi", "agent");
  }
  if (configured === "~") {
    return homedir();
  }
  return configured.startsWith("~/")
    ? join(homedir(), configured.slice(2))
    : configured;
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    log(
      `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function perTokenToPerMillion(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed === undefined ? undefined : parsed * 1_000_000;
}

function perMillion(value: unknown): number | undefined {
  return numberValue(value);
}

function readCost(raw: Record<string, unknown>): DynamicModel["cost"] {
  const pricing = record(raw.pricing) ?? {};
  const info = record(raw.model_info) ?? {};

  return {
    input:
      perTokenToPerMillion(pricing.prompt) ??
      perTokenToPerMillion(pricing.input) ??
      perTokenToPerMillion(info.input_cost_per_token) ??
      perMillion(info.input_cost_per_million_tokens) ??
      0,
    output:
      perTokenToPerMillion(pricing.completion) ??
      perTokenToPerMillion(pricing.output) ??
      perTokenToPerMillion(info.output_cost_per_token) ??
      perMillion(info.output_cost_per_million_tokens) ??
      0,
    cacheRead:
      perTokenToPerMillion(pricing.input_cache_read) ??
      perTokenToPerMillion(info.cache_read_input_token_cost) ??
      perMillion(info.cache_read_input_cost_per_million_tokens) ??
      0,
    cacheWrite:
      perTokenToPerMillion(pricing.input_cache_write) ??
      perTokenToPerMillion(info.cache_creation_input_token_cost) ??
      perMillion(info.cache_creation_input_cost_per_million_tokens) ??
      0,
  };
}

function readInput(raw: Record<string, unknown>): InputModality[] {
  const info = record(raw.model_info) ?? {};
  const architecture = record(raw.architecture) ?? {};
  const modalities = [
    ...stringArray(raw.input_modalities),
    ...stringArray(info.input_modalities),
    ...stringArray(architecture.input_modalities),
  ];

  return modalities.includes("image") ||
    raw.supports_vision === true ||
    info.supports_vision === true
    ? ["text", "image"]
    : ["text"];
}

function isChatModel(raw: Record<string, unknown>): boolean {
  const info = record(raw.model_info) ?? {};
  const outputs = [
    ...stringArray(raw.output_modalities),
    ...stringArray(info.output_modalities),
  ];

  // Skip image-only, embedding, classifier, and other non-chat entries.
  if (outputs.length > 0 && !outputs.includes("text")) {
    return false;
  }

  const mode = stringValue(info.mode)?.toLowerCase();
  if (mode && !["chat", "completion", "responses"].includes(mode)) {
    return false;
  }

  const type = stringValue(raw.type)?.toLowerCase();
  if (type && !["chat", "text"].includes(type)) {
    return false;
  }

  return true;
}

function isReasoningModel(raw: Record<string, unknown>, id: string): boolean {
  const info = record(raw.model_info) ?? {};
  const capabilities = [
    ...stringArray(raw.supported_features),
    ...stringArray(raw.supported_parameters),
  ].map((entry) => entry.toLowerCase());

  return (
    raw.supports_reasoning === true ||
    info.supports_reasoning === true ||
    capabilities.some((entry) =>
      ["reasoning", "include_reasoning", "reasoning_effort"].includes(entry),
    ) ||
    /(^|[-/._])(o1|o3|o4|o5|r1|reasoner|reasoning|thinking)([-/._]|$)/i.test(id)
  );
}

function toModel(
  raw: Record<string, unknown>,
  baseUrl: string,
): DynamicModel | undefined {
  const id = stringValue(raw.id) ?? stringValue(raw.model_name);
  if (!id || !isChatModel(raw)) {
    return undefined;
  }

  const info = record(raw.model_info) ?? {};
  const contextWindow =
    numberValue(raw.context_length) ??
    numberValue(raw.max_input_tokens) ??
    numberValue(info.max_input_tokens) ??
    numberValue(info.max_tokens) ??
    defaultContextWindow(info);
  const maxTokens =
    numberValue(raw.max_output_length) ??
    numberValue(raw.max_output_tokens) ??
    numberValue(info.max_output_tokens) ??
    numberValue(info.max_completion_tokens) ??
    Math.min(DEFAULT_MAX_TOKENS, contextWindow);

  return {
    type: "chat",
    id,
    name: stringValue(raw.name) ?? stringValue(info.name) ?? id,
    baseUrl,
    reasoning: isReasoningModel(raw, id),
    input: readInput(raw),
    cost: readCost(raw),
    contextWindow,
    maxTokens,
  };
}

function defaultContextWindow(info: Record<string, unknown>): number {
  return numberValue(info.context_window) ?? DEFAULT_CONTEXT_WINDOW;
}

function catalogEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const data = record(payload)?.data;
  if (Array.isArray(data)) {
    return data;
  }
  const models = record(payload)?.models;
  return Array.isArray(models) ? models : [];
}

function extractModels(payload: unknown, baseUrl: string): DynamicModel[] {
  const models = new Map<string, DynamicModel>();
  for (const entry of catalogEntries(payload)) {
    const raw = record(entry);
    const model = raw && toModel(raw, baseUrl);
    if (model) {
      models.set(model.id, model);
    }
  }

  return [...models.values()];
}

function applyModelInfo(
  models: DynamicModel[],
  payload: unknown,
): DynamicModel[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of catalogEntries(payload)) {
    const raw = record(entry);
    if (!raw) {
      continue;
    }
    const id =
      stringValue(raw.model_name) ??
      stringValue(raw.id) ??
      stringValue(record(raw.model_info)?.id);
    if (id) {
      byId.set(id, raw);
    }
  }
  if (byId.size === 0) {
    return models;
  }

  return models.map((model) => {
    const raw = byId.get(model.id);
    if (!raw) {
      return model;
    }

    const info = record(raw.model_info) ?? {};
    const contextWindow =
      numberValue(raw.max_input_tokens) ??
      numberValue(info.max_input_tokens) ??
      numberValue(info.max_tokens) ??
      model.contextWindow;
    const maxTokens =
      numberValue(raw.max_output_tokens) ??
      numberValue(info.max_output_tokens) ??
      numberValue(info.max_completion_tokens) ??
      model.maxTokens;
    const input =
      info.supports_vision === true && !model.input.includes("image")
        ? (["text", "image"] as InputModality[])
        : model.input;

    return {
      ...model,
      name: stringValue(raw.name) ?? stringValue(info.name) ?? model.name,
      reasoning: model.reasoning || info.supports_reasoning === true,
      input,
      contextWindow,
      maxTokens,
    };
  });
}

function restoreModels(
  context: RefreshContext,
  baseUrl: string,
): DynamicModel[] {
  const stored = context.stored;
  if (!Array.isArray(stored?.models)) {
    return [];
  }

  const models: DynamicModel[] = [];
  for (const entry of stored.models) {
    const raw = record(entry);
    if (!raw || (raw.type !== undefined && raw.type !== "chat")) {
      continue;
    }

    const id = stringValue(raw.id);
    if (!id) {
      continue;
    }

    const cost = record(raw.cost) ?? {};
    const input = stringArray(raw.input).filter(
      (value): value is InputModality => value === "text" || value === "image",
    );

    models.push({
      type: "chat",
      id,
      name: stringValue(raw.name) ?? id,
      baseUrl: stringValue(raw.baseUrl) ?? baseUrl,
      reasoning: raw.reasoning === true,
      input: input.length > 0 ? input : ["text"],
      cost: {
        input: numberValue(cost.input) ?? 0,
        output: numberValue(cost.output) ?? 0,
        cacheRead: numberValue(cost.cacheRead) ?? 0,
        cacheWrite: numberValue(cost.cacheWrite) ?? 0,
      },
      contextWindow: numberValue(raw.contextWindow) ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: numberValue(raw.maxTokens) ?? DEFAULT_MAX_TOKENS,
    });
  }

  return models;
}

function endpointUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return trimmedPath ? `${trimmedBase}/${trimmedPath}` : trimmedBase;
}

function resolveConfigValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("$$")) {
    return trimmed.slice(1);
  }
  if (trimmed.startsWith("$!")) {
    return `!${trimmed.slice(2)}`;
  }
  if (trimmed.startsWith("!")) {
    try {
      const output = execSync(trimmed.slice(1), {
        encoding: "utf8",
        timeout: 5_000,
      });
      return output.trim() || undefined;
    } catch (error) {
      log(
        `Could not resolve configured value: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  const envMatch =
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed) ??
    /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (envMatch) {
    return process.env[envMatch[1]!]?.trim() || undefined;
  }

  return trimmed;
}

function resolveHeaders(
  raw: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!raw) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const configured = stringValue(value);
    if (!configured) {
      continue;
    }
    const resolved = resolveConfigValue(configured);
    if (resolved !== undefined) {
      headers[name] = resolved;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (name) => name.toLowerCase() === "authorization",
  );
}

function authorizationHeaders(
  definition: DynamicProviderDefinition,
  credential: RefreshContext["credential"],
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(definition.headers ?? {}),
  };
  const apiKey =
    credential?.key ??
    definition.authKey ??
    (definition.configuredApiKey
      ? resolveConfigValue(definition.configuredApiKey)
      : undefined);

  if (
    apiKey &&
    apiKey !== DUMMY_API_KEY &&
    definition.authHeader &&
    !hasAuthorizationHeader(headers)
  ) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function fetchModelInfo(
  baseUrl: string,
  credential: RefreshContext["credential"],
  definition: DynamicProviderDefinition,
  signal: AbortSignal,
): Promise<unknown> {
  if (!definition.modelInfoPath) {
    return undefined;
  }

  const endpoint = endpointUrl(baseUrl, definition.modelInfoPath);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Model info request timed out")),
    REQUEST_TIMEOUT_MS,
  );
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      headers: authorizationHeaders(definition, credential),
      signal: controller.signal,
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    // Older LiteLLM versions and compatible proxies may not expose /model/info.
    return undefined;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", forwardAbort);
  }
}

async function fetchCatalog(
  baseUrl: string,
  credential: RefreshContext["credential"],
  definition: DynamicProviderDefinition,
  signal: AbortSignal,
): Promise<DynamicModel[]> {
  const endpoint = endpointUrl(baseUrl, definition.modelsPath);
  const headers = authorizationHeaders(definition, credential);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Model discovery timed out")),
    REQUEST_TIMEOUT_MS,
  );
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `GET ${endpoint} returned ${response.status} ${response.statusText}`,
      );
    }

    const models = extractModels(await response.json(), baseUrl);
    if (models.length === 0) {
      throw new Error(`GET ${endpoint} returned no chat models`);
    }

    const info = await fetchModelInfo(baseUrl, credential, definition, signal);
    return info === undefined ? models : applyModelInfo(models, info);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", forwardAbort);
  }
}

function log(message: string): void {
  console.error(`[dynamic-models] ${message}`);
}

function providerSuffix(providerId: string): string {
  return providerId.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

function credentialKey(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringValue(value);
  }

  const credential = record(value);
  return (
    stringValue(credential?.key) ??
    stringValue(credential?.apiKey) ??
    stringValue(credential?.access) ??
    stringValue(credential?.token)
  );
}

function fallbackApiKeyCommand(providerId: string): string {
  const suffix = providerSuffix(providerId);
  if (!suffix) {
    return '!printf %s "${DYNAMIC_MODELS_API_KEY:-dummy}"';
  }

  return `!printf %s "\${DYNAMIC_MODELS_${suffix}_API_KEY:-\${DYNAMIC_MODELS_API_KEY:-dummy}}"`;
}

function parseDynamicModels(value: unknown): DynamicModelsOptions | undefined {
  if (value !== true && record(value) === undefined) {
    return undefined;
  }

  const options = record(value) ?? {};
  return {
    modelsPath: stringValue(options.modelsPath) ?? "/models",
    modelInfoPath: stringValue(options.modelInfoPath) ?? "/model/info",
    headers: resolveHeaders(record(options.headers)),
    authHeader:
      typeof options.authHeader === "boolean" ? options.authHeader : undefined,
  };
}

function discoverDynamicProviders(): DynamicProviderDefinition[] {
  const agentDir = getAgentDir();
  const modelsJson = readJsonFile(join(agentDir, MODELS_FILENAME));
  const authJson = readJsonFile(join(agentDir, AUTH_FILENAME));
  const providers = record(record(modelsJson)?.providers) ?? {};
  const credentials = record(authJson) ?? {};
  const definitions: DynamicProviderDefinition[] = [];

  for (const id of Object.keys(providers).sort()) {
    const raw = record(providers[id]);
    if (!raw) {
      continue;
    }

    const options = parseDynamicModels(raw.dynamicModels);
    if (!options) {
      continue;
    }

    const suffix = providerSuffix(id);
    const envBaseUrl = suffix
      ? process.env[`DYNAMIC_MODELS_${suffix}_BASE_URL`]
      : undefined;
    const baseUrl =
      stringValue(raw.baseUrl) ??
      stringValue(envBaseUrl) ??
      stringValue(process.env.DYNAMIC_MODELS_BASE_URL);

    if (!baseUrl) {
      log(
        `Provider ${id} has dynamicModels enabled but no baseUrl in ${MODELS_FILENAME} or DYNAMIC_MODELS_${suffix || ""}_BASE_URL`,
      );
    }

    definitions.push({
      id,
      name: stringValue(raw.name),
      api: stringValue(raw.api),
      baseUrl,
      configuredApiKey: stringValue(raw.apiKey),
      authKey: credentialKey(credentials[id]),
      authHeader:
        options.authHeader ??
        (typeof raw.authHeader === "boolean" ? raw.authHeader : true),
      headers: options.headers ?? resolveHeaders(record(raw.headers)),
      modelsPath: options.modelsPath,
      modelInfoPath: options.modelInfoPath,
    });
  }

  return definitions;
}

function createRefreshModels(provider: DynamicProviderDefinition) {
  return async (context: RefreshContext): Promise<DynamicModel[]> => {
    const baseUrl = (context.baseUrl ?? provider.baseUrl ?? "").replace(
      /\/+$/,
      "",
    );
    const previousCache = catalogCaches.get(provider.id);
    if (!baseUrl) {
      log(`No baseUrl configured for ${provider.id}; skipping discovery`);
      return previousCache?.models ?? [];
    }

    const stored = restoreModels(context, baseUrl);
    if (stored.length > 0) {
      catalogCaches.set(provider.id, {
        baseUrl,
        checkedAt: numberValue(context.stored?.checkedAt) ?? 0,
        models: stored,
      });
    }

    const now = Date.now();
    const cached = catalogCaches.get(provider.id);
    const cacheIsFresh =
      cached !== undefined &&
      cached.baseUrl === baseUrl &&
      now - cached.checkedAt < CATALOG_TTL_MS;
    if (!context.force && cacheIsFresh) {
      return cached.models;
    }

    if (!context.allowNetwork || context.signal.aborted) {
      return cached?.models ?? stored;
    }

    const credential =
      context.credential ??
      (provider.authKey
        ? { type: "api_key", key: provider.authKey }
        : undefined);

    try {
      const models = await fetchCatalog(
        baseUrl,
        credential,
        provider,
        context.signal,
      );
      catalogCaches.set(provider.id, { baseUrl, checkedAt: now, models });

      try {
        await context.publish({
          persist: { models, checkedAt: now },
        });
      } catch (error) {
        log(
          `Could not persist model catalog for ${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return models;
    } catch (error) {
      if (context.signal.aborted) {
        return cached?.models ?? stored;
      }
      log(
        `Discovery failed for ${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return cached?.models ?? stored;
    }
  };
}

function syncProviders(pi: ExtensionAPI): string[] {
  const definitions = discoverDynamicProviders();
  const registeredProviders = registrationsFor(pi);
  const seen = new Set<string>();

  for (const definition of definitions) {
    seen.add(definition.id);
    const apiKey =
      definition.authKey ??
      definition.configuredApiKey ??
      (definition.baseUrl ? fallbackApiKeyCommand(definition.id) : undefined);
    const signature = JSON.stringify([
      definition.name,
      definition.api,
      definition.baseUrl ?? "",
      apiKey ?? "",
      definition.authHeader,
      definition.headers ?? {},
      definition.modelsPath,
      definition.modelInfoPath,
    ]);
    if (registeredProviders.get(definition.id) === signature) {
      continue;
    }

    const config: RegisterProviderConfig = {
      name: definition.name,
      api: definition.api,
      apiKey,
      refreshModels: createRefreshModels(definition),
    };

    // The extension API in older local dependency versions predates
    // refreshModels, so register through a narrow cast.
    (
      pi.registerProvider as unknown as (
        name: string,
        provider: RegisterProviderConfig,
      ) => void
    )(definition.id, config);
    registeredProviders.set(definition.id, signature);
  }

  for (const id of [...registeredProviders.keys()]) {
    if (seen.has(id)) {
      continue;
    }
    pi.unregisterProvider(id);
    registeredProviders.delete(id);
    catalogCaches.delete(id);
    log(`Unregistered ${id}: dynamicModels is no longer enabled`);
  }

  if (definitions.length === 0) {
    log(`No providers with "dynamicModels": true found in ${MODELS_FILENAME}`);
  }

  return definitions.map((definition) => definition.id);
}

async function refreshProviders(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  args: string,
): Promise<void> {
  const providerIds = syncProviders(pi);
  if (providerIds.length === 0) {
    ctx.ui.notify(
      `No providers with "dynamicModels": true found in ${MODELS_FILENAME}`,
      "info",
    );
    return;
  }

  const requested = args.trim();
  const selected = requested
    ? providerIds.filter((id) => id === requested)
    : providerIds;
  if (selected.length === 0) {
    ctx.ui.notify(
      `Unknown dynamic model provider: ${requested}. Available: ${providerIds.join(", ")}`,
      "error",
    );
    return;
  }

  const registry = ctx.modelRegistry as unknown as {
    refresh(options: {
      providers: string[];
      allowNetwork: boolean;
      force: boolean;
    }): Promise<{ errors?: ReadonlyMap<string, Error> }>;
  };

  try {
    const result = await registry.refresh({
      providers: selected,
      allowNetwork: true,
      force: true,
    });
    const failures = selected.flatMap((id) => {
      const error = result.errors?.get(id);
      return error ? [`${id}: ${error.message}`] : [];
    });
    const count = selected.reduce(
      (total, id) => total + (catalogCaches.get(id)?.models.length ?? 0),
      0,
    );

    if (failures.length > 0) {
      ctx.ui.notify(
        `Refreshed ${count} dynamic model(s); ${failures.length} provider(s) failed: ${failures.join("; ")}`,
        "error",
      );
      return;
    }

    ctx.ui.notify(
      `Refreshed ${count} dynamic model(s) across ${selected.length} provider(s)`,
      "info",
    );
  } catch (error) {
    ctx.ui.notify(
      `Dynamic model refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

export default function (pi: ExtensionAPI) {
  // Register discovery before Pi selects the startup model or lists models.
  syncProviders(pi);

  pi.registerCommand("dynamic-models-refresh", {
    description:
      'Reload providers with "dynamicModels": true and refresh their model catalogs',
    handler: (args, ctx) => refreshProviders(pi, ctx, args),
  });
}
