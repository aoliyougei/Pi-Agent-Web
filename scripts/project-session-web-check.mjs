// Run in the disposable Web client container sharing the RPC fixture's network namespace.
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { createSessionScope } = await createJiti(import.meta.url).import('../lib/session-scope.ts');
const base = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:30152';
const fixture = await (await fetch('http://127.0.0.1:8081/fixture')).json();
const entries = new Map();
const requests = [];
const scope = createSessionScope({ backend: () => 'fixture', storage: () => ({ getItem: k => entries.get(k) ?? null, setItem: (k,v) => entries.set(k,v), removeItem: k => entries.delete(k) }), send: async (url, init) => {
  requests.push(String(url));
  return fetch(`${base}${url}`, init);
} });
assert.equal(await scope.enabled(), true);
for (const name of ['A', 'B']) {
  const cwd = await scope.validate(`${fixture.root}/${name}`);
  scope.remember(fixture.ids[name], cwd);
  const response = await scope.fetch(`/api/sessions/${fixture.ids[name]}?tail=50&deferMedia=1`);
  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.equal(data.info.cwd, cwd);
  const list = await fetch(`${base}/api/sessions?cwd=${encodeURIComponent(cwd)}&force=1`);
  const sessions = (await list.json()).sessions;
  assert.ok(sessions.some(s => s.id === fixture.ids[name]));
  assert.ok(sessions.some(s => s.id === fixture.ids.global));
  assert.ok(!sessions.some(s => s.id === fixture.ids[name === 'A' ? 'B' : 'A']));
  const state = await scope.fetch(`/api/agent/${fixture.ids[name]}?start=false`);
  assert.equal(state.status, 200, await state.clone().text());
}
// Known-session commands use their own cwd even though B was browsed most recently.
const result = await scope.fetch(`/api/agent/${fixture.ids.A}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'get_state' }) });
assert.equal(result.status, 200, await result.clone().text());
const stream = await scope.fetch(`/api/agent/${fixture.ids.A}/events?cursor=`);
assert.equal(stream.status, 200);
assert.ok(stream.headers.get('content-type').includes('text/event-stream'));
await stream.body.cancel();
assert.ok(requests.some(url => url.includes('cwd=')));
console.log('PASS: new Web /version, validation, project detail, A/B list isolation, Agent state, JSON command and scoped SSE');
