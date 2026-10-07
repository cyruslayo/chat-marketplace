// Worker bundle guard (slice 10b AC3).
//
// `node:sqlite` is a non-functional stub in workerd: bundling the Node adapter into the Worker is a latent
// production bug. This bundles the real Worker entrypoint and fails if the Node SQLite adapter — or a direct
// `node:sqlite` import — is in the graph.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FORBIDDEN_INPUT = "node-sqlite-database";
const FORBIDDEN_IMPORT = /["']node:sqlite["']/;

/** Mirrors `apps/cloudflare/vite.config.ts`: the Node adapter is replaced by a stub, never bundled (10b). */
const NODE_ADAPTER_SPECIFIER = /\/node-sqlite-database\.(ts|js)$/;
const nodeSqliteAliasPlugin = {
  name: "node-sqlite-alias",
  setup(build) {
    build.onResolve({ filter: NODE_ADAPTER_SPECIFIER }, () => ({
      path: resolve(process.cwd(), "apps/cloudflare/src/node-sqlite-stub.ts"),
    }));
  },
};

/** esbuild has no Vite `?raw` behavior; provide it so the same source the `cf build` compiles can be bundled here. */
const viteRawPlugin = {
  name: "vite-raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
      namespace: "vite-raw",
    }));
    build.onLoad({ filter: /.*/, namespace: "vite-raw" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

export async function bundleWorker(entryPoints = ["apps/cloudflare/src/worker.ts"]) {
  const result = await build({
    entryPoints,
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
    plugins: [nodeSqliteAliasPlugin, viteRawPlugin],
    // The Worker runtime provides the `cloudflare:` modules and the `node:` builtins under nodejs_compat.
    external: ["cloudflare:*", "node:*"],
  });
  return {
    metafile: result.metafile,
    output: result.outputFiles.map((file) => file.text).join("\n"),
  };
}

/** The module paths (and a direct-import marker) that must never reach the Worker bundle. */
export function forbiddenWorkerModules(metafile, output) {
  const offenders = Object.keys(metafile.inputs).filter((path) => path.includes(FORBIDDEN_INPUT));
  if (FORBIDDEN_IMPORT.test(output)) offenders.push("direct node:sqlite import");
  return offenders;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/check-worker-bundle.mjs");
if (invokedDirectly) {
  const { metafile, output } = await bundleWorker();
  const offenders = forbiddenWorkerModules(metafile, output);
  if (offenders.length > 0) {
    console.error(`Worker bundle guard failed; remove from the Worker graph: ${offenders.join(", ")}`);
    process.exit(1);
  }
  console.log("Worker bundle guard: the Worker graph carries no node:sqlite or Node SQLite adapter.");
}
