import { randomUUID } from "node:crypto";
import { containsLuhnValidCardShape } from "./redaction.js";

/**
 * ADR 0075 & issue 50: platform-generated `<prefix>-<uuid>` ids. The redactor exempts an exact id under its key from the
 * card-number gate, but an exact v4 id can still carry a Luhn-valid card-shaped run, so the redactor keeps masking those
 * (test/redact-platform-ids*.test.ts). Generators therefore never emit a tripping id: a draw that trips the gate is
 * replaced. About one random v4 draw in 8,000 (measured) trips it, so exhausting the bound means the uuid source is broken.
 */
export const MAX_PLATFORM_ID_ATTEMPTS = 8;

export function generatePlatformId(prefix: string, nextUuid: () => string = () => randomUUID()): string {
  for (let attempt = 0; attempt < MAX_PLATFORM_ID_ATTEMPTS; attempt += 1) {
    const id = `${prefix}-${nextUuid()}`;
    if (!containsLuhnValidCardShape(id)) return id;
  }
  throw new Error(`Could not generate a ${prefix} id outside the card-shape redaction gate after ${MAX_PLATFORM_ID_ATTEMPTS} attempts`);
}
