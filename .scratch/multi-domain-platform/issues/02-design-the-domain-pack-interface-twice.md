# Design it twice: walk shortlet and commerce flows through DomainPack and ActionSpec

Status: resolved
Type: research
Blocked by: 01
Requested: 14 Oct 2026
Unlocks: 07, 11
Lane: A: Decisions
PRD: `../PRD.md`

## Why

Ousterhout's 'design it twice': an interface shaped by one user is special-purpose. Walk both real domains through the sketch in the PRD before code depends on it.

## What to build

1. Take two shortlet flows (request-to-book → offer → card payment; check-in support → human handoff) and two commerce flows (search → store cart → checkout; order tracking) and express each as `DomainPack` tools, surfaces and `ActionSpec`s.
2. Read the 15 `apps/web/src/*-actions.ts` files and list every check the action gate performs; confirm `ActionSpec` can express each one (context keys, optional fields, stale rules, authorization).
3. Write two alternative interface shapes (e.g. declarative `ActionSpec` vs. a per-pack `handleAction` function) and compare depth: interface size vs. hidden work.
4. Write the chosen interface as a TypeScript sketch in `## Answer` (not in `src/`).

## Out of scope

- Implementation. Changing any `src/` file.

## Acceptance criteria

- AC1: `## Answer` maps all four flows onto the chosen interface with no escape hatch.
- AC2: `## Answer` lists every gate check found in the 15 `*-actions.ts` files and how `ActionSpec` expresses it.
- AC3: Both alternatives are compared and the choice is justified in terms of interface size vs. hidden functionality.
- AC4: Open questions (e.g. one Product shared across stores or not) are listed for the owner.

## Tests

None (design).

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | Every action still becomes a platform command. |
| `docs/adr/0074-give-generative-surfaces-a-fail-closed-lifecycle.md` | Stale and expired surfaces must fail closed in the shared gate. |
| `docs/adr/0080-retain-deterministic-parity-for-critical-workflows.md` | Packs must support the deterministic concierge path too. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Research/design slice. DoD items 3 and 5 apply. No production code changes; the evidence and conclusions go in `## Answer`.

## Answer

### Method and evidence

Read for this answer: all 15 `apps/web/src/*-actions.ts`; the artifact builders (`card-payment-artifact.ts`, `conditional-offer-artifact.ts`); the assistant tool loop (`assistant-model.ts`, `assistant-tools.ts`, `assistant-state.ts`); the platform primitives a gate must call (`envelope.ts`, `thread.ts`, `interaction-security.ts`, `surface.ts`, `human-handoff.ts`, `CONTEXT.md`); and ADRs 0072, 0074, 0080, 0099. The gate is currently implemented 15 times, once per `*-actions.ts`, and its stale/context copies spread to the 22 files the PRD counts.

### Part 1 — the four flows on the DomainPack interface (AC1)

Each flow is expressed as pack-declared **tools** (read/proposal, run by `DomainPack.agent.execute`), **surfaces** (catalogue-validated presentations), and **ActionSpecs** (consequential actions the platform gate executes). No step needs an escape hatch: every consequential step is an `ActionSpec.run` that calls the *same* application command the deterministic route calls (ADR 0080), and every agent step that would change state only ever yields a proposal, never a mutation.

**S1 — Shortlet: request-to-book → offer → card payment.**
- Tools: `search_stays`, `get_unit_details`, `compare_stays`, `explain_stay_price`, `prepare_request_draft` (proposal), `propose_request_to_book` (proposal), `get_offer_status`, `propose_accept_offer` (proposal), `propose_start_payment` (proposal).
- Surfaces: `shortlet-discovery/v1` (results), `shortlet-booking/v1` (request draft, conditional offer, payment ticket).
- ActionSpecs: `shortlet.booking-request.confirm` / `.decline` on the `shortlet.booking-request` artifact; `shortlet.conditional-offer.accept` on `shortlet.conditional-booking-offer` (carries the server-issued `confirmationToken`); `shortlet.card-payment.initialize-checkout` / `.verify-return` on `shortlet.card-payment`.
- The tools only *propose* (`PendingAssistantAction`); the guest's confirmation dispatches the ActionSpec, which builds the envelope and runs `BookingRequestApplication.confirm`, `ConditionalOfferApplication.accept`, `CardPaymentApplication.initializeCheckout` — the same commands the conventional pages use.

