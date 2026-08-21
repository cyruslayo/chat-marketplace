import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";
process.env.GEMINI_API_KEY = "test-key";

test("CopilotKit v2 runtime exposes discovery and fresh-thread connect routes", async () => {
  const { app } = await import("../server.js");
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/copilotkit`;

  try {
    const info = await fetch(`${baseUrl}/info`);
    assert.equal(info.status, 200);
    const payload = (await info.json()) as { agents?: Record<string, unknown> };
    assert.ok(payload.agents?.default);

    const threads = await fetch(`${baseUrl}/threads?agentId=default`);
    assert.equal(threads.status, 200);

    const connect = await fetch(`${baseUrl}/agent/default/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-contract-test",
        runId: "run-contract-test",
        messages: [],
        tools: [],
        context: []
      })
    });
    assert.notEqual(connect.status, 404);
    assert.match(connect.headers.get("content-type") ?? "", /text\/event-stream/);
    await connect.text();

    const missingAgent = await fetch(`${baseUrl}/agent/missing/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread-missing", runId: "run-missing", messages: [], tools: [], context: [] })
    });
    assert.equal(missingAgent.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
});
