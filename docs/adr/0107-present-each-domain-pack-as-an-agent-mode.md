---
status: accepted
---

# Present each Domain Pack as an Agent Mode

The owner accepted this ADR on 8 Nov 2026, after reviewing the Agent Mode Playground (`.scratch/agent-modes/playground/agent-mode-playground.html`, published at <https://claude.ai/artifact/7QCKeeBUpDm12WpqH87HAA>). The acceptance covers what the playground demonstrates:

- tiers A and B switch automatically, with an undo
- "New conversation" resets only the active agent
- the research changes in `reports/Agent modes web technology.md`, folded into decisions 9 and 11 below

## Context

ADR 0099 lets a Domain Pack declare its prompt section, tools and surfaces, which the platform consumes. The agent side follows this: `AssistantDomainPack`, `AssistantPackRegistry`, conversation tasks (`start_task`, `switch_task`, `platform.task.start`, `platform.task.switch`), the task rail and the vertical starter cards are all in `apps/local-guest/src/assistant/`.

The guest-facing shell does not. Measured on `main` at 16d592e:

- **Shell copy is hard-coded for stays.** The chat shell (`renderGuestShellHtml`, `apps/local-guest/src/guest-server.ts:577-612`) writes the empty-state heading and body, the "Explore Abuja" and "Explore Lagos" starters, the composer placeholder and hint, the criteria-strip label and the workspace labels straight into the markup. The no-JS `/conversation` page repeats the composer copy (`guest-server.ts:774`). `client.ts` announces "Your stay details are still here" (`:1881`, `:1887`, `:2599`).
- **The persona is fixed.** `ASSISTANT_PLATFORM_PREAMBLE` (`assistant-platform.ts:20`) names the "Shortlet Guest Assistant" for every pack.
- **The client has no mode.** Responses carry `tasks` and `verticals`, but nothing says which pack is active or how the shell should present it.
- **The pack shape is booking-specific.** The surface methods (`bookingRequestSurface`, `conditionalOfferSurface`, …) and `AssistantTaskState` (`goal: "find_stay" | …`, `stayIntent`) are shortlet-shaped.

The owner wants a guest who switches domains (for example from stays to a future restaurants, events or communities domain) to see a different agent, both in the agent's replies and in the interface. The analysis is in `.scratch/agent-modes/architecture-analysis.md`. It rejects three alternatives: a client-only theme switch (it breaks ADR 0004, the cold restore and the no-JS parity of ADR 0080), one app per domain (it breaks ADR 0101's single Worker and shared thread), and model-generated UI (it breaks ADR 0073 and ADR 0106).

## Decision

1. **An Agent Mode is the guest-facing presentation of a Domain Pack.** It covers the agent's name and icon, the empty state and its starters, the composer copy, the shell region labels, the shell announcements and an accent token set. A pack supplies it as a static declaration (`presentation`) alongside its prompt, tools and surfaces (ADR 0099 decision 4).

2. **The server derives the mode, and the client never sets it.** The active mode is the pack of the thread's active task. With no task, it is the composition root's default pack. The mode is not stored separately, so a cold restore (ADR 0106) restores it from `activeTaskId`. The client changes the mode only by sending the existing `platform.task.start` or `platform.task.switch` event. An unknown or unregistered domain is refused, as `#unregisteredActiveDomain` already does. A mode value sent by the client is never read.

3. **The presentation is closed and static.** It is validated when the pack is registered: known fields only, bounded strings, a kit icon name, and a mode id that has a token block in the foundation CSS. The model never writes or changes it. All of its copy lives in `apps/web-agent/src/guest-content.ts` (ADR 0077: one copy source).

4. **Colours never travel in the presentation.** Each mode id has a block of `--mode-*` semantic tokens in the "Guest UI kit" block of `apps/web/src/shortlet-foundations.css`, scoped by `:root[data-mode="<id>"]`. Each block defines light, forced-dark and system-dark values, using the existing `data-theme` pattern. Components read `--mode-*` tokens, never a hex value. A mode changes accents only, never layout, spacing, type or target sizes (ADR 0078). Every token pair must meet WCAG 2.2 AA contrast, and a test checks it. This keeps ADR 0073's ban on CSS injection.

