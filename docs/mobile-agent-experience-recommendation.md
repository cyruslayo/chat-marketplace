# Mobile agent experience recommendation

Advisory, 5 September 2026. Based on repository source and ADRs, not a live usability audit. No application implementation or policy change is proposed by this document itself.

## Product direction

Use a stable mobile application shell with conversation and one active task workspace. Weaver renders the workspace from approved A2UI components. On mobile, complex tasks occupy a full-screen route; desktop can show conversation and workspace side by side. “Canvas” means this bounded DOM workspace, not an infinite board or an HTML canvas implementation.

Keep Discover, My stays, and Help directly reachable. An authenticated booking detail must remain accessible independently of its originating conversation. Preserve drafts, selection, scroll and focus across view changes; revalidate authoritative facts and action eligibility when returning.

The existing `apps/local-guest/src/conversational-shell.ts` already defines text, inline-surface and focused-surface modes and one active surface. The current HTML in `guest-server.ts` renders focused mode as a tall workspace beneath the transcript, rather than a dedicated mobile route. Evolve this shell before considering a framework migration.

## Suggested guest journey

1. Guest states location, dates, party and budget. Show editable structured criteria. Resolve whether a budget means stay cost or total cash requirement; never silently substitute demo dates in production.
2. Show a small shortlist with photographs, all-in stay total, separately disclosed applicable deposit, neighbourhood, specific verification evidence and relevant fit explanations. Expose unknown facts clearly.
3. Open details or a two-option comparison in the focused workspace. On narrow screens align comparison attributes vertically; avoid a wide spreadsheet. Allow typed refinements without losing the selection.
4. Prepare the request and show exact effects before submission. Present required verification and attestations through approved secure flows.
5. Show durable stages: request submitted, awaiting operator, offer ready, payment processing, confirmed, or the actual failure/expiry state. These are illustrative labels that must map to domain projections, not a replacement state machine.
6. Payment uses the supported secure provider surface. Returning from checkout triggers authoritative status retrieval. Never infer confirmation from a redirect, a screenshot, or an agent message.
7. My stays exposes next steps, permitted access information and help. Human takeover has an explicit ownership indicator and suppresses autonomous agent actions.

## Architectural constraints governing the recommendation

| ADR | Constraint | UX or architecture consequence |
| --- | --- | --- |
| 0004, 0081 | Backend owns state; Weaver is replaceable presentation | Domain projections feed InteractionArtifact, which feeds validated A2UI and conventional pages |
| 0005 | Request to Book; operator confirmation precedes payment and verified payment precedes reservation | Distinguish open dates, request, conditional offer and confirmed stay |
| 0011, 0013 | Verified primary guest and payer requirements | Secure verification and explicit attestations; no model-inferred consent |
| 0015, 0016 | All-in pricing; deposit separate and capability gated | Consistent totals and deposits only when applicable and enabled |
| 0044–0046, 0049 | Bounded payment windows, one live attempt, late refunds, hosted card checkout | Server-derived deadlines, guarded retries, accurate reconciliation and refund status |
| 0066, 0067 | Specific trust claims, location disclosure controls, bounded channels | Obscured pre-booking map, appropriate deep links and reachable support |
| 0070–0072 | Separate identities, redacted projections, backend command authority | Reauthorize, version-check, deduplicate and confirm exact effects |
| 0073 as modified by 0081 | Basic Catalog first; custom catalogues need insufficiency evidence | Start with current catalogue; test richer controls before proposing additions |
| 0074, 0075 | Fail-closed lifecycle and untrusted interaction content | Disable stale actions, preserve safe text, prohibit executable generated content |
| 0076 | Explicit human takeover | Show ownership; no autonomous messaging or mutation while human-owned |
| 0077, 0078 | Canonical meaning across channels; accessible Nigerian launch | en-NG, NGN, WAT deadlines, stable focus, 320px reflow, 44px practical targets |
| 0079 as modified by 0081 | Host owns replay and durable recovery | Browser reconnect restores state; it does not restart consequential work |
| 0080 as modified by 0081 | Conventional parity for material and recovery workflows | Search, contracting, payment, booking management and help survive agent outage |

These recommendations preserve the listed constraints. Any future implementation must independently complete the repository's ADR mapping, acceptance tests and Definition of Done.

## Dynamic rendering and task execution

The inspected assistant currently selects tools and explicitly does not generate raw A2UI; application adapters produce it. Retain that division for material workflows. Extend dynamic behavior first through bounded presentation choices: shortlist, comparison, detail, clarification, review and status. If agent-authored compositions are added later, validate catalogue/schema, semantic disclosures, resource policies and action authority before mounting.

The agent can search, compare, explain, prepare drafts and retrieve status. Material actions require explicit confirmation and platform commands; final risk, identity, safety and exceptional remedy decisions remain with authorized services or humans. Represent task progress as committed facts and next steps, never hidden reasoning.

Run durable waiting, reminders and reconciliation on the backend. Closing the browser must not end the booking workflow; stopping generation must not imply cancellation of an already committed command.

## Delivery priorities

1. Prototype the complete mobile journey with the existing Weaver integration: discovery, comparison, request review, operator wait, payment return and My stays.
2. Exercise browser Back, refresh, keyboard-open layouts, 320px width, focus restoration, network loss, stale quote, duplicate confirmation and human takeover. Include iPhone Safari and lower-end Android devices.
3. Establish authenticated durable recovery and deterministic route parity before adding installation prompts, push or voice.
4. Measure task completion, price/status comprehension, recovery success and support reachability. Then document any Basic Catalog limitations with observed examples before extending it.

## Source notes

- [A2UI overview](https://a2ui.org/introduction/what-is-a2ui/) describes declarative client-rendered components and separation of presentation and state.
- [A2UI catalogues](https://a2ui.org/concepts/catalogs/) describes schema-bound component definitions. Repository ADR-0081 governs local catalogue adoption.
- [MDN canvas](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas) explains that drawn content does not expose semantic HTML accessibility information; retain DOM controls for booking.
- [Web rendering guidance](https://web.dev/articles/rendering-on-the-web) explains server-rendering and client JavaScript tradeoffs; favor early usable HTML and bounded client rendering.
- [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) documents background-tab behavior; browser timers must not own contractual deadlines.

Companion research: `docs/research/mobile-agent-web-technologies-2026.md`.
