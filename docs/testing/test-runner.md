# Test runner

Use `npm test` for the complete suite. Use `npm run test:non-browser`, `npm run test:browser`, or `npm run test:files` for focused feedback.

Use `--suite=all|non-browser|browser` to select a suite. Repeat `--file=test/name.test.ts` to select files. Add `--test-name-pattern=pattern` to select named tests. Use `--workers=2` to set non-browser file concurrency. Browser files always run sequentially.

Use `node scripts/run-tests.mjs --list` to print the selected file list as JSON lines. Each line contains a file path and its browser classification.

Each run writes a report under `.scratch/test-runs/<run-uuid>/run.json`. The report records the selection, counts, durations, phase results, failure codes, source locations, and owned process IDs. The report omits error messages, output payloads, and test-name pattern values.

Use `node scripts/run-tests.mjs --cancel=<run-uuid>` to request cancellation. The command writes a control file for that run. The live runner polls the control file and stops its owned test process tree. The cancellation command confirms the request only. Read `run.json` to see the final state after the runner stops.

If the runner stops before it writes a final report, the record stays `running`. The next test-runner command marks it `incomplete` after the owner process exits. Recovery does not signal stale process IDs.

## Measured concurrency

The runner uses eight workers for non-browser files by default. You can override this setting with `--workers=<count>`. Browser files always use one worker.

The fixed nine-file benchmark ran 51 tests with zero failures in each measured run. Its median times were:

| Configuration | Workers | Median |
| --- | ---: | ---: |
| Current default | 7 | 21,238.5 ms |
| Explicit 2 | 2 | 17,895.5 ms |
| Explicit 4 | 4 | 16,760.5 ms |
| Explicit 8 | 8 | 13,456.5 ms |

Eight workers reduced the median by 36.6% for this selection. This result does not predict full-suite time. See the [benchmark records](../../.scratch/test-runner-speed/benchmark-results.json) for the selection, environment, and samples.
