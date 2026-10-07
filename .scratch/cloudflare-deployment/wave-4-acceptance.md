# Wave 4 pilot acceptance (08c AC5): in-app browser run

**Date:** 7 Oct 2026 · **Snapshot:** `cdcae50` on `infra/cloudflare-deployment` (tracked tree clean apart from the two-line heading fix in `scripts/pilot-acceptance-rodney.ps1`) · **Result: PASS**

The Rodney harness was written for another agent harness, so this run replays the same journey (`scripts/pilot-acceptance-rodney.ps1`, scenario by scenario) by hand in the Claude desktop app's in-app browser. Local test data only, no live provider calls.

## Setup

- `npm run pilot:local:reset`, then `npm run pilot:local:bootstrap` (3 Units: Lekki Phase 1, Old Ikoyi, Wuse 2; virtual clock starts at 2026-09-22T10:00Z), then `npm run pilot:local` on `127.0.0.1:3000` (`NODE_ENV` unset, `PORT=3000`).
- **Profile isolation.** The in-app browser has one cookie jar per host, not per tab. A shared jar was proven to leak a guest's thread across tabs, so it was not used. Rodney's three `RODNEY_HOME` profiles map to three cookie hosts:
  - Guest A: `http://127.0.0.1:3000` (native).
  - Guest B: `http://guest-b.localhost:3102`.
  - Operator: `http://operator.localhost:3103`.

  The two `*.localhost` hosts go through a pass-through proxy kept in the session scratchpad, not the repo. It changes only `Host`, `Origin` and `Referer` to the pilot's `publicOrigin`, and `Location` back to the proxy host. The server's origin checks and cookie handling run unchanged. Guest B's POSTs succeeded through it, and each profile had its own `shortlet_guest_session` cookie.
- Reservation and Booking Contract counts were read read-only from `.scratch/pilot-local/shortlet.sqlite`, with the same query as the script's `Get-BookingCounts`.
- Reflow checks set the emulated viewport to 390×844 and 320×740. Each check asserts `innerWidth == clientWidth == scrollWidth == width`, that the composer is visible, and that no visible control is under 44px (ADR 0078).

