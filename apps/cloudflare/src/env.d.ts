/** The Vite `?raw` build import of the foundations CSS (slice 09a's decision, built out in 09b). */
declare module "*.css?raw" {
  const value: string;
  export default value;
}

/** Slice 11b: the real inventory template read as text by the workerd import-route test. */
declare module "*.csv?raw" {
  const value: string;
  export default value;
}

/** Slice 16: the committed Node export read as text by the workerd migration test (not parsed by the bundler). */
declare module "*.json?raw" {
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
    PLATFORM: import("@cloudflare/workers-types").DurableObjectNamespace<
      import("./platform-do.js").PlatformDO
    >;
    COMMERCE: import("@cloudflare/workers-types").DurableObjectNamespace<
      import("./commerce-market-do.js").CommerceMarket
    >;
    ISOLATED_SHORTLET: import("@cloudflare/workers-types").DurableObjectNamespace;
    ISOLATED_PLATFORM: import("@cloudflare/workers-types").DurableObjectNamespace;
    ISOLATED_COMMERCE: import("@cloudflare/workers-types").DurableObjectNamespace;
    RECEIPTS: import("@cloudflare/workers-types").R2Bucket;
    EXPORTS: import("@cloudflare/workers-types").R2Bucket;
    ASSETS: import("@cloudflare/workers-types").Fetcher;
    COMMERCE_REFERENCE_HMAC_KEY: string;
    COMMERCE_REFERENCE_HMAC_KEY_ID: string;
  }
}
