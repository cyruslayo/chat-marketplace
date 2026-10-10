import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { createPlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { seedIssue01Units } from "../../../domains/shortlet/src/browse.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { createProvisionedOperator } from "../../../domains/shortlet/src/operator.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { SqliteOperatorRepresentativeGrantStore } from "../../../domains/shortlet/src/operator-representative-authority.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";

/** Shared fixtures for the `/_ops` workerd specs (AGENTS.md: no duplicated test fixtures). */
export const ORIGIN = "https://pilot.example.test";
export const TENANT = "tenant-synthetic";
export const SECRET = "synthetic-ops-shared-secret";
export const AUDIENCE = "synthetic-access-audience";

/** A synthetic RS256 private key for the Access-token tests; the matching public JWKS is in wrangler.test.jsonc. */
export const PRIVATE_TEST_JWK: JsonWebKey = {
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

/** A valid Access assertion, unless the payload is overridden or the signature is tampered with. */
export async function accessToken(payloadOverrides: Record<string, unknown> = {}, tamper = false): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: "synthetic-access-key", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    aud: AUDIENCE,
    iss: "https://shortlet.cloudflareaccess.test",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    ...payloadOverrides,
  }));
  const key = await crypto.subtle.importKey("jwk", PRIVATE_TEST_JWK, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  const bytes = new Uint8Array(signature);
  if (tamper) bytes[0] = bytes[0]! ^ 0x01;
  return `${header}.${payload}.${base64UrlBytes(bytes)}`;
}

export function opsHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", "cf-access-jwt-assertion": token, "x-shortlet-ops-secret": SECRET };
}

export const opsStub = () => env.SHORTLET.get(env.SHORTLET.idFromName(TENANT));

export async function withState<T>(run: (database: DurableObjectSqlDatabase) => T): Promise<T> {
  return runInDurableObject(opsStub(), (_instance, ctx) => run(new DurableObjectSqlDatabase(ctx.storage)));
}

export async function operatorIds(): Promise<string[]> {
  return withState((database) => new SqliteOperatorRepository(database).findAll().map((operator) => operator.id));
}

/** The inventory template's operators must exist before a row can validate against them. */
export async function seedOperator(operatorId: string): Promise<void> {
  await withState((database) => {
    const operators = new SqliteOperatorRepository(database, { clock: () => new Date() });
    if (operators.findById(operatorId)) return;
    operators.create(createProvisionedOperator({ id: operatorId, tenantId: TENANT, name: "Fixture Operator", now: new Date() }));
  });
}

/**
 * Seeds units and their operators so the tenant passes the provisioning gate (the guest/owner routes serve). The stub
 * defaults to the shared tenant object; a spec that needs an object no other test has built passes its own.
 */
export async function provisionTenant(stub: ReturnType<typeof opsStub> = opsStub()): Promise<void> {
  await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const units = new SqliteUnitRepository(database);
    if (units.findAll().length === 0) seedIssue01Units(units);
    const operators = new SqliteOperatorRepository(database, { clock: () => new Date() });
    for (const [id, name] of new Map(units.findAll().map((unit) => [unit.operator.id, unit.operator.name]))) {
      if (!operators.findById(id)) operators.create(createProvisionedOperator({ id, tenantId: TENANT, name: name?.trim() || "Fixture Operator", now: new Date() }));
    }
  });
}

/** ADR 0082: provisioning needs an explicit representative grant. */
export async function grantRepresentative(operatorId: string, actorId: string): Promise<void> {
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
