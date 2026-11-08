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

- [ ] AC1: The three commands, their pass counts and any accepted failures are recorded in Comments with the commit sha.
- [ ] AC2: The merge to main and the push each have the owner's explicit approval, recorded with the date.
- [ ] AC3: `git status` in the main checkout shows no owner edit lost (nothing stashed, reset or discarded).

## Comments

- 2026-11-08 (agent): Gate run in the batch worktree `C:\AI2026\chat-marketplace-production-launch` on commit `26e787b` (after resolving 09, 10 and 11). No merge and no push were performed.
- Test environment: the owner's shell supplies the Paystack and conditional-offer settings. This session used synthetic, non-secret test values only: `NODE_ENV=test`, `PAYSTACK_SECRET_KEY=sk_test_synthetic_offline`, `PAYSTACK_ENVIRONMENT=test`, `PAYSTACK_CALLBACK_BASE_URL=http://127.0.0.1:3001`, `SHORTLET_CONDITIONAL_OFFER_KEY=local-only-test-conditional-offer-key-0123456789`, `SHORTLET_GUEST_CODE_HASHING_KEY=local-only-test-guest-code-hashing-key-0123456789`, with `LLM_API_KEY` unset.
- `npm run check`: clean (Node, Worker, Worker test and tooling type checks plus the Worker bundle guard).
- `npm run test:workers`: 32 files, 199/199 tests passed.
- `npm test`: Phase 1 (concurrent, 379 files) 2975 tests, 2962 passed, 13 failed. Phase 2 (real browser, 39 files) 31 files passed, 8 failed, 0 timed out; 239 tests, 224 passed, 12 failed, 3 skipped.
- Accepted known failures observed (AGENTS.md list): `commerce-store-pages.real-browser.test.ts`, `commerce-surfaces-chromium.test.ts` (commerce is not shipping).
- Known load flakes observed (listed in AGENTS.md as passing solo): `model-quota-host-recovery.test.ts`, `guest-cross-tab-concurrency.test.ts`, `pilot-local.test.ts` AC4.
- Pre-existing failures at the batch base (three verified by running them at `4695b0a` in a temporary detached worktree): `back-office-reservation.test.ts` AC1 (expects a Guest phone the issue-04 fixtures do not store), `guest-sign-in-offer.test.ts` (2 tests; the shared `restartFixture` discovery turn fails), `local-apartment-owner-surface.test.ts` (expects the superseded ADR 0083 "preferred" tier, while the issue-04 owner decision is Standard until observed reliability exists), `extended-stays-every-deployment.test.ts` AC1 (production contact requirement from issue 04), `pilot-local.test.ts` AC14/AC26/AC27 (environment-sensitive Paystack failure path and payment-handoff copy), `paystack-real-browser.test.ts` (needs a real sandbox), and browser `discovery-phase3-chromium`, `guest-compare-chromium`, `guest-focused-phone-shell-chromium`, `guest-sign-in-offer-chromium`. Each was triaged solo; none touches 09, 10 or 11.
- Gate reds repaired in this pass: issue 03 made the conditional-offer signing key mandatory in production, and the demo Extended Stay, operator-session, production owner and operator-restart fixtures did not supply it (about 63 tests). The fixtures now supply the deployment key or the documented local-only key. `WORK-MAP.md` was regenerated from the resolved issue files. Commits `120e356`, `b6de573`, `af23bc5`, `26e787b`.
- AC2/AC3: not satisfied. The owner must approve the merge to main and then, separately, the push. Nothing was stashed, reset or discarded in any checkout. (A temporary base-check worktree was removed after verification; its removal followed a Windows `node_modules` junction and emptied the shared dependency directory, which was restored with `npm ci --include=dev`.)
