# 08 · One money format and the glossary labels

Status: resolved
Type: task
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0015 (all-in pricing), 0080; guideline §9, §10

## What to build

- `apps/web-agent/src/deposit-claim-a2ui.ts:6` prints "NGN 1,234.00" through `toLocaleString`, and shows raw `status` and `noClaimRefundStatus` values. Use `formatMoney` (`apps/web/src/ui-kit.ts:34`) and map the statuses to guest words held in `guest-content.ts`.
- `apps/local-guest/src/assistant/pending-action-a2ui.ts:85,94` use "Stay Total" and "Refundable Deposit". Use the `GUEST_GLOSSARY` and `GUEST_FACT_LABELS` terms ("All-In Stay Total", "Refundable Security Deposit").
- Add a test that fails if any guest A2UI builder formats kobo without `formatMoney`.

## Acceptance criteria

1. Deposit-claim amounts use the same ₦ format as every other guest money value
2. Deposit-claim statuses show guest words, never raw enum values
3. Pending-action surfaces use the glossary money labels
4. The format-guard test fails on a builder that calls toLocaleString on kobo

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
| 0015 | All-In Stay Total is the canonical stay total; deposits are separate. | AC1 and AC3 labels. |
| 0016 | A Refundable Security Deposit is disclosed separately. | AC1 deposit lines and AC3 label. |
| 0078 | NGN is stored in kobo and displayed unambiguously; English (Nigeria). | AC1 and AC4: one `formatMoney`, no kobo arithmetic in a builder. |
| 0080 | Chat and standard routes carry the same facts and wording. | The same builder feeds both channels. |

### Scope decision

AC4 says "any guest A2UI builder", so the guard covers every `*-a2ui.ts` under `apps/web-agent/src` and `apps/local-guest/src/assistant`, not only the two files named in "What to build". The same duplicate `NGN … toLocaleString` pattern existed in cancellation, booking amendment, checkout/overstay, mid-stay failure, protection fund, relocation and revenue release; all now use `formatMoney`. `pending-action-a2ui.ts` carried a private formatter with identical output; it now uses the shared one.

Deposit-claim statuses are mapped with a fail-closed default ("Status unavailable") so an unknown enum never reaches the guest. Status words are presentation only; the domain state is unchanged.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-money-format.test.ts test/render-cancellation-weaver-a2ui.test.ts test/render-checkout-overstay-weaver-a2ui.test.ts test/render-protection-fund-weaver-a2ui.test.ts test/render-relocation-weaver-a2ui.test.ts test/render-bank-transfer-weaver-a2ui.test.ts` — 22 tests, 22 passed, 0 failed.
- A repository-wide guard check confirms no `*-a2ui.ts` file formats kobo with `toLocaleString`.

## Answer

Deposit-claim amounts now use the shared `₦` kobo format, and their statuses are guest words rather than raw enums. Pending-action surfaces use "All-In Stay Total" and "Refundable Security Deposit". A source guard fails if any guest A2UI builder formats kobo with `toLocaleString` instead of `formatMoney`; every builder it found was fixed.
