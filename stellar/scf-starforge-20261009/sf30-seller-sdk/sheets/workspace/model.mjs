// MIT. Source authoring and retained revisions over the original Sheets engines.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { mkdir, lstat, chmod, rename } from 'node:fs/promises';
import { object, bytes, digest, identity, fault, stamp, absolute, privateDirectory, readPrivate,
  readJson, createFile, atomicJson, syncDirectory, acquireWorkspace } from '../../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, only, cellRange, compileQueries, qualifiedRange } from '../declaration.mjs';
import { retainSheetsCapture, readSheetsCapture, bindSheetsCapture, fetchSheetsResource } from '../capture.mjs';
import { openSheetsSourceFile, inspectSheetsSource } from '../source.mjs';
import { openSheetsPublisher } from '../publisher/model.mjs';
import { startPostgresPublisherServer } from '../../postgres/publisher/server.mjs';
import { normalizeConnections, selectConnection, connectionViews, workbookId, metadataView,
  fetchWorkbookMetadata } from './provider.mjs';

const SCHEMA = 'stellar-forge.sheets-authoring.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const decode = value => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw fault('SHEETS_RESOURCE_JSON_INVALID'); } };
const absent = async path => { try { await lstat(path); return false; } catch (issue) { if (issue.code === 'ENOENT') return true; throw issue; } };
const id = value => { if (typeof value !== 'string' || !UUID.test(value)) throw fault('REQUEST_ID_REQUIRED', 'Use one UUID for this operation and its recovery.'); return value; };
const text = (value, label, maximum = 128) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw fault('SHEETS_TEXT_REQUIRED', 'Enter a valid ' + label + '.');
  return value.trim();
};
const integer = (value, label) => { if (!Number.isSafeInteger(value) || value < 0) throw fault('SHEETS_REVISION_REQUIRED', label); return value; };
const letter = index => { let value = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
  value = String.fromCharCode(65 + (n - 1) % 26) + value; return value; };
const privateFault = issue => ({ code: typeof issue.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(issue.code) ? issue.code : 'SHEETS_AUTHORING_FAILED',
  message: issue.code && typeof issue.message === 'string' ? issue.message : 'Inspect the retained operation and selected input.',
  status: [400, 403, 404, 409, 413, 422, 502].includes(issue.status) ? issue.status : 422 });

function sourceConfig(capture, draft, connections, observed = false) {
  const config = { schema: 'stellar-forge.sheets-source.v1', spreadsheetId: capture.manifest.spreadsheetId,
    connection: draft.mode === 'live' && !observed ? selectConnection(connections, draft.connectionAlias) :
      { kind: 'capture', file: capture.manifestFile, sha256: capture.manifestSha256 },
    queries: { [draft.name]: { sheetId: capture.manifest.sheetId, sheetTitle: capture.grid.bounds.title,
      range: draft.range, columns: draft.columns, emptyRows: draft.emptyRows } } };
  const queries = compileQueries(config.queries);
  bindSheetsCapture(capture, config, queries[draft.name]);
  return config;
}

function packetBytes(value, maximum = MAX_CAPTURE_BYTES) {
  if (!object(value) || typeof value.data !== 'string' || value.encoding !== 'base64' ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > maximum ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))
    throw fault('SHEETS_PACKET_FILE_INVALID');
  const output = Buffer.from(value.data, 'base64');
  if (output.length !== value.bytes || digest(output) !== value.sha256) throw fault('SHEETS_PACKET_BYTES_CHANGED');
  return output;
}

