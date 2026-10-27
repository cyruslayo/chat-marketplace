# Classify concierge scope without granting authority

Status: claimed
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

Implementation uses the existing model port in both Node and Cloudflare compositions.
The default classifier sends no tools or previous conversation.
Timeout, invalid verdicts, unknown risks, and rejected scope return fixed copy.
Mixed requests retain original date evidence only within server execution.
Their model input contains typed slots and closed intents.
Mixed neighbourhoods must match the active pack's canonical inventory locations.
Rejected input is omitted from durable application timelines through a server-only result flag.
Pending decisions retain their existing command gate before classification.

ADR table: PRD maps ADRs 0068/0099 to the platform guard and pack vocabulary;
0070–0072/0074/0080 to pending decisions and principal-bound state;
0075/0076 to isolated context and metadata; 0105/0106 to unchanged provider defaults and fail-closed scope.
Each constraint remains reflected at these callsites.

Verification uses `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow`:

- `npx tsx --test --test-timeout=120000 test/assistant-scope-controls.test.ts`: 7 passed, 0 failed after independent-review corrections.
- `npx tsx --test --test-timeout=120000 test/assistant-scope-controls.test.ts test/shortlet-assistant-evals.test.ts test/assistant-reply-coverage.test.ts`: earlier compatibility baseline 57 passed, 0 failed.
- `npx tsx --test --test-timeout=120000 test/assistant-scope-controls.test.ts test/assistant-interactions-protocol.test.ts test/assistant-pack-registry.test.ts test/assistant-task-rail.test.ts test/demo-extended-assistant.test.ts`: 26 passed, 0 failed before the final parser/provenance corrections.
- `npm run check`: passed before final parser tightening; final check recorded below.

The initial four acceptance tests failed before implementation.
An added pending-decision test initially expected undefined, while canonical empty state uses null. The assertion was corrected.
Independent review identified date provenance loss, slot smuggling, and enum coercion. Regression checks now cover all three.
Remote persistence integration and complete cross-control evaluation remain in control 4/5.
Definition of Done: named tests and focused evidence exist; full batch gates, captures, and final review remain outstanding.
This issue remains claimed.

Final checks: npm run check passed. Final protocol/pack/task/demo command (same four paths above without scope file) passed 19/19. Scope file passed 7/7 after corrections. Logs: controls02-final-check.log, controls02-final-compat.log, controls02-reviewed2.log in the OS temporary directory.

Independent review of 76ff0fc found no remaining control02 code blockers. Reviewer reproduced date success, rejected slot injection, and rejected non-string enums. Reviewer inspected timeline propagation but did not execute remote rehydration. Implementation commit: 76ff0fc. Remote integration remains explicitly open for04.

Additional AC6 integration: npx tsx --test --test-timeout=120000 test/assistant-scope-persistence.test.ts passed 1/1. The test uses actual LocalGuestApp persistence through GuestDataPort, SQLite authority, and a fresh application instance. Rejected markers stay absent from the stored projection and later model requests. This covers the port integration; Cloudflare RPC transport remains part of the Worker gate.
