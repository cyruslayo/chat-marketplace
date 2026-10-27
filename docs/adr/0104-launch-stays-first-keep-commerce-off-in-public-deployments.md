---
status: accepted
---

# Launch stays first; keep commerce off in public deployments

**Superseded in part by 0105 (demo only).** The proposed restriction on public exposure of the development demo has a staging-only exception. The commerce restriction remains unchanged.

## Context

On 20 Oct 2026 the owner chose to launch stays only and defer public commerce. ADR 0003 establishes shortlet as the first reference domain. ADR 0100 admits commerce as the second domain pack and describes its future front doors; it does not require commerce to launch before its payment and guest-experience gates pass.

Commerce checkout is blocked on provider/legal decisions (multi-domain slice 04) and payment implementation (22). Slice 26's task rail and starters are implemented but unresolved. The synthetic commerce-on walkthrough in issue 31 records blocking chat UX defects, including stale checkout actions after a task switch (ADR 0074). CommerceMarket has no public Worker route, and ShortletPilot already composes commerce as disabled.

**Accepted by the owner on 25 Oct 2026, in chat.** The owner extended this ADR to every environment: local development, Cloudflare development, staging and production. Commerce is controlled by one switch, `COMMERCE_ENABLED` (decision 5). Commerce is parked, not cancelled. This acceptance does not reopen commerce; decision 3 still governs any enablement.

## Decision

1. **Launch stays only. Keep commerce off in every public deployment**, including Node production/staging pilot hosts and Cloudflare. The public `/welcome` page is a stays page, with no Shop section.
2. **Park, do not cancel, slices 04, 22, 26, 29 and 31.** Preserve their recorded statuses, dependencies, implementation and history. An otherwise unblocked ticket is not permission to start parked work. Issue 31 is not started by this decision.
3. **Public commerce may be enabled only after the owner explicitly reopens it and all these prerequisites hold:**
   - Slice **04**'s commerce payments ADR is accepted by the owner, with its required provider confirmation, legal review and named commission-policy source.
   - Slice **22** (commerce checkout through platform Payments) is resolved.
   - Slice **26** (task rail and vertical starters) is resolved.
   - Issue **31**'s blocker items 1–5 are fixed and verified.
   - A tested **public Worker route to CommerceMarket** exists, preserving the separate domain authorities in ADR 0101. Routes and the commerce assistant pack must be composed together; enabling store routes alone is not a working Shop experience.
4. **The local demo `apps/local-guest/src/cli-start.ts` may keep commerce on for development.** This exception does not apply to either Node pilot host or a public deployment, and grants no permission to expose the development demo publicly. Decision 5 now governs how commerce is switched on for development: it is on only when `COMMERCE_ENABLED=true`.
5. **One switch, every environment (owner decision, 25 Oct 2026).**
   - `COMMERCE_ENABLED` is the single switch for the commerce domain in local development, Cloudflare development, staging and production.
   - Unset, empty or `false` means off. Exactly `true` means on. Any other value stops startup with an error that names the variable.
   - The default is off.
   - The commerce HMAC key pair (`COMMERCE_REFERENCE_HMAC_KEY` and `COMMERCE_REFERENCE_HMAC_KEY_ID`, ADR 0075) is required only when commerce is on.
   - Domain code (`domains/commerce`) and the Cloudflare CommerceMarket Durable Object class are kept. Commerce is parked, not cancelled.
   - Turning the switch on in a public deployment remains subject to decision 3.

### Amendment (26 Oct 2026): where the switch parser lives

Decision 5 is unchanged. This amendment fixes only where its one parser (`commerceEnabledFromEnv`, with `COMMERCE_ENABLED_VARIABLE`) is kept.

