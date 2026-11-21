import test from 'node:test';
import assert from 'node:assert/strict';
import { callAgentLLM, loadAgentSkills, saveAgentSkills } from '../llm.js';
import { buildAttempts } from '../providers.js';
import { geminiPoolStatus, resetGeminiPool } from '../llm-pool.js';

test('Gemini sends credentials in a header and uses real system instructions plus temporary skills', async () => {
  let request;
  const result = await callAgentLLM('studio', 'Source article', 'Runtime contract', true, {
    config: { studio: { provider: 'gemini', model: 'chosen-model', api_key: 'secret-test', system_prompt: 'Saved policy' } },
    skills: 'Temporary rubric',
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":' }, { text: 'true}' }] } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.equal(new URL(request.url).searchParams.has('key'), false);
  assert.equal(request.init.headers['x-goog-api-key'], 'secret-test');
  assert.match(request.body.systemInstruction.parts[0].text, /Saved policy/);
  assert.match(request.body.systemInstruction.parts[0].text, /Runtime contract/);
  assert.match(request.body.systemInstruction.parts[0].text, /Temporary rubric/);
  assert.equal(request.body.contents.length, 1);
});

test('a standalone extraction task can exclude unrelated saved agent policy and skills', async () => {
  let body;
  await callAgentLLM('copywriter', 'KANDIDAT_PETIKAN_JSON: []', 'EXTRACTOR_ONLY_POLICY', true, {
    config: { copywriter: { provider: 'gemini', model: 'chosen-model', api_key: 'secret-test', system_prompt: 'SAVED_CAROUSEL_ONLY_POLICY' } },
    skills: 'CAROUSEL_AND_CAPTION_SKILLS', includeAgentPolicy: false,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"passage_ids":[]}' }] } }] });
    },
  });
  const policy = body.systemInstruction.parts[0].text;
  assert.equal(policy, 'EXTRACTOR_ONLY_POLICY');
  assert.doesNotMatch(policy, /SAVED_CAROUSEL_ONLY_POLICY|CAROUSEL_AND_CAPTION_SKILLS/u);
});

test('OpenAI-compatible endpoint with version suffix is not duplicated', async () => {
  let target;
  await callAgentLLM('copywriter', 'JSON please', '', true, {
    config: { copywriter: { provider: 'custom', endpoint: 'https://provider.example/api/v1/', model: 'm', api_key: 'test' } },
    fetchImpl: async (url) => { target = url; return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }); },
  });
  assert.equal(target, 'https://provider.example/api/v1/chat/completions');
});

test('per-call output limits cap primary and fallback reservations without raising configured limits', async () => {
  resetGeminiPool();
  const budgets = [];
  await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(),
    env: { GEMINI_API_KEY_1: 'budget-one', GEMINI_API_KEY_2: 'budget-two', GROQ_API_KEY: 'budget-groq' }, secrets: {},
    stage: 'stage2_article', maxTokens: 4096,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      budgets.push(body.generationConfig?.maxOutputTokens || body.max_tokens);
      return url.includes('generativelanguage.googleapis.com') ? new Response('busy', { status: 429 })
        : Response.json({ choices: [{ message: { content: '{}' } }] });
    },
  });
  assert.deepEqual(budgets, [4096, 4096, 4096]);
  let effective;
  const providers = routerProviders();
  providers.providers.groq.max_tokens = 2048;
  await callAgentLLM('studio', 'Return JSON', '', true, {
    config: { studio: { provider: 'groq', model: 'fixture' } }, providers, env: { GROQ_API_KEY: 'budget-groq' }, secrets: {}, maxTokens: 4096,
    fetchImpl: async (_url, init) => {
      effective = JSON.parse(init.body).max_tokens;
      return Response.json({ choices: [{ message: { content: '{}' } }] });
    },
  });
  assert.equal(effective, 2048);
});

