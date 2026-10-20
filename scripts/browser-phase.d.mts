export type BrowserFileStatus = "passed" | "failed" | "timed-out";

export interface TapSummary {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly skipped: number;
  readonly cancelled: number;
}

export interface BrowserFileResult {
  readonly file: string;
  readonly status: BrowserFileStatus;
  readonly exitCode: number | null;
  readonly elapsedMs: number;
  readonly summary: TapSummary | undefined;
}

export interface BrowserPhaseTotals extends TapSummary {
  readonly files: number;
  readonly passed: number;
  readonly failed: number;
  readonly timedOut: number;
}

export const BROWSER_FILE_TIMEOUT_MS: number;
export const BROWSER_FILE_TIMEOUT_ENV: string;

export function browserFileTimeoutMs(env?: NodeJS.ProcessEnv): number;
export function parseTapSummary(output: string): TapSummary | undefined;
export function browserFileStatus(options: {
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  readonly summary: TapSummary | undefined;
}): BrowserFileStatus;
export function aggregateBrowserPhase(results: readonly Pick<BrowserFileResult, "file" | "status" | "summary">[]): BrowserPhaseTotals;
export function formatBrowserPhaseTotals(totals: BrowserPhaseTotals): string[];
export function killProcessTree(pid: number): void;

export function runBrowserFile(options: {
  readonly root: string;
  readonly tsx: string;
  readonly file: string;
  readonly extra?: readonly string[];
  readonly timeoutMs: number;
  readonly log?: (message: string) => void;
}): Promise<BrowserFileResult>;

export function runBrowserFiles(options: {
  readonly root: string;
  readonly tsx: string;
  readonly files: readonly string[];
  readonly extra?: readonly string[];
  readonly timeoutMs: number;
  readonly log?: (message: string) => void;
}): Promise<BrowserFileResult[]>;
