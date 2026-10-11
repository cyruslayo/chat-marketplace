# Hide or replace the /guest/contact email form for linked devices, and decide the closed-account fallback

Status: ready-for-human
Type: task
Blocked by: 07, 10 (closed-account fallback)
Requested: 11 Oct 2026

## Why

Once a Guest signs in, their email belongs to the Guest Account. The contact email form still appears to a linked device, and submitting it is refused with copy. That is a dead end the Guest can see.

- The account is the single writer of the email (issue 07 Answer and Comments (b)). `GuestAccountContacts.saveEmail` refuses a linked principal with `GuestContactOwnedByAccountError` (`domains/shortlet/src/guest-account-contacts.ts:16` for the class, `:68` for the throw).
- The refusal copy is `GUEST_ACCOUNT_COPY.errors.emailOwnedByAccount` (`apps/web-agent/src/guest-content.ts`, used at `apps/local-guest/src/guest-server.ts:4341-4342` and `:9188-9189`).
- The form is still rendered: the email form markup is built at `apps/local-guest/src/guest-server.ts:5861`, and the "Contact details" link to `/guest/contact` at `:5397`. The contact route is `/guest/contact` (`guest-server.ts:9108-9130`, POST handling at `:9180`). The conversation contact prompt redirects to `/guest/contact?kind=email` at `:8179`, and the conventional route at `:4238`.
- Issue 08 Comments (remaining follow-up (a)) and issue 07 Comments (c) both record this as open.
- Note on citations: issue 07 Comments (c) and issue 08 cite `guest-server.ts` "~8055" and "~4777" for the contact prompts. On `origin/main` 8b23923 those lines are the `/client.js` asset route (`:8055`) and a payment artifact message (`:4777`). The real contact sites are the lines above.
- `apps/web/src/guest-contact-application.ts` is the shared contact application; it is re-exported from `apps/web/src/index.ts:2`.

## Question for the human

1. For a linked principal on the contact page: hide the email form entirely and show a link to `/account` (the account page, issue 07), or show the email read-only with that link?
2. Closed-account fallback (owned by issue 10): when an account is closed, `GuestAccountContacts` returns `contactEmail: null` for it (`guest-account-contacts.ts`, the closed-account branch), and `saveEmail` still refuses for the linked principal. The contact prompts then have no way forward. What should a principal of a closed account do? Options from issue 10 Comments: (a) use the principal's own contact row, or (b) re-prompt without writing the account email. Which, and what does the Guest see?
3. Does a closed account's linked principal keep its link (so the principal stays unable to save an email), or is the link removed on closure? This decides which branch of question 2 applies, and it is owned by the closure flow in issue 10 (legal review of issue 01 answer 6 still pending).

The hide-or-replace part (question 1) can be implemented on its own once the human answers it. Question 2 must not be guessed.

## Once decided (for the implementing agent)

- One helper decides whether the email form is shown, used by both the chat workspace and the standalone page (ADR 0080 parity; the shared helper is in `apps/web/src/guest-contact-application.ts`).
- Replace the form with the decided copy and link to `/account` for linked principals. Use `GUEST_ACCOUNT_COPY` strings only (no new copy without approval).
- The refusal path (`GuestContactOwnedByAccountError`) stays as a server-side guard, fail closed, and its test stays.
- Viewport checks at 320, 390, 768 and 1280 (ADR 0078) when the screen changes; captures go to `.scratch/guest-accounts/screenshots/12/`.

## Proposed acceptance criteria (after the human answers question 1 and 2)

- AC1: A linked principal does not see an editable email field on the contact page.
- AC1 failure path: a signed-out or unlinked principal still sees the email form.
- AC2: A linked principal submitting the email form directly is refused with the existing copy and writes nothing.
- AC3: The chat workspace and the standalone page show the same contact content for a linked principal (ADR 0080).
- AC4 (per decision 2): a principal of a closed account reaches a defined next step and is not left at a refusal.

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0093 | Account owns its identity; linked principals do not hold separate authority | `guest-account-contacts.ts:68`, the contact route |
| 0094 | Missing or conflicting ownership grants no account authority | Closed-account fallback (question 2) |
| 0080 | Chat and standalone page render the same content | `apps/web/src/guest-contact-application.ts`, `guest-server.ts:5397, 5861, 9130` |
| 0078 | Accessible layout; 44px targets; no horizontal overflow | Any changed screen |
| 0004 | Existing requests keep their contact snapshot | Unchanged by this issue |

## Comments

- 11 Oct 2026, filed from issue 07 Comments (b) and (c), issue 08 Comments (a), issue 10 Comments (closed-account follow-up). Line numbers re-checked on `origin/main` 8b23923.
- The closed-account dead end is recorded as fail closed until issue 10 decides it (issue 10 Comments, 11 Oct 2026).
