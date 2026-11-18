import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId } from "../apps/local-guest/src/shortlet-app.js";
import { coldApp } from "./helpers/assistant-cold-journey-harness.js";
import {
  JOURNEY_SCRIPT, JOURNEY_TEXT, journeyToOffer, journeyToPayment, journeyToRequest, journeyToReservation,
  stagingJourneyFixture, successOf, tap, typedTurn, type Surface,
} from "./helpers/assistant-stage-journey.js";
import { scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { GUEST_JOURNEY } from "../apps/web-agent/src/guest-content.js";
import {
  dateShowBackStage, inferActiveStage, journeyRailStep, journeyTailStep, persistedActiveStage, restoreStage, sentStage, shortletTaskStatus,
  stageForGuestThread, stageForSurfaceId, timelineCopyKey,
} from "../apps/local-guest/src/guest-stage.js";

// Characterisation matrix for issue 10 (deriveGuestStage, Track B: no behaviour change). Each row is a real flow on the staging-like
// clock with the assistant runtime enabled and a fresh thread. Every read or event runs in a NEW application over the same store
// (a cold restore, ADR 0106). The matrix pins what each derivation site returns through public outputs. The refactor must leave every
// cell unchanged. Pinned cells that disagree between sites are listed in the issue's Comments (issue 18 takes them).

const NEW_SEARCH_TEXT = "Another apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const VAGUE_TEXT = "Okay";
const LEKKI_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const SCRIPT = {
  ...JOURNEY_SCRIPT,
  [NEW_SEARCH_TEXT]: { slots: LEKKI_SEARCH, search: LEKKI_SEARCH },
  // An unclear turn: the pack answers it from the task state (ADR 0106, issue 11), or the fixed clarification.
  [VAGUE_TEXT]: { slots: {}, scope: "unclear" as const },
};

type Build = (f: DatedFixture, threadId: string) => Promise<void>;

/** The thread states in the matrix (issue 10), each reached by real guest turns and taps. */
const STATES: readonly { readonly name: string; readonly build: Build; readonly sent: boolean }[] = [
  { name: "discovery", sent: false, build: async (f, t) => { successOf(await typedTurn(f, t, JOURNEY_TEXT, SCRIPT), "search"); } },
  { name: "unit", sent: false, build: async (f, t) => { await unitSurface(f, t); } },
  { name: "draft", sent: false, build: async (f, t) => { await draftSurface(f, t); } },
  {
    name: "draft-after-new-search", sent: false,
    build: async (f, t) => {
      await draftSurface(f, t);
      successOf(await typedTurn(f, t, NEW_SEARCH_TEXT, SCRIPT), "new search while the draft is open");
    },
  },
  { name: "request", sent: true, build: async (f, t) => { await journeyToRequest(f, t); } },
  { name: "offer-issued", sent: true, build: async (f, t) => { await journeyToOffer(f, t); } },
  { name: "payment-surface", sent: true, build: async (f, t) => { await journeyToPayment(f, t); } },
  { name: "booking-confirmed", sent: true, build: async (f, t) => { await journeyToReservation(f, t); } },
];

/** What each derivation site reports for one thread state. */
export interface StageObservation {
  /** getState().journey: the journey rail (site `#journeyFor`). */
  readonly journey: string;
  /** getState().tasks: the task rail status (site `shortletTaskSummary`). */
  readonly taskStatus: string;
  /** The persisted activeStage written on save (sites `#stageForSurfaceId`, `#inferActiveStage`). */
  readonly persistedStage: string | null;
  /** The restored current surface id, ids normalised (site `#restoreCurrentSurface`). */
  readonly surfaceId: string;
  /** The reply to an unclear turn (site `sentStageFor` through `sentStageReply`, or the fixed clarification). */
  readonly vagueReply: string;
  /** The timeline entry the unclear turn wrote (site `#safeAssistantTimelineMessage`). */
  readonly vagueTimeline: string;
  /** A criteria edit on a sent thread (site `#guestStage` through `#criteriaGuard`); "not sent" before a request exists. */
  readonly criteriaLock: string;
}

async function unitSurface(f: DatedFixture, threadId: string): Promise<Surface> {
  const search = successOf(await typedTurn(f, threadId, JOURNEY_TEXT, SCRIPT), "search");
  return (await tap(f, threadId, search.surfaces[0]!, "View")).surfaces[0]!;
}

async function draftSurface(f: DatedFixture, threadId: string): Promise<Surface> {
  return (await tap(f, threadId, await unitSurface(f, threadId), "Request to Book")).surfaces[0]!;
}

/** Replaces the random ids in a surface id, so the pinned matrix is stable from run to run. */
export function stableSurfaceId(surfaceId: string): string {
  return surfaceId
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/ctr_cmd-[0-9a-f]+_(\d+)/g, "ctr_cmd-<id>_$1");
}

