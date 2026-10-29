# Tester readiness and open to-do (2026-10-29)

Staging: https://shortlet-pilot-staging.khayutsefi.workers.dev (built from main 579249a; main tip 0ed02f2 differs only by a test helper).

## Verified live on this build
Search (Lekki, 2 guests, 10-13 Nov 2026) -> View -> Request to Book -> phone -> Submit -> Conditional Offer -> Accept -> email -> Paystack test checkout -> paid -> "Reservation confirmed / Stay payment verified" (N200,000).

## Tell testers
- Synthetic data only. Placeholder phone +234 801 234 5678; any example.com email.
- A Booking Request can only be submitted 8:00 AM to 7:30 PM WAT (UTC+1), and by 10:55 AM WAT on the check-in date. A refusal outside that window is policy, not a bug (ADR 0041, 0042).
- Pick a check-in date in the future (for example 2-3 weeks out).
- Payment Window is 20 minutes after Accept Offer; a late payment is refunded and does not confirm.
- Payment is Paystack TEST mode: use Paystack's published test card, not a real card.
- The chat workspace at `/` is the main experience; `/conversation` is the no-JS fallback.
- Only Lekki Phase 1 demo inventory is expected to return results (units come from apps/cloudflare/demo/inventory.csv).

## Before wide testing
- [ ] Confirm in the Paystack dashboard that `charge.success` reached `<origin>/webhooks/paystack` with a 200 (no webhook log line was seen after the first payment). Booking was confirmed, but not proven via the webhook.
- [ ] Each tester's journey creates real staging bookings; decide who clears them and how (demo reset).
- [ ] Concierge daily model-call cap is 1500; watch usage if many testers.
- [ ] `/_ops/*` stays behind Cloudflare Access plus ops secret; guest pages are public. Confirm the link you send is the guest origin only.

## Known gaps (follow-up issues)
1. ADR 0046: a late Paystack success on a superseded or reminted reference is ignored, with nothing recorded or refunded. Narrow (legacy path). Proposed fix: record an indeterminate attempt on timeout, ask the PSP before any new initialize on retry, keep every minted reference monitored, pass AbortSignal to payments.start, make a retry during an in-flight start join it.
2. `apps/cloudflare/test/daily-export.spec.ts` D3 times out at 5.7 s against a 5 s limit on this machine (also fails solo). Raise the spec timeout or speed the export.
3. Bank-transfer references (`exp_trf_<hex>`) still contain an underscore (ADR 0047 decision).
4. Stuck legacy initiated attempts on later periods block a retry for 20 minutes.
5. After a refused payment start the chat card still shows the verify-return button.
6. The conditional-offer HMAC literal `conditional_offer_secret` should become a configured secret.
7. Local workerd load check of the prebuilt bundle has no repo script (only the static module-scope guard exists).
8. Demo CSV trust fields expire 2027-12-31; refresh before about 19 Sep 2027 (104-day rule blocks offers after that).

## Gate status (da4e3c5 and main)
check clean; test:workers and npm test pass except load flakes that pass solo and the accepted commerce files (`commerce-store-pages.real-browser`, `commerce-surfaces-chromium`) plus the D3 timing failure above.

## Owner housekeeping
- Delete `C:\Users\Cyrus\staging-secrets.env`, `access-policy-include.json`, `access-app.json`.
- Access service token client secret expires 27 Oct 2027 (kept in password manager).
- Main is NOT pushed to origin; uncommitted AGENTS.md, CLAUDE.md, HANDOFF.md and `.scratch` edits remain in the main checkout. Backup of the replaced untracked `.scratch/assistant-runtime-hardening` files is in the session scratchpad.
- Remove the detached worktree `C:\AI2026\chat-marketplace-staging` and `-merge`/`-fixes` once no longer needed.
