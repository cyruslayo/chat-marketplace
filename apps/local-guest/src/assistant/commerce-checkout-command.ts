import type { ActionArtifact, ActionContextSchema, ActionOutcome, ActionSpec, ActionServerEvent } from "../../../../packages/platform-core/src/interactions.js";
import { resolveAction } from "../../../../packages/platform-core/src/interactions.js";
import type { CommandPrincipal, PlatformCommandEnvelope } from "../../../../packages/platform-core/src/envelope.js";
import type { SqlDatabase, SqlRow } from "../../../../packages/platform-core/src/sql-database.js";
import type { AuditLog } from "../../../../packages/platform-core/src/index.js";
import { COMMERCE_CHECKOUT_CONFIRM_ACTION } from "../../../web-agent/src/commerce-presentation.js";

export const COMMERCE_CHECKOUT_COMMAND = "commerce.checkout.confirm";

function validTenantId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface CommerceCheckoutLineSnapshot {
  readonly lineId: string;
  readonly offerId: string;
  readonly variantId?: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly priceKobo: number;
}

export interface CommerceCheckoutProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly taskId: string;
  readonly storeId: string;
  readonly deliveryZoneId: string;
  readonly cartVersion: string;
  readonly lines: readonly CommerceCheckoutLineSnapshot[];
  readonly subtotalKobo: number;
  readonly shippingFeeKobo: number;
  readonly totalKobo: number;
  readonly version: number;
  readonly status: "proposed" | "dispatching" | "payment_unavailable" | "payment_started";
}

export interface CommerceCheckoutConfirmation {
  readonly proposalId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly cartVersion: string;
  readonly confirmedTotalKobo: number;
}

export interface CommerceCheckoutCommandPayload extends CommerceCheckoutConfirmation {
  readonly tenantId: string;
  readonly storeId: string;
}

export interface CommerceCheckoutExecutor {
  execute(input: { readonly envelope: PlatformCommandEnvelope<CommerceCheckoutCommandPayload>; readonly proposal: CommerceCheckoutProposal }): { readonly status: "payment_started" | "payment_unavailable" };
}

export interface CommerceCheckoutArtifact extends ActionArtifact {
  readonly schemaVersion: "commerce.checkout-proposal/v1";
  readonly projectionVersion: number;
  readonly proposal: CommerceCheckoutProposal;
}

interface ActionContext extends CommerceCheckoutConfirmation { readonly surfaceId?: string }

const contextSchema: ActionContextSchema = {
  required: {
    proposalId: { type: "string", nonEmpty: true },
    taskId: { type: "string", nonEmpty: true },
    expectedVersion: { type: "integer", min: 1 },
    cartVersion: { type: "string", nonEmpty: true },
    confirmedTotalKobo: { type: "integer", min: 0 },
  },
  optional: { surfaceId: { type: "string", nonEmpty: true } },
};

function readProposal(row: SqlRow): CommerceCheckoutProposal {
  const parsed: unknown = JSON.parse(String(row.lines_json));
  if (!Array.isArray(parsed)) throw new TypeError("Stored checkout proposal lines are invalid.");
  const status = String(row.status);
  if (status !== "proposed" && status !== "dispatching" && status !== "payment_unavailable" && status !== "payment_started") throw new TypeError("Stored checkout proposal status is invalid.");
  return {
    id: String(row.id), tenantId: String(row.tenant_id), principalId: String(row.principal_id), taskId: String(row.task_id),
    storeId: String(row.store_id), deliveryZoneId: String(row.delivery_zone_id), cartVersion: String(row.cart_version), lines: parsed as CommerceCheckoutLineSnapshot[],
    subtotalKobo: Number(row.subtotal_kobo), shippingFeeKobo: Number(row.shipping_fee_kobo), totalKobo: Number(row.total_kobo),
    version: Number(row.version), status,
  };
}

export class CommerceCheckoutCommandBoundary {
  readonly #spec: ActionSpec<ActionContext, CommerceCheckoutArtifact, CommerceCheckoutCommandPayload>;

