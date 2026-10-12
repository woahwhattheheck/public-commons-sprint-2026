// MIT. Original MPP workbench entry, read-only input review and managed startup binding.
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, privateDirectory, regular, readJSON, plain, need, digest, canonical, recordId, operationId } from './storage.mjs';

export const MPP_READY_SCHEMA = 'stellar-forge.mpp-console-ready.v1';
const BINDING_SCHEMA = 'stellar-forge.mpp-application-binding.v1';
const SOURCE = 'stellar/scf-starforge-20261009/mpp-charge';
const SHA = /^[a-f0-9]{64}$/;
const ROLES = ['merchant', 'buyer', 'customer'];
const PACKAGES = ['@stellar/mpp', 'mppx', '@stellar/stellar-sdk'];
const sourceNames = ['cli.mjs', 'server.mjs', 'customer/workbench.mjs', 'storage.mjs', 'runtime.mjs', 'package.json'];
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const field = (name, label, type = 'path', required = false, description = '') => ({ name, label, type, required, description });

export function mppApplication(common) {
  return {
    id: 'mpp', command: 'mpp', requiredSource: SOURCE + '/customer/workbench.mjs',
    title: 'MPP merchant and customer', terminal: true,
    description: 'Reopen the original merchant, customer offers, saved purchases, response downloads and recovery. Execution uses the existing governor and its original terminal.',
    fields: [
      field('workspaceDirectory', 'Initialized private MPP workspace', 'path', true,
        'Use the original mpp init workspace or a received customer workspace. Unconfigured workspaces can be opened for configuration.'),
      field('tokenEnv', 'Optional console token environment name', 'text', false,
        'Name of a private environment value containing the original 64-character lowercase hexadecimal console token. Leave empty for a new private token.'),
      field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3; the existing managed worker supplies the governor terminal.'),
      ...common,
    ],
  };
}

async function privateJSON(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await file.stat();
    need(first.isFile() && first.nlink === 1 && !(first.mode & 0o077) &&
      (process.getuid === undefined || first.uid === process.getuid()) &&
      first.size <= 4 * 1024 * 1024, 'APPLICATION_MPP_PRIVATE_RECORD_REQUIRED');
    const bytes = await file.readFile(), last = await file.stat();
    need(bytes.length === first.size && first.size === last.size &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs,
      'APPLICATION_MPP_RECORD_CHANGED', 'Review the current original MPP record again', 409);
    let value;
    try { value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)); }
    catch { need(false, 'APPLICATION_MPP_RECORD_JSON_INVALID'); }
    return { value, sha256: digest(bytes) };
  } finally { await file.close(); }
}

