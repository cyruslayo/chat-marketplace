# 06 · Keep internal terms out of guest copy

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0106 (assistant path), 0005 (Request to Book wording); guideline §9 vocabulary table

## What to build

Guests must never see internal state names or raw IDs (§9).

- `apps/web-agent/src/guest-content.ts:68-70`: the model-path receipt says "Booking Request {id} has been disclosed" and shows raw contract and offer IDs. It is used at `apps/local-guest/src/assistant/shortlet-assistant-pack.ts:1449`. Use the guest wording "Request sent. Waiting for the Operator to respond." and keep IDs in secondary details.
- `guest-content.ts:76` says "Commerce surface", and lines 273-280 say "in the workspace". Replace these with words the guest knows (for example "the stay details beside the chat"), following `docs/design/shortlet-design-system-direction.md` vocabulary.
- Extend `GUEST_FORBIDDEN_TERMS` (`guest-content.ts:84-90`) with `disclosed`, `surface`, `workspace` and `artifact`. Add a test that sweeps every exported guest string in `guest-content.ts`.

## Acceptance criteria

1. The model-path request receipt names the request as sent and waiting for the Operator, with no raw contract or offer ID in its main text
2. No exported guest string contains a forbidden term, and the sweep test fails when one is added
3. An assistant-enabled cold-restore journey shows the new receipt after submit

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Assistant path: read ADR 0106 in full first. Tests run with the assistant runtime enabled and a cold restore (a new `LocalGuestApp` over the same store) before every event, on a fresh thread, with a staging-like clock (2026-10-27) and guest. `test/assistant-cold-journey.test.ts` is the model.

## Comments
