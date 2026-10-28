import {
  cloneTaskState,
  type AssistantTask,
  type AssistantTaskState,
  type AssistantThreadState,
  type AssistantTurnSurface,
} from "./assistant-state.js";
import { PENDING_ACTION_STAGE } from "./assistant-stage-handler.js";

/** Fallback copy for a projected operation whose handler gave no message of its own (the platform's generic wording). */
export const GENERIC_PROJECTED_OPERATION_FALLBACK = "The requested information is ready below.";

/** The sentinel key for "none": no open proposal, no card, no replaced notice. */
const NONE = null;

/** The key of an optional item (its id), or `NONE`. An absent (undefined) and a null item share the same key. */
function keyOf(item: { readonly id: string } | null | undefined): string | null {
  return item ? item.id : NONE;
}

/**
 * Issue 04: the candidate thread state of one turn or one confirmed action (ADR 0070). Every mutation made while the turn runs
 * goes to this object, and the thread is unchanged until `commit` is called. Rollback is simply not committing.
 *
 * The transaction holds no domain logic. Stage handlers and the runtime place and supersede surfaces through it, and the
 * commit sites choose which parts of the candidate reach the thread, as each path did before this type existed.
 */
export class TurnTransaction {
  /** The candidate task state of the active task. */
  taskState: AssistantTaskState;
  activeTaskId: string;
  /** Candidate task list (copies of the thread's tasks, so a rollback leaves the thread's list alone). */
  tasks: AssistantTask[];
  activeSurfaces: Map<string, string>;
  supersededSurfaces: Set<string>;
  lastSurfaces: readonly AssistantTurnSurface[];
  /** Surfaces produced by this turn, in order. */
  readonly surfaces: AssistantTurnSurface[] = [];
  discoveryArtifactId: string | null;
  discoveryArtifact: unknown;
  /** The fallback copy for a turn whose operation succeeded but whose reply failed: the first surface's, or the generic copy. */
  fallbackMessage: string = GENERIC_PROJECTED_OPERATION_FALLBACK;
  /**
   * Issue 06 (ADR 0070): the open proposal and its card as the thread held them when this candidate was taken. A commit compares
   * against them to tell a change this run made (a clear, an execution, a new proposal) from a copy it only carried over.
   */
  readonly #basePendingId: string | null;
  readonly #basePendingSurface: string | null;
  readonly #baseReplacedId: string | null;

  constructor(thread: AssistantThreadState) {
    this.taskState = cloneTaskState(thread.taskState);
    this.activeTaskId = thread.activeTaskId;
    this.tasks = thread.tasks.map((task) => ({ ...task }));
    this.activeSurfaces = new Map<string, string>(thread.activeSurfaces);
    this.supersededSurfaces = new Set<string>(thread.supersededSurfaces);
    this.lastSurfaces = thread.lastSurfaces;
    this.discoveryArtifactId = thread.discoveryArtifactId;
    this.discoveryArtifact = thread.discoveryArtifact;
    // Each base is the value the run started from, as a key, with `NONE` (null) for "no proposal", "no card" or "no notice". An
    // absent field (undefined) and a null field are the same "none", so every comparison below is symmetric.
    this.#basePendingId = keyOf(thread.taskState.pendingAction);
    this.#basePendingSurface = thread.activeSurfaces.get(PENDING_ACTION_STAGE) ?? NONE;
    this.#baseReplacedId = keyOf(thread.taskState.replacedPendingAction);
  }

  /** Retires the active surface of a stage (it becomes superseded and cannot authorise actions). Does nothing if the stage has none. */
  supersede(stage: string): void {
    const surfaceId = this.activeSurfaces.get(stage);
    if (surfaceId) {
      this.supersededSurfaces.add(surfaceId);
      this.activeSurfaces.delete(stage);
    }
  }

  /** Makes a surface the active one for its stage. */
  place(stage: string, surfaceId: string): void {
    this.activeSurfaces.set(stage, surfaceId);
  }

  /** Clears the candidate's open proposal. The surface is retired separately, with `supersede`. */
  clearPendingAction(): void {
    this.taskState.pendingAction = null;
  }