test('an exhausted stage Gemini budget uses fallback without another Gemini request', async () => {
  resetGeminiPool();
  const urls = [];
  await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(),
    env: { GEMINI_API_KEY_1: 'limit-one', GEMINI_API_KEY_2: 'limit-two', GROQ_API_KEY: 'limit-groq' }, secrets: {},
    stage: 'stage2_article', geminiAttemptLimit: 0,
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ choices: [{ message: { content: '{}' } }] });
    },
  });
  assert.deepEqual(urls, ['https://api.groq.com/openai/v1/chat/completions']);
});

test('fails fast on invalid credentials and redacts credentials echoed by a provider', async () => {
  let calls = 0;
  await assert.rejects(() => callAgentLLM('analis', 'JSON please', '', true, {
    config: { analis: { provider: 'gemini', model: 'chosen-model', api_key: 'never-expose-this' } },
    env: {}, secrets: {},
    fetchImpl: async () => { calls++; return new Response('invalid key never-expose-this', { status: 401 }); },
  }), (error) => error.message.includes('401') && !error.message.includes('never-expose-this'));
  assert.equal(calls, 1);
});

test('rotates to a healthy Gemini slot and falls back to Groq after two transient failures', async () => {
  resetGeminiPool();
  const urls = [];
  await callAgentLLM('designer', 'JSON please', '', true, {
    config: { designer: { provider: 'gemini', model: 'primary' } },
    env: { GEMINI_API_KEY_1: 'slot-one-secret', GEMINI_API_KEY_2: 'slot-two-secret', GROQ_API_KEY: 'groq-secret' },
    fetchImpl: async (url) => {
      urls.push(url);
      return urls.length <= 2 ? new Response('busy', { status: 503 }) : Response.json({ choices: [{ message: { content: '{}' } }] });
    },
  });
  assert.equal(urls.length, 3);
  assert.ok(urls.slice(0, 2).every((url) => /:streamGenerateContent\?alt=sse$/u.test(url)));
  assert.equal(urls[2], 'https://api.groq.com/openai/v1/chat/completions');
});

