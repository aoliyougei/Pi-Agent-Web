import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const code = source.slice(source.indexOf("function loadLastCustomCwd("), source.indexOf("function loadUnreadSessionIds("));

test("custom directory history is isolated per backend and ignores unscoped legacy paths", () => {
  const values = new Map([["pi-web:last-custom-cwd", "/other-agent/legacy"]]);
  let backend = "default";
  const window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  const getSelectedBackendId = () => backend;
  const { loadLastCustomCwd, saveLastCustomCwd } = new Function("window", "getSelectedBackendId", "LAST_CUSTOM_CWD_STORAGE_KEY", `${ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return { loadLastCustomCwd, saveLastCustomCwd };`)(window, getSelectedBackendId, "pi-web:last-custom-cwd");
  assert.equal(loadLastCustomCwd(), "");
  saveLastCustomCwd("/agent-default/project");
  backend = "12345678-1234-1234-1234-123456789abc";
  assert.equal(loadLastCustomCwd(), "");
  saveLastCustomCwd("/agent-b/project");
  assert.equal(loadLastCustomCwd(), "/agent-b/project");
  backend = "default";
  assert.equal(loadLastCustomCwd(), "/agent-default/project");
  assert.equal(values.get("pi-web:last-custom-cwd"), "/other-agent/legacy");
});
