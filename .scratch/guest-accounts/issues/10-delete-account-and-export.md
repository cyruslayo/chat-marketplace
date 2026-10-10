# Delete account and download my data

Status: needs-info
Type: task
Blocked by: 01, 07, legal sign-off on issue 01 answer 6
Requested: 2 Oct 2026

## Why

Once Guests have accounts, they must be able to leave and to see what is held about them (user story 13; Nigeria Data Protection Act 2023). Booking, payment and payout records cannot simply be deleted, so the rules from issue 01 decide what is anonymised and kept.

**Before starting:** the retention period and the anonymise-vs-delete split in issue 01 answer 6 are provisional. Confirm a lawyer has reviewed them (NDPA 2023) and record that in `## Comments`; otherwise set this issue to `needs-info`.

## What to build

- On `/account`: "Download my data" and "Delete my account", each a POST form; delete asks for a fresh Sign-In Code first.
- **Export.** A JSON (or the format chosen in issue 01) download of the account, linked principals' threads, requests, bookings, contacts, and any reviews, messages and favourites from the follow-on effort once they exist. No other Guest's data, no operator internals, no payment secrets (ADR 0075). Payment references are omitted from the account export: ADR 0096 exempts only the private R2 daily export, not account exports.
- **Delete.** Revokes all sessions, closes the account, unlinks principals, and deletes or anonymises each record class exactly as issue 01 says. Retained records keep only what the retention rule allows.
- An audit entry with safe identifiers only.

## Acceptance criteria

- AC1: Export contains exactly the record classes issue 01 lists for the signed-in account. Failure path: records of another account never appear.
- AC2: Delete requires a fresh code; without it nothing changes.
- AC3: After delete, every session is rejected, the email can start a brand-new account, and old threads are not visible to it.
- AC4: Each record class is deleted or anonymised as issue 01 says (one test per class).
- AC5: Delete is refused, with a reason, while a payment is in progress, a stay is upcoming or in progress, or a deposit claim or appeal is open. One test per condition.

## Tests to add/update

New `test/guest-account-deletion.test.ts`.

## ADR compliance

0004, 0070, 0075, 0093, 0094 and the retention answer in issue 01.

## Comments

- 10 Oct 2026: no lawyer review of the retention period or the anonymise-vs-delete split (issue 01 answer 6, Nigeria Data Protection Act 2023) is recorded in this repository. Status set to `needs-info`; it moves to `ready-for-agent` only once legal sign-off is recorded here.
- 10 Oct 2026: Stay Message Threads, Saved Stays, favourites and published reviews are not on `origin/main`. They belong to `.scratch/guest-stays-and-favourites/`. The export and deletion rules for them apply only once that effort lands.
- 10 Oct 2026: the account export must omit payment references (`psp_reference`, `transfer_reference`). ADR 0096 exempts only the private R2 daily export from the bearer-credential rule.
