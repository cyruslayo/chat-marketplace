import type {
  HttpRequestLike,
  HttpResponseHeaderValueOrList,
  HttpResponseLike,
} from "./http-like.js";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Slice 09c: the Fetch-to-node-HTTP adapter. A Durable Object receives a Web `Request` and must return a Web
 * `Response`; the extracted handlers (08a–08c) speak the narrow node-shaped interfaces, so the shim translates
 * between the two without changing one line of handler logic. This shared implementation compiles under both
 * the Node-Types program and the Workers-Types program OF the repository; `apps/cloudflare/src/http-shim.ts`
 * re-exports it as the Durable Object's single import site.
 *
 * Byte-for-byte rule (ADRs 0087/0088): webhook bodies travel to the handler exactly as they arrived — no text
 * decoding or re-encoding anywhere in the body path.
 */

/** `url` is the request path plus query, exactly as node:http delivers it to a handler. */
function requestPathFrom(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

/** Lower-cased header names in Node's shape; repeated `Set-Cookie` values stay a list. */
function nodeHeadersFrom(request: Request): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  // Optional accessor so the same code type-checks under both the Node and Workers Headers shapes.
  const setCookie = (
    request.headers as Headers & { getSetCookie?: () => readonly string[] }
  ).getSetCookie?.();
  if (setCookie && setCookie.length > 0) headers["set-cookie"] = [...setCookie];
  return headers;
}

class BodyPump {
  readonly #data: Array<(chunk: Buffer) => void> = new Array();
  readonly #end: Array<() => void> = new Array();
  readonly #error: Array<(error: Error) => void> = new Array();
  #started = false;
  #ended = false;

