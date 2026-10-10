# Remove production stubs in the back office

Status: ready-for-agent
Type: task
Blocked by: none

## What to build

`apps/local-owner/src/local-owner-environment.ts` hard-codes, in production composition: guest contacts as `+2348012345678`, guest verification as `governmentIdVerified: true`, and operator reliability as 12/12 and 0.98. Replace each with the authoritative source or the explicit policy. Read ADRs 0066, 0083 and 0085 first; if an ADR leaves a gap, record it and ask the user rather than inventing a value.

## Acceptance criteria

- [ ] The back office reads guest contact details from the stored guest contact, not a fixed number.
- [ ] Guest verification at request time follows ADR 0085 and never returns a hard-coded result.
- [ ] Operator reliability comes from stored bookings or the documented cold-start policy.
