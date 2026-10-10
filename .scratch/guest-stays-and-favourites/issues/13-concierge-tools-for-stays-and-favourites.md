# Concierge tools for stays and favourites

Status: ready-for-agent
Type: task
Blocked by: 04, 12
Requested: 2 Oct 2026

## Why

User story 18: the chat-first experience must reach the same content as the pages (ADR 0080 parity), without the model inventing anything.

## What to build

- Tools in `apps/local-guest/src/assistant/assistant-tools.ts`, following `compare_stays`:
  - `list_my_stays`: returns the issue 03 Stay History for the signed-in account; for a signed-out Guest, a sign-in prompt artifact.
  - `save_stay` / `unsave_stay`: by shortlist ref (e.g. `stay-1`) or unit; sends the `favourite.save` / `favourite.remove` commands (ADR 0072).
  - `list_favourites`: the Saved Stays, with the availability check when the conversation already has dates.
- A2UI rendering in `apps/web-agent/` using the same helpers as the pages (stay tickets, stay cards), within the governed catalogue (ADR 0073, 0074, 0081).
- Reviews and messages are not written through tools; the concierge links to the forms.
- During human takeover the tools do nothing (ADR 0076).

## Acceptance criteria

- AC1: "Show my stays" in chat renders the same stays and text as `/stays/mine`. Failure path: signed out, the reply offers sign-in and shows no stays.
- AC2: "Save this one" saves the referenced stay; an unknown ref gets a clear reply and saves nothing.
- AC3: "Show my favourites" renders the same list as `/favourites`.
- AC4: During human takeover the tools are not run.
- AC5: A generative surface outside the catalogue fails closed (ADR 0074).

## Tests to add/update

Extend the assistant tool tests and the A2UI parity tests.

## ADR compliance

0072, 0073, 0074, 0076, 0080, 0081.
