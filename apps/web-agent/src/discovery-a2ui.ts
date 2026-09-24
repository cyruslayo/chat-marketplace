import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@weaver/core";
import { formatGuestDate, guestAmenityLabel, guestOccupancyLabel } from "./guest-content.js";

export interface DiscoveryLocationProjection {
  readonly city: string;
  readonly neighbourhood: string;
}

export interface DiscoveryPriceProjection {
  readonly nightlyKobo: number;
  readonly allInStayTotalKobo: number | null;
  readonly mandatoryFeesKobo: number;
  readonly refundableSecurityDepositKobo: number;
  readonly amountDueNowKobo: number | null;
  readonly currency: "NGN";
  readonly pricingVersion: string;
}

export interface DiscoveryInspectionProjection {
  readonly status: string;
  readonly inspectedAt: string;
  readonly expiresAt: string;
  readonly scope: readonly string[];
}

export interface DiscoveryUnitProjection {
  readonly id: string;
  readonly title: string;
  readonly location: DiscoveryLocationProjection;
  readonly capacity: number;
  readonly bedrooms?: number;
  readonly bathrooms: number;
  readonly description: string;
  readonly amenities: readonly string[];
  readonly photoUrls: readonly string[];
  readonly price: DiscoveryPriceProjection;
  readonly trust: {
    readonly inspection: DiscoveryInspectionProjection;
    readonly managementAuthority: {
      readonly status: string;
      readonly verifiedAt: string;
    };
    readonly occupancyModel: string;
  };
}

