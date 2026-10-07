import { env } from "cloudflare:workers";
import { SELF, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import { createPlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { SqliteOperatorRepresentativeGrantStore } from "../../../domains/shortlet/src/operator-representative-authority.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { SqliteOperatorSessionAuthority } from "../../../domains/shortlet/src/operator-session-authority.js";
import { runOperatorListCommand } from "../../shortlet-ops/src/operator-cli.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";

const ORIGIN = "https://pilot.example.test";
const TENANT = "tenant-synthetic";
const SECRET = "synthetic-ops-shared-secret";
const AUDIENCE = "synthetic-access-audience";

/** A synthetic RS256 keypair for the Access-token tests. Test-only; the matching public JWKS is in wrangler.test.jsonc. */
const TEST_PRIVATE_JWK: JsonWebKey = {
  kty: "RSA",
  n: "s-OrNgEde0lVkMzmI5Eoo8Fseut09ZD3KpPKGcwvAynA3hjUDDm6kHYR58oo2tdPq_6y-faoZJEEU6HEvMn2eJK9nZtPEmPumk7cnzvhMbItYmTycOm_1A-q3Sp0vLevM5KfuivZ14FLS-wQUlh2MQNxT5XFdQ4_x0LZ0jGstqB0upBnCjWd17a6SFsm3rLhCnrf8j4N9TPvngIQOdZnGxwn_mnXrtKXYkCOEpjDkOMRCZtyw0TQDcd57lOonDphZlD6JM6ldnkL3bndrasRqOwX7ePGQg41lkB6hxiISMH_UZKqpZsR0yk0noTQ-MImic7DqpOTcUyGAGyWsloQaQ",
  e: "AQAB",
  d: "LO0ls9GYetNoVscNjQFyTF-Ax7wpVDEVwaDyXvoDHb-eRvmdb8Y1JWIPe7ud83XFlJeCPHJRQPiEw5xJpbqs3xUK3SNOHrItg4VBjVUnm0E8G3BJqlB-k6gsDJtPV1hqna83TAgqmitU0kvNEbu9HOWWtYEatO7Pl-TGwLuePmeuOPY6fw7MYm3QMAe2zBT-6urbVfGL5hOTY8YSJaoT0Xt0ypJxSgE6Ot5U2LZ2vWUtAf8xCQCCjWP2UUOf889u0inmWEpHee4MPvuqjFNbP6nET4Q-0_3uNVT-LlS-XFEauX_GGX9Z6ExwDzqZtUPk11p_rCv3QU6JYY6yHTO0OQ",
  p: "2wwtZtsLvocOgDjSGbShOSWPv6eMWR4IHVBDmIV1qrCl7X-UQe5yvqEo8DVNl_axwCMbs9PPvOsqH97Jk4XGspiJm9zxtXT6ioIU4Pmo5wdaL46SMtDEHBZYf2JH_7HCYI2V9pbxyMUnD6ZSJNNOJXqfJ8Vvfuv2_aMjizUCSm0",
  q: "0jxlzxNbhljPibqzktFXm-4uaqCoVw6AMDCNGUsYsemD4uwk1LzS3XfsgePnoiFQfVNC_SS4oFVqZBc4SyKlSREp26NsC9XVJv45QM2ZJUIbO-G2-DRRWJEdnOs5_QLFi6CjmLCFNiKIDg-gEppnv3lJmn4Y9fJceWcNQWOl4G0",
  dp: "OD3hLmaRlmLg80UjlNwPBThCt2fSnlMarEQehvvFYYUnpVo7e844gf-pHjvhZ2I882NQSpTY4t3SnAo84XbYtKR7uJw7J2cYqRWLPNR9bIwzuMA3g3qcz8VhBZv7dohyqw3PclgBTpZoWBlRQAlNKExarwB_hywY57jKeISsyOU",
  dq: "kl6ykyVrB3I1rDJsa7-MO2fssRgBm_rgjKyA0CdUnilyRT8btXFxbffcleJSlrKTE24wqYYzdI2DcQQpkUYhxWlJtz1kMClEKc29lryN7z7DL0HK3auvJvaBo4qx6NFRMBE7VUcwt6v7Ba8jR1BxAwIymHlKb5G5iFyTAf-asVE",
  qi: "1IXbuLDbwyBCq89p99yhkzK3z5ut9MMniGydr5vDDsC5KX4I-fl642wqcrmAz6UlMvab0jZzdb4Mjp7dEZSaLbKUJE8cbGyI-LXpQ8Ofg70MvnL7oT4nFba4X5QYoC-w7jzhJwT3_5qfNFvCAEcCPHE5x7cQb8Q4WfBvBobHB_o",
};

function base64Url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A valid Access assertion, unless the payload is overridden (expiry, audience) or the signature is tampered with. */
async function accessToken(payloadOverrides: Record<string, unknown> = {}, tamper = false): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: "synthetic-access-key", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    aud: AUDIENCE,
    iss: "https://shortlet.cloudflareaccess.test",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    ...payloadOverrides,
  }));
  const key = await crypto.subtle.importKey("jwk", TEST_PRIVATE_JWK, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  const bytes = new Uint8Array(signature);
  if (tamper) bytes[0] = bytes[0]! ^ 0x01;
  return `${header}.${payload}.${base64UrlBytes(bytes)}`;
}

function opsHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", "cf-access-jwt-assertion": token, "x-shortlet-ops-secret": SECRET };
}

const stub = () => env.SHORTLET.get(env.SHORTLET.idFromName(TENANT));

async function withState<T>(run: (database: DurableObjectSqlDatabase) => T): Promise<T> {
  return runInDurableObject(stub(), (_instance, ctx) => run(new DurableObjectSqlDatabase(ctx.storage)));
}

async function operatorIds(): Promise<string[]> {
  return withState((database) => new SqliteOperatorRepository(database).findAll().map((operator) => operator.id));
}

/** ADR 0082: provisioning needs an explicit representative grant, exactly as the ops route checks. */
async function grantRepresentative(operatorId: string, actorId: string): Promise<void> {
  await withState((database) => {
    const grants = new SqliteOperatorRepresentativeGrantStore(database, { clock: () => new Date() });
    if (grants.canActForOperator({ actorId, operatorId, tenantId: TENANT })) return;
    grants.createGrant(createPlatformCommandEnvelope({
      commandName: "operator_representative.grant",
      principal: { id: "production-operations", role: "admin", tenantId: TENANT },
      payload: {
        actorId,
        operatorId,
        expiresAtIso: "2027-01-01T00:00:00Z",
        responsiblePersonVerifiedAtIso: "2026-08-01T00:00:00Z",
        verificationReference: "verification-test-011a",
      },
      idempotencyKey: `seed-grant-${actorId}-${operatorId}`,
    }));
  });
}

async function createOperator(token: string, operatorId: string, name = "Ops Operator"): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: opsHeaders(token),
    body: JSON.stringify({ operatorId, tenantId: TENANT, name }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("11a AC1: a request missing either authentication layer, or presenting a wrong value, is refused and changes nothing", async () => {
  const token = await accessToken();
  const before = await operatorIds();

  const noAssertion = await SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shortlet-ops-secret": SECRET },
    body: JSON.stringify({ operatorId: "op-denied-no-assertion", tenantId: TENANT, name: "Denied" }),
  });
  expect(noAssertion.status).toBe(401);

  const noSecret = await SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-access-jwt-assertion": token },
    body: JSON.stringify({ operatorId: "op-denied-no-secret", tenantId: TENANT, name: "Denied" }),
  });
  expect(noSecret.status).toBe(401);

  const emptySecret = await SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-access-jwt-assertion": token, "x-shortlet-ops-secret": "" },
    body: JSON.stringify({ operatorId: "op-denied-empty-secret", tenantId: TENANT, name: "Denied" }),
  });
  expect(emptySecret.status).toBe(401);

  const wrongSecret = await SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-access-jwt-assertion": token, "x-shortlet-ops-secret": "not-the-secret" },
    body: JSON.stringify({ operatorId: "op-denied-wrong-secret", tenantId: TENANT, name: "Denied" }),
  });
  expect(wrongSecret.status).toBe(401);

  const expired = await SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: opsHeaders(await accessToken({ exp: Math.floor(Date.now() / 1000) - 60 })),
    body: JSON.stringify({ operatorId: "op-denied-expired", tenantId: TENANT, name: "Denied" }),
  });
  expect(expired.status).toBe(401);

  const wrongAudience = await SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: opsHeaders(await accessToken({ aud: "some-other-audience" })),
    body: JSON.stringify({ operatorId: "op-denied-audience", tenantId: TENANT, name: "Denied" }),
  });
  expect(wrongAudience.status).toBe(401);

  const tampered = await SELF.fetch(`${ORIGIN}/_ops/operators`, {
    method: "POST",
    headers: opsHeaders(await accessToken({}, true)),
    body: JSON.stringify({ operatorId: "op-denied-tampered", tenantId: TENANT, name: "Denied" }),
  });
  expect(tampered.status).toBe(401);

  expect(await operatorIds()).toEqual(before);
});

