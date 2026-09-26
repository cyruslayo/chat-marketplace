import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@weaver/core";
import { formatNgnKobo, type DiscoveryUnitProjection } from "./discovery-a2ui.js";
import { unitDetailArtifactFromProjection, type UnitDetailArtifact } from "../../web/src/unit-detail-artifact.js";
import { GUEST_GLOSSARY, GUEST_JOURNEY, formatGuestDate, guestAmenityLabel, guestInspectionDisclosure, guestOccupancyLabel } from "./guest-content.js";

export const REQUEST_TO_BOOK_EVENT = "shortlet.unit-detail.request-to-book";
/** Issue 08: returns to the results of the same search; the server validates the discovery artifact id. */
export const BACK_TO_RESULTS_EVENT = "shortlet.unit-detail.back-to-results";

export interface UnitDetailActionContext {
  readonly artifactId: string;
  readonly unitId: string;
  readonly projectionVersion: number;
}

export interface UnitDetailToA2UIInput {
  readonly unit: DiscoveryUnitProjection;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly surfaceId: string;
  readonly action: UnitDetailActionContext;
}

export function unitDetailArtifactToA2UI({ artifact, surfaceId, backToResults }: {
  readonly artifact: UnitDetailArtifact;
  readonly surfaceId: string;
  /** The discovery artifact the Guest came from; omitted when there are no results to return to. */
  readonly backToResults?: { readonly artifactId: string };
}): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions.find((candidate) => candidate.type === "request-to-book");
  const prefix = "unit-detail";
  const location = facts.title.toLocaleLowerCase().includes(facts.neighbourhood.toLocaleLowerCase())
    ? facts.city
    : `${facts.neighbourhood}, ${facts.city}`;
  const coreFacts = [
    guestOccupancyLabel(facts.occupancyModel),
    ...(facts.bedrooms === undefined ? [] : [`${facts.bedrooms} ${facts.bedrooms === 1 ? "bedroom" : "bedrooms"}`]),
    `${facts.bathrooms} ${facts.bathrooms === 1 ? "bathroom" : "bathrooms"}`,
    `Sleeps ${facts.capacity}`,
  ].filter((value): value is string => value !== undefined);
  const allInLabel = facts.price.allInStayTotalKobo === null ? "Indicative nightly rate" : GUEST_GLOSSARY.allInStayTotal;
  const allInAmount = facts.price.allInStayTotalKobo ?? facts.price.nightlyKobo;
  const inspectionDisclosure = guestInspectionDisclosure(facts.inspection);
  const nightRate = facts.price.allInStayTotalKobo === null
    ? undefined
    : `Nightly rate: ${formatNgnKobo(facts.price.nightlyKobo)}`;
  const stayDates = `Stay dates: ${formatGuestDate(facts.checkIn) ?? facts.checkIn} to ${formatGuestDate(facts.checkOut) ?? facts.checkOut}`;
  const amenityIds = facts.amenities.map((_, index) => `${prefix}-amenity-${index}`);
  const inspectionId = inspectionDisclosure === undefined ? [] : [`${prefix}-inspection`];
  const depositId = facts.price.refundableSecurityDepositKobo > 0 ? [`${prefix}-deposit`] : [];
  const nightlyRateId = nightRate === undefined ? [] : [`${prefix}-nightly-rate`];
  const feeId = facts.price.mandatoryFeesKobo > 0 ? [`${prefix}-fees`] : [];
  const amountDueId = facts.price.amountDueNowKobo === null ? [] : [`${prefix}-amount-due`];
  const photoIds = facts.photos.map((_, index) => `${prefix}-photo-${index}`);
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: [
      ...(photoIds.length > 0 ? photoIds : [`${prefix}-photo-unavailable`]),
      `${prefix}-title`, `${prefix}-location`, `${prefix}-facts`, `${prefix}-stay-dates`,
      `${prefix}-price-label`, `${prefix}-price`, ...nightlyRateId, ...feeId, ...depositId, ...amountDueId,
      `${prefix}-description-heading`, `${prefix}-description`, `${prefix}-amenities-heading`, `${prefix}-amenities`,
      ...inspectionId, `${prefix}-disclosure`, `${prefix}-actions`,
    ] },
    { id: `${prefix}-title`, component: "Text", text: facts.title, variant: "h2" },
    { id: `${prefix}-location`, component: "Text", text: location, variant: "caption" },
    { id: `${prefix}-facts`, component: "Text", text: coreFacts.join(" · ") },
    { id: `${prefix}-stay-dates`, component: "Text", text: stayDates, variant: "caption" },
    { id: `${prefix}-price-label`, component: "Text", text: allInLabel, variant: "caption" },
    { id: `${prefix}-price`, component: "Text", text: formatNgnKobo(allInAmount), variant: "h2" },
    ...(nightRate ? [{ id: `${prefix}-nightly-rate`, component: "Text" as const, text: nightRate, variant: "caption" as const }] : []),
    ...(facts.price.mandatoryFeesKobo > 0 ? [{ id: `${prefix}-fees`, component: "Text" as const, text: `Mandatory fees included: ${formatNgnKobo(facts.price.mandatoryFeesKobo)}`, variant: "caption" as const }] : []),
    ...(facts.price.refundableSecurityDepositKobo > 0 ? [{ id: `${prefix}-deposit`, component: "Text" as const, text: `${GUEST_GLOSSARY.refundableSecurityDeposit}: ${formatNgnKobo(facts.price.refundableSecurityDepositKobo)}`, variant: "caption" as const }] : []),
    ...(facts.price.amountDueNowKobo === null ? [] : [{ id: `${prefix}-amount-due`, component: "Text" as const, text: `Amount Due Now: ${formatNgnKobo(facts.price.amountDueNowKobo)}`, variant: "caption" as const }]),
    { id: `${prefix}-description-heading`, component: "Text", text: "About this place", variant: "h3" },
    { id: `${prefix}-description`, component: "Text", text: facts.description },
    { id: `${prefix}-amenities-heading`, component: "Text", text: "Amenities", variant: "h3" },
    { id: `${prefix}-amenities`, component: "Column", children: amenityIds },
    ...facts.amenities.map((amenity, index) => ({ id: amenityIds[index]!, component: "Text" as const, text: guestAmenityLabel(amenity) })),
    ...photoIds.map((id, index) => ({ id, component: "Image" as const, url: facts.photos[index]!, description: `${facts.title} in ${facts.neighbourhood}, ${facts.city}${index === 0 ? " — main view" : ` — view ${index + 1}`}` })),
    ...(photoIds.length === 0 ? [{ id: `${prefix}-photo-unavailable`, component: "Text" as const, text: "No property photos are available yet.", variant: "caption" as const }] : []),
    ...(inspectionDisclosure ? [{ id: `${prefix}-inspection`, component: "Text" as const, text: inspectionDisclosure, variant: "caption" as const }] : []),
    { id: `${prefix}-disclosure`, component: "Text", text: `Request to Book starts a request for Operator confirmation. Viewing this ${GUEST_GLOSSARY.unit} does not reserve dates or create a Reservation.`, variant: "caption" },
    { id: `${prefix}-actions`, component: "Row", children: [...(action ? [`${prefix}-request-button`] : []), ...(backToResults ? [`${prefix}-back-button`] : [])] },
    ...(action ? [
      { id: `${prefix}-request-button`, component: "Button" as const, child: `${prefix}-request-label`, variant: "primary" as const, action: { event: { name: REQUEST_TO_BOOK_EVENT, context: { artifactId: action.artifactId, unitId: action.unitId, projectionVersion: action.projectionVersion } } }, accessibility: { label: `Request to Book ${facts.title}` } },
      { id: `${prefix}-request-label`, component: "Text" as const, text: "Request to Book" },
    ] : []),
    ...(backToResults ? [
      { id: `${prefix}-back-button`, component: "Button" as const, child: `${prefix}-back-label`, action: { event: { name: BACK_TO_RESULTS_EVENT, context: { artifactId: backToResults.artifactId } } } },
      { id: `${prefix}-back-label`, component: "Text" as const, text: GUEST_JOURNEY.backToResults },
    ] : []),
  ];
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ];
}

/**
 * ADR-0068 / ADR-0081: projects the authoritative discovery/unit data into a
 * guest Unit Detail surface. The action context carries only opaque references;
 * the server independently resolves authoritative state from them (ADR-0072).
 */
export function unitDetailToA2UI({
  unit,
  checkIn,
  checkOut,
  surfaceId,
  action,
}: UnitDetailToA2UIInput): readonly A2UIServerMessage[] {
  const artifact = unitDetailArtifactFromProjection({
    unit,
    checkIn,
    checkOut,
    projectionVersion: action.projectionVersion,
  });
  return unitDetailArtifactToA2UI({ artifact, surfaceId });
}
