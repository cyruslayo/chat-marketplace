import {
  BookingRequestManager,
  type CreateDraftOptions,
} from "../../../domains/shortlet/src/index.js";
import {
  createPlatformCommandEnvelope,
  type CommandPrincipal,
  type PlatformCommandEnvelope,
} from "../../../packages/platform-core/src/index.js";
import {
  bookingRequestArtifactFromRequest,
  bookingRequestArtifactId,
  type BookingRequestArtifact,
  type BookingRequestProjectionInput,
} from "./booking-request-artifact.js";

type BookingRequestManagerDependencies = ConstructorParameters<typeof BookingRequestManager>[0];

export type BookingRequestApplicationDependencies = BookingRequestManagerDependencies & {
  readonly clock?: () => Date;
};

export interface BookingRequestDecisionInput {
  readonly artifactId: string;
  readonly requestId: string;
  readonly expectedStatus: string;
  readonly projectionVersion: number;
  readonly principal: CommandPrincipal;
  readonly action: "confirm" | "decline";
  readonly reason?: string;
}

function snapshot(manager: BookingRequestManager, requestId: string): BookingRequestProjectionInput {
  return manager.getRequest(requestId) as unknown as BookingRequestProjectionInput;
}

export class BookingRequestApplication {
  readonly manager: BookingRequestManager;
  readonly #clock: () => Date;

  constructor(manager: BookingRequestManager, clock: () => Date = () => new Date()) {
    this.manager = manager;
    this.#clock = clock;
  }

  createDraft(input: CreateDraftOptions, principal: CommandPrincipal) {
    const { clock: _clientClock, ...trustedPayload } = input;
    const envelope = createPlatformCommandEnvelope({
      commandName: "booking_request.create_draft",
      principal,
      payload: trustedPayload,
    });
    return this.manager.createDraft(envelope, { clock: this.#clock });
  }

  disclose(draftId: string, principal: CommandPrincipal, autoDeliver = true) {
    const envelope = createPlatformCommandEnvelope({
      commandName: "booking_request.disclose",
      principal,
      payload: { draftId, autoDeliver },
    });
    return this.manager.discloseBookingRequest(envelope, { clock: this.#clock });
  }

  getArtifact(requestId: string, viewer: CommandPrincipal): BookingRequestArtifact {
    const current = snapshot(this.manager, requestId);
    if (current.status === "disclosed") {
      if (!current.delivered) {
        const deliveryEnvelope = createPlatformCommandEnvelope({
          commandName: "booking_request.delivery_failed",
          principal: { id: "system", role: "system" },
          payload: { requestId },
        });
        this.manager.checkAndResolveDeliveryFailure(deliveryEnvelope, { clock: this.#clock });
      }
      const expiryEnvelope = createPlatformCommandEnvelope({
        commandName: "booking_request.expire",
        principal: { id: "system", role: "system" },
        payload: { requestId },
      });
      this.manager.checkAndResolveExpiry(expiryEnvelope, { clock: this.#clock });
    }
    return bookingRequestArtifactFromRequest(snapshot(this.manager, requestId), viewer);
  }

  confirm(input: BookingRequestDecisionInput) {
    return this.decide(input, "booking_request.confirm");
  }

  decline(input: BookingRequestDecisionInput) {
    return this.decide(input, "booking_request.decline");
  }

  private decide(input: BookingRequestDecisionInput, commandName: "booking_request.confirm" | "booking_request.decline") {
    const current = snapshot(this.manager, input.requestId);
    const expectedArtifactId = bookingRequestArtifactId(input.requestId);
    if (input.artifactId !== expectedArtifactId) throw new Error("Booking Request artifact mismatch");
    if (current.requestId !== input.requestId) throw new Error("Booking Request identity mismatch");
    if (current.status !== input.expectedStatus || current.status !== "disclosed") {
      throw new Error("Booking Request action is stale or no longer allowed");
    }
    if (input.projectionVersion !== bookingRequestArtifactFromRequest(current, input.principal).projectionVersion) {
      throw new Error("Booking Request projection is stale");
    }
    this.assertOperator(current, input.principal);
    const payload = commandName === "booking_request.decline"
      ? { requestId: input.requestId, reason: input.reason ?? "" }
      : { requestId: input.requestId };
    const envelope: PlatformCommandEnvelope<typeof payload> = createPlatformCommandEnvelope({
      commandName,
      principal: input.principal,
      payload,
    });
    return commandName === "booking_request.confirm"
      ? this.manager.confirmBookingRequest(envelope, { clock: this.#clock })
      : this.manager.declineBookingRequest(envelope, { clock: this.#clock });
  }

  private assertOperator(request: BookingRequestProjectionInput, principal: CommandPrincipal): void {
    if (principal.role !== "operator" || !principal.id || !request.operatorId || principal.id !== request.operatorId) {
      throw new Error("Authenticated principal is not authorized for this Operator action");
    }
    if (!request.tenantId || !principal.tenantId || request.tenantId !== principal.tenantId) {
      throw new Error("Authenticated principal is not authorized for this tenant");
    }
  }
}

export function createBookingRequestApplication(
  dependencies: BookingRequestApplicationDependencies,
): BookingRequestApplication {
  const { clock, ...managerDependencies } = dependencies;
  return new BookingRequestApplication(new BookingRequestManager(managerDependencies), clock ?? (() => new Date()));
}
