import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";
import templateCsv from "../../../docs/pilot-inventory-template.csv?raw";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { ORIGIN, TENANT, accessToken, opsHeaders, seedOperator, withState } from "./ops-test-helpers.js";

async function unitIds(): Promise<string[]> {
  return withState((database) => new SqliteUnitRepository(database).findAll().map((unit) => unit.id));
}

function importRequest(token: string, query: string, body: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_ops/inventory/import${query}`, {
    method: "POST",
    headers: { ...opsHeaders(token), "content-type": "text/csv" },
    body,
  });
}

test("11b AC1: importing the inventory template through the route matches the importer's own result and writes the units", async () => {
  const token = await accessToken({});
  // The template's rows resolve against this operator, exactly as `pilot:inventory:import` requires.
  await seedOperator("operator-existing-001");
  const before = await unitIds();

  const dryRun = await importRequest(token, `?tenantId=${TENANT}&dryRun=true`, templateCsv);
  expect(dryRun.status).toBe(200);
  const drySummary = await dryRun.json();
  expect(drySummary.rowsRead).toBeGreaterThan(0);
  expect(drySummary.valid).toBeGreaterThan(0);
  expect(drySummary.valid + drySummary.invalid).toBe(drySummary.rowsRead);
  // A dry run changes nothing.
  expect(await unitIds()).toEqual(before);

  const wetRun = await importRequest(token, `?tenantId=${TENANT}`, templateCsv);
  expect(wetRun.status).toBe(200);
  const summary = await wetRun.json();
  // Same importer, same read/validity counts; the wet run stores exactly the valid rows.
  expect(summary.rowsRead).toBe(drySummary.rowsRead);
  expect(summary.valid).toBe(drySummary.valid);
  expect(summary.invalid).toBe(drySummary.invalid);
  expect(summary.inserted).toBe(drySummary.valid);
  expect(await unitIds()).not.toEqual(before);
});

test("11b AC2: a row the importer rejects is reported with its existing error and writes nothing for it", async () => {
  const token = await accessToken({});
  await seedOperator("operator-existing-001");
  const before = await unitIds();

  // Valid header, one row with an extra column; the importer reports it per row.
  const header = templateCsv.split("\n")[0]!;
  const badRow = `${templateCsv.split("\n")[1]!},extra-column`;
  const response = await importRequest(token, `?tenantId=${TENANT}`, `${header}\n${badRow}\n`);
  expect(response.status).toBe(200);
  const summary = await response.json();
  expect(summary.invalid).toBe(1);
  expect(summary.errors[0].row).toBeGreaterThanOrEqual(2);
  expect(summary.errors[0].message).toMatch(/columns/);
  expect(await unitIds()).toEqual(before);
});

test("11b AC2 failure path: a header the importer refuses is rejected without writing anything", async () => {
  const token = await accessToken({});
  const before = await unitIds();
  const response = await importRequest(token, `?tenantId=${TENANT}`, "unit_id,not_a_real_column\nbroken-row,1,2,3\n");
  expect(response.status).toBe(400);
  expect((await response.json()).message).toMatch(/required columns/);
  expect(await unitIds()).toEqual(before);
});

test("11b AC2 failure path: a CSV over the confirmed 5 MiB limit is refused before it is stored", async () => {
  const token = await accessToken({});
  const before = await unitIds();
  const oversize = new Uint8Array(5 * 1024 * 1024 + 1);
  const response = await SELF.fetch(`${ORIGIN}/_ops/inventory/import?tenantId=${TENANT}`, {
    method: "POST",
    headers: { ...opsHeaders(token), "content-type": "text/csv" },
    body: oversize,
  });
  expect(response.status).toBe(413);
  expect(await unitIds()).toEqual(before);
});

test("11b: the inventory route needs the same two authentication layers", async () => {
  const response = await SELF.fetch(`${ORIGIN}/_ops/inventory/import?tenantId=${TENANT}`, {
    method: "POST",
    headers: { "content-type": "text/csv" },
    body: templateCsv,
  });
  expect(response.status).toBe(401);
});
