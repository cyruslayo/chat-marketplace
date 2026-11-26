import type { GuestIdentity } from "../../../../domains/shortlet/src/index.js";
import type { CommandPrincipal } from "../../../../packages/platform-core/src/envelope.js";
import type { AssistantDomainPack } from "./assistant-platform.js";

/**
 * Platform contract for cross-domain plan rows (rules/02-plans-list.md, ADR 0099 decision 5, ADR 0071, ADR 0075).
 * Each registered pack may declare `planRows(scope, now)` and return closed, redacted rows. The platform validates
 * every row fail closed and owns the groups, ordering and badge count without reading any pack's transaction state.
 */

export const PLAN_ROW_GROUPS = ["needs_action", "in_progress", "past"] as const;
export type PlanRowGroup = (typeof PLAN_ROW_GROUPS)[number];

export const PLAN_ROW_TONES = ["info", "success", "warning", "danger"] as const;
export type PlanRowTone = (typeof PLAN_ROW_TONES)[number];

export interface PlanRowStatus {
  readonly tone: PlanRowTone;
  readonly label: string;
}

export interface PlanRowNextStep {
  readonly label: string;
  readonly deadlineAt?: string;
}

/** One redacted, link-only plan row owned by a domain pack. Never holds prices, contacts, addresses, tokens or identity facts. */
export interface PlanRow {
  readonly rowId: string;
  readonly domain: string;
  readonly title: string;
  readonly where: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly group: PlanRowGroup;
  readonly status: PlanRowStatus;
  readonly nextStep: PlanRowNextStep;
  readonly href: string;
}

export interface PlanRowScope {
  readonly principal: CommandPrincipal;
  readonly identity?: GuestIdentity;
}

/** Closed diagnostic emitted without row values or credentials when a pack throws or returns an unknown shape (ADR 0075, S6). */
export interface PlanRowsDiagnostic {
  readonly event: "plan_rows_pack_dropped";
  readonly domain: string;
  readonly reason: "threw" | "invalid_shape";
}

export interface ComposedPlanRows {
  readonly groups: {
    readonly needs_action: readonly PlanRow[];
    readonly in_progress: readonly PlanRow[];
    readonly past: readonly PlanRow[];
  };
  readonly badgeCount: number;
  readonly droppedDomains: readonly string[];
}

const ROW_KEYS = new Set(["rowId", "domain", "title", "where", "startsOn", "endsOn", "group", "status", "nextStep", "href"]);
const STATUS_KEYS = new Set(["tone", "label"]);
const NEXT_STEP_KEYS = new Set(["label", "deadlineAt"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactAllowedKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, required: readonly string[]): boolean {
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.has(key))) return false;
  return required.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isSafeLocalHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && !/[\u0000-\u001f\u007f\\]/.test(value);
}

/** Fail-closed validation of one plan row (rules/02, ADR 0074/0075). Unknown keys or mismatched domain fail closed. */
export function validatePlanRow(value: unknown, expectedDomain: string): PlanRow | null {
  if (!isPlainObject(value)) return null;
  if (!hasExactAllowedKeys(value, ROW_KEYS, ["rowId", "domain", "title", "where", "startsOn", "endsOn", "group", "status", "nextStep", "href"])) {
    return null;
  }
  if (!isBoundedText(value.rowId, 128)) return null;
  if (typeof value.domain !== "string" || value.domain !== expectedDomain || !isBoundedText(value.domain, 64)) return null;
  if (!isBoundedText(value.title, 200)) return null;
  if (typeof value.where !== "string" || value.where.length > 200) return null;
  if (!isIsoCalendarDate(value.startsOn) || !isIsoCalendarDate(value.endsOn)) return null;
  if (typeof value.group !== "string" || !(PLAN_ROW_GROUPS as readonly string[]).includes(value.group)) return null;
  if (!isPlainObject(value.status) || !hasExactAllowedKeys(value.status, STATUS_KEYS, ["tone", "label"])) return null;
  if (typeof value.status.tone !== "string" || !(PLAN_ROW_TONES as readonly string[]).includes(value.status.tone)) return null;
  if (!isBoundedText(value.status.label, 120)) return null;
  if (!isPlainObject(value.nextStep) || !hasExactAllowedKeys(value.nextStep, NEXT_STEP_KEYS, ["label"])) return null;
  if (!isBoundedText(value.nextStep.label, 200)) return null;
  if (value.nextStep.deadlineAt !== undefined && !isIsoTimestamp(value.nextStep.deadlineAt)) return null;
  if (!isSafeLocalHref(value.href)) return null;

  return Object.freeze({
    rowId: value.rowId,
    domain: value.domain,
    title: value.title,
    where: value.where,
    startsOn: value.startsOn,
    endsOn: value.endsOn,
    group: value.group as PlanRowGroup,
    status: Object.freeze({
      tone: value.status.tone as PlanRowTone,
      label: value.status.label,
    }),
    nextStep: Object.freeze({
      label: value.nextStep.label,
      ...(value.nextStep.deadlineAt === undefined ? {} : { deadlineAt: value.nextStep.deadlineAt }),
    }),
    href: value.href,
  });
}

