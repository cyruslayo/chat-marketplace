# 28 · Extended Stay collection and Notice to End copy

Status: resolved (structural line only; counsel terms remain open)
Type: task
Blocked by: 27
Phase: 4 (Batch D)
Applicable ADRs: 0092 (counsel gate)

## What to build

Guideline §11 asks the review and offer to say that later periods are not charged automatically, and to show the cancellation and Notice to End terms once approved. ADR 0092 leaves counsel-specific text as a gate.

- The owner supplies the approved wording.
- The agent then adds it to `guest-content.ts` and the screens from 27.
- Never draft legal text, and never use lease, tenancy, rent or landlord.

## Acceptance criteria

1. The approved wording is recorded here with its source
2. The offer and review show the wording for Extended Stays only
3. No guest string uses lease, tenancy, rent or landlord

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments

### Owner decision (10 Nov 2026): structural line only

The owner approved adding only the non-legal structural line, leaving the cancellation and Notice to End terms as counsel text. The line is carried by the existing `GUEST_FACT_LABELS.firstPeriodOnly`, which every Extended Stay schedule already shows: "This is the first Billing Period only. Later Billing Periods are paid separately on their due dates; they are not charged automatically." Source: owner decision in this session; the underlying rule is ADR 0092 (each Billing Period is a separate Period Payment).

The Extended Stay cancellation and Notice to End wording is **not** added: ADR 0092 marks those as counsel text not yet recorded, and this issue must not ship guest-facing behaviour that depends on them.

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0092 | Each Billing Period is a separate Period Payment; cancellation and Notice to End text is a counsel gate. | AC1 and AC2; the legal terms remain open. |

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/extended-stay-counsel-copy.test.ts` — 3 tests, 3 passed, 0 failed.

## Answer

Only the owner-approved structural line is added: later Billing Periods are paid separately on their due dates and are not charged automatically. It appears wherever an Extended Stay schedule appears and never on a Short Stay. The cancellation and Notice to End terms remain counsel text and are listed as an open gate for issue 31.

## Owner confirmation (11 Nov 2026)

The owner confirmed the wording in chat: "This is the first Billing Period only. Later Billing Periods are paid separately on their due dates; they are not charged automatically." The cancellation and Notice to End terms are still counsel text, and they remain an open gate for issue 31.