test("11a AC2: the create, list and update routes return the same domain result as the operator CLI", async () => {
  const token = await accessToken();

  const create = await createOperator(token, "op-parity-1", "Parity One");
  expect(create.status).toBe(200);
  const created = (await create.json()).operator;

  // The route calls the CLI's domain command; the stored row is the same record the CLI would report.
  const listed = await withState((database) =>
    runOperatorListCommand(new SqliteOperatorRepository(database)).operators.find((operator) => operator.id === "op-parity-1"),
  );
  expect(created).toEqual(listed);

  const update = await SELF.fetch(`${ORIGIN}/_ops/operators/op-parity-1`, {
    method: "PATCH",
    headers: opsHeaders(token),
    body: JSON.stringify({ name: "Parity Two" }),
  });
  expect(update.status).toBe(200);
  expect((await update.json()).operator.name).toBe("Parity Two");

  const list = await SELF.fetch(`${ORIGIN}/_ops/operators`, { headers: opsHeaders(token) });
  expect(list.status).toBe(200);
  const listedNames = (await list.json()).operators.map((operator: { name: string }) => operator.name);
  expect(listedNames).toContain("Parity Two");
});

test("11a AC3: a provisioned token appears only in the response body, never in the audit or the console", async () => {
  const token = await accessToken();
  await createOperator(token, "op-access-1");
  await grantRepresentative("op-access-1", "actor-access-1");

  const captured: string[] = [];
  const spyLog = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { captured.push(args.map(String).join(" ")); });
  const spyError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { captured.push(args.map(String).join(" ")); });

  const response = await SELF.fetch(`${ORIGIN}/_ops/operators/op-access-1/access`, {
    method: "POST",
    headers: opsHeaders(token),
    body: JSON.stringify({ actorId: "actor-access-1" }),
  });
  spyLog.mockRestore();
  spyError.mockRestore();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const provisioned: string = (await response.json()).token;
  expect(typeof provisioned).toBe("string");
  expect(provisioned.length).toBeGreaterThan(20);

  const audit = await withState((database) => JSON.stringify(new SqliteAuditLog(database).entries()));
  expect(audit).not.toContain(provisioned);
  expect(captured.join("\n")).not.toContain(provisioned);
});

test("11a AC4: revoking an operator's access refuses its session at once (ADR 0086)", async () => {
  const token = await accessToken();
  await createOperator(token, "op-revoke-1");
  await grantRepresentative("op-revoke-1", "actor-revoke-1");

  const provision = await SELF.fetch(`${ORIGIN}/_ops/operators/op-revoke-1/access`, {
    method: "POST",
    headers: opsHeaders(token),
    body: JSON.stringify({ actorId: "actor-revoke-1" }),
  });
  expect(provision.status).toBe(200);
  const accessTokenValue: string = (await provision.json()).token;

  const session = await withState((database) =>
    new SqliteOperatorSessionAuthority(database, { clock: () => new Date() }).authenticateAccessToken(accessTokenValue),
  );
  const resolvesBefore = await withState((database) =>
    new SqliteOperatorSessionAuthority(database, { clock: () => new Date() }).resolveSession(session.sessionId, session.sessionSecret),
  );
  expect(resolvesBefore).not.toBeNull();

  const revoke = await SELF.fetch(`${ORIGIN}/_ops/operators/op-revoke-1/access`, {
    method: "DELETE",
    headers: opsHeaders(token),
    body: JSON.stringify({ actorId: "actor-revoke-1" }),
  });
  expect(revoke.status).toBe(200);
  expect((await revoke.json()).revoked).toBe(true);

  const resolvesAfter = await withState((database) =>
    new SqliteOperatorSessionAuthority(database, { clock: () => new Date() }).resolveSession(session.sessionId, session.sessionSecret),
  );
  expect(resolvesAfter).toBeNull();
});
