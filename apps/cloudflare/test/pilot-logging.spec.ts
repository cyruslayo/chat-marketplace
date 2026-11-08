import { SELF } from "cloudflare:test";
import { expect, test, vi } from "vitest";
import { AssistantTurnRun } from "../../local-guest/src/assistant/assistant-turn-record.js";
import { HTTP_REQUEST_LOG_EVENT, UNHANDLED_REJECTION_LOG_EVENT, logUnhandledRejection } from "../src/worker.js";

// Production-launch issue 10 — structured request and assistant logging on the Worker (wraps pilot 24).
// ADR 0075: no body, query value, prompt, reply, cookie or identity material in a log line.

const ORIGIN = "https://pilot.example.test";
const SECRET_TOKEN = "operator-token-super-secret";
const GUEST_EMAIL = "guest.metrics@example.test";
const GUEST_PHONE = "+2348012345678";

function capturedLines(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  const spyLog = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
  const spyError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
  return { lines, restore() { spyLog.mockRestore(); spyError.mockRestore(); } };
}

function records(lines: readonly string[], event: string): Record<string, unknown>[] {
  return lines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.event === event);
}

test("AC1 — Each request logs route, status, latency and a request id, and no body or query values", async () => {
  const capture = capturedLines();
  try {
    const response = await SELF.fetch(`${ORIGIN}/_internal/probe?token=${encodeURIComponent(SECRET_TOKEN)}&email=${encodeURIComponent(GUEST_EMAIL)}`, { redirect: "manual" });
    expect(response.status).toBe(404);
  } finally {
    capture.restore();
  }
  const [line] = records(capture.lines, HTTP_REQUEST_LOG_EVENT);
  expect(line).toBeDefined();
  expect(line!.route).toBe("/_internal/probe");
  expect(line!.method).toBe("GET");
  expect(line!.status).toBe(404);
  expect(typeof line!.request_id).toBe("string");
  expect((line!.request_id as string).length).toBeGreaterThan(8);
  expect(typeof line!.duration_ms).toBe("number");
  expect(Number(line!.duration_ms)).toBeGreaterThanOrEqual(0);
  // No query value, body or identifier is in the line.
  expect(capture.lines.join("\n")).not.toContain(SECRET_TOKEN);
  expect(capture.lines.join("\n")).not.toContain(GUEST_EMAIL);
});

test("AC2 — Assistant diagnostics log provider, model, latency, status and error class, and no prompt or reply text", () => {
  const run = new AssistantTurnRun({ runId: "run-log-test", startedAtMs: 1_000, forward: () => undefined, isRegisteredTool: () => true });
  run.startPlannerCall();
  const record = run.toRecord({ modelName: "provider/model-a", providerName: "openai-compatible", threw: true, endedAtMs: 1_250 });
  expect(record["gen_ai.provider.name"]).toBe("openai-compatible");
  expect(record["gen_ai.request.model"]).toBe("provider/model-a");
  expect(record["error.type"]).toBe("runtime_exception");
  expect(record["assistant.duration_ms"]).toBe(250);
  const serialized = JSON.stringify(record);
  for (const forbidden of ["prompt", "reply", "messages", "content"]) {
    expect(serialized).not.toContain(`"${forbidden}"`);
  }
});

test("AC3 — Unhandled rejections are logged", () => {
  const capture = capturedLines();
  try {
    logUnhandledRejection(new TypeError("prompt text that must never be logged"));
  } finally {
    capture.restore();
  }
  const [line] = records(capture.lines, UNHANDLED_REJECTION_LOG_EVENT);
  expect(line).toBeDefined();
  expect(line!.error_class).toBe("TypeError");
  expect(capture.lines.join("\n")).not.toContain("prompt text that must never be logged");
});

test("AC4 — A request carrying a cookie, token, phone or email produces a log line with none of them", async () => {
  const capture = capturedLines();
  try {
    const response = await SELF.fetch(
      `${ORIGIN}/_internal/probe?token=${encodeURIComponent(SECRET_TOKEN)}&phone=${encodeURIComponent(GUEST_PHONE)}&email=${encodeURIComponent(GUEST_EMAIL)}`,
      { headers: { cookie: `shortlet_operator_session=${SECRET_TOKEN}; guest_email=${GUEST_EMAIL}`, authorization: `Bearer ${SECRET_TOKEN}` }, redirect: "manual" },
    );
    expect(response.status).toBe(404);
  } finally {
    capture.restore();
  }
  const [line] = records(capture.lines, HTTP_REQUEST_LOG_EVENT);
  expect(line).toBeDefined();
  const joined = capture.lines.join("\n");
  for (const value of [SECRET_TOKEN, GUEST_EMAIL, GUEST_PHONE, "shortlet_operator_session", "authorization"]) {
    expect(joined).not.toContain(value);
  }
});
