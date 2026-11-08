# 18 · Give notice to end an Extended Stay from the chat and the assistant

Status: claimed
Type: task
Blocked by: 17
Requested: 8 Nov 2026

## Why

Issue 17 made Notice to End work on the standalone page and in the back office. The owner decided (8 Nov 2026) that guests give notice **in the chat, from the confirmed booking, with a confirmation step**. Notice to End is the first chat action that **ends** something the guest has paid for, so it must never be confirmed by accident.

## Design (decided; do not change without asking)

1. **New pending-action type `give_notice`** in the closed union in `apps/local-guest/src/assistant/pending-actions.ts` (beside `request_to_book`, `accept_offer`, `start_checkout`), with its card in `pending-action-a2ui.ts`. The card shows the **same facts and labels as the issue 17 page** (`GUEST_NOTICE_COPY`, the domain's `previewNotice` result: new last night, new checkout, refund, still owed, and the terms). One helper renders the facts for chat and page (ADR 0077, 0080).
2. **Button-only confirmation.** A `give_notice` action is confirmed **only** by the structured confirm event from its own card (`ASSISTANT_CONFIRM` with the card's surface id and the bound `noticeDate` and `contractVersion`). Typed text ("yes", "ok", "go ahead") must **never** confirm it: the runtime's text-confirmation path must exclude this type explicitly, fail closed (an unknown type is excluded by default). Cancel ("Keep my stay" or `ASSISTANT_CANCEL`) changes nothing.
3. **Planner tool.** A shortlet pack tool, e.g. `propose_notice_to_end`, lets the planner **propose** the card when the guest asks to end early. The tool only previews; it never records notice. It is allowed only for a confirmed Extended Stay after Verified Access; otherwise it is a refused tool call (`tool_denial` via `AssistantGuestRefusalError`, never `CONCIERGE_UNAVAILABLE`). The runtime stays domain-neutral (`test/assistant-pack-registry.test.ts`).
4. **Chat button path.** The confirmed booking's chat surface gets the "Give notice to end your stay" action (`GUEST_NOTICE_COPY`), which opens the same card without the planner.
5. **Commit.** Confirming calls `NoticeToEndManager.giveNotice` with the bound `noticeDate` and `contractVersion`; a stale preview (notice date or contract version changed) is refused and a fresh card is offered.
6. **Cold restore.** The card's surface id, `noticeDate` and `contractVersion` are persisted with the thread and re-keyed on restore, never re-minted. Forged, superseded or unknown ids return `STALE_SURFACE` / `ARTIFACT_MISMATCH` and change nothing.

## Acceptance criteria

- AC1: From a confirmed Extended Stay after Verified Access, the chat action opens the notice card showing the same facts as the issue 17 page.
- AC2: Pressing "Give notice" on the card commits exactly one versioned Booking Amendment; "Keep my stay" changes nothing.
- AC3: Typed confirmations ("yes", "ok", "confirm", "go ahead") while a `give_notice` card is open never record notice, and the card stays open.
- AC4: A guest asking in chat to end early is offered the card through the planner tool; the tool never records notice by itself.
- AC5: On a Short Stay or before Verified Access, the tool is a `tool_denial` with a guest sentence and the action is not shown.
- AC6: Forged, superseded or unknown surface ids, and a stale `noticeDate` or `contractVersion`, are refused with `STALE_SURFACE` / `ARTIFACT_MISMATCH` and change nothing.
- AC7: Every test above runs with the assistant enabled and a cold restore (new `LocalGuestApp` over the same store) before every event, clock 2026-10-27, staging-like guest.
- AC8: Chat captures of the card and the recorded state at 320, 390, 768 and 1280, light and dark, with overflow and 44px checks, under `screenshots/18/`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0106 | Cold restore; persisted surface ids; `tool_denial`; no keyword fast path; domain-neutral runtime |
| 0092 (amended) | Notice to End after Verified Access; 14-day rule; refunds at nightly contracted values |
| 0060 | Versioned Booking Amendment |
| 0077, 0080 | Same helper and content for chat and page |
| 0078 | Accessible launch profile |

## Definition of Done

See `docs/agents/issue-tracker.md` and the AGENTS.md capture rules. Record commands and pass counts in Comments.

## Comments

- **8 Nov 2026, Claude (claimed: AC1-AC7 pass; AC8 partly done).** Failing tests first: `test/notice-to-end-chat.test.ts` (7 tests) failed on the missing feature before the implementation (the first failures were journey helper issues, fixed in the test; the open event returned `INVALID_EVENT`, then `UNSUPPORTED_EVENT`, then `STALE_SURFACE`, each for a real gap found and fixed below).
- **Files.** Runtime, platform and shell: `apps/local-guest/src/assistant/assistant-runtime.ts` (text-confirmation gate on the allow-list; pack-declared open events via `acceptsPackEvent` and `handleOpenAction`; confirm and cancel check the card id derived from the persisted action), `assistant-platform.ts` (the open-action hook), `control-copy.ts` (`useCardButtons`), `pending-actions.ts` (`give_notice`, the allow-list `isTextConfirmable`, notice reference fields), `pending-action-a2ui.ts` (the notice card from `noticeFactRows`), `shortlet-assistant-pack.ts` (`propose_notice_to_end` tool, gated to a stay with an offer, `proposeNoticeToEnd`, the `support` intent's tool, the open hook), `shortlet-stage-handlers.ts` (`noticeHandler`: confirms only by the card's button, stale-bound check, commit, re-presents the booking with the recorded notice), `shortlet-app.ts` (assistant events are remembered like turns so the card survives a cold restore; the shell forwards pack-declared events), `guest-projection.ts` (`give_notice` and its reference fields on the persisted allow-list), `fixture.ts` (the amended contract is written to the contract repository the booking artifact reads). Web: `apps/web/src/booking-contract-artifact.ts` (`noticeToEnd` facts), `apps/web-agent/src/booking-contract-a2ui.ts` (the Give notice action on an Extended Stay, the recorded facts instead once notice is given), `guest-content.ts` (`noticeFactRows`; the new copy). Extended-stay domain: `domains/shortlet/src/extended-stay-changes.ts` (a missing check-in record is not an open failure, so the Verified Access refusal is the one shown). Tests: `test/notice-to-end-chat.test.ts` (new), `test/helpers/notice-chat-journey.ts` (new, the shared journey), `test/assistant-stage-handlers.test.ts` (the pinned handler list gains `notice`). Capture: `.scratch/guest-ui-consistency/capture-18.ts`; screenshots `screenshots/18/chat-card-{light,dark}-{320,390,768,1280}.png` (8 files).
- **Design points as built.**
  - AC3: the confirmation allow-list (`TEXT_CONFIRMABLE_ACTION_TYPES` = request, accept, start checkout) is closed by default; a typed "yes", "ok", "confirm" or "go ahead" with an open `give_notice` card returns `ASSISTANT_CONTROL_COPY.useCardButtons` and nothing is executed. The card stays open.
  - AC4: the planner tool previews only; the `support` intent offers it (`toolIntentMap.support`).
  - AC5: the tool's refusals are `AssistantGuestRefusalError` (tool denial, recorded as a failed `application_operation` for `propose_notice_to_end`): "Giving notice applies to an Extended Stay..." (Short Stay) and "You can give notice once you have checked in at the property." (before Verified Access).
  - AC6: the press must name a booking surface `thread-<thread>:booking:<contract>` whose contract the guest can read (`contractApp.getArtifact`); otherwise `STALE_SURFACE`. The confirm checks the bound `contractVersion` and `noticeDate` against the current preview. Forged, unknown and superseded all change nothing (tests passed).
  - AC7: the card id is `pendingActionSurfaceId(thread, action)`, derived from the persisted action; every test event runs on a fresh app over the same store.
- **Deviations to decide (not improvised).**
  1. AC5 says "the action is not shown" before Verified Access. The Give notice action is shown on every Extended Stay booking (its terms are on the artifact), and a press before Verified Access is refused with the notice-not-verified sentence (`NOTICE_NOT_AVAILABLE`, `ok: false`, no card). Showing the button only after Verified Access needs the booking artifact to carry the check-in state; not built.
  2. AC6 "a fresh card is offered": a stale date or version is refused with `STALE_SURFACE` and the pending action is cleared. The guest asks again to get the current card; the refusal does not carry a new card (the failure result has no surfaces).
  3. A recorded notice removes the action from the booking surface (`noticeToEnd` on the artifact), and a second press is refused (test).
- **Commands and counts** (env `-u LLM_API_KEY`, `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow`):
  - `npx tsx --test test/notice-to-end-chat.test.ts`: 7 tests, 7 pass.
  - `npx tsx --test test/notice-to-end-wiring.test.ts`: 9 pass.
  - Pending-action and confirm/cancel batch (`assistant-change-explanations`, `assistant-context-isolation`, `assistant-host-composition`, `assistant-pack-registry`, `assistant-pending-action-restore`, `assistant-proposal-replacement`, `assistant-recorded-journeys`, `assistant-request-summary`, `assistant-runtime-boundary`, `assistant-scope-controls`, plus the two notice files): 109 tests, 108 pass, 1 failed (the boundary allowlist: a new template stage key; fixed by using `pendingActionSurfaceId`; rerun 12 pass).
  - `assistant-session-thread-lock`, `assistant-stage-handlers` (one pinned list updated for `notice`), `assistant-thread-lock`, `assistant-tool-authorization`, `assistant-unregistered-domain`, `assistant-where-chip`, `assistant-cold-journey`, `assistant-continuous-occupancy`, `assistant-short-stays-29-nights`, `continuous-occupancy`, `guest-retired-classes`, `guest-kit`, `shortlet-ui-foundations`, `demo-extended-cancellation-notice`, `owner-payable-per-period`, `later-period-payment-routes`: 167 tests, 166 pass, 1 failed (the pinned list, fixed), 1 rerun to 8 pass.
  - `demo-openrouter`, `model-quota-host-recovery`, `shortlet-assistant-evals`, `assistant-stage-handlers`: 79 tests, 79 pass.
  - Booking-surface tests (`demo-extended-stay`, `render-booking-contract-weaver-a2ui`, `confirmation-schedule-link`, `guest-conventional-booking-pages`, and others): 67 tests, 67 pass.
  - Final regression set after the last changes (`notice-to-end-chat`, `notice-to-end-wiring`, `assistant-stage-handlers`, `assistant-runtime-boundary`, `assistant-pending-action-restore`, `assistant-cold-journey`, `assistant-pack-registry`, `assistant-continuous-occupancy`, `guest-retired-classes`, `guest-kit`, `shortlet-ui-foundations`, `demo-extended-cancellation-notice`, `owner-payable-per-period`, `later-period-payment-routes`): 110 tests, 109 pass, 0 fail, 1 skipped by the runner.
  - `env -u LLM_API_KEY npm run check`: exit 0 on the working tree after these changes (the committed tree is checked after the commit below).
  - The real-Chrome file `guest-confirmation-system-chromium` was not run. The booking surface changed for Extended Stays only (a new action and the recorded block); the flagged real-Chrome check is open.
- **AC8 captures.** `capture-18.ts` runs the whole journey over the real HTTP routes (`/api/turn`, `/api/event`, with the `assistant-offline` concierge mode) and then the browser. Card captures: 8 of 8 pass (overflow, 44px for `main button, main a`, light and dark, 320/390/768/1280). Visual check of light 390: the facts (new last night 9 Nov 2026, new checkout 10 Nov 2026, refund ₦71,400, still owed ₦0) and both buttons. Recorded-state captures: **not produced**. After the press, the chat's restored booking surface carries the recorded block in the state (checked over HTTP), but the rendered page never shows "Notice given" (the page text shows the booking and its new checkout, with no notice block). The capture script fails at that step (`page-text-at-timeout` logs the notice-related lines, which are empty). The cause is not yet diagnosed; the client rendering of the booking surface is the next thing to check.
- **Owner strings (new, for confirmation).** "Giving notice applies to an Extended Stay. This is a Short Stay, so it cannot be ended early from here."; "You can give notice once you have checked in at the property."; "Notice to End is not available for this stay right now."; "Here are the terms for giving notice. Press Give notice on the card to confirm."; "Notice given. Your stay now ends on the new last night."; "The notice terms have changed. Ask again to see the current terms."; "To confirm, press the button on the card. Typed replies do not confirm this action." (platform copy).
- **Open.** AC8 recorded-state captures; the rendering of the recorded block in chat; deviations 1 and 2 above; the real-Chrome check of the booking confirmation; a commit of `capture-18.ts`, which still fails at the recorded step (it is committed only as the card-capture script with the open step noted).
- **Process note.** A first attempt at a capture ran the browser without the flock, in the background. It was stopped at once and no browser from it remained. An accidental placeholder task suggestion was created and withdrawn at once (`task_e0a869aa`).

