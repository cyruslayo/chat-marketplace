import type {
  HttpRequestLike,
  HttpResponseHeaderValueOrList,
  HttpResponseLike,
} from "../../packages/platform-core/src/http-like.js";

/**
 * Hand-built fakes for the narrow HTTP interfaces (slice 08a), reused by the owner
 * handler (08b), the pilot (08c), the asset slices (09a/09b) and the Fetch-to-node-HTTP
 * shim (09c). They model only the behaviour the handlers rely on: a buffered body
 * delivered on "data"/"end" subscriptions, and a response that records the status,
 * headers and body the handler wrote.
 */

export interface FakeRequestOptions {
  readonly method: string;
  readonly url: string;
  /** Node-shape headers; repeated names may be arrays, exactly like node:http clients send them. */
  readonly headers?: Record<string, string | readonly string[]>;
  /** Raw byte body; never decoded or re-encoded, exactly as node:http delivers it. */
  readonly body?: Buffer;
}

interface FakeRequestListeners {
  data: Array<(chunk: Buffer) => void>;
  end: Array<() => void>;
  error: Array<(error: Error) => void>;
}

const EVENT_LISTENER_ERROR = (eventName: string): Error =>
  new Error(`The handlers never listen for "${eventName}"`);

/** A `HttpRequestLike` fake, plus the test-only `fail` hook for body-reader error paths. */
export interface FakeHttpRequest extends HttpRequestLike {
  /** Makes the stream deliver "error" instead of the body. */
  fail(error: Error): void;
}

/**
 * A `HttpRequestLike` with no socket. Body events fire like an already-buffered Node
 * request: after the first listener is registered, chunks arrive and then "end" fires in
 * a later microtask, so a body read that subscribes "data", "end" and "error" sees all
 * three before any event.
 */
export function createFakeHttpRequest(options: FakeRequestOptions): FakeHttpRequest {
  const { method, url, body } = options;
  const headers: Record<string, string | readonly string[]> = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  const listeners: FakeRequestListeners = { data: [], end: [], error: [] };
  let streamError: Error | null = null;
  let delivered = false;
  let scheduled = false;
  const deliver = (): void => {
    if (delivered) return;
    delivered = true;
    if (streamError !== null) {
      for (const listener of listeners.error) listener(streamError);
      return;
    }
    const chunks = body === undefined ? [] : [body];
    for (const chunk of chunks) {
      for (const listener of listeners.data) listener(chunk);
    }
    for (const listener of listeners.end) listener();
  };
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(deliver);
  };
  const request: FakeHttpRequest = {
    method,
    url,
    headers: headers as HttpRequestLike["headers"],
    on(eventName, listener) {
      if (eventName === "data") listeners.data.push(listener as (chunk: Buffer) => void);
      else if (eventName === "end") listeners.end.push(listener as () => void);
      else if (eventName === "error") listeners.error.push(listener as (error: Error) => void);
      else throw EVENT_LISTENER_ERROR(eventName);
      schedule();
      return request;
    },
    resume() {
      // Nothing is buffered between reads: an unconsumed stream simply ends harmlessly.
      return request;
    },
    fail(error: Error): void {
      streamError = error;
      schedule();
    },
  };
  return request;
}

/** Fails the stream, for body-reader error paths ("error" instead of "end"). */
export function failFakeHttpRequest(request: HttpRequestLike, error: Error): void {
  (request as FakeHttpRequest).fail(error);
}

export interface CapturedResponse {
  readonly statusCode: number;
  /** Every written header, in write order; repeated names (a pair of `Set-Cookie`s) keep their own entries. */
  readonly headers: ReadonlyArray<{ name: string; value: string }>;
  readonly body: Buffer;
  readonly destroyed: boolean;
}

export interface FakeHttpResponseHandle {
  readonly response: HttpResponseLike;
  /** Resolves when the handler ends or destroys the response; never hangs, so a bad handler is caught, not awaited forever. */
  readonly finished: Promise<CapturedResponse>;
}

interface HeaderEntry {
  name: string;
  value: string;
}

/** `setHeader` replaces the entries its name has (Node semantics); `writeHead` appends its own. */
function writeEntries(
  target: HeaderEntry[],
  name: string,
  value: HttpResponseHeaderValueOrList,
  replace: boolean,
): void {
  const lowered = name.toLowerCase();
  if (replace) {
    for (let index = target.length - 1; index >= 0; index -= 1) {
      if (target[index]!.name === lowered) target.splice(index, 1);
    }
  }
  // Node writes one header line per value, so a list (two `Set-Cookie`s) keeps its own entries.
  for (const item of Array.isArray(value) ? value : [value]) {
    target.push({ name: lowered, value: String(item) });
  }
}

/**
 * A `HttpResponseLike` that records instead of writing to a socket. Values are lower-cased
 * names with one entry per written value, so a handler that sets a pair of `Set-Cookie`s
 * yields two entries, exactly like two header lines on the wire.
 */
export function createFakeHttpResponse(): FakeHttpResponseHandle {
  const entries: HeaderEntry[] = [];
  const bodyChunks: Buffer[] = [];
  let statusCode = 0;
  let sent = false;
  let destroyed = false;
  let resolveFinished!: (captured: CapturedResponse) => void;
  const finished = new Promise<CapturedResponse>((resolve) => {
    resolveFinished = resolve;
  });
  const finish = (): void => {
    resolveFinished({
      statusCode,
      headers: entries.map((entry) => ({ ...entry })),
      body: Buffer.concat(bodyChunks),
      destroyed,
    });
  };
  const response: HttpResponseLike = {
    get headersSent() {
      return sent;
    },
    writeHead(status, headers) {
      statusCode = status;
      if (headers !== undefined) {
        for (const [name, value] of Object.entries(headers)) {
          writeEntries(entries, name, value, false);
        }
      }
      sent = true;
      return response;
    },
    setHeader(name, value) {
      writeEntries(entries, name, value, true);
      return response;
    },
    end(bodyChunk) {
      if (bodyChunk !== undefined) bodyChunks.push(Buffer.from(bodyChunk));
      finish();
      return response;
    },
    destroy() {
      destroyed = true;
      finish();
      return response;
    },
  };
  return { response, finished };
}
