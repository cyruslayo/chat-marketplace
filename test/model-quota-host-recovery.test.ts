import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { SqliteModelRequestQuota, type ModelRequestQuotaPort } from "../packages/platform-core/src/model-request-quota.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";

type FailureMode = "quota" | "storage" | "provider";

async function recoveryFixture() {
  let failure: FailureMode | undefined;
  let transports = 0;
  let authority: SqliteModelRequestQuota | undefined;
  let scope: Parameters<ModelRequestQuotaPort["reserve"]>[0] | undefined;
  const quota: ModelRequestQuotaPort = {
    reserve: async (input) => {
      scope = input;
      if (failure === "storage") throw new Error("Synthetic quota storage failure");
      assert.ok(authority);
      return authority.reserve(input);
    },
  };
  const scripted = new ScriptedAssistantModel();
  const model: AssistantModelClient = {
    supportsProviderAttemptReservation: true,
    generate: async (request) => {
      await request.beforeProviderAttempt?.();
      transports++;
      if (failure === "provider") return {};
      return scripted.generate(request);
    },
  };
  const fixture = await restartFixture({}, {
    conciergeMode: "openai-compatible", modelClient: model, modelRequestQuota: quota,
    sessionScopedGuestPrincipals: true,
  });
  authority = new SqliteModelRequestQuota(fixture.environment.database, { dailyTenantLimit: 100, hourlyGuestLimit: 100 });
  return {
    ...fixture,
    transportCount: () => transports,
    async providePhone() {
      const response = await fetch(`${fixture.base}/guest/contact/phone`, {
        method: "POST", redirect: "manual",
        headers: { cookie: fixture.cookie, origin: fixture.base, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ phoneNumber: "08012345678", expectedRevision: "0" }),
      });
      assert.equal(response.status, 303, "Provide the authenticated guest contact prerequisite through its conventional route");
      await response.text();
    },
    async fail(mode: FailureMode) {
      if (mode === "quota") {
        assert.ok(scope);
        let denied = false;
        for (let attempt = 0; attempt <= 100; attempt++) {
          if (!(await authority!.reserve(scope)).reserved) { denied = true; break; }
        }
        assert.ok(denied, "Exhaust the actual persistent authority before recovery checks");
      }
      failure = mode;
    },
  };
}

test("AC4: exhaustion, provider refusal, and guard outage preserve authenticated deterministic pending decisions", async (t) => {
  for (const mode of ["quota", "storage", "provider"] as const) {
    for (const decision of ["Yes", "Cancel"]) {
      await t.test(`${mode}: ${decision}`, async () => {
        const fixture = await recoveryFixture();
        try {
          const search = await fixture.send("/api/turn", { text: "I need a place in Ikoyi for 4 nights for 2 guests" });
          assert.equal(search.ok, true);
          await fixture.providePhone();
          const proposal = await fixture.send("/api/turn", { text: "Request the first one." });
          assert.equal(proposal.ok, true);
          if (!proposal.ok) return;
          const pending = proposal.surfaces.find((surface) => JSON.stringify(surface.a2uiMessages).includes(ASSISTANT_CONFIRM_ACTION_EVENT));
          assert.ok(pending, "Create an authenticated exact-effect pending decision before failure");
          const confirmation = guestAction(pending, ASSISTANT_CONFIRM_ACTION_EVENT);
          await fixture.fail(mode);
          const before = fixture.transportCount();
          const result = await fixture.send("/api/turn", { text: decision });
          assert.equal(result.ok, true, "The authorized pending decision must remain available");
          assert.equal(fixture.transportCount(), before, "Pending decisions cannot need classifier or provider access");
          if (result.ok) assert.match(result.messages.join(" "), decision === "Cancel" ? /cancelled/i : /request|review|sent/i);
          const replay = await fixture.send("/api/event", confirmation);
          assert.equal(replay.ok, false, "Consumed pending authority cannot execute a second action");
          assert.equal(fixture.transportCount(), before);
        } finally { await fixture.close(); }
      });
    }
  }
});

test("AC4: exhaustion, provider refusal, and guard outage preserve authorized conventional discovery and draft routes", async (t) => {
  for (const mode of ["healthy", "quota", "storage", "provider"] as const) {
    await t.test(mode, async () => {
      const fixture = await recoveryFixture();
      try {
        const search = await fixture.send("/api/turn", { text: "I need a place in Ikoyi for 4 nights for 2 guests" });
        assert.equal(search.ok, true);
        if (!search.ok) return;
        if (mode !== "healthy") {
          await fixture.fail(mode);
          const refused = await fixture.send("/api/turn", { text: "Please check my stay" });
          assert.equal(refused.ok, true);
          if (refused.ok) assert.deepEqual(refused.messages, [ASSISTANT_CONTROL_COPY.unavailable]);
        }
        const before = fixture.transportCount();
        const current = await fixture.state();
        assert.equal(current.ok, true);
        if (!current.ok) return;
        const details = await fixture.send("/api/event", guestAction(current.surfaces[0]!, "shortlet.discovery.view-unit"));
        assert.equal(details.ok, true, "The authorized discovery action must remain available");
        if (!details.ok) return;
        const draft = await fixture.send("/api/event", guestAction(details.surfaces[0]!));
        assert.equal(draft.ok, true, "The conventional draft action must remain available");
        if (!draft.ok) return;
        const route = draft.surfaces[0]?.conventionalRoute;
        assert.match(route ?? "", /^\/booking-requests\/drafts\//);
        const page = await fetch(`${fixture.base}${route}`, { headers: { cookie: fixture.cookie } });
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Request Draft|Review your/);
        assert.equal(fixture.transportCount(), before, "Conventional effects cannot invoke the unavailable model");
      } finally { await fixture.close(); }
    });
  }
});
