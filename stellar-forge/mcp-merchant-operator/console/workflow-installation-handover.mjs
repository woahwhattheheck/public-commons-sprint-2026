// MIT. Original Console customer periods received by the native Installation desk.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { reopenWorkflowSeriesHandover } from './workflow-series-handover.mjs';
import { validateConsoleArchive, canonical, digest, fail } from './store.mjs';
import { createWorkflowReportPacket } from './workflow-reports.mjs';

export const WORKFLOW_INSTALLATION_SOURCE = 'stellar-forge.workflow-installation-source.v1';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 4096;
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const need = (condition, message, code = 'CONSOLE_INSTALLATION_SOURCE', status = 400) => {
  if (!condition) throw fail(code, message, status);
};
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
const descriptor = (path, raw) => ({ path, bytes: raw.length, sha256: digest(raw) });

async function readOriginal(path, expected) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= MAX_BYTES && (!expected || before.size === expected.bytes),
      'Select the complete original customer source within the Installation capacity.');
    const raw = await handle.readFile(), after = await handle.stat(), named = await lstat(path);
    need(named.isFile() && !named.isSymbolicLink() && sameFile(before, after) && sameFile(after, named) &&
      raw.length === before.size && (!expected || digest(raw) === expected.sha256),
      'The selected original customer file changed during preparation.', 'CONSOLE_INSTALLATION_SOURCE_CHANGED', 409);
    return raw;
  } finally { await handle.close(); }
}

function selection(input, received) {
  need(plain(input) && Object.keys(input).every(key => ['periods'].includes(key)) &&
    Array.isArray(input.periods) && input.periods.length > 0 && input.periods.length <= 100,
    'Select from one to 100 complete original customer periods.');
  const cycles = new Map(received.profile.workflowSeriesData?.cycles.map(row => [row.id, row]) ?? []);
  const runs = new Map(received.profile.workflowData?.runs.map(row => [row.id, row]) ?? []);
  const customers = new Set(received.manifest.customers.map(row => row.id)), seen = new Set();
  return input.periods.map(row => {
    need(plain(row) && Object.keys(row).length === 2 && typeof row.cycleId === 'string' &&
      Array.isArray(row.deliveryIds) && row.deliveryIds.every(id => typeof id === 'string') &&
      new Set(row.deliveryIds).size === row.deliveryIds.length &&
      row.deliveryIds.every(id => customers.has(id)), 'Select the original cycle and its explicit complete customer delivery IDs.');
    need(cycles.has(row.cycleId) && !seen.has(row.cycleId), 'Select each original saved cycle once.');
    seen.add(row.cycleId);
    const cycle = cycles.get(row.cycleId), run = runs.get(cycle.runId);
    const report = run ? createWorkflowReportPacket(received.profile, { runId: run.id }) : null;
    return { cycleId: cycle.id, deliveryIds: [...row.deliveryIds], report };
  });
}

/** Reuse the original complete-profile/file reader and report engine before packaging.
 * The Python consumer supplies the maintained ZIP implementation and independent
 * recorded-fact receiving. This operation does not dispatch or import a native run.
 */
