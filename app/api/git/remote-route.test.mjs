import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = ["./status/route.ts", "./diff/route.ts", "../worktrees/route.ts"];

test("migrated public Git and worktree routes contain no local filesystem or subprocess execution", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /agent-rpc\/routes\/git-worktrees-instance/);
    assert.doesNotMatch(source, /from\s+["'](?:node:)?(?:fs|path|child_process)["']|git-changes|@\/lib\/worktree|file-access|rpc-manager/);
  }
});
