// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Universal Multi-Provider LLM Client
// File: /root/gapura/services/common/llm.js
// Supports Google Gemini, OpenAI, OpenRouter, Groq, DeepSeek, Local Ollama
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '../../config/agents.json');

export function loadAgentsConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[LLM Client] Gagal membaca config/agents.json, fallback ke default:', err.message);
  }
  return {};
}

/**
 * Universal call to an LLM provider based on Agent configuration
 * @param {'analis' | 'copywriter'} agentKey
 * @param {string} promptText
 * @param {string} systemPrompt
 * @param {boolean} jsonMode
 */
export async function callAgentLLM(agentKey, promptText, systemPrompt = '', jsonMode = true) {
  const cfg = loadAgentsConfig();
  const agentCfg = cfg[agentKey] || {};

  const provider = (agentCfg.provider || 'gemini').toLowerCase();
  const endpoint = agentCfg.endpoint || 'https://generativelanguage.googleapis.com';
  const apiKey = agentCfg.api_key || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = agentCfg.model || 'gemini-2.0-flash';

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(`API Key untuk agen ${agentKey} belum dikonfigurasi.`);
  }

  // 1. Google Gemini Provider
  if (provider === 'gemini') {
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const url = `${cleanEndpoint}/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const contents = [];
    if (systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: `Instruksi Sistem:\n${systemPrompt}` }] });
      contents.push({ role: 'model', parts: [{ text: 'Baik, saya memahami seluruh aturan dan instruksi sistem tersebut.' }] });
    }
    contents.push({ role: 'user', parts: [{ text: promptText }] });

    const bodyPayload = {
      contents,
    };
    if (jsonMode) {
      bodyPayload.generationConfig = { responseMimeType: 'application/json' };
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini API Error (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) throw new Error('Gemini API mengembalikan respons kosong.');
    return resultText;
  }

  // 2. OpenAI-Compatible Provider (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, etc.)
  const cleanEndpoint = endpoint.replace(/\/+$/, '');
  const url = cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/v1/chat/completions`;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: promptText });

  const bodyPayload = {
    model,
    messages,
    temperature: 0.2,
  };
  if (jsonMode) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  // OpenRouter support
  if (endpoint.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://gapura.avenia.my.id';
    headers['X-Title'] = 'Gapura Homeless Media Engine';
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API Error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const resultText = data.choices?.[0]?.message?.content;
  if (!resultText) throw new Error('API Provider mengembalikan respons kosong.');
  return resultText;
}
