import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const { validateWorkspace, isMissingWorkspace, isWorkspaceWithin } = await createJiti(import.meta.url).import('./workspace-selection.ts');

test('validates before selection and returns the server normalized project identity', async () => {
  const result = await validateWorkspace('/repo/work', async (url, init) => {
    assert.equal(url, '/api/cwd/validate');
    assert.equal(JSON.parse(init.body).cwd, '/repo/work');
    return Response.json({ cwd: '/real/work', projectRoot: '/real', projectKey: '/real' });
  });
  assert.deepEqual(result, { cwd: '/real/work', root: '/real', key: '/real' });
});

test('only explicit missing directory errors authorize stale history cleanup', async () => {
  for (const [status, message, missing] of [[400, 'Directory does not exist: /gone', true], [403, 'Access denied', false], [503, 'Agent service unavailable', false]]) {
    await assert.rejects(validateWorkspace('/gone', async () => Response.json({ error: message }, { status })), error => {
      assert.equal(isMissingWorkspace(error), missing);
      return true;
    });
  }
});

test('worktree cleanup is segment bounded and handles slash-normalized Windows paths', () => {
  assert.equal(isWorkspaceWithin('/repo/w/sub', '/repo/w'), true);
  assert.equal(isWorkspaceWithin('/repo/w2', '/repo/w'), false);
  assert.equal(isWorkspaceWithin('C:\\Repo\\W\\sub', 'c:/repo/w'), true);
});
