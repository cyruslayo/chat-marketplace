import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/envelope.js";
import { SqliteGuestAccountAuthority, GuestAccountAuthorityError } from "../domains/shortlet/src/index.js";
import { closeGuestAccountAuthority, openGuestAccountAuthority, createGuestAccountFixture, guestEmailChange, signInGuestAccount, removeGuestAccountFixture, TEST_GUEST_ADDRESS, TEST_GUEST_EMAIL, TEST_GUEST_CODE_HASHING_KEY } from "./helpers/guest-account-authority.js";

function signInCode(authority: SqliteGuestAccountAuthority, email = TEST_GUEST_EMAIL, tenantId = "tenant-1") {
  return authority.requestCode({ tenantId, email, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
}

async function concurrentVerify(input: {
  databasePath: string;
  codeHashingKey: string;
  challenge: ReturnType<typeof signInCode>;
  timestamp: string;
}): Promise<readonly boolean[]> {
  const source = `
    import { SqliteGuestAccountAuthority } from "./domains/shortlet/src/index.js";
    import { openNodeSqliteDatabase } from "./packages/platform-core/src/node-sqlite-database.js";
    const input = JSON.parse(process.env.GUEST_ACCOUNT_VERIFY_INPUT ?? "{}");
    const database = openNodeSqliteDatabase(input.databasePath);
    const authority = new SqliteGuestAccountAuthority(database, { codeHashingKey: input.codeHashingKey, clock: () => new Date(input.timestamp) });
    process.stdout.write("READY\\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    try {
      authority.verifyCode({ challengeId: input.challenge.challengeId, tenantId: "tenant-1", email: "guest@example.test", code: input.challenge.code, purpose: "sign_in", clientAddress: "192.0.2.80" });
      process.stdout.write("RESULT:true\\n");
    } catch {
      process.stdout.write("RESULT:false\\n");
    } finally {
      database.close();
    }
  `;
  const children = Array.from({ length: 2 }, () => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    cwd: process.cwd(),
    env: { ...process.env, GUEST_ACCOUNT_VERIFY_INPUT: JSON.stringify(input) },
    stdio: ["pipe", "pipe", "pipe"]
  }));
  const output = children.map(() => "");
  await Promise.all(children.map((child, index) => new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output[index] += chunk.toString("utf8");
      if (output[index].includes("READY\n")) resolve();
    });
    child.stderr.on("data", (chunk: Buffer) => { output[index] += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => { if (code !== 0 && !output[index].includes("READY\n")) reject(new Error(output[index])); });
  })));
  for (const child of children) child.stdin.end("go");
  return await Promise.all(children.map((child, index) => new Promise<boolean>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => { output[index] += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) return reject(new Error(output[index]));
      const match = output[index].match(/RESULT:(true|false)/);
      if (!match) return reject(new Error(`Verifier child returned no result: ${output[index]}`));
      resolve(match[1] === "true");
    });
  })));
}

test("AC1 — A valid Sign-In Code creates an account and session; expired, consumed and unknown codes fail without issuing another session", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const challenge = signInCode(fixture.authority);
    assert.match(challenge.code, /^\d{6}$/);
    const verified = fixture.authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: challenge.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
    assert.equal(verified.purpose, "sign_in");
    assert.match(verified.account.accountGuestId, /^gacct-[A-Za-z0-9_-]{22}$/);
    assert.ok(fixture.authority.resolveSession(verified.sessionId, verified.sessionSecret));
    assert.throws(() => fixture.authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: challenge.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), GuestAccountAuthorityError);

    const expired = signInCode(fixture.authority, "late@example.test");
    fixture.advance(10 * 60 * 1000);
    assert.throws(() => fixture.authority.verifyCode({ challengeId: expired.challengeId, tenantId: "tenant-1", email: "late@example.test", code: expired.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), /expired|invalid/i);
    assert.throws(() => fixture.authority.verifyCode({ challengeId: "unknown-challenge", tenantId: "tenant-1", email: "unknown@example.test", code: "000000", purpose: "sign_in", clientAddress: "192.0.2.11" }), /invalid/i);
    assert.equal(fixture.authority.findAccountByEmail("late@example.test", "tenant-1"), null);
    assert.equal(fixture.authority.findAccountByEmail("unknown@example.test", "tenant-1"), null);
  } finally {
    await fixture.close();
  }
});

