import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import { startLocalPilotServer } from "../apps/pilot/src/local-pilot-server.js";
import {
  bootstrapLocalPilot,
  localPilotPaths,
} from "../apps/pilot/src/local-pilot.js";
import {
  cookieFrom,
  productionFixture,
  PUBLIC_ORIGIN,
} from "./helpers/pilot-fixture.js";
import { postJson } from "./helpers/guest-journey.js";

type Pilot = "production" | "staging" | "local";
interface Host {
  readonly base: string;
  readonly origin: string;
  readonly cookie: string;
  readonly unitId: string;
}

async function withPilot(
  kind: Pilot,
  run: (host: Host) => Promise<void>,
): Promise<void> {
  const fixture =
    kind === "local"
      ? null
      : await productionFixture(
          kind === "staging"
            ? {
                environment: {
                  SHORTLET_DEPLOYMENT: "staging",
                  SHORTLET_BETA_INVITE_CODE: "offline-invite",
                  PAYSTACK_ENVIRONMENT: "test",
                  PAYSTACK_SECRET_KEY: "sk_test_offline-only",
                },
              }
            : {},
        );
  const directory =
    fixture?.directory ??
    (await mkdtemp(join(tmpdir(), "pilot-commerce-off-")));
  const paths = localPilotPaths(directory);
  if (!fixture) bootstrapLocalPilot(paths);
  const server = fixture
    ? startPilotServer({
        port: 0,
        configuration: fixture.configuration,
        paystackClient: fixture.paystack,
      })
    : startLocalPilotServer({ port: 0, paths });
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    const entered = await fetch(
      `${base}/${kind === "staging" ? "?invite=offline-invite" : ""}`,
      { redirect: "manual" },
    );
    await run({
      base,
      cookie: cookieFrom(entered),
      origin: fixture ? PUBLIC_ORIGIN : "http://127.0.0.1:0",
      unitId: fixture?.configuration.unitId ?? "unit-local-abuja-wuse2",
    });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertCommerceUnavailable(host: Host): Promise<void> {
  for (const cookie of ["", host.cookie]) {
    for (const path of [
      "/s/harbour-goods",
      "/s/harbour-goods/offers/tote-offer",
      "/cart",
      "/orders/track",
    ]) {
      const response = await fetch(`${host.base}${path}`, {
        headers: { cookie },
        redirect: "manual",
      });
      assert.equal(
        response.status,
        404,
        `${path} must not mount on a pilot host`,
      );
    }
    const tracking = await fetch(`${host.base}/orders/track`, {
      method: "POST",
      headers: { cookie, origin: host.origin },
      body: new URLSearchParams({
        publicCode: "unknown",
        phone: "08000000000",
      }),
      redirect: "manual",
    });
    assert.equal(tracking.status, 404, "tracking must not accept POST either");
  }
}

test("AC1 — The production pilot host serves 404 for /s/<store>, /cart and /orders/track", async () => {
  for (const kind of ["production", "staging"] as const)
    await withPilot(kind, assertCommerceUnavailable);
});

test("AC1 startup — Validated pilot configuration fixes commerce to disabled and rejects every other injected value", async () => {
  const fixture = await productionFixture();
  try {
    assert.equal(Reflect.get(fixture.configuration, "commerce"), "disabled");
    for (const commerce of [
      undefined,
      null,
      "local",
      "enabled",
      "Disabled",
      "",
    ]) {
      const configuration = Object.assign({}, fixture.configuration, {
        commerce,
      });
      assert.throws(
        () =>
          startPilotServer({
            port: 0,
            configuration,
            paystackClient: fixture.paystack,
          }),
        /commerce must be disabled/,
      );
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("AC2 — The local pilot host serves 404 for the same paths", async () => {
  await withPilot("local", assertCommerceUnavailable);
});

test("AC3 — A guest message about buying a product on either pilot host gets the normal stays reply, and no Stays/Shop starters or task rail appear", async () => {
  for (const kind of ["production", "staging", "local"] as const)
    await withPilot(kind, async (host) => {
      const shell = await fetch(`${host.base}/`, {
        headers: { cookie: host.cookie },
      });
      assert.equal(shell.status, 200);
      const html = await shell.text();
      assert.match(html, /<nav id="task-rail"[^>]* hidden>/);
      assert.match(html, /<section id="vertical-starters"[^>]* hidden>/);
      assert.doesNotMatch(
        html,
        /class="ui-vertical-starter"|class="ui-task-rail__item/,
      );
      const threadId = `g-${crypto.randomUUID()}`;
      const turn = await postJson(
        host.base,
        "/api/turn",
        host.cookie,
        { threadId, text: "I want to buy a kettle" },
        host.origin,
      );
      assert.equal(turn.status, 200);
      assert.match(JSON.stringify(turn.body), /where you want to stay/);
      assert.doesNotMatch(
        JSON.stringify(turn.body),
        /Start a Commerce search|Started a Shop task|"domain(?:Id)?":"commerce"/,
      );
      const state = await fetch(`${host.base}/api/state?threadId=${threadId}`, {
        headers: { cookie: host.cookie },
      });
      assert.equal(state.status, 200);
      assert.doesNotMatch(await state.text(), /"domain(?:Id)?":"commerce"/);
      const reload = await fetch(`${host.base}/`, {
        headers: { cookie: host.cookie },
      });
      const restoredHtml = await reload.text();
      assert.match(restoredHtml, /<nav id="task-rail"[^>]* hidden>/);
      assert.match(
        restoredHtml,
        /<section id="vertical-starters"[^>]* hidden>/,
      );
      assert.doesNotMatch(
        restoredHtml,
        /class="ui-vertical-starter"|class="ui-task-rail__item/,
      );
    });
});

test("AC4 — Stays flows on both pilot hosts are unchanged (the existing pilot server tests pass without edits)", async () => {
  for (const kind of ["production", "staging", "local"] as const)
    await withPilot(kind, async (host) => {
      const unit = await fetch(`${host.base}/stays/${host.unitId}`, {
        headers: { cookie: host.cookie },
      });
      assert.equal(unit.status, 200);
      assert.match(await unit.text(), /Request to Book/);
      const threadId = `g-${crypto.randomUUID()}`;
      const city = await postJson(
        host.base,
        "/api/turn",
        host.cookie,
        { threadId, text: "Lagos" },
        host.origin,
      );
      assert.equal(city.status, 200);
      assert.match(JSON.stringify(city.body), /how many guests are staying/);
      const party = await postJson(
        host.base,
        "/api/turn",
        host.cookie,
        { threadId, text: "2 guests" },
        host.origin,
      );
      assert.equal(party.status, 200);
      assert.match(JSON.stringify(party.body), /what date you arrive/);
      const missingUnit = await fetch(`${host.base}/stays/no-such-unit`, {
        headers: { cookie: host.cookie },
      });
      assert.equal(missingUnit.status, 404);
    });
});
