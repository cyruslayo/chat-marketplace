# Cut the integration branch; spike Durable Object SQL semantics

Status: claimed
Type: prototype
Blocked by: none
Branch: `infra/cloudflare-deployment` (created here); the spike itself goes on `infra/cf-01a-do-sql-spike` and is **not merged**
Requested: 2 Oct 2026
Unlocks: 01c, 01b, 03a

## Why

The plan assumes Durable Object SQL can stand in for `node:sqlite` behind a synchronous port (PRD, "Context"). Slices 02a, 03b and 10b all rely on specific SQL behaviours. Confirm them before writing production code.

## What to build

1. Cut `infra/cloudflare-deployment` from an up-to-date `main` and push it. Check `git status` first: the working tree has unrelated uncommitted deletions under `scratch/`, and they must not be committed.
2. In a throwaway folder (`spikes/do-sql/`, kept outside the root `tsconfig.json` include), build a minimal Worker with one SQLite-backed Durable Object using Cloudflare's `cf` CLI. This spike may use the currently available CLI version; 01c pins the version and validates the project toolchain before implementation. The Workers test harness may use Wrangler internally if confirmed necessary; record that limitation rather than making Wrangler the developer workflow.
3. Answer each question with a runnable snippet and its observed output:
   - Does `ctx.storage.sql.exec(sql, ...bindings)` accept numbered `?1` parameters? Plain `?`? Named `$name`? (The answer to the last one is expected to be no.)
   - Does one `exec` run a multi-statement string such as `CREATE TABLE …; CREATE INDEX …;`? The domain stores create their schemas this way.
   - Which PRAGMAs are allowed: `busy_timeout`, `foreign_keys = ON`, `table_info(...)`, `journal_mode`? Is foreign-key enforcement on by default?
   - What type does a BLOB come back as (`ArrayBuffer` or `Uint8Array`), and which types does it accept on insert?
   - `transactionSync`: how does it behave when nested, when the callback throws (rollback), and when the callback returns a Promise or `await`s?
   - Does `cursor.rowsWritten` after an `UPDATE` match `changes` as `node:sqlite` reports it, including for `INSERT OR IGNORE` and for triggers?
   - What happens at 100 bound parameters, and at 101? At a 2 MB value, and just over?

## Out of scope

- Runtime compatibility questions (`@google/genai`, crypto, `Intl`, streaming); those are slice 01b.
- Any change under `apps/`, `domains/` or `packages/`.

## Acceptance criteria

- AC1: `infra/cloudflare-deployment` exists on the remote, cut from `main`, with no unrelated working-tree changes in it.
- AC2: Every question above has an answer in `## Answer`, with the snippet and its observed output.
- AC3: `## Answer` ends with a "Consequences" list saying exactly what 02a (port semantics), 03b (adapter translation, PRAGMA no-ops, limit guards) and 10b must do because of these answers.

## Tests

None in the repo. The evidence is the spike output recorded in `## Answer`.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| 0041, 0044, 0046 | Holds, payment windows and the single live attempt need atomic read-then-write. The `transactionSync` rollback and nesting answers decide whether the port can guarantee this. |

## Definition of Done

Prototype slice. DoD items 1, 2 and 7 apply only to AC1 and AC2, since no production code changes. Keep the spike folder off the integration branch.

## Comments

## Answer
