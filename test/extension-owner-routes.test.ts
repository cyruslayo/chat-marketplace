import assert from "node:assert/strict";
import test from "node:test";
import { crossOriginPost, operatorPost, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";

// Monthly-stays issue 09 (ADR 0092, ADR 0082): the Operator's extension decisions over the owner's HTTP routes. The authority checks
// of the route fail closed: no session is refused, a cross-origin post is refused, and a decision for a request that does not exist,
// or that this operator does not hold, changes nothing. The approve and decline paths themselves are tested on the environment in
// test/extension-owner-inbox.test.ts (a real extended stay is needed for a request to decide).

const UNKNOWN_CONTRACT = "contract-unknown-issue-09";
const UNKNOWN_EXTENSION = "extension-unknown-issue-09";

test("An extension approve or decline over the owner routes is refused without an operator session, from another origin, and for an unknown request", async () => {
  const f: SignedInOperator = await startSignedInOperator();
  try {
    for (const decision of ["approve", "decline"] as const) {
      const path = `/operator/extensions/${UNKNOWN_CONTRACT}/${UNKNOWN_EXTENSION}/${decision}`;
      assert.equal((await operatorPost(f.session, path, "")).status, 401, `${decision}: no session is refused`);
      assert.equal((await crossOriginPost(f.session, path)).status, 403, `${decision}: a cross-origin post is refused`);
      const signedIn = await operatorPost(f.session, path);
      assert.equal(signedIn.status, 409, `${decision}: an unknown request is refused and changes nothing`);
    }
    // The inbox still renders, with no extension section, for the signed-in operator.
    const inbox = await fetch(`${f.session.base}/operator/requests`, { headers: { cookie: f.session.cookie } });
    assert.equal(inbox.status, 200);
    assert.equal((await inbox.text()).includes("data-extension-requests"), false, "no extension request is listed");
  } finally {
    await f.server.close();
  }
});
