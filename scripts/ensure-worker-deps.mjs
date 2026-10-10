// Issue 16 C: the `cf` CLI finds the Cloudflare Vite plugin only in the project's own node_modules (apps/cloudflare), not in
// the repository root's. This script installs the Cloudflare app's dependencies from its committed lockfile
// (apps/cloudflare/package-lock.json) when they are missing, so a clean checkout runs `npm ci` and then any worker script.
// It never links, copies or writes a path outside the repository (docs/pilot-deployment.md).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const app = join(root, "apps", "cloudflare");
const required = [join(app, "node_modules", "@cloudflare", "vite-plugin", "package.json"), join(app, "node_modules", "vite", "package.json")];
if (required.every((file) => existsSync(file))) process.exit(0);

console.log("Installing the Cloudflare app's dependencies from apps/cloudflare/package-lock.json (npm ci --prefix apps/cloudflare).");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["ci", "--prefix", app, "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
