import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOKING_STATE_SCHEMA,
  GuestIdentityResolver,
  SqliteGuestAccountAuthority,
  SqliteGuestAccountLinks,
  SqliteGuestInteractionStore,
  type DurableBookingRequest,
  type DurableBookingSnapshot,
  type DurableConditionalOffer,
  type DurableGuestThreadRecord,
  type GuestAccountSession,
} from "../../domains/shortlet/src/index.js";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import type { SqlDatabase } from "../../packages/platform-core/src/sql-database.js";
import { signInGuestAccount, TEST_GUEST_CODE_HASHING_KEY } from "./guest-account-authority.js";

export const LINKING_TENANT = "tenant-1";

/**
 * One shared database file, opened once, with the authority, the interaction store, the linking store and the resolver
 * all borrowing it, the way the real composition does (ADR 0004, ADR 0095).
 */
export interface GuestLinkingFixture {
  readonly database: SqlDatabase;
  readonly authority: SqliteGuestAccountAuthority;
  readonly store: SqliteGuestInteractionStore;
  readonly links: SqliteGuestAccountLinks;
  readonly resolver: GuestIdentityResolver;
  /** Signs a device in with an email and links the device's principal to the account, as sign-in does (issue 06). */
  signInDevice(principalId: string, email: string): GuestAccountSession;
  /** Records a Booking Request with its authoritative contact snapshot, as disclosure does. */
  saveRequest(input: { requestId: string; primaryGuestId: string; contactEmail: string | null; tenantId?: string }): DurableBookingRequest;
  /** A thread owned by a principal, with the given projection text. */
  saveThread(input: { threadId: string; principalId: string; threadJson?: string; tenantId?: string }): DurableGuestThreadRecord;
  /** A conditional offer and a booking snapshot that follow a request, so lineage can be walked from a booking. */
  saveBooking(input: { requestId: string; offerId: string; reservationId: string; contractId: string; tenantId?: string }): void;
  close(): Promise<void>;
}

export async function createGuestLinkingFixture(): Promise<GuestLinkingFixture> {
  const directory = await mkdtemp(join(tmpdir(), "guest-account-linking-"));
  const database = openNodeSqliteDatabase(join(directory, "guest.sqlite"));
  let currentTime = new Date("2026-10-10T09:00:00.000Z");
  const clock = () => currentTime;
  const authority = new SqliteGuestAccountAuthority(database, { codeHashingKey: TEST_GUEST_CODE_HASHING_KEY, clock });
  const store = new SqliteGuestInteractionStore(database);
  database.exec(BOOKING_STATE_SCHEMA);
  const links = new SqliteGuestAccountLinks(database, { requests: store, clock });
  const resolver = new GuestIdentityResolver(authority, links);
  return {
    database,
    authority,
    store,
    links,
    resolver,
    signInDevice(principalId, email) {
      const session = signInGuestAccount(authority, email, LINKING_TENANT);
      links.linkSignedInPrincipal({ principalId, tenantId: LINKING_TENANT, accountGuestId: session.account.accountGuestId, email });
      // The per-email code-request cooldown is 60 seconds (ADR 0093), so each device signs in a minute later.
      currentTime = new Date(currentTime.getTime() + 61_000);
      return session;
    },
    saveRequest({ requestId, primaryGuestId, contactEmail, tenantId = LINKING_TENANT }) {
      const request: DurableBookingRequest = {
        requestId,
        draftId: `draft-${requestId}`,
        unitId: "unit-ikoyi-1",
        tenantId,
        operatorId: "operator-1",
        primaryGuestId,
        primaryGuestName: "Test Guest",
        occupants: [],
        checkIn: "2026-11-01",
        checkOut: "2026-11-04",
        nights: 3,
        quoteJson: "{}",
        inventoryCommitmentId: `commitment-${requestId}`,
        disclosedAt: "2026-10-01T10:00:00.000Z",
        deliveryDeadlineAt: "2026-10-01T10:05:00.000Z",
        operatorResponseDeadlineAt: "2026-10-01T10:30:00.000Z",
        delivered: true,
        deliveredAt: "2026-10-01T10:00:00.000Z",
        status: "disclosed",
        confirmedAt: null,
        declinedAt: null,
        declineReason: null,
        phoneNumber: "+2348000000000",
        contactEmailSnapshot: contactEmail,
      };
      store.saveBookingRequest(request);
      return request;
    },
    saveThread({ threadId, principalId, threadJson = "{}", tenantId = LINKING_TENANT }) {
      const thread: DurableGuestThreadRecord = { threadId, principalId, tenantId, threadJson };
      store.saveThread(thread);
      return thread;
    },
    saveBooking({ requestId, offerId, reservationId, contractId, tenantId = LINKING_TENANT }) {
      const offer: DurableConditionalOffer = {
        offerId,
        requestId,
        inventoryCommitmentId: `commitment-${requestId}`,
        unitId: "unit-ikoyi-1",
        tenantId,
        offerJson: "{}",
        status: "accepted",
        issuedAt: "2026-10-02T10:00:00.000Z",
        acceptedAt: "2026-10-02T11:00:00.000Z",
        tokenUsed: true,
        offerVersion: 1,
      };
      store.saveConditionalOffer(offer);
      const snapshot: DurableBookingSnapshot = {
        reservationId,
        contractId,
        offerId,
        reservationJson: "{}",
        contractJson: "{}",
        confirmedAt: "2026-10-02T11:05:00.000Z",
      };
      store.saveBookingSnapshot(snapshot);
    },
    async close() {
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Every row of the four tables that linking must never rewrite (AC3), in rowid order. */
export function linkedTableRows(database: SqlDatabase): Record<string, readonly unknown[]> {
  const tables = ["guest_booking_requests", "booking_contracts", "booking_reservations", "guest_booking_snapshots"];
  return Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
