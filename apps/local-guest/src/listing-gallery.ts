/**
 * The listing photo gallery (guest-gallery issue 01), shared by the full apartment page and the chat's apartment
 * details. The markup works without JavaScript (ADR 0080): every photo is shown in order and links to the full
 * image. `enhanceListingGallery` adds presentation only (ADR 0072): the "Photo X of N" count, "Show all", and a
 * full-screen viewer. Nothing here touches the DOM at import time, so the server can import the markup and styles.
 */

export interface GalleryPhoto {
  readonly src: string;
  readonly alt: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const photosWord = (count: number) => `${count} ${count === 1 ? "photo" : "photos"}`;

/**
 * Server markup. The cover loads first at high priority; the rest load lazily (the LCP guidance). Photos after the
 * fifth are hidden on wide screens only once the script has added "Show all" (`.is-enhanced`).
 */
export function listingGalleryHtml(input: { readonly title: string; readonly photos: readonly GalleryPhoto[] }): string {
  const count = input.photos.length;
  const items = input.photos.map((photo, index) => {
    const loading = index === 0 ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"';
    return `<li class="listing-gallery__item"><a class="listing-gallery__open" href="${escapeAttribute(photo.src)}" data-index="${index}"><img src="${escapeAttribute(photo.src)}" alt="${escapeAttribute(photo.alt)}" width="800" height="600" decoding="async" referrerpolicy="no-referrer"${loading}><span class="ui-sr-only">, open full size</span></a></li>`;
  }).join("");
  return `<section class="listing-gallery" aria-label="Photos of ${escapeAttribute(input.title)}" data-count="${count}"><ul class="listing-gallery__track" role="list" tabindex="0" aria-label="${escapeAttribute(`${photosWord(count)} of ${input.title}. Swipe or scroll to see more.`)}">${items}</ul><p class="listing-gallery__count" aria-live="polite">${escapeText(photosWord(count))}</p><button type="button" class="ui-button ui-button--secondary listing-gallery__all" hidden>Show all ${escapeText(photosWord(count))}</button></section>`;
}

/**
 * Styles. Each photo link is positioned, so its visually hidden text is clipped with the strip instead of widening
 * the page. The gallery switches layout on its own width (a container query), because the chat panel is narrower
 * than the window on desktop. Narrow: a swipe strip, one photo at a time. Wide: the cover beside a 2×2 grid.
 */
export const LISTING_GALLERY_STYLE = [
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
  ".listing-gallery[data-count=\"1\"] .listing-gallery__track{grid-template-columns:1fr}",
  ".listing-gallery[data-count=\"1\"] .listing-gallery__item:first-child{grid-row:auto}",
  ".listing-gallery[data-count=\"2\"] .listing-gallery__track{grid-template-columns:1fr 1fr}",
  ".listing-gallery[data-count=\"2\"] .listing-gallery__item:first-child{grid-row:auto}",
  ".listing-gallery[data-count=\"3\"] .listing-gallery__track,.listing-gallery[data-count=\"4\"] .listing-gallery__track{grid-template-columns:2fr 1fr}",
  ".listing-gallery[data-count=\"4\"] .listing-gallery__item:first-child{grid-row:span 3}",
  ".listing-gallery__count{display:none}",
  ".listing-gallery.is-enhanced .listing-gallery__item:nth-child(n+6){display:none}",
  ".listing-gallery__item[data-more]{position:relative}",
   ".listing-gallery__item[data-more]::after{content:attr(data-more);position:absolute;inset:0;display:grid;place-items:center;background:rgb(0 0 0/.45);color:var(--color-text-on-viewer);font-weight:650;border-radius:var(--radius-card);pointer-events:none}",
  "}",
  // The viewer: full screen, one photo at a time, swipe or step through; opened only by the script.
  ".listing-viewer{inset:0;width:100%;max-width:none;height:100%;max-height:none;margin:0;padding:0;border:0;background:var(--color-surface-viewer);color:var(--color-text-on-viewer)}",
  ".listing-viewer::backdrop{background:rgb(0 0 0/.6)}",
  ".listing-viewer[open]{display:grid;grid-template-rows:auto minmax(0,1fr)}",
  ".listing-viewer__bar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) var(--space-3)}",
  ".listing-viewer__count{margin:0;font-size:var(--font-size-body);font-weight:600}",
  ".listing-viewer__track{display:flex;height:100%;min-height:0;margin:0;padding:0;list-style:none;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none}",
  ".listing-viewer__item{flex:0 0 100%;display:flex;align-items:center;justify-content:center;height:100%;min-width:0;padding:var(--space-2) var(--space-12);box-sizing:border-box;scroll-snap-align:start}",
  "@media (max-width:40rem){.listing-viewer__item{padding-inline:var(--space-2)}}",
  ".listing-viewer__item img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;min-height:0;object-fit:contain}",
  ".listing-viewer button{min-width:var(--control-min-target);min-height:var(--control-min-target);border:1px solid currentColor;border-radius:var(--radius-round);background:var(--color-surface-viewer);color:var(--color-text-on-viewer);font-size:1.25rem;cursor:pointer}",
  ".listing-viewer button:focus-visible{outline:3px solid var(--color-focus);outline-offset:2px}",
  ".listing-viewer button:disabled{opacity:.35;cursor:default}",
  ".listing-viewer__prev,.listing-viewer__next{position:absolute;top:50%;transform:translateY(-50%)}",
  ".listing-viewer__prev{inset-inline-start:var(--space-2)}",
  ".listing-viewer__next{inset-inline-end:var(--space-2)}",
  "@media (prefers-reduced-motion:no-preference){.listing-gallery__track,.listing-viewer__track{scroll-behavior:smooth}}",
].join("");

/**
 * A photo that fails to load becomes the "Photo unavailable" box, named for the apartment, so the page stays usable
 * (ADR 0078). Idempotent: the chat also watches every image it renders.
 */
export function watchPhotoFailure(image: HTMLImageElement): void {
  if (image.dataset.failureWatched === "true") return;
  image.dataset.failureWatched = "true";
  const failed = (): void => {
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

/**
 * The chat's apartment details: builds the same gallery around the images Weaver rendered, so both surfaces share
 * one structure. The images keep their Weaver attributes; each is wrapped in a link to the full image.
 */
export function buildListingGallery(doc: Document, title: string, images: readonly HTMLImageElement[]): HTMLElement {
  const count = images.length;
  const section = doc.createElement("section");
  section.className = "listing-gallery";
  section.setAttribute("aria-label", `Photos of ${title}`);
  section.dataset.count = String(count);
  const track = doc.createElement("ul");
  track.className = "listing-gallery__track";
  track.setAttribute("role", "list");
  track.tabIndex = 0;
  track.setAttribute("aria-label", `${photosWord(count)} of ${title}. Swipe or scroll to see more.`);
  for (const [index, image] of images.entries()) {
    const item = doc.createElement("li");
    item.className = "listing-gallery__item";
    const link = doc.createElement("a");
    link.className = "listing-gallery__open";
    link.href = image.getAttribute("src") ?? "";
    link.dataset.index = String(index);
    if (!image.alt) image.alt = `Photo ${index + 1} of ${title}`;
    const hint = doc.createElement("span");
    hint.className = "ui-sr-only";
    hint.textContent = ", open full size";
    link.append(image, hint);
    item.append(link);
    track.append(item);
  }
  const counter = doc.createElement("p");
  counter.className = "listing-gallery__count";
  counter.setAttribute("aria-live", "polite");
  counter.textContent = photosWord(count);
  const all = doc.createElement("button");
  all.type = "button";
  all.className = "ui-button ui-button--secondary listing-gallery__all";
  all.hidden = true;
  all.textContent = `Show all ${photosWord(count)}`;
  section.append(track, counter, all);
  return section;
}

/**
 * Adds the count, "Show all" and the viewer to a gallery. Presentation only (ADR 0072); idempotent. The viewer is
 * built on first open, so a page that never opens it loads no extra images.
 */
export function enhanceListingGallery(gallery: HTMLElement): void {
  if (gallery.classList.contains("is-enhanced")) return;
  const doc = gallery.ownerDocument;
  const view = doc.defaultView;
  const track = gallery.querySelector<HTMLElement>(".listing-gallery__track");
  if (!track || !view) return;
  const links = [...track.querySelectorAll<HTMLAnchorElement>(".listing-gallery__open")];
  const count = links.length;
  if (count === 0) return;
  gallery.classList.add("is-enhanced");
  for (const image of track.querySelectorAll("img")) watchPhotoFailure(image);
  const title = (gallery.getAttribute("aria-label") ?? "Photos").replace(/^Photos of /, "");
  const counter = gallery.querySelector<HTMLElement>(".listing-gallery__count");
  const all = gallery.querySelector<HTMLButtonElement>(".listing-gallery__all");

  // The strip's "Photo X of N" follows the swipe. IntersectionObserver is the Baseline way to see which photo is
  // in view (scrollsnapchange is not available in every engine).
  const show = (index: number) => { if (counter) counter.textContent = `Photo ${index + 1} of ${count}`; };
  show(0);
  const observer = new view.IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) show(links.indexOf(entry.target.querySelector("a") as HTMLAnchorElement));
  }, { root: track, threshold: 0.6 });
  for (const item of track.children) observer.observe(item);

