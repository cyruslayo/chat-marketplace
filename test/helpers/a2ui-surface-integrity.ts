import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@cylayo/weaver-core";

type ReferencingComponent = { readonly id: string; readonly children?: readonly string[]; readonly child?: string; readonly action?: { readonly event: { readonly context: Record<string, unknown> } } };

function updateComponentsOf(messages: readonly unknown[], label: string): readonly ReferencingComponent[] {
  const update = messages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => typeof message === "object" && message !== null && "updateComponents" in message);
  assert.ok(update, `${label}: surface has updateComponents`);
  return update.updateComponents.components as readonly ReferencingComponent[];
}

/**
 * Asserts an A2UI surface is internally consistent before Weaver mounts it: component IDs are unique,
 * exactly one `root` exists and is never a child, and every `children`/`child` reference resolves to an emitted component.
 */
export function assertSurfaceReferencesResolve(messages: readonly unknown[], label: string): void {
  const components = updateComponentsOf(messages, label);
  const ids = components.map((component) => component.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: component ids are unique`);
  assert.equal(ids.filter((id) => id === "root").length, 1, `${label}: exactly one root component`);
  const references = components.flatMap(component => [...(component.children ?? []), ...(component.child === undefined ? [] : [component.child])]);
  assert.equal(references.includes("root"), false, `${label}: no component may reference root as a child`);
  for (const component of components) {
    const own = [...(component.children ?? []), ...(component.child === undefined ? [] : [component.child])];
    for (const reference of own) assert.ok(ids.includes(reference), `${label}: ${component.id} references missing component ${reference}`);
  }
  // Each non-root component has exactly one parent: an unreferenced component is orphaned, and a doubly referenced one renders twice.
  for (const id of ids) {
    if (id === "root") continue;
    assert.equal(references.filter(reference => reference === id).length, 1, `${label}: ${id} must be referenced by exactly one parent`);
  }
}

/** The exact context the rendered checkout Confirm button sends (ADR 0072 command input), read from the surface itself. */
export function checkoutConfirmContext(messages: readonly unknown[]): Record<string, unknown> {
  const context = updateComponentsOf(messages, "checkout").find(component => component.id === "checkout-confirm")?.action?.event.context;
  assert.ok(context, "checkout surface exposes a confirm action context");
  return context;
}
