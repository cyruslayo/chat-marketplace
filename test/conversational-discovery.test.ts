import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { A2UIServerMessage } from "@weaver/core";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import {
  startLocalGuestServer,
  type GuestSurfacePayload,
  type GuestTurnResult,
  type GuestTurnSuccess,
} from "../apps/local-guest/src/guest-server.js";
import {
  extractStayRequestFacts,
  mergeStayRequestContext,
  resolveStayRequestContext,
  type DiscoverySearchContext,
} from "../apps/local-guest/src/concierge.js";
import { restartFixture } from "./helpers/guest-restart.js";

const DEMO_CHECK_IN = "2026-09-10";
const FIXTURE_NOW = new Date("2026-09-03T10:00:00Z");

interface RecordedFilters {
  readonly location?: string;
  readonly neighbourhood?: string;
  readonly checkIn?: string;
  readonly checkOut?: string;
  readonly partySize?: number;
  readonly bedrooms?: number;
}

interface ConversationServer {
  readonly environment: LocalGuestEnvironment;
  readonly base: string;
  turn(threadId: string, text: string): Promise<GuestTurnResult>;
  turnWith(
    cookie: string,
    threadId: string,
    text: string,
  ): Promise<{ readonly status: number; readonly body: GuestTurnResult }>;
  issueCookie(): Promise<string>;
  stateWith(
    cookie: string,
    threadId: string,
  ): Promise<{
    readonly status: number;
    readonly body: { readonly surfaces?: readonly unknown[] };
  }>;
  close(): Promise<void>;
}

function newThreadId(): string {
  return `g-${crypto.randomUUID()}`;
}

function expectSuccess(
  result: GuestTurnResult,
  hint: string,
): GuestTurnSuccess {
  assert.equal(result.ok, true, `${hint}: ${JSON.stringify(result)}`);
  return result as GuestTurnSuccess;
}

function recordedSearches(
  environment: LocalGuestEnvironment,
): RecordedFilters[] {
  return environment.audit
    .entries()
    .filter((entry) => entry.type === "unit.search")
    .map((entry) => entry.filters as RecordedFilters);
}

function renderedUnitIds(surface: GuestSurfacePayload): string[] {
  const ids: string[] = [];
  for (const message of surface.a2uiMessages as readonly A2UIServerMessage[]) {
    if (!("updateComponents" in message)) continue;
    for (const component of message.updateComponents.components as readonly {
      readonly component?: string;
      readonly action?: {
        readonly event?: {
          readonly name?: string;
          readonly context?: Record<string, unknown>;
        };
      };
    }[]) {
      const event = component.action?.event;
      if (
        component.component !== "Button" ||
        event?.name !== "shortlet.discovery.view-unit"
      )
        continue;
      const unitId = event.context?.unitId;
      if (typeof unitId === "string") ids.push(unitId);
    }
  }
  return ids;
}

function firstEvent(surface: GuestSurfacePayload): {
  readonly name: string;
  readonly context: unknown;
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  readonly timestamp: string;
} {
  for (const message of surface.a2uiMessages as readonly A2UIServerMessage[]) {
    if (!("updateComponents" in message)) continue;
    for (const component of message.updateComponents.components as readonly {
      readonly component?: string;
      readonly action?: {
        readonly event?: { readonly name?: string; readonly context?: unknown };
      };
    }[]) {
      const event = component.action?.event;
      if (component.component === "Button" && event?.name && event.context) {
        return {
          name: event.name,
          context: event.context,
          surfaceId: surface.surfaceId,
          sourceComponentId: "conversation-test",
          timestamp: new Date().toISOString(),
        };
      }
    }
  }
  throw new Error("expected a generated action");
}

