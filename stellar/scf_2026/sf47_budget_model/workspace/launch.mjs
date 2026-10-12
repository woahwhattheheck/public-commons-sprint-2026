// MIT. Read the original SF47 managed launch without opening its SQLite workspace.
import { constants } from 'node:fs';
import { open, lstat, realpath, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRANT_LAUNCH_SCHEMA = 'stellar-forge.sf47.workspace-launch.v1';
export const GRANT_SELECTION_SCHEMA = 'stellar-forge.sf47.workspace-selection.v1';
const SOURCE = dirname(fileURLToPath(import.meta.url));
const BOOT_FILES = ['../budget.py', 'cli.py', 'server.py', 'model.py',
  'launcher.mjs', 'launch.mjs', 'managed_launch.py'];
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => Object.assign(new Error(message), {code, status:409});
const need = (test, code, message) => { if (!test) throw fail(code, message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function ordered(value) {
  return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]))
    : Array.isArray(value) ? value.map(ordered) : value;
}
const canonical = value => JSON.stringify(ordered(value));
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'),
    'GRANT_ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
}
async function regular(path, maximum, privateOnly = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'GRANT_REGULAR_FILE_REQUIRED');
    if (privateOnly) need(first.nlink === 1 && !(first.mode & 0o077) &&
      (process.getuid === undefined || first.uid === process.getuid()), 'GRANT_PRIVATE_LAUNCH_REQUIRED');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    need(first.dev === after.dev && first.ino === after.ino && first.size === after.size &&
      first.mtimeMs === after.mtimeMs && first.ctimeMs === after.ctimeMs && bytes.length === first.size,
    'GRANT_FILE_CHANGED_DURING_READ');
    return bytes;
  } finally { await handle.close(); }
}
async function privateDirectory(path) {
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (process.getuid === undefined || info.uid === process.getuid()) && await realpath(path) === path,
  'GRANT_PRIVATE_WORKSPACE_REQUIRED', 'Choose the original private workspace or a private receiving parent.');
}
export async function inspectGrantWorkspaceSelection({workspaceDirectory, scenarioFile, pythonExecutable} = {}) {
  const sourceDirectory = await realpath(SOURCE);
  const workspace = absolute(workspaceDirectory);
  need(await realpath(dirname(workspace)) === dirname(workspace), 'GRANT_REAL_WORKSPACE_PARENT_REQUIRED');
  try { await privateDirectory(workspace); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await privateDirectory(dirname(workspace));
  }
  const scenario = absolute(scenarioFile ?? join(sourceDirectory, '..', 'sf10_current_candidate.json'));
  need(await realpath(scenario) === scenario, 'GRANT_REAL_SCENARIO_REQUIRED');
  const executable = absolute(pythonExecutable);
  const pythonRealPath = await realpath(executable);
  await access(executable, constants.X_OK);
  const sourceSha256 = {};
  for (const name of BOOT_FILES)
    sourceSha256[name] = sha(await regular(resolve(sourceDirectory, name), 1024 * 1024));
  const selection = {
    schema:GRANT_SELECTION_SCHEMA, workspaceDirectory:workspace, sourceDirectory,
    scenarioFile:scenario, scenarioSha256:sha(await regular(scenario, 32 * 1024 * 1024)),
    pythonExecutable:executable, pythonRealPath, sourceSha256,
  };
  return {selection, selectionSha256:sha(Buffer.from(canonical(selection))),
    sourceFiles:BOOT_FILES.map(name => resolve(sourceDirectory, name))};
}
function originUrl(value, port) {
  need(typeof value === 'string' && value.length <= 1024, 'GRANT_STARTUP_URL_INVALID');
  const url = new URL(value);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username &&
    !url.password && !url.hash && !url.search && url.pathname === '/' &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    (port === 0 || Number(url.port || 80) === port), 'GRANT_STARTUP_URL_INVALID');
  return url;
}
function probe(url, token) {
  return new Promise((resolveResult, reject) => {
    const request = get(new URL('/api/access', url), {
      headers:{Authorization:'Bearer ' + token, Accept:'application/json'},
      maxHeaderSize:16384, agent:false,
    }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 32768) { request.destroy(fail('GRANT_STARTUP_RESPONSE_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('aborted', () => reject(fail('GRANT_STARTUP_UNAVAILABLE')));
      response.once('end', () => {
        try {
          need(response.statusCode === 200 && /^application\/json\b/i.test(response.headers['content-type'] ?? ''),
            'GRANT_STARTUP_UNAVAILABLE');
          resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) { reject(error); }
      });
    });
    request.once('error', reject);
    request.setTimeout(4000, () => request.destroy(fail('GRANT_STARTUP_TIMEOUT')));
  });
}
export async function readGrantWorkspaceLaunch({workspaceDirectory, scenarioFile, pythonExecutable,
  selectionSha256, executionSourceDirectory = SOURCE, pid, instanceId, port = 0, announcement} = {}) {
  need(Number.isSafeInteger(port) && port >= 0 && port <= 65535 && HASH.test(selectionSha256 ?? '') &&
    Number.isSafeInteger(pid) && pid > 0 && UUID.test(instanceId ?? ''), 'GRANT_STARTUP_BINDING_INVALID');
  const current = await inspectGrantWorkspaceSelection({workspaceDirectory, scenarioFile, pythonExecutable});
  need(current.selectionSha256 === selectionSha256, 'GRANT_LAUNCH_SELECTION_CHANGED');
  const executionDirectory = absolute(executionSourceDirectory);
  need(await realpath(executionDirectory) === executionDirectory, 'GRANT_EXECUTED_SOURCE_CHANGED');
  const execution = {sourceDirectory:executionDirectory, sourceSha256:{}};
  for (const name of BOOT_FILES)
    execution.sourceSha256[name] = sha(await regular(resolve(executionDirectory, name), 1024 * 1024));
  need(canonical(execution.sourceSha256) === canonical(current.selection.sourceSha256),
    'GRANT_EXECUTED_SOURCE_CHANGED');
  const privateLaunch = join(current.selection.workspaceDirectory, 'managed-launch.json');
  await privateDirectory(current.selection.workspaceDirectory);
  let record;
  try { record = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await regular(privateLaunch, 32768, true))); }
  catch (error) { if (error.code) throw error; throw fail('GRANT_PRIVATE_LAUNCH_INVALID'); }
  need(plain(record) && record.schema === GRANT_LAUNCH_SCHEMA && record.state === 'LISTENING' &&
    record.privateLaunch === privateLaunch && record.pid === pid && record.instanceId === instanceId &&
    record.selectionSha256 === selectionSha256 && canonical(record.selection) === canonical(current.selection) &&
    canonical(record.execution) === canonical(execution) &&
    record.accessFile === join(current.selection.workspaceDirectory, 'open-workspace.html') &&
    TOKEN.test(record.accessToken ?? ''), 'GRANT_PRIVATE_LAUNCH_CHANGED');
  const {accessToken, ...original} = record;
  need(plain(announcement) && canonical(announcement) === canonical(original), 'GRANT_STARTUP_ANNOUNCEMENT_CHANGED');
  const url = originUrl(record.url, port);
  // Authenticate the actual original listener. PID equality binds its record;
  // no /proc lookup is needed across managed worker PID namespaces.
  const response = await probe(url, accessToken);
  need(response?.available === true && canonical(response.launch) === canonical(original),
    'GRANT_STARTUP_LISTENER_CHANGED');
  url.hash = 'access=' + accessToken;
  return {url:url.href, original};
}
