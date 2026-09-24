# Local Guest Weaver Demo

This is a deterministic local demonstration of the guest Shortlet booking journey. It is not a production concierge or payment integration.

## Deterministic mode

From the repository root (no Gemini API key or network is required):


```sh
npm install
npm run guest:reset
npm run guest:local
```

Open <http://localhost:3001>. The local apartment-owner demo continues to use <http://localhost:3000>.

Use this canonical prompt to exercise the complete journey:

> I need an apartment in Ikoyi for 3 nights for 2 people

The default concierge is a small deterministic regex interpreter. It uses 10 September 2026 as the deterministic check-in date (fixture clock: 3 September 2026), derives checkout from the requested night count, preserves an optional Lagos neighbourhood filter, and asks for clarification when location, nights, or guest count cannot be safely interpreted.

## Assistant offline mode (v1)

To run the complete task-oriented Shortlet Guest Assistant completely offline with multi-turn support and two-phase confirmations:

```sh
npm run guest:assistant
```

## Gemini mode

For an optional live conversational interpreter, obtain a Gemini Developer API key through Google's official documentation and export it server-side:

```sh
export GEMINI_API_KEY="YOUR_KEY"
export GEMINI_MODEL="gemini-3.8-flash"
npm run guest:reset
CONCIERGE_MODE=gemini npm run guest:local
```

`GEMINI_MODEL` is configurable and defaults to `gemini-3.8-flash`. Gemini mode has a bounded 20-second local-demo request timeout and may incur API usage/cost. `GEMINI_API_KEY` is never sent to the browser, HTML, A2UI, Interaction Artifacts, events, responses, or logs. The server exposes exactly one model tool: `search_stays`. The server validates and normalizes its arguments, executes the authoritative `UnitDiscoveryQuery`, and sends Gemini only minimal result metadata. Discovery Artifact → `discoveryArtifactToA2UI` → Weaver still produces the apartment UI. Gemini is not involved in booking, Operator acceptance, offers, payment, or Booking Contract actions.

If `CONCIERGE_MODE=gemini` is selected without `GEMINI_API_KEY`, startup fails clearly. Deterministic tests never call Gemini.

## Optional local pilot live-agent smoke

This explicit smoke is separate from `npm test`, `npm run check`, `npm run verify:weaver`, and `pilot:acceptance:rodney`. It uses the already-bootstrapped local pilot inventory and the existing Gemini `AssistantModelClient` adapter. By default it makes one four-turn journey with a hard limit of 10 Gemini provider requests (two requests per turn plus two continuation calls); API usage may incur cost. The request count includes bounded connection retries.

PowerShell:

```powershell
$env:GEMINI_API_KEY = "<key>"
$env:GEMINI_MODEL = "gemini-3.8-flash"
npm run pilot:local:agent-smoke
```

Free-tier guidance: run one smoke journey, avoid repeated runs, and run the browser session only after the smoke succeeds. Use `--runs 3` only for deliberate variability testing; `PILOT_AGENT_SMOKE_RUNS=3` is also supported. A provider HTTP 429 stops the smoke immediately without another request. The command does not start or reset the pilot, and it does not submit a Booking Request or start payment. Without `GEMINI_API_KEY`, it exits successfully with `Live-agent smoke not run — credentials unavailable` and writes a `NOT_RUN` report. Runtime artifacts are written under `.scratch/pilot-agent-smoke/` and are ignored by Git. Reports include journey and per-turn request counts plus sanitized provider status, never prompts, model prose, authorization headers, or credentials.

For deliberate variability testing only:

```powershell
npm run pilot:local:agent-smoke -- --runs 3
```

The live browser can use the same existing Guest interface and local inventory:

```powershell
$env:GEMINI_API_KEY = "<key>"
$env:GEMINI_MODEL = "gemini-3.8-flash"
$env:CONCIERGE_MODE = "gemini"
npm run pilot:local
```

Then use the Guest conversation with these prompts, in order:

1. `Show me apartments in Wuse 2.`
2. `Only show me two-bedroom apartments.`
3. `Open the first one.`
4. `I want to book this apartment for two nights for two guests.`

`GEMINI_API_KEY` remains server-side. The local pilot continues to use its local payment provider; this smoke stops after the non-submitting Request Draft, before Operator or payment workflows. Location-only discovery does not require invented dates or party details; availability is rechecked authoritatively when the Request Draft is prepared.

The browser session is a separate, explicit validation step and is not launched by the smoke command. Start it only after the programmatic smoke succeeds; it makes its own Gemini requests.

## Journey stages

1. Discovery renders authoritative results with Weaver Basic Catalog A2UI, All-In Stay Total, separate Refundable Security Deposit, inspection, and management-trust facts. The canonical Ikoyi prompt returns only the eligible Old Ikoyi Unit; a generic Lagos prompt can return both eligible fixtures.
2. View Unit requests a server-generated Unit detail surface.
3. Request to Book creates and discloses a real Booking Request through the booking-eligibility and availability application paths; Guest Identity Verification is not required for booking.
4. The local fixture simulates the authorized Operator representative confirming the request and issuing a Conditional Booking Offer.
5. Accept Offer creates the payment projection. Start secure checkout uses a deterministic local PSP stub and progresses through separate stay and refundable-deposit charges; no card data or live provider is used.
6. Payment commits the reservation and exposes the resulting Booking Contract projection. Guest Identity Verification remains a future Check-In Eligibility requirement, and protected arrival data remains locked in this demo.

Every consequential action is emitted by Weaver and sent to the server. The browser owns only presentation and interaction projection state; the server validates the allow-listed action, current surface, identity, authorization, amount, and aggregate state.

## Reset and troubleshooting

`npm run guest:reset` removes the local guest SQLite fixture. The HTTP reset endpoint (`POST /api/reset`) also rebuilds the complete environment and clears interaction threads. A reset makes old surface events invalid and restores the deterministic first discovery artifact (`search-guest-demo-001`).

If the page says the client bundle is missing, run `node apps/local-guest/scripts/build-client.mjs` or restart with `npm run guest:local`. If a stale process owns port 3001, stop it before restarting. The demo uses only local fixtures and has no production credentials.
