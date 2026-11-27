# Guest-facing name: Xenia

Status: resolved
Type: task
Blocked by: none (D14 accepted 27 Nov 2026)

## What to build

- Replace "Shortlet" with "Xenia" in guest-facing copy only (D14): the chat app bar wordmark, page titles, guest emails and sign-in code text, and the strings in `design/round-12/copy-decisions.md` that wait only on D14 ("Contact Xenia if you sent money after the deadline", "Your Xenia sign-in code is {code}").
- Copy comes from `apps/web-agent/src/guest-content.ts` and `apps/local-guest/src/landing-copy.ts`. Package names, code identifiers, domain terms in `CONTEXT.md`, Operator screens, logs and the Worker name do not change.
- The persona label stays "Concierge · Stays" (ADR 0107); "Tolu from the Xenia team" still waits on the Language page.

## Acceptance criteria

- AC1: No guest page, chat surface or guest email shows "Shortlet"; a test scans the rendered guest routes and the email templates.
- AC2: Operator screens, routes, storage keys and identifiers are unchanged.
- AC3: Captures at 320, 390, 768 and 1280, light and dark, for the app bar, sign-in and one email preview.

## Comments

- D14 also asks for a trademark check before public launch; that is the owner's, not this issue's.
- 27 Nov 2026 (resolved):
  - Replaced guest-facing `"Shortlet"` with `"Xenia"` in `apps/web-agent/src/guest-content.ts` (`GUEST_ACCOUNT_COPY`, `GUEST_PAYMENT_COPY.lateReview`), `apps/web-agent/src/bank-transfer-a2ui.ts`, `apps/web/src/ui-kit.ts`, `apps/local-guest/src/guest-server.ts`, `apps/local-guest/src/client.ts` (and `"Ask the concierge"`), and `apps/local-guest/src/shortlet-app.ts` (`You will leave Xenia temporarily...`). Persona label stays `"Concierge · Stays"` (ADR 0107); `"Tolu from the Xenia team"` held back. Operator screens, routes, storage keys, identifiers and Worker name (`shortlet-pilot*`) unchanged.
  - Checks:
    - `npm run build` -> clean
    - `npm run check && npx tsx --test test/guest-brand-xenia.test.ts test/guest-account-pages.test.ts test/guest-account-sign-in.test.ts test/guest-account-page.test.ts test/guest-ui-kit.test.ts` -> 109/109 passed (`guest-brand-xenia.test.ts` 2/2)
    - Captured 24 screenshots (`appbar`, `signin`, `email` × 320/390/768/1280 × light/dark) under `.scratch/guest-ui-consistency/screenshots/30/`.
