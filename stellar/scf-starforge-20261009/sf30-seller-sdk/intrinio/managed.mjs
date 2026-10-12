// MIT. Source-bound launch of the original retained Intrinio Python workspace.
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { inspectIntrinioWorkspace, startIntrinioWorkspace } from './workspace.mjs';
import { absolute, plain, need, digest, json, canonical, privateDirectory, regular,
  operationLease } from '../../distribution/runtime-workspace/storage.mjs';

export const INTRINIO_SELECTION_SCHEMA = 'stellar-forge.intrinio-managed-selection.v1';
export const INTRINIO_STARTUP_SCHEMA = 'stellar-forge.intrinio-operator-startup.v1';
export const INTRINIO_BINDING_SCHEMA = 'stellar-forge.intrinio-operator-binding.v1';
export const INTRINIO_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PREFIX = 'stellar/scf-starforge-20261009/';
const PRODUCT = PREFIX + 'sf30-seller-sdk/intrinio/';
const PYTHON = PREFIX + 'sf30-seller-sdk/python/';
export const INTRINIO_MANAGED_SOURCE_FILES = Object.freeze([
  ...['managed.mjs', 'workspace.mjs', 'cli.mjs', 'application.py', 'intrinio_review/__init__.py',
    'intrinio_review/model.py', 'intrinio_review/domain.py', 'public/index.html', 'public/app.mjs',
    'public/data.mjs', 'public/style.css'].map(path => PRODUCT + path),
  ...['config.mjs', 'source.mjs', 'merchant.mjs', 'workspace/model.mjs', 'workspace/server.mjs',
    'workspace/index.html', 'workspace/browser.mjs', 'workspace/local-draft-store.mjs',
    'workspace/release-panel.mjs', 'workspace/style.css'].map(path => PYTHON + path),
  PREFIX + 'sf82-seller-pilot/releases.mjs',
  PREFIX + 'sf82-seller-pilot/release-python.mjs',
  PREFIX + 'distribution/runtime-workspace/storage.mjs',
]);
const hash = value => digest(json(canonical(value)));
const equal = (left, right) => json(canonical(left)) === json(canonical(right));
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function intrinioManagedSource(sourceRoot = INTRINIO_SOURCE_ROOT) {
  sourceRoot = absolute(sourceRoot);
  need(await realpath(sourceRoot) === sourceRoot, 'INTRINIO_MANAGED_SOURCE_ROOT');
  const files = [];
  for (const name of INTRINIO_MANAGED_SOURCE_FILES) {
    const path = join(sourceRoot, name);
    need(await realpath(path) === path, 'INTRINIO_MANAGED_SOURCE_PATH');
    const bytes = await regular(path, 8 * 1024 * 1024);
    files.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  }
  return { root: sourceRoot, files, sha256: hash(files) };
}

function selectionShape(selection) {
  need(plain(selection) && selection.schema === INTRINIO_SELECTION_SCHEMA &&
    plain(selection.workspace) && plain(selection.revision) && plain(selection.source) &&
    identifier(selection.workspace.id) && typeof selection.workspace.createdAt === 'string' &&
    Number.isFinite(Date.parse(selection.workspace.createdAt)) && identifier(selection.revision.id) &&
    sha(selection.revision.digest) && sha(selection.source.sha256) &&
    Array.isArray(selection.source.files) && selection.source.files.length === INTRINIO_MANAGED_SOURCE_FILES.length,
  'INTRINIO_MANAGED_SELECTION_INVALID');
  absolute(selection.workspace.directory); absolute(selection.source.root);
  for (const [index, file] of selection.source.files.entries()) {
    need(plain(file) && file.name === INTRINIO_MANAGED_SOURCE_FILES[index] && sha(file.sha256) &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0, 'INTRINIO_MANAGED_SELECTION_INVALID');
  }
  need(hash(selection.source.files) === selection.source.sha256, 'INTRINIO_MANAGED_SOURCE_CHANGED');
  return selection;
}

/** Read the original SQLite revision and blobs in read-only mode. */
export async function prepareIntrinioManagedSelection(directory, { sourceRoot = INTRINIO_SOURCE_ROOT } = {}) {
  directory = await privateDirectory(absolute(directory));
  const snapshot = await inspectIntrinioWorkspace(directory);
  need(snapshot.workspace.directory === directory && identifier(snapshot.workspace.id) &&
    typeof snapshot.workspace.createdAt === 'string' && sha(snapshot.revision.digest),
  'INTRINIO_MANAGED_WORKSPACE_INVALID');
  const source = await intrinioManagedSource(sourceRoot);
  return selectionShape({
    schema: INTRINIO_SELECTION_SCHEMA,
    workspace: { directory, id: snapshot.workspace.id, createdAt: snapshot.workspace.createdAt },
    revision: { id: snapshot.revision.id, digest: snapshot.revision.digest },
    source,
  });
}

