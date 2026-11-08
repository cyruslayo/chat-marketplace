# Agent modes: switchable agents with an adaptive guest UI

Technical analysis and proposed architecture. Status: **proposal, not decided**. Date: 8 Nov 2026. Measured on `main` at 16d592e.

Drafted from this: [ADR 0107](../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) (proposed), [map](map.md), [issue 01](issues/01-render-the-shell-from-the-stays-mode.md).

## 1. The ask

When the guest is talking to the apartment concierge, the whole screen should say so: the opening prompt, the starter chips, the composer hint, the colours and the agent's name. When another domain is added later (restaurants, events, communities), selecting it should change the agent (prompt, tools, replies) **and** the front end, so the guest can see they are talking to a different agent.

Call this an **Agent Mode**: the guest-facing face of one Domain Pack. Note that `packages/platform-core/CONTEXT.md` tells us not to say "vertical", so "Agent Mode" needs a glossary entry (section 9).

## 2. What exists today

The agent half is mostly built. The UI half is not.

### Already in place (agent side)

| Piece | Where | What it does |
|---|---|---|
| `AssistantDomainPack` | `apps/local-guest/src/assistant/assistant-platform.ts:108` | Per-pack prompt section, tools, intent map, validation, execution and surface projections. |
| `AssistantPackRegistry` | `assistant-platform.ts:290` | Registers packs and holds the active one. |
| `composeSystemInstruction` | `assistant-platform.ts:252` | Platform preamble plus the active pack's section. Only the active pack's tools are offered. |
| Conversation tasks | `start_task` / `switch_task` tools, `platform.task.start` / `platform.task.switch` events | One thread can hold one task per domain. Switching asks the guest first. |
| Task rail and vertical starters | `guest-kit.ts:705-740`, `client.ts:2131-2230`, `#task-rail`, `#vertical-starters` | Already rendered from `pack.label` and `pack.starterDescription`. Hidden until more than one pack is registered. |
| Fail-closed unknown domain | `#unregisteredActiveDomain` in `assistant-runtime.ts` | A task whose pack is not registered is refused (`tool_denial`). |
| Commerce switch | `packages/commerce-switch`, ADR 0104 | Shows how a parked pack stays unregistered. |

### Gaps

1. **The shell copy is hard-coded for stays.** `guest-server.ts:577-612` writes "Find a place to stay", the "Explore Abuja" and "Explore Lagos" chips, the "Area, dates, guests" placeholder, the composer hint, "Your search", "Current stay details" and "Return to your current stay details" straight into the page. These are exactly the things the guest sees change. None of them come from the pack.
2. **The persona is hard-coded.** `ASSISTANT_PLATFORM_PREAMBLE` (`assistant-platform.ts:20`) says "You are the Shortlet Guest Assistant… discovering accommodation". Any second pack would inherit an apartment identity.
3. **The pack interface has a booking shape.** `unitDetailSurface`, `bookingRequestSurface`, `conditionalOfferSurface`, `cardPaymentSurface` and `bookingContractSurface` are required methods. `AssistantTaskState` has `goal: "find_stay" | "book_stay" | …` and `stayIntent`. A restaurant or events pack would have to stub booking methods and carry stay fields.
4. **Cross-domain routing is a keyword match with built-up copy.** `#route` (`assistant-runtime.ts:627`) matches `intentKeywords` and builds "Start a Shop search? Your shortlet search is saved." from pack ids. The guest would see "shortlet", which is not a guest word, and the copy is not in `guest-content.ts`.
5. **The client has no notion of a mode.** Responses carry `tasks` and `verticals`, but nothing tells the client which pack is active or how the shell should look. There are no per-mode tokens in `shortlet-foundations.css`, and `<html>` has `data-theme` but no `data-mode`.
6. **Starter copy is fixed per pair.** `GUEST_VERTICALS` in `guest-content.ts` names `staysDescription` and `shopDescription` directly.

## 3. How others do this

These are the patterns that hold up, and what this repo can take from each.

