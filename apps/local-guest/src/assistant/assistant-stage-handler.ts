import type { LocalGuestEnvironment } from "../fixture.js";
import type { AssistantDomainPack, AssistantToolExecutionResult } from "./assistant-platform.js";
import type { AssistantTurnSurface } from "./assistant-state.js";
import type { PendingAssistantAction } from "./pending-actions.js";
import type { TurnTransaction } from "./assistant-turn-transaction.js";

/**
 * Issue 04: one handler per stage behind a small shared interface (ADR 0099: packs supply their handlers; the runtime
 * calls them and owns the authority checks around them).
 *
 * The stage names a surface is filed under, and the rule a stage's surface follows when it is placed, are declared by the
 * handler that owns them. The runtime names no stage. `supersedes` lists the stages whose active surfaces the handler
 * retires; the handler applies that list itself (`retireOwnStages`) at the point its own behaviour requires, because some
 * handlers retire only when they actually place a surface.
 */

/** The platform's stage for the open confirmation card (ADR 0074). Platform-owned, so no pack can rename it. */
export const PENDING_ACTION_STAGE = "pending_action";

/**
 * Issue 06: thrown by a confirmation when the open proposal no longer fits the domain (for example its Unit was taken meanwhile).
 * The runtime reports it as `STALE_SURFACE` and drops the proposal. The runtime names no domain, so a pack throws this typed
 * error rather than a domain class. Any other throw is not a stale proposal and is never reported as one.
 */
export class AssistantStaleProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantStaleProposalError";
  }
}

/** One successful tool execution of the active pack, as the runtime hands it to the handlers. */
export interface StageToolExecution {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly execution: AssistantToolExecutionResult;
}

/** What a handler produced for a claimed execution. `surface` is absent when the claim placed nothing. */
export interface StageProjection {
  readonly surface?: AssistantTurnSurface;
  /** The reply copy if this surface is the one a failed turn falls back to (ADR 0079). */
  readonly fallbackMessage?: string;
}

/** The result of a confirmed pending action: the same shape `handleTurn` and `handleAssistantEvent` return. */
export type PendingActionOutcome =
  | { readonly ok: true; readonly message: string; readonly surfaces: readonly AssistantTurnSurface[] }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** The turn's view for a handler: the candidate transaction, the active pack, the environment and the stage marker. */
export interface StageTurnContext {
  readonly threadId: string;
  readonly tx: TurnTransaction;
  readonly pack: AssistantDomainPack;
  readonly environment: LocalGuestEnvironment;
  /** Moves the turn's diagnostic stage, so a failure is classified where it happened (`projection`, `a2ui`). */
  setStage(stage: "projection" | "a2ui"): void;
}

export interface AssistantStageHandler {
  /** The stage this handler files its surface under. */
  readonly stage: string;
  /** The stages whose active surfaces this handler retires, declared once here. */
  readonly supersedes: readonly string[];
  /** Claims an authoritative tool execution, or returns undefined when the execution is not this handler's. */
  project?(input: StageToolExecution, turn: StageTurnContext): StageProjection | undefined;
  /** The pending-action kind this handler confirms. */
  readonly confirms?: string;
  /** Executes a confirmed pending action of kind `confirms`. Runs only after the runtime's authority checks pass. */
  confirm?(action: PendingAssistantAction, turn: StageTurnContext): PendingActionOutcome;
}

/** Retires the stages a handler declares in `supersedes`. The handler calls this where its behaviour requires it. */
export function retireOwnStages(handler: AssistantStageHandler, turn: StageTurnContext): void {
  for (const stage of handler.supersedes) turn.tx.supersede(stage);
}
