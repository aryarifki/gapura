import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const executeCommand = promisify(execFile);

export function createScheduler({ execute = executeCommand } = {}) {
  return {
    async status() {
      try {
        const { stdout } = await execute('systemctl', ['show', 'gapura-pipeline.timer', '--property=ActiveState,NextElapseUSecRealtime,LastTriggerUSec'], { timeout: 4000 });
        const fields = Object.fromEntries(stdout.trim().split('\n').map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
        return { kind: 'systemd', name: 'Gapura editorial pipeline', active: fields.ActiveState === 'active', next_run: fields.NextElapseUSecRealtime || null, last_run: fields.LastTriggerUSec || null, interval_minutes: 15, delivery_enabled: false };
      } catch { return { kind: 'systemd', active: false, error: 'Timer Gapura belum tersedia.', interval_minutes: 15, delivery_enabled: false }; }
    },
    async toggle(active) {
      if (typeof active !== 'boolean') throw new TypeError('active harus boolean.');
      await execute('systemctl', [active ? 'enable' : 'disable', '--now', 'gapura-pipeline.timer'], { timeout: 6000 });
      return this.status();
    },
  };
}
