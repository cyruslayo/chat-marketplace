import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { A2UIClientActionMessage } from "@cylayo/weaver-core";
import { Window } from "happy-dom";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import { COMPARE_UNIT_EVENT, VIEW_UNIT_EVENT, discoveryArtifactToA2UI, type DiscoveryArtifactProjection } from "../apps/web-agent/src/discovery-a2ui.js";

/**
 * Weaver catalogues issue 06 (ADR 0102): discovery results render through the typed StayCard and StayResults components
 * of `shortlet-discovery/v1`, mounted here on the guest browser's own runtime in happy-dom.
 */
const SEARCH = { location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2 };
const TRUSTED_IMAGES = "https://images.example/";

function lagosArtifact(photoUrls?: readonly string[]): DiscoveryArtifactProjection {
  const directory = mkdtempSync(join(tmpdir(), "weaver-discovery-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite"), clock: () => new Date("2026-09-03T10:00:00Z") });
  try {
    if (photoUrls) for (const unit of environment.unitRepository.findAll()) environment.unitRepository.save({ ...unit, photoUrls: [...photoUrls] });
    const artifact = environment.discoveryQuery.search(SEARCH);
    assert.equal(artifact.facts.results.length, 2, "the Lagos fixture search has two results");
    return structuredClone(artifact) as DiscoveryArtifactProjection;
  } finally {
    environment.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The same search with its results (and their view actions) in the opposite order. */
function reversed(artifact: DiscoveryArtifactProjection): DiscoveryArtifactProjection {
  return { ...artifact, facts: { ...artifact.facts, results: [...artifact.facts.results].reverse() }, actions: [...artifact.actions].reverse() };
}

/** A third result, so "See both side by side" must not appear. */
function withThirdResult(artifact: DiscoveryArtifactProjection): DiscoveryArtifactProjection {
  const first = artifact.facts.results[0]!;
  const third = { ...first, id: "unit-third", title: "Third Test Stay" };
  const action = { ...artifact.actions[0]!, unitId: third.id, conventionalRoute: "/stays/unit-third" };
  return { ...artifact, facts: { ...artifact.facts, results: [...artifact.facts.results, third] }, actions: [...artifact.actions, action] };
}

function mountDiscovery(artifact: DiscoveryArtifactProjection, onCompareBoth?: () => void) {
  const surfaceId = "discovery-test";
  const events: A2UIClientActionMessage["action"][] = [];
  const web = createShortletWebRuntime({
    resourcePolicy: ({ kind, url }) => kind === "image" && url.startsWith(TRUSTED_IMAGES) ? url : undefined,
    onServerEvent: (event) => { events.push(event.message.action); },
    ...(onCompareBoth ? { onCompareBoth } : {}),
  });
  for (const message of discoveryArtifactToA2UI({ artifact, surfaceId })) assert.equal(web.runtime.process(message).ok, true, "the discovery message is valid");
  const window = new Window();
  const target = window.document.createElement("div");
  window.document.body.append(target);
  assert.equal(web.mount({ surfaceId, target: target as unknown as Element }).ok, true, "the discovery surface mounts");
  return { target, events };
}

/** Clicks a happy-dom element (its types are not the DOM lib's, so the element is taken as unknown). */
function click(element: unknown): void {
  assert.ok(element, "the control exists");
  (element as { click(): void }).click();
}

test("AC1: each chat card is the search page's .ui-stay-card, with its facts, the total label before the deposit, and the View button in the kit's place", () => {
  const artifact = lagosArtifact();
  const { target } = mountDiscovery(artifact);
  const cards = [...target.querySelectorAll(".stay-grid[role=list] > .stay-card.ui-stay-card[role=listitem]")];
  assert.deepEqual(cards.map((card) => card.getAttribute("data-unit-id")), artifact.facts.results.map((unit) => unit.id));
  const card = cards[0]!;
  const unit = artifact.facts.results[0]!;
  assert.equal(card.querySelector(".ui-stay-card__title a")?.getAttribute("href"), `/stays/${unit.id}`, "the title keeps a real href for no-JS and new tabs");
  assert.equal(card.querySelector(".ui-stay-card__title")?.textContent, unit.title);
  assert.equal(card.querySelector(".ui-stay-card__where")?.textContent, `${unit.location.neighbourhood}, ${unit.location.city}`);
  assert.ok(card.querySelectorAll(".ui-stay-card__facts .ui-fact").length >= 2);
  const total = [...card.querySelectorAll(".ui-stay-card__total p")].map((line) => line.textContent ?? "");
  assert.match(total[0]!, /^₦/);
  assert.match(total[1]!, /All-In Stay Total/);
  assert.match(total[2]!, /^\+ ₦.* Refundable Security Deposit \(separate\)$/, "the deposit follows the total and its label");
  assert.ok(card.querySelector(".stay-card__fit"), "the fit reason is kept and marked");
  const view = card.querySelector("button.ui-button.ui-button--primary.ui-button--block.ui-stay-card__view");
  assert.ok(view, "Weaver's View button takes the kit link's place");
  assert.equal(card.querySelector("a.ui-stay-card__view"), null, "the kit's fallback link is replaced, not duplicated");
  assert.equal(card.querySelector(".stay-card__compare.ui-link")?.previousElementSibling, view, "Compare follows View apartment");
  assert.doesNotMatch(card.textContent ?? "", /No property photos are available yet/, "no duplicate caption under the kit's photo box");
});

test("AC1: the title link opens the stay through the card's View button", () => {
  const artifact = lagosArtifact();
  const { target, events } = mountDiscovery(artifact);
  click(target.querySelector(`.ui-stay-card[data-unit-id="${artifact.facts.results[1]!.id}"] .ui-stay-card__title a`));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, VIEW_UNIT_EVENT);
  assert.equal((events[0]?.context as { unitId?: string }).unitId, artifact.facts.results[1]!.id);
});

