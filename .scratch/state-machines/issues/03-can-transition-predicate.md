# 03 canTransition predicate in platform-core

Status: resolved
Type: task
Track: B
Blocked by: none

## What to build

Add `packages/platform-core/src/state-transition.ts`:

```ts
/** An allowed-from table: every state lists the states it may move to. `satisfies` makes the compiler reject a table that omits a state. */
export type TransitionTable<S extends string> = { readonly [K in S]: readonly S[] };
/** Whether `from -> to` is listed. Pure; never throws. Callers keep their own error text and idempotent returns. */
export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}
```

If `packages/platform-core/src/index.ts` is a barrel, also export both names from it. No other code uses the helper in this issue.

## Acceptance criteria

1. An allowed move returns true.
2. A move that is not listed returns false, including a move out of a terminal state (an empty list).
3. A table that omits a state fails type checking. Prove this with an `// @ts-expect-error` line in the test file; `npm run check` type-checks it.

## Tests

`test/state-transition.test.ts`, then `npm run check`.

## Comments

- Implemented `packages/platform-core/src/state-transition.ts` (`TransitionTable`, `canTransition`), exported from `packages/platform-core/src/index.ts`, and added `test/state-transition.test.ts` (one test per AC, AC3 uses `@ts-expect-error`). No other code uses the helper.
- ADR check: `docs/adr/` lists no ADR that governs a generic transition predicate; the PRD governing-ADR table names none for this issue.
- `tsconfig.json` includes `test/**/*`, so the `@ts-expect-error` line is type-checked by `npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/state-transition.test.ts`: tests 3, pass 3, fail 0.
- `env -u LLM_API_KEY npm run check` (tsc root, tsc apps/cloudflare, tsc tests, tsc tooling, worker bundle guard): exit 0.
- Not run: full `npm test` (DoD item 7). Per the Test scope in CLAUDE.md and AGENTS.md it is a once-per-batch pre-merge gate, not a per-issue step. Status left as `ready-for-agent` until the orchestrator decides how to treat DoD item 7 for this batch.
- Orchestrator review: DoD 7's full `npm test` is the batch gate (AGENTS.md Test scope), so resolved. Re-ran the test (3 pass) and `npm run check` (exit 0).