5. **The platform renders the shell from the presentation.** The `guest-kit.ts` helpers render the empty state, the starters and the composer from the presentation, for both the chat shell and the no-JS `/conversation` page (ADR 0080 parity). The server sets `data-mode` on `<html>` in the first response, so the page never shows the wrong mode first.

6. **Every guest response carries the mode.** `/api/turn`, `/api/event` and the state read include `mode` (the active presentation) on both the assistant path and the non-assistant path, as the criteria strip already does. The client validates its shape and applies it only when its id differs from the rendered `data-mode`.

7. **A mode switch is announced and need not animate.** The client may animate a switch with the View Transitions API (feature-detected, typed `mode-switch`, skipped under `prefers-reduced-motion`). An instant update is always correct. The change is announced through the existing polite announcer. The persona name and icon say which agent is active, so the mode never relies on colour alone.

8. **The persona belongs to the pack, and the server switches packs by tier.** The platform preamble names no domain. The pack's prompt section carries the agent's identity. A switch the guest did not choose starts only from a scope-classifier verdict: outside the active pack's scope and inside another registered pack's scope. It never starts from a keyword match on the client or the server. No keyword shortcut answers an in-scope turn (ADR 0106). Each automatic switch is disclosed in the chat, because the risk is a silent switch, not a wrong one. Thresholds are tuned on labelled guest turns, and the confidence band is logged in the diagnostic. Until those thresholds exist, a live deployment may run tier C only.
   - **Tier A, fresh task** (no task, or no guest facts yet): switch automatically, and the new pack answers the same turn.
   - **Tier B, in progress with nothing at risk** (no Request Draft, open proposal, Booking Request, Conditional Offer or open Payment Window): switch automatically and offer an undo. The old task keeps its state.
   - **Tier C, work at risk, or an uncertain verdict:** suggest the switch with fixed copy from `guest-content.ts`. The guest confirms it (ADR 0074).
   - There is at most one automatic switch per guest turn. There is no automatic switch back to a mode the guest explicitly chose to leave in this conversation.
   - The answering pack's own controls apply to the carried-over turn (ADR 0106). Ids minted under one mode fail closed under another.
   - The response states the change as `modeChange` with a closed reason (`guest_selected`, `auto_detected` or `suggested`). A closed diagnostic `assistant.mode.change.v1` records it without ids (ADR 0079).

9. **Each mode has an Agent Mark, a decorative animated glyph whose state follows existing signals.**
    - **Shape.** Each mark is an SVG from the kit icon set, with a silhouette that differs per mode, coloured by `--mode-*` tokens. It has no animation runtime.
    - **Presence.** As well as the app-bar mark, a presence dock above the composer shows the active agent while it is thinking, working or replying. Its chip names the current step in the pack's own copy, and the dock drops away when the reply lands.
    - **States.** The states are closed: `idle`, `listening`, `thinking`, `working` (a tool step is running, shown by a prop the pack names), `responding`, `suggesting`, `switching`, `resting` and `human`. Each comes from a signal the shell already has: the request in flight, the control outcome, the mode change, or human takeover (ADR 0076). While a human operator has taken over, the mark never shows AI activity.
    - **Motion.** Motion is `transform` and `opacity` only. It sits inside `prefers-reduced-motion: no-preference`, with a static form for every state. Nothing loops longer than 5 seconds unasked (WCAG 2.2.2), including `thinking` and `working` on a slow turn: they settle into their still form. Everything pauses while the page is hidden. Lottie, dotLottie and Rive are not used.
    - **Accessibility.** The mark is `aria-hidden` inside a labelled control. Text and the existing announcers carry the status.
    - **Amendment (10 Nov 2026, owner).** While one mode is registered, the app-bar mark is decorative and `aria-hidden`, and it is not a control. It becomes a labelled control when the mode sheet arrives (slice 5).
    - **Choosing.** The guest picks among registered modes through a native radio group, shown as a swipeable strip of marks in an empty conversation and as a sheet from the app-bar mark otherwise. The sheet is a modal `<dialog>` with a visible Close button, and it adds no history entry, because Android Back already closes a modal dialog. A swipe settles on `scrollend`. Snap events and scroll-state queries are enhancements only. In an empty conversation, picking previews the mode on the client from the static presentations. Only a first message or a starter commits it, through `platform.task.start`. A preview creates no task and grants no authority.

