import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);

test("browser cookies independently select backends and reject malformed selection", async () => {
  const { backendIdFromCookie, backendStorageKey } = await jiti.import("./agent-backend-selection.ts");
  const id = "12345678-1234-1234-1234-123456789abc";
  assert.equal(backendIdFromCookie(`other=x; pi-web-agent-backend=${id}`), id);
  assert.equal(backendIdFromCookie("pi-web-agent-backend=default"), "default");
  assert.equal(backendIdFromCookie(""), "default");
  assert.equal(backendIdFromCookie("pi-web-agent-backend=../x"), "invalid");
  assert.equal(backendStorageKey("workspace", "default"), "workspace");
  assert.equal(backendStorageKey("workspace", id), `workspace:${id}`);
});

test("a stale tab blocks fetch before sending commands to a newly selected backend", async () => {
  const { guardBackendFetch } = await jiti.import("./agent-backend-selection.ts");
  const previousDocument = globalThis.document;
  let sent = false;
  globalThis.document = { cookie: "pi-web-agent-backend=12345678-1234-1234-1234-123456789abc" };
  try {
    const guarded = guardBackendFetch("default", async () => { sent = true; return new Response(); });
    await assert.rejects(guarded("/api/agent/session", { method: "POST" }), /Backend selection changed/);
    assert.equal(sent, false);
  } finally { globalThis.document = previousDocument; }
});

test("selection saves only an id and navigates without previous session or cwd", async () => {
  const { selectBackend } = await jiti.import("./agent-backend-selection.ts");
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let target;
  globalThis.window = { location: { protocol: "https:", pathname: "/", assign: (url) => { target = url; } } };
  globalThis.document = { cookie: "" };
  try {
    selectBackend("default");
    assert.match(document.cookie, /^pi-web-agent-backend=default; Path=\/; SameSite=Strict; Max-Age=31536000; Secure$/);
    assert.equal(target, "/");
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
