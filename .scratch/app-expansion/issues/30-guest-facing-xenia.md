# Guest-facing name: Xenia

Status: ready-for-agent
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
