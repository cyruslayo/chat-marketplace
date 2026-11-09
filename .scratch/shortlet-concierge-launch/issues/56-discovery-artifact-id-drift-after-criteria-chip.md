# View apartment fails with ARTIFACT_MISMATCH after a When chip and a party-size answer

Status: fix applied in the working tree, not committed (awaiting owner approval)
Type: AFK
Blocked by: none
Requested: 9 Nov 2026 (staging, `shortlet-pilot-staging.khayutsefi.workers.dev`)

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What the guest saw

1. Area search: Wuse 2, Abuja. One result card (indicative nightly rate, no dates or party size).
2. Criteria strip "When" chip: 12–18 Nov 2026, 6 nights. Reply: "So far I have: Wuse 2, Abuja · Thu 12 Nov 2026 to Wed 18 Nov 2026 · 6 nights. Could you tell me how many guests are staying?" with the chips "Just me", "2 guests", ...
3. Tapped "Just me". Reply: "Please tell me what you need for your stay. You can also use the standard search and booking pages." (`ASSISTANT_CONTROL_COPY.unavailable`).
4. Tapped "View apartment" on the card still on screen, twice. Each tap: "The action does not match the authoritative artifact." (`ARTIFACT_MISMATCH`). The "Guests" chip still reads "Add guests".

## Is Weaver the cause?

No. Weaver (`@cylayo/weaver-web` 0.2.1) rendered the card and sent its action with the `artifactId` the server put in it. The refusal is the app's own server guard, `resolveDiscoveryServerEvent` (`apps/web/src/discovery-actions.ts:113`), called from `#handleViewUnit` (`apps/local-guest/src/shortlet-app.ts`). The guard worked as designed: the id on the card no longer matched the thread's. The defect is that the server changed the thread's id without showing a new card. Weaver-side findings that made this harder to see are in the [Weaver team note](../../weaver-catalogues/notes/2026-11-09-stale-artifact-actions.md).

## Root cause (defect 1: artifact id re-minted by the shell sync)

- The discovery artifact id is random per search (`generatePlatformId("search", ...)`, `domains/shortlet/src/browse.ts:491`).
- The When chip (`#handleCriteriaEdit`) records the dates in the assistant's task state and the persisted `thread.assistantContext`, but with no party size it only asks a question: no search runs, so the card on screen and the runtime's artifact still describe the undated search (id A).
- On the next assistant turn ("Just me"), `#syncAssistantPersistence` calls `#assistantContextSearch(thread, context, runtimeArtifact)`. The context now has dates the runtime artifact's filters lack, so `matchesContext` is false and it re-runs `discoveryQuery.search(filters)`. It passed no `keepArtifactId`, so the re-query took a **new** id B and wrote it to `thread.discoveryArtifactId`.
- No surface was returned for B. The guest's card still names A, and the surface id (`thread-…:discovery:results`) is unchanged, so the surface guard passes and the artifact guard refuses: `ARTIFACT_MISMATCH`, on every tap.
- The cold-restore path (`#rebuildAssistantDiscovery`) already passes `keepArtifactId` for exactly this reason (ADR 0106). The warm sync path did not. Staging hits the warm path whenever the Durable Object instance stays alive between requests, which is why the cold-restore tests never caught it.

Reproduced offline by `test/assistant-discovery-artifact-drift.test.ts`: the warm "Just me" case failed with `ARTIFACT_MISMATCH` before the fix.

## Fix (applied)

`#syncAssistantPersistence` (`apps/local-guest/src/shortlet-app.ts`) now passes the current artifact's id (or the persisted `thread.discoveryArtifactId`) as `keepArtifactId`. A sync re-query refreshes the facts under the id the guest's card names, as a cold restore does. It never mints an id that no card carries.

The guards still fail closed:

- A forged `artifactId` still returns `ARTIFACT_MISMATCH`.
- A real new search (planner `search_stays`, or a chip edit that runs `#executeDiscovery`) still issues a new artifact and a new surface. The old card then fails with `STALE_SURFACE`, and the client refreshes on that code.
- A unit missing from the re-queried results still fails with `ACTION_NOT_AUTHORIZED`.

ADR check: ADR 0106 (an id the guest holds is persisted and re-keyed, never re-minted; guards stay fail closed): met. ADR 0077/0080 (a restore re-queries the authorized domain query): unchanged, the facts are still re-queried.

## Follow-up issues (owner decisions, 9 Nov 2026)

