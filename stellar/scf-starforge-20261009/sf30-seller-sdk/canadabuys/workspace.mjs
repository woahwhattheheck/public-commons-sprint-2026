// MIT. One durable native model for CanadaBuys operators, clients and merchant tools.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WORKSPACE_SCHEMA, PACKAGE_SCHEMA, LEGACY_WORKSPACE_SCHEMA, LEGACY_PACKAGE_SCHEMA, sha256, canonical, failure, plain, text, revision, timestamp,
  selection, compareRows, emptyReview } from './core.mjs';
import { decodeCsv, parseCsv } from './csv.mjs';
import { sourceProvenance, DERIVED_SOURCE_KIND, SOURCE_WORKSPACE_SCHEMA, SOURCE_PACKAGE_SCHEMA } from './source-provenance.mjs';
import { prepareEntries, entryOrder, closingTime, matchProfile, joinKey, SOSA_COLUMNS, sourceSupplierNames, sourceCommodityCodes } from './domain.mjs';
import { renderReport } from './reports.mjs';
import { CanadaBuysBidderDesk, validateDeskEnvelope } from './bidder-desk-workspace.mjs';
export { WORKSPACE_SCHEMA, PACKAGE_SCHEMA, sha256, canonical, failure } from './core.mjs';

function preparedCsv(input, meta = {}) {
  const stream = selection(meta.stream);
  const { bytes, rawText } = decodeCsv(input);
  if (bytes.length > 256 * 1024 * 1024) throw failure('SOURCE_CAPACITY', 'Source exceeds the 256 MiB intake capacity', 413);
  const digest = sha256(bytes);
  if (meta.expectedSha256 !== undefined && meta.expectedSha256 !== digest)
    throw failure('SOURCE_HASH_MISMATCH', 'Source bytes differ from the selected SHA256', 409, { actualSha256: digest });
  const parsed = parseCsv(rawText);
  const has = name => parsed.columns.some(column => column.toLowerCase() === name.toLowerCase());
  if (stream.endsWith('tenders') && (!has('referenceNumber-numeroReference') || !has('solicitationNumber-numeroSollicitation')
      || !has('tenderClosingDate-appelOffresDateCloture')))
    throw failure('TENDER_COLUMNS_REQUIRED', 'Select the complete current CanadaBuys tender CSV', 422, { columns: parsed.columns });
  if (stream === 'awards' && (!has('solicitationNumber-numeroSollicitation') || !has('contractNumber-numeroContrat')))
    throw failure('AWARD_COLUMNS_REQUIRED', 'Select the complete current CanadaBuys award CSV', 422, { columns: parsed.columns });
  if (stream === 'supply-arrangements' && !SOSA_COLUMNS.every(has))
    throw failure('ARRANGEMENT_COLUMNS_REQUIRED', 'Select the complete standing offers and supply arrangements CSV', 422, { columns: parsed.columns });
  const provenance = sourceProvenance(meta, parsed, stream, digest), id = provenance.id;
  const metadata = { id, stream, sha256: digest, bytes: bytes.length, columns: parsed.columns, rowCount: parsed.rows.length,
    label: text(meta.label || stream, 'label', 2048), url: text(meta.url || '', 'url', 8192),
    retrievedAt: timestamp(meta.retrievedAt), ...provenance.metadata,
    response: plain(meta.response) ? meta.response : null };
  return { id, bytes, rawText, metadata, entries: prepareEntries(parsed, metadata) };
}
const stripRow = entry => { const { row, ...rest } = entry; return { ...rest, summary: { ...entry.summary, description: { en: '', fr: '' } } }; };
const dispositions = ['unreviewed', 'reviewing', 'pursue', 'passed'];
const workshareStatuses = ['draft', 'ready', 'partner-review', 'agreed', 'delivering', 'completed', 'passed'];
function reviewFields(patch, current) {
  if (!plain(patch)) throw failure('INVALID_REVIEW', 'Review must be an object');
  const allowed = new Set(['expectedRevision', 'disposition', 'owner', 'nextAction', 'note', 'shortlisted', 'qualification']);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw failure('INVALID_REVIEW_FIELD', 'Unsupported review field: ' + key);
  const next = { ...current };
  for (const name of ['owner', 'nextAction', 'note']) if (Object.hasOwn(patch, name)) next[name] = text(patch[name], name, name === 'note' ? 131072 : 32768);
  if (patch.disposition !== undefined) {
    if (!dispositions.includes(patch.disposition)) throw failure('INVALID_DISPOSITION', 'Choose a supported review disposition', 400, { dispositions });
    next.disposition = patch.disposition;
  }
  if (patch.shortlisted !== undefined) {
    if (typeof patch.shortlisted !== 'boolean') throw failure('INVALID_REVIEW', 'shortlisted must be a boolean');
    next.shortlisted = patch.shortlisted;
  }
  if (patch.qualification !== undefined) {
    const q = patch.qualification;
    if (!plain(q) || !Array.isArray(q.requirements) || q.requirements.length > 1000)
      throw failure('INVALID_QUALIFICATION', 'Qualification needs a requirements array');
    const requirements = q.requirements.map((requirement, index) => {
      if (!plain(requirement) || !['unreviewed', 'met', 'gap', 'not-applicable'].includes(requirement.status))
        throw failure('INVALID_REQUIREMENT', 'Requirement has an invalid review status', 400, { index });
      return { id: text(requirement.id, 'requirement id', 256), requirement: text(requirement.requirement, 'requirement', 32768),
        status: requirement.status, source: text(requirement.source || '', 'requirement source', 8192), note: text(requirement.note || '', 'requirement note', 32768) };
    });
    if (new Set(requirements.map(row => row.id)).size !== requirements.length) throw failure('DUPLICATE_REQUIREMENT', 'Requirement ids must be unique');
    next.qualification = { requirements, ...Object.fromEntries(['capability', 'eligibility', 'commercial', 'timing']
      .map(name => [name, text(q[name] || '', name, 65536)])) };
  }
  return next;
}
function cents(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw failure('INVALID_AMOUNT', name + ' must be nonnegative integer cents');
  return value;
}
function workshareFields(input, current = {}) {
  if (!plain(input)) throw failure('INVALID_WORKSHARE', 'Workshare must be an object');
  const next = { ...current };
  for (const name of ['title', 'partner', 'owner', 'availableFrom', 'scope', 'deliverables', 'partnerResponsibilities',
    'inputs', 'acceptance', 'note']) next[name] = text(input[name] === undefined ? current[name] || '' : input[name], name, 131072);
  next.status = input.status === undefined ? current.status || 'draft' : input.status;
  if (!workshareStatuses.includes(next.status)) throw failure('INVALID_WORKSHARE_STATUS', 'Choose a supported workshare status', 400, { statuses: workshareStatuses });
  next.currency = input.currency === undefined ? current.currency || 'CAD' : text(input.currency, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(next.currency)) throw failure('INVALID_CURRENCY', 'Currency must be a three-letter code');
  next.feeCents = cents(input.feeCents === undefined ? current.feeCents || 0 : input.feeCents, 'feeCents');
  for (const name of ['estimatedHours', 'partnerHours', 'deliveryDays']) {
    next[name] = input[name] === undefined ? current[name] || 0 : input[name];
    if (!Number.isFinite(next[name]) || (name === 'deliveryDays' && !Number.isSafeInteger(next[name])) || next[name] < 0 || next[name] > 1000000)
      throw failure('INVALID_ESTIMATE', name + ' must be a nonnegative finite number');
  }
  for (const name of ['milestones', 'costs']) {
    const rows = input[name] === undefined ? current[name] || [] : input[name];
    if (!Array.isArray(rows) || rows.length > 1000) throw failure('INVALID_WORKSHARE_ROWS', name + ' must be an array');
    next[name] = rows.map(row => {
      if (!plain(row)) throw failure('INVALID_WORKSHARE_ROW', name + ' needs complete rows');
      return { id: text(row.id, name + ' id', 256), title: text(row.title, name + ' title', 32768),
        amountCents: cents(row.amountCents, name + ' amountCents'),
        ...(name === 'milestones' ? { due: text(row.due || '', 'milestone due', 256), acceptance: text(row.acceptance || '', 'milestone acceptance', 32768) } : {}) };
    });
    if (new Set(next[name].map(row => row.id)).size !== next[name].length) throw failure('DUPLICATE_WORKSHARE_ROW', name + ' ids must be unique');
  }
  const sum = rows => rows.reduce((total, row) => {
    const result = total + row.amountCents;
    if (!Number.isSafeInteger(result)) throw failure('AMOUNT_OVERFLOW', 'Combined cents exceed the supported exact amount');
    return result;
  }, 0);
  next.totals = { feeCents: next.feeCents, milestoneCents: sum(next.milestones), costCents: sum(next.costs),
    marginBeforeLaborCents: next.feeCents - sum(next.costs), currency: next.currency };
  return next;
}
export class CanadaBuysWorkspace {
  constructor(directory, { operator = 'operator', title = 'CanadaBuys procurement desk' } = {}) {
    if (typeof directory !== 'string' || !directory.trim()) throw failure('WORKSPACE_REQUIRED', 'Choose a workspace directory');
    this.directory = resolve(text(directory, 'workspace directory', 8192));
    this.operator = text(operator, 'operator', 256);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.databasePath = join(this.directory, 'workspace.sqlite');
    this.db = new DatabaseSync(this.databasePath);
    this.depth = 0; this.closed = false;
    try {
      const exists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get();
      if (exists) {
        const existing = this.db.prepare('SELECT value FROM metadata WHERE id=1').get();
        if (existing && ![WORKSPACE_SCHEMA, SOURCE_WORKSPACE_SCHEMA, LEGACY_WORKSPACE_SCHEMA].includes(JSON.parse(existing.value).schema))
          throw failure('WORKSPACE_VERSION', 'Choose a CanadaBuys workspace directory');
      }
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
      this.db.exec('CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,body BLOB NOT NULL,metadata TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS source_observations(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,source_id TEXT NOT NULL REFERENCES sources(id),stream TEXT NOT NULL,retrieved_at TEXT NOT NULL,data TEXT NOT NULL);'
        + 'CREATE INDEX IF NOT EXISTS source_observation_order ON source_observations(stream,retrieved_at);'
        + 'CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),notice_id TEXT,kind TEXT NOT NULL,solicitation_key TEXT NOT NULL,data TEXT NOT NULL);'
        + 'CREATE INDEX IF NOT EXISTS notice_entries ON entries(notice_id);'
        + 'CREATE INDEX IF NOT EXISTS solicitation_entries ON entries(solicitation_key);'
        + 'CREATE INDEX IF NOT EXISTS kind_entries ON entries(kind);'
        + 'CREATE TABLE IF NOT EXISTS entry_codes(entry_id TEXT NOT NULL REFERENCES entries(id),scheme TEXT NOT NULL,code TEXT NOT NULL,PRIMARY KEY(entry_id,scheme,code));'
        + 'CREATE INDEX IF NOT EXISTS code_entries ON entry_codes(scheme,code,entry_id);'
        + 'CREATE TABLE IF NOT EXISTS entry_supplier_names(entry_id TEXT NOT NULL REFERENCES entries(id),name_key TEXT NOT NULL,PRIMARY KEY(entry_id,name_key));'
        + 'CREATE INDEX IF NOT EXISTS supplier_entries ON entry_supplier_names(name_key,entry_id);'
        + 'CREATE TABLE IF NOT EXISTS reviews(notice_id TEXT PRIMARY KEY,data TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS workshares(id TEXT PRIMARY KEY,notice_id TEXT NOT NULL,data TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS workshare_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,data TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS receiving(id TEXT PRIMARY KEY,data TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,data TEXT NOT NULL);'
        + 'CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
      const at = new Date().toISOString();
      this.db.prepare('INSERT OR IGNORE INTO metadata(id,value) VALUES(1,?)').run(JSON.stringify({
        schema: WORKSPACE_SCHEMA, id: randomUUID(), title: text(title, 'title', 1024), revision: 0, createdAt: at, updatedAt: at
      }));
      if (Number(this.db.prepare('PRAGMA user_version').get().user_version) < 1) {
        const insertCode = this.db.prepare('INSERT OR IGNORE INTO entry_codes(entry_id,scheme,code) VALUES(?,?,?)');
        const insertName = this.db.prepare('INSERT OR IGNORE INTO entry_supplier_names(entry_id,name_key) VALUES(?,?)');
        this.db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of this.db.prepare('SELECT id,data FROM entries').iterate()) {
            const entry = JSON.parse(row.data);
            for (const {scheme,code} of sourceCommodityCodes(entry.summary)) insertCode.run(entry.id,scheme,code);
            for (const name of sourceSupplierNames(entry.summary)) insertName.run(entry.id,joinKey(name));
          }
          this.db.exec('PRAGMA user_version=1; COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }
      // Schema v2 retains bidder records. Older clients reject this schema instead of exporting an incomplete package.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.bidderDesk = new CanadaBuysBidderDesk(this);
        const metadata = this.metadata();
        if (metadata.schema === LEGACY_WORKSPACE_SCHEMA) {
          const updated = { ...metadata, schema: WORKSPACE_SCHEMA, revision: metadata.revision + 1, updatedAt: new Date().toISOString() };
          this.db.prepare('UPDATE metadata SET value=? WHERE id=1').run(JSON.stringify(updated));
          this.db.prepare('INSERT INTO audit(data) VALUES(?)').run(JSON.stringify({
            id: randomUUID(), type: 'workspace.schema.migrated', revision: updated.revision,
            at: updated.updatedAt, operator: this.operator, from: LEGACY_WORKSPACE_SCHEMA, to: WORKSPACE_SCHEMA
          }));
        }
        this.db.exec('PRAGMA user_version=' + (this.metadata().schema === SOURCE_WORKSPACE_SCHEMA ? 3 : 2) + '; COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      chmodSync(this.databasePath, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }
  metadata() { return JSON.parse(this.db.prepare('SELECT value FROM metadata WHERE id=1').get().value); }
  _snapshot(callback) {
    if (this.depth) return callback();
    this.db.exec('BEGIN'); this.depth++;
    try { const result = callback(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.depth--; }
  }
  _change(type, expectedRevision, callback) {
    if (this.depth) throw failure('TRANSACTION_IN_PROGRESS', 'Finish the current operation before changing the workspace', 409);
    this.db.exec('BEGIN IMMEDIATE'); this.depth++;
    try {
      const metadata = this.metadata();
      if (expectedRevision !== null) revision(expectedRevision, metadata.revision);
      const result = callback(metadata);
      const updated = { ...metadata, schema: this.metadata().schema, revision: metadata.revision + 1, updatedAt: new Date().toISOString() };
      this.db.prepare('UPDATE metadata SET value=? WHERE id=1').run(JSON.stringify(updated));
      this.db.prepare('INSERT INTO audit(data) VALUES(?)').run(JSON.stringify({
        id: randomUUID(), type, revision: updated.revision, at: updated.updatedAt, operator: this.operator, ...result.audit,
        ...(updated.schema !== metadata.schema ? { sourceSchemaUpgrade: { from: metadata.schema, to: updated.schema } } : {})
      }));
      this.db.exec('COMMIT'); return { ...result.value, workspace: updated };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.depth--; }
  }
  _entries() { return this.db.prepare('SELECT data FROM entries ORDER BY rowid').all().map(row => JSON.parse(row.data)); }
  _review(id) { const row = this.db.prepare('SELECT data FROM reviews WHERE notice_id=?').get(id); return row ? JSON.parse(row.data) : emptyReview(); }
  _observations() { return this.db.prepare('SELECT data FROM source_observations ORDER BY sequence').all().map(row => JSON.parse(row.data)); }
  _latestOpen() {
    const row = this.db.prepare("SELECT data FROM source_observations WHERE stream='open-tenders' ORDER BY retrieved_at DESC,sequence DESC LIMIT 1").get();
    if (row) { const observation = JSON.parse(row.data); return { ...observation, observationId: observation.id, id: observation.sourceId }; }
    const sources = this.db.prepare('SELECT metadata FROM sources').all().map(row => JSON.parse(row.metadata));
    return sources.filter(source => source.stream === 'open-tenders').sort((a,b) => b.retrievedAt.localeCompare(a.retrievedAt))[0] || null;
  }
  _observe(observation) {
    if (!plain(observation) || typeof observation.sourceId !== 'string')
      throw failure('INVALID_SOURCE_OBSERVATION', 'Source observation must identify its complete original source');
    const source = this.db.prepare('SELECT metadata FROM sources WHERE id=?').get(observation.sourceId);
    if (!source) throw failure('OBSERVATION_SOURCE_REQUIRED', 'Source observation requires its complete retained source');
    const metadata = JSON.parse(source.metadata);
    if (!plain(observation) || !/^observation-[a-f0-9-]{36}$/.test(observation.id || '') ||
        observation.stream !== metadata.stream || observation.sha256 !== metadata.sha256 ||
        observation.bytes !== metadata.bytes || observation.rowCount !== metadata.rowCount)
      throw failure('INVALID_SOURCE_OBSERVATION', 'Source observation differs from its complete retained source');
    timestamp(observation.retrievedAt); timestamp(observation.observedAt);
    const old = this.db.prepare('SELECT data FROM source_observations WHERE id=?').get(observation.id);
    if (old && canonical(JSON.parse(old.data)) !== canonical(observation))
      throw failure('SOURCE_OBSERVATION_CHANGED', 'The same source observation has different contents', 409);
    if (!old) this.db.prepare('INSERT INTO source_observations(id,source_id,stream,retrieved_at,data) VALUES(?,?,?,?,?)')
      .run(observation.id, observation.sourceId, observation.stream, observation.retrievedAt, JSON.stringify(observation));
    return observation;
  }
  _ingest(prepared, allowedIds = null, { observe = true } = {}) {
    if (prepared.metadata.bodyKind === DERIVED_SOURCE_KIND) {
      if (!this.depth) throw failure('TRANSACTION_REQUIRED', 'Derived source adoption requires the original workspace transaction', 409);
      const metadata = this.metadata();
      if (metadata.schema !== SOURCE_WORKSPACE_SCHEMA) {
        this.db.prepare('UPDATE metadata SET value=? WHERE id=1').run(JSON.stringify({ ...metadata, schema: SOURCE_WORKSPACE_SCHEMA }));
        this.db.exec('PRAGMA user_version=3');
      }
    }
    const old = this.db.prepare('SELECT metadata FROM sources WHERE id=?').get(prepared.id);
    if (old) {
      const retained = JSON.parse(old.metadata);
      if (retained.sha256 !== prepared.metadata.sha256 || retained.bytes !== prepared.bytes.length ||
          ['bodyKind','coverage','derivationSha256','derivation'].some(key => canonical(retained[key]) !== canonical(prepared.metadata[key])))
        throw failure('SOURCE_IDENTITY_CHANGED', 'Source identity differs from retained bytes', 409);
    } else this.db.prepare('INSERT INTO sources(id,body,metadata) VALUES(?,?,?)')
      .run(prepared.id, prepared.bytes, JSON.stringify(prepared.metadata));
    const insert = this.db.prepare('INSERT OR IGNORE INTO entries(id,source_id,notice_id,kind,solicitation_key,data) VALUES(?,?,?,?,?,?)');
    const insertCode = this.db.prepare('INSERT OR IGNORE INTO entry_codes(entry_id,scheme,code) VALUES(?,?,?)');
    const insertName = this.db.prepare('INSERT OR IGNORE INTO entry_supplier_names(entry_id,name_key) VALUES(?,?)');
    let entriesAdded = 0;
    for (const entry of prepared.entries) {
      if (allowedIds && !allowedIds.has(entry.id)) continue;
      const added = Number(insert.run(entry.id, entry.sourceId, entry.noticeId, entry.kind, entry.solicitationKey, JSON.stringify(entry)).changes);
      entriesAdded += added;
      if (added) {
        for (const {scheme,code} of sourceCommodityCodes(entry.summary)) insertCode.run(entry.id,scheme,code);
        for (const name of sourceSupplierNames(entry.summary)) insertName.run(entry.id,joinKey(name));
      }
    }
    const observation = observe ? this._observe({
      id: 'observation-' + randomUUID(), sourceId: prepared.id, stream: prepared.metadata.stream,
      sha256: prepared.metadata.sha256, bytes: prepared.bytes.length, rowCount: prepared.entries.length,
      retrievedAt: prepared.metadata.retrievedAt, observedAt: new Date().toISOString(),
      label: prepared.metadata.label, url: prepared.metadata.url, response: prepared.metadata.response
    }) : null;
    return { sourceId: prepared.id, sourceAdded: !old, entriesAdded, rowCount: prepared.entries.length,
      ...(observation ? { observationId: observation.id } : {}) };
  }
  importCsv(input, meta = {}, expectedRevision) {
    revision(expectedRevision, this.metadata().revision);
    const prepared = preparedCsv(input, meta);
    const result = this._change('source.imported', expectedRevision, () => {
      const ingestion = this._ingest(prepared);
      return { value: { ingestion }, audit: { ...ingestion, stream: prepared.metadata.stream, sha256: prepared.metadata.sha256 } };
    });
    return { ...this.view(), ingestion: result.ingestion };
  }
  getSource(id, { includeBody = true } = {}) {
    return this._snapshot(() => {
      const stored = this.db.prepare('SELECT body,metadata FROM sources WHERE id=?').get(id);
      if (!stored) throw failure('SOURCE_NOT_FOUND', 'Source does not exist', 404);
      const metadata = JSON.parse(stored.metadata), body = Buffer.from(stored.body);
      if (body.length !== metadata.bytes || sha256(body) !== metadata.sha256)
        throw failure('SOURCE_CHANGED', 'Retained original source bytes changed', 409);
      if (metadata.bodyKind === DERIVED_SOURCE_KIND || metadata.derivation !== undefined) {
        const checked = preparedCsv(body, { ...metadata, expectedSha256: metadata.sha256 });
        if (checked.id !== id || canonical(checked.metadata) !== canonical(metadata))
          throw failure('SOURCE_CHANGED', 'Retained derived source provenance differs from its original complete evidence', 409);
      }
      const entryIds = this.db.prepare('SELECT id FROM entries WHERE source_id=? ORDER BY rowid').all(id).map(row => row.id);
      return { ...metadata, entryIds, observations: this.db.prepare('SELECT data FROM source_observations WHERE source_id=? ORDER BY sequence').all(id).map(row => JSON.parse(row.data)), ...(includeBody ? { rawText: decodeCsv(body).rawText } : {}) };
    });
  }
  getEntry(id) {
    const row = this.db.prepare('SELECT data FROM entries WHERE id=?').get(id);
    if (!row) throw failure('ENTRY_NOT_FOUND', 'Source edition does not exist', 404);
    return JSON.parse(row.data);
  }
  _notice(id, entries, latestOpen) {
    const history = entries.filter(entry => entry.noticeId === id).sort(entryOrder);
    if (!history.length) throw failure('NOTICE_NOT_FOUND', 'Notice does not exist', 404);
    const current = history[0], summary = { ...current.summary, closing: closingTime(current.summary.closing.raw) };
    return { id, summary, entries: history.map(stripRow), review: this._review(id),
      presentInLatestOpenFeed: latestOpen ? history.some(entry => entry.sourceId === latestOpen.id) : null };
  }
  view() {
    return this._snapshot(() => {
      const metadata = this.metadata();
      // Index views use source summaries; complete original rows remain in notice detail and export.
      const entries = this.db.prepare("SELECT json_remove(data, '$.row') AS data FROM entries WHERE kind='tender' ORDER BY rowid").iterate();
      const sources = this.db.prepare('SELECT metadata FROM sources ORDER BY rowid').all().map(row => JSON.parse(row.metadata));
      const latestOpen = this._latestOpen();
      const groups = new Map();
      for (const record of entries) {
        const entry = JSON.parse(record.data);
        if (!groups.has(entry.noticeId)) groups.set(entry.noticeId, []);
        groups.get(entry.noticeId).push(entry);
      }
      const notices = [...groups].map(([id, history]) => this._notice(id, history, latestOpen));
      const list = table => this.db.prepare('SELECT data FROM ' + table + ' ORDER BY rowid').all().map(row => JSON.parse(row.data));
      return { schema: metadata.schema, workspace: metadata, revision: metadata.revision, sources, sourceObservations: this._observations(), latestOpenObservation: latestOpen, notices,
        workshares: list('workshares'), captures: list('captures').map(capture => { const { rawText, rawBase64, ...summary } = this.getCapture(capture.id); return { ...summary, retainedBodyBytes: rawBase64 ? Buffer.from(rawBase64, 'base64').length : rawText === undefined ? 0 : Buffer.byteLength(rawText) }; }), receivings: list('receiving'), publications: list('publications'),
        counts: { notices: notices.length, awards: Number(this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE kind='award'").get().n),
          supplyArrangements: Number(this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE kind='arrangement'").get().n), sources: sources.length } };
    });
  }
  getNotice(id) {
    return this._snapshot(() => {
      const entries = this.db.prepare('SELECT data FROM entries WHERE notice_id=? ORDER BY rowid').all(id).map(row => JSON.parse(row.data));
      const latestOpen = this._latestOpen();
      const notice = this._notice(id, entries, latestOpen);
      const history = entries.filter(entry => entry.noticeId === id).sort(entryOrder), currentEntry = history[0];
      const solicitationEntries = new Map();
      for (const entry of history) if (entry.solicitationKey) {
        if (!solicitationEntries.has(entry.solicitationKey)) solicitationEntries.set(entry.solicitationKey, []);
        solicitationEntries.get(entry.solicitationKey).push(entry);
      }
      const awardCandidates = [...new Map([...solicitationEntries.keys()].flatMap(key =>
        this.db.prepare("SELECT data FROM entries WHERE kind='award' AND solicitation_key=?").all(key)
          .map(row => { const entry = JSON.parse(row.data); return [entry.id,entry]; }))).values()];
      const awards = awardCandidates
        .map(entry => ({
          ...entry, match: { basis: 'exact-solicitation-number', value: entry.summary.solicitationNumber,
            matchedNoticeEntryIds: solicitationEntries.get(entry.solicitationKey).map(original => original.id),
            buyerMatches: solicitationEntries.get(entry.solicitationKey).some(original =>
              ['en','fr'].some(language => joinKey(entry.summary.buyer[language]) &&
                joinKey(entry.summary.buyer[language]) === joinKey(original.summary.buyer[language]))),
            status: 'candidate', sourceEntryId: entry.id }
        }));
      const supplierKeys = new Set(awards.flatMap(entry => [entry.summary.supplier, entry.summary.supplierNames.en, entry.summary.supplierNames.fr]).map(joinKey).filter(Boolean));
      const arrangementIds = new Set();
      for (const key of solicitationEntries.keys())
        for (const row of this.db.prepare("SELECT id FROM entries WHERE kind='arrangement' AND solicitation_key=?").all(key)) arrangementIds.add(row.id);
      for (const key of supplierKeys)
        for (const row of this.db.prepare("SELECT e.id FROM entry_supplier_names n JOIN entries e ON e.id=n.entry_id WHERE e.kind='arrangement' AND n.name_key=?").all(key)) arrangementIds.add(row.id);
      for (const [field,scheme] of [['commodityCodes','GSIN'],['unspsc','UNSPSC']])
        for (const code of currentEntry.summary[field])
          for (const candidateScheme of [scheme, 'SOSA:unspecified'])
            for (const row of this.db.prepare("SELECT e.id FROM entry_codes c JOIN entries e ON e.id=c.entry_id WHERE e.kind='arrangement' AND c.scheme=? AND c.code=?").all(candidateScheme,code)) arrangementIds.add(row.id);
      const supplyArrangements = [...arrangementIds].map(id => this.getEntry(id)).flatMap(entry => {
        const evidence = [];
        if (entry.solicitationKey && solicitationEntries.has(entry.solicitationKey))
          evidence.push({ basis: 'exact-solicitation-number', value: entry.summary.solicitationNumber,
            matchedNoticeEntryIds: solicitationEntries.get(entry.solicitationKey).map(original => original.id) });
        const suppliers = sourceSupplierNames(entry.summary);
        for (const supplier of suppliers) if (supplierKeys.has(joinKey(supplier)))
          evidence.push({ basis: 'award-supplier-name', value: supplier });
        for (const [field, scheme] of [['unspsc','UNSPSC'],['commodityCodes','GSIN']]) {
          const common = entry.summary[field].filter(code => currentEntry.summary[field].includes(code));
          if (common.length) evidence.push({ basis: 'exact-commodity-code-overlap', scheme, values: common });
          const sourceValues = (entry.summary.arrangement?.commodity.codes || []).filter(code => currentEntry.summary[field].includes(code));
          if (sourceValues.length) evidence.push({ basis: 'source-commodity-value-overlap', sourceScheme: 'unspecified',
            noticeScheme: scheme, values: sourceValues, requiresSchemeConfirmation: true,
            description: 'The original code values match; the SOSA dictionary does not identify their classification scheme.' });
        }
        return evidence.length ? [{ ...entry, match: { status: 'candidate', evidence } }] : [];
      });
      const contractGroups = new Map();
      for (const award of awards) {
        const key = award.summary.contractNumber || award.summary.referenceNumber || award.id;
        if (!contractGroups.has(key)) contractGroups.set(key, []); contractGroups.get(key).push(award);
      }
      const awardGroups = [...contractGroups].map(([contractNumber, editions]) => ({ contractNumber,
        current: [...editions].sort(entryOrder)[0], editions, cumulativeValuesAreNotSummed: true }));
      return { ...notice, currentEntry, history, awards, awardGroups, supplyArrangements,
        workshares: this.db.prepare('SELECT data FROM workshares WHERE notice_id=? ORDER BY rowid').all(id).map(row => JSON.parse(row.data)) };
    });
  }
  compare(beforeId, afterId) {
    return this._snapshot(() => {
      const before = this.getEntry(beforeId), after = this.getEntry(afterId);
      return { before: stripRow(before), after: stripRow(after), sameNotice: before.noticeId !== null && before.noticeId === after.noticeId,
        changes: compareRows(before.row, after.row) };
    });
  }
  updateReview(id, patch) {
    const result = this._change('notice.reviewed', null, () => {
      this.getNotice(id); const current = this._review(id);
      revision(patch?.expectedRevision, current.revision, 'notice review');
      const updated = { ...reviewFields(patch, current), revision: current.revision + 1, updatedAt: new Date().toISOString(), operator: this.operator };
      this.db.prepare('INSERT INTO reviews(notice_id,data) VALUES(?,?) ON CONFLICT(notice_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(updated));
      return { value: { review: updated }, audit: { noticeId: id, previousRevision: current.revision, review: updated } };
    });
    return { ...this.getNotice(id), workspace: result.workspace };
  }
  createWorkshare(input, expectedRevision) {
    const result = this._change('workshare.created', expectedRevision, () => {
      const notice = this.getNotice(text(input.noticeId, 'noticeId', 256)), id = 'workshare-' + randomUUID(), at = new Date().toISOString();
      const record = { ...workshareFields(input), id, noticeId: notice.id, revision: 1, createdAt: at, updatedAt: at, operator: this.operator,
        sourceContext: { entryId: notice.currentEntry.id, sourceId: notice.currentEntry.sourceId,
          rowSha256: notice.currentEntry.rowSha256, summary: notice.currentEntry.summary } };
      this.db.prepare('INSERT INTO workshares(id,notice_id,data) VALUES(?,?,?)').run(id, notice.id, JSON.stringify(record));
      this.db.prepare('INSERT INTO workshare_history(id,data) VALUES(?,?)').run(id, JSON.stringify(record));
      return { value: { workshare: record }, audit: { workshareId: id, noticeId: notice.id, revision: 1 } };
    });
    return result;
  }
  getWorkshare(id) {
    return this._snapshot(() => {
      const row = this.db.prepare('SELECT data FROM workshares WHERE id=?').get(id);
      if (!row) throw failure('WORKSHARE_NOT_FOUND', 'Workshare does not exist', 404);
      return { ...JSON.parse(row.data), history: this.db.prepare('SELECT data FROM workshare_history WHERE id=? ORDER BY sequence')
        .all(id).map(record => JSON.parse(record.data)) };
    });
  }
  updateWorkshare(id, patch) {
    return this._change('workshare.updated', null, () => {
      const current = this.getWorkshare(id); revision(patch?.expectedRevision, current.revision, 'workshare');
      if (patch.noticeId !== undefined && patch.noticeId !== current.noticeId)
        throw failure('WORKSHARE_NOTICE_CHANGED', 'Create a separate workshare for another notice', 409);
      const { history, ...original } = current;
      const record = { ...workshareFields(patch, original), revision: current.revision + 1, updatedAt: new Date().toISOString(), operator: this.operator };
      this.db.prepare('UPDATE workshares SET data=? WHERE id=?').run(JSON.stringify(record), id);
      this.db.prepare('INSERT INTO workshare_history(id,data) VALUES(?,?)').run(id, JSON.stringify(record));
      return { value: { workshare: record }, audit: { workshareId: id, revision: record.revision } };
    });
  }
  qualify(profile = {}, at = Date.now()) {
    return this._snapshot(() => ({ profile, results: this.view().notices.map(notice => matchProfile(notice, profile, at)) }));
  }
  _selected({ scope = 'all', noticeIds = [] } = {}) {
    if (!['all', 'shortlist', 'selected'].includes(scope)) throw failure('INVALID_SCOPE', 'Choose all, shortlist or selected');
    if (!Array.isArray(noticeIds) || noticeIds.some(id => typeof id !== 'string')) throw failure('INVALID_SELECTION', 'noticeIds must be an array of identities');
    const view = this.view();
    const selected = view.notices.filter(notice => noticeIds.length ? noticeIds.includes(notice.id) : scope === 'shortlist' ? notice.review.shortlisted : scope === 'selected' ? false : true);
    const missing = noticeIds.filter(id => !selected.some(notice => notice.id === id));
    if (missing.length) throw failure('NOTICE_NOT_FOUND', 'Selected notices do not exist', 404, { missing });
    return { view, notices: selected };
  }
  report(options = {}) {
    return this._snapshot(() => {
      const { view, notices } = this._selected(options);
      return renderReport({ workspace: view.workspace, sources: view.sources, notices: notices.map(notice => this.getNotice(notice.id)),
        workshares: view.workshares.filter(workshare => notices.some(notice => notice.id === workshare.noticeId)) }, options);
    });
  }
  exportPackage(options = {}) {
    return this._snapshot(() => {
      if (options.expectedRevision !== undefined) revision(options.expectedRevision, this.metadata().revision);
      const { view, notices } = this._selected(options), ids = new Set(notices.map(notice => notice.id));
      const allSelected = (!options.scope || options.scope === 'all') && !(options.noticeIds || []).length;
      const selectedEntries = allSelected ? this._entries() : notices.flatMap(notice => {
        const detail = this.getNotice(notice.id); return [...detail.history, ...detail.awards, ...detail.supplyArrangements];
      });
      const entryIds = new Set(selectedEntries.map(entry => entry.id)), sourceIds = new Set(selectedEntries.map(entry => entry.sourceId));
      if (allSelected) for (const source of view.sources) sourceIds.add(source.id);
      if (view.latestOpenObservation && ids.size) sourceIds.add(view.latestOpenObservation.id);
      const sourceObservations = view.sourceObservations.filter(observation => sourceIds.has(observation.sourceId));
      const captures = this.db.prepare('SELECT data FROM captures ORDER BY rowid').all().map(row => JSON.parse(row.data));
      const workshares = view.workshares.filter(workshare => ids.has(workshare.noticeId)).map(workshare => this.getWorkshare(workshare.id));
      const relevantCaptures = allSelected ? captures : captures.filter(capture => capture.status === 'complete' && sourceIds.has(capture.sourceId));
      const publications = allSelected ? view.publications : view.publications.filter(publication =>
        Array.isArray(publication.noticeIds) && publication.noticeIds.length &&
        publication.noticeIds.every(id => ids.has(id)));
      // A selected delivery carries its selected current decisions and full workshare editions.
      // Cross-workspace receiving records are represented by selected provenance references.
      const receivingHistory = allSelected ? view.receivings : view.receivings.filter(receiving =>
        receiving.ingestion.some(item => sourceIds.has(item.sourceId))).map(receiving => ({
          packageId: receiving.packageId, receivedAt: receiving.receivedAt, operator: receiving.operator,
          sourceWorkspaceId: receiving.sourceWorkspace?.id || receiving.sourceWorkspaceId || null,
          ingestion: receiving.ingestion.filter(item => sourceIds.has(item.sourceId)), projection: 'selected-source-provenance'
        }));
      const body = { schema: view.workspace.schema === SOURCE_WORKSPACE_SCHEMA ? SOURCE_PACKAGE_SCHEMA : PACKAGE_SCHEMA, exportedAt: new Date().toISOString(), workspace: view.workspace,
        selection: { scope: options.scope || 'all', noticeIds: [...ids] },
        sources: [...sourceIds].map(id => { const { observations, ...source } = this.getSource(id);
          return { ...source, entryIds: source.entryIds.filter(entryId => entryIds.has(entryId)) }; }),
        sourceObservations, reviews: notices.map(notice => ({ noticeId: notice.id, review: notice.review })),
        workshares, captures: relevantCaptures, publications, receivingHistory,
        bidderDesk: this.bidderDesk.exportData({ noticeIds: [...ids], all: allSelected }),
        provenance: { mode: allSelected ? 'full-workspace' : 'selected-workspace',
          sourceCount: sourceIds.size, noticeCount: ids.size, workshareCount: workshares.length,
          omittedCaptureCount: captures.length - relevantCaptures.length,
          omittedPublicationCount: view.publications.length - publications.length,
          receivingHistory: allSelected ? 'complete' : 'selected-source-references' } };
      return { ...body, packageId: sha256(canonical(body)) };
    });
  }
  _receivedWorkshare(input, selectedNoticeIds) {
    if (!plain(input) || !/^workshare-[a-f0-9-]{36}$/.test(input.id || '') ||
        !selectedNoticeIds.has(input.noticeId) || !Number.isSafeInteger(input.revision) || input.revision < 1)
      throw failure('INVALID_PACKAGE_WORKSHARE', 'Incoming workshare requires its original identity, revision and selected notice');
    const context = input.sourceContext;
    if (!plain(context)) throw failure('WORKSHARE_SOURCE_REQUIRED', 'Workshare needs its original source edition');
    const source = this.getEntry(context.entryId);
    if (source.noticeId !== input.noticeId || source.sourceId !== context.sourceId ||
        source.rowSha256 !== context.rowSha256 || canonical(source.summary) !== canonical(context.summary))
      throw failure('WORKSHARE_SOURCE_CHANGED', 'Workshare source context differs from its exact original notice edition', 409);
    const record = { ...workshareFields(input), id: input.id, noticeId: input.noticeId, revision: input.revision,
      createdAt: timestamp(input.createdAt, 'workshare createdAt'), updatedAt: timestamp(input.updatedAt, 'workshare updatedAt'),
      operator: text(input.operator, 'workshare operator', 256),
      sourceContext: { entryId: source.id, sourceId: source.sourceId, rowSha256: source.rowSha256, summary: source.summary } };
    if (canonical(record) !== canonical(input))
      throw failure('WORKSHARE_EDITION_CHANGED', 'Incoming workshare edition differs from the complete native record', 409);
    return record;
  }
  receivePackage(packet, { expectedRevision } = {}) {
    if (!plain(packet) || ![PACKAGE_SCHEMA, SOURCE_PACKAGE_SCHEMA, LEGACY_PACKAGE_SCHEMA].includes(packet.schema) || !Array.isArray(packet.sources) ||
        !Array.isArray(packet.reviews) || !Array.isArray(packet.workshares))
      throw failure('INVALID_PACKAGE', 'Select a complete CanadaBuys workspace package', 422);
    const { packageId, ...body } = packet;
    if (typeof packageId !== 'string' || sha256(canonical(body)) !== packageId) throw failure('PACKAGE_HASH_MISMATCH', 'Package identity does not match its complete contents', 409);
    const prior = this.db.prepare('SELECT data FROM receiving WHERE id=?').get(packageId);
    if (prior) return { receiving: JSON.parse(prior.data), workspace: this.metadata(), alreadyReceived: true };
    if ([PACKAGE_SCHEMA, SOURCE_PACKAGE_SCHEMA].includes(packet.schema)) validateDeskEnvelope(packet.bidderDesk);
    else if (packet.bidderDesk !== undefined) throw failure('PACKAGE_VERSION_MISMATCH', 'Bidder records require a v2 CanadaBuys package', 422);
    const prepared = packet.sources.map(source => {
      if (!plain(source) || !Array.isArray(source.entryIds)) throw failure('INVALID_SOURCE_PACKAGE', 'Every source needs original bytes and selected entry identities', 422);
      if (packet.schema !== SOURCE_PACKAGE_SCHEMA &&
          (source.bodyKind === DERIVED_SOURCE_KIND || source.derivation !== undefined || source.derivationSha256 !== undefined))
        throw failure('PACKAGE_VERSION_MISMATCH', 'Separately derived notice evidence requires a v3 CanadaBuys package', 422);
      const result = preparedCsv(source.rawText, { ...source, expectedSha256: source.sha256 });
      if (result.id !== source.id || result.bytes.length !== source.bytes || result.metadata.rowCount !== source.rowCount ||
          result.metadata.bodyKind === DERIVED_SOURCE_KIND &&
          ['columns','bodyKind','coverage','derivation','derivationSha256','url','retrievedAt','label','response'].some(key => canonical(result.metadata[key]) !== canonical(source[key])))
        throw failure('SOURCE_PACKAGE_MISMATCH', 'Packaged source metadata differs from its original CSV', 409);
      const ids = new Set(result.entries.map(entry => entry.id));
      if (new Set(source.entryIds).size !== source.entryIds.length || source.entryIds.some(id => !ids.has(id)))
        throw failure('ENTRY_PACKAGE_MISMATCH', 'Packaged edition selections differ from original CSV identities', 409);
      return { result, allowed: new Set(source.entryIds) };
    });
    if (new Set(prepared.map(item => item.result.id)).size !== prepared.length) throw failure('DUPLICATE_PACKAGE_SOURCE', 'Package repeats a source');
    const selectedNoticeIds = new Set(prepared.flatMap(item => item.result.entries
      .filter(entry => item.allowed.has(entry.id) && entry.kind === 'tender').map(entry => entry.noticeId)));
    if (!plain(packet.selection) || !Array.isArray(packet.selection.noticeIds) ||
        !['all','shortlist','selected'].includes(packet.selection.scope) ||
        new Set(packet.selection.noticeIds).size !== packet.selection.noticeIds.length ||
        packet.selection.noticeIds.length !== selectedNoticeIds.size ||
        packet.selection.noticeIds.some(id => !selectedNoticeIds.has(id)))
      throw failure('PACKAGE_SELECTION_CHANGED', 'Package selection differs from its original selected tender editions', 409);
    if (packet.reviews.some(item => !plain(item)) ||
        new Set(packet.reviews.map(item => item.noticeId)).size !== packet.reviews.length ||
        packet.reviews.length !== selectedNoticeIds.size ||
        packet.reviews.some(item => !selectedNoticeIds.has(item.noticeId)))
      throw failure('PACKAGE_REVIEWS_CHANGED', 'Package needs one review for each selected original notice');
    if (packet.workshares.some(item => !plain(item)) ||
        new Set(packet.workshares.map(item => item.id)).size !== packet.workshares.length ||
        packet.workshares.some(item => !selectedNoticeIds.has(item.noticeId)))
      throw failure('PACKAGE_WORKSHARES_CHANGED', 'Package workshares require unique identities and selected original notices');
    if (packet.sourceObservations !== undefined && (!Array.isArray(packet.sourceObservations) ||
        packet.sourceObservations.some(item => !plain(item)) ||
        new Set(packet.sourceObservations.map(item => item.id)).size !== packet.sourceObservations.length ||
        packet.sourceObservations.some(item => !prepared.some(source => source.result.id === item.sourceId))))
      throw failure('PACKAGE_OBSERVATIONS_CHANGED', 'Package observations require unique identities and included original sources');
    if (packet.captures !== undefined && (!Array.isArray(packet.captures) ||
        packet.captures.some(item => !plain(item)) ||
        new Set(packet.captures.map(item => item.id)).size !== packet.captures.length))
      throw failure('PACKAGE_CAPTURES_CHANGED', 'Package captures require unique original identities');
    return this._change('package.received', expectedRevision, () => {
      const ingestion = prepared.map(item => this._ingest(item.result, item.allowed, { observe: !Array.isArray(packet.sourceObservations) })), reviewConflicts = [], workshareConflicts = [], captureConflicts = [];
      for (const observation of packet.sourceObservations || []) this._observe(observation);
      for (const incoming of packet.reviews) {
        this.getNotice(incoming.noticeId);
        const sourceReview = incoming.review;
        if (!plain(sourceReview) || !Number.isSafeInteger(sourceReview.revision) || sourceReview.revision < 0)
          throw failure('INVALID_PACKAGE_REVIEW', 'Incoming review revision is invalid');
        const validated = { ...reviewFields(Object.fromEntries(['disposition', 'owner', 'nextAction', 'note', 'shortlisted', 'qualification']
          .filter(key => Object.hasOwn(sourceReview, key)).map(key => [key, sourceReview[key]])), emptyReview()),
          revision: sourceReview.revision, updatedAt: sourceReview.updatedAt || null, operator: sourceReview.operator || null };
        const current = this._review(incoming.noticeId);
        if (current.revision > 0 && canonical(current) !== canonical(validated)) reviewConflicts.push({ noticeId: incoming.noticeId, retained: current, incoming: validated });
        else if (current.revision === 0 && validated.revision > 0)
          this.db.prepare('INSERT INTO reviews(notice_id,data) VALUES(?,?) ON CONFLICT(notice_id) DO UPDATE SET data=excluded.data')
            .run(incoming.noticeId, JSON.stringify(validated));
      }
      for (const incoming of packet.workshares) {
        const { history, ...original } = incoming;
        const validated = this._receivedWorkshare(original, selectedNoticeIds);
        if (!Array.isArray(history) || history.length !== validated.revision)
          throw failure('WORKSHARE_HISTORY_REQUIRED', 'Package requires every original workshare edition');
        const editions = history.map((edition, index) => {
          const record = this._receivedWorkshare(edition, selectedNoticeIds);
          if (record.id !== validated.id || record.noticeId !== validated.noticeId ||
              record.revision !== index + 1 || record.createdAt !== validated.createdAt ||
              canonical(record.sourceContext) !== canonical(validated.sourceContext))
            throw failure('WORKSHARE_HISTORY_CHANGED', 'Workshare history changes its original identity, source or revision order');
          return record;
        });
        if (canonical(editions[editions.length - 1]) !== canonical(validated))
          throw failure('WORKSHARE_HEAD_CHANGED', 'The final original edition differs from the current workshare');
        const current = this.db.prepare('SELECT data FROM workshares WHERE id=?').get(validated.id);
        if (current && canonical(JSON.parse(current.data)) !== canonical(validated))
          workshareConflicts.push({ workshareId: validated.id, retained: JSON.parse(current.data), incoming: validated, incomingHistory: editions });
        else if (!current) {
          this.db.prepare('INSERT INTO workshares(id,notice_id,data) VALUES(?,?,?)').run(validated.id, validated.noticeId, JSON.stringify(validated));
          for (const edition of editions)
            this.db.prepare('INSERT INTO workshare_history(id,data) VALUES(?,?)').run(validated.id, JSON.stringify(edition));
        }
      }
      for (const incoming of packet.captures || []) {
        if (!plain(incoming) || !/^capture-[a-f0-9-]{36}$/.test(incoming.id || '') ||
            !Number.isSafeInteger(incoming.revision) || incoming.revision < 1 ||
            !Number.isSafeInteger(incoming.attempts) || incoming.attempts < 1 ||
            !['downloading','interrupted','complete'].includes(incoming.status))
          throw failure('INVALID_PACKAGE_CAPTURE', 'Incoming capture identity or state is invalid');
        selection(incoming.stream);
        if (incoming.status === 'complete') {
          if (!prepared.some(item => item.result.id === incoming.sourceId))
            throw failure('CAPTURE_SOURCE_REQUIRED', 'Completed capture requires its complete source in this package');
          const source = this.getSource(incoming.sourceId, { includeBody: false });
          if (source.sha256 !== incoming.sha256 || source.bytes !== incoming.bytes || source.stream !== incoming.stream)
            throw failure('CAPTURE_SOURCE_CHANGED', 'Completed capture differs from its original included source');
        }
        const old = this.db.prepare('SELECT data FROM captures WHERE id=?').get(incoming.id);
        if (old && canonical(JSON.parse(old.data)) !== canonical(incoming))
          captureConflicts.push({ captureId: incoming.id, retained: JSON.parse(old.data), incoming });
        else if (!old) this.db.prepare('INSERT INTO captures(id,data) VALUES(?,?)').run(incoming.id, JSON.stringify(incoming));
      }
      const bidderDesk = [PACKAGE_SCHEMA, SOURCE_PACKAGE_SCHEMA].includes(packet.schema)
        ? this.bidderDesk.receiveData(packet.bidderDesk, { selectedNoticeIds })
        : { status: 'LEGACY_SOURCE_PACKAGE', importedRecords: 0, conflicts: [] };
      const receiving = { packageId, receivedAt: new Date().toISOString(), operator: this.operator, bidderDesk,
        sourceWorkspace: packet.workspace, ingestion, reviewConflicts, workshareConflicts, captureConflicts,
        sourceCaptures: packet.captures || [], sourcePublications: packet.publications || [], sourceReceivingHistory: packet.receivingHistory || [] };
      this.db.prepare('INSERT INTO receiving(id,data) VALUES(?,?)').run(packageId, JSON.stringify(receiving));
      return { value: { receiving, alreadyReceived: false }, audit: { packageId, sourceCount: prepared.length, reviewConflicts: reviewConflicts.length, workshareConflicts: workshareConflicts.length } };
    });
  }
  getReceiving(id) {
    const row = this.db.prepare('SELECT data FROM receiving WHERE id=?').get(id);
    if (!row) throw failure('RECEIVING_NOT_FOUND', 'Receiving record does not exist', 404);
    return JSON.parse(row.data);
  }
  saveCapture(capture, expectedRevision = null, expectedCaptureRevision = null) {
    if (!plain(capture) || typeof capture.id !== 'string') throw failure('INVALID_CAPTURE', 'Capture identity is required');
    return this._change('capture.saved', expectedRevision, () => {
      const existing = this.db.prepare('SELECT data FROM captures WHERE id=?').get(capture.id);
      if (existing) revision(expectedCaptureRevision, JSON.parse(existing.data).revision, 'capture');
      else if (expectedCaptureRevision !== null) throw failure('CAPTURE_NOT_FOUND', 'Capture does not exist', 404);
      const currentRevision = existing ? JSON.parse(existing.data).revision : 0;
      const record = { ...capture, revision: currentRevision + 1, updatedAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO captures(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(record.id, JSON.stringify(record));
      return { value: { capture: record }, audit: { captureId: record.id, status: record.status } };
    });
  }
  completeCapture(id, expectedCaptureRevision, input, meta, completion) {
    const prepared = preparedCsv(input, meta);
    return this._change('capture.imported', null, () => {
      const current = this.getCapture(id); revision(expectedCaptureRevision, current.revision, 'capture');
      if (current.stream !== prepared.metadata.stream || current.url !== prepared.metadata.url)
        throw failure('CAPTURE_SELECTION_CHANGED', 'Capture source selection changed', 409);
      const ingestion = this._ingest(prepared), { rawText, rawBase64, ...retained } = current;
      const capture = { ...retained, ...completion, status: 'complete', canResume: false,
        revision: current.revision + 1, sourceId: prepared.id, sha256: prepared.metadata.sha256,
        bytes: prepared.bytes.length, rowCount: prepared.entries.length, completedAt: new Date().toISOString() };
      this.db.prepare('UPDATE captures SET data=? WHERE id=?').run(JSON.stringify(capture), id);
      return { value: { capture, ingestion }, audit: { captureId: id, sourceId: prepared.id, ...ingestion } };
    });
  }
  getCapture(id) {
    const row = this.db.prepare('SELECT data FROM captures WHERE id=?').get(id);
    if (!row) throw failure('CAPTURE_NOT_FOUND', 'Capture record does not exist', 404);
    const record = JSON.parse(row.data);
    return { ...record, canResume: record.canResume || record.status === 'downloading' && Date.parse(record.leaseUntil || '') <= Date.now() };
  }
  getPublication(id) {
    const row = this.db.prepare('SELECT data FROM publications WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  }
  recordPublication(record, expectedRevision = null) {
    const publication = { ...record, id: record.id || randomUUID(), at: new Date().toISOString(), operator: this.operator };
    return this._change('publication.saved', expectedRevision, () => {
      this.db.prepare('INSERT INTO publications(id,data) VALUES(?,?)').run(publication.id, JSON.stringify(publication));
      return { value: { publication }, audit: { publicationId: publication.id } };
    });
  }
  close() {
    if (!this.closed) { this.db.close(); this.closed = true; }
  }
}
