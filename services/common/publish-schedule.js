// Optimal WIB publishing schedule helpers for Gapura Media.
// All dates use fixed Asia/Jakarta (UTC+7) arithmetic so slot computation is
// deterministic across server timezones and tests.

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DEFAULT_PUBLISHING_HOURS_WIB = Object.freeze([
  '07:30',
  '10:00',
  '12:15',
  '15:30',
  '19:00',
  '21:00',
]);
export const DEFAULT_DAILY_PUBLISH_LIMIT = 6;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function wibDateKey(date) {
  const ts = date instanceof Date ? date.getTime() : Date.parse(date);
  if (!Number.isFinite(ts)) throw new Error('Tanggal slot publikasi tidak valid.');
  const wib = new Date(ts + WIB_OFFSET_MS);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatWibTimestamp(date) {
  const ts = date instanceof Date ? date.getTime() : Date.parse(date);
  if (!Number.isFinite(ts)) return '';
  const wib = new Date(ts + WIB_OFFSET_MS);
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${wibDateKey(date)} ${hh}:${mm} WIB`;
}

export function parseHoursWib(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [...DEFAULT_PUBLISHING_HOURS_WIB];
  const valid = [...new Set(
    list
      .map((item) => String(item ?? '').trim())
      .filter((item) => HHMM_RE.test(item)),
  )].sort();
  return valid.length ? valid : [...DEFAULT_PUBLISHING_HOURS_WIB];
}

function slotUtcFromWibDay(baseWibDate, dayOffset, hhmm) {
  const match = HHMM_RE.exec(hhmm);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return new Date(Date.UTC(
    baseWibDate.getUTCFullYear(),
    baseWibDate.getUTCMonth(),
    baseWibDate.getUTCDate() + dayOffset,
    hour,
    minute,
    0,
    0,
  ) - WIB_OFFSET_MS);
}

export function computeNextPublishSlot({
  now = new Date(),
  hoursWib = DEFAULT_PUBLISHING_HOURS_WIB,
  occupiedDates = [],
  dailyLimit = DEFAULT_DAILY_PUBLISH_LIMIT,
  minLeadMinutes = 5,
  minSpacingMinutes = 90,
  maxDaysAhead = 14,
} = {}) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Waktu acuan slot publikasi tidak valid.');
  const hours = parseHoursWib(hoursWib);
  const limit = Number.isInteger(dailyLimit) && dailyLimit >= 0 ? dailyLimit : DEFAULT_DAILY_PUBLISH_LIMIT;
  const leadMs = Math.max(0, Number(minLeadMinutes) || 0) * 60_000;
  const spacingMs = Math.max(0, Number(minSpacingMinutes) || 0) * 60_000;

  const occupiedTimestamps = [];
  const countsByWibDay = new Map();
  for (const item of occupiedDates || []) {
    const ts = item instanceof Date ? item.getTime() : Date.parse(item);
    if (!Number.isFinite(ts)) continue;
    occupiedTimestamps.push(ts);
    const key = wibDateKey(new Date(ts));
    countsByWibDay.set(key, (countsByWibDay.get(key) || 0) + 1);
  }

  const baseWib = new Date(nowMs + WIB_OFFSET_MS);
  for (let dayOffset = 0; dayOffset <= maxDaysAhead; dayOffset++) {
    const dayProbe = new Date(Date.UTC(baseWib.getUTCFullYear(), baseWib.getUTCMonth(), baseWib.getUTCDate() + dayOffset) - WIB_OFFSET_MS);
    const dayKey = wibDateKey(dayProbe);
    if (limit > 0 && (countsByWibDay.get(dayKey) || 0) >= limit) continue;

    for (const hhmm of hours) {
      const candidate = slotUtcFromWibDay(baseWib, dayOffset, hhmm);
      if (!candidate) continue;
      const candMs = candidate.getTime();
      if (candMs < nowMs + leadMs) continue;
      if (occupiedTimestamps.some((ts) => Math.abs(candMs - ts) < spacingMs)) continue;
      return {
        scheduledAt: candidate,
        slotWib: formatWibTimestamp(candidate),
      };
    }
  }

  const fallback = new Date(nowMs + Math.max(leadMs, spacingMs || 60 * 60_000));
  return {
    scheduledAt: fallback,
    slotWib: formatWibTimestamp(fallback),
  };
}

export async function loadPublishingScheduleConfig(client, env = process.env) {
  let hoursWib = [...DEFAULT_PUBLISHING_HOURS_WIB];
  let dailyLimit = Number.parseInt(String(env.GAPURA_DAILY_PUBLISH_LIMIT || DEFAULT_DAILY_PUBLISH_LIMIT), 10);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1) dailyLimit = DEFAULT_DAILY_PUBLISH_LIMIT;

  try {
    const { rows } = await client.query(
      "SELECT key, value FROM app_settings WHERE key IN ('publishing_hours_wib')",
    );
    const hoursRow = rows.find((r) => r.key === 'publishing_hours_wib');
    if (hoursRow) hoursWib = parseHoursWib(hoursRow.value);
  } catch {
    // Keep defaults if app_settings is unavailable.
  }

  return { hoursWib, dailyLimit };
}

export async function loadOccupiedPublishDates(client) {
  const { rows } = await client.query(`
    SELECT COALESCE(sp.published_at, sp.scheduled_at) AS slot_at
    FROM scheduled_posts sp
    WHERE sp.status IN ('pending', 'publishing', 'success')
      AND COALESCE(sp.published_at, sp.scheduled_at) >= NOW() - INTERVAL '36 hours'
    UNION ALL
    SELECT MIN(pt.published_at) AS slot_at
    FROM publication_targets pt
    WHERE pt.status = 'published'
      AND pt.published_at >= NOW() - INTERVAL '36 hours'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_posts sp2
        WHERE sp2.draft_id = pt.draft_id AND sp2.status = 'success'
      )
    GROUP BY pt.draft_id
  `);
  return rows.map((row) => row.slot_at).filter(Boolean).map((value) => new Date(value));
}
