import type { IncomingHttpHeaders } from "node:http";

/**
 * The request surface the request handlers actually use (slice 08a), typed so a
 * Durable Object fetch (09c) can implement exactly these members without owning
 * a node:http server. The shapes deliberately follow node:http, so the real
 * `IncomingMessage` type still satisfies the interface and the Node wrappers and
 * tests keep passing real request objects.
 */
export interface HttpRequestLike {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  /** Lower-cased header names in Node's shape; repeated headers arrive as arrays. */
  readonly headers: IncomingHttpHeaders;
  on(eventName: "data", listener: (chunk: Buffer) => void): this;
  on(eventName: "end", listener: () => void): this;
  on(eventName: "error", listener: (error: Error) => void): this;
  /** Node semantics: the stream is not paused, so buffered body bytes that no listener took are discarded. */
  resume(): this;
}

/** Header values the handlers write today: `Set-Cookie` stays a separate call per value or a list of values. */
export type HttpResponseHeaderValue = string | number;
export type HttpResponseHeaderList = readonly HttpResponseHeaderValue[];
export type HttpResponseHeaderValueOrList = HttpResponseHeaderValue | HttpResponseHeaderList;
export type HttpResponseHeaders = Record<string, HttpResponseHeaderValue>;

/**
 * The response surface the request handlers actually use (slice 08a). The real
 * `ServerResponse` type satisfies this, so the Node wrappers keep passing real
 * responses, and the Workers shim (09c) can collect the same calls without a
 * socket.
 */
export interface HttpResponseLike {
  /** True once the status line and headers have been written; error paths read it. */
  readonly headersSent: boolean;
  writeHead(statusCode: number, headers?: HttpResponseHeaders): this;
  /** Replaces the entries `name` has, as node:http does; an array writes one entry per value (ADR 0086). */
  setHeader(name: string, value: HttpResponseHeaderValueOrList): this;
  end(body?: string | Buffer): this;
  /** Node semantics: tears the connection down; the owner error path uses it after headers were sent. */
  destroy(error?: Error): this;
}
