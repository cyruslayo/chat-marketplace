/**
 * Issue 23 (ADR 0078; guideline §7 reserve image space, §12 slow network): every guest image carries intrinsic
 * dimensions, and only the lead image loads eagerly at high priority.
 */
export interface ImageMount {
  querySelectorAll(selectors: string): ArrayLike<HTMLImageElement>;
}

export function applyImageLayout(mount: ImageMount): void {
  const images = Array.from(mount.querySelectorAll("img"));
  images.forEach((image, index) => {
    if (!image.hasAttribute("width")) image.setAttribute("width", "800");
    if (!image.hasAttribute("height")) image.setAttribute("height", "600");
    if (index === 0) {
      image.loading = "eager";
      image.setAttribute("fetchpriority", "high");
    } else {
      image.loading = "lazy";
      image.removeAttribute("fetchpriority");
    }
  });
}
