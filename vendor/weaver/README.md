# Vendored Weaver packages

These package artifacts establish the repository-local Weaver consumption boundary. Weaver source is not vendored.

- Repository: https://github.com/cyruslayo/weaver
- Exact source commit: `b76e980e9b932820a6f74c0f881ea6c7e98bee04`
- Package version: `0.1.2`
- Packages vendored:
  - `@weaver/core`
  - `@weaver/web`
- Weaver packaging and verification command: `pnpm verify:packages`

## SHA-256

| Artifact | SHA-256 |
| --- | --- |
| `weaver-core-0.1.2.tgz` | `86dd3c398b6ee050860c0f9e55af34298d216260f5cf1d3f2dcb0579abaa18d2` |
| `weaver-web-0.1.2.tgz` | `692228d9be5595d43c0916cd7bf015dbfb7fffd14851f0a2392e48a57ddd2e79` |

Run `npm run verify:weaver` in this repository to verify the checked-in artifacts.

## Refreshing the artifacts

1. Check out https://github.com/cyruslayo/weaver at the intended exact commit (detached HEAD, not a branch).
2. Confirm `packages/core/package.json` and `packages/web/package.json` have the intended names and the same intended version.
3. In Weaver, run `pnpm install --frozen-lockfile`.
4. In Weaver, run its documented packaging verification command: `pnpm verify:packages`.
5. Copy only `artifacts/weaver-core-<version>.tgz` and `artifacts/weaver-web-<version>.tgz` into this directory. Do not copy Weaver source or the MCP artifact.
6. Calculate each artifact's SHA-256 digest and update both this file and `scripts/verify-weaver-vendor.mjs`.
7. Use npm to install both repository-relative tarballs so `package.json` and `package-lock.json` are updated together.
8. Run `npm run verify:weaver`, `npm run check`, `npm test`, and a clean `npm ci` verification.

Changing the Weaver source commit or package version requires regenerating the tarballs and updating the hashes.
