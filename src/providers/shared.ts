import type { ProviderId } from "../types";
import { ProviderError } from "./types";
export async function checkedJson(
  provider: ProviderId, endpoint: string, init: RequestInit, signal?: AbortSignal,
): Promise<any> {
  const response = await fetch(endpoint, { ...init, signal });
  const raw = await response.text();
  let payload: unknown = raw;
  try { payload = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: "The provider rejected this request. Check the selected model and input.",
      401: "The API key was rejected.",
      403: "This API key does not have permission for the selected model.",
      404: "The selected model is unavailable for this API key.",
      429: "The provider rate limit or quota was reached.",
      500: "The provider reported an internal error.",
      503: "The provider is temporarily unavailable.",
    };
    throw new ProviderError(provider, response.status, endpoint, payload,
      messages[response.status] || `Provider request failed (${response.status}).`);
  }
  return payload;
}
export const authHeaders = (apiKey: string): Record<string, string> => ({
  "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`,
});
