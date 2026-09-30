import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@weaver/core";
import { formatNgnKobo, type DiscoveryUnitProjection } from "./discovery-a2ui.js";
import { unitDetailArtifactFromProjection, type UnitDetailArtifact } from "../../web/src/unit-detail-artifact.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, GUEST_JOURNEY, UNIT_DETAIL_ABOUT_HEADING, guestAmenityLabel, guestFact, guestInspectionDisclosure } from "./guest-content.js";
import { formatStayDates, nightsBetween, unitStayTotalLabel, unitTiles } from "./booking-presentation.js";

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
  // ADR-0066: neighbourhood-level only, the same where line the standalone page shows.
  const location = `${facts.neighbourhood}, ${facts.city} · exact address after payment`;
  const tiles = unitTiles(facts.bedrooms, facts.bathrooms, facts.capacity);
  const nights = nightsBetween(facts.checkIn, facts.checkOut);
  const quoted = facts.price.allInStayTotalKobo !== null;
  const allInLabel = quoted ? unitStayTotalLabel(formatStayDates(facts.checkIn, facts.checkOut), nights) : "Indicative nightly rate";
  const allInAmount = facts.price.allInStayTotalKobo ?? facts.price.nightlyKobo;
  const inspectionDisclosure = guestInspectionDisclosure(facts.inspection);
  const amenityIds = facts.amenities.map((_, index) => `${prefix}-amenity-${index}`);
  const inspectionId = inspectionDisclosure === undefined ? [] : [`${prefix}-inspection`];
  const depositId = facts.price.refundableSecurityDepositKobo > 0 ? [`${prefix}-deposit`] : [];
  const photoIds = facts.photos.map((_, index) => `${prefix}-photo-${index}`);
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: [
      ...(photoIds.length > 0 ? photoIds : [`${prefix}-photo-unavailable`]),
      `${prefix}-title`, `${prefix}-location`, `${prefix}-bedrooms`, `${prefix}-bathrooms`, `${prefix}-sleeps`,
      `${prefix}-price-label`, `${prefix}-price`, ...depositId,
      `${prefix}-about-heading`, `${prefix}-about`, `${prefix}-amenities-heading`, `${prefix}-amenities`,
      ...inspectionId, `${prefix}-disclosure`, `${prefix}-actions`,
    ] },
    { id: `${prefix}-title`, component: "Text", text: facts.title, variant: "h2" },
    { id: `${prefix}-location`, component: "Text", text: location, variant: "caption" },
    ...tiles.map((tile, index) => ({ id: `${prefix}-${["bedrooms", "bathrooms", "sleeps"][index]}`, component: "Text" as const, text: guestFact([GUEST_FACT_LABELS.bedrooms, GUEST_FACT_LABELS.bathrooms, GUEST_FACT_LABELS.sleeps][index]!, tile.text) })),
    { id: `${prefix}-price-label`, component: "Text", text: allInLabel, variant: "caption" },
    { id: `${prefix}-price`, component: "Text", text: formatNgnKobo(allInAmount), variant: "h2" },
    ...(facts.price.refundableSecurityDepositKobo > 0 ? [{ id: `${prefix}-deposit`, component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.refundableSecurityDeposit, formatNgnKobo(facts.price.refundableSecurityDepositKobo)), variant: "caption" as const }] : []),
    { id: `${prefix}-about-heading`, component: "Text", text: UNIT_DETAIL_ABOUT_HEADING, variant: "h2" },
    { id: `${prefix}-about`, component: "Text", text: facts.description },
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
