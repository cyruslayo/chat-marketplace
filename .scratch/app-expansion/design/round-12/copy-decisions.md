# Copy Decisions: Round 12

> **Rule (kickoff I4):** Every visible guest string must come from [apps/web-agent/src/guest-content.ts](../../../../apps/web-agent/src/guest-content.ts) (or the Operator copy module). **No `New` or `Brand` string lands in code until the owner fills in `Owner` below.**

## 1. `Brand` and `New` strings awaiting owner approval

All entries from `CopyReview.dc.html` (63 consolidated entries) and every individual board's copy list are included below, grouped by decision/area.

### A. Decision-gated strings (`Brand` & `New`)

| String | Tag | Board(s) | Waits on | Owner |
| --- | --- | --- | --- | --- |
| The concierge is automated software. When a question needs a person, it goes to our team. | Brand | Domains, Help, CopyReview | D13 (second sentence only once D6 is true) | |
| Are you unsafe or locked out? Contact the support team now. | New | Report, CopyReview | D6, D18 | |
| A person on the support team takes it on and replies here. / We ask the Operator to fix it. / If it isn’t fixed in time, a person decides what you are owed under your stay terms. | New | Report, CopyReview | D18 (support rota) | |
| Refund being made. A person on our team pays it. No date is promised yet. | New | Cancel, CopyReview | D16, D20 | |
| If you sent money after the deadline, it will be refunded. A late payment doesn’t confirm the booking. | New | BankTransfer, CopyReview | Pilot refund policy (manual, ADR 0045) | |
| Not available yet. How to ask: Set by the owner (download, delete) | New | Account, CopyReview | guest-accounts 10, D15 | |
| Your plans; Ask about your plans | New | Domains, CopyReview | D10 (and second live domain) | |
| Contact Xenia if you sent money after the deadline; Your Xenia sign-in code is {code} | Brand | BankTransfer, ManualTransfer, SignIn, CopyReview | D14 (code currently says `Shortlet`) | |
| Tolu from the Xenia team (sample name; Language page pattern) | Brand | Report | D14 + Language page | |
| Set by the owner (address, phone, WhatsApp, hours, during a stay, bank details, reply time, cover) | New | Apartment, Help, ManualTransfer, Message, Report, StayBefore | D6, D7, D18, ADR 0090 config | |
| Set by the Events ADR | New | Domains | D2, D12 (Events ADR) | |

### B. `Brand` strings (Language page patterns)

| String | Tag | Board(s) | Waits on | Owner |
| --- | --- | --- | --- | --- |
| Ask the concierge | Brand | Account, Help, SignIn, CopyReview | Brand / Language page approval | |
| Ask about these stays… | Brand | Unavailable | Brand / Language page approval | |
| Photo coming soon (Placeholder card) | Brand | Apartment | Brand / Language page approval | |
| Stay here (Language page pattern) | Brand | Domains | Brand / Language page approval (note: `GUEST_NEW_CONVERSATION.cancel` is already `"Stay here"`) | |
| Find a stay in Abuja; Find a stay in Lagos; I need a place for a month | Brand | Domains | Brand / Language page approval (note: `STAYS_PRESENTATION.emptyState.starters` currently uses `"Explore Abuja"` / `"Explore Lagos"`) | |
| Find a place to stay, and its lede | Brand | Domains | Brand / Language page approval (compare `STAYS_PRESENTATION.emptyState`) | |

### C. `New` strings by surface group

#### Navigation, shell & multi-domain