export async function exportWorkflowInstallation({ directory, input, output, python = 'python3', signal } = {}) {
  need(typeof directory === 'string' && directory && typeof output === 'string' && output,
    'Select the original full customer directory and complete output filename.');
  need(typeof python === 'string' && python && !python.includes('\0'), 'Select the original installed Python executable.');
  signal?.throwIfAborted();
  const received = await reopenWorkflowSeriesHandover({ directory });
  validateConsoleArchive(received.profile);
  const chosen = selection(input, received);
  const originals = received.files.map(row => ({ path: row.path, bytes: row.bytes,
    sha256: row.sha256, absolutePath: row.absolutePath }));
  for (const name of ['selection.json', 'handover.json']) {
    const path = join(received.directory, name), raw = await readOriginal(path);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    need(name !== 'handover.json' || canonical(value) === canonical(received.manifest),
      'The complete original handover changed.', 'CONSOLE_INSTALLATION_SOURCE_CHANGED', 409);
    if (name === 'selection.json') need(value.contentSha256 === received.manifest.selectionSha256,
      'The original customer selection changed.', 'CONSOLE_INSTALLATION_SOURCE_CHANGED', 409);
    originals.push({ ...descriptor(name, raw), absolutePath: path });
  }
  const generated = [];
  const periods = chosen.map(row => {
    let report = null;
    if (row.report) {
      const raw = Buffer.from(JSON.stringify(row.report, null, 2) + '\n');
      report = descriptor('reports/' + row.report.selection.runId + '.json', raw);
      generated.push({ ...report, base64: raw.toString('base64') });
    }
    return { cycleId: row.cycleId, deliveryIds: row.deliveryIds, report };
  });
  const all = [...originals, ...generated];
  need(all.length + 2 <= MAX_FILES && all.reduce((sum, row) => sum + row.bytes, 0) <= MAX_BYTES,
    'The complete Installation source exceeds 32 MiB / 4096 files. Select a smaller complete customer handover.',
    'CONSOLE_INSTALLATION_SOURCE_SIZE', 413);
  const byName = new Map(originals.map(row => [row.path, { path: row.path, bytes: row.bytes, sha256: row.sha256 }]));
  const manifest = { schema: WORKFLOW_INSTALLATION_SOURCE, profileId: received.profileId,
    sourceWorkspaceId: received.manifest.sourceWorkspaceId, profile: byName.get('profile.json'),
    selection: byName.get('selection.json'), handover: byName.get('handover.json'), periods, files: [] };
  const body = Buffer.from(JSON.stringify({ manifest, originals, generated }));
  need(body.length <= MAX_BYTES * 2, 'Retain the complete bounded original packaging input.', 'CONSOLE_INSTALLATION_SOURCE_SIZE', 413);
  const script = fileURLToPath(new URL('../../../stellar/scf_2026/sf47_budget_model/workspace/operations_workflow_source.py', import.meta.url));
  const controller = new AbortController(), relay = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', relay, { once: true });
  const interrupt = () => controller.abort(new Error('Original customer source export interrupted.'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let child, closed;
  try {
    signal?.throwIfAborted();
    let spawnError;
    const chunks = [], errors = []; let size = 0, errorSize = 0;
    child = spawn(python, [script, 'package', '--input', '-', '--output', output],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    closed = new Promise(resolve => {
      child.once('error', error => { spawnError = error; });
      child.once('close', (code, signalName) => resolve({ code, signal: signalName }));
    });
    const abort = () => child.kill('SIGTERM');
    controller.signal.addEventListener('abort', abort, { once: true });
    if (controller.signal.aborted) abort();
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) { spawnError = fail('CONSOLE_INSTALLATION_SOURCE_OUTPUT', 'The original source response exceeds its complete capacity.', 413); child.kill('SIGTERM'); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      errors.push(chunk); errorSize += chunk.length;
      while (errorSize > 32768 && errors.length > 1) errorSize -= errors.shift().length;
    });
    child.stdin.on('error', error => { if (!spawnError) spawnError = error; });
    child.stdin.end(body);
    const ended = await closed;
    controller.signal.removeEventListener('abort', abort);
    const diagnostics = Buffer.concat(errors).toString('utf8').slice(-32768);
    if (controller.signal.aborted) throw Object.assign(fail('CONSOLE_INSTALLATION_SOURCE_INTERRUPTED',
      'Continue the same output filename to reopen a completed original handover.', 409), { diagnostics });
    if (spawnError || ended.code !== 0) throw Object.assign(fail('CONSOLE_INSTALLATION_SOURCE_PACKAGE',
      spawnError?.message ?? 'The original Installation source packager returned an error.', 500),
      { exitCode: ended.code, signal: ended.signal, diagnostics });
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    need(result.schema === WORKFLOW_INSTALLATION_SOURCE && result.profileId === received.profileId &&
      canonical(result.periods.map(row => ({ cycleId: row.cycleId, deliveryIds: row.deliveryIds }))) ===
      canonical(periods.map(row => ({ cycleId: row.cycleId, deliveryIds: row.deliveryIds }))),
      'The complete packaged source returned another original customer selection.', 'CONSOLE_INSTALLATION_SOURCE_CHANGED', 409);
    return result;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    signal?.removeEventListener('abort', relay);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM'); await closed;
    }
  }
}
