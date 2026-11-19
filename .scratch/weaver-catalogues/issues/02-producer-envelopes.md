# Build A2UI envelopes with `createA2UIV091Producer`

Status: resolved
Type: task
Blocked by: 01
Requested: 6 Oct 2026

## Why

Each of the 21 A2UI builders hand-writes the same two envelopes:

```ts
[{ version: "v0.9.1", createSurface: { surfaceId, catalogId } },
 { version: "v0.9.1", updateComponents: { surfaceId, components } }]
```

These cover `apps/web-agent/src/*-a2ui.ts` and `apps/local-guest/src/assistant/pending-action-a2ui.ts`.

Weaver 0.2's `createA2UIV091Producer()` builds those envelopes, validates them against the A2UI v0.9.1 protocol, and returns a caller-owned deep clone. It throws `TypeError` on an invalid envelope, a non-finite number, a cycle or a non-plain object.

It does **not** validate catalogue component schemas. That remains issue 03's job.

## What to build

- **Helper.** Create `apps/web-agent/src/a2ui-surface.ts` exporting `surfaceMessages(surfaceId, catalogId, components)`. It uses one module-level producer and returns the frozen pair `[producer.createSurface({ surfaceId, catalogId }), producer.updateComponents({ surfaceId, components })]`. Give it the precise return type the builders use today.
- **Builders.** Replace the hand-built literals in all 21 builders with `surfaceMessages`. Keep each builder's `Object.freeze` behaviour.
- **Client.** The hand-built `deleteSurface` in `apps/local-guest/src/client.ts` (inside `renderSurface`, around line 1830) switches to `producer.deleteSurface({ surfaceId })`. Rebuild `dist/client.js`.
- Output must not change. This is a refactor.

## Acceptance criteria

- **AC1:** For every builder, the output for its existing test fixtures deep-equals the output before this change. Capture the snapshots before the refactor, or reuse the existing `render-*-weaver-a2ui` and `discovery-a2ui` expectations unchanged.
- **AC2:** No file under `apps/` builds a `createSurface` or `updateComponents` envelope as an object literal. A source-scan test checks this.
- **AC3:** `surfaceMessages` throws on an invalid envelope, such as an empty `surfaceId`. No builder can produce one, so builders given a fixture with a missing id fail loudly; they do not emit a malformed surface.
- **AC4:** Removing and recreating a chat surface still works. The existing Chromium surfaces that re-render the same `surfaceId` stay green.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0081 | Weaver APIs stay in the adapter layer (`apps/web-agent`, `apps/local-guest`), never in domains or platform-core. | `a2ui-surface.ts` location |
| 0073 | Every outbound message passes A2UI validation. | The producer's protocol validation (AC3); catalogue validation comes in 03. |

## Comments

### Implementation (19 Nov 2026, branch `claude/wonderful-thompson-iicglk`, after 07 at `556a50b`)

- `apps/web-agent/src/a2ui-surface.ts` exports one module-level `A2UI_PRODUCER = createA2UIV091Producer()` and `surfaceMessages(surfaceId, catalogId, components): readonly [CreateSurfaceMessage, UpdateComponentsMessage]`, a frozen pair.
- **Finding:** Weaver 0.2.1's producer accepts an empty or blank `surfaceId` (checked: `createSurface({ surfaceId: "" })` returns a message). AC3 therefore needs `surfaceMessages` to refuse a blank surface or catalogue id itself, with the same `TypeError` the producer uses for its own envelope errors (fail closed). The producer still rejects non-finite numbers, cycles and non-plain objects.
- All 23 builder envelopes use `surfaceMessages`: the 21 `apps/web-agent/src/*-a2ui.ts` files (including `protection-fund` and `relocation`, written without spaces, which the new source scan caught), `commerce-presentation.ts` (two envelopes, refactor only; commerce stays off) and `apps/local-guest/src/assistant/pending-action-a2ui.ts`. Each builder's existing `Object.freeze` wrapper is kept.
- The contact-details surface in `shortlet-app.ts` uses `A2UI_PRODUCER.createSurface`, `.updateDataModel` and `.updateComponents`; the client's re-create path uses `A2UI_PRODUCER.deleteSurface`. `dist/client.js` rebuilt.

### Validation

- AC1: `npx tsx .scratch/weaver-catalogues/dump-journey-messages.ts` walks discovery to confirmation (11 stages) and prints every surface's messages with per-run ids blanked; the output is deterministic (two runs identical) and byte-identical before and after the change, key order included. The existing `render-*-weaver-a2ui` (15 files) and `discovery-a2ui` expectations pass unchanged.
- AC2–AC3: `test/a2ui-surface-producer.test.ts` (4 tests): the source scan over `apps/`, the frozen pair, `TypeError` on an empty surface id, an empty catalogue id and a non-finite number, and `unitDetailArtifactToA2UI({ surfaceId: "" })` throwing.
- AC4: real Chrome, one file at a time: `guest-criteria-strip-chromium` 2/2, `guest-focused-phone-shell-chromium` 7/7, `guest-split-workspace-chromium` 4/4, `unit-detail-old-ikoyi-chromium` 1/1, `guest-real-browser-cross-tab` 14/14, `guest-final-acceptance-chromium` 3/3, `mobile-guest-journey-chromium` 43/43.
- `npm run check` clean. Focused: `npx tsx --test test/a2ui-surface-producer.test.ts test/render-*-weaver-a2ui.test.ts test/discovery-a2ui.test.ts test/commerce-catalogue.test.ts test/commerce-switch-catalogues.test.ts test/assistant-paystack-checkout-contact.test.ts test/assistant-pending-action-expiry.test.ts test/assistant-pending-action-restore.test.ts test/guest-contact-pilot.test.ts test/shortlet-catalog-validation.test.ts test/weaver-*-catalogue.test.ts test/assistant-recorded-journeys.test.ts test/shortlet-assistant-evals.test.ts test/local-guest-weaver-demo.test.ts test/weaver-web-host.test.ts test/weaver-dependency-boundary.test.ts test/assistant-cold-journey.test.ts`: 222 passed, 0 failed.
- The full `npm test` and `npm run test:workers` run once for the batch, before merge (CLAUDE.md, Test scope).

### ADR compliance and Definition of Done

| ADR | Constraint | Where it is met |
| --- | --- | --- |
| 0081 | Weaver APIs only in the adapter layer. | `a2ui-surface.ts` is in `apps/web-agent`; `weaver-dependency-boundary` passes. |
| 0073 | Every outbound message passes A2UI validation. | Producer envelope validation plus the blank-id guard (AC3); catalogue validation is unchanged. |

DoD: each AC has a named test (AC1 also the byte-identical journey and unchanged builder expectations; AC4 the Chrome suites); the failure paths are empty ids and a non-finite number; ADRs 0073 and 0081 read; no new dependency, policy string or logging; `npm run check` clean.
