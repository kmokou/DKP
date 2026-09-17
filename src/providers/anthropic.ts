import type { ModelOption } from "../types";
import { checkedJson } from "./shared";
import type { ProviderAdapter, ProviderRequest } from "./types";
const API = "https://api.anthropic.com/v1";
const headers = (key: string) => ({
  "Content-Type": "application/json", "x-api-key": key,
  "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
});
export const anthropicProvider: ProviderAdapter = {
  id: "anthropic", label: "Anthropic Claude",
  async listModels(apiKey, signal): Promise<ModelOption[]> {
    const data = await checkedJson("anthropic", `${API}/models?limit=100`,
      { headers: headers(apiKey) }, signal);
    return (data.data || []).map((m: any) => ({ id: String(m.id), label: m.display_name || m.id }));
  },
  async generate(request: ProviderRequest) {
    const content: any[] = [];
    if (request.image) content.push({ type: "image", source: {
      type: "base64", media_type: request.image.mimeType, data: request.image.data,
    }});
    content.push({ type: "text", text: `${request.prompt}\n\nReturn valid JSON only.` });
    const data = await checkedJson("anthropic", `${API}/messages`, {
      method: "POST", headers: headers(request.apiKey), body: JSON.stringify({
        model: request.model, system: request.system,
        messages: [{ role: "user", content }], temperature: 0.15, max_tokens: 16000,
      }),
    }, request.signal);
    return {
      text: (data.content || []).filter((p: any) => p.type === "text").map((p: any) => p.text).join(""),
      tokens: Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0),
      requestId: data.id,
    };
  },
};