- **Agent manifests (custom GPTs, Gemini Gems, Copilot agents, Slack and Teams app manifests).** Each agent ships a small declarative record: name, icon, description, instructions and "conversation starters". The host renders the starters and header from that record. The agent never draws its own chrome. *Take:* a per-pack presentation manifest. Starters are data, not markup.
- **Server-driven UI (Airbnb, Lyft and others).** The server decides which layout and copy a screen uses, and the client is a renderer with a fixed component set. *Take:* the repo already does this for surfaces with A2UI (ADR 0073, 0081). The mode manifest does the same for the shell chrome, using the same closed vocabulary.
- **Multi-brand design tokens.** One component library, with brand themes applied as token sets scoped by an attribute (`[data-brand=x]`). The components never change. *Take:* scope accent tokens by `[data-mode]` inside the existing `@layer shortlet-foundation`. The kit stays one kit.
- **Host config versus card content (Adaptive Cards).** The host owns colours, fonts and spacing. The agent sends content and semantic roles only. *Take:* a pack names a mode id. It never sends colours or CSS (ADR 0073 forbids CSS injection).
- **Native "mode" transitions on mobile.** When the mode changes, the persistent chrome (app bar, composer) stays in place and morphs, and the content area swaps. On the web that is the View Transitions API with named persistent elements.

## 4. Options

| Option | Summary | Verdict |
|---|---|---|
| A. Client-only theme switch | `client.js` holds a table of modes and restyles when a chip is tapped. | **Reject.** The server is the authority (ADR 0004). It breaks on a cold restore, breaks the no-JS `/conversation` fallback (ADR 0080/0081 parity), and lets the client claim a mode the server never started. |
| B. One app per mode | Separate pages or subdomains per domain (`/stays`, `/events` as separate apps). | **Reject.** ADR 0101 keeps one Worker, a platform-owned thread and one account. Separate apps lose the shared conversation and the task rail. |
| C. Model-generated UI | Let the model choose the starters, the colours or the layout. | **Reject.** ADR 0073 forbids dynamic schemas and CSS. ADR 0106 keeps the model out of authority. Copy would drift. |
| **D. Server-owned mode manifest plus scoped tokens plus a generic pack** | Each pack declares a static presentation manifest. The active task's pack sets the mode. The server renders the shell from the manifest and sends it on every response. The CSS applies per-mode tokens by `data-mode`. | **Recommend.** It fits ADR 0099 (packs declare, the platform renders), ADR 0073 (closed vocabulary), ADR 0077 (one copy source), ADR 0080 (parity) and ADR 0106 (cold restore, fail closed). |

## 5. Recommended architecture

```
                       ┌──────────────────── server (authority) ────────────────────┐
 guest taps starter /  │ thread.activeTaskId ──► task.domain ──► AssistantPackRegistry │
 accepts switch chip ─►│                                   │                         │
                       │                    ┌──────────────┴──────────────┐          │
                       │                    ▼                             ▼          │
                       │           agent: persona + prompt        presentation:      │
                       │           section + tools (active only)  ModePresentation   │
                       └────────────────────────────────────────────────┬──────────┘
                                         every /api/turn, /api/event, getState
                                         and the first HTML render carry `mode`
                                                         ▼
                       ┌──────────────────── client (renderer) ─────────────────────┐
                       │ <html data-mode="stays"> ─► scoped tokens (accent, tint)    │
                       │ empty state, starters, composer, labels ◄─ manifest copy    │
                       │ change of mode ─► startViewTransition({types:["mode"]})     │
                       └────────────────────────────────────────────────────────────┘
```

### 5.1 The mode is derived and never stored on the client

- **Mode = the pack of the thread's active task.** There is no new authority and nothing new to persist. A cold restore (ADR 0106) rebuilds `activeTaskId`, and the mode follows from it.
- With no task yet, the mode is the composition root's default pack (stays today).
- The client never sends a mode. It sends `platform.task.start { domain }` or `platform.task.switch { taskId }` as it does now. An unknown or unregistered domain is refused by the existing guard.

### 5.2 `ModePresentation`: one static manifest per pack

Add a `presentation` field to `AssistantDomainPack`. The copy lives in `apps/web-agent/src/guest-content.ts` (ADR 0077: one copy source), and the pack refers to it.

```ts
// apps/web-agent/src/guest-content.ts (copy source); type in platform-core or assistant-platform
export interface ModePresentation {
  readonly id: string;                 // equals the pack id; also the CSS `data-mode` key
  readonly label: string;              // "Stays"
  readonly persona: { readonly name: string; readonly icon: GuestIconName };   // "Stays concierge", kit icon
  readonly tagline: string;            // starter card line (replaces starterDescription)
  readonly emptyState: {
    readonly heading: string;          // "Find a place to stay"
    readonly body: string;
    readonly starters: readonly { readonly label: string; readonly prompt: string }[];  // "Explore Abuja"
  };
  readonly composer: {
    readonly label: string;
    readonly placeholder: string;      // "Area, dates, guests"
    readonly hint: string;
    readonly inputMode?: "text" | "search";
  };
  readonly workspace: { readonly regionLabel: string; readonly reopenLabel: string };
  readonly criteria?: { readonly regionLabel: string; readonly editLabel: string };
}
```