test("AC2: each result row opens the matching unit's detail, also with the results in reversed order (rows match cards by unitId)", () => {
  for (const artifact of [lagosArtifact(), reversed(lagosArtifact())]) {
    const { target, events } = mountDiscovery(artifact);
    const rows = [...target.querySelectorAll('.ui-result-rows[role=list][aria-label="Stays for your search"] .ui-result-row')];
    assert.equal(rows.length, 2);
    for (const [index, unit] of artifact.facts.results.entries()) {
      assert.equal(rows[index]?.getAttribute("href"), `/stays/${unit.id}`);
      click(rows[index]);
      assert.equal((events.at(-1)?.context as { unitId?: string }).unitId, unit.id, `row ${index} opens ${unit.id}`);
    }
    assert.ok(target.querySelector(".stay-results > .ui-result-rows ~ .stay-grid"), "the rows precede the grid, so the phone CSS hides the grid");
  }
});

test("AC3: exactly two results show \"See both side by side\", which calls the host's compareBoth", () => {
  let compared = 0;
  const { target } = mountDiscovery(lagosArtifact(), () => { compared += 1; });
  const both = target.querySelector("button.ui-link.ui-result-rows__compare");
  assert.ok(both, "the both link is offered for two results");
  assert.match(both.textContent ?? "", /See both side by side/);
  click(both);
  assert.equal(compared, 1);
});

test("AC3: three or more results show no \"both\" link, and neither does a host without a compareBoth handler", () => {
  assert.equal(mountDiscovery(withThirdResult(lagosArtifact()), () => {}).target.querySelector(".ui-result-rows__compare"), null);
  assert.equal(mountDiscovery(lagosArtifact()).target.querySelector(".ui-result-rows__compare"), null, "never a dead control");
});

test("AC3: Compare buttons keep their allow-listed event", () => {
  const artifact = lagosArtifact();
  const { target, events } = mountDiscovery(artifact);
  click(target.querySelector(`.ui-stay-card[data-unit-id="${artifact.facts.results[0]!.id}"] .stay-card__compare`));
  assert.equal(events.at(-1)?.name, COMPARE_UNIT_EVENT);
});

test("AC4: the photo count shows only for two or more photos, and only approved photo URLs are rendered", () => {
  const several = mountDiscovery(lagosArtifact([`${TRUSTED_IMAGES}one.png`, `${TRUSTED_IMAGES}two.png`])).target;
  assert.equal(several.querySelectorAll(".ui-stay-card__count").length, 2);
  assert.equal(several.querySelector(".ui-stay-card__photo")?.getAttribute("src"), `${TRUSTED_IMAGES}one.png`);
  assert.equal(several.querySelector(".ui-result-row__thumb img")?.getAttribute("src"), `${TRUSTED_IMAGES}one.png`);
  const one = mountDiscovery(lagosArtifact([`${TRUSTED_IMAGES}one.png`])).target;
  assert.equal(one.querySelector(".ui-stay-card__count"), null);
  const refused = mountDiscovery(lagosArtifact(["https://tracker.invalid/pixel.png", "https://tracker.invalid/two.png"])).target;
  assert.doesNotMatch(refused.innerHTML, /tracker\.invalid/, "a refused URL appears nowhere, card or row");
  assert.equal(refused.querySelectorAll(".ui-stay-card__photo--empty").length, 2, "the kit's labelled no-photo box shows instead");
});

test("typed card props are text: markup in a title is escaped, never parsed (ADR 0075)", () => {
  const artifact = lagosArtifact();
  const hostile = "<img src=x onerror=alert(1)>";
  const results = artifact.facts.results.map((unit, index) => index === 0 ? { ...unit, title: `Flat ${hostile}` } : unit);
  const { target } = mountDiscovery({ ...artifact, facts: { ...artifact.facts, results } });
  assert.equal(target.querySelector("[onerror]"), null);
  assert.equal(target.querySelector(".ui-stay-card__title")?.textContent, `Flat ${hostile}`);
  assert.equal(target.querySelector(".ui-result-row__title")?.textContent, `Flat ${hostile}`);
});

test("an empty search keeps the Basic \"No stays match\" surface", () => {
  const artifact = lagosArtifact();
  const { target } = mountDiscovery({ ...artifact, facts: { ...artifact.facts, results: [] }, actions: [] });
  assert.match(target.textContent ?? "", /No stays match this search/);
  assert.equal(target.querySelector(".stay-results"), null);
});

test("AC7: client.ts no longer defines decorateDiscoveryCards or viewUnitIds", async () => {
  const client = await readFile(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /\bdecorateDiscoveryCards\b/);
  assert.doesNotMatch(client, /\bviewUnitIds\b/);
});
