export type RunState = "running" | "passed" | "failed" | "cancelled" | "incomplete";
export type FinalRunState = Exclude<RunState, "running">;
export type FileState = Exclude<FinalRunState, "cancelled"> | "cancelled";
export interface Counts {
  passed: number;
  failed: number;
  skipped: number;
  cancelled: number;
}
export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}
export interface TestResultRow {
  file: string;
  name?: string;
  status?: "pass" | "fail" | "skip" | "cancelled";
  durationMs?: number;
  kind?: "summary";
  success?: boolean;
  counts?: Counts & { todo?: number; tests?: number };
  code?: string;
  source?: SourceLocation;
  error?: unknown;
}
export interface FailureRecord {
  name: string;
  code?: string;
  source?: SourceLocation;
}
export interface FileRecord {
  file: string;
  state: FileState;
  durationMs: number;
  exitCode: number;
  counts: Counts;
  failures: FailureRecord[];
}
export interface PhaseRecord {
  suite: "non-browser" | "browser";
  selectedFiles: string[];
  workers: number;
  durationMs: number;
  exitCode: number;
  state: FinalRunState;
  childPid?: number;
}
export interface RunRecord {
  schemaVersion: 1;
  run: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationMs: number;
    command: string[];
    selectedFiles: string[];
    workerDefaults: { nonBrowser: number; source: string };
    owner: { pid: number; childPids: number[] };
    phases: PhaseRecord[];
    state: RunState;
    exitCode: number | null;
  };
  counts: Counts;
  files: FileRecord[];
}
export interface BenchmarkSample {
  durationMs: number;
  exitCode: number;
  failures: number;
}
export interface BenchmarkConfiguration {
  id: string;
  workers: number;
  samples: BenchmarkSample[];
}
export interface BenchmarkDecision {
  selectedId: string;
  workers?: number;
  medianMs?: number;
  reason: string;
}

export function createRunRecord(options?: {
  runId?: string;
  startedAt?: string;
  command?: string[];
  selectedFiles?: string[];
  ownerPid?: number;
  workerDefaults?: { nonBrowser: number; source: string };
}): RunRecord;
export function recordPhaseResult(record: RunRecord, phase: {
  suite: "non-browser" | "browser";
  selectedFiles?: string[];
  workers: number;
  durationMs?: number;
  exitCode?: number;
  state?: FinalRunState;
  childPid?: number;
}): PhaseRecord;
export function recordFileResult(record: RunRecord, file: string, rows?: TestResultRow[], options?: {
  exitCode?: number;
  durationMs?: number;
  state?: FileState;
  childPid?: number;
}): FileRecord;
export function finalizeRunRecord(record: RunRecord, options?: {
  exitCode?: number;
  state?: FinalRunState;
  endedAt?: string;
  elapsedMs?: number;
  durationMs?: number;
}): RunRecord;
export function chooseBenchmarkWinner(configurations: BenchmarkConfiguration[], defaultId: string): BenchmarkDecision;
export function recoverStaleRunRecord(record: RunRecord, options?: {
  isProcessAlive?: (pid: number) => boolean;
  endedAt?: string;
}): RunRecord;
