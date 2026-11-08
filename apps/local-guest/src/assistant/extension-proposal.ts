import { generatePlatformId } from "../../../../packages/platform-core/src/index.js";
import { ContinuousOccupancyError, ExtensionRefusedError, type ExtensionRefusalCode } from "../../../../domains/shortlet/src/index.js";
import { GUEST_EXTENSION_COPY } from "../../../../apps/web-agent/src/guest-content.js";
import { EXTENSION_OPEN_EVENT } from "../../../../apps/web-agent/src/booking-contract-a2ui.js";
import type { LocalGuestEnvironment } from "../fixture.js";
import { AssistantGuestRefusalError } from "./date-tokens.js";
import type { PendingAssistantAction } from "./pending-actions.js";

// Monthly-stays issue 09 (ADR 0092 Extensions, ADR 0106, ADR 0074). The extension card: a preview only. It shows the one added
// Billing Period (or the nights left under the maximum) with its amount and due date. The card's own button sends the request;
// the Operator decides in the back office. A refusal is a guest refusal (tool_denial or a refused button), never an error.

export { EXTENSION_OPEN_EVENT };

const REFUSAL: Record<ExtensionRefusalCode, string> = {
  NOT_AUTHORIZED: GUEST_EXTENSION_COPY.notAvailable,
  NOT_OPERATOR: GUEST_EXTENSION_COPY.notAvailable,
  NOT_EXTENDED: GUEST_EXTENSION_COPY.notExtended,
  NOT_AN_EXTENSION: GUEST_EXTENSION_COPY.notAvailable,
  NOTICE_IN_FORCE: GUEST_EXTENSION_COPY.noticeInForce,
  EXTENSION_PENDING: GUEST_EXTENSION_COPY.pending,
  NOT_AWAITING: GUEST_EXTENSION_COPY.pending,
  TOO_LONG: GUEST_EXTENSION_COPY.tooLong,
  UNAVAILABLE: GUEST_EXTENSION_COPY.unavailable,
  INSPECTION_NOT_VALID: GUEST_EXTENSION_COPY.inspection,
  STALE: GUEST_EXTENSION_COPY.stale,
  QUOTE_CHANGED: GUEST_EXTENSION_COPY.stale,
  EXPIRED: GUEST_EXTENSION_COPY.expired,
  NOT_FOUND: GUEST_EXTENSION_COPY.notAvailable,
};

/** The guest sentence for a domain refusal. The Continuous Occupancy refusal carries its own wording (ADR 0023). */
export function extensionRefusal(error: unknown): AssistantGuestRefusalError | undefined {
  if (error instanceof ExtensionRefusedError) return new AssistantGuestRefusalError(REFUSAL[error.code]);
  if (error instanceof ContinuousOccupancyError) return new AssistantGuestRefusalError(error.message);
  return undefined;
}

/**
 * The pending extension action for the confirmed Extended Stay. It binds the contract version and the new checkout that
 * the card shows, so the confirmation sends exactly that request or is refused (fail closed).
 */
export function proposeExtension(input: { readonly environment: LocalGuestEnvironment; readonly contractId: string; readonly threadId: string; readonly now: Date }): PendingAssistantAction {
  let preview;
  try {
    preview = input.environment.extensions.previewNextPeriod(input.contractId, input.environment.guestPrincipal());
  } catch (error) {
    const refusal = extensionRefusal(error);
    if (refusal) throw refusal;
    throw error;
  }
  const period = preview.addedPeriods[0];
  if (period === undefined) throw new AssistantGuestRefusalError(GUEST_EXTENSION_COPY.notAvailable);
  return {
    id: generatePlatformId("pa"),
    threadId: input.threadId,
    guestActorId: input.environment.config.guestId,
    tenantId: input.environment.config.tenantId,
    type: "request_extension",
    authoritativeReferences: {
      contractId: input.contractId,
      contractVersion: preview.contractVersion,
      newCheckOut: preview.newCheckOut,
      addedNights: preview.addedNights,
      addedAmountKobo: preview.addedAmountKobo,
      periodDueDate: period.dueDate,
    },
    summary: GUEST_EXTENSION_COPY.cardOpened,
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + 15 * 60 * 1000).toISOString(),
    executed: false,
  };
}
