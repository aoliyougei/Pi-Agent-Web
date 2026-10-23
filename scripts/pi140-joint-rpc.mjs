// Run only in the pinned disposable RPC container; no production data or external models.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
const root = await mkdtemp('/tmp/pi140-joint-');
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = `${root}/agent`;
await mkdir(`${root}/agent/extensions`, { recursive: true });
await writeFile(`${root}/agent/extensions/phase2.ts`, await readFile('/tmp/joint/phase2.ts'));
await writeFile(`${root}/agent/extensions/tools.ts`, `export default function(pi) {
for (const [name, defaultActive] of [['removed_tool',true],['new_tool',true],['inactive_tool',false]]) pi.registerTool({name,label:name,description:name,parameters:{type:'object',properties:{}},defaultActive,execute:async()=>({content:[{type:'text',text:'ok'}],details:{}})});
}`);
await writeFile(`${root}/agent/settings.json`, JSON.stringify({ sessionDir: '.pi/sessions', defaultProvider: 'joint', defaultModel: 'echo', compaction: { keepRecentTokens: 1, reserveTokens: 256 } }));
// HTTP provider is also available in Chat only, where extensions intentionally do not load.
await writeFile(`${root}/agent/models.json`, JSON.stringify({ providers: { joint: { baseUrl: 'http://127.0.0.1:8083/v1', api: 'openai-completions', apiKey: 'fixture-not-a-secret', models: [{ id: 'echo', name: 'Joint HTTP Echo', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 512 }] } } }));
let gated = false, modelRequests = 0;
const pendingModelResponses = [];
createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); modelRequests++;
  const last = body.messages?.at(-1)?.content;
  const text = typeof last === 'string' ? last : last?.find(part => part.type === 'text')?.text ?? 'summary';
  const finish = () => {
    const choice = { index: 0, delta: { role: 'assistant', content: `echo:${text}` }, finish_reason: null };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'joint', object: 'chat.completion.chunk', created: 1, model: 'echo', choices: [choice] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: 'joint', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
  };
  if (gated) pendingModelResponses.push(finish); else finish();
}).listen(8083, '127.0.0.1');
const token = randomBytes(32).toString('hex');
await writeFile(`${root}/token`, token, { mode: 0o400 });
const { SessionManager } = await import('/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
const { appendSessionToolSelection } = await import('/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/dependencies/session-tool-selection.js');
const cwd = `${root}/project`; await mkdir(cwd, { recursive: true });
const fixtures = {};
const usage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 1, totalTokens: 16, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 0.125 } };
for (const [name, selection] of [['default', undefined], ['explicit', ['read']], ['none', []], ['costs', undefined], ['global', undefined]]) {
  const manager = SessionManager.create(cwd, name === 'global' ? `${root}/agent/sessions/global-fixture` : `${cwd}/.pi/sessions`);
  if (selection !== undefined) appendSessionToolSelection(manager, selection);
  manager.appendModelChange('joint', 'echo'); manager.appendThinkingLevelChange('medium');
  const refs = names => names.map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } }));
  manager.appendMessage({ role: 'system', content: '', toolsAdded: refs(['read','removed_tool']), timestamp: Date.now() });
  manager.appendMessage({ role: 'system', content: '', toolsRemoved: refs(['removed_tool']), timestamp: Date.now() });
  manager.appendMessage({ role: 'user', content: `joint-${name}`, timestamp: Date.now() });
  const message = { role: 'assistant', content: [{ type: 'text', text: `seed-${name}` }], api: 'openai-completions', provider: 'joint', model: 'echo', stopReason: 'stop', timestamp: Date.now(), usage };
  if (name === 'costs') {
    for (const flag of [undefined, false, true]) manager.appendMessage({ ...message, content: [{ type: 'text', text: `cost-${String(flag)}` }], usage: { ...usage, cost: { ...usage.cost, ...(flag === undefined ? {} : { totalFromProvider: flag }) } } });
    manager.appendMessage({ ...message, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'bad-call', name: 'write', arguments: {}, argumentsError: 'Invalid JSON: {"path":' }] });
    manager.appendMessage({ role: 'toolResult', toolCallId: 'bad-call', toolName: 'write', content: [{ type: 'text', text: 'Invalid JSON: {"path":' }], isError: true, timestamp: Date.now() });
  } else manager.appendMessage({ ...message, usage: { ...usage, cost: { ...usage.cost, total: 0 } } });
  fixtures[name] = { id: manager.getSessionId(), file: manager.getSessionFile() };
}
let child;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start() {
  child = spawn('pi-agent-rpc', [], { env: { ...process.env, PI_AGENT_RPC_TOKEN_FILE: `${root}/token`, PI_AGENT_RPC_HOST: '127.0.0.1', PI_AGENT_RPC_PORT: '8080' }, stdio: ['ignore','ignore','inherit'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:8080/internal/v1/version', { headers: { authorization: `Bearer ${token}` } })).ok) return; } catch {} await delay(100); }
  // The authenticated endpoint is authoritative if the health path differs.
  assert.equal((await fetch('http://127.0.0.1:8080/internal/v1/version', {headers:{authorization:`Bearer ${token}`}})).status, 200);
}
await start();
const trace = [];
createServer(async (req,res) => {
  const url = new URL(req.url, 'http://test');
  const json = data => { res.setHeader('content-type','application/json'); res.end(JSON.stringify(data)); };
  try {
    if (url.pathname === '/fixture') return json({ root, cwd, fixtures });
    if (url.pathname === '/trace') return json(trace);
    if (url.pathname === '/gate' && req.method === 'POST') { gated = true; return json({ gated }); }
    if (url.pathname === '/gate-state') return json({ gated, waiting: pendingModelResponses.length, modelRequests });
    if (url.pathname === '/release' && req.method === 'POST') { gated = false; for (const finish of pendingModelResponses.splice(0)) finish(); return json({ gated }); }
    if (url.pathname === '/snapshot') return json({ file: fixtures[url.searchParams.get('name')].file, content: await readFile(fixtures[url.searchParams.get('name')].file, 'utf8') });
    if (url.pathname === '/restart' && req.method === 'POST') {
      await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }); await start(); return json({ restarted: true });
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks); let data; try { data = JSON.parse(body); } catch {}
    trace.push({ url: req.url, method: req.method, type: data?.type, toolNames: data?.toolNames, cwd: data?.cwd, cursor: req.headers['last-event-id'] });
    const headers = { authorization: `Bearer ${token}` };
    for (const key of ['content-type','accept','last-event-id','x-pi-agent-protocol']) if (req.headers[key]) headers[key] = req.headers[key];
    const abort = new AbortController(); res.on('close', () => abort.abort());
    const response = await fetch(`http://127.0.0.1:8080${req.url}`, { method: req.method, headers, signal: abort.signal, ...(body.length ? { body } : {}) });
    const outgoing = new Headers(response.headers); for (const key of ['transfer-encoding','connection','content-length','content-encoding']) outgoing.delete(key);
    res.writeHead(response.status, Object.fromEntries(outgoing));
    for await (const chunk of response.body ?? []) res.write(chunk); res.end();
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
}).listen(8081, '0.0.0.0', () => console.log('READY pi140 joint relay; no credentials logged'));
