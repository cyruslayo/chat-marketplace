# Decide whether the concierge mentions sign-in and links to 'my account'

Status: ready-for-human
Type: task
Blocked by: 08 (copy approval), 07
Requested: 11 Oct 2026

## Why

Two parts of the account design were specified but not built, and no acceptance criterion defines their wording or behaviour.

- Issue 08 "What to build", fourth bullet: after the request-sent and confirmation moments, the concierge mentions sign-in once, with a link to the sign-in page form (`.scratch/guest-accounts/issues/08-offer-sign-in-after-request.md`). Not built: issue 08 Comments (11 Oct 2026) and its Needs human list.
- Issue 07 Comments (d) and issue 08 Comments (c): the concierge answers "my account" with a link to `/account` (ADR 0080 chat parity). Not built: the concierge has no account intent, and no criterion covers it.
- The concierge reply is model text. Issue 08 records that "no criterion says what it should say" (Comments (c)). Any concierge reply about sign-in is therefore copy, and copy needs approval.
- The concierge's tools may not carry sign-in: issue 08 says "no sign-in inside the chat model's tools; ADR 0072 keeps consequential actions as platform commands" (What to build, fourth bullet). Sign-in sends an email and sets an account session, so a model-driven sign-in would be a consequential action.
- ADR 0085 (move guest identity verification enforcement to check-in) and ADR 0093 (booking authority remains independent of account authentication) mean the concierge must not imply that an account is required to book. The offer copy in `GUEST_ACCOUNT_COPY` already says "Signing in is optional" (`apps/web-agent/src/guest-content.ts`, `offerIntro`).

## Question for the human

1. Should the concierge mention sign-in at all, and if so, after which moments? (Issue 08 says once, after request-sent and confirmation.)
2. Should the concierge's "my account" reply exist, and if so, may it contain only a link to `/account` (no sign-in action in the model's tools)?
3. Approve the wording (copy in `apps/web-agent/src/guest-content.ts`, a new `GUEST_ACCOUNT_COPY` entry) or supply it.

The status stays `ready-for-human` until questions 1 and 3 are answered. No acceptance criteria are proposed, because the wording and the trigger are the decision.

## Once decided (for the implementing agent)

- Use `GUEST_ACCOUNT_COPY` for the wording (no new string outside it without approval).
- Any link goes to `/account` or `/account/sign-in?return=...` through the existing safe return path helper (no user-influenced target).
- The concierge tool surface must not gain a sign-in or email action (ADR 0072).
- Chat and standalone page parity (ADR 0080) for whatever is decided.

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0072 | Consequential actions go through platform commands, not the model's tools | Any concierge sign-in path |
| 0080 | Chat and standalone page show the same content for critical workflows | The mention and the link |
| 0085 | Identity verification is a check-in step; no account gate on booking | The copy must not imply an account is required |
| 0093 | Booking authority is independent of account authentication | The copy and the trigger |
| 0075 | No email, code or session material in model context or logs | Model prompt construction |

## Comments

- 11 Oct 2026, filed from issue 08 What to build (fourth bullet) and Needs human (Concierge mention), and from issue 07 Comments (d). Not built in either issue.
