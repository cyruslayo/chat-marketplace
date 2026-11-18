import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  A2UI_V091_BASIC_CATALOG_ID,
  createBasicCatalogV091Registration,
  createWeaverRuntime,
  type A2UIServerMessage,
  type JsonObject as WeaverJsonObject,
} from "@cylayo/weaver-core";
import { RendererRegistry, createBasicWebRuntime, type WebServerEventHandoff } from "@cylayo/weaver-web";
import { Window } from "happy-dom";
import { basicEquivalentCatalogue, composeWeaverCatalogue } from "../apps/web-agent/src/catalogues/weaver-catalogues.js";
import { COMMERCE_DISCOVERY_CATALOG } from "../apps/web-agent/src/commerce-catalogs.js";
import { rendererRegistrationsFor } from "../apps/local-guest/src/catalogue-renderers.js";
import { mountGuestSurfaceOrFallback } from "../apps/local-guest/src/guest-surface-fallback.js";
import { PROBE_ACTION_NAME, PROBE_CATALOGUE_ID, PROBE_MANIFEST } from "./fixtures/surface-kit/probe-manifest.js";
import { PROBE_CARD, probeCardHtml, probeCardText, type ProbeCardProps } from "./fixtures/surface-kit/probe-card.js";

const probe = composeWeaverCatalogue(PROBE_MANIFEST);
const resourcePolicy = () => undefined;

function props(overrides: Partial<ProbeCardProps> = {}): ProbeCardProps {
  return {
    id: "root",
    component: "ProbeCard",
    title: "Probe title",
    facts: ["First fact", "Second fact"],
    primaryActionLabel: "Open probe",
    primaryAction: { event: { name: PROBE_ACTION_NAME } },
    ...overrides,
  };
}

function surface(surfaceId: string, component: string, componentProps: Record<string, unknown>): readonly A2UIServerMessage[] {
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: PROBE_CATALOGUE_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components: [{ ...componentProps, id: "root", component } as never] } },
  ];
}

function probeRuntime(onServerEvent?: (event: WebServerEventHandoff) => void) {
  const created = createBasicWebRuntime({
    additionalCatalogs: [probe.registration],
    additionalRenderers: rendererRegistrationsFor(probe.composed, resourcePolicy),
    ...(onServerEvent === undefined ? {} : { rendering: { onServerEvent } }),
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("runtime creation failed");
  return created.value;
}

function accepted(runtime: ReturnType<typeof probeRuntime>, messages: readonly A2UIServerMessage[]): boolean {
  return messages.every((message) => runtime.runtime.process(message).ok);
}

function mountTarget(): { readonly target: HTMLElement; readonly document: Document } {
  const window = new Window();
  return { target: window.document.createElement("div") as unknown as HTMLElement, document: window.document as unknown as Document };
}

test("AC1 - the probe manifest composes and registers in createWeaverRuntime and createBasicWebRuntime, and RendererRegistry has both aliases and every Basic component", () => {
  const weaver = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration(), probe.registration] });
  assert.equal(weaver.ok, true);
  assert.equal(probe.registration.catalogId, PROBE_CATALOGUE_ID);
  assert.equal(probe.registration.schema["catalogId"], PROBE_CATALOGUE_ID);

  const web = createBasicWebRuntime({
    additionalCatalogs: [probe.registration],
    additionalRenderers: rendererRegistrationsFor(probe.composed, resourcePolicy),
  });
  assert.equal(web.ok, true);

  const registry = new RendererRegistry(rendererRegistrationsFor(probe.composed, resourcePolicy));
  const basicComponents = Object.keys(createBasicCatalogV091Registration().schema["components"] as WeaverJsonObject);
  assert.ok(basicComponents.length > 10);
  for (const component of [...basicComponents, "ProbeStayCard", "ProbeOtherCard"]) {
    assert.equal(registry.has(PROBE_CATALOGUE_ID, component), true, component);
  }
  assert.equal(registry.has(PROBE_CATALOGUE_ID, "ProbeCard"), false, "the un-aliased name has no renderer");
});

