import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-files-parity-"));
const external = mkdtempSync(join(tmpdir(), "pi-files-external-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { createAgentServer } = await import("../../packages/pi-web-agent-server/dist/server.js");
const jiti = createJiti(import.meta.url);
const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
const { createRemoteFileRoutes } = await jiti.import("../../lib/agent-rpc/routes/files.ts");
const { createRemoteAgentRoutes } = await jiti.import("../../lib/agent-rpc/routes/agent.ts");
const token = "files-parity-token";

const filePath = (path) => "/internal/v1/api/files/" + path.split(/[\\/]/).filter(Boolean).map(encodeURIComponent).join("/");
const context = (path) => ({ params: Promise.resolve({ path: path.split(/[\\/]/).filter(Boolean) }) });

function comparable(response, body) {
  const headers = {};
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "cache-control", "content-security-policy", "referrer-policy", "x-content-type-options"]) {
    if (response.headers.has(name)) headers[name] = response.headers.get(name);
  }
  return { status: response.status, headers, body };
}

async function snapshot(response) {
  return comparable(response, new Uint8Array(await response.arrayBuffer()));
}

test("file/cwd/index/upload/bash BFF responses equal authenticated Agent responses", async (t) => {
  const externalFile = join(external, "referenced.txt");
  const bashFile = join(tmpdir(), `pi-bash-parity-${process.pid}.log`);
  writeFileSync(join(root, "alpha.txt"), "alpha");
  copyFileSync(join(process.cwd(), "node_modules/mammoth/test/test-data/single-paragraph.docx"), join(root, "document.docx"));
  writeFileSync(externalFile, "external");
  writeFileSync(bashFile, "bash output");
  const manager = SessionManager.create(root);
  manager.appendMessage({ role: "user", content: `Read ${externalFile}`, timestamp: Date.now() });
  manager.appendMessage({ role: "bashExecution", command: "printf parity", output: "bash output", exitCode: 0, cancelled: false, truncated: false, fullOutputPath: bashFile, timestamp: Date.now() });
  const id = manager.getSessionId();
  const sessionFile = manager.getSessionFile();
  mkdirSync(dirname(sessionFile), { recursive: true });
  writeFileSync(sessionFile, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
    rmSync(bashFile, { force: true });
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const send = createAgentClient({ baseUrl: base, token }).fetch;
  const files = createRemoteFileRoutes(send);
  const agents = createRemoteAgentRoutes(send);
  const auth = { authorization: `Bearer ${token}` };

  await files.VALIDATE(new Request("http://web/api/cwd/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: root }) }));
  const cases = [
    [`${filePath(root)}?type=list`, () => files.FILES(new Request(`http://web/api/files/${basename(root)}?type=list`), context(root))],
    [`${filePath(join(root, "alpha.txt"))}?type=read`, () => files.FILES(new Request("http://web/api/files/alpha.txt?type=read"), context(join(root, "alpha.txt")))],
    [`${filePath(join(root, "alpha.txt"))}?type=meta`, () => files.FILES(new Request("http://web/api/files/alpha.txt?type=meta"), context(join(root, "alpha.txt")))],
    [`${filePath(join(root, "alpha.txt"))}?type=download`, () => files.FILES(new Request("http://web/api/files/alpha.txt?type=download", { headers: { range: "bytes=1-3" } }), context(join(root, "alpha.txt"))), { range: "bytes=1-3" }],
    [`${filePath(join(root, "document.docx"))}?type=preview`, () => files.FILES(new Request("http://web/api/files/document.docx?type=preview"), context(join(root, "document.docx")))],
    [`${filePath(externalFile)}?type=read&sessionId=${id}`,  () => files.FILES(new Request(`http://web/api/files/referenced.txt?type=read&sessionId=${id}`), context(externalFile))],
    [`/internal/v1/api/file-index?cwd=${encodeURIComponent(root)}&q=alpha`, () => files.INDEX(new Request(`http://web/api/file-index?cwd=${encodeURIComponent(root)}&q=alpha`))],
    [`/internal/v1/api/agent/${id}/bash-output?path=${encodeURIComponent(bashFile)}`, () => agents.BASH_OUTPUT(new Request(`http://web/api/agent/${id}/bash-output?path=${encodeURIComponent(bashFile)}`), { params: Promise.resolve({ id }) })],
  ];
  for (const [path, throughBff, extraHeaders = {}] of cases) {
    const expected = await snapshot(await fetch(base + path, { headers: { ...auth, ...extraHeaders } }));
    const actual = await snapshot(await throughBff());
    assert.deepEqual(actual, expected, path);
  }

  const boundary = "parity-boundary";
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="upload.txt"\r\nContent-Type: text/plain\r\n\r\nuploaded\r\n--${boundary}--\r\n`;
  const uploadPath = `${filePath(root)}?type=upload&conflict=overwrite`;
  const init = { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
  const expected = await snapshot(await fetch(base + uploadPath, { ...init, headers: { ...auth, ...init.headers } }));
  const actual = await snapshot(await files.FILES(new Request("http://web/api/files/root?type=upload&conflict=overwrite", init), context(root)));
  assert.deepEqual(actual, expected);
});
