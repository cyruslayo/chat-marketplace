# Pilot metrics operators can see

Status: ready-for-agent
Type: AFK
Blocked by: 04
Requested: 8 Nov 2026
Wraps: [pilot-launch-readiness/13](../../pilot-launch-readiness/issues/13-pilot-metrics.md) (its acceptance criteria apply; resolve both together)

## Parent

[PRD](../PRD.md), goal "operators must see value".

## Why

Operators and the owner judge the pilot by numbers: how many requests came, how fast they were confirmed, what was paid and what the owner is owed. Pilot 13 specifies the report; on Cloudflare it must read from the Durable Object, not a Node SQLite file.

## What to build

The pilot 13 report as a back-office page behind operator authentication (ADR 0086), reading the production store on both Node and the Worker. Define every metric name in `domains/shortlet/CONTEXT.md` before using it. Owner payables use the existing per-period payables (ADR 0089, 0092); Extended Stay periods may show as zero while issue 06 keeps them off.

## Acceptance criteria

- [ ] AC1 to AC5: the five criteria of pilot-launch-readiness/13, one named test each.
- [ ] AC6: The page works on the Worker (a `apps/cloudflare/test/*.spec.ts`).
- [ ] AC7 failure path: the page refuses a request without operator authentication.
- [ ] AC8: The page shows no guest contact, card or payment-reference material beyond what ADR 0075 and 0096 allow.

## ADRs to read

0075, 0086, 0089, 0092, 0096.

## Comments
