# Bounded test runner benchmark

The fixed selection contains nine non-browser files. It covers CPU-side Weaver runtime-budget checks, SQLite repositories and logs, local HTTP servers, and Weaver adapters. Each probe passed 51 tests with zero failures.

The benchmark used Node v22.19.0 on Windows 11 x64. The machine reported eight logical CPUs and seven workers for the runner's current non-browser default. It ran one bounded warmup, then two ordered rounds of current default, 2, 4, and 8 workers.

| Configuration | Run IDs | Durations | Median |
| --- | --- | --- | ---: |
| Current default | `92e44f6a-4e29-4d3c-b48f-342afe8e4887`, `40af4454-bfd4-4b03-a5ac-0b26a6e6f1ad` | 30,979 ms; 11,498 ms | 21,238.5 ms |
| 2 workers | `40dacc45-650f-4394-8171-7bd2e648e12e`, `768898d7-d9a3-489b-8893-0e984e0c9530` | 18,751 ms; 17,040 ms | 17,895.5 ms |
| 4 workers | `97c987ea-7965-4e57-a518-45f3f17f31d1`, `2d95ff41-e04b-4c72-8082-ba7472bc82f6` | 12,850 ms; 20,671 ms | 16,760.5 ms |
| 8 workers | `678d5229-739c-4547-905d-e433d83d4cd1`, `8571a2e9-2bcf-456d-923e-0b0ae430a0fd` | 10,278 ms; 16,635 ms | 13,456.5 ms |

The measured winner is 8 workers. Its median is 36.6% below the current default median. The two default samples vary by 19,481 ms, and the two 8-worker samples vary by 6,357 ms. The sample count follows the planned two runs per configuration, so the median result remains sensitive to timing variance.

The warmup run was `60b6d233-140a-4cef-9f60-e1fbffcc192a`. It passed 51 tests in 52,107 ms.

The measured source hashes are stored under `sourcesSha256`. The finalized source hashes are stored under `postBenchmarkSourceSha256`; the runner default and phase metadata changed after measurement. Selected-file SHA-256 hashes, environment details, all run IDs, and complete reports are in [benchmark-results.json](./benchmark-results.json) and [benchmark-runs](./benchmark-runs/).
