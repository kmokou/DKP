import type { ModelOption, ProviderId } from "../types";
import { authHeaders, checkedJson } from "./shared";
import type { ProviderAdapter, ProviderRequest } from "./types";
export function openAICompatibleProvider(config: {
  id: Extract<ProviderId, "openai" | "deepseek">; label: string; baseUrl: string;
  fallbackModels: ModelOption[]; modelFilter?: (id: string) => boolean;
}): ProviderAdapter {
  return {
    id: config.id, label: config.label,
    async listModels(apiKey, signal) {
      try {
        const data = await checkedJson(config.id, `${config.baseUrl}/models`,
          { headers: authHeaders(apiKey) }, signal);
        const models = (data.data || []).map((m: any) => String(m.id || ""))
          .filter((id: string) => id && (!config.modelFilter || config.modelFilter(id)))
          .map((id: string) => ({ id, label: id }));
        return models.length ? models : config.fallbackModels;
      } catch (error) {
        if (config.id === "deepseek") return config.fallbackModels;
        throw error;
      }
    },
    async generate(request: ProviderRequest) {
      const userContent: string | any[] = request.image
        ? [
            { type: "text", text: request.prompt },
            { type: "image_url", image_url: {
              url: `data:${request.image.mimeType};base64,${request.image.data}`,
            } },
          ]
        : request.prompt;
      const body: any = {
        model: request.model,
        messages: [{ role: "system", content: request.system }, { role: "user", content: userContent }],
        temperature: 0.15, max_tokens: 16000,
      };
      if (request.schema && config.id === "openai") body.response_format = { type: "json_object" };
      const data = await checkedJson(config.id, `${config.baseUrl}/chat/completions`, {
        method: "POST", headers: authHeaders(request.apiKey), body: JSON.stringify(body),
      }, request.signal);
      return {
        text: data.choices?.[0]?.message?.content || "",
        tokens: Number(data.usage?.total_tokens) || 0,
        requestId: data.id,
      };
    },
  };
}
export const openaiProvider = openAICompatibleProvider({
  id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1",
  fallbackModels: [
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
  ],
  modelFilter: (id) => /^(gpt|o\d|chatgpt)/i.test(id),
});
export const deepseekProvider = openAICompatibleProvider({
  id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com",
  fallbackModels: [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ],
});
