# CI

The workflow is `.github/workflows/ci.yml`. It has no secrets, no deploy steps, and no Cloudflare login, and its token is read-only (`contents: read`).

## Jobs

| Job | Runs on | Required | Commands |
| --- | --- | --- | --- |
| `verify` | pull requests to `main`, pushes to `main`, manual runs | Yes (see below) | `npm ci`, `npm run check`, `npm run test:workers`, `npm run test:non-browser` |
| `browser` | pushes to `main`, manual runs only | No | `npm ci`, `npm run build`, `npm run test:browser` with the runner's Google Chrome |

`npm run test:non-browser` runs every test file that does not drive a real Chrome. `npm run test:browser` runs the files that do, one at a time. `npm test` runs both phases in order, as before.

The `browser` job runs `npm run build` before the real-browser tests. The local guest server serves `apps/local-guest/dist/client.js` from disk, and that tracked copy is not rebuilt for each change, so the job builds the current client in the CI workspace only. The built file is not committed.

## Running the same commands locally

```sh
npm ci
npm run check
npm run test:workers
npm run test:non-browser
npm run test:browser   # needs Chrome; set SHORTLET_CHROME_PATH to its binary, and SHORTLET_CHROME_NO_SANDBOX=1 where the sandbox cannot run
```

The file split is in `scripts/test-phases.mjs`, and `scripts/run-tests.mjs` runs it.

## Branch protection

The workflow does not change repository settings. To make `verify` block merges, a repository admin must add it under Settings, Branches, the rule for `main`, as a required status check. Until then, the check reports but does not block. The `browser` job must not be added as a required check.
