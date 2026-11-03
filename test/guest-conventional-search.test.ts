import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { restartFixture } from "./helpers/guest-restart.js";
import { renderConventionalSearchHtml } from "../apps/local-guest/src/guest-server.js";
import { formatNgnKobo } from "../apps/web-agent/src/index.js";

async function get(url: string, cookie?: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { headers: { accept: "text/html", ...(cookie ? { cookie } : {}) } });
  return { status: response.status, body: await response.text() };
}

function searchFilters(route: string): Record<string, string | number> {
  const filters: Record<string, string | number> = {};
  for (const [key, value] of new URL(route, "http://localhost").searchParams) {
    filters[key] = key === "partySize" || key === "bedrooms" ? Number(value) : value;
  }
  return filters;
}

test("AC2: /stays/search never reaches the unit-detail handler", async () => {
  const fixture = await restartFixture();
  try {
    const discovery = await fixture.advance("discovery");
    const unitRoute = discovery.surfaces[0]!.conventionalRoute!;
    const search = await get(`${fixture.base}/stays/search`);
    assert.equal(search.status, 200);
    assert.match(search.body, /data-page="stay-search"/);
    assert.doesNotMatch(search.body, /Apartment not found/);
    // Failure path: a deeper path under /stays/search is neither search nor a unit.
    const deeper = await get(`${fixture.base}/stays/search/extra`);
    assert.equal(deeper.status, 404);
    assert.doesNotMatch(deeper.body, /data-page="stay-search"/);
    // The unit-detail handler is still reached for a real unit id.
    const unitId = fixture.environment.discoveryQuery.search(searchFilters(unitRoute)).facts.results[0]!.id as string;
    const unit = await get(`${fixture.base}/stays/${encodeURIComponent(unitId)}`);
    assert.equal(unit.status, 200);
    assert.doesNotMatch(unit.body, /data-page="stay-search"/);
  } finally { await fixture.close(); }
});

test("AC1 (search part): /stays/search built by the guest app returns 200 with the matching results", async () => {
  const fixture = await restartFixture();
  try {
    const discovery = await fixture.advance("discovery");
    const route = discovery.surfaces[0]!.conventionalRoute;
    assert.ok(route?.startsWith("/stays/search?"), `emitted route: ${route}`);
    const expected = fixture.environment.discoveryQuery.search(searchFilters(route!)).facts.results.map((unit: { id: string }) => unit.id);
    assert.ok(expected.length > 0);
    const page = await get(`${fixture.base}${route}`);
    assert.equal(page.status, 200);
    for (const unitId of expected) assert.match(page.body, new RegExp(`data-unit-id="${unitId}"`));
    assert.match(page.body, new RegExp(`href="/stays/${expected[0]}\\?`));
    assert.equal((page.body.match(/data-unit-id=/g) ?? []).length, expected.length);

    // Failure paths: criteria the guest app never builds fail closed with 400.
    for (const invalid of ["?city=lagos", "?partySize=abc", "?checkIn=2026-09-10", "?checkIn=not-a-date&checkOut=2026-09-12", "?bedrooms=-1"]) {
      const rejected = await get(`${fixture.base}/stays/search${invalid}`);
      assert.equal(rejected.status, 400, invalid);
      assert.match(rejected.body, /data-error-code="SEARCH_INVALID"/, invalid);
    }
  } finally { await fixture.close(); }
});

test("AC2: opening a result keeps its current criteria and authoritative quote on the conventional detail route", async () => {
  const fixture = await restartFixture();
  try {
    const discovery = await fixture.advance("discovery");
    const route = discovery.surfaces[0]!.conventionalRoute!;
    const artifact = fixture.environment.discoveryQuery.search(searchFilters(route));
    const first = artifact.facts.results[0]!;
    const searchPage = await get(`${fixture.base}${route}`);
    const detailRoute = new RegExp(`href="([^\"]*\/stays\/${first.id}[^\"]*)"`).exec(searchPage.body)?.[1];
    assert.ok(detailRoute, "the selected result has a conventional detail route");
    assert.match(detailRoute!, /checkIn=/, "the result route carries the selected dates");
    assert.match(detailRoute!, /partySize=/, "the result route carries the guest count");
    const detail = await get(`${fixture.base}${detailRoute!.replace(/&amp;/g, "&")}`);
    assert.equal(detail.status, 200);
    assert.match(detail.body, /All-In Stay Total/);
    assert.match(detail.body, /2 guests/);
    assert.ok(detail.body.includes(formatNgnKobo(first.price.allInStayTotalKobo!)), "the detail total matches the selected result quote");
    assert.match(detail.body, /Refundable Security Deposit/);
    const incomplete = await get(`${fixture.base}/stays/${first.id}?threadId=${fixture.threadId}`);
    assert.equal(incomplete.status, 400, "missing quote criteria fail closed");
    const stale = await get(`${fixture.base}/stays/${first.id}?location=Abuja&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    assert.equal(stale.status, 409, "criteria that no longer include the selected unit fail closed");
  } finally { await fixture.close(); }
});

test("AC3: zero results preserve the search criteria, offer direct repair, and show no result action", async () => {
  const fixture = await restartFixture();
  try {
    const discovery = await fixture.advance("discovery");
    const route = discovery.surfaces[0]!.conventionalRoute!;
    const zeroRoute = `${route}&budget=1`;
    const page = await get(`${fixture.base}${zeroRoute}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /No stays match/);
    assert.match(page.body, /aria-label="Change your search"/);
    assert.match(page.body, /id="search-area"[^>]*>[\s\S]*selected/);
    assert.doesNotMatch(page.body, /data-unit-id=|View apartment|Request to Book/);
  } finally { await fixture.close(); }
});

