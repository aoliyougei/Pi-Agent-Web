import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../packages/pi-web-agent-server/src/routes/files.ts", import.meta.url), "utf8");
const start = source.indexOf('if (type === "watch")');
const end = source.indexOf('if (!stat?.isFile())', start);
assert.notEqual(start, -1, "Agent watch route not found");
assert.notEqual(end, -1, "Agent watch route end not found");
const watchBlock = source.slice(start, end);

test("Agent-owned file watching survives same-path replacement", () => {
  assert.match(watchBlock, /watch\(dirname\(file\)/);
  assert.match(watchBlock, /samePath\(join\(dirname\(file\), changed\.toString\(\)\), file\)/);
  assert.match(watchBlock, /next\.ctimeMs === lastCtimeMs/);
  assert.match(watchBlock, /next\.ino === lastIno/);
  assert.match(watchBlock, /exists/);
});

test("Agent-owned watch authorizes a missing target through its parent", () => {
  assert.match(source, /isExistingFilePathAllowed\(stat \? file : dirname\(file\), roots\)/);
  assert.match(watchBlock, /exists = !!stat/);
  assert.match(watchBlock, /sendEvent\("connected"/);
});

test("Agent-owned watcher closes when the browser stream closes", () => {
  assert.match(watchBlock, /request\.once\("aborted", close\)/);
  assert.match(watchBlock, /response\.once\("close", close\)/);
});
