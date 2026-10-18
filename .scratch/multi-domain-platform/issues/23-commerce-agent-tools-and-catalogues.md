# Commerce agent tools, commerce-* catalogues and presentations

Status: resolved
Type: task
Blocked by: 13, 21, weaver-catalogues 03
Requested: 14 Oct 2026
Unlocks: 27, 29
Lane: D: Commerce
PRD: `../PRD.md`

## Why

The concierge must be able to shop.

## What to build

1. Pack tools: `search_products`, `get_offer`, `quote_delivery`, `add_to_store_cart` (read/cart), `propose_checkout` (proposal → platform command), `get_order_status`.
2. Presentations (data only, like `apps/web-agent/src/*-presentation.ts`) and A2UI for `commerce-discovery/v1`, `commerce-cart/v1`, `commerce-order/v1`, registered through slice 11 and built with the catalogue runtime factory from weaver-catalogues 03.
3. Deterministic parity for checkout (ADR 0080).
4. Commerce prompt section; no shortlet vocabulary leaks.

## Out of scope

- Shell task rail (26), store pages (27).

## Acceptance criteria

- AC1: A shopping intent starts a commerce task and only commerce tools are offered.
- AC2: `propose_checkout` never pays without an explicit confirmation command.
- AC3: Commerce surfaces use only registered commerce or common catalogues.
- AC4: The checkout flow has a deterministic path.

## Tests

Scripted-assistant tests through the shared fixture; one per AC.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | Checkout confirmation. |
| `docs/adr/0073-govern-domain-specific-a2ui-catalogues.md` | New catalogues need review. |
| `docs/adr/0080-retain-deterministic-parity-for-critical-workflows.md` | Parity. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

- 18 Oct 2026: checkout confirmation is now represented by a persisted task/tenant/principal-scoped, versioned proposal and the `commerce.checkout.confirm` ActionSpec/PlatformCommandEnvelope. The assistant surface and conventional `confirmCheckoutConventional` entry use the same validator/authorization/revalidation/command handler. With no slice-22 executor configured, an authorized command returns `payment_unavailable`, writes minimal audit evidence and creates no order or payment. Scripted `AssistantRuntime` tests cover AC2–AC4, including unauthorized/stale rejection, retry idempotency and real Weaver catalogue registration/mounting. Validation: `npm run check` and focused commerce test suites.

## Answer

Resolved 18 Oct 2026. Implementation commit `bba2a73` (on top of the earlier issue 23 chain already on the branch) was fast-forwarded into local `main`. Nothing was pushed.

**Evidence**

- Full suite on `bba2a73`: phase 1 1,837/1,837 passed. Browser phase 179 passed, 0 failed, 2 skipped (the task-rail captures, gated by `SHORTLET_TASK_RAIL_BROWSER=1`). Log: `C:\Users\Cyrus\AppData\Local\Temp\opencode\mdp23-bba2a73-full-suite.log`.
- `npm run check`: clean.
- Captures in `screenshots/23-checkout-fix/` at 320, 390, 768 and 1280: discovery, cart, order, checkout proposed, and checkout payment_unavailable. No horizontal overflow. No controls under 44px (ADR 0078).
- Independent review: ACCEPT.

**ADRs read and applied:** 0072 (checkout confirmation through platform commands), 0073 (registered commerce catalogues), 0074 (generative surface lifecycle), 0075 (minimal interaction data, no credentials in audit or logs), 0078 (launch accessibility profile, captures and 44px targets), 0080 (deterministic checkout parity), 0081 (Weaver as the A2UI runtime), 0103 (commerce discovery, cart and order catalogues).

**Acceptance criteria and their tests** (`test/commerce-agent-tools.test.ts`, `test/commerce-surface-references.test.ts`, `test/commerce-surfaces-chromium.test.ts`):

- AC1: "AC1: a shopping intent starts a commerce task and only commerce tools are offered"; "AC1 scripted assistant: shopping intent confirms commerce task and exposes only its six tools".
- AC2: "AC2: propose_checkout never pays without an explicit confirmation command"; "AC2 scripted assistant: proposal requires a separate explicit command and creates no Merchant Order".
- AC3: "AC3: commerce surfaces use only the owner-approved registered commerce catalogues"; "AC3 scripted assistant: discovery, cart and order surfaces all validate and mount in the registered Weaver runtime"; plus the surface-reference tests and the real-Chromium discovery, cart and order test.
- AC4: "AC4: checkout has a deterministic text and typed-surface path with no payment execution"; "AC4 scripted assistant and conventional route use the same authorized, versioned, idempotent platform command"; plus the post-confirm and per-status copy tests.

**Failure paths named in the tests:** proposal and confirmation fail closed for missing, blank, malformed and cross-tenant scope; dangling and doubly-parented surface components are rejected; a stored checkout status with no approved copy is rejected rather than rendered blank. The 18 Oct comment above records unauthorized and stale rejection and retry idempotency.

**Definition of Done**

1. [x] Every acceptance criterion has a dedicated named test whose name mirrors the criterion text (AC1 to AC4 above).
2. [x] The named failure paths are exercised (listed above).
3. [x] Every relevant ADR is listed and read; the constraints are cited above and in the 18 Oct comment.
4. [x] No injected dependency is unused. Checked by the independent review (ACCEPT). Not separately re-verified in this pass.
5. [x] No policy string, rule or constant invented. The one unresolved gap is noted and put to the user: ADR 0103 on replay (known issue b).
6. [x] No bearer credential or restricted identity material in audit records or logs (ADR 0075). Checked by the independent review (ACCEPT). Not separately re-verified in this pass.
7. [x] `npm run check` is clean and `npm test` has zero failures (counts above; the 2 browser skips are opt-in).

**Known issues, not fixed in this slice**

- (a) Pre-existing redaction bug at `packages/platform-core/src/redaction.ts:144`: the Luhn gate runs before the exact-id exemption, so about 1 in 7,000 random `cmd-<uuid>` ids are redacted. It caused one intermittent failure in an earlier run of `test/issue-and-accept-conditional-booking-offer.test.ts`.
- (b) ADR 0103 does not say whether a conventional replay of a confirmed proposal returns the stored result (current behaviour) or a conflict. Awaiting a user decision.
- (c) At 320px the shell task chips break mid-word (pre-existing shell CSS).
