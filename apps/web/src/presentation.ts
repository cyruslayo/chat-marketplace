import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingRequestApplication } from "./booking-request-application.js";
import type { BookingRequestArtifact } from "./booking-request-artifact.js";

export function conventionalSearch(query: any, filters: any) {
  return { channel: "web" as const, artifact: query.search(filters) };
}

export function conventionalSearchRoute(filters: Record<string, any> = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return `/stays/search${query ? `?${query}` : ""}`;
}

export function conventionalBookingRequestRoute(requestId: string): string {
  return `/booking-requests/${encodeURIComponent(requestId)}`;
}

export function getConventionalBookingRequestView(
  application: BookingRequestApplication,
  requestId: string,
  principal: CommandPrincipal,
): { readonly route: string; readonly artifact: BookingRequestArtifact } {
  return Object.freeze({
    route: conventionalBookingRequestRoute(requestId),
    artifact: application.getArtifact(requestId, principal),
  });
}
