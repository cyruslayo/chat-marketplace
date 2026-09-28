import test from "node:test";
import assert from "node:assert/strict";
import { FOREIGN_ORIGIN, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { cookieOf, openComplaint, principal, recordAccess, reservation, travelTo, windowOpens } from "./helpers/back-office-reservation.js";
import { visibleText } from "./helpers/back-office-page.js";
import { formatWat } from "../apps/local-owner/src/back-office-view.js";

// Issue 10 — dismiss a Blocking Fulfilment Complaint (.scratch/operator-dashboard/issues/10-resolve-a-blocking-complaint.md,
// ADR 0089, 0091).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function reservationPage(f: SignedInOperator, id: string, cookie = cookieOf(f)): Promise<{ status: number; html: string; text: string }> {
  const response = await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(id)}`, cookie);
  const html = await response.text();
  return { status: response.status, html, text: visibleText(html) };
}

function complaintIds(f: SignedInOperator, id: string): readonly string[] {
  return f.server.environment.operatorReservation(id, principal(f)).openComplaints.map((complaint) => complaint.complaintId);
}

function dismissForm(html: string, id: string, complaintId: string): string {
  const version = html.match(new RegExp(`action="/operator/bookings/${id}/blocking-complaint/${complaintId}/dismiss"[\\s\\S]*?name="basedOnVersion" value="([^"]+)"`))?.[1];
  assert.ok(version, `dismiss form for ${complaintId}`);
  return version;
}

async function dismiss(f: SignedInOperator, id: string, complaintId: string, options: { reason?: string; cookie?: string; origin?: string; basedOnVersion?: string; extra?: Record<string, string> } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? dismissForm((await reservationPage(f, id)).html, id, complaintId);
  const form: Record<string, string> = { basedOnVersion, ...(options.reason === undefined ? { reason: "cured" } : options.reason === "" ? {} : { reason: options.reason }), ...options.extra };
  return operatorPost(f.session, `/operator/bookings/${encodeURIComponent(id)}/blocking-complaint/${encodeURIComponent(complaintId)}/dismiss`, options.cookie ?? cookieOf(f), options.origin ? { origin: options.origin } : {}, form);
}

const dismissals = (f: SignedInOperator) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_blocking_complaint_dismissed");

/**
 * Verified Access recorded 30 minutes into the window, then a complaint an hour later. Pass an existing Reservation when
 * the clock has moved past Operator Active Hours (requests are only disclosed 8 AM–7:30 PM WAT).
 */
async function complained(f: SignedInOperator, checkIn: string, checkOut: string, existing?: string): Promise<{ id: string; accessAt: Date }> {
  const id = existing ?? await reservation(f, checkIn, checkOut);
  const accessAt = new Date(windowOpens(checkIn).getTime() + 30 * MINUTE);
  await travelTo(f, accessAt);
  recordAccess(f, id);
  await travelTo(f, new Date(accessAt.getTime() + HOUR));
  openComplaint(f, id);
  return { id, accessAt };
}

test("AC1 — From the Reservation page you can dismiss an open Blocking Fulfilment Complaint with a reason from the fixed list. The complaint becomes resolved, and the action is audited with codes only", async () => {
  const f = await startSignedInOperator();
  try {
    const { id } = await complained(f, "2026-09-10", "2026-09-12");
    const [complaintId] = complaintIds(f, id);
    assert.ok(complaintId);
    const page = await reservationPage(f, id);
    assert.match(page.text, /Open Blocking Fulfilment Complaint Habitability failure/);
    // The fixed reasons, and no free text.
    assert.match(page.html, /name="reason" value="cured"[^>]*>\s*Fixed, and the Guest stayed/);
    assert.match(page.html, /name="reason" value="not_borne_out"[^>]*>\s*Not borne out on review/);
    assert.doesNotMatch(page.html.slice(page.html.indexOf("/dismiss")), /<textarea/);

    const done = await dismiss(f, id, complaintId, { reason: "not_borne_out" });
    assert.equal(done.status, 303);
    assert.equal(done.headers.get("location"), `/operator/bookings/${id}`);
    assert.deepEqual(complaintIds(f, id), [], "no complaint is open");
    const after = await reservationPage(f, id);
    assert.doesNotMatch(after.text, /Open Blocking Fulfilment Complaint/);
    assert.doesNotMatch(after.html, /\/dismiss"/);
    // The audit keeps ids and codes only (ADR 0075).
    const [entry] = dismissals(f);
    assert.ok(entry);
    assert.deepEqual(Object.keys(entry).sort(), ["actorId", "complaintId", "occurredAt", "reason", "recordedAt", "requestId", "reservationId", "tenantId", "type"]);
    assert.equal(entry.reason, "not_borne_out");

    // A complaint reported again later is a new complaint, and can be dismissed on its own.
    openComplaint(f, id);
    const [again] = complaintIds(f, id);
    assert.ok(again && again !== complaintId, "a fresh complaint id");
    assert.equal((await dismiss(f, id, again)).status, 303);
    assert.equal(dismissals(f).length, 2);
  } finally { await f.close(); }
});

test("AC2 — Once no complaint is open, the owner payable leaves \"paused\". It is due 24 hours after Verified Access, or at the dismissal if that is later", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const lateId = await reservation(f, "2026-09-20", "2026-09-22");
    const twoId = await reservation(f, "2026-09-25", "2026-09-26");
    // Dismissed within the 24 hours: due 24 hours after Verified Access, as if no complaint had been open.
    const early = await complained(f, "2026-09-10", "2026-09-12");
    assert.equal(env.ownerPayable(early.id, principal(f)).payable!.status, "paused");
    assert.equal((await dismiss(f, early.id, complaintIds(f, early.id)[0]!)).status, 303);
    const dueEarly = new Date(early.accessAt.getTime() + 24 * HOUR).toISOString();
    let payable = env.ownerPayable(early.id, principal(f)).payable!;
    assert.equal(payable.status, "not_yet_due");
    assert.equal(payable.dueAt, dueEarly);
    assert.match((await reservationPage(f, early.id)).text, new RegExp(`Owner payable Due ${formatWat(dueEarly)}`));
    await travelTo(f, new Date(dueEarly));
    assert.equal(env.ownerPayable(early.id, principal(f)).payable!.status, "due");

    // Dismissed after the 24 hours: due at the dismissal, not a fresh window.
    const late = await complained(f, "2026-09-20", "2026-09-22", lateId);
    await travelTo(f, new Date(late.accessAt.getTime() + 30 * HOUR));
    assert.equal(env.ownerPayable(late.id, principal(f)).payable!.status, "paused", "still paused past the 24 hours");
    const dismissedAt = f.now().toISOString();
    assert.equal((await dismiss(f, late.id, complaintIds(f, late.id)[0]!)).status, 303);
    payable = env.ownerPayable(late.id, principal(f)).payable!;
    assert.equal(payable.status, "due");
    assert.equal(payable.dueAt, dismissedAt);

    // While any complaint stays open, the payable stays paused.
    const two = await complained(f, "2026-09-25", "2026-09-26", twoId);
    openComplaint(f, two.id, "access_failure");
    assert.equal(complaintIds(f, two.id).length, 2);
    assert.equal((await dismiss(f, two.id, complaintIds(f, two.id)[0]!)).status, 303);
    assert.equal(env.ownerPayable(two.id, principal(f)).payable!.status, "paused");
    assert.match((await reservationPage(f, two.id)).text, /Not due while a Blocking Fulfilment Complaint is open/);
  } finally { await f.close(); }
});

