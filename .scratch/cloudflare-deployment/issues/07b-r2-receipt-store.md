# R2 receipt store

Status: resolved
Type: task
Blocked by: 03a, 07a
Branch: `infra/cf-07b-r2-receipts`
Requested: 2 Oct 2026
Unlocks: 10b, 12a

## Why

On Cloudflare, receipt bytes go to a private R2 bucket (a PRD decision). This slice adds the R2 implementation of the 07a port and proves it in workerd.

## What to build

- `apps/cloudflare/src/r2-receipt-blob-store.ts`: `R2ReceiptBlobStore implements ReceiptBlobStore`, taking an `R2Bucket` binding (`RECEIPTS`).
  - `put` writes the object with `httpMetadata.contentType`.
  - `get` returns the bytes as a `Uint8Array`, or `null` if the object is missing.
  - `delete` is idempotent.
- No public access: nothing in this slice creates a public URL, a signed URL or a custom domain for the bucket. Receipts are only streamed through the existing back-office route.
- Add a `list(prefix?)` method if 12a's orphan sweep needs one. Add it to the port only if `SqliteReceiptBlobStore` can implement it too.
- **The size limit is enforced before the body is read.** Today the guest server rejects on `content-length` above `receiptMaxBytes + 16 KiB` (`guest-server.ts:7480–7495`; default `DEFAULT_RECEIPT_MAX_BYTES` = 5 MiB at `apps/local-guest/src/fixture.ts:47`). Confirm the shim (09c) keeps `content-length`. Add a streaming byte counter that aborts when the limit is passed, for chunked uploads with no length.
- `apps/cloudflare/test/r2-receipt-blob-store.spec.ts` runs against the pool's R2 simulation.

## Out of scope

- Wiring into the Durable Object (10b), and the sweep (12a).

## Acceptance criteria

- AC1: Put, get and delete round-trip bytes and content type through R2 in workerd.
- AC2: `get` of a missing key returns `null`, and `delete` of a missing key does not throw.
- AC3: An upload over the configured limit is refused with 413 before the whole body is buffered, with and without `content-length`. Failure path: no R2 object and no metadata row exist afterwards.
- AC4: Nothing in the code produces a public or signed R2 URL. A grep test for `createPresignedUrl` and `publicUrl` in `apps/cloudflare/src` passes.
- AC5: `npm run test:workers`, `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0090 | Configured receipt limit; back office only | 413 path; no public URL |
| 0075 | Secure uploads | private bucket, opaque keys |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

## Answer

Resolved 6 Oct 2026. `apps/cloudflare/src/r2-receipt-blob-store.ts` implements the port over the private `RECEIPTS` bucket (`put` with `httpMetadata.contentType`, `get` to a `Uint8Array` or null, idempotent `delete`). `apps/cloudflare/src/bounded-body.ts` adds `readBodyWithLimit` for the Worker: a declared `content-length` over the limit is refused before any byte is read, and with no length the stream is counted and cancelled the moment the limit is passed.

- AC1 to AC3 in workerd (`apps/cloudflare/test/r2-receipt-blob-store.spec.ts`, 6 tests, 22 workerd tests in total): round trip including every byte value; missing key gives null and double delete is quiet; oversized with a length is refused with at most one pull; an endless chunked body is cancelled after fewer than 20 pulls; `RECEIPTS` stays empty after each refusal. The same file runs `SqliteManualTransferStore` over `DurableObjectSqlDatabase` plus R2, including the 07a table rebuild of a legacy receipt table on Durable Object SQL.
- AC3 on the Node route (`test/r2-receipt-store-boundaries.test.ts`): a receipt over the limit is refused with 413 both with a content-length and as a chunked body without one, with no metadata row and no blob afterwards, and an in-limit receipt still succeeds.
- AC4: a Node test fails on any `createPresignedUrl`, `publicUrl`, presign or r2.dev reference under `apps/cloudflare/src`.
- The Worker source type check now compiles `manual-transfer.ts`, which exposed three Node-only `Buffer` calls; receipt type sniffing and receipt id generation now use plain byte operations (behaviour identical).
- Still for 09c: confirm the Fetch-to-Node shim preserves `content-length` and the stream, and for 10b: wire `R2ReceiptBlobStore(env.RECEIPTS)` into both environments' `receiptBlobs` dependency and call `readBodyWithLimit` before the multipart parse.
- ADRs: 0090, 0075.
