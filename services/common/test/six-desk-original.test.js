import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEditorialBrief, validateOriginalContent } from '../original-editorial.js';
import { SIX_DESK_CORPUS } from './fixtures/six-desk-original.js';

const briefFor = ({ topic, editorialInput }) => buildEditorialBrief(topic, { editorialInput });
const corpusFor = (desk) => SIX_DESK_CORPUS.find((entry) => entry.desk === desk);
const normalize = (value) => value.toLocaleLowerCase('id').replace(/\s+/gu, ' ').trim();

test('the corpus has exactly the six supported desks and clearly labels invented material', () => {
  assert.deepEqual(SIX_DESK_CORPUS.map(({ desk }) => desk).sort(), ['bursa', 'ekonomi', 'hukum', 'lingkungan', 'politik', 'sosial']);
  for (const { desk, topic, editorialInput, raw } of SIX_DESK_CORPUS) {
    assert.equal(topic.desk, desk);
    assert.match(topic.title, /^SYNTHETIC:/u);
    assert.match(topic.primary_source, /SYNTHETIC/u);
    assert.equal(new URL(topic.url).hostname, 'example.org');
    assert.match(raw.scope_note, /^SYNTHETIC:/u);
    assert.match(raw.caption_blocks[0].text, /^SYNTHETIC/u);
    assert.match(raw.threads_body, /^SYNTHETIC:/u);
    for (const fact of editorialInput.facts) {
      assert.deepEqual(Object.keys(fact).sort(), fact.quote
        ? ['id', 'quote', 'source_name', 'source_url', 'text']
        : ['id', 'source_name', 'source_url', 'text']);
      assert.match(fact.text, /^SYNTHETIC:/u);
      assert.match(fact.source_name, /SYNTHETIC/u);
      assert.equal(new URL(fact.source_url).hostname, 'example.org');
      if (fact.quote) assert.deepEqual(Object.keys(fact.quote).sort(), ['speaker', 'text']);
    }
  }
});

