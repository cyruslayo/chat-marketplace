import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createBasicWebRuntime } from "@weaver/web";
import {
  startLocalGuestServer,
  type GuestTurnSuccess,
  type LocalGuestServerHandle,
} from "../apps/local-guest/src/guest-server.js";
import type { A2UIServerMessage, A2UIClientActionMessage } from "@weaver/core";

const CANONICAL_PROMPT = "I need an apartment in Ikoyi for 3 nights for 2 people";
const IKOYI_TITLE = "Luxury 2-Bedroom Apartment in Old Ikoyi";
const LEKKI_TITLE = "Serene 1-Bedroom Suite in Lekki Phase 1";
const ALL_IN_TOTAL_NGN = "₦370,000"; // 3 nights x ₦120,000 + ₦10,000 mandatory fees

function newThreadId(): string {
  return `g-${crypto.randomUUID()}`;
}

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

interface MountedSurface {
  readonly surfaceId: string;
  readonly target: Element;
}

interface BrowserHarness {
  readonly mounted: MountedSurface[];
  readonly events: A2UIClientActionMessage["action"][];
  mountSurface(surfaceId: string, a2uiMessages: readonly A2UIServerMessage[]): void;
  clickButton(target: Element, labelText: string, accessibleLabel?: string): boolean;
}

function createBrowserHarness(): BrowserHarness {
  const window = new Window();
  const mounted: { surfaceId: string; target: Element }[] = [];
  const events: A2UIClientActionMessage["action"][] = [];
  const created = createBasicWebRuntime({
    rendering: {
      onServerEvent: (event) => {
        events.push(event.message.action);
      },
    },
  });
  if (!created.ok) throw new Error("Weaver runtime failed to create");

  const asElement = (element: unknown): Element => element as Element;

  return {
    mounted,
    events,
    mountSurface(surfaceId: string, a2uiMessages: readonly A2UIServerMessage[]): void {
      const target = asElement(window.document.createElement("div"));
      for (const message of a2uiMessages) {
        const processed = created.value.runtime.process(message);
        assert.equal(processed.ok, true, `Weaver failed to process A2UI message for ${surfaceId}`);
      }
      const mountResult = created.value.mount({ surfaceId, target });
      assert.equal(mountResult.ok, true, `Weaver failed to mount surface ${surfaceId}`);
      mounted.push({ surfaceId, target });
    },
    clickButton(target: Element, labelText: string, accessibleLabel?: string): boolean {
      const buttons = [...target.querySelectorAll("button")];
      const button = accessibleLabel === undefined
        ? buttons.find((candidate) => candidate.textContent?.includes(labelText))
        : buttons.find((candidate) => {
          const card = candidate.closest('[data-a2ui-component="Card"]');
          return candidate.textContent?.includes(labelText) && card?.textContent?.includes(accessibleLabel.replace(/^View /, ""));
        });
      if (!button) return false;
      button.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
      return true;
    },
  };
}

function expectSuccess(body: any, hint: string): GuestTurnSuccess {
  assert.equal(body.ok, true, `${hint}: expected success, got ${JSON.stringify(body)}`);
  return body as GuestTurnSuccess;
}

function expectRejection(body: any, hint: string): { code: string } {
  assert.equal(body.ok, false, `${hint}: expected fail-closed rejection, got ${JSON.stringify(body)}`);
  return body as { ok: false; code: string };
}

function surfaceMessages(response: GuestTurnSuccess, surfaceIdSuffix: string): readonly A2UIServerMessage[] {
  const surface = response.surfaces.find((candidate) => candidate.surfaceId.endsWith(surfaceIdSuffix));
  assert.ok(surface, `expected a surface ending in ${surfaceIdSuffix}`);
  assert.ok(
    surface.a2uiMessages.some((message) => "createSurface" in message),
    "expected an A2UI createSurface message",
  );
  assert.ok(
    surface.a2uiMessages.some((message) => "updateComponents" in message),
    "expected an A2UI updateComponents message",
  );
  return surface.a2uiMessages;
}

interface JourneyServer {
  readonly server: LocalGuestServerHandle;
  readonly base: string;
  readonly harness: BrowserHarness;
  readonly threadId: string;
  relayEvents(): Promise<any[]>;
}

