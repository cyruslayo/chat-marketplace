import { createHash } from "node:crypto";
import type { CheckInSupportManager, AccessStatus } from "../../../domains/shortlet/src/checkin-support.js";
import type { MidStayBlockingComplaintQuery } from "../../../domains/shortlet/src/mid-stay-failure.js";
import type { RevenueReleaseAccessProvider } from "./revenue-release-application.js";

export class RevenueReleaseCheckInAccessAdapter implements RevenueReleaseAccessProvider {
  constructor(private readonly manager: CheckInSupportManager) {}
  getAccess(reservationId: string) {
    const result = this.manager.projectCheckInStatus(reservationId).accessResult;
    const safe = { status: result.status, verifiedAt: result.verifiedAt, protectionWindowStartsAt: result.protectionWindowStartsAt };
    const version = createHash("sha256").update(JSON.stringify(safe)).digest("hex");
    return { version, status: result.status, ...(result.verifiedAt ? { verifiedAt: result.verifiedAt } : {}), ...(result.protectionWindowStartsAt ? { protectionWindowStartsAt: result.protectionWindowStartsAt } : {}) };
  }
}
export class RevenueReleaseBlockingComplaintQuery {
  constructor(private readonly sources: readonly { hasUnresolvedBlockingComplaint(reservationId: string): boolean }[]) {}
  hasUnresolvedBlockingComplaint(reservationId: string): boolean { return this.sources.some((source) => source.hasUnresolvedBlockingComplaint(reservationId)); }
}
export type RevenueReleaseAccessStatus = AccessStatus;
export type { MidStayBlockingComplaintQuery };
