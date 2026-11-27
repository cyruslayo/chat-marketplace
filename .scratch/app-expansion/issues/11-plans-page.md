# The guest's list at `/plans`

Status: resolved
Type: task
Blocked by: none (10 resolved; D8, D9, D10 accepted 27 Nov 2026). Opening a row from a signed-in second device needs guest-accounts 13; until it lands, that device keeps today's refusal. Replaces guest-stays 03 and 04

## What to build

- `GET /plans`, plain HTML first (ADR 0080), from the kit's Your stays board. Title "Your stays" with one domain, "Your plans" with more.
- States: several, one, empty, error, loading; signed out as D8 decides.
- Entry points: the committed-work note, the account page, and the assistant's status reply (parity).
- A shared-device review recorded in Comments before code, if D8 is yes.

## Acceptance criteria

- AC1: Every cell of the rules 02 decision table (viewer × booking) is tested.
- AC2: After sign-out, no account row is visible.
- AC3: Each row opens its own page; a row whose state has changed opens the current state.
- AC4: Chat and page show the same rows and words.
- AC5: It works without JavaScript; captures at 320, 390, 768 and 1280, light and dark.
- AC6: `/plans` with no session is refused and reveals nothing.

## ADR compliance

0005, 0071, 0074, 0077, 0078, 0080, 0085, 0093, 0106.

## Comments
- 27 Nov 2026: owner accepted D8 (works on this device's own session, after the shared-device review), D9 (lists open requests and expired offers) and D10 ("Your stays", address `/plans`). Build for this device first; linked-device row pages follow guest-accounts 13.
- 27 Nov 2026 (Shared-device review for D8, recorded before code):
  - **Exposure:** Another person using the same unlocked browser sees live and past/ended rows for that browser's device session. `/api/committed-work` already exposes live work to that session; the incremental exposure from `/plans` is past/ended rows (declined/expired requests, expired/stale/revoked offers, past/cancelled stays).
  - **Bounds & mitigations:** Rows are strictly redacted per ADR 0071 and ADR 0075 (no prices, contact details, addresses, credentials/tokens, or identity facts); `GET /plans` responds with `Cache-Control: no-store` so browsers and caches do not retain it; `POST /account/sign-out` immediately drops all account rows from that browser (rules 02 S8); `GET /plans` with no session returns `401` and reveals nothing (AC6).
  - **Linked-device scope:** Opening a row's own page from a signed-in second device keeps today's refusal until `guest-accounts 13` lands.
- 27 Nov 2026 (resolved):
  - Implemented `GUEST_PLANS_COPY` (`apps/web-agent/src/guest-content.ts`), `planRowHtml` / `plansListHtml` / `plansChatCardProps` (`apps/local-guest/src/guest-kit.ts`), `LocalGuestApp.packs` (`apps/local-guest/src/shortlet-app.ts`), `GET /plans` (`apps/local-guest/src/guest-server.ts`, `401` with `Cache-Control: no-store` when no session), entry links in `client.ts`, `renderNoScriptConversationHtml`, and `renderAccountHtml` (`apps/local-guest/src/guest-account-pages.ts`), and updated `test/guest-navigation.test.ts` (`/plans` promoted from planned to live `section` route).
  - Checks:
    - `npm run build` -> clean
    - `npm run check && npx tsx --test test/guest-plans-page.test.ts test/guest-navigation.test.ts` -> 12/12 passed (`guest-navigation.test.ts` 5/5, `guest-plans-page.test.ts` 7/7)
    - `npx tsx --test test/domain-plan-rows.test.ts test/assistant-cold-journey.test.ts` -> 12/12 passed (`domain-plan-rows.test.ts` 8/8, `assistant-cold-journey.test.ts` 4/4)
    - Captures under `.scratch/guest-ui-consistency/screenshots/11/` at 320, 390, 768, 1280 (light & dark): `overflow=false`, `smallTargets=[]` across all 8 frames.
