import assert from "node:assert/strict";
import test from "node:test";
import { formatWatDateTime } from "../apps/web/src/ui-kit.js";

test("formatWatDateTime shows Africa/Lagos time and date with the WAT label", () => {
  assert.equal(formatWatDateTime("2026-10-18T10:00:00.000Z"), "11:00 am WAT, 18 Oct 2026");
  assert.equal(formatWatDateTime("2026-10-18T13:05:00.000Z"), "2:05 pm WAT, 18 Oct 2026");
});

test("formatWatDateTime reports an unparseable timestamp without throwing", () => {
  assert.equal(formatWatDateTime("not-a-date"), "time unavailable");
});
