/**
 * Issue 23 (ADR 0078; guideline §7 reserve image space, §12 slow network): every guest image carries intrinsic
 * dimensions, and only the lead image loads eagerly at high priority.
 */
export interface ImageMount {
  querySelectorAll(selectors: string): ArrayLike<HTMLImageElement>;
}

/**
 * Not the photo's real size: a 4:3 shape hint matching the guest image CSS (`.weaver-mount img`, `.ui-image-frame`,
 * `.ui-stay-card__photo` all use `aspect-ratio: 4 / 3` at full column width), so the browser reserves that shape before
 * the photo arrives. Used only when the image declares no size and has not loaded; a loaded photo's natural size wins.
 */
export const IMAGE_SHAPE_HINT = { width: 800, height: 600 } as const;

function positive(value: string | null): number | undefined {
  const parsed = Number(value);
  return value !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function reserveSpace(image: HTMLImageElement): void {
  const width = positive(image.getAttribute("width"));
  const height = positive(image.getAttribute("height"));
  if (width !== undefined && height !== undefined) return;
  if (width === undefined && height === undefined && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    image.setAttribute("width", String(image.naturalWidth));
    image.setAttribute("height", String(image.naturalHeight));
    return;
  }
  // One declared side keeps its value; the other follows the 4:3 hint so the photo is not distorted.
  const ratio = IMAGE_SHAPE_HINT.height / IMAGE_SHAPE_HINT.width;
  if (width !== undefined) image.setAttribute("height", String(Math.round(width * ratio)));
  else if (height !== undefined) image.setAttribute("width", String(Math.round(height / ratio)));
  else {
    image.setAttribute("width", String(IMAGE_SHAPE_HINT.width));
    image.setAttribute("height", String(IMAGE_SHAPE_HINT.height));
  }
}

export function applyImageLayout(mount: ImageMount): void {
  const images = Array.from(mount.querySelectorAll("img"));
  images.forEach((image, index) => {
    reserveSpace(image);
    if (index === 0) {
      image.loading = "eager";
      image.setAttribute("fetchpriority", "high");
    } else {
      image.loading = "lazy";
      image.removeAttribute("fetchpriority");
    }
  });
}
