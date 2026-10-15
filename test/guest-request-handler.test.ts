import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import {
  createGuestRequestHandler,
  startLocalGuestServer,
  type GuestRequestHandler,
  type LocalGuestServerHandle,
} from "../apps/local-guest/src/guest-server.js";
import type {
  HttpRequestLike,
  HttpResponseLike,
} from "../packages/platform-core/src/http-like.js";
import { TEST_MANUAL_ACCOUNT, TEST_RECEIPTS, multipartBody } from "./helpers/guest-payment-page.js";
import {
  createFakeHttpRequest,
  createFakeHttpResponse,
  type CapturedResponse,
} from "./helpers/http-like.js";
import type { Unit } from "../domains/shortlet/src/index.js";

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

test("08a AC1: createGuestRequestHandler().handle accepts only HttpRequestLike and HttpResponseLike", () => {
  // Minimal objects implementing only the interfaces type-check.
  const request: HttpRequestLike = new MinimalRequestLike();
  const response: HttpResponseLike = new MinimalResponseLike();
  assert.equal(typeof createGuestRequestHandler, "function");
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

function cookieOf(captured: CapturedResponse): string {
  const setCookie = captured.headers.find((entry) => entry.name === "set-cookie");
  assert.ok(setCookie, "a session is issued on the first GET /");
  return setCookie.value.split(";")[0]!;
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
function fakeTransport(handler: GuestRequestHandler): Transport {
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

/** Random session cookies and minted ids must not decide parity, and neither may node:http transport headers. */
const TRANSPORT_ONLY_HEADERS = new Set(["connection", "date", "keep-alive", "transfer-encoding", "content-length"]);

function normalizeFacts(captured: CapturedResponse): {
  statusCode: number;
  headers: { name: string; value: string }[];
  body: string;
} {
  const portable = (value: string): string =>
    value
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
      .replace(/SL-[A-Z0-9]+/g, "SL-<reference>")
      .replace(/(shortlet_guest_session=)[^;\s"']*/g, "$1<session>");
  return {
    statusCode: captured.statusCode,
    headers: captured.headers
      .filter((entry) => !TRANSPORT_ONLY_HEADERS.has(entry.name))
      .map((entry) => ({ name: entry.name, value: portable(entry.value) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value)),
    body: portable(captured.body.toString("utf8")),
  };
}

const FIXED_CLOCK_MS = new Date("2026-09-03T10:02:00.000Z").getTime();

/** Identical seeds for the fake and the server style: one accepted, zero-deposit offer each. */
async function acceptedOfferEnvironment(directory: string): Promise<{
  environment: LocalGuestEnvironment;
  offerId: string;
}> {
  let current = new Date(FIXED_CLOCK_MS);
  const environment = LocalGuestEnvironment.openNode({
    databasePath: join(directory, "guest.sqlite"),
    initialGuestPhoneNumber: "+2348012345678",
    initialGuestContactEmail: "guest@example.test",
    manualTransferAccount: TEST_MANUAL_ACCOUNT,
    clock: () => current,
  });
  const unit = environment.unitRepository.findById("unit-lagos-ikoyi-001") as Unit;
  environment.unitRepository.save({ ...unit, price: { ...unit.price, refundableSecurityDepositKobo: 0 } });
  const draft = environment.bookingRequestApp.createDraft(
    {
      unitId: unit.id,
      primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
      occupants: environment.demoOccupants(2),
      selfBookingAttestation: environment.selfBookingAttestation(),
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
    },
    environment.guestPrincipal(),
  );
  const request = environment.bookingRequestApp.disclose(draft.draftId, environment.guestPrincipal());
  const { offerId } = environment.simulateOperatorAcceptance(request.requestId);
  const offer = environment.conditionalOfferApp.getOffer(offerId);
  environment.conditionalOfferApp.accept({
    offerId,
    confirmationToken: offer.confirmationToken,
    expectedVersion: offer.offerVersion,
    principal: environment.guestPrincipal(),
  });
  return { environment, offerId };
}

/** A no-JS composer form body (ADR 0080), url-encoded like the page's own form. */
function decodeFormBody(fields: Record<string, string>): Buffer {
  return Buffer.from(new URLSearchParams(fields).toString(), "utf8");
}

test("08a AC2: handle drives a GET page, a form POST and a multipart receipt upload like the Node server", async () => {
  // Two independent, identically seeded environments: one driven through the handler,
  // one through the node:http server the wrapper builds.
  const handlerDirectory = await mkdtemp(join(tmpdir(), "guest-handler-fake-"));
  const serverDirectory = await mkdtemp(join(tmpdir(), "guest-handler-node-"));
  try {
    const fakeSetup = await acceptedOfferEnvironment(handlerDirectory);
    const realSetup = await acceptedOfferEnvironment(serverDirectory);
    const handler = createGuestRequestHandler({
      environment: fakeSetup.environment,
      localPayment: true,
      conciergeMode: "deterministic",
    });
    const server: LocalGuestServerHandle = startLocalGuestServer({
      port: 0,
      environment: realSetup.environment,
      localPayment: true,
      conciergeMode: "deterministic",
    });
    try {
      const base = `http://127.0.0.1:${await server.listen()}`;
      const fake = fakeTransport(handler);
      const real = httpTransport(base);
      const runs = async (transport: Transport, offer: string): Promise<CapturedResponse[]> => {
        const home = await transport.request("GET", "/");
        const cookie = cookieOf(home);
        const transferPage = await transport.request(
          "GET",
          `/payments/offers/${encodeURIComponent(offer)}/manual-transfer`,
          { cookie, accept: "text/html" },
        );
        // The no-JS composer form (ADR 0080): a real form body read; an empty message re-renders with the error.
        const composer = await transport.request(
          "POST",
          "/conversation",
          { cookie, accept: "text/html" },
          decodeFormBody({ threadId: "", message: "" }),
        );
        // Start the manual transfer from the page's own plain form.
        const start = await transport.request(
          "POST",
          `/payments/offers/${encodeURIComponent(offer)}/manual-transfer`,
          { cookie, accept: "text/html" },
        );
        // A multipart receipt upload for the started transfer: full bounded body read, parse and store.
        const { body, contentType } = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
        const upload = await transport.request(
          "POST",
          `/payments/offers/${encodeURIComponent(offer)}/manual-transfer/receipt`,
          { cookie, "content-type": contentType },
          body,
        );
        // The transfer page after the upload: the same state the server would show.
        const afterUpload = await transport.request(
          "GET",
          `/payments/offers/${encodeURIComponent(offer)}/manual-transfer`,
          { cookie, accept: "text/html" },
        );
        return [home, transferPage, composer, start, upload, afterUpload];
      };
      const fakeRuns = await runs(fake, fakeSetup.offerId);
      const realRuns = await runs(real, realSetup.offerId);
      assert.equal(fakeRuns.length, realRuns.length);
      for (let index = 0; index < fakeRuns.length; index += 1) {
        assert.deepEqual(
          normalizeFacts(fakeRuns[index]!),
          normalizeFacts(realRuns[index]!),
          `response ${index} must match through both invocation styles`,
        );
      }
      assert.equal(fakeRuns[0]!.statusCode, 200, "a GET page renders");
      assert.equal(fakeRuns[2]!.statusCode, 400, "an empty composer message is refused, with the same page");
      assert.equal(fakeRuns[4]!.statusCode, 303, `the receipt upload succeeded: ${fakeRuns[4]!.statusCode} ${fakeRuns[4]!.body.toString("utf8").slice(0, 200)}`);
      assert.deepEqual(
        fakeRuns[4]!.headers.filter((entry) => entry.name === "set-cookie"),
        [],
        "the upload response sets no session cookie on either side",
      );
    } finally {
      await server.close();
      await handler.close();
      fakeSetup.environment.close();
      realSetup.environment.close();
    }
  } finally {
    await rm(handlerDirectory, { recursive: true, force: true });
    await rm(serverDirectory, { recursive: true, force: true });
  }
});

test("08a AC3: close() stops every timer the handler started; idle eviction stays lazy", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "guest-handler-close-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
  try {
    const handler = createGuestRequestHandler({
      environment,
      fixtureRoutes: false,
      sessionScopedGuestPrincipals: true,
      sessionRuntimeIdleMs: 60_000,
    });
    try {
      const fake = fakeTransport(handler);
      const firstCookie = cookieOf(await fake.request("GET", "/"));
      const secondCookie = cookieOf(await fake.request("GET", "/"));
      assert.equal(handler.activeSessionRuntimes, 2);
      // Idle time passing evicts nothing: eviction is per-request, the handler schedules no timer.
      testContext.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
      testContext.mock.timers.tick(600_000);
      assert.equal(handler.activeSessionRuntimes, 2, "idle time alone evicts no runtime");
      assert.notEqual(secondCookie, firstCookie);
      // close() releases the runtimes it started.
      await handler.close();
      assert.equal(handler.activeSessionRuntimes, 0);
      // Time keeps passing after close(); nothing can wake up.
      testContext.mock.timers.tick(600_000);
      assert.equal(handler.activeSessionRuntimes, 0);
      // And closing again changes nothing.
      await handler.close();
      assert.equal(handler.activeSessionRuntimes, 0);
    } finally {
      testContext.mock.reset();
      await handler.close();
    }
  } finally {
    environment.close();
    await rm(directory, { recursive: true, force: true });
  }
});
