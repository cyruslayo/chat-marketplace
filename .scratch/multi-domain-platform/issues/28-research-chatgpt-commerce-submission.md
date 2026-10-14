# Research: ChatGPT app submission for commerce (link-out checkout, Nigeria, review checklist)

Status: ready-for-agent
Type: research
Blocked by: 03
Requested: 14 Oct 2026
Unlocks: 29
Lane: F: ChatGPT
PRD: `../PRD.md`

## Why

Submission rules change; confirm current requirements before building.

## What to build

Read the current OpenAI plugin/app guidelines and submission docs. Answer: is link-out checkout to our hosted Paystack checkout allowed; any regional limits for Nigeria; required privacy policy, test credentials, review checklist; how widgets are served; whether Instant Checkout applies. Record sources with URLs.

## Out of scope

- Building anything.

## Acceptance criteria

- AC1: Each question has a sourced answer in `## Answer`.
- AC2: A submission checklist is listed for slice 29.

## Tests

None.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0067-bound-launch-channels-and-support.md` | New channel. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Data shared with a third-party host. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Research/design slice. DoD items 3 and 5 apply. No production code changes; the evidence and conclusions go in `## Answer`.

## Comments