test('falls back across providers with the fallback provider key and endpoint', async () => {
  const calls = [];
  const result = await callAgentLLM('analis', 'Return JSON', '', true, {
    config: { analis: { provider: 'groq', model: 'llama-3.3-70b-versatile', fallback_models: ['gemini/gemini-3.5-flash'] } },
    providers: {
      providers: {
        groq: { label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true },
        gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
      },
      routing: { fallback_chain: [] },
    },
    env: { GROQ_API_KEY: 'groq-key', GEMINI_API_KEY: 'gemini-key' }, secrets: {},
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return url.includes('api.groq.com') ? new Response('busy', { status: 503 }) : Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  // A transient provider error is retried once before the chain skips it.
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.includes('api.groq.com') && calls[1].url.includes('api.groq.com'));
  assert.equal(calls[0].headers.Authorization, 'Bearer groq-key');
  assert.equal(calls[2].headers['x-goog-api-key'], 'gemini-key');
});

test('a 2xx HTML interstitial from one provider does not abort the fallback chain', async () => {
  const calls = [];
  const result = await callAgentLLM('analis', 'Return JSON', '', true, {
    config: { analis: { provider: 'groq', model: 'llama-3.3-70b-versatile', fallback_models: ['gemini/gemini-3.5-flash'] } },
    providers: {
      providers: {
        groq: { label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true },
        gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
      },
      routing: { fallback_chain: [] },
    },
    env: { GROQ_API_KEY: 'groq-key', GEMINI_API_KEY: 'gemini-key' },
    fetchImpl: async (url) => {
      calls.push(url);
      return url.includes('api.groq.com')
        ? new Response('<html><title>Just a moment...</title></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
        : Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.equal(calls.length, 2);
});

test('an empty 2xx payload from one provider does not abort the fallback chain', async () => {
  let calls = 0;
  const result = await callAgentLLM('analis', 'Return JSON', '', true, {
    config: { analis: { provider: 'groq', model: 'llama-3.3-70b-versatile', fallback_models: ['gemini/gemini-3.5-flash'] } },
    providers: {
      providers: {
        groq: { label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true },
        gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
      },
      routing: { fallback_chain: [] },
    },
    env: { GROQ_API_KEY: 'groq-key', GEMINI_API_KEY: 'gemini-key' },
    fetchImpl: async (url) => {
      calls++;
      return url.includes('api.groq.com')
        ? Response.json({ choices: [] })
        : Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.equal(calls, 2);
});

test('adapts a rejected response_format and still returns parsed JSON', async () => {
  let bodies = [];
  const result = await callAgentLLM('copywriter', 'Return JSON', '', true, {
    config: { copywriter: { provider: 'groq', model: 'llama-3.3-70b-versatile', api_key: 'groq-key' } },
    providers: {
      providers: { groq: { label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true } },
      routing: { fallback_chain: [] },
    },
    env: {},
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1
        ? Response.json({ error: 'response_format is not supported' }, { status: 400 })
        : Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].response_format);
  assert.equal(bodies[1].response_format, undefined);
});

test('sends Anthropic requests with x-api-key, version, and a required max_tokens', async () => {
  let request;
  const result = await callAgentLLM('studio', 'Return JSON', 'Policy', true, {
    config: { studio: { provider: 'anthropic', model: 'claude-sonnet-4-5' } },
    providers: {
      providers: { anthropic: { label: 'Anthropic', kind: 'anthropic', base_url: 'https://api.anthropic.com', api_key_env: 'ANTHROPIC_API_KEY', enabled: true } },
      routing: { fallback_chain: [] },
    },
    env: { ANTHROPIC_API_KEY: 'anthropic-key' },
    fetchImpl: async (url, init) => {
      request = { url, headers: init.headers, body: JSON.parse(init.body) };
      return Response.json({ content: [{ type: 'text', text: '{"ok":true}' }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.headers['x-api-key'], 'anthropic-key');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.body.max_tokens, 8192);
  assert.match(request.body.system, /Policy/);
});

test('buildAttempts keeps a disabled primary provider as an actionable error', () => {
  assert.throws(() => buildAttempts({ provider: 'xingchi', model: 'm' }, {
    providers: { xingchi: { label: 'Xingchi', kind: 'openai', base_url: 'https://api.xingchiapi.com/v1', api_key_env: 'XINGCHI_API_KEY', enabled: false } },
    routing: { fallback_chain: [] },
  }, { env: { XINGCHI_API_KEY: 'x' } }), /dinonaktifkan/);
});

test('unknown skill identifiers cannot read or write outside the skills directory', () => {
  assert.throws(() => saveAgentSkills('../../outside', 'content'), /agen tidak valid/i);
  assert.throws(() => loadAgentSkills('../../outside'), /agen tidak valid/i);
});

function routerProviders() {
  return {
    providers: {
      gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
      groq: { label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true },
      openrouter: { label: 'OpenRouter', kind: 'openai', base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY', enabled: true },
    },
    routing: { fallback_chain: [] },
  };
}

const routerConfig = { studio: { provider: 'gemini', model: 'gemini-2.5-flash' } };

test('all Gemini 429s cool down each key then route to Groq; telemetry contains only slot IDs', async () => {
  resetGeminiPool();
  const env = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`GEMINI_API_KEY_${index + 1}`, `gemini-secret-${index + 1}`]));
  env.GROQ_API_KEY = 'groq-secret';
  const events = [];
  let geminiCalls = 0;
  const result = await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env, secrets: {},
    onAttempt: (event) => events.push(event),
    fetchImpl: async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) { geminiCalls++; return new Response('busy', { status: 429 }); }
      return Response.json({ choices: [{ message: { content: '{"rows":[]}' } }] });
    },
  });
  assert.equal(result, '{"rows":[]}');
  assert.equal(geminiCalls, 6);
  assert.equal(events.length, 7);
  assert.deepEqual(events.slice(0, 6).map((event) => event.key_slot), [1, 2, 3, 4, 5, 6]);
  assert.ok(events.slice(0, 6).every((event) => event.outcome === 'rate_limited' && event.status === 429));
  assert.deepEqual(events[6], { stage: '', provider: 'groq', model: 'qwen/qwen3.8-27b',
    key_slot: undefined, fallback: true, elapsed_ms: events[6].elapsed_ms, status: 200, outcome: 'success' });
  assert.doesNotMatch(JSON.stringify(events), /secret/u);
  assert.deepEqual(geminiPoolStatus(Object.values(env).filter((value) => value.startsWith('gemini-secret'))).map(({ state }) => state), Array(6).fill('cooldown'));
});

test('staged calls try at most two of six Gemini keys for auth, rate limits and every transient HTTP status', async () => {
  for (const status of [401, 403, 429, 500, 502, 503, 504]) {
    resetGeminiPool();
    const env = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`GEMINI_API_KEY_${index + 1}`, `staged-${index + 1}`]));
    env.GROQ_API_KEY = 'groq';
    const events = [];
    const result = await callAgentLLM('studio', 'Return JSON', '', true, {
      config: routerConfig, providers: routerProviders(), env, secrets: {}, stage: 'stage1_synthesis',
      onAttempt: (event) => events.push(event),
      fetchImpl: async (url) => url.includes('generativelanguage.googleapis.com')
        ? new Response('unavailable', { status })
        : Response.json({ choices: [{ message: { content: '{}' } }] }),
    });
    assert.equal(result, '{}');
    assert.deepEqual(events.map((event) => event.provider), ['gemini', 'gemini', 'groq'], String(status));
    assert.ok(events.slice(0, 2).every((event) => event.status === status));
    assert.ok(geminiPoolStatus(Object.values(env).slice(2, 6)).every((item) => item.state === 'ready'));
  }
});

test('the default provider deadline is exactly 35 seconds', async (t) => {
  resetGeminiPool();
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => { deadlines.push(milliseconds); return timeout(milliseconds); });
  await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env: { GEMINI_API_KEY_1: 'deadline' }, secrets: {},
    fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }),
  });
  assert.deepEqual(deadlines, [35000]);
});

