/** Complete selected-runtime bridge for the original application control facade. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const manager = fileURLToPath(new URL('./manage.py', import.meta.url));
const definitions = {
  prepare: {
    application: '--application', manifest: '--manifest', directory: '--directory',
    node: '--node', npm: '--npm', upstreamManifest: '--upstream-manifest',
    hocuspocusArchive: '--hocuspocus-archive', tiptapArchive: '--tiptap-archive',
    exportPath: '--export'
  },
  inspect: { directory: '--directory', node: '--node' },
  export: { directory: '--directory', output: '--output', node: '--node' },
  receive: { archive: '--archive', directory: '--directory', node: '--node' }
};

export function startRuntime(operation, options = {}) {
  const fields = definitions[operation];
  if (!fields) throw new TypeError('Select an existing runtime operation');
  const selected = { ...options, node: options.node || process.execPath };
  const args = ['-B', manager, operation];
  for (const [name, flag] of Object.entries(fields)) {
    if (selected[name] !== undefined && selected[name] !== null) {
      if (typeof selected[name] !== 'string' || !selected[name]) throw new TypeError(name + ' must be a non-empty path');
      args.push(flag, selected[name]);
    }
  }
  if (operation === 'prepare' && options.build === false) args.push('--no-build');
  if (operation === 'prepare' && options.repairDependencies === true) args.push('--repair-dependencies');
  if (operation === 'inspect' && options.full === true) args.push('--full');
  const python = options.python || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  const child = spawn(python, args, { cwd: path.dirname(manager), stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const started = new Promise((resolve, reject) => {
    child.once('spawn', () => {
      const identity = { pid: child.pid, operation, directory: selected.directory || null };
      try { options.onStart?.(identity); } catch { /* Observers do not own native preparation. */ }
      resolve(identity);
    });
    child.once('error', reject);
  });
  const result = new Promise((resolve, reject) => {
    let stdout = '', stderr = '', line = '', tooLarge = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > 32 * 1024 * 1024) tooLarge = true;
      else stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-256 * 1024);
      line += chunk;
      const records = line.split('\n');
      line = records.pop();
      for (const record of records) {
        if (!record) continue;
        let event;
        try { event = JSON.parse(record); } catch { event = { event: 'native_stderr', text: record }; }
        try { options.onProgress?.(event); } catch { /* Continue receiving the accepted native operation. */ }
      }
      if (line.length > 256 * 1024) line = line.slice(-256 * 1024);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0 || signal || tooLarge) {
        const error = new Error(tooLarge ? 'The runtime result exceeds its complete JSON response allowance' :
          'The original runtime operation did not finish: ' + (signal || code));
        Object.assign(error, { operation, directory: selected.directory || null, pid: child.pid,
          exitCode: code, signal, stderr, stdout });
        reject(error);
        return;
      }
      try {
        const value = JSON.parse(stdout);
        const expected = operation === 'receive' ? 'hocuspocus.runtime-receiving-result.v1' :
          operation === 'export' ? 'hocuspocus.runtime.archive.v1' : 'hocuspocus.runtime-status.v1';
        if (value.schema !== expected) throw new Error('The original runtime response schema differs');
        resolve(value);
      } catch (error) {
        Object.assign(error, { operation, directory: selected.directory || null, stdout, stderr });
        reject(error);
      }
    });
  });
  // Callers may await either handle; observe early spawn failures on both promises.
  started.catch(() => {});
  result.catch(() => {});
  return { get pid() { return child.pid; }, started, result };
}

export async function prepareRuntime(options) { return startRuntime('prepare', options).result; }
export async function inspectRuntime(options) { return startRuntime('inspect', options).result; }
export async function exportRuntime(options) { return startRuntime('export', options).result; }
export async function receiveRuntime(options) { return startRuntime('receive', options).result; }
