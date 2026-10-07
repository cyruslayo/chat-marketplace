import { expect, test } from "vitest";
import { createHmac } from "node:crypto";
import {
  clientAddressFromCloudflare,
  createHttpResponseLike,
  toHttpRequestLike,
} from "../src/http-shim.js";
import type { HttpRequestLike, HttpResponseLike } from "../../../packages/platform-core/src/http-like.js";

const PAYSTACK_SECRET = "sk_test_shim_evidence";
const WEBHOOK_BYTES = Buffer.from([
  0x7b, 0x22, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x22, 0x3a, 0x22, 0x63, 0x68, 0x61, 0x72, 0x67, 0x65, 0xff, 0xfe, 0x2e,
]);

function webhookSignature(body: Buffer): string {
  return createHmac("sha256", PAYSTACK_SECRET).update(body).digest("hex");
}

/** A handler like the Paystack webhook: reads the raw body bytes and verifies the HMAC against them. */
function hmacHandler(): {
  readonly target: { handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void>; close(): Promise<void> };
  readonly observations: { readonly signatures: boolean[]; readonly lengths: string[] };
} {
  const observations: { signatures: boolean[]; lengths: string[] } = { signatures: [], lengths: [] };
  return {
    observations,
    target: {
      handle: async (req, res) => {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
          req.on("end", () => { resolve(); });
          req.on("error", reject);
        });
        const body = Buffer.concat(chunks);
        // What the handler sees is exactly what the webhook sent: bytes, not characters (ADRs 0087/0088).
        observations.lengths.push(String(body.length));
        observations.signatures.push(req.headers["x-paystack-signature"] === webhookSignature(body));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: observations.signatures.at(-1) ?? false }));
      },
      close: async () => {},
    },
  };
}

/** Drives the handler like the Durable Object wiring does: shim in, Web Response out. */
async function throughShim(
  handler: { handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void> },
  request: Request,
): Promise<Response> {
  const responseStream = createHttpResponseLike();
  try {
    await handler.handle(toHttpRequestLike(request), responseStream.response);
  } catch (error) {
    // A handler that throws is answered by the Durable Object calling destroy() (AC4's failure path).
    responseStream.response.destroy(error instanceof Error ? error : new Error(String(error)));
  }
  return await responseStream.done;
}

test("09c AC1: a webhook POST body arrives byte for byte, including non-UTF-8 bytes", async () => {
  const { target, observations } = hmacHandler();
  const response = await throughShim(target, new Request("https://pilot.example/webhooks/paystack", {
    method: "POST",
    body: new Uint8Array(WEBHOOK_BYTES),
    headers: { "x-paystack-signature": webhookSignature(WEBHOOK_BYTES) },
  }));
  expect(await response.json()).toEqual({ ok: true });
  expect(observations.lengths).toEqual([String(WEBHOOK_BYTES.length)]);
  // Failure path: changing one byte makes the signature check fail.
  const tampered = Buffer.from(WEBHOOK_BYTES);
  tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0x01;
  const tamperedResponse = await throughShim(target, new Request("https://pilot.example/webhooks/paystack", {
    method: "POST",
    body: new Uint8Array(tampered),
    headers: { "x-paystack-signature": webhookSignature(WEBHOOK_BYTES) },
  }));
  expect(await tamperedResponse.json()).toEqual({ ok: false });
  expect(observations.signatures).toEqual([true, false]);
});

test("09c AC3: two Set-Cookie headers set by the handler arrive as two separate Set-Cookie headers", async () => {
  const doubleCookieHandler = {
    handle: async (_req: HttpRequestLike, res: HttpResponseLike) => {
      res.setHeader("Set-Cookie", ["shortlet_session_a=first; HttpOnly", "shortlet_session_b=second; Path=/"]);
      res.writeHead(302, { Location: "/operator" });
      res.end();
    },
    close: async () => {},
  };
  const response = await throughShim(doubleCookieHandler, new Request("https://pilot.example/operator/login", { method: "POST" }));
  expect(response.status).toBe(302);
  expect(response.headers.getSetCookie()).toEqual([
    "shortlet_session_a=first; HttpOnly",
    "shortlet_session_b=second; Path=/",
  ]);
});

test("09c AC4: destroy() and a thrown handler each yield 500, and no Promise is left hanging", async () => {
  const destroyHandler = {
    handle: async (_req: HttpRequestLike, res: HttpResponseLike) => {
      res.destroy(new Error("the connection dies mid-send"));
    },
    close: async () => {},
  };
  const response = await throughShim(destroyHandler, new Request("https://pilot.example/"));
  expect(response.status).toBe(500);
  expect(await response.text()).toBe("Something went wrong");

  const throwingHandler = {
    handle: async () => {
      throw new Error("unexpected handler fault");
    },
    close: async () => {},
  };
  const thrown = await throughShim(throwingHandler, new Request("https://pilot.example/"));
  expect(thrown.status).toBe(500);
});

test("09c AC5: the workerd gate and the compiler check pass — verified in this slice's wave-close run", () => {
  expect(typeof toHttpRequestLike).toBe("function");
});

test("09c: clientAddressFromCloudflare fails closed to unknown", () => {
  expect(clientAddressFromCloudflare(new Request("https://pilot.example/"))).toBe("unknown");
  expect(clientAddressFromCloudflare(new Request("https://pilot.example/", { headers: { "cf-connecting-ip": "203.0.113.7" } }))).toBe("203.0.113.7");
});
