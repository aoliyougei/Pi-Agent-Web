import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "../client.ts";

const { createRemoteGitWorktreeRoutes } = await createJiti(import.meta.url).import("./git-worktrees.ts");

test("Git and worktree adapters preserve method, query and raw JSON bytes", async (t) => {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.writeHead(request.method === "DELETE" ? 409 : 200, { "content-type": "application/json", "x-request-id": "git-1", "set-cookie": "secret=1" });
    response.end(request.method === "DELETE" ? '{"error":"dirty","dirty":true}' : '{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const routes = createRemoteGitWorktreeRoutes(createAgentClient({ baseUrl, token: "service-token" }).fetch);
  const body = '{ "cwd": "/tmp/项目", "path": "/tmp/wt", "force": false }\n';

  await (await routes.STATUS(new Request("http://web/api/git/status?cwd=%2Ftmp%2Fa%20b"))).text();
  await (await routes.DIFF(new Request("http://web/api/git/diff?cwd=%2Ftmp%2Fa%20b&path=%2Ftmp%2Fa%20b%2Fx.ts"))).text();
  await (await routes.WORKTREES(new Request("http://web/api/worktrees?cwd=%2Ftmp%2Fa%20b"))).text();
  const deleted = await routes.WORKTREES(new Request("http://web/api/worktrees", {
    method: "DELETE", body, headers: { "content-type": "application/json", cookie: "private=1", "x-request-id": "git-1" },
  }));

  assert.equal(deleted.status, 409);
  assert.deepEqual(await deleted.json(), { error: "dirty", dirty: true });
  assert.equal(deleted.headers.get("set-cookie"), null);
  assert.deepEqual(seen.map(({ method, path }) => [method, path]), [
    ["GET", "/internal/v1/api/git/status?cwd=%2Ftmp%2Fa%20b"],
    ["GET", "/internal/v1/api/git/diff?cwd=%2Ftmp%2Fa%20b&path=%2Ftmp%2Fa%20b%2Fx.ts"],
    ["GET", "/internal/v1/api/worktrees?cwd=%2Ftmp%2Fa%20b"],
    ["DELETE", "/internal/v1/api/worktrees"],
  ]);
  assert.equal(seen[3].body, body);
  assert.equal(seen[3].headers.authorization, "Bearer service-token");
  assert.equal(seen[3].headers.cookie, undefined);
  assert.equal(seen[3].headers["x-request-id"], "git-1");
});
