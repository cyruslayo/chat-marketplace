# Rules 02: the guest's list ("Your stays", later "Your plans")

Status: draft, gate 1 not passed. Depends on D2, D8, D9, D10.

## Contract (Proposed)

A pack may declare `planRows(scope, now)`. The platform calls it for each registered pack and composes one list. The platform never reads a pack's transaction state (ADR 0099 decision 5).

| Field | Meaning | Source |
| --- | --- | --- |
| `rowId` | Stable within the pack; not an authority | 0070, 0074 |
| `domain` | The pack id. The shell adds the mode's name and mark | 0107 |
| `title`, `where` | From the same helper as the pack's own page | 0077 |
| `startsOn`, `endsOn` | Dates in WAT | 0078 |
| `group` | `needs_action`, `in_progress`, `past` | Kit board |
| `status` | Tone and words | Kit Status word |
| `nextStep` | Words, plus an absolute deadline when there is one | 0078 |
| `href` | A standard route the pack owns | 0080 |

A row carries no price, contact detail, address, reference usable as a credential, or identity fact (ADR 0071, 0075).

## S rules

| # | Rule | Source |
| --- | --- | --- |
| S1 | A guest sees only rows of their own principal, Linked Principals or claimed requests | 0093; `committedWorkScope` |
| S2 | Signed out, only this browser session's principal | 0093; D8 |
| S3 | A Booking Request is never shown as a Reservation | 0005 |
| S4 | `needs_action` is true only while the action would be accepted now (lazy, against the clock) | 0044, 0074; anti-pattern 2 |
| S5 | A row never offers an action. It opens the page that checks authority | 0072, 0074 |
| S6 | A pack that fails, or returns an unknown shape, drops its rows with a visible notice; other packs' rows remain | 0074; **Proposed** |
| S7 | An unregistered pack contributes nothing and is not named | 0104, 0107 decision 10 |
| S8 | After sign-out no account row remains visible to that browser | 0093 |

## P rules

| # | Rule |
| --- | --- |
| P1 | Every booking the guest can open appears in exactly one group |
| P2 | The badge equals the number of `needs_action` rows |
| P3 | Order: needs action by soonest deadline; in progress by start date; past by most recent |
| P4 | Chat and page show the same rows with the same words (ADR 0080) |

## Decision table to test in full

Viewer (no session, device session, signed in, signed in on a second device, signed out again, another guest) × booking (own, linked, claimed, foreign) → visible or not. 24 cells.

## Checks

- Every reachable guest stage (`guest-stage.ts`) maps to exactly one group. Exhaustive over the stage matrix, so a new stage fails to compile.
- For every deadline, one instant before and one after: S4 and P2.
- Two packs (stays and `fake-domain-pack`): S6, S7, P3.
- Cold restore before each read (ADR 0106).

## Open

- Does an expired offer stay listed, and for how long? (D9)
- Shared-device review for D8: another person on the same browser sees the list. `/api/committed-work` already exposes live work to that session, so the new exposure is past and ended rows.
