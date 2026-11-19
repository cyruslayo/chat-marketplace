/**
 * Weaver catalogues issue 02 AC1 probe: walks the guest journey from discovery to confirmation (as
 * shortlet-catalog-validation AC3 does) and prints every surface's A2UI messages as JSON, with per-run ids blanked, so the
 * output before and after the producer refactor can be diffed byte for byte.
 * Usage: npx tsx .scratch/weaver-catalogues/dump-journey-messages.ts > out.json
 */
import { guestAction, restartFixture, stages } from "../../test/helpers/guest-restart.js";

const fixture = await restartFixture();
const out: { stage: string; surfaceId: string; messages: unknown }[] = [];
try {
  const first = await fixture.app.handleTurn(fixture.threadId, "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
  if (!first.ok) throw new Error("search failed");
  let result = first;
  const record = (stage: string) => { for (const surface of result.surfaces) out.push({ stage, surfaceId: surface.surfaceId, messages: surface.a2uiMessages }); };
  record(stages[0]);
  for (const stage of stages.slice(1, stages.indexOf("confirmed") + 1)) {
    if (stage === "offer") {
      fixture.environment.simulateOperatorAcceptance(result.surfaces[0]!.surfaceId.split(":").at(-1)!);
      const snapshot = fixture.app.getState(fixture.threadId);
      if (!snapshot) throw new Error("no state");
      result = { ...result, messages: [], surfaces: snapshot.surfaces };
    } else {
      const next = await fixture.app.handleEventAsync(fixture.threadId, guestAction(result.surfaces[0]!));
      if (!next.ok) throw new Error(`${stage} failed`);
      result = next;
    }
    record(stage);
  }
} finally {
  await fixture.close();
}
process.stdout.write(`${JSON.stringify(out, null, 1)
  .replace(/g-[0-9a-f-]{36}/g, "g-THREAD")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "UUID")
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "TIME")
  .replace(/tok_[A-Za-z0-9._-]+/g, "TOKEN")
  .replace(/(chk|ctr)_cmd-[0-9a-f]+/g, "$1_cmd-ID")}\n`);
