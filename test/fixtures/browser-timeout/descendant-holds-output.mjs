import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const pidFile = process.argv.at(-1);
if (!pidFile) throw new Error("Expected a PID file path");
const token = randomUUID();
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", `--browser-test-token=${token}`], { detached: true, stdio: ["ignore", 1, 2] });
if (descendant.pid === undefined) throw new Error("Expected the descendant to start");
writeFileSync(pidFile, JSON.stringify({ pid: descendant.pid, token }));
process.exit(0);