| String | Tag | Board(s) | Waits on | Owner |
| --- | --- | --- | --- | --- |
| Find · Your stays · Account (tab and side navigation) | New | Account, Help, SignIn, CopyReview | D10, shell (issue 15) | |
| 1 needs your action; 2 need your action | New | Main, StayDuring, CopyReview | Phase 3 (`11`, `15`) | |
| Ask about this stay · these stays · this request · this payment · your stays · changing this stay | New | Change, Compare, Main, Outcomes, Payments, Saved, StayAfter, StayBefore, StayDuring, CopyReview | Phase 3 (`15`) | |
| Close {task}; Help | New | BankTransfer, Cancel, ManualTransfer, PaymentChoice, Report, CopyReview | Phase 2b (`2b-02`) | |
| Show this search as: Concierge, List; Concierge, List (View switch) | New | Unavailable, CopyReview | Phase 3 (Find list) | |
| Loading list… | New | CopyReview | Phase 3 (Find list) | |
| Concierge, Stays. Change concierge | New | CopyReview | Multi-domain (`guest-content.ts` has `"Concierge · ${modeLabel}"` & `"Change concierge"`) | |
| 3 conversation tasks; Current; Planned; Wuse or Maitama, 3 Dec – 2 Jan (task title from the search) | New | Domains, TaskRail, CopyReview | Phase 2b / Task rail | |
| Sample row; What, where and when come from {mode} | New | Domains | D2, D12 (structure demo only) | |

#### Apartment, Compare, Saved & Unavailable

| String | Tag | Board(s) | Waits on | Owner |
| --- | --- | --- | --- | --- |
| Price for your dates | New | Apartment, CopyReview | Phase 2b / 4 | |
| Refundable Security Deposit, separate (code currently `"(separate)"`) | New | Apartment, BankTransfer, Outcomes, PaymentChoice, CopyReview | Copy review (alignment with `GUEST_FACT_LABELS`) | |
| What we checked | New | Apartment, CopyReview | Phase 2b | |
| Cancellation and house rules; The exact terms are shown again before you accept an offer. | New | Apartment, CopyReview | Phase 2b | |
| Not free for these dates; Change dates; Not free for 3 Dec – 2 Jan | New | Apartment, Saved, CopyReview | Phase 2b / 3 | |
| Save; Saved | New | Apartment, CopyReview | Phase 5 (`guest-stays 11, 12`) | |
| Close photos; Previous photo; Next photo | New | Apartment, CopyReview | Phase 2b / gallery | |
| Loading this apartment | New | Apartment, CopyReview | Phase 2b | |
| Totals include every nightly charge and fee for your dates. The deposit is separate and refundable. | New | Compare | Phase 2b | |
| Not listed; Pick one more stay; Choose another stay; … Compare needs two. | New | Compare, CopyReview | Phase 2b | |
| {stay} is not free for these dates; Its facts stay here… | New | Compare | Phase 2b | |
| Saved stays; Saving holds nothing. Add dates to see what is free and your total. | New | Saved, CopyReview | Phase 5 (`guest-stays 11, 12`) | |
| Nothing saved yet; Tap Save on an apartment to keep it here.; Find a stay | New | Saved, CopyReview | Phase 5 | |
| Add dates to see your total; Add dates | New | Saved, CopyReview | Phase 5 | |
| Compare these two (code: `Compare`) | New | Saved, CopyReview | Phase 5 | |
| {stay} removed; Undo | New | Saved, CopyReview | Phase 5 | |
| To remove a stay, open it and tap Saved. Saved stays are on this device until you sign in. | New | Saved, CopyReview | Phase 5 | |
| Loading saved stays | New | Saved | Phase 5 | |
| I can’t answer right now; Your message and your search are kept. You can keep looking without me. | New | Unavailable, CopyReview | Issue 14 | |
| Show as a list; Search as a list; Still not answering; Your message is kept. The list has everything you need to book. | New | Unavailable, CopyReview | Issue 14 | |
| Trying again… | New | Unavailable | Issue 14 | |
| You can search without me. Choose your city, dates and guests. | New | Unavailable | Issue 14 | |
| 3 apartments are free for these dates. | New | Unavailable | Issue 14 / Phase 3 | |

#### Payment choice, Bank transfer, Manual transfer & Outcomes

