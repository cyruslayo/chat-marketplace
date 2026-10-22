/**
 * ADR 0105 and issue 22: wraps a guest handler's HTML response so a banner is inserted after the body tag. The buffering
 * is shared by the staging beta banner (pilot) and the staging demo banner (guest handler). JSON and assets pass through.
 */
import type { HttpResponseHeaderValueOrList, HttpResponseLike } from "../../../packages/platform-core/src/http-like.js";
interface CapturedHeader {
  readonly name: string;
  readonly value: HttpResponseHeaderValueOrList;
}

function lowerCase(name: string): string {
  return name.toLowerCase();
}

function contentTypeOf(headers: readonly CapturedHeader[]): string | null {
  const entry = [...headers].reverse().find((candidate) => lowerCase(candidate.name) === "content-type");
  const value = entry?.value;
  return typeof value === "string" ? value : null;
}

function contentEncodingOf(headers: readonly CapturedHeader[]): string | null {
  const entry = [...headers].reverse().find((candidate) => lowerCase(candidate.name) === "content-encoding");
  const value = entry?.value;
  return typeof value === "string" ? value : null;
}

/**
 * Staging only: captures the handler's HTML response and applies the beta banner to the complete page — the same
 * wrap the proxy applied by re-parsing a buffered body, with the content-length rewritten and `transfer-encoding`
 * dropped. JSON and assets pass through untouched, and a `HEAD` is never transformed.
 */
export function bannerWrapped(
  inner: HttpResponseLike,
  method: string,
  transform: (html: string) => string,
): HttpResponseLike {
  const htmlResponse = (view: readonly CapturedHeader[]): boolean => {
    const contentType = contentTypeOf(view);
    return contentType !== null && /^text\/html\b/i.test(contentType) && contentEncodingOf(view) === null && method !== "HEAD";
  };
  let buffering = false;
  let capturedStatus = 0;
  let captured: CapturedHeader[] = [];
  const wrapped: HttpResponseLike = {
    get headersSent() {
      return inner.headersSent || buffering;
    },
    writeHead(statusCode, headers) {
      if (!buffering) {
        // The buffering decision is made from the handler's own written headers, not a re-parsed proxied body.
        const view = [...captured, ...Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }))];
        if (!htmlResponse(view)) return inner.writeHead(statusCode, headers);
        buffering = true;
      }
      capturedStatus = statusCode;
      for (const [name, value] of Object.entries(headers ?? {})) captured.push({ name, value });
      return wrapped;
    },
    setHeader(name, value) {
      if (!buffering) return inner.setHeader(name, value);
      const lowered = lowerCase(name);
      captured = captured.filter((entry) => lowerCase(entry.name) !== lowered);
      captured.push({ name: lowered, value });
      return wrapped;
    },
    end(body) {
      if (!buffering) return inner.end(body);
      // Rewrite content-length and drop transfer-encoding exactly as the buffering proxy did.
      const source = body === undefined ? "" : Buffer.isBuffer(body) ? body.toString("utf8") : body;
      const bodyBytes = Buffer.from(transform(source), "utf8");
      const remaining = captured.filter((entry) => lowerCase(entry.name) !== "transfer-encoding" && lowerCase(entry.name) !== "content-length");
      // node:http accepts setHeader only before writeHead flushes, so the replay sets everything first.
      for (const entry of remaining) inner.setHeader(entry.name, entry.value);
      inner.setHeader("Content-Length", String(bodyBytes.length));
      inner.writeHead(capturedStatus, {});
      return inner.end(bodyBytes);
    },
    destroy(error) {
      return inner.destroy(error);
    },
  };
  return wrapped;
}
