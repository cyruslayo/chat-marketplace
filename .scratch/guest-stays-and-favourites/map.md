# Map: guest stays, reviews, owner messages and favourites

PRD: `PRD.md` · Depends on: `../guest-accounts/` (A-05 linked principals, A-06 sign-in)

The frontier is the first issue, in phase order, that is open, unblocked and unclaimed. Each issue ends with `npm run check` and `npm test` green, and a commit on the effort branch. "A-NN" means issue NN of `../guest-accounts/`. Issue numbers are stable; work in the **phase order** below.

### Phase 1: first slice, "log in and see my stays"

Starts after accounts phase 1 issues A-02, A-04, A-05 and A-06 (see `../guest-accounts/map.md`).

| Order | # | Issue | Type | Blocked by |
| --- | --- | --- | --- | --- |
| – | 01 | Settle the stay, message and favourites policy values | grilling | resolved 3 Oct 2026 |
| 1 | 03 | Completed Stay projection and Stay History query | task | 01, A-05 |
| 2 | 04 | "My stays" page (with its own captures) | task | 03, A-06 |

### Phase 2: reviews

| Order | # | Issue | Type | Blocked by |
| --- | --- | --- | --- | --- |
| 3 | 05 | Persist Verified-Stay Reviews | task | 03 |
| 4 | 06 | Guest leaves a review from a past stay | task | 04, 05 |
| 5 | 07 | Operator responds to a review | task | 05 |

### Phase 3: owner messages

| Order | # | Issue | Type | Blocked by |
| --- | --- | --- | --- | --- |
| 6 | 02 | ADR 0094: Relayed guest–operator stay messages | task | 01 |
| 7 | 08 | Stay Message Thread domain and store | task | 02, 03 |
| 8 | 09 | Guest message screen on a stay | task | 04, 08 |
| 9 | 10 | Operator replies from the inbox, and message emails | task | 08 |

### Phase 4: favourites, concierge, final captures

| Order | # | Issue | Type | Blocked by |
| --- | --- | --- | --- | --- |
| 10 | 11 | Saved Stay domain and store | task | 01, A-05 |
| 11 | 12 | Save control and Favourites page with availability check | task | 04, 11 |
| 12 | 13 | Concierge tools for stays and favourites | task | 04, 12 |
| 13 | 14 | Walkthrough stages and captures | task | 06, 09, 12, 13 |

After phase 1, phases 2, 3 and 4 have no dependencies on each other (except 14) and may run in parallel on separate branches. Run only one browser suite or capture sweep at a time.

## Kickoff prompt for a new session

> Implement the guest stays and favourites effort in phase order (phase 1 is usually done together with accounts phase 1; see `../guest-accounts/map.md`). Confirm `../guest-accounts/` issues 05 and 06 are resolved. Read `.scratch/guest-stays-and-favourites/PRD.md`, then `map.md`, and follow the implementation protocol in `AGENTS.md`. Work on branch `feat/guest-stays-favourites` from an up-to-date `main`. For each issue: claim it, read the ADRs it lists, write one failing test per acceptance criterion, implement, run `npm run check` and the full `npm test` (browser phase in the background), check the Definition of Done in `docs/agents/issue-tracker.md`, commit, then write the `## Answer` and a context pointer here.
> - Don't invent policy numbers or copy; they come from issue 01 or from me.
> - Do not show reviews or ratings anywhere a Guest browses.
> - A message never changes a booking (ADR 0060).

## Context pointers

(Append one line per resolved issue: what landed and where.)

- 01: policy values settled with the user on 3 Oct 2026; see the issue's `## Answer` and `PRD.md` "Settled policy values". Message retention (answer 4) is provisional until legal review.