**S2 — Shortlet: check-in support → human handoff.**
- Tools: a check-in status read, plus `request_human_support`, `report_access_problem`.
- Surfaces: `shortlet-incident/v1` (check-in support card); the handoff state surface.
- ActionSpecs: `shortlet.check-in.confirm-access` / `.request-support` / `.report-problem` on `shortlet.check-in-support`; and `platform.handoff.request-human` / `.stop-current-run` on the handoff artifact. Handoff is platform-owned (ADR 0099), so its ActionSpec lives in the platform pack while its surface appears inside the shortlet task — the domain supplies the check-in specs, the platform supplies the handoff spec.

**C1 — Commerce: search → store cart → checkout.**
- Tools: `commerce.search`, `commerce.get_offer`, `commerce.add_to_cart`, `commerce.view_cart`, `commerce.checkout` (proposal).
- Surfaces: `commerce-discovery/v1`, `commerce-cart/v1`.
- ActionSpecs: `commerce.cart.add`, `commerce.cart.update`, `commerce.checkout.start` on `commerce.cart` / `commerce.checkout`, producing one Merchant Order per store cart; payment is then a platform Payments ActionSpec shared with shortlet (card/transfer), not a commerce-owned one (ADR 0099 rule 5, slice 04/22).

**C2 — Commerce: order tracking.**
- Tools: `commerce.get_order_status`.
- Surfaces: `commerce-order/v1` (order + fulfilment timeline).
- ActionSpecs: none required for the read path; an in-policy `commerce.order.cancel` would be a domain ActionSpec. Tracking is a projection, so `DomainPack.surfaces.project` is the whole mechanism.

### Part 2 — every gate check in the 15 `*-actions.ts` files (AC2)

The 15 resolvers perform the same checks in the same order. Each becomes one part of `ActionSpec` (G-numbers are the gate steps):

| # | Check (present in current code) | Rejection code today | How `ActionSpec` expresses it |
| --- | --- | --- | --- |
| G1 | Action name is in the module's known-event set | `UNSUPPORTED_ACTION` | The platform routes by `ActionSpec.name`; unknown names never reach a spec |
| G2 | Context is a non-null object, not an array | `INVALID_CONTEXT` | Gate parses `ActionSpec.context` from the raw event |
| G3 | Exact key set — no unknown keys; required present; permitted optionals typed | `INVALID_CONTEXT` | `ActionSpec.context { required, optional, strict: true }` |
| G4 | Field types/enums/ranges — non-empty string, integer ≥ 1, `"automated"`, `"confirmed"`, `"issued"`, purpose `stay`/`security_deposit`, `requestedTime` matches `^(12\|13\|14):00$` | `INVALID_CONTEXT` | `FieldSpec { type, nonEmpty, min, enum, pattern }` |
| G5 | Authoritative artifact fetch succeeds (wrapped in try/catch) | `INVALID_ARTIFACT`, sometimes `ACTION_NOT_AUTHORIZED` | `ActionSpec.artifact.load(ref, viewer)`; a throw becomes `INVALID_ARTIFACT` |
| G6 | Artifact `kind` + `schemaVersion` valid, and derived id well-formed (`<prefix>:<factId>`, integer projectionVersion) | `INVALID_ARTIFACT` | `ActionSpec.artifact.kind` / `.schemaVersion` / `.id(facts)` |
| G7 | `context.artifactId === artifact.id` | `ARTIFACT_MISMATCH` | Gate compares parsed `context.artifactId` to `artifact.id(facts)` |
| G8 | Context entity ids match artifact facts (`offerId`, `requestId`, `claimId`, `reservationId`, `contractId`, `threadId`) | `*_MISMATCH` (`REQUEST_MISMATCH`, `OFFER_MISMATCH`) | `ActionSpec.crossMatch(ctx, facts) → boolean` |
| G9 | Staleness consensus — expected status plus every version (offer/contract/incident/policy/economics/arrival/evidence/assessment/cure) and `projectionVersion` equal the artifact's current values | `STALE_ACTION` | `ActionSpec.isStale(artifact, ctx) → boolean` |
| G10 | Advertised-action authorization — `artifact.actions` contains the action, with matching sub-id (`requestId`, `candidateId`, `decisionVersion`, `requestedTime`, `capabilityId`) and the viewer's role/tenant | `ACTION_NOT_AUTHORIZED` | `ActionSpec.isAuthorized(artifact, ctx, principal) → boolean` |
| G11 | Confirmation token equals the advertised token, and is single-use (no replay) | `ACTION_NOT_AUTHORIZED` | `ActionSpec.confirmation { required, tokenOf(artifact) }`; the gate consumes it via `InteractionSecurityEngine`/thread lease |
| G12 | Safe effect target — the conventional route is validated (`isSafeConventionalRoute`) | `INVALID_ROUTE` | `ActionSpec.effect?(artifact, ctx)` validated by the gate |
| G13 | Execute the domain command, preserve a thrown `STALE_ACTION`, build envelope (`idempotencyKey`, `expectedVersion`), audit, return refreshed projection | `STALE_ACTION` / `ACTION_NOT_AUTHORIZED` | `ActionSpec.run(command, ctx)`; the gate builds the envelope and calls `project()` for the refresh |
| G14 | Fixed rejection vocabulary (`UNSUPPORTED_ACTION`, `INVALID_CONTEXT`, `INVALID_ARTIFACT`, `ARTIFACT_MISMATCH`, `*_MISMATCH`, `STALE_ACTION`, `ACTION_NOT_AUTHORIZED`, `INVALID_ROUTE`) | — | Gate-owned union; specs return domain results, the gate maps them to codes |

