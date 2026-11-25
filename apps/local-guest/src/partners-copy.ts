/**
 * The copy of the founding partners page at /partners (landing issue 17). Source: the design file `Xenia Founding Partners
 * Abuja.html` (pass 11, 25 Nov 2026) and the owner-approved deck `.scratch/brand/landing-operators-copy.md`. Strings the demo
 * frames share with the product come from guest-content.ts instead (ADR 0077). Strings marked "New" were written for this
 * build and wait for the owner's approval (issue 17, Comments).
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
    "Xenia is a concierge that guests chat with to find and book furnished apartments. Apply to be a founding partner in Abuja.",
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
    headingBefore: "More guests for your apartments, without the ",
    headingAccent: "back-and-forth.",
    lede: "Xenia is a concierge that guests chat with to find and book furnished apartments. It answers their questions from your verified listing, then brings you booking requests that are ready for a yes or no.",
    note: "You agree the amount you receive. You approve every booking.",
  },

  problem: {
    eyebrow: "The problem",
    heading: "Good apartments. Interested guests. Too many messages.",
    paragraphs: [
      "One guest asks if the apartment is free next week. Another wants the price for three weeks. A third wants to compare four places before deciding.",
      "Your team sends photos, checks dates, explains rates, and follows up. Then the chat goes quiet.",
      "Every enquiry takes time, and most of it is the same questions. Your time is better spent on the apartments themselves.",
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
    heading: "This is what your guests see.",
    lede: "Guests describe their stay in their own words. The concierge does the rest, and asks you only for a yes or no.",
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
    eyebrow: "How Xenia helps",
    headingBefore: "Guests tell the concierge what they need. ",
    headingAccent: "You make the decision.",
    line: "When a guest wants your apartment, they send a booking request, and the decision is yours.",
    requestsHeading: "How requests work",
    minutes: "30",
    minutesText: "minutes to say yes or no",
    held: "The dates are held for that guest while you decide.",
    nothingBooked:
      "Nothing is booked until you say yes, the guest accepts the final offer, and their payment is confirmed.",
    requestLabel: "Example: the request you receive",
    requestTag: "The request you receive",
    atLaunch: "At launch, we bring each request to you and record your answer.",
  },

  benefits: {
    eyebrow: "What you get",
    heading: "Built around how you run your apartments.",
    lead: {
      heading: "The amount you agree is the amount you receive",
      body: "For each apartment, we agree the amount you receive. Xenia adds its margin to the price the guest sees, so the guest pays one all-in price and you receive exactly your agreed amount.",
    },
    items: [
      {
        icon: "ready",
        heading: "In front of guests who are ready",
        body: "Guests reach your apartment after they’ve already said where, when and for how long. You see a request, not a cold enquiry.",
      },
      {
        icon: "questions",
        heading: "Fewer repeat questions",
        body: "The concierge answers questions about price, location, amenities and dates from your verified listing, at any hour.",
      },
      {
        icon: "decision",
        heading: "Every booking is your decision",
        body: "You approve or decline each request. Your apartments stay under your management.",
      },
      {
        icon: "lengths",
        heading: "Short stays, and stays of 1 to 6 months",
        body: "Guests can book from 1 night to 29 nights. Apartments that opt in can also take stays of 30 to 180 nights, priced by the month, with a clear statement of which utilities are included.",
      },
      {
        icon: "card",
        heading: "Payment collected before the stay",
        body: "Guests pay through Xenia by card or bank transfer before the booking is confirmed. For stays longer than 30 nights, that payment covers the first 30-night period, and the guest pays each later period as the stay goes on.",
      },
    ],
  },

  side: {
    eyebrow: "Your side",
    heading: "Everything waiting on you, in one place.",
    figureLabel:
      "Example: your partner home in Xenia, showing what is waiting on you across your Abuja apartments",
  },

  payment: {
    label: "Payment",
    eyebrow: "Step 6 · Payment",
    body: "It’s due 24 hours after the guest gets in, or after the agreed check-in time if that’s later, unless they’ve raised a problem that’s still being resolved. We pay you by bank transfer.",
    figureLabel: "Example: payments to you, one row per booking",
    close:
      "Not another listing site where you upload photos and wait. A guided path from the first question to a paid booking, with you deciding the parts that matter.",
  },

  founding: {
    eyebrow: "The founding network",
    headingBefore: "We’re building our ",
    headingAccent: "first",
    headingAfter: " apartment network in Abuja.",
    paragraphs: [
      "We’d like to build it with operators who care about their apartments and the guests who stay in them. Whether you manage two apartments or twenty, we’d like to hear from you.",
      "We’re onboarding apartments first. When our first apartments are live, we’ll start advertising to guests, and founding partners will be listed from day one.",
    ],
    listHeading: "What founding partners get",
    items: [
      {
        heading: "Featured in our launch campaigns.",
        body: "We’ll advertise founding apartments to guests looking for stays in Abuja, and we track which ads bring guests in, so we spend where it works.",
      },
      {
        heading: "A report on how guests find you.",
        body: "You’ll see how many guests viewed and asked about your apartments, and which campaigns brought them.",
      },
      {
        heading: "Founding margin terms.",
        body: "A lower Xenia margin on your apartments for an agreed period. That keeps your guest price more competitive, while you still receive your full agreed amount. We’ll set the terms with you when you join.",
      },
      {
        heading: "Help shape the partner app.",
        body: "You’ll use it first and tell us what to change.",
      },
    ],
    ctaHeading: "Put your apartments in front of the right guests.",
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
          "We agree the amount you receive for each apartment, and add our margin to the price the guest sees. The guest pays one all-in price, and you receive your agreed amount.",
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
        open: true,
        paragraphs: [
          "You’ll need:",
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
          "Not yet. We’re onboarding our first apartments now. Our guest campaign begins once they are live.",
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
    heading: "Good hospitality starts with a good place to stay.",
    lede: "Finding and booking that place should be just as simple. Let’s make it simple together.",
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
