# ADR 0092 and DPIA update

Status: ready-for-human
Type: grilling
Blocked by: none
Branch: `infra/cf-14-adr-0092`
Requested: 2 Oct 2026
Unlocks: 15

## Why

Moving the pilot to Cloudflare is a system-wide architectural decision. It also changes the vendor and data-protection position: Cloudflare and R2 become processors, and Durable Object placement is only a hint, with no Nigeria jurisdiction option. ADR 0065 makes the DPIA, vendor roles and retention launch gates.

## What to build

- An agent drafts `docs/adr/0092-host-the-pilot-on-cloudflare.md` in the format of the existing ADRs (read 0086 to 0091 first). It covers:
  - one SQLite-backed Durable Object per tenant as the single system of record;
  - why Durable Objects and not D1 (synchronous SQL, `transactionSync`; see the PRD);
  - R2 for receipt evidence and exports;
  - no Nigerian data residency (`locationHint: "afr"` is best effort);
  - sharding by tenant later;
  - the consequences for ADRs 0004, 0065, 0075 and 0090.
- The agent drafts the ADR 0065 launch-gate updates, wherever the DPIA and vendor register live (find them; check `.scratch/shortlet-concierge-launch/issues/43-*`):
  - vendor roles for Cloudflare (Workers, Durable Objects, R2, Logs) and Google Gemini;
  - cross-border transfer;
  - retention periods, including 12a's export retention.
- **The user reviews and decides**, through a grilling session. Record the questions and answers under `## Comments`.

## Acceptance criteria

- AC1: ADR 0092 exists, is accepted by the user, and is linked from the ADR index if there is one.
- AC2: The ADR 0065 gate items for Cloudflare and Gemini are updated, and any item still open is listed as a blocker for 15.
- AC3: Every decision recorded traces to a user answer in `## Comments`.

## ADR compliance

| ADR | Relevance |
| --- | --- |
| 0065 | Launch gates |
| 0075 | Retention and minimisation |
| 0004 | Single system of record |

## Definition of Done

Items 3 and 5 of the DoD apply. There is no code.

## Comments
