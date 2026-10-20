---
status: proposed
---

# Launch stays first; keep commerce off in public deployments

## Context

On 20 Oct 2026 the owner chose to launch stays only and defer public commerce. ADR 0003 establishes shortlet as the first reference domain. ADR 0100 admits commerce as the second domain pack and describes its future front doors; it does not require commerce to launch before its payment and guest-experience gates pass.

Commerce checkout is blocked on provider/legal decisions (multi-domain slice 04) and payment implementation (22). Slice 26's task rail and starters are implemented but unresolved. The synthetic commerce-on walkthrough in issue 31 records blocking chat UX defects, including stale checkout actions after a task switch (ADR 0074). CommerceMarket has no public Worker route, and ShortletPilot already composes commerce as disabled.

This is a proposed architectural record of the owner's launch decision, not an accepted ADR. Only the owner may accept this ADR; no acceptance or permission to reopen commerce is implied by the documentation task.

## Proposed decision

1. **Launch stays only. Keep commerce off in every public deployment**, including Node production/staging pilot hosts and Cloudflare. The public `/welcome` page is a stays page, with no Shop section.
2. **Park, do not cancel, slices 04, 22, 26, 29 and 31.** Preserve their recorded statuses, dependencies, implementation and history. An otherwise unblocked ticket is not permission to start parked work. Issue 31 is not started by this decision.
3. **Public commerce may be enabled only after the owner explicitly reopens it and all these prerequisites hold:**
   - Slice **04**'s commerce payments ADR is accepted by the owner, with its required provider confirmation, legal review and named commission-policy source.
   - Slice **22** (commerce checkout through platform Payments) is resolved.
   - Slice **26** (task rail and vertical starters) is resolved.
   - Issue **31**'s blocker items 1–5 are fixed and verified.
   - A tested **public Worker route to CommerceMarket** exists, preserving the separate domain authorities in ADR 0101. Routes and the commerce assistant pack must be composed together; enabling store routes alone is not a working Shop experience.
4. **The local demo `apps/local-guest/src/cli-start.ts` may keep commerce on for development.** This exception does not apply to either Node pilot host or a public deployment, and grants no permission to expose the development demo publicly.

## Consequences

- [Pilot readiness 27](../../.scratch/pilot-launch-readiness/issues/27-disable-commerce-on-node-pilot-hosts.md) is the Node composition change. No domain pack, transaction model or shared platform interface changes (ADR 0099).
- [Multi-domain 30](../../.scratch/multi-domain-platform/issues/30-defer-commerce-until-stays-launch.md) records deferral; [issue 31](../../.scratch/multi-domain-platform/issues/31-commerce-on-chat-ux-fixes.md) retains the synthetic walkthrough evidence. The [landing port](../../.scratch/landing-page/issues/11-port-landing-onto-main.md) implements the stays-only public page separately.
- This proposes deferring ADR 0100's public commerce front doors, not removing commerce as an active internal domain. Its Merchant verification and domain-separation requirements remain unchanged.
- ADR 0002's historical commerce-payment conditions still require revalidation through slice 04; no split structure, commission rate or payment method is newly approved here.
- ADRs 0004, 0067, 0074, 0075, 0095 and 0101 remain in force: backend authority, bounded shortlet channels, fail-closed surfaces, minimization, hosting/data-protection gates and separate domain objects. This ADR authorizes no deployment, real-person data processing or public commerce route.

## Related

ADRs 0002, 0003, 0004, 0067, 0074, 0075, 0095, 0099, 0100 and 0101; multi-domain platform map and issue 30; pilot launch readiness issue 27; landing issues 11–15.