async function startConversation(
  options: { readonly sessionScoped?: boolean } = {},
): Promise<ConversationServer> {
  const directory = mkdtempSync(join(tmpdir(), "guest-conversation-"));
  const databasePath = join(directory, "guest.sqlite");
  const environment = new LocalGuestEnvironment({ databasePath });
  const server = startLocalGuestServer({
    port: 0,
    environment,
    sessionScopedGuestPrincipals: options.sessionScoped === true,
  });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const issueCookie = async (): Promise<string> => {
    const response = await fetch(base);
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    await response.text();
    return cookie;
  };
  const cookie = await issueCookie();
  const turnWith = async (
    credential: string,
    threadId: string,
    text: string,
  ): Promise<{ readonly status: number; readonly body: GuestTurnResult }> => {
    const response = await fetch(`${base}/api/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: credential },
      body: JSON.stringify({ threadId, text }),
    });
    return {
      status: response.status,
      body: (await response.json()) as GuestTurnResult,
    };
  };
  return {
    environment,
    base,
    turn: async (threadId, text) =>
      (await turnWith(cookie, threadId, text)).body,
    turnWith,
    issueCookie,
    stateWith: async (credential, threadId) => {
      const response = await fetch(
        `${base}/api/state?threadId=${encodeURIComponent(threadId)}`,
        { headers: { cookie: credential } },
      );
      return {
        status: response.status,
        body: (await response.json()) as { surfaces?: readonly unknown[] },
      };
    },
    close: async () => {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function converse(...messages: readonly string[]): DiscoverySearchContext {
  let context: DiscoverySearchContext | null = null;
  for (const message of messages) {
    context = mergeStayRequestContext(
      context,
      extractStayRequestFacts(message, { now: FIXTURE_NOW }),
      message,
    ).context;
  }
  return context ?? {};
}

// ---------------------------------------------------------------------------
// Pure merge/resolve semantics: the accumulated context is server-owned state.
// ---------------------------------------------------------------------------

test("AC1 — A city supplied on one turn persists to the next turn", () => {
  const first = mergeStayRequestContext(null, extractStayRequestFacts("Lagos"));
  assert.equal(first.context.city, "Lagos");
  const second = mergeStayRequestContext(
    first.context,
    extractStayRequestFacts("2 nights from 10 Sept and 2 guests"),
  );
  assert.equal(second.context.city, "Lagos");
});

test("AC2 — Night count supplied on one turn persists", () => {
  const context = converse("Lagos", "2 nights from 10 Sept and 2 guests", "Lekki");
  assert.equal(context.nights, 2);
});

test("AC3 — Guest count supplied on one turn persists", () => {
  const context = converse("Lagos", "2 nights from 10 Sept and 2 guests", "Lekki");
  assert.equal(context.partySize, 2);
});

test("AC4 — Neighbourhood supplied later completes the existing search", () => {
  const context = converse("Lagos", "2 nights from 10 Sept and 2 guests", "Lekki");
  assert.equal(context.city, "Lagos");
  assert.equal(context.neighbourhood, "Lekki Phase 1");
  assert.deepEqual(
    resolveStayRequestContext(context, { now: FIXTURE_NOW }),
    {
      kind: "search",
      filters: {
        location: "Lagos",
        neighbourhood: "Lekki Phase 1",
        checkIn: DEMO_CHECK_IN,
        checkOut: "2026-09-12",
        partySize: 2,
      },
    },
  );
});

test("Natural partial turn orders accumulate when their meaning is unambiguous", () => {
  const sequenceB = converse("Lekki", "2 nights", "2 guests");
  assert.deepEqual(sequenceB, {
    city: "Lagos",
    neighbourhood: "Lekki Phase 1",
    nights: 2,
    partySize: 2,
  });
  const sequenceC = converse("2 guests", "Lagos", "2 nights", "Ikoyi");
  assert.deepEqual(sequenceC, {
    city: "Lagos",
    neighbourhood: "Old Ikoyi",
    nights: 2,
    partySize: 2,
  });
});

test("AC8 — Changing neighbourhood preserves duration and guest count", () => {
  const context = converse("Lagos", "2 nights from 10 Sept and 2 guests", "Lekki");
  const changed = mergeStayRequestContext(
    context,
    extractStayRequestFacts("Ikoyi"),
  );
  assert.equal(changed.context.neighbourhood, "Old Ikoyi");
  assert.equal(changed.context.nights, 2);
  assert.equal(changed.context.partySize, 2);
});

test("AC9 — Changing duration preserves location and guest count", () => {
  const context = converse("Lagos", "2 nights from 10 Sept and 2 guests", "Lekki");
  const corrected = mergeStayRequestContext(
    context,
    extractStayRequestFacts("Actually make it 3 nights."),
  );
  assert.equal(corrected.context.city, "Lagos");
  assert.equal(corrected.context.neighbourhood, "Lekki Phase 1");
  assert.equal(corrected.context.partySize, 2);
  assert.equal(corrected.context.nights, 3);
});

test("AC10/AC11 — A conflicting location is held, never silently applied", () => {
  const context = converse("Lagos", "2 nights from 10 Sept and 2 guests");
  const merged = mergeStayRequestContext(
    context,
    extractStayRequestFacts("Wuse"),
  );
  assert.ok(merged.conflict);
  assert.equal(merged.context.city, "Lagos");
  assert.equal(merged.context.nights, 2);
  assert.equal(merged.context.partySize, 2);
  assert.equal(merged.context.pendingLocationChange?.city, "Abuja");
  assert.match(
    merged.conflict.question,
    /Do you want Wuse in Abuja, or should I keep searching in Lagos\?/,
  );
});

test("AC10/AC11 — Confirming the pending location preserves unrelated fields", () => {
  const conflict = mergeStayRequestContext(
    converse("Lagos", "2 nights from 10 Sept and 2 guests"),
    extractStayRequestFacts("Wuse"),
  );
  const confirmed = mergeStayRequestContext(
    conflict.context,
    extractStayRequestFacts("Abuja"),
    "Abuja",
  );
  assert.equal(confirmed.conflict, undefined);
  assert.deepEqual(confirmed.context, {
    city: "Abuja",
    nights: 2,
    partySize: 2,
    checkIn: "2026-09-10",
    datesConfirmed: true,
  });
});

test("AC10/AC11 — Keeping the established city preserves unrelated fields", () => {
  const conflict = mergeStayRequestContext(
    converse("Lagos", "2 nights from 10 Sept and 2 guests"),
    extractStayRequestFacts("Wuse"),
  );
  const kept = mergeStayRequestContext(
    conflict.context,
    extractStayRequestFacts("keep Lagos"),
    "keep Lagos",
  );
  assert.equal(kept.conflict, undefined);
  assert.deepEqual(kept.context, { city: "Lagos", nights: 2, partySize: 2, checkIn: "2026-09-10", datesConfirmed: true });
});

test("AC16 — The parser never produces apartment facts", () => {
  for (const message of [
    "Lagos",
    "2 nights from 10 Sept and 2 guests",
    "Lekki",
    "Only show two bedrooms.",
    "Wuse",
  ]) {
    const keys = Object.keys(extractStayRequestFacts(message)).sort();
    assert.ok(
      keys.every((key) =>
        ["bedrooms", "location", "nights", "partySize"].includes(key),
      ),
      `${message}: ${keys.join(",")}`,
    );
  }
  assert.deepEqual(Object.keys(extractStayRequestFacts("Lekki")).sort(), [
    "location",
  ]);
});

// ---------------------------------------------------------------------------
// End-to-end deterministic conversation through the real Guest application.
// ---------------------------------------------------------------------------

test("AC5/AC6/AC17 — Lagos → 2 nights from 10 Sept and 2 guests → Lekki executes an authoritative discovery surface", async () => {
  const conversation = await startConversation();
  try {
    const threadId = newThreadId();
    const city = expectSuccess(
      await conversation.turn(threadId, "Lagos"),
      "Lagos turn",
    );
    assert.equal(
      city.surfaces.length,
      0,
      "an incomplete search must not render a surface",
    );
    assert.match(
      city.messages.join(" "),
      /how many nights you need and how many guests are staying/,
    );
    assert.doesNotMatch(city.messages.join(" "), /where you want to stay/);

    const stay = expectSuccess(
      await conversation.turn(threadId, "2 nights from 10 Sept and 2 guests"),
      "nights and guests turn",
    );
    assert.doesNotMatch(
      stay.messages.join(" "),
      /Could you tell me/,
      "known constraints are not requested again",
    );

    const results = expectSuccess(
      await conversation.turn(threadId, "Lekki"),
      "Lekki turn",
    );
    assert.equal(results.surfaces.length, 1);
    const surface = results.surfaces[0]!;
    assert.match(surface.surfaceId, /:discovery:results/);
    assert.equal(surface.mode, "inline-surface");

    // The authoritative discovery query received the complete accumulated context.
    const filters = recordedSearches(conversation.environment).at(-1)!;
    assert.deepEqual(filters, {
      location: "Lagos",
      neighbourhood: "Lekki Phase 1",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-12",
      partySize: 2,
    });

    // The rendered DiscoveryArtifact is exactly what the authoritative query returns.
    const authoritative =
      conversation.environment.discoveryQuery.search(filters);
    assert.deepEqual(
      authoritative.facts.results.map((unit) => unit.id),
      ["unit-lagos-lekki-002"],
    );
    assert.deepEqual(renderedUnitIds(surface), ["unit-lagos-lekki-002"]);
    assert.match(surface.textFallback ?? "", /Found 1 eligible apartment/);
  } finally {
    await conversation.close();
  }
});

test("AC7 — Known information is never requested again", async () => {
  const conversation = await startConversation();
  try {
    const threadId = newThreadId();
    const first = expectSuccess(
      await conversation.turn(threadId, "Lagos"),
      "Lagos",
    );
    assert.doesNotMatch(first.messages.join(" "), /where you want to stay/);
    const second = expectSuccess(
      await conversation.turn(threadId, "2 nights from 10 Sept"),
      "nights",
    );
    assert.doesNotMatch(second.messages.join(" "), /where you want to stay/);
    assert.doesNotMatch(second.messages.join(" "), /how many nights/);
    assert.match(second.messages.join(" "), /how many guests are staying/);
    const third = expectSuccess(
      await conversation.turn(threadId, "2 guests"),
      "guests",
    );
    assert.equal(third.surfaces.length, 1);
  } finally {
    await conversation.close();
  }
});

test("AC10/AC11 — Lagos → nights/guests → Wuse clarifies and keeps nights and guests", async () => {
  const conversation = await startConversation();
  try {
    const threadId = newThreadId();
    expectSuccess(await conversation.turn(threadId, "Lagos"), "Lagos");
    expectSuccess(
      await conversation.turn(threadId, "2 nights from 10 Sept and 2 guests"),
      "nights and guests",
    );
    const conflict = expectSuccess(
      await conversation.turn(threadId, "Wuse"),
      "Wuse",
    );
    assert.equal(conflict.surfaces.length, 0);
    const reply = conflict.messages.join(" ");
    assert.match(
      reply,
      /Do you want Wuse in Abuja, or should I keep searching in Lagos\?/,
    );
    assert.doesNotMatch(reply, /where you want to stay/);
    const searchesBeforeConflict = recordedSearches(
      conversation.environment,
    ).length;
    assert.equal(
      searchesBeforeConflict,
      1,
      "the sufficient Lagos search already ran",
    );
    expectSuccess(
      await conversation.turn(threadId, "hello"),
      "unrelated turn while conflict is open",
    );
    assert.equal(
      recordedSearches(conversation.environment).length,
      searchesBeforeConflict,
      "no search runs while the conflict is open",
    );

    const resolved = expectSuccess(
      await conversation.turn(threadId, "Abuja"),
      "Abuja confirmation",
    );
    assert.equal(resolved.surfaces.length, 1);
    assert.deepEqual(recordedSearches(conversation.environment).at(-1), {
      location: "Abuja",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-12",
      partySize: 2,
    });
  } finally {
    await conversation.close();
  }
});

test("AC10/AC11 — The Guest can keep the established city after a conflict", async () => {
  const conversation = await startConversation();
  try {
    const threadId = newThreadId();
    expectSuccess(await conversation.turn(threadId, "Lagos"), "Lagos");
    expectSuccess(
      await conversation.turn(threadId, "2 nights from 10 Sept and 2 guests"),
      "nights and guests",
    );
    expectSuccess(await conversation.turn(threadId, "Wuse"), "Wuse");
    const kept = expectSuccess(
      await conversation.turn(threadId, "keep Lagos"),
      "keep Lagos",
    );
    assert.equal(kept.surfaces.length, 1);
    assert.deepEqual(recordedSearches(conversation.environment).at(-1), {
      location: "Lagos",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-12",
      partySize: 2,
    });
  } finally {
    await conversation.close();
  }
});

test("AC8/AC9/AC12 — Corrections and refinements preserve the rest of the search", async () => {
  const conversation = await startConversation();
  try {
    const threadId = newThreadId();
    expectSuccess(await conversation.turn(threadId, "Lagos"), "Lagos");
    expectSuccess(
      await conversation.turn(threadId, "2 nights from 10 Sept and 2 guests"),
      "nights and guests",
    );
    const discovery = expectSuccess(
      await conversation.turn(threadId, "Lekki"),
      "Lekki",
    );
    assert.deepEqual(renderedUnitIds(discovery.surfaces[0]!), [
      "unit-lagos-lekki-002",
    ]);

    const corrected = expectSuccess(
      await conversation.turn(threadId, "Actually make it 3 nights."),
      "duration correction",
    );
    assert.equal(corrected.surfaces.length, 1);
    assert.deepEqual(recordedSearches(conversation.environment).at(-1), {
      location: "Lagos",
      neighbourhood: "Lekki Phase 1",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-13",
      partySize: 2,
    });

    const refined = expectSuccess(
      await conversation.turn(threadId, "Only show two bedrooms."),
      "bedroom refinement",
    );
    assert.equal(refined.surfaces.length, 1);
    assert.deepEqual(recordedSearches(conversation.environment).at(-1), {
      location: "Lagos",
      neighbourhood: "Lekki Phase 1",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-13",
      partySize: 2,
      bedrooms: 2,
    });
    assert.deepEqual(
      renderedUnitIds(refined.surfaces[0]!),
      [],
      "the 1-bedroom Lekki Unit is excluded by the refinement",
    );

    // Neighbourhood change after results preserves nights and guests.
    const moved = expectSuccess(
      await conversation.turn(threadId, "Ikoyi"),
      "neighbourhood change",
    );
    assert.deepEqual(recordedSearches(conversation.environment).at(-1), {
      location: "Lagos",
      neighbourhood: "Old Ikoyi",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-13",
      partySize: 2,
      bedrooms: 2,
    });
    assert.deepEqual(renderedUnitIds(moved.surfaces[0]!), [
      "unit-lagos-ikoyi-001",
    ]);
  } finally {
    await conversation.close();
  }
});

test("AC13 — Superseded result actions remain invalid", async () => {
  const conversation = await startConversation();
  try {
    const threadId = newThreadId();
    expectSuccess(await conversation.turn(threadId, "Lagos"), "Lagos");
    expectSuccess(
      await conversation.turn(threadId, "2 nights from 10 Sept and 2 guests"),
      "nights and guests",
    );
    const first = expectSuccess(
      await conversation.turn(threadId, "Lekki"),
      "Lekki",
    );
    const stale = firstEvent(first.surfaces[0]!);
    const refined = expectSuccess(
      await conversation.turn(threadId, "Only show two bedrooms."),
      "refinement",
    );
    assert.notEqual(
      refined.surfaces[0]!.surfaceId,
      first.surfaces[0]!.surfaceId,
    );

    const replay = await fetch(`${conversation.base}/api/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, ...stale }),
    });
    const body = (await replay.json()) as { ok: boolean; code?: string };
    assert.equal(body.ok, false);
    assert.equal(body.code, "STALE_SURFACE");
  } finally {
    await conversation.close();
  }
});

