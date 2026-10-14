/**
 * The brand-layer photographs of the public page (issue 08, direction doc "Photography"): the hero and the closing. Like the
 * apartment list (landing-units.ts), each entry carries `approved`. Both are false today (issue 06 item 5 is open, and the
 * files in apps/local-guest/assets/landing/ are Unsplash placeholders). Without an approved photo the section paints its
 * solid forest-deep ground and the scrim, so the text reads with no image.
 */
export interface LandingPhoto {
  readonly id: "hero" | "closing";
  readonly src: string;
  readonly width: number;
  readonly height: number;
  /** The closing photograph lazy-loads; the hero is above the fold and loads at once. */
  readonly lazy: boolean;
  /** True only once the photograph is approved for the public page (issue 06 item 5). */
  readonly approved: boolean;
}

export const LANDING_PHOTOS = Object.freeze({
  hero: { id: "hero", src: "/landing/photos/ikoyi-living.jpg", width: 800, height: 450, lazy: false, approved: false },
  closing: { id: "closing", src: "/landing/photos/ikoyi-bedroom.jpg", width: 800, height: 800, lazy: true, approved: false },
} satisfies Record<"hero" | "closing", LandingPhoto>);

/** Whether a brand photograph renders: approved, or placeholders are on (a local build). */
export function photoRenders(photo: LandingPhoto, placeholders = false): boolean {
  return photo.approved || placeholders;
}
