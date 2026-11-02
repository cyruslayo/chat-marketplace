# Tell the classifier and planner today's date

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

Neither model is told the date. The classifier instruction (`scope-classifier.ts:79`) and the planner instruction (`ASSISTANT_PLATFORM_PREAMBLE` + `SHORTLET_PROMPT_SECTION`) have no date, weekday, time zone or horizon, so the model cannot place "next Friday" or tell a check-in from a checkout reliably.

## What to build

- Each classifier and planner request carries one line of turn context, for example `Today is Sunday 1 November 2026 (Africa/Lagos). The last bookable check-in is 30 January 2027.` Built from the injected clock and `BOOKING_HORIZON_DAYS`; the pack supplies it (ADR 0099), the runtime stays domain-neutral.
- Put it in the per-turn context, not the cached system prefix, so prompt caching still works.
- It grants no date authority (ADR 0106).

## Acceptance criteria

- [ ] AC1: A classifier request built at 2026-10-27 contains that date, its weekday and Africa/Lagos.
- [ ] AC2: A planner request contains the same line and the last bookable check-in date.
- [ ] AC3 failure path: a planner date the guest did not write is still rejected as `tool_denial` even though the model now knows the date.
- [ ] AC4: The system instruction text is identical across two turns on different days (cache stability).

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Model-only dates never authorize | AC3 |
| 0099 | Runtime has no shortlet knowledge | Line built by the pack |
| 0075 | No guest text in logs | Line holds no guest data |

## Comments
