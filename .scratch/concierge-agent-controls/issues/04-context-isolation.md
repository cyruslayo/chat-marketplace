# Isolate external context and rejected instructions

Status: claimed
Blocked by: 03

## What to build

Implement control 4 and ADR 0106 through pack-owned public-fact projections and platform history construction.
Minimize what listing/tool data reaches the model; preserve source/trust labels for remaining external strings.
Never promote external narrative into system instructions, tool schemas, scope policy, reply copy, or permission lists.
Keep credentials, private identity/payment material, raw exception text, and hidden internal identifiers out of model-visible context and diagnostics.
Quarantine rejected guest/model content from later model history and trusted summaries without erasing committed domain audit evidence.
Bound retained model context through configured engineering limits and safe summaries of canonical state, rather than model-written authority.
Keep Node and Cloudflare persistence behavior consistent.
Treat unknown tool names and provider error codes as untrusted diagnostic data.
Log closed known names/codes or a fixed unknown marker, rather than arbitrary model-selected strings.
Keep raw application results separate from the minimized model history when rendering trusted replies.

## Acceptance criteria

- [ ] AC1: Injections in titles, descriptions, amenities, and tool-result strings cannot change tools, instructions, authorization, reply facts, URLs, or actions.
- [ ] AC2: Classifiers receive only current input plus minimal canonical task facts; model context excludes unnecessary narrative and restricted fields.
- [ ] AC3: Rejected turns cannot poison later model requests after a normal turn, task switch, persistence round trip, or cold start.
- [ ] AC4: Safe tool projections still provide enough facts for discovery, comparison, pricing, status, and booking preparation.
- [ ] AC5: Diagnostics and artifacts contain only permitted metadata, with no prompts, replies, keys, or restricted identity/payment material.

## ADR compliance

Use PRD's ADR map and ADR 0106. Test actual model requests and application persistence boundaries, rather than isolated sanitizers alone.

## Comments

Implementation evidence (23 Oct 2026): the five `AC1`–`AC5` tests in `test/assistant-context-isolation.test.ts` were added before runtime changes. The first test run failed on an invalid fixture (`unitRepository.all`); after correcting the fixture, AC2 detected raw phone data in classifier input, AC3 detected model prose and rejected input in stored history, AC5 detected arbitrary provider codes in diagnostics. These were implementation failures, not skipped assertions.

ADR constraints applied:

| ADR | Constraint applied | Code and acceptance criteria |
| --- | --- | --- |
| 0068, 0069, 0099 | Platform builds provider-neutral history; packs own public projections. | `AssistantDomainPack.projectToolResult` and runtime history; AC1–4. |
| 0070, 0071, 0075 | Keep interaction and domain identity separate; redact and minimize context and diagnostics. | Current-input redaction, sanitized persistence, allowlisted diagnostics; AC2, AC3, AC5. |
| 0072, 0074, 0080 | Keep command authority, stale checks, and conventional recovery. | Valid tool call/result pairing and unchanged command flow; AC1, AC4. |
| 0077, 0079 | Build replies from canonical facts; bound replayable history and keep diagnostics safe. | Raw local results versus projected model results, bounded history, fixed diagnostics; AC1, AC3, AC5. |
| 0101, 0105, 0106 | Keep platform/domain ownership and demo defaults; external text and model output never grant authority. | Separate pack projections, no raw reply history, fixed error metadata; AC1–5. |

Red evidence: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-context-isolation.test.ts` initially failed 5/5 because of fixture errors and the expected leaks. After fixture repair it failed 1/5: AC5 exposed `TOKEN-SECRET` as `providerErrorCode`. Runtime changes addressed the failures.

Green evidence: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-context-isolation.test.ts test/assistant-interactions-protocol.test.ts test/assistant-scope-persistence.test.ts test/assistant-tool-authorization.test.ts test/assistant-pack-registry.test.ts` passed 29/29. `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/shortlet-assistant-evals.test.ts` passed 49/49. `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npm run check` passed, including all Cloudflare type checks and Worker bundle guard.

