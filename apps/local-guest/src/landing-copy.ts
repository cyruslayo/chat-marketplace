import { MAX_STAY_NIGHTS } from "../../../domains/shortlet/src/browse.js";

/**
 * The approved marketing copy of the landing page. Sources: the copy deck (owner approval 12 Oct 2026: the deck table, the
 * Q1 answer change and recommended addition 1, `.scratch/landing-page/copy/final-copy-deck.md`) and the "A + C · Lagos, in
 * conversation" slots approved on 14 Oct 2026 (`.scratch/landing-page/issues/06-mix-direction-approvals.md`, items 3, 4
 * and 6). Slot IDs follow the deck.
 *
 * Only marketing copy lives here. The phone and chat-window screens and the strings from guest-content.ts are NOT in this
 * module (ADR-0077: one source for guest wording). Apostrophes and quotes are typographic (’ “ ”).
 */

/** One FAQ entry. `placeholder` marks an answer that is still bracketed text: it renders only with placeholders on (Issue 08 AC6). */
export interface LandingFaqItem {
  readonly question: string;
  readonly answer: string;
  readonly placeholder?: boolean;
}

export const LANDING_COPY = Object.freeze({
  /** Explicit owner approval, 20 Oct 2026, landing issue 13: live-demo illustrations, not inventory. */
  demoNotice: "Demo — illustrative photos, not live listings.",
  /** S01: hero eyebrow (kept). */
  heroEyebrow: "Furnished apartments · Lagos and Abuja",
  /** S02: hero H1 in three parts, so the accent word is its own element (issue 06 item 3). See heroHeadingText. */
  heroHeading: {
    before: "Your apartment in Lagos or Abuja, ",
    accent: "settled",
    after: " in one conversation.",
  },
  /** S03: hero lede (issue 06 item 3). */
  heroLede:
    "Say what you need. See only what you can book, at the full price. Your money stays yours until the apartment is confirmed for your dates.",
  /** The visible label of the hero composer's text field (direction doc, Accessibility). */
  composerLabel: "Describe your stay",
  /** S04: composer placeholder, hero and closing composer. */
  composerPlaceholder: "Where, when and who’s coming?",
  /** S05: primary button of the composer: hero, beat 5 and closing composer. */
  primaryAction: "See what you can book",
  /** Example chips under the hero composer (issue 06 item 6). Each chip fills the field; its nights are checked below. */
  exampleChips: [
    { text: "Somewhere quiet in Abuja for a week", nights: 7 },
    { text: "Lekki, 3 nights from Friday, 4 of us", nights: 3 },
    { text: "Ikoyi, 2 weeks from 10 Sept", nights: 14 },
  ],
  /** S06: reassurance under the hero and the closing composer. */
  reassurance: "Nothing is charged, and nothing is sent until you press send.",
  /** Nav labels (issue 06 item 3). */
  navHowItWorks: "How it works",
  navYourMoney: "Your money",
  navQuestions: "Questions",
  /** App bar's one filled action (issue 06 item 3). Below 48rem the link shows appBarActionShort. */
  appBarAction: "Start a conversation",
  appBarActionShort: "Start",
  /** Trust strip: four facts in one ruled row (issue 06 item 3). */
  trust: [
    {
      title: "The Operator confirms first",
      line: "A verified company manages each apartment.",
    },
    {
      title: "Priced all-in for your dates",
      line: "Any deposit sits on its own line.",
    },
    {
      title: "Dates held while they reply",
      line: "Up to 30 minutes in active hours.",
    },
    {
      title: "Pay only after the yes",
      line: "If they decline, nothing is due.",
    },
  ],
  /** Apartments H2 and its line (issue 06 item 3). The section renders only approved (or placeholder) units. */
  apartmentsHeading: {
    before: "Apartments you can actually book, ",
    accent: "not listings.",
  },
  apartmentsLine:
    "Fewer results, by design: only apartments you can request for your dates, each one managed by a verified Operator.",
  /** Money timeline H2 (accent is the italic part) and its three cards, as on the Mix-Desktop board (issue 06 item 3). */
  moneyHeading: {
    before: "Your money stays yours until the apartment is ",
    accent: "confirmed for your dates.",
  },
  /** Each card's status tag is text (issue 08 AC5); the tone is the kit tone: neutral for nothing due, warning for what is due now. */
  moneyCards: [
    {
      number: "1",
      title: "You send a Booking Request",
      body: "Your dates are held while the Operator replies, up to 30 minutes in active hours.",
      status: "Nothing due yet",
      tone: "neutral",
    },
    {
      number: "2",
      title: "The Operator says yes",
      body: "Your offer shows exactly what you pay and by when. If they decline, nothing is due.",
      status: "Nothing due yet",
      tone: "neutral",
    },
    {
      number: "3",
      title: "You pay, it’s confirmed",
      body: "Once payment is verified, the Reservation is confirmed and arrival steps stay in the same chat.",
      status: "Due now: the amount on your offer",
      tone: "warning",
    },
  ] as const,
  /** S09: small label under the example chat window (kept). */
  exampleLabel: "Example booking · real app screens",
  /** S07: section eyebrow. */
  howEyebrow: "How it works · one trip, five screens",
  /** S08: section H2. */
  howHeading: "Five screens you’ll see. Five hassles you won’t.",
  /** S10: FAQ section title. */
  faqHeading: "Questions, answered plainly",
  /** S11: closing H2. */
  closingHeading: "Start with the trip, not the form.",
  /** S12: browser tab title. */
  pageTitle: "Shortlet · Lagos and Abuja apartments, priced all-in",
  /** Beat pain lines (issue 05 wording; issue 08 sub-task B changes how they are shown). */
  pain: [
    "retyping your trip on five sites, then chasing an agent on WhatsApp",
    "a price that grows once you’ve decided, with fees at the end",
    "a yes you gave before you saw the small print",
    "paying for a place someone else got first",
    "refreshing your bank app, unsure whether the payment landed",
  ],
  /** Beat headings H1–H5. */
  headings: [
    "Say it once, the way you’d tell a friend.",
    "Only what you can book, at the full price.",
    "Read it all before anything leaves your phone.",
    "No payment until the Operator says yes.",
    "Pay once, then see it confirmed in the same chat.",
  ],
  /** Beat bodies B1–B5. */
  bodies: [
    "Area, dates and guests come from your own words and show as chips you can check. The concierge asks only for what’s missing.",
    "Fewer results, by design: only apartments you can request for your dates. Each price is the All-In Stay Total, and any Refundable Security Deposit sits on its own line.",
    "Dates, guests and total sit on one page. Nothing is sent until you press send, and price and availability are re-checked the moment you do.",
    "The Operator is the verified company managing the apartment. Your dates are held while they reply, up to 30 minutes in active hours. If they decline, nothing is due.",
    "The offer shows exactly what you pay and by when. Once payment is verified, the Reservation is confirmed, and arrival steps stay in this chat.",
  ],
  /** Status tags: shown once, in the money timeline (issue 06 item 4, issue 08 sub-task B). Used by the status-tag tests. */
  statusNothingDue: "Nothing due yet",
  statusDueNow: "Due now: the amount on your offer",
  /** Footer column headings and the copyright line. Structure from the direction doc (row 10), not from the issue 06 approvals. */
  footerCities: "Cities",
  footerShortlet: "Shortlet",
  footerHelp: "Help",
  footerCopyright: "© 2026 Shortlet",
  /** Help links, shown only once a URL is configured (direction doc row 10). Labels as the direction doc names them. */
  helpSupport: "Support",
  helpPrivacy: "Privacy",
  helpTerms: "Terms",
  /** FAQ questions and answers. Q2–Q3 answers are unchanged. Q4 and Q5 are placeholders (issue 06 item 6 leaves them open). */
  faq: [
    {
      question: "Are the dates mine as soon as I send?",
      answer:
        "Not yet. They’re held for you while the Operator replies, up to 30 minutes in their active hours, and they’re yours once the Operator confirms and your payment is verified.",
    },
    {
      question: "What’s in the price, and what isn’t?",
      answer:
        "The All-In Stay Total covers every mandatory charge for your dates and guests. Any deposit is shown separately.",
    },
    {
      question: "And if the Operator says no?",
      answer:
        "No payment is due, and you can keep searching in the same conversation.",
    },
    {
      question: "Which areas can I book?",
      answer: "[AREAS WITH PUBLISHED INVENTORY]",
      placeholder: true,
    },
    {
      question: "Is there a fee for using Shortlet?",
      answer: "[APPROVED FEE ANSWER]",
      placeholder: true,
    },
    {
      question: "Is there an ID check before I book?",
      answer:
        "Not online for this pilot. Any check-in steps are handled separately.",
    },
  ] as readonly LandingFaqItem[],
});

