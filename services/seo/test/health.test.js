import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrendHealth } from '../health.js';

test('reports the newest successful scan and fresh status', () => {
  const result = buildTrendHealth([
    { is_active: true, last_error: null, last_scanned_at: '2026-11-16T11:55:00Z' },
    { is_active: true, last_error: '429', last_scanned_at: '2026-11-16T11:58:00Z' },
  ], { now: Date.parse('2026-11-16T12:00:00Z'), xApiConfigured: true });
  assert.equal(result.active_sources, 2);
  assert.equal(result.successful_sources, 1);
  assert.equal(result.stale, false);
  assert.equal(result.provider_mode, 'x_api');
});

test('surfaces old or absent data and labels public-web trend fallbacks honestly', () => {
  assert.equal(buildTrendHealth([], { now: 1000 }).stale, true);
  const result = buildTrendHealth([{ is_active: true, last_error: null, last_scanned_at: '2026-11-16T08:00:00Z' }], {
    now: Date.parse('2026-11-16T12:00:00Z'), rssHubConfigured: false,
  });
  assert.equal(result.stale, true);
  assert.equal(result.provider_mode, 'google_trends_bluesky_forums');
});

test('marks an all-failed source set stale without hiding its active source count', () => {
  const result = buildTrendHealth([{ is_active: true, last_error: 'HTTP 429', last_scanned_at: '2026-11-16T11:59:00Z' }], {
    now: Date.parse('2026-11-16T12:00:00Z'), rssHubConfigured: true,
  });
  assert.equal(result.active_sources, 1);
  assert.equal(result.successful_sources, 0);
  assert.equal(result.stale, true);
});

test('last successful scan survives later failures and invalid timestamps never count as successes', () => {
  const result = buildTrendHealth([
    { is_active: true, last_error: 'HTTP 503', last_scanned_at: '2026-11-16T11:59:00Z', last_success_at: '2026-11-16T11:55:00Z' },
    { is_active: true, last_error: null, last_scanned_at: 'invalid' },
  ], { now: Date.parse('2026-11-16T12:00:00Z') });
  assert.equal(result.successful_sources, 1);
  assert.equal(result.latest_success_at, '2026-11-16T11:55:00.000Z');
  assert.equal(result.stale, false);
  assert.equal(result.failed_sources, 1);
});
