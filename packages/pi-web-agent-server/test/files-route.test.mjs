import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createAgentServer } from "../dist/server.js";

const token = "files-route-token";
const root = mkdtempSync(join(tmpdir(), "pi-files-route-"));
const defaultRoot = join(root, "defaults");
process.env.PI_WEB_DEFAULT_CWD_ROOT = defaultRoot;
mkdirSync(join(root, "alpha"));
mkdirSync(join(root, "beta"));
writeFileSync(join(root, "note.txt"), "note");

async function start(t) {
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  return `http://127.0.0.1:${app.address().port}`;
}

async function raw(base, path, init = {}) {
  return fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init.headers },
  });
}

async function request(base, path, init = {}) {
  const response = await raw(base, path, init);
  return { status: response.status, body: await response.json() };
}

function filePath(path) {
  return "/internal/v1/api/files/" + path.split(/[\\/]/).filter(Boolean).map(encodeURIComponent).join("/");
}

test("internal cwd browse lists only directories and reports its parent", async (t) => {
  const base = await start(t);
  const result = await request(base, `/internal/v1/api/cwd/browse?path=${encodeURIComponent(root)}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.path, root);
  assert.equal(result.body.parentPath, tmpdir());
  assert.deepEqual(result.body.directories.map(({ name }) => name), ["alpha", "beta"]);
});

test("internal cwd validation normalizes a directory and allows it for file access", async (t) => {
  const base = await start(t);
  const result = await request(base, "/internal/v1/api/cwd/validate", { method: "POST", body: JSON.stringify({ cwd: root }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.cwd, root);
  assert.equal(result.body.projectRoot, root);
  assert.equal(typeof result.body.projectKey, "string");
  const { getAdditionalAllowedRoots } = await import("../dist/dependencies/allowed-roots.js");
  assert.equal(getAdditionalAllowedRoots().has(root), true);

  const file = await request(base, "/internal/v1/api/cwd/validate", { method: "POST", body: JSON.stringify({ cwd: join(root, "note.txt") }) });
  assert.equal(file.status, 400);
  assert.equal(file.body.error, `Path is not a directory: ${join(root, "note.txt")}`);
});

test("internal default cwd creates and allows the dated directory", async (t) => {
  const base = await start(t);
  const result = await request(base, "/internal/v1/api/default-cwd", { method: "POST" });
  assert.equal(result.status, 200);
  assert.match(result.body.cwd, new RegExp(`^${defaultRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pi-cwd-\\d{8}$`));
  const { getAdditionalAllowedRoots } = await import("../dist/dependencies/allowed-roots.js");
  assert.equal(getAdditionalAllowedRoots().has(result.body.cwd), true);
});

test("internal files list, read and range-stream only an allowed real path", async (t) => {
  const outside = mkdtempSync(join(tmpdir(), "pi-files-outside-"));
  writeFileSync(join(root, "alpha", "hello.txt"), "hello world");
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(outside, join(root, "escape"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const base = await start(t);
  await request(base, "/internal/v1/api/cwd/validate", { method: "POST", body: JSON.stringify({ cwd: root }) });

  const listing = await request(base, `${filePath(root)}?type=list`);
  assert.equal(listing.status, 200);
  assert.equal(listing.body.path, root);
  assert.deepEqual(listing.body.entries.map(({ name }) => name), ["alpha", "beta", "defaults", "escape", "note.txt"]);

  const text = await request(base, `${filePath(join(root, "alpha", "hello.txt"))}?type=read`);
  assert.deepEqual(text, { status: 200, body: { content: "hello world", language: "text", size: 11 } });

  const ranged = await raw(base, `${filePath(join(root, "alpha", "hello.txt"))}?type=download`, { headers: { range: "bytes=1-4" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 1-4/11");
  assert.equal(ranged.headers.get("accept-ranges"), "bytes");
  assert.equal(await ranged.text(), "ello");

  assert.equal((await request(base, `${filePath(join(outside, "secret.txt"))}?type=read`)).status, 403);
  assert.equal((await request(base, `${filePath(join(root, "escape", "secret.txt"))}?type=read`)).status, 403);
  assert.equal((await request(base, `${filePath(root + "-collision")}?type=list`)).status, 403);
});

test("internal files render bounded DOCX previews and reject final symlink reads", async (t) => {
  const document = join(root, "alpha", "document.docx");
  copyFileSync(new URL("../../../node_modules/mammoth/test/test-data/single-paragraph.docx", import.meta.url), document);
  writeFileSync(join(root, "alpha", "target.txt"), "inside");
  symlinkSync("target.txt", join(root, "alpha", "linked.txt"));
  const base = await start(t);
  await request(base, "/internal/v1/api/cwd/validate", { method: "POST", body: JSON.stringify({ cwd: root }) });

  const preview = await raw(base, `${filePath(document)}?type=preview`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(preview.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await preview.text(), /<main>/);

  const linked = await request(base, `${filePath(join(root, "alpha", "linked.txt"))}?type=read`);
  assert.equal(linked.status, 404);
  assert.equal(linked.body.error, "Not found");
});

test("internal files preserve metadata, preview limits, and replacement watch events", async (t) => {
  const watched = join(root, "alpha", "watched.txt");
  writeFileSync(watched, "first");
  const oversized = join(root, "alpha", "oversized.txt");
  writeFileSync(oversized, Buffer.alloc(256 * 1024 + 1, 65));
  const invalidUtf8 = join(root, "alpha", "invalid.txt");
  writeFileSync(invalidUtf8, Buffer.from([0x66, 0x80, 0x6f]));
  const oversizedImage = join(root, "alpha", "oversized.png");
  writeFileSync(oversizedImage, Buffer.alloc(10 * 1024 * 1024 + 1));
  const base = await start(t);
  await request(base, "/internal/v1/api/cwd/validate", { method: "POST", body: JSON.stringify({ cwd: root }) });

  const meta = await request(base, `${filePath(watched)}?type=meta`);
  assert.deepEqual(meta, { status: 200, body: { size: 5, language: "text", mime: "text/plain", previewKind: null } });
  const tooLarge = await request(base, `${filePath(oversized)}?type=read`);
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error, "File too large for preview (>256KB)");
  const invalid = await request(base, `${filePath(invalidUtf8)}?type=read`);
  assert.deepEqual(invalid.body, { content: "f�o", language: "text", size: 3 });
  const image = await request(base, `${filePath(oversizedImage)}?type=read`);
  assert.equal(image.status, 413);
  assert.equal(image.body.error, "Image too large (>10MB)");

  const response = await raw(base, `${filePath(watched)}?type=watch`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = decoder.decode((await reader.read()).value);
  assert.match(received, /event: connected/);
  writeFileSync(watched, "second");
  const deadline = Date.now() + 2000;
  while (!received.includes("event: change") && Date.now() < deadline) {
    const next = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 100))]);
    if (next.timeout) continue;
    received += decoder.decode(next.value);
  }
  assert.match(received, /event: change/);
  await reader.cancel();
});

test("internal file index lists and searches an authorized real Git repository", async (t) => {
  const repository = join(root, "repository");
  mkdirSync(join(repository, "src"), { recursive: true });
  writeFileSync(join(repository, "src", "ChatInput.tsx"), "input");
  writeFileSync(join(repository, "README.md"), "readme");
  execFileSync("git", ["init", "-q", repository]);
  execFileSync("git", ["-C", repository, "add", "."]);
  const base = await start(t);
  await request(base, "/internal/v1/api/cwd/validate", { method: "POST", body: JSON.stringify({ cwd: repository }) });

  const listing = await request(base, `/internal/v1/api/file-index?cwd=${encodeURIComponent(repository)}`);
  assert.deepEqual(listing, { status: 200, body: { files: ["README.md", "src/ChatInput.tsx"], truncated: false } });
  const search = await request(base, `/internal/v1/api/file-index?cwd=${encodeURIComponent(repository)}&q=chinp`);
  assert.deepEqual(search, { status: 200, body: { matches: [{ path: "src/ChatInput.tsx", isDir: false }] } });
  assert.equal((await request(base, `/internal/v1/api/file-index?cwd=${encodeURIComponent(root + "-collision")}`)).status, 403);
});

test("internal upload validates names and conflict strategies before writing", async (t) => {
  const directory = join(root, "alpha");
  writeFileSync(join(directory, "existing.txt"), "old");
  symlinkSync("existing.txt", join(directory, "link.txt"));
  const base = await start(t);
  await request(base, "/internal/v1/api/cwd/validate", { method: "POST", body: JSON.stringify({ cwd: root }) });
  const endpoint = filePath(directory);

  let result = await request(base, `${endpoint}?type=upload-check`, { method: "POST", body: JSON.stringify({ fileNames: ["existing.txt", "new.txt"] }) });
  assert.deepEqual(result, { status: 200, body: { conflicts: ["existing.txt"], nonReplaceable: [] } });
  result = await request(base, `${endpoint}?type=upload-check`, { method: "POST", body: JSON.stringify({ fileNames: ["same.txt", "same.txt"] }) });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /Duplicate/);

  const upload = new FormData();
  upload.append("files", new File(["new"], "new.txt"));
  upload.append("files", new File(["replace"], "existing.txt"));
  const response = await raw(base, `${endpoint}?type=upload&conflict=skip`, { method: "POST", body: upload });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { uploaded: ["new.txt"], skipped: ["existing.txt"], errors: [] });

  const replaceLink = new FormData();
  replaceLink.append("files", new File(["bad"], "link.txt"));
  const refused = await raw(base, `${endpoint}?type=upload&conflict=overwrite`, { method: "POST", body: replaceLink });
  assert.equal(refused.status, 207);
  assert.deepEqual(await refused.json(), { uploaded: [], skipped: [], errors: [{ name: "link.txt", error: "Cannot replace a directory or symbolic link" }] });
});

test("persisted bash output routing does not require a Runtime adapter", async (t) => {
  const base = await start(t);
  const missing = await request(base, "/internal/v1/api/agent/00000000-0000-0000-0000-000000000000/bash-output?path=%2Ftmp%2Fpi-bash-missing.log");
  assert.equal(missing.status, 403);
  assert.deepEqual(missing.body, { error: "forbidden" });
});

test.after(() => rmSync(root, { recursive: true, force: true }));
