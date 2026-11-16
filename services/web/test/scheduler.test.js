import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../scheduler.js';

test('reads native timer state and never treats old n8n DB active flag as proof', async () => {
  const calls = [];
  const scheduler = createScheduler({ execute: async (command, args) => {
    calls.push([command, args]);
    return { stdout: 'ActiveState=active\nNextElapseUSecRealtime=Mon 2026-11-16 12:15:00 WIB\nLastTriggerUSec=Mon 2026-11-16 12:00:00 WIB\n' };
  } });
  const status = await scheduler.status();
  assert.equal(status.active, true);
  assert.equal(status.kind, 'systemd');
  assert.match(status.next_run, /12:15/);
  assert.equal(calls[0][0], 'systemctl');
});

test('changes only the dedicated Gapura timer and rejects ambiguous toggle values', async () => {
  const calls = [];
  const scheduler = createScheduler({ execute: async (command, args) => { calls.push([command, args]); return { stdout: '' }; } });
  await scheduler.toggle(false);
  assert.deepEqual(calls[0], ['systemctl', ['disable', '--now', 'gapura-pipeline.timer']]);
  await assert.rejects(() => scheduler.toggle('false'), /boolean/);
});