/** Reads what the sites report for the thread, on a cold restore. */
function observe(f: DatedFixture, threadId: string): Omit<StageObservation, "vagueReply" | "vagueTimeline" | "criteriaLock"> {
  const state = coldApp(f, threadId).getState(threadId);
  assert.ok(state, "the thread is readable");
  const stored = f.environment.interactionStore.findThread(threadId);
  const parsed: unknown = stored ? JSON.parse(stored.threadJson) : undefined;
  const persistedStage = typeof parsed === "object" && parsed !== null && "activeStage" in parsed && typeof parsed.activeStage === "string" ? parsed.activeStage : null;
  return {
    journey: state.journey ? `${state.journey.current}${state.journey.outcome ? `:${state.journey.outcome.kind}` : ""}` : "none",
    taskStatus: (state.tasks ?? []).map((task) => task.status).join("|") || "none",
    persistedStage,
    surfaceId: stableSurfaceId(state.surfaces[0]?.surfaceId ?? "none"),
  };
}

/** An unclear turn after a cold restore, then the reply it gave and the timeline entry it wrote. */
async function vagueTurn(f: DatedFixture, threadId: string): Promise<{ readonly vagueReply: string; readonly vagueTimeline: string }> {
  const turn = await typedTurn(f, threadId, VAGUE_TEXT, SCRIPT);
  const reply = turn.ok ? turn.messages.join(" / ") : `${turn.code}`;
  const timeline = coldApp(f, threadId).getState(threadId)?.timeline.at(-1)?.text ?? "none";
  return { vagueReply: reply, vagueTimeline: timeline };
}

/** A criteria edit based on the current criteria: a sent thread refuses it (ADR 0005). */
async function criteriaLock(f: DatedFixture, threadId: string): Promise<string> {
  const key = coldApp(f, threadId).getState(threadId)?.criteria?.key;
  assert.ok(key, "a sent thread reports its criteria");
  const result = await coldApp(f, threadId).handleEventAsync(threadId, {
    name: CRITERIA_EDIT_EVENT,
    surfaceId: criteriaSurfaceId(threadId),
    sourceComponentId: "criteria-strip",
    timestamp: new Date().toISOString(),
    context: { field: "guests", partySize: 1, basedOn: key },
  });
  return result.ok ? "accepted" : `${result.code}: ${result.message}`;
}

/** Builds one state on a fresh staging-like thread, then reads every site. */
async function matrixRow(name: string): Promise<StageObservation> {
  const index = STATES.findIndex((candidate) => candidate.name === name);
  const state = STATES[index];
  assert.ok(state, `unknown state ${name}`);
  const f = stagingJourneyFixture(scriptedPlanner(SCRIPT).client);
  try {
    const threadId = `g-d1a00${String(index + 10).padStart(2, "0")}1`;
    await state.build(f, threadId);
    const read = observe(f, threadId);
    const turn = await vagueTurn(f, threadId);
    const lock = state.sent ? await criteriaLock(f, threadId) : "not sent";
    return { ...read, ...turn, criteriaLock: lock };
  } finally { f.close(); }
}

/**
 * The pinned matrix, read on unchanged code (issue 10, step 1). Disagreements are noted beside the rows; they are pinned as they
 * stand, not fixed here (issue 18).
 */
