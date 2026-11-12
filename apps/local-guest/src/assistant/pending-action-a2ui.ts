import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@cylayo/weaver-core";
import type { PendingAssistantAction } from "./pending-actions.js";
import { GUEST_EXTENSION_COPY, GUEST_FACT_LABELS, GUEST_GLOSSARY, GUEST_NOTICE_COPY, extensionFactRows, noticeFactRows, type ExtensionFactRow, type NoticeFactRow } from "../../../web-agent/src/guest-content.js";
import { formatMoney } from "../../../web/src/ui-kit.js";

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
/** Issue 18: the Notice to End facts the card shows, the same rows the page shows (ADR 0077). Fails closed without them. */
function noticeCardRows(action: PendingAssistantAction): readonly NoticeFactRow[] {
  const refs = action.authoritativeReferences;
  if (refs.newLastNight === undefined || refs.newCheckOut === undefined || refs.refundKobo === undefined || refs.owedKobo === undefined) {
    throw new Error("A Notice to End card needs its notice facts");
  }
  return noticeFactRows({ newLastNight: refs.newLastNight, newCheckOut: refs.newCheckOut, refundKobo: refs.refundKobo, owedKobo: refs.owedKobo }, formatMoney);
}

/** Monthly-stays issue 09: the extension card's facts, from the references the card was built with (ADR 0060). */
function extensionCardRows(action: PendingAssistantAction): readonly ExtensionFactRow[] {
  const refs = action.authoritativeReferences;
  if (refs.addedNights === undefined || refs.newCheckOut === undefined || refs.addedAmountKobo === undefined || refs.periodDueDate === undefined) {
    throw new Error("An extension card needs its extension facts");
  }
  return extensionFactRows({ addedNights: refs.addedNights, newCheckOut: refs.newCheckOut, addedAmountKobo: refs.addedAmountKobo, periodDueDate: refs.periodDueDate }, formatMoney);
}

export function pendingActionToA2UI({
  action,
  surfaceId,
}: PendingActionToA2UIInput): readonly A2UIServerMessage[] {
  const prefix = `pending-action-${action.id}`;
  const isNotice = action.type === "give_notice";
  const isExtension = action.type === "request_extension";
  const noticeRows = isNotice ? noticeCardRows(action) : [];
  const extensionRows = isExtension ? extensionCardRows(action) : [];
  const title =
    action.type === "request_to_book"
      ? "Confirm Booking Request"
      : action.type === "accept_offer"
        ? "Confirm Offer Acceptance"
        : isNotice
          ? GUEST_NOTICE_COPY.heading
          : isExtension
            ? GUEST_EXTENSION_COPY.heading
            : "Confirm Secure Checkout";
  const confirmLabel = isNotice ? GUEST_NOTICE_COPY.confirm : isExtension ? GUEST_EXTENSION_COPY.confirm : "Confirm";
  const cancelLabel = isNotice ? GUEST_NOTICE_COPY.back : isExtension ? GUEST_EXTENSION_COPY.back : "Cancel";

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
        ...noticeRows.map((row) => `${prefix}-fact-${row.key}`),
        ...extensionRows.map((row) => `${prefix}-fact-${row.key}`),
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
    ...noticeRows.map((row) => ({ id: `${prefix}-fact-${row.key}`, component: "Text" as const, text: `${row.label}: ${row.value}` })),
    ...extensionRows.map((row) => ({ id: `${prefix}-fact-${row.key}`, component: "Text" as const, text: `${row.label}: ${row.value}` })),
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
    { id: `${prefix}-confirm-label`, component: "Text", text: confirmLabel },
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
    { id: `${prefix}-cancel-label`, component: "Text", text: cancelLabel },
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
