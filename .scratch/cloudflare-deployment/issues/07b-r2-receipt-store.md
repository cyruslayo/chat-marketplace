# R2 receipt store

Status: ready-for-agent
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
