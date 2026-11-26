import type { CommandPrincipal } from "../../../../packages/platform-core/src/envelope.js";
import {
  dateKeyInLagos,
  projectBookingRequestStatus,
  type BookingContract,
  type ConditionalBookingOffer,
  type GuestIdentity,
} from "../../../../domains/shortlet/src/index.js";
import {
  conventionalBookingContractRoute,
  conventionalBookingRequestRoute,
  conventionalCardPaymentRoute,
  conventionalConditionalOfferRoute,
} from "../../../web/src/presentation.js";
import { conditionalOfferArtifactFromOffer } from "../../../web/src/conditional-offer-artifact.js";
import { cardPaymentArtifactFromState } from "../../../web/src/card-payment-artifact.js";
import { guestPaymentStatus, guestRequestStatus } from "../../../web-agent/src/booking-presentation.js";
import type { LocalGuestEnvironment } from "../fixture.js";
import { parseGuestProjection } from "../guest-projection.js";
import type { GuestStage } from "../guest-stage.js";
import type { PlanRow, PlanRowGroup, PlanRowScope } from "./plan-rows.js";

/**
 * Exhaustive mapping from every GuestStage in `guest-stage.ts` to its default PlanRowGroup,
 * or `null` for pre-request browsing stages (`discovery`, `unit`, `draft`) that never appear in `/plans`.
 * Adding a new GuestStage without updating this map fails `tsc --noEmit` (Issue 10 AC1).
 */
export const GUEST_STAGE_PLAN_GROUP: Readonly<Record<GuestStage, PlanRowGroup | null>> = {
  discovery: null,
  unit: null,
  draft: null,
  request: "in_progress",
  offer: "needs_action",
  payment: "needs_action",
  booking: "in_progress",
};

export function planGroupForGuestStage(stage: GuestStage): PlanRowGroup | null {
  return GUEST_STAGE_PLAN_GROUP[stage];
}

export function committedWorkScope(
  env: LocalGuestEnvironment,
  principal: CommandPrincipal,
  identity?: GuestIdentity,
): readonly string[] | null {
  if (
    principal.role !== "guest" ||
    !principal.id ||
    !principal.tenantId ||
    principal.tenantId !== env.config.tenantId
  )
    return null;
  if (identity?.accountGuestId !== undefined) {
    return identity.tenantId === principal.tenantId &&
      identity.principalIds.includes(principal.id)
      ? identity.principalIds
      : null;
  }
  return principal.id === env.guestPrincipal().id ? [principal.id] : null;
}

export interface StaysCommittedWorkEntry {
  readonly kind: "request" | "offer" | "reservation";
  readonly threadId: string;
  readonly route: string;
  readonly unitTitle?: string;
}

