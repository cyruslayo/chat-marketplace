declare namespace Cloudflare {
  interface Env {
    TEST_HARNESS: DurableObjectNamespace<import("./test-harness-do.js").TestHarnessDO>;
    RECEIPTS: R2Bucket;
    EXPORTS: R2Bucket;
  }
}
