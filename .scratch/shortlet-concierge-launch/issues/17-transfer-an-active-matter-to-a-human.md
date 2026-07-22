# Transfer an active matter to a human and back

Status: ready-for-agent
Type: AFK
User stories: 35, 85–87, 92, 103–104

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Implement explicit automated, handoff-requested, human-owned, and resume-pending control modes. Let users stop an Agent Run, give an authorized responder a minimized context packet and visible ownership, suspend automation, and resume only through deliberate handback and a fresh Interaction Projection.

## Acceptance criteria

- [ ] Stop prevents future generation and tools but accurately preserves committed domain and provider actions.
- [ ] Mandatory triggers route to the correct staffed General Support or Active-Stay Emergency Support path.
- [ ] Human ownership suppresses autonomous messages, state-changing tools, and competing scheduled nudges.
- [ ] Handback requires authorization, resolved authority, fresh state, user notice, and a new Agent Run.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
- [Issue 16](16-verify-access-with-live-support.md)
