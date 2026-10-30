import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Discover models from every LiteLLM-compatible OpenAI endpoint whose provider
 * id starts with "litellm-". Provider endpoints (baseUrl, headers, etc.) come
 * from models.json and credentials come from auth.json; this extension only
 * supplies the dynamic model catalogs.
 *
 * The discovered catalogs are persisted by Pi per provider, so models that were
 * found during an earlier run are still available when an endpoint is offline.
 */

const PROVIDER_PREFIX = "litellm-";
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

interface LiteLlmProviderDefinition {
  id: string;
  name: string;
  api: string;
  baseUrl?: string;
  authKey?: string;
  configuredApiKey?: string;
}

const catalogCaches = new Map<string, CatalogCache>();
const registeredProviders = new Map<string, string>();

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

  return modalities.includes("image") || info.supports_vision === true
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
    numberValue(info.max_input_tokens) ??
    numberValue(info.max_tokens) ??
    defaultContextWindow(info);
  const maxTokens =
    numberValue(raw.max_output_length) ??
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

function extractModels(payload: unknown, baseUrl: string): DynamicModel[] {
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(record(payload)?.data)
      ? (record(payload)!.data as unknown[])
      : Array.isArray(record(payload)?.models)
        ? (record(payload)!.models as unknown[])
        : [];

  const models = new Map<string, DynamicModel>();
  for (const entry of entries) {
    const raw = record(entry);
    const model = raw && toModel(raw, baseUrl);
    if (model) {
      models.set(model.id, model);
    }
  }

  return [...models.values()];
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

async function fetchCatalog(
  baseUrl: string,
  credential: RefreshContext["credential"],
  signal: AbortSignal,
): Promise<DynamicModel[]> {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = credential?.type === "api_key" ? credential.key : undefined;
  if (apiKey && apiKey !== DUMMY_API_KEY) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

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
    return models;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", forwardAbort);
  }
}

function log(message: string): void {
  console.error(`[litellm-models] ${message}`);
}

function providerSuffix(providerId: string): string {
  return providerId
    .slice(PROVIDER_PREFIX.length)
    .replace(/[^a-z0-9]+/gi, "_")
    .toUpperCase();
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
    return '!printf %s "${LITELLM_API_KEY:-dummy}"';
  }

  return `!printf %s "\${LITELLM_${suffix}_API_KEY:-\${LITELLM_API_KEY:-dummy}}"`;
}

function discoverLiteLlmProviders(): LiteLlmProviderDefinition[] {
  const agentDir = getAgentDir();
  const modelsJson = readJsonFile(join(agentDir, MODELS_FILENAME));
  const authJson = readJsonFile(join(agentDir, AUTH_FILENAME));
  const providers = record(record(modelsJson)?.providers) ?? {};
  const credentials = record(authJson) ?? {};
  const ids = new Set([...Object.keys(providers), ...Object.keys(credentials)]);
  const definitions: LiteLlmProviderDefinition[] = [];

  for (const id of [...ids].sort()) {
    if (!id.startsWith(PROVIDER_PREFIX)) {
      continue;
    }

    const raw = record(providers[id]) ?? {};
    const suffix = providerSuffix(id);
    const envBaseUrl = suffix
      ? process.env[`LITELLM_${suffix}_BASE_URL`]
      : undefined;
    const baseUrl =
      stringValue(raw.baseUrl) ??
      stringValue(envBaseUrl) ??
      stringValue(process.env.LITELLM_BASE_URL);
    if (!baseUrl) {
      log(
        `Skipping ${id}: no baseUrl in ${MODELS_FILENAME} or LITELLM_${suffix || ""}_BASE_URL`,
      );
      continue;
    }

    definitions.push({
      id,
      name:
        stringValue(raw.name) ??
        `LiteLLM (${suffix ? suffix.toLowerCase().replace(/_/g, "-") : id})`,
      api: stringValue(raw.api) ?? "openai-completions",
      baseUrl,
      authKey: credentialKey(credentials[id]),
      configuredApiKey: stringValue(raw.apiKey),
    });
  }

  return definitions;
}

function createRefreshModels(provider: LiteLlmProviderDefinition) {
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
      const models = await fetchCatalog(baseUrl, credential, context.signal);
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
  const definitions = discoverLiteLlmProviders();
  const seen = new Set<string>();

  for (const definition of definitions) {
    seen.add(definition.id);
    const apiKey =
      definition.authKey ??
      (definition.configuredApiKey
        ? undefined
        : fallbackApiKeyCommand(definition.id));
    const signature = JSON.stringify([
      definition.name,
      definition.api,
      definition.baseUrl ?? "",
      apiKey ?? "",
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
    log(`Unregistered ${id}: no longer present in ${MODELS_FILENAME}`);
  }

  if (definitions.length === 0) {
    log(`No ${PROVIDER_PREFIX}* providers found in ${MODELS_FILENAME}`);
  }

  return definitions.map((definition) => definition.id);
}

export default function (pi: ExtensionAPI) {
  const initialProviders = syncProviders(pi);
  if (initialProviders.length > 0) {
    log(
      `Managing ${initialProviders.length} LiteLLM provider(s): ${initialProviders.join(", ")}`,
    );
  }

  pi.registerCommand("litellm-refresh", {
    description:
      "Reload litellm-* providers and refresh their /models catalogs",
    handler: async (args, ctx) => {
      const providerIds = syncProviders(pi);
      if (providerIds.length === 0) {
        ctx.ui.notify(
          `No ${PROVIDER_PREFIX}* providers found in ${MODELS_FILENAME}`,
          "info",
        );
        return;
      }

      const requested = args.trim();
      const selected = requested
        ? providerIds.filter(
          (id) => id === requested || id === `${PROVIDER_PREFIX}${requested}`,
        )
        : providerIds;
      if (selected.length === 0) {
        ctx.ui.notify(
          `Unknown LiteLLM provider: ${requested}. Available: ${providerIds.join(", ")}`,
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
            `Refreshed ${count} LiteLLM model(s); ${failures.length} provider(s) failed: ${failures.join("; ")}`,
            "error",
          );
          return;
        }

        ctx.ui.notify(
          `Refreshed ${count} LiteLLM model(s) across ${selected.length} provider(s)`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          `LiteLLM model refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });
}
