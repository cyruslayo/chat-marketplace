# Method: write the rules, check the rules, then build

Status: the owner accepted checking money, deadlines and cross-feature rules this way on 25 Nov 2026. Tooling choices are in decisions.md.

## What it is, and what it is not

- **It is** bounded exhaustive checking: run the real classes through every order of a small set of steps, with every combination of a small set of failures, and compare each result with written rules.
- **It is not a proof.** It covers only the steps, depth and stubs that were chosen. Each check states them.
- **It does not choose policy.** It shows that code follows the rules. The owner decides whether the rules are right.

## Which work uses it

| Work | Method |
| --- | --- |
| Cancel, change, extend, notice, pay, refund, complaint, together | Rules page, owner scenarios, exhaustive order and failure checks |
| Deadlines, duplicates, late and out-of-order payment events | Same, with clock steps and repeated events |
| Refund, deposit and payable sums | Generated inputs against conservation rules |
| Who may see or do what | Decision table, every cell tested |
| Cross-domain rows and domain switching | Contract rules, checked with the existing fake pack (`test/helpers/fake-domain-pack.ts`) |
| Navigation | Reachability: every screen has Help, an exit and a way back |
| Visual port, fonts, copy | Captures, contrast, reflow and target checks. Not formal methods |
| Usability | Guest task study. Not formal methods |
| Concierge wording | Evaluations. Only the surrounding controls are checked |

## The steps for one feature

1. **Rules page** (`rules/NN-*.md`). States and moves, actors, `S` rules (must never happen), `P` rules (must eventually happen, and who finishes it), and the ADR behind each. A rule with no ADR or glossary source is marked **Proposed** and waits for the owner.
2. **Scenarios.** Each rule also appears as a one-line story the owner can approve or reject. No code is written against an unapproved Proposed rule.
3. **Cross-check.** Every pair of features that touch the same booking gets a cell: what happens when B arrives while A is unfinished. An empty cell blocks the issue.
4. **Failing check.** The rule becomes a test over the real classes. It must fail first, for the stated reason.
5. **Build** until it passes, then run the issue's other tests.
6. **Mutation check.** Remove the new guard and confirm the check fails again. Record the counts.
7. **Keep it.** The check stays in `test/`, and the row in `docs/agents/state-machines.md` is updated in the same commit.

## Gates

| Gate | Passes when |
| --- | --- |
| 1 Rules | Every `S` and `P` rule has a source or owner approval, and no cross-check cell is empty |
| 2 Scenarios | The owner has answered each Proposed rule in decisions.md |
| 3 Check | The check fails without the guard and passes with it; bounds and stubs are recorded |
| 4 Real storage | The check also passes on `SqliteBookingStateRepository` or the matching SQLite store, not only in memory |
| 5 Screen | Captures and the navigation check pass. The screen offers only actions the rules allow |

## Rules for writing a check

- Drive exported classes. Never copy their logic into the check.
- Use real stores where they exist. List every stub and what it assumes.
- Prefer small bounds that finish within 30 seconds in `npm test`. Put wider bounds behind an explicit script. Prune by observable state (issue 03 AC6); a ten-step check at depth 5 is about 111,000 orders without it.
- Print the shortest failing sequence.
- Every check asserts that the interesting path was reached (for example, that some sequence does cancel and some does commit). A check that never reaches the state passes for the wrong reason.
- No `any` in domain types, synthetic data only, no credentials or contact values in output (ADR 0075).
- Assistant-path checks use the assistant, a cold restore before every event, the 2026-10-27 clock and an unseeded guest (ADR 0106).

## Tools

- **Now:** plain TypeScript in `test/`, no new dependency.
- **Not now:** Quint, TLA+, Alloy (D5). The usual TLA+ checker needs Java, which is not installed on this machine.
- **Not planned:** proof assistants.

## Trial, 25 Nov 2026

Source: [trial/explore.mts](trial/explore.mts). Run from the worktree root:

```
env -u LLM_API_KEY node --import tsx .scratch/app-expansion/trial/explore.mts
```

| Check | Bounds | Result |
| --- | --- | --- |
| A. Booking change against cancellation | 4 steps, depth 6, 5,460 orders, one Reservation; calendar, quote, settlement and arrival stubbed | 403 orders charge after cancellation. Shortest: request, accept, cancel, commit. Same on SQLite. 0 with a trial guard on Reservation status |
| B. One failure each in ledger, date release, refund during cancellation | 8 combinations, 3 retries | 7 end unfinished. The class has no resume path and the guest has no action. Some record `reconciliation_required` on purpose; nobody owns finishing them |
| C. Transition tables | 9 domain tables | Unreachable: offer `revoked`; card session `expired`, `failed`; journey `failed`, `expired`. Already state-machines issue 25 |
| D. Period payment after a Notice to End | One path through the real composition | **Refused, as it should be.** The suspicion was wrong |
| E. Prototype navigation | 26 and 37 screens | Every screen has Help, an exit and a way back |

A and B are latent: neither flow is connected for guests. D is kept because a plan based on reading alone would have reported a defect that does not exist.