async function startJourneyServer(): Promise<JourneyServer> {
  const server = startLocalGuestServer({ port: 0 });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const harness = createBrowserHarness();
  const threadId = newThreadId();
  return {
    server,
    base,
    harness,
    threadId,
    async relayEvents(): Promise<any[]> {
      const collected = harness.events.splice(0, harness.events.length);
      const results: any[] = [];
      for (const action of collected) {
        const { body } = await postJson(base, "/api/event", { threadId, ...action });
        results.push(body);
      }
      return results;
    },
  };
}

function assertNoHandcodedCards(html: string): void {
  assert.equal(html.includes(IKOYI_TITLE), false, "server HTML must not hand-code apartment cards");
  assert.equal(html.includes(LEKKI_TITLE), false, "server HTML must not hand-code apartment cards");
  assert.equal(html.includes("₦"), false, "server HTML must not hand-code prices");
  assert.equal(html.includes("Conditional Booking Offer"), false, "server HTML must not hand-code offers");
}

test("Guest natural-language turn produces an authoritative discovery artifact rendered by Weaver", async () => {
  const journey = await startJourneyServer();
  try {
    const page = await fetch(`${journey.base}/`).then((response) => response.text());
    assert.ok(page.includes("Shortlet Concierge"));
    assert.ok(page.includes("Local demo"));
    assertNoHandcodedCards(page);

    const turn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: journey.threadId, text: CANONICAL_PROMPT })).body,
      "canonical prompt turn",
    );
    assert.ok(turn.surfaces.length >= 1);
    const discoverySurface = turn.surfaces[0]!;
    assert.match(discoverySurface.surfaceId, /:discovery:results$/);
    assert.ok(discoverySurface.surfaceId.startsWith(`thread-${journey.threadId}`));

    journey.harness.mountSurface(
      discoverySurface.surfaceId,
      discoverySurface.a2uiMessages as readonly A2UIServerMessage[],
    );
    const target = journey.harness.mounted[0]!.target;
    const rendered = target.textContent ?? "";
    assert.ok(rendered.includes("2 eligible Units found"), "rendered Weaver surface shows result summary");
    assert.ok(rendered.includes(IKOYI_TITLE), "rendered Weaver surface shows the Ikoyi unit card");
    assert.ok(rendered.includes(`All-In Stay Total: ${ALL_IN_TOTAL_NGN}`), "rendered surface shows all-in pricing");
    assert.ok(rendered.includes("Inspection: current"), "rendered surface shows trust information");
  } finally {
    await journey.server.close();
  }
});

test("Concierge asks for missing details when input cannot be safely interpreted", async () => {
  const journey = await startJourneyServer();
  try {
    const turn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: journey.threadId, text: "I need a place" })).body,
      "ambiguous prompt turn",
    );
    assert.equal(turn.surfaces.length, 0, "no surfaces for an uninterpretable request");
    assert.ok(turn.messages[0]!.includes("where you want to stay"));
  } finally {
    await journey.server.close();
  }
});

test("Weaver-generated View Unit action round-trips through the server and replaces or adds the next dynamic surface", async () => {
  const journey = await startJourneyServer();
  try {
    const turn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: journey.threadId, text: CANONICAL_PROMPT })).body,
      "turn",
    );
    journey.harness.mountSurface(turn.surfaces[0]!.surfaceId, turn.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[]);
    const discoveryTarget = journey.harness.mounted[0]!.target;

    assert.ok(
      journey.harness.clickButton(discoveryTarget, "View Unit", `View ${IKOYI_TITLE}`),
      "the generated discovery surface exposes a View Unit action",
    );
    assert.equal(journey.harness.events[0]?.context && (journey.harness.events[0].context as Record<string, unknown>).unitId, "unit-lagos-ikoyi-001");
    const [eventResponse] = await journey.relayEvents();
    const unitResponse = expectSuccess(eventResponse, "view-unit event");
    const unitSurface = unitResponse.surfaces[0]!;
    assert.match(unitSurface.surfaceId, /:unit:detail$/);

    journey.harness.mountSurface(unitSurface.surfaceId, unitSurface.a2uiMessages as readonly A2UIServerMessage[]);
    const unitTarget = journey.harness.mounted[1]!.target;
    const rendered = unitTarget.textContent ?? "";
    assert.ok(rendered.includes(IKOYI_TITLE));
    assert.ok(rendered.includes(`All-In Stay Total: ${ALL_IN_TOTAL_NGN}`));
    assert.ok(rendered.includes("Refundable Security Deposit: ₦50,000"));
    assert.ok(rendered.includes("Request to Book"), "unit detail exposes the Request to Book action");
  } finally {
    await journey.server.close();
  }
});