test("AC14 — Guest threads keep independent search context", async () => {
  const conversation = await startConversation();
  try {
    const threadA = newThreadId();
    const threadB = newThreadId();
    expectSuccess(await conversation.turn(threadA, "Lagos"), "A Lagos");
    expectSuccess(
      await conversation.turn(threadA, "2 nights from 10 Sept and 2 guests"),
      "A nights and guests",
    );
    // Thread B has no accumulated context; it must still be asked for a location.
    const b = expectSuccess(
      await conversation.turn(threadB, "2 guests"),
      "B guests",
    );
    assert.match(b.messages.join(" "), /where you want to stay/);
    assert.equal(b.surfaces.length, 0);
    const searchesAfterB = recordedSearches(conversation.environment).length;
    assert.equal(
      searchesAfterB,
      1,
      "Thread B must not inherit Thread A's search",
    );

    const a = expectSuccess(
      await conversation.turn(threadA, "Lekki"),
      "A Lekki",
    );
    assert.equal(a.surfaces.length, 1);
    assert.deepEqual(recordedSearches(conversation.environment).at(-1), {
      location: "Lagos",
      neighbourhood: "Lekki Phase 1",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-12",
      partySize: 2,
    });
    assert.equal(
      recordedSearches(conversation.environment).length,
      searchesAfterB + 1,
    );
  } finally {
    await conversation.close();
  }
});

