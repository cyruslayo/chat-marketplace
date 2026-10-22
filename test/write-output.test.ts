import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeOutput } from "../scripts/write-output.mjs";

test("Generated output reports a missing destination directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "missing-output-"));
  try {
    await assert.rejects(writeOutput(join(directory, "missing", "output.txt"), "bytes"), { code: "ENOENT" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Generated output waits for a transient Windows memory-mapped file and writes the requested bytes", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "mapped-output-"));
  const path = join(directory, "output.txt");
  const releasePath = join(directory, "release");
  writeFileSync(path, "old output");
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; $map=[System.IO.MemoryMappedFiles.MemoryMappedFile]::CreateFromFile($env:OUTPUT_TEST_PATH,[System.IO.FileMode]::Open); $view=$map.CreateViewAccessor(); [Console]::WriteLine('mapped'); [Console]::Out.Flush(); $deadline=[datetime]::UtcNow.AddSeconds(10); while (!(Test-Path -LiteralPath $env:OUTPUT_TEST_RELEASE) -and [datetime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 20 }; $view.Dispose(); $map.Dispose()"], {
    env: { ...process.env, OUTPUT_TEST_PATH: path, OUTPUT_TEST_RELEASE: releasePath }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
      child.once("exit", (code) => { if (code !== 0) reject(new Error("Memory-map fixture failed")); });
    });
    assert.throws(() => writeFileSync(path, "new"), "the fixture reproduces the Windows overwrite failure");
    setTimeout(() => writeFileSync(releasePath, "release"), 250);
    await writeOutput(path, "new");
    assert.equal(readFileSync(path, "utf8"), "new");
  } finally {
    writeFileSync(releasePath, "release");
    await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
    rmSync(directory, { recursive: true, force: true });
  }
});