## Scenarios

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Guest A home | PASS | `/healthz` `{ok:true}`. H1 "Shortlet"; title "Shortlet Concierge". Composer textbox and "Send" button are accessible. Thread `g-9d3b…` was created. No AUTHENTICATION_REQUIRED. |
| 2 | Lagos multi-turn discovery | PASS | Turns: "Lagos", then "2 nights and 2 guests", then "Lekki", then "29 Sept". Weaver mount rendered "Serene One-Bedroom Suite in Lekki Phase 1", 2 guests, 29 Sept–1 Oct. |
| 3 | Authoritative Lekki result | PASS | ₦135,000 = 2 × ₦65,000 + ₦5,000 (inventory). 1 bed, 1 bath, sleeps 2, Wi-Fi. |
| 4 | Discovery reflow 390 / 320 | PASS | scrollWidth 390 / 320; composer visible; no target under 44px. |
| 5 | Generated Unit detail | PASS | "View apartment" opened the detail. Title, neighbourhood, beds/baths/capacity, wifi, description and ₦135,000 match inventory. The photo `src` is `/photos/lekki-1-bedroom.svg`. "Request to Book" is present. |
| 6 | Detail reflow 390 / 320 | PASS | As in row 4. |
| 7 | Two-bedroom refinement | PASS | "0 eligible places … Tue 29 Sept 2026 to Thu 1 Oct 2026"; exactly one `.weaver-mount`. |
| 8 | Old Ikoyi | PASS | 1 eligible place: "Garden Two-Bedroom Stay in Old Ikoyi", ₦265,000 (2 × 125,000 + 15,000). |
| 9 | Request Draft | PASS | "Request Draft · Not sent yet · Your dates are not reserved". |
| 10 | Phone collection | PASS | Weaver tel input. Synthetic `+2348090001111` saved; the flow resumed to the review. |
| 11 | Booking review + reflow | PASS | "Review Booking Request": Unit, 29 Sept–1 Oct, All-In Stay Total ₦265,000. Reflow at 390 / 320 passes. |
| 12 | Booking Request submitted | PASS | "Request sent · Waiting for Operator response … not yet a Reservation". Active surface `:request:req-1dff6b3f…`. |
| 13 | Guest A / Guest B isolation | PASS | Guest B got its own thread `g-e4b1…`, and its "Lagos" turn persisted. Probing Guest A's thread from Guest B returned 200 with an empty timeline and no surfaces. No Guest A text appeared. |
| 14 | Unauthenticated Operator isolation | PASS | The login page has the "One-time access token" textbox and the "Sign in" button. No guest thread in session storage. Both guest thread probes returned 401 AUTHENTICATION_REQUIRED. |
| 15 | Operator token and login | PASS | A fresh `pilot:local:operator-token` token signed in to the back office. Reusing it returned the alert "Access token already consumed", and the existing session stayed valid. The token is not recorded anywhere. |
| 16 | Operator inbox and request detail | PASS | Request req-1dff6b3f lists Unit, 2026-09-29 to 2026-10-01, 2 occupants, phone, ₦265,000 and the deadline. |
| 17 | Operator confirmation | PASS | Attestation checkbox, then "Confirm for Local Pilot Stays Ltd". Result: "Request confirmed · This request is no longer actionable". |
| 18 | Conditional Booking Offer | PASS | After reload, Guest A sees the offer: ₦265,000, "Pay by 11:27 am WAT … 20 minutes left". |
| 19 | Offer acceptance, payment-ready | PASS | "Accept and pay" led to "Payment required · Secure checkout is available". The only active surface is `:payment:ready:offer-8016…`. The Accept action is gone. Counts 0 / 0. |
| 20 | Payment email and checkout resume | PASS | Required email (synthetic `pilot.guest@example.test`) was saved. Result: "Payment handoff ready · Payment not yet verified", ₦265,000, with the deadline. Counts 0 / 0. |
| 21 | Local deterministic payment | PASS | Flow: `/payments/offers/…`, then "Continue to local demo payment", then "Complete local payment". The browser returned to the thread showing "Reservation confirmed · Stay payment verified" and booking reference `res_cmd-c1b8…`. Counts **1 / 1**. H1 "Shortlet". |
| 22 | Confirmed reflow 390 / 320 | PASS | As in row 4. |
| 23 | Restart persistence | PASS | Pilot stopped (listener released) and restarted; browser sessions were kept open. Guest A's same thread still shows "Reservation confirmed". The Operator session went straight to "Booking Requests" ("Request confirmed"). Counts 1 / 1. |
| 24 | Guest B location conflict | PASS | After the restart, Guest B's transcript still had its own "Lagos" turn. "2 nights and 2 guests" was kept. "Wuse" got "Do you want Wuse in Abuja, or should I keep searching in Lagos?". "Abuja" kept 2 guests and 2 nights without asking again. |
| 25 | Guest B Unit to Booking Request | PASS | 1 eligible place in Abuja: "Sunlit Two-Bedroom Retreat in Wuse 2", ₦202,000. Detail, draft, phone `+2348090002222`, review, submit. Distinct request req-df8f1ae5. Counts stay 1 / 1. Guest A's thread is still empty when probed from Guest B. |
| 26 | Operator declines Guest B | PASS | Reason "Dates not available", then "Decline Booking Request". Result: "Request declined". |
| 27 | Guest B declined state | PASS | "Request declined · No Reservation was made and no payment is due". The timeline mentions the decline. No `:booking:` or `:payment:` surface. No Guest A text. |
| 28 | Guest A remains confirmed | PASS | The only active surface is `:booking:ctr_cmd-c1b8…` "Reservation confirmed". No Guest B text. Final counts **1 Reservation / 1 Booking Contract**. |
| 29 | Accessibility | PASS | Guest: heading "Shortlet", composer textbox, "Send", generated actions named by text. Operator: "One-time access token", "Sign in", "Confirm for Local Pilot Stays Ltd", "Decline Booking Request", heading "Booking Requests". |

## Copy and flow drift (the Rodney script is stale; not a product regression)

The script (`6e14a23`, 23 Sep) predates the guest UI refresh and confirm-real-dates work (30 Sep to 2 Oct). It would fail at its next assertion even with the heading fix. The current behaviour is the intended product:

- **Composer accessible name.** It is now "Area, dates, guests" (visible label "Your message"), not "Message the concierge".
- **Discovery action.** It reads "View apartment", not "View Unit".
- **Arrival date.** Discovery now asks for the arrival date ("Could you tell me what date you arrive…") before searching. The script assumed it was inferred.
- **Draft text.** It says "Your dates are not reserved", not "Inventory is not reserved".
- **Review order.** "Review request" asks for the phone number first, then shows "Review Booking Request". The old order was review, then Submit, then phone.
- **Operator landing page.** It is now the back office: home "Waiting on you", then "Booking Requests". The text "Operator workspace" no longer appears. The inbox lists request IDs in links, not the raw Unit ID in text.
- **Operator confirm and decline.** Confirm needs an attestation checkbox. Decline needs a reason under "Decline this request…".
- **Projection strings.** "Booking Request status: disclosed|declined", "Payment status: ready|checkout_initiated", "Total cash requirement" and "Contract version: 1" no longer appear in the projections. The UI shows the same states in guest copy.
- **Guest B location summary.** After resolving the conflict the summary reads "Abuja", not "Wuse 2, Abuja". Search still returned only the Wuse 2 Unit, the only Abuja inventory.
- **Pilot photos.** They return 404 "No approved local property photo is bundled with this pilot". The UI shows its "Photo unavailable" fallback, and image sources still point at the inventory's `/photos/` paths.
