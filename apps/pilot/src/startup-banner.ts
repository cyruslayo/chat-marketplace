import { conciergeStartupFields, type ConciergeConfiguration } from "../../local-guest/src/assistant/concierge-configuration.js";

/** The back-office entry point: owners never sign in, so this is where you start (ADR 0086). */
export const OPERATOR_LOGIN_PATH = "/operator/login";

/** Startup lines for `npm run pilot:local`. */
export function localPilotStartupLines(input: { readonly port: number; readonly dataDirectory: string }): readonly string[] {
  const origin = `http://127.0.0.1:${input.port}`;
  return [
    "Local Shortlet pilot started",
    `\nGuest:\n${origin}/`,
    `\nOperator sign-in:\n${origin}${OPERATOR_LOGIN_PATH}`,
    `\nHealth:\n${origin}/healthz`,
    `\nData:\n${input.dataDirectory}`,
  ];
}

/** Startup lines for the production pilot. Secrets and keys never appear here (ADR 0075). */
export function productionPilotStartupLines(input: { readonly publicOrigin: string; readonly paystackEnvironment: string; readonly port: number; readonly concierge?: ConciergeConfiguration }): readonly string[] {
  return [
    "Shortlet pilot initialized",
    "environment=production",
    `publicOrigin=${input.publicOrigin}`,
    `paystackEnvironment=${input.paystackEnvironment}`,
    ...(input.concierge ? conciergeStartupFields(input.concierge) : []),
    "status=ready",
    "health=/healthz",
    `operatorLogin=${new URL(OPERATOR_LOGIN_PATH, input.publicOrigin).href}`,
    `listeningPort=${input.port}`,
  ];
}
