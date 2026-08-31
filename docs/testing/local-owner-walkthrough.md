# Local Apartment-Owner Test & Simulation Guide

This guide describes how to run and test the Shortlet marketplace locally on a developer machine as an apartment owner (`LOCAL OWNER READY`).

## Prerequisites & Design

- **No production credentials or cloud deployments needed**: All identity, verification, calendar, payments, and SMS systems run with deterministic local mocks and file-backed SQLite storage.
- **Root Commands**:
  - `npm run owner:local`: Starts the localhost test surface for an apartment owner at `http://localhost:3000`.
  - `npm run owner:reset`: Resets the local deterministic fixture database.
  - `npm run test:owner-local`: Runs automated end-to-end acceptance tests proving owner readiness.

---

## Seeded Apartment Owner & Unit Profile

When you launch `npm run owner:local`, the environment automatically seeds one high-trust apartment owner and unit:

| Property | Value | Domain Rationale / ADR Reference |
| :--- | :--- | :--- |
| **Operator Entity** | `Eko Prime Living Ltd` (`op-lagos-owner-001`) | Approved business entity with verified CAC & responsible persons (ADR 0021, ADR 0062). |
| **Representative Person** | `Babatunde Adeleke` (`person-owner-001`) | Holds an explicit, active `operator_actions` grant in SQLite (ADR 0072, ADR 0075). |
| **Apartment Unit** | `Luxury 2-Bedroom Apartment in Old Ikoyi` (`unit-lagos-ikoyi-001`) | Entire Place occupancy model in Lagos, capacity 4 (ADR 0021). |
| **Inspection & Authority** | `passed` & `verified` | Satisfies all 9 physical inspection safety scopes & 8 management authority permissions (ADR 0021). |
| **Pricing & Terms** | ₦120,000 / night, ₦10,000 mandatory charges, ₦50,000 deposit | Complies with All-In pricing and refundable deposit rules (ADR 0016, ADR 0026). |
| **Trust Tier & Commission** | `preferred` (10% commission) | Evaluated from $\ge 30$ bookings and $\ge 98\%$ reliability with zero active misconduct (ADR 0083). |

---

## Local Walkthrough Workflow

### 1. Launch the Test Server
```bash
npm run owner:local
```
Navigate in your browser to: **`http://localhost:3000`**

### 2. Inspect Owner & Apartment Identity
- Verify that **Eko Prime Living Ltd** displays as **Approved** and **CAC Verified**.
- Verify that **Babatunde Adeleke** is marked **Authorized** under the active representative grant.
- Inspect the apartment's physical inspection status (**passed**) and management authority (**verified**).

### 3. Review Settlement & Trust Projections
- Observe the **Preferred** tier projection with 10% platform commission.
- Review the **Ordinary Settlement (100%)** breakdown for an upcoming 3-night stay (₦370,000 gross $\rightarrow$ ₦333,000 net $\rightarrow$ ₦333,000 payable now, ₦0 routine reserve tranche under ADR 0083).

### 4. Test Incoming Booking Request
1. Click **"Generate Demo Booking Request"** on the dashboard.
2. A verified incoming guest request from *Dr. Kemi Balogun* appears in the interaction panel with an active 30-minute response window.
3. Click **"Confirm Booking"**:
   - The status immediately transitions to `confirmed`.
   - The availability calendar locks the dates (`2026-08-15` to `2026-08-18`) against any overlapping bookings or holds.
   - Any re-attempt to confirm the same request fails closed.

### 5. Reset Fixture
To return to a clean initial state:
```bash
npm run owner:reset
```
Or click the **"Reset Fixture"** button directly on the dashboard.

---

## Automated Acceptance & Readiness Proof

Run the automated test suite to verify all 5 acceptance phases:
```bash
npm run test:owner-local
```
This tests:
1. Representative authority grant creation, lookup, and negative access denial for unauthorized actors.
2. Apartment eligibility, safety inspection scope, and calendar availability.
3. Trust Tier progression and balanced ledger reconciliation under ADR 0083.
4. Booking request creation, confirmation, inventory locking, and idempotency.
5. Server HTTP endpoints (`GET /`, `GET /api/state`, `POST /action/*`) and dashboard rendering.
