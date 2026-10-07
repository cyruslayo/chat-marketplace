/** The Vite `?raw` build import of the foundations CSS (slice 09a's decision, built out in 09b). */
declare module "*.css?raw" {
  const value: string;
  export default value;
}

/** Test-runtime bindings (`wrangler.test.jsonc`). The deployable shape is `CloudflareEnv` in cloudflare-config.ts. */
declare namespace Cloudflare {
  interface Env {
    TEST_HARNESS: import("@cloudflare/workers-types").DurableObjectNamespace<
      import("./test-harness-do.js").TestHarnessDO
    >;
    SHORTLET: import("@cloudflare/workers-types").DurableObjectNamespace<
      import("./shortlet-pilot-do.js").ShortletPilot
    >;
    RECEIPTS: import("@cloudflare/workers-types").R2Bucket;
    EXPORTS: import("@cloudflare/workers-types").R2Bucket;
    ASSETS: import("@cloudflare/workers-types").Fetcher;
  }
}
