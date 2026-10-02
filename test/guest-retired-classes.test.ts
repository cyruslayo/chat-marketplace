import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { BOOKING_STAGE_PAGES, withStagePage } from "./helpers/guest-stage-pages.js";

// Guest UI consistency issue 11: the kit replaced these classes and style strings. `.stay-card` and `.stay-grid` stay as
// the client's hooks for the Weaver cards (they carry `.ui-stay-card`), so they are not retired.
const RETIRED = [/waiting-panel/, /\bstay-result\b/, /GUEST_STAY_PAYMENT_STYLE/];
const SEARCH = "/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2";

test("AC4: the retired classes and style strings are gone from the shell and the sources", () => {
  const shell = renderGuestShellHtml();
  for (const pattern of RETIRED) assert.doesNotMatch(shell, pattern, `shell still has ${pattern}`);
  for (const file of ["apps/local-guest/src/client.ts", "apps/local-guest/src/guest-server.ts", "apps/web/src/shortlet-foundations.css"]) {
    const source = readFileSync(file, "utf8");
    for (const pattern of RETIRED) assert.doesNotMatch(source, pattern, `${file} still has ${pattern}`);
  }
});

test("AC4: the retired classes are gone from the rendered search page and every booking page", async () => {
  const fixture = await restartFixture();
  try {
    const search = await (await fetch(`${fixture.base}${SEARCH}`, { headers: { cookie: fixture.cookie } })).text();
    assert.match(search, /ui-stay-card/, "the search page still renders stay cards");
    for (const pattern of RETIRED) assert.doesNotMatch(search, pattern);
  } finally { await fixture.close(); }
  for (const spec of BOOKING_STAGE_PAGES) {
    await withStagePage(spec, async ({ fixture, path }) => {
      const html = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
      assert.match(html, /<html/, `${spec.label} rendered a page`);
      for (const pattern of RETIRED) assert.doesNotMatch(html, pattern, `${spec.label} has ${pattern}`);
    });
  }
});
