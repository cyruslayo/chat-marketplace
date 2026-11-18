import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, catalogueIds, catalogueSnapshotSlug, type JsonObject } from "../packages/surface-kit/src/index.js";
import {
  SHORTLET_BOOKING_CATALOG,
  SHORTLET_BOOKING_CATALOG_ID,
  SHORTLET_BOOKING_MANIFEST,
  SHORTLET_CATALOG_NAMESPACE,
  SHORTLET_COMPOSED_CATALOGUES,
  SHORTLET_DISCOVERY_CATALOG,
  SHORTLET_DISCOVERY_CATALOG_ID,
  SHORTLET_DISCOVERY_MANIFEST,
} from "../apps/web-agent/src/shortlet-catalogs.js";
import { validateShortletMessages } from "../apps/web-agent/src/validate-shortlet-messages.js";
import {
  COMPARE_BACK_EVENT,
  COMPARE_UNIT_EVENT,
  SEE_ALL_DISCOVERY_EVENT,
  VIEW_UNIT_EVENT,
} from "../apps/web-agent/src/discovery-actions.js";
import { BACK_TO_RESULTS_EVENT, REQUEST_TO_BOOK_EVENT } from "../apps/web-agent/src/unit-detail-actions.js";
import { REQUEST_DRAFT_REVIEW_EVENT, REQUEST_DRAFT_SUBMIT_EVENT } from "../apps/web-agent/src/request-draft-actions.js";
import { DRAFT_REPLACEMENT_ACCEPT_EVENT, DRAFT_REPLACEMENT_KEEP_EVENT } from "../apps/web-agent/src/draft-replacement-actions.js";
import { EXTENSION_OPEN_EVENT, NOTICE_OPEN_EVENT } from "../apps/web-agent/src/booking-contract-actions.js";
import { BANK_TRANSFER_INITIALIZE_EVENT } from "../apps/web/src/bank-transfer-actions.js";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, CARD_PAYMENT_VERIFY_RETURN_EVENT } from "../apps/web/src/card-payment-actions.js";
import { CONDITIONAL_OFFER_ACCEPT_EVENT } from "../apps/web/src/conditional-offer-actions.js";
import { sourceFiles } from "./helpers/source-files.js";
import { restartFixture } from "./helpers/guest-restart.js";
import type { GuestSurfacePayload } from "../apps/local-guest/src/guest-server.js";

const root = fileURLToPath(new URL("..", import.meta.url));

