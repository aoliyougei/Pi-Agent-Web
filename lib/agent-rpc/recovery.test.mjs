import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { AgentEventConnection } = await jiti.import('../agent-event-connection.ts');
const { createRemoteAgentRoutes } = await jiti.import('./routes/agent.ts');

test('browser adapter flattens Agent errors and turns expired cursors into an EventSource control event', async () => {
  const requests = [];
  const routes = createRemoteAgentRoutes(async (path, init) => {
    requests.push({ path, headers: new Headers(init.headers) });
    return Response.json({ error: { code: path.includes('/events') ? 'resync_required' : 'prompt_rejected', message: 'rejected', requestId: 'r1' }, accepted: false }, { status: path.includes('/events') ? 409 : 500 });
  });
  const context = { params: Promise.resolve({ id: 'session-1' }) };
  const error = await routes.POST(new Request('http://web/command', { method: 'POST', body: '{}' }), context);
  assert.equal(error.status, 500);
  assert.deepEqual(await error.json(), { error: 'rejected', code: 'prompt_rejected', requestId: 'r1', accepted: false });
  const event = await routes.EVENTS(new Request('http://web/events?cursor=12'), context);
  assert.equal(event.status, 200);
  assert.match(event.headers.get('content-type'), /text\/event-stream/);
  assert.equal(await event.text(), 'data: {"type":"resync_required"}\n\n');
  assert.equal(requests[1].headers.get('last-event-id'), '12');
  assert.equal(requests[1].path, '/internal/v1/api/agent/session-1/events');
  await routes.EVENTS(new Request('http://web/events?cursor=old', { headers: { 'last-event-id': 'new' } }), context);
  assert.equal(requests[2].headers.get('last-event-id'), 'new');
  const malformed = createRemoteAgentRoutes(async () => new Response('not json', { status: 500, headers: { 'content-type': 'application/json' } }));
  assert.equal((await malformed.RUNNING(new Request('http://web/running'))).status, 502);
});

test('connection carries cursor on replacement and reconciles before reconnecting without expired cursor', async () => {
  const sources = [], events = [];
  let release, recoveries = 0;
  const recovery = new Promise(resolve => { release = resolve; });
  const connection = new AgentEventConnection({
    createSource(id, cursor) { const source = { readyState: 1, onmessage: null, onerror: null, close() {} }; sources.push({ id, cursor, source }); return source; },
    onEvent: event => events.push(event), shouldMaintain: () => true,
    readinessTimeoutMs: 500, reconnectDelayMs: 1,
    onResync: async id => { assert.equal(id, 's1'); recoveries++; await recovery; },
  });
  const first = connection.ensureConnected('s1');
  sources[0].source.onmessage({ data: '{"type":"connected"}', lastEventId: '10' });
  await first;
  connection.close();
  const next = connection.ensureConnected('s1');
  assert.equal(sources[1].cursor, '10');
  sources[1].source.onmessage({ data: '{"type":"resync_required"}', lastEventId: '' });
  await assert.rejects(next);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(recoveries, 1);
  assert.equal(sources.length, 2, 'must await reconciliation');
  assert.deepEqual(events, [{ type: 'connected' }]);
  release();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(sources.length, 3);
  assert.equal(sources[2].cursor, undefined);
  sources[2].source.onmessage({ data: '{"type":"connected"}', lastEventId: '20' });
  connection.close();
  const other = connection.ensureConnected('s2');
  assert.equal(sources[3].cursor, undefined, 'cursor must not cross Session boundaries');
  sources[3].source.onmessage({ data: '{"type":"connected"}', lastEventId: '1' });
  await other;
  connection.close();
});
