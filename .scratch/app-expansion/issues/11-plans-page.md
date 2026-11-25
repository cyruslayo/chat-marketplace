# The guest's list at `/plans`

Status: needs-info
Type: task
Blocked by: 10, guest-accounts 13 (D21 accepted), D8, D9, D10 (owner). Replaces guest-stays 03 and 04 once accepted

## What to build

- `GET /plans`, plain HTML first (ADR 0080), from the kit's Your stays board. Title "Your stays" with one domain, "Your plans" with more.
- States: several, one, empty, error, loading; signed out as D8 decides.
- Entry points: the committed-work note, the account page, and the assistant's status reply (parity).
- A shared-device review recorded in Comments before code, if D8 is yes.

## Acceptance criteria

- AC1: Every cell of the rules 02 decision table (viewer × booking) is tested.
- AC2: After sign-out, no account row is visible.
- AC3: Each row opens its own page; a row whose state has changed opens the current state.
- AC4: Chat and page show the same rows and words.
- AC5: It works without JavaScript; captures at 320, 390, 768 and 1280, light and dark.
- AC6: `/plans` with no session is refused and reveals nothing.

## ADR compliance

0005, 0071, 0074, 0077, 0078, 0080, 0085, 0093, 0106.

## Comments
