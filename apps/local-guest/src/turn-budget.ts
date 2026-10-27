/**
 * Concierge turn budgets (ADR 0106 deadlines and configurable engineering settings), shared by the server runtime and the
 * browser client. This module has no imports, so the client bundle takes these numbers without importing server code.
 */

/** Scope stage, total wall-clock budget: a first attempt of 5 s and a retry of at most 3 s (ADR 0106 amendment, 26 Oct 2026). */
export const SCOPE_CLASSIFIER_BUDGET_MS = 8_000;

/** One planner provider request (assistant runtime). */
export const PLANNER_REQUEST_TIMEOUT_MS = 20_000;

/** Planner requests per turn: the tool-round loop of the assistant runtime. */
export const MAX_PLANNER_TOOL_ROUNDS = 4;

/** Provider attempts per planner request: the primary plus the one configured fallback (fallback-model-client.ts). */
export const PLANNER_PROVIDER_ATTEMPTS = 2;

/** The longest a server turn can run: the scope stage, then every planner request on every provider attempt. */
export const SERVER_TURN_MAX_MS = SCOPE_CLASSIFIER_BUDGET_MS + MAX_PLANNER_TOOL_ROUNDS * PLANNER_PROVIDER_ATTEMPTS * PLANNER_REQUEST_TIMEOUT_MS;

/** Allowance for transport, the commit and rendering above the server's longest turn: one further planner request timeout. */
export const CLIENT_TURN_TRANSPORT_MARGIN_MS = PLANNER_REQUEST_TIMEOUT_MS;

/**
 * How long the browser waits for POST /api/turn. The server's commit is never abandoned before it can finish, so
 * when this wait ends the turn is already committed or rejected, and the client checks the thread before it offers Retry.
 */
export const CLIENT_TURN_TIMEOUT_MS = SERVER_TURN_MAX_MS + CLIENT_TURN_TRANSPORT_MARGIN_MS;

/** Wait for the other browser requests (state refresh, committed work), unchanged from the earlier client. */
export const CLIENT_REQUEST_TIMEOUT_MS = 10_000;

/** UX setting: after this long on one turn, the composer says the concierge is still working. A normal turn takes 5 to 8 s. */
export const TURN_STILL_WORKING_AFTER_MS = 10_000;