test("AC4: Back from Unit detail returns to the current search results and keeps its criteria", async () => {
  const fixture = await restartFixture();
  try {
    const discovery = await fixture.advance("discovery");
    const searchRoute = `${discovery.surfaces[0]!.conventionalRoute!}&threadId=${fixture.threadId}`;
    const searchPage = await get(`${fixture.base}${searchRoute}`, fixture.cookie);
    const unitId = /data-unit-id="([^"]+)"/.exec(searchPage.body)?.[1];
    assert.ok(unitId);
    const detailRoute = new RegExp(`href="([^\"]*\\/stays\\/${unitId}[^\"]*)"`).exec(searchPage.body)?.[1];
    assert.ok(detailRoute);
    const detailPage = await get(`${fixture.base}${detailRoute!.replace(/&amp;/g, "&")}`, fixture.cookie);
    assert.match(detailPage.body, /Back to search results/);
    const backRoute = /href="([^\"]+)"[^>]*>Back to search results/.exec(detailPage.body)?.[1]?.replace(/&amp;/g, "&");
    assert.ok(backRoute?.startsWith("/stays/search?"));
    assert.ok(backRoute!.includes(`threadId=${fixture.threadId}`), "Back preserves the current thread identity");
    const returned = await get(`${fixture.base}${backRoute}`, fixture.cookie);
    assert.equal(returned.status, 200);
    assert.match(returned.body, new RegExp(`data-unit-id="${unitId}"`));
    assert.match(returned.body, /value="2026-09-10"/);
    assert.match(returned.body, /value="2026-09-13"/);
    assert.match(returned.body, /value="2"/);
    const conversationRoute = /href="([^\"]+)"[^>]*>Back to your conversation/.exec(returned.body)?.[1];
    assert.equal(conversationRoute, `/?threadId=${fixture.threadId}`);
    const conversation = await get(`${fixture.base}${conversationRoute}`, fixture.cookie);
    assert.equal(conversation.status, 200);
    const state = await get(`${fixture.base}/api/state?threadId=${fixture.threadId}`, fixture.cookie);
    assert.equal(state.status, 200);
    assert.match(state.body, new RegExp(fixture.threadId));
    const forged = await get(`${fixture.base}/api/state?threadId=g-00000000-0000-4000-8000-000000000000`, fixture.cookie);
    assert.doesNotMatch(forged.body, /g-00000000-0000-4000-8000-000000000000/, "an unknown thread id receives no thread projection");
  } finally { await fixture.close(); }
});

test("Warm editorial conventional stay cards lead with real photos and separate all-in and deposit facts", async () => {
  const fixture = await restartFixture();
  try {
    const discovery = await fixture.advance("discovery");
    const route = discovery.surfaces[0]!.conventionalRoute!;
    const artifact = fixture.environment.discoveryQuery.search(searchFilters(route));
    const first = artifact.facts.results[0]!;
    const withPhoto = { ...artifact, facts: { ...artifact.facts, results: [{ ...first, photoUrls: ["https://images.example/stay.jpg"] }, ...artifact.facts.results.slice(1)] } };
    const html = renderConventionalSearchHtml(withPhoto, () => "/photos/stay.jpg");
    assert.match(html, /class="ui-stay-card__photo" src="\/photos\/stay.jpg"/);
    assert.match(html, /referrerpolicy="no-referrer"/);
    assert.match(html, /alt="Photo of /);
    assert.match(html, /class="ui-stay-card__facts"/);
    assert.match(html, /All-In Stay Total for \d+ nights?/);
    assert.match(html, /\+ .[\d,]+ Refundable Security Deposit \(separate\)/);
    // The card styling is the shared kit, not inline page CSS (guest-ui-consistency issue 02).
    const foundations = await readFile(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
    assert.match(foundations, /\.ui-stay-card__photo \{[^}]*aspect-ratio: 4 \/ 3/);
    assert.match(foundations, /\.ui-stay-card__photo \{[^}]*border-radius: var\(--radius-card\)/);
    assert.doesNotMatch(html, /Verified badge|★/);
  } finally { await fixture.close(); }
});

test("AC1 (search part): restored discovery and unit surfaces emit routes that return 200", async () => {
  const discovery = await restartFixture();
  try {
    await discovery.advance("discovery");
    await discovery.restart();
    const restored = await discovery.state();
    assert.equal(restored.ok, true); if (!restored.ok) return;
    const route = restored.surfaces[0]!.conventionalRoute!;
    assert.match(route, /^\/stays\/search\?.*location=/);
    assert.equal((await get(`${discovery.base}${route}`)).status, 200);
  } finally { await discovery.close(); }

  const inspection = await restartFixture();
  try {
    await inspection.advance("inspection");
    await inspection.restart();
    const restored = await inspection.state();
    assert.equal(restored.ok, true); if (!restored.ok) return;
    const route = restored.surfaces[0]!.conventionalRoute!;
    // Failure path: the restored unit surface previously pointed at an empty /booking-requests/ route.
    assert.match(route, /^\/stays\/[^/?]+\?/);
    assert.equal((await get(`${inspection.base}${route}`)).status, 200);
  } finally { await inspection.close(); }
});
