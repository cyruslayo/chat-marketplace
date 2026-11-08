import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EXTENDED_STAY_POLICY, MAX_STAY_NIGHTS } from "../domains/shortlet/src/index.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";
import {
  LANDING_COPY,
  LANDING_FORBIDDEN_TERMS,
  LANDING_LENGTH_LIMITS,
  validateExampleChips,
} from "../apps/local-guest/src/landing-copy.js";
import { escapeHtml } from "../apps/web/src/ui-kit.js";

// Landing issue 16 (monthly stay copy). Sources: ADR 0092 (as amended 1 Nov 2026), ADR 0023 (as amended), ADR 0077, ADR 0078,
// ADR 0106. The approved copy is owner-approved on 8 Nov 2026 and is used character for character.

const SCRATCH = fileURLToPath(new URL("../.scratch/landing-page/", import.meta.url));
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The visible text of a markup string: tags removed, scripts and styles dropped. */
function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sectionAt(html: string, marker: string): string {
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `the section ${marker} is rendered`);
  const end = html.indexOf("</section>", start);
  assert.ok(end > start, `the section ${marker} closes`);
  return html.slice(start, end + "</section>".length);
}

function within(text: string, limit: number, name: string): void {
  assert.ok([...text].length <= limit, `${name} is ${[...text].length} characters, over its limit of ${limit}`);
}

test("AC1: Every slot in the table renders exactly the approved text, within its length limit", () => {
  const html = renderLandingHtml();
  const text = plainText(html);
  const approved: readonly [string, string, number][] = [
    ["Furnished apartments · by the night or month", "heroEyebrow", LANDING_LENGTH_LIMITS.heroEyebrow],
    [
      "Say what you need, for a few nights or a few months. See only what you can book, at the full price. Your money stays yours until it’s confirmed.",
      "heroLede",
      LANDING_LENGTH_LIMITS.heroLede,
    ],
    ["Where, for how long, and who’s coming?", "composerPlaceholder", LANDING_LENGTH_LIMITS.composerPlaceholder],
    ["How it works · one stay, five screens", "howEyebrow", LANDING_LENGTH_LIMITS.howEyebrow],
    ["Start with the stay, not the form.", "closingHeading", LANDING_LENGTH_LIMITS.closingHeading],
    ["Shortlet · Lagos and Abuja apartments, nights or months", "pageTitle", LANDING_LENGTH_LIMITS.pageTitle],
    [
      "Once payment is verified, the Reservation is confirmed. Staying a month or more? You pay 30 nights at a time, each on its own due date.",
      "moneyCards[2].body",
      LANDING_LENGTH_LIMITS.moneyCardBody,
    ],
  ];
  for (const [copy, slot, limit] of approved) {
    within(copy, limit, slot);
    assert.ok(text.includes(copy) || html.includes(escapeHtml(copy)), `the page renders the ${slot} text exactly`);
  }

  assert.equal(LANDING_COPY.heroEyebrow, approved[0]![0]);
  assert.equal(LANDING_COPY.heroLede, approved[1]![0]);
  assert.equal(LANDING_COPY.composerPlaceholder, approved[2]![0]);
  assert.equal(LANDING_COPY.howEyebrow, approved[3]![0]);
  assert.equal(LANDING_COPY.closingHeading, approved[4]![0]);
  assert.equal(LANDING_COPY.pageTitle, approved[5]![0]);
  assert.equal(LANDING_COPY.moneyCards[2]!.body, approved[6]![0]);
  assert.ok(
    html.includes(`placeholder="${escapeHtml("Where, for how long, and who’s coming?")}"`),
    "the composer placeholder attribute carries the approved text",
  );
  assert.ok(html.includes(`<title>${escapeHtml(approved[5]![0])}</title>`), "the page title carries the approved text");

  const chip = LANDING_COPY.exampleChips[2]!;
  assert.deepEqual(
    { text: chip.text, nights: chip.nights },
    { text: "Ikoyi, 60 nights from 5 Jan, relocating", nights: 60 },
    "the third chip is the approved 60-night chip",
  );
  within(chip.text, LANDING_LENGTH_LIMITS.exampleChip, "exampleChips[2]");
  assert.ok(html.includes(`>${escapeHtml(chip.text)}</button>`), "the 60-night chip renders as a button");

  const faq = LANDING_COPY.faq;
  assert.equal(faq[2]!.question, "And if the Operator says no?", "the existing FAQ order is kept before the new entry");
  assert.deepEqual(
    { question: faq[3]!.question, answer: faq[3]!.answer },
    {
      question: "Can I stay for a month or longer?",
      answer:
        "Yes, from 30 nights up to 6 months, in apartments that offer it. You pay the first 30 nights to confirm, then each later 30 nights by its own due date.",
    },
    "the new FAQ entry follows 'And if the Operator says no?'",
  );
  within(faq[3]!.question, LANDING_LENGTH_LIMITS.faqQuestion, "the new FAQ question");
  assert.ok(
    html.includes(`<summary>${escapeHtml(faq[3]!.question)}</summary><p>${escapeHtml(faq[3]!.answer)}</p>`),
    "the new FAQ entry renders with its question and answer",
  );
  assert.equal(faq[4]!.question, "Which areas can I book?", "the placeholder questions keep their place after the new entry");
});

