# 03 canTransition predicate in platform-core

Status: ready-for-agent
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