| String | Tag | Board(s) | Waits on | Owner |
| --- | --- | --- | --- | --- |
| Continue to secure payment (code: `Continue to stay payment · ₦…`); Opening secure payment… | New | PaymentChoice, CopyReview | Phase 2b | |
| Try again, or choose another way to pay before {time}. | New | PaymentChoice, CopyReview | Phase 2b | |
| Show transfer instructions as a link (code currently a button) | New | PaymentChoice | Phase 2b | |
| {n} minutes left (e.g. `16 minutes left`) | New | PaymentChoice, CopyReview | Code already computes `${n} minutes left` in `guest-kit.ts` | |
| Transfer exactly this amount to this account. (old board) | New | BankTransfer | Phase 2b | |
| Exact amount; Getting an account for this booking…; Open your stay | New | BankTransfer, CopyReview | Phase 2b / Phase 4 | |
| Copy booking reference; Uploading receipt…; Go to Your stays | New | ManualTransfer, CopyReview | Phase 2b / Phase 3 | |
| Upload your receipt; Choose a photo or PDF, up to 5 MB; Upload receipt | New | ManualTransfer | Phase 2b (`guest-kit.ts` has `Upload receipt`) | |
| This transfer was declined; We did not see this transfer in our account. | New | ManualTransfer, CopyReview | Phase 2b | |
| If you sent money, keep your receipt and contact us. | New | ManualTransfer, CopyReview | Phase 2b | |
| The total has changed; The total for your dates changed before you sent your request. Nothing was sent.; Review the new total; Keep looking; Was, when you looked | New | Outcomes, CopyReview | Phase 2b | |
| Stay you asked for; Declined at; Expired at; Tried at; Send the request again; See the latest status | New | Outcomes, CopyReview | Phase 2b | |

#### Stay pages, Payments, Report, Change, Cancel & Message (Phase 4 & 5)