export interface DiscoveryArtifactProjection {
  readonly id: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly projectionVersion: number;
  readonly domainReferences: readonly { readonly type: string; readonly id: string }[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly disclosures: readonly string[];
  readonly facts: {
    readonly filters: Readonly<Record<string, unknown>>;
    readonly results: readonly DiscoveryUnitProjection[];
  };
  readonly amounts: readonly object[];
  readonly actions: readonly {
    readonly type: string;
    readonly unitId: string;
    readonly conventionalRoute: string;
  }[];
  readonly acknowledgements: readonly unknown[];
  readonly sensitivity: string;
}

export interface DiscoveryArtifactToA2UIInput {
  readonly artifact: DiscoveryArtifactProjection;
  readonly surfaceId: string;
}

export const VIEW_UNIT_EVENT = "shortlet.discovery.view-unit";
export const SEE_ALL_DISCOVERY_EVENT = "shortlet.discovery.see-all";

export function formatNgnKobo(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const absoluteKobo = Math.abs(kobo);
  const wholeNaira = Math.floor(absoluteKobo / 100);
  const remainderKobo = absoluteKobo % 100;
  const digits = String(wholeNaira);
  const firstGroupLength = digits.length % 3 || 3;
  const grouped = [digits.slice(0, firstGroupLength), ...digits.slice(firstGroupLength).match(/.{3}/g) ?? []].join(",");
  const fraction = remainderKobo === 0 ? "" : `.${String(remainderKobo).padStart(2, "0")}`;
  return `${sign}₦${grouped}${fraction}`;
}

function unitComponents(
  artifactId: string,
  unit: DiscoveryUnitProjection,
  canViewUnit: boolean,
): { readonly cardId: string; readonly components: readonly A2UIComponent[] } {
  const prefix = `unit-${unit.id}`;
  const location = unit.title.toLocaleLowerCase().includes(unit.location.neighbourhood.toLocaleLowerCase())
    ? unit.location.city
    : `${unit.location.neighbourhood}, ${unit.location.city}`;
  const facts = [
    ...(unit.bedrooms === undefined ? [] : [`${unit.bedrooms} ${unit.bedrooms === 1 ? "bedroom" : "bedrooms"}`]),
    `${unit.bathrooms} ${unit.bathrooms === 1 ? "bathroom" : "bathrooms"}`,
    `Sleeps ${unit.capacity}`,
    guestOccupancyLabel(unit.trust.occupancyModel),
  ].filter((fact): fact is string => fact !== undefined);
  const highlights = unit.amenities.slice(0, 3);
  const allInLabel = unit.price.allInStayTotalKobo === null ? "Indicative nightly rate" : "All-In Stay Total";
  const allInAmount = unit.price.allInStayTotalKobo === null
    ? unit.price.nightlyKobo
    : unit.price.allInStayTotalKobo;

  return {
    cardId: `${prefix}-card`,
    components: [
      { id: `${prefix}-card`, component: "Card", child: `${prefix}-content` },
      {
        id: `${prefix}-content`,
        component: "Column",
        children: [
          ...(unit.photoUrls.length > 0 ? [`${prefix}-primary-photo`] : [`${prefix}-photo-unavailable`]),
          `${prefix}-title`, `${prefix}-location`, `${prefix}-facts`,
          ...(highlights.length > 0 ? [`${prefix}-amenities`] : []),
          `${prefix}-divider`, `${prefix}-price-label`, `${prefix}-price`,
          ...(unit.price.refundableSecurityDepositKobo > 0 ? [`${prefix}-deposit`] : []),
          ...(canViewUnit ? [`${prefix}-view-button`] : []),
        ],
      },
      { id: `${prefix}-title`, component: "Text", text: unit.title, variant: "h3" },
      { id: `${prefix}-location`, component: "Text", text: location, variant: "caption" },
      ...(unit.photoUrls.length > 0 ? [{
        id: `${prefix}-primary-photo`,
        component: "Image" as const,
        url: unit.photoUrls[0]!,
        description: `${unit.title} in ${unit.location.neighbourhood}, ${unit.location.city}`,
      }] : []),
      ...(unit.photoUrls.length === 0 ? [{
        id: `${prefix}-photo-unavailable`,
        component: "Text" as const,
        text: "No property photos are available yet.",
        variant: "caption" as const,
      }] : []),
      { id: `${prefix}-facts`, component: "Text", text: facts.join(" · ") },
      ...(highlights.length > 0 ? [{
        id: `${prefix}-amenities`,
        component: "Text" as const,
        text: highlights.map(guestAmenityLabel).join(" · "),
        variant: "caption" as const,
      }] : []),
      { id: `${prefix}-divider`, component: "Divider", axis: "horizontal" },
      { id: `${prefix}-price-label`, component: "Text", text: allInLabel, variant: "caption" },
      { id: `${prefix}-price`, component: "Text", text: formatNgnKobo(allInAmount), variant: "h3" },
      ...(unit.price.refundableSecurityDepositKobo > 0 ? [{
        id: `${prefix}-deposit`,
        component: "Text" as const,
        text: `Refundable Security Deposit: ${formatNgnKobo(unit.price.refundableSecurityDepositKobo)}`,
        variant: "caption" as const,
      }] : []),
      ...(canViewUnit ? [
        {
          id: `${prefix}-view-button`,
          component: "Button" as const,
          child: `${prefix}-view-label`,
          variant: "primary" as const,
          action: {
            event: {
              name: VIEW_UNIT_EVENT,
              context: { artifactId, unitId: unit.id },
            },
          },
          accessibility: { label: `View ${unit.title}` },
        },
        { id: `${prefix}-view-label`, component: "Text" as const, text: "View Unit" },
      ] : []),
    ],
  };
}

export function discoveryArtifactToA2UI({
  artifact,
  surfaceId,
}: DiscoveryArtifactToA2UIInput): readonly A2UIServerMessage[] {
  const unitGroups = artifact.facts.results.map((unit) => unitComponents(
    artifact.id,
    unit,
    artifact.actions.some((action) => action.type === "view-unit" && action.unitId === unit.id),
  ));
  const checkIn = typeof artifact.facts.filters.checkIn === "string" ? formatGuestDate(artifact.facts.filters.checkIn) : undefined;
  const checkOut = typeof artifact.facts.filters.checkOut === "string" ? formatGuestDate(artifact.facts.filters.checkOut) : undefined;
  const dateSummary = checkIn && checkOut ? ` · ${checkIn} – ${checkOut}` : "";
  const context = discoveryContext(artifact.facts.filters);
  const resultSummary = artifact.facts.results.length === 0
    ? "No current matches"
    : `${artifact.facts.results.length} stay${artifact.facts.results.length === 1 ? "" : "s"} to explore`;
  const disclosureIds = artifact.disclosures.map((_, index) => `disclosure-${index}`);
  const resultListId = "result-list";
  const seeAllId = "see-all-results";
  const rootChildren = ["result-summary", "search-context", resultListId, ...(unitGroups.length === 1 ? [] : unitGroups.length > 1 ? [seeAllId] : []), ...(unitGroups.length === 0 ? ["zero-result-guidance"] : []), ...disclosureIds];
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: rootChildren },
    { id: "result-summary", component: "Text", text: resultSummary, variant: "h2" },
    { id: "search-context", component: "Text", text: `${context}${dateSummary}`.trim(), variant: "caption" },
    { id: resultListId, component: "Column", children: unitGroups.map((group) => group.cardId) },
    ...(unitGroups.length === 0 ? [{ id: "zero-result-guidance", component: "Text" as const, text: "Try another neighbourhood, dates, or guest count in your message. Your search details are still here to refine.", variant: "body" as const }] : []),
    ...(unitGroups.length > 1 ? [
      {
        id: seeAllId,
        component: "Button" as const,
        child: "see-all-results-label",
        variant: "primary" as const,
        action: { event: { name: SEE_ALL_DISCOVERY_EVENT, context: { artifactId: artifact.id } } },
        accessibility: { label: "See all discovery results" },
      },
      { id: "see-all-results-label", component: "Text" as const, text: "See all results" },
    ] : []),
    ...unitGroups.flatMap((group) => group.components),
    ...artifact.disclosures.map((disclosure, index): A2UIComponent => ({
      id: `disclosure-${index}`,
      component: "Text",
      text: disclosure,
      variant: "caption",
    })),
  ];

  return [
    {
      version: "v0.9.1",
      createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID },
    },
    {
      version: "v0.9.1",
      updateComponents: { surfaceId, components },
    },
  ];
}

function discoveryContext(filters: Readonly<Record<string, unknown>>): string {
  const location = typeof filters.neighbourhood === "string"
    ? filters.neighbourhood
    : typeof filters.location === "string" ? filters.location : undefined;
  const partySize = typeof filters.partySize === "number" ? `${filters.partySize} ${filters.partySize === 1 ? "guest" : "guests"}` : undefined;
  const details = [location, partySize].filter((value): value is string => value !== undefined);
  return details.length > 0 ? `Search: ${details.join(" · ")}` : "Search results for your request";
}
