/**
 * Issue 13 (ADR 0074, 0078, 0081; guideline §6 item 10, §12): the browser applies the A2UI `accessibility.label`
 * metadata that Weaver 0.2.1 ignores. The visible label always stays part of the accessible name (WCAG 2.5.3).
 */

interface A2UIComponentLike {
  readonly id: string;
  readonly component: string;
  readonly child?: string;
  readonly text?: string;
  readonly accessibility?: { readonly label?: unknown };
}

export interface LabelledControl {
  /** The visible text of the button's child Text. */
  readonly visibleText: string;
  /** The server's accessibility label. */
  readonly accessibleLabel: string;
  /** The name to set on the rendered control: the label when it contains the visible text, otherwise both. */
  readonly name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The accessible name, with the visible label kept inside it (WCAG 2.5.3, label in name). */
export function accessibleNameFor(visibleText: string, label: string): string {
  return label.toLocaleLowerCase().includes(visibleText.toLocaleLowerCase()) ? label : `${visibleText}: ${label}`;
}

/** Every Button in the surface messages that carries an accessibility label, with its visible text resolved. */
export function labelledControls(messages: readonly unknown[]): LabelledControl[] {
  const components = new Map<string, A2UIComponentLike>();
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.updateComponents)) continue;
    const list = message.updateComponents.components;
    if (!Array.isArray(list)) continue;
    for (const component of list) {
      if (!isRecord(component) || typeof component.id !== "string" || typeof component.component !== "string") continue;
      components.set(component.id, component as unknown as A2UIComponentLike);
    }
  }
  const controls: LabelledControl[] = [];
  for (const component of components.values()) {
    if (component.component !== "Button") continue;
    const label = component.accessibility?.label;
    if (typeof label !== "string" || label.trim() === "") continue;
    const visibleText = component.child === undefined ? undefined : components.get(component.child)?.text;
    if (typeof visibleText !== "string" || visibleText.trim() === "") continue;
    const visible = visibleText.trim();
    const accessible = label.trim();
    controls.push({ visibleText: visible, accessibleLabel: accessible, name: accessibleNameFor(visible, accessible) });
  }
  return controls;
}

/** Sets `aria-label` on the rendered buttons in component order; a button without a label keeps its visible-text name. */
export function applyAccessibilityLabels(mount: { querySelectorAll(selectors: string): ArrayLike<HTMLButtonElement> }, messages: readonly unknown[]): void {
  const controls = labelledControls(messages);
  if (controls.length === 0) return;
  const buttons = Array.from(mount.querySelectorAll('button[data-a2ui-component="Button"]'));
  const used = new Set<HTMLButtonElement>();
  for (const control of controls) {
    const button = buttons.find((candidate) => !used.has(candidate) && candidate.textContent?.trim() === control.visibleText);
    if (!button) continue;
    used.add(button);
    button.setAttribute("aria-label", control.name);
  }
}
