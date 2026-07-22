# Issue tracker: Local Markdown

Issues and PRDs for this repository live as Markdown files in `.scratch/`.

## Conventions

- One effort per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append under a `## Comments` heading

## Publishing

When a skill says to publish to the issue tracker, create the appropriate file under `.scratch/<feature-slug>/`, creating the directory if needed. When a skill says to fetch a ticket, read the referenced local file.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- Ticket type is recorded as `Type: research`, `prototype`, `grilling`, or `task`
- Ticket status is recorded as `Status: claimed` or `Status: resolved`
- Blocking edges use `Blocked by: NN, NN`
- The frontier is the first numbered open, unblocked, unclaimed issue
- Claim by setting `Status: claimed` before work
- Resolve by appending an `## Answer`, setting `Status: resolved`, and adding a context pointer to the map
