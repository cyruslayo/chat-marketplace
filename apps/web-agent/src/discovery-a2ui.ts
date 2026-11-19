import {
  type A2UIComponent,
  type A2UIServerMessage,
} from "@cylayo/weaver-core";
import { formatMoney } from "../../web/src/ui-kit.js";
import { GUEST_COMPARE_LABELS, GUEST_FACT_LABELS, GUEST_GLOSSARY, formatGuestDate, guestAmenityLabel, stayTotalLabel } from "./guest-content.js";
import { monthlyPriceFact, utilitiesFact, type ExtendedStayUnitFacts } from "./extended-stay-presentation.js";
import { SHORTLET_DISCOVERY_CATALOG_ID, STAY_CARD_COMPONENT, STAY_COMPARISON_COMPONENT, STAY_RESULTS_COMPONENT } from "./shortlet-catalogs.js";
import { surfaceMessages } from "./a2ui-surface.js";

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
  /** Demo-launch issue 12: present only on an Extended Stay result (ADR 0092). */
  readonly extendedStay?: ExtendedStayUnitFacts;
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
  /** Issue 13b: the result already picked for comparison, if any. */
  readonly compareSelection?: string;
  /** ADR 0105: the staging demo labels each synthetic stay with the "Demo listing" chip. */
  readonly demo?: boolean;
}

export const VIEW_UNIT_EVENT = "shortlet.discovery.view-unit";
export const SEE_ALL_DISCOVERY_EVENT = "shortlet.discovery.see-all";
/** Issue 13b: pick (or un-pick) a result; the second pick opens the comparison. */
export const COMPARE_UNIT_EVENT = "shortlet.discovery.compare";
/** Issue 13b: from the comparison, re-present the same search results. */
export const COMPARE_BACK_EVENT = "shortlet.discovery.compare.back-to-results";
/** Presentation only: the comparison is two-up (issue 13b). */
export const COMPARE_SIZE = 2;

/** Kept as the Guest-surface name; the shared formatter lives in apps/web/src/ui-kit.ts. */
export function formatNgnKobo(kobo: number): string {
  return formatMoney(kobo);
}

/** Where each fit reason comes from on the unit (issue 11 AC1). */
export type FitReasonSource = "capacity" | "bedrooms" | "amenities" | "trust.inspection";

export interface FitReason {
  readonly text: string;
  readonly source: FitReasonSource;
}

const POWER_AMENITIES = ["24_7_power_generator", "generator"] as const;
const MAX_FIT_REASONS = 3;

/**
 * Issue 11 AC1: up to three reasons a unit fits the search, each read from
 * one unit field against the criteria. Nothing is inferred: a unit without
 * the field gets no reason. The inspection reason is a dated, specific claim
 * (ADR-0008, ADR-0066), never a generic "verified".
 */
export function fitReasons(unit: DiscoveryUnitProjection, filters: Readonly<Record<string, unknown>>): readonly FitReason[] {
  const reasons: FitReason[] = [];
  const partySize = typeof filters.partySize === "number" ? filters.partySize : undefined;
  if (partySize !== undefined && Number.isInteger(unit.capacity) && unit.capacity >= partySize) {
    reasons.push({ source: "capacity", text: unit.capacity === partySize ? `Sleeps ${partySize} exactly` : `Room for ${partySize} (sleeps ${unit.capacity})` });
  }
  if (typeof filters.bedrooms === "number" && unit.bedrooms === filters.bedrooms) {
    reasons.push({ source: "bedrooms", text: `${unit.bedrooms} ${unit.bedrooms === 1 ? "bedroom" : "bedrooms"}, as asked` });
  }
  const power = POWER_AMENITIES.find((amenity) => unit.amenities.includes(amenity));
  if (power !== undefined) reasons.push({ source: "amenities", text: guestAmenityLabel(power) });
  const inspected = formatGuestDate(unit.trust.inspection.inspectedAt);
  if ((unit.trust.inspection.status === "current" || unit.trust.inspection.status === "passed") && inspected !== undefined) {
    reasons.push({ source: "trust.inspection", text: `Physically inspected ${inspected}` });
  }
  return reasons.slice(0, MAX_FIT_REASONS);
}

/**
 * Issue 03b / ADR-0015 / issue 10: a result is described as within budget only when it has an All-In Stay Total at or
 * under the budget. The Refundable Security Deposit is never part of that comparison (ADR-0016); when it takes the cash
 * needed over the budget, the card shows the projected amount due now, never a presentation-level sum of two amounts.
 */
