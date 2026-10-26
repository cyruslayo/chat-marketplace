/**
 * The one commerce switch (owner decision; ADR 0104). Commerce is OFF in every deployment unless the operator sets
 * COMMERCE_ENABLED to exactly "true". Unset, empty or exactly "false" is OFF. Any other value throws, so a typo can never
 * switch commerce on silently. The error names the variable and never echoes the rejected value.
 *
 * This is the only parser. It lives in the commerce domain, which the commerce object may import (ADR 0099, ADR 0101);
 * a host reads it from here, so no runtime closure of the commerce object reaches a local app.
 */
export const COMMERCE_ENABLED_VARIABLE = "COMMERCE_ENABLED";

export function commerceEnabledFromEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[COMMERCE_ENABLED_VARIABLE];
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(
    `${COMMERCE_ENABLED_VARIABLE} must be exactly "true" to turn commerce on, or "false" or unset to keep it off (ADR 0104). ` +
      "Commerce is not started with any other value.",
  );
}
