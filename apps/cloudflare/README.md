# Workers test harness

Run `npm run test:workers` from the repository root. Tests under `test/*.spec.ts`
run in local workerd, with SQLite-backed `TestHarnessDO` and private simulated
`RECEIPTS` / `EXPORTS` R2 bindings. No Cloudflare account or real data is needed.

Use the project-pinned `cf` CLI for Workers development, builds and deployment.
Production configuration and application assembly belong to slice 10b; this
harness is not deployable application scaffolding.

Following the proof in issue 01c, this harness pins Vitest 4.1.11 and
`@cloudflare/vitest-plugin` 1.3.6 (the current integration, rather than the legacy
`vitest-pool-workers` package). The plugin requires Wrangler 4.147.0 internally.
`wrangler.test.jsonc` exists only for that test runtime. Wrangler is not a
project developer/deployment CLI or direct dependency.

`npm run check` checks Node code, Worker source, Worker tests and the Node-hosted
Vitest configuration separately. Worker source excludes Vitest's Node type
references so a `node:sqlite` import cannot silently type-check there. Workers
compatibility globals such as `process` alone are not a valid Node-only probe.
Generated/local state (`.cloudflare/`, `.wrangler/`, `.dev.vars*`) is ignored.
