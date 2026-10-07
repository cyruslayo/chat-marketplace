import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { assertOpsUrlAllowed, remoteOpsConfiguration } from "../apps/shortlet-ops/src/ops-client.js";

test("11b AC3: a non-https, non-localhost ops URL is refused before any request is sent", () => {
  assert.throws(() => assertOpsUrlAllowed("http://ops.example.com"), /https/);
  assert.throws(() => remoteOpsConfiguration({ SHORTLET_OPS_URL: "http://ops.example.com" }), /https/);
  assert.throws(() => remoteOpsConfiguration({ SHORTLET_OPS_URL: "not a url" }), /absolute URL/);
  assert.equal(assertOpsUrlAllowed("https://ops.example.com").protocol, "https:");
  assert.equal(assertOpsUrlAllowed("http://127.0.0.1:8787").hostname, "127.0.0.1");
  assert.equal(assertOpsUrlAllowed("http://localhost:8787").hostname, "localhost");
});

test("11b AC4: with SHORTLET_OPS_URL unset the CLIs keep their local behaviour", () => {
  assert.equal(remoteOpsConfiguration({}), null);
  assert.equal(remoteOpsConfiguration({ SHORTLET_OPS_URL: "   " }), null);
});

test("11b AC3: the operator CLIs send both authentication layers to the configured ops URL", async () => {
  const seen: { readonly url?: string; readonly headers?: Record<string, string | string[] | undefined> } = {};
  const server = createServer((request, response) => {
    (seen as { url?: string }).url = request.url;
    (seen as { headers?: Record<string, string | string[] | undefined> }).headers = request.headers;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      operators: [{ id: "op-remote-1", tenantId: "tenant-remote", name: "Remote Operator", status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
    }));
  });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  try {
    const child = spawn(process.execPath, ["--import", "tsx", "apps/shortlet-ops/src/cli-operator-list.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SHORTLET_OPS_URL: `http://127.0.0.1:${port}`,
        SHORTLET_OPS_SECRET: "shared-secret-value",
        CF_ACCESS_CLIENT_ID: "access-client-id",
        CF_ACCESS_CLIENT_SECRET: "access-client-secret",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const code = await new Promise<number | null>((resolve) => { child.on("close", resolve); });

    assert.equal(code, 0, stderr);
    assert.match(stdout, /op-remote-1/);
    assert.equal(seen.url, "/_ops/operators");
    assert.equal(seen.headers?.["x-shortlet-ops-secret"], "shared-secret-value");
    assert.equal(seen.headers?.["cf-access-client-id"], "access-client-id");
    assert.equal(seen.headers?.["cf-access-client-secret"], "access-client-secret");
  } finally {
    server.close();
  }
});
