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
const SKILLS_DIR = path.resolve(__dirname, '../../config/skills');

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
 * Membaca berkas skills.md spesifik untuk tiap agen
 * @param {'scout' | 'analis' | 'copywriter' | 'designer'} agentKey
 */
export function loadAgentSkills(agentKey) {
  try {
    const skillPath = path.join(SKILLS_DIR, `${agentKey}.skills.md`);
    if (fs.existsSync(skillPath)) {
      return fs.readFileSync(skillPath, 'utf8');
    }
  } catch (err) {
    console.warn(`[LLM Client] Gagal membaca skills.md untuk agen ${agentKey}:`, err.message);
  }
  return '';
}

/**
 * Menyimpan berkas skills.md untuk tiap agen
 * @param {'scout' | 'analis' | 'copywriter' | 'designer'} agentKey
 * @param {string} content
 */
export function saveAgentSkills(agentKey, content) {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }
    const skillPath = path.join(SKILLS_DIR, `${agentKey}.skills.md`);
    fs.writeFileSync(skillPath, content, 'utf8');
    return true;
  } catch (err) {
    console.error(`[LLM Client] Gagal menyimpan skills.md untuk agen ${agentKey}:`, err);
    throw err;
  }
}

/**
 * Universal call to an LLM provider based on Agent configuration
 * @param {'scout' | 'analis' | 'copywriter' | 'designer'} agentKey
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

  // Gabungkan System Prompt bawaan dengan skills.md kustom agen
  const skillsMd = loadAgentSkills(agentKey);
  const effectiveSystemPrompt = [
    agentCfg.system_prompt || systemPrompt || '',
    skillsMd ? `\n--- SKILLS.MD KUSTOM (PANDUAN EKSEKUSI AGEN ${agentKey.toUpperCase()}) ---\n${skillsMd}` : '',
  ].filter(Boolean).join('\n\n');

  // 1. Google Gemini Provider
  if (provider === 'gemini') {
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const url = `${cleanEndpoint}/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const contents = [];
    if (effectiveSystemPrompt) {
      contents.push({ role: 'user', parts: [{ text: `Instruksi Sistem & Skills:\n${effectiveSystemPrompt}` }] });
      contents.push({ role: 'model', parts: [{ text: 'Baik, saya memahami seluruh aturan, instruksi sistem, dan keterampilan (skills) tersebut.' }] });
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
  if (effectiveSystemPrompt) {
    messages.push({ role: 'system', content: effectiveSystemPrompt });
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
