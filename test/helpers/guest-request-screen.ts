import assert from "node:assert/strict";
import { restartFixture } from "./guest-restart.js";

export type RequestScreenState = "draft" | "review" | "sent" | "declined" | "expired";

export async function withRequestScreen<T>(state: RequestScreenState, run: (fixture: Awaited<ReturnType<typeof restartFixture>>, path: string) => Promise<T>, config: Parameters<typeof restartFixture>[0] = {}): Promise<T> {
  const fixture = await restartFixture(config);
  try {
    const result = await fixture.advance(state === "draft" ? "draft" : state === "review" ? "review" : "pending");
    const path = result.surfaces[0]?.conventionalRoute;
    assert.ok(path);
    if (state === "declined") fixture.environment.simulateOperatorDecline(result.surfaces[0]!.surfaceId.split(":").at(-1)!);
    if (state === "expired") fixture.setTime("2026-09-03T10:30:00Z");
    await fixture.state();
    return await run(fixture, path);
  } finally { await fixture.close(); }
}