function budgetNote(unit: DiscoveryUnitProjection, budgetKobo: number | undefined): string | undefined {
  const total = unit.price.allInStayTotalKobo;
  if (budgetKobo === undefined || total === null || total > budgetKobo) return undefined;
  const within = `Within your ${formatNgnKobo(budgetKobo)} budget (${GUEST_GLOSSARY.allInStayTotal}).`;
  const deposit = unit.price.refundableSecurityDepositKobo;
  const amountDueNow = unit.price.amountDueNowKobo;
  return deposit > 0 && amountDueNow !== null && amountDueNow > budgetKobo
    ? `${within} The ${GUEST_GLOSSARY.refundableSecurityDeposit} is paid separately, so the ${GUEST_FACT_LABELS.amountDueNow.toLowerCase()} is ${formatNgnKobo(amountDueNow)}.`
    : within;
}

/** One phone result row (`StayResults.rows`): the parts the kit's result row draws, keyed by its card's unit. */
interface StayResultRow {
  readonly unitId: string;
  readonly title: string;
  readonly total: string;
  readonly totalLabel: string;
  readonly photoUrl?: string;
}

interface CompareControl {
  /** The result already picked, if any. */
  readonly selected?: DiscoveryUnitProjection;
}

function compareButton(artifactId: string, unit: DiscoveryUnitProjection, prefix: string, compare: CompareControl): readonly A2UIComponent[] {
  const picked = compare.selected?.id === unit.id;
  // WCAG 2.5.3: each accessible name starts with the visible label.
  const label = picked ? GUEST_COMPARE_LABELS.unpick : GUEST_COMPARE_LABELS.pick;
  const accessible = picked
    ? `${GUEST_COMPARE_LABELS.unpick}: ${unit.title}`
    : compare.selected === undefined ? `Compare: ${unit.title}` : `Compare: ${unit.title} with ${compare.selected.title}`;
  return [
    {
      id: `${prefix}-compare-button`,
      component: "Button",
      child: `${prefix}-compare-label`,
      variant: "borderless",
      action: { event: { name: COMPARE_UNIT_EVENT, context: { artifactId, unitId: unit.id } } },
      accessibility: { label: accessible },
    },
    { id: `${prefix}-compare-label`, component: "Text", text: label },
  ];
}

