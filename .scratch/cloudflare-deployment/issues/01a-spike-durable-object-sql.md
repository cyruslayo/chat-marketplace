# Cut the integration branch; spike Durable Object SQL semantics

Status: resolved
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

### Observed SQL semantics

The spike uses `ctx.storage.sql.exec` and `ctx.storage.transactionSync` in `spikes/do-sql/src/index.ts`. It ran with `cf@1.0.0-beta.12`, `@cloudflare/vite-plugin@2.0.0-beta.sha-52b0dc0e9`, and Vite 8.3.2 on the local `cf dev` runtime.

1. **Parameters** — `SELECT ? AS value`, `SELECT ?1 AS value`, and `SELECT $value AS value`, each with one positional binding, returned respectively `[{"value":"plain"}]`, `[{"value":"numbered"}]`, and `[{"value":"named"}]`. All three forms are accepted.
2. **Multiple statements** — `sql.exec("CREATE TABLE IF NOT EXISTS probe_multi (id INTEGER PRIMARY KEY); CREATE INDEX IF NOT EXISTS probe_multi_idx ON probe_multi(id);")` returned catalog rows for both `probe_multi` and `probe_multi_idx`; one call executes both statements.
3. **PRAGMAs and foreign keys** — `PRAGMA busy_timeout = 5000` and `PRAGMA journal_mode` each failed with `not authorized: SQLITE_AUTH`. `PRAGMA foreign_keys = ON` returned an empty cursor without error. `PRAGMA table_info('probe_multi')` worked and returned the expected `id INTEGER PRIMARY KEY` column. A newly named Durable Object, before any foreign-key PRAGMA, returned `PRAGMA foreign_keys` as `1` and rejected an invalid child row with `FOREIGN KEY constraint failed`; enforcement is on by default.
4. **BLOBs** — inserting either `new Uint8Array([0, 1, 127, 255])` or its `ArrayBuffer` into a BLOB column succeeded. Both read back as `ArrayBuffer` with bytes `[0,1,127,255]`.
5. **Transactions** — the success probe was `transactionSync(() => { sql.exec("INSERT INTO probe_tx VALUES (?, ?)", 1, "outer"); storage.transactionSync(() => sql.exec("INSERT INTO probe_tx VALUES (?, ?)", 2, "inner")); })`; inserts 1 and 2 both committed. Throwing from the outer callback removed both its own and nested inserts (3 and 4). In a nested-failure probe, the inner callback inserted id 2 and threw; after catching that error, the outer callback inserted id 3 and committed, leaving ids 1 and 3. Returning `Promise.resolve()` from a callback after inserting id 5 was accepted and id 5 committed. The runtime does not reject or await a thenable, so adapters must enforce synchronous callback semantics themselves.
6. **Rows written vs changes** — the probe ran `INSERT OR IGNORE INTO probe_count (id, value) VALUES (?, ?)` twice for the same id, then `UPDATE probe_count SET value = ? WHERE id = ?` (with one `AFTER UPDATE` trigger insert), then the same `UPDATE` for missing id 999. Cursor `rowsWritten` was 0, 2, and 0. `SELECT changes()` immediately after each statement returned 0, 1, and 0, matching Node `StatementSync.run().changes` (confirmed with the same trigger case).
7. **Limits** — the probe generated `SELECT ?, ?, ...` with 100 and 101 positional bindings; 100 succeeded and 101 failed with `too many SQL variables at offset 207: SQLITE_ERROR`. It inserted `"x".repeat(2 * 1024 * 1024)` and `"x".repeat(2 * 1024 * 1024 + 1)` into a TEXT column; both values were accepted by the local runtime.

### Consequences

- **02a (port semantics):** Support plain, numbered and named bindings at the Durable Object boundary. Preserve `run().changes` semantics rather than forwarding `rowsWritten`; the adapter can query `SELECT changes()` immediately after the statement. Reject thenable-returning transaction callbacks explicitly. Support nested transactions with nested rollback isolation (savepoints on Node); outer rollback must include successful nested work. Document that `transactionSync` itself accepts a Promise without awaiting it.
- **03b (adapter translation and guards):** BLOB reads arrive as `ArrayBuffer`, so translate them to the port's `Uint8Array`; accept `Uint8Array` and `ArrayBuffer` on insert. Treat `busy_timeout` and `journal_mode` as unsupported PRAGMAs (no-op only where callers need compatibility), preserve default foreign-key enforcement, and allow `foreign_keys` and `table_info`. Guard more than 100 bound parameters; do not add a 2 MiB value limit based on this runtime result.
- **10b:** Configure required foreign-key constraints in schema and rely on the runtime default; do not configure busy timeout or journal mode. Keep transaction callbacks synchronous and enforce no-Promise behavior at the application/adapter seam, because runtime `transactionSync` silently commits before an async continuation. Preserve a single tenant transaction boundary and test trigger-aware change counts.

- **Evidence and limitation:** All outputs above came from requests to the local `cf dev` server. The limit observations are runtime-specific and do not replace a documented platform quota check before production use.
