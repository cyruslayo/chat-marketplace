/**
 * The copy of the founding partners page at /partners (landing issue 17). Source: the design file `Xenia Founding Partners
 * Abuja.html` (pass 11, 25 Nov 2026), the owner-approved deck `.scratch/brand/landing-operators-copy.md`, and the Rory
 * Sutherland full-voice rewrite (26 Nov 2026). Strings the demo frames share with the product come from guest-content.ts
 * instead (ADR 0077). Strings marked "New" were written for this build and wait for the owner's approval (issue 17, Comments).
 */

export interface PartnersFaqItem {
  readonly question: string;
  /** Paragraphs and, for one answer, a list between the first paragraph and the last. */
  readonly paragraphs: readonly string[];
  readonly list?: readonly string[];
  readonly open?: boolean;
}

export const PARTNERS_COPY = Object.freeze({
  pageTitle: "Xenia: founding partners in Abuja",
  pageDescription:
    "Xenia is a concierge that answers guests from your verified listing and brings you ready-to-decide booking requests. Apply to be a founding partner in Abuja.",
  brand: "Xenia",
  skip: "Skip to main content",
  nav: {
    label: "On this page",
    how: "How it works",
    payment: "Payment",
    questions: "Questions",
  },
  apply: "Apply to be a founding partner",
  applyShort: "Apply",
  applyLede:
    "Tell us about your apartments. We’ll review your application and contact you about the next steps.",
  illustration: "Illustration",
  plannedApp: "Example · the partner app we’re building with founding partners",
  partnerBrand: "Xenia · Partner",

  hero: {
    eyebrow: "For apartment operators in Abuja",
    headingBefore: "Stop being an unpaid travel agent for people who leave you on ",
    headingAccent: "read.",
    lede: "Most shortlet enquiries aren’t bookings—they’re free research. Xenia answers every question from your verified listing, settles the dates and all-in price upfront, and only interrupts you when a guest is ready to book—for a straight yes or no.",
    note: "You name the exact amount you receive. You approve every stay. No requests after 7:30\u00a0PM\u00a0WAT.",
  },

  problem: {
    eyebrow: "The real bottleneck",
    heading: "A hotel doesn’t win because the rooms are better. It wins because nobody has to haggle at 10\u00a0PM.",
    paragraphs: [
      "You already know how a good Abuja apartment loses a month-long guest. One person asks if next week is free. Another wants a three-week quote, asks for six more photos, asks if diesel is included, and says “let me get back to you.”",
      "Your team spends half the day answering the same five questions—and the chat ends on two blue ticks.",
      "Meanwhile, a consultant flying into Abuja for a month wants three things: one clear price, no transfer to a personal account, and a receipt their employer won’t question. When an apartment can’t give them that quickly, they keep looking.",
      "Good apartments don’t have a quality problem. They have a booking friction problem.",
    ],
    figureLabel: "Example enquiry messages",
    figureTag: "Example",
    messages: [
      "Hi, is the apartment free next week?",
      "What’s the price for three weeks?",
      "I’m comparing four places. Can you send more photos?",
    ],
    figureFoot: "Read 2 days ago",
  },

  guest: {
    eyebrow: "The guest’s side",
    heading: "Notice how far the guest gets before your phone rings once.",
    lede: "In this example, a guest plans a 30-night stay in Wuse—dates, power, Wi-Fi, all-in total—without sending your team a single message. Watch “Where you come in”: you appear only twice. Once to say yes. Once to get paid.",
    stageLabel: "Demo · synthetic listings · nothing is booked",
    stageGroup: "Guest demo",
    stepsLabel: "Demo steps",
    captionGuest: "What the guest sees",
    captionYou: "Where you come in",
    you: "You",
    requestLink: "See the request you receive",
    previous: "Previous",
    next: "Next",
    again: "Start again",
  },

  how: {
    eyebrow: "The deal",
    headingBefore: "We filter out the idle enquiries. ",
    headingAccent: "In return, you answer serious guests in 30 minutes.",
    line: "A good concierge doesn’t flood you with leads. It brings you one guest who already knows your exact price, the dates, and what utilities are included—and wants your dates.",
    requestsHeading: "How requests work",
    minutes: "30",
    minutesText: "minutes to say yes or no",
    held: "The dates are held for that guest while you decide. Decline privately—the guest never sees your reason.",
    nothingBooked:
      "Nothing is booked until you say yes, the guest accepts the final offer, and their payment is confirmed.",
    requestLabel: "Example: the request you receive",
    requestTag: "The request you receive",
    atLaunch: "At launch, we bring each request to you and record your answer.",
  },

  benefits: {
    eyebrow: "What you get",
    heading: "Built for operators who don’t chase.",
    lead: {
      heading: "Name your number. Receive your number.",
      body: "Most platforms quote your rate and then take a bite out of it—so you end up inflating your price and resenting every payout. With Xenia, we agree the exact amount you receive for each apartment and add our margin to the price the guest sees. Our margin is never taken out of your amount. No haggling for “last price.”",
    },
    items: [
      {
        icon: "ready",
        heading: "Requests, not enquiries",
        body: "By the time a stay reaches you, the guest has already committed to where, when, how many people, and the full all-in price. You see a booking request, not a cold chat.",
      },
      {
        icon: "questions",
        heading: "A concierge that never improvises",
        body: "It answers questions about price, location, amenities and dates at any hour using only the verified facts on your listing. It never guesses—anything unusual goes to our team.",
      },
      {
        icon: "decision",
        heading: "Your apartments stay yours",
        body: "You approve or decline every booking request. No auto-accept, no surprise discounts, and your apartments stay under your management.",
      },
      {
        icon: "lengths",
        heading: "Built for 30-to-180-night stays, too",
        body: "Short stays of 1 to 29 nights come standard. Apartments that opt in can also take 1-to-6-month stays priced by the month—with power, fuel and utilities stated upfront so nobody argues in week two.",
      },
      {
        icon: "card",
        heading: "Payment collected before the key turns",
        body: "Guests pay through Xenia by card or bank transfer before a booking is confirmed—never cash at the gate, and never a transfer to someone’s personal account. For stays longer than 30 nights, that payment covers the first 30-night period, and the guest pays each later period as the stay goes on.",
      },
    ],
  },

  side: {
    eyebrow: "Your side",
    heading: "Everything waiting on you, and nothing that isn’t.",
    figureLabel:
      "Example: your partner home in Xenia, showing what is waiting on you across your Abuja apartments",
  },

  payment: {
    label: "Payment",
    eyebrow: "Payment & trust",
    headingBefore: "Your agreed amount, ",
    headingAccent: "24 hours",
    headingAfter: " after check-in.",
    paragraphs: [
      "Guests don’t hesitate to book furnished apartments because they’re cheap—they hesitate because paying a large sum online feels like a leap of faith. Xenia collects the guest’s payment before the booking is confirmed.",
      "Your agreed amount is due 24 hours after the guest gets in, or after the agreed check-in time if that’s later, unless they’ve raised a problem that’s still being resolved. We pay you by bank transfer. The guest has already paid before arriving, so you never chase a payment for a stay.",
    ],
    figureLabel: "Example: payments to you, one row per booking",
    close:
      "Not another classifieds board where you upload photos and hope. A proper booking path—from the first question to a settled bank transfer.",
  },

  founding: {
    eyebrow: "The founding network",
    headingBefore: "We inspect every apartment ",
    headingAccent: "in person",
    headingAfter: "—which is why serious operators should apply.",
    paragraphs: [
      "Any marketplace can promise thousands of listings by letting anyone upload three flattering photos. The result is a race to the bottom where well-run apartments get dragged down by bad ones.",
      "We’re building our first Abuja network the slower way: inspecting every apartment in person, checking authority to let, and onboarding serious operators before we spend anything advertising to guests. Whether you manage two spotless apartments or twenty, you’ll sit in a curated room—not shout in a crowded bazaar.",
    ],
    listHeading: "What founding partners get",
    items: [
      {
        heading: "First in front of launch demand.",
        body: "When our Abuja guest campaigns switch on, founding apartments are the ones we advertise first—and we track which ads bring guests in, so we spend where it works.",
      },
      {
        heading: "A report on how guests find you.",
        body: "You’ll see how many guests viewed and asked about your apartments, and which campaigns brought them.",
      },
      {
        heading: "Lower Xenia margin, agreed up front.",
        body: "A reduced founding margin on your apartments for an agreed period. That keeps your guest-facing price sharper while your own agreed payout stays untouched. We set the terms with you when you join.",
      },
      {
        heading: "A seat at the table for the partner app.",
        body: "At launch we handle requests directly with you; as we build the partner app shown above, you use it first and tell us what actually saves you time.",
      },
    ],
    ctaHeading: "Put your apartments in front of guests who are ready to pay.",
  },

  questions: {
    eyebrow: "Before you apply",
    heading: "Questions",
    items: [
      {
        question: "Do I keep control of my bookings?",
        paragraphs: [
          "Yes. You approve or decline every request, and your apartments stay under your management.",
        ],
      },
      {
        question: "Is the concierge a person?",
        paragraphs: [
          "No. It’s automated software that answers guests using your listing’s verified facts. When a question needs a person, it goes to our team.",
        ],
      },
      {
        question: "How quickly do I need to respond?",
        paragraphs: [
          "Requests reach you between 8:00 AM and 7:30 PM WAT, every day. Each one needs a yes or no within 30 minutes, and the guest’s dates are held while you decide.",
        ],
      },
      {
        question: "How does Xenia make money?",
        paragraphs: [
          "We agree the exact amount you receive for each apartment, and add our margin to the price the guest sees. Our margin is never taken out of your amount: the guest pays one all-in price, and you receive your agreed amount.",
        ],
      },
      {
        question: "What do founding partners get?",
        paragraphs: [
          "A place in our launch ad campaigns, a report on how guests find your apartments, and a lower Xenia margin for an agreed period. We set the terms with you when you join.",
        ],
      },
      {
        question: "When do I get paid?",
        paragraphs: [
          "Your agreed amount is due 24 hours after the guest gets in, or after the agreed check-in time if that’s later, unless they’ve raised a problem that’s still being resolved. We pay you by bank transfer. For stays longer than 30 nights, each later period is due once the guest has paid for it and it has begun. Your dates stay blocked for the whole stay from the first payment.",
        ],
      },
      {
        question: "Do you take longer stays?",
        paragraphs: [
          "Yes. Stays of 1 to 29 nights are standard. Stays of 30 to 180 nights (1 to 6 months) are open to apartments that opt in with a monthly amount and a statement of the utilities included.",
        ],
      },
      {
        question: "What do I need to join?",
        paragraphs: [
          "The bar is intentionally high—because the same check that applies to you is what keeps unreliable listings off the same page as yours. You’ll need:",
          "We inspect every apartment in person before it goes live.",
        ],
        list: [
          "your business’s CAC registration, with details of the people responsible for it;",
          "a business bank account in the same name;",
          "written authority to let each apartment as a short-term rental;",
          "any FCT licences or registrations that apply;",
          "the required insurance;",
          "someone who can answer requests between 8:00 AM and 8:00 PM WAT every day, and a backup.",
        ],
      },
      {
        question: "How do I manage requests?",
        paragraphs: [
          "At launch, we bring each request to you as soon as it arrives and record your answer. The partner app shown on this page is what we’re building with founding partners.",
        ],
      },
      {
        question: "Are guests booking yet?",
        paragraphs: [
          "Not yet—deliberately. There is no worse mistake than inviting guests to an empty table. We’re inspecting and onboarding our founding Abuja apartments first, so when our guest campaigns begin, every guest meets real, verified inventory from day one.",
        ],
      },
      {
        question: "What happens after I apply?",
        paragraphs: [
          "We’ll contact you to discuss your apartments, arrange an inspection, and agree the amount you receive.",
        ],
      },
    ] satisfies readonly PartnersFaqItem[] as readonly PartnersFaqItem[],
  },

  closing: {
    heading: "You already did the hard part: building an apartment worth staying in.",
    lede: "Don’t lose the guest in a WhatsApp thread.",
    place: "Starting in Abuja.",
  },

  join: {
    eyebrow: "How to join",
    heading: "How to join.",
    steps: [
      "Apply and tell us about your apartments.",
      "We inspect in person and agree the amount you receive.",
      "Your apartments go live with the facts we checked.",
      "You answer requests; we handle the offer and payment.",
    ],
  },

  form: {
    fullName: "Full name",
    business: "Business name",
    phone: "Phone",
    phonePlaceholder: "+234 801 234 5678",
    email: "Email",
    area: "Area in Abuja",
    areaEmpty: "Choose an area",
    units: "Number of apartments",
    unitsEmpty: "Choose a range",
    stays: "Stay lengths you offer",
    staysShort: "Up to 29 nights",
    staysMonthly: "1 to 6 months",
    how: "How guests book with you today",
    optional: "(optional)",
    send: "Send application",
    /** New: while the application is being sent. */
    sending: "Sending…",
    notSent: "Not sent.",
    sentHeading: "Application sent.",
    sentBody: "We’ll contact you about the next steps.",
    /** New: the link beside the consent sentence. */
    privacyNotice: "How we use your details",
    /** New: shown in place of the fields while no privacy notice is configured. */
    closedHeading: "Applications open soon.",
    closedBody:
      "We’re finishing our privacy notice first, so we can’t take your details yet. Please come back soon.",
    /** New: the store could not save the application. */
    unavailable:
      "We couldn’t save your application. Nothing was sent. Please try again in a few minutes.",
  },

  footer: {
    place: "Starting in Abuja",
    /** New: the link to the guest landing page (owner decision, 25 Nov 2026: each page links to the other). */
    guestPage: "Looking for a place to stay?",
  },
});

