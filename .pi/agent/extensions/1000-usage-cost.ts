import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Prefer provider-reported response costs over catalog estimates.
 *
 * Pi's OpenAI-compatible parser always derives `usage.cost` from the model
 * catalog, even when the provider returned an authoritative `usage.cost` in the
 * response. Gateways and proxies such as LiteLLM and OpenRouter often expose
 * that value while their model catalogs have no usable pricing.
 *
 * This extension captures the reported total from the final provider stream
 * chunk and writes it onto the finalized assistant message. Pi's existing
 * input/output/cache breakdown is scaled proportionally so its fields still add
 * up to the reported total.
 *
 * This is a workaround for Pi's `parseChunkUsage()` calling `calculateCost()`
 * unconditionally. It can be removed once Pi honors provider-reported costs.
 *
 * Assumes `usage.cost` is the USD total to bill. OpenRouter BYOK is a special
 * case: `cost` can be only OpenRouter's fee, with upstream spend reported in
 * `cost_details.upstream_inference_cost`.
 */

interface ProviderStreamEvent {
  provider?: unknown;
  model?: unknown;
  data?: unknown;
}

const pendingCosts = new Map<string, number>();

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function usageKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

function rawUsage(data: unknown): Record<string, unknown> | undefined {
  const chunk = record(data);
  if (!chunk) {
    return undefined;
  }

  const firstChoice = record(
    Array.isArray(chunk.choices) ? chunk.choices[0] : undefined,
  );
  return record(chunk.usage) ?? record(firstChoice?.usage);
}

function reportedUsageCost(data: unknown): number | undefined {
  const usage = rawUsage(data);
  return usage ? nonNegativeNumber(usage.cost) : undefined;
}

function applyReportedUsageCost(
  usage: Record<string, unknown> | undefined,
  total: number,
): void {
  const cost = record(usage?.cost);
  if (!cost) {
    return;
  }

  const previousTotal =
    typeof cost.total === "number" && Number.isFinite(cost.total)
      ? cost.total
      : 0;
  if (previousTotal > 0) {
    // Keep Pi's input/output/cache split proportional to the catalog estimate
    // while making the total match the provider-reported cost.
    const scale = total / previousTotal;
    for (const field of [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
    ] as const) {
      const value = cost[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        cost[field] = value * scale;
      }
    }
  }

  cost.total = total;
}

export default function (pi: ExtensionAPI) {
  (
    pi.on as unknown as (
      event: "provider_stream_event",
      handler: (event: ProviderStreamEvent) => void,
    ) => unknown
  )("provider_stream_event", (event) => {
    const providerId = stringValue(event.provider);
    const modelId = stringValue(event.model);
    if (!providerId || !modelId) {
      return;
    }

    const cost = reportedUsageCost(event.data);
    if (cost !== undefined) {
      pendingCosts.set(usageKey(providerId, modelId), cost);
    }
  });

  // Drop any cost captured for a previous, incomplete stream before the next
  // assistant message for the same provider/model starts.
  pi.on("message_start", (event) => {
    const message = record(event.message);
    if (!message || message.role !== "assistant") {
      return;
    }

    const providerId = stringValue(message.provider);
    const modelId = stringValue(message.model);
    if (providerId && modelId) {
      pendingCosts.delete(usageKey(providerId, modelId));
    }
  });

  pi.on("message_end", (event) => {
    const message = record(event.message);
    if (!message || message.role !== "assistant") {
      return;
    }

    const providerId = stringValue(message.provider);
    const modelId = stringValue(message.model);
    if (!providerId || !modelId) {
      return;
    }

    const key = usageKey(providerId, modelId);
    const reported = pendingCosts.get(key);
    if (reported === undefined) {
      return;
    }
    pendingCosts.delete(key);

    applyReportedUsageCost(record(message.usage), reported);
  });
}
