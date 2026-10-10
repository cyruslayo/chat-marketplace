# `ReceiptBlobStore` port, SQLite implementation and migration

Status: resolved
Type: task
Blocked by: 02b
Branch: `infra/cf-07a-receipt-blob-port`
Requested: 2 Oct 2026
Unlocks: 07b

## Why

Manual-transfer receipts are stored as BLOBs in `manual_transfer_receipts.bytes` (`domains/shortlet/src/manual-transfer.ts`: table at :138, `bytes BLOB NOT NULL`; `saveReceipt` at :158, `readReceipt` at :161, delete at :167). A 5 MB receipt exceeds the Durable Object's 2 MB value limit, so on Cloudflare the bytes must go to R2. This slice adds the port and keeps Node behaviour identical.

## What to build

- In `domains/shortlet/src/receipt-blob-store.ts`, define the `ReceiptBlobStore` port, with operations that may be async:
  - `put(key, bytes: Uint8Array, contentType): Promise<void>`
  - `get(key): Promise<{ bytes: Uint8Array; contentType: string } | null>`
  - `delete(key): Promise<void>`
- `SqliteReceiptBlobStore` keeps bytes in SQLite (today's behaviour, for Node and local use).
- An additive migration on `manual_transfer_receipts`:
  - add `object_key TEXT` and `size_bytes INTEGER`;
  - make `bytes` nullable. SQLite cannot drop `NOT NULL` in place, so use a create–copy–rename inside one transaction. It must be idempotent and safe on a database that already has receipts.
- `SqliteManualTransferStore` stores **metadata only** (key, content type, size, timestamps) and delegates bytes to the injected `ReceiptBlobStore`.
  - Write order: blob `put` first, then the metadata row inside the transaction. **Never `await` inside the transaction.**
  - Read: the row, then the blob `get`.
  - Rows written before the migration (with `bytes` and no key) must still be readable.
- Keys are random and opaque (`crypto.randomUUID()`), never the booking reference or guest data (ADR 0075).
- Async now reaches the receipt upload and back-office read paths in `guest-server.ts` (around :7480–7495) and the owner receipt route. Make those callers `await`. Keep the change minimal.

## Out of scope

- The R2 implementation (07b), and the orphan sweep (12a).
- Changing the 5 MB limit or the routes.

## Acceptance criteria

- AC1: Uploading and reading a receipt on Node returns identical bytes and content type, with the bytes stored through `SqliteReceiptBlobStore`.
- AC2: A database with receipts saved before the migration still serves them after it. The migration is idempotent: running it twice is a no-op.
- AC3: Object keys never contain the booking reference, guest name or phone. Failure path: a test asserts that the key matches a UUID pattern.
- AC4: If the blob `put` fails, no metadata row is written and the upload returns the existing error page.
- AC5: Receipts stay visible only to the back office (ADR 0090). The existing authorization tests pass. `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0090 | Receipts are evidence only, seen only by the back office; configured limit | routes unchanged; the limit is unchanged |
| 0075 | Secure uploads; opaque keys | UUID keys |
| 0041 / 0046 | No `await` inside transactions | put before the transaction |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

## Answer

Resolved 6 Oct 2026. `domains/shortlet/src/receipt-blob-store.ts` defines the async `ReceiptBlobStore` (`put`, `get`, idempotent `delete`) and `SqliteReceiptBlobStore` (table `receipt_blobs`); `SqliteManualTransferStore(database, blobs = SqliteReceiptBlobStore)` now keeps metadata only.

- **Table migration.** `manual_transfer_receipts` gains `object_key` and `size_bytes`, and `bytes` becomes nullable. It is detected from `sqlite_master` (no PRAGMA, so it also runs on Durable Object SQL) and rebuilt create-copy-rename in one transaction; running it again is a no-op. Rows saved before the migration keep their bytes inline, get their size, and are still served; deleting one needs no blob.
- **Write order and the await gap.** `uploadReceipt` is now async and runs: full refusal check, then `await` blob put, then the check again and the synchronous commit (calendar hold, metadata row, transfer, attempt, audit). The re-check matters because another request can win while the put is waiting; a loser's bytes are discarded. Nothing awaits inside a transaction. A failed put records nothing and reaches the existing "receipt was not accepted" page (the route already maps any non-`ManualTransferError` that way).
- **Async ripple.** `readReceipt`, `purgeReceipts`, the owner's `manualTransferReceipt` and the guest upload route now await. Retention used to run inside `listOperatorManualTransfers`, which is synchronous; it is now `purgeManualTransferReceipts()`, called by the owner server before any signed-in `GET /operator*`, so the same reads still trigger it (bytes are deleted first, then the transfer is re-read fresh and saved).
- **Composition.** Both environments' dependencies take an optional `receiptBlobs` (default SQLite), used to build the store; the Guest and Owner must be given the same one.
- AC1 to AC4: `test/receipt-blob-store.test.ts` (identical bytes through the blob table with a null-bytes metadata row; legacy rows and idempotent migration; UUID-only keys with no reference, receipt id, name or phone; failed put leaves no row and the existing page; two racing uploads leave one receipt and no orphan; spy proves every byte goes through the port). AC5: the existing manual-transfer, back-office and authorization suites pass unchanged except two `await`s in test helpers.
- ADRs: 0090 (back-office-only receipts, unchanged limit and routes), 0075 (opaque keys), 0041/0046 (put before the state change, nothing awaited in a transaction), 0095.
- Left for 12a: there is no `list` on the port. The orphan sweep needs object upload times, which the SQLite store does not keep, so 12a should use the R2 binding directly.