  /** Records a surface produced by this turn. The first surface sets the turn's fallback copy. */
  addSurface(surface: AssistantTurnSurface, fallbackMessage?: string): void {
    if (this.surfaces.length === 0) this.fallbackMessage = fallbackMessage ?? GENERIC_PROJECTED_OPERATION_FALLBACK;
    this.surfaces.push(surface);
  }

  /**
   * Writes the candidate to the thread. Each flag names one part a commit site changes; a site that did not change a part leaves
   * it alone, as before. The active task's stored copy is mirrored last (`syncActiveTask`).
   */
  commit(thread: AssistantThreadState, parts: {
    readonly state: boolean;
    readonly tasks: boolean;
    readonly discovery: boolean;
    readonly lastSurfaces: readonly AssistantTurnSurface[];
  }): void {
    // Issue 06 (ADR 0070): a delta, not a whole-clone overwrite. The open proposal, its card and its replaced notice are owned by
    // whichever run changed them last. A candidate that still holds the proposal this run started with only carried it over, so
    // the thread's current value wins. A stale clone therefore cannot restore a proposal that was executed or cleared meanwhile.
    // Symmetric (issue 06 follow-up): a field is written only when this run changed it AND the thread still holds the value the
    // run started from. A field this run did not change keeps the thread's current value, so a candidate that never had a proposal
    // cannot erase one another run opened. A field this run changed is written only over the base value, so a clear cannot erase a
    // different proposal another run opened, and an executed clear stays cleared.
    // Each field follows one rule, with `NONE` on both sides: take the thread's value unless this run changed the field AND the
    // thread still holds the run's base value. Then the candidate's change is written over the base, and nothing else is.
    if (parts.state) {
      const threadPending = thread.taskState.pendingAction ?? null;
      if (keyOf(this.taskState.pendingAction) === this.#basePendingId || keyOf(threadPending) !== this.#basePendingId) {
        this.taskState.pendingAction = threadPending;
      }
      const threadReplaced = thread.taskState.replacedPendingAction ?? null;
      if (keyOf(this.taskState.replacedPendingAction) === this.#baseReplacedId || keyOf(threadReplaced) !== this.#baseReplacedId) {
        this.taskState.replacedPendingAction = threadReplaced;
      }
      thread.taskState = this.taskState;
    }
    if (parts.tasks) {
      thread.tasks = this.tasks;
      thread.activeTaskId = this.activeTaskId;
    }
    const candidateCard = this.activeSurfaces.get(PENDING_ACTION_STAGE) ?? NONE;
    const currentCard = thread.activeSurfaces.get(PENDING_ACTION_STAGE) ?? NONE;
    if (candidateCard === this.#basePendingSurface || currentCard !== this.#basePendingSurface) {
      if (currentCard === NONE) this.activeSurfaces.delete(PENDING_ACTION_STAGE);
      else this.activeSurfaces.set(PENDING_ACTION_STAGE, currentCard);
    }
    // A superseded surface stays superseded: a stale candidate cannot make a retired card authoritative again.
    for (const surfaceId of thread.supersededSurfaces) this.supersededSurfaces.add(surfaceId);
    thread.activeSurfaces = this.activeSurfaces;
    thread.supersededSurfaces = this.supersededSurfaces;
    thread.lastSurfaces = parts.lastSurfaces;
    if (parts.discovery) {
      thread.discoveryArtifactId = this.discoveryArtifactId;
      thread.discoveryArtifact = this.discoveryArtifact;
    }
    syncActiveTask(thread);
  }
}

/** Mirrors the thread's active workspace back onto the active task object. */
export function syncActiveTask(thread: AssistantThreadState): void {
  const active = thread.tasks.find((task) => task.taskId === thread.activeTaskId);
  if (!active) return;
  active.state = thread.taskState;
  active.activeSurfaces = thread.activeSurfaces;
  active.supersededSurfaces = thread.supersededSurfaces;
  active.lastSurfaces = thread.lastSurfaces;
}
