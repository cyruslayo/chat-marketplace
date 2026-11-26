# 17 · Founding partners page at `/partners`

Status: in-progress
Type: task
Blocked by: none for the build. Publishing is blocked by "Before publishing" below.
Requested: 25 Nov 2026

## Why

The design team finished the Xenia page that recruits apartment operators in Abuja (`Xenia Founding Partners Abuja.html`, pass 11, 25 Nov 2026; reviews in `.scratch/brand/review/`). The app has no page for operators: `/welcome` speaks to guests.

## Owner decisions, 25 Nov 2026 (chat)

1. The operator page lives at `/partners`; the guest page stays at `/welcome`; each links to the other. The Xenia look for `/welcome` is a follow-up.
2. The application form stores applications on the server. It stays closed until a privacy notice exists.
3. The design's Contact and Privacy footer links are left out until they have targets.

## What to build

1. **The page.** Every section, string and figure of the design, light and dark, from its own stylesheet (`xenia-partners.css`) and copy module. No inline styles; colour values only in the marked token block. It does not load `shortlet-foundations.css`, whose `.ui-*` rules are still the earlier look (app-expansion issue 07 and phase 2b move them).
2. **The Demo stage.** Six frames of one guest's booking, from kit components. Server HTML shows all six stacked with their captions (ADR 0080 parity); the script turns them into one stage with Previous, Next and Start again. No autoplay. The screen is inert and nothing in it submits. Shipped guest strings come from `guest-content.ts` (ADR 0077).
3. **The application.** `POST /partners/apply`, validated on the server by the same rules the browser uses, stored with the consent sentence, the privacy notice address and the time. Works without JavaScript. Open only when `SHORTLET_PARTNER_PRIVACY_URL` is a valid HTTPS address; otherwise the page shows no fields and the POST is refused.
4. **Links.** `/partners` footer to `/welcome`; `/welcome` footer to `/partners`.

## Acceptance criteria

- AC1: `GET /partners` renders every section of the design with its exact copy, public, with no session cookie, no inline style and no third-party request.
- AC2: Without JavaScript all six demo frames and their captions are in the document in order; the screen content is inert and holds no form action.
- AC3: With JavaScript one frame shows at a time; Previous, Next and Start again change it, announce "Step n of 6: Name", keep focus on the pressed control and never move the window.
- AC4: With no privacy notice configured the page shows no application fields and `POST /partners/apply` stores nothing (fail closed). A malformed setting stops startup.
- AC5: With it configured a valid application is stored once with its consent record, and the answer is a redirect to a page that says "Application sent."; sending the same form twice stores one row.
- AC6: An invalid application stores nothing, answers 422 with the design's messages, keeps what was typed and focuses the first wrong field.
- AC7: A cross-origin POST and an oversized body are refused; repeated POSTs from one address are rate limited; no application value reaches a log, a URL or a redirect.
- AC8: The table is a schema migration, is in the daily export list, and is read by the owner through the existing `/_ops/export` route.
- AC9: ADR 0078: no horizontal overflow and no control under 44px at 320, 390, 768 and 1280, light and dark. Captures in `screenshots/17/`.
- AC10: `/welcome` and `/partners` link to each other; every existing landing test still passes.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0004 | The backend owns state | Application store in the object's SQLite; the browser check only repeats the server's |
| 0075 | No restricted data in URLs, logs or projections | POST body only; redirect carries no value; nothing logged |
| 0077 | One source for guest wording | Demo frames import `guest-content.ts` |
| 0078 | WCAG 2.2 AA, 44px, 320px, WAT times, text before media | Markup, CSS, captures |
| 0080 | A conventional route for every critical task | Form and demo work without JavaScript |
| 0081 | Identical bytes from Node and the Worker | Same build copies the CSS and script to static assets |
| 0095 | Real personal data waits for the production gates | The form is closed unless configured |
| 0099 | Public marketing routes before the domain dispatch; hosts compose only | `partners-route-module.ts` |
| 0105 | Demo listings are labelled | "Demo listing" on every demo apartment; stage label |

## Before publishing (owner)

- Privacy notice, retention period and deletion route for applications (ADR 0075 periods are provisional; ADR 0095 gates apply to real applicants).
- Counsel review of the payment, authority and insurance wording.
- "When a question needs a person, it goes to our team": true only once there is a support contact (app-expansion D6, D13).
- An NDPA decision on ad tracking ("we track which ads bring guests in").
- "Are guests booking yet? Not yet." while `/welcome` invites guests to book.
- New strings written for this build, not in the approved copy: see Comments.

## Comments

26 Nov 2026 (Claude): built on `feat/partners-landing` (worktree `C:\AI2026\chat-marketplace-partners`, from main d1d5955). Not committed yet.

- **Checks run:**
  - `npm run check`: clean.
  - `npx tsx --test test/partners-page.test.ts`: 14 of 14 pass.
  - Affected tests, together with the line above: 13 files, 213 of 213 pass. The other 12 files are `landing-page`, `landing-handoff`, `landing-monthly-copy`, `demo-mode-landing`, `guest-account-linking`, `guest-identity-assurance`, `schema-migrations`, `export-node-sqlite`, `asset-loader`, `pilot-guardrails`, `cloudflare-config` and `demo-mode-config`.
  - `npx tsx --test test/partners-page-chromium.test.ts`: 3 of 3 pass.
  - `npm run test:workers -- apps/cloudflare/test/landing-assets.spec.ts apps/cloudflare/test/data-migration.spec.ts`: 33 of 33 pass.
  - The full `npm test` and `test:workers` belong to the batch gate and were not run.
- **Captures:** `npx tsx .scratch/landing-page/capture-17.ts 17` covers 320, 390, 768 and 1280, light and dark, every page and every demo step. Results: no overflow, no control under 44px, no text under 12px, every naira amount in Newsreader, and no contrast failure on solid grounds. On every step the must-see parts are inside the screen. Findings are in `screenshots/17/findings.txt`.
- **Copy:** a word-for-word comparison with the design finds only lines that were merged or split, plus the owner's three decisions (no Contact or Privacy links, a footer link to `/welcome`, the privacy link). Nothing else differs.
- **New strings, waiting for approval:**
  - "Sending…";
  - "How we use your details";
  - "Applications open soon." and the sentence under it;
  - the message when an application cannot be saved;
  - "Looking for a place to stay?" (`/partners` footer);
  - "For apartment operators" (`/welcome` footer).
- **Departures from the design:**
  - The demo screens' links and buttons are pictures (spans), not controls (spec §5, inert).
  - The request card and partner home have real borders, so their outline shows behind the header.
  - The design's "Step 6 · Payment" eyebrow is kept, although the numbered steps it belonged to were removed in pass 5. Ask the owner.
- **Reading applications:** `GET /_ops/export?table=partner_applications`, behind Access and the ops secret.
- **To open the form:** set `SHORTLET_PARTNER_PRIVACY_URL` (an HTTPS address) once the privacy notice exists.
- **Generated files:**
  - `apps/cloudflare/public/_headers` gains the two new assets. That is a real change, so it should be committed.
  - `dist/partners.js` is committed like `landing.js`.
  - The build also rewrote `dist/client.js`, which this work does not change, so it is not part of this commit.