test('401/403 and API_KEY_INVALID quarantine only that Gemini key; 404 model failure does not', async () => {
  resetGeminiPool();
  for (const status of [401, 403]) {
    resetGeminiPool();
    const credentialEnv = { GEMINI_API_KEY_1: 'first-auth-secret', GEMINI_API_KEY_2: 'second-auth-secret' };
    let authCalls = 0;
    const authResult = await callAgentLLM('studio', 'Return JSON', '', true, {
      config: routerConfig, providers: routerProviders(), env: credentialEnv, secrets: {},
      fetchImpl: async () => {
        authCalls++;
        return authCalls === 1 ? new Response('{"error":{"status":"UNAUTHENTICATED"}}', { status })
          : Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
      },
    });
    assert.equal(authResult, '{}');
    assert.equal(authCalls, 2);
    assert.deepEqual(geminiPoolStatus(['first-auth-secret', 'second-auth-secret']).map(({ state }) => state), ['quarantined', 'ready']);
  }

  resetGeminiPool();
  const env = { GEMINI_API_KEY_1: 'first-secret', GEMINI_API_KEY_2: 'second-secret', GROQ_API_KEY: 'groq-secret' };
  let call = 0;
  const result = await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env, secrets: {},
    fetchImpl: async () => {
      call++;
      return call === 1 ? new Response('{"error":{"status":"API_KEY_INVALID"}}', { status: 400 })
        : Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.equal(call, 2);
  assert.deepEqual(geminiPoolStatus(['first-secret', 'second-secret']).map(({ state }) => state), ['quarantined', 'ready']);

  resetGeminiPool();
  let fallbackUrl = '';
  await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env: { GEMINI_API_KEY_1: 'key', GROQ_API_KEY: 'groq-secret' }, secrets: {},
    fetchImpl: async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) return new Response('{"error":{"status":"NOT_FOUND","message":"model not found"}}', { status: 404 });
      fallbackUrl = url;
      return Response.json({ choices: [{ message: { content: '{}' } }] });
    },
  });
  assert.equal(fallbackUrl, 'https://api.groq.com/openai/v1/chat/completions');
  assert.deepEqual(geminiPoolStatus(['key']).map(({ state }) => state), ['ready']);
});

