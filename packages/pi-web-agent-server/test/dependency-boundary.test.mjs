import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const dependencyRoot = join(packageRoot, "src/dependencies");
const expected = readFileSync(join(dependencyRoot, "README.md"), "utf8")
  .match(/Agent-owned modules:\n\n```text\n([\s\S]*?)\n```/)[1]
  .trim().split("\n");

function filesUnder(root) {
  const result = [];
  for (const name of readdirSync(root)) {
    const file = join(root, name);
    if (statSync(file).isDirectory()) result.push(...filesUnder(file));
    else if (/\.(?:ts|tsx)$/.test(name)) result.push(file);
  }
  return result;
}

test("contains every reviewed Agent runtime dependency", () => {
  for (const file of expected) assert.ok(existsSync(join(dependencyRoot, file)), `missing ${file}`);
});

test("Agent runtime dependencies are package-local and framework-free", () => {
  for (const file of filesUnder(dependencyRoot)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from ["'](?:next(?:\/|["'])|react(?:\/|["']))/, relative(packageRoot, file));
    assert.doesNotMatch(source, /from ["']@\//, relative(packageRoot, file));
    for (const match of source.matchAll(/from ["'](\.\.?\/[^"']+)["']/g)) {
      assert.ok(resolve(dirname(file), match[1]).startsWith(packageRoot), `${relative(packageRoot, file)} escapes package`);
    }
  }
});