  constructor(private readonly body: null | { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } }) {}

  private async pump(): Promise<void> {
    if (this.body === null) {
      this.#ended = true;
      for (const listener of this.#end) listener();
      return;
    }
    const reader = this.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // The exact raw bytes go through untouched: no decode, no re-encode (webhook HMAC, ADRs 0087/0088).
        const chunk = Buffer.from(value!);
        for (const listener of this.#data) listener(chunk);
      }
      this.#ended = true;
      for (const listener of this.#end) listener();
    } catch (error) {
      this.#ended = true;
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const listener of this.#error) listener(failure);
    }
  }

  /**
   * Registers a listener and starts the pump; already-ended streams fire what applies immediately.
   * The listener union is narrowed by the event name (the callers' overloads guarantee that).
   */
  subscribe(
    eventName: "data" | "end" | "error",
    listener: ((chunk: Buffer) => void) | (() => void) | ((error: Error) => void),
  ): void {
    if (eventName === "data") {
      this.#data.push(listener as (chunk: Buffer) => void);
      this.start();
    } else if (eventName === "end") {
      this.#end.push(listener as () => void);
      this.start();
    } else {
      this.#error.push(listener as (error: Error) => void);
      this.start();
    }
  }

  /** Node semantics: the stream flows without a listener; unconsumed bytes are drained and discarded. */
  drain(): void {
    this.start();
  }

  private start(): void {
    if (this.#started || this.#ended) return;
    this.#started = true;
    void this.pump();
  }
}

/** `toHttpRequestLike` turns a Fetch `Request` into exactly the surface 08a's handlers consume. */
export function toHttpRequestLike(request: Request): HttpRequestLike {
  const body = new BodyPump(request.body);
  const requestLike: HttpRequestLike = {
    method: request.method,
    url: requestPathFrom(request.url),
    headers: nodeHeadersFrom(request),
    on(eventName, listener) {
      body.subscribe(eventName as "data" | "end" | "error", listener);
      return requestLike;
    },
    resume() {
      body.drain();
      return requestLike;
    },
  };
  return requestLike;
}

interface CapturedHeader {
  readonly name: string;
  readonly value: HttpResponseHeaderValueOrList;
}

const UNEXPECTED_ERROR_STATUS = 500;
const UNEXPECTED_ERROR_BODY = "Something went wrong";
const UNEXPECTED_ERROR_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * `createHttpResponseLike` collects the handler's writes and hands the caller the Web `Response` to return.
 * Several `Set-Cookie` values are appended one by one, never joined. `destroy()` — and a handler that throws,
 * which the Durable Object wiring turns into a `destroy()` call — settles an unsent response as a 500, so no
 * Promise is ever left hanging.
 */
export interface HttpResponseStream {
  readonly response: HttpResponseLike;
  /** Resolves exactly once, when the handler ends the response (or destroys it). */
  readonly done: Promise<Response>;
}

export function createHttpResponseLike(): HttpResponseStream {
  let entries: CapturedHeader[] = [];
  let statusCode = 200;
  let headersWritten = false;
  let settled = false;
  let resolveDone!: (response: Response) => void;
  const done = new Promise<Response>((resolve) => {
    resolveDone = resolve;
  });
  /** Node semantics: `setHeader` replaces what the name has; `writeHead` adds its own on top. */
  const capture = (
    name: string,
    value: HttpResponseHeaderValueOrList,
    replace: boolean,
  ): void => {
    if (replace) {
      entries = entries.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase());
    }
    entries.push({ name, value });
  };
  const webHeaders = (): Headers => {
    const headers = new Headers();
    for (const entry of entries) {
      for (const value of Array.isArray(entry.value) ? entry.value : [entry.value]) {
        headers.append(entry.name, String(value));
      }
    }
    return headers;
  };
  const settle = (response: Response): void => {
    if (settled) return;
    settled = true;
    resolveDone(response);
  };
  const responseLike: HttpResponseLike = {
    get headersSent() {
      return headersWritten || settled;
    },
    writeHead(status, headers) {
      if (settled) return responseLike;
      for (const [name, value] of Object.entries(headers ?? {})) {
        capture(name, value, false);
      }
      statusCode = status;
      headersWritten = true;
      return responseLike;
    },
    setHeader(name, value) {
      if (settled) return responseLike;
      capture(name, value, true);
      return responseLike;
    },
    end(body) {
      if (settled) return responseLike;
      if (!headersWritten) headersWritten = true;
      const headersOut = webHeaders();
      settle(
        body === undefined
          ? new Response(null, { status: statusCode, headers: headersOut })
          : // The webhook bytes must arrive exactly as sent: a string stays a string, bytes stay `Uint8Array`.
            new Response(typeof body === "string" ? body : new Uint8Array(body), { status: statusCode, headers: headersOut }),
      );
      return responseLike;
    },
    destroy(error) {
      // Before anything was sent the caller sees the familiar per-request error page; after headers were sent
      // the response resolves with what was written (Workers cannot half-send a Response).
      if (headersWritten) {
        settle(new Response(null, { status: statusCode, headers: webHeaders() }));
      } else {
        statusCode = UNEXPECTED_ERROR_STATUS;
        entries = [{ name: "Content-Type", value: UNEXPECTED_ERROR_CONTENT_TYPE }];
        settle(new Response(UNEXPECTED_ERROR_BODY, { status: UNEXPECTED_ERROR_STATUS, headers: webHeaders() }));
      }
      return responseLike;
    },
  };
  return { response: responseLike, done };
}

/**
 * The connected client's address, sent by the edge. It fails closed to `"unknown"` when the header is absent,
 * so an unknowable client shares one rate-limit bucket instead of skipping limits.
 *
 * The node-shaped shim carries the same `cf-connecting-ip` header, so a long-lived handler — whose rate limiters
 * must keep their windows across requests — reads the address from `HttpRequestLike.headers` through this shared
 * rule rather than calling the `Request` overload.
 */
export function clientAddressFromCloudflareHeaderValue(value: string | readonly string[] | undefined): string {
  const header = Array.isArray(value) ? value.join(",") : value;
  const address = typeof header === "string" ? header.trim() : "";
  return address === "" ? "unknown" : address;
}

export function clientAddressFromCloudflare(request: Request): string {
  return clientAddressFromCloudflareHeaderValue(request.headers.get("cf-connecting-ip") ?? undefined);
}