test("AC2 - ProbeStayCard accepts a valid message and rejects an absent badge slot, an extra property and the un-aliased name", () => {
  const runtime = probeRuntime();
  const valid = props();
  const { id: _id, component: _component, ...rest } = valid;
  assert.equal(accepted(runtime, surface("probe-valid", "ProbeStayCard", rest)), true, "a valid ProbeStayCard message is accepted");

  assert.equal(accepted(runtime, surface("probe-badge", "ProbeStayCard", { ...rest, badge: { label: "Hot", tone: "positive" } })), false, "badge is absent in ProbeStayCard");
  assert.equal(accepted(runtime, surface("probe-extra", "ProbeStayCard", { ...rest, nightlyKobo: 1 })), false, "an extra property is rejected");
  assert.equal(accepted(runtime, surface("probe-unaliased", "ProbeCard", rest)), false, "the un-aliased name is rejected");
  const { title: _title, ...missingTitle } = rest;
  assert.equal(accepted(runtime, surface("probe-missing", "ProbeStayCard", missingTitle)), false, "a missing required property is rejected");
  assert.equal(accepted(runtime, surface("probe-other-badge", "ProbeOtherCard", { ...rest, badge: { label: "Hot", tone: "positive" } })), true, "ProbeOtherCard keeps the badge slot");
});

test("AC3 - a rendered ProbeOtherCard equals the parsed html(props) output, and a value with <script> and a quote renders as text", () => {
  const runtime = probeRuntime();
  const hostile = props({ title: 'Probe <script>alert("x")</script> "quoted"', facts: ['<img src=x onerror="alert(1)">'], badge: { label: "A & B", tone: "caution" } });
  const { id: _id, component: _component, ...rest } = hostile;
  assert.equal(accepted(runtime, surface("probe-render", "ProbeOtherCard", rest)), true);
  const { target, document } = mountTarget();
  const mounted = runtime.mount({ surfaceId: "probe-render", target: target as unknown as Element });
  assert.equal(mounted.ok, true);

  const template = document.createElement("template");
  template.innerHTML = probeCardHtml(hostile);
  const expected = template.content.firstElementChild!;
  const rendered = target.querySelector("article")!;
  assert.ok(rendered, "the kit article is rendered");
  assert.equal(rendered.outerHTML, expected.outerHTML);
  assert.equal(target.querySelector("script"), null, "no script element");
  assert.equal(target.querySelector("img"), null, "no image element from a value");
  const handlerAttributes = [...target.querySelectorAll("*")].flatMap((element) => element.getAttributeNames()).filter((name) => name.startsWith("on"));
  assert.deepEqual(handlerAttributes, [], "no handler attribute on any element");
  assert.ok((target.textContent ?? "").includes('<script>alert("x")</script> "quoted"'), "the value is visible as text");

  const { target: otherTarget } = mountTarget();
  const executable: ReadonlyArray<string> = ["<script>1</script>", '<p onclick="x()">a</p>', '<a href="javascript:x()">a</a>'];
  for (const [index, markup] of executable.entries()) {
    const badRuntime = createBasicWebRuntime({
      additionalCatalogs: [probe.registration],
      additionalRenderers: rendererRegistrationsFor({
        ...probe.composed,
        components: probe.composed.components.map((entry) => ({ ...entry, definition: { ...entry.definition, html: () => markup } })),
      }, resourcePolicy),
    });
    assert.equal(badRuntime.ok, true);
    if (!badRuntime.ok) return;
    assert.equal(accepted(badRuntime.value as never, surface(`probe-bad-${index}`, "ProbeOtherCard", rest)), true);
    const badTarget = mountTarget().target;
    assert.equal(badRuntime.value.mount({ surfaceId: `probe-bad-${index}`, target: badTarget as unknown as Element }).ok, true);
    assert.equal(badTarget.querySelector("script, [onclick], a[href^='javascript']"), null, `executable markup is dropped: ${markup}`);
    assert.ok((badTarget.textContent ?? "").includes(probeCardText(hostile)), "the text fallback is rendered instead");
  }
  assert.equal(otherTarget.childNodes.length, 0);
});

