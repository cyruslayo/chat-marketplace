# Local Shortlet Pilot — Human Acceptance Session Runbook

Baseline commit: `601b4250c9da0776a6b58243d08c57ccc5344095`

> ⚠️ **Session precondition to confirm before you start.** The working tree at session start
> is **not** clean: `apps/local-guest/src/guest-server.ts` carries a large uncommitted change
> (mostly a formatting pass, plus a few small fail-closed guards). The local pilot runs the
> **working tree**, not the commit. Decide whether to `git stash` it, commit it, or accept it
> before you begin — see `git status` / `git diff --stat`.

## 1. Start the pilot (already running)

```bash
# clean session (optional, destroys local pilot data only)
npm run pilot:local:reset
npm run pilot:local:bootstrap

# start (Terminal A)
npm run pilot:local

# one-time Operator token (Terminal B)
npm run pilot:local:operator-token
```

A reset + bootstrap was performed, so the session starts clean:
`guest_booking_requests = 0`, `booking_reservations = 0`, `booking_contracts = 0`.

If the server was restarted, just re-run `npm run pilot:local` — the data survives in
`.scratch/pilot-local/`.

## 2. URLs

| Surface | URL |
| --- | --- |
| Guest | <http://127.0.0.1:3000/> |
| Operator login | <http://127.0.0.1:3000/operator/login> |
| Operator inbox | <http://127.0.0.1:3000/operator/requests> |
| Health | <http://127.0.0.1:3000/healthz> |

Operator authentication is **not** bypassed: `GET /operator/requests` without a session
returns `401`.

## 3. What is actually running

- **No live model.** `CONCIERGE_MODE` is unset → deterministic regex concierge
  (`apps/local-guest/src/concierge.ts`). No `GEMINI_API_KEY`, no network calls to a model.
- **Deterministic local PSP.** `deterministicPsp: true`; payment still flows through the real
  payment application boundary and produces a real Reservation + Booking Contract.
- **3 published Units:**

  | id | title | area | cap | bed | bath | nightly | photos |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | `unit-local-abuja-wuse2` | Sunlit Two-Bedroom Retreat in Wuse 2 | Abuja / Wuse 2 | 4 | 2 | 2 | ₦95,000 | 2 SVG |
  | `unit-local-lagos-ikoyi` | Garden Two-Bedroom Stay in Old Ikoyi | Lagos / Old Ikoyi | 4 | 2 | 2 | ₦125,000 | 2 SVG |
  | `unit-local-lagos-lekki` | Serene One-Bedroom Suite in Lekki Phase 1 | Lagos / Lekki Phase 1 | 2 | 1 | 1 | ₦65,000 | 2 SVG |

- Guest thread id lives in `sessionStorage` → survives **refresh**, not **tab close**.
- Photos are synthetic same-origin SVGs at `/photos/*.svg` (no external image host).

## 4. Scenario checklist (type conversationally in the Guest composer)

### Scenario 1 — Lagos multi-turn

1. `Lagos` → assistant asks for missing facts (expect "how many guests…").
2. `2 nights and 2 guests` → discovery surface appears (Old Ikoyi for Lagos).
3. `Lekki` → results now relevant to Lekki Phase 1.
   - Judge: facts remembered, **no repeated** nights/guests question, single workspace updated
     in place (not stacked duplicates), result visibly Lagos/Lekki.
4. `Show me the apartment.` or the generated **View Unit** action → Unit detail.
   - Inspect: photos, title, area, price, bedrooms, bathrooms, capacity, amenities, description.

### Scenario 2 — Refinement

From an active discovery result: `Only show me two bedrooms.`

- Judge: `conversation → workspace update`, not `conversation → duplicate UI → duplicate UI`.

### Scenario 3 — Conflict

Fresh session (new tab): `Lagos` → `2 nights and 2 guests` → `Wuse`

- Expect a **concise location clarification** (Abuja vs keep Lagos); nights stay 2, guests stay 2.
- Then `Abuja` → discovery proceeds **without** re-asking nights or guests.

### Scenario 4 — Guest booking

apartment → **Request to Book** → **Request Draft** → **Review Request** →
**Submit Booking Request** → phone (synthetic Nigerian number, e.g. `+2348031234567`) →
**Save Phone number**

- Judge: next action obvious? price understandable? deposit understandable? UI connected to the
  conversation? unnecessary verbosity? does the Guest understand the request is **not yet
  confirmed**?

### Scenario 5 — Operator

`/operator/login` → paste one-time token → open inbox → open the request → **Confirm Booking Request**

- Judge: request easy to understand? response deadline clear? Guest phone where expected?
  confirmation obvious? usable without developer knowledge?

### Scenario 6 — Guest offer

Back to Guest → **Conditional Booking Offer** appears → accept → provide payment email

- Judge: amount and deadline clear? `conversation → offer → payment` coherent?

### Scenario 7 — Local payment

Follow **Start secure checkout** → email → payment handoff → **Continue to local demo payment**
→ **Complete local payment** → **Reservation confirmed**

- Judge final screen against: Did my booking succeed? Which apartment? For what stay?
  What did I pay? What happens next?

### Scenario 8 — Restart

1. Stop `pilot:local` (Ctrl+C).
2. `npm run pilot:local`.
3. Refresh the **same** Guest tab; refresh the Operator tab.

- Judge: state and session remain intact.

### Scenario 9 — Decline

New Guest session/tab → create a Booking Request → Operator inbox → **Decline Booking Request**
→ refresh Guest → confirm the Guest understands it was declined.

### Scenario 10 — Mobile

Responsive mode at **390px** and **320px**; inspect composer, apartment cards, Unit details,
booking forms, offer, payment, confirmed booking, and the Operator inbox.

## 5. Findings template

While exploring, record each issue as one of **BLOCKER / CONFUSING / COSMETIC / FUTURE** with:

- page/state
- exact user action
- observed behaviour
- expected behaviour
- screenshot (optional)

Do **not** change code during the session. Collect findings first.

## 6. Agent-side scratch artifacts (not product code)

- `.scratch/pilot-acceptance/screenshots/*.png` — CDP walk-through screenshots
- `.scratch/pilot-acceptance/agent-observations.json` — machine notes from that walk
- `.scratch/pilot-acceptance/capture.mts` — throwaway driver
