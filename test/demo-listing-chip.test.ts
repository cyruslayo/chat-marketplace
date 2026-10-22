import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { demoListingChipHtml, stayCardInnerHtml, stayCardParts, type StayPreview } from "../apps/local-guest/src/guest-kit.js";
import { renderConventionalSearchHtml, renderConventionalUnitDetailHtml } from "../apps/local-guest/src/guest-server.js";
import { discoveryArtifactToA2UI } from "../apps/web-agent/src/discovery-a2ui.js";
import { GUEST_FACT_LABELS } from "../apps/web-agent/src/guest-content.js";
import { demoDatabase, removeDemoDatabase, withDemoEnvironment } from "./helpers/demo-mode-fixture.js";

const PREVIEW: StayPreview = {
  href: "/stays/unit-lagos-ikoyi-001",
  title: "Ikoyi two-bedroom",
  neighbourhood: "Ikoyi",
  city: "Lagos",
  bedrooms: 2,
  bathrooms: 2,
  capacity: 4,
  allInStayTotalKobo: 45_000_000,
  nightlyKobo: 15_000_000,
  refundableSecurityDepositKobo: 5_000_000,
  nights: 3,
  unitId: "unit-lagos-ikoyi-001",
};

test("AC5: stay cards show the Demo listing chip from one kit helper in chat and on the standalone page", async () => {
  const card = stayCardInnerHtml(stayCardParts({ ...PREVIEW, demoListing: true }));
  assert.ok(card.includes(demoListingChipHtml()), "the stay card renders the kit chip");
  assert.ok(card.includes(GUEST_FACT_LABELS.demoListing), "the chip label comes from GUEST_FACT_LABELS");
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: true }, (environment: LocalGuestEnvironment) => {
      const artifact = environment.discoveryQuery.search({ city: "Lagos" });
      assert.ok(renderConventionalSearchHtml(artifact, undefined, true).includes(demoListingChipHtml()), "the standalone results page shows the chip");
      const chat = discoveryArtifactToA2UI({ artifact, surfaceId: "demo-chip-surface", demo: true });
      assert.ok(JSON.stringify(chat).includes(GUEST_FACT_LABELS.demoListing), "the chat discovery card carries the chip fact");
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});

test("AC5 failure path: nothing shows when demo is off", async () => {
  assert.equal(stayCardInnerHtml(stayCardParts(PREVIEW)).includes(GUEST_FACT_LABELS.demoListing), false);
  assert.equal(stayCardInnerHtml(stayCardParts({ ...PREVIEW, demoListing: false })).includes(GUEST_FACT_LABELS.demoListing), false);
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: false }, (environment: LocalGuestEnvironment) => {
      const artifact = environment.discoveryQuery.search({ city: "Lagos" });
      assert.equal(renderConventionalSearchHtml(artifact).includes(GUEST_FACT_LABELS.demoListing), false, "the results page");
      assert.equal(JSON.stringify(discoveryArtifactToA2UI({ artifact, surfaceId: "demo-chip-off", demo: false })).includes(GUEST_FACT_LABELS.demoListing), false, "the chat card");
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});

test("AC5: the unit detail shows the Demo listing chip with demo on and not with demo off", async () => {
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: true }, (environment: LocalGuestEnvironment) => {
      const unit = environment.unitRepository.findAll()[0]!;
      assert.ok(renderConventionalUnitDetailHtml(unit, undefined, true).includes(demoListingChipHtml()), "demo on");
      assert.equal(renderConventionalUnitDetailHtml(unit).includes(GUEST_FACT_LABELS.demoListing), false, "demo off");
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});