/** Validates an entire pack response. Any malformed row drops all of that pack's rows (fail closed, S6). */
export function validatePackPlanRows(raw: unknown, expectedDomain: string): readonly PlanRow[] | null {
  if (!Array.isArray(raw)) return null;
  const validated: PlanRow[] = [];
  for (const item of raw) {
    const row = validatePlanRow(item, expectedDomain);
    if (row === null) return null;
    validated.push(row);
  }
  return Object.freeze(validated);
}

function compareNeedsAction(left: PlanRow, right: PlanRow): number {
  const leftMs = left.nextStep.deadlineAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(left.nextStep.deadlineAt);
  const rightMs = right.nextStep.deadlineAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(right.nextStep.deadlineAt);
  if (leftMs !== rightMs) return leftMs - rightMs;
  return left.startsOn.localeCompare(right.startsOn) || left.domain.localeCompare(right.domain) || left.rowId.localeCompare(right.rowId);
}

function compareInProgress(left: PlanRow, right: PlanRow): number {
  return left.startsOn.localeCompare(right.startsOn) || left.endsOn.localeCompare(right.endsOn) || left.domain.localeCompare(right.domain) || left.rowId.localeCompare(right.rowId);
}

function comparePast(left: PlanRow, right: PlanRow): number {
  return right.endsOn.localeCompare(left.endsOn) || right.startsOn.localeCompare(left.startsOn) || left.domain.localeCompare(right.domain) || left.rowId.localeCompare(right.rowId);
}

/**
 * Platform composer (rules/02 P1-P3, S6-S7, ADR 0099): calls `planRows` on each registered pack,
 * drops any failing or malformed pack cleanly, groups rows, sorts each group deterministically, and
 * derives the action-needed badge count.
 */
export async function composePlanRows(
  packs: readonly AssistantDomainPack[],
  scope: PlanRowScope,
  now: Date,
  options: { readonly onDiagnostic?: (event: PlanRowsDiagnostic) => void } = {},
): Promise<ComposedPlanRows> {
  const needsAction: PlanRow[] = [];
  const inProgress: PlanRow[] = [];
  const past: PlanRow[] = [];
  const droppedDomains: string[] = [];

  for (const pack of packs) {
    if (!pack.planRows) continue;
    let raw: unknown;
    try {
      raw = await pack.planRows(scope, now);
    } catch {
      droppedDomains.push(pack.id);
      options.onDiagnostic?.({ event: "plan_rows_pack_dropped", domain: pack.id, reason: "threw" });
      continue;
    }
    const rows = validatePackPlanRows(raw, pack.id);
    if (rows === null) {
      droppedDomains.push(pack.id);
      options.onDiagnostic?.({ event: "plan_rows_pack_dropped", domain: pack.id, reason: "invalid_shape" });
      continue;
    }
    for (const row of rows) {
      if (row.group === "needs_action") needsAction.push(row);
      else if (row.group === "in_progress") inProgress.push(row);
      else past.push(row);
    }
  }

  needsAction.sort(compareNeedsAction);
  inProgress.sort(compareInProgress);
  past.sort(comparePast);

  const frozenNeedsAction = Object.freeze(needsAction);
  return Object.freeze({
    groups: Object.freeze({
      needs_action: frozenNeedsAction,
      in_progress: Object.freeze(inProgress),
      past: Object.freeze(past),
    }),
    badgeCount: frozenNeedsAction.length,
    droppedDomains: Object.freeze(droppedDomains),
  });
}
