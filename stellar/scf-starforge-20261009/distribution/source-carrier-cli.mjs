#!/usr/bin/env node
// MIT. Durable source-carrier operations using the host's existing connected-tool adapter.
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  SOURCE_CARRIER_LIMITS, sourceCarrierTextInfo, prepareSourceCarrier,
  createSourceCarrierState, assertSourceCarrierPlan, assertSourceCarrierState,
  receiveSourceCarrierAuthorities, publishSourceCarrier, attachSourceCarrier,
  finalizeSourceCarrierIndex, adoptSourceCarrierOutcome, publishSourceCarrierIndex,
} from './source-carrier-producer.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = (message, code = 'SOURCE_CARRIER_INPUT') => { throw Object.assign(new Error(message), { code }); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const maxPrivateBytes = 64 * 1024 * 1024;
const local = (base, value) => {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail('Supply the original local file path.');
  return isAbsolute(value) ? value : resolve(base, value);
};
const help = String.raw`Retain a complete public Git source through the existing GitHub/Notion adapters.

source-carrier prepare --directory DIR --input INPUT.json [--adapter EXISTING.mjs]
source-carrier status --directory DIR
source-carrier publish --directory DIR --adapter EXISTING.mjs
source-carrier attach --directory DIR --adapter EXISTING.mjs
source-carrier index --directory DIR [--output INDEX.json]
source-carrier publish-index --directory DIR --adapter EXISTING.mjs
source-carrier adopt-outcome --directory DIR --key ORIGINAL_KEY --receipt RESULT.json

prepare receives exact commit/tree text from existing local files or the existing
read-only Git adapter. A retainedStateFile adopts an existing v1 transfer.
publish advances the original Git objects, source branches and archive uploads.
attach appends the already uploaded parts to the original destination page.
index writes the exact v1 receiving index. publish-index also retains that small
complete file on the original page, using its own persisted provider operations.
adopt-outcome records the actual response of an uncertain original call.

Node 22.16 or newer supplies the process-lifetime SQLite operation lock.
Keep DIR private; it retains complete original provider responses and upload IDs.
See SOURCE_CARRIERS.md and source-carrier-input.schema.json for the full contract.
`;

function options(args) {
  const [command = 'help', ...values] = args;
  const allowed = {
    prepare: ['--directory', '--input', '--adapter'],
    status: ['--directory'],
    publish: ['--directory', '--adapter'],
    attach: ['--directory', '--adapter'],
    index: ['--directory', '--output'],
    'publish-index': ['--directory', '--adapter'],
    'adopt-outcome': ['--directory', '--key', '--receipt'],
  };
  if (['help', '--help', '-h'].includes(command)) return { command: 'help' };
  if (!allowed[command]) fail('Unknown source-carrier command: ' + command);
  const result = { command };
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i], value = values[i + 1];
    if (!allowed[command].includes(key) || Object.hasOwn(result, key) || !value || value.startsWith('--'))
      fail('Invalid or repeated source-carrier option: ' + key);
    result[key] = value;
  }
  if (!result['--directory']) fail('Use the original --directory.');
  for (const key of command === 'prepare' ? ['--input'] :
    ['publish', 'attach', 'publish-index'].includes(command) ? ['--adapter'] :
    command === 'adopt-outcome' ? ['--key', '--receipt'] : []) {
    if (!result[key]) fail('Required option: ' + key);
  }
  return result;
}

async function readText(path, maximum = maxPrivateBytes, optional = false) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) fail('Expected a bounded original regular file: ' + path);
    const bytes = await handle.readFile();
    if (bytes.length > maximum) fail('Original file exceeds its retained limit: ' + path);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const directory = await open(path, constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}
