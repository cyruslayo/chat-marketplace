# Fact Map: Round 12 Boards → Branch Projections, Routes, Commands & ADRs

> **Rule (kickoff I1 & I5):** Every fact and action on a board must trace to a server-owned projection, route, or command on this branch (`feat/app-expansion`). Anything not wired in `apps/local-guest/` (even if an uncomposed in-memory domain class exists in `domains/shortlet/`) is marked **`missing`** (or **`missing in apps (domain only)`**) — never invented.

---

## 1. Board assumptions that differ from the backend

1. **₦50,000 Refundable Security Deposit (`Apartment`, `Compare`, `PaymentChoice`, `BankTransfer`, `ManualTransfer`, `Outcomes`, `StayBefore`, `Payments`, `Cancel`, `StayAfter`):** The boards show a ₦50,000 (or ₦100,000) deposit line everywhere "so the line is visible everywhere". Pilot bookings use **₦0 deposit** (`ADR 0089`, `decisions.md D32`), and `priceBreakdownHtml` omits the deposit row when `refundableSecurityDepositKobo <= 0` (`apps/local-guest/src/guest-kit.ts:167-170`). Boards also invent a split `"Next: Refundable Security Deposit"` transfer step (`BankTransfer`, `StayBefore`) that assumes a separate deposit payment is owed.
2. **"Xenia" guest branding (`Main`, `Domains`, `BankTransfer`, `ManualTransfer`, `SignIn`, `Report`, `Account`, `Help`):** Guest-facing copy on this branch still says `Shortlet` (`GUEST_ACCOUNT_COPY.brandName`, `GUEST_PAYMENT_COPY.lateReview`). Rename waits on **D14**.
3. **Events, Services, Community (`Domains`):** Placeholder structure only (**D2**, **D12**). Only Stays ships; commerce stays off (`ADR 0104`).
4. **Example data & unstaffed placeholders:** Dates (`Thu 3 Dec 2026`, `Thu 26 Nov 2026`), `"Day 12 of 89"`, `"Tolu from the Xenia team"`, `"Local Demo Bank"`, `"SL-67J8NRV7"`, and `"Set by the owner"` values are illustrative board placeholders — never a data source.
5. **Active Hours & Payment Window:** Operator Active Hours (8:00 AM–7:30 PM WAT, 10:55 AM same-day cutoff, `ADR 0041/0042`) and the 20-minute Payment Window from Operator confirmation (`ADR 0044`) govern request submit and payment availability even when boards omit them.
6. **Manual refunds (`BankTransfer`, `Cancel`, `Payments`):** Pilot refunds are manual (`docs/policy/shortlet-pilot-payments.md`, `D4`, `D28`), not automated.

---

## 2. Element-by-element map across all 22 product/shell boards

*(Meta boards `Handover.dc.html` and `CopyReview.dc.html` hold handover notes and copy tables only; see `issues/08-design-round-12.md` and `copy-decisions.md`.)*

### `Main.dc.html` (App bar, short phones & shell)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| App bar wordmark & mode label (`Concierge · Stays`) | `GUEST_MODES.stays.label`, `appBarHtml` (`ui-kit.ts`), `presentationFor` (`shortlet-app.ts`) | 0077, 0107 | exists |
| Help link in App bar | Route `/help` | 0080 | **missing** (no `/help` route in `guest-server.ts` yet; issue 16) |
| Tab bar (`Find`, `Your stays`, `Account`) | Routes `/`, `/plans`, `/account` | 0080, 0093 | **partial** (`/` & `/account` exist; `/plans` missing — issue 11; tab bar missing — issue 15) |
| Tab bar action-needed badge (`1 needs your action`) | `shortletApp.committedWork` / `GET /api/committed-work` (`apps/local-guest/src/shortlet-app.ts`, `guest-server.ts`) | 0071, 0079 | **partial** (`committedWork` lists live stays; `needs_action` group/badge count missing — issue 10) |
| Ask bar (`Ask about this request` → Composer link) | Navigation to `/` or `/conversation` with thread/context | 0079, 0080 | **missing** (issue 15) |
| Waiting screen (`Waiting for the Operator`, deadline, steps) | `BookingRequestArtifact`, `requestScreenContent` (`request-presentation.ts`), `requestScreenHtml` (`guest-kit.ts`) | 0005, 0041, 0077 | exists |

