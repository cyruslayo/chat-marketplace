import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createGuestRequestHandler } from "../apps/local-guest/src/guest-server.js";
import { GUEST_ACCOUNT_COPY, GUEST_PAYMENT_COPY } from "../apps/web-agent/src/guest-content.js";
import { bankTransferArtifactToA2UI } from "../apps/web-agent/src/bank-transfer-a2ui.js";
import { accountComposition, CapturingEmailSender } from "./helpers/guest-account-sign-in.js";
import { cookieOf, sendGuest } from "./helpers/guest-route-harness.js";
import { BOOKING_STAGE_PAGES, withStagePage } from "./helpers/guest-stage-pages.js";

// Issue 30 (D14): guest-facing name is Xenia; Operator screens, routes, storage keys, identifiers and Worker name stay.

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function visibleTextFromHtml(html: string): string {
  // Strip <link>, <script>, <style> and attribute values other than aria-label/title, keeping <title> text.
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1]! : "";
  const ariaLabels = [...html.matchAll(/\baria-label="([^"]*)"/gi)].map((m) => m[1]!).join(" ");
  const bodyOnly = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
  return `${title} ${ariaLabels} ${bodyOnly}`;
}

test("AC1: No live guest page, chat surface, or guest email shows 'Shortlet'; persona stays 'Concierge · Stays'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-xenia-"));
  const env = LocalGuestEnvironment.openNode({ databasePath: join(dir, "guest.sqlite") });
  const handler = createGuestRequestHandler(env);
  try {
    const home = await sendGuest(handler, "GET", "/");
    const cookie = cookieOf(home);
    const routes = [
      { path: "/", res: home },
      { path: "/plans", res: await sendGuest(handler, "GET", "/plans", { cookie }) },
      { path: "/stays/search?area=old-ikoyi&checkIn=2026-10-28&checkOut=2026-10-31&partySize=2", res: await sendGuest(handler, "GET", "/stays/search?area=old-ikoyi&checkIn=2026-10-28&checkOut=2026-10-31&partySize=2") },
      { path: "/account/sign-in", res: await sendGuest(handler, "GET", "/account/sign-in", { cookie }) },
      { path: "/guest/contact", res: await sendGuest(handler, "GET", "/guest/contact", { cookie }) },
      { path: "/welcome", res: await sendGuest(handler, "GET", "/welcome") },
    ];
    for (const entry of routes) {
      const visible = visibleTextFromHtml(entry.res.bodyText);
      assert.doesNotMatch(visible, /\bShortlet\b/i, `${entry.path} must not show 'Shortlet'`);
      assert.doesNotMatch(visible, /Tolu from the Xenia team/i, `${entry.path} must not show unapproved sample name`);
    }
    assert.match(visibleTextFromHtml(home.bodyText), /\bXenia\b/, "home page shows Xenia wordmark");

    // Email templates
    assert.doesNotMatch(GUEST_ACCOUNT_COPY.emailSubject, /\bShortlet\b/i);
    assert.match(GUEST_ACCOUNT_COPY.emailSubject, /\bXenia\b/);
    assert.doesNotMatch(GUEST_ACCOUNT_COPY.emailBody("123456", 10), /\bShortlet\b/i);
    assert.match(GUEST_ACCOUNT_COPY.emailBody("123456", 10), /\bXenia\b/);
    assert.doesNotMatch(GUEST_ACCOUNT_COPY.emailChangeSubject, /\bShortlet\b/i);
    assert.match(GUEST_ACCOUNT_COPY.emailChangeSubject, /\bXenia\b/);
    assert.doesNotMatch(GUEST_ACCOUNT_COPY.emailChangeBody("123456", 10), /\bShortlet\b/i);
    assert.match(GUEST_ACCOUNT_COPY.emailChangeBody("123456", 10), /\bXenia\b/);
    assert.doesNotMatch(GUEST_PAYMENT_COPY.lateReview, /\bShortlet\b/i);
    assert.match(GUEST_PAYMENT_COPY.lateReview, /\bXenia\b/);

    // Bank transfer late payment A2UI surface
    const lateMessages = bankTransferArtifactToA2UI({
      surfaceId: "s-1",
      artifact: {
        artifactId: "bt-1",
        kind: "bank_transfer",
        actions: [],
        facts: {
          offerId: "offer-1",
          unit: "2-bedroom apartment",
          checkIn: "2026-12-03",
          checkOut: "2026-12-06",
          nights: 3,
          status: "late_payment_refund_pending",
          amountDueNowKobo: 100_000,
          currency: "NGN",
          expiresAt: "2026-10-27T12:00:00.000Z",
          bankName: "Demo Bank",
          accountNumber: "0123456789",
          accountName: "Demo Account",
        },
      } as unknown as Parameters<typeof bankTransferArtifactToA2UI>[0]["artifact"],
    });
    const lateTexts = lateMessages
      .flatMap((m) => ("updateComponents" in m ? m.updateComponents.components : []))
      .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
      .join(" ");
    assert.doesNotMatch(lateTexts, /\bShortlet\b/i);
    assert.match(lateTexts, /\bXenia\b/);
  } finally {
    env.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // Stage pages (request, offer, payment, confirmed)
  for (const spec of BOOKING_STAGE_PAGES) {
    await withStagePage(spec, async ({ fixture, path }) => {
      const response = await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie, accept: "text/html" } });
      assert.equal(response.status, 200, `${spec.label} returned 200`);
      const visible = visibleTextFromHtml(await response.text()).replace(/Shortlet Test Ltd/g, "");
      assert.doesNotMatch(visible, /\bShortlet\b/i, `stage ${spec.label} must not show 'Shortlet'`);
    });
  }
});

test("AC2: Operator screens, routes, storage keys, identifiers and Worker name are unchanged", () => {
  const cfConfig = readFileSync(join(REPO_ROOT, "apps/cloudflare/cloudflare.config.ts"), "utf8");
  assert.match(cfConfig, /shortlet-pilot/);
  const serverSource = readFileSync(join(REPO_ROOT, "apps/local-guest/src/guest-server.ts"), "utf8");
  const accountRuntimeSource = readFileSync(join(REPO_ROOT, "apps/local-guest/src/guest-account-runtime.ts"), "utf8");
  assert.match(serverSource, /shortlet_guest_session/);
  assert.match(accountRuntimeSource, /shortlet_guest_account/);
  assert.match(serverSource, /\/shortlet-foundations\.css/);
  const backOffice = readFileSync(join(REPO_ROOT, "apps/local-owner/src/back-office-view.ts"), "utf8");
  assert.ok(backOffice.length > 0);
});
