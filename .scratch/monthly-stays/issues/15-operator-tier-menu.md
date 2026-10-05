# Decide the operator tier menu for Extended Stay supply

Status: ready-for-human
Type: grilling
Blocked by: none (runs alongside 01; its offer is tested in the pilot)
Requested: 4 Oct 2026

## Why

Operators in Lagos and Abuja don't lack listings; they lack predictable occupancy. Lagos Airbnb occupancy is about 43% (PRD). The platform pools demand across many units, so it can sell operators certainty in exchange for a lower monthly price.

Negotiating each deal one by one tells us little. A small **menu of contracts** lets each operator choose, and the choice shows what they value: control of their calendar, a better price, or certainty. This is screening. It also gives every operator a reason to stay on the platform after the first Billing Period, which is the main leakage risk for monthly stays.

Strategy background: `strategy-supply-deals.html` in this folder (also published as an artifact; see `## Comments`).

## Proposed menu (to decide, not policy)

None of these names or values are policy until they're recorded in an ADR and `CONTEXT.md`. Every number below is a starting point to test in the pilot.

| Tier | Operator gives | Platform gives | Fits today's ADRs? |
|---|---|---|---|
| **Listed** | Monthly Agreed Amounts near their nightly equivalent; keeps full calendar control | Listing, inspection, protected payment, support; margin on top (ADR 0089) | Yes |
| **Committed** | A deeper monthly discount (test 15–30% below Listed); agreed availability windows for Extended Stays; a 12-month non-circumvention promise for platform-introduced guests | Named account manager; access to shared services (bulk diesel, cleaning, internet); the earnings projection (issue 16) refreshed quarterly; first offer of matching demand | Mostly. See conflicts 1–3 |
| **Guaranteed** | The deepest discount; Extended Stays only through the platform; a share of revenue above a floor | A quarterly revenue floor, settled as a top-up if the platform doesn't fill the unit | No. Needs a new ADR. See conflicts 3–5 |

## ADR conflicts found while drafting

These change what the menu may offer. Resolve each one before the menu is shown to operators.

1. **ADR 0066: no sponsored placement.** Ranking uses fit, reliability and value. A commercial tier **cannot buy higher ranking**. Committed units may rank better only through the signals ADR 0066 already counts, such as calendar reliability and response performance. Never promise "priority placement".
2. **ADR 0089: payout timing.** The owner payable is already due 24 hours after Verified Access, which is the guest-protection timing. "Faster payout" is therefore **not** a tier benefit. Paying earlier would weaken guest protection.
3. **ADR 0039: non-exclusive inventory.** Operators may sell through other channels without ranking penalty, and we don't ask about their outside commercial terms. Exclusivity (Guaranteed) and any rate-parity request need an ADR change, and counsel must check them for competition law (FCCPA 2018).
4. **ADR 0089: price = agreed amounts + margin.** A revenue share above a floor, or a price band, isn't allowed by today's price rule.
5. **ADR 0083 is superseded by 0089:** there are no trust tiers or tier settlement terms at launch. Any new tier concept must be a fresh decision, not a revival of 0083.
6. **Master lease was rejected (3 Oct 2026).** A revenue floor is partly a master lease. If Guaranteed goes ahead it needs an exposure cap, for example total floors never above a set share of trailing margin, and only for units in neighbourhoods with at least 3 months of fill data.

## Decisions needed

1. Which tiers to offer in the pilot. Recommendation: **Listed and Committed only**. Hold Guaranteed until there is fill data.
2. The Committed discount range and availability-window terms to test.
3. The non-circumvention wording and its period (needs counsel, issue 02).
4. Which shared-services deal to set up first (diesel, cleaning or internet), and who runs it.
5. Neighbourhood unit caps: how many units per area we onboard against observed demand, so we can keep the occupancy promise.
6. Whether tier and commitment terms become versioned unit configuration (like Monthly Agreed Amounts) or operator-level configuration.
7. Glossary terms for `domains/shortlet/CONTEXT.md` (for example Supply Tier, Availability Window, Revenue Floor).

## Acceptance criteria

- AC1: For each decision 1–7, a recorded answer under `## Answer`, backed by pilot evidence where it exists.
- AC2: Each pilot operator's tier choice recorded, with their stated reason (from issue 01).
- AC3: Each ADR conflict 1–6 marked as either avoided (with the menu wording that avoids it) or needing a new ADR (with a drafted title).
- AC4: Counsel questions on non-circumvention, exclusivity and competition law added to issue 02 (done 4 Oct 2026: questions 8–11), and counsel's answers applied to the menu.
- AC5: If any tier is adopted: an ADR drafted, and follow-up code issues listed in `map.md`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0066 | No sponsored placement; tiers cannot buy ranking |
| 0089 | Owner gets agreed amounts; margin on top; payout due 24h after Verified Access |
| 0039 | Inventory is non-exclusive; no ranking penalty for other channels |
| 0083 | Superseded; no trust-tier settlement terms at launch |
| 0064 | Enforcement stays graduated and published, whatever the tier |
| 0092 | Extended Stay terms and prices are unit configuration; extensions never agreed off-platform |

## Comments

- 4 Oct 2026: strategy page published at https://claude.ai/artifact/LpWHnwxAVebFDFsmnXYuvk (source: `strategy-supply-deals.html` in this folder).