### `Domains.dc.html` (More than one domain)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Mode label switcher (`Change concierge`) & `<dialog>` chooser | `GUEST_MODE_CHOOSER`, `mode-choice.ts`, `shortlet-app.ts` (`modeFor`, `restoredModeSuggestion`) | 0107 | exists (multi-mode dialog variant is new in `2b-05`) |
| Starters (`Explore Abuja` / `Explore Lagos`) | `ModePresentation.emptyState.starters` (`guest-content.ts`) | 0107 | exists |
| Tier C switch suggestion (`Switch to Concierge · Events`) | `GUEST_MODE_SUGGESTION`, `restoredModeSuggestion` (`shortlet-app.ts`) | 0107 | exists |
| Switch divider (`You're now talking to Concierge · Events`) | `guestModeSwitchAnnouncement` (`guest-content.ts`), `mode-announcement.ts` | 0107 | exists (divider UI new in `2b-05`) |
| `Your plans` grouped list (`Stays`, `Events`, `Sample row`) | `AssistantDomainPack.planRows` (proposed); `/plans` route | 0099, 0107 | **missing** (issues 10, 11; Events rows out of scope per D2/D12) |
| Automation notice (`The concierge is automated software.`) | Copy waits on D13 | 0075 | **missing** |

### `Apartment.dc.html` (Apartment, gallery and photo viewer)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Back to results | `BACK_TO_RESULTS_EVENT` (`shortlet-app.ts`) / `GET /stays/search?...` | 0080 | exists |
| 6-step Journey rail (`Step 2 of 6 · Stay`) | `projectJourney` (`journey-rail.ts`), `railHtml` (`guest-kit.ts`) | 0005, 0077 | exists (compact mobile variant `2b-02`) |
| Gallery photos & count (`1 / 7`, `Show all 7 photos`, fullscreen viewer) | `Unit.photoUrls`, `listingGalleryHtml` (`listing-gallery.ts`), `GET /stays/:id/photos` (`gallery-page.ts`) | 0066, 0078 | exists (fullscreen viewer markup/controls `2b-04`) |
| Demo listing badge | `config.demo`, `demoListingChipHtml` (`guest-kit.ts`) | 0105 | exists |
| Save / Saved toggle button | Saved-stays store / command | – | **missing** (Phase 5: `guest-stays 11, 12`) |
| Unit title, area (`Wuse, Abuja · Entire place`), bedroom/power/workspace tiles | `UnitDetailArtifact.facts`, `unitTilesHtml` (`guest-kit.ts`) | 0007, 0066 | exists |
| Unavailable state (`Not free for these dates`, `Change dates`) | `isEligibleUnit` / `createStayQuote`, availability check in `shortlet-app.ts` / `guest-server.ts` | 0039, 0055 | exists (`Change dates` chip/redirect) |
| Check-in / Check-out / nights / All-In Stay Total | `StayQuote.allInStayTotalKobo`, `priceBreakdownHtml` (`guest-kit.ts`) | 0015, 0092 | exists |
| Refundable Security Deposit (`₦50,000` on board) | `StayQuote.refundableSecurityDepositKobo` | 0016, 0089 | exists (0 in pilot per ADR 0089 / D32) |
| Exact address (`Set by the owner`) | `findArrivalDataByContractId` (`fixture.ts` returns `null`); `failClosedArrivalDisclosurePolicy` (`arrival-disclosure-policy.ts`) | 0066, 0085 | **missing** (returns `null`, blocked on D7) |
| What we checked (inspection scope & date) | `guestInspectionDisclosure` (`guest-content.ts`), `Unit.inspection` | 0008, 0009, 0056 | exists |
| Cancellation and house rules summary | `cancellationPolicy.summary`, `guestConductRules` | 0014, 0058, 0059 | exists |
| `Request to book` primary action | `REQUEST_TO_BOOK_EVENT` (`shortlet-app.ts`) / `POST /stays/:id/request` (`guest-server.ts`) | 0005, 0080 | exists |

