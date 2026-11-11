import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { applyImageLayout, IMAGE_SHAPE_HINT } from "../apps/local-guest/src/image-layout.js";

// Issue 23 (ADR 0078; guideline §7, §12): every guest image reserves its space; only the lead image is eager/high.

test("AC1: Every guest img element has width and height attributes", () => {
  const window = new Window();
  const mount = window.document.createElement("div");
  mount.innerHTML = '<img src="a.jpg"><img src="b.jpg" width="320" height="240"><img src="c.jpg">';
  applyImageLayout(mount as unknown as Parameters<typeof applyImageLayout>[0]);
  const images = [...mount.querySelectorAll("img")];
  for (const image of images) {
    assert.ok(image.hasAttribute("width"), `${image.src} has width`);
    assert.ok(image.hasAttribute("height"), `${image.src} has height`);
  }
  // Failure path: an existing intrinsic size is kept.
  assert.equal(images[1]!.getAttribute("width"), "320");
  assert.equal(images[1]!.getAttribute("height"), "240");
});

test("AC2: At most one image per screen has fetchpriority high", () => {
  const window = new Window();
  const mount = window.document.createElement("div");
  mount.innerHTML = '<img src="a.jpg"><img src="b.jpg"><img src="c.jpg">';
  applyImageLayout(mount as unknown as Parameters<typeof applyImageLayout>[0]);
  const images = [...mount.querySelectorAll("img")];
  assert.equal(images.filter((image) => image.getAttribute("fetchpriority") === "high").length, 1);
  assert.equal(images[0]!.getAttribute("fetchpriority"), "high");
  assert.equal(images[0]!.getAttribute("loading"), "eager");
  for (const image of images.slice(1)) {
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.equal(image.hasAttribute("fetchpriority"), false);
  }
});