test("AC2: The 'Staying for months?' band renders its H2, line and three facts using kit components only, and passes the foundation/retired-class tests", () => {
  const html = renderLandingHtml();
  const band = sectionAt(html, '<section id="months"');
  const money = html.indexOf('<section id="money"');
  const questions = html.indexOf('<section id="questions"');
  assert.ok(money < html.indexOf('<section id="months"') && html.indexOf('<section id="months"') < questions, "the band sits after the money section and before the questions");

  assert.equal(
    plainText(band).replace(/\s+/g, " ").trim().startsWith("Staying for months? Pay one month at a time."),
    true,
    "the H2 reads exactly 'Staying for months? Pay one month at a time.'",
  );
  assert.match(band, /<h2 id="months-h">Staying for months\? <em class="landing-section__accent">Pay one month at a time\.<\/em><\/h2>/, "the second sentence is the italic accent");
  assert.ok(
    band.includes("<p>Not a hotel bill for three months. Not a year paid upfront before you know the city.</p>"),
    "the line renders exactly",
  );
  const facts = [
    "One monthly price, all-in.",
    "Each apartment lists what’s included: power, water, internet, cleaning.",
    "30 nights at a time, never more than one period ahead.",
  ];
  for (const fact of facts) {
    within(fact, LANDING_LENGTH_LIMITS.monthsFact, `fact "${fact}"`);
    assert.ok(band.includes(`<p>${escapeHtml(fact)}</p>`), `the fact renders: ${fact}`);
  }
  assert.equal(band.split('<li class="landing-months__fact">').length - 1, 3, "three facts, each a list item");
  assert.match(band, /<svg[^>]*class="ui-icon/, "each fact uses the kit icon");
  assert.doesNotMatch(band, /\sstyle=/, "no inline style strings in the band");
  assert.doesNotMatch(band, /#[0-9a-fA-F]{3,8}\b/, "no hex colour in the band");

  const css = readFileSync(join(ROOT, "apps/web/src/shortlet-landing.css"), "utf8");
  const bandCss = css.slice(css.indexOf(".landing-months"), css.indexOf(".landing-months") + 2000);
  assert.ok(bandCss.length > 0, "the band's classes are styled in shortlet-landing.css");
  assert.doesNotMatch(bandCss.split("}").slice(0, 8).join("}"), /#[0-9a-fA-F]{3,8}\b/, "the band's rules use tokens only");
  assert.match(css, /\.landing-months__facts\s*\{[^}]*grid/, "the facts list lays out as a grid");
});

test("AC3: The chip validator accepts 29, 30, 60 and 180 nights and refuses 0 and 181", () => {
  assert.equal(MAX_STAY_NIGHTS, 29, "the Short Stay maximum is 29 nights (ADR 0023 as amended)");
  assert.equal(EXTENDED_STAY_POLICY.minimumNights, 30, "the Extended Stay minimum is 30 nights (ADR 0092 as amended)");
  assert.equal(EXTENDED_STAY_POLICY.maximumNights, 180, "the Extended Stay maximum is 180 nights (ADR 0092 as amended)");
  for (const nights of [29, 30, 60, 180]) {
    assert.deepEqual(validateExampleChips([{ text: `Ikoyi, ${nights} nights`, nights }]), [], `a ${nights}-night chip is accepted`);
  }
  for (const nights of [0, 181]) {
    const problems = validateExampleChips([{ text: `Ikoyi, ${nights} nights`, nights }]);
    assert.equal(problems.length, 1, `a ${nights}-night chip is refused`);
    assert.match(problems[0]!, /a Short Stay is 1 to 29 nights \(ADR 0023\)/, "the refusal names the Short Stay range");
    assert.match(problems[0]!, /an Extended Stay is 30 to 180 nights \(ADR 0092\)/, "the refusal names the Extended Stay range");
  }
  assert.deepEqual(validateExampleChips(LANDING_COPY.exampleChips), [], "every approved chip passes the validator");
});

test("AC4: The 60-night chip, sent through the landing handoff, produces a 60-night search on a production-like composition", async () => {
  // The issue 14 path: POST /welcome/start with the chip text, on a composition with the demo off (the default for
  // openNode). Then a cold restore (a new server over the same database) before the conversation is read, as a Worker request.
  const CHIP = LANDING_COPY.exampleChips[2]!.text;
  const directory = mkdtempSync(join(tmpdir(), "landing-monthly-"));
  const databasePath = join(directory, "guest.sqlite");
  const clock = () => new Date("2026-11-08T10:00:00Z");
  try {
    const first = startLocalGuestServer({ port: 0, environment: LocalGuestEnvironment.openNode({ databasePath, clock }) });
    const base = `http://127.0.0.1:${await first.listen()}`;
    let cookie = "";
    let location = "";
    try {
      const response = await fetch(`${base}/welcome/start`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin: base },
        body: new URLSearchParams({ message: CHIP }).toString(),
      });
      assert.equal(response.status, 303, "the handoff opens a conversation");
      cookie = /shortlet_guest_session=gs-[a-f0-9-]+/.exec(response.headers.get("set-cookie") ?? "")?.[0] ?? "";
      assert.notEqual(cookie, "", "a session is issued");
      location = response.headers.get("location") ?? "";
    } finally {
      await first.close();
    }

    const restored = startLocalGuestServer({ port: 0, environment: LocalGuestEnvironment.openNode({ databasePath, clock }) });
    const restoredBase = `http://127.0.0.1:${await restored.listen()}`;
    try {
      const page = await fetch(`${restoredBase}${location}`, { headers: { accept: "text/html", cookie } });
      assert.equal(page.status, 200, "the conversation is readable after a cold restore");
      const text = plainText(await page.text()).replace(/\s+/g, " ");
      assert.ok(text.includes(CHIP), "the first Guest message is the chip text");
      assert.ok(text.includes("60 nights"), "the concierge reads the stay as 60 nights");
      assert.ok(text.includes("Tue 5 Jan 2027"), "the check-in is 5 January 2027, the next 5 January after the clock");
      assert.doesNotMatch(text, /how many nights|how long (?:would you|will you) stay|how many nights/i, "the concierge does not ask for the nights again");
      assert.doesNotMatch(text, /month|monthly/i, "no month parser is needed: the chip says nights");
    } finally {
      await restored.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AC5: No landing copy contains a forbidden term, including the five new ones", () => {
  const html = renderLandingHtml("system", { placeholders: true, demo: true });
  const copy = [
    LANDING_COPY.heroLede,
    LANDING_COPY.composerPlaceholder,
    LANDING_COPY.exampleChips[2]!.text,
    LANDING_COPY.howEyebrow,
    LANDING_COPY.closingHeading,
    LANDING_COPY.pageTitle,
    LANDING_COPY.moneyCards[2]!.body,
    LANDING_COPY.heroEyebrow,
    LANDING_COPY.monthsHeading.before + LANDING_COPY.monthsHeading.accent,
    LANDING_COPY.monthsLine,
    ...LANDING_COPY.monthsFacts,
    ...LANDING_COPY.faq.flatMap((item) => [item.question, item.answer]),
  ];
  for (const term of LANDING_FORBIDDEN_TERMS) {
    for (const text of copy) assert.doesNotMatch(text, term, `forbidden term ${term} in: ${text}`);
  }
  for (const word of ["rent", "lease", "tenant", "tenancy", "landlord"]) {
    const term = LANDING_FORBIDDEN_TERMS.find((candidate) => candidate.test(word));
    assert.ok(term, `${word} is a forbidden term`);
    assert.match(`The ${word} is due`, term, `${word} as a whole word is refused`);
    assert.doesNotMatch(plainText(html), term, `${word} does not appear in the rendered page`);
  }
  assert.doesNotMatch("Pay upfront, current dates, a current stay", /\b(?:rent|lease|tenant|tenancy|landlord)\b/i, "upfront and current are not forbidden");
  assert.ok(
    !LANDING_FORBIDDEN_TERMS.some((term) => term.test("upfront")),
    "upfront is not a forbidden term",
  );
});

test("AC6: The landing captures at 320, 390, 768 and 1280, light and dark, pass ADR 0078 and are saved under screenshots/16/", () => {
  const folder = join(SCRATCH, "screenshots", "16");
  assert.ok(existsSync(folder), "screenshots/16 exists");
  const files = readdirSync(folder);
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 390, 768, 1280]) {
      assert.ok(
        files.some((file) => file.startsWith(`landing-${theme}-${width}`) && file.endsWith(".png")),
        `a ${theme} capture at ${width} exists`,
      );
    }
  }
  const findings = readFileSync(join(folder, "findings.txt"), "utf8");
  assert.match(findings, /horizontal overflow \(document\): none/, "the captures report no horizontal overflow");
  assert.doesNotMatch(findings, /horizontal overflow \(document\): (?!none)/, "no capture reports horizontal overflow");
  assert.doesNotMatch(findings, /controls under 44x44: [1-9]/, "every control is at least 44 px in every capture");
});
