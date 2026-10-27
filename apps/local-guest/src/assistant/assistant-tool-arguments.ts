import type { AssistantToolParameterProperty, AssistantToolParametersSchema } from "./assistant-model.js";

/**
 * Validates model-supplied tool arguments against the declared `AssistantToolParametersSchema` subset
 * before any task, pack or command path sees them (ADR 0075: model output is untrusted; ADR 0072 and
 * ADR 0106: a tool call must match its exact offered schema). No schema library: the subset is small
 * and adding a dependency is an owner decision.
 *
 * A violation names a schema-declared path and a closed reason. It never carries the rejected value,
 * so the error text sent back to the model and any diagnostic stay free of argument content.
 */

export type AssistantArgumentViolationReason = "missing" | "type" | "range" | "length" | "enum" | "unknown";

export interface AssistantArgumentViolation {
  /** Schema path such as "nights" or "stayRefs[0]", or "arguments" for the root. Never a model-supplied value. */
  readonly field: string;
  readonly reason: AssistantArgumentViolationReason;
}

interface ObjectSchema {
  readonly properties?: Readonly<Record<string, AssistantToolParameterProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

const ROOT_FIELD = "arguments";

/** Returns the first violation of `args` against `schema`, or undefined when every argument conforms. */
export function findToolArgumentViolation(schema: AssistantToolParametersSchema, args: unknown): AssistantArgumentViolation | undefined {
  return checkObject(schema, args, "");
}

/** Guest-safe, value-free message for the model. It names the field and the rule, never the value. */
export function toolArgumentFailureMessage(violation: AssistantArgumentViolation): string {
  switch (violation.reason) {
    case "missing": return `Required argument "${violation.field}" is missing.`;
    case "type": return `Argument "${violation.field}" does not match its declared type.`;
    case "range": return `Argument "${violation.field}" is outside its allowed range.`;
    case "length": return `Argument "${violation.field}" is outside its allowed length or item count.`;
    case "enum": return `Argument "${violation.field}" is not an allowed value.`;
    case "unknown": return violation.field === ROOT_FIELD
      ? "An undeclared argument is not allowed."
      : `An undeclared argument is not allowed inside "${violation.field}".`;
  }
}

function checkObject(schema: ObjectSchema, value: unknown, path: string): AssistantArgumentViolation | undefined {
  if (!isPlainRecord(value)) return violation(path, "type");
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) return violation(childPath(path, key), "missing");
  }
  if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) {
    return violation(path, "unknown");
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key)) continue;
    const found = checkProperty(propertySchema, value[key], childPath(path, key));
    if (found) return found;
  }
  return undefined;
}

function checkProperty(schema: AssistantToolParameterProperty, value: unknown, path: string): AssistantArgumentViolation | undefined {
  const types = typeof schema.type === "string" ? [schema.type] : schema.type;
  if (!types.some((type) => valueMatchesType(type, value))) return violation(path, "type");
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) return violation(path, "enum");

  if (typeof value === "number") {
    if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) {
      return violation(path, "range");
    }
  }
  if (typeof value === "string") {
    if ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength)) {
      return violation(path, "length");
    }
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    if ((schema.minItems !== undefined && items.length < schema.minItems) || (schema.maxItems !== undefined && items.length > schema.maxItems)) {
      return violation(path, "length");
    }
    if (schema.items) {
      for (let index = 0; index < items.length; index++) {
        const found = checkProperty(schema.items, items[index], `${path}[${index}]`);
        if (found) return found;
      }
    }
  }
  if (isPlainRecord(value) && (schema.properties || schema.required || schema.additionalProperties === false)) {
    return checkObject(schema, value, path);
  }
  return undefined;
}

function violation(path: string, reason: AssistantArgumentViolationReason): AssistantArgumentViolation {
  return { field: path === "" ? ROOT_FIELD : path, reason };
}

function childPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Closed type names from the schema subset. An unlisted type name matches nothing (fail closed). */
function valueMatchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isPlainRecord(value);
    default: return false;
  }
}
