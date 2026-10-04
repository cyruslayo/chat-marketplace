# Build the operator earnings projection and guest value comparison

Status: ready-for-human
Type: prototype
Blocked by: none (a spreadsheet first; any code waits for 05)
Requested: 4 Oct 2026

## Why

The operator pitch is "a guaranteed month beats a month of nightly gaps". It has to be shown with each operator's own numbers, or it won't be believed. The same data also gives guests an honest comparison with a hotel or an annual lease. That comparison is the strongest argument for relocators, who otherwise pay a year upfront.

Build it as a spreadsheet and use it in pilot onboarding (issue 01) first. Build it into the product only if it changes operator decisions.

## The operator model

### Inputs (per unit)

| Input | Symbol | Source, in order of preference |
|---|---|---|
| Nightly rate the owner actually achieves | R | Owner's statements for the last 6–12 months |
| Occupancy | o | Owner's calendar history; otherwise a cited market benchmark, shown as a range |
| Average nightly-stay length | L | Owner's history |
| Channel fees as a share of revenue | f | Owner's channel statements |
| Cost per turnover (clean, laundry, restock) | c | Owner or cleaning vendor quote |
| Utilities per occupied night (diesel, power, water, internet) | u | Owner's bills ÷ occupied nights |
| Scheduled cleaning cost per month for an Extended Stay | s | From the unit's servicing statement (ADR 0092) |
| Offered Monthly Agreed Amount | M | The offer under discussion |

### Formulas

- Nightly mode, expected monthly net:
  `N(o) = R·30·o·(1 − f) − (30·o / L)·c − 30·o·u`
- Monthly mode, certain monthly net:
  `E(M) = M − 30·u − s − c·(30 / stay nights)`
  This is about one turnover per stay.
- Break-even Monthly Agreed Amount:
  `M* = N(o) + 30·u + s + c·(30 / stay nights)`
- Show `N` at a low, expected and high occupancy, so the operator sees the risk they're giving up.

Fixed costs (rent or mortgage, service charge, insurance) are the same in both modes, so they cancel and are left out.

**Utilities matter.** An Extended Stay includes utilities in the price (ADR 0092) and the unit is occupied every night. At 43% occupancy it's occupied about 13 nights. The owner therefore pays for roughly 17 more nights of diesel. Leaving `u` out makes a monthly offer look better than it is.

### Worked example (illustrative only, not pilot data)

Inputs: R ₦80,000, f 15%, L 3 nights, c ₦12,000, u ₦8,000, s ₦40,000, a 90-night stay.

| | Low (30%) | Expected (43%) | High (55%) |
|---|---|---|---|
| Nightly mode net, N | ₦504,000 | ₦722,400 | ₦924,000 |

- Monthly mode costs: 30·u = ₦240,000, plus s ₦40,000, plus one turnover over 3 months (₦4,000 a month) = ₦284,000.
- Break-even at expected occupancy: M* ≈ ₦1,006,400.
- An offer of M = ₦1.1M gives the operator ₦816,000 net, **certain**. That is about ₦94k above their expected nightly net, and above everything except the high case.
- Guest price at a 15% margin: ₦1,265,000 for the month. The platform keeps ₦165,000.

The PRD's ₦1.03M figure is **gross** nightly income. Compare offers with net figures, not gross.

## The guest comparison

Show the monthly all-in price next to:
- a comparable hotel × 30 nights;
- an annual lease's **cash needed upfront**: rent plus the agency, legal and caution amounts that are customary in that city;
- a typical unverified shortlet's nightly price × 30.

Every benchmark needs a cited source and a date. If a benchmark can't be sourced, leave it out. Don't estimate it.

## Acceptance criteria

- AC1: A spreadsheet in `.scratch/monthly-stays/` (or a linked sheet), with one tab per pilot unit, using the formulas above, with low, expected and high occupancy, and showing M*.
- AC2: Every input cell is labelled with its source (owner document, vendor quote, or cited benchmark with date). No unsourced market figure.
- AC3: Used in at least 10 pilot onboarding conversations. For each one, record the offer, M*, the operator's answer and their tier choice (issue 15).
- AC4: A guest comparison for each pilot neighbourhood with sourced benchmarks, tested on at least 5 leads per segment, with their reactions recorded.
- AC5: A recommendation under `## Answer`: keep it as a sales tool, or build it into the back office and guest discovery. If build: follow-up issues listed in `map.md`, noting that the operator view uses owner data the platform must protect (ADR 0075) and never shows one operator another operator's numbers.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0089 | Guest price = agreed amounts + margin; owner receives the agreed amount |
| 0092 | Monthly price includes the stated utilities; a short final period is priced nightly; no repricing of confirmed periods |
| 0015 | Guests see one All-In Stay Total; comparisons use it |
| 0039 | We don't collect outside commercial terms by right; owner data is shared voluntarily for the projection |
| 0075 | Owner financial data is minimised and kept out of logs |

Code standards: no invented benchmark or policy number. Anything the model needs that isn't sourced is noted as a gap and raised with the user.

## Comments
