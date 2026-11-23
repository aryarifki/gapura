import test from 'node:test';
import assert from 'node:assert/strict';
import { runAutopilotScheduler } from '../autopilot-scheduler.js';

function makeCandidate(overrides = {}) {
  return {
    id: 201,
    topic_id: 1880,
    topic_title: 'IHSG Menguat Tipis',
    raw_title: 'IHSG Menguat Tipis',
    normalized_title: 'IHSG Menguat Tipis',
    primary_source: 'IDX Channel',
    source_id: 4,
    source_url: 'https://www.idxchannel.com/market-news/fixture',
    topic_desk: 'bursa',
    topic_keywords: ['ihsg'],
    source_published_at: '2026-11-23T04:00:00.000Z',
    topic_created_at: '2026-11-23T04:00:00.000Z',
    score_total: 88,
    analyst_verdict: 'passed',
    status: 'draft',
    needs_review: true,
    copy_model: 'staged-editorial-v3',
    content_format: 'carousel',
    caption: 'Caption berita bursa yang lengkap.',
    hashtags: ['#GapuraMedia'],
    slides: [{ no: 1, role: 'cover', layout: 'editorial-cover', teks: '', data: { title: 'IHSG Menguat', kicker: 'Bursa', cover_mode: 'typography' } }],
    editorial_input: { version: 1, mode: 'current', facts: [] },
    editorial_mode: 'current',
    caption_body: 'Caption berita bursa yang lengkap.',
    threads_caption: 'Ringkasan Threads bursa #GapuraMedia',
    angle: 'Pergerakan indeks',
    scope_note: 'Data perdagangan harian',
    editorial_references: { caption: [], threads: [] },
    article_body: 'A'.repeat(1300),
    article_references: [{ url: 'https://a.example' }, { url: 'https://b.example' }, { url: 'https://c.example' }],
    article_facts: [],
    article_metadata: { pipeline: { status: 'VALIDATED' } },
    ...overrides,
  };
}

test('runAutopilotScheduler returns early when GAPURA_AUTOPILOT_PUBLISH is not true', async () => {
  const pool = { connect() { throw new Error('Should not connect when disabled'); } };
  const res = await runAutopilotScheduler({ pool, env: { GAPURA_AUTOPILOT_PUBLISH: 'false' } });
  assert.equal(res.scheduled, 0);
  assert.equal(res.skipped, 'disabled');
});

test('runAutopilotScheduler skips non-Bursa/OJK ekonomi drafts and schedules priority draft into optimal WIB slot', async () => {
  const queries = [];
  const disallowedEkonomi = makeCandidate({
    id: 200,
    topic_desk: 'ekonomi',
    topic_title: 'Daftar Lengkap UMP 2027 Daerah',
    raw_title: 'Daftar Lengkap UMP 2027 Daerah',
    normalized_title: 'Daftar Lengkap UMP 2027 Daerah',
    primary_source: 'CNN Indonesia Ekonomi',
    source_url: 'https://www.cnnindonesia.com/ekonomi/ump-2027',
    topic_keywords: ['ump', 'daerah'],
  });
  const bursaDraft = makeCandidate({ id: 201, topic_desk: 'bursa' });

  const pool = {
    async connect() {
      return {
        release() {},
        async query(sql, values = []) {
          const q = sql.replace(/\s+/g, ' ').trim();
          queries.push({ q, values });
          if (q.startsWith("SELECT COUNT(*)::int AS cnt FROM scheduled_posts")) return { rows: [{ cnt: 0 }] };
          if (q.includes('FROM app_settings')) return { rows: [{ key: 'publishing_hours_wib', value: ['07:30', '12:15', '19:00'] }] };
          if (q.includes('COALESCE(sp.published_at, sp.scheduled_at)')) return { rows: [] };
          if (q.includes('FROM drafts d JOIN topics t ON t.id = d.topic_id')) return { rows: [disallowedEkonomi, bursaDraft] };
          if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };
          if (q.includes("SELECT * FROM drafts WHERE id = $1 AND status = 'draft' FOR UPDATE")) return { rows: [bursaDraft] };
          if (q.startsWith("UPDATE drafts SET status = 'scheduled'")) return { rowCount: 1 };
          if (q.startsWith('INSERT INTO scheduled_posts')) return { rowCount: 1 };
          if (q.startsWith('INSERT INTO audit_log')) return { rowCount: 1 };
          throw new Error(`Unexpected SQL: ${q}`);
        },
      };
    },
  };

  const res = await runAutopilotScheduler({
    pool,
    config: { analis: { ekonomi_requires_bursa_or_ojk: true, priority_desks: ['bursa', 'politik'] } },
    env: { GAPURA_AUTOPILOT_PUBLISH: 'true', GAPURA_AUTOPILOT_QUEUE_SIZE: '2', GAPURA_DAILY_PUBLISH_LIMIT: '6' },
    now: new Date('2026-11-23T04:00:00.000Z'), // 11:00 WIB
    logger: { log() {} },
  });

  assert.equal(res.scheduled, 1);
  assert.equal(res.items[0].draft_id, 201);
  assert.equal(res.items[0].slot_wib, '2026-11-23 12:15 WIB');
  const auditCall = queries.find(({ q }) => q.startsWith('INSERT INTO audit_log'));
  assert.match(auditCall.q, /'owner_autopilot'/);
});