const PINNED: Readonly<Record<string, StageObservation>> = {
  // Disagreement D1: a kept draft after a new search: the rail says search, the task rail says Request, and the persisted stage says discovery.
  discovery: {
    journey: "search", taskStatus: "Stay", persistedStage: "discovery", surfaceId: "thread-g-d1a00101:discovery:search-guest-demo-001",
    vagueReply: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    vagueTimeline: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    criteriaLock: "not sent",
  },
  unit: {
    journey: "stay", taskStatus: "Stay", persistedStage: "unit", surfaceId: "thread-g-d1a00111:unit:detail:0",
    vagueReply: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    vagueTimeline: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    criteriaLock: "not sent",
  },
  // Disagreement D2: a draft with no sent request: the rail says request, but the stage the rest of the code derives is draft (not observable here).
  draft: {
    journey: "request", taskStatus: "Request", persistedStage: "request", surfaceId: "thread-g-d1a00121:request:draft:draft-<uuid>",
    vagueReply: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    vagueTimeline: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    criteriaLock: "not sent",
  },
  // Disagreement D1 (see above): the draft survives a new search; three sites disagree on where the Guest is.
  "draft-after-new-search": {
    journey: "search", taskStatus: "Request", persistedStage: "discovery", surfaceId: "thread-g-d1a00131:discovery:search-guest-demo-008",
    vagueReply: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    vagueTimeline: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
    criteriaLock: "not sent",
  },
  request: {
    journey: "request", taskStatus: "Request", persistedStage: "request", surfaceId: "thread-g-d1a00141:request:req-<uuid>",
    vagueReply: "Your Booking Request is with Eko Prime Living Ltd for review; you can see it in your stay details. I can also answer questions about Serene 1-Bedroom Suite in Lekki Phase 1, such as parking or Wi-Fi.",
    vagueTimeline: "The current booking information is ready below.",
    criteriaLock: "CRITERIA_LOCKED: A sent Booking Request can't be changed while Eko Prime Living Ltd reviews it. If Eko Prime Living Ltd confirms, you can choose not to accept the offer at no cost and search again with new details. Nothing has been changed.",
  },
  "offer-issued": {
    journey: "offer", taskStatus: "Offer", persistedStage: "offer", surfaceId: "thread-g-d1a00151:offer:offer-<uuid>",
    vagueReply: "Your Conditional Booking Offer is in your stay details. Review it and accept it there if it suits you. I can also answer questions about Serene 1-Bedroom Suite in Lekki Phase 1, such as parking or Wi-Fi.",
    vagueTimeline: "The current booking information is ready below.",
    criteriaLock: "CRITERIA_LOCKED: A Conditional Booking Offer can't be changed. You can choose not to accept it at no cost and search again with new details. Nothing has been changed.",
  },
  // D3 (fixed in issue 18): an accepted offer on the payment surface: the rail says pay, the task rail now says Pay, and sentStageFor says payment.
  "payment-surface": {
    journey: "pay", taskStatus: "Pay", persistedStage: "payment", surfaceId: "thread-g-d1a00161:payment:ready:offer-<uuid>",
    vagueReply: "Your payment step is in your stay details. I can also answer questions about Serene 1-Bedroom Suite in Lekki Phase 1, such as parking or Wi-Fi.",
    vagueTimeline: "The current booking information is ready below.",
    criteriaLock: "CRITERIA_LOCKED: An accepted offer can't be changed from this conversation. Nothing has been changed.",
  },
  "booking-confirmed": {
    journey: "confirmed", taskStatus: "Confirmed", persistedStage: "booking", surfaceId: "thread-g-d1a00171:booking:ctr_cmd-<id>_1793095200000",
    vagueReply: "Your booking is in your stay details. I can also answer questions about Serene 1-Bedroom Suite in Lekki Phase 1, such as parking or Wi-Fi.",
    vagueTimeline: "The current booking information is ready below.",
    criteriaLock: "CRITERIA_LOCKED: Changes to a confirmed Reservation are made as a booking amendment, which re-checks availability and price. I can't start one from this conversation yet. Nothing has been changed.",
  },
};

test("AC1: The characterisation matrix passes unchanged before and after the refactor, with the assistant enabled and a cold restore before every event", async () => {
  const rows: Record<string, StageObservation> = {};
  for (const state of STATES) rows[state.name] = await matrixRow(state.name);
  assert.deepEqual(rows, PINNED);
});

test("AC1: The guest sees the payment step on the task rail for an accepted offer on the payment surface, matching the journey rail", async () => {
  // Issue 18, D3: the task rail's step is the journey rail's canonical "Pay" label, read on a cold restore with the assistant enabled.
  const row = await matrixRow("payment-surface");
  assert.equal(row.journey, "pay");
  assert.equal(row.taskStatus, GUEST_JOURNEY.pay);
});

// AC2: each derivation site calls a pure function from guest-stage.ts. The pure functions below are checked against the same thread
// states as the matrix rows. Cells the matrix cannot reach through public output (the timeline's detail and draft copy, the draft
// show-back, the inferred stage) are checked through their pure rule, and the test says so.

const SURFACE_FOR = (name: string): string => PINNED[name]!.surfaceId;

