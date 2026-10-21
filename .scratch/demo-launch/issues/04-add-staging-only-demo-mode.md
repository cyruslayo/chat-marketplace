# Add a staging-only demo mode

Status: ready-for-agent
Type: AFK
Blocked by: 01
Requested: 21 Oct 2026

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

A visitor who opens the staging URL today cannot try the product, for three reasons.

- **Invite gate.** Staging requires `SHORTLET_BETA_INVITE_CODE`:
  - the loader throws without it (`apps/pilot/src/pilot-config-core.ts:161`);
  - `apps/cloudflare/cloudflare.config.ts:76-78` reads it;
  - a guest session starts only from `/?invite=<code>`.
- **Demo label off.** The owner-approved label `landingDemo` (`apps/local-guest/src/guest-server.ts:2164`, banner text `LANDING_COPY.demoNotice` in `apps/local-guest/src/landing-copy.ts:23`) is never set by the Durable Object (`apps/cloudflare/src/shortlet-pilot-do.ts:287-312`).
- **No operator to accept.** A request to book waits for an operator. Auto-acceptance exists only in the fixture: `simulateOperatorAcceptance` (`apps/local-guest/src/fixture.ts:680`), called from `assistant-runtime.ts:936`. Production has no auto-accept path.

## What to build

- **The flag.** Add `SHORTLET_DEMO=enabled` as a build-time text binding in `cloudflare.config.ts`. Parse it in `apps/cloudflare/src/cloudflare-config.ts` and in `pilot-config-core.ts`. The loader **refuses** it when the deployment is production (ADR 0105).
- **When the flag is on:**
  - Skip the `SHORTLET_BETA_INVITE_CODE` requirement, and do not gate session start on an invite.
  - Pass `landingDemo: true` to the guest request handler from the Durable Object.
  - Replace the "Beta: test payments only" banner with demo copy from the copy modules (`landing-copy.ts`, and `apps/web-agent/src/guest-content.ts` for chat). The copy says it is a demo, payments are Paystack test mode with the published test card, and visitors should not enter real personal data. Do not inline strings.
  - **Auto-accept** a submitted request through the real operator-accept command path, which goes through the platform command gate (ADR 0072). Use a synthetic demo operator principal. Do not call the fixture-only `simulateOperatorAcceptance`. Make the delay configurable (default 0); no magic number.
  - Show a **"Demo listing" chip** on stay cards and the unit detail. Add it as a kit component in `apps/local-guest/src/guest-kit.ts`, styled in the "Guest UI kit" block of `apps/web/src/shortlet-foundations.css` with semantic tokens only. Chat and the standalone page must render it from the same helper, and the label goes in `GUEST_FACT_LABELS`. Do not reformat the CSS file.
- Follow `.scratch/guest-ui-consistency/` for the UI parts.

## Acceptance criteria

- [ ] AC1: With `SHORTLET_DEMO=enabled` on staging, a guest session starts from `/` and from `/welcome` without an invite code.
- [ ] AC1 failure path: with demo off on staging, a missing invite code is still a startup error, and `/` without `?invite=` still refuses a session.
- [ ] AC2: `SHORTLET_DEMO=enabled` with a production deployment is a startup error in both the Cloudflare and Node config loaders.
- [ ] AC3: In demo mode, `/welcome` and the guest pages show the demo notice and the test-payment copy from the copy modules.
- [ ] AC4: In demo mode, a submitted request is accepted automatically through the operator-accept command, and the guest reaches the offer screen. An audit row records the demo operator.
- [ ] AC4 failure path: with demo off, no request is auto-accepted.
- [ ] AC5: Stay cards and the unit detail show the "Demo listing" chip in chat and on the standalone page, both from the same kit helper. Nothing shows when demo is off.
- [ ] AC6: Screenshots at 320, 390, 768 and 1280, in light and dark, show no horizontal overflow and no controls under 44px (ADR 0078). Save them in `.scratch/demo-launch/screenshots/04/`.
- [ ] AC7: `npm run check`, `npm run test:workers` and `npm test` pass.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0105 | Demo is staging-only and refused in production | AC2 |
| 0104 | No public development demo | Superseded in part by 0105 (AC1) |
| 0072 | Consequential actions go through platform commands | Auto-accept goes through the operator-accept command (AC4) |
| 0005 | Request to Book; the operator confirms before payment | Kept: the demo operator still confirms through the command (AC4) |
| 0078 | Reflow and target sizes | AC6 |

## Comments
