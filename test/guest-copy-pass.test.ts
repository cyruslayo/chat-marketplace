import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { A2UIServerMessage } from "@weaver/core";
import { restartFixture, type RestartStage } from "./helpers/guest-restart.js";
import { formatGuestHistorySummary } from "../apps/local-guest/src/conversational-shell.js";
import { renderConventionalUnitDetailHtml, renderGuestShellHtml, type GuestStateSnapshot, type GuestSurfacePayload, type GuestTurnSuccess } from "../apps/local-guest/src/guest-server.js";
import { GUEST_FORBIDDEN_TERMS, GUEST_GLOSSARY, GUEST_RECEIPTS, accommodationProviderLine, guestDisclosure, guestReservationStatusCount } from "../apps/web-agent/src/guest-content.js";

const OPERATOR_LEGAL_NAME = "Eko Prime Living Ltd";

function surfaceTexts(surface: GuestSurfacePayload): string[] {
  return surface.a2uiMessages
    .flatMap((message: A2UIServerMessage) => "updateComponents" in message ? message.updateComponents.components as readonly { readonly component: string; readonly text?: unknown }[] : [])
    .filter((component) => component.component === "Text" && typeof component.text === "string")
    .map((component) => component.text as string);
}

function htmlText(html: string): string {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");
}

interface JourneyCapture {
  readonly stages: Map<RestartStage | "declined", GuestTurnSuccess>;
  readonly timeline: GuestStateSnapshot["timeline"];
  readonly emptySearch: GuestTurnSuccess;
  readonly unitPage: string;
}

let captured: Promise<JourneyCapture> | undefined;

/** One confirmed journey plus a declined request, shared by every AC below. */
function journey(): Promise<JourneyCapture> {
  captured ??= (async () => {
    const stages = new Map<RestartStage | "declined", GuestTurnSuccess>();
    const fixture = await restartFixture();
    let timeline: GuestStateSnapshot["timeline"] = [];
    let emptySearch: GuestTurnSuccess | undefined;
    let unitPage = "";
    try {
      await fixture.advance("confirmed", (stage, result) => { stages.set(stage, result); });
      const state = await fixture.state();
      assert.equal(state.ok, true); if (!state.ok) throw new Error("state unavailable");
      timeline = state.timeline;
      const unit = fixture.environment.unitRepository.findById("unit-lagos-ikoyi-001");
      assert.ok(unit);
      unitPage = renderConventionalUnitDetailHtml(unit as Parameters<typeof renderConventionalUnitDetailHtml>[0]);
    } finally { await fixture.close(); }

    const declined = await restartFixture();
    try {
      const pending = await declined.advance("pending");
      declined.environment.simulateOperatorDecline(pending.surfaces[0]!.surfaceId.split(":").at(-1)!);
      const state = await declined.state();
      assert.equal(state.ok, true); if (!state.ok) throw new Error("state unavailable");
      stages.set("declined", { ok: true, messages: [], surfaces: state.surfaces });
    } finally { await declined.close(); }

    const empty = await restartFixture();
    try {
      const search = await empty.send("/api/turn", { text: "I need an apartment in Abuja for 2 nights for 2 people" });
      assert.equal(search.ok, true); if (!search.ok) throw new Error("search failed");
      emptySearch = search;
    } finally { await empty.close(); }
    return { stages, timeline, emptySearch: emptySearch!, unitPage };
  })();
  return captured;
}

function everyGuestString(capture: JourneyCapture): string[] {
  const strings: string[] = [];
  for (const result of [...capture.stages.values(), capture.emptySearch]) {
    strings.push(...result.messages, ...(result.receipts ?? []));
    for (const surface of result.surfaces) {
      strings.push(...surfaceTexts(surface));
      if (surface.textFallback) strings.push(surface.textFallback);
      if (surface.conventionalRouteLabel) strings.push(surface.conventionalRouteLabel);
      if (surface.summary) strings.push(formatGuestHistorySummary(surface.summary, "superseded"));
    }
  }
  strings.push(...capture.timeline.map((entry) => entry.text), htmlText(renderGuestShellHtml()), htmlText(capture.unitPage));
  return strings;
}

