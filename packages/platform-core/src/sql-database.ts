export type SqlValue = string | number | bigint | null | Uint8Array;

export type SqlRow = Record<string, SqlValue>;

export type SqlParams = Record<string, SqlValue> | readonly SqlValue[];

export interface SqlStatement {
  get(params?: SqlParams): SqlRow | undefined;
  all(params?: SqlParams): SqlRow[];
  run(params?: SqlParams): { changes: number };
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  /**
    * Run a synchronous, atomic read-then-write operation. Nested calls preserve
    * savepoint rollback boundaries. The callback must not return a Promise; a
    * thrown error rolls back its transaction scope and is rethrown.
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}
