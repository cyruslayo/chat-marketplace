/**
 * Runs `run` with the given process environment overrides, then restores every touched variable. An override of
 * `undefined` removes the variable for the duration of the run. Shared by the commerce switch tests (ADR 0104).
 */
export async function withProcessEnv<T>(overrides: Readonly<Record<string, string | undefined>>, run: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(Object.keys(overrides).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** The payment reference key pair and the test-only opt-in, all unset. A synthetic value is never a real secret (ADR 0075). */
export const COMMERCE_KEYS_UNSET = {
  COMMERCE_REFERENCE_HMAC_KEY: undefined,
  COMMERCE_REFERENCE_HMAC_KEY_ID: undefined,
  COMMERCE_REFERENCE_TEST_KEY: undefined,
} as const;

/** A synthetic key pair for switch-ON tests. Not a credential. */
export const COMMERCE_SYNTHETIC_KEYS = {
  COMMERCE_REFERENCE_HMAC_KEY: "synthetic-switch-test-reference-key-value-0001",
  COMMERCE_REFERENCE_HMAC_KEY_ID: "switch-test-k1",
} as const;
