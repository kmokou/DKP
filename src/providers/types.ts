import type { ModelOption, ProviderId } from "../types";
export interface ProviderRequest {
  apiKey: string; model: string; system: string; prompt: string;
  schema?: Record<string, unknown>;
  image?: { mimeType: string; data: string };
  signal?: AbortSignal;
}
export interface ProviderResponse { text: string; tokens: number; requestId?: string }
export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  listModels(apiKey: string, signal?: AbortSignal): Promise<ModelOption[]>;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    readonly endpoint: string,
    readonly payload: unknown,
    message: string,
  ) { super(message); this.name = "ProviderError"; }
}
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, ""));
}
