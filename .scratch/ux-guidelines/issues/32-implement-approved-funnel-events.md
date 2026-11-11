# 32 · Implement the approved funnel events

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 5 (Batch E)
Applicable ADRs: 0075 (no identity material in logs), 0106 (assistant path, cold restore); guideline §13 measurement plan

## What to build

The owner approved three events from issue 30 on 11 Nov 2026. Add exactly these, on the same channel as the existing domain transition events (asserted by `test/guest-transition-telemetry.test.ts`):

- **`discovery.results`**: emitted when discovery produces a results artifact. Fields: `stage` (closed: `discovery-results`, `unit-detail`), `resultCount` (count).
- **`draft.correction`**: emitted when the guest corrects a Request Draft. Fields: `category` (closed: `dates`, `guests`, `budget`, `contact`, `other`), `attempt` (count). Never the entered values.
- **`operator.response.latency`**: aggregate only. Fields: `bucket` (closed: `<5m`, `5-10m`, `10-30m`, `>30m`), `count`. No per-request row, id or Operator identity.

Not approved, so do not build it: `recovery.outcome` (listed as proposed in issue 30's table). If a §13 signal needs it, raise it with the owner.

## Acceptance criteria

1. Each of the three events is emitted at its point, with only the listed fields
2. Every field is a closed enum or a count; a test fails if any other field, free text, phone, email, reference, token, URL or id appears
3. `draft.correction` records the category, never the corrected value
4. `operator.response.latency` is emitted only as an aggregate bucket and count
5. The assistant path emits the same events as the conventional path, tested with the runtime enabled and a cold restore before every event (ADR 0106)

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- No other events and no new telemetry channel. Extend the closed-field assertion in `test/guest-transition-telemetry.test.ts`.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.

## Comments
