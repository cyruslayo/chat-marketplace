import { isAbsolute, relative, sep } from "node:path";

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function relativeFile(file) {
  if (typeof file !== "string") return undefined;
  const value = isAbsolute(file) ? relative(process.cwd(), file) : file;
  return value.split(sep).join("/");
}

function sourceLocation(data) {
  if (typeof data.file !== "string") return undefined;
  const source = { file: relativeFile(data.file) };
  if (Number.isInteger(data.line) && data.line > 0) source.line = data.line;
  if (Number.isInteger(data.column) && data.column > 0) source.column = data.column;
  return source;
}

function rowFor(event) {
  if (event.type === "test:interrupted") {
    return event.data.tests
      .filter((item) => item.type !== "suite")
      .map((item) => ({
        file: relativeFile(item.file),
        name: item.name,
        status: "cancelled",
        durationMs: 0,
        ...(sourceLocation(item) ? { source: sourceLocation(item) } : {}),
      }));
  }

  if (event.type === "test:summary") {
    const summary = event.data;
    const file = relativeFile(summary.file);
    if (!file) return [];
    return [{
      file,
      kind: "summary",
      durationMs: Number.isFinite(summary.duration_ms) && summary.duration_ms >= 0 ? summary.duration_ms : 0,
      success: summary.success === true,
      counts: {
        passed: summary.counts.passed,
        failed: summary.counts.failed,
        skipped: summary.counts.skipped,
        cancelled: summary.counts.cancelled,
        ...(Number.isInteger(summary.counts.tests) ? { tests: summary.counts.tests } : {}),
        ...(Number.isInteger(summary.counts.todo) ? { todo: summary.counts.todo } : {}),
      },
    }];
  }

  if (event.type !== "test:pass" && event.type !== "test:fail") return [];
  const { data } = event;
  if (data.details.type === "suite") return [];

  const status = data.skip !== undefined || data.todo !== undefined
    ? "skip"
    : event.type === "test:fail"
      ? "fail"
      : "pass";
  const errorCode = status === "fail" ? data.details.error?.code : undefined;
  const code = typeof errorCode === "string" && FAILURE_CODE.test(errorCode) ? errorCode : undefined;
  const source = sourceLocation(data);

  return [{
    file: relativeFile(data.file),
    name: data.name,
    status,
    durationMs: Number.isFinite(data.details.duration_ms) && data.details.duration_ms >= 0
      ? data.details.duration_ms
      : 0,
    ...(code ? { code } : {}),
    ...(source ? { source } : {}),
  }];
}

// Node's built-in structured event stream avoids parsing unstable TAP or spec text.
export default async function* testRunnerReporter(source) {
  for await (const event of source) {
    for (const row of rowFor(event)) {
      if (typeof row.file !== "string" || (row.kind !== "summary" && typeof row.name !== "string")) continue;
      yield `${JSON.stringify(row)}\n`;
    }
  }
}
