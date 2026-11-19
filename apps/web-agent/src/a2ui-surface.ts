import {
  createA2UIV091Producer,
  type A2UIComponent,
  type CreateSurfaceMessage,
  type UpdateComponentsMessage,
} from "@cylayo/weaver-core";

/**
 * Weaver catalogues issue 02 (ADR 0073, ADR 0081): every A2UI envelope the adapters emit is built by Weaver's
 * version-explicit producer, which validates the A2UI v0.9.1 protocol envelope and returns caller-owned JSON. It throws a
 * `TypeError` on an invalid envelope (for example an empty surface id) rather than emitting a malformed surface. It does
 * not validate catalogue component schemas; `validateShortletMessages` and the runtime do that. Weaver stays in this
 * adapter layer, never in domains or platform-core.
 */
export const A2UI_PRODUCER = createA2UIV091Producer();

/** A surface's opening pair: create it on its catalogue, then set its components. */
export type SurfaceMessages = readonly [CreateSurfaceMessage, UpdateComponentsMessage];

export function surfaceMessages(surfaceId: string, catalogId: string, components: readonly A2UIComponent[]): SurfaceMessages {
  // Weaver 0.3.1's producer still accepts an empty or blank id; a surface with no identity is refused here, fail closed.
  if (surfaceId.trim() === "") throw new TypeError("A2UI surface id must not be empty");
  if (catalogId.trim() === "") throw new TypeError("A2UI catalogue id must not be empty");
  return Object.freeze([
    A2UI_PRODUCER.createSurface({ surfaceId, catalogId }),
    A2UI_PRODUCER.updateComponents({ surfaceId, components }),
  ] as const);
}
