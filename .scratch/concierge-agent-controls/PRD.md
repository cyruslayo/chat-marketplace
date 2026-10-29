# Concierge agent controls

Status: claimed
Requested: 23 October 2026

## Goal

Implement the owner's approved controls 1–5 in sequence.
Keep the concierge useful for legitimate guest tasks while constraining replies, scope, effects, context, and resource use.
Source: `docs/research/concierge-agent-controls-2026.md`; architectural decision: ADR 0106.
Baseline: `a5b4250`; worktree: `C:\AI2026\chat-marketplace-controls`; branch: `codex/concierge-agent-controls`.

## Authorized scope

1. Typed reply plans and authoritative server-generated replies.
2. A tool-free scope classifier with safe failure and history behavior.
3. Exact tool schemas, state/capability restrictions, and server authorization.
4. Minimal untrusted context and protection against rejected-history poisoning.
5. Persistent atomic abuse budgets, adversarial tests, UI captures, and complete batch validation.

Do not deploy, push, change provider account settings, switch model defaults, or enable public commerce.
Preserve the original dirty `main` checkout. Do not copy unrelated changes into this branch.
Keep code provider-neutral and retain the conventional command paths.

## ADR map

| ADR | Constraint | Control |
| --- | --- | --- |
| 0015, 0077, 0089 | Server prices and status retain their current domain meaning. | 1, 3 |
| 0068, 0069, 0099 | Platform controls and provider-neutral interfaces; packs declare vocabulary. | 1–5 |
| 0070, 0071, 0072, 0074, 0080 | Distinct identities, current state, command authority, stale checks, conventional recovery. | 2–5 |
| 0073, 0078, 0102 | Valid registered Weaver surfaces, existing UI kit, accessible controls and reflow. | 1, 5 |
| 0075, 0076 | Minimal safe context, metadata-only diagnostics, no automation during human ownership. | 2–5 |
| 0079 | Evaluation, observable failure, and rollback evidence. | 1–5 |
| 0101 | Shared platform authority across host/domain object boundaries. | 3–5 |
| 0105 | Synthetic demo, approved model/processor scope, no production changes. | 1–5 |
| 0106 | Owner-approved control vocabulary and execution behavior. | 1–5 |

## Integration acceptance

All five issue implementations need independent diff review and focused checks before successors start.
Keep the batch claimed until the integrated gate passes.
Run `npm run check`, `npm run test:workers`, and the full `npm test` once after the five controls are integrated.
Keep durable logs, exit codes, test counts, and failure names.
Run only one browser suite or capture process at a time.
Capture changed guest surfaces at 320, 390, 768, and 1280 pixels, with overflow and target-size checks.
Rehearse synthetic live behavior with the approved model and preserve failed evidence.
