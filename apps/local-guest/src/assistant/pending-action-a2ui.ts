import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@cylayo/weaver-core";
import type { PendingAssistantAction } from "./pending-actions.js";
import { formatMoney } from "../../../web/src/ui-kit.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY } from "../../../web-agent/src/guest-content.js";

export const ASSISTANT_CONFIRM_ACTION_EVENT = "shortlet.assistant.confirm-action";
export const ASSISTANT_CANCEL_ACTION_EVENT = "shortlet.assistant.cancel-action";

/** The surface id a confirmation card is filed under for one open action (ADR 0074: the id a cold restore re-keys). */
export function pendingActionSurfaceId(threadId: string, actionId: string): string {
  return `thread-${threadId}:pending-action:${actionId}`;
}

export interface PendingActionToA2UIInput {
  readonly action: PendingAssistantAction;
  readonly surfaceId: string;
}

/**
 * Creates an authoritative A2UI confirmation surface for a pending consequential action.
 * The model NEVER generates this A2UI directly (ADR-0081).
 */
export function pendingActionToA2UI({
  action,
  surfaceId,
}: PendingActionToA2UIInput): readonly A2UIServerMessage[] {
  const prefix = `pending-action-${action.id}`;
  const title =
    action.type === "request_to_book"
      ? "Confirm Booking Request"
      : action.type === "accept_offer"
        ? "Confirm Offer Acceptance"
        : "Confirm Secure Checkout";

  const components: A2UIComponent[] = [
    {
      id: "root",
      component: "Column",
      children: [
        `${prefix}-card`,
      ],
    },
    {
      id: `${prefix}-card`,
      component: "Card",
      child: `${prefix}-content`,
    },
    {
      id: `${prefix}-content`,
      component: "Column",
      children: [
        `${prefix}-title`,
        `${prefix}-summary`,
        ...(action.authoritativeReferences.stayTotalKobo !== undefined
          ? [`${prefix}-total`]
          : []),
        ...(action.authoritativeReferences.refundableDepositKobo !== undefined
          ? [`${prefix}-deposit`]
          : []),
        `${prefix}-divider`,
        `${prefix}-buttons`,
      ],
    },
    { id: `${prefix}-title`, component: "Text", text: title, variant: "h3" },
    { id: `${prefix}-summary`, component: "Text", text: action.summary },
    ...(action.authoritativeReferences.stayTotalKobo !== undefined
      ? [
          {
            id: `${prefix}-total`,
            component: "Text" as const,
            text: `${GUEST_FACT_LABELS.allInStayTotal}: ${formatMoney(action.authoritativeReferences.stayTotalKobo)}`,
          },
        ]
      : []),
    ...(action.authoritativeReferences.refundableDepositKobo !== undefined
      ? [
          {
            id: `${prefix}-deposit`,
            component: "Text" as const,
            text: `${GUEST_GLOSSARY.refundableSecurityDeposit}: ${formatMoney(action.authoritativeReferences.refundableDepositKobo)}`,
          },
        ]
      : []),
    { id: `${prefix}-divider`, component: "Divider", axis: "horizontal" },
    {
      id: `${prefix}-buttons`,
      component: "Row",
      children: [`${prefix}-confirm-button`, `${prefix}-cancel-button`],
    },
    {
      id: `${prefix}-confirm-button`,
      component: "Button",
      child: `${prefix}-confirm-label`,
      variant: "primary",
      action: {
        event: {
          name: ASSISTANT_CONFIRM_ACTION_EVENT,
          context: { actionId: action.id, threadId: action.threadId, surfaceId },
        },
      },
      accessibility: { label: `Confirm: ${title}` },
    },
    { id: `${prefix}-confirm-label`, component: "Text", text: "Confirm" },
    {
      id: `${prefix}-cancel-button`,
      component: "Button",
      child: `${prefix}-cancel-label`,
      action: {
        event: {
          name: ASSISTANT_CANCEL_ACTION_EVENT,
          context: { actionId: action.id, threadId: action.threadId, surfaceId },
        },
      },
      accessibility: { label: `Cancel: ${title}` },
    },
    { id: `${prefix}-cancel-label`, component: "Text", text: "Cancel" },
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