Latest post-review evidence: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-context-isolation.test.ts test/assistant-interactions-protocol.test.ts test/assistant-scope-persistence.test.ts test/assistant-tool-authorization.test.ts test/assistant-pack-registry.test.ts test/commerce-agent-tools.test.ts` passed 46/46. This includes bounded-context overflow, current booking/offer status facts, mixed valid/rejected tool continuity, and rehydrated adapter continuity. `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/shortlet-assistant-evals.test.ts` passed 49/49 after history-bound changes. The latest `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npm run check` passed with the Worker bundle guard.

The persistence test uses `LocalGuestApp`, a remote guest-data port backed by SQLite, and a fresh runtime. It proves rejected tool names, identity arguments, and arbitrary provider steps do not reappear after cold start. Gemini tests preserve signed thoughts and validated matching function calls; they drop model output, thought summaries, and rejected calls.

Issue 05 note: draft projections retain only the closed `request_draft.create` operation, `created`, `availabilityChecked`, and `inventoryReserved` booleans. Evaluation outcome counts should use actual application effects. History step offsets are unstable because canonical summaries and trimming can change step positions.

Definition of Done review: all five criteria have named tests; named failure cases include sensitive-input redaction, invalid-call quarantine, persistent history inspection, successful discovery/details/compare/price/status/draft/request/offer projections, unknown diagnostics, and safe provider continuity. No new dependency or domain policy constant was added. The existing redactor serves sensitive-data handling. Configurable engineering bounds default to 32 history steps, 24,000 history characters, and 8 projected context items, with runtime validation. Issue remains claimed pending independent review and batch gates; full batch gates run after all five controls.

Independent parent review accepted commit `c2c1b4f` without OpenRouter context blockers. Parent reran context, scope, and OpenAI adapter checks at 21/21 (`controls04-final-parent.log`).

Cold-start continuity follow-up red: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-persistent-continuity.test.ts` initially failed because the authenticated HTTP `/api/state` route returned an empty timeline immediately after an Assistant search. The prior fast path created an empty runtime thread and returned `timeline: []` before loading the owner-checked Guest projection.

The follow-up stores only a closed Shortlet context: validated city, current filters, selected Unit reference, and existing owner-scoped workflow references. It omits Assistant conversation history, prompts, model prose, provider steps, credentials, listing artifacts, descriptions, and amenities. It redacts persisted user timeline text and uses shared server-authored timeline copy. Restore validates principal and tenant, re-queries current discovery facts, reconstructs Assistant shortlist and selected Unit state, and rebuilds the legacy surface from current domain state. The test exercises search, HTTP refresh, process restart, a real result-view event, detail follow-up, another restart, draft follow-up, current booking status, owner-checked conventional draft and Review routes, and wrong-principal/tenant rejection.

ADR constraints applied:

| ADR | Constraint applied | Code path |
| --- | --- | --- |
| 0070, 0093 | Bind persisted work to authenticated principal and tenant; identity fields never come from the model. | `#hydrateThreadRecord`, `restoreShortletState`, wrong-owner tests. |
| 0071, 0075 | Keep interaction projections redacted and omit restricted data and model history. | `assistantContext`, redacted timeline, no discovery narrative in Assistant projections. |
| 0072, 0080 | Preserve command authority and conventional draft/Review routes. | `getState`, `#restoreCurrentSurface`, HTTP Review test. |
| 0077 | Rebuild canonical presentations from current authorized domain artifacts. | `#assistantContextSearch`, detail and draft restoration. |
| 0099, 0101 | Keep pack state behind the platform host and read threads through the authorized local/remote guest-data boundary. | Assistant-to-Guest projection sync and restore path. |
| 0094 | Do not add identity assurance or restricted identity fields to Assistant continuity. | Closed assistant projection contains no identity or payment data. |

Green evidence: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-persistent-continuity.test.ts` passed 1/1 after the restore fix. `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-persistent-continuity.test.ts test/local-guest-shell.test.ts test/guest-process-restart.test.ts test/guest-booking-journey.test.ts` passed 37/37. The latest `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npm run check` passed, including all Cloudflare type checks and the Worker bundle guard. The follow-up commit and issue remain claimed pending independent review and the five-control batch gate.

Final follow-up evidence after preserving the original discovery action/artifact pairing: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-persistent-continuity.test.ts test/local-guest-shell.test.ts` passed 9/9; the latest `npm run check` passed. The test verifies storage contains no Assistant `conversationHistory`, `rawStep`, original guest prompts, or external listing narrative. Assistant continuity restores only from the owner/tenant-checked canonical projection.
