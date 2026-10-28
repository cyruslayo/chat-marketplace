# Fix the Paystack checkout's email gate and its provider-failure recovery

Status: needs-triage
Type: task
Blocked by: 06
Requested: 28 Oct 2026 (follow-up written by issue 06, Gap M12 and the bounded provider call)
PRD: `../PRD.md`

## Why

Issue 06 holds the thread's run across the Paystack `initialize-checkout` provider call and bounds that await (M13). While
writing those tests, two defects in the checkout path were found that predate issue 06. Neither is fixed there. Both are
recorded here so the owner can decide the order.

## Defect 1: a guest with no email gets ACTION_NOT_AUTHORIZED instead of the email prompt

- The Paystack checkout's resolver run in `apps/web/src/card-payment-actions.ts` (about lines 65-68) calls
  `application.initializeCheckoutFromCommand(envelope!)` and throws when the guest has no email on file. The throw happens
  before `handleEventAsync` reaches the email surface (`apps/local-guest/src/shortlet-app.ts`, about lines 1326-1337, the
  `email address is required` branch). The guest gets `ACTION_NOT_AUTHORIZED` and no email prompt.
- The synchronous `#handleCardCheckout` path asks for the email first. The async Paystack branch does not. The two paths
  disagree.
- Observed by issue 06 tests: the checkout tests save the email through `guestContactApp.submitEmail` before the event, so
  the defect is hidden there.

## Defect 2: after a provider failure the checkout session has no checkoutUrl, and the ready surface is superseded

- A provider failure (or the bounded timeout that issue 06 adds, which returns the same closed refusal) leaves the initiated
  checkout session with no `checkoutUrl`.
- The payment surface that offered the checkout is superseded, so the same event returns `STALE_SURFACE`.
- Not verified: whether the continue route (`/payments/offers/:offerId/continue`) recovers a checkout whose provider call
  failed, or whether the guest is left with no way to pay until a new offer is accepted. Verify this on a cold restore before
  choosing a fix.

## What to build

- Defect 1: make the Paystack path ask for the email as `#handleCardCheckout` does, with the same surface, so the guest is
  prompted rather than refused. Fail closed when the email is still missing after the prompt.
- Defect 2: decide the recovery. Either the continue route re-initializes a checkout that has no `checkoutUrl`, or the
  failed session is closed and the ready surface is restored. Whichever is chosen, a provider failure must not leave a
  session that nothing can finish.

## Acceptance criteria

- A guest with no email who starts Paystack checkout is shown the email prompt, not `ACTION_NOT_AUTHORIZED`, and a saved email
  lets the checkout continue to the provider.
- After a provider failure (a rejected call or the bounded timeout), the guest can reach a working checkout, or sees a closed
  refusal with a path forward. Tests run with the assistant enabled, a cold restore before each event, and the staging-like
  clock (27 Oct 2026).
- The checkout tests in `test/assistant-thread-lock.test.ts` keep passing, and the email test does not save the email in
  advance.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0087, 0088 | Paystack is the pilot card provider; card and transfer offers go through it | The checkout path and its recovery |
| 0089 | Guest payments and the owner amount | The checkout amount on the continue route |
| 0106 | Closed control outcomes; no invented outcome; fail closed | Any refusal code used for the email gate or the failed session (reuse existing codes) |

## Notes for the owner

- The bounded provider call (issue 06, M13) uses the constant `PAYSTACK_CHECKOUT_PROVIDER_TIMEOUT_MS` in
  `apps/local-guest/src/shortlet-app.ts`. Its value (20 s) is an engineering setting to confirm.
- Staging payments are real Paystack test mode. The owner pays with the published test card. Stop before card entry (AGENTS.md).
