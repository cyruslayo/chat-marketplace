# Fix the flaky receipt object-key assertion

Status: ready-for-agent
Type: AFK
Requested: 11 Oct 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

Bug in the test, not in the product code. `test/receipt-blob-store.test.ts:89` fails intermittently in CI.

- The test `07a AC3: Object keys never contain the booking reference, guest name or phone` (`test/receipt-blob-store.test.ts:78`) asserts `assert.doesNotMatch(key, /guest|\+?234|0801/i)` on the receipt object key (line 89). The regex is a generic digit pattern, not the actual values for this booking.
- The key is a bare random UUID: `domains/shortlet/src/receipt-blob-store.ts:22` returns `crypto.randomUUID()`. The hex digits of a v4 UUID can contain the substring `234`, so the assertion fails for about 1 run in 1,300 (rate measured in issue 50 Follow-ups). The redaction work in issue 50 is not involved.
- Observed: CI `verify` on run 38147745935, attempt 1 (reported by the requester; not re-checked against the Actions log here). Issue 50 records one earlier CI failure of the same test (`verify`, head `e8008df`) that passed on rerun.
- The assertion can fail on a correct implementation, so it gives false red builds and hides real failures in that CI job.

## What to build

- Change the assertions in `test/receipt-blob-store.test.ts` (around lines 86 to 89) so they check that the object key does not contain the actual values for this test's booking: the booking reference (`transfer.bookingReference`), the receipt id, the guest name, and the phone number used in the fixture. Use the fixture values, not a digit pattern.
- Keep the existing check that the key is a UUID (`assert.match(key, UUID)`, line 86).
- Keep the failure-path check that a derived key (`receipt-${bookingReference}`) would be refused (line 90 to 91).
- Do not change `domains/shortlet/src/receipt-blob-store.ts`. Its key scheme is correct under ADR 0075.

## Acceptance criteria

- [ ] AC3: Object keys never contain the booking reference, guest name or phone. (One named test; assertions use the fixture's actual values.)
- [ ] AC3 failure path: a store that derives the key from the booking reference is refused by the same test.
- [ ] AC3 failure path: a key that embeds the guest name or the phone digits is refused by the same test.
- [ ] The test passes 200 consecutive runs of `npx tsx --test test/receipt-blob-store.test.ts` (loop run, recorded in Comments).

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0075 | Minimise personal data; object keys carry no guest or booking identity | `receipt-blob-store.ts:22`, the assertion at test line 89 |
| 0090 | Manual bank transfer receipts are stored as a blob referenced by the transfer | `receipt-blob-store.ts`, `manual_transfer_receipts` |

## Comments

- 11 Oct 2026, filed on docs branch `file-followup-issues` (base `origin/main` 8b23923). Source: issue 50 Follow-ups (`.scratch/shortlet-concierge-launch/issues/50-keep-platform-ids-intact-under-card-redaction.md`), which records the flake and its rate. Unrelated to redaction.