function unitComponents(
  artifactId: string,
  unit: DiscoveryUnitProjection,
  canViewUnit: boolean,
  filters: Readonly<Record<string, unknown>>,
  budgetKobo?: number,
  compare?: CompareControl,
  demo = false,
): { readonly cardId: string; readonly row: StayResultRow; readonly components: readonly A2UIComponent[] } {
  const prefix = `unit-${unit.id}`;
  // Guest UI consistency issue 05: always the neighbourhood-level place (ADR 0066), so the chat card and the page say the same.
  const location = `${unit.location.neighbourhood}, ${unit.location.city}`;
  const facts = [
    ...(unit.bedrooms === undefined ? [] : [`${unit.bedrooms} ${unit.bedrooms === 1 ? "bedroom" : "bedrooms"}`]),
    `${unit.bathrooms} ${unit.bathrooms === 1 ? "bathroom" : "bathrooms"}`,
    `Sleeps ${unit.capacity}`,
  ];
  const highlights = unit.amenities.slice(0, 3);
  const checkIn = typeof filters.checkIn === "string" ? filters.checkIn : undefined;
  const checkOut = typeof filters.checkOut === "string" ? filters.checkOut : undefined;
  const nights = checkIn && checkOut && /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut)
    ? (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000
    : undefined;
  const allInLabel = stayTotalLabel(unit.price.allInStayTotalKobo !== null, typeof nights === "number" && Number.isInteger(nights) ? nights : undefined);
  const allInAmount = unit.price.allInStayTotalKobo === null
    ? unit.price.nightlyKobo
    : unit.price.allInStayTotalKobo;
  const budget = budgetNote(unit, budgetKobo);
  const fit = fitReasons(unit, filters);

  // Weaver catalogues issue 06 (ADR 0102): the card's facts are typed StayCard props, drawn by the search page's kit
  // markup. Only the server-worded caption lines and the action Buttons stay Basic children.
  const factTiles = [
    ...(unit.bedrooms === undefined ? [] : [{ icon: "bed" as const, text: facts[0]! }]),
    { icon: "bath" as const, text: facts[facts.length - 2]! },
    { icon: "users" as const, text: facts[facts.length - 1]! },
  ];
  const notes = [
    ...(highlights.length > 0 ? [`${prefix}-amenities`] : []),
    ...(unit.extendedStay ? [`${prefix}-monthly`, `${prefix}-utilities`] : []),
    ...(budget === undefined ? [] : [`${prefix}-budget`]),
  ];
  return {
    cardId: `${prefix}-card`,
    row: {
      unitId: unit.id,
      title: unit.title,
      total: formatNgnKobo(allInAmount),
      totalLabel: allInLabel,
      ...(unit.photoUrls.length > 0 ? { photoUrl: unit.photoUrls[0]! } : {}),
    },
    components: [
      {
        id: `${prefix}-card`,
        component: STAY_CARD_COMPONENT,
        unitId: unit.id,
        title: unit.title,
        where: location,
        ...(demo ? { demo: true } : {}),
        facts: factTiles,
        total: formatNgnKobo(allInAmount),
        totalLabel: allInLabel,
        ...(unit.price.refundableSecurityDepositKobo > 0 ? { deposit: formatNgnKobo(unit.price.refundableSecurityDepositKobo) } : {}),
        ...(unit.photoUrls.length > 0 ? { photoUrl: unit.photoUrls[0]! } : {}),
        // The "1 / N" badge counts the same photos as the search page's card; one photo shows no badge.
        ...(unit.photoUrls.length > 1 ? { photoCount: unit.photoUrls.length } : {}),
        ...(canViewUnit ? { view: `${prefix}-view-button` } : {}),
        ...(compare === undefined ? {} : { compare: `${prefix}-compare-button` }),
        ...(fit.length > 0 ? { fit: `${prefix}-fit` } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      },
      ...(fit.length > 0 ? [{ id: `${prefix}-fit`, component: "Text" as const, text: `Why it fits: ${fit.map((reason) => reason.text).join(" · ")}`, variant: "caption" as const }] : []),
      ...(highlights.length > 0 ? [{
        id: `${prefix}-amenities`,
        component: "Text" as const,
        text: highlights.map(guestAmenityLabel).join(" · "),
        variant: "caption" as const,
      }] : []),
      ...(unit.extendedStay ? [
        { id: `${prefix}-monthly`, component: "Text" as const, text: monthlyPriceFact(unit.extendedStay), variant: "caption" as const },
        { id: `${prefix}-utilities`, component: "Text" as const, text: utilitiesFact(unit.extendedStay), variant: "caption" as const },
      ] : []),
      ...(budget === undefined ? [] : [{ id: `${prefix}-budget`, component: "Text" as const, text: budget, variant: "caption" as const }]),
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
        { id: `${prefix}-view-label`, component: "Text" as const, text: GUEST_GLOSSARY.viewUnit },
      ] : []),
      ...(compare === undefined ? [] : compareButton(artifactId, unit, prefix, compare)),
    ],
  };
}

