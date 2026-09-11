#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
run_node() {
  if command -v node >/dev/null 2>&1; then
    node -
  else
    docker run --rm -i -v "$ROOT:/work:ro" -w /work node:22-alpine node -
  fi
}
run_node <<'NODE'
const fs = require("node:fs");
const pkg = require("./package.json");
if (pkg.version !== "0.8.11") throw new Error("unexpected Pi Web version");
const upstream = fs.readFileSync("UPSTREAM.md", "utf8");
for (const value of ["0.8.11", "28bab3c25f5f6770c9b0b745ebbfec1c27f7b948"]) {
  if (!upstream.includes(value)) throw new Error(`UPSTREAM.md missing ${value}`);
}
const required = [
  "app/api/sessions/[id]/ssh-environment/route.ts",
  "app/api/agent/[id]/remote-files/route.ts",
  "app/api/agent/[id]/remote-file/route.ts",
  "components/middleware/ssh-remote-status/RemoteFileExplorer.tsx",
  "lib/middleware/ssh-remote-status/workspace-model.ts",
  "components/ChatWindow.extension-dialog.test.mjs",
];
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`missing migrated feature: ${file}`);
}
const chat = fs.readFileSync("components/ChatWindow.tsx", "utf8");
for (const behavior of [
  'overflowY: "auto"',
  'window.addEventListener("keydown", handleKeyDown, { capture: true })',
  'if (event.target === event.currentTarget) cancel()',
]) {
  if (!chat.includes(behavior)) throw new Error(`missing dialog behavior: ${behavior}`);
}
NODE
printf '%s\n' "Pi Web fork baseline verification passed"
