# ADR 0092 and DPIA update

Status: resolved
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

### Human review decisions (4 Oct 2026)

1. **Hosting decision:** The user accepted one SQLite-backed Durable Object per tenant with private R2 for receipt evidence and exports, with the explicit understanding that `locationHint: "afr"` is best-effort and Cloudflare has no Nigerian data-residency option.
2. **Vendor roles:** Record Cloudflare (Workers, Durable Objects, R2 and Logs) and Google Gemini as assumed/proposed processors for the data they handle. Actual role, subprocessors, contract/DPA terms and service locations must be confirmed before launch.
3. **Cross-border processing:** Nigerian privacy counsel must approve the applicable transfer basis, safeguards and destinations before production or real-person staging data is processed. Synthetic-only staging remains possible while this gate is open.
4. **Retention:** Keep ADR 0075's 30-day transient, 180-day conversation/telemetry and seven-year material-audit periods provisional. Approve a class-by-class schedule, Cloudflare Logs retention and issue 12a export retention before launch.

The decisions above are the user's answers to the issue 14 review questions. They accept the architecture, not the outstanding legal or contract conclusions. The clean integration worktree has no separate DPIA or vendor-register artifact; ADR 0065 is updated as the available canonical launch gate. The source issue 43 in the original checkout records a prior legal/privacy gate close, but its supporting DPIA/register artifacts are not present in this integration worktree.

### ADR compliance

| ADR | Constraint | Reflection |
| --- | --- | --- |
| 0004 | Backend owns authoritative transaction state | ADR 0092 assigns tenant state to the SQLite-backed Durable Object. |
| 0065 | DPIA, vendor roles, cross-border transfer and retention are launch gates | ADR 0065 names the proposed roles and open gates; issue 15 remains synthetic-data-only until closure. |
| 0075 | Minimize restricted data, redact logs, and treat retention as provisional pending review | ADRs 0065 and 0092 prohibit restricted material in ordinary model input/log projections and retain provisional periods pending approval. |
| 0090 | Receipt evidence is back-office-only and deleted after the stated period | ADR 0092 preserves private R2 storage and the existing 90-day deletion rule. |

## Answer

- Added accepted ADR 0092 at `docs/adr/0092-host-the-pilot-on-cloudflare.md`; no ADR index exists in `docs/adr/` to update.
- Updated ADR 0065 with Cloudflare/Gemini proposed processor roles, cross-border approval requirements, minimized data-flow assumptions, provisional retention, and explicit launch blockers.
- Recorded each human decision above. Open gates are: Nigerian counsel's transfer/DPIA approval, confirmation of processor roles/subprocessors/contract terms and service locations, and an approved schedule for all data classes including Cloudflare Logs and issue 12a exports. These remain explicit blockers on issue 15 even though the issue 14 architecture/documentation slice is resolved; synthetic-only staging is allowed meanwhile.
- ADRs 0004, 0065, 0075 and 0090 were re-read and their constraints are mapped above and in the two ADR documents.
