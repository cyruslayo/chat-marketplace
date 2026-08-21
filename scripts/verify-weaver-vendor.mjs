import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const artifacts = [
  {
    url: new URL("../vendor/weaver/weaver-core-0.1.2.tgz", import.meta.url),
    sha256: "86dd3c398b6ee050860c0f9e55af34298d216260f5cf1d3f2dcb0579abaa18d2",
  },
  {
    url: new URL("../vendor/weaver/weaver-web-0.1.2.tgz", import.meta.url),
    sha256: "692228d9be5595d43c0916cd7bf015dbfb7fffd14851f0a2392e48a57ddd2e79",
  },
];

async function calculateSha256(url) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(url)) hash.update(chunk);
  return hash.digest("hex");
}

for (const artifact of artifacts) {
  const path = fileURLToPath(artifact.url);
  try {
    await access(artifact.url);
  } catch {
    console.error(`Missing Weaver artifact: ${path}`);
    process.exitCode = 1;
    continue;
  }

  const actual = await calculateSha256(artifact.url);
  if (actual !== artifact.sha256) {
    console.error(`Weaver artifact hash mismatch: ${path}`);
    process.exitCode = 1;
  }
}

if (process.exitCode !== 1) console.log("Verified Weaver vendor artifacts.");
