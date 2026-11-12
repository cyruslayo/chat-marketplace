# Unassisted task study — protocol

Issue 29 (guideline §13). The owner recruits and runs every session; this document is prepared for them. Use synthetic data only, and never record personal data beyond the consented notes.

## Before the sessions

- **Participants:** at least two Guest profiles and one Operator profile; five participants in total. Include at least one small Android phone on a weak connection, one keyboard-only user and one screen-reader user.
- **Devices:** real phones where possible; the reference device is a low-end Android phone running Chrome.
- **Data:** synthetic listings and a staging or local demo deployment. Never use a real card, phone number, email or booking reference. The published Paystack test card may be used by the owner only; stop participants before card entry.
- **Materials:** a printed observation sheet per participant, the consent script below, and this task list. Do not show the task list to the participant.

## Consent script (read aloud)

> Thank you for helping. We are testing the product, not you. I will ask you to complete some ordinary booking tasks and watch how it goes. Please think aloud if you are comfortable doing so. There are no wrong answers; anything that goes wrong is useful for us.
>
> I will take notes on what you do and say, and may quote you anonymously. I will not record your name, phone number, email, payment details or any real booking. The session takes about 45 minutes and you can stop at any time without giving a reason.
>
> Do you consent to taking part and to anonymous notes and quotes? [record yes/no]

## The nine tasks (guideline §13)

Give the participant an outcome, never a screen name. Do not help unless they are stuck for more than two minutes; record the help.

1. Find an Abuja apartment for stated dates and guests.
2. Compare two results by their true stay total.
3. Identify whether the selected Unit is already reserved.
4. Submit a Booking Request and state what happens next.
5. Explain the difference between an Offer and a confirmed Reservation.
6. Return after a simulated network interruption.
7. Complete an authorized hosted payment handoff without assuming browser return means success.
8. For an Extended Stay, explain the first and later period payments.
9. For an Operator, find the urgent request and make an informed decision.

## Observation sheet

One row per task per participant. Keep **Observed** and **Interpretation** in separate columns.

| Field | How to record |
| --- | --- |
| Participant / profile | An alias only (for example `G1-phone`, `O1-screenreader`) |
| Task number | 1–9 |
| Completed | Yes / No / Assisted |
| Time to complete | Minutes, rounded |
| Wrong turns | Count and one-line description |
| Hesitation | Where, and for how long |
| Misunderstanding | Quote or paraphrase in the participant's words |
| Recovery | What they did after the error; did they recover unaided |
| Quotes | Verbatim where possible, marked `quote` |
| Observed | What happened, without inference |
| Interpretation | What we think it means, marked `interpretation` |

### Per-task prompts to note

1. Did they use the search controls or the conversation? Did they find Abuja without help?
2. Did they compare All-In Stay Totals, or nightly prices? Did the deposit confuse the comparison?
3. Did they say "available", "reserved", "booked", or something else? Did the status words match the page?
4. Could they say what happens next (operator response, offer, payment) after submitting?
5. Could they state the difference in their own words? Did they believe an Offer was a confirmed booking?
6. After the interruption, did they retry, reload, or believe the action was lost? Did the page keep their text?
7. Did they treat returning from Paystack as proof of payment, or check the status?
8. Could they explain the first Billing Period and later periods, and when the later ones are due?
9. Did the Operator find the soonest deadline and state the effect of Confirm and Decline before acting?

## After the sessions

- Transcribe the sheets into `.scratch/ux-guidelines/study/results.md`, keeping evidence apart from interpretation.
- Add new P0 and P1 findings to `.scratch/ux-guidelines/evidence-matrix.md` with an issue number.
- Do not record personal data beyond the consented notes; delete any session recording after transcription.
- Stop before any real card entry. If a session reaches the hosted checkout, the owner uses the published test card only.