/** The snapshot as committed; a Windows checkout may hold CRLF, which is not part of the schema. */
async function snapshot(catalogueId: string): Promise<string> {
  const file = path.join(root, "test", "fixtures", "catalogues", `${catalogueSnapshotSlug(catalogueId)}.json`);
  return (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
}

function shortletIds(): readonly string[] {
  return [SHORTLET_DISCOVERY_CATALOG_ID, SHORTLET_BOOKING_CATALOG_ID];
}

/** Records every action event a surface emits, keyed by the catalogue id its createSurface names. */
function emittedEvents(surface: GuestSurfacePayload, emitted: Map<string, Set<string>>): void {
  const created = surface.a2uiMessages.find((message): message is Extract<typeof message, { createSurface: unknown }> => "createSurface" in message);
  const names = surface.a2uiMessages
    .flatMap((message) => "updateComponents" in message ? message.updateComponents.components : [])
    .flatMap((component) => {
      const event = (component as { action?: { event?: { name?: unknown } } }).action?.event?.name;
      return typeof event === "string" ? [event] : [];
    });
  const bucket = created === undefined ? undefined : emitted.get(created.createSurface.catalogId);
  if (bucket !== undefined) for (const name of names) bucket.add(name);
}

test("AC1 - the composed discovery and booking schemas serialize byte-identically to the captured fixtures", async () => {
  assert.deepEqual(catalogueIds(SHORTLET_COMPOSED_CATALOGUES), [SHORTLET_DISCOVERY_CATALOG_ID, SHORTLET_BOOKING_CATALOG_ID]);
  for (const composed of SHORTLET_COMPOSED_CATALOGUES) {
    const captured = await snapshot(composed.manifest.id);
    assert.equal(canonicalJson(composed.schema), captured, `${composed.manifest.id} schema is byte-identical`);
    assert.ok(captured.length > 50_000, "the baseline is the full Basic schema, not an empty file");
  }
  assert.equal(canonicalJson(SHORTLET_DISCOVERY_CATALOG.schema as JsonObject), await snapshot(SHORTLET_DISCOVERY_CATALOG_ID));
  assert.equal(canonicalJson(SHORTLET_BOOKING_CATALOG.schema as JsonObject), await snapshot(SHORTLET_BOOKING_CATALOG_ID));
  assert.notEqual(await snapshot(SHORTLET_DISCOVERY_CATALOG_ID), await snapshot(SHORTLET_BOOKING_CATALOG_ID), "the typed components differ between the two");
  const discoveryAliases = SHORTLET_COMPOSED_CATALOGUES[0]!.components.map((entry) => entry.alias);
  assert.deepEqual(discoveryAliases, ["UnitDetail", "UnitGallery", "UnitDetailSheet", "UnitActionBar", "StayCard", "StayResults", "StayComparison"]);
  const bookingAliases = SHORTLET_COMPOSED_CATALOGUES[1]!.components.map((entry) => entry.alias);
  assert.deepEqual(bookingAliases, ["StayTicket", "PriceBreakdown"]);
  for (const composed of SHORTLET_COMPOSED_CATALOGUES) {
    for (const entry of composed.components) {
      assert.equal(entry.definition.tier, 3, `${entry.alias} is wrapped as a Tier 3 component (owner decision D34)`);
      assert.equal(typeof entry.definition.text, "function", `${entry.alias} carries a plain-text fallback`);
      assert.ok(entry.definition.fixtures.valid.length > 0 && entry.definition.fixtures.invalid.length > 0, `${entry.alias} has valid and invalid fixtures`);
    }
  }

  // The wire form too (e97d11f, resolved for the nine typed components): each registration schema deep-equals the
  // committed snapshot, so content drift fails even where formatting would not. The byte-level identity to the
  // pre-manifest construction was proven directly — SHA-256 of JSON.stringify of each catalogue: a2bcc2f8… (discovery)
  // and 44e35c3e… (booking), identical before commit 34a1373 and after — and the canonical snapshot pin keeps it.
  for (const registration of [SHORTLET_DISCOVERY_CATALOG, SHORTLET_BOOKING_CATALOG]) {
    assert.deepEqual(JSON.parse(await snapshot(registration.catalogId)), registration.schema, `${registration.catalogId} wire form`);
  }
});

test("AC2 - the shortlet ids stay in one namespace constant and no other source repeats the literal", async () => {
  assert.equal(SHORTLET_DISCOVERY_CATALOG_ID, `${SHORTLET_CATALOG_NAMESPACE}/discovery/v1`);
  assert.equal(SHORTLET_BOOKING_CATALOG_ID, `${SHORTLET_CATALOG_NAMESPACE}/booking/v1`);
  assert.equal(SHORTLET_DISCOVERY_MANIFEST.id, SHORTLET_DISCOVERY_CATALOG_ID);
  assert.equal(SHORTLET_BOOKING_MANIFEST.id, SHORTLET_BOOKING_CATALOG_ID);
  const holders: string[] = [];
  for (const area of ["apps", "domains", "packages"]) {
    for (const file of await sourceFiles(path.join(root, area))) {
      if (!/\.(?:ts|tsx|mts)$/.test(file) || file.includes(`${path.sep}dist${path.sep}`)) continue;
      if ((await readFile(file, "utf8")).includes(SHORTLET_CATALOG_NAMESPACE)) holders.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  assert.deepEqual(holders, ["apps/web-agent/src/shortlet-catalogs.ts"]);
});

test("AC3 - the manifest actions are exactly the sixteen emitted events, and every event emitted on a shortlet surface is allow-listed", async () => {
  assert.deepEqual(new Set(SHORTLET_DISCOVERY_MANIFEST.actions), new Set([
    VIEW_UNIT_EVENT,
    SEE_ALL_DISCOVERY_EVENT,
    COMPARE_UNIT_EVENT,
    COMPARE_BACK_EVENT,
    REQUEST_TO_BOOK_EVENT,
    BACK_TO_RESULTS_EVENT,
  ]));
  assert.deepEqual(new Set(SHORTLET_BOOKING_MANIFEST.actions), new Set([
    REQUEST_DRAFT_REVIEW_EVENT,
    REQUEST_DRAFT_SUBMIT_EVENT,
    DRAFT_REPLACEMENT_ACCEPT_EVENT,
    DRAFT_REPLACEMENT_KEEP_EVENT,
    CONDITIONAL_OFFER_ACCEPT_EVENT,
    BANK_TRANSFER_INITIALIZE_EVENT,
    CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT,
    CARD_PAYMENT_VERIFY_RETURN_EVENT,
    NOTICE_OPEN_EVENT,
    EXTENSION_OPEN_EVENT,
  ]));
  assert.equal(SHORTLET_DISCOVERY_MANIFEST.actions.length + SHORTLET_BOOKING_MANIFEST.actions.length, 16, "all sixteen emitted events, no duplicates");

  const emitted = new Map<string, Set<string>>(shortletIds().map((id) => [id, new Set<string>()]));
  const fixture = await restartFixture();
  try {
    await fixture.advance("confirmed", (_stage, result) => {
      for (const surface of result.surfaces) {
        emittedEvents(surface, emitted);
        assert.equal(validateShortletMessages(surface.a2uiMessages).ok, true);
      }
    });
  } finally {
    await fixture.close();
  }
  assert.ok(emitted.get(SHORTLET_DISCOVERY_CATALOG_ID)!.size > 0, "the walk reached real discovery surfaces");
  assert.ok(emitted.get(SHORTLET_BOOKING_CATALOG_ID)!.size > 0, "the walk reached real booking surfaces");
  for (const manifest of [SHORTLET_DISCOVERY_MANIFEST, SHORTLET_BOOKING_MANIFEST]) {
    for (const name of emitted.get(manifest.id)!) assert.ok(manifest.actions.includes(name), `${manifest.id} must allow-list ${name}`);
  }
  // An emitted name outside the list must fail the check above: prove the comparison itself.
  assert.throws(() => { for (const name of ["shortlet.invented"]) assert.ok(SHORTLET_DISCOVERY_MANIFEST.actions.includes(name), "invented"); }, /invented/);
});

test("AC4 - every existing builder output that uses a shortlet catalogue id still validates", () => {
  for (const catalogId of shortletIds()) {
    const messages = [
      { version: "v0.9.1" as const, createSurface: { surfaceId: `manifest-${catalogId}`, catalogId } },
      { version: "v0.9.1" as const, updateComponents: { surfaceId: `manifest-${catalogId}`, components: [{ id: "root", component: "Text" as const, text: "Same Basic rendering" }] } },
    ];
    assert.equal(validateShortletMessages(messages).ok, true, catalogId);
    const broken = [messages[0]!, { ...messages[1]!, updateComponents: { ...messages[1]!.updateComponents, components: [{ id: "root", component: "AgentInvented" as const, text: "x" }] } }];
    assert.equal(validateShortletMessages(broken as never).ok, false, "an unknown component still fails closed");
  }
});

test("AC5 - no shortlet catalogue is built from a cloned Basic schema outside the library adapter", async () => {
  const source = await readFile(path.join(root, "apps", "web-agent", "src", "shortlet-catalogs.ts"), "utf8");
  assert.ok(!/function shortletCatalog\b/.test(source) && !/defineShortletCatalog/.test(source));
  const offenders: string[] = [];
  for (const area of ["apps", "domains", "packages"]) {
    for (const file of await sourceFiles(path.join(root, area))) {
      if (!/\.(?:ts|tsx|mts)$/.test(file) || file.includes(`${path.sep}dist${path.sep}`)) continue;
      const text = await readFile(file, "utf8");
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (/structuredClone\([^)]*basic[^)]*schema/i.test(text) && relative.includes("shortlet")) offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(!/structuredClone/.test(source));
  assert.ok(!/@cylayo\/weaver/.test(source), "shortlet-catalogs.ts reaches Weaver only through the adapter");
});