test("AC14 — A different browser principal cannot read or drive another Guest thread", async () => {
  const conversation = await startConversation({ sessionScoped: true });
  try {
    const cookieB = await conversation.issueCookie();
    const threadA = newThreadId();
    expectSuccess(await conversation.turn(threadA, "Lagos"), "A Lagos");
    const crossState = await conversation.stateWith(cookieB, threadA);
    assert.deepEqual(crossState.body.surfaces ?? [], []);
    const crossTurn = await conversation.turnWith(cookieB, threadA, "Lekki");
    assert.equal(crossTurn.status, 401);
    assert.equal(crossTurn.body.ok, false);
  } finally {
    await conversation.close();
  }
});

test("AC15 — Restart preserves an incomplete conversational search context", async () => {
  const fixture = await restartFixture();
  try {
    const first = expectSuccess(
      await fixture.send("/api/turn", { text: "Lagos" }),
      "Lagos",
    );
    assert.equal(first.surfaces.length, 0);
    await fixture.restart();
    const second = expectSuccess(
      await fixture.send("/api/turn", { text: "2 nights from 10 Sept and 2 guests" }),
      "nights and guests",
    );
    assert.doesNotMatch(second.messages.join(" "), /where you want to stay/);
    assert.doesNotMatch(second.messages.join(" "), /Could you tell me/);
    await fixture.restart();
    const third = expectSuccess(
      await fixture.send("/api/turn", { text: "Lekki" }),
      "Lekki",
    );
    assert.equal(third.surfaces.length, 1);
    assert.deepEqual(recordedSearches(fixture.environment).at(-1), {
      location: "Lagos",
      neighbourhood: "Lekki Phase 1",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-12",
      partySize: 2,
    });
  } finally {
    await fixture.close();
  }
});