/** Own unique same-directory temporary; a reused PID cannot strand publication. */
async function atomicText(path, text, { immutable = false } = {}) {
  const before = await readText(path, maxPrivateBytes, true);
  if (before !== null && (immutable || before === text)) {
    if (before !== text) fail('The retained original file differs: ' + path, 'SOURCE_CARRIER_RETAINED_CHANGED');
    return;
  }
  const temporary = resolve(dirname(path), '.' + path.split(/[\\/]/).at(-1) + '.pending.' + randomUUID());
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    if (immutable) {
      try { await link(temporary, path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const retained = await readText(path, maxPrivateBytes);
        if (retained !== text) fail('The retained original file differs: ' + path, 'SOURCE_CARRIER_RETAINED_CHANGED');
      }
    } else await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function optionalJson(path) {
  const value = await readText(path, maxPrivateBytes, true);
  return value === null ? null : JSON.parse(value);
}

async function withOperationLock(root, action) {
  const lockPath = resolve(root, 'operation-lock.sqlite3');
  const before = await lstat(lockPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (before && (!before.isFile() || before.isSymbolicLink())) fail('Original operation lock must be a regular file.');
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(lockPath);
  let held = false;
  try {
    database.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS original_operation (id INTEGER PRIMARY KEY CHECK(id=1), instance TEXT NOT NULL);');
    try {
      database.exec('BEGIN IMMEDIATE'); held = true;
      database.prepare('INSERT INTO original_operation(id, instance) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET instance=excluded.instance').run(randomUUID());
    } catch (error) {
      fail('Another process owns this original source-carrier operation: ' + error.message, 'SOURCE_CARRIER_BUSY');
    }
    return await action();
  } finally {
    try { if (held) database.exec('ROLLBACK'); } finally { database.close(); }
  }
}

function validateInput(input) {
  const keys = ['schema', 'operationId', 'repository', 'commit', 'pageId', 'branchPrefix',
    'filenamePrefix', 'maxSourceBytes', 'commitFile', 'treeFile', 'attributeFiles', 'retainedStateFile'];
  if (!plain(input) || input.schema !== 'stellar-forge.git-source-carrier-input.v1' ||
    Object.keys(input).some(key => !keys.includes(key)) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/.test(input.operationId ?? '') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository ?? '') ||
    !/^[0-9a-f]{40}$/.test(input.commit ?? '')) fail('Use the complete source-carrier input contract.');
  if (!!input.commitFile !== !!input.treeFile) fail('Provide both original authority files, or receive both through the existing Git adapter.');
  if (input.attributeFiles !== undefined && !input.commitFile) fail('Local archive-attribute files accompany both captured authority files.');
  if (input.attributeFiles !== undefined && !plain(input.attributeFiles)) fail('attributeFiles maps original Git paths to local UTF-8 files.');
  if (input.retainedStateFile !== undefined && typeof input.retainedStateFile !== 'string') fail('Use the original retained state file.');
  return input;
}

async function adapterAt(path) {
  const filename = await realpath(resolve(path));
  const source = await readText(filename, 2 * 1024 * 1024);
  const module = await import(pathToFileURL(filename).href);
  const tools = module.tools ?? module.default;
  if (!tools || typeof tools !== 'object') fail('The existing adapter must export tools (or its default tools object).');
  return { tools, close: typeof module.close === 'function' ? () => module.close() : async () => {},
    descriptor: { path: filename, ...sourceCarrierTextInfo(source) } };
}

async function prepare(root, inputPath, adapterPath) {
  const inputFilename = await realpath(resolve(inputPath));
  const inputText = await readText(inputFilename, 256 * 1024);
  const input = validateInput(JSON.parse(inputText)), inputRoot = dirname(inputFilename);
  // Freeze the original invocation input before any source read; replay keeps every byte.
  await atomicText(resolve(root, 'input.json'), inputText, { immutable: true });
  const existingCommit = await readText(resolve(root, 'SOURCE-COMMIT.json'), SOURCE_CARRIER_LIMITS.metadataBytes, true);
  const existingTree = await readText(resolve(root, 'SOURCE-TREE.json'), SOURCE_CARRIER_LIMITS.metadataBytes, true);
  const existingAttributes = await optionalJson(resolve(root, 'archive-attributes.json'));
  let commitJson, treeJson, attributeFiles, adapter;
  try {
    if (existingCommit !== null && existingTree !== null && existingAttributes !== null) {
      commitJson = existingCommit; treeJson = existingTree; attributeFiles = existingAttributes;
    } else if (input.commitFile) {
      commitJson = await readText(local(inputRoot, input.commitFile), SOURCE_CARRIER_LIMITS.metadataBytes);
      treeJson = await readText(local(inputRoot, input.treeFile), SOURCE_CARRIER_LIMITS.metadataBytes);
      attributeFiles = Object.create(null);
      for (const [gitPath, path] of Object.entries(input.attributeFiles ?? {}))
        Object.defineProperty(attributeFiles, gitPath, { value: await readText(local(inputRoot, path), SOURCE_CARRIER_LIMITS.fileBytes), enumerable: true });
    } else {
      if (!adapterPath) fail('Use --adapter for the original read-only source receiving, or provide the captured authority files.');
      adapter = await adapterAt(adapterPath);
      ({ commitJson, treeJson, attributeFiles } = await receiveSourceCarrierAuthorities({
        repository: input.repository, commit: input.commit, tools: adapter.tools }));
    }
    const plan = prepareSourceCarrier({ repository: input.repository, commitJson, treeJson,
      branchPrefix: input.branchPrefix, filenamePrefix: input.filenamePrefix,
      maxSourceBytes: input.maxSourceBytes, attributeFiles });
    if (plan.source.commit !== input.commit) fail('The original authority commit differs from the selected input.');
    await atomicText(resolve(root, 'SOURCE-COMMIT.json'), commitJson, { immutable: true });
    await atomicText(resolve(root, 'SOURCE-TREE.json'), treeJson, { immutable: true });
    await atomicText(resolve(root, 'archive-attributes.json'), json(attributeFiles), { immutable: true });
    await atomicText(resolve(root, 'plan.json'), json(plan), { immutable: true });
    let state = await optionalJson(resolve(root, 'state.json'));
    if (state === null) {
      if (input.retainedStateFile) {
        const retained = await readText(local(inputRoot, input.retainedStateFile));
        state = JSON.parse(retained); assertSourceCarrierState(plan, state);
        if (state.operationId && state.operationId !== input.operationId) fail('Resume the original retained operation identity.');
        if (input.pageId && state.pageId?.replaceAll('-', '').toLowerCase() !== input.pageId.replaceAll('-', '').toLowerCase())
          fail('The original retained destination differs.');
        await atomicText(resolve(root, 'received-state.json'), retained, { immutable: true });
      } else state = createSourceCarrierState(plan, { operationId: input.operationId, pageId: input.pageId });
      await atomicText(resolve(root, 'state.json'), json(state), { immutable: true });
    }
    assertSourceCarrierState(plan, state);
    const prior = await optionalJson(resolve(root, 'operation.json'));
    const basis = { schema: 'stellar-forge.git-source-carrier-operation.v1',
      operationId: input.operationId, source: plan.source,
      input: { path: 'input.json', ...sourceCarrierTextInfo(inputText) },
      plan: { path: 'plan.json', ...sourceCarrierTextInfo(json(plan)) },
      authorityFiles: plan.authorities,
      archiveAttributes: { path: 'archive-attributes.json', ...sourceCarrierTextInfo(json(attributeFiles)) } };
    if (prior && !same(Object.fromEntries(Object.keys(basis).map(key => [key, prior[key]])), basis))
      fail('Original source-carrier operation basis differs.');
    const operation = prior ?? { ...basis, createdAt: new Date().toISOString() };
    await atomicText(resolve(root, 'operation.json'), json(operation), { immutable: true });
    return summary(root, operation, plan, state);
  } finally { await adapter?.close(); }
}

async function openOperation(root) {
  const operation = await optionalJson(resolve(root, 'operation.json'));
  if (!operation) fail('Finish the original prepare command in this directory first.', 'SOURCE_CARRIER_PREPARATION_INCOMPLETE');
  if (operation.schema !== 'stellar-forge.git-source-carrier-operation.v1') fail('Original operation schema differs.');
  const inputText = await readText(resolve(root, 'input.json'), 256 * 1024);
  const input = validateInput(JSON.parse(inputText));
  if (!same(sourceCarrierTextInfo(inputText), { bytes: operation.input?.bytes, sha256: operation.input?.sha256 }))
    fail('The retained input differs.');
  const planText = await readText(resolve(root, 'plan.json'));
  const plan = JSON.parse(planText); assertSourceCarrierPlan(plan);
  if (!same(sourceCarrierTextInfo(planText), { bytes: operation.plan?.bytes, sha256: operation.plan?.sha256 }) ||
    !same(operation.source, plan.source) || input.operationId !== operation.operationId ||
    input.repository !== plan.source.repository || input.commit !== plan.source.commit)
    fail('The retained original plan binding differs.');
  const authorityText = Object.create(null);
  for (const authority of plan.authorities) {
    const text = await readText(resolve(root, authority.path), SOURCE_CARRIER_LIMITS.metadataBytes);
    if (!same(sourceCarrierTextInfo(text), { bytes: authority.bytes, sha256: authority.sha256 }))
      fail('Original source authority bytes differ: ' + authority.path);
    Object.defineProperty(authorityText, authority.path, { value: text, enumerable: true });
  }
  const attrsText = await readText(resolve(root, 'archive-attributes.json'));
  if (!same(sourceCarrierTextInfo(attrsText), { bytes: operation.archiveAttributes?.bytes, sha256: operation.archiveAttributes?.sha256 }))
    fail('The original archive-attribute input differs.');
  const reproduced = prepareSourceCarrier({ repository: input.repository,
    commitJson: authorityText['SOURCE-COMMIT.json'], treeJson: authorityText['SOURCE-TREE.json'],
    branchPrefix: input.branchPrefix, filenamePrefix: input.filenamePrefix,
    maxSourceBytes: input.maxSourceBytes, attributeFiles: JSON.parse(attrsText) });
  if (json(reproduced) !== planText) fail('The retained original source inventory differs.');
  const state = await optionalJson(resolve(root, 'state.json'));
  assertSourceCarrierState(plan, state);
  if (state.operationId && state.operationId !== operation.operationId) fail('Retained operation identity differs.');
  if (input.pageId && state.pageId?.replaceAll('-', '').toLowerCase() !== input.pageId.replaceAll('-', '').toLowerCase())
    fail('The retained original destination differs.');
  return { operation, plan, state, authorityText };
}

function summary(root, operation, plan, state) {
  const parts = plan.parts.map(part => {
    const saved = state.parts.find(value => value.part === part.part);
    return { part: part.part, kind: part.kind, filename: part.filename,
      sourceFiles: part.manifest.members.length,
      sourceBytes: part.manifest.members.reduce((total, row) => total + row.bytes, 0),
      carrierCommit: saved?.carrierCommit ?? null,
      stage: saved?.notionReference ? 'ATTACHED' : saved?.attachment ? 'UPLOADED' :
        saved?.branchReceipt ? 'SOURCE_RETAINED' : saved?.carrierCommit ? 'COMMIT_RETAINED' : 'PREPARED' };
  });
  const pending = Object.entries(state.operations).filter(([, value]) => value.status !== 'RETURNED' && !value.reconciliation)
    .map(([key, value]) => ({ key, name: value.name, status: value.status }));
  return { schema: 'stellar-forge.git-source-carrier-status.v1', directory: root,
    operationId: operation.operationId, source: plan.source,
    parts, attachedParts: parts.filter(part => part.stage === 'ATTACHED').length,
    pending, pageOperation: state.pageOperation ? { status: state.pageOperation.status, parts: state.pageOperation.parts } : null,
    indexPublication: state.indexPublication ? { filename: state.indexPublication.filename,
      bytes: state.indexPublication.bytes, sha256: state.indexPublication.sha256,
      stage: state.indexPublication.notionReference ? 'ATTACHED' : state.indexPublication.attachment ? 'UPLOADED' : 'PREPARED' } : null };
}

export async function main(args = process.argv.slice(2)) {
  const opt = options(args);
  if (opt.command === 'help') { console.log(help); return; }
  const requested = resolve(opt['--directory']);
  if (opt.command === 'prepare') await mkdir(requested, { recursive: true, mode: 0o700 });
  const root = await realpath(requested);
  const print = value => console.log(json(value).trimEnd());
  if (opt.command === 'status') {
    const { operation, plan, state } = await openOperation(root);
    return print(summary(root, operation, plan, state));
  }
  return withOperationLock(root, async () => {
    if (opt.command === 'prepare') return print(await prepare(root, opt['--input'], opt['--adapter']));
    const { operation, plan, state, authorityText } = await openOperation(root);
    const persist = next => atomicText(resolve(root, 'state.json'), json(next));
    if (opt.command === 'adopt-outcome') {
      const result = JSON.parse(await readText(resolve(opt['--receipt'])));
      await adoptSourceCarrierOutcome({ plan, state, key: opt['--key'], result, persist });
      return print(summary(root, operation, plan, state));
    }
    let adapter;
    try {
      if (opt['--adapter']) {
        adapter = await adapterAt(opt['--adapter']);
        state.adapters ??= [];
        if (!state.adapters.some(value => value.path === adapter.descriptor.path && value.sha256 === adapter.descriptor.sha256)) {
          state.adapters.push(adapter.descriptor); await persist(state);
        }
      }
      if (opt.command === 'publish')
        await publishSourceCarrier({ plan, state, authorityText, tools: adapter.tools, persist });
      if (opt.command === 'attach')
        await attachSourceCarrier({ plan, state, tools: adapter.tools, persist });
      if (opt.command === 'publish-index')
        await publishSourceCarrierIndex({ plan, state, tools: adapter.tools, persist });
      let indexFile = null;
      if (['index', 'attach', 'publish-index'].includes(opt.command) ||
        state.parts.length === plan.parts.length && state.parts.every(part => part.notionReference)) {
        const index = finalizeSourceCarrierIndex(plan, state);
        const content = json(index);
        indexFile = resolve(opt['--output'] ?? resolve(root, plan.filenamePrefix + '_TRANSFER.json'));
        await atomicText(indexFile, content, { immutable: true });
      }
      print({ ...summary(root, operation, plan, state), ...(indexFile ? {
        index: { path: indexFile, ...sourceCarrierTextInfo(await readText(indexFile)) } } : {}) });
    } finally { await adapter?.close(); }
  });
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false)) {
  main().catch(error => {
    console.error(JSON.stringify({ error: error.code ?? 'SOURCE_CARRIER_FAILED', message: error.message }));
    process.exitCode = 1;
  });
}
