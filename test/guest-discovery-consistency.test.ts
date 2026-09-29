import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { stayCardHtml } from "../apps/local-guest/src/guest-kit.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { discoveryArtifactToA2UI } from "../apps/web-agent/src/index.js";

const SEARCH = "/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2";

async function withServer<T>(run: (base: string) => Promise<T>, setup?: (environment: LocalGuestEnvironment) => void): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "guest-discovery-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite"), clock: () => new Date("2026-09-03T10:00:00Z") });
  setup?.(environment);
  const server = startLocalGuestServer({ port: 0, environment });
  try { return await run(`http://127.0.0.1:${await server.listen()}`); } finally { await server.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("AC3: the All-In Stay Total precedes the deposit on the search page's cards, with no rating, Verified badge or map, and a neighbourhood-level place", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}${SEARCH}`)).text();
    const card = /<article class="ui-stay-card"[\s\S]*?<\/article>/.exec(html)?.[0];
    assert.ok(card, "the page has a stay card");
    assert.ok(card.indexOf("All-In Stay Total for 3 nights") > -1 && card.indexOf("All-In Stay Total for 3 nights") < card.indexOf("Refundable Security Deposit (separate)"), "total, then the deposit");
    assert.ok(card.indexOf("ui-money-total") < card.indexOf("Refundable Security Deposit"), "the money figure leads");
    assert.match(card, /Old Ikoyi, Lagos/);
    assert.doesNotMatch(card, /Verified|★|rating|\bmap\b|pin-map/i);
    assert.doesNotMatch(card, /<script/);
    // Failure path: the place is never an address, and the photo is fetched with no referrer (ADR 0075).
    assert.doesNotMatch(card.replace(/<[^>]*>/g, " "), /\d+\s+\w+\s+(Street|Road|Avenue|Close)/i);
    assert.doesNotMatch(card, /<img(?![^>]*referrerpolicy="no-referrer")/);
  });
});

test("AC5: without JavaScript the search page's cards, chips and search form work, and View apartment opens the unit page", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}${SEARCH}`)).text();
    assert.match(html, /<h1>1 apartment in Old Ikoyi, Lagos<\/h1>/);
    assert.match(html, /<a class="ui-chip" href="#change-search">[\s\S]*?Old Ikoyi, Lagos<\/a>/);
    assert.match(html, /<a class="ui-chip ui-chip--add" href="#change-search">[\s\S]*?Budget<\/a>/);
    assert.match(html, /<form class="ui-panel search-form" id="change-search" method="get" action="\/stays\/search"/);
    assert.doesNotMatch(html, /<script/);
    const href = /<a class="ui-button ui-button--primary ui-button--block ui-stay-card__view" href="([^"]+)"/.exec(html)?.[1];
    assert.ok(href, "View apartment is a plain link");
    const unit = await fetch(`${base}${href.replace(/&amp;/g, "&")}`);
    assert.equal(unit.status, 200);
    assert.match(await unit.text(), /Luxury 2-Bedroom Apartment in Old Ikoyi/);
    // The form still validates: an unknown area is refused rather than searched.
    assert.equal((await fetch(`${base}/stays/search?area=nowhere&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`)).status, 400);
  });
});

const PHOTOS = ["https://images.example/one.png", "https://images.example/two.png", "https://images.example/three.png"];

function withPhotos(environment: LocalGuestEnvironment, photoUrls: readonly string[]): void {
  const unit = environment.unitRepository.findAll().find((candidate) => candidate.location.neighbourhood === "Old Ikoyi");
  assert.ok(unit);
  environment.unitRepository.save({ ...unit, photoUrls: [...photoUrls] });
}

test("Photo count: a stay card with several photos shows \"1 / N\" over its photo, and a card with one photo or none shows no count", () => {
  const preview = { href: "/stays/unit-1", title: "Stay", neighbourhood: "Old Ikoyi", city: "Lagos", allInStayTotalKobo: 370_000_00, refundableSecurityDepositKobo: 20_000_00, nightlyKobo: 120_000_00, bedrooms: 2, bathrooms: 2, capacity: 4, nights: 3 };
  const several = stayCardHtml({ ...preview, photoSrc: "/photos/one.png", photoCount: 7 });
  assert.match(several, /<span class="ui-stay-card__count">[\s\S]*<span aria-hidden="true">1 \/ 7<\/span><span class="ui-sr-only">7 photos<\/span><\/span>/);
  assert.match(several, /<div class="ui-stay-card__media"><img class="ui-stay-card__photo"/);
  // Failure paths: a single photo has nothing to count, and no photo keeps "Photos not available".
  assert.doesNotMatch(stayCardHtml({ ...preview, photoSrc: "/photos/one.png", photoCount: 1 }), /ui-stay-card__count/);
  const none = stayCardHtml({ ...preview, photoCount: 0 });
  assert.doesNotMatch(none, /ui-stay-card__count/);
  assert.match(none, /Photos not available/);
});

test("Photo count: the chat's discovery card carries the stay's photo count as a Photos fact only when there are two or more photos", () => {
  const directory = mkdtempSync(join(tmpdir(), "guest-discovery-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite"), clock: () => new Date("2026-09-03T10:00:00Z") });
  const search = { location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2 };
  const texts = () => discoveryArtifactToA2UI({ artifact: environment.discoveryQuery.search(search), surfaceId: "s" })
    .flatMap((message) => "updateComponents" in message ? message.updateComponents.components : [])
    .map((component) => component.text).filter((text): text is string => typeof text === "string");
  withPhotos(environment, PHOTOS);
  assert.ok(texts().includes("Photos: 3"));
  withPhotos(environment, PHOTOS.slice(0, 1));
  assert.ok(!texts().some((text) => text.startsWith("Photos: ")));
  withPhotos(environment, []);
  assert.ok(!texts().some((text) => text.startsWith("Photos: ")));
  environment.close();
  rmSync(directory, { recursive: true, force: true });
});

test("Photo count: the search page's card shows \"1 / N\" for a stay with several photos, without JavaScript", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}${SEARCH}`)).text();
    const card = /<article class="ui-stay-card"[\s\S]*?<\/article>/.exec(html)?.[0];
    assert.ok(card);
    assert.match(card, /<span aria-hidden="true">1 \/ 3<\/span><span class="ui-sr-only">3 photos<\/span>/);
  }, (environment) => withPhotos(environment, PHOTOS));
});
