import assert from "node:assert/strict";
import { createPlatformCommandEnvelope } from "../../packages/platform-core/src/index.js";
import { DirectPaystackClient, SqliteOperatorRepresentativeGrantStore, SqliteOperatorSessionAuthority, type PaystackHttpFetcher } from "../../domains/shortlet/src/index.js";
import { PUBLIC_ORIGIN, type ProductionFixture } from "./pilot-fixture.js";

/** The generated A2UI action behind the button labelled `label` on the latest surface of a turn or state body. */
export function surfaceAction(body: unknown, label: string): { readonly surfaceId: string; readonly name: string; readonly context: Record<string, unknown>; readonly sourceComponentId: string } {
  assert.ok(body !== null && typeof body === "object");
  const surfaces = (body as { surfaces?: unknown }).surfaces;
  assert.ok(Array.isArray(surfaces) && surfaces.length > 0);
  const surface = surfaces.at(-1);
  assert.ok(surface !== null && typeof surface === "object");
  const record = surface as { surfaceId?: unknown; a2uiMessages?: unknown };
  assert.equal(typeof record.surfaceId, "string");
  assert.ok(Array.isArray(record.a2uiMessages));
  for (const message of record.a2uiMessages) {
    if (message === null || typeof message !== "object") continue;
    const update = (message as { updateComponents?: { components?: unknown } }).updateComponents;
    if (!update || !Array.isArray(update.components)) continue;
    const components = update.components.filter((component): component is Record<string, unknown> => component !== null && typeof component === "object");
    const textById = new Map(components.filter((component) => component.component === "Text" && typeof component.id === "string").map((component) => [component.id as string, typeof component.text === "string" ? component.text : ""]));
    const button = components.find((component) => component.component === "Button" && typeof component.id === "string" && typeof component.child === "string" && (textById.get(component.child) ?? "").includes(label));
    const event = button?.action;
    if (!button || event === null || typeof event !== "object") continue;
    const eventValue = (event as { event?: unknown }).event;
    if (eventValue === null || typeof eventValue !== "object") continue;
    const name = (eventValue as { name?: unknown }).name;
    const context = (eventValue as { context?: unknown }).context;
    if (typeof name === "string" && context !== null && typeof context === "object" && !Array.isArray(context)) {
      return { surfaceId: record.surfaceId as string, name, context: context as Record<string, unknown>, sourceComponentId: button.id as string };
    }
  }
  throw new Error(`A2UI action not found: ${label}`);
}

export async function postJson(base: string, path: string, cookie: string, body: unknown, origin = PUBLIC_ORIGIN): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { cookie: cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

export async function guestEvent(base: string, cookie: string, threadId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await postJson(base, "/api/event", cookie, { threadId, ...body });
  assert.equal(result.status, 200);
  return result.body;
}

/** A representative grant and a one-time sign-in token for the fixture's Operator (ADR 0082, 0086). */
export function provisionOperatorToken(fixture: ProductionFixture, clock: () => Date, reference: string): string {
  const actorId = "production-session-actor";
  const grants = new SqliteOperatorRepresentativeGrantStore(fixture.configuration.databasePath, { clock });
  grants.createGrant(createPlatformCommandEnvelope({
    commandName: "operator_representative.grant",
    principal: { id: "pilot-admin", role: "admin", tenantId: fixture.configuration.tenantId },
    payload: {
      actorId,
      operatorId: fixture.configuration.operatorId,
      expiresAtIso: "2027-01-01T00:00:00Z",
      responsiblePersonVerifiedAtIso: "2026-01-01T00:00:00Z",
      verificationReference: reference,
    },
    idempotencyKey: `${reference}-grant`,
  }));
  const sessions = new SqliteOperatorSessionAuthority(fixture.configuration.databasePath, { clock });
  const token = sessions.provisionAccessToken({ actorId, tenantId: fixture.configuration.tenantId, representativeAuthorized: true }).token;
  sessions.close();
  grants.close();
  return token;
}

/** A live-mode Paystack client over a fake HTTP transport that approves whatever it initialized. */
export function approvingPaystack(fixture: ProductionFixture): { readonly provider: DirectPaystackClient; readonly initializedReference: () => string } {
  let initializedReference = "";
  let initializedAmount = 0;
  let initializedPayerId = "";
  const fetcher: PaystackHttpFetcher = async (_url, init) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body ?? "{}") as { reference?: string; amount?: number; metadata?: string };
      initializedReference = body.reference ?? "";
      initializedAmount = body.amount ?? 0;
      initializedPayerId = typeof body.metadata === "string" ? ((JSON.parse(body.metadata) as { shortlet_guest_id?: string }).shortlet_guest_id ?? "") : "";
      return { status: 200, async json() { return { status: true, data: { authorization_url: "https://checkout.paystack.com/callback-regression", reference: initializedReference } }; } };
    }
    return {
      status: 200,
      async json() {
        return { status: true, data: { reference: initializedReference, amount: initializedAmount, currency: "NGN", status: "success", domain: "live", metadata: JSON.stringify({ shortlet_guest_id: initializedPayerId }) } };
      },
    };
  };
  return { provider: new DirectPaystackClient(fixture.configuration.paystack, fetcher), initializedReference: () => initializedReference };
}
