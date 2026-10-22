/**
 * Shared fixtures for the staging demo mode tests (issue 04, ADR 0105). Values are synthetic: Paystack keys are offline
 * placeholders and the origin is the test origin the other pilot fixtures use.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLIC_ORIGIN } from "./pilot-fixture.js";
import type { AssetLoader } from "../../packages/platform-core/src/asset-loader.js";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION, type GuestRequestHandler } from "../../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment, type LocalGuestFixtureConfig } from "../../apps/local-guest/src/fixture.js";
import { createFakeHttpRequest, createFakeHttpResponse, type CapturedResponse, type FakeRequestOptions } from "./http-like.js";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import assert from "node:assert/strict";

type ActionSurface = { readonly a2uiMessages: readonly A2UIServerMessage[]; readonly surfaceId: string };

/** The first action of a surface as the browser would send it (the same shape guest-booking-journey.test.ts uses). */
export function firstAction(surface: ActionSurface): { name: string; context: Record<string, unknown>; surfaceId: string; sourceComponentId: string; timestamp: string } {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  assert.ok(update);
  const component = (update.updateComponents.components as readonly { readonly action?: { readonly event?: { readonly name?: unknown; readonly context?: unknown } } }[]).find((candidate) => candidate.action?.event);
  assert.ok(component?.action?.event);
  assert.equal(typeof component.action.event.name, "string");
  assert.ok(component.action.event.context && typeof component.action.event.context === "object" && !Array.isArray(component.action.event.context));
  return { name: component.action.event.name as string, context: component.action.event.context as Record<string, unknown>, surfaceId: surface.surfaceId, sourceComponentId: "test", timestamp: new Date().toISOString() };
}

export const DEMO_INVITE_CODE = "demo-mode-invite-offline";

/** Staging with the demo switched on: no invite code is needed (ADR 0105). */
export const DEMO_STAGING_SOURCE = {
  SHORTLET_DEPLOYMENT: "staging",
  SHORTLET_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
  SHORTLET_TENANT_ID: "tenant-staging-demo",
  PAYSTACK_SECRET_KEY: "sk_test_offline-only",
  PAYSTACK_ENVIRONMENT: "test",
  SHORTLET_DEMO: "enabled",
} as const;

/** Staging with the demo off: the invite gate applies as before (issue 22). */
export const STAGING_WITHOUT_DEMO_SOURCE = {
  ...DEMO_STAGING_SOURCE,
  SHORTLET_DEMO: undefined,
  SHORTLET_BETA_INVITE_CODE: DEMO_INVITE_CODE,
} as const;

/** Production with the demo switched on: must refuse at startup (ADR 0105). */
export const PRODUCTION_WITH_DEMO_SOURCE = {
  SHORTLET_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
  SHORTLET_TENANT_ID: "tenant-production-demo",
  PAYSTACK_SECRET_KEY: "sk_live_offline-only",
  PAYSTACK_ENVIRONMENT: "live",
  SHORTLET_DEMO: "enabled",
} as const;

export function demoDatabase(): { readonly dir: string; readonly path: string } {
  const dir = mkdtempSync(join(tmpdir(), "demo-mode-"));
  return { dir, path: join(dir, "guest.sqlite") };
}

export function removeDemoDatabase(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

const demoAssets: AssetLoader = {
  text: (name) => (name.endsWith(".css") ? "/* injected stylesheet */" : "/* injected script */"),
};
const demoBinaryAssets = { read: (_name: string): Uint8Array => new Uint8Array([1, 2, 3]) };

/** The guest handler as the staging composition builds it. The demo flag rides on the environment configuration. */
export function demoGuestHandler(environment: LocalGuestEnvironment, options: { readonly betaInviteCode?: string } = {}): GuestRequestHandler {
  return createGuestRequestHandler({
    environment,
    commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    assets: demoAssets,
    sessionScopedGuestPrincipals: true,
    landingBinaryAssets: demoBinaryAssets,
    ...(options.betaInviteCode === undefined ? {} : { betaInviteCode: options.betaInviteCode }),
  });
}

export async function sendDemoRequest(handler: GuestRequestHandler, path: string, options: Partial<FakeRequestOptions> = {}): Promise<CapturedResponse> {
  const req = createFakeHttpRequest({ method: "GET", url: path, headers: { host: "localhost" }, ...options });
  const { response, finished } = createFakeHttpResponse();
  await handler.handle(req, response);
  return finished;
}

export function setCookieOf(response: CapturedResponse): string | undefined {
  return response.headers.find((header) => header.name.toLowerCase() === "set-cookie")?.value;
}

/** Opens a guest environment on the given database and runs the test body, closing it afterwards. */
export async function withDemoEnvironment(
  options: Partial<LocalGuestFixtureConfig> & { readonly databasePath: string },
  run: (environment: LocalGuestEnvironment) => Promise<void> | void,
): Promise<void> {
  const environment = LocalGuestEnvironment.openNode(options);
  try {
    await run(environment);
  } finally {
    environment.close();
  }
}
