import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const { createSessionScope, sessionResponseError } = await createJiti(import.meta.url).import('./session-scope.ts');

function fixture(capabilities = ['project-session-discovery']) {
  const values = new Map(); const calls = []; let backend = 'default';
  const scope = createSessionScope({
    backend: () => backend,
    storage: () => ({ getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }),
    send: async (url, init) => {
      calls.push({ url: String(url), init });
      if (url === '/api/agent/version') return Response.json({ capabilities });
      if (url === '/api/cwd/validate') return Response.json({ cwd: JSON.parse(init.body).cwd });
      return Response.json({ ok: true });
    },
  });
  return { scope, calls, switchBackend: id => { backend = id; }, values };
}

test('session errors retain conflict details rather than reducing them to HTTP status', async () => {
  const error = await sessionResponseError(Response.json({ error: 'Multiple distinct session files share this session ID', code: 'session_id_conflict' }, { status: 409 }));
  assert.match(error.message, /Multiple distinct/);
  assert.equal((await sessionResponseError(new Response('bad gateway', { status: 502 }))).message, 'HTTP 502');
});

test('session hints survive controller recreation and remain backend isolated', () => {
  const f = fixture(); f.scope.remember('a', '/projects/A');
  assert.equal(f.scope.cwd('a'), '/projects/A');
  f.switchBackend('b'); assert.equal(f.scope.cwd('a'), undefined);
  f.scope.remember('a', '/projects/B'); assert.equal(f.scope.cwd('a'), '/projects/B');
  f.switchBackend('default'); assert.equal(f.scope.cwd('a'), '/projects/A');
  f.scope.forget('a'); assert.equal(f.scope.cwd('a'), undefined);
});

test('validates the session hint before cold fetch and preserves query parameters', async () => {
  const f = fixture(); f.scope.remember('a', '/projects/A');
  await f.scope.fetch('/api/sessions/a/context?leafId=x');
  assert.deepEqual(f.calls.map(c => c.url), ['/api/agent/version', '/api/cwd/validate', '/api/sessions/a/context?leafId=x&cwd=%2Fprojects%2FA']);
  assert.equal(JSON.parse(f.calls[1].init.body).cwd, '/projects/A');
  await f.scope.fetch('/api/agent/a', { method: 'POST', body: JSON.stringify({ type: 'prompt', message: 'hi' }) });
  assert.deepEqual(JSON.parse(f.calls.at(-1).init.body), { type: 'prompt', message: 'hi', cwd: '/projects/A' });
});

test('old RPC keeps global requests unchanged and never receives hints', async () => {
  const f = fixture([]); f.scope.remember('a', '/projects/A');
  await f.scope.fetch('/api/sessions/a');
  assert.deepEqual(f.calls.map(c => c.url), ['/api/agent/version', '/api/sessions/a']);
  assert.equal(f.scope.url('/api/agent/a/events?cursor=1'), '/api/agent/a/events?cursor=1');
});

test('SSE and resource URLs preserve explicit cwd and other query fields', async () => {
  const f = fixture(); f.scope.remember('a', '/projects/A'); await f.scope.prepare('a');
  assert.equal(f.scope.url('/api/agent/a/events?cursor=1'), '/api/agent/a/events?cursor=1&cwd=%2Fprojects%2FA');
  assert.equal(f.scope.url('/api/sessions/a/entries/e/tool-result-image?cwd=%2Foriginal&blockIndex=0'), '/api/sessions/a/entries/e/tool-result-image?cwd=%2Foriginal&blockIndex=0');
  assert.equal(f.scope.url('/api/files/tmp/a?sessionId=a&type=read'), '/api/files/tmp/a?sessionId=a&type=read&cwd=%2Fprojects%2FA');
});

test('persisted hints are restored by a fresh page controller', () => {
  const values = new Map();
  const options = { backend: () => 'rpc-a', storage: () => ({ getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }), send: async () => Response.json({}) };
  createSessionScope(options).remember('saved', '/project/A');
  assert.equal(createSessionScope(options).cwd('saved'), '/project/A');
});

test('session operations revalidate after prior success for RPC restarts', async () => {
  const f = fixture(); f.scope.remember('a', '/A');
  await f.scope.fetch('/api/sessions/a');
  await f.scope.fetch('/api/sessions/a');
  assert.equal(f.calls.filter(c => c.url === '/api/cwd/validate').length, 2);
});

test('a backend change during validation cannot send the original session to the new backend', async () => {
  let backend = 'A', release;
  const delivered = [];
  const wait = new Promise(resolve => { release = resolve; });
  const scope = createSessionScope({ backend: () => backend, storage: () => undefined, send: async (url) => {
    if (url === '/api/agent/version') return Response.json({ capabilities: ['project-session-discovery'] });
    if (url === '/api/cwd/validate') { await wait; return Response.json({ cwd: '/A' }); }
    delivered.push(url); return Response.json({});
  } });
  scope.remember('session-a', '/A');
  const pending = scope.fetch('/api/sessions/session-a');
  await new Promise(resolve => setImmediate(resolve));
  backend = 'B'; release();
  await assert.rejects(pending, /Backend selection changed/);
  assert.deepEqual(delivered, []);
});

test('validation failures prevent session delivery and are not cached as success', async () => {
  const calls = []; let valid = false;
  const scope = createSessionScope({ backend: () => 'default', storage: () => undefined, send: async (url) => {
    calls.push(url);
    if (url === '/api/agent/version') return Response.json({ capabilities: ['project-session-discovery'] });
    if (url === '/api/cwd/validate') return valid ? Response.json({ cwd: '/A' }) : Response.json({ error: 'Denied' }, { status: 403 });
    return Response.json({ ok: true });
  } });
  scope.remember('a','/A');
  await assert.rejects(scope.fetch('/api/sessions/a'), /Denied/);
  assert.ok(!calls.includes('/api/sessions/a?cwd=%2FA'));
  valid = true; await scope.fetch('/api/sessions/a');
  assert.equal(calls.at(-1), '/api/sessions/a?cwd=%2FA');
});
