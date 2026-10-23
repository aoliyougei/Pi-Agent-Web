import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const { needsKimiV1Hint } = await createJiti(import.meta.url).import('./kimi-base-url.ts');
test('Kimi custom addresses get a non-mutating /v1 hint', () => {
  for (const name of ['kimi-coding', 'kimi', 'Kimi Custom']) {
    assert.equal(needsKimiV1Hint(name, 'https://proxy.example/api'), true);
    assert.equal(needsKimiV1Hint(name, 'https://proxy.example/api/v1/'), false);
    assert.equal(needsKimiV1Hint(name, undefined), false);
  }
  assert.equal(needsKimiV1Hint('custom', 'https://api.moonshot.cn'), true);
  assert.equal(needsKimiV1Hint('custom', 'https://api.kimi.com/coding/v1'), false);
  assert.equal(needsKimiV1Hint('other', 'https://proxy.example'), false);
});
