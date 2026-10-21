# Demo launch map

Parent: [PRD.md](PRD.md)

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Record the public demo exception ADR](issues/01-record-public-demo-exception-adr.md) | HITL | ready-for-human | none |
| 02 | [Run the concierge on GPT-6 Luna via OpenRouter](issues/02-run-concierge-on-gpt6-luna-via-openrouter.md) | AFK | ready-for-agent | 01 |
| 03 | [Benchmark GPT-6 Luna against the baseline](issues/03-benchmark-gpt6-luna.md) | AFK | ready-for-agent | 02 |
| 04 | [Add a staging-only demo mode](issues/04-add-staging-only-demo-mode.md) | AFK | ready-for-agent | 01 |
| 05 | [Seed demo apartments with photos](issues/05-seed-demo-apartments-with-photos.md) | AFK | ready-for-agent | 04 |
| 06 | [Deploy the demo to Cloudflare staging](issues/06-deploy-demo-to-cloudflare-staging.md) | HITL | ready-for-human | 02, 04, 05 |
| 07 | [Verify the live demo journey end to end](issues/07-verify-live-demo-journey.md) | AFK | ready-for-agent | 03, 06 |

## Frontier

01 is the frontier. Once it is done, 02 and 04 can run in parallel, since they touch different files. 03 follows 02, and 05 follows 04.

```
01 → 02 → 03 ──────────┐
01 → 04 → 05 → 06 → 07 ←┘
     02 ─────────↗
```

## Context pointers

(Add one line per resolved issue: what changed and where.)
