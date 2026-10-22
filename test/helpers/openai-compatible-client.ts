import { OpenAiCompatibleClient, type OpenAiCompatibleClientConfig } from "../../apps/local-guest/src/assistant/openai-compatible-client.js";

export interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function completion(message: Record<string, unknown>): Response {
  return jsonResponse(200, { id: "cmpl-1", choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop" }] });
}

export function clientWith(
  respond: (captured: CapturedRequest, attempt: number) => Promise<Response> | Response,
  overrides: Partial<OpenAiCompatibleClientConfig> = {},
): { readonly client: OpenAiCompatibleClient; readonly requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const client = new OpenAiCompatibleClient({
    apiKey: "sk-offline-test",
    baseUrl: "https://api.deepseek.com/",
    model: "deepseek-chat",
    fetch: async (url, init) => {
      const captured = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
      requests.push(captured);
      return respond(captured, requests.length);
    },
    ...overrides,
  });
  return { client, requests };
}
