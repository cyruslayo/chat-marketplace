import {
  cloneTaskState,
  type AssistantTask,
  type AssistantTaskState,
  type AssistantThreadState,
  type AssistantTurnSurface,
} from "./assistant-state.js";

/** Fallback copy for a projected operation whose handler gave no message of its own (the platform's generic wording). */
export const GENERIC_PROJECTED_OPERATION_FALLBACK = "The requested information is ready below.";

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

  constructor(thread: AssistantThreadState) {
    this.taskState = cloneTaskState(thread.taskState);
    this.activeTaskId = thread.activeTaskId;
    this.tasks = thread.tasks.map((task) => ({ ...task }));
    this.activeSurfaces = new Map<string, string>(thread.activeSurfaces);
    this.supersededSurfaces = new Set<string>(thread.supersededSurfaces);
    this.lastSurfaces = thread.lastSurfaces;
    this.discoveryArtifactId = thread.discoveryArtifactId;
    this.discoveryArtifact = thread.discoveryArtifact;
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
    if (parts.state) thread.taskState = this.taskState;
    if (parts.tasks) {
      thread.tasks = this.tasks;
      thread.activeTaskId = this.activeTaskId;
    }
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