  // Wide screens show five photos; the fifth says how many more there are.
  if (count > 5) {
    const fifth = track.children[4] as HTMLElement | undefined;
    if (fifth) fifth.dataset.more = `+${count - 5} more`;
  }
  if (all && count > 1) all.hidden = false;

  let viewer: { readonly dialog: HTMLDialogElement; open(index: number, opener: HTMLElement): void } | null = null;
  const openViewer = (index: number, opener: HTMLElement) => {
    viewer ??= createViewer(doc, title, links.map((link) => ({ src: link.getAttribute("href") ?? "", alt: link.querySelector("img")?.alt || `Photo of ${title}` })));
    viewer.open(index, opener);
  };
  for (const [index, link] of links.entries()) {
    link.addEventListener("click", (event) => {
      // Let a modified click open the image in a new tab, as a plain link would.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openViewer(index, link);
    });
  }
  all?.addEventListener("click", () => openViewer(0, all));
}

function createViewer(doc: Document, title: string, photos: readonly GalleryPhoto[]): { readonly dialog: HTMLDialogElement; open(index: number, opener: HTMLElement): void } {
  const view = doc.defaultView!;
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
  close.textContent = "✕";
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
  prev.textContent = "‹";
  const next = doc.createElement("button");
  next.type = "button";
  next.className = "listing-viewer__next";
  next.setAttribute("aria-label", "Next photo");
  next.textContent = "›";
  dialog.append(bar, track, prev, next);
  doc.body.append(dialog);

  let current = 0;
  let opener: HTMLElement | null = null;
  const render = (index: number) => {
    current = index;
    counter.textContent = `${index + 1} of ${count}`;
    prev.disabled = index === 0;
    next.disabled = index === count - 1;
  };
  const go = (index: number) => {
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
    if (event.key === "ArrowRight") { event.preventDefault(); go(current + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(current - 1); }
    else if (event.key === "Home") { event.preventDefault(); go(0); }
    else if (event.key === "End") { event.preventDefault(); go(count - 1); }
  });
  // Light dismiss: a tap on the dark area around a photo closes the viewer. `closedby="any"` covers the backdrop
  // where supported; this covers engines without it (Safari) and the full-screen dialog's own background.
  dialog.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target === dialog || target.classList.contains("listing-viewer__item") || target === track) dialog.close();
  });
  // The dialog restores focus to what was focused when it opened; the opener is focused before opening (below), and
  // again after the close event in case the native restoration landed elsewhere.
  dialog.addEventListener("close", () => {
    const from = opener;
    opener = null;
    if (from) view.setTimeout(() => from.focus({ preventScroll: true }), 0);
  });

  return {
    dialog,
    open(index: number, from: HTMLElement) {
      opener = from;
      from.focus({ preventScroll: true });
      dialog.showModal();
      // Jump straight to the chosen photo, without the smooth scroll.
      const previous = track.style.scrollBehavior;
      track.style.scrollBehavior = "auto";
      track.scrollLeft = index * track.clientWidth;
      track.style.scrollBehavior = previous;
      render(index);
      close.focus();
    },
  };
}