test("AC1: Each surface states reservation status exactly once", async () => {
  // Failure path: the detector counts every restatement, so a repeated
  // disclaimer cannot pass as a single status line.
  assert.equal(guestReservationStatusCount(["Draft · Not reserved", "Dates are not reserved until you submit.", "Dates are not held yet."]), 3);

  const { stages } = await journey();
  for (const stage of ["draft", "review", "pending", "offer", "confirmed", "declined"] as const) {
    const result = stages.get(stage);
    assert.ok(result, `missing ${stage}`);
    const surface = result.surfaces[0]!;
    const lines = [...result.messages, ...surfaceTexts(surface)];
    assert.equal(guestReservationStatusCount(lines), 1, `${stage} surface must state reservation status once:\n${lines.join("\n")}`);
    assert.equal(guestReservationStatusCount([surface.textFallback ?? ""]), 1, `${stage} text fallback must state reservation status once: ${surface.textFallback}`);
  }
});

test("AC2: No guest-facing surface contains \"revalidated\", \"controlled catalogue\", \"guest liability\", \"escrow\" or \"host\"", async () => {
  // Failure path: the domain quote disclosures still carry internal ledger and
  // catalogue terms (domain code is unchanged); presentation must translate them.
  const domainDeposit = "Refundable Security Deposit is quoted separately and held as guest liability.";
  const domainCatalogue = "Optional services come strictly from the controlled catalogue with no off-platform payment.";
  assert.ok(GUEST_FORBIDDEN_TERMS.some((term) => term.test(domainDeposit)));
  assert.ok(GUEST_FORBIDDEN_TERMS.some((term) => term.test(domainCatalogue)));
  for (const disclosure of [domainDeposit, domainCatalogue]) {
    const guestCopy = guestDisclosure(disclosure);
    assert.equal(GUEST_FORBIDDEN_TERMS.some((term) => term.test(guestCopy)), false, guestCopy);
  }

  const offenders = everyGuestString(await journey()).filter((text) => GUEST_FORBIDDEN_TERMS.some((term) => term.test(text)));
  assert.deepEqual(offenders, []);
});

test("AC3: All-In Stay Total and Refundable Security Deposit labels are unchanged", async () => {
  assert.equal(GUEST_GLOSSARY.allInStayTotal, "All-In Stay Total");
  assert.equal(GUEST_GLOSSARY.refundableSecurityDeposit, "Refundable Security Deposit");
  const { stages } = await journey();
  for (const stage of ["draft", "review", "pending", "offer", "payment-ready"] as const) {
    const surface = stages.get(stage)!.surfaces[0]!;
    const texts = [...surfaceTexts(surface), surface.textFallback ?? ""];
    assert.ok(texts.some((text) => text.includes(`${GUEST_GLOSSARY.allInStayTotal}:`)), `${stage} shows the All-In Stay Total label`);
    assert.ok(texts.some((text) => text.includes(GUEST_GLOSSARY.refundableSecurityDeposit)), `${stage} shows the Refundable Security Deposit label`);
  }
  // Failure path: shortened money labels are not allowed anywhere.
  const shortened = everyGuestString(await journey()).filter((text) => /\bStay total\b|\b[Rr]efundable deposit\b/.test(text));
  assert.deepEqual(shortened, []);
});

