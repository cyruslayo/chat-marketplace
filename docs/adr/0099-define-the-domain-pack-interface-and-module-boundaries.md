---
status: accepted
---

# Define the domain-pack interface and module boundaries

## Context

ADR 0003 decided that the product would be a domain-extensible Concierge Platform, delivered through shortlets as its first reference domain, with marketplace commerce, appointments and future businesses keeping separate domain packs and business language. It named the intent but not the seam, so nothing today constrains where a domain's code may be reached from.

Measured on `main` at 9a24178 (PRD, Diagnosis 1–7):

- `domains/shortlet` exposes 798 exports from a `src/index.ts` of `export *` lines, and 41 internal modules are imported directly past that index by 74 non-test files in `apps/`.
- 19 `*Application` classes in `apps/web/src` wrap managers; 17 expose a `readonly manager`, and there are 112 `.manager.` reach-throughs in `apps/`.
- The action gate (context allow-list, artifact kind/version, stale projection, authorization, rejection codes) is rewritten across 22 files; `contextOf` alone is copied 8 times.
- One workflow is split by layer, not knowledge, across the domain file, `*-application`, `*-actions`, `*-artifact`, `web-agent/*-a2ui`, `*-presentation`, `guest-server.ts` and `client.ts`.
- `apps/local-guest/src/guest-server.ts` is 9,601 lines.
- General-purpose modules hold shortlet specifics (`surface.ts` hardcodes `APPROVED_CATALOGUES`; `human-handoff.ts` knows `activeStay` and `bookingId`), and platform services (Paystack, guest accounts, manual transfer, receipts) live inside the domain.

A second domain (commerce) is now being added. Without a defined seam, every new vertical copies this structure, and the platform cannot host it without editing platform code.

## Decision

The Concierge Platform and its domain packs are separated by one interface, and by one set of module boundaries that a test can check.

1. **One public façade per domain.** A domain exposes exactly one module, `domains/<domain>/src/index.ts`. No file outside the domain imports any path past that index. A boundary test enforces the rule. The modules that violate it today are recorded on a temporary allow-list; the allow-list must reach zero.

2. **The platform owns the shared services.** The platform owns Conversation (threads and tasks, and the router), the Agent (model clients, tool loop, budget, and which pack's tools are exposed), Interactions (the one action gate), Surfaces (registry-fed catalogues and renderers), Payments, Accounts, Handoff, Audit, Telemetry, Redaction, and the storage ports (`SqlDatabase`, `BlobStore`). Domains do not own these concerns.

3. **One action gate for every consequential action.** Every consequential action — an agent tool call and the deterministic concierge path alike — passes through the single platform action gate (ADR 0072), which independently enforces authentication, authorization, schema and current-state validation, stale/expired surface handling (ADR 0074), policy, idempotency, concurrency and audit. A pack supplies its action specs to that gate; it does not keep its own gate or its own copy of a gate check.

4. **Packs declare; they do not reach in.** A pack declares its prompt section, its tools, its surfaces, its action specs, its routes, its migrations, and an event hook. The platform consumes those declarations through the interface. A pack never imports platform internals, and no pack imports another pack. Domains share infrastructure only; neither domain imports or generalizes the other's transactional model (`CONTEXT-MAP.md`).

5. **The domain owns its transaction model, its ledger and its identity assurance.** Transaction models, ledgers and identity assurance (for example Smile ID, ADR 0084/0094) stay with the domain. No shared transaction model is introduced across domains. A domain ledger reacts to platform payment events; the platform does not own domain ledgers.

6. **Hosts are composition roots only.** A host (`apps/cloudflare`, the Node pilot, and the later MCP server) registers packs and composes their route modules. It holds no business rules of its own.

7. **The interface is designed against exactly two packs.** The interface is shaped by walking both the shortlet and the commerce flows through it, per ADR 0003's condition that the abstractions must survive at least one second domain. Shipping the internal SDK outside this repository remains out of scope.

The concrete TypeScript shape of the interface is fixed by the design-it-twice slice (map slice 02). This ADR fixes the rules that shape must satisfy.

## Consequences

- The seam is now a checkable rule: "nothing imports past `domains/*/src/index`", "`.manager.` reach-throughs in `apps/` are zero", "one action-gate implementation", "`guest-server.ts` is a shell". The map tracks each as a metric.
- The refactor slices (06–14) deliver the rule: the boundary test and its shrinking allow-list, the Interactions gate and `ActionSpec`, the shortlet façade, registry-fed catalogues, the DomainPack registry, the conversation tasks and router, and the split of `guest-server.ts`.
- ADR 0068's platform-owned adapters and ADR 0073's per-domain catalogues are the extension points packs plug into; this ADR is what keeps a pack from bypassing them.
- ADR 0003's "SDK remains internal until a second domain demonstrates the abstractions survive real transactional use" is exercised by this effort; it is not yet satisfied.

## Related

ADR 0003 (source of the domain-pack intent and the second-domain condition), ADR 0068 (platform-owned adapters), ADR 0072 (consequential actions through platform commands), ADR 0073 (domain-specific A2UI catalogues). PRD and map: `.scratch/multi-domain-platform/`.
