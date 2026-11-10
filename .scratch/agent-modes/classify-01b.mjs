import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire("file:///C:/AI2026/chat-marketplace-agent-modes-01b/package.json");
const sharp = require("sharp");
const dirs = { b1: process.argv[2], b2: process.argv[3], h: process.argv[4] };
const names = readdirSync(dirs.h).filter((n) => n.endsWith(".png")).sort();
const decode = async (p) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ data, w: info.width, h: info.height }));
// Returns { count, bbox } of differing pixels between two decoded images.
function diff(a, b) {
  if (a.w !== b.w || a.h !== b.h) return { count: -1, bbox: "size" };
  let count = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0, p = 0; i < a.data.length; i += 4, p++) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
      count++; const x = p % a.w, y = Math.floor(p / a.w);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { count, bbox: count ? `x${x0}-${x1} y${y0}-${y1}` : "" };
}
const rows = [];
for (const n of names) {
  const [b1, b2, h] = await Promise.all([decode(join(dirs.b1, n)), decode(join(dirs.b2, n)), decode(join(dirs.h, n))]);
  const noise = diff(b1, b2);
  const headVsB1 = diff(h, b1), headVsB2 = diff(h, b2);
  let cls;
  if (noise.count === 0) cls = headVsB2.count === 0 ? "identical" : "CHANGED (stable base)";
  else if (headVsB1.count === 0 || headVsB2.count === 0) cls = "noise (base unstable; head matches one base run)";
  else cls = "UNSTABLE base, head matches neither";
  rows.push(`${n}\t${cls}\tbase-noise ${noise.count}\thead-vs-b2 ${headVsB2.count} ${headVsB2.bbox}`);
}
const out = rows.join("\n") + "\n";
writeFileSync("classify-01b.tsv", out);
const tally = {};
for (const r of rows) { const c = r.split("\t")[1]; tally[c] = (tally[c] || 0) + 1; }
console.log(tally);