### `Compare.dc.html` (Compare two stays)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Back to results & criteria summary (`3 Dec – 2 Jan · 30 nights · 1 guest`) | `COMPARE_BACK_EVENT`, `DiscoverySearchContext` (`shortlet-app.ts`, `guest-projection.ts`) | 0074 | exists |
| Stays comparison facts (Total, Deposit, Area, Bedrooms, Power, Workspace, Cancellation) | `compareArtifactToA2UI`, `COMPARE_UNIT_EVENT` (`shortlet-app.ts`, `shortlet-renderers.ts`) | 0015, 0066, 0102 | exists (`Not listed` / unavailable-stay row updates in `2b-04`) |
| `Price changed` notice & `Pick one more stay` / `Choose another stay` | Re-quoted `DiscoveryArtifactProjection` | 0015, 0074 | **partial** (stale/price refresh exists; single-stay partial compare copy is new) |
| `View apartment` per column | `REQUEST` / `viewUnit` event in `shortlet-app.ts`, `GET /stays/:id` | 0080 | exists |

### `PaymentChoice.dc.html` (Payment choice)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Close / Help task bar | Back to conversation / `/help` | 0080 | **partial** (`/help` missing) |
| Step 5 of 6 · Pay & countdown banner (`Pay by 11:44 AM WAT · 16 minutes left`) | `CardPaymentArtifact.facts.paymentWindowExpiresAt`, `deadlineBannerHtml` (`guest-kit.ts`) | 0044, 0078 | exists |
| Card checkout error / Bank transfer open / Payment not confirmed banners | `GUEST_PAYMENT_CALLBACK_COPY`, `GUEST_PAYMENT_COPY`, `guest-server.ts`, `paymentScreenHtml` | 0046, 0047, 0077 | exists (`Show transfer instructions` as link vs button in `2b-01`/`2b-06`) |
| `This payment`, `Refundable Security Deposit`, `Total to complete booking` | `priceBreakdownHtml` (`guest-kit.ts`), `CardPaymentArtifact.facts` | 0015, 0016, 0089 | exists (deposit 0 in pilot) |
| Radio group: `Card`, `Bank transfer`, `Manual bank transfer` | `paymentChoiceHtml` (`guest-kit.ts`), `POST /payments/offers/:id` (`guest-server.ts`) | 0080, 0087, 0088, 0090 | exists |
| Email address field (card only) | `shortlet.guest-contact.submit-email`, `GuestContactApplication`, `/payments/offers/:id/continue` | 0049, 0093 | exists |
| `Continue to secure payment` button | `CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT`, `POST /payments/offers/:id` | 0049, 0087 | exists |

