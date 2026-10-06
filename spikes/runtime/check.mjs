import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const origin = "http://localhost:5183";
let response;
for (let attempt = 0; attempt < 60; attempt++) {
  try { response = await fetch(origin); if (response.ok) break; } catch {}
  await sleep(500);
}
assert.ok(response?.ok, "cf dev did not start");
const runtime = await response.json();
const formatter = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
const node = {
  digest: createHmac("sha512", "synthetic-spike-key").update(new Uint8Array([0, 255, 123, 34, 195, 169, 34, 125])).digest("hex"),
  intl: ["2026-01-01T00:00:00Z", "2026-07-22T23:30:00Z", "2026-12-31T23:00:00Z"].map(value => formatter.format(new Date(value))),
};
assert.equal(runtime.digest, node.digest);
assert.deepEqual(runtime.intl, node.intl);
assert.deepEqual(runtime.ips, [4, 6, 0]);
assert.equal(runtime.equal, true);
assert.equal(runtime.unequal, false);
assert.equal(runtime.modelCalls, 1);
assert.equal(runtime.generated, "mocked-gemini-ok");
assert.equal(runtime.importedBuffer, "00ff");
assert.ok(runtime.synchronousClockDeltaMs >= 0); // Report observed local clock behaviour rather than forcing the PRD assumption.
console.log(JSON.stringify({ runtime, node }, null, 2));

const boundary = "synthetic-probe-boundary";
const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="synthetic.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
const upload = new ReadableStream({ async start(controller) {
  controller.enqueue(prefix);
  controller.enqueue(new Uint8Array(64 * 1024));
  await sleep(300);
  for (let sent = 64 * 1024; sent < 5 * 1024 * 1024; sent += 64 * 1024) controller.enqueue(new Uint8Array(64 * 1024));
  controller.enqueue(suffix); controller.close();
} });
const streamed = await fetch(`${origin}/multipart`, { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: upload, duplex: "half" });
assert.ok(streamed.ok);
const multipart = await streamed.json();
assert.equal(multipart.bytes, 5 * 1024 * 1024 + prefix.length + suffix.length);
assert.ok(multipart.chunks > 1);
console.log(JSON.stringify({ multipart }, null, 2));
