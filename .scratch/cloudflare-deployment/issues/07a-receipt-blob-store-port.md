# `ReceiptBlobStore` port, SQLite implementation and migration

Status: ready-for-agent
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
