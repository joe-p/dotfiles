import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * LiteLLM-specific request tagging.
 *
 * Dynamic model discovery for LiteLLM (and every other provider) lives in
 * `1000-dynamic-models.ts` and is enabled per provider with
 * `"dynamicModels": true` in models.json.
 *
 * This extension only adds the current Pi session id to LiteLLM proxy requests
 * so proxy-side logs and spend tracking can group calls from one session.
 */

const PROVIDER_PREFIX = "litellm";

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_headers", (event, ctx) => {
    if (!ctx.model?.provider?.startsWith(PROVIDER_PREFIX)) {
      return;
    }

    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) {
      event.headers.session_id = sessionId;
    }
  });
}
