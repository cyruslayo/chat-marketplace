# Walkthrough stages and captures

Status: ready-for-agent
Type: task
Blocked by: 06, 09, 12, 13
Requested: 2 Oct 2026

## Why

Every guest UI change ends with captures and reflow and target checks (`AGENTS.md`, ADR 0078).

## What to build

- Walkthrough stages in `.scratch/guest-ui-consistency/walkthrough.ts` (local test data only): My stays (upcoming, past, empty), review form and each ineligible state, review submitted, message thread (open and closed window), Favourites with each availability outcome.
- A capture script for this group, copied from `capture-10.ts`, asserting no horizontal overflow and no control under 44px (hidden native radios report 1x1; their labels are the targets).
- Captures at 320, 390, 768 and 1280, light and dark, in `.scratch/guest-stays-and-favourites/screenshots/<issue number>/`.
- Re-run `capture-11-all.sh` because the stay card and app bar change; one group at a time.
- Delete `walkthrough-06.log` afterwards.

## Acceptance criteria

- AC1: Every new screen and state has captures at all four widths, light and dark.
- AC2: The capture script fails on overflow or a small target, and passes for these screens.
- AC3: The full sweep shows no new findings for existing screens.

## Tests to add/update

The capture script itself.

## ADR compliance

0078, 0080.
