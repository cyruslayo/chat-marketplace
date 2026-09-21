import test from "node:test";
import assert from "node:assert/strict";
import { interpretStayRequest } from "../apps/local-guest/src/concierge.js";

const options = { demoCheckIn: "2026-09-10" };

test("Abuja city requests produce a production discovery search", () => {
  assert.deepEqual(interpretStayRequest("I need an apartment in Abuja for 2 nights for 2 people", options), {
    kind: "search",
    filters: {
      location: "Abuja",
      checkIn: "2026-09-10",
      checkOut: "2026-09-12",
      partySize: 2,
    },
  });
});

test("Wuse 2 requests preserve the Abuja neighbourhood filter", () => {
  assert.deepEqual(interpretStayRequest("I need an apartment in Wuse 2 for 2 nights for 2 people", options), {
    kind: "search",
    filters: {
      location: "Abuja",
      neighbourhood: "Wuse 2",
      checkIn: "2026-09-10",
      checkOut: "2026-09-12",
      partySize: 2,
    },
  });
});
