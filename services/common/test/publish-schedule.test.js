import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PUBLISHING_HOURS_WIB,
  computeNextPublishSlot,
  formatWibTimestamp,
  parseHoursWib,
  wibDateKey,
} from '../publish-schedule.js';

test('parseHoursWib validates HH:MM slots and falls back safely', () => {
  assert.deepEqual(parseHoursWib(['21:00', '07:30', '07:30', 'bad', '12:15']), ['07:30', '12:15', '21:00']);
  assert.deepEqual(parseHoursWib('["19:00","10:00"]'), ['10:00', '19:00']);
  assert.deepEqual(parseHoursWib('not-json'), [...DEFAULT_PUBLISHING_HOURS_WIB]);
});

test('computeNextPublishSlot picks the next available peak WIB slot with spacing and daily limit', () => {
  // 2026-11-23 11:30 WIB = 04:30 UTC
  const now = new Date('2026-11-23T04:30:00.000Z');
  const first = computeNextPublishSlot({ now });
  assert.equal(first.slotWib, '2026-11-23 12:15 WIB');

  // If 12:15 WIB is occupied, next is 15:30 WIB
  const second = computeNextPublishSlot({ now, occupiedDates: [first.scheduledAt] });
  assert.equal(second.slotWib, '2026-11-23 15:30 WIB');

  // If 6 slots already occupied on 2026-11-23 WIB, rolls over to 2026-11-24 07:30 WIB
  const fullDay = DEFAULT_PUBLISHING_HOURS_WIB.map((hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(2026, 10, 23, h - 7, m, 0, 0));
  });
  assert.equal(wibDateKey(fullDay[0]), '2026-11-23');
  const nextDay = computeNextPublishSlot({ now, occupiedDates: fullDay, dailyLimit: 6 });
  assert.equal(nextDay.slotWib, '2026-11-24 07:30 WIB');
  assert.equal(formatWibTimestamp(nextDay.scheduledAt), '2026-11-24 07:30 WIB');
});