export function discoveryArtifactToA2UI({
  artifact,
  surfaceId,
  compareSelection,
  demo = false,
}: DiscoveryArtifactToA2UIInput): readonly A2UIServerMessage[] {
  // Issue 13b: comparing needs at least two results; a stale pick is ignored.
  const selected = artifact.facts.results.find((unit) => unit.id === compareSelection);
  const compare: CompareControl | undefined = artifact.facts.results.length >= COMPARE_SIZE ? (selected === undefined ? {} : { selected }) : undefined;
  const unitGroups = artifact.facts.results.map((unit) => unitComponents(
    artifact.id,
    unit,
    artifact.actions.some((action) => action.type === "view-unit" && action.unitId === unit.id),
    artifact.facts.filters,
    typeof artifact.facts.filters.maxPriceKobo === "number" ? artifact.facts.filters.maxPriceKobo : undefined,
    compare,
    demo,
  ));
  const checkIn = typeof artifact.facts.filters.checkIn === "string" ? formatGuestDate(artifact.facts.filters.checkIn) : undefined;
  const checkOut = typeof artifact.facts.filters.checkOut === "string" ? formatGuestDate(artifact.facts.filters.checkOut) : undefined;
  const dateSummary = checkIn && checkOut ? ` · ${checkIn} – ${checkOut}` : "";
  const context = discoveryContext(artifact.facts.filters);
  const resultSummary = artifact.facts.results.length === 0
    ? "No stays match this search"
    : `${artifact.facts.results.length} stay${artifact.facts.results.length === 1 ? "" : "s"} to explore`;
  const disclosureIds = artifact.disclosures.map((_, index) => `disclosure-${index}`);
  const resultListId = "result-list";
  const seeAllId = "see-all-results";
  const rootChildren = ["result-summary", "search-context", resultListId, ...(unitGroups.length === 1 ? [] : unitGroups.length > 1 ? [seeAllId] : []), ...(unitGroups.length === 0 ? ["zero-result-guidance"] : []), ...disclosureIds];
  const resultList: A2UIComponent = unitGroups.length === 0
    ? { id: resultListId, component: "Column", children: [] }
    : { id: resultListId, component: STAY_RESULTS_COMPONENT, rows: unitGroups.map((group) => ({ ...group.row })), cards: unitGroups.map((group) => group.cardId) };
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: rootChildren },
    { id: "result-summary", component: "Text", text: resultSummary, variant: "h2" },
    { id: "search-context", component: "Text", text: `${context}${dateSummary}`.trim(), variant: "caption" },
    // Weaver catalogues issue 06: the result rows, "See both side by side" and the card grid; an empty search keeps the
    // Basic Column and its "No stays match" guidance.
    resultList,
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

  return surfaceMessages(surfaceId, SHORTLET_DISCOVERY_CATALOG_ID, components);
}

export interface CompareArtifactToA2UIInput {
  readonly artifact: DiscoveryArtifactProjection;
  readonly unitIds: readonly [string, string];
  readonly surfaceId: string;
}

export interface CompareAttribute {
  readonly key: string;
  readonly label: string;
  readonly value: (unit: DiscoveryUnitProjection) => string;
}

/**
 * Issue 13b: every compared attribute, in one fixed order so the two stays
 * line up. Price is the All-In Stay Total (ADR-0015); the deposit is its own
 * row, never folded into the price (ADR-0016).
 */
export const COMPARE_ATTRIBUTES: readonly CompareAttribute[] = [
  {
    key: "price",
    label: GUEST_GLOSSARY.allInStayTotal,
    value: (unit) => unit.price.allInStayTotalKobo === null
      ? `Not yet quoted · Indicative nightly rate ${formatNgnKobo(unit.price.nightlyKobo)}`
      : formatNgnKobo(unit.price.allInStayTotalKobo),
  },
  {
    key: "deposit",
    label: GUEST_FACT_LABELS.refundableSecurityDeposit,
    value: (unit) => unit.price.refundableSecurityDepositKobo > 0 ? formatNgnKobo(unit.price.refundableSecurityDepositKobo) : "None",
  },
  { key: "where", label: GUEST_FACT_LABELS.where, value: (unit) => `${unit.location.neighbourhood}, ${unit.location.city}` },
  { key: "bedrooms", label: "Bedrooms", value: (unit) => unit.bedrooms === undefined ? "Not provided" : String(unit.bedrooms) },
  { key: "bathrooms", label: "Bathrooms", value: (unit) => String(unit.bathrooms) },
  { key: "sleeps", label: "Sleeps", value: (unit) => String(unit.capacity) },
];

/** Plain-text comparison for fallbacks and conventional pages. */
export function compareFallbackText(units: readonly DiscoveryUnitProjection[]): string {
  return units.map((unit) => `${unit.title}: ${COMPARE_ATTRIBUTES.map((attribute) => `${attribute.label} ${attribute.value(unit)}`).join("; ")}.`).join(" ");
}

/** Weaver catalogues issue 07: the `StayComparison` table props, as the renderer draws them. */
export interface StayComparisonProps {
  readonly heads: readonly string[];
  readonly rows: readonly {
    readonly key: string;
    readonly cells: readonly { readonly value: string; readonly unit: string }[];
  }[];
}

/**
 * Builds the comparison table props and refuses a row whose cell count differs from the heads, before anything is
 * emitted: a short row would otherwise shift a value into another stay's column.
 */
export function stayComparisonProps(heads: readonly string[], rows: StayComparisonProps["rows"]): StayComparisonProps {
  for (const row of rows) {
    if (row.cells.length !== heads.length) throw new Error(`Comparison row "${row.key}" has ${row.cells.length} cells for ${heads.length} stays`);
  }
  return { heads: [...heads], rows: rows.map((row) => ({ key: row.key, cells: row.cells.map((cell) => ({ ...cell })) })) };
}

