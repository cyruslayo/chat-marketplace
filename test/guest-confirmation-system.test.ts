import assert from "node:assert/strict";
import test from "node:test";
import { errorPage } from "../apps/web/src/ui-kit.js";
import { confirmationContent } from "../apps/web-agent/src/confirmation-presentation.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";
import { restartFixture } from "./helpers/guest-restart.js";

test("AC1: confirmation uses the Reservation ID, preserves projected amounts and does not label an uncollected deposit as collected", async () => {
  await withStagePage({ label: "confirmed", stage: "confirmed" }, async ({ fixture, path, threadId }) => {
    const artifact = fixture.environment.contractApp.getArtifact(decodeURIComponent(path.split("/").at(-1)!), fixture.environment.guestPrincipal());
    const content = confirmationContent(artifact, threadId, path, "Existing details");
    assert.equal(content.bookingReference, artifact.facts.reservationId);
    assert.equal(content.depositCollected, true);
    const { securityDeposit: _deposit, ...facts } = artifact.facts;
    assert.equal(confirmationContent({ ...artifact, facts }, threadId, path, "").depositCollected, false);
    assert.equal(confirmationContent({ ...artifact, facts: { ...artifact.facts, refundableSecurityDepositKobo: 0 } }, threadId, path, "").depositCollected, false);
    assert.match(content.details, /Provided by/);
    assert.match(content.steps.join(" "), /does not itself grant physical access/);
    const html = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
    assert.match(html, /Amount paid:.*₦370,000/);
    assert.match(html, /Refundable Security Deposit collected:.*₦20,000/);
  });
});

test("AC2: an unknown form error code renders a complete HTML error page and preserves JSON for API clients", async () => {
  const fixture = await restartFixture();
  try {
    const result = await fixture.advance("draft");
    const path = `${result.surfaces[0]!.conventionalRoute}/review`;
    const request = (accept: string) => fetch(`${fixture.base}${path}`, { method: "POST", headers: { cookie: fixture.cookie, origin: "https://foreign.example", accept }, redirect: "manual" });
    const htmlResponse = await request("text/html");
    assert.equal(htmlResponse.status, 403);
    const html = await htmlResponse.text();
    assert.match(html, /ui-appbar/);
    assert.match(html, /data-error-code="ORIGIN_REJECTED"/);
    assert.match(html, /data-status="403"/);
    assert.doesNotMatch(html, /ui-rail/);
    const jsonResponse = await request("application/json");
    assert.equal(jsonResponse.status, 403);
    assert.deepEqual(await jsonResponse.json(), { ok: false, code: "ORIGIN_REJECTED" });
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 0);
  } finally { await fixture.close(); }
});

for (const status of [400, 401, 403, 404, 409, 500]) {
  test(`AC2: the ${status} error page renders the app bar, empty-state card and one primary action, and keeps data-error-code and data-status`, () => {
    const html = errorPage({ status, code: 'TEST_<CODE>', title: 'An <error>', message: 'Try <again>', action: { href: "/", label: "Back to your conversation" } });
    assert.match(html, /class="ui-appbar"/);
    assert.match(html, /ui-empty/);
    assert.match(html, /data-error-code="TEST_&lt;CODE&gt;"/);
    assert.match(html, new RegExp(`data-status="${status}"`));
    assert.equal((html.match(/ui-button--primary/g) ?? []).length, 1);
    assert.match(html, /ui-button--block/);
    assert.doesNotMatch(html, /ui-rail|<error>|<again>/);
  });
}
