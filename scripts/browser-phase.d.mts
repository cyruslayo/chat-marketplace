export type BrowserFileStatus = "passed" | "failed" | "timed-out";

export interface BrowserFileResult {
  readonly file: string;
  readonly status: BrowserFileStatus;
  readonly exitCode: number | null;
  readonly elapsedMs: number;
}

export const BROWSER_FILE_TIMEOUT_MS: number;
export const BROWSER_FILE_TIMEOUT_ENV: string;

export function browserFileTimeoutMs(env?: NodeJS.ProcessEnv): number;
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
