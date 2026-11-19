import type { A2UIServerMessage } from "@cylayo/weaver-core";

/** A component as it appears in an updateComponents message: its id, its type name and its props. */
export type RenderedComponent = { readonly id: string; readonly component: string; readonly [prop: string]: unknown };

/** Every component the server messages put on the surface, in emission order. */
export function surfaceComponents(messages: readonly A2UIServerMessage[]): readonly RenderedComponent[] {
  return messages.flatMap((message) => ("updateComponents" in message ? (message.updateComponents.components as unknown as RenderedComponent[]) : []));
}

/** The catalogue id the surface was created on, or undefined when no createSurface message exists. */
export function surfaceCatalogId(messages: readonly A2UIServerMessage[]): string | undefined {
  const created = messages.find((message) => "createSurface" in message);
  return created && "createSurface" in created ? created.createSurface.catalogId : undefined;
}

/** Every typed component of one catalogue type (for example "StayTicket"), in emission order. */
export function typedComponents(messages: readonly A2UIServerMessage[], type: string): readonly RenderedComponent[] {
  return surfaceComponents(messages).filter((component) => component.component === type);
}

/** The single typed component of one catalogue type. Fails the calling test when there is not exactly one. */
export function typedComponent(messages: readonly A2UIServerMessage[], type: string): RenderedComponent {
  const found = typedComponents(messages, type);
  if (found.length !== 1) throw new Error(`expected exactly one ${type}, found ${found.length}`);
  return found[0]!;
}

/** One end of a StayTicket: the day of the month, the formatted date and the machine-readable datetime. */
export interface TicketDateProps {
  readonly day: string;
  readonly date: string;
  readonly datetime?: string;
}

/** The props of the typed StayTicket (apps/web-agent booking-presentation `TicketParts`). */
export interface StayTicketProps {
  readonly id: string;
  readonly title: string;
  readonly checkIn: TicketDateProps;
  readonly checkOut: TicketDateProps;
  readonly foot: string;
}

/** The props of the typed PriceBreakdown (apps/web-agent booking-presentation `BreakdownParts`), money already formatted. */
export interface PriceBreakdownProps {
  readonly id: string;
  readonly condition?: string;
  readonly total?: string;
  readonly totalLabel?: string;
  readonly deposit?: string;
  readonly depositCollected?: boolean;
  readonly due?: string;
  readonly thisPayment?: string;
  readonly paid?: string;
  readonly next?: string;
}

/** The surface's single StayTicket, with its props typed. */
export function stayTicket(messages: readonly A2UIServerMessage[]): StayTicketProps {
  return typedComponent(messages, "StayTicket") as unknown as StayTicketProps;
}

/** The surface's single PriceBreakdown, with its props typed. */
export function priceBreakdown(messages: readonly A2UIServerMessage[]): PriceBreakdownProps {
  return typedComponent(messages, "PriceBreakdown") as unknown as PriceBreakdownProps;
}

/** The component type of each child of the surface's root Column, in display order. */
export function rootChildTypes(messages: readonly A2UIServerMessage[]): readonly string[] {
  const components = surfaceComponents(messages);
  const root = components.find((component) => component.component === "Column" && Array.isArray(component.children));
  const children = (root?.children ?? []) as readonly string[];
  return children.map((id) => components.find((component) => component.id === id)?.component ?? "missing");
}