Rules:

- **Closed and static.** It is validated at registration (string lengths, a known icon, a known `data-mode` key with tokens in CSS). The model never writes it.
- **No colours in the manifest.** Colours live in CSS, keyed by `id` (5.4). This keeps ADR 0073's ban on CSS injection and keeps contrast testable at build time.
- **Same helper for chat and page.** `guest-kit.ts` gets `emptyStateHtml(presentation)` and `composerHtml(presentation)`, used by both the chat shell and the no-JS `/conversation` page (AGENTS.md "Guest UI kit").

### 5.3 Wire protocol

- **First render.** `guest-server.ts` renders the shell from the default or active presentation, and sets `<html lang="en-NG" data-theme="system" data-mode="stays">` on the server, so the page never flashes the wrong mode.
- **Every response** (`/api/turn`, `/api/event`, `getState`) carries `mode: ModePresentation`. It is about 1 KB, so sending it every time is simpler and safer than diffing. This follows the AGENTS rule that the criteria strip comes back on assistant responses too.
- **Client.** `client.ts` validates the shape the way it already checks `verticals` (`isGuestVertical`). It applies the mode only when `mode.id` differs from `document.documentElement.dataset.mode`.

### 5.4 Theming: scoped semantic tokens

In the "Guest UI kit" block of `shortlet-foundations.css`, keep the committed formatting (the foundation tests match it with regexes):

```css
@layer shortlet-foundation {
  :root[data-mode="stays"]  { --mode-accent: var(--color-accent); --mode-accent-subtle: var(--color-accent-subtle); --mode-tint: …; }
  :root[data-mode="events"] { --mode-accent: …; --mode-accent-subtle: …; --mode-tint: …; }
  /* dark values follow the existing three-place pattern: [data-theme="dark"] and
     @media (prefers-color-scheme: dark) { [data-theme="system"] } */
}
```

- **Small surface.** A mode changes only a few semantic tokens: `--mode-accent`, `--mode-accent-subtle`, `--mode-on-accent` and `--mode-tint`. It also chooses the persona icon. Components read `--mode-*`, never a hex value. Layout, spacing and type stay the same, so the kit stays one kit and the 44px and reflow checks (ADR 0078) still hold.
- **A test enforces it.** Every registered presentation id has a CSS block that defines every `--mode-*` token in light, forced-dark and system-dark. Each pair passes WCAG 2.2 AA contrast against `--color-surface`.
- **Browser chrome.** On a switch, update `<meta name="theme-color">` (one with `media="(prefers-color-scheme: dark)"` and one without), so the mobile address bar takes the mode tint.
- **Container style queries** (`@container style(--mode: x)`) have only been Baseline since May 2026. Do not use them for core mode styling. Attribute selectors do the same job today.

### 5.5 The switch moment: motion and accessibility

```ts
function applyMode(next: ModePresentation): void {
  const update = () => { renderShell(next); document.documentElement.dataset.mode = next.id; };
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
  try { document.startViewTransition({ update, types: ["mode-switch"] }); }
  catch { document.startViewTransition(update); }   // engines without the options form
  announce(modeSwitchedCopy(next));                  // existing #announcer, polite
}
```

- `view-transition-name: app-bar`, `composer` and `persona` keep the chrome in place while the colours cross-fade. The transcript area uses the root cross-fade. The `:active-view-transition-type(mode-switch)` selector scopes the animation so ordinary turns do not animate. View Transitions have been Baseline (newly available) since Oct 2025, so feature-detect them and fall back to an instant update.
- Move focus to the new empty-state heading only when the guest started the switch from the switcher. Leave focus alone when the switch came from a chip in the conversation. Never rely on colour alone: the persona name and icon in the app bar say which agent is active.

### 5.6 Choosing a mode

- **Empty conversation:** the starter cards that already exist (`#vertical-starters`), fed by `presentation.tagline`. They appear only when two or more modes are registered, as today.
- **Mid-conversation:** a mode switcher in the app bar. On mobile, use the existing bottom-sheet pattern (`history.pushState({shortletSheet: true})`) so Back closes it. On desktop (64rem and up), show the task rail as it is. The `popover` attribute is a good fit for the menu, but it is only newly available, so keep the sheet as the base.
- **Agent-suggested:** the model may offer `start_task`. The switch still needs a guest tap on a confirmation chip (ADR 0074, 0106), as today.
- **Deep links:** `/?start=<modeId>` (or a `/m/<modeId>` route) runs the same `platform.task.start` on the server. Add web app manifest `shortcuts` entries, one per mode, for Android home-screen long-press. All of this is optional and comes later.

