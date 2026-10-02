import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
const log = createWriteStream(".scratch/guest-ui-consistency/walkthrough-06.log");
const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", ".scratch/guest-ui-consistency/walkthrough.ts"], { env: { ...process.env, NODE_ENV: "test" } });
child.stdout.pipe(log);
child.stderr.pipe(log);
console.log(`Walkthrough launcher PID: ${process.pid}; child PID: ${child.pid}`);
