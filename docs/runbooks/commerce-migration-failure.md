# Commerce migration failure and local Node databases

Issue 24 (review 5 and review 3). The COMMERCE Durable Object (`CommerceMarket`) applies its migration ledger on start. The
ledger is the only source of the `merchant_orders` shape. If it cannot reach the expected shape, the object fails closed.

## 0. Commerce is off by default (ADR 0104 decision 5)

Commerce is switched by `COMMERCE_ENABLED` in every environment. Unset, empty or `false` means off. Exactly `true` means on. Any other value stops startup or the build with an error that names the variable. Turning commerce on in any public deployment is an owner-only decision (ADR 0104 decision 3). Sections 1 and 4 describe the failure modes of an object that is on, unless the text says otherwise.

While commerce is off, the `CommerceMarket` object:

- builds no commerce pack and does not read the payment reference key pair;
- refuses every checkout and every non-empty import with `503 COMMERCE_DISABLED`. An import with zero rows for a commerce table succeeds as an empty no-op;
- answers a `rows` count, which the cutover reads (below).

Cutover while commerce is off (`POST /_ops/cutover/complete`) checks the commerce row count before any platform or Shortlet write:

| Commerce row count | Result | Written |
| --- | --- | --- |
| Zero | Proceeds without a commerce cutover object | Shortlet and platform cutover as usual |
| More than zero | `409 COMMERCE_ROWS_PRESENT_WHILE_DISABLED` | Nothing |
| The count fails or returns no usable number | `503 COMMERCE_CUTOVER_UNAVAILABLE` | Nothing |

A restore that carries commerce rows into an off target is refused (`COMMERCE_DISABLED`). To restore those rows, set `COMMERCE_ENABLED=true` and rebuild the Worker first (the switch is read at build time, see `cloudflare-staging-rehearsal.md`, section 1). That change is subject to the owner decision above.

## 1. What the object does when it fails

Every request to a `CommerceMarket` whose start-up failed is refused with `503` and one of these fixed codes. Nothing else
is logged, and no error text, row or payment reference is included.

| Code | Meaning | Logged line |
| --- | --- | --- |
| `COMMERCE_MIGRATION_FAILED` | A ledger migration statement failed. The usual cause is migration 6 (the keyed-hash rebuild) refusing to rebuild `merchant_orders` while legacy order rows exist. | `COMMERCE_MIGRATION_FAILED` |
| `COMMERCE_SCHEMA_SHAPE_INVALID` | The ledger finished, but `merchant_orders` does not have `payment_reference_hash` or still has `payment_reference`. | `COMMERCE_SCHEMA_SHAPE_INVALID` |

Shortlet keeps working. `GET /_ops/status` and `GET /_ops/import/verify` report `commerce: { ok: false, code: "COMMERCE_UNAVAILABLE" }`.
`POST /_ops/cutover/complete` returns `503 COMMERCE_CUTOVER_UNAVAILABLE` and records no Shortlet cutover, so it is safe to run again.

## 2. Response

1. Do not restore traffic to commerce. Shortlet and platform can stay live.
2. Read the logged code from the Workers log. Do not copy any row, payment reference or hash into the incident record.
3. For `COMMERCE_MIGRATION_FAILED` with legacy orders: those orders were created before the hashed-reference migration. A
   converter is a separate decision (issue 24, "Migration limit"). Do not delete rows to make the migration pass without
   that decision.
4. For `COMMERCE_SCHEMA_SHAPE_INVALID`: restore the COMMERCE object from its last good point in time (section 1 of
   `cloudflare-restore.md`), then re-check the object's status.
5. After the fix, the object re-runs the ledger on its next start. Check `GET /_ops/status` for `commerce.schemaVersion`.

## 3. Local Node databases (no Node migration path)

By default, the local guest (`apps/local-guest`) composes commerce only when `COMMERCE_ENABLED=true`. When it is on, the guest server
applies the commerce ledger at start-up (`apps/local-guest/src/guest-server.ts`), so a Node SQLite file gets `merchant_orders`
from the ledger. When it is off, the local guest mounts no commerce routes and creates no commerce table. Since issue 24
review 3, `CommerceOrders` creates no table itself. The consequences:

- A local file created before the hashed-reference change has the raw `payment_reference` column. Delete it and let the
  local environment create a new one. Do not copy rows from it.
- Commerce order tests migrate their own in-memory databases (`test/helpers/commerce-database.ts`).

## 4. Payment reference key (ADR 0075; user decision 18 Oct 2026)

Each merchant order stores a keyed hash of its payment reference, not the reference and not a plain SHA-256. The stored value
is `<keyId>:<64 lowercase hex>`, an HMAC-SHA-256 over the trimmed reference. A plain SHA-256 could be brute-forced from an export,
because Shortlet references are predictable.

The key pair is required only when commerce is on, that is `COMMERCE_ENABLED=true` (ADR 0104 decision 5). While commerce is off, the key is not read and this section does not apply.

- **Secret:** `COMMERCE_REFERENCE_HMAC_KEY` (a Worker secret, set by name only, never committed). It must be at least 32 bytes. The Cloudflare configuration declares it only while commerce is on (`apps/cloudflare/cloudflare.config.ts`), so the default deployment needs no commerce secret. Turning commerce on means declaring and setting it before the deploy.
- **Id:** `COMMERCE_REFERENCE_HMAC_KEY_ID` (a plain var, such as `k1`). It is stored in clear with each hash, so it must not hold a secret. It is declared only while commerce is on.
- **Local guest and local merchant:** the local guest (`apps/local-guest`) reads the pair only when commerce is on. Outside tests, it fails to start without the pair and names the variables, never their values. The merchant back office (`apps/local-merchant`) refuses to start while commerce is off (it names `COMMERCE_ENABLED=true`), and needs the pair when it is on. The test-only key is never a fallback outside the test runner: it needs `NODE_ENV=test` and the explicit opt-in `COMMERCE_REFERENCE_TEST_KEY=allow`, and only the local guest accepts it. The Node pilot servers (`apps/pilot`) keep commerce disabled for the stays-only launch (ADR 0104 decision 1), so they do not read the pair.
- **Missing or short key (commerce on):** the commerce object refuses every request with `503 COMMERCE_REFERENCE_KEY_INVALID`. Shortlet keeps working.
  The logged line is the fixed code only. Neither the key nor the reference is logged.
- **Restore:** a restored `merchant_orders` row must carry a `<keyId>:<64 lowercase hex>` hash, or the import is refused with
  `INVALID_PAYMENT_REFERENCE_HASH`.
- **Rotation:** the domain can keep earlier keys (`previousKeys`) so older orders still match. The Worker does not read an
  earlier key yet. Do not rotate the key until that wiring is added (an open follow-up). Changing the key without it orphans
  lookups for orders stored under the old key.
- **Never** place the key or a reference in a log, a URL, a ticket or a chat message.
