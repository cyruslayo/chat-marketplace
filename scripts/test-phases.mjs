// Splits the test files into the two phases that `scripts/run-tests.mjs` runs.
// Phase 1 ("concurrent") holds every file that does not drive a real Chrome. Phase 2 ("browser") holds the files that
// do: they call `launchRealBrowser` themselves or import a helper that does (for example
// test/helpers/listing-photo-browser.ts). `--non-browser` drops phase 2 and keeps phase 1 unchanged, so CI can run the
// non-browser checks alone without changing what `npm test` runs. `--browser-only` runs phase 2 alone.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const NON_BROWSER_FLAG = "--non-browser";
export const BROWSER_ONLY_FLAG = "--browser-only";
const PLAN_FLAGS = [NON_BROWSER_FLAG, BROWSER_ONLY_FLAG];

export function planTestPhases({ root, args }) {
  const nonBrowserOnly = args.includes(NON_BROWSER_FLAG);
  const browserOnly = args.includes(BROWSER_ONLY_FLAG);
  const extra = args.filter((arg) => !PLAN_FLAGS.includes(arg));
  const files = readdirSync(join(root, "test"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => `test/${name}`);
  const browserHelpers = readdirSync(join(root, "test", "helpers"))
    .filter((name) => name.endsWith(".ts") && name !== "chrome-devtools.ts" && readFileSync(join(root, "test", "helpers", name), "utf8").includes("launchRealBrowser"))
    .map((name) => `./helpers/${name.replace(/\.ts$/, ".js")}`);
  const drivesBrowser = (file) => {
    const source = readFileSync(join(root, file), "utf8");
    return /launchRealBrowser\s*\(/.test(source) || browserHelpers.some((helper) => source.includes(`"${helper}"`));
  };
  const browserFiles = files.filter(drivesBrowser);
  const concurrent = files.filter((file) => !browserFiles.includes(file));
  return { concurrent: browserOnly ? [] : concurrent, browser: nonBrowserOnly ? [] : browserFiles, extra };
}