### `BankTransfer.dc.html` (Bank transfer)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Exact amount, total, deposit, Pay by deadline | `BankTransferPaymentApplication`, `bank-transfer-a2ui.ts`, `payment-page.ts` | 0044, 0047, 0088 | exists (deposit 0 in pilot) |
| `Next: Refundable Security Deposit` & split transfer message | – | 0016, 0089 | **missing** (pilot has 0 deposit; split transfer copy not in codebase) |
| Bank, Account name, Account number, `Copy account number` | `BankTransferSession` (`bank-transfer.ts`), `bankDetailsCardHtml` (`guest-kit.ts`) | 0047, 0088 | exists |
| Transfer states (waiting, processing, expired, late-payment pending refund, can't start, confirmed) | `GET/POST /payments/offers/:id/transfer`, `PaystackPayments` webhook | 0045, 0047 | exists |
| `Open your stay` button (on confirmed) | Route `/plans/:id` or `/bookings/contracts/:id` | 0080 | **partial** (`/bookings/contracts/:id` or offer route exists; `/plans` stay page is Phase 4 `17`) |

### `ManualTransfer.dc.html` (Manual transfer with receipt upload)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Exact amount, deposit, `Transfer and upload by` deadline | `ManualTransferManager` (`manual-transfer.ts`), `guest-server.ts` `/payments/offers/:id/manual-transfer` | 0044, 0090 | exists (deposit 0 in pilot) |
| Bank, Account name, Account number (`Set by the owner`), Booking reference + copy | `ManualTransferAccount` (`manual-transfer-account.ts`), `bankDetailsCardHtml` | 0090 | exists (account values come from env/config) |
| Receipt upload (`<input type="file">`, JPEG/PNG/PDF up to 5 MB) | `uploadCardHtml` (`guest-kit.ts`), `multipart.ts`, `ReceiptBlobStore` | 0090 | exists |
| Receipt received (`Waiting for payment check`), Declined (`Not received` / `Amount doesn't match`), Expired, Can't start (8 AM–8 PM WAT) | `ManualTransferManager`, `local-owner-server.ts` verification, `guest-server.ts` | 0041, 0090 | exists |
| `Go to Your stays` action | Route `/plans` | 0080 | **missing** (issue 11) |

### `Outcomes.dc.html` (Declined, expired and stale)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Request declined / Request expired / Request could not be delivered | `BookingRequestArtifact`, `requestScreenContent` (`request-presentation.ts`) | 0041, 0043 | exists |
| Offer expired / Offer no longer current | `ConditionalOfferArtifact`, `offerScreenContent` (`offer-presentation.ts`) | 0044, 0074 | exists |
| Price changed before send (`The total has changed`, `Was, when you looked`) | `RequestDraftArtifact`, `proposeDraftReplacement` (`draft-replacement.ts`, `shortlet-app.ts`) | 0015, 0074 | **partial** (draft replacement exists; `Was, when you looked` comparison row is new) |
| `Send the request again` / `See the latest status` / `Find other stays` | `shortlet-app.ts`, `guest-server.ts` | 0080 | **partial** (`Find other stays` & `Back to your conversation` exist; `Send the request again` route/command is new) |

### `StayBefore.dc.html` (Stay page, before)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Offline cached banner (`You are offline`) | – | 0078 | **missing** (no service worker / offline snapshot cache on branch) |
| `Next: Refundable Security Deposit` banner & pay CTA | `CardPaymentStatus === "deposit_required"` | 0016, 0089 | exists in type, unused in 0-deposit pilot |
| Stay ticket (dates, nights, guests, booking reference, deposit collected, stay payment paid) | `stayTicketHtml`, `priceBreakdownHtml`, `BookingContractArtifact` (`confirmation-presentation.ts`) | 0005, 0015, 0077 | exists |
| `Before you arrive` 3 steps | `confirmationSteps` (`confirmation-presentation.ts`) | 0085 | exists |
| `Address and access` (`Set by the owner` / `Shared here when they're ready`) | `findArrivalDataByContractId` (`fixture.ts` returns `null`), `ArrivalDisclosurePolicy` (`arrival-disclosure-policy.ts`) | 0066, 0085 | **missing** (returns `null`, blocked on D7 / issue 21) |
| `Message the Operator` row | – | 0075 | **missing** (Phase 5: `guest-stays 02, 08–10`) |
| `Payments and receipts` row | `GET /bookings/periods/:offerId` (Extended Stay schedule only) | 0092 | **partial** (schedule exists for Extended Stays; receipts & Short Stay payments page missing — issue 22, D19) |
| `Contract and house rules` row | `BookingContractArtifact.facts.cancellationPolicy`, `guestConductRules` | 0058, 0059 | exists (inline on contract page; dedicated sub-view/anchor in issue 17) |
| `Change or cancel` row | `CancellationApplication` / `BookingAmendmentApplication` | 0058, 0060 | **missing in apps** (unwired in-memory domain classes; Phase 4 issues 18, 19) |

### `StayDuring.dc.html` (Stay page, during)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Day 12 of 89 · Ikoyi, Lagos` | Derived from `BookingContract.checkIn` / `checkOut` + clock | 0092 | **missing** (not projected on `confirmationContent` yet — issue 17) |
| Active report banner (`A person is handling your report`, `Open report`) | `MidStayFailureApplication` (`mid-stay-failure.ts`), `human-risk-review.ts` | 0061, 0076 | **missing in apps** (in-memory domain only, no guest route — issue 20) |
| `Next payment · Billing Period 2` (`Due`, `Overdue`, `Pay this period`, `All 3 periods paid`) | `BillingPeriodProjection`, `period-payment.ts`, `POST /payments/periods/:offerId/:index` | 0092 | exists (needs unified stay-page panel — issue 17, 22) |
| `Report a problem` row | `MidStayFailureApplication` | 0061 | **missing in apps** (issue 20) |
| `Message the Operator` row | – | 0075 | **missing** (Phase 5) |
| `Next cleaning · Weekly` row | `Unit.utilitiesIncluded` / `extendedStayUnitFacts` | 0092 | **partial** (text utility policy exists; structured next-cleaning date is **missing** — issue 23) |
| `Payments and receipts` (`1 of 3 periods paid`) | `BillingPeriodProjection` | 0092 | **partial** (schedule exists; receipts missing — issue 22) |
| `Address, check-in and house rules` row | `findArrivalDataByContractId` (`null`) + `guestConductRules` | 0085 | **missing** (address/access blocked on D7 — issue 21) |
| `Extend or end stay` row | `NoticeToEndManager` (`/bookings/notice/:id`), `ExtendedStayExtensionManager` | 0092 | exists (for Extended Stays; unified `Change or cancel` / link in issue 19) |

### `StayAfter.dc.html` (Stay page, after)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Past stay` / `Cancelled` status | `Reservation.status` (`checked_out` / `cancelled`) | 0058 | **partial** (no dedicated past-stay page projection yet — issue 17) |
| `Security Deposit Claim` banner (`Read and answer the claim`) | `DepositClaimApplication` (`deposit-claim.ts`), `GUEST_DEPOSIT_CLAIM_COPY` | 0017–0020 | **missing in apps** (`DepositClaimApplication` not composed in `apps/local-guest`; deposit 0 in pilot per ADR 0089 / D32) |
| `Stay payment paid` & `Refundable Security Deposit` (`being returned` / `returned` / `on hold`) | `InMemorySecurityDepositAccountingRepository` | 0016, 0089 | **missing in apps** (deposit 0 in pilot; post-stay deposit refund state not projected to guest page) |
| `Receipt` (`For your records or an expense claim`) | – | 0089 | **missing** (waits on counsel D19 — issue 22) |
| `Review this stay` (`Open until`, `Review sent`, `Review closed`, Operator reply) | `VerifiedStayReview` (`verified-stay-review.ts`) | 0066 | **missing in apps** (Phase 5: `guest-stays 05–07`) |
| `Find this apartment again` (`Check new dates`) | `GET /stays/:unitId` | 0080 | exists (link target exists; stay-page row new in issue 17) |
| `Contract and house rules` | `BookingContractArtifact` | 0058, 0059 | exists |

### `Payments.dc.html` (Payments and receipts)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Payment being checked` banner | `isCardPaymentProcessing`, `paymentScreenContent` | 0044 | exists |
| `Receipt could not be downloaded` error banner | – | – | **missing** (no receipt route yet — issue 22, D19) |
| `Next payment · Billing Period N`, `Pay this period`, `1 of 3 periods paid` | `GET /bookings/periods/:offerId`, `POST /payments/periods/:offerId/:index` (`guest-server.ts`) | 0092 | exists |
| `Stay payment paid`, `Refundable Security Deposit collected, separate` | `BookingContractArtifact` / `CardPaymentArtifact` | 0016, 0089 | exists (deposit 0 in pilot) |
| `Receipts` (`Receipt · Billing Period 1`, `No receipts yet`) | – | – | **missing** (waits on counsel D19 — issue 22) |

### `Report.dc.html` (Report a problem, report sent)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Are you unsafe or locked out?` emergency phone/cover | Support contact (`Set by the owner`) | 0030, 0067 | **missing** (waits on D6) |
| `What is wrong?` (4 ADR 0061 categories), `When did it start?`, `What happened?`, `Send report` | `MidStayFailureApplication` (`mid-stay-failure.ts`) | 0061 | **missing in apps** (`MidStayFailureApplication` is in-memory only; no guest route/handler — issue 20) |
| `Your report was not sent` (device draft kept) | – | 0078 | **missing** (issue 20) |
| `Report sent` thread (`Tolu from the Xenia team`, `Reply to Tolu`, 3 steps, `Report closed`) | `MidStayFailureApplication` + `HumanRiskReview` | 0061, 0076 | **missing in apps** (waits on D6, D18 — issue 20) |
| Ask bar hidden while human owns report | Human takeover rule | 0076 | **missing** (issue 20) |

### `Change.dc.html` (Change or cancel)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `A change is waiting` (`See the change`) | `BookingAmendmentApplication` / `ExtendedStayExtensionManager` | 0060, 0092 | **missing in apps** (`BookingAmendmentApplication` unwired; extension exists in chat/contract — issue 19) |
| `Cancelled` banner (`This Reservation was cancelled on {date}. It can't be changed.`, `See your refund`) | `CancellationApplication` | 0058 | **missing in apps** (issue 04/05 in rules lane; UI in issue 18/19) |
| `Change dates or guests` (`Up to 24 hours before check-in`) | `BookingAmendmentApplication` (`booking-amendment.ts`) | 0060 | **missing in apps** (issue 19, D17) |
| `Extend your stay`, `Give Notice to End` | `ExtendedStayExtensionManager`, `NoticeToEndManager` (`/bookings/notice/:offerId`) | 0092 | **partial** (Notice page & chat extension exist; unified page link in issue 19) |
| `Cancel reservation` (`You see the exact refund first`) | `CancellationApplication` (`cancellation-noshow.ts`) | 0014, 0058 | **missing in apps** (issue 18, D16) |

### `Cancel.dc.html` (Cancel with refund)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Stay ticket summary & `bookingReference` | `BookingContractArtifact`, `stayTicketHtml` | 0005, 0077 | exists |
| Refund calculation (`Stay payment paid`, `Kept under your terms`, `Refundable Security Deposit, returned separately`, 3 dated ADR 0058 lines) | `CancellationApplication` (`cancellation-noshow.ts`) | 0014, 0058, 0089 | **missing in apps** (unwired in-memory domain class; issue 04/05 + issue 18, D16, D20) |
| Stale refund alert (`Your refund changed while you were viewing it`) | Optimistic version guard | 0072 | **missing in apps** (issue 18) |
| `Cancelled` outcome + manual refund status (`Refund being made` / `Refund made`, date, reference) | Manual refund obligation (`D4`, `D28`) | 0045, 0089 | **missing** (issue 05 + issue 18, D20) |

### `Message.dc.html` (Message the Operator)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Guest ↔ Operator message thread (`Sent`, `Read`, `Reply time: Set by the owner`) | – | 0060, 0075 | **missing** (Phase 5: `guest-stays 02, 08–10`) |
| Contact redaction banner (`A phone number was hidden`), send failure, post-stay closed notice | – | 0075 | **missing** (Phase 5) |

### `SignIn.dc.html` (Sign-in and code)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Sign in` email form & validation (`Enter a valid email address.`) | `GET/POST /account/sign-in`, `renderSignInHtml` (`guest-account-pages.ts`) | 0093 | exists |
| `Enter your code` 6-digit code form, expiry, `Request a new code`, errors | `POST /account/sign-in/code`, `renderSignInCodeHtml`, `GuestAccountRuntime` | 0093 | exists |
| `Sign-in is not available right now` fallback + `Back to Find` | `GUEST_ACCOUNT_COPY.unavailable` | 0080, 0093 | exists (`Back to Find` link target in `2b-02`/`15`) |
| `Signed in` confirmation (`Open your stay`, `Back to your account`) | `guest-account-runtime.ts`, `guest-server.ts` | 0093 | **partial** (`Back to your account` exists; `Open your stay` return-to-stay link is issue 13) |

### `Account.dc.html` (Account)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Your details` (Email confirmed, Phone number, Identity status) | `GET /account`, `renderAccountHtml` (`guest-account-pages.ts`) | 0085, 0093, 0094 | exists |
| `Change email` & `Save phone number` forms | `POST /account/email`, `/account/email/code`, `/account/phone` | 0093 | exists |
| `Where you are signed in` (`This device`, `Another device` + UA/last-seen) | `GuestSession` / `GuestAccountRuntime` | 0093 | **missing** (session list projection not rendered on `/account` yet; only Sign out & Sign out everywhere exist) |
| `Sign out` & `Sign out everywhere` | `POST /account/sign-out`, `POST /account/sign-out-everywhere` | 0093 | exists |
| `Your data` (`Download my data`, `Delete my account` — `Set by the owner`), `Privacy and terms` | – | 0065 | **missing** (`guest-accounts 10`, D15; no `/privacy` route yet) |

### `Help.dc.html` (Help)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Contextual current-stay rows (`Report a problem with your stay`, `Open report`, `Where is my booking?`, `Change or cancel a stay`, `Payments and receipts`) | `committedWork` + stage routes | 0080 | **missing** (issue 16, no `/help` route yet) |
| `Talk to a person` (`Phone`, `WhatsApp`, `Hours`, `During a stay` = `Set by the owner`) | – | 0030, 0067 | **missing** (waits on D6) |
| 4 reading rows (`How booking works`, `Cancellation terms`, `How we check apartments`, `Privacy and terms`) | – | 0014, 0065 | **missing** (issue 16) |
| `The concierge is automated software.` | Copy waits on D13 | 0075 | **missing** |

### `Saved.dc.html` (Saved)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| Saved stays list, empty state, `Undo` removal, `Demo listing` | – | 0105 | **missing** (Phase 5: `guest-stays 11, 12`) |
| Dates / guests criteria chips (`Add dates to see your total`, `Not free for ...`) | `GuestCriteria` (`shortlet-app.ts`), `createStayQuote` | 0015 | **missing** (on Saved page; criteria chips exist on search) |
| `Compare these two` action | `COMPARE_UNIT_EVENT` | 0102 | **missing** (on Saved page) |

### `Unavailable.dc.html` (Concierge unavailable)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Concierge` / `List` view switch | View link to `/stays/search` with shared `GuestCriteria` | 0080, 0106 | **missing** (Phase 3: Find list + issue 14) |
| `I can't answer right now` banner + `Show as a list` + `Try again` (retaining composer text & criteria) | `GUEST_CONTINUE_CONVERSATION.failed` (`guest-content.ts`), `guest-turn-recovery.ts` | 0080, 0106 | **partial** (`guest-turn-recovery.ts` keeps message & retries; fallback-to-list banner/action is issue 14) |
| `Still not answering` banner + `Search as a list` | Route `/stays/search` | 0080 | **missing** (issue 14) |
| Inline list results (`3 apartments are free for these dates`) | `GET /stays/search`, `toDiscoveryProjection` | 0015, 0066 | exists (at `/stays/search`, not yet switched inline from `/` — issue 14/Find list) |

### `TaskRail.dc.html` (Task rail)

| Element | Projection field / Route / Command | ADR | Status |
| --- | --- | --- | --- |
| `Conversation tasks` collapsible toggle + unread/update count (`2 updates`) | `shortletApp.#taskRailFor`, `taskRailHtml` (`guest-kit.ts`), `GUEST_TASK_RAIL` | 0107 | exists |
| Task rows (`Current`, `Searching`, `Offer ready · pay by ...`, `Reservation confirmed`) | `shortletTaskStatus` (`guest-stage.ts`), `PersistedAssistantTask` (`guest-projection.ts`) | 0106, 0107 | exists |

---

## 3. Summary of `missing` fields, routes & commands (branch `feat/app-expansion`)

1. **Shell & Navigation (`Main`, `Domains`, `Help`, `SignIn`):** `/plans` route and grouped rows (`issues/10`, `11`); `needs_action` group & badge count (`issue 10`); Ask bar & Tab bar (`issue 15`); `/help` route, 4 reading pages, and automation sentence (`issue 16`, **D13**); Find View switch (`Concierge`/`List`) and Concierge unavailable list fallback (`issue 14`); `Open your stay` return link (`issue 13`).
2. **Support & Contact (`Help`, `Report`):** Support phone, WhatsApp, hours, and active-stay emergency details (**D6**); report handling & response rota (**D18**).
3. **Arrival & Servicing (`Apartment`, `StayBefore`, `StayDuring`):** Exact address and access instructions (`findArrivalDataByContractId` returns `null`, **D7**, `issue 21`); structured next-cleaning schedule (`issue 23`).
4. **After-Booking Mutations — unwired in `apps/` (`Change`, `Cancel`, `Report`, `StayBefore`, `StayDuring`, `StayAfter`):**
   - `CancellationApplication` (`domains/shortlet/src/cancellation-noshow.ts`) not composed in `apps/` + manual refund status/reference projection (`issues 04, 05, 18`, **D16, D20**).
   - `BookingAmendmentApplication` (`domains/shortlet/src/booking-amendment.ts`) not composed in `apps/` (`issue 19`, **D17**).
   - `MidStayFailureApplication` (`domains/shortlet/src/mid-stay-failure.ts`) not composed in `apps/`, no guest report form/thread or human-takeover Ask-bar suppression (`issue 20`, **D6, D18**).
   - `DepositClaimApplication` (`domains/shortlet/src/deposit-claim.ts`) not composed in `apps/` (deposit is 0 in pilot per `ADR 0089` / **D32**).
5. **Payments & Receipts (`Payments`, `StayBefore`, `StayAfter`, `BankTransfer`, `Outcomes`):**
   - Receipt generation, download route, and error state (`issue 22`, **D19**).
   - Split `"Next: Refundable Security Deposit"` bank transfer step (does not exist in 0-deposit pilot).
   - Offline cached stay snapshot (`StayBefore`).
   - `Send the request again` one-tap retry & `Was, when you looked` old-price field on `Outcomes`.
   - Unified `Day N of M` stay-progress counter on `StayDuring`.
6. **Account (`Account`):** Active-sessions list (`This device`, `Another device`), `Download my data`, `Delete my account` (`guest-accounts 10`, **D15**), and `/privacy` route.
7. **Phase 5 (`Saved`, `Message`, `StayAfter`):** Saved stays store/undo (`guest-stays 11, 12`), Guest–Operator messaging & contact redaction (`guest-stays 02, 08–10`), `VerifiedStayReview` guest UI (`guest-stays 05–07`).
