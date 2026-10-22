# Demo launch map

Parent: [PRD.md](PRD.md)

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Record the public demo exception ADR](issues/01-record-public-demo-exception-adr.md) | HITL | resolved | none |
| 02 | [Run the concierge on GPT-6 Luna via OpenRouter](issues/02-run-concierge-on-gpt6-luna-via-openrouter.md) | AFK | resolved | 01 |
| 03 | [Benchmark GPT-6 Luna against the baseline](issues/03-benchmark-gpt6-luna.md) | AFK | ready-for-agent | 02 |
| 04 | [Add a staging-only demo mode](issues/04-add-staging-only-demo-mode.md) | AFK | resolved | 01 |
| 05 | [Seed demo apartments with photos](issues/05-seed-demo-apartments-with-photos.md) | AFK | ready-for-agent | 04 |
| 06 | [Deploy the demo to Cloudflare staging](issues/06-deploy-demo-to-cloudflare-staging.md) | HITL | ready-for-human | 02, 04, 05 |
| 07 | [Verify the live demo journey end to end](issues/07-verify-live-demo-journey.md) | AFK | ready-for-agent | 03, 06 |

## Frontier

02 and 04 are resolved. 04 is resolved with open items recorded in its Comments (chat chip screenshot, chat-path delay, operator pages and local pilot out of scope). 05 is next. This run follows the owner's requested order: finish 02, then 04. 03 follows 02, and 05 follows 04.

```
01 → 02 → 03 ──────────┐
01 → 04 → 05 → 06 → 07 ←┘
     02 ─────────↗
```

## Context pointers

- 01: [ADR 0105](../../docs/adr/0105-public-demo-exception.md) records the accepted demo exception. ADR 0104 notes its demo-only partial supersession. Four dedicated tests and the complete suite passed.

- 04: the staging demo is off by default and refused in production (ADR 0105). Its acceptance runs the owner confirmation command path. Tests: test/demo-mode-config.test.ts, test/demo-mode-guest.test.ts, test/demo-auto-accept.test.ts, test/demo-listing-chip.test.ts, test/demo-accept-delay-config.test.ts, test/demo-mode-landing.test.ts. Captures: .scratch/demo-launch/screenshots/04/. Open items are in the issue Comments.

- 04: the staging demo is off by default and refused in production (ADR 0105). Its acceptance runs the owner confirmation command path. Tests: test/demo-mode-config.test.ts, test/demo-mode-guest.test.ts, test/demo-auto-accept.test.ts, test/demo-listing-chip.test.ts, test/demo-accept-delay-config.test.ts, test/demo-mode-landing.test.ts. Captures: .scratch/demo-launch/screenshots/04/. Open items are in the issue Comments.
