import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginGuard } from '../access.js';

function request(guard, headers = {}, method = 'POST') {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  let proceeded = false;
  guard({ method, get: (name) => headers[name] || '' }, res, () => { proceeded = true; });
  return { proceeded, ...res };
}

test('dashboard API reads and writes do not require an admin token or cookie', () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const result = request(createOriginGuard(), {}, method);
    assert.equal(result.proceeded, true);
    assert.equal(result.statusCode, 200);
  }
});

test('same-origin writes work with the public host or tunnel origin configuration', () => {
  assert.equal(request(createOriginGuard(), { origin: 'https://gapura.avenia.my.id', host: 'gapura.avenia.my.id' }).proceeded, true);
  assert.equal(request(createOriginGuard({ publicOrigin: 'https://gapura.avenia.my.id' }), { origin: 'https://gapura.avenia.my.id', host: 'localhost:3005' }).proceeded, true);
});

test('cross-origin and malformed browser origins remain rejected', () => {
  const guard = createOriginGuard({ publicOrigin: 'https://gapura.avenia.my.id' });
  for (const origin of ['https://attacker.example', 'null', 'not-a-url', 'http://gapura.avenia.my.id']) {
    const result = request(guard, { origin, host: 'gapura.avenia.my.id' });
    assert.equal(result.proceeded, false, origin);
    assert.equal(result.statusCode, 403, origin);
  }
});
