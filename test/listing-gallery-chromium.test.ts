import test from "node:test";
import assert from "node:assert/strict";
import { createListingPhotoContext, type ListingPhotoContext } from "./helpers/listing-photo-browser.js";

// Guest gallery issue 01 — the gallery in real Chromium (.scratch/guest-gallery/issues/01-listing-photo-gallery.md).

const PHOTOS = Array.from({ length: 7 }, (_, index) => `https://images.example/photo-${index + 1}.png`);

async function openStayPage(context: ListingPhotoContext): Promise<void> {
  await context.tab.navigate(`${context.base}/stays/${context.unitId}`);
  await context.tab.waitForFunction("document.querySelector('.listing-gallery.is-enhanced') !== null", 15000);
}

async function openChatDetail(context: ListingPhotoContext): Promise<void> {
  await context.tab.navigate(`${context.base}/`);
  await context.tab.waitForSelector("#composer-input");
  await context.tab.evaluate(`(() => { const input = document.getElementById('composer-input'); input.value = 'I need an apartment in Lagos from 10 Sept for 2 nights for 2 people'; document.getElementById('composer').requestSubmit(); })()`);
  await context.tab.waitForText(context.unitTitle, 30000);
  assert.equal(await context.tab.clickButton("View apartment", context.unitTitle), true);
  await context.tab.waitForFunction("document.querySelector('#active-workspace .listing-gallery.is-enhanced') !== null", 15000);
}

const layout = (scope: string) => `(() => {
  const gallery = document.querySelector(${JSON.stringify(scope)});
  const items = [...gallery.querySelectorAll('.listing-gallery__item')];
  const boxes = items.map((item) => { const r = item.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), shown: getComputedStyle(item).display !== 'none' }; });
  const track = gallery.querySelector('.listing-gallery__track');
  const all = gallery.querySelector('.listing-gallery__all');
  return {
    boxes,
    trackWidth: Math.round(track.getBoundingClientRect().width),
    scrollable: track.scrollWidth > track.clientWidth + 1,
    snap: getComputedStyle(track).scrollSnapType,
    count: gallery.querySelector('.listing-gallery__count')?.textContent ?? '',
    countShown: getComputedStyle(gallery.querySelector('.listing-gallery__count')).display !== 'none',
    all: all && !all.hidden && getComputedStyle(all).display !== 'none' ? all.textContent : null,
    more: items[4]?.dataset.more ?? null,
    hrefs: items.map((item) => item.querySelector('a')?.getAttribute('href')),
    documentWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
  };
})()`;

interface Layout {
  readonly boxes: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly shown: boolean }[];
  readonly trackWidth: number;
  readonly scrollable: boolean;
  readonly snap: string;
  readonly count: string;
  readonly countShown: boolean;
  readonly all: string | null;
  readonly more: string | null;
  readonly hrefs: readonly (string | null)[];
  readonly documentWidth: number;
  readonly viewport: number;
}

test("AC1 — On phones (below 48rem), the apartment's photos form a swipeable strip, one photo at a time in their stored order, with a \"Photo X of N\" count that follows the swipe. The page does not scroll sideways at 320px", async () => {
  for (const width of [320, 390]) {
    const context = await createListingPhotoContext(PHOTOS, width);
    try {
      await openStayPage(context);
      const strip = await context.tab.evaluate<Layout>(layout(".listing-gallery"));
      assert.deepEqual(strip.hrefs, PHOTOS, "in stored order");
      assert.equal(strip.scrollable, true, "a horizontal strip");
      assert.match(strip.snap, /x mandatory/);
      assert.ok(strip.boxes.every((box) => box.w === strip.trackWidth), `one photo at a time at ${width}px`);
      assert.ok(strip.boxes.every((box, index) => index === 0 || box.x > strip.boxes[index - 1]!.x), "left to right");
      assert.equal(strip.countShown, true);
      assert.equal(strip.count, "Photo 1 of 7");
      assert.ok(strip.documentWidth <= width, `no sideways page scroll at ${width}px`);
      // Swipe to the third photo: the count follows.
      await context.tab.evaluate("(() => { const track = document.querySelector('.listing-gallery__track'); track.style.scrollBehavior = 'auto'; track.scrollLeft = track.clientWidth * 2 + 8; })()");
      await context.tab.waitForFunction("document.querySelector('.listing-gallery__count')?.textContent === 'Photo 3 of 7'", 5000);
      // The strip itself can be reached and scrolled with the keyboard (ADR 0078).
      assert.equal(await context.tab.evaluate<number>("document.querySelector('.listing-gallery__track').tabIndex"), 0);
    } finally {
      await context.close();
    }
  }
});

