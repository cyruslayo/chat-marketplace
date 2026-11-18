import {
  createBasicCatalogRendererRegistrations,
  type BasicResourcePolicy,
  type RendererRegistration,
  type WebComponentRenderInput,
} from "@cylayo/weaver-web";
import type { AnySurfaceComponent, ComposedCatalogue } from "../../../packages/surface-kit/src/index.js";

/**
 * The renderer adapter between the Weaver-free surface-kit and Weaver 0.2.1 (ADR 0108 decision 5, ADR 0081). One of the
 * two modules that pair the library with Weaver. It needs the DOM, so it lives with the guest client, not in
 * `apps/web-agent`.
 */

/** Markup that could run code is never inserted: a kit helper emits none, so any hit means a defect (ADR 0075). */
function carriesExecutableMarkup(content: DocumentFragment): boolean {
  if (content.querySelector("script, iframe, object, embed") !== null) return true;
  for (const element of content.querySelectorAll("*")) {
    for (const attribute of element.getAttributeNames()) {
      if (attribute.toLowerCase().startsWith("on")) return true;
      if (/^\s*javascript:/i.test(element.getAttribute(attribute) ?? "")) return true;
    }
  }
  return false;
}

function renderAlias(definition: AnySurfaceComponent, input: WebComponentRenderInput): Node {
  // The runtime validated these properties against the aliased schema before it called a renderer, so they are the
  // component's props (strict, ADR 0073). The cast is the one place the erased props type is narrowed again.
  const props = input.properties as never;
  const template = input.document.createElement("template");
  template.innerHTML = definition.html(props);
  if (carriesExecutableMarkup(template.content)) {
    const fallback = input.document.createElement("p");
    fallback.textContent = definition.text(props);
    return fallback;
  }
  const root = template.content.firstElementChild;
  if (root === null) return input.document.createTextNode(definition.text(props));
  for (const marked of root.querySelectorAll("[data-surface-action]")) {
    const actionProperty = marked.getAttribute("data-surface-action");
    if (actionProperty === null || actionProperty === "") continue;
    marked.addEventListener("click", () => {
      input.interactions.dispatchAction(actionProperty);
    });
  }
  return root;
}

/**
 * The renderer registrations for one composed catalogue: the Basic renderers under the catalogue id, plus one renderer
 * per alias. An alias renderer is a thin adapter over the component's one kit `html(props)` helper, so the chat and the
 * no-JS page render the same markup.
 */
export function rendererRegistrationsFor(composed: ComposedCatalogue, resourcePolicy: BasicResourcePolicy): RendererRegistration[] {
  const catalogId = composed.manifest.id;
  return [
    ...createBasicCatalogRendererRegistrations({ catalogId, resourcePolicy }),
    ...composed.components.map(({ alias, definition }): RendererRegistration => ({
      catalogId,
      component: alias,
      render: (input) => renderAlias(definition, input),
    })),
  ];
}
