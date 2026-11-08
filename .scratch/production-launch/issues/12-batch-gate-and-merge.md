# Batch gate and merge to main

Status: claimed
Type: task
Blocked by: 01, 03, 04, 05, 06, 07, 08, 09 (10, 11 if done)

## What to do

Follow AGENTS.md "Test scope" and "Orchestrating agents":

1. In a dedicated merge worktree at the batch tip, run `npm run check`, `npm run test:workers` and the full `npm test` once (background, long timeout).
2. Triage any red file by running it alone first. Accepted known failures are listed in AGENTS.md ("Known accepted failures"); anything else is fixed before merging.
3. Ask the owner for explicit approval to merge to main, then separately to push.

## Acceptance criteria

- [x] AC1: The three commands, their pass counts and any accepted failures are recorded in Comments with the commit sha.
- [ ] AC2: The merge to main and the push each have the owner's explicit approval, recorded with the date.
- [ ] AC3: `git status` in the main checkout shows no owner edit lost (nothing stashed, reset or discarded).

## Comments

- 2026-11-08 (agent): Final gate on commit `9f7f919` in the batch worktree `C:\AI2026\chat-marketplace-production-launch`. No merge and no push were performed.
- Test environment (important): the local Guest suite expects the Paystack variables **unset**, so its deterministic PSP serves the local card flows; setting a synthetic `PAYSTACK_SECRET_KEY` makes the local card checkout attempt a network call and fails several unrelated tests. The run used `NODE_ENV=test`, `SHORTLET_CONDITIONAL_OFFER_KEY=local-only-test-conditional-offer-key-0123456789` (issue 03 requires at least 32 characters in production-shaped compositions), `SHORTLET_GUEST_CODE_HASHING_KEY=local-only-test-guest-code-hashing-key-0123456789`, with `LLM_API_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_ENVIRONMENT` and `PAYSTACK_CALLBACK_BASE_URL` unset. Values are synthetic; no secret was read or printed.
- `npm run check`: clean (Node, Worker, Worker test and tooling type checks plus the Worker bundle guard).
- `npm run test:workers`: 32 files, 199/199 tests passed.
- `npm test`: Phase 1 (concurrent, 379 files) 2975 tests, 2971 passed, 4 failed. Phase 2 (real browser, 39 files) 35 files passed, 4 failed, 0 timed out; 239 tests, 231 passed, 5 failed, 3 skipped.
- Accepted known failures: `commerce-store-pages.real-browser.test.ts`, `commerce-surfaces-chromium.test.ts` (commerce is not shipping, AGENTS.md accepts these).
- Load flakes that pass solo (verified again in this pass): `guest-cross-tab-concurrency.test.ts`, `model-quota-host-recovery.test.ts`, `guest-journey-rail-chromium.test.ts`, `guest-waiting-states-chromium.test.ts`. `pilot-local.test.ts` and the Extended Stay, reservation and owner-surface suites now pass.
- Pre-existing reds fixed before this final run: issue 03's mandatory conditional-offer signing key was missing from the demo Extended Stay, operator-session, production-owner and operator-restart fixtures (about 63 tests, commits `26e787b`, `9f7f919`); stale issue-04 expectations (Reservation phone, production contact disclosure, Standard tier and 90/10 payout plan) were updated with the stored-contact fixtures; `pilot-local` AC14 supplies the production key; and the guest shell now reuses only an explicitly requested server-issued thread id, minting a fresh one otherwise, so reloads keep their conversation while new tabs stay isolated (this replaced a last-thread reuse that shared one conversation across tabs and broke the browser discovery tests).
- Remaining unexplained failure: none. `paystack-real-browser.test.ts` was not run against a real sandbox in this pass; it is credential-dependent and out of scope offline.
- AC3: nothing was stashed, reset or discarded in any checkout. The owner's edits in `C:\AI2026\chat-marketplace` remain untouched. (A temporary base-check worktree was removed after verifying pre-existing failures; its removal followed a Windows `node_modules` junction and emptied the shared dependency directory, which was restored with `npm ci --include=dev`.)
- AC2 remains open: the owner must approve the merge to main and then, separately, the push.
