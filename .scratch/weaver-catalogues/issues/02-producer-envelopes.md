# Build A2UI envelopes with `createA2UIV091Producer`

Status: ready-for-agent
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
