// MIT. Host-owned connections to the original local Merchant Consoles.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { WORKFLOW_SERIES_ALIAS } from './catalog/workflow-series.mjs';
export const WORKFLOW_SERIES_CONNECTION_SCHEMA = 'stellar-forge.workflow-series-connection.v1';
export const seriesConnectionFailure = (code, message) => Object.assign(new Error(message), { code });
const need = (value, message) => { if (!value) throw seriesConnectionFailure('WORKFLOW_SERIES_CONFIGURATION', message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, allowed, required) => need(plain(value) &&
  Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)),
  'Use the complete declared recurring-work connection fields.');
const pathValue = value => { need(typeof value === 'string' && value.length > 0 && value.length <= 4000 && !/[\x00-\x1f]/.test(value), 'Select a declared local path.'); return value; };
export async function readWorkflowSeriesPrivateFile(path, maximum = 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(maximum) && !(before.mode & 0o077n) &&
      (typeof process.getuid !== 'function' || before.uid === BigInt(process.getuid())),
    'Use an owned private regular file within its original size limit.');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      need(read.bytesRead > 0, 'The original private file ended before its saved byte count.'); offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    need(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid'].every(key => before[key] === after[key]),
      'The original private file changed while being read.');
    return bytes;
  } finally { await handle.close(); }
}
export async function workflowSeriesPrivateDirectory(path, create = false) {
  path = resolve(path);
  if (create) try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()) && await realpath(path) === path,
  'Use an existing owned private directory with its original absolute path.');
  return path;
}
export async function readWorkflowSeriesConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readWorkflowSeriesPrivateFile(path)));
  exact(raw, ['schema', 'consoles'], ['schema', 'consoles']);
  need(raw.schema === WORKFLOW_SERIES_CONNECTION_SCHEMA && plain(raw.consoles) && Object.keys(raw.consoles).length > 0,
    'Declare the original recurring-work Consoles.');
  const consoles = Object.create(null), base = dirname(path);
  for (const [alias, value] of Object.entries(raw.consoles)) {
    need(WORKFLOW_SERIES_ALIAS.test(alias), 'Use a stable lowercase Console alias.');
    exact(value, ['label', 'workspaceId', 'url', 'urlFile', 'urlEnv', 'tokenEnv', 'incoming'],
      ['label', 'workspaceId', 'tokenEnv']);
    need(typeof value.label === 'string' && value.label.trim() && value.label.length <= 160 &&
      typeof value.workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.workspaceId),
    'Retain the readable Console label and its actual saved workspace ID.');
    need(typeof value.tokenEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.tokenEnv),
      'Name the existing Console bearer-token environment variable.');
    need(['url', 'urlFile', 'urlEnv'].filter(key => Object.hasOwn(value, key)).length === 1,
      'Declare exactly one existing Console URL, URL file or URL environment variable.');
    const selected = { label: value.label, workspaceId: value.workspaceId, tokenEnv: value.tokenEnv, incoming: Object.create(null) };
    if (value.url !== undefined) selected.url = pathValue(value.url);
    else if (value.urlFile !== undefined) selected.urlFile = resolve(base, pathValue(value.urlFile));
    else { need(typeof value.urlEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.urlEnv),
      'Name the existing Console URL environment variable.'); selected.urlEnv = value.urlEnv; }
    need(value.incoming === undefined || plain(value.incoming), 'Declare incoming handovers by their original names.');
    for (const [name, entry] of Object.entries(value.incoming ?? {})) {
      need(WORKFLOW_SERIES_ALIAS.test(name), 'Use a stable lowercase incoming handover alias.');
      exact(entry, ['directory', 'expectedContentSha256'], ['directory', 'expectedContentSha256']);
      need(typeof entry.expectedContentSha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.expectedContentSha256),
        'Retain the original complete handover content SHA256.');
      selected.incoming[name] = { directory: resolve(base, pathValue(entry.directory)), expectedContentSha256: entry.expectedContentSha256 };
    }
    consoles[alias] = selected;
  }
  return { schema: WORKFLOW_SERIES_CONNECTION_SCHEMA, consoles };
}
