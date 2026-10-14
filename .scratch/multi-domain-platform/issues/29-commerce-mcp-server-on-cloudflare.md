# Commerce MCP server on Cloudflare: read tools, checkout link-out, widgets from presentations

Status: ready-for-agent
Type: task
Blocked by: 23, 24, 28
Requested: 14 Oct 2026
Unlocks: none
Lane: F: ChatGPT
PRD: `../PRD.md`

## Why

The ChatGPT app is another host on the commerce pack, reusing its presentations.

## What to build

Add a remote MCP server route in `apps/cloudflare` exposing commerce read tools and a checkout link-out; render commerce presentations as Apps SDK widgets (a second renderer next to A2UI). No stays tools.

## Out of scope

- Submitting the app (owner).

## Acceptance criteria

- AC1: Only commerce tools are exposed.
- AC2: Checkout always links out to our hosted checkout; no payment is taken inside ChatGPT.
- AC3: Widgets are built from the same presentations as the web chat.
- AC4: No personal data beyond what slice 28 allows is returned.

## Tests

One test per AC against the MCP route.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Minimization. |
| `docs/adr/0068-use-ag-ui-and-a2ui-behind-platform-owned-adapters.md` | Renderers behind adapters. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