| String | Tag | Board(s) | Waits on | Owner |
| --- | --- | --- | --- | --- |
| Loading your stay; We could not find that stay (code: `We could not find that payment link`) | New | StayBefore, StayDuring, CopyReview | Phase 4 (`17`) | |
| You are offline; This is your stay as it was at {time}. Changes may be missing. | New | StayBefore, CopyReview | Phase 4 (`17`) | |
| Refundable Security Deposit collected | New | StayBefore, CopyReview | Phase 4 (`17`) | |
| Before you arrive, and its three lines; Address and access; Shared here when they’re ready | New | StayBefore, CopyReview | Phase 4 (`17`, `21`, D7) | |
| Message the Operator; Questions and small requests; Arrival time and questions | New | StayBefore, StayDuring, Message, CopyReview | Phase 5 (`guest-stays 02, 08–10`) | |
| Payments and receipts; Contract and house rules; Change or cancel | New | StayBefore, Change, Payments, CopyReview | Phase 4 (`17`, `19`, `22`) | |
| Day 12 of 89; Pay this period; Due {date}; Overdue · was due {date} | New | StayDuring, Payments, CopyReview | Phase 4 (`17`, `22`) | |
| 1 of 3 periods paid; All 3 periods paid; Nothing is due. Your Reservation ends on {date}.; Paid {date} | New | StayDuring, Payments, CopyReview | Phase 4 (`17`, `22`) | |
| Report a problem; Power, water, access, safety; Report a problem with your stay | New | StayDuring, Help, Report, CopyReview | Phase 4 (`20`) | |
| Next cleaning; Weekly; Extend or end stay; Address, check-in and house rules | New | StayDuring, CopyReview | Phase 4 (`17`, `23`) | |
| A person is handling your report; Open report | New | StayDuring, Help | Phase 4 (`20`) | |
| Past stay; Cancelled | New | StayAfter, Change | Phase 4 (`17`, `18`) | |
| ₦50,000, being returned / returned {date} / on hold | New | StayAfter, CopyReview | Phase 4 (deposit claims / ADR 0089 zero deposit) | |
| The Operator has made a claim on your deposit. Answer by {time}.; Read and answer the claim | New | StayAfter, CopyReview | Phase 4 / deposit claims | |
| Review this stay; Open until {date}; Review sent; Review closed; Your review goes to the Operator, who may answer once. Reviews are not shown on listings yet. | New | StayAfter, CopyReview | Phase 5 (`guest-stays 05–07`) | |
| Find this apartment again; Check new dates; Receipt; For your records or an expense claim | New | StayAfter, CopyReview | Phase 4 (`17`, `22`) | |
| Refundable Security Deposit collected, separate | New | Payments | Phase 4 (`22`) | |
| Receipts; Receipt · Billing Period 1; No receipts yet. One appears here after each payment is verified. | New | Payments, CopyReview | Phase 4 (`22`), D19 | |
| The receipt could not be downloaded; Your payment is not affected. Try again.; Downloading receipt… | New | Payments, CopyReview | Phase 4 (`22`) | |
| What is wrong?, and four choices (ADR 0061 categories); When did it start?; What happened? (optional) | New | Report, CopyReview | Phase 4 (`20`) | |
| Leave out phone numbers and other people’s names.; Choose what is wrong. | New | Report, CopyReview | Phase 4 (`20`) | |
| Send report; Sending report…; Your report was not sent; What you wrote is kept on this device… | New | Report, CopyReview | Phase 4 (`20`) | |
| Report sent; We have your report; Reply to Tolu; Send reply; Report closed; This report is closed | New | Report, CopyReview | Phase 4 (`20`) | |
| Your report is kept with this stay. The concierge won’t answer for the team while a person is handling it. | New | Report, CopyReview | Phase 4 (`20`, ADR 0076) | |
| Change dates or guests; Up to 24 hours before check-in; Less than 24 hours to check-in. Ask the concierge. | New | Change, CopyReview | Phase 4 (`19`), D17 | |
| Extend your stay; You see the last day and what is due first; You see the exact refund first | New | Change, CopyReview | Phase 4 (`19`), D17 | |
| A change is complete only when it is accepted and any payment is verified. Until then your booking stays as it is. | New | Change, CopyReview | Phase 4 (`19`) | |
| A change is waiting; See the change; Cancelled; This Reservation was cancelled on {date}. It can’t be changed.; See your refund | New | Change | Phase 4 (`19`) | |
| Cancel reservation; Keep reservation; Your refund if you cancel now · Flexible terms; Kept under your terms | New | Cancel, CopyReview | Phase 4 (`18`), D16, D20 | |
| Refundable Security Deposit, returned separately; Your cancellation terms, with three dated lines | New | Cancel | Phase 4 (`18`) | |
| This can’t be undone; Your dates are released and other guests can request them.; Cancelling… | New | Cancel, CopyReview | Phase 4 (`18`) | |
| Your refund changed while you were viewing it…; Your reservation was not cancelled; Nothing has changed… | New | Cancel, CopyReview | Phase 4 (`18`) | |
| Cancelled; Your dates are released.; Refund made; Paid on {date}, reference {reference}. | New | Cancel | Phase 4 (`18`), D20 | |
| No messages yet. Ask about arrival, parking or anything in the apartment. | New | Message | Phase 5 (`guest-stays 02, 08–10`) | |
| A message never changes your dates, price or guests. Phone numbers and emails are hidden, and links are not sent. | New | Message, CopyReview | Phase 5 | |
| Your message; Send message; Sending…; Sent; Read | New | Message | Phase 5 | |
| A phone number was hidden; Your message was sent without it…; Your message was not sent; It is kept below… | New | Message, CopyReview | Phase 5 | |
| This stay has ended, so messages are closed. You can still read them.; Reply time: Set by the owner | New | Message, CopyReview | Phase 5 | |

