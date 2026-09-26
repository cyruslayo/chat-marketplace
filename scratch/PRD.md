# PRD: Guest chat-first UX

Status: ready-for-agent
Report: https://claude.ai/artifact/SN6HVci7M4bjpVthVtmA5Y
Audit date: 25 Sept 2026. The live walkthrough used `npm run guest:local` (deterministic concierge) at 1280px and 375px. Gemini assistant mode is out of scope for this round.

## Problem

The guest app looks chat-first but behaves form-first:
- The conversation is a thin slot-filling wrapper.
- The system's understanding is hidden.
- The focused workspace pushes the chat aside.
- Once booking starts, the concierge stops answering.

## Principles

- **Engelbart:** one shared working surface, with multiple views of the same state.
- **Kay:** simple things are simple and complex things are possible. Comparing, amending and backtracking are never dead ends.
- **Victor:** show the data. What the system believes is always visible and directly editable, and a change shows its consequence immediately.

## Findings

| ID | Finding | Evidence |
|---|---|---|
| F1 | Replies never say what was understood; no persistent criteria view | `guest-server.ts:1450`, `concierge.ts` `clarifyReply` |
| F2 | Check-in is always the demo date; dates are fabricated | `concierge.ts:316` |
| F3 | "me and my wife", "this weekend" and "quiet" are silently ignored | `concierge.ts:92–114` |
| F4 | No reply to a question or a change after submission; workspace demoted to fallback | `client.ts:347, :480`; `guest-server.ts:230, :297` |
| F5 | Workspace displaces the transcript; no back to results; no comparison | `guest-server.ts:898` |
| F6 | "Not reserved" repeated 2–3 times per screen; internal terms leak into guest copy | draft, review and request surfaces |
| F7 | Operator wait is static text; no countdown or next steps | ADR 0041 |
| F8 | Actions exposed as links or generic elements; unnamed button; no `role=log`; assertive-only announcer; non-scrolling transcript; no Escape | `guest-server.ts:1490, :1627` |
| F9 | Conventional fallback routes return 404; chat does not work without JS | `apps/web/src/presentation.ts:30, :84, :88` |
| F10 | No new conversation, undo, or edit of an earlier answer | `client.ts` sessionStorage thread |
| F11 | No fit reasons; indicative-rate footnote shown on dated results; narrow card; city-only chips | discovery surface |
| F12 | No typing indicator, timeout or retry (earlier audit A16 still open) | `client.ts` |

## Scope

The issues are listed in [map.md](map.md). Out of scope: Gemini assistant mode, Operator app, real photography, payment provider changes.

## Decisions (approved 25 Sept 2026)

1. **Guest vocabulary (issue 07):** keep the canonical money and contract terms. Unit becomes "apartment" in guest copy. The Accommodation Provider is named only where the contract forms (ADR 0006). All labels come from one glossary module.
2. **Withdrawal (issue 10):** no guest withdrawal of a submitted Booking Request at launch. The UI states the no-cost exit (don't accept the offer). "Decline offer" is a follow-up that needs an ADR.
3. **Budget (issue 03):** compared against the All-In Stay Total, deposit excluded and shown separately (ADR 0015). Nightly budgets are converted to a stay total.

Details and added acceptance criteria are in each issue.

## Follow-ups needing an ADR

- A "Decline offer" action on the Conditional Booking Offer.
- Guest withdrawal during the Operator window, only if pilot evidence shows a need.
