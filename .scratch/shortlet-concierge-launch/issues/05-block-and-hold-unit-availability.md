# Block and hold Unit availability authoritatively

Status: ready-for-agent
Type: AFK
User stories: 69–70

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Give an eligible non-exclusive Operator an authoritative Availability Calendar with immediate Operator Blocks and a 45-minute Operator Hold that may receive one eligible 15-minute extension. Prevent overlapping inventory commitments across every application path.

## Acceptance criteria

- [ ] Operator Blocks immediately remove overlapping Open Dates and retain audit provenance.
- [ ] Holds expire automatically, allow at most one valid extension, and never exceed 60 minutes.
- [ ] Competing holds, blocks, and bookings are protected by real transaction and overlap constraints.
- [ ] Web, agent, and support views show the same current availability without owning it locally.

## Blocked by

- [Issue 04](04-onboard-and-publish-one-inspected-unit.md)