#### Account, Sign-in & Help

| String | Tag | Board(s) | Waits on | Owner |
| --- | --- | --- | --- | --- |
| This device; Another device; Now; Your data; Download my data; Delete my account; Privacy and terms | New | Account, SignIn, CopyReview | guest-accounts 10, D15 | |
| Open your stay; Back to Find; Checking code… | New | SignIn, CopyReview | Phase 2b / 3 | |
| Where is my booking?; See every request and stay; Change or cancel a stay; Payments and receipts | New | Help, CopyReview | Phase 3 (Help) | |
| Talk to a person; Phone; WhatsApp; Hours; During a stay | New | Help, CopyReview | D6 | |
| How booking works; Cancellation terms; How we check apartments; Privacy and terms | New | Help, CopyReview | Phase 3 (Help) | |

---

## 2. `Code` string verification against `apps/web-agent/src/guest-content.ts`

Every string tagged `Code` on the boards was programmatically checked against `apps/web-agent/src/guest-content.ts` and the rest of `apps/` + `domains/`.

### A. Truly missing or mismatched in `guest-content.ts` (and codebase)

| Board | String tagged `Code` | Finding |
| --- | --- | --- |
| `Account` | `Sign out everywhere, and its sentence` | Exists in `guest-content.ts` (`signOutEverywhere`, `signOutEverywhereIntro`) — compound board note only. |
| `Account` | `Change email, its sentence, Send code to new email` | Exists in `guest-content.ts` (`changeEmailHeading`, `changeEmailIntro`, `changeEmailButton`) — compound board note only. |
| `Apartment` | `Photo 1 of 7` | **Mismatch:** `listing-gallery.ts` / `guest-kit.ts` use `1 / 7` (or `Photos: 7` in `GUEST_FACT_LABELS`), not `"Photo 1 of 7"`. |
| `Apartment` | `Show all 7 photos` | **Not in `guest-content.ts`:** hardcoded in `apps/local-guest/src/listing-gallery.ts`, `client.ts`, and `guest-server.ts`. |
| `Apartment` | `Photos of {title}`, `Photo of {title}`, `Photo unavailable` | **Not in `guest-content.ts`:** defined in `apps/local-guest/src/listing-gallery.ts` (and `guest-kit.ts`). |
| `Apartment` | `Request to book` | **Not in `guest-content.ts`:** appears in `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (CTA copy), not in `guest-content.ts`. |
| `Apartment` | `All-in · 30 nights` | **Mismatch:** `guest-kit.ts` uses `GUEST_FACT_LABELS.allInStayTotal` / `stayTotalLabel(true, 30)` (`"All-In Stay Total for 30 nights"`), not `"All-in · 30 nights"`. |
| `Apartment` | `This stay is no longer available for your dates and party size. Please choose another stay.` | **Not in `guest-content.ts`:** lives in `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`. |
| `BankTransfer` | `Next: Refundable Security Deposit` | **Not found anywhere in `apps/` or `domains/`.** (`BankTransfer` / `StayBefore` board assumes a deposit split transfer step that does not exist in code.) |
| `BankTransfer` | `Your transfer arrived and your Reservation is confirmed.` | **Not found anywhere in `apps/` or `domains/`.** |
| `BankTransfer` | `Bank transfer payment`, `Waiting for your transfer`, `Your transfer is processing`, `Transfer account expired`, `Payment arrived after the deadline`, `Transfer the exact amount to {bank}, account {number}…`, `Your bank has started the transfer…`, `Stay payment received. Continue with the separate Refundable Security Deposit transfer.`, `The transfer account expired. No Reservation was made.`, `Your payment arrived after the deadline, so no Reservation was made. Refund of the full amount: recorded as pending.` | **Not in `guest-content.ts`:** these live in `apps/web-agent/src/bank-transfer-a2ui.ts`, `apps/local-guest/src/guest-server.ts`, and `domains/shortlet/src/bank-transfer.ts` (and `Copy account number` / `Account number copied` / `Copying is not available…` live in `apps/local-guest/src/payment-page.ts` / `guest-kit.ts`). |
| `BankTransfer` | `Bank transfer can't start, and its message` | **Not in `guest-content.ts`:** lives in `apps/local-guest/src/guest-server.ts` (exact wording differs; board text says `"No transfer account was issued…"`). |
| `Compare` | `Compare stays` | **Not in `guest-content.ts`:** lives in `shortlet-app.ts`, `shortlet-renderers.ts`, `scripted-assistant-model.ts`. |
| `Compare` | `Flexible`, `Standard` | **Not in `guest-content.ts`:** cancellation tier names live in `domains/shortlet/src/quote.ts`. |
| `ManualTransfer` | `Transfer and upload your receipt`, `Transfer and upload by {time}`, `Booking reference`, `Include the booking reference with your transfer…`, `Copy account number`, `That file is too large…`, `Upload a photo (JPEG or PNG) or a PDF of your receipt.`, `Choose a receipt file to upload.`, `Waiting for payment check`, `Receipt received · not confirmed yet`, `We will check by {time}`, `We received your receipt. Your dates are held until then. No Reservation exists yet.`, `The deadline has passed, so the receipt was not accepted. No Reservation was made.`, `Manual bank transfer can't start, and its message` | **Not in `guest-content.ts`:** all live in `apps/local-guest/src/guest-server.ts` / `guest-kit.ts` / `payment-page.ts` (only `Manual bank transfer` is in `GUEST_PAYMENT_COPY.manual`). |
| `ManualTransfer` | `Not received`, `Amount doesn't match` | **Not in `guest-content.ts`:** Operator decline reasons live in `domains/shortlet/src/manual-transfer.ts` and `apps/local-owner/src/local-owner-server.ts`. |
| `Outcomes` | `Request declined`, `Request expired`, `Request could not be delivered`, `This offer has expired`, `Conditional Booking Offer expired`, `Offer no longer current`, `Find other stays`, `No payment was taken.` | **Not in `guest-content.ts`:** split across `apps/web-agent/src/booking-presentation.ts`, `offer-presentation.ts`, `request-presentation.ts`, `apps/local-guest/src/guest-kit.ts`, `shortlet-app.ts`, `conversational-shell.ts`. |
| `Outcomes` | `No payment was taken. No Reservation was made from this offer.` | **Mismatch:** `offer-presentation.ts` emits `"No payment was taken. No Reservation was made from this offer."` by concatenating `"No payment was taken. "` + `guestReservationStatus("offer-closed")`, rather than a single constant in `guest-content.ts`. |
| `PaymentChoice` | `Pay by {time}`, `Payment method`, `Required to start hosted card checkout…`, `No payment was taken.`, `Your bank transfer is still open` | **Not in `guest-content.ts`:** live in `guest-kit.ts`, `guest-server.ts`, `shortlet-app.ts`, `booking-presentation.ts`. |
| `Payments` | `Payment being checked`, `We’re checking the payment result. Don’t submit another payment while it’s pending.` | **Not in `guest-content.ts`:** hardcoded in `apps/web-agent/src/payment-presentation.ts`. |
| `TaskRail` | `Task statuses come from the pack` | Descriptive spec note on `TaskRail.dc.html`, not a literal string. |

> **Action for Phase 2b / I4:** Centralise the `Code` strings currently living in `guest-server.ts`, `listing-gallery.ts`, `payment-page.ts`, `bank-transfer-a2ui.ts`, `offer-presentation.ts`, and `payment-presentation.ts` into `guest-content.ts` before porting those screens, and treat `Next: Refundable Security Deposit`, `Your transfer arrived and your Reservation is confirmed.`, `Photo 1 of {n}`, and `All-in · {n} nights` as unapproved mismatches until resolved.
