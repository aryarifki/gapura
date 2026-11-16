import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadMetaConnection, saveMetaConnection } from '../meta-connection-store.js';

const connection = { access_token: 'private-test-token', app_id: '1123019133826199', config_id: '1848852586267233', client_business_id: '123', instagram_account_id: '1784', username: 'gapuramedia', graph_version: 'v27.0', connected_at: '2026-11-16T00:00:00.000Z', expires_at: null };

test('Meta connection is saved atomically with private permissions and remains server-only', (t) => {
  const root = fs.mkdtempSync('/tmp/opencode/gapura-meta-store-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'private', 'meta.json');
  assert.equal(loadMetaConnection(file), null);
  assert.deepEqual(saveMetaConnection(connection, file), { configured: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepEqual(loadMetaConnection(file), connection);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['meta.json']);
});

test('invalid Meta connections are rejected without overwriting the previous one', (t) => {
  const root = fs.mkdtempSync('/tmp/opencode/gapura-meta-store-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'meta.json');
  saveMetaConnection(connection, file);
  for (const patch of [{ access_token: '' }, { instagram_account_id: '../bad' }, { app_id: null }, { client_business_id: '' }, { expires_at: 'invalid-date' }]) {
    assert.throws(() => saveMetaConnection({ ...connection, ...patch }, file));
    assert.deepEqual(loadMetaConnection(file), connection);
  }
  fs.writeFileSync(file, 'not-json');
  assert.equal(loadMetaConnection(file), null);
});