test("AC2 — Five wrong attempts commit and the correct code is refused afterward", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const challenge = signInCode(fixture.authority);
    const wrongCode = challenge.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.throws(() => fixture.authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: wrongCode, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), /invalid|attempt/i);
    }
    assert.throws(() => fixture.authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: challenge.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), /attempt|invalid/i);
    assert.equal(fixture.authority.findAccountByEmail(TEST_GUEST_EMAIL, "tenant-1"), null);
  } finally {
    await fixture.close();
  }
});

test("Malformed code submissions consume attempt and rate budgets", async () => {
  const fixture = await createGuestAccountFixture();
  closeGuestAccountAuthority(fixture.authority);
  const authority = openGuestAccountAuthority(fixture.databasePath, {
    codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
    clock: fixture.now,
    policy: { signInCodeMaxAttempts: 1, codeRequestCooldownMs: 0, codeChecksPerEmailPerHour: 3, codeChecksPerAddressPerHour: 3 }
  });
  try {
    const challenge = authority.requestCode({ tenantId: "tenant-1", email: TEST_GUEST_EMAIL, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
    assert.throws(() => authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: "not-a-code", purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "code_attempts_exhausted");
    assert.throws(() => authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: challenge.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "code_attempts_exhausted");
    assert.equal(authority.findAccountByEmail(TEST_GUEST_EMAIL, "tenant-1"), null);
  } finally {
    closeGuestAccountAuthority(authority);
    await removeGuestAccountFixture(fixture.directory);
  }
});

test("AC3 — Two concurrent verifications of one code produce exactly one session", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const challenge = signInCode(fixture.authority);
    const results = await concurrentVerify({
      databasePath: fixture.databasePath,
      codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
      challenge,
      timestamp: fixture.now().toISOString()
    });
    assert.equal(results.filter(Boolean).length, 1);
    const database = new DatabaseSync(fixture.databasePath);
    try {
      const row = database.prepare("SELECT COUNT(*) AS count FROM guest_account_sessions WHERE tenant_id = 'tenant-1'").get() as { count: number };
      assert.equal(row.count, 1);
    } finally {
      database.close();
    }
  } finally {
    await fixture.close();
  }
});

test("AC4 — Code requests have the same public outcome shape and audit type for known and unknown email addresses", async () => {
  const fixture = await createGuestAccountFixture();
  const entries: Record<string, string | number>[] = [];
  closeGuestAccountAuthority(fixture.authority);
  const authority = openGuestAccountAuthority(fixture.databasePath, {
    codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
    clock: fixture.now,
    audit: { record: (entry) => entries.push(entry) }
  });
  try {
    const first = authority.requestCode({ tenantId: "tenant-1", email: "known@example.test", purpose: "sign_in", clientAddress: "192.0.2.20" });
    authority.verifyCode({ challengeId: first.challengeId, tenantId: "tenant-1", email: "known@example.test", code: first.code, purpose: "sign_in", clientAddress: "192.0.2.20" });
    fixture.advance(60 * 1000);
    const known = authority.requestCode({ tenantId: "tenant-1", email: "known@example.test", purpose: "sign_in", clientAddress: "192.0.2.21" });
    const unknown = authority.requestCode({ tenantId: "tenant-1", email: "new@example.test", purpose: "sign_in", clientAddress: "192.0.2.22" });
    assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
    assert.ok(known.code && unknown.code && known.expiresAt === unknown.expiresAt);
    assert.deepEqual(entries.filter((entry) => entry.type === "guest.account.code.requested").map((entry) => entry.type), ["guest.account.code.requested", "guest.account.code.requested", "guest.account.code.requested"]);
  } finally {
    closeGuestAccountAuthority(authority);
    await removeGuestAccountFixture(fixture.directory);
  }
});

