import assert from "node:assert/strict";
import test from "node:test";
import { createAgentServer } from "../dist/server.js";

const token = "push-route-token";
const auth = { authorization: `Bearer ${token}` };

async function start(t, push) {
  const server = createAgentServer({ token, version: { protocolVersion: 1 }, push });
  await server.listen("127.0.0.1", 0);
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("Agent owns push configuration and subscription persistence without exposing private keys", async (t) => {
  const subscriptions = [];
  const base = await start(t, {
    getVapidPublicKey: async () => "public-only",
    addSubscription: async (subscription) => { subscriptions.push(subscription); },
  });

  let response = await fetch(`${base}/internal/v1/api/push/config`, { headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { publicKey: "public-only" });

  response = await fetch(`${base}/internal/v1/api/push/subscribe`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ subscription: { endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } }, locale: "zh-CN", privateKey: "must-not-leak" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(subscriptions, [{ endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" }, locale: "zh-CN" }]);
  assert.doesNotMatch(JSON.stringify(await (await fetch(`${base}/internal/v1/api/push/config`, { headers: auth })).json()), /private|must-not-leak/);
});

test("Agent push subscription route rejects malformed and non-JSON requests before persistence", async (t) => {
  let writes = 0;
  const base = await start(t, {
    getVapidPublicKey: async () => "public",
    addSubscription: async () => { writes += 1; },
  });
  const cases = [
    ["text/plain", JSON.stringify({ subscription: { endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } } }), 415],
    ["application/json", "{", 400],
    ["application/json", JSON.stringify({ subscription: { endpoint: "http://push.example/a", keys: { p256dh: "p", auth: "a" } } }), 400],
  ];
  for (const [type, body, status] of cases) {
    const response = await fetch(`${base}/internal/v1/api/push/subscribe`, { method: "POST", headers: { ...auth, "content-type": type }, body });
    assert.equal(response.status, status);
  }
  assert.equal(writes, 0);
});

test("Agent push failures do not expose filesystem details", async (t) => {
  const base = await start(t, {
    getVapidPublicKey: async () => "public-only",
    addSubscription: async () => { throw new Error("ENOENT /home/node/.pi/agent/web-push.json"); },
  });
  const response = await fetch(`${base}/internal/v1/api/push/subscribe`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ subscription: { endpoint: "https://push.example/sub", keys: { p256dh: "key", auth: "auth" } } }),
  });
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text.includes("/home/node/.pi"), false);
  assert.deepEqual(JSON.parse(text), { error: "Unable to save push subscription" });
});
