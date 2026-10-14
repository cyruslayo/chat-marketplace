/**
 * The apartments section's list (issue 08 sub-task C, direction doc row 5): one entry per Unit shown as a photo card.
 *
 * Every entry carries `approved`. An entry renders on the public page only when it is approved (issue 06 item 5 is still open,
 * so all three are false today). Local builds render every entry with placeholders on (landing-page-html.ts). The two local
 * Units use test-data photos (apps/local-guest/assets/landing/); they never show on the public page while unapproved.
 */
export interface LandingUnitPhoto {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export interface LandingUnit {
  readonly id: string;
  /** The area name, first on the card ("Old Ikoyi"). */
  readonly area: string;
  /** The bedroom count, shown after the area ("2 bedrooms"). */
  readonly bedrooms: string;
  readonly city: string;
  /** The photograph, or null for a placeholder card. */
  readonly photo: LandingUnitPhoto | null;
  /** The label on a placeholder card's picture (only shown with placeholders on). */
  readonly placeholderLabel?: string;
  /** True only once the Unit and its photograph are approved for the public page (issue 06 item 5). */
  readonly approved: boolean;
}

export const LANDING_UNITS: readonly LandingUnit[] = Object.freeze([
  {
    id: "old-ikoyi",
    area: "Old Ikoyi",
    bedrooms: "2 bedrooms",
    city: "Lagos",
    photo: { src: "/landing/photos/ikoyi-bedroom.jpg", alt: "Bedroom in Old Ikoyi", width: 800, height: 800 },
    approved: false,
  },
  {
    id: "lekki-phase-1",
    area: "Lekki Phase 1",
    bedrooms: "1 bedroom",
    city: "Lagos",
    photo: { src: "/landing/photos/lekki-bedroom.jpg", alt: "Bedroom in Lekki Phase 1", width: 800, height: 450 },
    approved: false,
  },
  {
    id: "abuja-placeholder",
    area: "[Area]",
    bedrooms: "[bedrooms]",
    city: "Abuja",
    photo: null,
    placeholderLabel: "[ABUJA PHOTO · APPROVED UNIT]",
    approved: false,
  },
]);

/** The units to render: approved ones, and every one when placeholders are on (a local build). */
export function unitsToRender(units: readonly LandingUnit[] = LANDING_UNITS, placeholders = false): readonly LandingUnit[] {
  return units.filter((unit) => unit.approved || placeholders);
}
