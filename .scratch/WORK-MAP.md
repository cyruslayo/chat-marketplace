# Work map: current issue statuses

**Generated 8 Nov 2026** from the issue files in the `launch/production-critical-path` worktree, based on main `16d592e`. The issue file is authoritative; this page is an inventory, not a completion verdict. See [production launch](production-launch/map.md) for the paid-Short-Stay critical path. No issue was marked resolved solely because its code was merged.

## How this page was generated

From the repository root, run the command below on the working tree (or on a clean checkout of the commit to audit). It reads `.scratch/*/issues/*.md`, normalizes annotated statuses such as `resolved (agent side; ...)`, and prints the count by effort. It includes newly created efforts without a manual allowlist. For the open-issue inventory, read the issue files; blocked-by edges are defined there, including cross-effort dependencies the counter cannot infer.

```python
# python -I -c '<this snippet>' (from the repository root)
import collections
import pathlib
import re

counts = collections.defaultdict(collections.Counter)
for issue in pathlib.Path('.scratch').glob('*/issues/*.md'):
    text = issue.read_text(encoding='utf-8')
    status = re.search(r'(?m)^Status:\s*(.*)$', text)
    counts[issue.parts[1]][status.group(1).split(' (')[0] if status else 'missing'] += 1
for effort, statuses in sorted(counts.items()):
    print(effort, dict(statuses))
print('TOTAL', sum(sum(v.values()) for v in counts.values()),
      dict(sum(counts.values(), collections.Counter())))
```

## At a glance

| Effort | ready-for-agent | ready-for-human | needs-info | needs-triage | claimed | split | resolved | Files |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| assistant-concierge-parity | 0 | 0 | 0 | 1 | 0 | 0 | 17 | 18 |
| assistant-runtime-hardening | 6 | 0 | 0 | 3 | 0 | 0 | 0 | 9 |
| cloudflare-deployment | 0 | 3 | 0 | 0 | 0 | 0 | 36 | 39 |
| concierge-agent-controls | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 5 |
| demo-launch | 1 | 2 | 0 | 0 | 0 | 0 | 10 | 13 |
| guest-accounts | 4 | 4 | 1 | 0 | 0 | 0 | 6 | 15 |
| guest-chat-first-ux | 0 | 0 | 0 | 0 | 0 | 4 | 18 | 22 |
| guest-focused-journey | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 5 |
| guest-gallery | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| guest-payments | 0 | 1 | 0 | 0 | 0 | 0 | 4 | 5 |
| guest-stays-and-favourites | 12 | 0 | 0 | 0 | 1 | 0 | 1 | 14 |
| guest-ui-consistency | 0 | 0 | 0 | 0 | 0 | 0 | 12 | 12 |
| landing-page | 0 | 2 | 0 | 0 | 0 | 0 | 13 | 15 |
| monthly-stays | 8 | 5 | 2 | 0 | 0 | 0 | 1 | 16 |
| multi-domain-platform | 2 | 0 | 1 | 1 | 6 | 0 | 25 | 35 |
| operator-dashboard | 1 | 0 | 0 | 0 | 0 | 0 | 13 | 14 |
| pilot-launch-readiness | 7 | 10 | 0 | 0 | 0 | 0 | 10 | 27 |
| production-launch | 11 | 8 | 0 | 0 | 0 | 0 | 2 | 21 |
| short-stays-29-nights | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 6 |
| shortlet-concierge-launch | 3 | 6 | 0 | 2 | 1 | 0 | 43 | 55 |
| test-runner-speed | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 |
| weaver-catalogues | 6 | 0 | 0 | 0 | 0 | 0 | 2 | 8 |
| **Total** | **61** | **41** | **4** | **7** | **14** | **4** | **225** | **356** |

## Reconciliation notes

- [Assistant runtime hardening](assistant-runtime-hardening/issues/): 01–06 are implemented and merged via `1c2e0b8` but still open on their recorded Definition-of-Done gaps; 07–09 are separate open follow-ups. Each file carries a production-launch/01 evidence note.
- [Concierge agent controls](concierge-agent-controls/issues/): 01–05 are merged via `ae708b1` but remain `claimed` because their integrated acceptance evidence, including the recorded red full suite for 05, is incomplete. Their issue comments record the distinction.
- [Demo launch](demo-launch/map.md): 12 and 13 are resolved by `6f82a7b` and `a572324`; older progress pointers are historical. The benchmark acceptance (03), deployment evidence (06) and 180-night live journey (07) remain open.
- The tester-facing trust-expiry note uses the 119-day calculation (ADR 0023 as amended plus ADR 0055). Historical issue comments discussing the former 104-day calculation remain as dated evidence, not tester guidance.
