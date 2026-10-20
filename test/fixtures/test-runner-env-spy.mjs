import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const realSpawnSync = childProcess.spawnSync.bind(childProcess);

function recordChildEnvironment(phase, env) {
  const probe = realSpawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify({node: process.env.NODE_ENV, key: process.env.COMMERCE_REFERENCE_TEST_KEY}))"], {
    encoding: "utf8",
    env: env ?? process.env,
  });
  if (probe.status !== 0) throw new Error("The environment probe child failed");
  appendFileSync(process.env.RUNNER_ENV_CAPTURE, `${JSON.stringify({ phase, ...JSON.parse(probe.stdout) })}\n`);
}

childProcess.spawnSync = (_command, _args, options = {}) => {
  recordChildEnvironment("phase1", options.env);
  return { status: 0, error: undefined, signal: null, pid: 1, output: [], stdout: null, stderr: null };
};

childProcess.spawn = (_command, _args, options = {}) => {
  recordChildEnvironment("phase2", options.env);
  const child = new EventEmitter();
  child.pid = 0;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  setImmediate(() => {
    child.stdout.push(Buffer.from("# tests 1\n# pass 1\n# fail 0\n"));
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit("close", 0);
  });
  return child;
};

syncBuiltinESMExports();
