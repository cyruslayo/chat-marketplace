import { defineSurfaceComponent } from "../../../packages/surface-kit/src/index.js";
import { escapeHtml, statusBadge, type StatusTone } from "../../../apps/web/src/ui-kit.js";

/**
 * Test-only Surface Component (surface-catalogue-library issue 02). It is never imported by production code and its
 * manifest id (`urn:chat-marketplace:test/probe/v1`) is never registered in production. It carries no domain vocabulary
 * (ADR 0108 decision 2) and no copy: every visible string arrives through props (ADR 0077).
 */
export type ProbeTone = "positive" | "neutral" | "caution";

export interface ProbeAction {
  readonly event: { readonly name: string; readonly context?: Readonly<Record<string, unknown>> };
}

/** Written beside the schema; `assertPropsMatchSchema` keeps the two equal. */
export interface ProbeCardProps {
  readonly id: string;
  readonly component: "ProbeCard";
  readonly title: string;
  readonly facts?: readonly string[];
  readonly badge?: { readonly label: string; readonly tone: ProbeTone };
  readonly primaryActionLabel: string;
  readonly primaryAction: ProbeAction;
}

export const PROBE_CARD_REQUIRED = ["id", "component", "title", "primaryActionLabel", "primaryAction"] as const;
export const PROBE_CARD_OPTIONAL = ["facts", "badge"] as const;

const BADGE_TONES: Readonly<Record<ProbeTone, StatusTone>> = { positive: "success", neutral: "neutral", caution: "warning" };

const PROBE_CARD_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    component: { const: "ProbeCard" },
    title: { type: "string" },
    facts: { type: "array", items: { type: "string" } },
    badge: {
      type: "object",
      properties: {
        label: { type: "string" },
        tone: { enum: ["positive", "neutral", "caution"] },
      },
      required: ["label", "tone"],
      additionalProperties: false,
    },
    primaryActionLabel: { type: "string" },
    primaryAction: { $ref: "common_types.json#/$defs/Action" },
  },
  required: [...PROBE_CARD_REQUIRED],
  additionalProperties: false,
} as const;

export function probeCardHtml(props: ProbeCardProps): string {
  const badge = props.badge === undefined ? "" : statusBadge(props.badge.label, BADGE_TONES[props.badge.tone]);
  const facts = props.facts === undefined || props.facts.length === 0
    ? ""
    : `<ul class="ui-stay-card__facts">${props.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`;
  return `<article class="ui-stay-card"><h2 class="ui-stay-card__title">${escapeHtml(props.title)}</h2>${badge}${facts}<button type="button" class="ui-button ui-button--primary" data-surface-action="primaryAction">${escapeHtml(props.primaryActionLabel)}</button></article>`;
}

export function probeCardText(props: ProbeCardProps): string {
  return [props.title, props.badge?.label, ...(props.facts ?? []), props.primaryActionLabel]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n");
}

export const PROBE_CARD = defineSurfaceComponent<ProbeCardProps>({
  name: "ProbeCard",
  version: "1.0.0",
  tier: 2,
  schema: PROBE_CARD_SCHEMA,
  html: probeCardHtml,
  text: probeCardText,
  fixtures: {
    valid: [
      { id: "probe", component: "ProbeCard", title: "Probe", primaryActionLabel: "Open", primaryAction: { event: { name: "probe_open" } } },
      {
        id: "probe-full",
        component: "ProbeCard",
        title: "Probe full",
        facts: ["One", "Two"],
        badge: { label: "Ready", tone: "positive" },
        primaryActionLabel: "Open",
        primaryAction: { event: { name: "probe_open" } },
      },
    ],
    invalid: [
      { id: "probe", component: "ProbeCard", title: "Probe", primaryActionLabel: "Open", primaryAction: { event: { name: "probe_open" } }, extra: 1 },
      { id: "probe", component: "ProbeCard", primaryActionLabel: "Open", primaryAction: { event: { name: "probe_open" } } },
    ],
  },
});
