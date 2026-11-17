import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Ratchet for docs/agents/state-machines.md (issue 02). Every exported lifecycle union or
// `as const` state array in the scanned folders must be named (in backticks) in the map, and
// every name the map lists must still exist. Names that match the pattern but are not
// lifecycles go in ALLOW_LIST, each with a reason. Commerce paths are skipped (not shipping).

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const mapPath = "docs/agents/state-machines.md";
const scannedFolders = [
  "domains/shortlet/src",
  "packages/platform-core/src",
  "apps/local-guest/src",
  "apps/web-agent/src",
] as const;

const LIFECYCLE_SUFFIX = "(?:Status|Stage|State|Lifecycle|Mode)";
const STATE_ARRAY_SUFFIX = "(?:STATUSES|STATES|STAGES)";

const typeDeclaration = new RegExp(
  String.raw`export\s+type\s+(\w*${LIFECYCLE_SUFFIX})\s*=\s*(?:\|\s*)?(?:"|\(typeof\s+\w+\)\[number\])`,
  "g",
);
const arrayDeclaration = new RegExp(
  String.raw`export\s+const\s+([A-Z][A-Z0-9_]*_${STATE_ARRAY_SUFFIX})\s*=\s*\[[^\]]*\]\s*as\s+const`,
  "g",
);
const mentionPattern = new RegExp(
  `^(?:[A-Z]\\w*${LIFECYCLE_SUFFIX}|[A-Z][A-Z0-9_]*_${STATE_ARRAY_SUFFIX})$`,
);

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface LifecycleName {
  readonly name: string;
  readonly path: string;
}

export interface AllowEntry {
  readonly name: string;
  readonly reason: string;
}

export interface InventoryReport {
  readonly missingFromMap: LifecycleName[];
  readonly staleInMap: string[];
  readonly staleAllowList: string[];
}

// Names that match the lifecycle pattern but are not lifecycles the system moves between states.
const ALLOW_LIST: readonly AllowEntry[] = [
  {
    name: "PresentationMode",
    reason: "Layout mode of a surface (text, inline, focused) in the conversational shell; a display setting, not a stored lifecycle.",
  },
  {
    name: "ConciergeMode",
    reason: "Deployment switch for the concierge model path (deterministic, gemini, openai-compatible); configuration, not a booking lifecycle.",
  },
  {
    name: "VisitorMode",
    reason: "Guest-conduct rule value (prohibited, or registered 8am to 10pm visitors); a policy setting that does not move between states.",
  },
  {
    name: "JourneyStepState",
    reason: "View state of one step on the journey rail (done, current, failed, upcoming), computed on render and never stored.",
  },
  {
    name: "AssistantDiagnosticStage",
    reason: "Closed label for assistant diagnostic log events; logs carry ids and transitions only (ADR 0075), so the label is not a held state.",
  },
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function findLifecycleTypes(sources: readonly SourceFile[]): LifecycleName[] {
  const found: LifecycleName[] = [];
  for (const source of sources) {
    const filePath = normalizePath(source.path);
    if (filePath.toLowerCase().includes("commerce")) continue;
    for (const match of source.text.matchAll(typeDeclaration)) {
      found.push({ name: match[1], path: filePath });
    }
    for (const match of source.text.matchAll(arrayDeclaration)) {
      found.push({ name: match[1], path: filePath });
    }
  }
  return found;
}

export function mentionedLifecycleNames(markdown: string): string[] {
  const names = new Set<string>();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    if (mentionPattern.test(match[1])) names.add(match[1]);
  }
  return [...names].sort();
}

export function compareInventory(
  found: readonly LifecycleName[],
  mapNames: readonly string[],
  allowList: readonly AllowEntry[],
): InventoryReport {
  const mapped = new Set(mapNames);
  const allowed = new Set(allowList.map((entry) => entry.name));
  const foundNames = new Set(found.map((item) => item.name));
  const missingFromMap = found
    .filter((item) => !mapped.has(item.name) && !allowed.has(item.name))
    .sort((a, b) => (a.path === b.path ? a.name.localeCompare(b.name) : a.path.localeCompare(b.path)));
  return {
    missingFromMap,
    staleInMap: mapNames.filter((name) => !foundNames.has(name)).sort(),
    staleAllowList: allowList.map((entry) => entry.name).filter((name) => !foundNames.has(name)).sort(),
  };
}

async function collectTypeScriptFiles(directory: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "test" || entry.name === "dist") continue;
      await collectTypeScriptFiles(file, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(file);
    }
  }
  return out;
}

async function repositorySources(): Promise<SourceFile[]> {
  const sources: SourceFile[] = [];
  for (const folder of scannedFolders) {
    for (const file of await collectTypeScriptFiles(path.join(repositoryRoot, folder))) {
      sources.push({
        path: path.relative(repositoryRoot, file),
        text: await readFile(file, "utf8"),
      });
    }
  }
  return sources;
}

test("AC1: An exported lifecycle union missing from the map fails the test, naming the file and the type", () => {
  const sources: SourceFile[] = [
    {
      path: "domains/shortlet/src/widget-lifecycle.ts",
      text: `export type WidgetStatus = "open" | "closed";`,
    },
    {
      path: "apps/local-guest/src/gadget-state.ts",
      text: `export const GADGET_STATES = ["idle", "busy"] as const;\nexport type GadgetState = (typeof GADGET_STATES)[number];`,
    },
  ];

  const report = compareInventory(findLifecycleTypes(sources), [], []);

  assert.deepEqual(report.missingFromMap, [
    { name: "GADGET_STATES", path: "apps/local-guest/src/gadget-state.ts" },
    { name: "GadgetState", path: "apps/local-guest/src/gadget-state.ts" },
    { name: "WidgetStatus", path: "domains/shortlet/src/widget-lifecycle.ts" },
  ]);
  assert.deepEqual(report.staleInMap, []);
});

test("AC2: A map entry for a type that no longer exists in the scanned code fails the test", () => {
  const sources: SourceFile[] = [
    {
      path: "apps/local-guest/src/live.ts",
      text: `export type LiveStatus = "on" | "off";`,
    },
  ];
  const mapNames = mentionedLifecycleNames(
    "| Live | `LiveStatus` | `RetiredStatus` | `booking-request.ts` |",
  );

  const report = compareInventory(findLifecycleTypes(sources), mapNames, []);

  assert.deepEqual(mapNames, ["LiveStatus", "RetiredStatus"]);
  assert.deepEqual(report.staleInMap, ["RetiredStatus"]);
  assert.deepEqual(report.missingFromMap, []);
});

test("AC3: The test passes on this branch once issue 01's map is complete", async () => {
  const found = findLifecycleTypes(await repositorySources());
  const mapNames = mentionedLifecycleNames(readFileSync(path.join(repositoryRoot, mapPath), "utf8"));

  const report = compareInventory(found, mapNames, ALLOW_LIST);

  assert.deepEqual(report.missingFromMap, []);
  assert.deepEqual(report.staleInMap, []);
  assert.deepEqual(report.staleAllowList, []);
});

test("Paths containing commerce are skipped by the scan", () => {
  const sources: SourceFile[] = [
    {
      path: "apps/web-agent/src/commerce-presentation.ts",
      text: `export type CommerceCheckoutStatus = "proposed" | "payment_started";`,
    },
  ];

  assert.deepEqual(findLifecycleTypes(sources), []);
});