test("Guest booking request and local authorized Operator acceptance produce a guest Conditional Offer surface", async () => {
  const journey = await startJourneyServer();
  try {
    const turn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: journey.threadId, text: CANONICAL_PROMPT })).body,
      "turn",
    );
    journey.harness.mountSurface(turn.surfaces[0]!.surfaceId, turn.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[]);
    assert.ok(journey.harness.clickButton(journey.harness.mounted[0]!.target, "View Unit", `View ${IKOYI_TITLE}`));
    const [unitEvent] = await journey.relayEvents();
    const unitResponse = expectSuccess(unitEvent, "view-unit");
    journey.harness.mountSurface(unitResponse.surfaces[0]!.surfaceId, unitResponse.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[]);

    assert.ok(journey.harness.clickButton(journey.harness.mounted[1]!.target, "Request to Book"));
    const [requestEvent] = await journey.relayEvents();
    const requestResponse = expectSuccess(requestEvent, "request-to-book");
    assert.ok(
      requestResponse.messages.some((message: string) => message.includes("The host has accepted your request")),
      "operator simulation is announced conversationally",
    );

    const requestSurface = requestResponse.surfaces.find((surface: any) => surface.surfaceId.includes(":request:"))!;
    const offerSurface = requestResponse.surfaces.find((surface: any) => surface.surfaceId.includes(":offer:"))!;
    assert.ok(requestSurface && offerSurface, "booking request and offer surfaces are returned");

    journey.harness.mountSurface(requestSurface.surfaceId, requestSurface.a2uiMessages as readonly A2UIServerMessage[]);
    journey.harness.mountSurface(offerSurface.surfaceId, offerSurface.a2uiMessages as readonly A2UIServerMessage[]);
    const requestTarget = journey.harness.mounted[2]!.target;
    const offerTarget = journey.harness.mounted[3]!.target;

    const requestText = requestTarget.textContent ?? "";
    assert.ok(requestText.includes("Booking Request status: confirmed"), "request advanced through the real confirm path");
    const requestButtons = [...requestTarget.querySelectorAll("button")].map((button) => button.textContent ?? "");
    assert.equal(
      requestButtons.some((label) => label.includes("Confirm") || label.includes("Decline")),
      false,
      "guest-facing request surface must not expose Operator confirm/decline controls",
    );

    const offerText = offerTarget.textContent ?? "";
    assert.ok(offerText.includes("Conditional Booking Offer"));
    assert.ok(offerText.includes(`All-In Stay Total: ${ALL_IN_TOTAL_NGN}`));
    assert.ok(offerText.includes("Refundable Security Deposit: ₦50,000.00"));
    assert.ok(offerText.includes("Amount Due Now: ₦420,000.00"));
    assert.ok(offerText.includes("Cancellation:"));
    assert.ok(offerText.includes("Payment Window expires:"));
    assert.ok(
      [...offerTarget.querySelectorAll("button")].some((button) => button.textContent?.includes("Accept")),
      "guest offer exposes the generated Accept action",
    );
  } finally {
    await journey.server.close();
  }
});

