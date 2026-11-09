// Usage: node compare-01b.mjs <dirA> <dirB> [outFile]
// Compares same-named PNGs pixel by pixel (decoded RGBA) and reports identical, differing and one-sided files.
import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire("file:///C:/AI2026/chat-marketplace-agent-modes-01b/package.json");
const sharp = require("sharp");

const [dirA, dirB, outFile] = process.argv.slice(2);
const namesA = new Set(readdirSync(dirA).filter((n) => n.endsWith(".png")));
const namesB = new Set(readdirSync(dirB).filter((n) => n.endsWith(".png")));
const shared = [...namesA].filter((n) => namesB.has(n)).sort();
const onlyA = [...namesA].filter((n) => !namesB.has(n)).sort();
const onlyB = [...namesB].filter((n) => !namesA.has(n)).sort();

async function decode(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const identical = [];
const differing = [];
for (const name of shared) {
  const a = await decode(join(dirA, name));
  const b = await decode(join(dirB, name));
  if (a.width !== b.width || a.height !== b.height) {
    differing.push(`${name}: size ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    continue;
  }
  let count = 0;
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > 0) {
      count += 1;
      if (d > max) max = d;
    }
  }
  if (count === 0) identical.push(name);
  else differing.push(`${name}: ${count} pixels differ, max channel delta ${max}`);
}

const lines = [
  `A: ${dirA}`,
  `B: ${dirB}`,
  `shared PNGs: ${shared.length}, identical: ${identical.length}, differing: ${differing.length}`,
  `only in A: ${onlyA.length} ${onlyA.join(", ")}`,
  `only in B: ${onlyB.length} ${onlyB.join(", ")}`,
  "differing:",
  ...differing.map((line) => `  ${line}`),
];
const text = lines.join("\n") + "\n";
if (outFile) writeFileSync(outFile, text);
process.stdout.write(text);
