import test from 'node:test';
import assert from 'node:assert/strict';
import { callAgentLLM, loadAgentSkills, saveAgentSkills } from '../llm.js';
import { buildAttempts } from '../providers.js';

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

test('OpenAI-compatible endpoint with version suffix is not duplicated', async () => {
  let target;
  await callAgentLLM('copywriter', 'JSON please', '', true, {
    config: { copywriter: { provider: 'custom', endpoint: 'https://provider.example/api/v1/', model: 'm', api_key: 'test' } },
    fetchImpl: async (url) => { target = url; return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }); },
  });
  assert.equal(target, 'https://provider.example/api/v1/chat/completions');
});

test('fails fast on invalid credentials and redacts credentials echoed by a provider', async () => {
  let calls = 0;
  await assert.rejects(() => callAgentLLM('analis', 'JSON please', '', true, {
    config: { analis: { provider: 'gemini', model: 'chosen-model', api_key: 'never-expose-this' } },
    fetchImpl: async () => { calls++; return new Response('invalid key never-expose-this', { status: 401 }); },
  }), (error) => error.message.includes('401') && !error.message.includes('never-expose-this'));
  assert.equal(calls, 1);
});

test('only uses an explicitly configured fallback model after a transient provider failure', async () => {
  const urls = [];
  await callAgentLLM('designer', 'JSON please', '', true, {
    config: { designer: { provider: 'gemini', model: 'primary', fallback_model: 'configured-fallback', api_key: 'test' } },
    fetchImpl: async (url) => {
      urls.push(url);
      return urls.length === 1 ? new Response('busy', { status: 503 }) : Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    },
  });
  assert.equal(urls.length, 2);
  assert.match(urls[1], /configured-fallback:generateContent/);
});

test('falls back across providers with the fallback provider key and endpoint', async () => {
  const calls = [];
  const result = await callAgentLLM('analis', 'Return JSON', '', true, {
    config: { analis: { provider: 'masb', model: 'qwen3.8-27b', fallback_models: ['gemini/gemini-2.5-flash'] } },
    providers: {
      providers: {
        masb: { label: 'MASB', kind: 'openai', base_url: 'https://ai.masb.web.id/v1', api_key_env: 'MASB_API_KEY', enabled: true },
        gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
      },
      routing: { fallback_chain: [] },
    },
    env: { MASB_API_KEY: 'masb-key', GEMINI_API_KEY: 'gemini-key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return url.includes('ai.masb') ? new Response('busy', { status: 503 }) : Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    },
  });
  assert.equal(result, '{"ok":true}');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.Authorization, 'Bearer masb-key');
  assert.equal(calls[1].headers['x-goog-api-key'], 'gemini-key');
});

test('a 2xx HTML interstitial from one provider does not abort the fallback chain', async () => {
  const calls = [];
  const result = await callAgentLLM('analis', 'Return JSON', '', true, {
    config: { analis: { provider: 'masb', model: 'qwen3.8-27b', fallback_models: ['gemini/gemini-2.5-flash'] } },
    providers: {
      providers: {
        masb: { label: 'MASB', kind: 'openai', base_url: 'https://ai.masb.web.id/v1', api_key_env: 'MASB_API_KEY', enabled: true },
        gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
      },
      routing: { fallback_chain: [] },
    },
    env: { MASB_API_KEY: 'masb-key', GEMINI_API_KEY: 'gemini-key' },
    fetchImpl: async (url) => {
      calls.push(url);
      return url.includes('ai.masb')
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
    config: { analis: { provider: 'masb', model: 'qwen3.8-27b', fallback_models: ['gemini/gemini-2.5-flash'] } },
    providers: {
      providers: {
        masb: { label: 'MASB', kind: 'openai', base_url: 'https://ai.masb.web.id/v1', api_key_env: 'MASB_API_KEY', enabled: true },
        gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
      },
      routing: { fallback_chain: [] },
    },
    env: { MASB_API_KEY: 'masb-key', GEMINI_API_KEY: 'gemini-key' },
    fetchImpl: async (url) => {
      calls++;
      return url.includes('ai.masb')
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
    config: { copywriter: { provider: 'masb', model: 'qwen3.8-27b', api_key: 'masb-key' } },
    providers: {
      providers: { masb: { label: 'MASB', kind: 'openai', base_url: 'https://ai.masb.web.id/v1', api_key_env: 'MASB_API_KEY', enabled: true } },
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
