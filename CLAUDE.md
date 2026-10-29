@AGENTS.md

## Test scope

- Per issue: run `npm run check` plus only the issue's own and affected tests, and record the commands and counts in the issue's Comments.
- The full `npm test` and `npm run test:workers` run once per batch, before merging to main, after every issue in the batch is resolved. Do not run them per issue.
- Details: AGENTS.md, "Test scope".

## Operating rules

- Scope: apartment (shortlet) booking only. Commerce stays off behind the fail-closed `COMMERCE_ENABLED` switch; no new commerce work.
- Never open `C:\Users\Cyrus\staging-secrets.env`, never print the environment, and run commands with `env -u LLM_API_KEY`. The owner runs all Cloudflare commands; get explicit approval before merging to main, pushing or deploying.
- Deploying staging: build from a clean detached worktree at the gated commit, verify the descriptor, run `npm run check` there, then give the owner the deploy command; never deploy. The one allowed `cf` call is a read-only log query when the owner asks. Details: AGENTS.md, "Staging deployment".
- Merging: gate in a dedicated worktree, then merge to main only on explicit approval; do not push without a separate approval. Never stash, reset or discard the owner's uncommitted edits or untracked files: commit them with the owner's approval, or back them up outside the repo.
- Verify agent reports with `git log`, `git status` and a clean-tree `npm run check`, not the report.
- Concierge assistant changes: read ADR 0106 first and test with the assistant enabled and a cold restore before every event. Details: AGENTS.md, "Concierge assistant path" and "Staging deployment".
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
