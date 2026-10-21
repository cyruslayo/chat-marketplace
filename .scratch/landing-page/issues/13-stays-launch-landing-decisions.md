# 13 · Owner decisions for the stays-launch landing page

Status: ready-for-human
Type: grilling
Blocked by: none
Requested: 20 Oct 2026

## Decided already (20 Oct 2026)

- Launch stays only; commerce stays off (`../../multi-domain-platform/issues/30-defer-commerce-until-stays-launch.md`).
- The landing page is a stays page, with no Shop section.

## To decide (recommendation first)

1. **What the search box does on send.** Today the landing form is `GET /` with an unnamed input, so the visitor's words are dropped and they land on an empty app. Yet the page says "Say what you need" (direction doc, "Landing-to-concierge handoff": the Guest never has to retype).
   - **(a) Recommended:** a POST route that creates the session (with the same beta-invite gate as `/`), starts a new thread with the message as the first Guest turn, and redirects into the conversation. The message travels only in the request body, never in the URL. On `main`, `POST /conversation` already starts a thread from a first message but requires a session (`apps/local-guest/src/guest-server.ts`, `/conversation` handler). This is issue 14.
   - (b) Keep the link to an empty app and change the copy so it promises nothing.
2. **The beta gate on staging.**
   - **(a) Recommended:** `/welcome` is public. Sending from the search box meets the invite gate exactly as `/` does today (`guest-server.ts`, `betaInviteCode`).
   - (b) Put `/welcome` behind the gate too.
3. **"Furnished".** The eyebrow ("Furnished apartments · Lagos and Abuja") and the page title use a word that is not in `domains/shortlet/CONTEXT.md`; it appears only in ADR-0092.
   - **(a) Recommended:** add "Furnished" to the shortlet glossary as a property of a published Unit (it is true of every Unit at launch).
   - (b) Drop the word: "Apartments · Lagos and Abuja".
4. **Monthly stays on the page.** ADR-0092 (accepted 4 Oct 2026) allows 30–90-night Extended Stays, but its guest-facing items marked [counsel] are not in force.
   - **(a) Recommended:** the page shows 1–14-night stays only until counsel signs off.
   - (b) Show Extended Stays now.

   Note: a saved preference says the positioning is "1–6 month stays", but ADR-0092 caps an Extended Stay at 90 nights. Confirm which is current before any copy mentions months.
5. **Deposit wording.** The trust strip says "Any deposit sits on its own line". ADR-0016 keeps deposit collection feature-flagged off until the PSP and counsel confirm, and `.scratch/monthly-stays/PRD.md:97` says deposits are zero at launch.
   - **(a) Recommended:** keep the line, because it describes how a deposit would be shown, and confirm it is true for the pilot.
   - (b) Remove deposit mentions until deposits exist.
6. **Still open from issue 06, item 5:** approved photography (hero, closing, 2–3 Units with one in Abuja), and the two FAQ answers ("Which areas can I book?", "Is there a fee for using Shortlet?").

## Answer

### Owner approval — 20 Oct 2026

The owner replied **"accept recommendations"** after the session report explicitly recommended options **(a), items 1–5**:

1. Carry the exact first message by POST into a new conversation, with session issuance and the existing beta gate; never put the message in a URL. Implement under issue 14 after the port, preserving existing work and the application's conversation seam.
2. Keep `/welcome` public on staging; sending still meets the same invite gate as `/`.
3. Add **Furnished** to the shortlet glossary as a property of a published Unit, true for every launch Unit. This records approval; the glossary edit has not yet been made.
4. Show only **1–14-night stays** on the landing until counsel signs off. No monthly/1–6-month positioning is approved.
5. Keep **"Any deposit sits on its own line"** as conditional wording. Pilot deposits remain zero at launch; this approves neither collection nor a change to the feature flag or counsel/PSP gates.

**Still open (item 6):** approved real Unit photography and the two FAQ answers. Keep unapproved photography and unanswered FAQ entries off the normal public page. Issue 13 remains `ready-for-human` for those decisions.

**Live-demo exception, subsequently approved on 20 Oct 2026:** the owner wants to use the current photos for live demonstrations before Operator onboarding, and replied **"yes"** to a distinct demo mode labelled **"Demo — illustrative photos, not live listings."** Real bookings and payments remain unavailable for demo inventory. This approves the demo presentation and that exact label, not real Unit publication, new claims about properties, payment collection, unlabelled public stock photography, or the pending FAQ answers. Existing photography approval flags remain false. Issue 11 records the corresponding renderer scope clarification.

The same reply approved fast-forwarding the tracker branch to local `main` (`ad5ad72`), completed without a push or deployment. It did not accept a future ADR draft or authorize later branch merges.

## Comments