for (const entry of SIX_DESK_CORPUS) {
  test(`${entry.desk}: validates six original contributions and platform captions through the shared contract`, () => {
    const brief = briefFor(entry);
    const content = validateOriginalContent(entry.raw, brief);
    assert.equal(brief.discovery.desk, entry.desk);
    assert.equal(brief.discovery.normalized_title, entry.topic.title);
    assert.equal(brief.slide_count, 6);
    assert.equal(content.format, 'carousel');
    assert.equal(content.editorial_mode, entry.editorialInput.mode);
    assert.equal(content.needs_review, true);
    assert.equal(content.source_url, entry.topic.url);
    assert.deepEqual(content.editorial_input, entry.editorialInput);
    assert.equal(content.slides.length, 6);
    assert.deepEqual(content.slides.map(({ no }) => no), [1, 2, 3, 4, 5, 6]);
    assert.equal(content.slides[0].role, 'cover');
    assert.equal(content.slides[0].layout, 'cover-focus');
    assert.equal(content.slides.at(-1).role, 'close');
    assert.notEqual(normalize(content.slides[0].teks), normalize(brief.discovery.normalized_title));
    assert.equal(content.slides[0].data.title, content.slides[0].teks);
    assert.equal(new Set(content.slides.map(({ purpose }) => normalize(purpose))).size, 6);
    assert.equal(new Set(content.slides.map(({ teks }) => normalize(teks))).size, 6);
    for (const [index, result] of content.slides.entries()) {
      assert.equal(result.teks, entry.raw.slides[index].teks);
      assert.deepEqual(result.data, entry.raw.slides[index].data);
      assert.equal(result.source, entry.topic.primary_source);
      assert.ok(result.teks.length <= (index === 0 ? 120 : 500));
    }

    const body = entry.raw.caption_blocks.map(({ text }) => text).join('\n\n');
    const tags = content.hashtags.join(' ');
    assert.equal(content.caption_body, body);
    assert.ok(body.length >= 1200 && body.length <= 1900, `${entry.desk}: ${body.length} caption characters`);
    assert.equal(content.caption, `${body}\n\n${tags}`);
    assert.ok(content.caption.length <= 2200);
    assert.equal(content.threads_caption, `${entry.raw.threads_body}\n\n${tags}`);
    assert.ok(content.threads_caption.length <= 500);
    assert.equal(content.caption.match(/#GapuraMedia/gu).length, 1);
    assert.equal(content.threads_caption.match(/#GapuraMedia/gu).length, 1);
    assert.doesNotMatch(body, /#[\p{L}\p{N}_]+|https?:\/\//u);
    assert.doesNotMatch(entry.raw.threads_body, /#[\p{L}\p{N}_]+|https?:\/\//u);
    assert.deepEqual(content.editorial_references.caption, entry.raw.caption_blocks.map(({ kind, fact_ids }) => ({ kind, fact_ids })));
    assert.deepEqual(content.editorial_references.threads, entry.raw.threads_fact_ids);
  });
}

test('desk scripts, caption paragraphs, purposes and angles are independently authored', () => {
  const vocabulary = {
    politik: /anggaran|mandat|aspirasi|risalah|partisipasi|perwakilan/iu,
    sosial: /sekolah|pendaftaran|disabilitas|keluarga/iu,
    hukum: /laporan|dugaan|diduga|pemeriksa|pelapor|tuduhan/iu,
    lingkungan: /hujan|saluran|genangan|pembersihan/iu,
    ekonomi: /keranjang|belanja|harga|anggaran keluarga/iu,
    bursa: /dividen|emiten|pemegang saham|laba/iu,
  };
  const scripts = SIX_DESK_CORPUS.flatMap(({ raw }) => raw.slides.map(({ teks }) => normalize(teks)));
  const purposes = SIX_DESK_CORPUS.flatMap(({ raw }) => raw.slides.map(({ purpose }) => normalize(purpose)));
  const paragraphs = SIX_DESK_CORPUS.flatMap(({ raw }) => raw.caption_blocks.map(({ text }) => normalize(text)));
  assert.equal(new Set(scripts).size, 36);
  assert.equal(new Set(purposes).size, 36);
  assert.equal(new Set(paragraphs).size, paragraphs.length);
  for (const field of ['angle', 'scope_note', 'threads_body']) {
    assert.equal(new Set(SIX_DESK_CORPUS.map(({ raw }) => normalize(raw[field]))).size, 6, field);
  }
  for (const { desk, raw } of SIX_DESK_CORPUS) {
    assert.ok(raw.slides.slice(1).every(({ teks }) => vocabulary[desk].test(teks)), `${desk}: substantive desk-specific slides`);
    assert.ok(raw.caption_blocks.filter(({ text }) => vocabulary[desk].test(text)).length >= 4, `${desk}: substantive caption paragraphs`);
  }
});

test('title-only explainers require no facts and current references map only to their own supplied facts', () => {
  assert.deepEqual(SIX_DESK_CORPUS.filter(({ editorialInput }) => editorialInput.mode === 'explainer').map(({ desk }) => desk), ['politik', 'sosial', 'ekonomi', 'bursa']);
  assert.deepEqual(SIX_DESK_CORPUS.filter(({ editorialInput }) => editorialInput.mode === 'current').map(({ desk }) => desk), ['hukum', 'lingkungan']);
  for (const entry of SIX_DESK_CORPUS) {
    const brief = briefFor(entry);
    const content = validateOriginalContent(entry.raw, brief);
    const facts = new Map(brief.facts.map((fact) => [fact.id, fact]));
    const used = new Set();
    const contributions = [
      ...entry.raw.slides,
      ...entry.raw.caption_blocks,
      { fact_ids: entry.raw.threads_fact_ids },
      ...entry.raw.slides.flatMap(({ data }) => data.events || []),
    ];
    for (const part of contributions) {
      assert.ok(Array.isArray(part.fact_ids));
      for (const id of part.fact_ids) {
        assert.ok(facts.has(id), `${entry.desk}: unknown reference ${id}`);
        used.add(id);
      }
      if (part.claim_type === 'fact' || part.kind === 'fact') assert.ok(part.fact_ids.length > 0);
    }
    assert.deepEqual([...used].sort(), [...facts.keys()].sort());
    if (brief.mode === 'explainer') {
      assert.deepEqual(brief.facts, []);
      assert.ok(content.slides.every(({ claim_type, fact_ids }) => claim_type !== 'fact' && fact_ids.length === 0));
    } else {
      assert.ok(content.slides.some(({ claim_type, fact_ids }) => claim_type === 'fact' && fact_ids.length > 0));
    }
  }
});

test('the current law statement preserves the exact supplied quote, speaker and allegation qualifier', () => {
  const law = corpusFor('hukum');
  const content = validateOriginalContent(law.raw, briefFor(law));
  const statement = content.slides.find(({ role }) => role === 'official_statement');
  assert.ok(statement);
  assert.equal(statement.claim_type, 'fact');
  const fact = law.editorialInput.facts.find(({ id }) => statement.fact_ids.includes(id));
  assert.deepEqual(statement.data, { quote: fact.quote.text, author: fact.quote.speaker });
  assert.ok(statement.teks.includes(fact.quote.text));
  assert.ok(statement.teks.includes(fact.quote.speaker));
  assert.ok(law.raw.caption_blocks.some(({ fact_ids, text }) => fact_ids.includes(fact.id) && text.includes(fact.quote.text) && text.includes(fact.quote.speaker)));
  assert.ok(law.raw.threads_body.includes(fact.quote.text));
  assert.ok(law.raw.threads_body.includes(fact.quote.speaker));
  const reportSlide = content.slides.find(({ fact_ids }) => fact_ids.includes('law_report'));
  assert.match(reportSlide.teks, /\bdiduga\b/u);
  assert.match(law.raw.caption_blocks.find(({ fact_ids }) => fact_ids.includes('law_report')).text, /\bdiduga\b/u);
  assert.match(law.raw.threads_body, /\bdiduga\b/u);
});

test('the current environmental chronology binds ordered ISO dates to distinct synthetic observations', () => {
  const environment = corpusFor('lingkungan');
  const content = validateOriginalContent(environment.raw, briefFor(environment));
  const chronology = content.slides.find(({ role }) => role === 'chronology');
  assert.ok(chronology);
  assert.equal(chronology.layout, 'timeline');
  assert.equal(chronology.claim_type, 'fact');
  assert.deepEqual(chronology.data.events.map(({ date }) => date), ['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(chronology.data.events.map(({ fact_ids }) => fact_ids), [['env_rain'], ['env_inspection'], ['env_cleanup']]);
  for (const event of chronology.data.events) {
    assert.match(event.text, /SYNTHETIC/u);
    const fact = environment.editorialInput.facts.find(({ id }) => event.fact_ids.includes(id));
    assert.ok(fact.text.includes(event.date));
    assert.ok(chronology.fact_ids.includes(fact.id));
    assert.equal(new Date(event.date).toISOString().slice(0, 10), event.date);
  }
  assert.match(content.slides.at(-1).teks, /tidak memuat pengukuran genangan/u);
});

test('current fixtures reject missing qualifiers, altered attribution and broken event references', () => {
  const law = corpusFor('hukum');
  const certainty = structuredClone(law.raw);
  certainty.slides[1].teks = certainty.slides[1].teks.replace('diduga', 'terbukti');
  assert.throws(() => validateOriginalContent(certainty, briefFor(law)), /qualifier_missing/u);
  const misattributed = structuredClone(law.raw);
  misattributed.slides[2].data.author = 'Pembicara Lain SYNTHETIC';
  assert.throws(() => validateOriginalContent(misattributed, briefFor(law)), /quote_attribution_invalid/u);

  const environment = corpusFor('lingkungan');
  const unknownReference = structuredClone(environment.raw);
  unknownReference.slides[2].data.events[0].fact_ids = ['law_report'];
  assert.throws(() => validateOriginalContent(unknownReference, briefFor(environment)), /timeline_fact_ids_invalid/u);
  const reversed = structuredClone(environment.raw);
  reversed.slides[2].data.events.reverse();
  assert.throws(() => validateOriginalContent(reversed, briefFor(environment)), /timeline_date_invalid/u);
});
