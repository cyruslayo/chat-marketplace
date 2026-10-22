# Verify the live demo journey end to end

Status: ready-for-agent
Type: AFK
Blocked by: 03, 06, 08, 09, 10, 11, 12, 13
Requested: 21 Oct 2026

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

Before the owner shares the link, someone has to walk the deployed demo as a visitor. The walk must show that the agent, not the deterministic concierge, is answering, and that the full test-payment flow works.

## What to build

Walk the live origin in a real browser, such as the in-app browser:

1. Open `/` and `/welcome`. Expect no invite prompt, the demo notice and the test-payment copy.
2. In chat, request a synthetic unit for 180 consecutive nights. Expect a six-period quote, monthly price, photos and the "Demo listing" chip.
3. Refine the search ("something cheaper, closer to VI"), then open a unit. The gallery should load all its photos.
4. Ask the agent to compare two units and explain a price. The prices must match the unit data (no fabrication).
5. Request to book. Confirm explicitly; the request should be auto-accepted (issue 04) and the offer should show all six periods.
6. Pay the first period with the Paystack published test card. Expect one confirmed 180-night booking. Automated Worker and Node tests cover later-period payment sessions without waiting six months in the live demo.
7. Check that `/_ops` shows model-handled turns above zero for the session (issue 02 counter).

Then:

- Take screenshots of each step at 320, 390, 768 and 1280, in light and dark, using `.scratch/guest-ui-consistency/capture.ts` with the live URLs. Save them in `.scratch/demo-launch/screenshots/07/`.
- Write a short demo script for the owner in `.scratch/demo-launch/demo-script.md`: the suggested prompts, what each one shows, and the test card.

## Acceptance criteria

- [ ] AC1: Steps 1–6 complete on the live origin, with screenshots.
- [ ] AC1 failure path: a reply that makes up a price or claims a booking without a payment is recorded as a blocker, and the issue stays open.
- [ ] AC2: The `/_ops` counter shows model-handled turns for the walk, so the agent ran on GPT-6 Luna rather than only the deterministic fallback.
- [ ] AC3: There is no horizontal overflow and no control under 44px at any captured width (ADR 0078).
- [ ] AC4: `demo-script.md` exists.
- [ ] AC5: The benchmark verdict from issue 03 is "go". Link it in `## Comments`.
- [ ] AC6: The live quote shows six 30-night periods and the confirmed contract records a 180-night stay. Later-period payment rules pass the focused issue 10 tests.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0078 | Reflow and 44px targets | AC3 |
| 0080 | No agent-only financial transitions; no fabrication | AC1 failure path |
| 0087 | Paystack test mode on staging | Step 6 |

## Comments
