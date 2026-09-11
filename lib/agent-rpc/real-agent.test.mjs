import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createJiti } from 'jiti';
import { createAgentClient } from './client.ts';

const root = mkdtempSync(join(tmpdir(), 'bff-real-'));
process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
const { createRemoteAgentRoutes } = await createJiti(import.meta.url).import('./routes/agent.ts');
const { createAgentServer } = await import('../../packages/pi-web-agent-server/dist/server.js');
const { createAgentRouteAdapter } = await import('../../packages/pi-web-agent-server/dist/runtime/agent-adapter.js');
const { getRpcSession } = await import('../../packages/pi-web-agent-server/dist/runtime/session-runtime.js');
const { SessionManager } = await import('@earendil-works/pi-coding-agent');

// Actual HTTP router, SDK, registry and disk authorization; no mocked runtime.
test('inactive BFF against real Agent: passive state, create/command, error compatibility, SSE and authorized bash download', { timeout: 20000 }, async () => {
  const app = createAgentServer({ token: 'test-secret', version: { protocolVersion: 1 }, agent: createAgentRouteAdapter(), eventBufferCapacity: 2 });
  const ids = [];
  const files = [];
  await app.listen('127.0.0.1', 0);
  const routes = createRemoteAgentRoutes(createAgentClient({ baseUrl: `http://127.0.0.1:${app.address().port}`, token: 'test-secret' }).fetch);
  const context = id => ({ params: Promise.resolve({ id }) });
  const request = (url, body) => new Request(`http://web${url}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const manager = SessionManager.create(root);
    const file = manager.getSessionFile(), id = manager.getSessionId();
    ids.push(id);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(manager.getHeader()) + '\n');
    const idle = await routes.GET(request(`/api/agent/${id}`), context(id));
    assert.deepEqual(await idle.json(), { running: false });
    assert.equal(getRpcSession(id), undefined, 'poll must not create an SDK runtime or take a writer lock');
    const invalidStart = await routes.NEW(request('/api/agent/new', { type: 'prompt', cwd: join(root, 'missing'), message: 'never send', toolNames: [] }));
    assert.equal(invalidStart.status, 400);
    const invalidBody = await invalidStart.json();
    assert.equal(invalidBody.code, 'prompt_rejected');
    assert.equal(invalidBody.accepted, false);
    const created = await routes.NEW(request('/api/agent/new', { type: 'ensure_session', cwd: root, toolNames: [] }));
    assert.equal(created.status, 200);
    const data = await created.json(); ids.push(data.sessionId);
    assert.equal(data.success, true); assert.equal(data.data, null);
    const state = await routes.GET(request('/state'), context(data.sessionId));
    assert.equal((await state.json()).running, true);
    const command = await routes.POST(request('/command', { type: 'get_state' }), context(data.sessionId));
    assert.equal((await command.json()).success, true);
    const missing = await routes.POST(request('/missing', { type: 'prompt', message: 'never send' }), context(randomUUID()));
    assert.equal(missing.status, 404);
    const rejected = await missing.json();
    assert.equal(typeof rejected.error, 'string');
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.code, 'prompt_rejected');
    const events = await routes.EVENTS(request('/events'), context(data.sessionId));
    const reader = events.body.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, /"type":"connected"/);
    await reader.cancel();
    const expired = await routes.EVENTS(request('/events?cursor=unknown-cursor'), context(data.sessionId));
    assert.equal(expired.status, 200);
    assert.match(await expired.text(), /resync_required/);

    const output = join(tmpdir(), `pi-bash-${randomUUID()}.log`); files.push(output);
    writeFileSync(output, 'hello\n世界');
    const logUrl = `/bash?path=${encodeURIComponent(output)}`;
    assert.equal((await routes.BASH_OUTPUT(request(logUrl), context(id))).status, 403);
    manager.appendMessage({ role: 'bashExecution', command: 'echo', output: '', exitCode: 0, cancelled: false, truncated: true, fullOutputPath: output, timestamp: Date.now() });
    // Upstream defers non-assistant persistence; write a fixture JSONL with the real manager entries.
    writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map(v => JSON.stringify(v)).join('\n') + '\n');
    const inline = await routes.BASH_OUTPUT(request(logUrl), context(id));
    assert.deepEqual(await inline.json(), { success: true, data: { output: 'hello\n世界' } });
    const download = await routes.BASH_OUTPUT(request(logUrl + '&download=1'), context(id));
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(await download.text(), 'hello\n世界');
    writeFileSync(output, Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal((await routes.BASH_OUTPUT(request(logUrl), context(id))).status, 413);
    rmSync(output); symlinkSync(file, output);
    assert.equal((await routes.BASH_OUTPUT(request(logUrl), context(id))).status, 404);
    assert.equal((await routes.BASH_OUTPUT(request('/bash?path=/etc/passwd'), context(id))).status, 400);
  } finally {
    for (const id of ids) await getRpcSession(id)?.shutdown();
    await app.close();
    for (const file of files) rmSync(file, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
