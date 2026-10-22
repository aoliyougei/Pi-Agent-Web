// Disposable fixture runner; run only inside the isolated RPC candidate container.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
const legacy = process.env.TEST_RPC_LEGACY === '1';
const port = legacy ? 8082 : 8080;
const root = await mkdtemp(legacy ? '/tmp/web-project-session-legacy-' : '/tmp/web-project-session-');
const token = randomBytes(32).toString('hex');
await writeFile(`${root}/token`, token, { mode: 0o400 });
await mkdir(`${root}/agent`, { recursive: true });
await writeFile(`${root}/agent/settings.json`, JSON.stringify({ sessionDir: '.pi/sessions' }));
const { SessionManager } = await import('/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
const ids = {};
for (const name of ['A', 'B']) {
  const cwd = `${root}/${name}`;
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, `${cwd}/.pi/sessions`);
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text: `project-${name}` }], timestamp: Date.now() });
  ids[name] = manager.getSessionId();
}
const globalManager = SessionManager.create(`${root}/A`, `${root}/agent/sessions/global-fixture`);
globalManager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'global-A' }], timestamp: Date.now() });
ids.global = globalManager.getSessionId();
const child = spawn('pi-agent-rpc', [], { env: { ...process.env, PI_CODING_AGENT_DIR: `${root}/agent`, PI_AGENT_RPC_TOKEN_FILE: `${root}/token`, PI_AGENT_RPC_HOST: '0.0.0.0', PI_AGENT_RPC_PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] });
async function request(path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/internal/v1${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
  const data = await response.json();
  return { response, data };
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/version')).response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const version = (await request('/version')).data;
  assert.equal(version.capabilities.includes('project-session-discovery'), !legacy);
  for (const name of legacy ? [] : ['A', 'B']) {
    const cwd = `${root}/${name}`;
    assert.equal((await request('/api/cwd/validate', { method: 'POST', body: JSON.stringify({ cwd }) })).response.status, 200);
    const cold = await request(`/api/sessions/${ids[name]}?cwd=${encodeURIComponent(cwd)}`);
    assert.equal(cold.response.status, 200, JSON.stringify(cold.data));
    const list = await request(`/api/sessions?cwd=${encodeURIComponent(cwd)}&force=1`);
    assert.ok(list.data.sessions.some(s => s.id === ids[name]));
    assert.ok(list.data.sessions.some(s => s.id === ids.global));
    assert.ok(!list.data.sessions.some(s => s.id === ids[name === 'A' ? 'B' : 'A']));
  }
  const global = await request('/api/sessions?force=1');
  assert.ok(global.data.sessions.every(s => s.id !== ids.A && s.id !== ids.B));
  assert.ok(global.data.sessions.some(s => s.id === ids.global));
  const created = await request('/api/agent/new', { method: 'POST', body: JSON.stringify({ cwd: `${root}/A`, type: 'ensure_session', toolNames: [] }) });
  assert.equal(created.response.status, 200, JSON.stringify(created.data));
  console.log(legacy ? 'PASS: legacy RPC starts with global-only discovery' : 'PASS: candidate capability, cold detail without LIST, A/B isolation, global-only list, configured new session');
  // Loopback-only test relay in the shared test network namespace. Production is never contacted.
  createServer(async (req, res) => {
    if (req.url === '/fixture') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ root, ids, version }));
      return;
    }
    try {
      const headers = new Headers({ authorization: `Bearer ${token}` });
      for (const name of ['content-type', 'accept', 'last-event-id', 'x-request-id', 'x-pi-agent-protocol']) {
        if (req.headers[name]) headers.set(name, req.headers[name]);
      }
      const upstream = await fetch(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers,
        ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: req, duplex: 'half' }),
      });
      const outgoing = new Headers(upstream.headers);
      for (const name of ['transfer-encoding', 'connection', 'content-encoding', 'content-length']) outgoing.delete(name);
      res.writeHead(upstream.status, Object.fromEntries(outgoing));
      for await (const chunk of upstream.body ?? []) res.write(chunk);
      res.end();
    } catch { res.writeHead(502); res.end(); }
  }).listen(port + 1, '127.0.0.1');
  console.log(`READY: isolated RPC fixture on ${port}; loopback test relay on ${port + 1}`);
  // Keep alive for the Web peer tests; external task-owned container stop cleans it up.
  await new Promise(() => {});
} catch (error) {
  child.kill('SIGTERM');
  throw error;
}
