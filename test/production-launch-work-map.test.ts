import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const efforts = ["assistant-runtime-hardening", "concierge-agent-controls", "demo-launch"];
const issues = (effort: string) => readdirSync(`.scratch/${effort}/issues`).filter(name => name.endsWith(".md"));
const status = (content: string) => content.match(/^Status: (.+)$/m)?.[1]?.split(" (")[0];
const comments = (content: string) => content.slice(content.lastIndexOf("\n## Comments") + "\n## Comments".length);

test("AC1: Every issue in assistant-runtime-hardening, concierge-agent-controls and demo-launch has a status that matches main, with a Comments entry citing the commits or tests used as evidence", () => {
  for (const effort of efforts) for (const name of issues(effort)) {
    const content = readFileSync(`.scratch/${effort}/issues/${name}`, "utf8");
    assert.match(comments(content), /[0-9a-f]{7,40}|test\//, `${effort}/${name} lacks evidence`);
    if (effort === "assistant-runtime-hardening" && Number.parseInt(name.slice(0, 2), 10) <= 6) {
      assert.equal(status(content), "ready-for-agent", `${effort}/${name} is not fully accepted`);
    }
    if (effort === "concierge-agent-controls") assert.equal(status(content), "claimed", `${effort}/${name} has an open integrated gate`);
  }
});

test("AC2: WORK-MAP.md counts match the regenerated issue inventory and include production-launch", () => {
  const map = readFileSync(".scratch/WORK-MAP.md", "utf8");
  const all = readdirSync(".scratch", { withFileTypes: true }).filter(entry => entry.isDirectory() && readdirSync(`.scratch/${entry.name}`).includes("issues"));
  let total = 0;
  for (const effort of all) {
    const counts = new Map<string, number>();
    for (const name of issues(effort.name)) {
      const value = status(readFileSync(`.scratch/${effort.name}/issues/${name}`, "utf8"));
      assert.ok(value, `missing status in ${effort.name}/${name}`);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const values = ["ready-for-agent", "ready-for-human", "needs-info", "needs-triage", "claimed", "split", "resolved"].map(key => counts.get(key) ?? 0);
    const row = `| ${effort.name} | ${values.join(" | ")} | ${issues(effort.name).length} |`;
    assert.ok(map.includes(row), `stale work-map row: ${row}`);
    total += issues(effort.name).length;
  }
  assert.match(map, /\[production launch\]\(production-launch\/map\.md\)/);
  assert.match(map, new RegExp(`\\| \\*\\*Total\\*\\* \\|[^\\n]*\\| \\*\\*${total}\\*\\* \\|`));
});

test("AC3: No tester-facing doc still says 104-day", () => {
  const testerNotes = readFileSync(".scratch/concierge-agent-controls/validation/2026-10-29/tester-readiness-and-todo.md", "utf8");
  assert.doesNotMatch(testerNotes, /104.day|104 days/i);
  assert.match(testerNotes, /119-day/);
});

test("AC4: No status is moved to resolved without evidence; anything uncertain stays open with a note", () => {
  for (const effort of efforts) for (const name of issues(effort)) {
    const path = `.scratch/${effort}/issues/${name}`;
    const content = readFileSync(path, "utf8");
    const prior = execFileSync("git", ["show", `16d592e:${path}`], { encoding: "utf8" });
    if (status(prior) !== "resolved" && status(content) === "resolved") {
      assert.match(content, /## Answer[\s\S]+/);
      assert.match(comments(content), /[0-9a-f]{7,40}|test\//);
    }
    if (status(prior) !== "resolved" && status(content) !== "resolved") {
      assert.match(comments(content), /production-launch\/01 reconciliation|Production-launch\/01 reconciliation/);
    }
  }
});
