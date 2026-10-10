# Back-office shell and "waiting on you" home

Status: resolved
Type: task
Blocked by: B0

## What to build

Every back-office page renders through one layout with:
- your name;
- navigation (links only for shipped slices);
- Log out.

It builds on `shortlet-foundations.css` and `pageShell`, and changes no Guest page. The home page replaces the actor and tenant ids with what is waiting on you, soonest first:
- requests to answer, with WAT deadlines;
- manual transfers to verify, once B6 ships;
- owner payouts due, once B7 ships.

Fix the pilot startup banner so it prints `/operator/login` (pilot FINDINGS M4).

## Acceptance criteria

- AC1: Every back-office page shares one header with your name, navigation and Log out, and no page uses an actor, tenant, request or unit id as its main label.
- AC2: Home lists what is waiting on you, soonest deadline first, each with its owner, apartment and absolute WAT deadline, linking to the item; with nothing waiting it says so.
- AC3: An expired or revoked session lands on sign-in with a plain reason, and an action for an owner whose grant was revoked is denied.
- AC4: Pages reflow at 320px with 44px targets, and the pilot startup banner prints the `/operator/login` URL.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0078 | 320px, 44px targets, absolute WAT |
| 0082 | grant per owner re-checked per action |
| 0086 | session expiry and revocation fail closed |
| 0075 | no raw ids as labels |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [ ] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [ ] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `bo/b1-back-office-home` (stacked on B0).

- **Shared layout:** `backOfficePage({ title, viewer, current, body, style? })` in `apps/local-owner/src/back-office-view.ts`.
  - It wraps `pageShell` and adds one `bo-header` with your name (`env.representativeDisplayName`), the `BACK_OFFICE_NAV` links (Home, Requests) and Log out.
  - Home, the inbox, request detail and the not-found page all render through it. Sign-in keeps the narrow `pageShell`.
- **Names instead of ids:** `env.requestLabels(requestId)` gives the owner name and apartment title.
  - Owner name comes from the operator repository, then the unit's operator, then the config.
  - Raw ids now appear only in `href` and `data-*` attributes.
- **Home:** a `WaitingItem` union with only `kind: "request"` for now.
  - To add a kind later: extend the union, add its builder in `waitingItems`, and the list stays sorted by `dueAt`.
  - Deadlines are the projected `operatorResponseDeadlineAt`, rendered as `<time datetime>` with absolute WAT.
- **Sign-in reasons:** `SqliteOperatorSessionAuthority.sessionRejection` returns `missing`, `expired` or `revoked`. It fails closed: without a matching secret the result is always `missing`.
  - A page GET with no usable session gets a 303 to `/operator/login`, with `?reason=expired` or `?reason=signed-out` when the reason is known.
  - Unknown reason codes are ignored.
  - Action POSTs still return 401.
- **Startup banner:** `apps/pilot/src/startup-banner.ts`. The local banner prints `http://127.0.0.1:<port>/operator/login`; production prints `operatorLogin=<origin>/operator/login`.
- **Tests:** `test/back-office-home.test.ts` has AC1–AC4. It uses the new helper `startSignedInOperator`, and `operatorGet` no longer follows redirects.

**Changed legacy assertions** (401 on page GETs becomes a 303 to sign-in):
- `operator-session-helper` no-session, logout, revoked and expired tests;
- `operator-authentication` AC31 and AC32;
- `operator-request-inbox` AC2 and AC27 (AC27 also asserts the POST still returns 401);
- `pilot-local` AC5, now 303, with the heading wait changed to "Waiting on you";
- `shortlet-ui-foundations`, same heading wait.

**ADRs:**

| ADR | Where it's reflected |
|---|---|
| 0078 | 320px reflow, 44px `--control-min-target` on header controls, absolute WAT via `watTime`. Measured at 320, 375 and 1280: no overflow and no target under 44px. |
| 0082 | Home and inbox use `listOperatorRequestArtifacts`, which checks the grant per owner. A revoked grant empties home and makes confirm return 409. |
| 0086 | A page without a usable session redirects to sign-in, and a POST without one returns 401. `sessionRejection` gives a reason only when the secret matches. |
| 0075 | No id is used as a visible label. No new logs or telemetry. |
| 0041 / 0077 | "Respond by" uses the projected deadline, never a recalculated one. |

**Definition of Done**
- Each AC has one named test, and the failure paths are asserted in AC3:
  - no session: GET 303, POST 401;
  - expired and revoked sessions;
  - forged secret;
  - cross-origin POST: 403;
  - unknown target: 404 inside the layout;
  - revoked grant: 409.
- The ADRs are mapped above, and no policy strings were invented.
- No secrets reach logs.
- Walkthrough at 320, 375 and 1280, and no JavaScript is shipped on any back-office page.
- `npm run check` is clean. `npm test` gave 1188 passed and 0 failed.
