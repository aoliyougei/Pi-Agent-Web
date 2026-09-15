import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createAgentServer } = await import("../../packages/pi-web-agent-server/dist/server.js");
const jiti = createJiti(import.meta.url);
const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
const { createRemotePushRoutes } = await jiti.import("../../lib/agent-rpc/routes/push.ts");
const token = "push-parity-token";

async function snapshot(response) {
  return { status: response.status, type: response.headers.get("content-type"), body: new Uint8Array(await response.arrayBuffer()) };
}

test("Push BFF responses equal authenticated Agent responses byte-for-byte", async (t) => {
  const app = createAgentServer({
    token,
    version: { protocolVersion: 1 },
    push: { getVapidPublicKey: async () => "public", addSubscription: async () => {} },
  });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const routes = createRemotePushRoutes(createAgentClient({ baseUrl: base, token }).fetch);
  const payload = JSON.stringify({ subscription: { endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } }, locale: "en" });
  const cases = [
    [routes.CONFIG, new Request("http://web/api/push/config"), "/internal/v1/api/push/config"],
    [routes.SUBSCRIBE, new Request("http://web/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: payload }), "/internal/v1/api/push/subscribe"],
  ];
  for (const [handler, request, path] of cases) {
    const browser = await snapshot(await handler(request));
    const direct = await snapshot(await fetch(base + path, {
      method: request.method,
      headers: { authorization: `Bearer ${token}`, ...(request.method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(request.method === "POST" ? { body: payload } : {}),
    }));
    assert.equal(browser.status, 200);
    assert.deepEqual(browser, direct);
  }
});
