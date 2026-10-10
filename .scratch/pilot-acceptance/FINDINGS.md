# Local Shortlet Pilot — Agent-Observed Acceptance Findings (DRAFT for human review)

**Baseline commit:** `601b4250c9da0776a6b58243d08c57ccc5344095`
**Method:** deterministic `/api/turn` probes against the live pilot + real-Chromium CDP walk
(`capture.mts`) + source inspection. **These are agent observations, not human judgements.**
No code was changed.

## Verified working (no issue)

| Area | Evidence |
| --- | --- |
| Multi-turn memory | `Lagos` → asks nights/guests → `2 nights and 2 guests` → 2 eligible; `Lekki` → 1 eligible. No repeat of known facts. |
| Single workspace | Surface ids increment (`…results`, `…:2`, `…:3`) and DOM shows exactly **1** `#active-workspace` after every turn — no duplicate UI stack. |
| Weaver rendering | Real-Chromium proof that the workspace mount is `[data-renderer=weaver]` for discovery, unit detail, draft, review, phone, offer, payment, contract. |
| Conflict | `Lagos` → `2 nights and 2 guests` → `Wuse` ⇒ “Do you want Wuse in Abuja, or should I keep searching in Lagos?”; `Abuja` ⇒ 1 eligible, nights/guests preserved. |
| “Not yet confirmed” clarity | Assistant says “Dates are not reserved until you submit a revalidated Booking Request.”, “Booking Request submitted. No Reservation exists yet; the Operator must respond.”, draft says “Inventory is not reserved. This is not a Booking Request or Reservation.” |
| Payment | Deterministic local PSP through the real payment boundary; **exactly 1** Reservation and **1** Booking Contract; final screen says “Reservation confirmed” / “Booking confirmed” and shows Amount Paid. |
| Operator auth | `/operator/requests` unauthenticated ⇒ 401; one-time token login works; raw request id used as link text. |
| Mobile | 390px and 320px: `document.scrollWidth == viewport`, `#active-workspace` overflow 0, 1 workspace. |

## BLOCKER

_None observed._ Every scripted journey leg completed end-to-end (payment produced exactly one
Reservation and one Booking Contract, and state survived refresh/restart in the automated suite).

## CONFUSING

### C1 — The confirmed-booking screen does not name the apartment

- **Page/state:** Guest → final `Reservation confirmed` workspace (after local payment).
- **Action:** complete a booking, then read the confirmation.
- **Observed:** `Unit: unit-local-lagos-lekki; Stay: 2026-09-29 to 2026-10-01 (2 nights)`.
- **Expected:** the apartment **title** (“Serene One-Bedroom Suite in Lekki Phase 1”) and its area,
  so the Guest can answer “Which apartment did I book?”.
- **Why it matters:** the acceptance brief explicitly asks the Guest to answer that question from
  this screen. The title is shown on the draft/review/offer, then disappears at confirmation.
- **Evidence:** `agent-observations.json` → `s16.local payment`; screenshot `21-confirmed-booking.png`.

### C2 — Raw unit id replaces the title in the Booking Request status screen

- **Observed:** `Unit: unit-local-lagos-lekki; Stay: …` while the immediately preceding Request
  Draft / Review screens show `Unit: Serene One-Bedroom Suite in Lekki Phase 1`.
- **Expected:** one consistent human-readable identifier.
- **Evidence:** `s7.save phone` vs `s4.request draft`; screenshots `10-…` vs `07-…`.

### C3 — Operator cannot tell which apartment a request is for

- **Page/state:** Operator inbox + request detail.
- **Observed:** line text is the raw `req-db2313a9-…` id and `Unit: unit-local-lagos-lekki`.
- **Expected:** apartment title (and ideally guest name), not internal ids.
- **Why it matters:** “usable without developer knowledge” — a real Operator has no way to map
  `unit-local-lagos-lekki` to a property.
- **Evidence:** `s9.operator inbox`, `s10.operator request detail`; source
  `apps/local-owner/src/local-owner-server.ts:37,43`.

### C4 — “Show me the apartment.” is not understood

- **Action:** from an active discovery result, type `Show me the apartment.` (a phrase in the
  acceptance script) — or `show me the first one`.
- **Observed:** “Your current search results are still active. Tell me how you would like to refine
  them, for example: “Only show two-bedroom apartments”.”
- **Expected:** open the Unit detail (as the generated **View Unit** action does), or at least
  acknowledge the intent.
- **Note:** the journey still continues via the generated UI action, so this is not a blocker.
- **Evidence:** deterministic probes 1 and 4; `capture.mts` s3 (generated action works).

### C5 — Refinement can silently produce zero results

- **Action:** from the Lekki result, type `Only show me two bedrooms.`
- **Observed:** “I found 0 eligible places in Lagos …” / “No eligible Units match those
  requirements.” The **neighbourhood constraint (Lekki Phase 1) is retained**, and Lekki has only
  1-bedroom inventory, so nothing matches.
- **Expected (judgement):** either widen the search, or explain _why_ (e.g. “Lekki Phase 1 has no
  two-bedroom units — remove the area filter?”). Without that, the Guest may conclude Lagos has no
  2-bedroom apartments, even though Old Ikoyi has one.
- **Control case:** the same refinement **without** a neighbourhood correctly returns 1 Unit.
- **Evidence:** probe thread `g-1111…` turn 4; `g-2222…` control.

### C6 — Manifest fields are exposed with machine vocabulary / raw values

- **Booking Request status:** `Booking Request status: disclosed`, `Delivery: delivered at
  2026-09-22T10:34:10.230Z` (raw ISO), `Nights: 2`.
