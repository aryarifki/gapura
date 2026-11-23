import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntakeGuard } from '../intake-guard.js';

function request(guard, headers = {}) {
  const req = { get: (name) => headers[name] || '' };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let proceeded = false;
  guard(req, res, () => { proceeded = true; });
  return { proceeded, req, res };
}

test('guard is inert when no intake token is configured', () => {
  const guard = createIntakeGuard();
  const result = request(guard, {});
  assert.equal(result.proceeded, true);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.req.gapuraIntake, undefined);
});

test('valid intake token proceeds and marks the request', () => {
  const guard = createIntakeGuard({ token: 'test-intake-secret' });
  const result = request(guard, { 'x-gapura-intake-token': 'test-intake-secret' });
  assert.equal(result.proceeded, true);
  assert.equal(result.req.gapuraIntake, true);
});

test('missing token from a non-browser caller is rejected', () => {
  const guard = createIntakeGuard({ token: 'test-intake-secret' });
  const result = request(guard, {});
  assert.equal(result.proceeded, false);
  assert.equal(result.res.statusCode, 401);
});

test('wrong token from a non-browser caller is rejected', () => {
  const guard = createIntakeGuard({ token: 'test-intake-secret' });
  const result = request(guard, { 'x-gapura-intake-token': 'wrong-secret' });
  assert.equal(result.proceeded, false);
  assert.equal(result.res.statusCode, 401);
});

test('browser requests with an Origin header still pass for the Studio UI', () => {
  const guard = createIntakeGuard({ token: 'test-intake-secret' });
  const result = request(guard, { origin: 'https://gapura.avenia.my.id' });
  assert.equal(result.proceeded, true);
  assert.equal(result.req.gapuraIntake, undefined);
});
