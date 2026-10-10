import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalApartmentOwnerEnvironment,
  startLocalOwnerServer,
} from "../apps/local-owner/src/index.js";
import {
  createOwnerRequestHandler,
  type OwnerRequestHandler,
} from "../apps/local-owner/src/local-owner-server.js";
import type {
  HttpRequestLike,
  HttpResponseLike,
} from "../packages/platform-core/src/http-like.js";
import {
  createFakeHttpRequest,
  createFakeHttpResponse,
  type CapturedResponse,
} from "./helpers/http-like.js";

/** AC1: a minimal object implementing only the narrow interfaces type-checks. */
class MinimalRequestLike implements HttpRequestLike {
  readonly method = "GET";
  readonly url = "/";
  readonly headers = {};

  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    _event: "data" | "end" | "error",
    _listener: ((chunk: Buffer) => void) | (() => void) | ((error: Error) => void),
  ): this {
    return this;
  }

  resume(): this {
    return this;
  }
}

class MinimalResponseLike implements HttpResponseLike {
  get headersSent(): boolean {
    return true;
  }

  writeHead(_statusCode: number, _headers?: Record<string, string | number>): this {
    return this;
  }

  setHeader(_name: string, _value: string | number): this {
    return this;
  }

  end(_body?: string | Buffer): this {
    return this;
  }

  destroy(_error?: Error): this {
    return this;
  }
}

test("08b AC1: createOwnerRequestHandler().handle accepts only HttpRequestLike and HttpResponseLike", () => {
  // Minimal objects implementing only the interfaces type-check.
  const request: HttpRequestLike = new MinimalRequestLike();
  const response: HttpResponseLike = new MinimalResponseLike();
  assert.equal(typeof createOwnerRequestHandler, "function");
  assert.equal(typeof request.on, "function");
  assert.equal(typeof response.end, "function");
  // The narrow direction holds: objects missing the required members are refused.
  {
    // @ts-expect-error a request without the event dispatch is not an HttpRequestLike
    const missingEvents: HttpRequestLike = { headers: {} };
    void missingEvents;
  }
  {
    // @ts-expect-error a response without writeHead/setHeader/destroy is not an HttpResponseLike
    const missingWrites: HttpResponseLike = { headersSent: false };
    void missingWrites;
  }
});

interface Transport {
  request(
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: Buffer,
  ): Promise<CapturedResponse>;
}

function setCookieValues(captured: CapturedResponse, name: string): string[] {
  return captured.headers.filter((entry) => entry.name === name).map((entry) => entry.value);
}

/** Cookie header values for `shortlet_operator_session` and `shortlet_operator_secret` in write order. */
function sessionCookieHeader(captured: CapturedResponse): string {
  const bodies = [
    ...setCookieValues(captured, "set-cookie").filter((value) => value.startsWith("shortlet_operator_session=")),
    ...setCookieValues(captured, "set-cookie").filter((value) => value.startsWith("shortlet_operator_secret=")),
  ].map((value) => value.split(";")[0]!);
  if (bodies.length !== 2) throw new Error(`login must set the two operator cookies, saw ${bodies.length}`);
  return bodies.join("; ");
}

/** Real transport: everything goes through a node:http server like a browser would. */
function httpTransport(base: string): Transport {
  return {
    async request(method, url, headers = {}, body) {
      const response = await fetch(new URL(url, base), {
        method,
        headers: { ...headers },
        ...(body === undefined ? {} : { body: new Uint8Array(body) }),
        redirect: "manual",
      });
      const captured: { name: string; value: string }[] = [];
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== "set-cookie") captured.push({ name: name.toLowerCase(), value });
      });
      for (const value of response.headers.getSetCookie()) {
        captured.push({ name: "set-cookie", value });
      }
      return {
        statusCode: response.status,
        headers: captured,
        body: Buffer.from(await response.arrayBuffer()),
        destroyed: false,
      };
    },
  };
}

/** Fake transport: everything goes through the handler with the hand-built fakes. */
function fakeTransport(handler: OwnerRequestHandler): Transport {
  return {
    async request(method, url, headers = {}, body) {
      const request = createFakeHttpRequest({
        method,
        url,
        headers: body === undefined ? headers : { ...headers, "content-length": String(body.length) },
        ...(body === undefined ? {} : { body }),
      });
      const { response, finished } = createFakeHttpResponse();
      const handled = handler.handle(request, response);
      const captured = await Promise.race([finished, handled.then(() => finished)]);
      await handled;
      return await captured;
    },
  };
}

/** Random session ids/secret hashes must not decide parity, and neither may node:http transport headers. */
const TRANSPORT_ONLY_HEADERS = new Set(["connection", "date", "keep-alive", "transfer-encoding", "content-length"]);