test("Weaver-generated offer acceptance advances through the real application path without client-side authority", async () => {
  const journey = await startJourneyServer();
  try {
    // Drive to the offer stage.
    const turn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: journey.threadId, text: CANONICAL_PROMPT })).body,
      "turn",
    );
    journey.harness.mountSurface(turn.surfaces[0]!.surfaceId, turn.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[]);
    assert.ok(journey.harness.clickButton(journey.harness.mounted[0]!.target, "View Unit", `View ${IKOYI_TITLE}`));
    const [unitEvent] = await journey.relayEvents();
    const unitResponse = expectSuccess(unitEvent, "view-unit");
    journey.harness.mountSurface(unitResponse.surfaces[0]!.surfaceId, unitResponse.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[]);
    assert.ok(journey.harness.clickButton(journey.harness.mounted[1]!.target, "Request to Book"));
    const [requestEvent] = await journey.relayEvents();
    const requestResponse = expectSuccess(requestEvent, "request-to-book");
    const offerSurface = requestResponse.surfaces.find((surface: any) => surface.surfaceId.includes(":offer:"))!;
    journey.harness.mountSurface(offerSurface.surfaceId, offerSurface.a2uiMessages as readonly A2UIServerMessage[]);

    // Accept the offer through the generated action.
    const offerTarget = journey.harness.mounted[2]!.target;
    assert.ok(journey.harness.clickButton(offerTarget, "Accept"));
    const [acceptEvent] = await journey.relayEvents();
    const acceptResponse = expectSuccess(acceptEvent, "offer accept");
    const paymentSurface = acceptResponse.surfaces[0]!;
    assert.match(paymentSurface.surfaceId, /:payment:/);
    journey.harness.mountSurface(paymentSurface.surfaceId, paymentSurface.a2uiMessages as readonly A2UIServerMessage[]);
    const paymentTarget = journey.harness.mounted[3]!.target;
    const paymentText = paymentTarget.textContent ?? "";
    assert.ok(paymentText.includes("Payment status: ready"), "payment surface comes from the real CardPaymentApplication");
    assert.ok(
      [...paymentTarget.querySelectorAll("button")].some((button) => button.textContent?.includes("Start secure checkout")),
    );

    // Start the local deterministic checkout.
    assert.ok(journey.harness.clickButton(paymentTarget, "Start secure checkout"));
    const [checkoutEvent] = await journey.relayEvents();
    const checkoutResponse = expectSuccess(checkoutEvent, "card checkout");
    const confirmedPayment = checkoutResponse.surfaces.find((surface: any) => surface.surfaceId.includes(":payment:"));
    const bookingSurface = checkoutResponse.surfaces.find((surface: any) => surface.surfaceId.includes(":booking:"));
    assert.ok(confirmedPayment && bookingSurface, "confirmed payment and booking contract surfaces are returned");

    journey.harness.mountSurface(confirmedPayment.surfaceId, confirmedPayment.a2uiMessages as readonly A2UIServerMessage[]);
    journey.harness.mountSurface(bookingSurface.surfaceId, bookingSurface.a2uiMessages as readonly A2UIServerMessage[]);
    const confirmedText = journey.harness.mounted[4]!.target.textContent ?? "";
    const contractText = journey.harness.mounted[5]!.target.textContent ?? "";
    assert.ok(confirmedText.includes("Payment status: confirmed"));
    assert.ok(confirmedText.includes("Booking Contract: "), "confirmed payment shows the authoritative contract reference");
    assert.ok(contractText.includes("Booking confirmed"), "booking contract surface confirms the stay");
    assert.ok(contractText.includes(IKOYI_TITLE) || contractText.includes("unit-lagos-ikoyi-001"));
  } finally {
    await journey.server.close();
  }
});

