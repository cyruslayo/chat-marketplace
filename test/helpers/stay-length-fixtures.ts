import { temporaryDatabasePath } from "./temporary-database.js";
import { LocalGuestApp } from "../../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { LIVE_LIKE_CLOCK } from "./guest-date-fixtures.js";

/** Issue 19 fixtures: a live-like deterministic app over a temporary store (clock 27 Oct 2026, Africa/Lagos). */
export async function withLiveApp(run: (app: LocalGuestApp, environment: LocalGuestEnvironment, threadId: string) => Promise<void>): Promise<void> {
  const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`stay-length-${crypto.randomUUID()}.sqlite`), clock: LIVE_LIKE_CLOCK });
  try { await run(new LocalGuestApp(environment), environment, `g-${crypto.randomUUID()}`); } finally { environment.close(); }
}

/** The filters of the thread's current discovery search, as the stored projection holds them (undefined when no search ran). */
export function searchedFilters(environment: LocalGuestEnvironment, threadId: string): { readonly checkIn?: unknown; readonly checkOut?: unknown } | undefined {
  const record = environment.interactionStore.findThread(threadId);
  if (!record) return undefined;
  const projection = JSON.parse(record.threadJson) as { readonly discoveryArtifact?: { readonly facts?: { readonly filters?: { readonly checkIn?: unknown; readonly checkOut?: unknown } } } | null };
  return projection.discoveryArtifact?.facts?.filters;
}
