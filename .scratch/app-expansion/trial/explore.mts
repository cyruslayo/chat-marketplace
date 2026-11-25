// Exhaustive exploration of the REAL classes on main (d1d5955), trial of 25 Nov 2026. Nothing is written to the repository.
const R = new URL("../../../", import.meta.url).href; // repository root
const { CancellationNoShowManager, BookingAmendmentManager } = await import(R + "domains/shortlet/src/index.ts");
const { InMemoryBookingStateRepository, SqliteBookingStateRepository } = await import(R + "domains/shortlet/src/booking-state.ts");
const { CancellationApplication } = await import(R + "apps/web/src/cancellation-application.ts");
const { createPlatformCommandEnvelope } = await import(R + "packages/platform-core/src/index.ts");
const { fixedOccupancyLedger } = await import(R + "test/helpers/continuous-occupancy-fixture.ts");

// SQL=1 uses the SQLite store. GUARD=1 adds a trial guard on Reservation status.
const { NodeSqliteDatabase } = await import(R + "packages/platform-core/src/node-sqlite-database.ts");
const openDb = () => new NodeSqliteDatabase(":memory:");
const guest = { id: "g1", role: "guest", tenantId: "t1" } as any;
const system = { id: "settlement-service", role: "system", tenantId: "t1" } as any;
const now = () => new Date("2026-08-10T10:00:00Z");
const contract0: any = { contractId: "c1", reservationId: "r1", offerId: "o1", unitId: "u1", tenantId: "t1", parties: { primaryGuest: { id: "g1", name: "Ada" }, operator: { id: "op" }, distinctPayer: null }, dates: { checkIn: "2026-08-20", checkOut: "2026-08-25", nights: 5 }, occupants: [{ name: "Ada" }], quote: { allInStayTotalKobo: 50000, refundableSecurityDepositKobo: 10000, currency: "NGN" }, totalAmountDueNowKobo: 50000, policies: { cancellationPolicy: { type: "flexible", version: "A", policySummary: "Flexible" }, guestConductRules: [] }, paymentDetails: { paymentMethod: "fresh_card", pspReference: "original", amountKobo: 50000, currency: "NGN", paidAt: "2026-08-01T00:00:00Z" }, createdAt: "2026-08-01T00:00:00Z", contractVersion: 1, checkout: { time: "11:00", timezone: "Africa/Lagos", source: "contractual" }, financialSummary: { originalBookingTotalKobo: 50000, currentContractTotalKobo: 50000, currency: "NGN", amendmentAdjustments: [] } };
const res0: any = { reservationId: "r1", contractId: "c1", unitId: "u1", primaryGuestId: "g1", dates: { checkIn: "2026-08-20", checkOut: "2026-08-25" }, status: "confirmed", confirmedAt: "2026-08-01T00:00:00Z", inventoryCommitmentId: "commit-1" };

function world(faults: Record<string, number>) {
  const left = { ...faults }; const log: string[] = [];
  const step = (n: string) => { if ((left[n] ?? 0) > 0) { left[n]--; log.push(n + ":FAIL"); throw new Error("injected " + n); } log.push(n); };
  const state: any = process.env.SQL ? new SqliteBookingStateRepository(openDb()) : new InMemoryBookingStateRepository({ contracts: [structuredClone(contract0)], reservations: [structuredClone(res0)] });
  if (process.env.SQL) state.saveBookingAtomically({ contract: structuredClone(contract0), reservation: structuredClone(res0) });
  const cancel = new CancellationApplication({
    state, manager: new CancellationNoShowManager(), clock: now,
    timing: { getWindow: () => ({ startIso: "2026-08-20T13:00:00.000Z", timezone: "Africa/Lagos" }) },
    economics: { getEconomics: () => ({ version: "e1", currency: "NGN", cancellationBaseKobo: 50000, refundableCleaningKobo: 0, refundableUnprovidedServicesKobo: 0, refundableSecurityDepositKobo: 0, refundableAttributableTaxKobo: 0, refundableDuplicatePaymentKobo: 0, commissionRate: 0.12 }) },
    arrival: { getState: () => ({ status: "awaiting_access", version: "a1" }) },
    refunds: { initiateOrGetRefund: (i: any) => { step("refund"); return { refundId: "rf1", status: "pending", amountKobo: i.amountKobo, currency: "NGN" }; } },
    ledger: { postCancellation: () => { step("ledger"); return { ledgerRecordId: "l1", status: "posted" }; } },
    availability: { releaseConfirmedBooking: () => { step("release"); } },
  } as any);
  let charged = 0;
  const amend = new BookingAmendmentManager({
    continuousOccupancy: fixedOccupancyLedger({ unitProperties: { u1: "p1" } }),
    contractRepository: { getContract: (id: string) => { if (process.env.GUARD && state.findReservationById("r1")!.status !== "confirmed") throw new Error("STALE_ACTION"); return state.findContractById(id)!; }, mutateContract: (i: any, v: any, m: any) => state.mutateContract(i, v, m) },
    calendar: { getAuthoritativeAvailability: () => ({ isAvailable: true, version: "a1" }), hasSameDayCheckInOnDate: () => false },
    inspectionRepository: { isPassedAndValidThrough: () => ({ valid: true, version: "i1" }) }, authorityRepository: { isValidThrough: () => ({ valid: true, version: "m1" }) },
    quoteProvider: { quote: ({ resultingDates }: any) => ({ quoteId: "q", quoteVersion: "2", currency: "NGN", revisedAllInStayTotalKobo: resultingDates.nights === 6 ? 60000 : 50000, financialAdjustment: resultingDates.nights === 6 ? { type: "additional_collection", amountKobo: 10000, currency: "NGN" } : { type: "none", amountKobo: 0, currency: "NGN" } }) },
    settlementProvider: { settle: ({ amendmentId, contractId, adjustment, quote }: any) => { charged += adjustment.amountKobo; return { settlementId: "s1", amendmentId, contractId, type: adjustment.type, amountKobo: adjustment.amountKobo, currency: "NGN", quoteId: quote.quoteId, quoteVersion: quote.quoteVersion, status: "settled" }; } },
  } as any);
  let id = "";
  const act: Record<string, () => void> = {
    request: () => { if (id) throw new Error("once"); id = amend.requestAmendment(createPlatformCommandEnvelope({ commandName: "booking_amendment.request", principal: guest, payload: { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } } }), now).amendmentId; },
    accept: () => { amend.acceptAmendment(id, guest, now); },
    commit: () => { amend.commitAmendment(createPlatformCommandEnvelope({ commandName: "booking_amendment.commit", principal: system, payload: { amendmentId: id } }), now); },
    cancel: () => { cancel.cancel("r1", guest); },
  };
  return { act, state, log, case: () => cancel.getArtifact("r1", guest).facts.case, actions: () => cancel.getArtifact("r1", guest).actions.length, charged: () => charged };
}

