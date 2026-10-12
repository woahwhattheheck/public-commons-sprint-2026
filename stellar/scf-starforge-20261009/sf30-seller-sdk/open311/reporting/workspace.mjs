// MIT. Durable reporting editions, atomic revision checks and complete receiving.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../domain.mjs';
import { fail, copy, digest, object, label, instant } from './calendar.mjs';
import { validateSource, normalizeProfile, buildReport, validateReport, compareReports, validateReview, incorporateReview, reviewTemplate } from './domain.mjs';
import { reportCsv, reportHtml } from './render.mjs';

export const WORKSPACE_SCHEMA = 'commons.open311.reporting-workspace.v1';
const DATABASE_SCHEMA = 'commons.open311.reporting-database.v1';
const now = () => new Date().toISOString();
const parse = value => JSON.parse(value);
function mutation(input) {
  object(input, 'Action'); label(input.requestId, 'Stable request ID', 200);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    fail('EXPECTED_REVISION_REQUIRED', 'Supply the revision observed before this action.');
  return copy(input);
}
export function openWorkspace(directory, { create = true } = {}) {
  directory = resolve(label(directory, 'Workspace directory', 4096));
  const filename = join(directory, 'open311-reporting.sqlite');
  if (!existsSync(filename) && !create) fail('WORKSPACE_NOT_FOUND', 'Initialize or receive a reporting workspace first.', 404);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  directory = realpathSync(directory);
  const db = new DatabaseSync(join(directory, 'open311-reporting.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
  const hasMetadata = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reporting_meta'").get();
  if (!hasMetadata()) {
    try {
      db.exec('BEGIN IMMEDIATE');
      if (!hasMetadata()) {
        const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        if (existing.length) fail('WRONG_WORKSPACE_DATABASE', 'This database belongs to a different application.');
        db.exec('CREATE TABLE reporting_meta(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);' +
          'CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));' +
          'CREATE TABLE operations(request_id TEXT PRIMARY KEY,kind TEXT NOT NULL,input_sha TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);');
        db.prepare('INSERT INTO reporting_meta VALUES(1,?)').run(canonicalJson({ schema: DATABASE_SCHEMA, workspaceId: randomUUID(), revision: 0, createdAt: now(), updatedAt: now(), receivedFrom: [], archivedOperations: [] }));
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} db.close(); throw e; }
  }
  const metadata = () => parse(db.prepare('SELECT value FROM reporting_meta WHERE id=1').get().value);
  if (metadata().schema !== DATABASE_SCHEMA) { db.close(); fail('UNSUPPORTED_WORKSPACE', 'This reporting database version is unsupported.'); }
  const all = kind => db.prepare('SELECT value FROM records WHERE kind=? ORDER BY id').all(kind).map(r => parse(r.value));
  const get = (kind, id) => {
    const row = db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id);
    if (!row) fail('RECORD_NOT_FOUND', kind + ' ' + id + ' was not found.', 404);
    return parse(row.value);
  };
  const find = (kind, id) => {
    const row = db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? parse(row.value) : null;
  };
  const save = (kind, id, value) => db.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?)').run(kind, id, canonicalJson(value));
  const replace = (kind, id, value) => db.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind, id, canonicalJson(value));
  function transaction(action, write = false) {
    db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }
  function state() {
    return transaction(() => {
      const m = metadata();
      return { schema: WORKSPACE_SCHEMA, directory, workspaceId: m.workspaceId, revision: m.revision, createdAt: m.createdAt, updatedAt: m.updatedAt,
        receivedFrom: m.receivedFrom,
        sources: all('source').map(s => ({ id: s.id, sha256: s.sha256, bytes: s.bytes, identity: s.identity,
          name: s.envelope.collection.name, connection: s.envelope.collection.connection, summary: s.envelope.summary, importedAt: s.importedAt })),
        profiles: all('profile'),
        reports: all('report').map(r => ({ id: r.id, sha256: r.sha256, name: r.definition.name, seriesId: r.seriesId, predecessorId: r.predecessorId,
          createdAt: r.createdAt, definition: r.definition, totals: r.totals })),
        series: all('head'),
        reviews: all('review').map(r => ({ id: r.id, sha256: r.sha256, receivedAt: r.receivedAt, reviewer: r.review.reviewer,
          baseReportId: r.review.baseReportId, changes: r.review.changes })),
        operations: db.prepare('SELECT request_id,kind,created_at FROM operations ORDER BY created_at DESC,request_id DESC LIMIT 30').all()
          .map(o => ({ requestId: o.request_id, kind: o.kind, createdAt: o.created_at, state: 'SUCCEEDED' })) };
    });
  }
  function operation(requestId) {
    label(requestId, 'Request ID', 200);
    const row = db.prepare('SELECT * FROM operations WHERE request_id=?').get(requestId);
    if (row) return { requestId, kind: row.kind, state: 'SUCCEEDED', inputSha256: row.input_sha,
      input: parse(row.input), result: parse(row.result), createdAt: row.created_at };
    for (const archive of metadata().archivedOperations) {
      const found = archive.operations.find(o => o.requestId === requestId);
      if (found) return { ...copy(found), originWorkspaceId: archive.workspaceId, archived: true };
    }
    return null;
  }
  function mutate(kind, supplied, action) {
    const input = mutation(supplied), { expectedRevision, ...intent } = input, inputSha = digest({ kind, intent });
    return transaction(() => {
      const old = operation(input.requestId);
      if (old) {
        if (old.archived) fail('ARCHIVED_OPERATION_ID', 'This request ID belongs to a received original operation. Use a new request ID for work in this receiving workspace.', 409, old);
        if (old.kind !== kind || old.inputSha256 !== inputSha) fail('REQUEST_ID_CONFLICT', 'This request ID already names a different action.', 409);
        return old.result;
      }
      const m = metadata();
      if (input.expectedRevision !== m.revision) fail('REVISION_CONFLICT', 'The workspace changed. Refresh the current revision before choosing this action.', 409, { expectedRevision: input.expectedRevision, actualRevision: m.revision });
      const createdAt = now(), result = { ...action(input, { id: 'report-' + digest([m.workspaceId, input.requestId]).slice(0, 24), createdAt }),
        workspaceId: m.workspaceId, revision: m.revision + 1, requestId: input.requestId };
      m.revision++; m.updatedAt = createdAt;
      db.prepare('UPDATE reporting_meta SET value=? WHERE id=1').run(canonicalJson(m));
      db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(input.requestId, kind, inputSha, canonicalJson(input), canonicalJson(result), createdAt);
      return result;
    }, true);
  }
  function importSource(input) {
    return mutate('source-import', input, value => {
      const source = validateSource(value.originalText);
      const existing = all('source').find(s => canonicalJson(s.identity) === canonicalJson(source.identity));
      if (existing && existing.sha256 !== source.sha256) fail('SOURCE_IDENTITY_CONFLICT', 'This original workspace/revision/collection identity already has a different complete file.', 409, { existingSourceId: existing.id, existingSha256: existing.sha256, incomingSha256: source.sha256 });
      if (existing) return { sourceId: existing.id, reused: true };
      source.importedAt = now(); save('source', source.id, source);
      return { sourceId: source.id, reused: false, sourceSha256: source.sha256 };
    });
  }
  function putProfile(input) {
    return mutate('profile-save', input, value => {
      const profile = normalizeProfile(value.profile), key = profile.id + '@' + profile.revision, existing = find('profile', key);
      if (existing && canonicalJson(existing) !== canonicalJson(profile)) fail('PROFILE_EDITION_CONFLICT', 'This profile edition is already retained with different settings. Save a new revision.', 409);
      if (!existing) save('profile', key, profile);
      return { profileId: key, reused: !!existing };
    });
  }
  function build(input) {
    return mutate('report-build', input, (value, identity) => {
      const definition = object(value.definition, 'Report definition'), profile = get('profile', definition.profileId);
      if (!Array.isArray(definition.sourceIds)) fail('SOURCE_SELECTION_REQUIRED', 'Choose source edition IDs.');
      const sources = definition.sourceIds.map(id => get('source', id));
      const report = buildReport(definition, sources, profile, identity), previous = find('head', report.seriesId);
      if (previous) { report.predecessorId = previous.reportId; delete report.sha256; report.sha256 = digest(report); }
      save('report', report.id, report); replace('head', report.seriesId, { id: report.seriesId, reportId: report.id, sha256: report.sha256 });
      return { reportId: report.id, reportSha256: report.sha256, totals: report.totals };
    });
  }
  function importReview(input) {
    return mutate('review-import', input, value => {
      let incoming; try { incoming = JSON.parse(value.originalText); } catch { fail('INVALID_JSON', 'Import the complete reviewer-return JSON file.'); }
      const base = get('report', incoming.baseReportId), review = validateReview(incoming, base);
      const sha256 = digest(value.originalText), id = 'review-' + sha256.slice(0, 24);
      if (!find('review', id)) save('review', id, { id, sha256, originalText: value.originalText, review, receivedAt: now() });
      const head = get('head', base.seriesId), current = get('report', head.reportId);
      return { reviewId: id, baseReportId: base.id, currentReportId: current.id,
        comparison: current.id === base.id ? null : compareReports(base, current) };
    });
  }
  function applyReview(input) {
    return mutate('review-apply', input, (value, identity) => {
      const selected = object(value.selection, 'Review selection'), saved = get('review', selected.reviewId), review = saved.review;
      const base = get('report', review.baseReportId), head = get('head', base.seriesId), current = get('report', head.reportId);
      const already = new Set(current.reviewerHistory.filter(h => h.reviewId === selected.reviewId).flatMap(h => h.changeIds));
      if (selected.changeIds?.some(id => already.has(id))) fail('REVIEW_ALREADY_INCORPORATED', 'A selected review change is already incorporated into the current report series.', 409);
      const report = incorporateReview(base, current, review, selected, identity);
      save('report', report.id, report); replace('head', report.seriesId, { id: report.seriesId, reportId: report.id, sha256: report.sha256 });
      return { reportId: report.id, reportSha256: report.sha256, predecessorId: report.predecessorId };
    });
  }
  function workspaceExport({ reportId = null, expectedRevision } = {}) {
    return transaction(() => {
      const m = metadata();
      if (expectedRevision !== undefined && expectedRevision !== m.revision) fail('REVISION_CONFLICT', 'The export revision changed. Refresh before exporting.', 409);
      if (reportId) get('report', reportId);
      const records = db.prepare('SELECT kind,id,value FROM records ORDER BY kind,id').all().map(r => ({ kind: r.kind, id: r.id, value: parse(r.value) }));
      const operations = db.prepare('SELECT request_id FROM operations ORDER BY created_at,request_id').all().map(o => operation(o.request_id));
      const result = { schema: WORKSPACE_SCHEMA, workspaceId: m.workspaceId, revision: m.revision, createdAt: m.createdAt,
        exportedAt: now(), selectedReportId: reportId, records, operations, receivedFrom: m.receivedFrom, archivedOperations: m.archivedOperations };
      result.sha256 = digest(result); return result;
    });
  }
  function exportFile({ kind, reportId = null, expectedRevision } = {}) {
    if (kind === 'workspace' || kind === 'json') {
      const bundle = workspaceExport({ reportId, expectedRevision });
      return { filename: 'open311-reporting-' + (reportId ?? bundle.workspaceId) + '.json', contentType: 'application/json; charset=utf-8', body: canonicalJson(bundle) + '\n' };
    }
    return transaction(() => {
      if (expectedRevision !== undefined && expectedRevision !== metadata().revision) fail('REVISION_CONFLICT', 'The export revision changed.', 409);
      const report = get('report', reportId);
      if (kind === 'csv') return { filename: report.id + '.csv', contentType: 'text/csv; charset=utf-8', body: reportCsv(report) };
      if (kind === 'html') return { filename: report.id + '.html', contentType: 'text/html; charset=utf-8', body: reportHtml(report) };
      if (kind === 'review') return { filename: report.id + '-review.json', contentType: 'application/json; charset=utf-8', body: JSON.stringify(reviewTemplate(report), null, 2) + '\n' };
      fail('INVALID_EXPORT_KIND', 'Choose json, csv, html, review or workspace.');
    });
  }
  function receive(originalText, control = {}) {
    let bundle; try { bundle = JSON.parse(originalText); } catch { fail('INVALID_JSON', 'Receive a complete reporting workspace JSON package.'); }
    const { sha256, ...body } = object(bundle, 'Receiving package');
    if (bundle.schema !== WORKSPACE_SCHEMA || sha256 !== digest(body)) fail('PACKAGE_HASH_MISMATCH', 'The complete reporting package schema or SHA-256 is invalid.');
    if (!Array.isArray(bundle.records) || !Array.isArray(bundle.operations) || !Array.isArray(bundle.archivedOperations) || !Array.isArray(bundle.receivedFrom))
      fail('INCOMPLETE_REPORTING_PACKAGE', 'The full reporting records and operation histories are required.');
    if (!Number.isSafeInteger(bundle.revision) || bundle.revision < 0) fail('INVALID_PACKAGE_REVISION', 'The original reporting revision is invalid.');
    label(bundle.workspaceId, 'Original reporting workspace ID', 120); instant(bundle.exportedAt, 'Original export time');
    const keys = new Set(), sources = new Map(), profiles = new Map(), reports = new Map(), reviews = new Map(), heads = new Map();
    for (const record of bundle.records) {
      if (!['source', 'profile', 'report', 'review', 'head'].includes(record.kind)) fail('UNSUPPORTED_PACKAGE_RECORD', 'This package contains an unsupported record kind.');
      const key = record.kind + '/' + record.id;
      if (keys.has(key)) fail('DUPLICATE_PACKAGE_RECORD', 'The full reporting package repeats a record.');
      keys.add(key);
      if (record.kind === 'source') {
        const checked = validateSource(record.value.originalText);
        if (checked.id !== record.id || checked.sha256 !== record.value.sha256 ||
            canonicalJson(checked.envelope) !== canonicalJson(record.value.envelope)) fail('SOURCE_RECORD_MISMATCH', 'A source record differs from its exact original file.');
        sources.set(record.id, record.value);
      } else if (record.kind === 'profile') {
        const checked = normalizeProfile(record.value);
        if (record.id !== checked.id + '@' + checked.revision || canonicalJson(checked) !== canonicalJson(record.value)) fail('PROFILE_RECORD_MISMATCH', 'A profile edition is inconsistent.');
        profiles.set(record.id, checked);
      } else if (record.kind === 'report') {
        const checked = validateReport(record.value);
        if (checked.id !== record.id) fail('REPORT_RECORD_MISMATCH', 'A report ID is inconsistent.');
        reports.set(record.id, checked);
      } else if (record.kind === 'review') reviews.set(record.id, record.value);
      else heads.set(record.id, record.value);
    }
    for (const report of reports.values()) {
      if (!profiles.has(report.profileId) || report.sourceIds.some(id => !sources.has(id)) ||
          canonicalJson(report.profile) !== canonicalJson(profiles.get(report.profileId)) ||
          report.predecessorId && !reports.has(report.predecessorId)) fail('INCOMPLETE_REPORTING_PACKAGE', 'The package is missing a report source, profile edition or predecessor.');
      for (const row of report.rows) {
        const source = sources.get(row.sourceId), original = source?.envelope.observations.find(o => o.key === row.key)?.versions.find(v => v.sourceSha256 === row.sourceSha256);
        if (!original || canonicalJson(original.item.source) !== canonicalJson(row.source)) fail('REPORT_SOURCE_MISMATCH', 'A report row does not match its complete original source version.');
      }
    }
    for (const [id, review] of reviews) {
      const base = reports.get(review.review.baseReportId);
      if (!base || id !== review.id || review.sha256 !== digest(review.originalText) ||
          canonicalJson(validateReview(JSON.parse(review.originalText), base)) !== canonicalJson(review.review)) fail('REVIEW_RECORD_MISMATCH', 'A retained review return differs from its complete original file.');
    }
    for (const [id, head] of heads) if (!reports.has(head.reportId) || reports.get(head.reportId).seriesId !== id || reports.get(head.reportId).sha256 !== head.sha256)
      fail('SERIES_HEAD_MISMATCH', 'A report series head does not match its retained edition.');
    if (bundle.selectedReportId && !reports.has(bundle.selectedReportId)) fail('SELECTED_REPORT_MISSING', 'The selected report was not included.');
    const operationIds = new Set();
    for (const op of bundle.operations) {
      if (operationIds.has(op.requestId)) fail('DUPLICATE_OPERATION', 'An original operation ID is repeated.');
      operationIds.add(op.requestId);
      const { expectedRevision, ...intent } = mutation(op.input);
      if (op.requestId !== op.input.requestId || op.inputSha256 !== digest({ kind: op.kind, intent }) || op.state !== 'SUCCEEDED')
        fail('OPERATION_HISTORY_MISMATCH', 'An original operation does not match its retained input.');
    }
    const receiveInput = mutation({ requestId: control.requestId ?? 'receive-' + sha256.slice(0, 32),
      expectedRevision: control.expectedRevision ?? 0, originalText });
    const { expectedRevision: receiveExpected, ...receiveIntent } = receiveInput;
    const receiveHash = digest({ kind: 'workspace-receive', intent: receiveIntent });
    return transaction(() => {
      const prior = operation(receiveInput.requestId);
      if (prior) {
        if (prior.archived || prior.kind !== 'workspace-receive' || prior.inputSha256 !== receiveHash) fail('REQUEST_ID_CONFLICT', 'This receiving request ID names a different original operation.', 409);
        return prior.result;
      }
      const m = metadata();
      if (receiveExpected !== m.revision) fail('REVISION_CONFLICT', 'The receiving workspace changed. Refresh before receiving.', 409);
      if (m.revision !== 0 || db.prepare('SELECT COUNT(*) AS count FROM records').get().count !== 0)
        fail('RECEIVING_WORKSPACE_NOT_EMPTY', 'Receive into a new empty reporting workspace.', 409);
      for (const record of bundle.records) save(record.kind, record.id, record.value);
      m.receivedFrom = [...copy(bundle.receivedFrom), { workspaceId: bundle.workspaceId, revision: bundle.revision,
        packageSha256: sha256, receivedAt: now(), selectedReportId: bundle.selectedReportId }];
      m.archivedOperations = [...copy(bundle.archivedOperations), { workspaceId: bundle.workspaceId, revision: bundle.revision, operations: copy(bundle.operations) }];
      m.revision = 1; m.updatedAt = now();
      db.prepare('UPDATE reporting_meta SET value=? WHERE id=1').run(canonicalJson(m));
      const result = { workspaceId: m.workspaceId, revision: m.revision, requestId: receiveInput.requestId,
        originalWorkspaceId: bundle.workspaceId, originalRevision: bundle.revision,
        packageSha256: sha256, selectedReportId: bundle.selectedReportId, records: bundle.records.length };
      db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(receiveInput.requestId, 'workspace-receive', receiveHash,
        canonicalJson(receiveInput), canonicalJson(result), m.updatedAt);
      return result;
    }, true);
  }
  return { directory, state, operation, importSource, putProfile, build, importReview, applyReview, exportFile, workspaceExport,
    source: id => get('source', id), profile: id => get('profile', id), report: id => get('report', id), review: id => get('review', id),
    compare: (before, after) => compareReports(get('report', before), get('report', after)), receive, close: () => db.close() };
}
export function receiveWorkspace(directory, originalText) {
  const workspace = openWorkspace(directory);
  try { return workspace.receive(originalText); } finally { workspace.close(); }
}
