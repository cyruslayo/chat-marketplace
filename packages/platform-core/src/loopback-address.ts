/**
 * The development loopback address (IPv4), and the origin the local pilot serves. It lives outside `apps/pilot/src`
 * so the pilot reachable surfaces stay free of proxy-address literals (slice 08c); the value is shown to the
 * operator at startup and bound by the Node wrappers.
 */
export const LOOPBACK_ADDRESS = "127.0.0.1";
