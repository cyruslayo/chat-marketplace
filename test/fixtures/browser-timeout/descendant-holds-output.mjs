import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const pidFile = process.argv.at(-1);
if (!pidFile) throw new Error("Expected a PID file path");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: ["ignore", 1, 2] });
if (descendant.pid === undefined) throw new Error("Expected the descendant to start");
writeFileSync(pidFile, String(descendant.pid));
process.exit(0);