test("AC4 - clicking the element marked for primaryAction dispatches exactly one server event with the action name from the message", () => {
  const events: WebServerEventHandoff[] = [];
  const runtime = probeRuntime((event) => events.push(event));
  const { id: _id, component: _component, ...rest } = props({ primaryAction: { event: { name: "probe_open", context: { reference: "r1" } } } });
  assert.equal(accepted(runtime, surface("probe-click", "ProbeOtherCard", rest)), true);
  const { target } = mountTarget();
  assert.equal(runtime.mount({ surfaceId: "probe-click", target: target as unknown as Element }).ok, true);
  assert.equal(events.length, 0, "rendering dispatches nothing");
  const marked = target.querySelectorAll("[data-surface-action='primaryAction']");
  assert.equal(marked.length, 1);
  (marked[0] as HTMLElement).click();
  assert.equal(events.length, 1);
  const action = (events[0]!.message as unknown as { action?: { name?: string } }).action;
  assert.equal(action?.name, "probe_open");
});

test("AC5 - a Basic-only stale runtime fails closed to the complete text and the conventional route", () => {
  const stale = createBasicWebRuntime({});
  assert.equal(stale.ok, true);
  if (!stale.ok) return;
  const full = props({ badge: { label: "Ready", tone: "positive" } });
  const { id: _id, component: _component, ...rest } = full;
  const messages = surface("probe-stale", "ProbeOtherCard", rest);
  assert.equal(stale.value.runtime.process(messages[0]!).ok, false, "the stale client refuses the unknown catalogue");
  const { target } = mountTarget();
  const result = mountGuestSurfaceOrFallback({
    attemptMount: () => stale.value.mount({ surfaceId: "probe-stale", target: target as unknown as Element }),
    mount: target,
    surface: {
      surfaceId: "probe-stale",
      mode: "inline-surface",
      status: "active",
      summary: "Probe",
      textFallback: probeCardText(full),
      conventionalRoute: "/conversation",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(target.dataset["renderer"], "fallback");
  for (const part of ["Probe title", "Ready", "First fact", "Second fact", "Open probe"]) {
    assert.ok((target.textContent ?? "").includes(part), `the fallback keeps ${part}`);
  }
  assert.equal(target.querySelector("a")?.getAttribute("href"), "/conversation");
  assert.equal(PROBE_CARD.text(full as never), probeCardText(full), "the fallback text is the definition's text()");
});

test("AC6 - basicEquivalentCatalogue of a commerce registration returns the same schema and no components, and leaves the registration unchanged", async () => {
  const before = JSON.stringify(COMMERCE_DISCOVERY_CATALOG);
  const wrapped = basicEquivalentCatalogue(COMMERCE_DISCOVERY_CATALOG);
  assert.equal(wrapped.manifest.id, COMMERCE_DISCOVERY_CATALOG.catalogId);
  assert.equal(wrapped.manifest.owner, "commerce");
  assert.deepEqual(wrapped.schema, COMMERCE_DISCOVERY_CATALOG.schema);
  assert.deepEqual(wrapped.components, []);
  assert.equal(JSON.stringify(COMMERCE_DISCOVERY_CATALOG), before, "the registration is not modified");
  assert.throws(() => basicEquivalentCatalogue({ catalogId: "https://example.com/other", schema: {} }), /platform namespace/);
  const commerceSource = await readFile(new URL("../apps/web-agent/src/commerce-catalogs.ts", import.meta.url), "utf8");
  assert.ok(!commerceSource.includes("surface-kit"), "commerce-catalogs.ts is untouched by the library (ADR 0104)");
  assert.equal(A2UI_V091_BASIC_CATALOG_ID.length > 0, true);
});
