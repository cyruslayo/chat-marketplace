import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@weaver/core";
import type { DiscoveryUnitProjection } from "./discovery-a2ui.js";

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
  const prefix = "unit-detail";
  const components: A2UIComponent[] = [
    {
      // Basic Catalog mounts the surface from the conventional `root`
      // component. Keep the root stable while the rest of this surface uses
      // its own namespaced component IDs.
      id: "root",
      component: "Column",
      children: [
        `${prefix}-title`, `${prefix}-location`, `${prefix}-capacity`, `${prefix}-amenities`,
        `${prefix}-stay-dates`, `${prefix}-divider`, `${prefix}-price`, `${prefix}-deposit`,
        `${prefix}-inspection`, `${prefix}-inspection-dates`, `${prefix}-authority`,
        `${prefix}-disclosure`, `${prefix}-actions`,
      ],
    },
    { id: `${prefix}-title`, component: "Text", text: unit.title, variant: "h2" },
    { id: `${prefix}-location`, component: "Text", text: `${unit.location.neighbourhood}, ${unit.location.city}` },
    { id: `${prefix}-capacity`, component: "Text", text: `Capacity: ${unit.capacity} guests · ${unit.trust.occupancyModel}` },
    { id: `${prefix}-amenities`, component: "Text", text: `Amenities: ${unit.amenities.join(", ")}` },
    { id: `${prefix}-stay-dates`, component: "Text", text: `Stay: ${checkIn} to ${checkOut}` },
    { id: `${prefix}-divider`, component: "Divider", axis: "horizontal" },
    { id: `${prefix}-price`, component: "Text", text: `All-In Stay Total: ${formatNgnKobo(unit.price.allInStayTotalKobo ?? unit.price.nightlyKobo)}` },
    { id: `${prefix}-deposit`, component: "Text", text: `Refundable Security Deposit: ${formatNgnKobo(unit.price.refundableSecurityDepositKobo)}` },
    { id: `${prefix}-inspection`, component: "Text", text: `Physical inspection: ${unit.trust.inspection.status}` },
    {
      id: `${prefix}-inspection-dates`,
      component: "Text",
      text: `Inspected: ${unit.trust.inspection.inspectedAt}; current through: ${unit.trust.inspection.expiresAt}`,
      variant: "caption",
    },
    { id: `${prefix}-authority`, component: "Text", text: `Management authority: ${unit.trust.managementAuthority.status}` },
    {
      id: `${prefix}-disclosure`,
      component: "Text",
      text: "Request to Book does not charge you. The Operator confirms availability before any payment is due.",
      variant: "caption",
    },
    {
      id: `${prefix}-actions`,
      component: "Row",
      children: [`${prefix}-request-button`],
    },
    {
      id: `${prefix}-request-button`,
      component: "Button",
      child: `${prefix}-request-label`,
      variant: "primary",
      action: {
        event: {
          name: REQUEST_TO_BOOK_EVENT,
          context: { artifactId: action.artifactId, unitId: action.unitId, projectionVersion: action.projectionVersion },
        },
      },
      accessibility: { label: `Request to Book ${unit.title}` },
    },
    { id: `${prefix}-request-label`, component: "Text", text: "Request to Book" },
  ];

  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ];
}