- Landing defect 1 on `fix/chat-hardening`: [62](62-land-discovery-artifact-drift-fix.md).
- Defect 2: the owner chose structured chip events → [58](58-structured-quick-replies.md). The owner also approved an ADR 0106 amendment that gives the classifier and planner one closed open-question code → [57](57-assistant-open-question-state.md).
- Defect 3 → [60](60-guest-safe-refusals.md).
- Further hardening: no dead-end replies → [59](59-assistant-no-dead-ends.md); terse-follow-up evals → [61](61-terse-follow-up-evals.md).
- Order: 62 → 57 → 58 → 59 → 61. Issue 60 is independent once 62 lands, but it shares `client.ts` with 58, so run them one at a time.

## Defect 2 (open, see 57 and 58): the "Just me" chip the app offers is not understood by the assistant

- The clarify reply offers `quickRepliesFor("who")` chips: "Just me", "2 guests", … (`apps/local-guest/src/concierge.ts:135`, via `clarificationChipsFor`).
- The client sends a quick reply as typed text (`client.ts`, `renderQuickReplies` → `sendTurn(text)`), so it goes through the scope classifier. The classifier sees only `{ message: "Just me", context: { hasShortlist, hasSelectedStay, hasOffer } }` (`scope-classifier.ts`, ADR 0075: no conversation history), so it cannot know a party-size question is open. Live, it most likely answered `unclear` (or failed), and the turn returned the fixed `unavailable` copy, discarded the input and left "Guests: Add guests". The exact `assistant.control.outcome.v1` for this turn needs the staging log (owner-run, read-only query) to confirm.
- ADR 0106 already treats chip dates, nights and party size as structured guest input. Proposed fix: send the party-size chips as a structured `shortlet.criteria.edit` `{ field: "guests", partySize }` event (the path the Guests chip already uses), not as free text. The alternative, telling the classifier which question is open, widens what the classifier sees and needs an ADR 0075 decision. Needs a decision before an agent picks it up.

## Defect 3 (open, see 60): a refused card stays live and shows developer copy

- `client.ts` `renderResponse` marks the surface stale and refreshes only for `STALE_SURFACE`, `STALE_ACTION` and `EXPIRED_SURFACE`. `ARTIFACT_MISMATCH`, `INVALID_ARTIFACT` and `ACTION_NOT_AUTHORIZED` leave the card clickable, so each tap appends the same refusal (the guest saw it twice).
- The refusal text is the server's developer message ("The action does not match the authoritative artifact."), shown verbatim in the transcript. Guests should see fixed guest copy from `apps/web-agent/src/guest-content.ts`, for example "These results have changed. Here are the current ones." plus a refresh.
- Proposed fix: treat `ARTIFACT_MISMATCH` and `INVALID_ARTIFACT` like `STALE_SURFACE` in the client (mark stale, `refreshServerState()`), and map refusal codes to guest copy. This is a guest UI change (client.js rebuild, captures per AGENTS.md "Guest UI work").

## Acceptance criteria (defect 1)

- [x] After an area search, a When chip that only asks for guests, and any assistant turn, View on the card on screen opens the unit (warm and cold).
- [x] A forged discovery artifact id still fails closed with `ARTIFACT_MISMATCH` (warm and cold).
- [x] After a new planner search, the earlier card's View fails closed and the new card's View opens (warm and cold).

## Comments

- 9 Nov 2026, defect 1 fix. Commands (all with `env -u LLM_API_KEY`):
  - `npx tsx --test test/assistant-discovery-artifact-drift.test.ts`: before the fix 1 of 4 failed (warm "Just me": `ARTIFACT_MISMATCH`); after the fix 8 of 8 pass.
  - `npx tsx --test test/assistant-discovery-artifact-drift.test.ts test/assistant-cold-journey.test.ts test/assistant-where-chip.test.ts test/assistant-proposal-supersession.test.ts test/assistant-persistent-continuity.test.ts test/guest-chip-continuity.test.ts test/assistant-budget-chip.test.ts test/assistant-parity.test.ts test/assistant-location-change.test.ts test/assistant-booking-journey.test.ts`: 106 of 106 pass.
  - `npm run check`: clean.
- Not run: the full `npm test` and `npm run test:workers` (once per batch, before merging), and a live retest on staging after a rebuild.
- Local fixtures have no eligible Wuse 2 unit, so the test uses Old Ikoyi and Lekki Phase 1. The mechanism does not depend on the area.
