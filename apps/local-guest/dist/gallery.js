"use strict";
(() => {
  // apps/local-guest/src/listing-gallery.ts
  var LISTING_GALLERY_STYLE = [
    ".listing-gallery{container-type:inline-size;display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-2);min-width:0;position:relative}",
    ".listing-gallery__track{display:flex;gap:var(--space-2);min-width:0;margin:0;padding:0;list-style:none;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:thin;border-radius:var(--radius-card)}",
    ".listing-gallery__track:focus-visible{outline:3px solid var(--color-focus);outline-offset:2px}",
    ".listing-gallery__item{flex:0 0 100%;min-width:0;scroll-snap-align:start}",
    ".listing-gallery__open{position:relative;display:block;height:100%;border-radius:var(--radius-card);overflow:hidden;background:var(--color-surface-subtle)}",
    ".listing-gallery__open:focus-visible{outline:3px solid var(--color-focus);outline-offset:-3px}",
    ".listing-gallery__open img,.listing-gallery__open .photo-fallback{display:block;width:100%!important;height:100%!important;max-width:none!important;min-height:0!important;margin:0!important;aspect-ratio:4/3;object-fit:cover!important;border-radius:0!important}",
    ".listing-gallery__count{justify-self:end;margin:0;padding:var(--space-1) var(--space-3);border-radius:var(--radius-round);background:var(--color-surface-subtle);color:var(--color-text-secondary);font-size:var(--font-size-small)}",
    ".listing-gallery__all{justify-self:start;min-height:var(--control-min-target)}",
    ".listing-gallery__all[hidden]{display:none}",
    "@container (min-width:30rem){",
    ".listing-gallery__track{display:grid;overflow:visible;scroll-snap-type:none;grid-template-columns:2fr 1fr 1fr;grid-auto-flow:dense}",
    ".listing-gallery__item:first-child{grid-row:span 2}",
    ".listing-gallery__item:first-child img,.listing-gallery__item:first-child .photo-fallback{aspect-ratio:auto}",
    '.listing-gallery[data-count="1"] .listing-gallery__track{grid-template-columns:1fr}',
    '.listing-gallery[data-count="1"] .listing-gallery__item:first-child{grid-row:auto}',
    '.listing-gallery[data-count="2"] .listing-gallery__track{grid-template-columns:1fr 1fr}',
    '.listing-gallery[data-count="2"] .listing-gallery__item:first-child{grid-row:auto}',
    '.listing-gallery[data-count="3"] .listing-gallery__track,.listing-gallery[data-count="4"] .listing-gallery__track{grid-template-columns:2fr 1fr}',
    '.listing-gallery[data-count="4"] .listing-gallery__item:first-child{grid-row:span 3}',
    ".listing-gallery__count{display:none}",
    ".listing-gallery.is-enhanced .listing-gallery__item:nth-child(n+6){display:none}",
    ".listing-gallery__item[data-more]{position:relative}",
    ".listing-gallery__item[data-more]::after{content:attr(data-more);position:absolute;inset:0;display:grid;place-items:center;background:rgb(0 0 0/.45);color:#fff;font-weight:650;border-radius:var(--radius-card);pointer-events:none}",
    "}",
    // The viewer: full screen, one photo at a time, swipe or step through; opened only by the script.
    ".listing-viewer{inset:0;width:100%;max-width:none;height:100%;max-height:none;margin:0;padding:0;border:0;background:rgb(10 12 10/.96);color:#fff}",
    ".listing-viewer::backdrop{background:rgb(0 0 0/.6)}",
    ".listing-viewer[open]{display:grid;grid-template-rows:auto minmax(0,1fr)}",
    ".listing-viewer__bar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) var(--space-3)}",
    ".listing-viewer__count{margin:0;font-size:var(--font-size-body);font-weight:600}",
    ".listing-viewer__track{display:flex;height:100%;min-height:0;margin:0;padding:0;list-style:none;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none}",
    ".listing-viewer__item{flex:0 0 100%;display:flex;align-items:center;justify-content:center;height:100%;min-width:0;padding:var(--space-2) var(--space-12);box-sizing:border-box;scroll-snap-align:start}",
    "@media (max-width:40rem){.listing-viewer__item{padding-inline:var(--space-2)}}",
    ".listing-viewer__item img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;min-height:0;object-fit:contain}",
    ".listing-viewer button{min-width:var(--control-min-target);min-height:var(--control-min-target);border:1px solid rgb(255 255 255/.5);border-radius:var(--radius-round);background:rgb(0 0 0/.55);color:#fff;font-size:1.25rem;cursor:pointer}",
    ".listing-viewer button:focus-visible{outline:3px solid var(--color-focus);outline-offset:2px}",
    ".listing-viewer button:disabled{opacity:.35;cursor:default}",
    ".listing-viewer__prev,.listing-viewer__next{position:absolute;top:50%;transform:translateY(-50%)}",
    ".listing-viewer__prev{inset-inline-start:var(--space-2)}",
    ".listing-viewer__next{inset-inline-end:var(--space-2)}",
    "@media (prefers-reduced-motion:no-preference){.listing-gallery__track,.listing-viewer__track{scroll-behavior:smooth}}"
  ].join("");
  function watchPhotoFailure(image) {
    if (image.dataset.failureWatched === "true") return;
    image.dataset.failureWatched = "true";
    const failed = () => {
      const fallback = image.ownerDocument.createElement("div");
      fallback.className = "photo-fallback";
      fallback.setAttribute("role", "img");
      fallback.setAttribute("aria-label", `${image.alt || "Property photo"} unavailable`);
      fallback.textContent = "Photo unavailable";
      image.replaceWith(fallback);
    };
    image.addEventListener("load", () => image.classList.add("is-loaded"), { once: true });
    image.addEventListener("error", failed, { once: true });
    if (image.complete && image.naturalWidth > 0) image.classList.add("is-loaded");
    else if (image.complete && image.getAttribute("src")) failed();
  }
  function enhanceListingGallery(gallery) {
    if (gallery.classList.contains("is-enhanced")) return;
    const doc = gallery.ownerDocument;
    const view = doc.defaultView;
    const track = gallery.querySelector(".listing-gallery__track");
    if (!track || !view) return;
    const links = [...track.querySelectorAll(".listing-gallery__open")];
    const count = links.length;
    if (count === 0) return;
    gallery.classList.add("is-enhanced");
    for (const image of track.querySelectorAll("img")) watchPhotoFailure(image);
    const title = (gallery.getAttribute("aria-label") ?? "Photos").replace(/^Photos of /, "");
    const counter = gallery.querySelector(".listing-gallery__count");
    const all = gallery.querySelector(".listing-gallery__all");
    const show = (index) => {
      if (counter) counter.textContent = `Photo ${index + 1} of ${count}`;
    };
    show(0);
    const observer = new view.IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) show(links.indexOf(entry.target.querySelector("a")));
    }, { root: track, threshold: 0.6 });
    for (const item of track.children) observer.observe(item);
    if (count > 5) {
      const fifth = track.children[4];
      if (fifth) fifth.dataset.more = `+${count - 5} more`;
    }
    if (all && count > 1) all.hidden = false;
    let viewer = null;
    const openViewer = (index, opener) => {
      viewer ??= createViewer(doc, title, links.map((link) => ({ src: link.getAttribute("href") ?? "", alt: link.querySelector("img")?.alt || `Photo of ${title}` })));
      viewer.open(index, opener);
    };
    for (const [index, link] of links.entries()) {
      link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openViewer(index, link);
      });
    }
    all?.addEventListener("click", () => openViewer(0, all));
  }
  function createViewer(doc, title, photos) {
    const view = doc.defaultView;
    const count = photos.length;
    const dialog = doc.createElement("dialog");
    dialog.className = "listing-viewer";
    dialog.setAttribute("aria-label", `Photos of ${title}`);
    dialog.setAttribute("closedby", "any");
    const bar = doc.createElement("div");
    bar.className = "listing-viewer__bar";
    const counter = doc.createElement("p");
    counter.className = "listing-viewer__count";
    counter.setAttribute("aria-live", "polite");
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "listing-viewer__close";
    close.setAttribute("aria-label", "Close photos");
    close.textContent = "\u2715";
    bar.append(counter, close);
    const track = doc.createElement("ul");
    track.className = "listing-viewer__track";
    track.setAttribute("role", "list");
    for (const photo of photos) {
      const item = doc.createElement("li");
      item.className = "listing-viewer__item";
      const image = doc.createElement("img");
      image.src = photo.src;
      image.alt = photo.alt;
      image.referrerPolicy = "no-referrer";
      image.decoding = "async";
      image.loading = "lazy";
      watchPhotoFailure(image);
      item.append(image);
      track.append(item);
    }
    const prev = doc.createElement("button");
    prev.type = "button";
    prev.className = "listing-viewer__prev";
    prev.setAttribute("aria-label", "Previous photo");
    prev.textContent = "\u2039";
    const next = doc.createElement("button");
    next.type = "button";
    next.className = "listing-viewer__next";
    next.setAttribute("aria-label", "Next photo");
    next.textContent = "\u203A";
    dialog.append(bar, track, prev, next);
    doc.body.append(dialog);
    let current = 0;
    let opener = null;
    const render = (index) => {
      current = index;
      counter.textContent = `${index + 1} of ${count}`;
      prev.disabled = index === 0;
      next.disabled = index === count - 1;
    };
    const go = (index) => {
      const target = Math.max(0, Math.min(count - 1, index));
      track.scrollTo({ left: target * track.clientWidth });
      render(target);
    };
    const observer = new view.IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) render([...track.children].indexOf(entry.target));
    }, { root: track, threshold: 0.6 });
    for (const item of track.children) observer.observe(item);
    prev.addEventListener("click", () => go(current - 1));
    next.addEventListener("click", () => go(current + 1));
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(current + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(current - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        go(0);
      } else if (event.key === "End") {
        event.preventDefault();
        go(count - 1);
      }
    });
    dialog.addEventListener("click", (event) => {
      const target = event.target;
      if (target === dialog || target.classList.contains("listing-viewer__item") || target === track) dialog.close();
    });
    dialog.addEventListener("close", () => {
      const from = opener;
      opener = null;
      if (from) view.setTimeout(() => from.focus({ preventScroll: true }), 0);
    });
    return {
      dialog,
      open(index, from) {
        opener = from;
        from.focus({ preventScroll: true });
        dialog.showModal();
        const previous = track.style.scrollBehavior;
        track.style.scrollBehavior = "auto";
        track.scrollLeft = index * track.clientWidth;
        track.style.scrollBehavior = previous;
        render(index);
        close.focus();
      }
    };
  }

  // apps/local-guest/src/gallery-page.ts
  var run = () => {
    for (const gallery of document.querySelectorAll(".listing-gallery")) enhanceListingGallery(gallery);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
})();
