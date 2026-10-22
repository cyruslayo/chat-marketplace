# Record the public demo exception ADR (0105)

Status: resolved
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

- [x] AC1: `docs/adr/0105-public-demo-exception.md` exists and lists every deferred ADR with its reason, and every kept ADR.
- [x] AC2: The ADR states that demo mode is refused in production. That is the constraint issue 04 tests.
- [x] AC3: The ADR states the reversal criteria.
- [x] AC4: The owner has recorded their sign-off in `## Comments` with a date.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0005 | Operator confirmation precedes payment; verified payment precedes reservation | Kept (AC1) |
| 0008 | Physical inspection before publication | Deferred for synthetic units (AC1) |
| 0009 | Current inspection claims and expiry | Deferred for synthetic claims (AC1) |
| 0010 | Registered and verified contracting operators | Deferred for the synthetic operator (AC1) |
| 0065 | Verification, regulatory, and data-protection launch gates | Demo-only deferral and reversal (AC1, AC3) |
| 0068 | Platform-owned adapters and non-authoritative model output | Kept (AC1) |
| 0069 | Pinned interaction profile and fail-closed events | Kept (AC1) |
| 0072 | Consequential actions use platform commands and confirmation | Kept (AC1) |
| 0075 | Minimize interaction data and exclude credentials from logs | Kept (AC1) |
| 0079 | Model changes require evaluation and rollback evidence | Kept (AC1) |
| 0080 | Deterministic routes preserve critical workflow authority | Kept (AC1) |
| 0087 | Server-authoritative Paystack with test credentials and matching callback origin | Kept (AC1) |
| 0095 | Cloudflare authority, processor scope, and real-data gates | Hosting kept; demo processor/data exception only (AC1, AC3) |
| 0104 | Public demo restriction and public commerce restriction | Demo restriction superseded in part; commerce stays off (AC1) |

## Comments

- 21 Oct 2026: The owner accepted ADR 0105 in chat. ADRs 0008, 0009, 0010, 0065, 0095, and 0104 are deferred only within its stated demo scope. ADRs 0005, 0068, 0069, 0072, 0075, 0079, 0080, and 0087 remain in force.
- 21 Oct 2026: `npm run check` and the four issue-specific tests passed. `npm test` failed in the browser phase: `mobile-guest-journey-chromium.test.ts` could not terminate Chrome, then timed out on its browser lock. A separate focused run passed 42 of 43 tests; the remaining failure was a Windows `UNKNOWN` error while writing a screenshot. The full-suite Definition of Done gate remains open.
- 22 Oct 2026: A later full run passed 2042 of 2044 non-browser tests, with two failures. Its browser phase passed 223 of 227 tests, with one failure and three skips. The failures were two back-office `fetch failed` errors and one Windows screenshot-write `UNKNOWN` error in `discovery-phase3-chromium.test.ts`. The full-suite gate remains open.
- 22 Oct 2026: The lock watcher repeatedly observed `git.exe` children of `ChatGPT.exe` (parent PID 130772) during `.git/index.lock` creation. Its executable belongs to the installed `OpenAI.Codex` package. The observed locks cleared normally. This is process correlation, not a direct file-operation trace. The original stale lock's creator remains unproven.
- 22 Oct 2026: `npm run check` passed. `npm test -- --test-concurrency=4` passed all 2046 non-browser tests. All 35 browser files passed: 224 tests passed, three skipped, zero failed, and zero timed out. Commit `fcc4978` contains the Windows build/capture fix that removed the observed file-write failures.

## Definition of Done review

- [x] Each acceptance criterion has a dedicated named test in `test/demo-public-exception-adr.test.ts`.
- [x] This documentation issue names no failure paths. Issue 04 owns the production startup refusal test.
- [x] The compliance table records all 14 required ADRs. Each was read and checked against the accepted document.
- [x] This issue adds no constructor dependencies.
- [x] The issue and accepted ADR supply every demo policy. No domain threshold was added.
- [x] The documents and tests contain no real credentials or restricted identity material.
- [x] Type checking and the complete test suite passed with unchanged test coverage and reduced concurrency.

## Answer

The owner accepted ADR 0105 on 21 Oct 2026. It records the staging-only exception, retained constraints, production refusal, and reversal criteria. ADR 0104 carries the required demo-only partial supersession note. Runtime implementation follows in issues 02 and 04.
