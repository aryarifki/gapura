import { spawn } from 'node:child_process';
const DEFAULT_PYTHON = '/etc/gapura/editorial-venv/bin/python';
const MAX_JSON_BYTES = 512 * 1024;

function clean(value) {
  return String(value ?? '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
}

function rootCandidate(value) {
  const source = clean(value);
  if (!source || source[0] === '{' || source[0] === '[') return source;
  const start = source.search(/[\[{]/u);
  if (start < 0) return source;
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      const open = stack.pop();
      if ((char === '}' && open !== '{') || (char === ']' && open !== '[')) return source;
      if (!stack.length) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

/** Parses a whole JSON root (including arrays); when malformed, asks the
 * installed Python json-repair package to repair that same root, never a
 * separately extracted first object. Staged editorial responses bypass this
 * helper and go unchanged to their Python validation gate. */
export async function normalizeJsonResponse(value, { pythonPath = process.env.EDITORIAL_PYTHON || process.env.GAPURA_JSON_REPAIR_PYTHON || DEFAULT_PYTHON, timeoutMs = 5000 } = {}) {
  const source = rootCandidate(value);
  if (Buffer.byteLength(source, 'utf8') > MAX_JSON_BYTES) return clean(value);
  try { return JSON.stringify(JSON.parse(source)); }
  catch { /* Use the same Python repair library as the editorial validation gate. */ }
  try {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(pythonPath, [
        '-I', '-c', 'import sys; from json_repair import repair_json; sys.stdout.write(repair_json(sys.stdin.read()))',
      ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let output = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      timer.unref?.();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (Buffer.byteLength(output, 'utf8') > MAX_JSON_BYTES * 2) child.kill('SIGKILL');
      });
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && Buffer.byteLength(output, 'utf8') <= MAX_JSON_BYTES * 2) resolve(output);
        else reject(new Error('json_repair_failed'));
      });
      child.stdin.end(source);
    });
    return JSON.stringify(JSON.parse(stdout));
  } catch {
    return clean(value);
  }
}

export { rootCandidate as jsonRootCandidate };