test("AC4: Receipts render as markers, not assistant turns", async () => {
  const { stages, timeline } = await journey();
  const draft = stages.get("draft")!;
  assert.deepEqual(draft.receipts, [GUEST_RECEIPTS.draftCreated]);
  assert.deepEqual(stages.get("pending")!.receipts, [GUEST_RECEIPTS.requestSent]);
  assert.deepEqual(stages.get("payment-ready")!.receipts, [GUEST_RECEIPTS.offerAccepted]);
  assert.deepEqual(stages.get("confirmed")!.receipts, [GUEST_RECEIPTS.paymentVerified]);

  // The restored transcript keeps receipts as markers, never as assistant turns.
  const receipts = new Set<string>(Object.values(GUEST_RECEIPTS));
  assert.deepEqual(timeline.filter((entry) => entry.role === "receipt").map((entry) => entry.text), [GUEST_RECEIPTS.draftCreated, GUEST_RECEIPTS.requestSent, GUEST_RECEIPTS.offerAccepted, GUEST_RECEIPTS.paymentVerified]);
  // Failure path: a receipt must not also appear as an assistant message.
  assert.deepEqual(timeline.filter((entry) => entry.role === "assistant" && receipts.has(entry.text)), []);
  for (const result of stages.values()) assert.equal(result.messages.some((message) => receipts.has(message)), false);
});

test("AC5: Guest-facing surfaces say \"apartment\" and never \"Unit\"", async () => {
  const capture = await journey();
  const discovery = capture.stages.get("discovery")!.surfaces[0]!;
  assert.ok(surfaceTexts(discovery).includes(GUEST_GLOSSARY.viewUnit), "discovery cards offer \"View apartment\"");
  // Failure path: the no-results search is phrased with the guest noun too.
  const emptyCopy = [...capture.emptySearch.messages, ...capture.emptySearch.surfaces.flatMap((surface) => [surface.textFallback ?? "", ...surfaceTexts(surface)])].join(" ");
  assert.match(emptyCopy, /\bapartments?\b/);
  const offenders = everyGuestString(capture).filter((text) => /\bUnits?\b/.test(text));
  assert.deepEqual(offenders, []);
});

test("AC6: The Accommodation Provider line with the Operator's legal name appears on the review, offer and confirmation surfaces, and on no discovery or draft surface", async () => {
  const line = accommodationProviderLine(OPERATOR_LEGAL_NAME);
  assert.equal(line, `Provided by ${OPERATOR_LEGAL_NAME} (your accommodation provider)`);
  const { stages } = await journey();
  for (const stage of ["review", "offer", "confirmed"] as const) {
    assert.ok(surfaceTexts(stages.get(stage)!.surfaces[0]!).includes(line), `${stage} names the Accommodation Provider`);
  }
  // Failure path: the contracting party is not disclosed before the contract can form.
  for (const stage of ["discovery", "inspection", "draft"] as const) {
    const texts = surfaceTexts(stages.get(stage)!.surfaces[0]!);
    assert.equal(texts.some((text) => /accommodation provider/i.test(text)), false, `${stage} must not show the provider line`);
  }
});

test("AC7: Every guest label in the table comes from the single glossary module", () => {
  const labels = [GUEST_GLOSSARY.allInStayTotal, GUEST_GLOSSARY.refundableSecurityDeposit, GUEST_GLOSSARY.offerReadyHeading, GUEST_GLOSSARY.viewUnit, GUEST_GLOSSARY.requestDraftStatus, GUEST_GLOSSARY.revalidation, "your accommodation provider"];
  const sources = [
    ...readdirSync("apps/web-agent/src").filter((name) => name.endsWith(".ts") && name !== "guest-content.ts").map((name) => join("apps/web-agent/src", name)),
    "apps/local-guest/src/guest-server.ts",
    "apps/local-guest/src/client.ts",
    "apps/local-guest/src/conversational-shell.ts",
  ];
  const offenders: string[] = [];
  for (const path of sources) {
    const code = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const label of labels) if (code.includes(label)) offenders.push(`${path}: ${label}`);
  }
  // Failure path: a surface that hardcodes a glossary label is reported.
  assert.deepEqual(offenders, []);
});