test("AC2: stageForGuestThread gives each matrix state its guest stage, with the draft kept across a new search", () => {
  const none = new Set<string>();
  assert.equal(stageForGuestThread({ activeSurfaces: none, offerId: false, requestId: false, draftId: false, unitDetail: false }), "discovery");
  assert.equal(stageForGuestThread({ activeSurfaces: new Set(["unit"]), offerId: false, requestId: false, draftId: false, unitDetail: true }), "unit");
  assert.equal(stageForGuestThread({ activeSurfaces: new Set(["request"]), offerId: false, requestId: false, draftId: true, unitDetail: true }), "draft");
  // Issue 16: the draft survives a new search (its id is kept), so the guest stage stays draft.
  assert.equal(stageForGuestThread({ activeSurfaces: new Set(["discovery"]), offerId: false, requestId: false, draftId: true, unitDetail: false }), "draft");
  assert.equal(stageForGuestThread({ activeSurfaces: new Set(["request"]), offerId: false, requestId: true, draftId: true, unitDetail: false }), "request");
  assert.equal(stageForGuestThread({ activeSurfaces: new Set(["offer"]), offerId: true, requestId: true, draftId: true, unitDetail: false }), "offer");
  assert.equal(stageForGuestThread({ activeSurfaces: new Set(["payment"]), offerId: true, requestId: true, draftId: true, unitDetail: false }), "payment");
  assert.equal(stageForGuestThread({ activeSurfaces: new Set(["booking"]), offerId: true, requestId: true, draftId: true, unitDetail: false }), "booking");
});

test("AC2: stageForSurfaceId reads every matrix surface id as its persisted stage, and fails closed on an unknown id", () => {
  for (const name of Object.keys(PINNED)) {
    assert.equal(stageForSurfaceId(SURFACE_FOR(name)), PINNED[name]!.persistedStage, name);
  }
  assert.equal(stageForSurfaceId("thread-g-d1a00161:payment:ready:offer-x"), "payment", "the parser reads the id's segments, as before");
  assert.equal(stageForSurfaceId("thread-g-d1a00101:criteria"), null, "a surface that names no stage is not a stage");
  assert.equal(stageForSurfaceId(""), null);
});

test("AC2: inferActiveStage picks the furthest active surface, in the same order as before", () => {
  assert.equal(inferActiveStage(new Set(["discovery", "unit", "request"])), "request");
  assert.equal(inferActiveStage(new Set(["discovery", "unit", "offer", "payment"])), "payment");
  assert.equal(inferActiveStage(new Set(["discovery", "booking", "payment"])), "booking");
  assert.equal(inferActiveStage(new Set(["compare", "draft_replacement"])), null, "compare and draft replacement are not stages of the inference");
});

test("AC2: persistedActiveStage writes each matrix row's persisted stage", () => {
  for (const name of Object.keys(PINNED)) {
    const row = PINNED[name]!;
    assert.equal(persistedActiveStage(SURFACE_FOR(name), new Set(["discovery"])), row.persistedStage, name);
  }
});

test("AC2: journeyTailStep gives the rail's tail for the discovery, unit and draft-after-search rows", () => {
  assert.equal(journeyTailStep({ unitSurfaceActive: true, draftId: false, lastSurfaceStage: "unit", discoveryArtifact: true }), "stay");
  assert.equal(journeyTailStep({ unitSurfaceActive: false, draftId: true, lastSurfaceStage: "request", discoveryArtifact: true }), "request");
  assert.equal(journeyTailStep({ unitSurfaceActive: false, draftId: true, lastSurfaceStage: "discovery", discoveryArtifact: true }), "search", "matrix row: draft after a new search reads search");
  assert.equal(journeyTailStep({ unitSurfaceActive: false, draftId: false, lastSurfaceStage: "discovery", discoveryArtifact: true }), "search", "matrix row: discovery reads search");
  assert.equal(journeyTailStep({ unitSurfaceActive: false, draftId: false, lastSurfaceStage: null, discoveryArtifact: false }), null, "no rail without a search");
});

