export declare const NON_BROWSER_FLAG: "--non-browser";
export declare const BROWSER_ONLY_FLAG: "--browser-only";

export interface TestPhasePlan {
  /** Test files run together in phase 1 (no real Chrome). Empty with `--browser-only`. */
  readonly concurrent: readonly string[];
  /** Test files run one at a time in phase 2 (real Chrome). Empty with `--non-browser`. */
  readonly browser: readonly string[];
  /** Arguments other than the plan flags, forwarded to `node --test`. */
  readonly extra: readonly string[];
}

export declare function planTestPhases(options: { root: string; args: readonly string[] }): TestPhasePlan;