async function workspaceSnapshot(directory, inputPath) {
  directory = absolute(directory);
  await privateDirectory(directory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const metadataPath = join(directory, 'workspace.json');
  const metadataInput = await inputPath(metadataPath, 'file');
  const { value: metadata, sha256 } = await privateJSON(metadataPath);
  need(metadataInput.sha256 === sha256, 'APPLICATION_MPP_RECORD_CHANGED');
  need(plain(metadata) && metadata.schema === 'stellar-forge.mpp-workspace.v1' &&
    typeof metadata.createdAt === 'string' && !Number.isNaN(Date.parse(metadata.createdAt)) &&
    Number.isSafeInteger(metadata.revision) && metadata.revision >= 0 &&
    ROLES.every(role => metadata[role] == null || typeof metadata[role] === 'string' && SHA.test(metadata[role])),
    'APPLICATION_MPP_WORKSPACE_INVALID',
    'Choose the original initialized MPP workspace; use starforge mpp init for a new workspace');
  inputs.push(metadataInput);
  for (const group of ['sdk', 'purchases', 'deliveries', 'profiles', 'reports']) {
    await privateDirectory(join(directory, group));
    inputs.push(await inputPath(join(directory, group), 'directory', false, true));
  }
  const profiles = Object.fromEntries(ROLES.map(role => [role, metadata[role] ?? null]));
  const visited = new Set();
  for (const profileId of Object.values(profiles)) {
    if (!profileId || visited.has(profileId)) continue;
    visited.add(profileId);
    const path = join(directory, 'profiles', digest(profileId) + '.json');
    const input = await inputPath(path, 'file');
    const row = await privateJSON(path);
    need(input.sha256 === row.sha256 && plain(row.value) &&
      row.value.schema === 'stellar-forge.mpp-record.v1' &&
      row.value.key === profileId && plain(row.value.value) &&
      digest(JSON.stringify(canonical(row.value.value))) === profileId,
      'APPLICATION_MPP_PROFILE_CHANGED', 'Review the original saved MPP profile', 409);
    inputs.push(input);
  }
  need(same(metadataInput, await inputPath(metadataPath, 'file')),
    'APPLICATION_MPP_RECORD_CHANGED', 'Review the current original MPP workspace again', 409);
  return {
    inputs, workspace: directory, createdAt: metadata.createdAt, revision: metadata.revision,
    metadataSha256: sha256, profiles,
    directoryIdentity: { dev: inputs[0].dev, ino: inputs[0].ino },
  };
}

/** Reads saved data and selected source only; the original console acquires its writer lease. */
export async function prepareMppApplication(settings, inputPath, runtimeDirectory) {
  need(typeof inputPath === 'function', 'APPLICATION_MPP_INPUT_READER_REQUIRED');
  need(settings.tokenEnv === undefined || typeof settings.tokenEnv === 'string' &&
    /^[A-Z_][A-Z0-9_]{0,127}$/.test(settings.tokenEnv), 'APPLICATION_MPP_TOKEN_ENV_INVALID');
  const port = settings.port ?? 0;
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'APPLICATION_PORT_INVALID');
  const snapshot = await workspaceSnapshot(settings.workspaceDirectory, inputPath);
  const selected = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const inputs = [...snapshot.inputs], sources = {}, sourceText = {};
  for (const name of sourceNames) {
    const path = join(selected.sourceRoot, SOURCE, name);
    const input = await inputPath(path, 'file');
    const bytes = await regular(path);
    need(input.sha256 === digest(bytes), 'APPLICATION_MPP_SOURCE_CHANGED');
    inputs.push(input);
    sources[name] = { path, sha256: input.sha256, bytes: bytes.length };
    sourceText[name] = new TextDecoder('utf8', { fatal: true }).decode(bytes);
  }
  need((sourceText['cli.mjs'] + sourceText['server.mjs']).includes(MPP_READY_SCHEMA) &&
    sourceText['server.mjs'].includes('/api/identity'),
    'APPLICATION_MPP_READY_SOURCE_REQUIRED',
    'Select a runtime containing the original MPP customer workbench and its console identity startup');
  let manifest;
  try { manifest = JSON.parse(sourceText['package.json']); }
  catch { need(false, 'APPLICATION_MPP_RUNTIME_MANIFEST_INVALID'); }
  need(plain(manifest?.dependencies) && PACKAGES.every(name =>
    typeof manifest.dependencies[name] === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.dependencies[name])),
    'APPLICATION_MPP_RUNTIME_MANIFEST_INVALID');
  const versions = Object.fromEntries(PACKAGES.map(name => [name, manifest.dependencies[name]]));
  const args = ['serve', snapshot.workspace, String(port)];
  if (settings.tokenEnv) args.push('--token-env', settings.tokenEnv);
  const { inputs: ignored, ...workspace } = snapshot;
  return {
    args, inputs,
    binding: {
      schema: BINDING_SCHEMA, ...workspace, tokenEnv: settings.tokenEnv ?? null, versions, sources,
      runtime: { directory: selected.directory, sourceCommit: selected.sourceCommit,
        sourceManifestSha256: selected.sourceManifestSha256 },
    },
  };
}

