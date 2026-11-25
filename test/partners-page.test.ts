import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";
import {
  EMPTY_PARTNER_INPUT,
  PARTNER_CONSENT_TEXT,
  PARTNER_ERROR_TEXT,
  partnerInputFromForm,
  validatePartnerApplication,
} from "../apps/local-guest/src/partner-application.js";
import { SqlitePartnerApplicationStore } from "../apps/local-guest/src/partner-application-store.js";
import { partnerPrivacyNoticeUrl } from "../apps/local-guest/src/partner-privacy-notice.js";
import {
  PARTNERS_COPY,
  PARTNERS_DEMO_STEPS,
} from "../apps/local-guest/src/partners-copy.js";
import { renderPartnersHtml } from "../apps/local-guest/src/partners-page-html.js";
import { createPartnersRouteModule } from "../apps/local-guest/src/partners-route-module.js";
import { createGuestShell } from "../apps/local-guest/src/guest-shell.js";
import {
  GUEST_FACT_LABELS,
  GUEST_PAYMENT_COPY,
  GUEST_RECEIPTS,
  guestReservationStatus,
} from "../apps/web-agent/src/guest-content.js";
import { escapeHtml } from "../apps/web/src/ui-kit.js";
import { createPilotRequestHandler } from "../apps/pilot/src/pilot-request-handler.js";
import {
  PILOT_LIMIT_DEFAULTS,
  loadPilotCoreConfiguration,
} from "../apps/pilot/src/pilot-config-core.js";
import { SHORTLET_SCHEMA_MIGRATIONS } from "../apps/cloudflare/src/schema.js";
import { SHORTLET_EXPORT_TABLES } from "../apps/cloudflare/src/do-export.js";
import { CREDENTIAL_TABLES } from "../packages/platform-core/src/data-migration.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { STAGING_WITHOUT_DEMO_SOURCE } from "./helpers/demo-mode-fixture.js";

// Landing issue 17: the founding partners page at /partners. Synthetic applicants only.
const NOTICE = "https://example.com/privacy";
const NOW = "2026-11-25T10:00:00.000Z";
const VALID = {
  fullName: "Test Applicant",
  business: "Example Apartments Ltd",
  phone: "+234 801 234 5678",
  email: "Applicant@Example.com",
  area: "Wuse",
  units: "2 to 5",
  stays: "short",
  how: "By phone & “WhatsApp”",
  consent: "yes",
};

type Fields = Readonly<Record<string, string | readonly string[]>>;

function body(fields: Fields): string {
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(fields))
    for (const entry of typeof value === "string" ? [value] : value)
      form.append(name, entry);
  return form.toString();
}

interface Server {
  readonly base: string;
  readonly environment: LocalGuestEnvironment;
  apply(fields: Fields, headers?: Record<string, string>): Promise<Response>;
  rows(): Record<string, unknown>[];
}

async function withServer(
  notice: string | null,
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "partners-"));
  const environment = LocalGuestEnvironment.openNode({
    databasePath: join(directory, "guest.sqlite"),
    clock: () => new Date(NOW),
  });
  const server = startLocalGuestServer({
    port: 0,
    environment,
    partnerPrivacyNoticeUrl: notice,
  });
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    await run({
      base,
      environment,
      apply: (fields, headers = {}) =>
        fetch(`${base}/partners/apply`, {
          method: "POST",
          redirect: "manual",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: base,
            ...headers,
          },
          body: body(fields),
        }),
      rows: () => {
        const exists = environment.database
          .prepare(
            "SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'partner_applications'",
          )
          .get();
        return exists === undefined
          ? []
          : environment.database
              .prepare("SELECT * FROM partner_applications ORDER BY rowid")
              .all();
      },
    });
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return value !== null && typeof value === "object"
    ? Object.values(value).flatMap(strings)
    : [];
}

const OPEN_HTML = renderPartnersHtml({
  form: { kind: "open", privacyNoticeUrl: NOTICE, formKey: randomUUID() },
});

