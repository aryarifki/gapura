import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStoryClaims } from '../storytelling.js';
import { buildEditorialBrief, validateOriginalContent } from '../../common/original-editorial.js';
import { storyFixture, storyInput, storyTopic } from '../../common/test/fixtures/story-editorial.js';

test('the internal checker rejects unsupported claims without editing public prose or approving publication', async () => {
  const brief = buildEditorialBrief(storyTopic, { editorialInput: storyInput, slideCount: 5 });
  const c = validateOriginalContent(storyFixture(), brief); const before = JSON.stringify(c);
  const review = await checkStoryClaims(c, brief, { reviewer: async (_agent, prompt, policy, _json, options) => {
    assert.equal(options.includeAgentPolicy, false); assert.equal(options.skills, '');
    assert.match(policy, /pemeriksa klaim internal/u); assert.match(prompt, /FACTS_JSON/u);
    return JSON.stringify({ supported: false, issues: [{ channel: 'caption', location: 'paragraf awal', reason: 'Dampak tidak didukung sumber.', fact_ids: ['f1'] }] });
  } });
  assert.equal(review.supported, false); assert.equal(review.publication_approved, false);
  assert.equal(JSON.stringify(c), before);
  assert.match(review.checked_hash, /^[a-f0-9]{64}$/u);
});

test('the checker accepts flat object rows and both legacy review response forms', async () => {
  const brief = buildEditorialBrief(storyTopic, { editorialInput: storyInput, slideCount: 5 });
  const content = validateOriginalContent(storyFixture(), brief);
  for (const result of [{ rows: [{ kind: 'verdict', supported: true }] }, [{ kind: 'verdict', supported: true }], { supported: true, issues: [] }]) {
    const review = await checkStoryClaims(content, brief, { reviewer: async (_agent, _prompt, _policy, _json, options) => {
      assert.equal(options.responseSchema.type, 'object');
      assert.equal(options.responseSchema.properties.rows.type, 'array');
      return JSON.stringify(result);
    } });
    assert.equal(review.supported, true);
    assert.deepEqual(review.issues, []);
    assert.equal(review.publication_approved, false);
  }
});

test('legacy review issues may omit optional fact IDs but unknown IDs still fail the actual gate', async () => {
  const brief = buildEditorialBrief(storyTopic, { editorialInput: storyInput, slideCount: 5 });
  const content = validateOriginalContent(storyFixture(), brief);
  const issue = { channel: 'caption', reason: 'Premis pertanyaan perlu diperjelas.' };
  const check = (value) => checkStoryClaims(content, brief, { reviewer: async () => JSON.stringify({ supported: false, issues: [value] }) });
  assert.deepEqual((await check(issue)).issues[0].fact_ids, []);
  await assert.rejects(check({ ...issue, fact_ids: ['unknown'] }), /review_issue_fact_ids_invalid/u);
});