async function identityResponse(url, token) {
  const response = await fetch(new URL('/api/identity', url), {
    headers: { authorization: 'Bearer ' + token }, redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    need(false, 'APPLICATION_MPP_IDENTITY_UNAVAILABLE', 'The original MPP console identity did not match its startup');
  }
  const reader = response.body?.getReader();
  need(reader, 'APPLICATION_MPP_IDENTITY_UNAVAILABLE');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      need(length <= 65536, 'APPLICATION_MPP_IDENTITY_TOO_LARGE');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let value;
  try { value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { need(false, 'APPLICATION_MPP_IDENTITY_JSON_INVALID'); }
  return value;
}

/** Uses the existing run/start-review and PTY records; it creates no new process owner. */
export async function mppStartup(request, line, operationDirectory) {
  if (request.command !== 'mpp' || request.args?.[0] !== 'serve' ||
      !line.startsWith('{"schema":"' + MPP_READY_SCHEMA + '",')) return null;
  let ready, url;
  try { ready = JSON.parse(line); url = new URL(ready.privateUrl); } catch { return null; }
  if (!plain(ready) || ready.schema !== MPP_READY_SCHEMA ||
      url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      url.username || url.password || url.pathname !== '/' || url.search ||
      !/^#[a-f0-9]{64}$/.test(url.hash) || ready.origin !== url.origin ||
      !Number.isInteger(ready.pid) || ready.pid < 1 ||
      !Number.isInteger(ready.ppid) || ready.ppid < 1 || ready.pid === ready.ppid ||
      typeof ready.workspace !== 'string' || typeof ready.createdAt !== 'string' ||
      !plain(ready.versions)) return null;
  const port = Number(request.args[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65535 ||
      port !== 0 && Number(url.port || 80) !== port || ready.workspace !== request.args[1]) return null;
  const directory = absolute(operationDirectory);
  const id = operationId(basename(directory)), appId = recordId(request.applicationId);
  need(basename(dirname(directory)) === 'operations', 'APPLICATION_MPP_OPERATION_DIRECTORY_INVALID');
  const root = dirname(dirname(directory));
  const run = await readJSON(join(root, 'applications', appId, 'runs', id + '.json'));
  need(run.schema === 'stellar-forge.application-run.v1' && run.id === id &&
    run.applicationId === appId && run.request.command === request.command &&
    same(run.request.args, request.args), 'APPLICATION_MPP_RUN_CHANGED');
  const review = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  const original = review.command?.mppBinding;
  need(review.schema === 'stellar-forge.application-start-review.v1' &&
    review.applicationId === appId && review.id === run.reviewId &&
    review.applicationRevision === run.revision && review.command.command === 'mpp' &&
    same(review.command.args, request.args) && original?.schema === BINDING_SCHEMA &&
    original.workspace === ready.workspace && original.createdAt === ready.createdAt &&
    same(original.versions, ready.versions) &&
    (ready.tokenEnv ?? null) === original.tokenEnv &&
    same(original.runtime, { directory: review.runtime.directory, sourceCommit: review.runtime.sourceCommit,
      sourceManifestSha256: review.runtime.sourceManifestSha256 }),
    'APPLICATION_MPP_START_BINDING_CHANGED');
  await privateDirectory(original.workspace);
  const workspaceInfo = await lstat(original.workspace);
  need(workspaceInfo.dev === original.directoryIdentity?.dev && workspaceInfo.ino === original.directoryIdentity?.ino,
    'APPLICATION_MPP_START_WORKSPACE_CHANGED');
  const state = await privateJSON(join(original.workspace, 'workspace.json'));
  need(state.sha256 === original.metadataSha256 &&
    state.value.createdAt === original.createdAt, 'APPLICATION_MPP_START_WORKSPACE_CHANGED');
  const terminal = await readJSON(join(directory, 'terminal-process.json'));
  need(request.terminal === true &&
    terminal.schema === 'stellar-forge.application-terminal-process.v1' &&
    terminal.operationId === id && terminal.original?.pid === ready.ppid &&
    typeof terminal.original.processStart === 'string' &&
    same(terminal.original.args?.slice(-(request.args.length + 1)), ['mpp', ...request.args]),
    'APPLICATION_MPP_ORIGINAL_CHILD_CHANGED');
  if (await readJSON(join(directory, 'terminal-exit.json'), true) ||
      await readJSON(join(directory, 'stop.json'), true)) return null;
  const identity = await identityResponse(url, url.hash.slice(1));
  need(plain(identity) && identity.schema === 'stellar-forge.mpp-console-identity.v1' &&
    identity.pid === ready.pid && identity.ppid === ready.ppid &&
    identity.origin === ready.origin && identity.workspace === original.workspace &&
    identity.createdAt === original.createdAt && same(identity.versions, original.versions),
    'APPLICATION_MPP_CONSOLE_IDENTITY_CHANGED');
  return {
    url: url.href,
    original: {
      schema: MPP_READY_SCHEMA, pid: ready.pid, ppid: ready.ppid,
      workspace: original.workspace, createdAt: original.createdAt, revision: original.revision,
      profiles: original.profiles, versions: identity.versions, tokenEnv: original.tokenEnv,
      runtime: original.runtime, terminalProcessStart: terminal.original.processStart,
    },
  };
}
