# Batch gate and merge to main

Status: ready-for-agent
Type: task
Blocked by: 01, 03, 04, 05, 06, 07, 08, 09 (10, 11 if done)
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md).

## What to do

Follow AGENTS.md "Test scope" and "Orchestrating agents":

1. In a dedicated merge worktree at the batch tip, run `npm run check`, `npm run test:workers` and the full `npm test` once (background, long timeout).
2. Triage any red file by running it alone first. Accepted known failures are listed in AGENTS.md ("Known accepted failures"); anything else is fixed before merging.
3. Ask the owner for explicit approval to merge to main, then separately to push.

## Acceptance criteria

- [ ] AC1: The three commands, their pass counts and any accepted failures are recorded in Comments with the commit sha.
- [ ] AC2: The merge to main and the push each have the owner's explicit approval, recorded with the date.
- [ ] AC3: `git status` in the main checkout shows no owner edit lost (nothing stashed, reset or discarded).

## Comments