6. **The parser lives in `packages/commerce-switch/src/commerce-switch.ts`, outside `domains/commerce`.** Reasons:
   - Shortlet and apartment code read the switch, and shortlet never imports commerce (ADR 0099 and ADR 0100 decision 1). Keeping the parser in the commerce domain made every host that reads the flag depend on the domain, and `test/domain-boundary.test.ts` AC4 then failed for five files that deep-import it.
   - The owner has decided that commerce will not ship. Apartment code must therefore read the flag without importing the commerce domain at all. Decision 2 ("parked, not cancelled") is not reworded here; the owner should confirm whether that wording still holds.
   - The Cloudflare config loader is plain Node ESM with an exact-specifier rule and no `.js` to `.ts` mapping. `apps/cloudflare/cloudflare.config.ts` names the parser by its real `.ts` path, and `test/cloudflare-config.test.ts` checks that the file is in the config's import graph.
   - The parser is dependency-free. It imports nothing from `apps/` or `domains/`, and `test/commerce-switch-placement.test.ts` enforces that.
   - The commerce object still reads the same parser, so the switch is one implementation, with its behaviour unchanged. The commerce object's own runtime closure does not reach `domains/commerce/src/commerce-switch.ts`, because that file no longer exists.

Decision 5 still stands for every environment. The move changes no behaviour and no environment's default.

### Amendment (26 Oct 2026): decision 6 extended to commerce injection

Decision 6's placement stands. This amendment adds how the commerce domain is composed, so that an apartment host's closure stays free of `domains/commerce`:

- **Injection, default none.** `apps/local-guest/src/guest-server.ts` takes the commerce domain by injection (`commerceModule`, typed by the neutral port in `apps/local-guest/src/commerce-port.ts`). It no longer imports `domains/commerce`, its route module, or its reference-key reader. Its default is no module.
- **Fail closed.** With the composition "local" (the switch is on, `COMMERCE_ENABLED=true`) and no module injected, the guest server refuses to start, with an error that names `COMMERCE_ENABLED` and echoes no value. The switch is never silently treated as off. An invalid switch value still throws as before. The composition "disabled" wins over the switch and ignores any module.
- **What composition roots inject.** Only a composition root that ships commerce injects the module. Today that is the local dev demo, `apps/local-guest/src/cli-start.ts`, which injects `LOCAL_COMMERCE_MODULE` from `apps/local-guest/src/commerce-module-local.ts` (decision 4). The Shortlet Worker (`apps/cloudflare/src/shortlet-pilot-do.ts`), both Node pilot hosts (`apps/pilot/src/pilot-server.ts`, `apps/pilot/src/local-pilot-server.ts`) and the browser client inject nothing and pass composition "disabled".
- **Enforcement.** `test/apartment-commerce-free-closure.test.ts` checks the runtime-and-type import closure (ADR 0099 and 0100 decision 1) of the Shortlet Worker object, the guest server and both Node pilot hosts for `domains/commerce` files. The dev demo may reach `domains/commerce` only through `commerce-*` composition files. The Worker's `CommerceMarket` re-export is the documented exception in ADR 0101, so the Worker's closure still contains commerce.

Decision 5 still stands for every environment.

## Consequences

- [Pilot readiness 27](../../.scratch/pilot-launch-readiness/issues/27-disable-commerce-on-node-pilot-hosts.md) is the Node composition change. No domain pack, transaction model or shared platform interface changes (ADR 0099).
- [Multi-domain 30](../../.scratch/multi-domain-platform/issues/30-defer-commerce-until-stays-launch.md) records deferral; [issue 31](../../.scratch/multi-domain-platform/issues/31-commerce-on-chat-ux-fixes.md) retains the synthetic walkthrough evidence. The [landing port](../../.scratch/landing-page/issues/11-port-landing-onto-main.md) implements the stays-only public page separately.
- This defers ADR 0100's public commerce front doors, not removing commerce as a domain pack. Commerce is off by default in every environment and is enabled only by `COMMERCE_ENABLED=true`. Its Merchant verification and domain-separation requirements remain unchanged.
- ADR 0002's historical commerce-payment conditions still require revalidation through slice 04; no split structure, commission rate or payment method is newly approved here.
- ADRs 0004, 0067, 0074, 0075, 0095 and 0101 remain in force: backend authority, bounded shortlet channels, fail-closed surfaces, minimization, hosting/data-protection gates and separate domain objects. This ADR authorizes no deployment, real-person data processing or public commerce route.

## Related

ADRs 0002, 0003, 0004, 0067, 0074, 0075, 0095, 0099, 0100 and 0101; multi-domain platform map and issue 30; pilot launch readiness issue 27; landing issues 11–15.