/**
 * Issue 13b AC2: two results side by side, one row per attribute. Each cell
 * repeats its stay's name so a stacked cell still says what it describes;
 * the shell stacks the rows at narrow widths (AC3, ADR-0078). Weaver
 * catalogues issue 07 (ADR 0102): one typed StayComparison on
 * `shortlet-discovery/v1`. Throws on a unit the artifact lacks: the caller
 * has already validated both against the stored artifact.
 */
export function compareArtifactToA2UI({ artifact, unitIds, surfaceId }: CompareArtifactToA2UIInput): readonly A2UIServerMessage[] {
  const units = unitIds.map((id) => {
    const unit = artifact.facts.results.find((candidate) => candidate.id === id);
    if (unit === undefined) throw new Error("Compared stay is not in these results");
    return unit;
  });
  const table = stayComparisonProps(
    units.map((unit) => unit.title),
    COMPARE_ATTRIBUTES.map((attribute) => ({ key: attribute.label, cells: units.map((unit) => ({ value: attribute.value(unit), unit: unit.title })) })),
  );
  const checkIn = typeof artifact.facts.filters.checkIn === "string" ? formatGuestDate(artifact.facts.filters.checkIn) : undefined;
  const checkOut = typeof artifact.facts.filters.checkOut === "string" ? formatGuestDate(artifact.facts.filters.checkOut) : undefined;
  const context = `${discoveryContext(artifact.facts.filters)}${checkIn && checkOut ? ` · ${checkIn} – ${checkOut}` : ""}`.trim();
  const disclosureIds = artifact.disclosures.map((_, index) => `compare-disclosure-${index}`);
  const components: A2UIComponent[] = [
    {
      id: "root",
      component: "Column",
      children: ["compare-heading", ...(context === "" ? [] : ["compare-context"]), "compare-table", ...disclosureIds, "compare-back"],
    },
    { id: "compare-heading", component: "Text", text: `Compare ${units.length} stays`, variant: "h2" },
    ...(context === "" ? [] : [{ id: "compare-context", component: "Text" as const, text: context, variant: "caption" as const }]),
    {
      id: "compare-table",
      component: STAY_COMPARISON_COMPONENT,
      heads: [...table.heads],
      rows: table.rows.map((row) => ({ key: row.key, cells: row.cells.map((cell) => ({ value: cell.value, unit: cell.unit })) })),
      // A "View" per stay opens it, the same event a result's View apartment sends.
      actions: units.map((_, index) => `compare-view-${index}`),
    },
    ...units.flatMap((unit, index): A2UIComponent[] => [
      { id: `compare-view-${index}`, component: "Button", child: `compare-view-${index}-label`, action: { event: { name: VIEW_UNIT_EVENT, context: { artifactId: artifact.id, unitId: unit.id } } }, accessibility: { label: `View ${unit.title}` } },
      { id: `compare-view-${index}-label`, component: "Text", text: "View" },
    ]),
    ...artifact.disclosures.map((disclosure, index): A2UIComponent => ({ id: `compare-disclosure-${index}`, component: "Text", text: disclosure, variant: "caption" })),
    {
      id: "compare-back",
      component: "Button",
      child: "compare-back-label",
      variant: "primary",
      action: { event: { name: COMPARE_BACK_EVENT, context: { artifactId: artifact.id } } },
    },
    { id: "compare-back-label", component: "Text", text: "Back to results" },
  ];
  return surfaceMessages(surfaceId, SHORTLET_DISCOVERY_CATALOG_ID, components);
}

function discoveryContext(filters: Readonly<Record<string, unknown>>): string {
  const location = typeof filters.neighbourhood === "string"
    ? filters.neighbourhood
    : typeof filters.location === "string" ? filters.location : undefined;
  const partySize = typeof filters.partySize === "number" ? `${filters.partySize} ${filters.partySize === 1 ? "guest" : "guests"}` : undefined;
  const budget = typeof filters.maxPriceKobo === "number" ? `budget ${formatNgnKobo(filters.maxPriceKobo)}` : undefined;
  const details = [location, partySize, budget].filter((value): value is string => value !== undefined);
  return details.length > 0 ? `Your search: ${details.join(" · ")}` : "Your search details";
}
