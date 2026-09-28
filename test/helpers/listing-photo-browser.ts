import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../../apps/local-guest/src/guest-server.js";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./chrome-devtools.js";
import { startImageFixtureServer, type ImageFixtureServer } from "./image-fixtures.js";

/** A real-Chromium guest server whose first unit has the given photos, served by the image fixture (listing photos, gallery). */

export interface ListingPhotoContext {
  readonly directory: string;
  readonly environment: LocalGuestEnvironment;
  readonly server: LocalGuestServerHandle;
  readonly browser: RealBrowserInstance;
  readonly tab: RealBrowserTab;
  readonly base: string;
  readonly unitId: string;
  readonly unitTitle: string;
  readonly unitDescription: string;
  readonly imageFixture: ImageFixtureServer;
  close(): Promise<void>;
}

export async function createListingPhotoContext(photoUrls: readonly string[], width: number, height = 800): Promise<ListingPhotoContext> {
  const directory = mkdtempSync(join(tmpdir(), "listing-photos-browser-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const unit = environment.unitRepository.findAll()[0];
  assert.ok(unit);
  const unitDescription = "A bright, quiet apartment with a spacious living room, reliable power, secure parking, natural light, and room for a comfortable short stay.\n\nGuests have easy access to the surrounding neighbourhood and practical everyday amenities.";
  environment.unitRepository.save({ ...unit, description: unitDescription, bathrooms: 2, photoUrls: [...photoUrls] });
  const server = startLocalGuestServer({ port: 0, environment });
  const imageFixture = startImageFixtureServer();
  let browser: RealBrowserInstance | undefined;
  let tab: RealBrowserTab | undefined;
  let disposeImageInterception: (() => Promise<void>) | undefined;
  let closed = false;
  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      try { await disposeImageInterception?.(); } catch {}
      try { await tab?.close(); } catch {}
      try { await browser?.close({ releaseLock: false }); } catch {}
      try { await server.close(); } catch {}
      try { await imageFixture.close(); } catch {}
      rmSync(directory, { recursive: true, force: true });
    } finally {
      browser?.releaseLock();
    }
  };
  try {
    await imageFixture.listen();
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    browser = await launchRealBrowser({ headless: true });
    tab = await browser.createTab();
    await tab.setViewport(width, height);
    disposeImageInterception = await tab.interceptRequests((url) => imageFixture.respond(url));
    return {
      directory,
      environment,
      server,
      browser,
      tab,
      base,
      unitId: unit.id,
      unitTitle: unit.title,
      unitDescription,
      imageFixture,
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

