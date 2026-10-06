import { DurableObject } from "cloudflare:workers";

export class TestHarnessDO extends DurableObject<Cloudflare.Env> {}

// Test-pool entrypoint only; production assembly belongs to slice 10b.
export default {
  fetch(): Response {
    return new Response("Test harness only", { status: 404 });
  },
};
