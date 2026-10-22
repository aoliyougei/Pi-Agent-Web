// Browser acceptance against disposable Web/RPC containers; no model calls.
import assert from 'node:assert/strict';
import { chromium } from '/tmp/web-browser/node_modules/playwright/index.mjs';
const base = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:30152';
const { root, ids } = await (await fetch('http://127.0.0.1:8081/fixture')).json();
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  const failed = [];
  page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) failed.push([response.status(),response.url()]); });
  // Deep link restoration uses a prior backend-scoped hint, not a prior server list cache.
  await page.addInitScript(({ root, ids }) => {
    localStorage.setItem('pi-web:session-cwd:default', JSON.stringify({ [ids.A]: `${root}/A` }));
  }, { root, ids });
  await page.goto(`${base}/?session=${ids.A}`);
  await page.getByText('project-A', { exact: true }).first().waitFor({ timeout: 60000 });
  assert.ok((await page.locator('body').innerText()).includes('project-A'));
  await page.reload();
  await page.getByText('project-A', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.getByText('global-A', { exact: true }).first().waitFor({ timeout: 30000 });
  // Choose B through the real sidebar custom-directory picker.
  await page.getByRole('button', { name: `${root}/A`, exact: true }).click();
  await page.getByText('Custom path', { exact: false }).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForFunction(() => document.querySelector('#directory-path')?.value === '/home/node');
  await page.locator('#directory-path').fill(`${root}/B`);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await page.waitForResponse(response => response.url().includes('/api/cwd/browse?path=') && response.status() === 200);
  await page.getByRole('button', { name: 'Select this folder', exact: true }).click();
  await page.getByText('project-B', { exact: true }).first().waitFor({ timeout: 30000 });
  // Rapid switches: delay A's list until B has already been selected and loaded.
  await page.route('**/api/sessions?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cwd') === `${root}/A`) await new Promise(resolve => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.getByRole('button', { name: `${root}/B`, exact: true }).click();
  await page.locator(`button[title="${root}/A"]`).click();
  await page.getByRole('button', { name: `${root}/A`, exact: true }).click();
  await page.locator(`button[title="${root}/B"]`).click();
  await page.getByText('project-B', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  assert.equal(await page.getByText('project-B', { exact: true }).count() > 0, true);
  console.log('PASS: Chromium project deep-link restore, reload, custom-directory A -> B, global retention and delayed A/B switching');
  console.log('API errors observed:', JSON.stringify(failed));
  await context.close();
} finally { await browser.close(); }
