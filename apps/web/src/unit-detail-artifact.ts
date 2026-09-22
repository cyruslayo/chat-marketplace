import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { DiscoveryUnitProjection } from "../../web-agent/src/discovery-a2ui.js";

export const UNIT_DETAIL_ARTIFACT_KIND = "shortlet.unit-detail";
export const UNIT_DETAIL_SCHEMA_VERSION = "shortlet.unit-detail/v1";

export interface UnitDetailArtifactAction {
  readonly type: "request-to-book";
  readonly artifactId: string;
  readonly unitId: string;
  readonly projectionVersion: number;
}

export interface UnitDetailArtifact {
  readonly id: string;
  readonly kind: typeof UNIT_DETAIL_ARTIFACT_KIND;
  readonly schemaVersion: typeof UNIT_DETAIL_SCHEMA_VERSION;
  readonly projectionVersion: number;
  readonly domainReferences: readonly { readonly type: "unit"; readonly id: string }[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly disclosures: readonly string[];
  readonly facts: {
    readonly unitId: string;
    readonly title: string;
    readonly neighbourhood: string;
    readonly city: string;
    readonly photos: readonly string[];
    readonly price: DiscoveryUnitProjection["price"];
    readonly bedrooms?: number;
    readonly bathrooms: number;
    readonly capacity: number;
    readonly amenities: readonly string[];
    readonly description: string;
    readonly occupancyModel: string;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly inspection: DiscoveryUnitProjection["trust"]["inspection"];
    readonly managementAuthority: DiscoveryUnitProjection["trust"]["managementAuthority"];
  };
  readonly actions: readonly UnitDetailArtifactAction[];
  readonly acknowledgements: readonly string[];
  readonly sensitivity: "booking-sensitive";
}

export interface UnitDetailArtifactInput {
  readonly unit: DiscoveryUnitProjection;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly projectionVersion: number;
  readonly viewer?: CommandPrincipal;
}

export function unitDetailArtifactId(unitId: string, projectionVersion: number): string {
  return `unit-detail:${unitId}:${projectionVersion}`;
}

export function unitDetailArtifactFromProjection({ unit, checkIn, checkOut, projectionVersion, viewer }: UnitDetailArtifactInput): UnitDetailArtifact {
  const id = unitDetailArtifactId(unit.id, projectionVersion);
  const canRequest = viewer === undefined || (viewer.role === "guest" && viewer.id !== "");
  const actions: readonly UnitDetailArtifactAction[] = canRequest
    ? [{ type: "request-to-book", artifactId: id, unitId: unit.id, projectionVersion }]
    : [];

  return Object.freeze({
    id,
    kind: UNIT_DETAIL_ARTIFACT_KIND,
    schemaVersion: UNIT_DETAIL_SCHEMA_VERSION,
    projectionVersion,
    domainReferences: Object.freeze([{ type: "unit" as const, id: unit.id }]),
    policyVersions: Object.freeze({ pricing: unit.price.pricingVersion }),
    disclosures: Object.freeze(["Request to Book does not charge you. The Operator confirms availability before payment is due."]),
    facts: Object.freeze({
      unitId: unit.id,
      title: unit.title,
      neighbourhood: unit.location.neighbourhood,
      city: unit.location.city,
      photos: Object.freeze([...unit.photoUrls]),
      price: Object.freeze({ ...unit.price }),
      ...(unit.bedrooms === undefined ? {} : { bedrooms: unit.bedrooms }),
      bathrooms: unit.bathrooms,
      capacity: unit.capacity,
      amenities: Object.freeze([...unit.amenities]),
      description: unit.description,
      occupancyModel: unit.trust.occupancyModel,
      checkIn,
      checkOut,
      inspection: Object.freeze({ ...unit.trust.inspection, scope: Object.freeze([...unit.trust.inspection.scope]) }),
      managementAuthority: Object.freeze({ ...unit.trust.managementAuthority }),
    }),
    actions: Object.freeze(actions.map((action) => Object.freeze(action))),
    acknowledgements: Object.freeze([]),
    sensitivity: "booking-sensitive",
  });
}
