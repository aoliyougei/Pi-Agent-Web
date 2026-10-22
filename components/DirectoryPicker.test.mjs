import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");
const loader = source.slice(source.indexOf("async function loadDirectories("), source.indexOf("function FolderIcon("));
function loadWith(fetch) {
  return new Function("fetch", `${ts.transpileModule(loader, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return loadDirectories;`)(fetch);
}

test("opening a missing historical directory falls back to the current backend default", async () => {
  const calls = [];
  const load = loadWith(async url => {
    calls.push(url);
    return calls.length === 1
      ? Response.json({ error: "Directory does not exist" }, { status: 404 })
      : Response.json({ path: "/home/node", directories: [] });
  });
  assert.equal((await load("/old-backend/project", true)).path, "/home/node");
  assert.deepEqual(calls, ["/api/cwd/browse?path=%2Fold-backend%2Fproject", "/api/cwd/browse"]);
  assert.match(source, /navigateTo\(initialPath \|\| undefined, true\)/);
});

test("manual navigation and non-404 failures do not silently fall back", async () => {
  for (const [status, initial] of [[404, false], [403, true], [503, true]]) {
    let calls = 0;
    const load = loadWith(async () => { calls++; return Response.json({ error: "Cannot browse" }, { status }); });
    await assert.rejects(load("/project", initial), /Cannot browse/);
    assert.equal(calls, 1);
  }
});

test("failure of the default fallback is reported without retrying indefinitely", async () => {
  let calls = 0;
  const load = loadWith(async () => { calls++; return Response.json({ error: "Directory does not exist" }, { status: 404 }); });
  await assert.rejects(load("/missing", true), /Directory does not exist/);
  assert.equal(calls, 2);
});
