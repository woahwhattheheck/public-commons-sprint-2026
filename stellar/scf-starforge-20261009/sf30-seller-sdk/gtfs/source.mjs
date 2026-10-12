// MIT. Original GTFS program bridge; source and archive programs remain fixed native modules.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fault } from '../postgres/publisher/files.mjs';

export const GTFS_WORKSPACE_SCHEMA = 'stellar-forge.gtfs-workspace.v1';
export const GTFS_SELECTION_SCHEMA = 'stellar-forge.gtfs-selection.v1';
export const GTFS_LAUNCH_SCHEMA = 'stellar-forge.gtfs-workspace-launch.v1';
export const GTFS_ZIP_MAX_BYTES = 16 * 1024 * 1024;
const PROGRAM = fileURLToPath(new URL('./source.py', import.meta.url));
const ARCHIVE_PROGRAM = fileURLToPath(new URL('./archive.py', import.meta.url));
const errorCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value) ? value : 'GTFS_PROCESS_FAILED';

async function runPython(program, args, { env = process.env, timeoutMs = 300000, signal, onRecord, stdout = process.stdout } = {}) {
  if (!Array.isArray(args) || args.some(v => typeof v !== 'string')) throw fault('GTFS_ARGUMENTS_INVALID');
  if (signal?.aborted) throw fault('GTFS_CANCELLED');
  const python = env.SF_GTFS_PYTHON || env.SF_FRICTIONLESS_PYTHON || 'python3';
  const child = spawn(python, ['-B', '-u', program, ...args], {
    env: { ...env, PYTHONDONTWRITEBYTECODE: '1' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '', timedOut = false, cancelled = false, killTimer, spawnError;
  const closed = new Promise(resolve => {
    child.once('error', issue => { spawnError = issue; });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-32768); });
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 3000);
      killTimer.unref();
    }
  };
  const abort = () => { cancelled = true; stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  timer.unref();
  let output = '', pending = '', total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const data of child.stdout) {
      if (signal?.aborted) abort();
      const text = decoder.decode(data, { stream: true });
      if (onRecord) {
        pending += text;
        let line;
        while ((line = pending.indexOf('\n')) !== -1) {
          const value = pending.slice(0, line); pending = pending.slice(line + 1);
          if (!value || value.length > 16777216) throw fault('GTFS_PROTOCOL_RECORD_INVALID');
          await onRecord(JSON.parse(value));
        }
        if (pending.length > 16777216) throw fault('GTFS_PROTOCOL_RECORD_TOO_LARGE');
      } else if (stdout === null) {
        total += data.length;
        if (total > 16777216) throw fault('GTFS_RESPONSE_TOO_LARGE');
        output += text;
      } else {
        if (!stdout.write(data)) await new Promise(resolve => stdout.once('drain', resolve));
      }
    }
    const remainder = decoder.decode();
    if (onRecord && (pending + remainder).length) throw fault('GTFS_PROTOCOL_TRUNCATED');
    if (!onRecord && stdout === null) output += remainder;
    const ended = await closed;
    if (timedOut) throw fault('GTFS_PROCESS_TIMEOUT');
    if (cancelled) throw fault('GTFS_CANCELLED');
    if (spawnError) throw fault('GTFS_PYTHON_UNAVAILABLE', 'Select an installed Python 3 runtime with SF_GTFS_PYTHON.');
    if (ended.code !== 0) {
      let record;
      try { record = JSON.parse(stderr.trim().split('\n').at(-1)); } catch {}
      throw fault(errorCode(record?.error), record?.message || 'The retained package operation did not complete.');
    }
    return stdout === null && !onRecord ? JSON.parse(output) : undefined;
  } catch (issue) {
    stop(); await closed;
    if (timedOut) throw fault('GTFS_PROCESS_TIMEOUT');
    if (cancelled) throw fault('GTFS_CANCELLED');
    throw issue;
  } finally {
    clearTimeout(timer); clearTimeout(killTimer);
    signal?.removeEventListener('abort', abort);
  }
}


export function runGtfsCommand(args, options = {}) {
  return runPython(PROGRAM, args, { ...options, stdout: null });
}
export function runGtfsArchiveCommand(args, options = {}) {
  return runPython(ARCHIVE_PROGRAM, args, { ...options, stdout: null });
}
export function inspectGtfsArchive(file, expectedSha256, options = {}) {
  return runGtfsCommand(['inspect', '--archive', resolve(file),
    ...(expectedSha256 ? ['--sha256', expectedSha256] : [])], options);
}
export function compileGtfsEdition(file, recipe, output, options = {}) {
  return runGtfsCommand(['compile', '--archive', resolve(file), '--recipe', resolve(recipe), '--output', resolve(output)], options);
}
export function inspectGtfsEdition(directory, options = {}) {
  return runGtfsCommand(['read-edition', '--edition', resolve(directory)], options);
}
function pageArgs(input) {
  return ['--resource', input.resource, '--offset', String(input.offset ?? 0),
    '--limit', String(input.limit ?? 50), '--query', input.query ?? ''];
}
export function readGtfsRows(directory, input, options = {}) {
  return runGtfsCommand(['rows', '--edition', resolve(directory), ...pageArgs(input)], options);
}
export function readGtfsSourceRows(file, expectedSha256, input, options = {}) {
  return runGtfsCommand(['table', '--archive', resolve(file), '--sha256', expectedSha256, ...pageArgs(input)], options);
}
export function compareGtfsEditions(before, after, output, options = {}) {
  return runGtfsCommand(['compare', '--before', resolve(before), '--after', resolve(after), '--output', resolve(output)], options);
}
