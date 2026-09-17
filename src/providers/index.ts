import type { ProviderId } from "../types";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { deepseekProvider, openaiProvider } from "./openai-compatible";
import type { ProviderAdapter } from "./types";
export const providers: Record<ProviderId, ProviderAdapter> = {
  gemini: geminiProvider, openai: openaiProvider,
  anthropic: anthropicProvider, deepseek: deepseekProvider,
};
