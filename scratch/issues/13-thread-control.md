# New conversation, undo, and comparison

Status: split
Type: epic
Findings: F10, F5 (see ../PRD.md)

## What to build

Add a "New conversation" control (with an in-page confirmation when a request is live), and a two-up comparison opened from results that stacks on narrow screens.

## Split

This issue is delivered by:
- [13a](13a-new-conversation.md): AC1
- [13b](13b-compare.md): AC2–3

## Acceptance criteria (reference)

- AC1: Starting a new conversation doesn't withdraw or cancel an existing Booking Request, and says so.
- AC2: Choosing Compare on two results shows price, capacity and amenities aligned.
- AC3: At 320px, the comparison stacks attributes vertically with no horizontal scroll.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0079 | Starting over never cancels committed work |
| 0078 | Comparison stacks vertically at narrow widths |

## Definition of Done

Resolved when every child issue is resolved.
