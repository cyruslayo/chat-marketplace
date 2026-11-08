import assert from "node:assert/strict";
import type { GuestRequestHandler } from "../../apps/local-guest/src/guest-server.js";
import { createFakeHttpRequest, createFakeHttpResponse, type CapturedResponse } from "./http-like.js";

// Shared guest HTTP harness: sends requests through the real guest handler and reads its responses (ADR 0080 deterministic
// routes). Synthetic data only; the origin matches the guest host so same-origin checks pass.

export const GUEST_ORIGIN = "http://localhost";

/** A captured guest response with its body read as UTF-8 text. */
export type GuestResponse = CapturedResponse & { readonly bodyText: string };

export async function sendGuest(handler: GuestRequestHandler, method: string, path: string, options: { cookie?: string; form?: Record<string, string> } = {}): Promise<GuestResponse> {
  const headers: Record<string, string> = { host: "localhost", origin: GUEST_ORIGIN };
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  let body: string | undefined;
  if (options.form !== undefined) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  }
  const req = createFakeHttpRequest({ method, url: path, headers, ...(body === undefined ? {} : { body: Buffer.from(body, "utf8") }) });
  const { response, finished } = createFakeHttpResponse();
  await handler.handle(req, response);
  const captured = await finished;
  return { ...captured, bodyText: captured.body.toString("utf8") };
}

export function cookieOf(response: CapturedResponse): string {
  const header = response.headers.find((entry) => entry.name.toLowerCase() === "set-cookie");
  assert.ok(header, "a session cookie is issued");
  return header.value.split(";")[0]!;
}

export function locationOf(response: CapturedResponse): string {
  return response.headers.find((entry) => entry.name.toLowerCase() === "location")?.value ?? "";
}