- **Secure payment:** `Payment status: ready`, `Payment deadline: 2026-09-22T10:54:30.007Z` (raw ISO).
- **Unit detail:** `Capacity: 2 guests · entire-place`.
- **Confirmed booking:** `Payment method: fresh_card`.
- **Expected:** human wording/timestamps (the Operator view already formats the deadline as
  “22 Sept 2026, 12:04 WAT”; the Guest surface does not).
- **Evidence:** `s7`, `s13`, `s3`, `s16`; source `unit-detail-a2ui.ts:33`,
  `card-payment-a2ui.ts:14,17`, `booking-contract-a2ui.ts:13`.

### C7 — The offer screen contains a wall of policy text

- **Observed:** the Conditional Booking Offer surface includes a ~12-clause guest-conduct
  paragraph (“…commercial use is prohibited.; Occupancy must not exceed the verified maximum.;
  Every overnight occupant must be named.; Visitors follow the unit's disclosed catalogue
  choice…; Quiet hours are 22:00–08:00 Africa/Lagos.; …”) plus a `Disclosures:` paragraph.
- **Expected (judgement):** the decision-relevant facts (amount, deadline, what happens next)
  prominent; long policy text available but collapsed/linked.
- **Why it matters:** the brief asks “Is anything unnecessarily verbose?”
- **Evidence:** `s12.guest offer`.

### C8 — “Companion 1” appears as an occupant the Guest never entered

- **Observed:** Request Draft / Review / Offer show
  `Primary Guest: Local Guest; Guests: Local Guest, Companion 1`.
- **Cause:** local fixture synthesises `Companion ${index}` (`apps/local-guest/src/fixture.ts:347`).
- **Expected (judgement):** either ask the Guest for occupant names, or don't display a placeholder
  name as if it were a real occupant.
- **Evidence:** `s4.request draft`, `s12.guest offer`.

### C9 — Amenity labels are mangled

- **Observed:** `Amenities: wifi, 247powergenerator, parking, airconditioning, securityguard,
  swimmingpool` — but on another unit `…, security_guard` (underscore kept).
- **Cause:** amenities are emitted as raw catalogue tokens joined with `,`
  (`discovery-a2ui.ts:125`, `unit-detail-a2ui.ts:35`) and rendered through a markdown-capable Text
  component, so paired `_` characters are consumed (`24_7_power_generator` → `247powergenerator`)
  while a lone `_` (as in `security_guard`) survives.
- **Expected:** human labels (“24/7 power generator”, “Air conditioning”, “Security guard”).
- **Evidence:** `s1.turn2`, `s1.turn3`, `s3`, `s18`.

## COSMETIC

### M1 — Inconsistent currency formatting across Guest surfaces

- Unit detail / draft / offer: `₦135,000.00`
- Request Draft also appends the code: `₦135,000.00 NGN`
- Secure payment + confirmed booking: `NGN 135000.00` (no symbol, no thousands separator)
- Evidence: `s3`, `s4`, `s13`, `s16`.

### M2 — Persistent “Ready for your next action.” + literal “CURRENT WORKSPACE”

- Every workspace renders `CURRENT WORKSPACE` and `Ready for your next action.`, including on the
  completed `Reservation confirmed` screen and on pure error/empty states.
- Evidence: all workspace captures.

### M3 — Payment leaves the chat UI for a bare page

- `Start secure checkout` → “Continue on the standard page” → `Continue to local demo payment` →
  a plain, minimally styled `/payments/local/...` page (“Local demo payment”).
- Journey is coherent; visually it reads as leaving the product.
- Evidence: `s15`, `s16`; screenshot `20-local-payment-page.png`.

### M4 — Startup banner prints `/operator/` rather than the login URL

- `npm run pilot:local` prints `Operator: http://127.0.0.1:3000/operator/`; the brief’s entry point
  is `/operator/login`.
- Evidence: `apps/pilot/src/cli-local-start.ts`.

### M5 — `ExperimentalWarning: SQLite is an experimental feature` on every CLI command

- Appears on `pilot:local`, `pilot:local:bootstrap`, `pilot:local:operator-token`.
- Harmless, but noisy for a first-time operator.

### M6 — Compliance vocabulary on the Guest Unit detail

- `Physical inspection: current`, `Inspected: 2026-09-01; current through: 2027-09-30`,
  `Management authority: current`.
- Likely deliberate trust transparency (ADR-0008/0056), but the wording is operator-facing.

### M7 — Internal policy version id shown to the Guest

- `Cancellation: standard (cancellation-v1) — Standard launch cancellation policy`.
- Evidence: `s4.request draft`.

## FUTURE

### F1 — Refinement/opening intents are regex-limited

- The deterministic concierge understands a narrow set of phrasings; `Show me the apartment.` and
  `show me the first one` fall through to the generic refine hint. Not required for the first pilot
  if the generated UI actions carry the journey.

### F2 — Synthetic SVG “photos”

- Two same-origin placeholder SVGs per unit, with the area name drawn on them. Fine for a
  functional pilot; not a real apartment presentation.

### F3 — Occupant names are fixture-generated

- See C8; a real product would collect occupant details rather than synthesise `Companion N`.

## Open (not agent-verifiable)

- **Restart check (human):** verified automatically by `test/pilot-local.test.ts` AC21–AC23
  (Reservation survives refresh; survives application restart; Operator state survives restart).
  The human should still confirm visually.
- **Decline check:** verified automatically by AC24/AC25 in real Chromium. The agent-side
  screenshot walk could not capture it (see `29-operator-declined.png` — no request to decline):
  a Guest tab opened **after** a confirmed booking did not render the composer. This was not
  reproduced against a clean session and is most likely agent-harness resource pressure with 6+
  headless tabs; it needs one human confirmation.