// 1. Every order of amendment and cancellation steps, to depth 6. Property: after cancellation nothing is charged and the contract does not change.
const names = ["request", "accept", "commit", "cancel"]; let seqs = 0, bad1: string[][] = [];
function run(path: string[]) { const w = world({}); let at: any = null; for (const n of path) { try { w.act[n]!(); } catch {} if (!at && w.state.findReservationById("r1")!.status === "cancelled") at = { v: w.state.findContractById("c1")!.contractVersion, c: w.charged() }; } return { w, at }; }
(function dfs(path: string[]) { if (path.length) { seqs++; const { w, at } = run(path); if (at && (w.charged() > at.c || w.state.findContractById("c1")!.contractVersion > at.v)) bad1.push(path); } if (path.length < 6) for (const n of names) dfs([...path, n]); })([]);
bad1.sort((a, b) => a.length - b.length);
console.log("A. orderings explored:", seqs, "| violations:", bad1.length, "| shortest:", bad1[0]?.join(" -> "));
if (bad1[0]) { const { w } = run(bad1[0]); console.log("   reservation:", w.state.findReservationById("r1")!.status, "| charged after cancel (kobo):", w.charged(), "| contract total:", w.state.findContractById("c1")!.totalAmountDueNowKobo); }

// 2. Every single-failure combination in cancellation, then three retries. Property: a cancelled booking eventually has ledger posted, dates released and a refund started.
let combos = 0; const bad2: string[] = [];
for (const l of [0, 1]) for (const r of [0, 1]) for (const f of [0, 1]) { combos++; const w = world({ ledger: l, release: r, refund: f }); for (let i = 0; i < 4; i++) { try { w.act.cancel!(); } catch {} } const c: any = w.case(); const ok = c && c.ledgerStatus === "posted" && c.inventoryReleaseStatus === "released" && ["pending", "settled"].includes(c.refundStatus); if (!ok) bad2.push(`fail once {${[l && "ledger", r && "release", f && "refund"].filter(Boolean).join(",")}} -> reservation ${w.state.findReservationById("r1")!.status}, ledger ${c?.ledgerStatus}, dates ${c?.inventoryReleaseStatus}, refund ${c?.refundStatus}, guest actions left ${w.actions()}, calls [${w.log.join(" ")}]`); }
console.log("B. failure combinations:", combos, "| stuck after 3 retries:", bad2.length); bad2.forEach((b) => console.log("   ", b));

// 3. Structural check of every transition table exported by the domain and platform.
const tables: [string, string][] = [["booking-request", "BOOKING_REQUEST_TRANSITIONS"], ["conditional-offer", "CONDITIONAL_OFFER_TRANSITIONS"], ["card-payment", "CARD_CHECKOUT_SESSION_TRANSITIONS"], ["card-payment", "RESERVATION_TRANSITIONS"], ["bank-transfer", "BANK_TRANSFER_SESSION_TRANSITIONS"], ["manual-transfer", "MANUAL_TRANSFER_TRANSITIONS"], ["payment-attempt", "LIVE_PAYMENT_ATTEMPT_TRANSITIONS"], ["booking-payment-journey", "BOOKING_PAYMENT_STAGE_TRANSITIONS"], ["booking-amendment", "AMENDMENT_TRANSITIONS"]];
console.log("C. transition tables:");
for (const [f, n] of tables) { const m: any = await import(R + `domains/shortlet/src/${f}.ts`); const t = m[n] as Record<string, readonly string[]>; const ks = Object.keys(t); const start = ks[0]!; const seen = new Set([start]); const q = [start]; while (q.length) for (const x of t[q.pop()!] ?? []) if (!seen.has(x)) { seen.add(x); q.push(x); } console.log("   ", n, "| states", ks.length, "| terminal:", ks.filter((k) => t[k]!.length === 0).join(",") || "none", "| unreachable from " + start + ":", ks.filter((k) => !seen.has(k)).join(",") || "none"); }