### 5.7 Agent side

- **Persona.** Make the platform preamble neutral ("You are a concierge on this platform. Use tools for facts…"). Move the identity line into the pack (`presentation.persona.name` plus `promptSection`). Each pack's system instruction stays stable, so prompt caching still works per pack.
- **Cross-domain routing.** Replace `#route`'s keyword match with the scope classifier. When the active pack's `scopeDescription` rejects a turn and another registered pack accepts it, return `scope_redirect` with a fixed switch chip from `guest-content.ts` ("Switch to Events? Your stay search is saved."). This removes the "shortlet" leak and the copy built from ids. It is a redirect, not an in-scope shortcut, so it keeps to ADR 0106's "no deterministic in-scope fast path".
- **Generic pack contract.** Split the interface:
  - `agent`: prompt, tools, intent map, validate, normalize, execute, reply rendering.
  - `presentation`: `ModePresentation`.
  - `surfaces`: a map from pack-declared stage kinds to renderers (`Record<string, (artifact, surfaceId) => A2UI[]>`), replacing the five booking methods.
  - `state`: `initial(): S`, `parse(unknown): S | undefined` (fail closed) and `summary(S): AssistantTaskSummary`, so `AssistantTaskState` is no longer stay-shaped. The shortlet state becomes `ShortletTaskState`.

  This is the refactor ADR 0099 decision 7 asks for ("designed against exactly two packs").

### 5.8 Registration and switches

- A mode exists only if the composition root registers its pack, which is what ADR 0104 already does for commerce. A parked or disabled domain is simply not registered, so it never appears in starters, the switcher, deep links or `scope_redirect`.
- Each future domain gets its own fail-closed switch with the `COMMERCE_ENABLED` semantics (exactly `true` means on, any other non-empty value stops startup). Whether that becomes one generic parser is an owner decision for the new ADR. `COMMERCE_ENABLED` itself does not change.

## 6. ADR constraints

| ADR | Constraint | Where it bites |
|---|---|---|
| 0004 | The browser is not an authority. | The mode is derived on the server. The client never declares it (5.1). |
| 0073, 0081 | Closed catalogues. No dynamic schema, CSS or HTML from the agent. | The manifest is static and validated. Colours are in CSS only (5.2, 5.4). |
| 0074 | Fail-closed surface lifecycle. A switch supersedes proposals. | Switching keeps `replacePendingProposal(…, "task_switched")`. Ids from another mode stay `STALE_SURFACE`. |
| 0077 | One copy source. | All manifest copy lives in `guest-content.ts`. Chat and page use the same kit helper. |
| 0078 | Accessible launch profile, 44px targets. | The switcher, starters and announcer. Contrast test per mode token pair. |
| 0080, 0081 | Deterministic parity and no-JS fallback. | `/conversation` renders the same manifest and the same starters as plain links or forms. |
| 0099 | Packs declare; the platform renders. One façade per domain. | `presentation` is a declaration. Kit rendering is platform-owned. A new domain lives in `domains/<x>` behind its index. |
| 0101 | One Worker. The platform owns threads and tasks. | One app, one thread, many tasks (rejects option B). |
| 0104 | Stays first. Commerce off, fail closed. | No commerce work. Parked packs stay unregistered (5.8). |
| 0106 | Cold restore before every event. Date authority. No in-scope fast path. | Mode survives a cold restore because it is derived. Switch tests run on the cold-restore harness. Routing goes through the classifier (5.7). |

## 7. Delivery slices

Slices 1 and 2 are apartment-only refactors with **no visible change**. They are in scope now. Slices 3 to 5 make switching real and prove it with a **test-only fixture pack** (registered in tests, never in a composition root). Slice 6 is a new domain and needs the owner to open it.

| # | Slice | Done when |
|---|---|---|
| 0 | ADR "Agent modes" (amends 0099, extends 0073/0077), plus the CONTEXT glossary entry. | Accepted by the owner. |
| 1 | `ModePresentation` for stays. The shell (`guest-server.ts:577-612`, `/conversation`) renders from it through kit helpers. Server-rendered `data-mode`. `mode` added to every response. | The walkthrough and the full capture sweep (`capture-11-all.sh`) show no diff. `assistant-cold-journey` passes. |
| 2 | Neutral platform preamble. The persona moves into the stays pack. | Cold-journey and scope-classifier tests pass, and the closed diagnostics are unchanged. |
| 3 | Generic pack contract: `surfaces` map and pack-owned task state with a fail-closed `parse`. | Shortlet behaviour is unchanged. A fixture pack implements the contract without stubbing booking methods. |
| 4 | Client mode switching: `applyMode`, scoped `--mode-*` tokens, view transition, `theme-color`, announcer. Classifier-based `scope_redirect`. | A test registers stays plus the fixture pack and runs: start, switch, cold restore, event, switch back. The mode, starters and composer follow, and forged task ids fail closed. Captures at 320/390/768/1280, light and dark. |
| 5 | Mode switcher sheet, deep-link start, manifest shortcuts. | Real-Chrome test of the sheet with Back. 44px targets. |
| 6 | First real second domain (restaurants, events or communities). | Its own ADR, domain package, switch and catalogue. Owner decision. |

