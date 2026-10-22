// Docker-only Chromium regression: mock API responses, never remove a real worktree.
import assert from 'node:assert/strict';
import { chromium } from '/tmp/web-browser/node_modules/playwright/index.mjs';
const root = '/app/example', removed = `${root}/.worktrees/deleted`, sibling = `${root}/.worktrees/deleted-other`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  let gone = false, deleted = 0;
  const validations = [], lists = [];
  await page.addInitScript(({ removed, sibling }) => {
    localStorage.setItem('pi-web:local-workspaces-v1', JSON.stringify([removed, sibling]));
  }, { removed, sibling });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/agent-backends') return json({ backends: [{ id: 'default', name: 'Test', baseUrl: 'http://test', hasToken: true }] });
    if (url.pathname === '/api/agent/version') return json({ serverVersion: 'test', piVersion: '1.2.0', capabilities: ['project-session-discovery'] });
    if (url.pathname === '/api/home') return json({ home: '/home/node' });
    if (url.pathname === '/api/cwd/validate') {
      const { cwd } = request.postDataJSON(); validations.push(cwd);
      return cwd === removed && gone ? json({ error: `Directory does not exist: ${cwd}` }, 400) : json({ cwd, projectRoot: root, projectKey: root });
    }
    if (url.pathname === '/api/sessions') {
      lists.push(url.searchParams.get('cwd'));
      return json({ sessions: [{ id: 'global', path: '/sessions/global.jsonl', cwd: root, projectRoot: root, projectKey: root, messageCount: 1, firstMessage: 'Global preserved', created: '2026-10-22', modified: '2026-10-22' }], runningSessionIds: [] });
    }
    if (url.pathname === '/api/worktrees') {
      if (request.method() === 'DELETE') { gone = true; deleted++; return json({ success: true }); }
      const cwd = url.searchParams.get('cwd');
      return json({ projectRoot: root, projectKey: root, isGit: true, isTopLevel: true, currentWorktreePath: cwd, worktrees: [{ path: root, branch: 'main', isMain: true }, ...(!gone ? [{ path: removed, branch: 'feature-delete', isMain: false }] : [])] });
    }
    if (url.pathname === '/api/agent/running') return json({ runningSessionIds: [] });
    if (url.pathname === '/api/models') return json({ models: {}, modelList: [], defaultModel: null });
    if (url.pathname.startsWith('/api/files/')) return json({ entries: [] });
    return json({});
  });
  await page.goto('http://127.0.0.1:30152/');
  await page.getByText('Global preserved', { exact: true }).waitFor();
  await page.getByTitle(`Switch worktree: ${root}`, { exact: true }).click();
  await page.locator('button').filter({ hasText: 'feature-delete' }).first().click();
  await page.getByTitle(`Switch worktree: ${removed}`, { exact: true }).waitFor();
  await page.getByTitle(`Switch worktree: ${removed}`, { exact: true }).click();
  // The actual title is localized from removeWorktreeTitle.
  const deleteButton = page.getByRole('button', { name: new RegExp(`Remove.*${removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await deleteButton.click();
  await page.getByRole('button', { name: root, exact: true }).waitFor();
  assert.equal(deleted, 1);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('pi-web:local-workspaces-v1')))).includes(removed), false);
  await page.getByRole('button', { name: root, exact: true }).click();
  assert.equal(await page.locator(`button[title="${removed}"]`).count(), 0);
  assert.equal(await page.locator(`button[title="${sibling}"]`).count(), 1);
  // Simulate legacy stale history left by an older Web release, then select it.
  await page.evaluate(({ removed, sibling }) => localStorage.setItem('pi-web:local-workspaces-v1', JSON.stringify([removed, sibling])), { removed, sibling });
  await page.reload();
  await page.getByRole('button', { name: root, exact: true }).click();
  await page.locator(`button[title="${removed}"]`).click();
  await page.getByText(`Directory does not exist: ${removed}`, { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: removed, exact: true }).count(), 0);
  assert.ok(!lists.slice(-2).includes(removed));
  await page.evaluate(({ removed }) => localStorage.setItem('pi-web:session-cwd:default', JSON.stringify({ missing: removed })), { removed });
  await page.goto('http://127.0.0.1:30152/?session=missing');
  await page.getByText('Global preserved', { exact: true }).waitFor();
  await page.getByRole('button', { name: root, exact: true }).waitFor();
  console.log('PASS: UI deletion cleanup, main fallback, sibling retention, stale-history rejection and cold missing-cwd global recovery');
  await context.close();
} finally { await browser.close(); }