/**
 * Splits a heading at its accent phrase, which must close the heading (sub-task C: "answered plainly", "not the form.").
 * The accent renders in an em element; joining the parts gives the approved heading exactly.
 */
export function splitHeadingAtAccent(
  heading: string,
  accent: string,
): { readonly before: string; readonly accent: string } {
  if (!heading.endsWith(accent))
    throw new Error(`the accent "${accent}" must end the heading "${heading}"`);
  return { before: heading.slice(0, heading.length - accent.length), accent };
}

/**
 * The How it works H2 split at its second sentence: the second sentence is the italic accent (issue 08 sub-task B). The copy
 * text is unchanged; joining the parts with one space gives the approved heading.
 */
export function howHeadingParts(heading: string = LANDING_COPY.howHeading): {
  readonly before: string;
  readonly accent: string;
} {
  const match = /^(.+?[.!?])\s+(.+)$/.exec(heading);
  return match
    ? { before: match[1]!, accent: match[2]! }
    : { before: heading, accent: "" };
}

/** The hero H1 as one string (for the page title check and for text matching). */
export function heroHeadingText(
  heading: {
    readonly before: string;
    readonly accent: string;
    readonly after: string;
  } = LANDING_COPY.heroHeading,
): string {
  return `${heading.before}${heading.accent}${heading.after}`;
}

