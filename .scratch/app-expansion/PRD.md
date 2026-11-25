# PRD: from a chat to a whole app, on the Xenia design system

Status: draft for owner review (25 Nov 2026)
Type: plan
Baseline: `main` at d1d5955, worktree `C:\AI2026\chat-marketplace-app-expansion`, branch `docs/app-expansion`
Prototype: <https://claude.ai/artifact/19UKnffE8Wc45H3zCvgxcx> (private; 37 screens, light and dark, 320 / 390 / desktop)
Read next: [method.md](method.md), [decisions.md](decisions.md), [map.md](map.md)

## Problem

1. **The guest app stops at payment.** Search, request, offer and payment are well built. After that a guest can open one booking page, a payment schedule, an extension and a Notice to End. There is no list of their stays, no help, no cancellation, no way to report a problem, and no way to get the address.
2. **Nothing connects the pages.** The shell offers "New conversation" and "Contact details". Standard pages exist (ADR 0080), but no navigation leads to them.
3. **The design has moved.** The Xenia kit is approved; the code still runs the green palette with system fonts.
4. **Other domains are coming** (Events, Services, Community). Seams exist on `main` (ADR 0099, 0107). The guest's list of commitments knows stays only.

Three facts block a real paying guest today. All were checked on `main`:

| Fact | Evidence |
| --- | --- |
| A paid guest never receives the address | `findArrivalDataByContractId` returns null in `apps/local-guest/src/fixture.ts`; the arrival policy is fail closed (ADR 0085) |
| Guests are sent to a support channel that does not exist | `guest-content.ts` `generalSupport`; no contact value found in `apps/` |
| No guest or Operator can cancel a Reservation | `CancellationApplication` is not composed by `apps/local-guest`, `apps/local-owner` or `apps/cloudflare` |

## Outcome

1. A guest can find, book, pay, stay, get help, change plans and come back without needing the concierge to be available (ADR 0080).
2. The concierge stays the core. It is reachable from every section and carries the section's context.
3. Every guest screen uses the Xenia kit. The Operator back office follows its accepted boards.
4. Money, deadlines and cross-feature rules are written down, approved by the owner as scenarios, and checked by machine before screens are built on them.
5. A second domain can be added without rebuilding Stays.

## Structure

Three places, one concierge, short tasks. The reasons are in the prototype notes and in Apple's Human Interface Guidelines review (conversation, 25 Nov 2026).

| Part | What it is | Rule |
| --- | --- | --- |
| **Find** | One search, shown as Concierge or List | One set of criteria. A List edit is structured guest input (ADR 0106) |
| **Your stays** ("Your plans" once a second domain is live) | Needs action, in progress and upcoming, past and ended | Platform owns the list, order and groups; each domain supplies rows (ADR 0099 decision 5) |
| **Account** | Sign-in, contact, data | Never a gate to booking (ADR 0085, 0093) |
| **Ask bar** | The composer, above the tabs on section pages | Opens the concierge with the page's context. It grants no authority |
| **Task screens** | Review, accept, pay, cancel, report | Full screen, titled, one way out, no tab bar. Waiting is not a task |
| **Help** | On every screen | Leads with the current stay. Needs a real contact (D6) |
| **Concierge chooser** | Only with two or more registered domains | Already on `main` (03g). Domains change focus; tabs change place |

## Screens

`F` = fixed by an existing board or screen; `N` = new; `?` = waits on a decision.

