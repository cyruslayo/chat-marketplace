import test from "node:test";
import assert from "node:assert/strict";
import { restartFixture } from "./helpers/guest-restart.js";

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
    assert.match(page.body, new RegExp(`href="/stays/${expected[0]}"`));
    assert.equal((page.body.match(/data-unit-id=/g) ?? []).length, expected.length);

    // Failure paths: criteria the guest app never builds fail closed with 400.
    for (const invalid of ["?city=lagos", "?partySize=abc", "?checkIn=2026-09-10", "?checkIn=not-a-date&checkOut=2026-09-12", "?bedrooms=-1"]) {
      const rejected = await get(`${fixture.base}/stays/search${invalid}`);
      assert.equal(rejected.status, 400, invalid);
      assert.match(rejected.body, /data-error-code="SEARCH_INVALID"/, invalid);
    }
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
    assert.match(route, /^\/stays\/[^/?]+$/);
    assert.equal((await get(`${inspection.base}${route}`)).status, 200);
  } finally { await inspection.close(); }
});
