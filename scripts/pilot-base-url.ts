import { assertHttpsOrLoopbackUrl } from "../packages/platform-core/src/https-url-guard.js";

/**
 * Slice 15: an operator-chosen pilot origin (for example a Cloudflare staging URL) given by `--base-url <url>`,
 * `--base-url=<url>` or `SHORTLET_BASE_URL`. When neither is set the caller keeps its local behaviour and this
 * returns null. Anything else is validated fail-closed: https (or localhost http), an origin only (no credentials,
 * query, fragment or path), and a flag and environment value that agree. Errors never echo the value.
 */
export interface PilotBaseUrl {
  readonly origin: string;
  readonly remote: true;
}

const FLAG = "--base-url";

function flagValue(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === FLAG) {
      const next = argv[index + 1];
      if (next === undefined || next.trim() === "" || next.startsWith("--")) {
        throw new Error(`${FLAG} requires a value`);
      }
      return next.trim();
    }
    if (argument.startsWith(`${FLAG}=`)) {
      const value = argument.slice(FLAG.length + 1).trim();
      if (value === "") throw new Error(`${FLAG} requires a value`);
      return value;
    }
  }
  return null;
}

function validatedOrigin(value: string): string {
  const parsed = assertHttpsOrLoopbackUrl(value, "Base URL");
  if (parsed.username !== "" || parsed.password !== "") throw new Error("Base URL must not contain credentials");
  if (parsed.search !== "") throw new Error("Base URL must not include a query");
  if (parsed.hash !== "") throw new Error("Base URL must not include a fragment");
  if (parsed.pathname !== "/") throw new Error("Base URL must not include a path");
  return parsed.origin;
}

export function resolvePilotBaseUrl(argv: readonly string[], env: NodeJS.ProcessEnv): PilotBaseUrl | null {
  const fromFlag = flagValue(argv);
  const fromEnvironment = env.SHORTLET_BASE_URL?.trim() ?? "";
  if (fromFlag === null && fromEnvironment === "") return null;
  if (fromFlag !== null && fromEnvironment !== "" && validatedOrigin(fromFlag) !== validatedOrigin(fromEnvironment)) {
    throw new Error(`${FLAG} and SHORTLET_BASE_URL disagree; set one of them`);
  }
  return { origin: validatedOrigin(fromFlag ?? fromEnvironment), remote: true };
}
