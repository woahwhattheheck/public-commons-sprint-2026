// MIT. Source authoring over the original SheetBest capture and publication engines.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { lstat, chmod, rename, readdir } from 'node:fs/promises';
import { object, bytes, digest, identity, fault, stamp, absolute, privateDirectory, readPrivate,
  readJson, createFile, atomicJson, syncDirectory, acquireWorkspace } from '../../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, only, compileQueries, binding } from '../declaration.mjs';
import { readSheetBestCapture, bindSheetBestCapture, retainSheetBestCapture, fetchSheetBestRecords } from '../capture.mjs';
import { projectionOrders, initialOrders } from './projection.mjs';
import { openSheetBestSourceFile, inspectSheetBestSource } from '../source.mjs';
import { openSheetBestPublisher } from '../publisher/model.mjs';
import { startPostgresPublisherServer } from '../../postgres/publisher/server.mjs';
import { reviewSheetBestDeployment, prepareSheetBestDeployment, inspectSheetBestDeployment, stageSheetBestDeployment, readSheetBestDeploymentFile } from './deployment.mjs';
import { inspectSheetBestAuthoring } from './launch.mjs';
import { normalizeConnections, selectConnection, connectionViews } from './provider.mjs';
import { MAX_PACKET_BYTES, makeSheetBestSourcePacket, validatePacket, retainPacket, packetFromCapture, createOrVerify } from './packet.mjs';

const SCHEMA = 'stellar-forge.sheetbest-authoring.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const decode = value => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw fault('SHEETBEST_RESOURCE_JSON_INVALID'); } };
const absent = async path => { try { await lstat(path); return false; } catch (issue) { if (issue.code === 'ENOENT') return true; throw issue; } };
const id = value => { if (typeof value !== 'string' || !UUID.test(value)) throw fault('REQUEST_ID_REQUIRED', 'Use one UUID for this operation and its recovery.'); return value; };
const text = (value, label, maximum = 128) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw fault('SHEETBEST_TEXT_REQUIRED', 'Enter a valid ' + label + '.');
  return value.trim();
};
const integer = (value, label) => { if (!Number.isSafeInteger(value) || value < 0) throw fault('SHEETBEST_REVISION_REQUIRED', label); return value; };
const privateFault = issue => ({ code: typeof issue.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(issue.code) ? issue.code : 'SHEETBEST_AUTHORING_FAILED',
  message: issue.code && typeof issue.message === 'string' ? issue.message : 'Inspect the retained operation and selected input.',
  status: [400,403,404,409,413,422,502].includes(issue.status) ? issue.status : 422,
  ...(issue.providerStatus ? { providerStatus: issue.providerStatus } : {}),
  ...(issue.retryAfter ? { retryAfter: issue.retryAfter } : {}),
  ...(issue.requestId ? { providerRequestId: issue.requestId } : {}) });

