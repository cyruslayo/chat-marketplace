/// <reference types="@cloudflare/vitest-plugin/types" />
/// <reference path="../src/env.d.ts" />
/// <reference path="../src/cloudflare-workers.d.ts" />
// Keep the real Workers declarations available when an editor opens this spec as an inferred project.
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { LANDING_BINARY_ASSETS } from "../../local-guest/src/landing-assets.js";
import { GUEST_HTML_SECURITY_HEADERS } from "../../../packages/platform-core/src/security-headers.js";
import { ORIGIN, provisionTenant } from "./ops-test-helpers.js";

// Injected from the Node host's real AssetLoader by the Node-side Vitest configuration.
declare const __LANDING_NODE_ASSETS__: Readonly<
  Record<string, { readonly byteLength: number; readonly sha256: string }>
>;

// SELF calls the Worker entry directly; the real front door serves static files first.
// Exercise that native service through ASSETS, not a second application asset implementation.
test("Landing 12 AC1: GET /welcome and every referenced asset return 200 with the correct content type in Workers, without a session or with a stale session", async () => {
  await provisionTenant();
  for (const cookie of ["", "shortlet_guest_session=stale"]) {
    const page = await SELF.fetch(`${ORIGIN}/welcome`, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("set-cookie")).toBeNull();
    expect(page.headers.get("content-security-policy")).toBe(
      GUEST_HTML_SECURITY_HEADERS["Content-Security-Policy"],
    );
    const html = await page.text();
    expect(html).toContain("Your apartment");
    expect(html).not.toContain("/landing/photos/");
    const paths = [
      ...html.matchAll(
        /(?:href|src)="(\/(?:landing\/[^"#]+|landing\.js|shortlet-(?:landing|foundations)\.css))"/g,
      ),
    ].map((match) => match[1]!);
    expect(paths).toContain("/landing.js");
    expect(paths).toContain("/shortlet-landing.css");
    expect(paths).toContain("/landing/fonts/newsreader-500.woff2");
    for (const path of new Set(paths)) {
      const asset = await env.ASSETS.fetch(`${ORIGIN}${path}`);
      expect(asset.status, path).toBe(200);
      const mime = path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".js")
          ? "text/javascript"
          : "font/woff2";
      expect(asset.headers.get("content-type"), path).toContain(mime);
      expect((await asset.arrayBuffer()).byteLength, path).toBeGreaterThan(0);
    }
  }
});

test("Landing 12 AC2: Fonts and photos have correct MIME types and long-cache immutable headers; unknown landing assets return 404, not 500", async () => {
  await provisionTenant();
  for (const [path, metadata] of Object.entries(LANDING_BINARY_ASSETS)) {
    const asset = await env.ASSETS.fetch(`${ORIGIN}${path}`);
    expect(asset.status, path).toBe(200);
    expect(asset.headers.get("content-type"), path).toBe(metadata.contentType);
    expect(asset.headers.get("cache-control"), path).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await asset.arrayBuffer()).byteLength, path).toBeGreaterThan(0);
  }
  for (const path of [
    "/landing/fonts/unknown.woff2",
    "/landing/photos/unknown.jpg",
    "/landing/photos/%2e%2e%2fprivate.jpg",
  ]) {
    expect((await env.ASSETS.fetch(`${ORIGIN}${path}`)).status, path).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}${path}`)).status, path).toBe(404);
  }
});

test("Landing 12 AC3: Landing stylesheet and script bytes on Cloudflare are identical to the canonical files used by the Node host", async () => {
  await provisionTenant();
  // Compare exact byte counts and SHA-256, not CSS ?raw text whose line endings Vite normalizes.
  for (const [name, expected] of Object.entries(__LANDING_NODE_ASSETS__)) {
    const asset = await env.ASSETS.fetch(`${ORIGIN}/${name}`);
    expect(asset.status, name).toBe(200);
    const bytes = await asset.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(bytes.byteLength, name).toBe(expected.byteLength);
    expect(sha256, name).toBe(expected.sha256);
  }
});
