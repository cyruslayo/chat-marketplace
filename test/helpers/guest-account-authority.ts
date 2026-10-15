import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteGuestAccountAuthority, type GuestAccountAuthorityOptions, type GuestAccountSession } from "../../packages/platform-core/src/accounts/authority.js";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import type { SqlDatabase } from "../../packages/platform-core/src/sql-database.js";
import { createPlatformCommandEnvelope } from "../../packages/platform-core/src/envelope.js";

export const TEST_GUEST_CODE_HASHING_KEY = "guest-account-test-key-not-for-production";
export const TEST_GUEST_EMAIL = "guest@example.test";
export const TEST_GUEST_ADDRESS = "192.0.2.10";

const ownedHandles = new WeakMap<SqliteGuestAccountAuthority, SqlDatabase>();

/** Opens a handle over the file and an authority that borrows it, like the real composition does. */
export function openGuestAccountAuthority(databasePath: string, options: GuestAccountAuthorityOptions): SqliteGuestAccountAuthority {
  const database = openNodeSqliteDatabase(databasePath);
  const authority = new SqliteGuestAccountAuthority(database, options);
  ownedHandles.set(authority, database);
  return authority;
}

/** Simulates a process stop: the authority never closes the shared handle itself, so the test closes it. */
export function closeGuestAccountAuthority(authority: SqliteGuestAccountAuthority): void {
  ownedHandles.get(authority)?.close();
  ownedHandles.delete(authority);
}

export function signInGuestAccount(authority: SqliteGuestAccountAuthority, email = TEST_GUEST_EMAIL, tenantId = "tenant-1") {
  const input = { tenantId, email, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS } as const;
  const challenge = authority.requestCode(input);
  return authority.verifyCode({ ...input, challengeId: challenge.challengeId, code: challenge.code });
}

export function guestEmailChange(authority: SqliteGuestAccountAuthority, session: GuestAccountSession, email: string, revision = session.account.revision) {
  const input = {
    tenantId: session.account.tenantId, email, purpose: "change_email", clientAddress: TEST_GUEST_ADDRESS,
    accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret
  } as const;
  const challenge = authority.requestCode({ ...input, expectedRevision: revision });
  const verified = authority.verifyCode({ ...input, challengeId: challenge.challengeId, code: challenge.code });
  const command = createPlatformCommandEnvelope({
    commandName: "guest_account.change_email",
    principal: { id: session.account.accountGuestId, role: "guest", tenantId: session.account.tenantId },
    expectedVersion: revision, payload: { email }
  });
  return { command, proof: verified.proof, sessionSecret: session.sessionSecret };
}

export interface GuestAccountFixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly authority: SqliteGuestAccountAuthority;
  now(): Date;
  advance(milliseconds: number): void;
  close(): Promise<void>;
}

export async function createGuestAccountFixture(): Promise<GuestAccountFixture> {
  const directory = await mkdtemp(join(tmpdir(), "guest-account-authority-"));
  const databasePath = join(directory, "guest.sqlite");
  let currentTime = new Date("2026-10-04T10:00:00.000Z");
  const authority = openGuestAccountAuthority(databasePath, {
    codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
    clock: () => currentTime
  });
  return {
    directory,
    databasePath,
    get authority() { return authority; },
    now: () => currentTime,
    advance(milliseconds) { currentTime = new Date(currentTime.getTime() + milliseconds); },
    async close() {
      closeGuestAccountAuthority(authority);
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export async function removeGuestAccountFixture(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