/** One demo step: the stage's own chapter name, its two captions and the summary a screen reader hears for the inert screen. */
export interface PartnersDemoStep {
  readonly name: string;
  readonly guest: string;
  readonly you: string;
  /** True on the two steps that involve the operator. */
  readonly marked: boolean;
  /** True on the step that links to the request card further down the page. */
  readonly link: boolean;
  readonly summary: string;
}

const SUMMARY = "The guest’s screen shows: ";

export const PARTNERS_DEMO_STEPS: readonly PartnersDemoStep[] = Object.freeze([
  {
    name: "Ask",
    guest:
      "They describe the stay in their own words. Their dates and party size become chips they can edit.",
    you: "Nothing yet. No messages for your team to answer.",
    marked: false,
    link: false,
    summary: `${SUMMARY}the guest’s message asking for a furnished place in Wuse or Maitama for a month from 3 December, with reliable power, Wi-Fi and a desk to work at; search chips for Wuse or Maitama, 3 Dec – 2 Jan · 30 nights and 1 guest, and a chip to add a budget; a message box for the city or area, dates and guests.`,
  },
  {
    name: "Matches",
    guest:
      "Only apartments free for their dates, each with one price for the whole stay.",
    you: "Your apartment is shown with the facts we checked together.",
    marked: false,
    link: false,
    summary: `${SUMMARY}the concierge’s reply that three apartments are free for those dates, each priced as the All-In Stay Total for 30 nights; 2-bedroom, Wuse, ₦1,380,000; 1-bedroom, Garki, ₦1,035,000; Studio, Wuse 2, ₦759,000; each marked Demo listing.`,
  },
  {
    name: "Apartment",
    guest: "What’s included, the exact dates and one total, before they ask.",
    you: "The utilities you include are stated up front, so there are no surprises at check-in.",
    marked: false,
    link: false,
    summary: `${SUMMARY}2-bedroom apartment, Wuse, a demo listing with its photo coming soon; 2 bedrooms, 2 bathrooms, sleeps 4; power and generator fuel, water and internet included; cleaning weekly; price for Thu 3 Dec 2026 to Sat 2 Jan 2027, 30 nights, 1 guest, entire place; All-In Stay Total ₦1,380,000; Request to book.`,
  },
  {
    name: "Request",
    guest:
      "They know it’s a request, not a booking, and when they’ll hear back.",
    you: "This is when the request reaches you. You have 30 minutes. The dates are held.",
    marked: true,
    link: true,
    summary: `${SUMMARY}Booking Request sent for 2-bedroom apartment, Wuse, Thu 3 Dec 2026 to Sat 2 Jan 2027; total to complete booking ₦1,380,000 if accepted; not yet a Reservation; the Operator replies by 11:42 AM WAT.`,
  },
  {
    name: "Offer",
    guest:
      "You said yes. They see the final terms and pay through Xenia by card or bank transfer.",
    you: "You don’t collect payment. It’s verified before the stay is confirmed.",
    marked: false,
    link: false,
    summary: `${SUMMARY}Conditional Booking Offer for 2-bedroom apartment, Wuse, Thu 3 Dec 2026 to Sat 2 Jan 2027; total to complete booking ₦1,380,000; it becomes a Reservation only after payment is verified; pay by 11:44 AM WAT; Accept and choose payment.`,
  },
  {
    name: "Confirmed",
    guest:
      "A confirmed Reservation and a receipt they can forward to their employer.",
    you: "We confirm when the guest gets in. 24 hours later, your agreed amount is due.",
    marked: true,
    link: false,
    summary: `${SUMMARY}Reservation confirmed for 2-bedroom apartment, Wuse, Thu 3 Dec 2026 to Sat 2 Jan 2027, booking 0412; stay payment paid ₦1,380,000; offer accepted and payment verified; Download receipt.`,
  },
]);
