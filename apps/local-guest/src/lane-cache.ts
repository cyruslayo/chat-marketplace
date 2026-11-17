/**
 * Issue 03i (ADR 0107 decision 11, analysis 5.5 and 11.5): the client's in-memory lane cache and scroll memory.
 *
 * Pure and node-importable: no DOM, no browser storage. The client keeps the lane's DOM (the handle) here and the server's last
 * timeline for it. The cache never authorises anything. A switch always sends `platform.task.switch` (ADR 0107 decision 2), and the
 * server response decides which lane is active; a cached lane is only shown while the server's task list still names it.
 */

/** The owner's cap (decision 1, 17 Nov 2026): visited lanes kept live in memory, the visible lane included. */
export const LANE_CACHE_LIMIT = 4;

/** Where a switch came from. Only the switcher (rail, strip or sheet) moves focus; a chip or the server does not. */
export type SwitchOrigin = "switcher" | "chip" | "server";

/** One guest-visible timeline row, as the server returned it. Only role and text are compared. */
export interface LaneRow {
  readonly role: string;
  readonly text: string;
}

interface CachedLane<H> {
  handle: H;
  /** The server's rows for this lane as last returned (never the locally appended DOM text). */
  rows: readonly LaneRow[];
  /** The transcript scroll position the guest left this lane at. */
  scrollTop: number;
}

/** Stores lanes in least-recently-used order. A lane read or written is the most recently used. */
export class LaneCache<H> {
  readonly #limit: number;
  #threadId: string;
  readonly #lanes = new Map<string, CachedLane<H>>();

  constructor(threadId: string, limit: number = LANE_CACHE_LIMIT) {
    this.#threadId = threadId;
    this.#limit = limit;
  }

  get size(): number {
    return this.#lanes.size;
  }

  get threadId(): string {
    return this.#threadId;
  }

  has(taskId: string): boolean {
    return this.#lanes.has(taskId);
  }

  /** Reads a lane and makes it the most recently used. */
  get(taskId: string): CachedLane<H> | undefined {
    const lane = this.#lanes.get(taskId);
    if (lane === undefined) return undefined;
    this.#lanes.delete(taskId);
    this.#lanes.set(taskId, lane);
    return lane;
  }

  /** Reads a lane without changing its order. */
  peek(taskId: string): CachedLane<H> | undefined {
    return this.#lanes.get(taskId);
  }

  /** Adds a lane as the most recently used. Returns the handles dropped to stay within the cap (least recently used first). */
  put(taskId: string, handle: H, rows: readonly LaneRow[] = [], scrollTop = 0): H[] {
    this.#lanes.delete(taskId);
    this.#lanes.set(taskId, { handle, rows, scrollTop });
    const evicted: H[] = [];
    while (this.#lanes.size > this.#limit) {
      const oldest = this.#lanes.keys().next().value;
      if (oldest === undefined) break;
      const lane = this.#lanes.get(oldest);
      this.#lanes.delete(oldest);
      if (lane !== undefined) evicted.push(lane.handle);
    }
    return evicted;
  }

  /** Records the server's rows and/or the scroll position for a cached lane. Does not change the order. */
  remember(taskId: string, patch: { readonly rows?: readonly LaneRow[]; readonly scrollTop?: number }): void {
    const lane = this.#lanes.get(taskId);
    if (lane === undefined) return;
    if (patch.rows !== undefined) lane.rows = patch.rows;
    if (patch.scrollTop !== undefined) lane.scrollTop = patch.scrollTop;
  }

  /** Drops every lane whose task the server no longer lists (fail closed). Returns the dropped handles. */
  retain(serverTaskIds: readonly string[]): H[] {
    const dropped: H[] = [];
    for (const [taskId, lane] of [...this.#lanes]) {
      if (serverTaskIds.includes(taskId)) continue;
      this.#lanes.delete(taskId);
      dropped.push(lane.handle);
    }
    return dropped;
  }

  /** Clears the cache when the thread id changes. Returns every handle dropped (empty when the thread is the same). */
  bindThread(threadId: string): H[] {
    if (threadId === this.#threadId) return [];
    this.#threadId = threadId;
    const dropped = [...this.#lanes.values()].map((lane) => lane.handle);
    this.#lanes.clear();
    return dropped;
  }

  /** The task ids, least recently used first. */
  order(): string[] {
    return [...this.#lanes.keys()];
  }
}

/** What the client does for one switch. The server's response is applied after it, and it wins. */
export interface SwitchPlan {
  /** `cached`: show the remembered lane now. `fresh`: show an empty lane until the server's timeline arrives. `none`: show nothing. */
  readonly show: "cached" | "fresh" | "none";
  /** Always true: the switch event goes to the server, which owns the active task. */
  readonly sendEvent: boolean;
  /** A lane switch replaces the history entry (ADR 0107 decision 11). */
  readonly history: "replace";
  /** The lane heading takes focus only after a switch from the switcher. */
  readonly focus: "lane-heading" | "keep";
  /** The remembered scroll position of a cached lane. */
  readonly scrollTop?: number;
  readonly scroll: "restore" | "none";
  /** Reduced motion: no smooth scrolling. */
  readonly scrollBehavior: "instant" | "auto";
}

export interface SwitchRequest {
  readonly target: string;
  /** The task ids of the server's latest task list (the authority). */
  readonly serverTaskIds: readonly string[];
  readonly origin: SwitchOrigin;
  readonly reducedMotion: boolean;
}

/** Plans a switch from the cache, the server's task list and the switch's origin. Reads the cache without changing its order. */
export function planSwitch<H>(cache: LaneCache<H>, request: SwitchRequest): SwitchPlan {
  const listed = request.serverTaskIds.includes(request.target);
  const cached = listed ? cache.peek(request.target) : undefined;
  const base = {
    sendEvent: true,
    history: "replace",
    focus: request.origin === "switcher" ? "lane-heading" : "keep",
    scrollBehavior: request.reducedMotion ? "instant" : "auto",
  } as const;
  if (!listed) return { ...base, show: "none", scroll: "none" };
  if (cached === undefined) return { ...base, show: "fresh", scroll: "none" };
  return { ...base, show: "cached", scroll: "restore", scrollTop: cached.scrollTop };
}

/** Two timelines are the same when every row has the same role and text, in order. */
export function timelinesEqual(a: readonly LaneRow[], b: readonly LaneRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => row.role === b[index]?.role && row.text === b[index]?.text);
}

/**
 * Owner decision (17 Nov 2026): after a switch, a lane whose server-sourced lines are unchanged is kept as rendered, so the guest's own
 * lines stay. The guest's lines are not part of the server timeline and are ignored here. Any other difference is a mismatch, and the
 * server wins. Nothing is stored for this comparison.
 */
export function serverRowsMatch(cachedServerRows: readonly LaneRow[], serverRows: readonly LaneRow[]): boolean {
  return timelinesEqual(serverSourced(cachedServerRows), serverSourced(serverRows));
}

function serverSourced(rows: readonly LaneRow[]): readonly LaneRow[] {
  return rows.filter((row) => row.role !== "user");
}
