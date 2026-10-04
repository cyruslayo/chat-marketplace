import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteGuestAccountAuthority } from "../../domains/shortlet/src/guest-account-authority.js";

export const TEST_GUEST_CODE_HASHING_KEY = "guest-account-test-key-not-for-production";
export const TEST_GUEST_EMAIL = "guest@example.test";
export const TEST_GUEST_ADDRESS = "192.0.2.10";

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
  const createAuthority = () => new SqliteGuestAccountAuthority(databasePath, {
    codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
    clock: () => currentTime
  });
  let authority = createAuthority();
  return {
    directory,
    databasePath,
    get authority() { return authority; },
    now: () => currentTime,
    advance(milliseconds) { currentTime = new Date(currentTime.getTime() + milliseconds); },
    async close() {
      authority.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export async function removeGuestAccountFixture(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