export interface StaysPlanEntry {
  readonly row: PlanRow;
  readonly committedWork?: StaysCommittedWorkEntry;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function whereLabel(environment: LocalGuestEnvironment, unitId: string, fallbackLocation?: unknown): string {
  const unit = environment.unitRepository.findById(unitId);
  if (unit) return `${unit.location.neighbourhood}, ${unit.location.city}`;
  if (isPlainRecord(fallbackLocation)) {
    const neighbourhood = typeof fallbackLocation.neighbourhood === "string" ? fallbackLocation.neighbourhood : "";
    const city = typeof fallbackLocation.city === "string" ? fallbackLocation.city : "";
    if (neighbourhood && city) return `${neighbourhood}, ${city}`;
    if (city) return city;
  }
  return "";
}

function unitTitleLabel(environment: LocalGuestEnvironment, unitId: string, fallbackTitle?: string): string {
  return environment.unitRepository.findById(unitId)?.title ?? fallbackTitle ?? "Stay";
}

function periodPaymentScheduleHref(offerId: string): string {
  return `/bookings/periods/${encodeURIComponent(offerId)}`;
}

/**
 * Collects redacted plan rows and matching live `committedWork` entries for Stays from durable stores.
 * Evaluates every deadline lazily against `now` (ADR 0004, 0074, 0106) and fails closed on invalid or foreign threads.
 */
export async function collectStaysPlanEntries(
  environment: LocalGuestEnvironment,
  scope: PlanRowScope,
  now: Date = environment.clock(),
): Promise<readonly StaysPlanEntry[]> {
  const principals = committedWorkScope(environment, scope.principal, scope.identity);
  const tenantId = scope.principal.tenantId;
  if (principals === null || !tenantId) return [];

  const candidates: { readonly threadId: string; readonly principalId: string; readonly claimedRequestId: string | null; readonly threadJson: string }[] = [];
  for (const record of await environment.guestData.findThreadsForPrincipals(principals, tenantId)) {
    candidates.push({ threadId: record.threadId, principalId: record.principalId, claimedRequestId: null, threadJson: record.threadJson });
  }
  for (const requestId of scope.identity?.claimedRequestIds ?? []) {
    const request = environment.interactionStore.findBookingRequest(requestId);
    if (!request || request.tenantId !== tenantId) continue;
    for (const record of await environment.guestData.findThreadsForPrincipal(request.primaryGuestId, tenantId)) {
      candidates.push({ threadId: record.threadId, principalId: record.principalId, claimedRequestId: requestId, threadJson: record.threadJson });
    }
  }

  const seenThreads = new Set<string>();
  const entries: StaysPlanEntry[] = [];

  for (const candidate of candidates) {
    if (seenThreads.has(candidate.threadId)) continue;
    const projection = parseGuestProjection(safeJsonParse(candidate.threadJson));
    if (!projection || (!projection.requestId && !projection.offerId)) continue;
    if (candidate.claimedRequestId !== null && projection.requestId !== candidate.claimedRequestId) continue;
    seenThreads.add(candidate.threadId);

    const owner: CommandPrincipal = { id: candidate.principalId, role: "guest", tenantId };
    const offerId =
      projection.offerId ??
      (projection.requestId
        ? (environment.interactionStore.findConditionalOfferByRequestId(projection.requestId)?.offerId ?? null)
        : null);

    // 1. Confirmed Reservation / Booking Contract (if a snapshot exists for this offer).
    const snapshot = offerId ? environment.interactionStore.findBookingSnapshotByOfferId(offerId) : null;
    if (offerId && snapshot) {
      const parsedContract = safeJsonParse(snapshot.contractJson);
      if (!isPlainRecord(parsedContract) || typeof parsedContract.contractId !== "string") continue;
      const contract = parsedContract as unknown as BookingContract;
      const storedReservation = environment.contractRepository.findReservationById(snapshot.reservationId);
      const parsedFallbackReservation = safeJsonParse(snapshot.reservationJson);
      const reservationStatus =
        storedReservation?.status ??
        (isPlainRecord(parsedFallbackReservation) && typeof parsedFallbackReservation.status === "string"
          ? parsedFallbackReservation.status
          : "confirmed");

      const title = unitTitleLabel(environment, contract.unitId);
      const where = whereLabel(environment, contract.unitId);
      const contractRoute = conventionalBookingContractRoute(contract.contractId);

      if (reservationStatus === "cancelled" || reservationStatus === "no_show") {
        entries.push({
          row: {
            rowId: `stays:contract:${contract.contractId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: contract.dates.checkIn,
            endsOn: contract.dates.checkOut,
            group: "past",
            status: { tone: "danger", label: reservationStatus === "cancelled" ? "Cancelled" : "No-show" },
            nextStep: { label: "View stay" },
            href: contractRoute,
          },
        });
        continue;
      }

      if (dateKeyInLagos(now, "now") >= contract.dates.checkOut) {
        entries.push({
          row: {
            rowId: `stays:contract:${contract.contractId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: contract.dates.checkIn,
            endsOn: contract.dates.checkOut,
            group: "past",
            status: { tone: "info", label: "Past stay" },
            nextStep: { label: "View past stay" },
            href: contractRoute,
          },
        });
        continue;
      }

      // Check Extended Stay billing periods lazily against `now` (ADR 0092, rules/02 S4).
      let payablePeriod: { readonly dueDate: string } | undefined;
      try {
        const periods = environment.cardPaymentApp.projectBillingPeriods(offerId, now);
        const found = periods.find((period) => period.status === "payable" && !period.live);
        if (found) payablePeriod = { dueDate: found.dueDate };
      } catch {
        payablePeriod = undefined;
      }

      if (payablePeriod) {
        entries.push({
          row: {
            rowId: `stays:contract:${contract.contractId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: contract.dates.checkIn,
            endsOn: contract.dates.checkOut,
            group: "needs_action",
            status: { tone: "warning", label: "Period payment due" },
            nextStep: { label: "Pay next billing period", deadlineAt: `${payablePeriod.dueDate}T00:00:00.000Z` },
            href: periodPaymentScheduleHref(offerId),
          },
          committedWork: {
            kind: "reservation",
            threadId: candidate.threadId,
            route: contractRoute,
            unitTitle: title,
          },
        });
      } else {
        entries.push({
          row: {
            rowId: `stays:contract:${contract.contractId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: contract.dates.checkIn,
            endsOn: contract.dates.checkOut,
            group: "in_progress",
            status: { tone: "success", label: "Reservation confirmed" },
            nextStep: { label: "View your stay" },
            href: contractRoute,
          },
          committedWork: {
            kind: "reservation",
            threadId: candidate.threadId,
            route: contractRoute,
            unitTitle: title,
          },
        });
      }
      continue;
    }

    // 2. Conditional Offer / Payment stage (no snapshot yet).
    if (offerId) {
      let offer: ConditionalBookingOffer;
      try {
        offer = environment.conditionalOfferApp.getOffer(offerId);
      } catch {
        continue;
      }
      const offerArtifact = conditionalOfferArtifactFromOffer(offer, owner, now);
      const title = unitTitleLabel(environment, offer.unitId, offer.unit.title);
      const where = whereLabel(environment, offer.unitId, offer.unit.location);
      const offerRoute = conventionalConditionalOfferRoute(offerId);

      if (offerArtifact.facts.status === "expired" || offerArtifact.facts.status === "stale" || offerArtifact.facts.status === "revoked") {
        const label =
          offerArtifact.facts.status === "expired"
            ? "Offer expired"
            : offerArtifact.facts.status === "stale"
              ? "Offer no longer current"
              : "Offer withdrawn";
        entries.push({
          row: {
            rowId: `stays:offer:${offerId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: offer.dates.checkIn,
            endsOn: offer.dates.checkOut,
            group: "past",
            status: { tone: "danger", label },
            nextStep: { label: "View offer" },
            href: offerRoute,
          },
        });
        continue;
      }

      if (offerArtifact.facts.status === "issued") {
        entries.push({
          row: {
            rowId: `stays:offer:${offerId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: offer.dates.checkIn,
            endsOn: offer.dates.checkOut,
            group: "needs_action",
            status: { tone: "warning", label: "Offer ready" },
            nextStep: { label: "Review and accept offer", deadlineAt: offer.paymentWindow.expiresAt },
            href: offerRoute,
          },
          committedWork: {
            kind: "offer",
            threadId: candidate.threadId,
            route: offerRoute,
            unitTitle: title,
          },
        });
        continue;
      }

      // Offer is "accepted": inspect manual transfer, bank transfer, and card payment lazily at `now`.
      const paymentRoute = conventionalCardPaymentRoute(offerId);
      const manual = environment.manualTransfers?.current(offerId, now);
      if (manual) {
        if (manual.status === "rejected" || manual.status === "expired") {
          entries.push({
            row: {
              rowId: `stays:offer:${offerId}`,
              domain: "shortlet",
              title,
              where,
              startsOn: offer.dates.checkIn,
              endsOn: offer.dates.checkOut,
              group: "past",
              status: { tone: "danger", label: manual.status === "rejected" ? "Transfer not matched" : "Payment window expired" },
              nextStep: { label: "View payment" },
              href: `${paymentRoute}/manual-transfer`,
            },
          });
          continue;
        }
        if (manual.status === "awaiting_verification") {
          entries.push({
            row: {
              rowId: `stays:offer:${offerId}`,
              domain: "shortlet",
              title,
              where,
              startsOn: offer.dates.checkIn,
              endsOn: offer.dates.checkOut,
              group: "in_progress",
              status: { tone: "warning", label: "Waiting for payment check" },
              nextStep: { label: "Checking your transfer", deadlineAt: manual.verificationDeadlineAt },
              href: `${paymentRoute}/manual-transfer`,
            },
            committedWork: {
              kind: "offer",
              threadId: candidate.threadId,
              route: offerRoute,
              unitTitle: title,
            },
          });
          continue;
        }
        entries.push({
          row: {
            rowId: `stays:offer:${offerId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: offer.dates.checkIn,
            endsOn: offer.dates.checkOut,
            group: "needs_action",
            status: { tone: "warning", label: "Waiting for your transfer" },
            nextStep: { label: "Transfer and upload receipt", deadlineAt: manual.paymentDeadlineAt },
            href: `${paymentRoute}/manual-transfer`,
          },
          committedWork: {
            kind: "offer",
            threadId: candidate.threadId,
            route: offerRoute,
            unitTitle: title,
          },
        });
        continue;
      }

      const transfer = environment.bankTransferApp?.getSession(offerId);
      if (transfer) {
        const transferExpired = transfer.status === "expired" || (transfer.status === "initiated" && now.getTime() >= Date.parse(transfer.expiresAt));
        if (transferExpired || transfer.status === "refunded") {
          entries.push({
            row: {
              rowId: `stays:offer:${offerId}`,
              domain: "shortlet",
              title,
              where,
              startsOn: offer.dates.checkIn,
              endsOn: offer.dates.checkOut,
              group: "past",
              status: { tone: "danger", label: transfer.status === "refunded" ? "Transfer refunded" : "Transfer account expired" },
              nextStep: { label: "View payment" },
              href: `${paymentRoute}/transfer`,
            },
          });
          continue;
        }
        if (transfer.status === "processing_in_grace") {
          entries.push({
            row: {
              rowId: `stays:offer:${offerId}`,
              domain: "shortlet",
              title,
              where,
              startsOn: offer.dates.checkIn,
              endsOn: offer.dates.checkOut,
              group: "in_progress",
              status: { tone: "warning", label: "Your transfer is processing" },
              nextStep: { label: "Waiting for bank confirmation" },
              href: `${paymentRoute}/transfer`,
            },
            committedWork: {
              kind: "offer",
              threadId: candidate.threadId,
              route: offerRoute,
              unitTitle: title,
            },
          });
          continue;
        }
        entries.push({
          row: {
            rowId: `stays:offer:${offerId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: offer.dates.checkIn,
            endsOn: offer.dates.checkOut,
            group: "needs_action",
            status: { tone: "warning", label: "Waiting for your transfer" },
            nextStep: { label: "Complete bank transfer", deadlineAt: transfer.expiresAt },
            href: `${paymentRoute}/transfer`,
          },
          committedWork: {
            kind: "offer",
            threadId: candidate.threadId,
            route: offerRoute,
            unitTitle: title,
          },
        });
        continue;
      }

      const session = environment.cardPaymentApp.getCheckoutSession(offerId);
      const journey = environment.cardPaymentApp.getPaymentJourney(offerId);
      const paymentArtifact = cardPaymentArtifactFromState({ offer, viewer: owner, session, journey, now });
      const processing =
        paymentArtifact.facts.journeyStage === "stay_payment_processing" ||
        paymentArtifact.facts.journeyStage === "deposit_payment_processing";
      const copy = guestPaymentStatus(paymentArtifact.facts.status, processing);

      if (
        paymentArtifact.facts.status === "expired" ||
        paymentArtifact.facts.status === "failed" ||
        paymentArtifact.facts.status === "compensated"
      ) {
        entries.push({
          row: {
            rowId: `stays:offer:${offerId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: offer.dates.checkIn,
            endsOn: offer.dates.checkOut,
            group: "past",
            status: { tone: "danger", label: copy.label },
            nextStep: { label: "View payment" },
            href: paymentRoute,
          },
        });
        continue;
      }

      if (
        processing ||
        paymentArtifact.facts.status === "compensation_pending" ||
        paymentArtifact.facts.status === "reconciliation_required"
      ) {
        entries.push({
          row: {
            rowId: `stays:offer:${offerId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: offer.dates.checkIn,
            endsOn: offer.dates.checkOut,
            group: "in_progress",
            status: { tone: "warning", label: copy.label },
            nextStep: { label: "Waiting for payment check" },
            href: paymentRoute,
          },
          committedWork: {
            kind: "offer",
            threadId: candidate.threadId,
            route: offerRoute,
            unitTitle: title,
          },
        });
        continue;
      }

      entries.push({
        row: {
          rowId: `stays:offer:${offerId}`,
          domain: "shortlet",
          title,
          where,
          startsOn: offer.dates.checkIn,
          endsOn: offer.dates.checkOut,
          group: "needs_action",
          status: { tone: "warning", label: copy.label },
          nextStep: { label: "Complete payment", deadlineAt: offer.paymentWindow.expiresAt },
          href: paymentRoute,
        },
        committedWork: {
          kind: "offer",
          threadId: candidate.threadId,
          route: offerRoute,
          unitTitle: title,
        },
      });
      continue;
    }

    // 3. Booking Request (no offer yet). Never called a Reservation (ADR 0005, rules/02 S3).
    if (projection.requestId) {
      const request = environment.interactionStore.findBookingRequest(projection.requestId);
      if (!request) continue;
      const status = projectBookingRequestStatus(request, now);
      const statusCopy = guestRequestStatus(status, request.delivered);
      const title = unitTitleLabel(environment, request.unitId);
      const where = whereLabel(environment, request.unitId);
      const requestRoute = conventionalBookingRequestRoute(request.requestId);

      if (status === "declined" || status === "expired" || status === "delivery_failed") {
        entries.push({
          row: {
            rowId: `stays:request:${request.requestId}`,
            domain: "shortlet",
            title,
            where,
            startsOn: request.checkIn,
            endsOn: request.checkOut,
            group: "past",
            status: { tone: "danger", label: statusCopy.label },
            nextStep: { label: "View request" },
            href: requestRoute,
          },
        });
        continue;
      }

      entries.push({
        row: {
          rowId: `stays:request:${request.requestId}`,
          domain: "shortlet",
          title,
          where,
          startsOn: request.checkIn,
          endsOn: request.checkOut,
          group: "in_progress",
          status: { tone: "info", label: statusCopy.label },
          nextStep: {
            label: "Waiting for the Operator",
            deadlineAt: request.delivered ? request.operatorResponseDeadlineAt : request.deliveryDeadlineAt,
          },
          href: requestRoute,
        },
        committedWork: {
          kind: "request",
          threadId: candidate.threadId,
          route: requestRoute,
          unitTitle: title,
        },
      });
    }
  }

  return Object.freeze(entries);
}

/** `AssistantDomainPack.planRows` implementation for Stays. */
export async function shortletPlanRows(
  environment: LocalGuestEnvironment,
  scope: PlanRowScope,
  now: Date = environment.clock(),
): Promise<readonly PlanRow[]> {
  try {
    const entries = await collectStaysPlanEntries(environment, scope, now);
    return Object.freeze(entries.map((entry) => entry.row));
  } catch {
    return [];
  }
}
