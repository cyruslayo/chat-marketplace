# 26: Bring main into the app-expansion line and renumber the cancellation migration to 7

Status: ready-for-agent
Type: task
Blocked by: none (owner decision D1 below shapes one AC)

## Why

Both lines add Shortlet schema migration **version 6** in `apps/cloudflare/src/schema.ts`:

| Line | Version 6 | Commit |
| --- | --- | --- |
| `main` | "founding partner applications" (`PARTNER_APPLICATION_SCHEMA`, landing issue 17) | edb74d7 |
| app-expansion (`feat/app-expansion` and every `feat/app-expansion-*`) | "durable cancellation cases" (`CANCELLATION_CASES_SCHEMA`, issue 05) | c167137 |

`applySchemaMigrations` (`packages/platform-core/src/schema-migrations.ts`) records only version numbers. It never compares names. A Durable Object already at version 6 therefore skips whatever the code now calls version 6, without any error. Every staging build prepared on 26 Nov (`chat-marketplace-staging-edb74d7`, `-bfe359d`, `-1c49d97`, `-884dd15`) carries partners as 6, and none carries issue 05. Staging may well be at partners = 6 already. If the app-expansion line kept cancellations at 6, staging would never create `cancellation_cases`, and the first cancellation would fail at runtime.

This also blocks 2b-08's follow-ups: `/partners` and the `/welcome` ↔ `/partners` links exist only on `main`.

## What to build

1. **Where.** Create a new worktree `C:\AI2026\chat-marketplace-ae-sync` on a new branch `feat/app-expansion-main-sync`.
   - Base it on the newest app-expansion commit, `feat/app-expansion-2b-08` (13063ad), which contains 07, 09, 2b-01, 2b-02 and 2b-08.
   - Junction `node_modules` as the other `ae-*` worktrees do.
   - When finished, remove the junctions with `cmd //c rmdir` **before** any `git worktree remove`, since a forced removal empties the shared install.
2. **Merge.** Run `git merge main` (4 commits past merge-base d1d5955: issue 17, its fix and two others). Resolve the conflicts:
   - `schema.ts`: keep main's `{ version: 6, name: "founding partner applications" }`, then add `{ version: 7, name: "durable cancellation cases", statements: [CANCELLATION_CASES_SCHEMA] }`. Keep both comments, and add a one-line ADR/issue note on why 7.
   - `do-export.ts`: the export table list holds both `cancellation_cases` and `partner_applications`, in sorted order.
   - Any other conflict (build script, asset loaders, `vitest.config.ts`, landing CSS/HTML): keep both sides. The landing files keep 2b-08's Xenia brand layer and main's `/partners` link and markup.
3. **Tests.**
   - `test/cancellation-always-finishes.test.ts:388` asserts `SHORTLET_SCHEMA_VERSION >= 6`. Make it look up the migration by name and assert version 7.
   - Add a test that pins the Shortlet migration list as append-only: the exact `[version, name]` pairs 1–7. Then a future branch that reuses a number fails a test, instead of skipping silently on a live object.
4. **Upgrade-path test** (Workers spec or Node, whichever fits `data-migration.spec.ts`):
   - a database migrated with main's list (at 6, partners) runs the merged list, applies only 7, and ends with both `partner_applications` and `cancellation_cases`;
   - a fresh database gets both tables;
   - a database at 5 gets 6 and 7.
5. **D1 (owner): runtime name guard.** Optionally make `applySchemaMigrations` fail closed when a stored name differs from the code's name for the same version. See the decision below.
6. **Follow-up in 2b-08's area, same branch.** The `/welcome` footer gets main's "For apartment operators" → `/partners` link back, and `test/partners-page.test.ts` cross-links pass.

## Acceptance criteria

- AC1: Partners stays version 6 and cancellations is version 7; `SHORTLET_SCHEMA_VERSION` is 7.
- AC2: A database at main's version 6 upgrades to 7 with `cancellation_cases` created and no other change. A fresh database and a database at version 5 reach 7 with both tables.
- AC3: The pinned `[version, name]` test fails if any existing entry is renumbered or renamed.
- AC4: `cancellation_cases` and `partner_applications` are both in `SHORTLET_EXPORT_TABLES`.
- AC5: `/welcome` keeps the 2b-08 brand layer and links to `/partners`; `/partners` renders as on main.
- AC6 (only if D1 = yes): a stored name that differs from the code refuses startup, with a closed error that carries no data.

## Decision for the owner

**D1. Add the runtime name guard?**
- **Recommended: no, test-only guard (AC3).** History shows one rename: Shortlet v3 was once named "guest accounts: linked principals, request claims and request contact snapshots" (commit 2e6e097). A staging object provisioned before that rename would refuse to start under a strict guard.
- **Yes**, with an allow-list of the known historical names, if the owner wants live objects protected against a mis-deployed branch.

## Operating notes

- Never deploy any `feat/app-expansion*` commit to staging before this lands. Its version 6 is cancellations, so on a staging object already at partners = 6 the cancellation table would never be created.
- Local SQLite files created from the app-expansion line (version 6 = cancellations) would skip partners. They are local test data only: delete them, or re-run with a fresh path.
- No merge to `main`, push or deploy without the owner's separate approval.

## ADR compliance

Read ADRs 0058, 0075 and 0095 (cancellation cases), the data-migration ADR (slice 16 / D3, `schema_migrations`) and the DPIA notes for personal-data tables (partner applications) before coding.

## Tests

- `npm run check`.
- `npx tsx --test test/cancellation-always-finishes.test.ts test/cutover-marker.test.ts` plus the new pin test, `test/partners-page.test.ts` and the landing unit tests.
- `npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts apps/cloudflare/test/landing-assets.spec.ts`.
- `test/landing-page-chromium.test.ts` solo.
- Record the commands and counts in `## Comments`. The full `npm test` and `test:workers` run at the batch gate.

## Comments
