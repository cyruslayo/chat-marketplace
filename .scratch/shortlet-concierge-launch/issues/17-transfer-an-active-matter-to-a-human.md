# Transfer an active matter to a human and back

Status: resolved
Type: AFK
User stories: 35, 85–87, 92, 103–104

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Implement explicit automated, handoff-requested, human-owned, and resume-pending control modes. Let users stop an Agent Run, give an authorized responder a minimized context packet and visible ownership, suspend automation, and resume only through deliberate handback and a fresh Interaction Projection.

## Acceptance criteria

- [x] Stop prevents future generation and tools but accurately preserves committed domain and provider actions.
- [x] Mandatory triggers route to the correct staffed General Support or Active-Stay Emergency Support path.
- [x] Human ownership suppresses autonomous messages, state-changing tools, and competing scheduled nudges.
- [x] Handback requires authorization, resolved authority, fresh state, user notice, and a new Agent Run.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
- [Issue 16](16-verify-access-with-live-support.md)

## Answer

Implemented `HumanHandoffManager` in `packages/platform-core/src/human-handoff.ts`.

### ADR Compliance
- **ADR 0030**: General Support (8 AM - 8 PM WAT) vs Active-Stay Emergency Support (24/7) routing.
- **ADR 0067**: Handoff channel routing and support coverage.
- **ADR 0075**: Data minimization and tenant scoping in handoff context packets.
- **ADR 0076**: Lifecycle modes (`automated`, `handoff-requested`, `human-owned`, `resume-pending`), stopping runs without losing committed actions, suppression of agent messages/tools during human ownership, authorized handback with fresh projection and new Agent Run.
- **ADR 0077**: Fresh Interaction Projection generation on handback.

