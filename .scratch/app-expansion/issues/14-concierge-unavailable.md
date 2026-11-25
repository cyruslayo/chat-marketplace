# When the concierge fails, offer the list

Status: needs-info
Type: task
Blocked by: copy approval (owner)

## Why

A failed turn offers Retry. ADR 0080 asks for a working route without the model. `/stays/search` exists and can carry the current criteria.

## What to build

- On `CONCIERGE_UNAVAILABLE`, `quota_refusal` and the no-JavaScript equivalent, show a link to `/stays/search` with the committed criteria, and to the guest's booking when one is live, beside Retry.
- Criteria come from server-held state, never from the failed message.

**Copy for approval:** "I can't answer right now." / "Your message and your search are kept. You can keep looking without me." / "Show as a list".

## Acceptance criteria

- AC1: After a failed turn the guest can reach matching results with no model call.
- AC2: The link carries only committed criteria; with none, it opens the plain search.
- AC3: The kept message and Retry behave as today, with no duplicate turn.
- AC4: It works after a cold restore, with the assistant enabled.
- AC5: A human-owned conversation shows no concierge wording.

## ADR compliance

0076, 0080, 0106.

## Comments
