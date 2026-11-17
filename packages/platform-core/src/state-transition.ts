/** An allowed-from table: every state lists the states it may move to. `satisfies` makes the compiler reject a table that omits a state. */
export type TransitionTable<S extends string> = { readonly [K in S]: readonly S[] };
/** Whether `from -> to` is listed. Pure; never throws. Callers keep their own error text and idempotent returns. */
export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}
