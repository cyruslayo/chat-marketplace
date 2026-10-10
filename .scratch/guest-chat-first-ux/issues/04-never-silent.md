# Answer every message after booking starts

Status: split
Type: epic
Findings: F4 (see ../PRD.md)

## What to build

Replace the canned replies at `guest-server.ts:230` and `:297` with deterministic handling for the stage the guest is in:
- **Questions about the apartment:** answer from Unit data, or say the fact isn't listed.
- **Changes to the stay:** turn them into a proposed change. Before submission this edits the draft with a new quote; after submission it becomes an amendment where one is allowed, or a plain explanation of why it isn't.
- **Anything else:** say honestly what the concierge can do now.

Find out why the workspace fell back to `.surface-fallback` after this message and fix it (`client.ts:347`, `:480`).

Repro: submit a Booking Request, then send "actually can we make it 3 nights? and is there parking?". Today there is no reply, and the announcer says "The workspace could not be displayed safely".

## Split

This issue is delivered by:
- [04a](04a-never-silent.md): AC1, 2, 4, 5
- [14-](14-draft-revision.md): AC3 (needs a decision first)

## Acceptance criteria (reference)

- AC1: Every guest message gets an assistant reply in every workflow state.
- AC2: "is there parking" is answered from unit amenities, or with a statement that it isn't listed.
- AC3: "make it 3 nights" on a draft proposes a re-quoted draft that needs confirmation.
- AC4: "make it 3 nights" on a submitted Booking Request never changes it silently; the reply explains the amendment path or why none exists.
- AC5: A free-text turn with a live surface open does not demote that surface to the fallback.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Distinguish request, offer and reservation truthfully |
| 0060 | Changes after submission are versioned amendments |
| 0074 | Fail closed on stale surfaces, but keep safe text |
| 0075 | Guest text is untrusted |

## Definition of Done

Resolved when every child issue is resolved.
