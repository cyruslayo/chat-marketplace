import { DurableObject } from "cloudflare:workers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer as ImportedBuffer } from "node:buffer";
import { isIP } from "node:net";
import { GoogleGenAI } from "@google/genai";

interface Env { PROBE: DurableObjectNamespace<RuntimeProbe> }
export class RuntimeProbe extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/multipart") {
      const reader = request.body!.getReader();
      const first = await reader.read();
      const started = Date.now();
      let bytes = first.value?.byteLength ?? 0;
      let chunks = first.done ? 0 : 1;
      let largestChunk = bytes;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength; chunks++;
        largestChunk = Math.max(largestChunk, chunk.value.byteLength);
      }
      return Response.json({ bytes, chunks, largestChunk, readDurationMs: Date.now() - started, contentType: request.headers.get("content-type") });
    }
    const raw = new Uint8Array([0, 255, 123, 34, 195, 169, 34, 125]);
    const digest = createHmac("sha512", "synthetic-spike-key").update(raw).digest();
    const formatter = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
    const before = Date.now();
    let sum = 0;
    for (let i = 0; i < 2_000_000; i++) sum += i;
    const after = Date.now();
    const originalFetch = globalThis.fetch;
    let modelCalls = 0;
    let generated = "";
    try {
      globalThis.fetch = async () => {
        modelCalls++;
        return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "mocked-gemini-ok" }] }, finishReason: "STOP" }] });
      };
      generated = (await new GoogleGenAI({ apiKey: "synthetic-not-a-live-key" }).models.generateContent({ model: "gemini-2.5-flash", contents: "synthetic probe" })).text ?? "";
    } finally { globalThis.fetch = originalFetch; }
    return Response.json({
      digest: digest.toString("hex"), equal: timingSafeEqual(digest, ImportedBuffer.from(digest)), unequal: timingSafeEqual(digest, ImportedBuffer.alloc(digest.length)),
      ips: [isIP("127.0.0.1"), isIP("::1"), isIP("not-an-ip")],
      intl: ["2026-01-01T00:00:00Z", "2026-07-22T23:30:00Z", "2026-12-31T23:00:00Z"].map(value => formatter.format(new Date(value))),
      bufferGlobal: typeof globalThis.Buffer, importedBuffer: ImportedBuffer.from([0, 255]).toString("hex"),
      synchronousClockDeltaMs: after - before, sum, modelCalls, generated,
    });
  }
}
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.PROBE.get(env.PROBE.idFromName("runtime-probe")).fetch(request);
  },
};