test("AC2: timelineCopyKey picks each copy in the same order (the detail and draft branches are not reached by the matrix)", () => {
  const base = { lastSurfaceStage: "discovery", draftId: false, requestId: false, offerId: false, discoveryArtifact: true };
  assert.equal(timelineCopyKey({ ...base, lastSurfaceStage: "request", draftId: true }), "draftReady");
  assert.equal(timelineCopyKey({ ...base, lastSurfaceStage: "unit" }), "detailsReady");
  assert.equal(timelineCopyKey({ ...base, requestId: true, lastSurfaceStage: "request" }), "statusReady", "matrix row: a sent request reads its status");
  assert.equal(timelineCopyKey({ ...base, offerId: true, lastSurfaceStage: "offer" }), "statusReady", "matrix row: an offer reads its status");
  assert.equal(timelineCopyKey(base), "results");
  assert.equal(timelineCopyKey({ ...base, discoveryArtifact: false }), "clarification", "fails closed to the clarification");
});

test("AC2: dateShowBackStage shows the draft copy only while a draft is open with no request or offer", () => {
  assert.equal(dateShowBackStage({ draftId: true, requestId: false, offerId: false }), "draft", "matrix row: draft");
  assert.equal(dateShowBackStage({ draftId: true, requestId: true, offerId: false }), "stay");
  assert.equal(dateShowBackStage({ draftId: true, requestId: false, offerId: true }), "stay");
  assert.equal(dateShowBackStage({ draftId: false, requestId: false, offerId: false }), "stay");
});

test("AC2: shortletTaskStatus gives each matrix row's task-rail step", () => {
  const stayed = { contractOrReservation: false, offerId: false, requestOrDraft: false, staySelected: true, offerAccepted: false };
  assert.equal(shortletTaskStatus(stayed), "stay", "matrix row: discovery and unit");
  assert.equal(shortletTaskStatus({ ...stayed, requestOrDraft: true }), "request", "matrix rows: draft and draft after a new search");
  assert.equal(shortletTaskStatus({ ...stayed, requestOrDraft: true, offerId: true }), "offer", "matrix row: offer issued");
  assert.equal(shortletTaskStatus({ ...stayed, requestOrDraft: true, offerId: true, offerAccepted: true }), "payment", "matrix row: payment surface (D3)");
  assert.equal(shortletTaskStatus({ ...stayed, requestOrDraft: true, offerId: true, contractOrReservation: true }), "confirmed", "matrix row: booking confirmed");
  assert.equal(shortletTaskStatus({ contractOrReservation: false, offerId: false, requestOrDraft: false, staySelected: false, offerAccepted: false }), "search", "fails closed to search");
});

test("AC2: shortletTaskStatus gives the payment step only for an accepted offer with no booking", () => {
  const issued = { contractOrReservation: false, offerId: true, requestOrDraft: true, staySelected: true, offerAccepted: false };
  assert.equal(shortletTaskStatus(issued), "offer", "an issued offer is still the offer step");
  assert.equal(shortletTaskStatus({ ...issued, offerAccepted: true }), "payment", "an accepted offer is the payment step, as the journey rail's pay");
  assert.equal(shortletTaskStatus({ ...issued, offerAccepted: true, contractOrReservation: true }), "confirmed", "a booking still wins over payment");
});

test("AC2: sentStage gives each sent matrix row its stage, and reads the offer only when one is held", () => {
  let reads = 0;
  const accepted = (): boolean => { reads += 1; return true; };
  assert.equal(sentStage({ bookingHeld: false, offerId: false, requestId: true, offerAccepted: accepted }), "request");
  assert.equal(sentStage({ bookingHeld: false, offerId: true, requestId: true, offerAccepted: () => false }), "offer");
  assert.equal(sentStage({ bookingHeld: false, offerId: true, requestId: true, offerAccepted: accepted }), "payment");
  assert.equal(sentStage({ bookingHeld: true, offerId: true, requestId: true, offerAccepted: accepted }), "booking");
  assert.equal(sentStage({ bookingHeld: false, offerId: false, requestId: false, offerAccepted: accepted }), undefined, "nothing sent");
  assert.equal(reads, 1, "the offer is read only for the payment row: not for the request, booking or nothing-sent rows");
});

