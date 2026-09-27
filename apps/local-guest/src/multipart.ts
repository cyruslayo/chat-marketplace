/**
 * A minimal multipart/form-data reader for the receipt upload (P5): one file field, read from a bounded body.
 * The declared part type and file name are ignored; the domain sniffs the bytes (ADR 0075: untrusted input).
 */
export class MultipartError extends Error {
  constructor(message: string) { super(message); this.name = "MultipartError"; }
}

export function multipartBoundary(contentType: string | undefined): string | null {
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) return null;
  const match = /boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** The bytes of the named file field, or null when the form has no such part. Throws on a malformed body. */
export function multipartFile(body: Buffer, boundary: string, field: string): Buffer | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let position = body.indexOf(delimiter);
  if (position !== 0) throw new MultipartError("Malformed multipart body");
  while (position !== -1) {
    const partStart = position + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString("latin1") === "--") return null;
    const headersEnd = body.indexOf("\r\n\r\n", partStart);
    if (headersEnd === -1) throw new MultipartError("Malformed multipart part");
    const headers = body.subarray(partStart, headersEnd).toString("utf8");
    const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), headersEnd + 4);
    if (next === -1) throw new MultipartError("Unterminated multipart part");
    const name = /content-disposition:[^\r\n]*\bname="([^"]*)"/i.exec(headers)?.[1];
    if (name === field) return Buffer.from(body.subarray(headersEnd + 4, next));
    position = next + 2;
  }
  return null;
}
