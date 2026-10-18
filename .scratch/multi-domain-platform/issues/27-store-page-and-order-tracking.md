# Store page and order tracking page from the same presentation helpers as chat

Status: ready-for-agent
Type: task
Blocked by: 23, 14b
Requested: 14 Oct 2026
Unlocks: none
Lane: E: Concierge UX
PRD: `../PRD.md`

## Why

Merchants share store links (instastore `/s/<slug>`); chat and pages must render the same facts from the same helper (AGENTS.md guest UI rule).

## What to build

Commerce route module: store page, offer page, cart, checkout handoff, order tracking (public code + phone, as instastore `get_order_status`). Use the guest kit and commerce presentations from slice 23.

## Out of scope

- Merchant branding beyond tokens.

## Acceptance criteria

- AC1: Store page and chat show the same offer facts from one presentation helper.
- AC2: Order tracking requires both the public code and the matching phone.
- AC3: Captures at the four widths pass the overflow and 44px checks.

## Tests

Browser tests; captures under `screenshots/27/`.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0078-meet-an-accessible-nigerian-launch-profile.md` | Accessibility. |
| `docs/adr/0077-project-canonical-interaction-artifacts-across-channels.md` | Same artifacts. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

- 18 Oct 2026: Copy approved by the user, 18 Oct 2026 (`COMMERCE_GUEST_COPY` as committed).
