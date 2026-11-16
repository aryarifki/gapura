import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RenderEngine } from '../../render/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const name = `gapura_test_${process.pid}`;
const password = randomBytes(24).toString('hex');
const token = randomBytes(32).toString('hex');
const temp = await fs.mkdtemp('/tmp/opencode/gapura-test-');
let child;
let fixture;
let exitCode = 1;
const psql = (sql) => {
  const result = spawnSync('runuser', ['-u', 'postgres', '--', 'psql', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
};
try {
  psql(`CREATE ROLE ${name} LOGIN PASSWORD '${password}';\nCREATE DATABASE ${name} OWNER ${name};`);
  const env = {
    ...process.env, NODE_ENV: 'test', PORT: '0', GAPURA_DISABLE_WORKERS: 'true', GAPURA_PUBLIC_ORIGIN: '',
    GAPURA_ADMIN_TOKEN: token, HME_DB_HOST: '127.0.0.1', HME_DB_PORT: '5432', HME_DB_USER: name, HME_DB_PASSWORD: password, HME_DB_NAME: name,
    PGPASSWORD: password, GOOGLE_API_KEY: '', GEMINI_API_KEY: '', OPENAI_API_KEY: '',
    MASB_API_KEY: '', XINGCHI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', OPENROUTER_API_KEY: '', XAI_API_KEY: '', NVIDIA_API_KEY: '',
    AGENTS_CONFIG_PATH: path.join(temp, 'agents.json'), AGENT_SKILLS_DIR: path.join(temp, 'skills'),
    PROVIDERS_CONFIG_PATH: path.join(temp, 'providers.json'), MODELS_CACHE_PATH: path.join(temp, 'models.cache.json'),
    GAPURA_PROVIDER_SECRETS: path.join(temp, 'provider-keys.json'),
    META_APP_ID: '', META_APP_SECRET: '', META_UNIFIED_CONFIG_ID: '', META_UNIFIED_REDIRECT_URI: '',
    META_PAGE_ACCESS_TOKEN: '', META_INSTAGRAM_ACCESS_TOKEN: '', META_THREADS_ACCESS_TOKEN: '',
    GAPURA_META_CONNECTION: path.join(temp, 'meta-unified.json'),
    STORAGE_PATH: path.join(temp, 'storage'), DESIGN_SYSTEM_PATH: path.join(temp, 'design-system'),
  };
  const migrations = ['database/schema.sql', 'database/migrations/20261111_seo_verifikator.sql', 'database/migrations/20261111_prompt_studio.sql',
    ...(await fs.readdir(path.join(root, 'database/migrations'))).filter((file) => /^\d{8}_.*\.sql$/u.test(file) && file >= '20261116_').sort().map((file) => `database/migrations/${file}`)];
  for (const file of migrations) {
    const result = spawnSync('psql', ['-h', '127.0.0.1', '-U', name, '-d', name, '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(root, file)], { env, encoding: 'utf8' });
    if (result.status) throw new Error(`${file}: ${result.stderr}`);
  }
  await fs.cp(path.join(root, 'config/skills'), env.AGENT_SKILLS_DIR, { recursive: true });
  await fs.cp(path.join(root, 'design-system'), env.DESIGN_SYSTEM_PATH, { recursive: true });
  const engine = new RenderEngine(env.DESIGN_SYSTEM_PATH);
  fixture = http.createServer(async (req, res) => {
    try {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      if (req.url === '/render') {
        if (body.slides?.some((slide) => slide.teks === 'FIXTURE_RENDER_ERROR')) return res.writeHead(503).end('fixture render failure');
        const slides = await engine.renderCarouselToDisk(body.draft_id, body.slides, path.join(env.STORAGE_PATH, 'drafts'));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rendered_slides: slides, total_time_ms: 1 }));
      } else if (req.url === '/health' || req.url === '/tokens/reload') res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
      else if (req.url === '/v1/models') res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model' }, { id: 'fixture-alt' }] }));
      else if (req.url === '/v1/chat/completions') {
        const prompt = body.messages?.at(-1)?.content || '';
        let result = { ok: true };
        if (prompt.includes('Caption') || prompt.includes('caption')) result = { caption: 'Inflasi Oktober 2,1% menurut sumber uji.', hashtags: ['#GapuraMedia'] };
        if (prompt.includes('VISUAL') || prompt.includes('format')) result = { format: 'single', slides: [{ no: 1, layout: 'cover-focus', teks: 'Inflasi Oktober 2,1%', data: { title: 'Inflasi Oktober 2,1%' } }] };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
      } else res.writeHead(404).end();
    } catch (error) { res.writeHead(500).end(error.message); }
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
  env.RENDER_SERVICE_URL = fixtureUrl;
  const config = JSON.parse(await fs.readFile(path.join(root, 'config/agents.json'), 'utf8'));
  for (const key of ['analis', 'copywriter', 'designer', 'seo', 'verifikator', 'studio']) Object.assign(config[key], { provider: 'custom', endpoint: fixtureUrl, api_key: 'fixture-key', model: 'fixture-model' });
  await fs.writeFile(env.AGENTS_CONFIG_PATH, JSON.stringify(config));
  await fs.writeFile(env.PROVIDERS_CONFIG_PATH, JSON.stringify({
    providers: {
      custom: { label: 'Fixture Provider', kind: 'openai', base_url: fixtureUrl, api_key_env: 'CUSTOM_API_KEY', enabled: true, max_tokens: 8192 },
    },
    routing: { fallback_chain: [] },
  }, null, 2));
  child = spawn(process.execPath, ['services/web/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise((resolve, reject) => {
    let buffer = '';
    child.stdout.on('data', (chunk) => { buffer += chunk; const match = buffer.match(/Running on (http:\/\/[^\s]+)/); if (match) resolve(match[1]); });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('exit', (code) => reject(new Error(`test web server exited ${code}`)));
  });
  env.GAPURA_TEST_BASE = base;
  env.GAPURA_TEST_STORAGE = env.STORAGE_PATH;
  const files = process.argv.slice(2);
  const tests = spawn(process.execPath, ['--test', ...(files.length ? files : ['services/web/test/server-db.test.js'])], { cwd: root, env, stdio: 'inherit' });
  exitCode = await new Promise((resolve) => tests.once('exit', (code) => resolve(code || 0)));
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); }
  if (fixture) { fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve)); }
  psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}';\nDROP DATABASE IF EXISTS ${name};\nDROP ROLE IF EXISTS ${name};`);
  await fs.rm(temp, { recursive: true, force: true });
}
process.exitCode = exitCode;