test('two Gemini body timeouts fall back without allowing a stalled stream to block the timeout', async () => {
  resetGeminiPool();
  let geminiCalls = 0;
  let groqCalls = 0;
  const events = [];
  const result = await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env: { GEMINI_API_KEY_1: 'one', GEMINI_API_KEY_2: 'two', GROQ_API_KEY: 'groq' },
    secrets: {}, timeoutMs: 15, onAttempt: (event) => events.push(event),
    fetchImpl: async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiCalls++;
        return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      groqCalls++;
      return Response.json({ choices: [{ message: { content: '{}' } }] });
    },
  });
  assert.equal(result, '{}');
  assert.equal(geminiCalls, 2);
  assert.equal(groqCalls, 1);
  assert.deepEqual(events.slice(0, 2).map(({ status, outcome }) => [status, outcome]), [[408, 'timeout'], [408, 'timeout']]);
});

test('Groq 429 advances to OpenRouter, preserving the configured fallback model', async () => {
  resetGeminiPool();
  const calls = [];
  const result = await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env: { GROQ_API_KEY: 'groq', OPENROUTER_API_KEY: 'openrouter', OPENROUTER_MODEL: 'google/gemini-2.5-flash' }, secrets: {},
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return calls.length === 1 ? new Response('rate limit', { status: 429 }) : Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://api.groq.com/openai/v1/chat/completions',
    'https://openrouter.ai/api/v1/chat/completions',
  ]);
  assert.equal(calls[1].body.model, 'google/gemini-2.5-flash');
});

test('Gemini SSE joins UTF-8 split across chunks, drops thoughts, reports usage, and returns staged JSON unchanged', async () => {
  resetGeminiPool();
  const events = [];
  const metadata = [];
  const emoji = String.fromCodePoint(0x1f4f0);
  const source = [
    { candidates: [{ content: { parts: [{ text: 'private-thought', thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: JSON.stringify({ rows: [{ text: `h${emoji}llo` }] }) }] } }] },
    { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 9 } },
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join('');
  const bytes = new TextEncoder().encode(source);
  const emojiBytes = new TextEncoder().encode(emoji);
  const unicodeOffset = bytes.findIndex((_, index) => emojiBytes.every((byte, offset) => bytes[index + offset] === byte));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, unicodeOffset + 1));
      controller.enqueue(bytes.slice(unicodeOffset + 1));
      controller.close();
    },
  });
  const expected = JSON.stringify({ rows: [{ text: `h${emoji}llo` }] });
  const result = await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env: { GEMINI_API_KEY_1: 'only-key' }, secrets: {},
    stage: 'stage2_article', responseSchema: { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } } } } }, required: ['rows'] },
    onAttempt: (event) => events.push(event), onMetadata: (event) => metadata.push(event),
    fetchImpl: async (url, init) => {
      assert.match(url, /:streamGenerateContent\?alt=sse$/u);
      assert.deepEqual(JSON.parse(init.body).generationConfig.thinkingConfig, { thinkingBudget: 0 });
      assert.equal(JSON.parse(init.body).generationConfig.responseJsonSchema.type, 'object');
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    },
  });
  assert.equal(result, expected);
  assert.doesNotMatch(result, /private-thought/u);
  assert.equal(metadata[0].usage.promptTokenCount, 7);
  assert.equal(events[0].status, 200);
  assert.equal(events[0].key_slot, 1);
});

test('rejects a streamed MAX_TOKENS response instead of accepting truncated JSON', async () => {
  resetGeminiPool();
  const result = await callAgentLLM('studio', 'Return JSON', '', true, {
    config: routerConfig, providers: routerProviders(), env: { GEMINI_API_KEY_1: 'key', GROQ_API_KEY: 'groq' }, secrets: {},
    stage: 'stage2_article',
    fetchImpl: async (url) => url.includes('generativelanguage.googleapis.com')
      ? new Response('data: {"candidates":[{"content":{"parts":[{"text":"{\\"rows\\":["}]}],"finishReason":"MAX_TOKENS"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json({ choices: [{ message: { content: '{"rows":[]}' } }] }),
  });
  assert.equal(result, '{"rows":[]}');
});
