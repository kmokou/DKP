import type { ModelOption } from "../types";
import { checkedJson } from "./shared";
import type { ProviderAdapter, ProviderRequest } from "./types";
const API = "https://generativelanguage.googleapis.com/v1beta";
export const geminiProvider: ProviderAdapter = {
  id: "gemini", label: "Google Gemini",
  async listModels(apiKey, signal): Promise<ModelOption[]> {
    const data = await checkedJson("gemini", `${API}/models?pageSize=1000`,
      { headers: { "x-goog-api-key": apiKey } }, signal);
    return (data.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: any) => ({
        id: String(m.name).replace("models/", ""),
        label: m.displayName || String(m.name).replace("models/", ""),
        description: m.description || "",
      })).sort((a: ModelOption, b: ModelOption) => a.label.localeCompare(b.label));
  },
  async generate(request: ProviderRequest) {
    const parts: any[] = [{ text: request.prompt }];
    if (request.image) parts.push({ inlineData: {
      mimeType: request.image.mimeType, data: request.image.data,
    }});
    const body: any = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json", temperature: 0.15, maxOutputTokens: 16000,
      },
    };
    if (request.schema) body.generationConfig.responseSchema = request.schema;
    const data = await checkedJson("gemini", `${API}/models/${request.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": request.apiKey },
      body: JSON.stringify(body),
    }, request.signal);
    const text = (data.candidates?.[0]?.content?.parts || [])
      .filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("");
    return { text, tokens: Number(data.usageMetadata?.totalTokenCount) || 0 };
  },
};
