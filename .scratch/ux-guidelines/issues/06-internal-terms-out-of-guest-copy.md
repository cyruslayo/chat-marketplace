# 06 · Keep internal terms out of guest copy

Status: resolved
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

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0106 | The typed reply path supplies wording; a cold restore precedes every event; no deterministic fast path. | AC1 and AC3. `renderShortletReplyBody` supplies the receipt; the AC3 test cold-restores before the status turn. |
| 0005 | A Request is not a Reservation; the request state is described as sent and waiting for the Operator. | AC1 receipt wording. |
| 0075 | Restricted identifiers never enter general interaction state or guest-facing copy. | Raw request, offer and contract IDs leave the reply; they remain in the authorized surface/workspace projection. |
| 0074 | Surfaces keep complete text and authoritative state; they never guess. | The receipt is server-authored from the tool result, not model prose. |
| 0080 | Chat and deterministic routes carry the same facts. | `GUEST_RECEIPTS.requestSent` and the new receipt both stop before any Reservation claim. |

### Code contradiction found and recorded

- A literal `workspace` in `GUEST_FORBIDDEN_TERMS` would flag the legitimate guest amenity "Dedicated workspace" (`GUEST_AMENITY_LABELS.workspace`), and a literal `disclosed` would flag counsel's contract terms ("Undisclosed commercial use", "disclosed Pet Friendly terms"). The forbidden forms are narrowed to the internal phrases `/\bthe workspace\b/` and `/\bhas been disclosed\b/`; the issue's intent (no internal state names or UI jargon) is kept.
- The model-path receipt never reached the new wording because `get_booking_status` returned `{ status, ...details }` and `details.status` overwrote the top-level status with the domain status. Fixed to `{ ...details, status }`, with the domain status kept as `requestStatus` / `offerStatus`. This is required for AC1/AC3 and has no effect on the authoritative domain state.
- AC1 says "keep IDs in secondary details". The reply is a single string, so the raw IDs leave the reply and remain in the authoritative surface/workspace projection shown beside it. No new reply structure was invented.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-internal-terms.test.ts test/guest-copy-pass.test.ts test/assistant-facility-answers.test.ts test/shortlet-assistant-evals.test.ts` — 71 tests, 71 passed, 0 failed.
- `npx tsx --test test/landing-page.test.ts` — 33 tests, 33 passed, 0 failed.

## Answer

Guest copy no longer exposes internal state names, UI jargon or raw request/offer/contract IDs. The model-path receipt now reads "Request sent. Waiting for the Operator to respond." and the capability replies point at "the stay details beside the chat". The forbidden-term sweep covers every exported string in `guest-content.ts` and fails when an internal term is added. An assistant-enabled cold-restore journey shows the new receipt after submit. A latent `get_booking_status` result-ordering defect that masked the receipt was fixed.
