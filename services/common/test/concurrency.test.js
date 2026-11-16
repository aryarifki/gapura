import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../concurrency.js';

test('preserves input order while mapping with a concurrency ceiling', async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapLimit([5, 4, 3, 2, 1], 2, async (value) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return value * 2;
  });
  assert.deepEqual(result, [10, 8, 6, 4, 2]);
  assert.equal(maximum, 2);
});

test('handles an empty collection and rejects non-positive limits', async () => {
  assert.deepEqual(await mapLimit([], 3, async (value) => value), []);
  await assert.rejects(() => mapLimit([1], 0, async (value) => value), /positive integer/);
});

test('preserves failure from an individual worker without returning partial results', async () => {
  await assert.rejects(() => mapLimit([1, 2, 3], 2, async (value) => {
    if (value === 2) throw new Error('provider failed');
    return value;
  }), /provider failed/);
});
