/**
 * MIT. Typed local client and launch binding for the original OECD project.
 */
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SCRIPT = fileURLToPath(new URL('./cli.py', import.meta.url));
export const OECD_CONNECTION_SCHEMA = 'stellar-forge.oecd-connection.v1';

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use the original loopback OECD operator origin');
  }
  return url.origin;
}
async function bytes(response, maximum) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel('response byte limit'); throw new Error('OECD response exceeds the selected byte limit'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function readOecdConnection(path) {
  const info = await stat(path);
  if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) {
    throw new Error('Use the private original OECD connection file');
  }
  const connection = JSON.parse(await readFile(path, 'utf8'));
  if (connection.schema !== OECD_CONNECTION_SCHEMA) throw new Error('Unknown OECD connection schema');
  localOrigin(connection.base_url);
  if (typeof connection.token !== 'string' || !connection.token) throw new Error('Connection has no original process capability');
  return connection;
}

export function createOecdClient({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 180000 }) {
  const origin = localOrigin(baseUrl);
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error('Use the original process capability');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('timeoutMs must be 1000–600000');
  async function request(path, { body, binary = false, raw = false, maximum = 128 * 1024 * 1024 } = {}) {
    const response = await fetchImpl(origin + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + token,
        ...(body !== undefined ? { 'Content-Type': binary ? 'application/zip' : 'application/json' } : {}) },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const content = await bytes(response, maximum);
    if (!response.ok) {
      let detail = content.toString('utf8');
      try { detail = JSON.parse(detail).error || detail; } catch {}
      const error = new Error(detail || 'OECD operator returned HTTP ' + response.status);
      error.status = response.status; error.responseBytes = content; throw error;
    }
    return raw ? { body: content, contentType: response.headers.get('content-type'),
      contentDisposition: response.headers.get('content-disposition') } : JSON.parse(content.toString('utf8'));
  }
  const id = value => {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Use the complete saved briefing identity');
    return value;
  };
  return Object.freeze({
    baseUrl: origin,
    state: () => request('/api/oecd/state'),
    seed: (body = {}) => request('/api/oecd/seed', { body }),
    capture: body => request('/api/oecd/captures', { body }),
    refresh: body => request('/api/oecd/refresh', { body }),
    preview: body => request('/api/oecd/preview', { body }),
    save: body => request('/api/oecd/briefings', { body }),
    briefing: value => request('/api/oecd/briefings/' + id(value)),
    sourceRows: value => request('/api/oecd/briefings/' + id(value) + '/source-rows'),
    compare: (before, after) => request('/api/oecd/compare', { body: { before: id(before), after: id(after) } }),
    activate: body => request('/api/oecd/activate', { body }),
    exportDataset: briefingId => request('/api/oecd/export-dataset', { body: { briefing_id: id(briefingId) } }),
    exportCustomer: briefingId => request('/api/oecd/export-customer', { body: { briefing_id: id(briefingId) }, raw: true }),
    exportProject: briefingId => request('/api/oecd/export-project', { body: { briefing_id: id(briefingId) }, raw: true }),
    importProject: body => request('/api/oecd/import', { body, binary: true }),
    reportFile: (briefingId, name) => {
      if (!['briefing.html', 'briefing.json', 'observations.csv'].includes(name)) throw new Error('Unknown report filename');
      return request('/api/oecd/briefings/' + id(briefingId) + '/files/' + name, { raw: true });
    },
    provider: (command, parameters = {}) => {
      if (!['getcapabilities', 'loadseries', 'loadmeta', 'searchseries', 'loadtree', 'listseries'].includes(command)) {
        throw new Error('Unknown original provider method');
      }
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(parameters)) {
        for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
      }
      return request('/api/provider/' + command + (query.size ? '?' + query.toString() : ''));
    },
  });
}

export async function launchOecd({ projectDirectory, create = false, port = 0, pythonCommand = 'python3',
  pythonArguments = [], providerUsernameEnv, providerPasswordEnv, startupTimeoutMs = 120000,
  stderr = process.stderr, env = process.env } = {}) {
  if (typeof projectDirectory !== 'string' || !projectDirectory) throw new Error('Select the original OECD project directory');
  const args = [...pythonArguments, SCRIPT, 'serve', '--project', resolve(projectDirectory), '--port', String(port)];
  if (create) args.push('--create');
  if (providerUsernameEnv) args.push('--provider-username-env', providerUsernameEnv);
  if (providerPasswordEnv) args.push('--provider-password-env', providerPasswordEnv);
  const child = spawn(pythonCommand, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.on('data', block => stderr?.write(block));
  let ended = false;
  const closed = new Promise((resolveClosed, rejectClosed) => {
    child.once('error', rejectClosed);
    child.once('close', (code, signal) => { ended = true; resolveClosed({ code, signal }); });
  });
  closed.catch(() => {});
  const connection = await new Promise((resolveReady, rejectReady) => {
    let buffer = '', ready = false;
    const timer = setTimeout(() => {
      if (!ready) { child.kill('SIGTERM'); rejectReady(new Error('The original OECD server did not return its startup binding')); }
    }, startupTimeoutMs);
    const finish = (error, value) => {
      if (ready) return;
      ready = true; clearTimeout(timer);
      if (error) rejectReady(error); else resolveReady(value);
    };
    child.once('error', error => finish(error));
    child.once('close', (code, signal) => finish(new Error('OECD server exited before startup: ' + (signal || code))));
    child.stdout.on('data', block => {
      buffer += block.toString('utf8');
      if (buffer.length > 1024 * 1024) {
        child.kill('SIGTERM'); finish(new Error('OECD startup output exceeds 1 MiB')); return;
      }
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.event === 'oecd-ready' && value.schema === OECD_CONNECTION_SCHEMA) finish(null, value);
      }
    });
  });
  const client = createOecdClient({ baseUrl: connection.base_url, token: connection.token });
  return { connection, client, child, closed, async close() {
    if (!ended) child.kill('SIGTERM');
    return closed;
  } };
}
