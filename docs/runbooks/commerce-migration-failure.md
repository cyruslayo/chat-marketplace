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
