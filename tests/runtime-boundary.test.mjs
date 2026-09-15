import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const excludedDirectories = new Set([".git", ".next", ".worktrees", "docs", "node_modules", "packages", "public", "scripts", "source", "tests"]);
const excludedFiles = new Set([
  "next.config.ts", // build-time reads only package metadata and static Next configuration
  "tailwind.config.ts",
]);

async function productionSources(directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(root, path);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...await productionSources(path));
    } else if (sourceExtensions.has(extname(entry.name)) && !entry.name.includes(".test.") && !excludedFiles.has(name)) {
      files.push([name, await readFile(path, "utf8")]);
    }
  }
  return files;
}

const forbidden = [
  ["Pi coding-agent runtime", /(?:from\s+|import\s*\()["']@earendil-works\/pi-coding-agent(?:["'/])/],
  ["Pi agent-core runtime", /(?:from\s+|import\s*\()["']@earendil-works\/pi-agent-core(?:["'/])/],
  ["filesystem runtime", /(?:from\s+|import\s*\(|require\s*\()["'](?:node:)?fs(?:\/promises)?["']/],
  ["process runtime", /(?:from\s+|import\s*\(|require\s*\()["'](?:node:)?child_process["']/],
  ["Agent data path", /(?:["'`])(?:\/app(?:\/|["'`])|\/home\/node\/\.pi(?:\/|["'`]))/],
  ["local Agent manager", /(?:rpc-manager|startRpcSession|getRpcSession|AgentSessionWrapper)/],
  ["local provider dispatcher", /(?:http-dispatcher|configureHttpDispatcher)/],
];

test("production Web source has no Agent SDK, data filesystem, or local execution fallback", async () => {
  const violations = [];
  for (const [name, source] of await productionSources()) {
    for (const [kind, pattern] of forbidden) {
      if (kind === "filesystem runtime" && name === "lib/agent-rpc/config.ts") continue; // fixed Secret file only
      if (pattern.test(source)) violations.push(`${name}: ${kind}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("the sole Web filesystem exception reads only a no-follow Secret descriptor", async () => {
  const source = await readFile(join(root, "lib/agent-rpc/config.ts"), "utf8");
  assert.match(source, /constants\.O_NOFOLLOW/);
  assert.match(source, /await file\.stat\(\)/);
  assert.doesNotMatch(source, /await stat\(path\)/);
  assert.equal((source.match(/from "node:fs\/promises"/g) ?? []).length, 1);
});

test("Web manifest excludes Agent-only runtime dependencies and process-spawning bins", async () => {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const name of [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "proper-lockfile",
    "undici",
    "web-push",
  ]) assert.equal(manifest.dependencies?.[name], undefined, name);
  assert.equal(manifest.dependencies?.["@aoliyougei/pi-agent-contract"], "0.1.0");
  assert.equal(manifest.bin, undefined);
});