/**
 * A problem with each example chip: an empty text, or a night count that is not a whole number from 1 to MAX_STAY_NIGHTS
 * (the Short Stay maximum, ADR 0023 as amended 1 Nov 2026). The limit comes from the domain, not from a copy here.
 */
export function validateExampleChips(
  chips: readonly { readonly text: string; readonly nights: number }[],
): string[] {
  const problems: string[] = [];
  for (const chip of chips) {
    if (chip.text.trim() === "") problems.push("a chip has no text");
    if (
      !Number.isInteger(chip.nights) ||
      chip.nights < 1 ||
      chip.nights > MAX_STAY_NIGHTS
    ) {
      problems.push(
        `"${chip.text}" describes ${chip.nights} nights; a Short Stay is 1 to ${MAX_STAY_NIGHTS} nights (ADR 0023)`,
      );
    }
  }
  return problems;
}

/** Per-slot length limits in characters, from the copy brief's slot inventory. Checked by the landing tests (AC5). */
export const LANDING_LENGTH_LIMITS = Object.freeze({
  heroEyebrow: 45,
  heroHeading: 70,
  heroLede: 160,
  composerLabel: 30,
  composerPlaceholder: 40,
  primaryAction: 22,
  exampleChip: 45,
  reassurance: 70,
  navLabel: 22,
  appBarAction: 22,
  appBarActionShort: 10,
  trustTitle: 40,
  trustLine: 70,
  apartmentsHeading: 55,
  apartmentsLine: 130,
  moneyHeading: 80,
  moneyCardTitle: 40,
  moneyCardBody: 170,
  moneyCardStatus: 40,
  howEyebrow: 40,
  howHeading: 70,
  pain: 70,
  heading: 55,
  body: 170,
  exampleLabel: 40,
  faqHeading: 30,
  faqQuestion: 60,
  closingHeading: 45,
  pageTitle: 60,
  statusNothingDue: 40,
  statusDueNow: 40,
});

/** Words and marks the landing copy must never use (copy brief, hard rules). Case-insensitive except "AI". */
export const LANDING_FORBIDDEN_TERMS: readonly RegExp[] = Object.freeze([
  /\bhosts?\b/i,
  /\bescrow\b/i,
  /\bguaranteed\b/i,
  /100% secure/i,
  /\bfully verified\b/i,
  /\bverified property\b/i,
  /\binstant booking\b/i,
  /\bno hidden fees\b/i,
  /\bAI\b/,
  /\bbot\b/i,
  /\brobot\b/i,
]);