## 8. Risks

- **Size of the shell files.** `guest-server.ts` (5,840 lines) and `client.ts` (2,924 lines) inline the shell. Slice 1 should move the chrome into `guest-kit.ts` helpers rather than adding branches in place.
- **Foundation CSS tests are regex-based.** New `--mode-*` blocks must follow the committed formatting exactly. Do not run a formatter over the file.
- **Copy leaks.** Grep for guest-visible "stay" or "shortlet" strings in the platform and runtime (for example `#route`, `ASSISTANT_CONTROL_COPY`) and move them into the pack.
- **Ids across modes.** A surface or artifact id minted in one mode must never validate in another. Add this to the cold-restore switch test.
- **A second domain is speculative until one is chosen.** Restaurants (reservations), events (tickets) and communities (membership) have quite different transaction models. Slice 3's generic contract should be shaped by stays plus the one domain the owner actually picks, not by all three.

## 9. The Agent Mark: an animated, cyclable agent identity

Added 8 Nov 2026 at the owner's request. Each mode gets a small animated mark, like the Claude Code agent glyph. The guest can cycle through the marks to pick an agent. When the conversation clearly belongs to another agent, the mark switches on its own and the interface follows.

Web guidance consulted (modern-web-guidance, Sep 2026 set): `motion`, `icons`, `spinner`, `physics-based-easing`, `individual-transform-properties`, `same-document-transitions`, `scroll-snap-state-sync`, `scroll-snap-realtime-feedback`, `carousel-snap-highlights`, `design-token-reactivity`, `dark-mode`.

### 9.1 What the mark is

- **One glyph per mode, with its own silhouette.** Each mark is drawn as an inline SVG symbol in the kit icon set and coloured with `currentColor` plus `--mode-accent`. The silhouette must differ between modes (for example a roof-like arc for Stays and a ticket notch for Events), so the mode is never told by colour alone (ADR 0078). The `icons` guide prefers CSS-driven SVG icons that are crisp at any size and themeable from CSS.
- **Two placements, one element identity.** The hero placement (about 72px) sits in the empty state above the heading. The app-bar placement (about 28px, with a 44px hit area) sits before the title. Both get `view-transition-name: agent-mark`, so the guest's first message animates the hero mark up into the app bar, and a mode switch morphs it in place (`same-document-transitions`).
- **No animation runtime.** Use CSS keyframes and transitions on `transform`, `opacity`, the individual `scale`/`rotate`/`translate` properties (widely available) and `linear()` spring easing (widely available since Dec 2023). This keeps the motion on the compositor (`motion`, `physics-based-easing`). Lottie and Rive are rejected for now. Each adds a heavy runtime on constrained Nigerian networks (ADR 0078), and neither reads the design tokens.

### 9.2 States: the mark shows what the agent is doing

The client sets `data-agent-state` on the mark. Every state maps to a signal the app already has, so nothing new is invented.

| State | When (existing signal) | Motion (no-preference) | Reduced motion |
|---|---|---|---|
| `idle` | Nothing in flight | One short "breath" after the mark appears, then still | Still |
| `listening` | Composer focused and has text | Slight lift (`scale: 1.04`) | Outline ring only |
| `thinking` | A request in flight (`isLoading`, `#working-status`) | Slow orbit or pulse, CSS only; the existing working-status text stays the accessible signal | Static "thinking" glyph variant plus the text |
| `responding` | A reply arrived | One spring pop | None |
| `suggesting` | The server suggests another mode (9.4, tier C) | The other agent's mark peeks out beside it | The other mark is shown, without motion |
| `switching` | The mode changed | The mark morphs through the view transition (`types: ["mode-switch"]`) | Instant swap plus an announcement |
| `resting` | `quota_refusal` or `CONCIERGE_UNAVAILABLE` | Desaturated, still | Same |
| `human` | Human takeover (ADR 0076) | The agent mark yields to a person badge, with no AI motion | Same |

