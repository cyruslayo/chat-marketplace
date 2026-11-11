import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { accessibleNameFor, applyAccessibilityLabels, labelledControls } from "../apps/local-guest/src/a2ui-accessibility.js";

// Issue 13 (ADR 0074, 0078, 0081; guideline §6 item 10, §12): the browser applies A2UI accessibility labels and keeps
// the visible label inside the accessible name (WCAG 2.5.3).

const messages = [{
  version: "v0.9.1",
  updateComponents: {
    surfaceId: "thread-g-1:discovery:focused",
    components: [
      { id: "view-label", component: "Text", text: "View apartment" },
      { id: "view", component: "Button", child: "view-label", accessibility: { label: "View Luxury 2-Bedroom Apartment" } },
      { id: "compare-label", component: "Text", text: "Compare" },
      { id: "compare", component: "Button", child: "compare-label", accessibility: { label: "Compare: Luxury 2-Bedroom Apartment" } },
      { id: "previous-label", component: "Text", text: "Previous" },
      { id: "previous", component: "Button", child: "previous-label" },
    ],
  },
}];

test("AC2: A component without an accessibility label keeps its visible-text name", () => {
  const controls = labelledControls(messages);
  assert.deepEqual(controls.map((control) => control.visibleText), ["View apartment", "Compare"]);
  assert.equal(controls.some((control) => control.visibleText === "Previous"), false);
  // Failure path: a Button with no resolvable visible child is not labelled from guesswork.
  assert.deepEqual(labelledControls([{ updateComponents: { components: [{ id: "orphan", component: "Button", accessibility: { label: "Orphan" } }] } }]), []);

  const window = new Window();
  const mount = window.document.createElement("div");
  mount.innerHTML = '<button data-a2ui-component="Button">View apartment</button><button data-a2ui-component="Button">Previous</button>';
  applyAccessibilityLabels(mount, messages);
  const [view, previous] = [...mount.querySelectorAll("button")];
  assert.equal(view?.getAttribute("aria-label"), "View apartment: View Luxury 2-Bedroom Apartment");
  assert.equal(previous?.getAttribute("aria-label"), null, "the unlabelled button keeps its visible-text name");
});

test("AC3: The visible label text is contained in the accessible name for every labelled control", () => {
  for (const control of labelledControls(messages)) {
    assert.ok(control.name.toLocaleLowerCase().includes(control.visibleText.toLocaleLowerCase()), `${control.name} contains ${control.visibleText}`);
  }
  assert.equal(accessibleNameFor("View apartment", "View Luxury 2-Bedroom Apartment"), "View apartment: View Luxury 2-Bedroom Apartment");
  // Failure path: a label that already contains the visible text is not repeated.
  assert.equal(accessibleNameFor("Compare", "Compare: Luxury 2-Bedroom Apartment"), "Compare: Luxury 2-Bedroom Apartment");
});
