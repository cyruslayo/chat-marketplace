import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listingGalleryHtml } from "../apps/local-guest/src/listing-gallery.js";
import { renderConventionalUnitDetailHtml, startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

// Guest gallery issue 01 — the server side of the gallery (.scratch/guest-gallery/issues/01-listing-photo-gallery.md).

const photos = Array.from({ length: 7 }, (_, index) => ({ src: `https://images.example/photo-${index + 1}.png`, alt: `Photo ${index + 1} of Garden Flat` }));

test("AC4 — Without JavaScript, every photo is still shown in its stored order, and each links to the full-size image", () => {
  const html = listingGalleryHtml({ title: "Garden Flat", photos });
  const links = [...html.matchAll(/<a class="listing-gallery__open" href="([^"]+)" data-index="(\d+)"><img src="([^"]+)"/g)];
  assert.deepEqual(links.map((match) => match[1]), photos.map((photo) => photo.src), "in stored order, each linking to its full image");
  assert.deepEqual(links.map((match) => match[3]), photos.map((photo) => photo.src));
  assert.deepEqual(links.map((match) => Number(match[2])), [0, 1, 2, 3, 4, 5, 6]);
  // The cover loads first at high priority; the rest lazily; all without a referrer (ADR 0075).
  const images = [...html.matchAll(/<img [^>]+>/g)].map((match) => match[0]);
  assert.match(images[0]!, /loading="eager" fetchpriority="high"/);
  for (const image of images.slice(1)) {
    assert.match(image, /loading="lazy"/);
    assert.doesNotMatch(image, /fetchpriority/);
  }
  for (const image of images) assert.match(image, /referrerpolicy="no-referrer"/);
  // "Show all" exists only for the script to reveal; nothing is hidden without it.
  assert.match(html, /<button type="button" class="ui-button ui-button--secondary listing-gallery__all" hidden>Show all 7 photos<\/button>/);
  assert.match(html, /<p class="listing-gallery__count" aria-live="polite">7 photos<\/p>/);
  // Names for assistive technology (ADR 0078).
  assert.match(html, /<section class="listing-gallery" aria-label="Photos of Garden Flat" data-count="7">/);
  assert.match(html, /tabindex="0" aria-label="7 photos of Garden Flat\. Swipe or scroll to see more\."/);
  // Text is escaped.
  assert.match(listingGalleryHtml({ title: "A <b> & \"C\"", photos: photos.slice(0, 1) }), /aria-label="Photos of A &lt;b&gt; &amp; &quot;C&quot;"/);
});

test("AC5 — The full apartment page and the chat's apartment details use the same gallery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "listing-gallery-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const server = startLocalGuestServer({ port: 0, environment });
  try {
    const unit = environment.unitRepository.findAll()[0]!;
    const page = renderConventionalUnitDetailHtml({ ...unit, photoUrls: photos.map((photo) => photo.src) });
    assert.match(page, /<section class="listing-gallery"/, "the full page renders the shared gallery");
    assert.match(page, /class="unit-detail-sheet" aria-label="Stay details"/, "the summary sheet overlaps the gallery");
    assert.match(page, /class="ui-tiles" aria-label="Stay facts"/, "stay facts use the kit tiles");
    assert.match(page, /class="ui-action-bar"/, "the request action stays available at the bottom");
    assert.match(page, /\.listing-gallery__track\{/, "with the shared styles");
    assert.match(page, /<script src="\/gallery\.js" defer><\/script>/, "and the shared script");
    // Photo alternatives name the apartment.
    assert.ok(page.includes(`alt="Photo 1 of ${unit.title}"`));
    // No photos: no gallery, no script, the existing message.
    const bare = renderConventionalUnitDetailHtml({ ...unit, photoUrls: [] });
    assert.doesNotMatch(bare, /listing-gallery"|gallery\.js/);
    assert.match(bare, /Photos are not available for this apartment yet\./);

    // The script is served to anyone, like the apartment page itself (no session needed).
    const port = await server.listen();
    const response = await fetch(`http://127.0.0.1:${port}/gallery.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    assert.match(await response.text(), /listing-gallery/);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("A public apartment page keeps its stylesheet and gallery script for a Guest with an unrecognised session", async () => {
  // Found during the gallery walkthrough: with session-scoped Guests (the pilot and production), an expired or unknown
  // session cookie made the shared stylesheet 401, so the public page rendered unstyled.
  const directory = mkdtempSync(join(tmpdir(), "listing-gallery-session-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const server = startLocalGuestServer({ port: 0, environment, sessionScopedGuestPrincipals: true });
  try {
    const port = await server.listen();
    const unit = environment.unitRepository.findAll()[0]!;
    const stale = { cookie: "shortlet_guest_session=gs-00000000-0000-4000-8000-000000000000" };
    for (const path of [`/stays/${unit.id}`, "/shortlet-foundations.css", "/gallery.js"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: stale });
      assert.equal(response.status, 200, path);
    }
    // Private routes still refuse the unknown session.
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/state`, { headers: stale })).status, 401);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