test("Landing 17 AC1: GET /partners renders every section with its exact copy, public, with no session cookie, no inline style and no third-party request", async () => {
  await withServer(NOTICE, async ({ base }) => {
    for (const cookie of ["", "shortlet_guest_session=stale"]) {
      const response = await fetch(`${base}/partners`, { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /default-src 'self'/,
      );
      const html = await response.text();
      for (const id of [
        "problem",
        "guest",
        "how",
        "request",
        "benefits",
        "your-side",
        "payment",
        "founding",
        "questions",
        "closing",
        "apply",
      ])
        assert.equal(
          html.split(`id="${id}"`).length - 1,
          1,
          `#${id} is on the page once`,
        );
      assert.doesNotMatch(html, / style="|<style/);
      assert.doesNotMatch(
        html,
        /(?:src|href)="https?:\/\/(?!example\.com\/privacy")/,
      );
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    }
  });
  // Copy that depends on the form's state is checked with the form; the rest is on every page.
  const copy = { ...PARTNERS_COPY, form: undefined };
  const optional = new Set([
    ...PARTNERS_COPY.benefits.items.map((item) => item.icon as string),
    PARTNERS_COPY.guest.again,
  ]);
  for (const text of [
    ...strings(copy),
    ...PARTNERS_DEMO_STEPS.flatMap((step) => [
      step.name,
      step.guest,
      step.you,
      step.summary,
    ]),
  ])
    if (!optional.has(text))
      assert.ok(OPEN_HTML.includes(escapeHtml(text)), text);
});

test("Landing 17 AC1: the stylesheet holds colour values only in its token block and loads only our own fonts", () => {
  const css = readFileSync(
    new URL("../apps/web/src/xenia-partners.css", import.meta.url),
    "utf8",
  );
  const [before, rest] = css.split("/* xenia-tokens:start */");
  const [, after] = rest!.split("/* xenia-tokens:end */");
  for (const part of [before!, after!])
    assert.doesNotMatch(part, /#[0-9a-f]{3,8}\b(?![^{]*\{)|rgba?\(|hsla?\(/i);
  for (const url of css.matchAll(/url\("([^"]+)"\)/g))
    assert.match(url[1]!, /^\/landing\/fonts\//);
  // Every class in the markup is styled here, because the page loads no other stylesheet.
  const classes = new Set(
    [...OPEN_HTML.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
      match[1]!.split(/\s+/),
    ),
  );
  // Markers that carry no rule of their own: their layout comes from the parent.
  const unstyled = new Set(["ui-message", "xp-hero", "xp-figure"]);
  for (const name of classes)
    if (!unstyled.has(name)) assert.ok(css.includes(`.${name}`), name);
});

test("Landing 17 AC2: without JavaScript all six demo frames and their captions are in order, inert, with no link, form or action inside a screen", () => {
  const frames = [
    ...OPEN_HTML.matchAll(
      /<li class="xp-frame" data-demo-frame="(\d)" data-demo-name="([^"]+)">([\s\S]*?)(?=<li class="xp-frame"|<\/ol><p class="xp-sr" aria-live)/g,
    ),
  ];
  assert.deepEqual(
    frames.map((frame) => [Number(frame[1]), frame[2]]),
    PARTNERS_DEMO_STEPS.map((step, index) => [index + 1, step.name]),
  );
  for (const [index, frame] of frames.entries()) {
    const [screen, captions] = frame[3]!.split('<span class="xp-screen__fade"');
    assert.match(screen!, /<div class="ui-page" data-mode="stays" inert>/);
    assert.doesNotMatch(
      screen!.slice(screen!.indexOf("inert>")),
      /<a\b|<form\b|<button\b|href=|action=|\bid="/,
    );
    assert.ok(captions!.includes(escapeHtml(PARTNERS_DEMO_STEPS[index]!.guest)));
    assert.ok(captions!.includes(escapeHtml(PARTNERS_DEMO_STEPS[index]!.you)));
  }
  // The controls need the script, so they are hidden until it runs.
  assert.match(OPEN_HTML, /data-demo-steps hidden/);
  assert.match(OPEN_HTML, /data-demo-controls hidden/);
});

test("Landing 17 AC2: the demo uses the product's own strings and labels every listing as a demo", () => {
  for (const text of [
    GUEST_RECEIPTS.requestSent,
    GUEST_RECEIPTS.offerAccepted,
    GUEST_RECEIPTS.paymentVerified,
    guestReservationStatus("request-sent"),
    guestReservationStatus("offer-issued"),
    guestReservationStatus("confirmed"),
    GUEST_FACT_LABELS.amountDueNow,
    GUEST_FACT_LABELS.amountPaid,
    GUEST_FACT_LABELS.ifRequestAccepted,
    GUEST_PAYMENT_COPY.accept,
  ])
    assert.ok(OPEN_HTML.includes(escapeHtml(text)), text);
  assert.equal(
    OPEN_HTML.split(`>${GUEST_FACT_LABELS.demoListing}<`).length - 1,
    4,
  );
  // No margin on show (owner, 22 Nov 2026): the demo booking's operator amount appears nowhere.
  assert.doesNotMatch(OPEN_HTML, /1,200,000/);
});

test("Landing 17 AC4: with no privacy notice the page shows no field and the POST stores nothing", async () => {
  await withServer(null, async ({ base, apply, rows }) => {
    for (const path of ["/partners", "/partners/applied"]) {
      const html = await (await fetch(`${base}${path}`)).text();
      assert.doesNotMatch(html, /<form|<input[^>]*name=|<select|<textarea/);
      assert.ok(html.includes(escapeHtml(PARTNERS_COPY.form.closedHeading)));
      assert.ok(!html.includes(PARTNERS_COPY.form.sentHeading));
    }
    const refused = await apply(VALID);
    assert.equal(refused.status, 503);
    assert.doesNotMatch(await refused.text(), /Test Applicant|Application sent/);
    assert.deepEqual(rows(), []);
  });
});

test("Landing 17 AC4: the setting opens the form only with an absolute HTTPS address, and a malformed one stops startup", () => {
  for (const empty of [undefined, "", "   "])
    assert.equal(partnerPrivacyNoticeUrl(empty), null);
  assert.equal(partnerPrivacyNoticeUrl(` ${NOTICE} `), NOTICE);
  for (const bad of [
    "enabled",
    "/privacy",
    "http://example.com/privacy",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
  ]) {
    assert.throws(() => partnerPrivacyNoticeUrl(bad), /absolute HTTPS URL/);
    assert.throws(
      () =>
        loadPilotCoreConfiguration({
          ...STAGING_WITHOUT_DEMO_SOURCE,
          SHORTLET_PARTNER_PRIVACY_URL: bad,
        }),
      /SHORTLET_PARTNER_PRIVACY_URL/,
    );
  }
  assert.equal(
    loadPilotCoreConfiguration(STAGING_WITHOUT_DEMO_SOURCE)
      .partnerPrivacyNoticeUrl,
    null,
  );
});

test("Landing 17 AC5: a valid application is stored once with its consent record and answered with a redirect that says it was sent", async () => {
  await withServer(NOTICE, async ({ base, apply, rows }) => {
    const page = await (await fetch(`${base}/partners`)).text();
    assert.ok(page.includes(`href="${NOTICE}"`));
    const formKey = /name="formKey" value="([0-9a-f-]{36})"/.exec(page)?.[1];
    assert.ok(formKey);
    const fields = { ...VALID, stays: ["short", "monthly"], formKey };
    const first = await apply(fields);
    assert.equal(first.status, 303);
    assert.equal(first.headers.get("location"), "/partners/applied#application");
    const second = await apply(fields);
    assert.equal(second.status, 303);
    const stored = rows();
    assert.equal(stored.length, 1, "the same form sent twice is one row");
    const { application_id, submission_key, ...row } = stored[0]!;
    assert.match(String(application_id), /^[0-9a-f-]{36}$/);
    assert.match(String(submission_key), /^[0-9a-f]{64}$/);
    assert.deepEqual(
      { ...row },
      {
        full_name: VALID.fullName,
        business_name: VALID.business,
        phone: VALID.phone,
        email: "applicant@example.com",
        area: VALID.area,
        unit_range: VALID.units,
        stay_lengths: "short,monthly",
        booking_today: VALID.how,
        consent_text: PARTNER_CONSENT_TEXT,
        privacy_notice_url: NOTICE,
        submitted_at: NOW,
      },
    );
    const sent = await (await fetch(`${base}/partners/applied`)).text();
    assert.ok(sent.includes(PARTNERS_COPY.form.sentHeading));
    assert.doesNotMatch(sent, /<form|Test Applicant/);
    // Corrected answers on the same form are a new application, never silently dropped.
    assert.equal((await apply({ ...fields, area: "Jabi" })).status, 303);
    assert.equal(rows().length, 2);
  });
});

test("Landing 17 AC6: an invalid application stores nothing, answers 422 with the design's messages, keeps what was typed and focuses the first wrong field", async () => {
  await withServer(NOTICE, async ({ apply, rows }) => {
    const response = await apply({
      ...VALID,
      fullName: '<b>"Test"</b>',
      phone: "0801",
      email: "someone",
    });
    assert.equal(response.status, 422);
    const html = await response.text();
    assert.ok(html.includes(escapeHtml(PARTNER_ERROR_TEXT.phone)));
    assert.ok(html.includes(escapeHtml(PARTNER_ERROR_TEXT.email)));
    assert.ok(!html.includes(escapeHtml(PARTNER_ERROR_TEXT.area)));
    assert.ok(html.includes("2 answers need fixing"));
    assert.ok(html.includes(`value="${escapeHtml('<b>"Test"</b>')}"`));
    assert.doesNotMatch(html, /<b>"Test"/);
    assert.match(html, /<option selected>Wuse<\/option>/);
    assert.match(html, /name="stays" value="short" checked/);
    assert.equal((html.match(/ autofocus/g) ?? []).length, 1);
    assert.match(html, /id="f-phone"[^>]*aria-invalid="true"[^>]* autofocus/);
    const empty = await apply({});
    assert.equal(empty.status, 422);
    const emptyHtml = await empty.text();
    for (const text of Object.values(PARTNER_ERROR_TEXT))
      assert.ok(emptyHtml.includes(escapeHtml(text)), text);
    assert.deepEqual(rows(), []);
  });
});

test("Landing 17 AC6: every field fails closed: missing, repeated, unknown, over-long or unticked", () => {
  const check = (fields: Fields): string[] => {
    const result = validatePartnerApplication(
      partnerInputFromForm(new URLSearchParams(body(fields))),
    );
    return result.ok ? [] : Object.keys(result.errors);
  };
  assert.deepEqual(check(VALID), []);
  const { how: _how, ...withoutOptional } = VALID;
  assert.deepEqual(check(withoutOptional), []);
  for (const field of [
    "fullName",
    "business",
    "phone",
    "email",
    "area",
    "units",
    "consent",
  ] as const) {
    assert.deepEqual(check({ ...VALID, [field]: "" }), [field]);
    assert.deepEqual(check({ ...VALID, [field]: [VALID[field], VALID[field]] }), [
      field,
    ]);
  }
  assert.deepEqual(check({ ...VALID, stays: [] }), ["stays"]);
  assert.deepEqual(check({ ...VALID, stays: ["short", "yearly"] }), ["stays"]);
  assert.deepEqual(check({ ...VALID, area: "Lagos" }), ["area"]);
  assert.deepEqual(check({ ...VALID, units: "100" }), ["units"]);
  assert.deepEqual(check({ ...VALID, consent: "no" }), ["consent"]);
  assert.deepEqual(check({ ...VALID, fullName: "x".repeat(201) }), ["fullName"]);
  assert.deepEqual(check({ ...VALID, phone: "call me 0801234567890" }), [
    "phone",
  ]);
  assert.equal(validatePartnerApplication(EMPTY_PARTNER_INPUT).ok, false);
});

test("Landing 17 AC6: an application that cannot be saved says so, keeps what was typed and reports no detail", async () => {
  const logged: unknown[] = [];
  const module = createPartnersRouteModule({
    assets: { text: () => "" },
    intake: {
      privacyNoticeUrl: NOTICE,
      newFormKey: randomUUID,
      store: {
        save: () => {
          throw new Error("disk I/O error near 'Test Applicant'");
        },
      },
    },
    originAccepted: () => true,
    readForm: async () => new URLSearchParams(body(VALID)),
  });
  const shell = createGuestShell({
    assets: { text: () => "" },
    staticAssets: [],
    routeModules: [module],
    notFound: async () => undefined,
  });
  const original = [console.log, console.error, console.warn] as const;
  console.log = console.error = console.warn = (...args: unknown[]) =>
    void logged.push(args);
  let status = 0;
  let html = "";
  try {
    await shell.handle(
      { method: "POST", url: "/partners/apply", headers: { host: "localhost" } } as never,
      {
        writeHead: (code: number) => {
          status = code;
        },
        end: (text: string) => {
          html = String(text);
        },
      } as never,
    );
  } finally {
    [console.log, console.error, console.warn] = original;
  }
  assert.equal(status, 503);
  assert.ok(html.includes(escapeHtml(PARTNERS_COPY.form.unavailable)));
  assert.ok(html.includes('value="Test Applicant"'));
  assert.doesNotMatch(html, /disk I\/O/);
  assert.deepEqual(logged, []);
});

test("Landing 17 AC7: a cross-origin POST and an oversized body are refused and store nothing", async () => {
  await withServer(NOTICE, async ({ apply, rows }) => {
    assert.equal(
      (await apply(VALID, { origin: "https://elsewhere.example" })).status,
      403,
    );
    assert.equal((await apply(VALID, { origin: "null" })).status, 403);
    const large = await apply({ ...VALID, how: "x".repeat(40 * 1024) });
    assert.equal(large.status, 413);
    assert.deepEqual(rows(), []);
    // A long answer in characters that URL-encode to nine bytes still fits.
    assert.equal(
      (await apply({ ...VALID, how: "’".repeat(2000) })).status,
      303,
    );
    assert.equal(rows().length, 1);
  });
});

test("Landing 17 AC7: repeated applications from one address are rate limited, apart from the new-session allowance", async () => {
  let reached = 0;
  const target = {
    handle: async (_req: unknown, res: { end(): void }) => {
      reached += 1;
      res.end();
    },
    close: async () => undefined,
  };
  const handler = createPilotRequestHandler(
    {
      publicOrigin: "https://example.com",
      deployment: "production",
      limits: { ...PILOT_LIMIT_DEFAULTS, newSessionsPerAddressPerHour: 2 },
    },
    {
      guest: target as never,
      owner: target as never,
      database: openNodeSqliteDatabase(":memory:"),
      clock: () => new Date(NOW),
      clientAddress: (req) => String(req.headers["x-address"]),
      ready: () => true,
    },
  );
  const send = async (
    method: string,
    url: string,
    address: string,
  ): Promise<{ status: number; body: string }> => {
    let status = 200;
    let text = "";
    await handler.handle(
      {
        method,
        url,
        headers: { "x-address": address },
        resume: () => undefined,
      } as never,
      {
        writeHead: (code: number) => {
          status = code;
        },
        end: (value?: string) => {
          text = value ?? "";
        },
      } as never,
    );
    return { status, body: text };
  };
  for (let n = 0; n < 2; n += 1)
    assert.equal((await send("POST", "/partners/apply", "a")).status, 200);
  const limited = await send("POST", "/partners/apply", "a");
  assert.equal(limited.status, 429);
  assert.match(limited.body, /href="\/partners"/);
  assert.equal((await send("POST", "/partners/apply", "b")).status, 200);
  assert.equal((await send("GET", "/", "a")).status, 200, "sessions are counted apart");
  assert.equal((await send("GET", "/partners", "a")).status, 200, "reading is free");
  assert.equal(reached, 5);
});

test("Landing 17 AC8: the applications table is a schema migration, is in the daily export and is not a credential table", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    // A deployed object at version 5 gains the table without losing anything.
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS.slice(0, 5), NOW);
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, NOW);
    const store = new SqlitePartnerApplicationStore(database, {
      clock: () => new Date(NOW),
      newId: randomUUID,
    });
    const result = validatePartnerApplication(
      partnerInputFromForm(new URLSearchParams(body(VALID))),
    );
    assert.ok(result.ok);
    const submission = {
      application: result.application,
      submissionKey: "k",
      privacyNoticeUrl: NOTICE,
    };
    assert.equal(store.save(submission), true);
    assert.equal(store.save(submission), false);
  } finally {
    database.close();
  }
  assert.ok(
    (SHORTLET_EXPORT_TABLES as readonly string[]).includes(
      "partner_applications",
    ),
  );
  assert.ok(!Object.hasOwn(CREDENTIAL_TABLES, "partner_applications"));
});

test("Landing 17 AC10: /welcome and /partners link to each other, and the saved theme applies to both", async () => {
  assert.match(renderLandingHtml(), /<a class="landing-link" href="\/partners">/);
  assert.match(OPEN_HTML, /<a href="\/welcome" class="xp-link">/);
  await withServer(null, async ({ base }) => {
    for (const path of ["/welcome", "/partners"]) {
      const html = await (
        await fetch(`${base}${path}`, {
          headers: { cookie: "shortlet_theme=dark" },
        })
      ).text();
      assert.match(html, /<html lang="en-NG" data-theme="dark">/);
    }
    for (const [path, type] of [
      ["/xenia-partners.css", "text/css"],
      ["/partners.js", "text/javascript"],
    ] as const) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", new RegExp(type));
      assert.ok((await response.text()).length > 0);
    }
  });
});
