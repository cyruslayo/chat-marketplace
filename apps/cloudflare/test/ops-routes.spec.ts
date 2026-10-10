import { SELF } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { SqliteOperatorSessionAuthority } from "../../../domains/shortlet/src/operator-session-authority.js";
import { runOperatorListCommand } from "../../shortlet-ops/src/operator-cli.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import {
  ORIGIN,
  SECRET,
  TENANT,
  accessToken,
  grantRepresentative,
  operatorIds,
  opsHeaders,
  withState,
} from "./ops-test-helpers.js";

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

test("16 F12: an Access assertion from another team's issuer, or with no issuer, is refused and a genuine one is accepted", async () => {
  const otherTeam = await accessToken({ iss: "https://other-team.cloudflareaccess.test" });
  const noIssuer = await accessToken({ iss: undefined });
  for (const token of [otherTeam, noIssuer]) {
    const response = await SELF.fetch(`${ORIGIN}/_ops/import/verify`, { headers: opsHeaders(token) });
    expect(response.status).toBe(401);
  }
  const genuine = await SELF.fetch(`${ORIGIN}/_ops/import/verify`, { headers: opsHeaders(await accessToken({})) });
  expect(genuine.status).toBe(200);
});
