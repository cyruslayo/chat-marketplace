import {
  type A2UIComponent,
  type A2UIServerMessage,
} from "@cylayo/weaver-core";
import { formatNgnKobo, type DiscoveryUnitProjection } from "./discovery-a2ui.js";
import { unitDetailArtifactFromProjection, type UnitDetailArtifact } from "../../web/src/unit-detail-artifact.js";
import { GUEST_GLOSSARY, GUEST_JOURNEY, guestAmenityLabel, guestInspectionDisclosure } from "./guest-content.js";
import { formatStayDates, nightsBetween, unitStayTotalLabel, unitTiles } from "./booking-presentation.js";
import { extendedStayUnitFacts } from "./extended-stay-presentation.js";
import {
  SHORTLET_DISCOVERY_CATALOG_ID,
  UNIT_ACTION_BAR_COMPONENT,
  UNIT_DETAIL_COMPONENT,
  UNIT_DETAIL_SHEET_COMPONENT,
  UNIT_GALLERY_COMPONENT,
} from "./shortlet-catalogs.js";

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

/**
 * Weaver catalogues issue 05 (ADR 0102): the unit detail as typed `shortlet-discovery/v1` components. The server
 * decides every section, fact and display string (ADR 0077); the renderers only draw them, so the client never
 * searches the rendered DOM for a fact and a missing fact can never leave the surface half built (ADR 0074).
 */
export function unitDetailArtifactToA2UI({ artifact, surfaceId, backToResults, demo = false }: {
  readonly artifact: UnitDetailArtifact;
  readonly surfaceId: string;
  /** The discovery artifact the Guest came from; omitted when there are no results to return to. */
  readonly backToResults?: { readonly artifactId: string };
  /** ADR 0105: the staging demo labels the synthetic stay with the "Demo listing" chip. */
  readonly demo?: boolean;
}): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions.find((candidate) => candidate.type === "request-to-book");
  const prefix = "unit-detail";
  // ADR-0066: neighbourhood-level only, the same where line the standalone page shows.
  const where = `${facts.neighbourhood}, ${facts.city} · exact address after payment`;
  const nights = nightsBetween(facts.checkIn, facts.checkOut);
  const quoted = facts.price.allInStayTotalKobo !== null;
  const totalLabel = quoted ? unitStayTotalLabel(formatStayDates(facts.checkIn, facts.checkOut), nights) : "Indicative nightly rate";
  const total = formatNgnKobo(facts.price.allInStayTotalKobo ?? facts.price.nightlyKobo);
  const deposit = facts.price.refundableSecurityDepositKobo > 0 ? formatNgnKobo(facts.price.refundableSecurityDepositKobo) : undefined;
  // Demo-launch issue 12: the same monthly price and utilities lines the chat card and the standalone page show (ADR 0092).
  const extended = extendedStayUnitFacts(facts.extendedStay);
  const inspectionDisclosure = guestInspectionDisclosure(facts.inspection);
  const amenityIds = facts.amenities.map((_, index) => `${prefix}-amenity-${index}`);
  const components: A2UIComponent[] = [
    {
      id: "root",
      component: UNIT_DETAIL_COMPONENT,
      gallery: `${prefix}-gallery`,
      sheet: `${prefix}-sheet`,
      amenities: [`${prefix}-amenities-heading`, `${prefix}-amenities`],
      supporting: [...(inspectionDisclosure ? [`${prefix}-inspection`] : []), `${prefix}-disclosure`],
      actionBar: `${prefix}-action-bar`,
    },
    {
      id: `${prefix}-gallery`,
      component: UNIT_GALLERY_COMPONENT,
      title: facts.title,
      photos: facts.photos.map((url, index) => ({
        url,
        alt: `${facts.title} in ${facts.neighbourhood}, ${facts.city}${index === 0 ? " — main view" : ` — view ${index + 1}`}`,
      })),
    },
    {
      id: `${prefix}-sheet`,
      component: UNIT_DETAIL_SHEET_COMPONENT,
      where,
      title: facts.title,
      ...(demo ? { demo: true } : {}),
      tiles: unitTiles(facts.bedrooms, facts.bathrooms, facts.capacity).map((tile) => ({ icon: tile.icon, text: tile.text })),
      breakdown: { total, totalLabel, ...(deposit === undefined ? {} : { deposit }) },
      ...(extended.length > 0 ? { extended: [...extended] } : {}),
      ...(facts.description.trim() === "" ? {} : { about: facts.description }),
    },
    { id: `${prefix}-amenities-heading`, component: "Text", text: "Amenities", variant: "h3" },
    { id: `${prefix}-amenities`, component: "Column", children: amenityIds },
    ...facts.amenities.map((amenity, index) => ({ id: amenityIds[index]!, component: "Text" as const, text: guestAmenityLabel(amenity) })),
    ...(inspectionDisclosure ? [{ id: `${prefix}-inspection`, component: "Text" as const, text: inspectionDisclosure, variant: "caption" as const }] : []),
    { id: `${prefix}-disclosure`, component: "Text", text: `Request to Book starts a request for Operator confirmation. Viewing this ${GUEST_GLOSSARY.unit} does not reserve dates or create a Reservation.`, variant: "caption" },
    { id: `${prefix}-action-bar`, component: UNIT_ACTION_BAR_COMPONENT, total, totalLabel, child: `${prefix}-actions` },
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
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: SHORTLET_DISCOVERY_CATALOG_ID } },
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
