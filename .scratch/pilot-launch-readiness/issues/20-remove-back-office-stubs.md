# Remove production stubs in the back office

Status: resolved
Type: task
Blocked by: none

## What to build

`apps/local-owner/src/local-owner-environment.ts` hard-codes, in production composition: guest contacts as `+2348012345678`, guest verification as `governmentIdVerified: true`, and operator reliability as 12/12 and 0.98. Replace each with the authoritative source or the explicit policy. Read ADRs 0066, 0083 and 0085 first; if an ADR leaves a gap, record it and ask the user rather than inventing a value.

## Acceptance criteria

- [ ] The back office reads guest contact details from the stored guest contact, not a fixed number.
- [ ] Guest verification at request time follows ADR 0085 and never returns a hard-coded result.
- [ ] Operator reliability comes from stored bookings or the documented cold-start policy.

## Comments

Production-launch/04 implemented this issue's three criteria at `8fa90f5`. `test/production-back-office-stubs.test.ts` has one named test per production criterion (AC1–AC5), including authenticated request detail with stored phone/private email, a missing-contact failure path, unverified-guest request success and no fake verification claim, zero observed reliability opportunities/null rates per the owner's cold-start answer, and a source grep regression guard. 97/97 focused Node tests, 7/7 focused Worker tests, and `npm run check` passed. See [the ADR and Definition-of-Done review](../../production-launch/issues/04-remove-back-office-stubs.md#comments).

## Answer

Contact snapshots are shown only on authorized request detail; absent contact is shown as missing. Identity verification is deferred to check-in under ADR 0085. Operator reliability stays unavailable at cold start under the recorded owner decision (ADR 0066 and ADR 0089 supersession). Commit `8fa90f5`.
