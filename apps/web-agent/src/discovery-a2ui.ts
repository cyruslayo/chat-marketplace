import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@weaver/core";

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
  readonly amenities: readonly string[];
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

const VIEW_UNIT_EVENT = "shortlet.discovery.view-unit";

function formatNgnKobo(kobo: number): string {
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
  const priceText = unit.price.allInStayTotalKobo === null
    ? `Indicative nightly rate: ${formatNgnKobo(unit.price.nightlyKobo)}`
    : `All-In Stay Total: ${formatNgnKobo(unit.price.allInStayTotalKobo)}`;

  return {
    cardId: `${prefix}-card`,
    components: [
      { id: `${prefix}-card`, component: "Card", child: `${prefix}-content` },
      {
        id: `${prefix}-content`,
        component: "Column",
        children: [
          `${prefix}-title`, `${prefix}-location`, `${prefix}-capacity`, `${prefix}-amenities`,
          `${prefix}-divider`, `${prefix}-prices`, `${prefix}-inspection`, `${prefix}-inspection-dates`,
          ...(canViewUnit ? [`${prefix}-view-button`] : []),
        ],
      },
      { id: `${prefix}-title`, component: "Text", text: unit.title, variant: "h3" },
      { id: `${prefix}-location`, component: "Text", text: `${unit.location.neighbourhood}, ${unit.location.city}` },
      { id: `${prefix}-capacity`, component: "Text", text: `Capacity: ${unit.capacity} guests` },
      { id: `${prefix}-amenities`, component: "Text", text: `Amenities: ${unit.amenities.join(", ")}` },
      { id: `${prefix}-divider`, component: "Divider", axis: "horizontal" },
      {
        id: `${prefix}-prices`,
        component: "Row",
        children: [`${prefix}-price`, `${prefix}-deposit`],
        justify: "spaceBetween",
      },
      { id: `${prefix}-price`, component: "Text", text: priceText },
      {
        id: `${prefix}-deposit`,
        component: "Text",
        text: `Refundable Security Deposit: ${formatNgnKobo(unit.price.refundableSecurityDepositKobo)}`,
      },
      { id: `${prefix}-inspection`, component: "Text", text: `Inspection: ${unit.trust.inspection.status}` },
      {
        id: `${prefix}-inspection-dates`,
        component: "Text",
        text: `Inspected: ${unit.trust.inspection.inspectedAt}; current through: ${unit.trust.inspection.expiresAt}`,
        variant: "caption",
      },
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
  const dateSummary = typeof artifact.facts.filters.checkIn === "string" && typeof artifact.facts.filters.checkOut === "string"
    ? ` Stay: ${artifact.facts.filters.checkIn} to ${artifact.facts.filters.checkOut}.`
    : "";
  const resultSummary = artifact.facts.results.length === 0
    ? `No eligible Units match those requirements.${dateSummary}`
    : `${artifact.facts.results.length} eligible Unit${artifact.facts.results.length === 1 ? "" : "s"} found.${dateSummary}`;
  const disclosureIds = artifact.disclosures.map((_, index) => `disclosure-${index}`);
  const rootChildren = ["result-summary", ...unitGroups.map((group) => group.cardId), ...disclosureIds];
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: rootChildren },
    { id: "result-summary", component: "Text", text: resultSummary, variant: "h2" },
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
