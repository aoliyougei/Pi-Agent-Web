import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const dialogSource = source.slice(
  source.indexOf("function ExtensionDialog("),
  source.indexOf("type ExtensionCustomRequest"),
);

// Regression: removing any one of these sizing rules lets a long confirm body
// grow the dialog past its cap and clip the fixed action row.
test("keeps long extension dialog content scrollable between fixed header and actions", () => {
  assert.match(dialogSource, /maxHeight: "min\(760px, calc\(100% - 40px\)\)"/);
  assert.match(
    dialogSource,
    /padding: 14,\s*flex: "1 1 auto",\s*minHeight: 0,\s*overflowY: "auto"/,
  );
  assert.match(dialogSource, /overflowWrap: "anywhere"/);
});

test("lets users cancel extension dialogs from the close button, Escape, or backdrop", () => {
  assert.match(
    dialogSource,
    /const cancel = useCallback\(\(\) => \{\s*onRespond\(request, \{ cancelled: true \}\);\s*\}, \[onRespond, request\]\)/,
  );
  assert.match(dialogSource, /if \(event\.target === event\.currentTarget\) cancel\(\)/);
  assert.match(dialogSource, /if \(event\.key !== "Escape"\) return/);
  assert.match(dialogSource, /event\.preventDefault\(\)/);
  assert.match(dialogSource, /event\.stopPropagation\(\)/);
  assert.match(dialogSource, /window\.addEventListener\("keydown", handleKeyDown, \{ capture: true \}\)/);
  assert.match(dialogSource, /aria-label=\{t\("chat\.close"\)\}[\s\S]*?onClick=\{cancel\}/);
  assert.match(dialogSource, /onClick=\{cancel\}[\s\S]*?\{t\("chat\.cancel"\)\}/);
});
