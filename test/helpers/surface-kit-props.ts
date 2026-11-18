import assert from "node:assert/strict";
import type { JsonObject } from "../../packages/surface-kit/src/index.js";

type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;

/**
 * Keeps a component's hand-written `Props` interface equal to its schema (PRD "Props type"; no generator dependency).
 *
 * The type parameter is the interface. The `required` and `optional` lists must name every required and optional key
 * of it: leaving one out is a compile error, and the run-time check compares the lists to the schema's `properties`
 * and `required`. A test helper only; it is not shipped.
 */
export function assertPropsMatchSchema<TProps, R extends RequiredKeys<TProps> & string, O extends OptionalKeys<TProps> & string>(
  schema: JsonObject,
  keys: { readonly required: readonly R[]; readonly optional: readonly O[] },
  ..._exhaustive: [Exclude<RequiredKeys<TProps>, R>] extends [never]
    ? [Exclude<OptionalKeys<TProps>, O>] extends [never] ? [] : [missingOptionalKeys: Exclude<OptionalKeys<TProps>, O>]
    : [missingRequiredKeys: Exclude<RequiredKeys<TProps>, R>]
): void {
  const properties = schema["properties"] as Record<string, unknown>;
  const required = (schema["required"] as readonly string[] | undefined) ?? [];
  assert.deepEqual([...keys.required].sort(), [...required].sort(), "required keys equal the schema's required list");
  assert.deepEqual(
    [...keys.required, ...keys.optional].sort(),
    Object.keys(properties).sort(),
    "every Props key is a schema property and the reverse",
  );
}
