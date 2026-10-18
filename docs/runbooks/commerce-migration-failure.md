# Commerce migration failure and local Node databases

Issue 24 (review 5 and review 3). The COMMERCE Durable Object (`CommerceMarket`) applies its migration ledger on start. The
ledger is the only source of the `merchant_orders` shape. If it cannot reach the expected shape, the object fails closed.

## 1. What the object does when it fails

Every request to a `CommerceMarket` whose start-up failed is refused with `503` and one of these fixed codes. Nothing else
is logged, and no error text, row or payment reference is included.

| Code | Meaning | Logged line |
| --- | --- | --- |
| `COMMERCE_MIGRATION_FAILED` | A ledger migration statement failed. The usual cause is migration 5 refusing to rebuild `merchant_orders` while legacy order rows exist. | `COMMERCE_MIGRATION_FAILED` |
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

The local Node runtime (`apps/local-guest`) does not run commerce migrations. Since issue 24 review 3, `CommerceOrders`
creates no table, so a Node SQLite file gets `merchant_orders` only from the ledger. The consequences:

- A local file created before the hashed-reference change has the raw `payment_reference` column. Delete it and let the
  local environment create a new one. Do not copy rows from it.
- A fresh local file has no `merchant_orders` table until a Node migration path exists. Commerce order tests migrate their
  own in-memory databases (`test/helpers/commerce-database.ts`). A local commerce order flow needs that path first. This is
  an open decision, not a silent fallback.

## 4. Payment reference key (ADR 0075; user decision 18 Oct 2026)

Each merchant order stores a keyed hash of its payment reference, not the reference and not a plain SHA-256. The stored value
is `<keyId>:<64 lowercase hex>`, an HMAC-SHA-256 over the trimmed reference. A plain SHA-256 could be brute-forced from an export,
because Shortlet references are predictable.

- **Secret:** `COMMERCE_REFERENCE_HMAC_KEY` (a Worker secret, set by name only, never committed). It must be at least 32 bytes.
- **Id:** `COMMERCE_REFERENCE_HMAC_KEY_ID` (a plain var, such as `k1`). It is stored in clear with each hash, so it must not hold a secret.
- **Missing or short key:** the commerce object refuses every request with `503 COMMERCE_REFERENCE_KEY_INVALID`. Shortlet keeps working.
  The logged line is the fixed code only. Neither the key nor the reference is logged.
- **Restore:** a restored `merchant_orders` row must carry a `<keyId>:<64 lowercase hex>` hash, or the import is refused with
  `INVALID_PAYMENT_REFERENCE_HASH`.
- **Rotation:** the domain can keep earlier keys (`previousKeys`) so older orders still match. The Worker does not read an
  earlier key yet. Do not rotate the key until that wiring is added (an open follow-up). Changing the key without it orphans
  lookups for orders stored under the old key.
- **Never** place the key or a reference in a log, a URL, a ticket or a chat message.
