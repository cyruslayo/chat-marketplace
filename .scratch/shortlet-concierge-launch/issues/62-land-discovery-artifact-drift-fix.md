# Land issue 56 defect 1 on fix/chat-hardening

Status: resolved
Type: HITL (commit approval)
Blocked by: none
Blocks: 57, 58, 59, 60, 61 (they build on the same branch)
Requested: 9 Nov 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62.

## Why

The fix for issue 56 defect 1 (the discovery artifact id is re-minted, so View apartment returns `ARTIFACT_MISMATCH`) is in the **main checkout's working tree** on `docs/landing-art-direction`, uncommitted. That checkout also holds many owner edits. The fix has to land on its own branch from `main` before 57–61 build on it.

## What to do

1. Create a dedicated worktree from `main`: `git worktree add C:\AI2026\chat-marketplace-hardening -b fix/chat-hardening main`. Junction `node_modules` and `apps/cloudflare/node_modules` from an existing worktree, as `chat-marketplace-merge` does.
2. In the main checkout, confirm that `git diff apps/local-guest/src/shortlet-app.ts` shows only the `#syncAssistantPersistence` hunk: about 5 lines, passing `currentArtifact?.id ?? thread.discoveryArtifactId` as `keepArtifactId`. Export it with `git diff -- apps/local-guest/src/shortlet-app.ts > <scratchpad>/56.patch` and apply it in the worktree with `git apply`.
3. Copy these untracked files into the worktree:
   - `test/assistant-discovery-artifact-drift.test.ts`
   - `.scratch/shortlet-concierge-launch/issues/56-…md` and `57`–`62`
   - `.scratch/weaver-catalogues/notes/2026-11-09-stale-artifact-actions.md`
4. In the worktree, run `env -u LLM_API_KEY npm run check` and `env -u LLM_API_KEY npx tsx --test test/assistant-discovery-artifact-drift.test.ts`. Expect 8 of 8 to pass.
5. **Ask the owner**, then make an explicit-path commit with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.
6. In the main checkout, delete the copied test file, and revert the shortlet-app.ts hunk with `git checkout -- apps/local-guest/src/shortlet-app.ts`. Both steps only after the owner approves, and only if the diff still holds nothing else. Never stash or reset the other owner edits.

## Acceptance criteria

- [x] `fix/chat-hardening` holds one commit with the fix, its 8 tests, issue files 56–62 and the Weaver note.
- [x] `npm run check` is clean in the worktree, and the drift test passes 8 of 8.
- [x] The main checkout's other uncommitted edits are unchanged.

## Comments
- 9 Nov 2026, landed on `fix/chat-hardening` (worktree `C:\AI2026\chat-marketplace-hardening`). Commands (all with `env -u LLM_API_KEY`):
  - `npm run check`: clean (tsc x4 plus the worker bundle guard).
  - `npx tsx --test test/assistant-discovery-artifact-drift.test.ts`: 8 of 8 pass.
  - Before carrying the hunk, confirmed `git diff apps/local-guest/src/shortlet-app.ts` in the main checkout held only the `#syncAssistantPersistence` hunk (5 insertions, 1 deletion); the other uncommitted edits were not touched.
- ADRs: 0106 (an id the guest holds is persisted and re-keyed, never re-minted; guards fail closed), 0077/0080 (a restore re-queries the authorized domain query).
- Not run: the full `npm test` and `npm run test:workers` (batch gate), and a live staging retest after a rebuild.
- WORK-MAP section 7 was only an uncommitted edit in the main checkout, not on `main`; it is carried into the branch so the later issues in the batch can update it.