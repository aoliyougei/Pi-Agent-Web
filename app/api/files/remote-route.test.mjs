import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [
  "../cwd/browse/route.ts",
  "../cwd/validate/route.ts",
  "../default-cwd/route.ts",
  "../file-index/route.ts",
  "./[...path]/route.ts",
  "../agent/[id]/bash-output/route.ts",
];

test("migrated public file routes contain no local filesystem, process, or Runtime execution", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'](?:node:)?(?:fs|path|child_process)["']|rpc-manager|session-reader|directory-browser|file-access|file-upload/);
    assert.match(source, /agent-rpc\/routes/);
  }
});

test("public upload retains browser request validation before remote delivery", async () => {
  const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
  const validation = source.indexOf("isApiRequestAllowed(request)");
  const delivery = source.indexOf("remoteFileRoutes.FILES(request, context)");
  assert.ok(validation >= 0 && delivery > validation);
});
