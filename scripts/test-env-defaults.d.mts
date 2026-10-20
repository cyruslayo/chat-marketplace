export const TEST_ENV_DEFAULTS: Readonly<Record<string, string>>;
export function applyTestEnvDefaults(env: Record<string, string | undefined>, defaults?: Readonly<Record<string, string>>): string[];