Rules from the `motion` guide and WCAG:

- **Pause, Stop, Hide (WCAG 2.2.2).** Nothing loops for more than 5 seconds unasked. `idle` is a single breath. `thinking` lasts only as long as a request, which is bounded by the turn budget. The CSS pauses all mark animations while `document.visibilityState` is `hidden`.
- **Reduced motion.** Write the motion inside `@media (prefers-reduced-motion: no-preference)`. Do not use the global `animation-duration: 0.01ms` hack, which the guide warns against. Every state has a static form.
- **No flashing.** Never more than three flashes a second. Do not bounce `opacity` (`physics-based-easing`).
- **Text is the source of truth.** The mark is `aria-hidden` decoration inside a labelled control. The status still reaches screen readers through `#working-status` and the existing announcers.
- **The human state is mandatory.** While an operator has taken over, the mark must never animate as if the AI were replying (ADR 0076).

### 9.3 Cycling through agents

Two contexts, with one control model: **a native radio group, styled as a strip of agent marks.**

- **Why radios.** The `carousel-snap-highlights` guide warns that a snapped item is not exposed to assistive technology, and that scroll-state styling must not be used for interactive state. Native radios give keyboard arrow-key cycling, a checked state, form submission for the no-JS page, and a 44px label target, which the kit already uses. The checked radio is the only "active" state. Swiping is a second way to change it.
- **Empty conversation: the hero strip.**
  - A horizontal `scroll-snap-type: x mandatory` row of mark labels (scroll snap has been widely available since 2020), with the checked one centred and large. The guest swipes, taps a neighbour, or uses the arrow keys.
  - While the guest swipes, the pending mark is highlighted (`scrollsnapchanging`). When it settles (`scrollsnapchange`), the matching radio is checked. Both snap events are Chrome and Edge only, so feature-detect them and fall back to an `IntersectionObserver` on a thin centre slice (`scroll-snap-state-sync`). `container-type: scroll-state` highlighting is an `@supports` enhancement only.
  - **Choosing previews, it does not commit.** Checking a radio changes only the preview: the heading, starters, placeholder and accent change on the client, from the static presentations the server already sends in `verticals`. There is no server call and no task is created, so flicking through five agents leaves nothing behind. The choice is committed when the guest sends a first message or taps a starter. The client then sends `platform.task.start { domain }` before the turn, and the server stays the authority (ADR 0107 decision 2).
- **During a conversation: the app-bar mark.**
  - The mark becomes a button: `aria-label="Stays concierge. Change concierge"`, with `aria-haspopup="dialog"`.
  - Tapping it opens the existing bottom sheet (Back closes it). The sheet holds the same radio group as larger cards: mark, persona name, tagline, and that agent's task status from the task rail (for example "Stays · Offer ready").
  - Choosing a card commits at once (`platform.task.switch` when that agent already has a task, `platform.task.start` when it does not). If the current task has an open proposal, the card warns first ("Your stay proposal will need confirming again"), because the switch replaces it (ADR 0074).
  - Do not put swipe gestures on the app bar. A swipe there competes with the OS back gesture and with text selection.
- **One mode registered (today).** The mark shows with its states but is not a button and has no strip. There is nothing to cycle.
- **Haptics (optional, not covered by the guidance).** `navigator.vibrate(8)` on snap commit, feature-detected (Android Chrome only, nothing on iOS) and skipped under reduced motion.

### 9.4 Automatic switching when the conversation changes topic

The server decides; the client never switches on keywords. The scope classifier (ADR 0106) already judges every turn. When it finds the turn outside the active pack's scope but inside another registered pack's scope, the runtime applies one of three tiers:

| Tier | Current task | What happens |
|---|---|---|
| **A. Fresh** | No task yet, or a task with no guest facts | **Switch automatically.** The server starts the new task, and the new agent answers the same turn, so the guest never repeats themself. The response carries the new `mode` and `modeChange { reason: "auto_detected", undoable: true }`. The mark morphs, and a chip offers "Back to Stays". |
| **B. In progress, nothing at risk** | A search or shortlist, but no draft, proposal, request, offer or payment | **Switch automatically, with undo.** The old task keeps its state in the rail. The undo chip stays until the guest's next message. |
| **C. Work at risk** | An open proposal, Request Draft, Booking Request, Conditional Offer or an open Payment Window | **Suggest, do not switch.** The mark goes to `suggesting` (the other agent peeks), and the reply carries a fixed chip, "Switch to Events? Your stay request is kept." The current agent stays active until the guest taps it. |

Guards:

