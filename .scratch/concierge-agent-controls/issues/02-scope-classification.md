# Classify concierge scope without granting authority

Status: ready-for-agent
Blocked by: 01

## What to build

Implement control 2 and ADR 0106 through the platform-owned pack interface and model port.
Use a tool-free structured classifier with the same explicitly configured approved model/provider.
Classify scope as `in_scope`, `mixed`, `out_of_scope`, or `unclear` with closed reason/risk/intent codes.
Supply only the new guest message and a minimal server-built task summary, never listing text or rejected history.
Keep original text server-side for argument provenance checks, without feeding rejected portions into later model prompts.
Use a bounded validated scoped intent for mixed requests. The unsupported part must never become freeform generation or a tool permission.
Preserve greetings, accommodation questions, Nigerian phrasing, terse follow-ups, legitimate account/booking questions, and current support routes.
Classifier failure gets fixed clarification or a conventional route. It cannot bypass the guard or erase valid domain state.
Perimeter/session checks precede the guard. Existing authorized pending decisions bypass classification and need no model call.
Wire the real Node and Cloudflare compositions; this must not remain a test-only injectable control.

## Acceptance criteria

- [ ] AC1: Unrelated requests return fixed redirects without running the planning model or tools.
- [ ] AC2: Valid stay requests, greetings, Pidgin, location corrections, and terse contextual follow-ups continue normally.
- [ ] AC3: Mixed requests process only the validated supported intent; model-supplied privileges and unsupported operations remain unavailable.
- [ ] AC4: Refusal, timeout, malformed JSON, extra fields, unknown labels, and exhausted guard quota use safe fixed behavior without unrestricted fallback.
- [ ] AC5: Authorized pending confirmations/cancellations work during classifier outage and do not invoke the classifier.
- [ ] AC6: Rejected guest text and rejected guard/model prose cannot enter future classifier/planner context or trusted summaries, including remote persistence/rehydration.
- [ ] AC7: Both production composition paths construct the configured guard without changing approved model/provider defaults.

## ADR compliance

Use PRD's ADR map and ADR 0106. Tests use the application turn boundary, actual runtime, and host configuration/composition.

## Comments

Record exact commands, pass counts, commit, and Definition of Done evidence.
