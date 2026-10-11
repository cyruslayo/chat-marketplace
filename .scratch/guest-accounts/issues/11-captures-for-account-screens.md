# Walkthrough stages and captures for account screens

Status: ready-for-agent
Type: task
Blocked by: 07, 08, 10
Requested: 2 Oct 2026

## Why

Every guest UI change ends with captures and reflow and target checks (`AGENTS.md`, ADR 0078).

## What to build

- Add walkthrough stages to `.scratch/guest-ui-consistency/walkthrough.ts` (local test data only): signed-out sign-in page, code page with an error, signed-in account page, request-sent with the sign-in offer.
- A capture script for the account group, copied from `capture-10.ts`, asserting no horizontal overflow and no control under 44px. Hidden native radios report 1x1; their labels are the targets.
- Captures at 320, 390, 768 and 1280, light and dark, saved in `.scratch/guest-accounts/screenshots/<issue number>/`.
- Re-run `capture-11-all.sh` if shared CSS or the shell changed; run groups one at a time.
- Delete `walkthrough-06.log` afterwards.

## Acceptance criteria

- AC1: Every new screen has captures at all four widths, light and dark.
- AC2: The capture script fails on horizontal overflow or a target under 44px, and passes for these screens.
- AC3: The full sweep shows no new findings in `findings-*.txt` for existing screens.

## Tests to add/update

The capture script itself; no unit tests.

## ADR compliance

0078, 0080.
