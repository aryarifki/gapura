import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeSecret } from '../runtime-secret.js';

test('returns configured secrets without altering them', () => {
  const old = process.env.RUNTIME_SECRET_TEST;
  process.env.RUNTIME_SECRET_TEST = 'configured-value';
  try { assert.equal(runtimeSecret('RUNTIME_SECRET_TEST'), 'configured-value'); }
  finally { if (old === undefined) delete process.env.RUNTIME_SECRET_TEST; else process.env.RUNTIME_SECRET_TEST = old; }
});

test('production fails closed when a runtime secret is missing', () => {
  const oldMode = process.env.NODE_ENV;
  const old = process.env.RUNTIME_SECRET_MISSING;
  process.env.NODE_ENV = 'production';
  delete process.env.RUNTIME_SECRET_MISSING;
  try { assert.throws(() => runtimeSecret('RUNTIME_SECRET_MISSING'), /wajib dikonfigurasi/); }
  finally {
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (old === undefined) delete process.env.RUNTIME_SECRET_MISSING; else process.env.RUNTIME_SECRET_MISSING = old;
  }
});

test('non-production has no shared default secret', () => {
  const oldMode = process.env.NODE_ENV;
  const old = process.env.RUNTIME_SECRET_EMPTY;
  delete process.env.RUNTIME_SECRET_EMPTY;
  process.env.NODE_ENV = 'development';
  try { assert.equal(runtimeSecret('RUNTIME_SECRET_EMPTY'), ''); }
  finally {
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (old === undefined) delete process.env.RUNTIME_SECRET_EMPTY; else process.env.RUNTIME_SECRET_EMPTY = old;
  }
});