- **Bounded switching.** At most one automatic switch per guest turn. There is no automatic switch back to a mode the guest explicitly chose to leave in this conversation, because a manual choice wins. An uncertain or split classifier verdict falls to tier C.
- **The new agent answers with its own controls.** The answering pack's own date authority, tool authorisation and scope rules apply to the carried-over turn (ADR 0106). Ids from the old mode stay `STALE_SURFACE` in the new one.
- **Closed reasons.** `modeChange.reason` is one of `guest_selected`, `auto_detected` or `suggested`. A closed diagnostic `assistant.mode.change.v1` records the from-mode, the to-mode, the reason, the tier and whether the guest undid it (ADR 0079, no ids). The undo rate tells us whether auto-switching is too eager.
- **The transcript stays legible.** Each agent message carries the small mark of the agent that wrote it, taken from the server's task domain for that turn. A switch leaves a divider row ("Now with the Events concierge"), announced politely. Earlier Stays replies keep the Stays mark.

This changes ADR 0107 decision 8 ("the switch is still confirmed by the guest"). Tiers A and B switch without asking. The ADR draft has been amended to match, and it is an **owner decision**.

### 9.5 Wire additions

- `verticals[]` carries each registered mode's full static `ModePresentation`, for previews only (no authority).
- `modeChange?: { from: string; to: string; reason: "guest_selected" | "auto_detected" | "suggested"; undoable: boolean }` is sent on the response that changes or suggests a mode.
- Each transcript turn carries `modeId`, from the server-side task domain.
- An undo is the existing `platform.task.switch` to the previous task. Nothing new is needed.

### 9.6 Slices this adds

- **1b. The Agent Mark for the single stays mode:** the glyph, the states in 9.2, the hero-to-app-bar transition, the reduced-motion and 5-second rules, and the human state. This is in scope now, because it adds identity without a second domain. It needs captures and the 44px check.
- **4b. Automatic switching tiers (9.4)**, with the fixture pack, on the cold-restore harness. Each tier gets its own test, and so does the "no switch back after a manual choice" rule.
- **5 (expanded). The cycling strip and the app-bar sheet (9.3).** Real-Chrome tests for swipe-settle, arrow keys and the sheet, plus a check that previewing creates no task.

## 10. Glossary addition (platform CONTEXT.md)

**Agent Mode**: the guest-facing presentation of the Domain Pack that owns the thread's active task: its persona, starters, composer copy and accent tokens. It is derived on the server from the active task and never set by the client. _Avoid_: vertical, theme, persona (on their own).

## 11. Chat history per Agent Mode

Added 8 Nov 2026. The owner wants each agent to keep its own chat history. Switching agents should show that agent's own conversation, not one shared transcript.

### 11.1 What is stored today

- **One conversation record per thread.** The thread (`guest_threads.thread_json`, in the platform Durable Object, ADR 0101) holds one guest-visible `timeline` (`GuestThreadState.timeline`, `shortlet-app.ts:661`) and one model history (`AssistantThreadState.conversationHistory`, `assistant-state.ts:137`). Both are shared by every task.
- **Tasks keep only their workspace.** Each `AssistantTask` (`assistant-state.ts:123`) already keeps its own state, surfaces and badge. A switch already saves and restores the task's workspace. It does not save or restore the chat.

So the seam already exists: the **task**. One task per mode, and each task already owns its workspace. It needs to own its chat as well.

### 11.2 Options

| Option | Model | Verdict |
|---|---|---|
| A. Filter one transcript | Tag each timeline entry with `modeId` and show only the active mode's entries. | **Reject.** The model history stays shared, so the Events agent would still read the Stays chat. That is a context leak (ADR 0106 "Tools and context": rejected or foreign content must not re-enter history). Tokens grow with every mode. |
| B. One thread per mode | A separate `threadId` per agent. | **Reject as the primary model.** It splits what ADR 0101 makes one platform conversation. It breaks the task rail, the unread badges and the "New conversation keeps committed work" rule (ADR 0079). An automatic switch would have to move a turn between threads. The thread id is also the security and session key (issue 53), so N ids per guest means N things to guard. |
| **C. One thread, one lane per mode** | The thread stays the container: one guest, one sign-in, one task rail. Each task owns a **lane**, which is its guest-visible timeline plus its own model history. Switching swaps the visible lane. | **Recommend.** The isolation is real for the guest and for the model. It builds on the existing task seam, and the restore and authority rules stay as they are. |

### 11.3 The lane model (option C)