export async function openSheetsAuthoring({ directory, create = false, connections = {}, environment = process.env,
  targetDirectory, seller = null, resource = null } = {}) {
  absolute(directory); connections = normalizeConnections(connections);
  if (create && !await absent(directory)) throw fault('SHEETS_AUTHORING_EXISTS', 'Reopen this source workspace without --create.');
  await privateDirectory(directory, create);
  const release = await acquireWorkspace(directory);
  let db, publisherService = null, pending = null, closed = false, closing;
  const lifetime = new AbortController();
  try {
    const database = join(directory, 'sources.sqlite');
    if (!create && await absent(database)) throw fault('SHEETS_AUTHORING_MISSING');
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
      catch (issue) { db.exec('ROLLBACK'); throw issue; } };
    if (create) {
      targetDirectory ??= join(directory, 'dataset'); absolute(targetDirectory, 'dataset directory');
      if (targetDirectory === directory || targetDirectory.startsWith(directory + '/captures/') || targetDirectory.startsWith(directory + '/versions/'))
        throw fault('SHEETS_TARGET_DIRECTORY_INVALID');
      transaction(() => {
        db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({ schema: SCHEMA, createdAt: stamp(),
          targetDirectory, publisherDirectory: join(directory, 'publisher'), sourceFile: join(directory, 'current-source.json') }));
        db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify({ draft: null, draftRevision: 0, selectedVersion: null, selectionRevision: 0 }));
      });
      for (const name of ['inputs', 'captures', 'previews', 'versions', 'interrupted']) await privateDirectory(join(directory, name), true);
      await syncDirectory(directory);
    }
    const settings = JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get()?.data ?? 'null');
    if (settings?.schema !== SCHEMA || settings.sourceFile !== join(directory, 'current-source.json') ||
        settings.publisherDirectory !== join(directory, 'publisher') || targetDirectory && targetDirectory !== settings.targetDirectory)
      throw fault('SHEETS_AUTHORING_BINDING_CHANGED');
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
      if (!row) throw fault('SHEETS_CAPTURE_NOT_FOUND', 'Choose a retained observation.', 404);
      return JSON.parse(row.data);
    };
    const capture = async request => {
      const row = captureRecord(request);
      const result = await readSheetsCapture(join(directory, 'captures', row.id, 'capture.json'), row.manifestSha256);
      if (result.manifest.sourceSha256 !== row.sourceSha256) throw fault('SHEETS_CAPTURE_RESOURCE_CHANGED');
      return result;
    };
    const version = number => {
      integer(number, 'Choose a saved source version.');
      const row = db.prepare('SELECT * FROM versions WHERE id=?').get(number);
      if (!row) throw fault('SHEETS_VERSION_NOT_FOUND', 'Choose a saved source version.', 404);
      return { id: row.id, requestId: row.request_id, ...JSON.parse(row.data) };
    };
    const versionConfig = async row => {
      const content = await readPrivate(join(directory, 'versions', row.requestId, 'source.json'));
      if (digest(content) !== row.sourceSha256) throw fault('SHEETS_SAVED_SOURCE_CHANGED');
      return decode(content);
    };
    const assertOpen = () => { if (closed || closing) throw fault('SHEETS_AUTHORING_CLOSED'); };
    const start = (kind, input, request) => {
      assertOpen(); id(request); const hash = identity(input);
      const old = db.prepare('SELECT * FROM operations WHERE id=?').get(request);
      if (old) {
        if (old.kind !== kind || old.payload_hash !== hash) throw fault('SHEETS_REQUEST_REUSED', 'This request ID belongs to different input.', 409);
        if (old.status === 'complete') return { done: true, value: JSON.parse(old.result) };
        if (old.status === 'failed') { const issue = JSON.parse(old.error); throw fault(issue.code, issue.message, issue.status); }
        throw fault('SHEETS_OPERATION_RETAINED', 'Inspect or resume the original retained operation.', 409);
      }
      if (pending) throw fault('SHEETS_AUTHORING_BUSY', 'The current source operation is still running.', 409);
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
      else { assertOpen(); if (pending) throw fault('SHEETS_AUTHORING_BUSY', 'Wait for the active operation.', 409); }
      const active = { id: request, kind, completion: null }; pending = active;
      active.completion = Promise.resolve().then(fn).then(result => transaction(() => complete(request, result))).catch(issue => {
        const error = privateFault(issue);
        const interrupted = !/^(SHEETS_|DATASET_|PRIVATE_|SOURCE_|QUERY_|INVALID_|ABSOLUTE_)/.test(issue.code ?? '');
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
        throw fault('SHEETS_SELECTION_CHANGED', 'Refresh the selected source before changing it.', 409);
      const config = await versionConfig(row);
      if (!await absent(settings.sourceFile)) {
        const existing = digest(await readPrivate(settings.sourceFile));
        const prior = state.selectedVersion === null ? null : version(state.selectedVersion).sourceSha256;
        if (existing !== prior && existing !== row.sourceSha256) throw fault('SHEETS_SELECTED_SOURCE_CHANGED',
          'The managed source file changed outside this workspace. Preserve it and restore the selected original source before continuing.', 409);
      } else if (state.selectedVersion !== null) throw fault('SHEETS_SELECTED_SOURCE_MISSING');
      if (await absent(settings.sourceFile) || digest(await readPrivate(settings.sourceFile)) !== row.sourceSha256)
        await atomicJson(directory, 'current-source.json', config);
      transaction(() => { const next = current(); if (next.selectedVersion !== row.id) {
        next.selectedVersion = row.id; next.selectionRevision++; setState(next); }
      });
      return { version: row, selectedVersion: row.id, sourceFile: settings.sourceFile, sourceSha256: row.sourceSha256 };
    }

    async function retainInput(request, content) {
      const file = join(directory, 'inputs', request + '.json');
      if (await absent(file)) { await createFile(file, content); await syncDirectory(dirname(file)); }
      else if (digest(await readPrivate(file, MAX_CAPTURE_BYTES * 2)) !== digest(content)) throw fault('SHEETS_REQUEST_REUSED');
      return file;
    }

    async function finishCapture(request, input, content, receivedAt, transport, packetDraft = null) {
      const target = join(directory, 'captures', request);
      let retained;
      if (!await absent(target)) retained = await readSheetsCapture(join(target, 'capture.json'));
      else {
        const staging = join(directory, 'captures', '.pending-' + request);
        if (!await absent(staging)) {
          await rename(staging, join(directory, 'interrupted', request + '-' + randomUUID()));
          await syncDirectory(join(directory, 'interrupted'));
        }
        retained = await retainSheetsCapture(content, staging, { range: input.range, receivedAt, transport });
        await rename(staging, target); await syncDirectory(dirname(target));
        retained = await readSheetsCapture(join(target, 'capture.json'));
      }
      if (digest(content) !== retained.manifest.sourceSha256 || retained.manifest.range !== input.range)
        throw fault('SHEETS_RETAINED_CAPTURE_MISMATCH');
      const metadata = metadataView(retained.resource);
      const record = { ...metadata, id: request, title: input.title, workbookTitle: metadata.title, createdAt: stamp(),
        range: retained.manifest.range, sheetId: retained.manifest.sheetId, sourceSha256: retained.manifest.sourceSha256,
        sourceBytes: retained.manifest.sourceBytes, manifestSha256: retained.manifestSha256,
        receivedAt: retained.manifest.receivedAt, transport: retained.manifest.transport,
        connectionAlias: input.connectionAlias ?? null };
      transaction(() => {
        const prior = db.prepare('SELECT data FROM captures WHERE id=?').get(request);
        if (!prior) db.prepare('INSERT INTO captures VALUES(?,?)').run(request, JSON.stringify(record));
        if (packetDraft) {
          const state = current();
          const desired = { ...packetDraft, captureId: request, mode: 'capture', connectionAlias: null };
          if (state.draftRevision === input.expectedDraftRevision + 1 && identity(state.draft) === identity(desired)) return;
          if (state.draftRevision !== input.expectedDraftRevision) throw fault('SHEETS_DRAFT_CHANGED', 'Reload the current draft before importing this source package.', 409);
          state.draft = desired; state.draftRevision++; setState(state);
        }
      });
      return { capture: captureRecord(request), draftRevision: current().draftRevision };
    }

    async function importObservation({ resourceBytes, range, title, requestId }) {
      if (!Buffer.isBuffer(resourceBytes) || resourceBytes.length > MAX_CAPTURE_BYTES) throw fault('SHEETS_RESOURCE_TOO_LARGE');
      const input = { range, title: text(title, 'observation title'), resourceSha256: digest(resourceBytes), resourceBytes: resourceBytes.length };
      // Validate the original range and resource before retaining an operation.
      const { capturedGrid } = await import('../capture.mjs'); capturedGrid(decode(resourceBytes), range);
      return run('IMPORT', input, requestId, async () => {
        await retainInput(requestId, resourceBytes);
        return finishCapture(requestId, input, resourceBytes, stamp(), 'connected-resource');
      });
    }

    async function readLive({ connectionAlias, spreadsheet: inputSpreadsheet, sheetId, sheetTitle, range, title, requestId }) {
      const connection = selectConnection(connections, connectionAlias), spreadsheet = workbookId(inputSpreadsheet);
      const selectedRange = qualifiedRange(sheetTitle, range);
      if (!Number.isSafeInteger(sheetId) || sheetId < 0) throw fault('SHEETS_SHEET_ID_INVALID');
      const input = { connectionAlias, spreadsheetId: spreadsheet, sheetId, sheetTitle, range: selectedRange,
        title: text(title, 'observation title'), connectionSha256: identity(connection) };
      return run('CAPTURE', input, requestId, async () => {
        const fetched = await fetchSheetsResource({ spreadsheetId: spreadsheet, connection },
          { qualifiedRange: selectedRange, sheetId }, { env: environment, signal: lifetime.signal });
        await retainInput(requestId, fetched.resourceBytes);
        await createFile(join(directory, 'inputs', requestId + '.receipt.json'), bytes({ receivedAt: fetched.receivedAt,
          sha256: digest(fetched.resourceBytes), bytes: fetched.resourceBytes.length }));
        await syncDirectory(join(directory, 'inputs'));
        return finishCapture(requestId, input, fetched.resourceBytes, fetched.receivedAt, 'google-rest');
      });
    }

    async function inspectCapture(request, selectedRange) {
      const retained = await capture(request), bounds = cellRange(selectedRange ?? retained.grid.bounds.a1);
      bindSheetsCapture(retained, { spreadsheetId: retained.manifest.spreadsheetId },
        { bounds, sheetId: retained.manifest.sheetId, sheetTitle: retained.grid.bounds.title });
      const columns = [];
      for (let column = bounds.startColumn; column < bounds.endColumn; column++) {
        const headerCell = retained.grid.cell(bounds.startRow, column);
        const counts = { string: 0, number: 0, boolean: 0, blank: 0, error: 0, formula: 0, unsafeInteger: 0, date: 0, nonInteger: 0 };
        const samples = [];
        for (let row = bounds.startRow + 1; row < bounds.endRow; row++) {
          const cell = retained.grid.cell(row, column), value = cell.effectiveValue;
          if (cell.userEnteredValue?.formulaValue !== undefined) counts.formula++;
          if (['DATE', 'TIME', 'DATE_TIME'].includes(cell.effectiveFormat?.numberFormat?.type)) counts.date++;
          let native = null;
          if (value?.errorValue !== undefined) { counts.error++; native = { error: value.errorValue.type ?? 'ERROR' }; }
          else if (value?.stringValue !== undefined) { counts.string++; native = value.stringValue; }
          else if (value?.boolValue !== undefined) { counts.boolean++; native = value.boolValue; }
          else if (value?.numberValue !== undefined) {
            counts.number++; native = value.numberValue;
            if (!Number.isInteger(native)) counts.nonInteger++;
            else if (!Number.isSafeInteger(native)) counts.unsafeInteger++;
          } else counts.blank++;
          if (samples.length < 4 && native !== null) samples.push({ row: row + 1, value: typeof native === 'string' ? native.slice(0, 240) : native });
        }
        const kinds = ['string', 'number', 'boolean'].filter(kind => counts[kind]);
        const suggestedType = kinds.length === 1 ? kinds[0] === 'number' && !counts.nonInteger && !counts.unsafeInteger ? 'integer' : kinds[0] : 'string';
        columns.push({ column: letter(column), header: headerCell.effectiveValue?.stringValue ?? null,
          validHeader: typeof headerCell.effectiveValue?.stringValue === 'string' && !!headerCell.effectiveValue.stringValue &&
            headerCell.userEnteredValue?.formulaValue === undefined,
          counts, samples, suggestedType });
      }
      return { capture: captureRecord(request), range: bounds.a1, title: retained.grid.bounds.title,
        rowCount: bounds.endRow - bounds.startRow - 1, columns };
    }

    async function normalizeDraft(input) {
      only(input, ['captureId', 'title', 'name', 'range', 'columns', 'emptyRows', 'mode', 'connectionAlias'], 'SHEETS_DRAFT_INVALID');
      const retained = await capture(input.captureId), draft = { ...input, title: text(input.title, 'source title'),
        mode: input.mode ?? 'capture', connectionAlias: input.connectionAlias ?? null, emptyRows: input.emptyRows ?? 'reject' };
      if (!['capture', 'live'].includes(draft.mode)) throw fault('SHEETS_SOURCE_MODE_INVALID');
      if (draft.mode === 'capture') draft.connectionAlias = null;
      if (!object(draft.columns)) throw fault('SHEETS_PUBLIC_COLUMNS_REQUIRED');
      sourceConfig(retained, draft, connections);
      return draft;
    }

    async function saveDraft({ draft, expectedRevision, requestId }) {
      integer(expectedRevision, 'Use the current draft revision.');
      const normalized = await normalizeDraft(draft);
      return run('DRAFT', { draft: normalized, expectedRevision }, requestId, async () => transaction(() => {
        const state = current();
        if (state.draftRevision !== expectedRevision) throw fault('SHEETS_DRAFT_CHANGED', 'Another window saved this draft. Reload before saving your edit.', 409);
        state.draft = normalized; state.draftRevision++; setState(state);
        return { draft: state.draft, draftRevision: state.draftRevision };
      }));
    }

    async function preview({ draftRevision, requestId }) {
      integer(draftRevision, 'Use the saved draft revision.');
      return run('PREVIEW', { draftRevision }, requestId, async () => {
        const state = current();
        if (!state.draft || state.draftRevision !== draftRevision) throw fault('SHEETS_DRAFT_CHANGED', 'Save and review the current draft before previewing it.', 409);
        const original = await capture(state.draft.captureId), config = sourceConfig(original, state.draft, connections, true);
        const folder = join(directory, 'previews', requestId); await privateDirectory(folder, true);
        const file = join(folder, 'source.json');
        if (await absent(file)) await createFile(file, bytes(config));
        else if (digest(await readPrivate(file)) !== digest(bytes(config))) throw fault('SHEETS_PREVIEW_SOURCE_CHANGED');
        const reader = await openSheetsSourceFile(file), sample = [];
        let report;
        try { report = await reader.source.exportDataset(state.draft.name, {}, {
          order: [{ column: Object.keys(state.draft.columns)[0], direction: 'asc' }], maxRows: 1000000,
          maxBytes: MAX_CAPTURE_BYTES, maxRowBytes: 1048576, timeoutMs: 30000, signal: lifetime.signal,
          onRow(row) { if (sample.length < 25) sample.push(row); },
        }); } finally { await reader.source.close(); }
        const result = { id: requestId, draftRevision, draftSha256: identity(state.draft), captureId: state.draft.captureId,
          sourceSha256: digest(bytes(config)), createdAt: stamp(), report, sample, sampleLimit: 25,
          complete: true, mode: state.draft.mode };
        transaction(() => db.prepare('INSERT INTO previews(id,data) VALUES(?,?)').run(requestId, JSON.stringify(result)));
        return result;
      });
    }

    async function saveVersion({ draftRevision, previewId, reviewer, note, expectedSelectedVersion, requestId }) {
      integer(draftRevision, 'Use the reviewed draft revision.'); id(previewId);
      const input = { draftRevision, previewId, reviewer: text(reviewer, 'reviewer'), note: text(note, 'source change note', 2000), expectedSelectedVersion };
      return run('VERSION', input, requestId, async () => {
        const state = current(), reviewed = JSON.parse(db.prepare('SELECT data FROM previews WHERE id=?').get(previewId)?.data ?? 'null');
        if (!state.draft || state.draftRevision !== draftRevision || !reviewed || reviewed.draftRevision !== draftRevision ||
            reviewed.draftSha256 !== identity(state.draft)) throw fault('SHEETS_PREVIEW_CHANGED', 'Preview the exact current saved draft before retaining a source version.', 409);
        if (state.selectedVersion !== expectedSelectedVersion) throw fault('SHEETS_SELECTION_CHANGED', 'Reload the currently selected source.', 409);
        const original = await capture(state.draft.captureId), config = sourceConfig(original, state.draft, connections);
        const folder = join(directory, 'versions', requestId); await privateDirectory(folder, true);
        const file = join(folder, 'source.json'), content = bytes(config);
        if (await absent(file)) await createFile(file, content);
        else if (digest(await readPrivate(file)) !== digest(content)) throw fault('SHEETS_SAVED_SOURCE_CHANGED');
        await inspectSheetsSource(file); await syncDirectory(folder);
        const record = { title: state.draft.title, createdAt: stamp(), reviewer: input.reviewer, note: input.note,
          draft: state.draft, draftRevision, previewId, sourceSha256: digest(content), sourceBytes: content.length,
          captureId: state.draft.captureId, observationSha256: original.manifest.sourceSha256,
          range: qualifiedRange(original.grid.bounds.title, state.draft.range), mode: state.draft.mode,
          rowCount: reviewed.report.rowCount, columns: reviewed.report.columns };
        const number = transaction(() => Number(db.prepare('INSERT INTO versions(request_id,data) VALUES(?,?)').run(requestId, JSON.stringify(record)).lastInsertRowid));
        return installSelection(version(number), expectedSelectedVersion);
      });
    }

    async function selectVersion({ versionId, expectedSelectedVersion, requestId }) {
      const row = version(versionId);
      return run('SELECT', { versionId, expectedSelectedVersion }, requestId, () => installSelection(row, expectedSelectedVersion));
    }

    async function exportVersion(versionId) {
      const row = version(versionId), retained = await capture(row.captureId), config = await versionConfig(row);
      const source = { ...config, connection: { kind: 'capture', file: 'capture/capture.json', sha256: retained.manifestSha256 } };
      const packet = { schema: 'stellar-forge.sheets-source-packet.v1', createdAt: row.createdAt,
        version: { id: row.id, title: row.title, reviewer: row.reviewer, note: row.note, sourceSha256: row.sourceSha256,
          originalMode: row.mode, rowCount: row.rowCount, columns: row.columns },
        source, draft: { ...row.draft, mode: 'capture', connectionAlias: null },
        capture: { manifest: retained.manifest, manifestSha256: retained.manifestSha256 },
        resource: { encoding: 'base64', bytes: retained.resourceBytes.length, sha256: retained.manifest.sourceSha256,
          data: retained.resourceBytes.toString('base64') } };
      return { filename: 'sheets-source-v' + row.id + '.json', mime: 'application/json', bytes: bytes(packet) };
    }

    async function importPacket({ packet, title, expectedDraftRevision, requestId }) {
      if (packet?.schema !== 'stellar-forge.sheets-source-packet.v1' || packet.capture?.manifest?.schema !== 'stellar-forge.sheets-capture.v1')
        throw fault('SHEETS_PACKET_INVALID');
      const content = packetBytes(packet.resource), manifest = packet.capture.manifest;
      if (digest(bytes(manifest)) !== packet.capture.manifestSha256 || manifest.sourceSha256 !== digest(content) || manifest.sourceBytes !== content.length)
        throw fault('SHEETS_PACKET_BYTES_CHANGED');
      only(packet.draft, ['captureId', 'title', 'name', 'range', 'columns', 'emptyRows', 'mode', 'connectionAlias'], 'SHEETS_PACKET_DRAFT_INVALID');
      const draft = { ...packet.draft, mode: 'capture', connectionAlias: null };
      compileQueries({ [draft.name]: { sheetId: manifest.sheetId, sheetTitle: packet.source?.queries?.[draft.name]?.sheetTitle,
        range: draft.range, columns: draft.columns, emptyRows: draft.emptyRows } });
      const input = { title: text(title, 'source package title'), range: manifest.range, expectedDraftRevision: integer(expectedDraftRevision, 'Use the current draft revision.'),
        packetSha256: digest(bytes(packet)), resourceSha256: digest(content), receivedAt: manifest.receivedAt, transport: manifest.transport };
      return run('PACKET', input, requestId, async () => {
        await retainInput(requestId, bytes(packet));
        return finishCapture(requestId, input, content, manifest.receivedAt, manifest.transport, draft);
      });
    }

    async function compareVersions(leftId, rightId) {
      const left = version(leftId), right = version(rightId);
      const aliases = [...new Set([...Object.keys(left.draft.columns), ...Object.keys(right.draft.columns)])];
      const columns = aliases.map(alias => {
        const before = left.draft.columns[alias] ?? null, after = right.draft.columns[alias] ?? null;
        return { alias, before, after, status: before === null ? 'added' : after === null ? 'removed' :
          identity(before) === identity(after) ? 'same' : 'changed' };
      });
      const previewFor = row => JSON.parse(db.prepare('SELECT data FROM previews WHERE id=?').get(row.previewId)?.data ?? 'null');
      return { left, right, columns, leftPreview: previewFor(left), rightPreview: previewFor(right),
        sameObservation: left.observationSha256 === right.observationSha256, sameRange: left.range === right.range,
        sameProjection: identity(left.draft.columns) === identity(right.draft.columns) };
    }

    async function openPublisher({ expectedSelectedVersion, requestId }) {
      return run('PUBLISHER', { expectedSelectedVersion }, requestId, async () => {
        const state = current();
        if (state.selectedVersion === null || state.selectedVersion !== expectedSelectedVersion)
          throw fault('SHEETS_SELECTION_CHANGED', 'Select the reviewed source before opening its publisher.', 409);
        const selected = version(state.selectedVersion);
        if (digest(await readPrivate(settings.sourceFile)) !== selected.sourceSha256) throw fault('SHEETS_SELECTED_SOURCE_CHANGED');
        if (!publisherService) {
          const publisher = await openSheetsPublisher({ directory: settings.publisherDirectory,
            create: await absent(settings.publisherDirectory), sourceFile: settings.sourceFile,
            targetDirectory: settings.targetDirectory, environment, seller, resource });
          try { publisherService = await startPostgresPublisherServer({ publisher, port: 0 }); }
          catch (issue) { await publisher.close(); throw issue; }
        }
        return { url: publisherService.url, sourceVersion: selected.id, sourceSha256: selected.sourceSha256,
          publisherDirectory: settings.publisherDirectory, targetDirectory: settings.targetDirectory };
      });
    }

    async function resume(request) {
      assertOpen(); id(request);
      const row = db.prepare('SELECT * FROM operations WHERE id=?').get(request);
      if (!row) throw fault('SHEETS_OPERATION_NOT_FOUND', 'No retained operation has this ID.', 404);
      if (row.status === 'complete') return JSON.parse(row.result);
      if (row.status === 'pending' && pending?.id === request) return pending.completion;
      if (row.status !== 'interrupted') throw fault('SHEETS_OPERATION_NOT_RESUMABLE', 'This operation has a retained terminal result.', 409);
      const input = JSON.parse(row.input);
      return run(row.kind, input, request, async () => {
        if (['IMPORT', 'CAPTURE', 'PACKET'].includes(row.kind)) {
          const file = join(directory, 'inputs', request + '.json');
          if (await absent(file)) throw fault(row.kind === 'CAPTURE' ? 'SHEETS_READ_NOT_RETAINED' : 'SHEETS_UPLOAD_NOT_RETAINED',
            'This process ended before the original bytes were retained. Make a new explicit capture or upload; this recovery sends no Google request.', 409);
          let content = await readPrivate(file, MAX_CAPTURE_BYTES * 2), packetDraft = null, transport = 'connected-resource', receivedAt = row.created;
          if (row.kind === 'PACKET') { const packet = decode(content); content = packetBytes(packet.resource);
            packetDraft = { ...packet.draft, mode: 'capture', connectionAlias: null }; transport = input.transport; receivedAt = input.receivedAt; }
          if (row.kind === 'CAPTURE') {
            let receipt;
            try { receipt = await readJson(join(directory, 'inputs', request + '.receipt.json')); }
            catch (issue) {
              if (issue.code === 'ENOENT') throw fault('SHEETS_READ_RECEIPT_NOT_RETAINED',
                'The original CellData bytes remain retained, but this read has no saved receipt. Import those bytes explicitly or request a new observation.', 409);
              throw issue;
            }
            if (receipt.sha256 !== digest(content) || receipt.bytes !== content.length) throw fault('SHEETS_RETAINED_INPUT_CHANGED');
            receivedAt = receipt.receivedAt; transport = 'google-rest'; }
          if (digest(content) !== input.resourceSha256 && row.kind !== 'CAPTURE') throw fault('SHEETS_RETAINED_INPUT_CHANGED');
          return finishCapture(request, input, content, receivedAt, transport, packetDraft);
        }
        if (row.kind === 'VERSION') {
          const saved = db.prepare('SELECT id FROM versions WHERE request_id=?').get(request);
          if (!saved) throw fault('SHEETS_VERSION_NOT_RETAINED', 'The source version was not committed. The saved draft remains available for a new review.', 409);
          return installSelection(version(saved.id), input.expectedSelectedVersion);
        }
        if (row.kind === 'SELECT') return installSelection(version(input.versionId), input.expectedSelectedVersion);
        if (row.kind === 'DRAFT') return transaction(() => {
          const state = current();
          if (state.draftRevision === input.expectedRevision + 1 && identity(state.draft) === identity(input.draft))
            return { draft: state.draft, draftRevision: state.draftRevision };
          if (state.draftRevision !== input.expectedRevision) throw fault('SHEETS_DRAFT_CHANGED', 'Reload the current draft.', 409);
          state.draft = input.draft; state.draftRevision++; setState(state);
          return { draft: state.draft, draftRevision: state.draftRevision };
        });
        if (row.kind === 'PREVIEW') {
          const saved = db.prepare('SELECT data FROM previews WHERE id=?').get(request);
          if (saved) return JSON.parse(saved.data);
          throw fault('SHEETS_PREVIEW_NOT_RETAINED', 'The validation result was not retained. Preview the same saved draft again; no new Google read is required.', 409);
        }
        if (row.kind === 'STOP_PUBLISHER' && !publisherService) return { running: false };
        throw fault('SHEETS_OPERATION_INTERRUPTED', 'The saved source remains available. Review the current state before requesting this operation again.', 409);
      }, true);
    }

    // A new owning process never repeats a remote request or starts the publisher.
    db.prepare("UPDATE operations SET status='interrupted',updated=? WHERE status='pending'").run(stamp());
    for (const row of db.prepare("SELECT id,kind,input FROM operations WHERE status='interrupted' AND kind IN ('VERSION','SELECT')").all()) {
      // Only the original local pointer mutation can reconcile itself on reopen.
      // Unknown edits to current-source.json are refused by installSelection.
      await resume(row.id).catch(() => {});
    }

    return {
      directory, settings, importObservation, importPacket, readLive, inspectCapture, saveDraft, preview, saveVersion,
      selectVersion, exportVersion, openPublisher, resume, operation, version, compareVersions,
      async workbook({ connectionAlias, spreadsheet }) {
        assertOpen(); return fetchWorkbookMetadata(workbookId(spreadsheet), selectConnection(connections, connectionAlias),
          { environment, signal: lifetime.signal });
      },
      async status({ capturesOffset = 0, versionsOffset = 0, limit = 25 } = {}) {
        for (const value of [capturesOffset, versionsOffset]) integer(value, 'Use a nonnegative result offset.');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fault('SHEETS_PAGE_LIMIT_INVALID');
        assertOpen(); const state = current();
        const previews = db.prepare('SELECT data FROM previews ORDER BY rowid DESC LIMIT 1').all().map(row => JSON.parse(row.data));
        return { schema: SCHEMA, directory, ...state, connections: await connectionViews(connections, environment),
          captures: db.prepare('SELECT data FROM captures ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit, capturesOffset).map(row => JSON.parse(row.data)),
          versions: db.prepare('SELECT * FROM versions ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, versionsOffset).map(row => ({ id: row.id, requestId: row.request_id, ...JSON.parse(row.data) })),
          pages: { limit, capturesOffset, versionsOffset,
            capturesTotal: db.prepare('SELECT count(*) AS count FROM captures').get().count,
            versionsTotal: db.prepare('SELECT count(*) AS count FROM versions').get().count },
          preview: previews.find(row => row.draftRevision === state.draftRevision) ?? null,
          active: pending ? { id: pending.id, kind: pending.kind } : null,
          operations: db.prepare('SELECT id FROM operations ORDER BY rowid DESC LIMIT 25').all().map(row => {
            const { result, ...summary } = operation(row.id); return summary;
          }),
          publisher: { running: !!publisherService, url: publisherService?.url ?? null, directory: settings.publisherDirectory,
            sourceFile: settings.sourceFile, targetDirectory: settings.targetDirectory },
        };
      },
      closePublisher({ requestId }) { return run('STOP_PUBLISHER', {}, requestId, async () => {
        if (publisherService) { const service = publisherService; await service.close(); if (publisherService === service) publisherService = null; }
        return { running: false };
      }); },
      close() {
        closing ??= (async () => {
          lifetime.abort();
          try { if (pending) await pending.completion.catch(() => {}); if (publisherService) await publisherService.close(); }
          finally { closed = true; db.close(); await release(); }
        })();
        return closing;
      },
    };
  } catch (issue) { try { db?.close(); } finally { await release(); } throw issue; }
}
