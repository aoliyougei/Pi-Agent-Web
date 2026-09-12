import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "../client.ts";

const { createRemoteFileRoutes } = await createJiti(import.meta.url).import("./files.ts");

async function fixture(t) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (req.url.includes("type=download")) {
      res.writeHead(206, {
        "content-type": "application/octet-stream", "content-length": "3", "content-range": "bytes 1-3/5", "accept-ranges": "bytes",
        "content-disposition": "attachment; filename=\"file.bin\"", "cache-control": "no-cache", "x-content-type-options": "nosniff", "set-cookie": "secret=1",
      }).end("bcd");
    } else {
      res.writeHead(200, { "content-type": "application/json", "x-private": "secret" }).end('{"ok":true}');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { seen, routes: createRemoteFileRoutes(createAgentClient({ baseUrl, token: "service-token" }).fetch) };
}

const filesContext = (path) => ({ params: Promise.resolve({ path }) });

test("cwd and file-index adapters preserve methods, query encoding, and raw JSON bytes", async (t) => {
  const { routes, seen } = await fixture(t);
  const body = '{ "cwd": "/tmp/项目" }\n';
  await (await routes.BROWSE(new Request("http://web/api/cwd/browse?path=%2Ftmp%2Fa%20b"))).text();
  await (await routes.VALIDATE(new Request("http://web/api/cwd/validate", { method: "POST", headers: { "content-type": "application/json" }, body }))).text();
  await (await routes.DEFAULT_CWD(new Request("http://web/api/default-cwd", { method: "POST" }))).text();
  await (await routes.INDEX(new Request("http://web/api/file-index?cwd=%2Ftmp%2Fa%20b&q=read%2Fme"))).text();
  assert.deepEqual(seen.map(({ method, url }) => [method, url]), [
    ["GET", "/internal/v1/api/cwd/browse?path=%2Ftmp%2Fa%20b"],
    ["POST", "/internal/v1/api/cwd/validate"],
    ["POST", "/internal/v1/api/default-cwd"],
    ["GET", "/internal/v1/api/file-index?cwd=%2Ftmp%2Fa%20b&q=read%2Fme"],
  ]);
  assert.equal(seen[1].body.toString(), body);
  assert.equal(seen[1].headers.authorization, "Bearer service-token");
});

test("files adapter streams multipart and range bodies with explicit response headers", async (t) => {
  const { routes, seen } = await fixture(t);
  const multipart = "--x\r\nContent-Disposition: form-data; name=\"files\"; filename=\"a.txt\"\r\n\r\nraw\r\n--x--\r\n";
  await (await routes.FILES(new Request("http://web/api/files/tmp/a?type=upload&conflict=error", {
    method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", cookie: "private=1" }, body: multipart,
  }), filesContext(["tmp", "a"]))).text();
  const download = await routes.FILES(new Request("http://web/api/files/tmp/a/file.bin?type=download", { headers: { range: "bytes=1-3", cookie: "private=1" } }), filesContext(["tmp", "a", "file.bin"]));
  assert.equal(download.status, 206);
  assert.equal(await download.text(), "bcd");
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "cache-control", "x-content-type-options"]) assert.ok(download.headers.has(name), name);
  assert.equal(download.headers.get("set-cookie"), null);
  assert.equal(seen[0].body.toString(), multipart);
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[1].headers.range, "bytes=1-3");
});

test("files adapter rejects malformed catch-all segments before Agent delivery", async (t) => {
  const { routes, seen } = await fixture(t);
  for (const path of [[], [".."], ["a/b"], ["bad\0name"]]) {
    assert.equal((await routes.FILES(new Request("http://web/api/files/ignored"), filesContext(path))).status, 400);
  }
  assert.equal(seen.length, 0);
});
