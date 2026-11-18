/** JSON value types owned by the library, so it needs no Weaver type (ADR 0081, ADR 0108). */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** Surface Component tiers (ADR 0108 decision 2): 1 platform, 2 shared archetype, 3 domain-only. */
export type SurfaceTier = 1 | 2 | 3;

/** A manifest's choice for one optional property (slot) of a component. */
export type SlotChoice = "required" | "optional" | "absent";

export interface SurfaceComponentInput<TProps> {
  readonly name: string;
  /** `<major>.<minor>.<patch>`. */
  readonly version: string;
  readonly tier: SurfaceTier;
  /** A draft 2020-12 object schema: `additionalProperties: false`, with `component` and `id` properties. */
  readonly schema: JsonObject;
  /** The one kit markup helper shared by the chat and the no-JS page. It must escape every value (ADR 0075). */
  readonly html: (props: TProps) => string;
  /** The complete text fallback, in reading order (ADR 0074). */
  readonly text: (props: TProps) => string;
  readonly fixtures: {
    readonly valid: readonly TProps[];
    readonly invalid: readonly JsonValue[];
  };
}

export interface SurfaceComponentDefinition<TProps = unknown> extends SurfaceComponentInput<TProps> {
  /** Optional properties of the schema (not in `required`, other than `component` and `id`). */
  readonly slots: readonly string[];
  readonly major: number;
}

/**
 * A definition with its props type erased, for manifests and composed catalogues. The props were validated against the
 * component's schema before a renderer calls `html` or `text`, so the adapter narrows them there.
 */
export interface AnySurfaceComponent {
  readonly name: string;
  readonly version: string;
  readonly tier: SurfaceTier;
  readonly schema: JsonObject;
  readonly html: (props: never) => string;
  readonly text: (props: never) => string;
  readonly fixtures: { readonly valid: readonly unknown[]; readonly invalid: readonly JsonValue[] };
  readonly slots: readonly string[];
  readonly major: number;
}

export interface ManifestComponent {
  readonly component: AnySurfaceComponent;
  /** Must equal the component's version major. */
  readonly major: number;
  readonly slots?: Readonly<Record<string, SlotChoice>>;
}

export interface CatalogueManifestInput {
  /** Owner-approved id: `urn:chat-marketplace:<namespace>/<name>/v<major>` (ADR 0073). */
  readonly id: string;
  readonly owner: string;
  readonly base: "basic/v0.9.1";
  /** Aliases in PascalCase, keyed to the component they alias. */
  readonly components: Readonly<Record<string, ManifestComponent>>;
  /** Allow-listed action event names. */
  readonly actions: readonly string[];
}

export type CatalogueManifest = CatalogueManifestInput;

export interface ComposedCatalogue {
  readonly manifest: CatalogueManifest;
  readonly schema: JsonObject;
  readonly components: readonly { readonly alias: string; readonly definition: AnySurfaceComponent }[];
}
