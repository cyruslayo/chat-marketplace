# Workers runtime spike (01b)

Run from this folder using the integration worktree's pinned dependencies:

```sh
npm exec cf -- build
npm exec cf -- dev
# Other terminal:
node check.mjs
npm exec cf -- deploy --dry-run
```

Vite fixes port 5183 because this beta does not forward cf dev port flags. Tests use only synthetic data and a mocked Gemini fetch. No API credential, authentication, remote resource or deployment is needed.

Observed on local cf dev (Node 22.19.0, cf 1.0.0-beta.12, plugin 2.0.0-beta.sha-52b0dc0e9, Vite 8.3.2):

- GoogleGenAI bundles; one generateContent call makes one mocked HTTP call and returns `mocked-gemini-ok`.
- Raw bytes `[0,255,123,34,195,169,34,125]` / synthetic key produce SHA512 HMAC `e66a8dc291268caf346169258942c2f5eea96e3cf40b5451cc7bd0949c35131df41287e2791bfbf38ad9e0855f16fd04af2a75a076971cc35b8848fa77aba332`, identical to Node. timingSafeEqual is true for equal bytes and false for same-length unequal bytes.
- isIP returns `[4,6,0]` for IPv4, IPv6 and invalid input.
- Intl renders `1 Jan 2026, 01:00`, `23 Jul 2026, 00:30`, `1 Jan 2027, 00:00`, identical to Node.
- Buffer exists globally (`function`); explicit node:buffer import works (`00ff`).
- A 5 MiB synthetic multipart payload plus 176 boundary/header bytes reaches the DO via stub.fetch(request): 5,243,056 bytes, 1,522 chunks, largest 4,096 bytes, 406 ms between first and last reads while the producer intentionally pauses 300 ms. This demonstrates progressive local body consumption, not complete up-front buffering; it is not a hosted limit guarantee.
- The 2,000,000-iteration synchronous loop totals 1,999,999,000,000 and advances Date.now by 3 ms (initial probe: 8 ms). Local behaviour differs from the PRD frozen-clock assumption. Production is untested; code must not rely on clock advancement inside a synchronous operation.

Build and dry-run both succeed without upload. This throwaway spike must NOT merge into the integration branch; only its issue answer does.
