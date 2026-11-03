# Guest focused journey map

PRD: `PRD.md`. Branch: `codex/guest-focused-journey`. Base: `1c2e0b8d714ff6d3ea0b0ae700eef2ab56f0524d`.

| # | Issue | Blocked by | Status |
| --- | --- | --- | --- |
| 01 | Entry and search continuity | none | resolved |
| 02 | Focused phone shell | 01 | resolved |
| 03 | Request and contact repair | 02 | resolved |
| 04 | Offer and payment clarity | 03 | resolved |
| 05 | Confirmation hierarchy | 04 | ready-for-agent |

Issue 01 context: commits `c2fb932` and `1d289d6`; acceptance evidence is in `issues/01-entry-search-continuity.md`.
Issue 02 context: commit `b36b0dd`; acceptance evidence is in `issues/02-focused-phone-shell.md`.
Issue 03 context: commits `d75532f`, `32b15b4`, and `09cb9b4`; independent review passed. Evidence is in `issues/03-request-contact.md`.

Issue 04 context: commit `eb70378`; independent review passed 22/22 tests. Evidence is in `issues/04-offer-payment.md`.

One GPT-6 Luna medium executor writes at a time. A separate reviewer checks each issue after its commit. The parent verifies actual diffs and results before assigning the next issue. Full pre-merge gates run once on the final commit. The batch remains separate from `main` until owner approval.
