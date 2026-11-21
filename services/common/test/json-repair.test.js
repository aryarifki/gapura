import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJsonResponse, jsonRootCandidate } from '../json-repair.js';

test('preserves an entire valid root array, not its first object', async () => {
  const raw = '[{"kind":"one"},{"kind":"two"}]';
  assert.equal(await normalizeJsonResponse(raw), raw);
  assert.deepEqual(JSON.parse(jsonRootCandidate('response:\n```json\n[{"id":1},{"id":2}]\n```')), [{ id: 1 }, { id: 2 }]);
});

test('preserves object roots and does not turn arbitrary prose into invented JSON', async () => {
  assert.equal(await normalizeJsonResponse('```json\n{"rows":[{"ok":true}]}\n```'), '{"rows":[{"ok":true}]}');
  assert.equal(await normalizeJsonResponse('No JSON was returned.'), 'No JSON was returned.');
});

test('repairs malformed legacy JSON arrays with the installed Python repair gate when available', async (context) => {
  const pythonPath = '/etc/gapura/editorial-venv/bin/python';
  try { await import('node:fs/promises').then(({ access }) => access(pythonPath)); }
  catch { context.skip('the editorial Python environment is not installed'); return; }
  const repaired = await normalizeJsonResponse('[{kind: "first",}, {kind: "second",}]');
  assert.deepEqual(JSON.parse(repaired), [{ kind: 'first' }, { kind: 'second' }]);
});

test('fails closed to the original input when the Python repair executable is unavailable', async () => {
  const raw = '[{kind: "first"}, {kind: "second"}]';
  assert.equal(await normalizeJsonResponse(raw, { pythonPath: '/nonexistent/json-repair-python' }), raw);
});
