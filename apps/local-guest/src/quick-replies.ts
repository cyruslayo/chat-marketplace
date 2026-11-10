import type { GuestQuickReply, QuickReplyEdit } from "./concierge.js";

/**
 * Issue 58 (ADR 0106, ADR 0107 "Settled"): the closed validator for a quick-reply chip. A chip is `{ label, edit? }`; `edit` is one of
 * the three structured criteria edits the strip accepts. Anything else drops that chip (fail closed), never the whole response.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function isQuickReplyEdit(value: unknown): value is QuickReplyEdit {
  if (!isRecord(value)) return false;
  if (value.field === "guests") return isPositiveInteger(value.partySize);
  if (value.field === "where") return typeof value.area === "string" && value.area.length > 0 && value.area.length <= 120;
  if (value.field === "when") return typeof value.checkIn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.checkIn) && isPositiveInteger(value.nights);
  return false;
}

/** Reads the list, dropping any chip with a missing label, an unknown edit field, or a field of the wrong type. */
export function isQuickReplyList(value: unknown): readonly GuestQuickReply[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const replies: GuestQuickReply[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.label !== "string" || item.label === "") continue;
    if (item.edit === undefined) { replies.push({ label: item.label }); continue; }
    if (isQuickReplyEdit(item.edit)) replies.push({ label: item.label, edit: item.edit });
  }
  return replies;
}
