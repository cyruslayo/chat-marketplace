# Local Shortlet pilot

This runs the complete pilot on one localhost origin with synthetic inventory and a deterministic local payment provider. It does not deploy or configure a VPS.

## First run

```text
npm install
npm run pilot:local:bootstrap
npm run pilot:local
```

Open:

- Guest: `http://127.0.0.1:3000/`
- Operator: `http://127.0.0.1:3000/operator/`
- Health: `http://127.0.0.1:3000/healthz`

Set `PORT` to override port 3000, for example in PowerShell:

```powershell
$env:PORT = "3100"
npm run pilot:local
```

The configured origin is exactly `http://127.0.0.1:<port>`; other Origins are rejected.

## Operator login

In a separate browser profile or incognito window:

```text
npm run pilot:local:operator-token
```

Copy the one-time token printed by that command, open `/operator/login`, paste it, and select **Sign in**. The normal startup log never prints a token.

## Guest journey

1. Open `http://127.0.0.1:3000/` in a fresh browser profile.
2. Select **Contact details**, enter a synthetic Nigerian phone such as `+2348090001111`, and save it.
3. Search: `I need an apartment in Abuja for 2 nights for 2 people` (or replace Abuja with Lagos).
4. Open the Unit and select **Request to Book**.
5. Review and submit the Booking Request.
6. In the Operator browser, open **Booking Requests**, open the request, and confirm it.
7. Return to the Guest browser, refresh, and accept the Conditional Booking Offer.
8. Open **Contact details**, enter a synthetic email such as `pilot.guest@example.test`, and save it.
9. Return to the Guest workspace and select **Start secure checkout**.
10. Select **Continue on the standard page**, then **Continue to local demo payment**.
11. Select **Complete local payment**.
12. Verify **Reservation confirmed**, the contract version, parties, dates, amount, and policies.

The local provider verifies the authoritative server amount through the existing card-payment application boundary. It does not collect card data and is not Paystack.

## Operator walkthrough

1. Run `npm run pilot:local:operator-token`.
2. Open `/operator/login`, paste the one-time token, and sign in.
3. Open `/operator/requests`.
4. Open the Booking Request and inspect dates, party, price, phone, and response deadline.
5. Confirm or decline the request.
6. Refresh the detail page and verify the terminal status.

## Two-browser isolation

Use two independent Chrome profiles or incognito contexts. Create a Request Draft and Booking Request in Browser A. Open the Guest URL in Browser B. Browser B receives a different `shortlet_guest_session` and cannot see Browser A’s phone, draft, request, offer, Reservation, or Contract.

## Restart test

1. Start with `npm run pilot:local` and keep both browser windows open.
2. Create and submit a Guest Booking Request, then sign the Operator in.
3. Stop the process normally with Ctrl+C.
4. Run `npm run pilot:local` again without bootstrapping.
5. Refresh both existing browser windows. Guest and still-valid Operator sessions restore from `.scratch/pilot-local/`.
6. Continue confirmation and payment. Stop/start once more and refresh to verify the confirmed Reservation and Contract remain visible.

## Decline test

Create a second Booking Request in another fresh Guest profile. In the Operator inbox, open it and select **Decline Booking Request**. Refresh the Guest window and verify the declined state.

## Reset

Reset is a separate CLI restricted to the exact local pilot directory:

```text
npm run pilot:local:reset
npm run pilot:local:bootstrap
```

It cannot target production paths and no reset HTTP route is mounted.

## Rodney browser acceptance (Windows)

PowerShell 7, Chrome, and the external `rodney` CLI are required; Rodney is not an npm dependency. Run `npm run pilot:acceptance:rodney -- --Reset` for a clean local run; `--Reset` explicitly resets and bootstraps local pilot data. By default the harness starts and stops its own `pilot:local` server. Use `--UseExistingServer` with a healthy manually started server to leave that server untouched; restart persistence is skipped in this mode. Guest A, Guest B, and Operator use separate Rodney homes beneath `.scratch/pilot-acceptance-rodney/sessions/`. Reports, screenshots, logs, and sessions are kept under `.scratch/pilot-acceptance-rodney/`.

The verified Rodney v0.4.0 executable advertises `start --show` in top-level help but rejects it at runtime, so `--ShowBrowser` falls back to headless acceptance. Rodney screenshot `-w`/`-h` changes screenshot dimensions but did not change CSS `window.innerWidth` or `documentElement.clientWidth` in this environment. The 320px/390px behavioral viewport checks are therefore reported as **SKIPPED**, not passed.

## Data location

Runtime data is ignored by Git and survives restart:

```text
.scratch/pilot-local/
  shortlet.sqlite
  inventory.json
  operators.json
```

## Local versus production

Local mode uses loopback HTTP, non-`Secure` cookies, synthetic Abuja/Wuse 2 and Lagos/Old Ikoyi plus Lagos/Lekki Phase 1 Units, locally served synthetic photos, a synthetic Operator/representative grant, and a deterministic local payment provider.

Production remains `npm run pilot:start`: it requires HTTPS, `Secure` cookies, live Paystack configuration, persistent configured files, and has no fixture, deterministic-provider, or reset routes. Both modes retain distinct Guest principals, real Guest and Operator sessions, ADR-0082 representative authority, the Booking Request and Conditional Booking Offer applications, the payment state machine, Reservation and Booking Contract creation, and durable persistence.

Late-payment/reconciliation remains covered by the existing focused regression tests; the local browser control intentionally exposes only the successful deterministic outcome and does not add a separate late-payment UI.
