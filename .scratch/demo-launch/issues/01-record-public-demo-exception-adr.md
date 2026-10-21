# Record the public demo exception ADR (0105)

Status: ready-for-human
Type: HITL
Blocked by: none
Requested: 21 Oct 2026

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

The owner wants a public demo before the legal, verification and processor gates close. Under AGENTS.md, an ADR must never be silently overridden. Every later issue in this effort bypasses a constraint from 0065, 0095, 0008, 0010 or 0104, so the exception has to be written down and signed before any code relies on it.

- ADR 0065 says "No unit publishes without" CAC, management authority, licensing, insurance and an inspection (`docs/adr/0065-*.md`).
- ADR 0095 limits processors to Cloudflare and Gemini, and blocks real-person data until counsel, the DPIA and retention sign-off are done.
- ADR 0104 says the local demo exception does not grant public exposure of the development demo.
- Landing issue 13 (`.scratch/landing-page/issues/13-stays-launch-landing-decisions.md:46-48`) approved only the demo landing label.

## What to build

- Write `docs/adr/0105-public-demo-exception.md` in the house ADR format, with status `accepted` once the owner signs. It covers:
  - **Scope:** the staging Worker only, behind `SHORTLET_DEMO=enabled`; synthetic demo inventory labelled "Demo listing"; Paystack test mode only; OpenRouter (GPT-6 Luna) as a demo-only model processor; no invite gate.
  - **Deferred:** 0065, 0095 (the processor list and real-person data), 0008, 0009, 0010 and 0104, each with a one-line reason.
  - **Kept:** 0072, 0080, 0075, 0079, 0068, 0069 and 0087. They are listed explicitly so implementers do not treat them as waived.
  - **Visitor notice:** visitors are told not to enter personal data. This is a mitigation, not compliance.
  - **Reversal criteria:** remove the flag, delete the demo inventory and photos, and mark 0105 superseded before any real launch. Production refuses demo mode.
- Add a "Superseded in part by 0105 (demo only)" note to 0104. Do not edit the other ADRs.

## Acceptance criteria

- [ ] AC1: `docs/adr/0105-public-demo-exception.md` exists and lists every deferred ADR with its reason, and every kept ADR.
- [ ] AC2: The ADR states that demo mode is refused in production. That is the constraint issue 04 tests.
- [ ] AC3: The ADR states the reversal criteria.
- [ ] AC4: The owner has recorded their sign-off in `## Comments` with a date.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0065, 0095 | Verification baseline; processor and data gates | Deferred (AC1) |
| 0008, 0009, 0010 | Inspection and operator verification | Deferred (AC1) |
| 0104 | No public development demo | Superseded in part (AC1) |
| 0072, 0080, 0075, 0079, 0087 | Command gate, deterministic parity, data minimisation, upgrade evidence, test keys | Kept (AC1) |

## Comments