Cross-cutting checks stay in the platform and run before any spec: authentication/session, tenant scope, CSRF, confirmation-token replay (`InteractionSecurityEngine.validateSecurityContext`), plus the URL allow-list, upload and provider-signature checks that already live there. No spec re-implements them.

### Part 3 — two interface shapes, compared for depth (AC3)

**Alternative A — declarative `ActionSpec` (data).** Each pack declares an array of specs; one platform gate reads the spec and performs G1–G14 generically. The domain-specific parts are small pure functions (which artifact, its identity, cross-match, staleness, authorization, optional effect, and `run`).

**Alternative B — per-pack `handleAction(event, ctx)` (behaviour).** The platform interface is a single method the pack implements, and the pack owns the entire gate for each of its actions.

| Dimension | A: declarative `ActionSpec` | B: per-pack `handleAction` |
| --- | --- | --- |
| Interface size | ~9 small fields/methods per action | 1 method per pack |
| Hidden work | The gate exists once, in the platform | The whole gate re-implemented per pack (today: 15 copies, 22 files with a stale/context copy) |
| Security-rule copies | 1 | N (one per action) |
| Deterministic parity | `run` is the same command as the conventional route | Pack must remember to reuse it |
| Failure modes | Uniform codes; impossible to skip a check | Each pack can omit or reorder a check |
| Depth (Ousterhout) | Slightly larger interface, much smaller hidden complexity | Tiny interface, large hidden complexity that cannot be removed |

**Choice: A.** B's tiny interface is the shallow-module trap the PRD names (Diagnosis 3): it hides the gate *inside every pack*, so the security rule (ADR 0072/0074) is duplicated and can silently drift. A pulls the gate down into the platform once. The extra interface surface (a handful of small fields) is cheap and declarative, and the shared gate is exactly the "Interactions" module in the PRD target design. This is what ADR 0099 rule 3 requires.

### Part 4 — the chosen interface as a TypeScript sketch

Sketch only; it lives here, not in `src/`. Slice 07 implements it.