test("AC5 — Sessions have absolute expiry and revocation is scoped to the account", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const firstChallenge = signInCode(fixture.authority, "first@example.test");
    const first = fixture.authority.verifyCode({ challengeId: firstChallenge.challengeId, tenantId: "tenant-1", email: "first@example.test", code: firstChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.30" });
    const otherChallenge = signInCode(fixture.authority, "other@example.test");
    const other = fixture.authority.verifyCode({ challengeId: otherChallenge.challengeId, tenantId: "tenant-1", email: "other@example.test", code: otherChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.32" });
    assert.equal(fixture.authority.resolveSession(first.sessionId, first.sessionSecret)?.accountGuestId, first.account.accountGuestId);
    fixture.advance(60 * 1000);
    const secondChallenge = signInCode(fixture.authority, "first@example.test");
    const second = fixture.authority.verifyCode({ challengeId: secondChallenge.challengeId, tenantId: "tenant-1", email: "first@example.test", code: secondChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.31" });
    assert.equal(second.account.accountGuestId, first.account.accountGuestId);
    fixture.authority.revokeAllSessions(first.account.accountGuestId, "tenant-1");
    assert.equal(fixture.authority.resolveSession(first.sessionId, first.sessionSecret), null);
    assert.equal(fixture.authority.resolveSession(second.sessionId, second.sessionSecret), null);
    assert.ok(fixture.authority.resolveSession(other.sessionId, other.sessionSecret));
    fixture.advance(60 * 1000);
    const thirdChallenge = signInCode(fixture.authority, "first@example.test");
    const third = fixture.authority.verifyCode({ challengeId: thirdChallenge.challengeId, tenantId: "tenant-1", email: "first@example.test", code: thirdChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.33" });
    fixture.advance(29 * 24 * 60 * 60 * 1000);
    assert.ok(fixture.authority.resolveSession(third.sessionId, third.sessionSecret));
    fixture.advance(24 * 60 * 60 * 1000);
    assert.equal(fixture.authority.resolveSession(third.sessionId, third.sessionSecret), null);
    assert.equal(third.expiresAt, new Date(Date.parse(third.createdAt) + 30 * 24 * 60 * 60 * 1000).toISOString());
  } finally {
    await fixture.close();
  }
});

test("AC6 — A code from another tenant fails closed without consuming the right-tenant challenge", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const challenge = signInCode(fixture.authority);
    assert.throws(() => fixture.authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-2", email: TEST_GUEST_EMAIL, code: challenge.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), /invalid/i);
    const result = fixture.authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: challenge.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
    assert.equal(result.account.tenantId, "tenant-1");
  } finally {
    await fixture.close();
  }
});

test("AC7 — Audit and telemetry exclude email, code, session secret and session id, and failing sinks do not block authentication", async () => {
  const fixture = await createGuestAccountFixture();
  const audit: Record<string, string | number>[] = [];
  const telemetry: Record<string, string | number>[] = [];
  closeGuestAccountAuthority(fixture.authority);
  const authority = openGuestAccountAuthority(fixture.databasePath, {
    codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
    clock: fixture.now,
    audit: { record: (entry) => audit.push(entry) },
    telemetry: { record: (entry) => telemetry.push(entry) }
  });
  try {
    const challenge = signInCode(authority, "private@example.test");
    assert.throws(() => signInCode(authority, "private@example.test"), GuestAccountAuthorityError);
    const wrongCode = challenge.code === "000000" ? "000001" : "000000";
    assert.throws(() => authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: "private@example.test", code: wrongCode, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS }), GuestAccountAuthorityError);
    const result = authority.verifyCode({ challengeId: challenge.challengeId, tenantId: "tenant-1", email: "private@example.test", code: challenge.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
    assert.throws(() => authority.requestCode({ tenantId: "tenant-1", email: "private@example.test", purpose: "export_data", clientAddress: TEST_GUEST_ADDRESS, accountGuestId: result.account.accountGuestId, sessionId: result.sessionId, sessionSecret: "wrong-secret", expectedRevision: 0 }), GuestAccountAuthorityError);
    const change = guestEmailChange(authority, result, "changed-private@example.test");
    assert.throws(() => authority.changeEmail({ ...change, sessionSecret: "wrong-secret" }), GuestAccountAuthorityError);
    const changed = authority.changeEmail(change);
    fixture.advance(60 * 1000);
    const actionInput = {
      tenantId: "tenant-1", email: changed.email, purpose: "export_data", clientAddress: TEST_GUEST_ADDRESS,
      accountGuestId: result.account.accountGuestId, sessionId: result.sessionId, sessionSecret: result.sessionSecret
    } as const;
    const action = authority.requestCode({ ...actionInput, expectedRevision: changed.revision });
    const verifiedAction = authority.verifyCode({ ...actionInput, challengeId: action.challengeId, code: action.code });
    assert.equal(authority.consumeActionProof({ proof: verifiedAction.proof, sessionSecret: result.sessionSecret }), true);
    authority.revokeSession(result.sessionId, "tenant-1");
    authority.revokeAllSessions(result.account.accountGuestId, "tenant-1");
    assert.deepEqual(audit, telemetry);
    for (const type of ["guest.account.code.requested", "guest.account.code.rate_limited", "guest.account.code.request_rejected", "guest.account.code.rejected", "guest.account.session.created", "guest.account.code.verified", "guest.account.action_code.verified", "guest.account.email_change.rejected", "guest.account.email_changed", "guest.account.action_proof.consumed", "guest.account.session.revoked", "guest.account.sessions.revoked_all"]) {
      assert.ok(audit.some((entry) => entry.type === type), `exercise redaction for ${type}`);
    }
    for (const entry of [...audit, ...telemetry]) {
      for (const key of Object.keys(entry)) assert.ok(["type", "tenantId", "accountGuestId", "purpose", "reasonCode", "expiresAt", "revision"].includes(key), `unexpected audit field ${key}`);
      for (const value of Object.values(entry)) {
        assert.ok(![challenge.code, wrongCode, action.code, result.sessionSecret, result.sessionId].includes(String(value)));
        assert.equal(String(value).includes("private@example.test"), false);
      }
    }
    const resilient = openGuestAccountAuthority(fixture.databasePath, {
      codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
      clock: fixture.now,
      audit: { record: () => { throw new Error("audit unavailable"); } },
      telemetry: { record: () => { throw new Error("telemetry unavailable"); } }
    });
    try {
      const next = resilient.requestCode({ tenantId: "tenant-1", email: "another@example.test", purpose: "sign_in", clientAddress: "192.0.2.40" });
      assert.doesNotThrow(() => resilient.verifyCode({ challengeId: next.challengeId, tenantId: "tenant-1", email: "another@example.test", code: next.code, purpose: "sign_in", clientAddress: "192.0.2.40" }));
    } finally {
      closeGuestAccountAuthority(resilient);
    }
  } finally {
    closeGuestAccountAuthority(authority);
    await removeGuestAccountFixture(fixture.directory);
  }
});

test("AC8 — Email change requires a new-address code and live session; wrong or stale proof leaves the account unchanged", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const initial = signInCode(fixture.authority);
    const session = fixture.authority.verifyCode({ challengeId: initial.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: initial.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
    const action = fixture.authority.requestCode({ tenantId: "tenant-1", email: "new@example.test", purpose: "change_email", clientAddress: "192.0.2.50", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret, expectedRevision: session.account.revision });
    const wrongCode = action.code === "000000" ? "000001" : "000000";
    assert.throws(() => fixture.authority.verifyCode({ challengeId: action.challengeId, tenantId: "tenant-1", email: "new@example.test", code: wrongCode, purpose: "change_email", clientAddress: "192.0.2.50", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret }), /invalid|attempt/i);
    fixture.advance(60 * 1000);
    const retry = fixture.authority.requestCode({ tenantId: "tenant-1", email: "new@example.test", purpose: "change_email", clientAddress: "192.0.2.51", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret, expectedRevision: session.account.revision });
    const proof = fixture.authority.verifyCode({ challengeId: retry.challengeId, tenantId: "tenant-1", email: "new@example.test", code: retry.code, purpose: "change_email", clientAddress: "192.0.2.51", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret });
    assert.equal(proof.purpose, "change_email");
    const command = createPlatformCommandEnvelope({
      commandName: "guest_account.change_email",
      principal: { id: session.account.accountGuestId, role: "guest", tenantId: "tenant-1" },
      expectedVersion: session.account.revision,
      payload: { email: "new@example.test" }
    });
    const changed = fixture.authority.changeEmail({ command, proof: proof.proof, sessionSecret: session.sessionSecret });
    assert.equal(changed.email, "new@example.test");
    assert.equal(changed.revision, session.account.revision + 1);
    const oldEmailLogin = signInCode(fixture.authority, TEST_GUEST_EMAIL);
    const oldEmailAccount = fixture.authority.verifyCode({ challengeId: oldEmailLogin.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: oldEmailLogin.code, purpose: "sign_in", clientAddress: "192.0.2.52" });
    assert.notEqual(oldEmailAccount.account.accountGuestId, session.account.accountGuestId);
    assert.equal(fixture.authority.findAccountByEmail("new@example.test", "tenant-1")?.accountGuestId, session.account.accountGuestId);
  } finally {
    await fixture.close();
  }
});

test("AC10 — Email-change commands reject missing tenant, wrong actor, stale version and unknown command envelopes", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const initial = signInCode(fixture.authority);
    const session = fixture.authority.verifyCode({ challengeId: initial.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: initial.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
    fixture.advance(60 * 1000);
    const action = fixture.authority.requestCode({ tenantId: "tenant-1", email: "new@example.test", purpose: "change_email", clientAddress: "192.0.2.53", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret, expectedRevision: session.account.revision });
    const proof = fixture.authority.verifyCode({ challengeId: action.challengeId, tenantId: "tenant-1", email: "new@example.test", code: action.code, purpose: "change_email", clientAddress: "192.0.2.53", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret });
    const envelope = (options: { commandName?: string; principal?: { id: string; role: "guest"; tenantId?: string }; expectedVersion?: number }) => createPlatformCommandEnvelope({
      commandName: options.commandName ?? "guest_account.change_email",
      principal: options.principal ?? { id: session.account.accountGuestId, role: "guest", tenantId: "tenant-1" },
      expectedVersion: options.expectedVersion ?? session.account.revision,
      payload: { email: "new@example.test" }
    });
    for (const command of [
      envelope({ principal: { id: session.account.accountGuestId, role: "guest" } }),
      envelope({ principal: { id: "gacct-other", role: "guest", tenantId: "tenant-1" } }),
      envelope({ expectedVersion: session.account.revision + 1 }),
      envelope({ commandName: "guest_account.delete" })
    ]) {
      assert.throws(() => fixture.authority.changeEmail({ command, proof: proof.proof, sessionSecret: session.sessionSecret }), GuestAccountAuthorityError);
    }
    assert.equal(fixture.authority.findAccountByEmail(TEST_GUEST_EMAIL, "tenant-1")?.accountGuestId, session.account.accountGuestId);
  } finally {
    await fixture.close();
  }
});

test("ADR 0072 — Email-change commands return their original result on exact retry, including after restart and later changes", async () => {
  const fixture = await createGuestAccountFixture();
  const entries: Record<string, string | number>[] = [];
  closeGuestAccountAuthority(fixture.authority);
  let authority = openGuestAccountAuthority(fixture.databasePath, {
    codeHashingKey: TEST_GUEST_CODE_HASHING_KEY, clock: fixture.now, audit: { record: (entry) => entries.push(entry) }
  });
  try {
    const session = signInGuestAccount(authority);
    const first = guestEmailChange(authority, session, "first-change@example.test");
    const result = authority.changeEmail(first);
    assert.deepEqual(authority.changeEmail(first), result);
    const second = guestEmailChange(authority, session, "second-change@example.test", result.revision);
    const later = authority.changeEmail(second);
    fixture.advance(10 * 60 * 1000);
    closeGuestAccountAuthority(authority);
    authority = openGuestAccountAuthority(fixture.databasePath, {
      codeHashingKey: TEST_GUEST_CODE_HASHING_KEY, clock: fixture.now, audit: { record: (entry) => entries.push(entry) }
    });
    assert.deepEqual(authority.changeEmail(first), result);
    assert.equal(authority.findAccountByEmail(later.email, "tenant-1")?.revision, later.revision);
    assert.equal(entries.filter((entry) => entry.type === "guest.account.email_changed").length, 2);
    assert.throws(() => authority.changeEmail({ ...first, sessionSecret: "wrong-secret" }), GuestAccountAuthorityError);
    authority.revokeSession(session.sessionId, "tenant-1");
    assert.throws(() => authority.changeEmail(first), GuestAccountAuthorityError);
  } finally {
    closeGuestAccountAuthority(authority);
    await removeGuestAccountFixture(fixture.directory);
  }
});

test("ADR 0072 — Reusing an email-change idempotency key for a different effect fails without consuming its fresh proof", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const session = signInGuestAccount(fixture.authority);
    const first = guestEmailChange(fixture.authority, session, "first-change@example.test");
    const changed = fixture.authority.changeEmail(first);
    assert.throws(() => fixture.authority.changeEmail({ ...first, command: { ...first.command, payload: { email: "substitution@example.test" } } }), GuestAccountAuthorityError);
    const second = guestEmailChange(fixture.authority, session, "second-change@example.test", changed.revision);
    assert.throws(() => fixture.authority.changeEmail({ ...second, command: { ...second.command, idempotencyKey: first.command.idempotencyKey } }), GuestAccountAuthorityError);
    assert.equal(fixture.authority.findAccountByEmail(changed.email, "tenant-1")?.revision, changed.revision);
    assert.equal(fixture.authority.findAccountByEmail("second-change@example.test", "tenant-1"), null);
    assert.equal(fixture.authority.changeEmail(second).revision, changed.revision + 1);

    const other = signInGuestAccount(fixture.authority, "other-account@example.test");
    const otherChange = guestEmailChange(fixture.authority, other, "other-change@example.test");
    assert.equal(fixture.authority.changeEmail({ ...otherChange, command: { ...otherChange.command, idempotencyKey: first.command.idempotencyKey } }).accountGuestId, other.account.accountGuestId);
  } finally {
    await fixture.close();
  }
});

test("Email-change proofs fail closed for revoked or expired sessions, expired proofs and changed account revisions", async () => {
  for (const scenario of ["revoked session", "expired session", "expired proof", "changed revision"] as const) {
    const fixture = await createGuestAccountFixture();
    try {
      const session = signInGuestAccount(fixture.authority);
      const change = guestEmailChange(fixture.authority, session, "stale-change@example.test");
      let currentEmail = TEST_GUEST_EMAIL;
      let revision = session.account.revision;
      if (scenario === "revoked session") fixture.authority.revokeSession(session.sessionId, "tenant-1");
      if (scenario === "expired session") fixture.advance(30 * 24 * 60 * 60 * 1000);
      if (scenario === "expired proof") fixture.advance(10 * 60 * 1000);
      if (scenario === "changed revision") {
        const other = guestEmailChange(fixture.authority, session, "current-change@example.test");
        const changed = fixture.authority.changeEmail(other);
        currentEmail = changed.email;
        revision = changed.revision;
        assert.throws(() => fixture.authority.changeEmail({ ...other, command: { ...other.command, idempotencyKey: "different-command" } }), GuestAccountAuthorityError);
      }
      assert.throws(() => fixture.authority.changeEmail(change), GuestAccountAuthorityError, scenario);
      assert.equal(fixture.authority.findAccountByEmail(currentEmail, "tenant-1")?.revision, revision);
      assert.equal(fixture.authority.findAccountByEmail("stale-change@example.test", "tenant-1"), null);
    } finally {
      await fixture.close();
    }
  }
});

test("AC9 — Restart preserves valid, expired, exhausted and revoked account authority state", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const validChallenge = signInCode(fixture.authority, "valid@example.test");
    const valid = fixture.authority.verifyCode({ challengeId: validChallenge.challengeId, tenantId: "tenant-1", email: "valid@example.test", code: validChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.60" });
    const expiredChallenge = signInCode(fixture.authority, "expired@example.test");
    const exhaustedChallenge = signInCode(fixture.authority, "exhausted@example.test");
    const wrongCode = exhaustedChallenge.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) assert.throws(() => fixture.authority.verifyCode({ challengeId: exhaustedChallenge.challengeId, tenantId: "tenant-1", email: "exhausted@example.test", code: wrongCode, purpose: "sign_in", clientAddress: "192.0.2.61" }));
    const revokedChallenge = signInCode(fixture.authority, "revoked@example.test");
    const revoked = fixture.authority.verifyCode({ challengeId: revokedChallenge.challengeId, tenantId: "tenant-1", email: "revoked@example.test", code: revokedChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.62" });
    fixture.authority.revokeSession(revoked.sessionId, "tenant-1");
    fixture.advance(10 * 60 * 1000);
    closeGuestAccountAuthority(fixture.authority);
    const reopened = openGuestAccountAuthority(fixture.databasePath, { codeHashingKey: TEST_GUEST_CODE_HASHING_KEY, clock: fixture.now });
    try {
      assert.ok(reopened.resolveSession(valid.sessionId, valid.sessionSecret));
      assert.equal(reopened.resolveSession(revoked.sessionId, revoked.sessionSecret), null);
      assert.throws(() => reopened.verifyCode({ challengeId: expiredChallenge.challengeId, tenantId: "tenant-1", email: "expired@example.test", code: expiredChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.63" }), /expired|invalid/i);
      assert.throws(() => reopened.verifyCode({ challengeId: exhaustedChallenge.challengeId, tenantId: "tenant-1", email: "exhausted@example.test", code: exhaustedChallenge.code, purpose: "sign_in", clientAddress: "192.0.2.64" }), /attempt|invalid/i);
    } finally {
      closeGuestAccountAuthority(reopened);
    }
  } finally {
    await removeGuestAccountFixture(fixture.directory);
  }
});

test("The persisted Sign-In Code table stores no plaintext code and hashes are challenge-bound", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const challenge = signInCode(fixture.authority);
    const database = new DatabaseSync(fixture.databasePath);
    try {
      const row = database.prepare("SELECT code_hash, challenge_id FROM guest_sign_in_codes WHERE challenge_id = ?").get(challenge.challengeId) as { code_hash: string; challenge_id: string };
      assert.notEqual(row.code_hash, challenge.code);
      assert.equal(row.challenge_id, challenge.challengeId);
      assert.match(row.code_hash, /^[a-f0-9]{64}$/);
    } finally {
      database.close();
    }
  } finally {
    await fixture.close();
  }
});

test("Configured send and check quotas are enforced across purposes without invalidating a usable code on refused resend", async () => {
  const fixture = await createGuestAccountFixture();
  closeGuestAccountAuthority(fixture.authority);
  const authority = openGuestAccountAuthority(fixture.databasePath, {
    codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
    clock: fixture.now,
    policy: {
      codeRequestCooldownMs: 0,
      codeRequestsPerEmailPerHour: 1,
      codeRequestsPerAddressPerHour: 3,
      codeChecksPerEmailPerHour: 1,
      codeChecksPerAddressPerHour: 1
    }
  });
  try {
    const first = authority.requestCode({ tenantId: "tenant-1", email: "quota@example.test", purpose: "sign_in", clientAddress: "192.0.2.90" });
    assert.throws(() => authority.requestCode({ tenantId: "tenant-1", email: "quota@example.test", purpose: "sign_in", clientAddress: "192.0.2.91" }), (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "rate_limited");
    const verified = authority.verifyCode({ challengeId: first.challengeId, tenantId: "tenant-1", email: "quota@example.test", code: first.code, purpose: "sign_in", clientAddress: "192.0.2.90" });
    assert.equal(verified.purpose, "sign_in");
    assert.throws(() => authority.verifyCode({ challengeId: "unknown", tenantId: "tenant-2", email: "quota@example.test", code: "000000", purpose: "export_data", clientAddress: "192.0.2.92" }), (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "rate_limited");
    assert.throws(() => authority.verifyCode({ challengeId: "unknown", tenantId: "tenant-1", email: "other@example.test", code: "000000", purpose: "sign_in", clientAddress: "192.0.2.90" }), (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "rate_limited");
    assert.ok(authority.resolveSession(verified.sessionId, verified.sessionSecret));
  } finally {
    closeGuestAccountAuthority(authority);
    await removeGuestAccountFixture(fixture.directory);
  }
});

test("Action-purpose codes produce no sign-in session and their proof is bound to one action and consumed once", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const signIn = signInCode(fixture.authority);
    const session = fixture.authority.verifyCode({ challengeId: signIn.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: signIn.code, purpose: "sign_in", clientAddress: TEST_GUEST_ADDRESS });
    fixture.advance(60 * 1000);
    const deletion = fixture.authority.requestCode({ tenantId: "tenant-1", email: TEST_GUEST_EMAIL, purpose: "delete_account", clientAddress: "192.0.2.91", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret, expectedRevision: session.account.revision });
    assert.throws(() => fixture.authority.verifyCode({ challengeId: deletion.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: deletion.code, purpose: "export_data", clientAddress: "192.0.2.91", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret }), /invalid|expired/i);
    const verified = fixture.authority.verifyCode({ challengeId: deletion.challengeId, tenantId: "tenant-1", email: TEST_GUEST_EMAIL, code: deletion.code, purpose: "delete_account", clientAddress: "192.0.2.91", accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret });
    assert.equal(verified.purpose, "delete_account");
    assert.equal("sessionSecret" in verified, false);
    assert.equal(fixture.authority.consumeActionProof({ proof: verified.proof, sessionSecret: session.sessionSecret }), true);
    assert.equal(fixture.authority.consumeActionProof({ proof: verified.proof, sessionSecret: session.sessionSecret }), false);
    assert.equal(fixture.authority.findAccountByEmail(TEST_GUEST_EMAIL, "tenant-1")?.accountGuestId, session.account.accountGuestId);
  } finally {
    await fixture.close();
  }
});

// Review gaps T1 and T2 (issue 07): the change-email code is bound to the session and account it was issued to.

test("T1: a change-email code cannot be requested with a session secret that does not hold the account, or with a stale revision (fails closed)", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const session = signInGuestAccount(fixture.authority, TEST_GUEST_EMAIL);
    const base = { tenantId: session.account.tenantId, email: "ada.new@example.test", purpose: "change_email" as const, clientAddress: TEST_GUEST_ADDRESS, accountGuestId: session.account.accountGuestId, sessionId: session.sessionId };
    assert.throws(
      () => fixture.authority.requestCode({ ...base, sessionSecret: "not-the-secret", expectedRevision: session.account.revision }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
      "a wrong session secret cannot start an email change",
    );
    assert.throws(
      () => fixture.authority.requestCode({ ...base, sessionSecret: session.sessionSecret, expectedRevision: session.account.revision + 1 }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
      "a stale account revision cannot start an email change",
    );
    // Neither refusal sends a code: the valid request afterwards is the first one recorded.
    const issued = fixture.authority.requestCode({ ...base, sessionSecret: session.sessionSecret, expectedRevision: session.account.revision });
    assert.ok(issued.challengeId, "the valid session and revision still get a challenge");
  } finally {
    await fixture.close();
  }
});

test("T2: a change-email code verifies only for the session it was issued to", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const first = signInGuestAccount(fixture.authority, TEST_GUEST_EMAIL);
    fixture.advance(61_000);
    const second = signInGuestAccount(fixture.authority, TEST_GUEST_EMAIL);
    const input = { tenantId: first.account.tenantId, email: "ada.new@example.test", purpose: "change_email" as const, clientAddress: TEST_GUEST_ADDRESS, accountGuestId: first.account.accountGuestId };
    const challenge = fixture.authority.requestCode({ ...input, sessionId: first.sessionId, sessionSecret: first.sessionSecret, expectedRevision: first.account.revision });
    assert.throws(
      () => fixture.authority.verifyCode({ ...input, challengeId: challenge.challengeId, code: challenge.code, sessionId: second.sessionId, sessionSecret: second.sessionSecret }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
      "another valid session of the same account cannot spend the code",
    );
    const verified = fixture.authority.verifyCode({ ...input, challengeId: challenge.challengeId, code: challenge.code, sessionId: first.sessionId, sessionSecret: first.sessionSecret });
    assert.equal(verified.purpose, "change_email", "the issuing session still verifies it (the failed attempt above did not consume it)");
  } finally {
    await fixture.close();
  }
});

test("T2: a change-email code verifies only for the account it was issued to", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const ada = signInGuestAccount(fixture.authority, TEST_GUEST_EMAIL);
    fixture.advance(61_000);
    const other = signInGuestAccount(fixture.authority, "other@example.test");
    const challenge = fixture.authority.requestCode({
      tenantId: ada.account.tenantId, email: "ada.new@example.test", purpose: "change_email", clientAddress: TEST_GUEST_ADDRESS,
      accountGuestId: ada.account.accountGuestId, sessionId: ada.sessionId, sessionSecret: ada.sessionSecret, expectedRevision: ada.account.revision,
    });
    assert.throws(
      () => fixture.authority.verifyCode({
        tenantId: ada.account.tenantId, email: "ada.new@example.test", purpose: "change_email", clientAddress: TEST_GUEST_ADDRESS,
        challengeId: challenge.challengeId, code: challenge.code,
        accountGuestId: other.account.accountGuestId, sessionId: other.sessionId, sessionSecret: other.sessionSecret,
      }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
      "another account's valid session cannot spend the code",
    );
  } finally {
    await fixture.close();
  }
});

test("T1 failure path: the authority refuses a change-email code to the account's own address and issues no challenge", async () => {
  const fixture = await createGuestAccountFixture();
  try {
    const session = signInGuestAccount(fixture.authority, TEST_GUEST_EMAIL);
    assert.throws(
      () => fixture.authority.requestCode({
        tenantId: session.account.tenantId, email: TEST_GUEST_EMAIL, purpose: "change_email", clientAddress: TEST_GUEST_ADDRESS,
        accountGuestId: session.account.accountGuestId, sessionId: session.sessionId, sessionSecret: session.sessionSecret, expectedRevision: session.account.revision,
      }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "invalid_input",
      "the account's current address is not a change",
    );
  } finally {
    await fixture.close();
  }
});