| Screen | Design source | Backend on `main` | Phase |
| --- | --- | --- | --- |
| Find start, concierge results | F (kit, showcase) | Ready | 2, 3 |
| Find as a list | N | `/stays/search`; shared criteria needed | 3 |
| Concierge unavailable | N | Small change | 3 |
| Apartment | F, needs gallery board | Ready | 2 |
| Review, waiting, offer | F | Ready | 2 |
| Payment choice, bank transfer, manual transfer and receipt | **No Xenia board found** | Ready | 2 |
| Your stays, empty | F (kit) | `committedWork` exists; list route is new | 3 |
| Stay, before / during / after | N (during, after) | Part | 4 |
| Payments and receipts | F (period card) | Schedule ready; receipts need counsel (monthly-stays 10) | 4 |
| Extend, Notice to End | F (shipped screens) | Ready (monthly-stays 09, 17, 18) | 2 (port) |
| Cancel, change dates | N | Code exists, unwired, in memory | 4 |
| Report a problem | N | Incident code exists, in memory, no guest intake | 4 |
| Message the Operator, reviews, saved | N | guest-stays 02, 05–12 | 5 |
| Help, Account | N / no board found | Contact `?`; sign-in ready; deletion `?` | 3, 4 |
| Compare, declined, expired, stale, sign-in | **No Xenia board found** | Ready | 2 |
| Domain chooser, switch, "Your plans" | N | Chooser and switch ready; row contract is new | 3, 6 |

## ADR compliance

| ADR | Constraint | Where it bites |
| --- | --- | --- |
| 0004, 0077 | The backend owns state; every surface shows the same facts | Stay page, Your stays, chat cards |
| 0012, 0013 | The Primary Guest occupies and pays | Every after-booking command |
| 0014, 0058, 0092 | Closed cancellation catalogue; Extended entry; Notice to End | Cancel screen, refund amounts |
| 0016–0020 | Deposit is separate; claims need internal finality | Cancel, stay page, receipts |
| 0021, 0089 | Owner Payable timing; payouts are manual | Cancel, notice, report |
| 0028, 0030, 0061, 0067 | Human support, remedies, relocation or refund | Help, report |
| 0041–0046 | Response window, Payment Window, one live attempt, late payment | Waiting, pay, rules pages |
| 0060 | Amendments are versioned; messages change nothing | Change, extend, notice, message |
| 0066 | Reviews collected, not shown; full address after payment | Reviews, arrival |
| 0071, 0075 | Redacted projections; no contact or identity in logs | Rows, messages, emails |
| 0072, 0074 | Commands through the platform gate; stale actions fail closed | Every new action |
| 0076 | Automation stops under human takeover | Report, help |
| 0078 | WCAG 2.2 AA, 44px, 320px, slow networks | Every screen, fonts |
| 0080 | A standard route for every critical task; the agent never confirms or cancels | Every screen |
| 0085, 0093, 0094 | Access after identity check; accounts by emailed code | Arrival, Account, Your stays |
| 0099, 0101, 0104, 0107, 0108 | Packs, platform services, commerce off, modes, shared components | Rows, chooser, chat components |
| 0102, 0106 | Typed catalogue components; cold restore; date authority | All chat work |

ADR 0108 exists only on `docs/ux-guidelines` and `feat/surface-kit-phase-1`. Issue 01 brings it across.

**Conflicts found, not resolved here:**
- ADR 0066 says the full address follows payment. ADR 0085 keeps protected arrival data closed until the identity procedure exists (D7).
- ADR 0045 describes automated refunds. `docs/policy/shortlet-pilot-payments.md` makes pilot refunds manual. This plan follows the pilot policy.
- AGENTS.md on `main` describes the Payment Window differently from ADR 0044 and the code (D22).
- `.scratch/ux-guidelines/issues/38` asks for a guest name on Operator screens. The owner decided against it on 21 Nov 2026 (kit decision D3).

## Out of scope

- Product screens for Events, Services or Community (decisions D2, D12).
- Commerce. Automatic domain switching (tiers A and B). Showing reviews or ratings. Availability alerts (owner, 2 Oct 2026). Interactive maps. Native apps.
- Any change to prices, deadlines, refund rules or the 119-day rule.

## Success

| Check | How |
| --- | --- |
| A guest completes every task in Structure with the model switched off | Automated journey, no model |
| Every approved rule has a check that fails without its guard | method.md gate 3 |
| No reachable state charges, refunds twice or strands a guest | Rules pages 01–03 |
| Every screen passes 320 / 390 / 768 / 1280, light and dark | Captures (AGENTS.md) |
| First render on the reference phone does not regress | Issue 07 measurement |
| Five target guests complete find, pay, report and cancel without help | ux-guidelines 29 (task study) |