test("Unknown or stale generated events fail closed", async () => {
  const journey = await startJourneyServer();
  try {
    const turn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: journey.threadId, text: CANONICAL_PROMPT })).body,
      "turn",
    );
    journey.harness.mountSurface(turn.surfaces[0]!.surfaceId, turn.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[]);
    assert.ok(journey.harness.clickButton(journey.harness.mounted[0]!.target, "View Unit", `View ${IKOYI_TITLE}`));
    const viewUnitAction = { ...journey.harness.events[0]! };
    const [viewUnitEvent] = await journey.relayEvents();

    // Unknown event names are rejected by the explicit allow-list.
    const unknown = await postJson(journey.base, "/api/event", {
      threadId: journey.threadId,
      name: "shortlet.evil.self-destruct",
      surfaceId: turn.surfaces[0]!.surfaceId,
      sourceComponentId: "test",
      timestamp: new Date().toISOString(),
      context: {},
    });
    expectRejection(unknown.body, "unknown event name");
    assert.equal(unknown.body.code, "UNSUPPORTED_EVENT");

    // A forged event on a surface the thread never issued fails closed.
    const forged = await postJson(journey.base, "/api/event", {
      threadId: journey.threadId,
      name: "shortlet.discovery.view-unit",
      surfaceId: "thread-g-forged:discovery:results",
      sourceComponentId: "test",
      timestamp: new Date().toISOString(),
      context: { artifactId: "anything", unitId: "unit-lagos-ikoyi-001" },
    });
    expectRejection(forged.body, "forged surface id");
    assert.equal(forged.body.code, "STALE_SURFACE");

    // An unlisted Unit ID inside a genuine surface event fails closed.
    const unlistedUnit = await postJson(journey.base, "/api/event", {
      threadId: journey.threadId,
      ...viewUnitAction,
      context: { artifactId: "search-guest-demo-001", unitId: "unit-not-in-results" },
    });
    expectRejection(unlistedUnit.body, "unlisted unit id");
    assert.equal(unlistedUnit.body.code, "ACTION_NOT_AUTHORIZED");

    // Replaying the already-consumed View Unit action against the superseded
    // unit-detail stage fails closed once the journey advances.
    const unitResponse = expectSuccess(viewUnitEvent, "view-unit");
    journey.harness.mountSurface(unitResponse.surfaces[0]!.surfaceId, unitResponse.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[]);
    assert.ok(journey.harness.clickButton(journey.harness.mounted[1]!.target, "Request to Book"));
    const [requestEvent] = await journey.relayEvents();
    expectSuccess(requestEvent, "request-to-book");

    const replayedViewUnit = await postJson(journey.base, "/api/event", {
      threadId: journey.threadId,
      name: "shortlet.discovery.view-unit",
      surfaceId: "thread-not-active",
      sourceComponentId: "test",
      timestamp: new Date().toISOString(),
      context: { artifactId: "search-guest-demo-001", unitId: "unit-lagos-ikoyi-001" },
    });
    expectRejection(replayedViewUnit.body, "stale surface after journey advanced");
  } finally {
    await journey.server.close();
  }
});

test("Guest demo reset restores deterministic discovery and booking state", async () => {
  const journey = await startJourneyServer();
  try {
    const firstTurn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: journey.threadId, text: CANONICAL_PROMPT })).body,
      "first turn",
    );
    const firstArtifactId = extractArtifactId(firstTurn);
    assert.equal(firstArtifactId, "search-guest-demo-001", "discovery artifact ids are deterministic");

    const reset = await postJson(journey.base, "/api/reset", {});
    assert.equal(reset.body.ok, true);

    // The pre-reset thread no longer exists: its events fail closed.
    const staleThread = await postJson(journey.base, "/api/event", {
      threadId: journey.threadId,
      name: "shortlet.discovery.view-unit",
      surfaceId: firstTurn.surfaces[0]!.surfaceId,
      sourceComponentId: "test",
      timestamp: new Date().toISOString(),
      context: {},
    });
    expectRejection(staleThread.body, "thread after reset");
    assert.equal(staleThread.body.code, "UNKNOWN_THREAD");

    // A fresh thread reaches the same deterministic discovery state.
    const freshThread = newThreadId();
    const secondTurn = expectSuccess(
      (await postJson(journey.base, "/api/turn", { threadId: freshThread, text: CANONICAL_PROMPT })).body,
      "post-reset turn",
    );
    assert.equal(extractArtifactId(secondTurn), "search-guest-demo-001", "reset restores deterministic discovery state");
    const rendered = (secondTurn.surfaces[0]!.a2uiMessages as readonly A2UIServerMessage[])
      .filter((message) => "updateComponents" in message)
      .flatMap((message) => message.updateComponents.components)
      .filter((component: any) => component.component === "Text")
      .map((component: any) => component.text)
      .join(" ");
    assert.ok(rendered.includes(IKOYI_TITLE));
    assert.ok(rendered.includes(LEKKI_TITLE));
  } finally {
    await journey.server.close();
  }
});

function extractArtifactId(turn: GuestTurnSuccess): string {
  const components = turn.surfaces[0]!.a2uiMessages
    .filter((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message)
    .flatMap((message) => message.updateComponents.components as any[]);
  const button = components.find((component) => component.component === "Button" && component.action?.event?.name === "shortlet.discovery.view-unit");
  assert.ok(button, "discovery surface exposes view-unit actions");
  return button.action.event.context.artifactId as string;
}
