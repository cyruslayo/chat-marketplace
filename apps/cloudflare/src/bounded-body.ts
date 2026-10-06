/** A request body went over its limit (ADR 0090 receipt size). */
export class BodyTooLargeError extends Error {
  constructor() {
    super("Body too large");
    this.name = "BodyTooLargeError";
  }
}

function declaredLength(headers: Headers): number | null {
  const value = headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

/**
 * Reads a request body into memory only while it stays within `limit` bytes (ADR 0090, ADR 0075).
 *
 * - A declared `content-length` over the limit is refused before a single byte is read.
 * - With no length (chunked), bytes are counted as they arrive and the stream is cancelled the moment the limit is
 *   passed, so an oversized or endless upload is never buffered in full and nothing is stored.
 */
export async function readBodyWithLimit(request: Request, limit: number): Promise<Uint8Array> {
  const declared = declaredLength(request.headers);
  if (declared !== null && declared > limit) {
    await request.body?.cancel();
    throw new BodyTooLargeError();
  }
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