  constructor(private readonly input: {
    readonly database: SqlDatabase;
    readonly audit?: AuditLog;
    readonly revalidate: (proposal: CommerceCheckoutProposal) => boolean;
    readonly executor?: CommerceCheckoutExecutor;
  }) {
    input.database.exec(`CREATE TABLE IF NOT EXISTS commerce_checkout_proposals (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL, task_id TEXT NOT NULL,
      store_id TEXT NOT NULL, delivery_zone_id TEXT NOT NULL, lines_json TEXT NOT NULL,
      cart_version TEXT NOT NULL,
      subtotal_kobo INTEGER NOT NULL, shipping_fee_kobo INTEGER NOT NULL, total_kobo INTEGER NOT NULL,
      version INTEGER NOT NULL, status TEXT NOT NULL, result_status TEXT
    )`);
    this.#spec = {
      name: COMMERCE_CHECKOUT_CONFIRM_ACTION,
      artifact: {
        kind: "commerce.checkout-proposal",
        schemaVersion: "commerce.checkout-proposal/v1",
        load: (raw, principal) => {
          const context = raw as ActionContext;
          const row = input.database.prepare("SELECT * FROM commerce_checkout_proposals WHERE id = $id").get({ $id: context.proposalId });
          if (!row) throw new Error("Checkout proposal not found.");
          const proposal = readProposal(row);
          if (!validTenantId(principal.tenantId) || !validTenantId(proposal.tenantId) || proposal.taskId !== context.taskId || proposal.tenantId !== principal.tenantId) throw new Error("Checkout proposal scope mismatch.");
          return { id: `commerce-checkout:${proposal.id}`, kind: "commerce.checkout-proposal", schemaVersion: "commerce.checkout-proposal/v1", projectionVersion: proposal.version, proposal };
        },
      },
      context: contextSchema,
      crossMatch: (context, artifact) => context.proposalId === artifact.proposal.id && context.taskId === artifact.proposal.taskId && context.cartVersion === artifact.proposal.cartVersion ? true : { code: "ARTIFACT_MISMATCH", message: "The checkout confirmation does not match this proposal." },
      expect: [{ expected: (context) => context.expectedVersion, actual: (artifact) => artifact.projectionVersion }],
       isAuthorized: (context, artifact, principal) => principal.role === "guest" && validTenantId(principal.tenantId) && validTenantId(artifact.proposal.tenantId) && principal.id === artifact.proposal.principalId && principal.tenantId === artifact.proposal.tenantId && context.confirmedTotalKobo === artifact.proposal.totalKobo,
      authorizationRejected: { code: "ACTION_NOT_AUTHORIZED", message: "The checkout confirmation is not authorized." },
      command: (context, artifact) => ({
        commandName: COMMERCE_CHECKOUT_COMMAND,
        idempotencyKey: `commerce-checkout:${artifact.proposal.id}:v${artifact.proposal.version}`,
        expectedVersion: artifact.proposal.version,
        payload: {
          proposalId: context.proposalId,
          taskId: context.taskId,
          expectedVersion: context.expectedVersion,
          cartVersion: context.cartVersion,
          confirmedTotalKobo: context.confirmedTotalKobo,
          tenantId: artifact.proposal.tenantId,
          storeId: artifact.proposal.storeId,
        },
      }),
      run: ({ artifact, envelope }) => this.#execute(artifact.proposal, envelope),
      rejectionMessages: { stale: "The cart or delivery quote has changed. Review a fresh checkout proposal.", runRejected: "Checkout confirmation is unavailable." },
      runRejectedCode: (error) => error instanceof Error && error.message === "Checkout proposal is stale." ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED",
    };
  }

  create(proposal: CommerceCheckoutProposal): void {
    if (!validTenantId(proposal.tenantId)) throw new TypeError("Checkout proposal requires a verified tenant scope.");
    this.input.database.prepare(`INSERT INTO commerce_checkout_proposals
      (id, tenant_id, principal_id, task_id, store_id, delivery_zone_id, lines_json, cart_version, subtotal_kobo, shipping_fee_kobo, total_kobo, version, status)
      VALUES ($id, $tenantId, $principalId, $taskId, $storeId, $deliveryZoneId, $linesJson, $cartVersion, $subtotal, $shipping, $total, $version, 'proposed')`)
      .run({ $id: proposal.id, $tenantId: proposal.tenantId, $principalId: proposal.principalId, $taskId: proposal.taskId, $storeId: proposal.storeId, $deliveryZoneId: proposal.deliveryZoneId, $linesJson: JSON.stringify(proposal.lines), $cartVersion: proposal.cartVersion, $subtotal: proposal.subtotalKobo, $shipping: proposal.shippingFeeKobo, $total: proposal.totalKobo, $version: proposal.version });
  }

  confirmationEvent(context: CommerceCheckoutConfirmation & { readonly surfaceId?: string }): ActionServerEvent {
    return { message: { action: { name: COMMERCE_CHECKOUT_CONFIRM_ACTION, context } } };
  }

  confirm(event: ActionServerEvent, principal: CommandPrincipal): ActionOutcome<CommerceCheckoutArtifact> {
    return resolveAction(event, [this.#spec], principal);
  }

  #execute(proposal: CommerceCheckoutProposal, envelope: PlatformCommandEnvelope<CommerceCheckoutCommandPayload> | undefined): CommerceCheckoutArtifact {
    if (proposal.status === "payment_unavailable" || proposal.status === "payment_started") return this.#artifact({ ...proposal, status: proposal.status });
    if (proposal.status === "dispatching") throw new Error("This checkout command is already being processed.");
    if (!envelope || envelope.commandName !== COMMERCE_CHECKOUT_COMMAND || !this.input.revalidate(proposal)) throw new Error("Checkout proposal is stale.");
    // A conditional write is the command's concurrency gate; the platform envelope supplies the stable retry key.
    const reserved = this.input.database.prepare("UPDATE commerce_checkout_proposals SET status = 'dispatching' WHERE id = $id AND version = $version AND status = 'proposed'")
      .run({ $id: proposal.id, $version: proposal.version });
    if (reserved.changes !== 1) {
      const current = this.input.database.prepare("SELECT * FROM commerce_checkout_proposals WHERE id = $id").get({ $id: proposal.id });
      if (current) return this.#artifact(readProposal(current));
      throw new Error("Checkout proposal is unavailable.");
    }
    if (!this.input.executor) {
      this.input.database.prepare("UPDATE commerce_checkout_proposals SET status = 'payment_unavailable', result_status = 'payment_unavailable' WHERE id = $id AND version = $version AND status = 'dispatching'")
        .run({ $id: proposal.id, $version: proposal.version });
      this.input.audit?.record({ action: COMMERCE_CHECKOUT_COMMAND, proposalId: proposal.id, commandId: envelope.commandId, status: "payment_unavailable" });
      return this.#artifact({ ...proposal, status: "payment_unavailable" });
    }
    try {
      const result = this.input.executor.execute({ envelope, proposal });
      this.input.database.prepare("UPDATE commerce_checkout_proposals SET status = $status, result_status = $status WHERE id = $id AND version = $version")
        .run({ $status: result.status, $id: proposal.id, $version: proposal.version });
      this.input.audit?.record({ action: COMMERCE_CHECKOUT_COMMAND, proposalId: proposal.id, commandId: envelope.commandId, status: result.status });
      return this.#artifact({ ...proposal, status: result.status });
    } catch (error) {
      this.input.database.prepare("UPDATE commerce_checkout_proposals SET status = 'proposed' WHERE id = $id AND version = $version AND status = 'dispatching'")
        .run({ $id: proposal.id, $version: proposal.version });
      throw error;
    }
  }

  #artifact(proposal: CommerceCheckoutProposal): CommerceCheckoutArtifact {
    return { id: `commerce-checkout:${proposal.id}`, kind: "commerce.checkout-proposal", schemaVersion: "commerce.checkout-proposal/v1", projectionVersion: proposal.version, proposal };
  }
}

/** Conventional checkout routes call this same typed event/schema/action-gate/command handler. */
export function confirmCommerceCheckoutConventional(input: {
  readonly boundary: CommerceCheckoutCommandBoundary;
  readonly confirmation: CommerceCheckoutConfirmation;
  readonly principal: CommandPrincipal;
}): ActionOutcome<CommerceCheckoutArtifact> {
  return confirmCommerceCheckoutAction({ boundary: input.boundary, actionName: COMMERCE_CHECKOUT_CONFIRM_ACTION, context: input.confirmation, principal: input.principal });
}

export function confirmCommerceCheckoutAction(input: {
  readonly boundary: CommerceCheckoutCommandBoundary;
  readonly actionName: string;
  readonly context: unknown;
  readonly principal: CommandPrincipal;
}): ActionOutcome<CommerceCheckoutArtifact> {
  return input.boundary.confirm({ message: { action: { name: input.actionName, context: input.context } } }, input.principal);
}