function normalizeFacts(captured: CapturedResponse): {
  statusCode: number;
  headers: { name: string; value: string }[];
  body: string;
} {
  const portable = (value: string): string =>
    value
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
      .replace(/(shortlet_operator_session=)[^;\s"']*/g, "$1<session>")
      .replace(/(shortlet_operator_secret=)[^;\s"']*/g, "$1<secret>");
  return {
    statusCode: captured.statusCode,
    headers: captured.headers
      .filter((entry) => !TRANSPORT_ONLY_HEADERS.has(entry.name))
      .map((entry) => ({ name: entry.name, value: portable(entry.value) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value)),
    body: portable(captured.body.toString("utf8")),
  };
}

const FIXED_CLOCK = new Date("2026-09-03T10:02:00.000Z");
const OPERATOR_ORIGIN = "http://operator.test";

/** Identically seeded owner environment over a temporary database, with a fixed clock. */
async function ownerEnvironment(directory: string) {
  return LocalApartmentOwnerEnvironment.openNode({
    databasePath: join(directory, "owner.sqlite"),
    clock: () => FIXED_CLOCK,
  });
}

test("08b AC2: operator login, a session-protected page and the receipt read behave like the Node server", async () => {
  const handlerDirectory = await mkdtemp(join(tmpdir(), "owner-handler-fake-"));
  const serverDirectory = await mkdtemp(join(tmpdir(), "owner-handler-node-"));
  try {
    const fakeEnv = await ownerEnvironment(handlerDirectory);
    const realEnv = await ownerEnvironment(serverDirectory);
    const handler = createOwnerRequestHandler({
      environment: fakeEnv,
      publicOrigin: OPERATOR_ORIGIN,
    });
    const server = startLocalOwnerServer({
      port: 0,
      environment: realEnv,
      publicOrigin: OPERATOR_ORIGIN,
    });
    try {
      const base = `http://127.0.0.1:${await server.listen()}`;
      const fake = fakeTransport(handler);
      const real = httpTransport(base);
      const runs = async (transport: Transport, env: LocalApartmentOwnerEnvironment): Promise<CapturedResponse[]> => {
        const token = env.provisionOperatorAccessToken();
        const login = await transport.request(
          "POST",
          "/operator/login",
          { origin: OPERATOR_ORIGIN },
          Buffer.from(new URLSearchParams({ token }).toString(), "utf8"),
        );
        // The session-protected back-office home read with the cookies the login just issued.
        const home = await transport.request("GET", "/operator", { cookie: sessionCookieHeader(login) });
        // ADR 0090: the receipt read route exists for signed-in representatives; unknown transfers are 404.
        const receipt = await transport.request(
          "GET",
          "/operator/transfers/no-such-transfer/receipt",
          { cookie: sessionCookieHeader(login) },
        );
        // Failure paths (ADRs 0086, 0090): no valid session is redirected to sign-in; the receipt read is refused.
        const homeUnsigned = await transport.request("GET", "/operator");
        const receiptUnsigned = await transport.request("GET", "/operator/transfers/no-such-transfer/receipt");
        return [login, home, receipt, homeUnsigned, receiptUnsigned];
      };
      const fakeRuns = await runs(fake, fakeEnv);
      const realRuns = await runs(real, realEnv);
      assert.equal(fakeRuns.length, realRuns.length);
      for (let index = 0; index < fakeRuns.length; index += 1) {
        assert.deepEqual(
          normalizeFacts(fakeRuns[index]!),
          normalizeFacts(realRuns[index]!),
          `response ${index} must match through both invocation styles`,
        );
      }
      assert.equal(fakeRuns[0]!.statusCode, 302, "a valid access token signs in");
      assert.deepEqual(
        setCookieValues(fakeRuns[0]!, "set-cookie").filter((value) => value.startsWith("shortlet_operator_session=")).length,
        1,
        "the login response sets the session cookie as its own header",
      );
      assert.deepEqual(
        setCookieValues(fakeRuns[0]!, "set-cookie").filter((value) => value.startsWith("shortlet_operator_secret=")).length,
        1,
        "the login response sets the secret cookie as its own header",
      );
      assert.equal(fakeRuns[1]!.statusCode, 200, "a signed-in back-office page renders");
      assert.equal(fakeRuns[2]!.statusCode, 404, "the receipt read answers not found for an unknown transfer");
      assert.ok(
        fakeRuns[2]!.headers.some((entry) => entry.name === "cache-control" && entry.value.includes("no-store")),
        "the receipt read is never cached",
      );
      assert.equal(fakeRuns[3]!.statusCode, 303, "a page without a session is redirected to sign-in");
      assert.ok(
        fakeRuns[3]!.headers.some((entry) => entry.name === "location" && entry.value === "/operator/login"),
        "the sign-in redirect goes to /operator/login",
      );
      assert.equal(fakeRuns[4]!.statusCode, 303, "a receipt read without a session is refused");
    } finally {
      await server.close();
      await handler.close();
      fakeEnv.close();
      realEnv.close();
    }
  } finally {
    await rm(handlerDirectory, { recursive: true, force: true });
    await rm(serverDirectory, { recursive: true, force: true });
  }
});

test("08b AC3: close() leaves no running timers and the environment closed", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "owner-handler-close-"));
  const env = await ownerEnvironment(directory);
  try {
    const handler = createOwnerRequestHandler({ environment: env });
    try {
      testContext.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
      const fake = fakeTransport(handler);
      const login = await fake.request(
        "POST",
        "/operator/login",
        {},
        Buffer.from(new URLSearchParams({ token: env.provisionOperatorAccessToken() }).toString(), "utf8"),
      );
      assert.equal(login.statusCode, 302);
      // An idle hour passes; nothing the handler scheduled may wake up.
      testContext.mock.timers.tick(60 * 60 * 1000);
      const home = await fake.request("GET", "/operator", { cookie: sessionCookieHeader(login) });
      assert.equal(home.statusCode, 200);
      // close() stops the handler; nothing can wake or serve after it.
      await handler.close();
      testContext.mock.timers.tick(60 * 60 * 1000);
      // And closing again changes nothing.
      await handler.close();
      // The environment is closed: reads fail closed rather than serve.
      assert.throws(() => env.sessionAuthority.sessionRejection("no-session", "no-secret"));
    } finally {
      testContext.mock.reset();
      await handler.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
