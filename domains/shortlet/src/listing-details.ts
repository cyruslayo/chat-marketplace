export const MAX_UNIT_DESCRIPTION_LENGTH = 2000;

function normalizedLine(value: string): string {
  return value.trim().replace(/[ \t]+/g, " ");
}

/** Keep operator copy plain text while preserving useful paragraph breaks. */
export function normalizeListingDescription(value: unknown, required = false): string {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("description is required");
    return "";
  }
  if (typeof value !== "string") throw new Error("description must be plain text");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new Error("description contains unsupported control characters");
  if (/[<>]/.test(value)) throw new Error("description must not contain markup");
  if (/(?:https?:\/\/|www\.)\S+/i.test(value)) throw new Error("description must not contain embedded links");
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizedLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized === "") {
    if (required) throw new Error("description is required");
    return "";
  }
  if (normalized.length > MAX_UNIT_DESCRIPTION_LENGTH) throw new Error(`description must be at most ${MAX_UNIT_DESCRIPTION_LENGTH} characters`);
  return normalized;
}

/** Zero is the explicit legacy/missing sentinel; imported pilot rows reject it. */
export function normalizeBathroomCount(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("bathrooms must be a non-negative integer");
  return value;
}
