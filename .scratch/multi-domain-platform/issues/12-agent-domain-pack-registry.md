# Agent DomainPack registry: shortlet prompt and tools move into the pack

Status: ready-for-agent
Type: task
Blocked by: 11
Requested: 14 Oct 2026
Unlocks: 13, 18
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

`assistant-tools.ts` (823 lines) and `assistant-runtime.ts` (903 lines) hardwire shortlet (PRD, Diagnosis 6). The agent must become general-purpose with packs supplying domain knowledge.

## What to build

1. In `apps/local-guest/src/assistant/` (or platform-core if slice 02 says so), split generic from specific: the tool loop, `MAX_ASSISTANT_TOOL_ROUNDS`, model-call budget and model clients stay generic.
2. Move `ASSISTANT_SYSTEM_INSTRUCTION`, `ASSISTANT_TOOL_DEFINITIONS`, `assistantToolsForState`, `executeAssistantTool`, the neighbourhood/city normalizers and pending-action kinds into a shortlet pack module.
3. The runtime composes the system instruction from a platform preamble + the active pack's prompt section and exposes only the active pack's tools; a call to an unknown or inactive tool fails closed.
4. Keep the deterministic concierge (`apps/local-guest/src/concierge.ts`) working (ADR 0080).

## Out of scope

- Router and multiple tasks (13). Commerce tools (23).

## Acceptance criteria

- AC1: The runtime has no import from `domains/shortlet` or shortlet web-agent converters; it gets them through the registered pack.
- AC2: A tool call naming a tool not offered by the active pack is rejected before execution.
- AC3: Scripted-assistant and Gemini/OpenAI-compatible tests pass unchanged.
- AC4: Deterministic concierge tests pass unchanged.

## Tests

New registry tests (fail-closed tool call, prompt composition); existing assistant tests.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0080-retain-deterministic-parity-for-critical-workflows.md` | Deterministic path preserved. |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | Proposal tools still become commands. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Prompt composition must not add personal data. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
