# 03 Request and contact repair

Status: ready-for-agent
Type: task
Blocked by: 02

## What to build

Give request review direct edits for trip and contact while retaining valid answers. Replace technical phone-format copy with a Nigerian example. Keep invalid input available for correction and return guests to their review task. Check actual screen-reader output for numbered steps before changing markup.

## Acceptance criteria

- AC1: Each editable review fact has a direct edit path that returns to the same draft with other valid facts retained; a superseded draft cannot submit.
- AC2: Phone entry uses plain guidance and a specific error, preserves the value after failure, and restores the review task after correction.
- AC3: Screen-reader output announces each step number once across request, waiting, offer, payment, and confirmation; required terms stay visible before submission.

## ADR map

0005/0041: draft and disclosed request differ. 0015/0016: review shows full price and deposit. 0075: contact remains private. 0077: chat/page facts match. 0078: labels and errors. 0080: conventional route. Read other intersecting ADRs before code.

## Tests and evidence

Write one named failing test per AC. Cover invalid contact, retained values, stale draft, and actual AX output. Run `npm run check` and affected tests, with one real-Chrome file at a time. Capture changed screens at four widths in light/dark. Record exact commands, counts, and Definition of Done review in Comments.

## Comments
