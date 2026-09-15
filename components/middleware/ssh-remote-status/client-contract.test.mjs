import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("./", import.meta.url);
const hook = readFileSync(new URL("useSshRemoteStatus.ts", root), "utf8");
const status = readFileSync(new URL("SshRemoteStatusBar.tsx", root), "utf8");
const files = readFileSync(new URL("useRemoteFiles.ts", root), "utf8");
const explorer = readFileSync(new URL("RemoteFileExplorer.tsx", root), "utf8");
const sidebar = readFileSync(new URL("../../SessionSidebar.tsx", root), "utf8");
const app = readFileSync(new URL("../../AppShell.tsx", root), "utf8");

// Ported from the former build-middleware contracts: assert the direct fork,
// not a patch manifest that no longer owns production code.
test("SSH status is abortable, read-only, and accessible", () => {
  assert.match(hook, /AbortController/);
  assert.doesNotMatch(hook, /setInterval/);
  assert.match(hook, /encodeURIComponent/);
  assert.match(status, /aria-expanded/);
  assert.match(status, /does not mean the SSH connection/);
  assert.doesNotMatch(status, /ssh-connect|ssh_cd|password|privateKey/);
});

test("Remote Explorer calls only fixed remote APIs and delegates file opens", () => {
  assert.match(files, /remote-files/);
  assert.match(files, /remote-file/);
  assert.doesNotMatch(files + explorer, /\/api\/files|git\/status|upload/);
  assert.match(explorer, /onOpenFile\(value, entry\.name\)/);
  assert.doesNotMatch(explorer, /absolutePath|onOpenFile\(remoteCwd/);
  assert.doesNotMatch(explorer, /setPreview|className=\{styles\.preview\}/);
});

test("direct fork selects the SSH explorer and preserves explicit remote file source", () => {
  assert.match(sidebar, /RemoteFileExplorer/);
  assert.match(sidebar, /useSshRemoteStatus/);
  assert.match(sidebar, /remoteWorkspaceMode/);
  assert.match(sidebar, /workspaceLabel/);
  assert.doesNotMatch(sidebar, /RemoteWorkspaceNotice|remoteWorkspaceLabel \?\?/);
  assert.match(app, /RemoteFileViewer/);
  assert.match(sidebar, /remoteSessionId:\s*selectedSessionId/);
  assert.match(app, /activeFileTab\.remoteSessionId/);
});
