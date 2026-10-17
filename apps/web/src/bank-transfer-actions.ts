import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveActionAsync } from "../../../packages/platform-core/src/index.js";
import { BANK_TRANSFER_ARTIFACT_KIND, BANK_TRANSFER_SCHEMA_VERSION, type BankTransferArtifact } from "./bank-transfer-artifact.js";
import type { BankTransferPaymentApplication } from "./bank-transfer-application.js";

export const BANK_TRANSFER_INITIALIZE_EVENT = "shortlet.bank-transfer.initialize";

type Context = {
  readonly artifactId: string;
  readonly offerId: string;
  readonly expectedStatus: string;
  readonly expectedPurpose?: string;
  readonly expectedJourneyVersion?: number;
  readonly expectedStage?: string;
  readonly depositPolicyVersion?: string;
  readonly projectionVersion: number;
};
export type BankTransferActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH" | "OFFER_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type BankTransferActionResult = { readonly ok: true; readonly artifact: BankTransferArtifact } | { readonly ok: false; readonly code: BankTransferActionRejectionCode; readonly message: string };

const STALE_MESSAGE = "The action is stale; refresh payment.";
const RUN_REJECTED_MESSAGE = "The payment action was rejected.";

/** The bank-transfer initialize action, declared for the platform gate (ADR 0072/0099). */
export function bankTransferInitializeSpec(application: BankTransferPaymentApplication): ActionSpec<Context, BankTransferArtifact, { readonly offerId: string }> {
  return {
    name: BANK_TRANSFER_INITIALIZE_EVENT,
    artifact: {
      kind: BANK_TRANSFER_ARTIFACT_KIND,
      schemaVersion: BANK_TRANSFER_SCHEMA_VERSION,
      load: (context, principal) => application.getArtifact(context.offerId, principal),
    },
    context: {
      required: {
        artifactId: { type: "string" },
        offerId: { type: "string" },
        expectedStatus: { type: "string" },
        projectionVersion: { type: "integer" },
      },
      optional: {
        expectedPurpose: { type: "string" },
        expectedJourneyVersion: { type: "number" },
        expectedStage: { type: "string" },
        depositPolicyVersion: { type: "string" },
      },
    },
    crossMatch: (context, artifact) =>
      context.artifactId !== artifact.id
        ? { code: "ARTIFACT_MISMATCH", message: "The action does not match the payment artifact." }
        : context.offerId !== artifact.facts.offerId
          ? { code: "OFFER_MISMATCH", message: "The action does not match the offer." }
          : true,
    expect: [
      { expected: (context) => context.expectedStatus, actual: (artifact) => artifact.facts.status },
      { expected: (context) => context.expectedPurpose, actual: (artifact) => artifact.actions[0]?.expectedPurpose ?? "stay" },
      { expected: (context) => context.expectedJourneyVersion, actual: (artifact) => artifact.facts.journeyVersion ?? 1 },
      { expected: (context) => context.expectedStage, actual: (artifact) => artifact.facts.journeyStage ?? artifact.facts.status },
      { expected: (context) => context.depositPolicyVersion, actual: (artifact) => artifact.facts.depositPolicyVersion ?? "" },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: (_context, artifact) => artifact.actions.some((action) => action.type === "initialize_transfer"),
    command: (context) => ({ commandName: "bank_transfer.initialize", payload: { offerId: context.offerId } }),
    run: async ({ context, principal, envelope }) => {
      await application.initializeTransferFromCommand(envelope!);
      return application.getArtifact(context.offerId, principal);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
  };
}

export async function resolveBankTransferServerEvent({ event, application, principal }: { readonly event: WebServerEventHandoff; readonly application: BankTransferPaymentApplication; readonly principal: CommandPrincipal }): Promise<BankTransferActionResult> {
  const outcome = await resolveActionAsync(event, [bankTransferInitializeSpec(application)], principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as BankTransferActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
