# Map: connect the deterministic concierge to the assistant

PRD: [PRD.md](PRD.md). Research: [../assistant-date-understanding/RESEARCH.md](../assistant-date-understanding/RESEARCH.md) (section 6 is the gap table).

## Order

```
01 ADR amendment (owner) ──► 02 shared resolver ──► 04 date phrases ──► 13 draft revision
03 date in prompts ─────────────────────────────────┘        │
02 ──► 05 checkout and ranges ───────────────────────────────┘
06 budget chip bug ──► 07 budget from guest words
08 closed lists ──► 09 location question + unsupported note
               └──► 11 facility answers + stage replies
04 05 07 08 09 11 12 13 ──► 16 parity suite
```

02 is resolved, so 04 and 05 are no longer blocked by it (both still need triage).
Owner decisions: none open (01 decided 2 Nov 2026). 17 resolved: path retired.

| # | Issue | Status | Blocked by |
|---|---|---|---|
| 01 | [Amend ADR 0106 for confirmed relative dates](issues/01-amend-adr-0106-for-confirmed-guest-phrases.md) | resolved | none |
| 02 | [Shared stay-date resolver](issues/02-shared-stay-date-resolver.md) | resolved | none |
| 03 | [Give the models today's date](issues/03-give-models-the-current-date.md) | resolved | none |
| 04 | [Assistant resolves and confirms date phrases](issues/04-assistant-resolves-and-confirms-date-phrases.md) | needs-triage | 02 |
| 05 | [Assistant checkout and date ranges](issues/05-assistant-checkout-and-date-ranges.md) | needs-triage | 02 |
| 06 | [Bug: budget chip never reaches the assistant](issues/06-sync-budget-chip-into-assistant.md) | resolved | none |
| 07 | [Assistant budget from guest words](issues/07-assistant-budget-from-guest-words.md) | resolved | 06 |
| 08 | [Closed lists for amenities and areas](issues/08-closed-lists-for-amenities-and-areas.md) | resolved | none |
| 09 | [Location-change question and unsupported preferences](issues/09-location-change-question-and-unsupported-preferences.md) | needs-triage | 08 |
| 10 | [Quick-reply chips on assistant clarifications](issues/10-quick-reply-chips-on-assistant-clarifications.md) | resolved | none |
| 11 | [Honest facility answers and stage replies](issues/11-honest-facility-answers-and-stage-replies.md) | needs-triage | 08 |
| 12 | [Explain changes after submission](issues/12-explain-changes-after-submission.md) | resolved | none |
| 13 | [Revise a draft from chat on the assistant path](issues/13-revise-draft-from-chat-on-assistant-path.md) | needs-triage | 04, 05 |
| 14 | [Plain-word date clarification](issues/14-plain-word-date-clarification.md) | resolved | none |
| 15 | [Bug: invented defaults in the request summary](issues/15-remove-invented-defaults-in-request-summary.md) | resolved | none |
| 16 | [Parity suite for both concierges](issues/16-parity-suite-for-both-concierges.md) | needs-triage | 04, 05, 07, 08, 09, 11, 12, 13 |
| 17 | [Decide the legacy Gemini concierge](issues/17-decide-the-legacy-gemini-concierge.md) | resolved | none |

## Already connected (no issue needed)

Every button event (View, Compare, Request to Book, Submit, phone, email, Accept Offer, payment) goes through the shared handlers. The where, when and guests chips, and criteria undo, are recorded in the assistant task state (`shortlet-app.ts:4083`). Assistant search results are written back to the shell context on cold restore (`#assistantContextSearch`).

## Resolved

- 01: ADR 0106 amended 2 Nov 2026 (confirmed date phrases are guest-authored); CONTEXT.md gains Date phrase and Show-back.
- 17: the older Gemini concierge path is removed; see the issue's Answer.
- 02: shared stay-date resolver in the shortlet domain; the deterministic and assistant paths both use it. Deviations and owner questions are in the issue's Comments.
- 07: the assistant reads the budget from the guest's own words (`budgetPhrase`) with the shared parser; open owner question on the held-budget repeat rule (issue 07 Comments).
