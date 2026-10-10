# Production build and runtime

Status: resolved
Type: task
Blocked by: none

## What to build

`npm run pilot:start` runs through `tsx`, and `npm run check` needs `typescript`, but both are devDependencies. With `NODE_ENV=production` (as `.env.example` sets it), `npm ci` skips devDependencies, so the documented install cannot start the app. The committed browser bundle `apps/local-guest/dist/client.js` is never rebuilt by `pilot:start`, and the Node version is not pinned even though the app needs built-in `node:sqlite`.

## Acceptance criteria

- [x] A production install (`NODE_ENV=production npm ci`) followed by the documented build and start commands starts the pilot.
- [x] A `build` script rebuilds the guest client bundle as part of the production build.
- [x] `package.json` declares `engines.node` for a version with `node:sqlite`, and `.nvmrc` matches.
- [x] `.scratch/pilot-rehearsal-*` is in `.gitignore`, so the rehearsal certificates and databases cannot be committed by accident.
- [x] `docs/pilot-deployment.md` documents the build step.

## Answer

Implemented on branch `launch/staging-and-build` (stacked on `launch/llm-providers`).

- `tsx` and `esbuild` moved to `dependencies`; `typescript` stays a devDependency (the server does not type-check). `package-lock.json` regenerated with `--package-lock-only`.
- New `npm run build` runs `apps/local-guest/scripts/build-client.mjs`.
- `engines.node >=22.13.0` (`node:sqlite` without a flag); `.nvmrc` pins 22.19.0, the tested version.
- `.gitignore` ignores `.scratch/pilot-rehearsal-*/`.
- `docs/pilot-deployment.md`: `npm ci --omit=dev`, `npm run build`, `npm run pilot:start`.
- Tests: `test/production-install.test.ts`, one per criterion (the documentation criterion is not a test).
- Verified for real on 28 Sept 2026: `git archive` of the commit → `NODE_ENV=production npm ci` (tsx and esbuild present, typescript absent) → `npm run build` → `npm run pilot:start` in staging served `/healthz` `{"ok":true}` and a fresh `/client.js`.
- Chose the minimal fix (tsx at runtime) over compiling to JS: `guest-server.ts` resolves `dist/client.js` relative to its own source path, so a compiled layout needs more change for no pilot benefit.
