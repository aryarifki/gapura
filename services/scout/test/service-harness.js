import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const servicesRoot = fileURLToPath(new URL('../../', import.meta.url));

// Load the real service and helpers, replacing only I/O boundaries. In particular,
// dotenv and the config/LLM client never read the workspace secrets in these tests.
export async function loadService(relativePath, { client, config = {}, llm, fetchImpl } = {}) {
  const context = vm.createContext({
    console, URL, AbortSignal, Response, Buffer, structuredClone,
    process: { env: {}, argv: [] },
    fetch: fetchImpl || (async () => { throw new Error('Unexpected network request'); }),
  });
  const cache = new Map();
  function synthetic(identifier, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier });
  }
  async function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const loading = (async () => {
      const module = new vm.SourceTextModule(await readFile(filename, 'utf8'), {
        context, identifier: filename,
        initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; },
      });
      await module.link(async (specifier, parent) => {
      if (specifier === 'dotenv') return synthetic('dotenv', { default: { config() {} } });
      if (specifier === 'pg') return synthetic('pg', { default: { Pool: class {
        async connect() { if (!client) throw new Error('Unexpected database connection'); return client; }
        async query(...args) { return client.query(...args); }
        async end() {}
      } } });
      const resolved = path.resolve(path.dirname(parent.identifier), specifier);
      if (resolved.endsWith('/common/llm.js')) return synthetic(resolved, {
        loadAgentsConfig: () => config,
        callAgentLLM: llm || (async () => { throw new Error('No test LLM configured'); }),
      });
      if (resolved.endsWith('/common/secret-store.js')) return synthetic(resolved, {
        loadProviderSecrets: () => ({}),
        saveProviderSecret: () => { throw new Error('Provider secrets are not available to isolated tests.'); },
      });
      if (specifier.startsWith('.')) return load(resolved);
      const imported = await import(isBuiltin(specifier) ? specifier : pathToFileURL(createRequire(parent.identifier).resolve(specifier)).href);
      return synthetic(specifier, Object.fromEntries(Object.keys(imported).map((key) => [key, imported[key]])));
      });
      return module;
    })();
    // Shared helper imports form a diamond. Reuse their completed link promise
    // instead of returning a module whose dependency linkage is still pending.
    cache.set(filename, loading);
    return loading;
  }
  const module = await load(path.join(servicesRoot, relativePath));
  await module.evaluate();
  return module.namespace;
}

export function recordingDb(handler = () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) { calls.push({ sql, params }); return handler(sql, params); },
    release() {},
  };
}