function privateUrls(startup, port) {
  let operator, native;
  try { operator = new URL(startup.operatorUrl); native = new URL(startup.nativeOperatorUrl); }
  catch { need(false, 'INTRINIO_MANAGED_URL_INVALID'); }
  for (const url of [operator, native]) {
    need(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      !url.username && !url.password && !url.search && /^#[a-f0-9]{64}$/.test(url.hash) &&
      Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535,
    'INTRINIO_MANAGED_URL_INVALID');
  }
  need(operator.pathname === '/intrinio' && native.pathname === '/' &&
    operator.origin === native.origin && operator.hash === native.hash &&
    (!port || Number(operator.port || 80) === port), 'INTRINIO_MANAGED_URL_CHANGED');
  return { operator, native };
}
async function originalJson(url, path, maximum = 16 * 1024 * 1024) {
  let response;
  try {
    response = await fetch(new URL(path, url.origin), {
      headers: { 'x-python-workspace-token': url.hash.slice(1) },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch { need(false, 'INTRINIO_MANAGED_LISTENER_UNAVAILABLE'); }
  need(response.ok && response.headers.get('content-type')?.startsWith('application/json'),
    'INTRINIO_MANAGED_LISTENER_CHANGED');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      need(total <= maximum, 'INTRINIO_MANAGED_STATE_LIMIT');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)));
}

/** Authenticate the original live API and bind it to the exact selected process and source. */
export async function verifyIntrinioManagedStartup(startup, {
  selection, sourceRoot = INTRINIO_SOURCE_ROOT, port = 0, pid,
} = {}) {
  selectionShape(selection);
  need(plain(startup) && startup.schema === INTRINIO_STARTUP_SCHEMA && plain(startup.binding),
    'INTRINIO_MANAGED_STARTUP_INVALID');
  const binding = startup.binding;
  need(binding.schema === INTRINIO_BINDING_SCHEMA &&
    typeof binding.instanceId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(binding.instanceId) &&
    Number.isSafeInteger(binding.pid) && binding.pid > 0 && (!pid || binding.pid === pid) &&
    typeof binding.startedAt === 'string' && Number.isFinite(Date.parse(binding.startedAt)) &&
    equal(binding.workspace, selection.workspace) && equal(binding.revision, selection.revision) &&
    binding.selectionSha256 === hash(selection) &&
    binding.sourceRoot === absolute(sourceRoot) && binding.selectedSourceRoot === selection.source.root &&
    binding.sourceSha256 === selection.source.sha256,
  'INTRINIO_MANAGED_STARTUP_CHANGED');
  const source = await intrinioManagedSource(sourceRoot);
  need(source.sha256 === selection.source.sha256 && equal(source.files, selection.source.files),
    'INTRINIO_MANAGED_SOURCE_CHANGED');
  const { operator, native } = privateUrls(startup, port);
  const state = await originalJson(operator, '/api/state');
  need(state.schema === 'stellar-forge.python-workspace.v1' &&
    state.workspace?.id === selection.workspace.id &&
    state.workspace?.createdAt === selection.workspace.createdAt &&
    state.workspace?.directory === selection.workspace.directory &&
    equal(state.operator?.binding, binding) && state.operator?.stopping === false,
  'INTRINIO_MANAGED_LISTENER_CHANGED');
  // The browser may have saved a later revision after startup. The reviewed
  // original revision must remain present with its original source digest.
  const revision = await originalJson(operator, '/api/revision?id=' + encodeURIComponent(selection.revision.id));
  need(revision.id === selection.revision.id && revision.digest === selection.revision.digest,
    'INTRINIO_MANAGED_REVISION_CHANGED');
  return {
    url: operator.href,
    links: [
      { id: 'intrinio-review', label: 'Statement review', url: operator.href },
      { id: 'python-source', label: 'Python source and release', url: native.href },
    ],
    original: startup,
  };
}

/** Own one original listener; its existing close drains previews and the seller. */
export async function startManagedIntrinioWorkspace(directory, { selection, port = 0 } = {}) {
  directory = await privateDirectory(absolute(directory));
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INTRINIO_MANAGED_PORT_INVALID');
  selectionShape(selection);
  need(selection.workspace.directory === directory,
    'INTRINIO_MANAGED_SELECTION_CHANGED');
  const lease = await operationLease(join(directory, '.intrinio-operator.lock'));
  let server;
  try {
    const current = await prepareIntrinioManagedSelection(directory);
    // Managed adoption keeps byte-identical source under its retained release root.
    const selectedCurrent = { ...current, source: { ...current.source, root: selection.source.root } };
    need(equal(selectedCurrent, selection), 'INTRINIO_MANAGED_REVIEW_CHANGED',
      'The selected workspace revision or installed source changed. Review Start again.');
    const binding = {
      schema: INTRINIO_BINDING_SCHEMA, instanceId: randomUUID(), pid: process.pid,
      startedAt: new Date().toISOString(), workspace: selection.workspace, revision: selection.revision,
      selectionSha256: hash(selection), selectedSourceRoot: selection.source.root,
      sourceRoot: current.source.root, sourceSha256: current.source.sha256,
    };
    server = await startIntrinioWorkspace(directory, { port, operatorBinding: binding });
    need(server.workspace.metadata().head === selection.revision.id, 'INTRINIO_MANAGED_REVIEW_CHANGED');
    const startup = {
      schema: INTRINIO_STARTUP_SCHEMA, operatorUrl: server.operatorUrl,
      nativeOperatorUrl: server.nativeOperatorUrl, binding,
    };
    await verifyIntrinioManagedStartup(startup, { selection, port, pid: process.pid });
    const closed = server.closed.finally(() => lease.close()); closed.catch(() => {});
    return { ...server, startup, closed };
  } catch (error) {
    try { await server?.close(); } finally { await lease.close(); }
    throw error;
  }
}