10. **Registering a pack is what creates its mode.** A parked or disabled domain is not registered, so it has no starter, no switch target and no deep link. ADR 0104 and `COMMERCE_ENABLED` are unchanged. A future domain's own switch is decided in that domain's ADR.

11. **Each mode keeps its own chat: one thread, one lane per task.** The thread stays the platform conversation (ADR 0101). Each task owns a lane: its guest-visible timeline and its own model history.
    - **Isolation.** A pack's classifier and planner see only their own lane. Across modes, only guest-authored text crosses, as the turn that triggers an automatic switch. Replies, tool results and surfaces never cross (ADR 0106 "Tools and context").
    - **Restore.** A cold restore loads the active task's lane by `activeTaskId`.
    - **Switches.** A switch leaves closed receipt and divider rows, with no copied text. Undoing an automatic switch re-sends the guest's text in the previous lane and deletes nothing.
    - **New conversation.** "New conversation" starts a new task in the active mode only (ADR 0079).
    - **Storage.** Lanes are stored per task in the platform Durable Object, alongside the thread header. Lanes are stored as one row per timeline or history event, not as JSON blobs. The design ceiling is 2 MB per row, because Cloudflare's documentation gives both 2 MB and 8 MB. They are covered by the evidence and private exports (ADR 0096).
    - **Client.** The client keeps each visited lane as a live hidden subtree (`hidden` or `content-visibility: hidden`), not detached and re-inserted. `moveBefore()` is an enhancement only. The lane cache is in memory only. A switch replaces the history entry rather than pushing one.

## Consequences

- With one pack registered, nothing changes for the guest. Slice 1 is a pure refactor, checked by the walkthrough captures.
- A second pack only needs to declare a presentation and add a token block. The shell does not need editing.
- The pack contract still has to become domain-neutral: the surface methods become a map from stage kind to renderer, and the task state becomes pack-owned with a fail-closed parse. That work is shaped against stays plus the first real second domain (ADR 0099 decision 7). It is a later slice of this effort and is not decided here.
- `CONTEXT.md` for the Concierge Platform gains **Agent Mode**.
- Tests: a presentation shape and registration test, a token-coverage and contrast test, and (once a second pack exists, even a test-only fixture) a cold-restore switch journey that checks that ids from one mode fail closed in another.

## Related

ADR 0004, ADR 0073, ADR 0074, ADR 0077, ADR 0078, ADR 0080, ADR 0081, ADR 0099, ADR 0101, ADR 0104, ADR 0106. Analysis, map and playground: `.scratch/agent-modes/`. Research: `reports/Agent modes web technology.md`.

Settled by the owner on 8 Nov 2026:

- **Naming: one concierge with domain capabilities.** Modes are presented as the same concierge changing focus ("Concierge · Stays"), not as separately named personas. The platform keeps one identity for trust and for the human handover (ADR 0076). The copy lives in `guest-content.ts`.
- **Booking facts do not cross lanes automatically.** Decision 11 stands: only guest-authored text crosses. If a later domain can use a fact from another lane (for example party size), the new lane may offer a chip such as "Use 2 guests?". When the guest taps it, the fact counts as structured guest input (ADR 0092, ADR 0106). The chip belongs to the first second-domain slice.
- **Sequencing.** Slices 1, 1b and 2 proceed now. Slices 3 to 5 wait for the owner's choice of the first real second domain, because ADR 0099 decision 7 shapes the pack contract against that domain. When switching ships, it starts at tier C only (decision 8).


Settled by the owner on 10 Nov 2026:

- **Validator bounds.** The presentation validator's bounds are accepted: 400 characters for a presentation string, 600 characters for a body, and 4 starters (decision 3, `validateModePresentation`).
- **App-bar mark while one mode is registered.** The mark is decorative and `aria-hidden`, not a control. It becomes a labelled control with the mode sheet (slice 5) (decision 9, Accessibility).
- **Persona wording.** "Concierge · Stays" is the approved persona wording. It is not shown while only one mode is registered, because that would change a screen meant to stay unchanged. It is added to `guest-content.ts` in slice 4 and shown only when more than one mode is registered.