```ts
interface AssistantTask {
  readonly taskId: string;
  readonly domain: string;            // the mode
  state: …;                           // unchanged
  activeSurfaces; supersededSurfaces; lastSurfaces; badge;   // unchanged
  timeline: GuestTimelineEntry[];     // NEW: what the guest sees in this mode
  conversationHistory: AssistantConversationStep[];  // NEW: moved from the thread, per task
}
// AssistantThreadState keeps: threadId, guestActorId, tenantId, tasks, activeTaskId,
// and a small thread-level `modeLog` (from, to, reason, at) for the transcript dividers and diagnostics.
```

Rules:

- **Context isolation.** A pack's planner and classifier see only their own lane's history. A cross-mode turn is handed over as **guest text only**: the turn that triggered an automatic switch is written into the new lane as the guest's message. The old agent's replies, tool results and surfaces never cross. This is a stricter form of ADR 0106 "Tools and context".
- **Restored by task id.** A cold restore loads `activeTaskId`, then that task's lane. Surface and artifact ids are already per task and re-keyed on restore. A lane's history is filtered by the pack that owns it.
- **Where a switch leaves its mark.** The old lane gets a closed receipt row ("Continued with the Events concierge"), and the new lane opens with a divider. Neither row copies text from the other lane.
- **Undo is "Ask Stays instead".** Undoing an automatic switch (tier A or B) switches back and re-sends the same guest text as a new turn in the Stays lane. The misrouted exchange stays in the Events lane as an honest record. Nothing is moved or deleted, so audit stays simple.
- **"New conversation" stays per mode.** It starts a fresh task for the active mode only, and the other modes' lanes are untouched. Committed work is still shown, as ADR 0079 requires. Whether "New conversation" may also mean "start over in every mode" is an owner choice, not decided here.
- **Unread.** A lane that receives an async event (an offer, a payment confirmation) while another mode is open gets the existing task badge, and the agent mark in the switcher shows a dot.
- **Bounded size.** Each lane keeps the existing retention limits on model history (`maxItems`, state summaries). The guest timeline has a per-lane cap, with older entries summarised as receipts, so the record cannot grow without limit.

### 11.4 Storage

- **Split the blob.** Today every Worker request reloads the whole `thread_json`. With N lanes that cost grows with the number of modes. Add `guest_thread_tasks (thread_id, tenant_id, task_id, domain, state_json, timeline_json, history_json, updated_at)` in the platform Durable Object. Keep `guest_threads` for the thread header and `activeTaskId`. A request then loads the header, the active lane, and only the summaries of the other lanes (domain, status, badge) for the rail.
- **Migration and export.** Use the existing data-migration path (ADR 0101, `ops-import.ts`). Today's single timeline becomes the stays task's lane. The new table joins the daily evidence export and the ADR 0096 private export next to `guest_threads` (`do-export.ts:79`). Redaction (ADR 0075) applies to each lane as it does to the thread now.
- **One writer.** The existing thread lock (`assistant-thread-lock.ts`) still covers the whole thread. A turn writes one lane plus the header in one transaction (`assistant-turn-transaction.ts`).

### 11.5 Client

- **Fetch on switch, cache in memory.** The switch response (`platform.task.switch` or `start`) returns the target lane's timeline and surfaces, as `getState` does today. The client keeps each visited lane's transcript DOM detached in memory (the `faster-spa-view-transitions` pattern), so flipping back is instant. It restores each lane's scroll position, which is client-only. A full reload asks the server, which is always right.
- **The swap is a view transition.** The transcript cross-fades while the agent mark morphs (section 9.1). Under reduced motion the swap is instant. Focus moves to the lane heading only when the guest switched from the switcher.
- **Preview creates nothing.** Cycling the strip in an empty conversation (section 9.3) shows the target mode's empty state. A mode that already has a lane shows a one-line "Continue: Stays · Offer ready" teaser rather than loading the whole lane, until the guest commits.
- **No-JS page.** `/conversation` renders the active lane only, plus the task rail as links that switch lanes (ADR 0080 parity).

### 11.6 Slices

- **3b. Per-task lanes (server):** move `timeline` and `conversationHistory` into the task, add `modeLog`, keep isolation of planner and classifier context, and add the migration of the existing single timeline. Behaviour does not change with one mode. Tests: a cold restore re-opens the right lane. With the fixture pack, the Events planner's request contains no Stays text, and the "Ask Stays instead" undo re-sends only the guest text.
- **3c. Table split and export:** `guest_thread_tasks`, the export coverage, and the restore runbook update. Run the Worker specs for the platform object, export and migration.
- **4 (expanded). Client lane swap:** the cache, scroll memory, view transition and teaser.
