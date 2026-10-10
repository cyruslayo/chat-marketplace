<objective>
Deliver slice B0 of the back-office plan: record a green baseline and extract one shared operator sign-in test helper at `test/helpers/operator-session.ts`. The back office (`apps/local-owner`, served at `/operator/*`) is about to be rebuilt over slices B1–B3 (milestone M1: "you see what is waiting and answer within the 30-minute window"). Every one of those slices must test the same failure paths: no session, an expired or revoked session, a revoked grant, and a cross-origin POST. Today each test file copies its own login-and-cookie code. One helper makes those tests short and consistent. This slice changes test code only, with no product behaviour.
</objective>

<context>
- The plan is `scratch/operator-dashboard/map.md` (identical copy at `.scratch/operator-dashboard/map.md`). Read the "Delivery rules" section and the slice table. B0 has no issue file; this prompt is its spec. The PRD is `PRD.md` in the same folder.
- Read `AGENTS.md` (implementation protocol, anti-patterns #4 "Duplicating Test Fixtures") and `docs/agents/coding-standards.md` before starting.
- Current duplicated sign-in code:
  - `test/operator-request-inbox.test.ts`: `journey()`, `get()`, `post()` at the top of the file. Login is a POST of `token` to `/operator/login` with `redirect: "manual"`, and the cookie is built by splitting the `set-cookie` header. The expired-clock test (AC15) and the restart tests (AC23, AC25) repeat the same login inline.
  - Also check `test/operator-authentication.test.ts`, `test/pilot-local.test.ts` and `test/pilot-production-composition.test.ts` for the same pattern.
- Server under test: `startLocalOwnerServer` in `apps/local-owner/src/local-owner-server.ts`. Cookies are `OPERATOR_SESSION_COOKIE` and `OPERATOR_SECRET_COOKIE`. `browserOriginAccepted` rejects a POST whose `Origin` is not the public origin with 403.
- Environment: `LocalApartmentOwnerEnvironment` in `apps/local-owner/src/local-owner-environment.ts`. It provides `provisionOperatorAccessToken()`, `sessionAuthority` (`revokeSession`), `grantStore` (`listGrants`, `revokeGrant` with a `createPlatformCommandEnvelope` admin principal, as in AC26 of the inbox test) and a `clock` config option.
- Existing helpers live in `test/helpers/` (for example `guest-restart.ts` and `paystack-http.ts`). Match their style.
- Relevant ADRs: 0082 (representative grants, fail closed on revocation) and 0086 (operator sign-in and 12-hour session). Read both.
</context>

<requirements>
1. Run `npm run check` and `npm test` on a fresh branch `bo/b0-operator-session-helper` created from `main`, and record the baseline. The known-flaky tests under full-suite load are listed in `git show HEAD:scratch/map.md` (search "flaky"); they pass when run alone.
2. Add `test/helpers/operator-session.ts`. It should export typed helpers (no `any`) that:
   - sign in against a running operator server with a freshly provisioned token and return the cookie header;
   - issue an authenticated GET and POST, with an optional cookie override and optional extra headers, where POSTs use `redirect: "manual"`;
   - make a cross-origin POST, sent with a foreign `Origin` header;
   - revoke the current session (via logout or `sessionAuthority`);
   - revoke the representative grant for the fixture owner;
   - start a server over an environment with a supplied clock, so expiry can be tested.
   Keep the API small, and design it around what B1–B3 will need for the four standard failure paths in the map's delivery rules.
3. Move `test/operator-request-inbox.test.ts` onto the helper, including the inline logins in AC15, AC23 and AC25. Move the other operator test files onto it where they repeat the same login. Test names and assertions stay unchanged.
4. Add a small `test/operator-session-helper.test.ts` that shows the helper produces each failure path against the current server: no session → 401, logout → 401, cross-origin POST → 403, and revoked grant → a confirm is refused. Assert today's actual behaviour. B1 will change the "expired session lands on sign-in" behaviour later.
</requirements>

<constraints>
- Test code only: do not edit `apps/`, `domains/` or `packages/`. B1 is the next slice to edit `local-owner-server.ts`, and the map allows only one slice at a time on that file.
- Keep every existing test name and assertion. This is a refactor, and a changed assertion would hide a regression.
- The working tree has many unrelated untracked and deleted files (`scratch/`, `.scratch/`, `HANDOFF-*.md`, `docs/design/...`). Stage only the files you changed, by explicit path. Never use `git add -A` or `git add .`.
</constraints>

<assumptions>
- Branch from `main`. ADRs 0088–0090 exist only on branch `adr/payments-and-margin` (PR #68). B0 does not need them; read them with `git show adr/payments-and-margin:docs/adr/<file>` if you want context.
- Commit locally. Do not push or open a PR, because the user reviews per milestone and will decide when to publish.
</assumptions>

<verification>
- `npm run check`: zero errors.
- `npm test`: all tests pass, or the only failures are known-flaky tests that pass when run alone with `npx tsx --test test/<file>.test.ts`. Show that.
- `npx tsx --test test/operator-request-inbox.test.ts test/operator-session-helper.test.ts` passes.
- Grep the test folder to confirm no operator test still builds the login cookie by hand.
</verification>

<done_when>
- `test/helpers/operator-session.ts` exists, is typed, and is used by every operator test that signs in.
- The helper's own test covers the four standard failure paths.
- Check and tests are green, and the work is one commit on `bo/b0-operator-session-helper`.
- The "Context pointers" section of `scratch/operator-dashboard/map.md` has a one-line B0 entry naming the helper and its exports. Make the same edit in `.scratch/operator-dashboard/map.md`, since both copies exist.
</done_when>

<report>
- Status: done / partial / blocked (and why)
- Files changed
- Baseline results before the change, and results after it (paste failures verbatim)
- The helper API, as a list of its exports with a one-line purpose each, because B1–B3 will rely on it
- Follow-ups or assumptions that turned out wrong
</report>
