// Environment defaults for `npm test`. The runner sets them on process.env before either phase, so the phase 2 child
// processes inherit them. A variable the caller has already set is never overwritten.
//
// Defaults belong here. The issue 24 branch adds NODE_ENV=test and COMMERCE_REFERENCE_TEST_KEY=allow; main has none today.
export const TEST_ENV_DEFAULTS = Object.freeze({});

/** Sets each default that is unset in `env`; returns the names it set. */
export function applyTestEnvDefaults(env, defaults = TEST_ENV_DEFAULTS) {
  const applied = [];
  for (const [name, value] of Object.entries(defaults)) {
    if (env[name] === undefined) {
      env[name] = value;
      applied.push(name);
    }
  }
  return applied;
}