test("AC14/AC15 — Restart keeps two Guest threads' search contexts separate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "guest-conversation-restart-"));
  const databasePath = join(directory, "guest.sqlite");
  let environment = new LocalGuestEnvironment({ databasePath });
  let server = startLocalGuestServer({ port: 0, environment });
  let base = `http://127.0.0.1:${await server.listen()}`;
  const home = await fetch(base);
  const cookie = home.headers.get("set-cookie")?.split(";")[0] ?? "";
  await home.text();
  const turn = async (
    threadId: string,
    text: string,
  ): Promise<GuestTurnResult> => {
    const response = await fetch(`${base}/api/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ threadId, text }),
    });
    return (await response.json()) as GuestTurnResult;
  };
  try {
    const threadA = newThreadId();
    const threadB = newThreadId();
    expectSuccess(await turn(threadA, "Lagos"), "A Lagos");
    expectSuccess(await turn(threadB, "Abuja"), "B Abuja");

    // A fresh application instance over the same durable store, no shared memory.
    await server.close();
    environment = new LocalGuestEnvironment({ databasePath });
    server = startLocalGuestServer({ port: 0, environment });
    base = `http://127.0.0.1:${await server.listen()}`;
    await (await fetch(base, { headers: { cookie } })).text();

    expectSuccess(
      await turn(threadA, "2 nights from 10 Sept and 2 guests"),
      "A nights and guests",
    );
    expectSuccess(
      await turn(threadB, "2 nights from 10 Sept and 2 guests"),
      "B nights and guests",
    );
    expectSuccess(await turn(threadA, "Lekki"), "A Lekki");
    expectSuccess(await turn(threadB, "Wuse 2"), "B Wuse 2");

    const searches = recordedSearches(environment);
    assert.deepEqual(searches.at(-2), {
      location: "Lagos",
      neighbourhood: "Lekki Phase 1",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-12",
      partySize: 2,
    });
    assert.deepEqual(searches.at(-1), {
      location: "Abuja",
      neighbourhood: "Wuse 2",
      checkIn: DEMO_CHECK_IN,
      checkOut: "2026-09-12",
      partySize: 2,
    });
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