test("AC3 — Dismissing a complaint that is already resolved, or from a stale version, or with no or an unknown reason, is refused and changes nothing", async () => {
  const f = await startSignedInOperator();
  try {
    const { id } = await complained(f, "2026-09-10", "2026-09-12");
    const [complaintId] = complaintIds(f, id);
    assert.ok(complaintId);
    const version = dismissForm((await reservationPage(f, id)).html, id, complaintId);

    for (const [reason, status] of [["", 400], ["guest was rude", 400], ["upheld", 400]] as const) {
      const refused = await dismiss(f, id, complaintId, { reason, basedOnVersion: version });
      assert.equal(refused.status, status, `reason "${reason}"`);
      assert.match(visibleText(await refused.text()), /Choose why the complaint is closed/);
    }
    assert.equal((await dismiss(f, id, complaintId, { basedOnVersion: version, extra: { note: "free text" } })).status, 400, "an unexpected field");
    assert.equal((await dismiss(f, id, "cmpl_unknown", { basedOnVersion: version })).status, 409, "an unknown complaint");
    assert.equal(complaintIds(f, id).length, 1, "nothing changed");

    // A stale version: the page changed since it was opened.
    openComplaint(f, id, "access_failure");
    let refused = await dismiss(f, id, complaintId, { basedOnVersion: version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /changed since you opened it/);
    assert.equal(complaintIds(f, id).length, 2);

    // Already resolved.
    const current = dismissForm((await reservationPage(f, id)).html, id, complaintId);
    assert.equal((await dismiss(f, id, complaintId, { basedOnVersion: current })).status, 303);
    const now = dismissForm((await reservationPage(f, id)).html, id, complaintIds(f, id)[0]!);
    refused = await dismiss(f, id, complaintId, { basedOnVersion: now });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This complaint is already closed\./);
    assert.equal(dismissals(f).length, 1);
  } finally { await f.close(); }
});

test("AC4 — The standard back-office failure paths apply: a revoked or expired grant, no session, a cross-origin POST, and a stale target", async () => {
  const f = await startSignedInOperator();
  try {
    const { id } = await complained(f, "2026-09-10", "2026-09-12");
    const [complaintId] = complaintIds(f, id);
    assert.ok(complaintId);
    const version = dismissForm((await reservationPage(f, id)).html, id, complaintId);
    assert.equal((await dismiss(f, id, complaintId, { cookie: "", basedOnVersion: version })).status, 401, "no session");
    assert.equal((await dismiss(f, id, complaintId, { origin: FOREIGN_ORIGIN, basedOnVersion: version })).status, 403, "cross-origin POST");
    assert.equal((await dismiss(f, "req-unknown", complaintId, { basedOnVersion: version })).status, 404, "an unknown booking");
    // An expired session is signed out.
    const expired = cookieOf(f);
    f.advance(13 * HOUR);
    assert.equal((await dismiss(f, id, complaintId, { cookie: expired, basedOnVersion: version })).status, 401, "an expired session");
    await travelTo(f, f.now());
    // A revoked grant: not found, and nothing changes (ADR 0082).
    revokeRepresentativeGrant(f.server.environment);
    assert.equal((await dismiss(f, id, complaintId, { basedOnVersion: version })).status, 404, "a revoked grant");
    assert.equal(dismissals(f).length, 0);
  } finally { await f.close(); }
});
