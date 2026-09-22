import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@weaver/core";
import type { DiscoveryUnitProjection } from "./discovery-a2ui.js";
import { unitDetailArtifactFromProjection, type UnitDetailArtifact } from "../../web/src/unit-detail-artifact.js";

export const REQUEST_TO_BOOK_EVENT = "shortlet.unit-detail.request-to-book";

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

export function unitDetailArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: UnitDetailArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions.find((candidate) => candidate.type === "request-to-book");
  const prefix = "unit-detail";
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: [`${prefix}-title`, `${prefix}-location`, `${prefix}-rooms`, `${prefix}-description`, `${prefix}-amenities`, ...facts.photos.map((_, index) => `${prefix}-photo-${index}`), `${prefix}-stay-dates`, `${prefix}-divider`, `${prefix}-price`, `${prefix}-deposit`, `${prefix}-inspection`, `${prefix}-inspection-dates`, `${prefix}-authority`, `${prefix}-disclosure`, `${prefix}-actions`] },
    { id: `${prefix}-title`, component: "Text", text: facts.title, variant: "h2" },
    { id: `${prefix}-location`, component: "Text", text: `${facts.neighbourhood}, ${facts.city}` },
    { id: `${prefix}-rooms`, component: "Text", text: `Bedrooms: ${facts.bedrooms ?? "Not provided"} · Bathrooms: ${facts.bathrooms} · Capacity: ${facts.capacity} guests · ${facts.occupancyModel}` },
    { id: `${prefix}-description`, component: "Text", text: facts.description },
    { id: `${prefix}-amenities`, component: "Text", text: `Amenities: ${facts.amenities.join(", ")}` },
    ...facts.photos.map((url, index) => ({ id: `${prefix}-photo-${index}`, component: "Image" as const, url, description: `Photo ${index + 1} of ${facts.title}` })),
    { id: `${prefix}-stay-dates`, component: "Text", text: `Stay: ${facts.checkIn} to ${facts.checkOut}` },
    { id: `${prefix}-divider`, component: "Divider", axis: "horizontal" },
    { id: `${prefix}-price`, component: "Text", text: `All-In Stay Total: ${formatNgnKobo(facts.price.allInStayTotalKobo ?? facts.price.nightlyKobo)}` },
    { id: `${prefix}-deposit`, component: "Text", text: `Refundable Security Deposit: ${formatNgnKobo(facts.price.refundableSecurityDepositKobo)}` },
    { id: `${prefix}-inspection`, component: "Text", text: `Physical inspection: ${facts.inspection.status}` },
    { id: `${prefix}-inspection-dates`, component: "Text", text: `Inspected: ${facts.inspection.inspectedAt}; current through: ${facts.inspection.expiresAt}`, variant: "caption" },
    { id: `${prefix}-authority`, component: "Text", text: `Management authority: ${facts.managementAuthority.status}` },
    { id: `${prefix}-disclosure`, component: "Text", text: artifact.disclosures.join(" "), variant: "caption" },
    { id: `${prefix}-actions`, component: "Row", children: action ? [`${prefix}-request-button`] : [] },
    ...(action ? [
      { id: `${prefix}-request-button`, component: "Button" as const, child: `${prefix}-request-label`, variant: "primary" as const, action: { event: { name: REQUEST_TO_BOOK_EVENT, context: { artifactId: action.artifactId, unitId: action.unitId, projectionVersion: action.projectionVersion } } }, accessibility: { label: `Request to Book ${facts.title}` } },
      { id: `${prefix}-request-label`, component: "Text" as const, text: "Request to Book" },
    ] : []),
  ];
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ];
}

function formatNgnKobo(kobo: number): string {
  const amount = (kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₦${amount}`;
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