test("AC2 — On wider screens, the gallery shows the cover large beside up to four more photos. With more than five photos, the fifth shows \"+K more\" and a \"Show all N photos\" button appears", async () => {
  const context = await createListingPhotoContext(PHOTOS, 1280, 900);
  try {
    await openStayPage(context);
    const mosaic = await context.tab.evaluate<Layout>(layout(".listing-gallery"));
    assert.equal(mosaic.scrollable, false, "a mosaic, not a strip");
    const [cover, ...rest] = mosaic.boxes;
    const shown = rest.filter((box) => box.shown);
    assert.equal(shown.length, 4, "the cover and four more");
    assert.ok(!mosaic.boxes[5]!.shown && !mosaic.boxes[6]!.shown, "the rest wait for Show all");
    assert.ok(cover!.w > shown[0]!.w * 1.5 && cover!.h > shown[0]!.h * 1.5, "the cover is large");
    assert.ok(shown.every((box) => box.x > cover!.x), "beside the cover");
    assert.equal(mosaic.more, "+2 more");
    assert.equal(await context.tab.evaluate<string>("getComputedStyle(document.querySelectorAll('.listing-gallery__item')[4], '::after').content"), "\"+2 more\"");
    assert.equal(mosaic.all, "Show all 7 photos");
    assert.equal(mosaic.countShown, false, "no strip count on wide screens");
    assert.ok(mosaic.documentWidth <= 1280);

    // Five or fewer photos: no "+K", and no hidden photos.
    const unit = context.environment.unitRepository.findById(context.unitId)!;
    context.environment.unitRepository.save({ ...unit, photoUrls: PHOTOS.slice(0, 3) });
    await openStayPage(context);
    const three = await context.tab.evaluate<Layout>(layout(".listing-gallery"));
    assert.equal(three.boxes.filter((box) => box.shown).length, 3);
    assert.equal(three.more, null);
    assert.ok(three.boxes[0]!.w > three.boxes[1]!.w, "the cover is still the largest");
  } finally {
    await context.close();
  }
});

