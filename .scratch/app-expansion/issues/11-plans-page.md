# The guest's list at `/plans`

Status: ready-for-agent
Type: task
Blocked by: none (10 resolved; D8, D9, D10 accepted 27 Nov 2026). Opening a row from a signed-in second device needs guest-accounts 13; until it lands, that device keeps today's refusal. Replaces guest-stays 03 and 04

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
- 27 Nov 2026: owner accepted D8 (works on this device's own session, after the shared-device review), D9 (lists open requests and expired offers) and D10 ("Your stays", address `/plans`). Build for this device first; linked-device row pages follow guest-accounts 13.
