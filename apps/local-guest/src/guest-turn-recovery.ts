/**
 * Decides whether a concierge turn that the browser stopped waiting for has reached the thread (idempotent retry, ADR 0106).
 * The server appends the guest's message to the timeline only when the turn is accepted, so the latest user entry tells
 * whether this turn landed. An earlier identical message never counts, because only the latest user entry is compared.
 */

export interface RecoveryTimelineEntry {
  readonly role: string;
  readonly text: string;
}

/**
 * The timeline entries after the guest's message when that message is the thread's latest user entry; undefined when it
 * is not, so the caller keeps the Retry choice. An empty array means the message landed with no reply yet.
 */
export function turnEntriesSince<Entry extends RecoveryTimelineEntry>(timeline: readonly Entry[], text: string): readonly Entry[] | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (entry?.role === "user") return entry.text === text ? timeline.slice(index + 1) : undefined;
  }
  return undefined;
}
