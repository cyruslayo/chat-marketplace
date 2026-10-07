/** The Vite `?raw` build import of the foundations CSS (slice 09a's decision, built out in 09b). */
declare module "*.css?raw" {
  const value: string;
  export default value;
}

declare namespace Cloudflare {
  interface Env {
    TEST_HARNESS: DurableObjectNamespace<
      import("./test-harness-do.js").TestHarnessDO
    >;
    RECEIPTS: R2Bucket;
    EXPORTS: R2Bucket;
  }
}