```ts
interface DomainPack {
  id: string;                                   // "shortlet" | "commerce"
  catalogues: CatalogueDefinition[];            // ADR 0073
  migrations: Migration[];                      // on SqlDatabase
  agent: {
    promptSection: string;
    tools(task: TaskState): ToolDefinition[];
    execute(call: ToolCall, ctx: DomainContext): Promise<ToolResult>;
  };
  surfaces: {
    project(task: TaskRef, viewer: Principal, clock: Clock): Presentation;
  };
  actions: ActionSpec[];
  routes?: RouteModule;
  onEvent?(event: PlatformEvent): void;
}

interface ActionSpec<Ctx = unknown, Facts = unknown, Cmd = unknown> {
  readonly name: string;                        // G1, e.g. "shortlet.conditional-offer.accept"
  readonly artifact: {                          // G5–G7
    readonly kind: string;
    readonly schemaVersion: string;
    readonly load: (ref: string, viewer: Principal) => Artifact<Facts>;
    readonly id: (facts: Facts) => string;      // e.g. `card-payment:${facts.offerId}`
  };
  readonly context: ContextSchema;              // G2–G4
  readonly crossMatch?: (ctx: Ctx, facts: Facts) => boolean;                    // G8
  readonly isStale: (artifact: Artifact<Facts>, ctx: Ctx) => boolean;           // G9
  readonly isAuthorized: (artifact: Artifact<Facts>, ctx: Ctx, principal: Principal) => boolean; // G10
  readonly confirmation?: { readonly required: boolean; readonly tokenOf: (artifact: Artifact<Facts>) => string }; // G11
  readonly effect?: (artifact: Artifact<Facts>, ctx: Ctx) => Effect;            // G12
  readonly run: (command: PlatformCommand<Cmd>, ctx: DomainContext) => Promise<ActionResult>; // G13
}

interface ContextSchema {
  readonly required: Readonly<Record<string, FieldSpec>>;
  readonly optional?: Readonly<Record<string, FieldSpec>>;
  readonly strict: true;                        // no unknown keys (G3)
}
interface FieldSpec {
  readonly type: "string" | "integer" | "boolean";
  readonly nonEmpty?: boolean;
  readonly min?: number;
  readonly enum?: readonly string[];            // "automated" | "confirmed" | "issued" | "stay" | ...
  readonly pattern?: string;                    // e.g. "^(12|13|14):00$"
}
```

The platform gate (the PRD's "Interactions") does G1–G14 in order for every spec, so a pack cannot reorder or omit a check, and the rejection vocabulary is uniform.

### Part 5 — open questions for the owner (AC4)

1. **Product identity (from the PRD):** one shared `Product` across stores, or one offer per product at MVP? The commerce catalogue model (slice 19) depends on this.
2. **Where the handoff ActionSpecs live:** platform pack (the pack every domain references for `platform.handoff.*`) or duplicated per domain? `human-handoff.ts` already holds the platform manager; the specs may belong beside it.
3. **Platform-common surfaces.** The PRD names shared surfaces (payment step, status timeline, handoff, confirmation). Do they get their own platform `ActionSpec`/catalogue set the domain packs reference, or does each pack re-declare them?
4. **Confirmation tokens — unify?** `ConditionalOffer` mints its own `confirmationToken`, while `InteractionThreadManager` issues confirmation leases. Should the gate own one token mechanism for all consequential specs?
5. **`projectionVersion` ownership.** Artifacts derive `projectionVersion` ad hoc (`card-payment` hardcodes 1/2/3/6; `conditional-offer` computes `offerVersion*10 + phase`). Should the platform own monotonic projection-version derivation so staleness (G9) is uniform?
6. **Catalogue-name drift.** `surface.ts` hardcodes `common/v1`, `discovery/v1`, `booking/v1`, `incident/v1`, `operator/v1`, while ADR 0073 and the PRD name `platform-common/v1`, `shortlet-discovery/v1`, `shortlet-booking/v1`, `shortlet-incident/v1`, `shortlet-operator/v1`. Which naming wins before the registry is built (slice 11)?
7. **`ToolState` vs `TaskState`.** `assistantToolsForState` gates tools by stay state (`shortlist`, `currentOfferId`). The pack interface takes a `TaskState` (PRD chat model). Confirm the task-type vocabulary ("find_stay", "book_stay", "manage_booking") generalizes to shop ("browse", "store_cart", "checkout", "track").

### ADR compliance (DoD item 3)

- **ADR 0072** — every consequential flow above resolves to one platform command envelope via `ActionSpec.run`; no spec mutates state directly.
- **ADR 0074** — G9/G11 keep stale or expired surfaces fail-closed; `GenerativeSurfaceManager` already turns a non-active surface into a refused action.
- **ADR 0080** — each `ActionSpec.run` is the same application command the deterministic route uses, so there is no agent-only transition.
- **ADR 0099** — one façade per domain, one action gate, platform owns the gate/payments/accounts/handoff, packs declare tools/surfaces/actions/routes/migrations.

## Comments

- 14 Oct 2026 (agent): Resolved with the design in `## Answer`. Chose the declarative `ActionSpec` over a per-pack `handleAction`; the chosen interface is sketched above. Seven open questions for the owner are listed in Part 5 (Product identity, handoff spec location, platform-common surfaces, confirmation-token ownership, `projectionVersion` ownership, catalogue-name drift, task-state vocabulary). No `src/` files were changed. Unblocks slices 07 and 11.