test("AC3 — Tapping a photo, or \"Show all\", opens a full-screen viewer at that photo, with previous and next buttons, arrow keys, swipe and an \"X of N\" count. Esc, the close button or a tap outside closes it, and focus returns to what opened it", async () => {
  for (const width of [390, 1280]) {
    const context = await createListingPhotoContext(PHOTOS, width, 900);
    try {
      await openStayPage(context);
      const viewer = `(() => { const dialog = document.querySelector('dialog.listing-viewer'); const rect = dialog?.getBoundingClientRect(); return { open: Boolean(dialog?.open), modal: Boolean(dialog?.matches(':modal')), count: dialog?.querySelector('.listing-viewer__count')?.textContent ?? '', full: rect ? rect.width >= innerWidth - 1 && rect.height >= innerHeight - 1 : false, prevDisabled: dialog?.querySelector('.listing-viewer__prev')?.disabled, nextDisabled: dialog?.querySelector('.listing-viewer__next')?.disabled, active: document.activeElement?.className ?? '' }; })()`;
      type Viewer = { open: boolean; modal: boolean; count: string; full: boolean; prevDisabled: boolean; nextDisabled: boolean; active: string };
      // No viewer (and no extra image requests) until it is first opened.
      assert.equal(await context.tab.evaluate<boolean>("document.querySelector('dialog.listing-viewer') === null"), true);

      // Tap the third photo (on a phone, swipe the strip to it first).
      await context.tab.evaluate("(() => { const link = document.querySelectorAll('.listing-gallery__open')[2]; link.scrollIntoView({ inline: 'start', block: 'nearest' }); link.click(); })()");
      await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer')?.open === true", 5000);
      let state = await context.tab.evaluate<Viewer>(viewer);
      assert.equal(state.modal, true, "a modal dialog");
      assert.equal(state.full, true, "full screen");
      assert.equal(state.count, "3 of 7", "at the photo tapped");
      assert.match(state.active, /listing-viewer__close/, "focus moves into the viewer");
      // Next button, arrow keys.
      await context.tab.evaluate("document.querySelector('.listing-viewer__next').click()");
      await context.tab.waitForFunction("document.querySelector('.listing-viewer__count').textContent === '4 of 7'", 5000);
      await context.tab.pressKey("ArrowRight");
      await context.tab.evaluate("document.querySelector('dialog.listing-viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
      await context.tab.waitForFunction("['5 of 7', '6 of 7'].includes(document.querySelector('.listing-viewer__count').textContent)", 5000);
      await context.tab.evaluate("document.querySelector('dialog.listing-viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))");
      await context.tab.waitForFunction("document.querySelector('.listing-viewer__count').textContent === '7 of 7'", 5000);
      state = await context.tab.evaluate<Viewer>(viewer);
      assert.equal(state.nextDisabled, true, "no next after the last photo");
      await context.tab.evaluate("document.querySelector('.listing-viewer__prev').click()");
      await context.tab.waitForFunction("document.querySelector('.listing-viewer__count').textContent === '6 of 7'", 5000);
      // Swipe: scrolling the viewer's track moves the count.
      await context.tab.evaluate("(() => { const track = document.querySelector('.listing-viewer__track'); track.style.scrollBehavior = 'auto'; track.scrollLeft = 0; })()");
      await context.tab.waitForFunction("document.querySelector('.listing-viewer__count').textContent === '1 of 7'", 5000);
      state = await context.tab.evaluate<Viewer>(viewer);
      assert.equal(state.prevDisabled, true, "no previous before the first photo");

      // Esc closes it; focus returns to the photo that opened it.
      await context.tab.pressKey("Escape");
      await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === false", 5000);
      assert.equal(await context.tab.evaluate<boolean>("document.activeElement === document.querySelectorAll('.listing-gallery__open')[2]"), true);

      // The close button, and a tap outside the photo.
      await context.tab.evaluate("document.querySelectorAll('.listing-gallery__open')[0].click()");
      await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === true", 5000);
      await context.tab.evaluate("document.querySelector('.listing-viewer__close').click()");
      await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === false", 5000);
      await context.tab.evaluate("document.querySelectorAll('.listing-gallery__open')[1].click()");
      await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === true", 5000);
      await context.tab.evaluate("document.querySelectorAll('.listing-viewer__item')[1].click()");
      await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === false", 5000);

      // "Show all" opens at the first photo (wide screens show it).
      if (width === 1280) {
        await context.tab.evaluate("document.querySelector('.listing-gallery__all').click()");
        await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === true", 5000);
        assert.equal((await context.tab.evaluate<Viewer>(viewer)).count, "1 of 7");
        await context.tab.pressKey("Escape");
        await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === false", 5000);
        assert.equal(await context.tab.evaluate<boolean>("document.activeElement === document.querySelector('.listing-gallery__all')"), true);
      }
      // Viewer photos load without a referrer too (ADR 0075).
      assert.equal(await context.tab.evaluate<boolean>("[...document.querySelectorAll('.listing-viewer img')].every((img) => img.referrerPolicy === 'no-referrer')"), true);
    } finally {
      await context.close();
    }
  }
});

test("AC4 — Without JavaScript, every photo is still shown in its stored order, and each links to the full-size image. The page and Request to Book stay usable", async () => {
  for (const width of [320, 1280]) {
    const context = await createListingPhotoContext(PHOTOS, width, 900);
    try {
      await context.tab.setJavaScriptEnabled(false);
      await context.tab.navigate(`${context.base}/stays/${context.unitId}`);
      await context.tab.waitForSelector(".listing-gallery");
      const plain = await context.tab.evaluate<Layout>(layout(".listing-gallery"));
      assert.deepEqual(plain.hrefs, PHOTOS, "every photo, in order, links to its full image");
      assert.ok(plain.boxes.every((box) => box.shown), "nothing is hidden without the script");
      assert.equal(plain.all, null, "no Show all button without the script");
      assert.equal(await context.tab.evaluate<boolean>("document.querySelector('.listing-gallery').classList.contains('is-enhanced')"), false);
      assert.ok(plain.documentWidth <= width);
      const text = await context.tab.evaluate<string>("document.body.innerText");
      assert.ok(text.includes(context.unitTitle) && text.includes("Continue to Request to Book"));
    } finally {
      await context.close();
    }
  }
});

test("AC5 — The full apartment page and the chat's apartment details use the same gallery. A photo that fails to load still shows the \"Photo unavailable\" box named for the apartment. Photos after the cover load lazily, and all use the no-referrer policy", async () => {
  const context = await createListingPhotoContext(PHOTOS, 390, 900);
  try {
    await openChatDetail(context);
    const chat = await context.tab.evaluate<Layout>(layout("#active-workspace .listing-gallery"));
    assert.deepEqual(chat.hrefs, PHOTOS, "the chat's details use the same gallery, in order");
    assert.equal(chat.count, "Photo 1 of 7");
    const images = await context.tab.evaluate<{ loading: string; referrer: string }[]>("[...document.querySelectorAll('#active-workspace .listing-gallery img')].map((img) => ({ loading: img.loading, referrer: img.referrerPolicy }))");
    assert.equal(images[0]!.loading, "eager");
    assert.ok(images.slice(1).every((image) => image.loading === "lazy"));
    assert.ok(images.every((image) => image.referrer === "no-referrer"));
    // The chat's viewer opens too.
    await context.tab.evaluate("document.querySelectorAll('#active-workspace .listing-gallery__open')[1].click()");
    await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer')?.open === true", 5000);
    assert.equal(await context.tab.evaluate<string>("document.querySelector('.listing-viewer__count').textContent"), "2 of 7");
    await context.tab.pressKey("Escape");
    await context.tab.waitForFunction("document.querySelector('dialog.listing-viewer').open === false", 5000);

    // A broken photo on the full page becomes the named "Photo unavailable" box, and the page stays usable.
    const unit = context.environment.unitRepository.findById(context.unitId)!;
    context.environment.unitRepository.save({ ...unit, photoUrls: [PHOTOS[0]!, context.imageFixture.brokenUrl, PHOTOS[2]!] });
    await openStayPage(context);
    await context.tab.evaluate("document.querySelectorAll('.listing-gallery__open')[1].scrollIntoView({ inline: 'start', block: 'nearest' })");
    await context.tab.waitForFunction("Boolean(document.querySelector('.listing-gallery .photo-fallback'))", 15000);
    const fallback = await context.tab.evaluate<{ role: string | null; name: string | null; text: string; insideLink: boolean }>("(() => { const box = document.querySelector('.listing-gallery .photo-fallback'); return { role: box.getAttribute('role'), name: box.getAttribute('aria-label'), text: box.textContent, insideLink: Boolean(box.closest('a.listing-gallery__open')) }; })()");
    assert.equal(fallback.role, "img");
    assert.ok(fallback.name?.includes(context.unitTitle) && /unavailable/.test(fallback.name));
    assert.equal(fallback.text, "Photo unavailable");
    assert.ok((await context.tab.evaluate<string>("document.body.innerText")).includes("Continue to Request to Book"));
  } finally {
    await context.close();
  }
});