test("AC2: journeyRailStep gives each matrix row's rail decision, reads lazily, and fails through to the tail when neither is held", () => {
  const unread = (): never => { throw new Error("read outside its branch"); };
  const request = (status: string, delivered = true) => () => ({ status, delivered });
  // Matrix rows: request sent, offer issued, payment surface (offer accepted), booking confirmed.
  assert.deepEqual(journeyRailStep({ offerId: false, requestId: true, paymentSurfaceActive: false, bookingSnapshotHeld: unread, offerStatus: unread, paymentStatus: unread, requestFacts: request("disclosed") }), { step: "request", status: "disclosed", delivered: true });
  assert.deepEqual(journeyRailStep({ offerId: true, requestId: true, paymentSurfaceActive: false, bookingSnapshotHeld: () => false, offerStatus: () => "issued", paymentStatus: unread, requestFacts: unread }), { step: "offer" });
  assert.deepEqual(journeyRailStep({ offerId: true, requestId: true, paymentSurfaceActive: true, bookingSnapshotHeld: () => false, offerStatus: () => "accepted", paymentStatus: () => "ready", requestFacts: unread }), { step: "pay" });
  // Booking confirmed: the snapshot wins, and neither the offer nor the payment is read.
  assert.deepEqual(journeyRailStep({ offerId: true, requestId: true, paymentSurfaceActive: true, bookingSnapshotHeld: () => true, offerStatus: unread, paymentStatus: unread, requestFacts: unread }), { step: "confirmed" });
  // Failure paths: an expired or failed payment, a stale or revoked offer, a declined or undeliverable request.
  assert.deepEqual(journeyRailStep({ offerId: true, requestId: false, paymentSurfaceActive: false, bookingSnapshotHeld: () => false, offerStatus: () => "accepted", paymentStatus: () => "expired", requestFacts: unread }), { step: "pay", failure: "expired" });
  assert.deepEqual(journeyRailStep({ offerId: true, requestId: false, paymentSurfaceActive: false, bookingSnapshotHeld: () => false, offerStatus: () => "stale", paymentStatus: unread, requestFacts: unread }), { step: "offer", outcome: "stale" });
  assert.deepEqual(journeyRailStep({ offerId: true, requestId: false, paymentSurfaceActive: false, bookingSnapshotHeld: () => false, offerStatus: () => "revoked", paymentStatus: unread, requestFacts: unread }), { step: "offer", outcome: "revoked" });
  assert.deepEqual(journeyRailStep({ offerId: false, requestId: true, paymentSurfaceActive: false, bookingSnapshotHeld: unread, offerStatus: unread, paymentStatus: unread, requestFacts: request("declined", false) }), { step: "request", status: "declined", delivered: false, outcome: "declined" });
  assert.deepEqual(journeyRailStep({ offerId: false, requestId: true, paymentSurfaceActive: false, bookingSnapshotHeld: unread, offerStatus: unread, paymentStatus: unread, requestFacts: request("delivery_failed") }), { step: "request", status: "delivery_failed", delivered: true, outcome: "delivery_failed" });
  // Neither an offer nor a request: the rail continues with the tail (draft and discovery rows).
  assert.equal(journeyRailStep({ offerId: false, requestId: false, paymentSurfaceActive: false, bookingSnapshotHeld: unread, offerStatus: unread, paymentStatus: unread, requestFacts: unread }), null);
});

test("AC2: restoreStage gives each matrix row's restore branch, and none without the facts its guard reads", () => {
  const none = { activeStage: null, unitDetail: false, discoveryArtifact: false, draftId: false, requestId: false, offerId: false };
  assert.equal(restoreStage({ ...none, activeStage: "unit", unitDetail: true, discoveryArtifact: true }), "unit", "matrix row: unit");
  assert.equal(restoreStage({ ...none, activeStage: "request", draftId: true }), "draft", "matrix row: draft");
  assert.equal(restoreStage({ ...none, activeStage: "request", draftId: true, requestId: true }), "request", "matrix row: request sent (the draft id is kept)");
  assert.equal(restoreStage({ ...none, activeStage: "offer", offerId: true, requestId: true }), "offer", "matrix row: offer issued");
  assert.equal(restoreStage({ ...none, activeStage: "payment", offerId: true, requestId: true }), "payment", "matrix row: payment surface");
  assert.equal(restoreStage({ ...none, activeStage: "booking", offerId: true, requestId: true }), "booking", "matrix row: booking confirmed");
  assert.equal(restoreStage({ ...none, activeStage: "discovery", discoveryArtifact: true }), "discovery", "matrix row: discovery and draft after a new search");
  // Fails closed: a unit without its detail, a discovery without results, a payment without an offer, a request with nothing to restore.
  assert.equal(restoreStage({ ...none, activeStage: "unit", discoveryArtifact: true }), null);
  assert.equal(restoreStage({ ...none, activeStage: "discovery" }), null);
  assert.equal(restoreStage({ ...none, activeStage: "payment" }), null);
  assert.equal(restoreStage({ ...none, activeStage: "request" }), null);
});