function sourceConfig(capture, draft, { allowEmpty = false } = {}) {
  const config = { schema: 'stellar-forge.sheetbest-source.v1', ...binding(capture.manifest),
    connection: { kind: 'capture', file: capture.manifestFile, sha256: capture.manifestSha256 },
    queries: structuredClone(draft.queries) };
  projectionOrders(config.queries, draft.orders, { allowEmpty });
  bindSheetBestCapture(capture, config);
  return config;
}
function displayNative(value) {
  if (value === undefined) return { kind: 'missing', value: null };
  if (value === null) return { kind: 'null', value: null };
  if (typeof value === 'string') return { kind: 'string', value: value.slice(0, 240), truncated: value.length > 240 };
  return { kind: typeof value, value };
}
export async function openSheetBestAuthoring({ directory, create = false, connections = {}, environment = process.env,
  targetDirectory, seller = null, resource = null, expectedIdentity } = {}) {
  absolute(directory); connections = normalizeConnections(connections);
  const directoryExisted = !await absent(directory);
  if (create && directoryExisted && await absent(join(directory, 'INIT.json')))
    throw fault('SHEETBEST_AUTHORING_EXISTS', 'Reopen the existing source workspace; this directory has no matching initialization receipt.');
  await privateDirectory(directory, create);
  const release = await acquireWorkspace(directory);
  let db, publisherService = null, deploymentService = null, pending = null, closed = false, closing;
  const deploymentDirectory = join(directory, 'deployments'), releaseDirectory = join(deploymentDirectory, 'releases');
  const lifetime = new AbortController();
  let publisherAccess = Promise.resolve();
  try {
    if (expectedIdentity !== undefined) {
      if (create) throw fault('SHEETBEST_MANAGED_EXISTING_WORKSPACE_REQUIRED');
      await inspectSheetBestAuthoring(directory, { expectedIdentity });
    }
    let initialization = null;
    if (create) {
      targetDirectory ??= join(directory, 'dataset'); absolute(targetDirectory, 'dataset directory');
      if (targetDirectory !== join(directory, 'dataset') && (targetDirectory === directory ||
          targetDirectory.startsWith(directory + '/') || directory.startsWith(targetDirectory + '/')))
        throw fault('SHEETBEST_TARGET_DIRECTORY_INVALID');
      const file = join(directory, 'INIT.json'), intent = { schema: SCHEMA, directory, targetDirectory };
      if (await absent(file)) await createOrVerify(file, bytes({ ...intent, createdAt: stamp() }));
      initialization = await readJson(file);
      if (initialization.schema !== intent.schema || initialization.directory !== directory ||
          initialization.targetDirectory !== targetDirectory || typeof initialization.createdAt !== 'string')
        throw fault('SHEETBEST_INITIALIZATION_CHANGED', 'Resume initialization with its original directory and dataset binding.', 409);
    }
    const database = join(directory, 'sources.sqlite');
    if (!create && await absent(database)) throw fault('SHEETBEST_AUTHORING_MISSING');
    if (!await absent(database)) {
      const stat = await lstat(database);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.nlink !== 1) throw fault('PRIVATE_DATABASE_REQUIRED');
    }
    db = new DatabaseSync(database); await chmod(database, 0o600);
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload_hash TEXT NOT NULL,
        input TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,result TEXT,error TEXT);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,operation TEXT,data TEXT NOT NULL);`);
    const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (issue) { try { db.exec('ROLLBACK'); } catch {} throw issue; } };
    if (create && !db.prepare('SELECT id FROM settings WHERE id=1').get()) {
      transaction(() => {
        db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({ schema: SCHEMA, createdAt: initialization.createdAt,
          targetDirectory, publisherDirectory: join(directory, 'publisher'), sourceFile: join(directory, 'current-source.json') }));
        db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify({ draft: null, draftRevision: 0, selectedVersion: null, selectionRevision: 0 }));
      });
      for (const name of ['inputs', 'captures', 'previews', 'versions', 'interrupted']) await privateDirectory(join(directory, name), true);
      await syncDirectory(directory);
    }
    const settings = JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get()?.data ?? 'null');
    if (settings?.schema !== SCHEMA || settings.sourceFile !== join(directory, 'current-source.json') ||
        settings.publisherDirectory !== join(directory, 'publisher') || targetDirectory && targetDirectory !== settings.targetDirectory)
      throw fault('SHEETBEST_AUTHORING_BINDING_CHANGED');
    for (const name of ['inputs', 'captures', 'previews', 'versions', 'interrupted']) await privateDirectory(join(directory, name), true);
    const current = () => JSON.parse(db.prepare('SELECT data FROM state WHERE id=1').get().data);
    const setState = value => db.prepare('UPDATE state SET data=? WHERE id=1').run(JSON.stringify(value));
    const event = (kind, request, data = {}) => db.prepare('INSERT INTO events(created,kind,operation,data) VALUES(?,?,?,?)')
      .run(stamp(), kind, request, JSON.stringify(data));
    const operation = request => {
      const row = db.prepare('SELECT * FROM operations WHERE id=?').get(id(request));
      if (!row) return null;
      return { id: row.id, kind: row.kind, status: row.status, createdAt: row.created, updatedAt: row.updated,
        result: row.result ? JSON.parse(row.result) : null, error: row.error ? JSON.parse(row.error) : null };
    };
    const captureRecord = request => {
      const row = db.prepare('SELECT data FROM captures WHERE id=?').get(id(request));
      if (!row) throw fault('SHEETBEST_CAPTURE_NOT_FOUND', 'Choose a retained observation.', 404);
      return JSON.parse(row.data);
    };
    const capture = async request => {
      const row = captureRecord(request);
      const result = await readSheetBestCapture(join(directory, 'captures', row.id, 'capture.json'), row.manifestSha256);
      if (identity(binding(result.manifest)) !== row.selectionSha256 || result.manifest.rowCount !== row.rowCount || result.manifest.sourceSha256 !== row.sourceSha256)
        throw fault('SHEETBEST_CAPTURE_RESOURCE_CHANGED');
      return result;
    };
    const version = number => {
      integer(number, 'Choose a saved source version.');
      const row = db.prepare('SELECT * FROM versions WHERE id=?').get(number);
      if (!row) throw fault('SHEETBEST_VERSION_NOT_FOUND', 'Choose a saved source version.', 404);
      return { id: row.id, requestId: row.request_id, ...JSON.parse(row.data) };
    };
    const versionConfig = async row => {
      const content = await readPrivate(join(directory, 'versions', row.requestId, 'source.json'));
      if (digest(content) !== row.sourceSha256) throw fault('SHEETBEST_SAVED_SOURCE_CHANGED');
      return decode(content);
    };
    const assertOpen = () => { if (closed || closing) throw fault('SHEETBEST_AUTHORING_CLOSED'); };
    const start = (kind, input, request) => {
      assertOpen(); id(request); const hash = identity(input);
      const old = db.prepare('SELECT * FROM operations WHERE id=?').get(request);
      if (old) {
        if (old.kind !== kind || old.payload_hash !== hash) throw fault('SHEETBEST_REQUEST_REUSED', 'This request ID belongs to different input.', 409);
        if (old.status === 'complete') return { done: true, value: JSON.parse(old.result) };
        if (old.status === 'failed') { const issue = JSON.parse(old.error); throw fault(issue.code, issue.message, issue.status); }
        throw fault('SHEETBEST_OPERATION_RETAINED', 'Inspect or resume the original retained operation.', 409);
      }
      if (pending) throw fault('SHEETBEST_AUTHORING_BUSY', 'The current source operation is still running.', 409);
      const time = stamp();
      transaction(() => {
        db.prepare('INSERT INTO operations(id,kind,payload_hash,input,status,created,updated) VALUES(?,?,?,?,?,?,?)')
          .run(request, kind, hash, JSON.stringify(input), 'pending', time, time);
        event('STARTED', request, { kind });
      });
      return { done: false };
    };
    const complete = (request, result) => {
      db.prepare('UPDATE operations SET status=?,updated=?,result=?,error=NULL WHERE id=?')
        .run('complete', stamp(), JSON.stringify(result), request);
      event('COMPLETED', request);
      return result;
    };
    const run = async (kind, input, request, fn, resume = false) => {
      if (!resume) { const opened = start(kind, input, request); if (opened.done) return opened.value; }
      else { assertOpen(); if (pending) throw fault('SHEETBEST_AUTHORING_BUSY', 'Wait for the active operation.', 409); }
      const active = { id: request, kind, completion: null }; pending = active;
      active.completion = Promise.resolve().then(fn).then(result => transaction(() => complete(request, result))).catch(issue => {
        const error = privateFault(issue);
        const interrupted = !/^(SHEETBEST_|DATASET_|PRIVATE_|SOURCE_|QUERY_|INVALID_|ABSOLUTE_)/.test(issue.code ?? '') ||
          ['SHEETBEST_CAPTURE_CANCELLED','SHEETBEST_PROVIDER_UNREACHABLE','SHEETBEST_RESPONSE_INTERRUPTED','SHEETBEST_CAPTURE_TIMEOUT','SHEETBEST_PROVIDER_TIMEOUT'].includes(issue.code);
        try { transaction(() => {
          db.prepare('UPDATE operations SET status=?,updated=?,error=? WHERE id=?')
            .run(interrupted ? 'interrupted' : 'failed', stamp(), JSON.stringify(error), request);
          event(interrupted ? 'INTERRUPTED' : 'FAILED', request, { code: error.code });
        }); } catch { /* The pending durable operation is reconciled on reopen. */ }
        throw fault(error.code, error.message, error.status);
      }).finally(() => { if (pending === active) pending = null; });
      return active.completion;
    };

    async function installSelection(row, expectedVersion) {
      const state = current();
      if (state.selectedVersion !== expectedVersion && state.selectedVersion !== row.id)
        throw fault('SHEETBEST_SELECTION_CHANGED', 'Refresh the selected source before changing it.', 409);
      const config = await versionConfig(row);
      if (!await absent(settings.sourceFile)) {
        const existing = digest(await readPrivate(settings.sourceFile));
        const prior = state.selectedVersion === null ? null : version(state.selectedVersion).sourceSha256;
        if (existing !== prior && existing !== row.sourceSha256) throw fault('SHEETBEST_SELECTED_SOURCE_CHANGED',
          'The managed source file changed outside this workspace. Preserve it and restore the selected original source before continuing.', 409);
      } else if (state.selectedVersion !== null) throw fault('SHEETBEST_SELECTED_SOURCE_MISSING');
      if (await absent(settings.sourceFile) || digest(await readPrivate(settings.sourceFile)) !== row.sourceSha256)
        await atomicJson(directory, 'current-source.json', config);
      transaction(() => { const next = current(); if (next.selectedVersion !== row.id) {
        next.selectedVersion = row.id; next.selectionRevision++; setState(next); }
      });
      return { version: row, selectedVersion: row.id, sourceFile: settings.sourceFile, sourceSha256: row.sourceSha256 };
    }



    async function retainInput(request, content) {
      const file = join(directory, 'inputs', request + '.json');
      await createOrVerify(file, content); return file;
    }
    async function finishCapture(request, input, retained) {
      bindSheetBestCapture(retained, input.config);
      const target = join(directory, 'captures', request);
      if (retained.manifestFile !== join(target, 'capture.json')) {
        if (!await absent(target)) {
          const original = await readSheetBestCapture(join(target, 'capture.json'), retained.manifestSha256);
          bindSheetBestCapture(original, input.config); retained = original;
        } else {
          await rename(dirname(retained.manifestFile), target); await syncDirectory(dirname(target));
          retained = await readSheetBestCapture(join(target, 'capture.json'), retained.manifestSha256);
        }
      }
      const draft = { captureId: request, title: input.title, queries: structuredClone(input.config.queries),
        orders: projectionOrders(input.config.queries, input.orders, { allowEmpty: true }) };
      sourceConfig(retained, draft, { allowEmpty: true });
      return transaction(() => {
        const prior = db.prepare('SELECT data FROM captures WHERE id=?').get(request);
        if (prior) {
          const record = JSON.parse(prior.data);
          if (record.manifestSha256 !== retained.manifestSha256 || identity(record.draft) !== identity(draft))
            throw fault('SHEETBEST_CAPTURE_RECORD_CHANGED');
          return { capture: record, ...record.adoption };
        }
        const state = current(), draftSaved = state.draftRevision === input.expectedDraftRevision;
        if (draftSaved) { state.draft = draft; state.draftRevision++; setState(state); }
        const record = { id: request, title: input.title,
          createdAt: retained.manifest.receivedAt, selection: binding(retained.manifest),
          selectionSha256: identity(binding(retained.manifest)),
          manifestSha256: retained.manifestSha256, sourceSha256: retained.manifest.sourceSha256,
          sourceBytes: retained.manifest.sourceBytes, rowCount: retained.manifest.rowCount,
          receivedAt: retained.manifest.receivedAt, responseKind: retained.manifest.responseKind,
          transport: retained.manifest.transport, imported: input.packetSha256 !== undefined,
          origin: input.origin ?? null, draft, adoption: { draftSaved, draftRevision: state.draftRevision } };
        db.prepare('INSERT INTO captures VALUES(?,?)').run(request, JSON.stringify(record));
        event('CAPTURE_RETAINED', request, { manifestSha256: record.manifestSha256, draftSaved });
        return { capture: record, ...record.adoption };
      });
    }
    async function performImport(input, request, packet) {
      packet ??= decode(await readPrivate(join(directory, 'inputs', request + '.json'), MAX_PACKET_BYTES));
      if (digest(bytes(packet)) !== input.packetSha256) throw fault('SHEETBEST_RETAINED_INPUT_CHANGED');
      const checked = validatePacket(packet);
      if (identity(checked.source) !== identity(input.config) || identity(checked.orders) !== identity(input.orders)) throw fault('SHEETBEST_RETAINED_INPUT_CHANGED');
      await retainInput(request, bytes(packet));
      const target = join(directory, 'captures', request);
      const retained = !await absent(target) ? await readSheetBestCapture(join(target, 'capture.json'), checked.manifestSha256) :
        await retainPacket(packet, join(directory, 'captures', '.pending-' + request));
      return finishCapture(request, input, retained);
    }
    async function importPacket({ packet, title, expectedDraftRevision, requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_PACKET_INPUT_INVALID');
      const checked = validatePacket(packet);
      const input = { title: text(title, 'capture title'), expectedDraftRevision: integer(expectedDraftRevision, 'Use the current draft revision.'),
        packetSha256: digest(bytes(packet)), config: checked.source, orders: checked.orders, origin: packet.origin ?? null };
      return run('IMPORT', input, requestId, () => performImport(input, requestId, packet));
    }
    async function importSource({ sourceFile, title, orders, expectedDraftRevision, requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_SOURCE_IMPORT_INVALID');
      absolute(sourceFile, 'original frozen source file');
      // Host/CLI-only input. The browser can import a complete portable packet,
      // but cannot name an arbitrary local file or token environment.
      const packet = await makeSheetBestSourcePacket(sourceFile, { orders });
      return importPacket({ packet, title, expectedDraftRevision, requestId });
    }
    async function performCapture(input, request, allowProvider) {
      const target = join(directory, 'captures', request), staging = join(directory, 'captures', '.pending-' + request);
      if (!await absent(join(target, 'capture.json')))
        return finishCapture(request, input, await readSheetBestCapture(join(target, 'capture.json')));
      const rawFile = join(directory, 'inputs', request + '.records.json');
      const receiptFile = join(directory, 'inputs', request + '.response.json');
      let receipt, resourceBytes;
      if (!await absent(receiptFile)) {
        receipt = await readJson(receiptFile, 32768); resourceBytes = await readPrivate(rawFile, MAX_CAPTURE_BYTES);
        if (receipt.bytes !== resourceBytes.length || receipt.sha256 !== digest(resourceBytes) ||
            identity(binding(receipt.response)) !== identity(binding(input.config)))
          throw fault('SHEETBEST_READ_RECEIPT_CHANGED');
      } else {
        if (!allowProvider || !await absent(rawFile))
          throw fault('SHEETBEST_READ_RECEIPT_NOT_RETAINED',
            'The original provider response receipt is not retained. These bytes remain private. Make a new explicit observation; recovery does not repeat the unknown GET.', 409);
        await retainInput(request, bytes(input.config));
        const received = await fetchSheetBestRecords(input.config, { env: environment, signal: lifetime.signal });
        const { resourceBytes: original, ...response } = received;
        resourceBytes = original;
        await createOrVerify(rawFile, resourceBytes, MAX_CAPTURE_BYTES);
        receipt = { schema: 'stellar-forge.sheetbest-authoring-response.v1', bytes: resourceBytes.length,
          sha256: digest(resourceBytes), response };
        await createOrVerify(receiptFile, bytes(receipt), 32768);
      }
      let retained;
      if (!await absent(join(staging, 'capture.json'))) {
        retained = await readSheetBestCapture(join(staging, 'capture.json'));
        if (retained.manifest.sourceSha256 !== receipt.sha256 ||
            retained.manifest.receivedAt !== receipt.response.receivedAt)
          throw fault('SHEETBEST_CAPTURE_RESOURCE_CHANGED');
      } else {
        if (!await absent(staging)) {
          await privateDirectory(staging);
          await rename(staging, join(directory, 'interrupted', request + '-' + randomUUID()));
          await syncDirectory(join(directory, 'interrupted')); await syncDirectory(dirname(staging));
        }
        // Rebuilding an interrupted retention uses the exact saved response and
        // timestamp, never another provider request.
        retained = await retainSheetBestCapture(resourceBytes, staging, receipt.response);
      }
      return finishCapture(request, input, retained);
    }
    async function readLive({ connectionAlias, title, expectedDraftRevision, requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_CAPTURE_INPUT_INVALID');
      const config = selectConnection(connections, connectionAlias);
      const input = { config, orders: {}, connectionAlias, title: text(title, 'capture title'),
        expectedDraftRevision: integer(expectedDraftRevision, 'Use the current draft revision.') };
      return run('CAPTURE', input, requestId, () => performCapture(input, requestId, true));
    }
    async function inspectCapture(request) {
      const retained = await capture(request), rows = retained.records;
      const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
      const fields = keys.map(name => {
        const counts = { number: 0, string: 0, boolean: 0, null: 0, missing: 0, emptyString: 0,
          unsafeInteger: 0, nonInteger: 0 };
        const samples = [];
        for (const row of rows) {
          const value = Object.hasOwn(row, name) ? row[name] : undefined;
          if (value === undefined) counts.missing++;
          else if (value === null) counts.null++;
          else {
            counts[typeof value]++;
            if (value === '') counts.emptyString++;
            if (typeof value === 'number') {
              if (Number.isInteger(value) && !Number.isSafeInteger(value)) counts.unsafeInteger++;
              if (!Number.isInteger(value)) counts.nonInteger++;
            }
          }
          if (samples.length < 5) samples.push(displayNative(value));
        }
        return { id: name, title: name, counts, samples };
      });
      return { capture: captureRecord(request), fields, manifest: retained.manifest,
        projectionRule: 'Only explicitly selected fields become public query columns. Missing fields always fail the original extractor, including nullable fields.',
        valueRule: retained.manifest.valueMode === 'strings'
          ? 'Original strings remain strings unless the operator explicitly selects a canonical numeric or boolean conversion.'
          : 'Raw mode retains the original scalar types; unsafe integers cannot become numeric public values.' };
    }
    async function normalizeDraft(input) {
      only(input, ['captureId','title','queries','orders'], 'SHEETBEST_DRAFT_INVALID');
      const retained = await capture(input.captureId);
      const draft = { captureId: input.captureId, title: text(input.title, 'source title'), queries: structuredClone(input.queries),
        orders: projectionOrders(input.queries, input.orders) };
      sourceConfig(retained, draft); return draft;
    }
    async function saveDraft({ draft, expectedRevision, requestId }) {
      integer(expectedRevision, 'Use the current draft revision.');
      const normalized = await normalizeDraft(draft);
      return run('DRAFT', { draft: normalized, expectedRevision }, requestId, () => transaction(() => {
        const state = current();
        if (state.draftRevision !== expectedRevision)
          throw fault('SHEETBEST_DRAFT_CHANGED', 'Another window saved this draft. Reload before saving your edit.', 409);
        state.draft = normalized; state.draftRevision++; setState(state);
        return { draft: state.draft, draftRevision: state.draftRevision };
      }));
    }
    async function performPreview(input, request) {
      const existing = db.prepare('SELECT data FROM previews WHERE id=?').get(request);
      if (existing) return JSON.parse(existing.data);
      const state = current();
      if (!state.draft || state.draftRevision !== input.draftRevision)
        throw fault('SHEETBEST_DRAFT_CHANGED', 'Save and preview the current draft before retaining a version.', 409);
      const original = await capture(state.draft.captureId), config = sourceConfig(original, state.draft);
      const folder = join(directory, 'previews', request); await privateDirectory(folder, true);
      const file = join(folder, 'source.json'); await createOrVerify(file, bytes(config));
      const reader = await openSheetBestSourceFile(file), reports = {};
      try {
        for (const [name, query] of Object.entries(config.queries)) {
          const sample = [];
          const report = await reader.source.exportDataset(name, {}, {
            order: state.draft.orders[name],
            maxRows: 1000000, maxBytes: MAX_CAPTURE_BYTES, maxRowBytes: 1048576, timeoutMs: 300000,
            signal: lifetime.signal, onRow(row) { if (sample.length < 25) sample.push(row); },
          });
          reports[name] = { report, sample, sampleLimit: 25 };
        }
      } finally { await reader.source.close(); }
      const result = { id: request, draftRevision: input.draftRevision, draftSha256: identity(state.draft),
        captureId: state.draft.captureId, sourceSha256: digest(bytes(config)), createdAt: stamp(),
        reports, complete: true, allRowsChecked: true, providerRead: false, mode: 'capture' };
      transaction(() => db.prepare('INSERT INTO previews VALUES(?,?)').run(request, JSON.stringify(result)));
      return result;
    }
    async function preview({ draftRevision, requestId }) {
      integer(draftRevision, 'Use the saved draft revision.');
      return run('PREVIEW', { draftRevision }, requestId, () => performPreview({ draftRevision }, requestId));
    }
    async function performVersion(input, request) {
      const prior = db.prepare('SELECT id FROM versions WHERE request_id=?').get(request);
      if (prior) return installSelection(version(prior.id), input.expectedSelectedVersion);
      const state = current(), reviewed = JSON.parse(db.prepare('SELECT data FROM previews WHERE id=?').get(input.previewId)?.data ?? 'null');
      if (!state.draft || state.draftRevision !== input.draftRevision || !reviewed ||
          reviewed.draftRevision !== input.draftRevision || reviewed.draftSha256 !== identity(state.draft))
        throw fault('SHEETBEST_PREVIEW_CHANGED', 'Preview the exact current saved draft before retaining a source version.', 409);
      if (state.selectedVersion !== input.expectedSelectedVersion)
        throw fault('SHEETBEST_SELECTION_CHANGED', 'Reload the currently selected source.', 409);
      const original = await capture(state.draft.captureId), config = sourceConfig(original, state.draft);
      const folder = join(directory, 'versions', request); await privateDirectory(folder, true);
      const file = join(folder, 'source.json'), content = bytes(config); await createOrVerify(file, content);
      await inspectSheetBestSource(file); await syncDirectory(folder);
      const record = { title: state.draft.title, createdAt: stamp(), reviewer: input.reviewer, note: input.note,
        draft: state.draft, draftRevision: input.draftRevision, previewId: input.previewId,
        sourceSha256: digest(content), sourceBytes: content.length, sourceFile: file,
        captureId: state.draft.captureId, observationSha256: original.manifestSha256,
        selectionSha256: identity(binding(original.manifest)),
        mode: 'capture', rowCount: original.manifest.rowCount,
        queries: Object.fromEntries(Object.entries(config.queries).map(([name, query]) => [name, Object.keys(query.columns)])),
        columns: [...new Set(Object.values(config.queries).flatMap(query => Object.keys(query.columns)))] };
      const number = transaction(() => Number(db.prepare('INSERT INTO versions(request_id,data) VALUES(?,?)').run(request, JSON.stringify(record)).lastInsertRowid));
      return installSelection(version(number), input.expectedSelectedVersion);
    }
    async function saveVersion({ draftRevision, previewId, reviewer, note, expectedSelectedVersion, requestId }) {
      const input = { draftRevision: integer(draftRevision, 'Use the reviewed draft revision.'), previewId: id(previewId),
        reviewer: text(reviewer, 'reviewer'), note: text(note, 'source change note', 2000), expectedSelectedVersion };
      return run('VERSION', input, requestId, () => performVersion(input, requestId));
    }
    async function selectVersion({ versionId, expectedSelectedVersion, requestId }) {
      version(versionId);
      return run('SELECT', { versionId, expectedSelectedVersion }, requestId, () => installSelection(version(versionId), expectedSelectedVersion));
    }
    async function exportVersion(versionId) {
      const row = version(versionId), retained = await capture(row.captureId), config = await versionConfig(row);
      const packet = packetFromCapture(retained, config, { origin: captureRecord(row.captureId).origin,
        orders: row.draft.orders, version: { id: row.id, title: row.title, reviewer: row.reviewer, note: row.note,
          sourceSha256: row.sourceSha256, createdAt: row.createdAt, rowCount: row.rowCount,
          queries: row.queries, originalMode: 'capture' } });
      return { filename: 'sheetbest-source-v' + row.id + '.json', mime: 'application/json', bytes: bytes(packet) };
    }
    async function exportCapture(captureId) {
      const row = captureRecord(captureId), original = await capture(captureId);
      return { filename: 'sheetbest-observation-' + captureId + '.json', mime: 'application/json',
        bytes: bytes(packetFromCapture(original, sourceConfig(original, row.draft, { allowEmpty: true }), { origin: row.origin, orders: row.draft.orders })) };
    }
    async function captureAttempt(request) {
      const row = db.prepare('SELECT kind,status FROM operations WHERE id=?').get(id(request));
      if (!row || row.kind !== 'CAPTURE') throw fault('SHEETBEST_CAPTURE_REQUEST_NOT_FOUND', 'Choose an original capture request.', 404);
      const target = join(directory, 'captures', request), staging = join(directory, 'captures', '.pending-' + request);
      const folder = !await absent(target) ? target : !await absent(staging) ? staging : null, files = [];
      let incomplete = null;
      if (folder) {
        await privateDirectory(folder);
        for (const file of await readdir(folder)) {
          if (!/^(?:capture|records)\.json$/.test(file)) continue;
          const stat = await lstat(join(folder, file));
          if (stat.isFile() && !stat.isSymbolicLink()) files.push({ file, bytes: stat.size });
        }
        incomplete = await absent(join(folder, 'capture.json')) ? { code: 'SHEETBEST_RETENTION_INCOMPLETE' } : null;
      }
      return { requestId: request, status: row.status, directory: folder, files, incomplete,
        recovery: 'Resume adopts a complete capture or retains the exact saved response and receipt. It never repeats the GET. A positively missing receipt ends that request so a new explicit observation can be made.' };
    }
    async function compareVersions(leftId, rightId) {
      const left = version(leftId), right = version(rightId), queries = [];
      for (const name of new Set([...Object.keys(left.draft.queries), ...Object.keys(right.draft.queries)])) {
        const before = left.draft.queries[name]?.columns ?? {}, after = right.draft.queries[name]?.columns ?? {};
        queries.push({ name, columns: [...new Set([...Object.keys(before), ...Object.keys(after)])].map(alias => ({
          alias, before: before[alias] ?? null, after: after[alias] ?? null,
          status: !(alias in before) ? 'added' : !(alias in after) ? 'removed' : identity(before[alias]) === identity(after[alias]) ? 'same' : 'changed',
        })) });
      }
      return { left, right, queries, sameObservation: left.observationSha256 === right.observationSha256,
        sameSelection: left.selectionSha256 === right.selectionSha256,
        sameProjection: identity(left.draft.queries) === identity(right.draft.queries),
        sameOrder: identity(left.draft.orders) === identity(right.draft.orders),
        orders: { left: left.draft.orders, right: right.draft.orders } };
    }

    async function publisherPlan({ versionId, query }) {
      const selected = version(versionId), config = await versionConfig(selected);
      const definition = compileQueries(config.queries)[query];
      if (!definition) throw fault('QUERY_NOT_FOUND');
      const columns = Object.fromEntries(Object.entries(definition.projection).map(([name, spec]) =>
        [name, { type: spec.type, nullable: spec.nullable }]));
      return { sourceVersion: selected.id, observationSha256: selected.observationSha256,
        sourceFile: selected.sourceFile, projection: definition.projection,
        plan: { title: selected.title, query, input: {}, sourceHash: selected.sourceSha256,
          dataset: { name: query, columns, filters: [], ranges: [], sorts: Object.keys(columns),
            defaultLimit: 50, maxLimit: 250, maxPageBytes: 921600 },
          extraction: { order: selected.draft.orders[query], maxRows: 1000000, maxBytes: MAX_CAPTURE_BYTES,
            maxRowBytes: 1048576, timeoutMs: 300000 } } };
    }

    async function openPublisher({ expectedSelectedVersion, requestId }) {
      return run('PUBLISHER', { expectedSelectedVersion }, requestId, () => serializePublisherAccess(async () => {
        const state = current();
        if (state.selectedVersion === null || state.selectedVersion !== expectedSelectedVersion)
          throw fault('SHEETBEST_SELECTION_CHANGED', 'Select the reviewed source before opening its publisher.', 409);
        const selected = version(state.selectedVersion);
        if (digest(await readPrivate(settings.sourceFile)) !== selected.sourceSha256) throw fault('SHEETBEST_SELECTED_SOURCE_CHANGED');
        if (!publisherService) {
          const publisher = await openSheetBestPublisher({ directory: settings.publisherDirectory,
            create: await absent(settings.publisherDirectory), sourceFile: settings.sourceFile,
            targetDirectory: settings.targetDirectory, environment, seller, resource });
          try { publisherService = await startPostgresPublisherServer({ publisher, port: 0 }); }
          catch (issue) { await publisher.close(); throw issue; }
        }
        return { url: publisherService.url, sourceVersion: selected.id, sourceSha256: selected.sourceSha256,
          publisherDirectory: settings.publisherDirectory, targetDirectory: settings.targetDirectory };
      }));
    }


    const deploymentPackagePath = request => join(deploymentDirectory, 'packages', id(request));
    const hashValue = value => {
      if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
        throw fault('SHEETBEST_DEPLOYMENT_HASH_REQUIRED', 'Use the inspected original SHA256.', 400);
      return value;
    };
    function serializePublisherAccess(action) {
      const result = publisherAccess.then(action);
      publisherAccess = result.catch(() => {});
      return result;
    }
    async function withPublisher(action) {
      assertOpen();
      return serializePublisherAccess(async () => {
        assertOpen();
        if (publisherService) return action(publisherService.publisher);
        if (await absent(settings.publisherDirectory))
          throw fault('SHEETBEST_DEPLOYMENT_PUBLISHER_MISSING', 'Publish the reviewed source through its original publisher first.', 409);
        const original = await openSheetBestPublisher({ directory: settings.publisherDirectory, environment, seller, resource });
        try { return await action(original); } finally { await original.close(); }
      });
    }
    /** Host-only access to the SAME browser-owned publisher and scheduler.
     * The caller supplies code, never an agent-selected module or native handle.
     * This serialized lifetime drains before closePublisher/deployment/close. */
    async function withOpenPublisher(action) {
      assertOpen();
      if (typeof action !== 'function') throw fault('SHEETBEST_PUBLISHER_CALLBACK_REQUIRED');
      return serializePublisherAccess(async () => {
        assertOpen();
        if (!publisherService)
          throw fault('SHEETBEST_PUBLISHER_NOT_OPEN', 'Explicitly open the selected source publisher first.', 409);
        return action({ publisher: publisherService.publisher, schedule: publisherService.schedule });
      });
    }

    function savedDeploymentOperation(request, kind) {
      const row = db.prepare('SELECT * FROM operations WHERE id=?').get(id(request));
      if (!row || row.kind !== kind || row.status !== 'complete')
        throw fault('SHEETBEST_DEPLOYMENT_RECEIPT_REQUIRED', 'Select the completed original review or package request.', 409);
      return { input: JSON.parse(row.input), result: JSON.parse(row.result) };
    }
    async function consoleRequest(method, path, input) {
      const service = deploymentService;
      if (!service) throw fault('SHEETBEST_DEPLOYMENT_CONSOLE_REQUIRED', 'Open the original deployment controls first.', 409);
      let response;
      try {
        response = await fetch(service.native.url + path, { method, redirect: 'error',
          headers: { 'x-release-token': service.native.token, origin: service.native.url,
            ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
          ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(175000)]) });
        const blocks = []; let size = 0;
        for await (const block of response.body) {
          size += block.length;
          if (size > 16 * 1024 * 1024) throw new Error('Original console reply exceeds 16 MiB.');
          blocks.push(block);
        }
        const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(blocks)));
        if (!response.ok) {
          const issue = fault('SHEETBEST_DEPLOYMENT_COMMAND_REJECTED',
            (result.error ?? 'OPERATOR_ERROR') + ': ' + (result.message ?? 'Inspect the original release state.'),
            [400, 403, 404, 409, 413, 422, 502].includes(response.status) ? response.status : 422);
          issue.nativeReply = true; throw issue;
        }
        return result;
      } catch (issue) {
        if (issue.nativeReply) throw issue;
        // No second POST after an uncertain local response. The source request
        // remains recoverable and resume reads only the original current state.
        throw fault('DEPLOYMENT_CONSOLE_RESPONSE_UNCERTAIN',
          'Read or resume this original request. Its deployment command is not automatically replayed.', 502);
      }
    }
    function deploymentOwnership() {
      return { running: Boolean(deploymentService), instanceId: deploymentService?.id ?? null,
        url: deploymentService?.native.operatorUrl ?? null, releaseDirectory };
    }
    async function nativeDeploymentState() {
      if (deploymentService) return consoleRequest('GET', '/api/status');
      if (await absent(releaseDirectory)) return null;
      const { releaseStatus } = await import('../../../sf82-seller-pilot/releases.mjs');
      return releaseStatus(releaseDirectory);
    }
    async function deploymentStatus({ runsOffset = 0, operationsOffset = 0, limit = 25 } = {}) {
      assertOpen();
      for (const offset of [runsOffset, operationsOffset]) integer(offset, 'Use a nonnegative result offset.');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fault('SHEETBEST_PAGE_LIMIT_INVALID');
      const sourceVersions = db.prepare('SELECT * FROM versions ORDER BY id DESC').all().map(row => {
        const data = JSON.parse(row.data);
        return { id: row.id, title: data.title, sourceSha256: data.sourceSha256, mode: data.mode };
      });
      let publisher = null;
      if (!await absent(settings.publisherDirectory)) publisher = await withPublisher(original => {
        const saved = original.status({ limit, runsOffset });
        return { pages: saved.pages.runs, active: saved.active, runs: saved.runs.map(row => {
          const plan = original.plan(row.plan), sourceSha256 = plan.data.sourceHash;
          return { id: row.id, planId: row.plan, state: row.state, createdAt: row.created, sourceSha256,
            sourceVersions: sourceVersions.filter(version => version.sourceSha256 === sourceSha256),
            candidateDigest: row.data.candidate?.candidateDigest ?? null,
            dataset: row.data.candidate?.dataset ?? null, publication: row.data.publication
              ? { snapshot: row.data.publication.snapshot, revision: row.data.publication.revision,
                  mode: row.data.publication.mode } : null };
        }) };
      });
      const total = db.prepare("SELECT count(*) AS count FROM operations WHERE kind LIKE 'DEPLOYMENT_%'").get().count;
      const operations = db.prepare("SELECT * FROM operations WHERE kind LIKE 'DEPLOYMENT_%' ORDER BY rowid DESC LIMIT ? OFFSET ?")
        .all(limit, operationsOffset).map(row => ({ ...operation(row.id), input: JSON.parse(row.input) }));
      return { schema: 'stellar-forge.sheetbest-deployment-status.v1', directory: deploymentDirectory,
        releaseDirectory, sourceVersions, publisher, operations,
        pages: { limit, runsOffset, operationsOffset, operationsTotal: total },
        console: deploymentOwnership(), native: await nativeDeploymentState() };
    }
    function versionForPublication(publisher, runId, versionId) {
      const selected = version(versionId), run = publisher.run(runId), plan = publisher.plan(run.plan);
      if (plan.data.sourceHash !== selected.sourceSha256 ||
          run.data?.candidate?.extraction?.observation?.capture?.manifestSha256 !== selected.observationSha256 ||
          identity(plan.data.extraction.order) !== identity(selected.draft.orders[plan.data.query]))
        throw fault('SHEETBEST_DEPLOYMENT_SOURCE_VERSION_CHANGED', 'Choose the source version that produced this original publication.', 409);
      return selected;
    }
    async function performDeploymentReview(input, request) {
      const result = await withPublisher(async publisher => {
        versionForPublication(publisher, input.runId, input.versionId);
        return reviewSheetBestDeployment({ publisher, runId: input.runId, terms: input.terms });
      });
      return { ...result, authoringVersion: input.versionId, reviewRequestId: request };
    }
    async function reviewDeployment({ versionId, runId, terms, requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_DEPLOYMENT_INPUT_INVALID');
      version(versionId); id(runId);
      const input = { versionId, runId, terms };
      return run('DEPLOYMENT_REVIEW', input, requestId, () => performDeploymentReview(input, requestId));
    }
    async function performDeploymentPrepare(input, request) {
      const reviewed = savedDeploymentOperation(input.reviewRequestId, 'DEPLOYMENT_REVIEW');
      if (reviewed.result.reviewSha256 !== input.expectedReviewSha256)
        throw fault('SHEETBEST_DEPLOYMENT_REVIEW_CHANGED', 'Select the exact reviewed merchant configuration.', 409);
      await privateDirectory(deploymentDirectory, true);
      await privateDirectory(join(deploymentDirectory, 'packages'), true);
      const result = await withPublisher(async publisher => {
        versionForPublication(publisher, reviewed.input.runId, reviewed.input.versionId);
        return prepareSheetBestDeployment({ publisher,
          runId: reviewed.input.runId, terms: reviewed.input.terms,
          expectedReviewSha256: input.expectedReviewSha256, directory: deploymentPackagePath(request) });
      });
      return { ...result, packageRequestId: request, reviewRequestId: input.reviewRequestId };
    }
    async function prepareDeployment({ reviewRequestId, expectedReviewSha256, requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_DEPLOYMENT_INPUT_INVALID');
      const input = { reviewRequestId: id(reviewRequestId), expectedReviewSha256: hashValue(expectedReviewSha256) };
      return run('DEPLOYMENT_PREPARE', input, requestId, () => performDeploymentPrepare(input, requestId));
    }
    async function inspectDeploymentPackage(packageRequestId) {
      const saved = savedDeploymentOperation(packageRequestId, 'DEPLOYMENT_PREPARE');
      const inspected = await inspectSheetBestDeployment(deploymentPackagePath(packageRequestId));
      if (inspected.sourceSha256 !== saved.result.sourceSha256 || inspected.candidateDigest !== saved.result.candidateDigest)
        throw fault('SHEETBEST_DEPLOYMENT_PACKAGE_CHANGED');
      return { ...inspected, packageRequestId };
    }
    async function performDeploymentStage(input) {
      const prepared = await inspectDeploymentPackage(input.packageRequestId);
      if (prepared.sourceSha256 !== input.expectedSourceSha256) throw fault('SHEETBEST_DEPLOYMENT_PACKAGE_CHANGED');
      return { ...await stageSheetBestDeployment({ packageDirectory: deploymentPackagePath(input.packageRequestId),
        releaseDirectory, id: input.id, label: input.label, runtime: input.runtime,
        expectedSourceSha256: input.expectedSourceSha256 }), packageRequestId: input.packageRequestId };
    }
    async function stageDeployment({ packageRequestId, expectedSourceSha256, id: releaseId, label, runtime = { port: 0 }, requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_DEPLOYMENT_INPUT_INVALID');
      const input = { packageRequestId: id(packageRequestId), expectedSourceSha256: hashValue(expectedSourceSha256),
        id: releaseId, label: label ?? releaseId, runtime };
      return run('DEPLOYMENT_STAGE', input, requestId, () => performDeploymentStage(input));
    }
    async function openDeploymentConsole({ requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_DEPLOYMENT_INPUT_INVALID');
      return run('DEPLOYMENT_CONSOLE_OPEN', {}, requestId, async () => {
        if (!deploymentService) {
          await privateDirectory(deploymentDirectory, true);
          const { initReleaseStore } = await import('../../../sf82-seller-pilot/releases.mjs');
          const { startReleaseConsole } = await import('../../../sf82-seller-pilot/release-console.mjs');
          await initReleaseStore(releaseDirectory);
          deploymentService = { id: randomUUID(), native: await startReleaseConsole(releaseDirectory, { port: 0, env: environment }) };
        }
        return deploymentOwnership();
      });
    }
    async function closeDeploymentConsole({ instanceId, requestId, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_DEPLOYMENT_INPUT_INVALID');
      const input = { instanceId: id(instanceId) };
      return run('DEPLOYMENT_CONSOLE_CLOSE', input, requestId, async () => {
        if (deploymentService && deploymentService.id !== input.instanceId)
          throw fault('SHEETBEST_DEPLOYMENT_CONSOLE_CHANGED', 'Close only the current deployment console instance.', 409);
        if (deploymentService) {
          const selected = deploymentService; await selected.native.close();
          if (deploymentService === selected) deploymentService = null;
        }
        return { running: false, instanceId: input.instanceId };
      });
    }
    async function compareDeployment({ from = null, to, ...extra }) {
      if (Object.keys(extra).length) throw fault('SHEETBEST_DEPLOYMENT_INPUT_INVALID');
      assertOpen();
      const { compareReleases, readReleaseState } = await import('../../../sf82-seller-pilot/releases.mjs');
      const state = await readReleaseState(releaseDirectory);
      return { generation: state.generation, ...await compareReleases(releaseDirectory, from ?? state.active, to) };
    }
    async function commandDeployment({ action, consoleInstanceId, expectedGeneration, expectedDigest, instanceId,
      id: releaseId, to, reason, receiving, requestId, ...extra }) {
      if (Object.keys(extra).length || !['activate', 'rollback', 'run', 'stop', 'restart'].includes(action))
        throw fault('SHEETBEST_DEPLOYMENT_ACTION_INVALID');
      id(consoleInstanceId); integer(expectedGeneration, 'Use the current original selection generation.');
      if (['stop', 'restart'].includes(action)) id(instanceId);
      if (action !== 'stop') hashValue(expectedDigest);
      const input = { action, consoleInstanceId, expectedGeneration,
        ...(expectedDigest === undefined ? {} : { expectedDigest }),
        ...(instanceId === undefined ? {} : { instanceId }), ...(releaseId === undefined ? {} : { id: releaseId }),
        ...(to === undefined ? {} : { to }), ...(reason === undefined ? {} : { reason }),
        ...(receiving === undefined ? {} : { receiving }) };
      return run('DEPLOYMENT_COMMAND', input, requestId, async () => {
        if (!deploymentService || deploymentService.id !== input.consoleInstanceId)
          throw fault('SHEETBEST_DEPLOYMENT_CONSOLE_CHANGED', 'Use the current original deployment console instance.', 409);
        const current = await consoleRequest('GET', '/api/status');
        if (current.console.busy) throw fault('SHEETBEST_DEPLOYMENT_BUSY', 'The original deployment action is still running.', 409);
        if (current.state.generation !== expectedGeneration) throw fault('SHEETBEST_DEPLOYMENT_SELECTION_CHANGED', 'Refresh and compare the current release selection.', 409);
        if (action !== 'stop') {
          const selectedId = action === 'activate' ? releaseId : action === 'rollback' ? to ?? current.state.previous : current.state.active;
          const { inspectRelease } = await import('../../../sf82-seller-pilot/releases.mjs');
          const selected = await inspectRelease(releaseDirectory, selectedId);
          if (selected.digest !== expectedDigest) throw fault('SHEETBEST_DEPLOYMENT_RELEASE_CHANGED', 'Use the exact inspected release digest.', 409);
        }
        const { action: _, consoleInstanceId: __, expectedDigest: ___, ...native } = input;
        const result = await consoleRequest('POST', '/api/' + action, native);
        return { mode: 'ORIGINAL_CONSOLE_REPLY', action, requestId, consoleInstanceId, native: result };
      });
    }
    async function recoverDeploymentCommand(row, input) {
      const native = await nativeDeploymentState();
      if (native?.console?.busy) throw fault('DEPLOYMENT_COMMAND_STILL_RUNNING', 'The original console is still completing its action. Check this same request again.', 409);
      return { mode: 'OBSERVED_ORIGINAL_STATE', action: input.action, requestId: row.id,
        originalConsoleInstanceId: input.consoleInstanceId, currentConsole: deploymentOwnership(),
        commandReplayed: false, native,
        observation: 'The current original release state is retained here. This recovery did not repeat the uncertain command or infer a historical result.' };
    }
    async function deploymentFile(packageRequestId, filename) {
      await inspectDeploymentPackage(packageRequestId);
      return readSheetBestDeploymentFile(deploymentPackagePath(packageRequestId), filename);
    }



    async function resume(request) {
      id(request);
      const row = db.prepare('SELECT * FROM operations WHERE id=?').get(request);
      if (!row) throw fault('SHEETBEST_OPERATION_NOT_FOUND', 'No retained request has this identifier.', 404);
      if (row.status === 'complete') return JSON.parse(row.result);
      if (row.status === 'failed') { const issue = JSON.parse(row.error); throw fault(issue.code, issue.message, issue.status); }
      if (pending) throw fault('SHEETBEST_AUTHORING_BUSY', 'Wait for the active original operation.', 409);
      const input = JSON.parse(row.input);
      return run(row.kind, input, request, async () => {
        if (row.kind === 'IMPORT') return performImport(input, request);
        if (row.kind === 'CAPTURE') return performCapture(input, request, false);
        if (row.kind === 'VERSION') return performVersion(input, request);
        if (row.kind === 'SELECT') return installSelection(version(input.versionId), input.expectedSelectedVersion);
        if (row.kind === 'DRAFT') return transaction(() => {
          const state = current();
          if (state.draftRevision === input.expectedRevision + 1 && identity(state.draft) === identity(input.draft))
            return { draft: state.draft, draftRevision: state.draftRevision };
          if (state.draftRevision !== input.expectedRevision) throw fault('SHEETBEST_DRAFT_CHANGED', 'Reload the current draft.', 409);
          state.draft = input.draft; state.draftRevision++; setState(state);
          return { draft: state.draft, draftRevision: state.draftRevision };
        });
        if (row.kind === 'PREVIEW') return performPreview(input, request);
        if (row.kind === 'DEPLOYMENT_REVIEW') return performDeploymentReview(input, request);
        if (row.kind === 'DEPLOYMENT_PREPARE') return performDeploymentPrepare(input, request);
        if (row.kind === 'DEPLOYMENT_STAGE') return performDeploymentStage(input);
        if (row.kind === 'DEPLOYMENT_COMMAND') return recoverDeploymentCommand(row, input);
        if (row.kind === 'DEPLOYMENT_CONSOLE_OPEN') return { ...deploymentOwnership(), observedOwnership: true };
        if (row.kind === 'DEPLOYMENT_CONSOLE_CLOSE') {
          if (deploymentService?.id === input.instanceId) {
            const selected = deploymentService; await selected.native.close();
            if (deploymentService === selected) deploymentService = null;
          }
          return { ...deploymentOwnership(), originalInstanceId: input.instanceId, observedOwnership: true };
        }
        if (row.kind === 'PUBLISHER') return { running: Boolean(publisherService), url: publisherService?.url ?? null,
          observedOwnership: true, sourceVersion: current().selectedVersion,
          publisherDirectory: settings.publisherDirectory };
        if (row.kind === 'STOP_PUBLISHER') {
          if (publisherService) { const service = publisherService; await service.close(); if (publisherService === service) publisherService = null; }
          return { running: false };
        }
        throw fault('SHEETBEST_OPERATION_INTERRUPTED', 'Inspect the original saved operation.', 409);
      }, true);
    }

    // Reopening never repeats a provider call or starts a publication/service.
    db.prepare("UPDATE operations SET status='interrupted',updated=? WHERE status='pending'").run(stamp());
    for (const row of db.prepare("SELECT id FROM operations WHERE status='interrupted' AND kind IN ('VERSION','SELECT')").all())
      await resume(row.id).catch(() => {});
    return {
      directory, settings, importSource, importPacket, readLive,
      inspectCapture, saveDraft, preview, saveVersion, selectVersion, exportVersion, exportCapture, captureAttempt, compareVersions,
      openPublisher, withOpenPublisher, publisherPlan, resume, operation, version, deploymentStatus, reviewDeployment, prepareDeployment,
      inspectDeploymentPackage, stageDeployment, openDeploymentConsole, closeDeploymentConsole,
      compareDeployment, commandDeployment, deploymentFile,
      async status({ capturesOffset = 0, versionsOffset = 0, limit = 25 } = {}) {
        for (const value of [capturesOffset, versionsOffset]) integer(value, 'Use a nonnegative result offset.');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fault('SHEETBEST_PAGE_LIMIT_INVALID');
        assertOpen(); const state = current();
        const previewRow = db.prepare('SELECT data FROM previews ORDER BY rowid DESC LIMIT 1').get();
        const preview = previewRow ? JSON.parse(previewRow.data) : null;
        return { schema: SCHEMA, directory, ...state, connections: connectionViews(connections, environment),
          captures: db.prepare('SELECT data FROM captures ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit, capturesOffset).map(row => JSON.parse(row.data)),
          versions: db.prepare('SELECT * FROM versions ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, versionsOffset).map(row => ({ id: row.id, requestId: row.request_id, ...JSON.parse(row.data) })),
          pages: { limit, capturesOffset, versionsOffset,
            capturesTotal: db.prepare('SELECT count(*) AS count FROM captures').get().count,
            versionsTotal: db.prepare('SELECT count(*) AS count FROM versions').get().count },
          preview: preview?.draftRevision === state.draftRevision ? preview : null,
          active: pending ? { id: pending.id, kind: pending.kind } : null,
          operations: db.prepare('SELECT id FROM operations ORDER BY rowid DESC LIMIT 25').all().map(row => {
            const { result, ...summary } = operation(row.id); return summary;
          }),
          deployment: deploymentOwnership(),
          publisher: { running: Boolean(publisherService), url: publisherService?.url ?? null,
            directory: settings.publisherDirectory, sourceFile: settings.sourceFile, targetDirectory: settings.targetDirectory },
        };
      },
      closePublisher({ requestId }) { return run('STOP_PUBLISHER', {}, requestId, () => serializePublisherAccess(async () => {
        if (publisherService) { const service = publisherService; await service.close(); if (publisherService === service) publisherService = null; }
        return { running: false };
      })); },
      close() {
        closing ??= (async () => {
          lifetime.abort();
          try {
            if (pending) await pending.completion.catch(() => {});
            await publisherAccess;
            try { if (publisherService) await publisherService.close(); }
            finally { if (deploymentService) await deploymentService.native.close(); }
          } finally { closed = true; db.close(); await release(); }
        })();
        return closing;
      },
    };
  } catch (issue) { try { db?.close(); } finally { await release(); } throw issue; }
}

