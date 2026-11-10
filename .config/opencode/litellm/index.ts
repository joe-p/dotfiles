import { Model, Plugin, Provider } from "@opencode/plugin"

type Options = {
  baseURL?: string
  apiKey?: string
  providerName?: string
  refreshMinutes?: number
}

type ModelInfo = {
  model_name?: string
  model_info?: {
    mode?: string
    max_input_tokens?: number
    max_output_tokens?: number
    supports_function_calling?: boolean
    supports_vision?: boolean
    input_cost_per_token?: number
    output_cost_per_token?: number
    cache_read_input_token_cost?: number
    cache_creation_input_token_cost?: number
  }
}

export default Plugin.define({
  id: "litellm.models",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as Options
    const providerID = Provider.ID.make("litellm")

    // Accepts either http://host:4000 or http://host:4000/v1
    const root = (options.baseURL ?? "http://127.0.0.1:4000")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/v1$/, "")

    const apiKey = options.apiKey?.trim() || undefined
    const headers: Record<string, string> = apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : {}

    async function getJSON<T>(path: string): Promise<T> {
      const response = await fetch(`${root}${path}`, { headers })
      if (!response.ok) {
        throw new Error(`${path}: ${response.status} ${response.statusText}`)
      }
      return (await response.json()) as T
    }

    function toModel(id: string, info: NonNullable<ModelInfo["model_info"]>) {
      const base = Model.Info.default(providerID, Model.ID.make(id))
      const vision = info.supports_vision === true
      const hasCost =
        typeof info.input_cost_per_token === "number" &&
        typeof info.output_cost_per_token === "number"

      return {
        ...base,
        name: id,
        capabilities: {
          ...base.capabilities,
          tools: info.supports_function_calling ?? true,
          input: vision ? ["text", "image"] : ["text"],
          output: ["text"],
        },
        limit: {
          ...base.limit,
          ...(typeof info.max_input_tokens === "number"
            ? { context: info.max_input_tokens }
            : {}),
          ...(typeof info.max_output_tokens === "number"
            ? { output: info.max_output_tokens }
            : {}),
        },
        ...(hasCost
          ? {
              cost: [
                {
                  input: info.input_cost_per_token! * 1_000_000,
                  output: info.output_cost_per_token! * 1_000_000,
                  cache: {
                    read: (info.cache_read_input_token_cost ?? 0) * 1_000_000,
                    write: (info.cache_creation_input_token_cost ?? 0) * 1_000_000,
                  },
                },
              ],
            }
          : {}),
        ...(/claude/i.test(id)
          ? {
              compatibility: {
                ...base.compatibility,
                cacheFormat: "anthropic" as const,
              },
            }
          : {}),
      }
    }

    async function load(): Promise<Model.Info[]> {
      const metadata = new Map<string, ModelInfo["model_info"]>()

      try {
        const body = await getJSON<{ data?: ModelInfo[] }>("/model/info")
        for (const entry of body.data ?? []) {
          if (entry.model_name) {
            metadata.set(entry.model_name, entry.model_info)
          }
        }
      } catch (error) {
        console.error("[litellm] /model/info unavailable", error)
      }

      let ids: string[] = []
      try {
        const body = await getJSON<{ data?: { id: string }[] }>("/v1/models")
        ids = (body.data ?? []).map((model) => model.id)
      } catch (error) {
        console.error("[litellm] /v1/models unavailable", error)
      }
      if (ids.length === 0) ids = [...metadata.keys()]

      return ids
        .filter((id) => id && !id.includes("#"))
        .map((id) => toModel(id, metadata.get(id) ?? {}))
    }

    let models = await load()

    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: options.providerName ?? "LiteLLM",
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: {
            baseURL: `${root}/v1`,
            ...(apiKey ? { apiKey } : {}),
          },
        },
        models,
      })
    })

    const refreshMinutes =
      typeof options.refreshMinutes === "number" && options.refreshMinutes > 0
        ? options.refreshMinutes
        : 5

    const timer = setInterval(() => {
      load()
        .then(async (next) => {
          models = next
          await ctx.provider.reload()
        })
        .catch((error) => console.error("[litellm] refresh failed", error))
    }, refreshMinutes * 60_000)

    return () => clearInterval(timer)
  },
})
