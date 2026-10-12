// MIT. Material catalog operations in the original OpenSearch workspace and request journal.
import { createReadStream, constants } from 'node:fs';
import { open, mkdir, lstat, chmod, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { WorkspaceError, clone, canonical, digest, identifier, now } from '../workspace/store.mjs';
import { catalogInputFormat, readCatalogRows } from './input.mjs';
import { normalizeCatalogMapping, compileCatalogMapping, catalogText, catalogIdentifier,
  catalogMaterialFields, catalogQuantity } from './mapping.mjs';
import { exportCatalog, createCatalogQueryDraft } from './exports.mjs';
import { exportCatalogBundle, importCatalogBundle } from './transfer.mjs';
import { SupplierWorkspace } from './supplier/workspace.mjs';

export const CATALOG_SCHEMA = 'stellar-forge.material-catalog.v1';
export const SOURCE_SCHEMA = 'stellar-forge.material-catalog-source.v1';
export const EDITION_SCHEMA = 'stellar-forge.material-catalog-edition.v1';
export const DECISION_SCHEMA = 'stellar-forge.material-catalog-decision.v1';
export const CATALOG_TABLES = {
  catalog_catalogs: ['id','revision','record_json'],
  catalog_history: ['catalog_id','revision','record_json'],
  catalog_sources: ['id','record_json'],
  catalog_editions: ['id','catalog_id','created_at','record_json'],
  catalog_materials: ['edition_id','material_key','material_id','sha256','record_json'],
  catalog_decisions: ['id','catalog_id','context_key','revision','record_json'],
  catalog_decision_history: ['decision_id','revision','record_json']
};
const parse = row => row ? JSON.parse(row.record_json) : null;
const fail = (code, message, status = 422) => { throw new WorkspaceError(code, message, status); };
const hashText = value => /^[a-f0-9]{64}$/.test(value ?? '');
const json = value => JSON.stringify(value);
const descriptionKey = value => value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
const count = (db, sql, ...args) => Number(db.prepare(sql).get(...args).n);
function page(offset = 0, limit = 50) {
  offset = Number(offset); limit = Number(limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    fail('CATALOG_PAGE_INVALID', 'Choose an offset from zero and a page size from 1 to 500.');
  return { offset, limit };
}
function like(value) { return '%' + value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') + '%'; }
function positiveRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('CATALOG_REVISION_REQUIRED', 'Reopen the selected catalog before applying this action.');
}
function provenance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CATALOG_PROVENANCE_INVALID', 'Source provenance must be an object.');
  const result = {};
  for (const name of ['url','revision','publisher','kind','note']) {
    if (value[name] !== undefined) result[name] = catalogText(value[name], 'Source ' + name, name === 'note' ? 4000 : 2048);
  }
  if (result.url) {
    let url; try { url = new URL(result.url); } catch { fail('CATALOG_SOURCE_URL_INVALID', 'Use the original HTTP or HTTPS source URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      fail('CATALOG_SOURCE_URL_INVALID', 'Use an HTTP or HTTPS source URL without embedded credentials.');
  }
  return result;
}
export async function hashCatalogFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) fail('CATALOG_FILE_INVALID', 'The retained input must be a regular private file.', 409);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename, { flags: constants.O_RDONLY | constants.O_NOFOLLOW, highWaterMark: 262144 })) {
    hash.update(chunk); bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('CATALOG_DIRECTORY_INVALID', 'The catalog directory must be an original private directory.', 409);
  await chmod(path, 0o700); return path;
}
export function sourceIdentity(source) {
  const { name, format, bytes, sha256, provenance: origin } = source;
  return digest({ name, format, bytes, sha256, provenance: origin });
}
export function editionReview(edition) {
  return { catalogId: edition.catalogId, catalogRevision: edition.catalogRevision, tenantId: edition.tenantId,
    mappingSha256: edition.mappingSha256, sourceId: edition.source.id, sourceSha256: edition.source.sha256,
    dependencies: edition.dependencies, baseEditionId: edition.baseEditionId, mode: edition.mode,
    counts: edition.counts, materialRootSha256: edition.materialRootSha256 };
}
export function materialRoot(db, editionId) {
  const hash = createHash('sha256');
  for (const row of db.prepare('SELECT material_key,sha256 FROM catalog_materials WHERE edition_id=? ORDER BY material_key').iterate(editionId))
    hash.update(row.material_key + ':' + row.sha256 + '\n');
  return hash.digest('hex');
}

export class OpenSearchCatalogWorkspace {
  constructor(workspace) {
    this.workspace = workspace; this.store = workspace.store; this.db = this.store.db;
    this.root = join(this.store.directory, 'catalog');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS catalog_catalogs(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,record_json TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS catalog_history(catalog_id TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(catalog_id,revision));' +
      'CREATE TABLE IF NOT EXISTS catalog_sources(id TEXT PRIMARY KEY,record_json TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS catalog_editions(id TEXT PRIMARY KEY,catalog_id TEXT NOT NULL,created_at TEXT NOT NULL,record_json TEXT NOT NULL);' +
      'CREATE INDEX IF NOT EXISTS catalog_edition_catalog ON catalog_editions(catalog_id,created_at);' +
      'CREATE TABLE IF NOT EXISTS catalog_materials(edition_id TEXT NOT NULL,material_key TEXT NOT NULL,material_id TEXT NOT NULL,sha256 TEXT NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(edition_id,material_key));' +
      'CREATE INDEX IF NOT EXISTS catalog_material_id ON catalog_materials(edition_id,material_id);' +
      'CREATE TABLE IF NOT EXISTS catalog_intake(edition_id TEXT NOT NULL,material_key TEXT NOT NULL,ordinal INTEGER NOT NULL,operation TEXT NOT NULL,PRIMARY KEY(edition_id,material_key));' +
      'CREATE TABLE IF NOT EXISTS catalog_decisions(id TEXT PRIMARY KEY,catalog_id TEXT NOT NULL,context_key TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL,UNIQUE(catalog_id,context_key));' +
      'CREATE TABLE IF NOT EXISTS catalog_decision_history(decision_id TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(decision_id,revision));' +
      'CREATE TABLE IF NOT EXISTS catalog_refs(edition_id TEXT NOT NULL,value TEXT NOT NULL,material_key TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(edition_id,value,material_key,kind));' +
      "CREATE VIRTUAL TABLE IF NOT EXISTS catalog_terms USING fts5(edition_id UNINDEXED,material_key UNINDEXED,terms,tokenize='unicode61 remove_diacritics 2');"
    );
    this.supplier = new SupplierWorkspace(this);
  }
  open() { if (this.workspace.closed) fail('WORKSPACE_CLOSING', 'Workspace is closing.', 503); }
  async directories() {
    await privateDirectory(this.root);
    for (const name of ['sources','incoming','transfers']) await privateDirectory(join(this.root, name));
  }
  sourcePath(id) { return join(this.root, 'sources', identifier(id) + '.bin'); }
  catalog(id, revision) {
    const result = parse(this.db.prepare('SELECT record_json FROM catalog_catalogs WHERE id=?').get(identifier(id, 'catalog ID')));
    if (!result) fail('CATALOG_NOT_FOUND', 'Catalog not found.', 404);
    if (revision !== undefined && revision !== result.revision) fail('CATALOG_CHANGED', 'The saved catalog changed. Reopen it before applying this action.', 409);
    return result;
  }
  history(id) {
    this.catalog(id); return this.db.prepare('SELECT record_json FROM catalog_history WHERE catalog_id=? ORDER BY revision').all(id).map(parse);
  }
  source(id) {
    const result = parse(this.db.prepare('SELECT record_json FROM catalog_sources WHERE id=?').get(identifier(id, 'source ID')));
    if (!result) fail('CATALOG_SOURCE_NOT_FOUND', 'Retained catalog input not found.', 404);
    return result;
  }
  async retainedSource(id) {
    const source = this.source(id), path = this.sourcePath(id), actual = await hashCatalogFile(path);
    if (actual.bytes !== source.bytes || actual.sha256 !== source.sha256) fail('CATALOG_SOURCE_CHANGED', 'The retained source no longer matches its original bytes.', 409);
    return { ...source, path };
  }
  edition(id) {
    const result = parse(this.db.prepare('SELECT record_json FROM catalog_editions WHERE id=?').get(identifier(id, 'catalog edition ID')));
    if (!result) fail('CATALOG_EDITION_NOT_FOUND', 'Catalog edition not found.', 404);
    if (result.reviewSha256 !== digest(editionReview(result))) fail('CATALOG_EDITION_CHANGED', 'The retained edition review changed.', 409);
    return result;
  }
  state() {
    return { schema: 'stellar-forge.material-catalog-workspace.v1',
      catalogs: this.db.prepare('SELECT record_json FROM catalog_catalogs ORDER BY id').all().map(parse),
      sources: this.db.prepare('SELECT record_json FROM catalog_sources ORDER BY id').all().map(parse),
      editions: this.db.prepare('SELECT record_json FROM catalog_editions ORDER BY created_at DESC').all().map(parse) };
  }
  complete(operation, result) {
    return this.store.writeOperation({ ...operation, state: 'COMPLETE', updatedAt: now(), result: clone(result) });
  }
  sync(kind, request, action) {
    this.open();
    return this.store.transaction(() => {
      const saved = this.store.reserve(kind, request);
      if (saved.existing) return saved.operation;
      return this.complete(saved.operation, action(saved.operation));
    });
  }
  async perform(kind, request, action) {
    this.open();
    const saved = this.store.transaction(() => this.store.reserve(kind, request));
    if (saved.existing) return saved.operation;
    const task = Promise.resolve().then(() => action(saved.operation))
      .then(result => this.store.finish(request.requestId, result))
      .catch(error => this.store.finish(request.requestId, null, this.workspace.failure(error)))
      .finally(() => this.workspace.active.delete(request.requestId));
    this.workspace.active.set(request.requestId, task); return task;
  }
  putCatalog(catalog) {
    this.db.prepare('INSERT INTO catalog_catalogs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json')
      .run(catalog.id, catalog.revision, json(catalog));
    this.db.prepare('INSERT INTO catalog_history VALUES(?,?,?)').run(catalog.id, catalog.revision, json(catalog));
    return catalog;
  }
  save(request) {
    return this.sync('catalog-save', request, () => {
      const prior = request.catalogId ? this.catalog(request.catalogId, request.expectedRevision) : null;
      if (prior) positiveRevision(request.expectedRevision);
      const tenantId = catalogText(request.tenantId, 'Tenant ID', 256);
      if (prior && prior.tenantId !== tenantId) fail('CATALOG_TENANT_IMMUTABLE', 'Create a separate catalog for a different tenant.');
      const mapping = normalizeCatalogMapping(request.mapping), at = now();
      const checkLookups = value => { if (!value || typeof value !== 'object') return;
        if (value.lookup?.sourceId) this.source(value.lookup.sourceId);
        for (const child of Object.values(value)) if (child && typeof child === 'object') checkLookups(child); };
      checkLookups(mapping);
      const result = { schema: CATALOG_SCHEMA, id: prior?.id ?? randomUUID(), revision: (prior?.revision ?? 0) + 1,
        title: catalogText(request.title, 'Catalog title', 120), tenantId, mapping, mappingSha256: digest(mapping),
        activeEditionId: prior?.activeEditionId ?? null, createdAt: prior?.createdAt ?? at, updatedAt: at };
      return { catalog: this.putCatalog(result) };
    });
  }
  async retainBytes(meta, iterable, destination) {
    if (!Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || meta.bytes > 8 * 1024 * 1024 * 1024 || !hashText(meta.sha256))
      fail('CATALOG_SOURCE_MANIFEST_REQUIRED', 'Supply the original byte count (up to 8 GiB) and SHA-256 before transferring the source.');
    await this.directories();
    const temporary = join(this.root, 'incoming', identifier(meta.requestId) + '-' + randomUUID() + '.part');
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'); let bytes = 0, complete = false;
    try {
      for await (const value of iterable) {
        if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail('CATALOG_SOURCE_BYTES_REQUIRED', 'Transfer original bytes without text conversion.');
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        bytes += chunk.length;
        if (bytes > meta.bytes) fail('CATALOG_SOURCE_LENGTH_CHANGED', 'The transferred source exceeds its declared byte count.');
        hash.update(chunk); await file.writeFile(chunk);
      }
      await file.sync();
      if (bytes !== meta.bytes || hash.digest('hex') !== meta.sha256) fail('CATALOG_SOURCE_HASH_CHANGED', 'The transferred bytes do not match the declared source.');
      complete = true;
    } finally { await file.close(); if (!complete) await unlink(temporary).catch(() => {}); }
    try {
      try { await link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const actual = await hashCatalogFile(destination);
        if (actual.bytes !== meta.bytes || actual.sha256 !== meta.sha256) fail('CATALOG_RETAINED_FILE_CONFLICT', 'A different retained file already occupies this identity.', 409);
      }
      const directory = await open(join(destination, '..'), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(() => {}); }
    return destination;
  }
  upload(meta, bytes) {
    const selected = { requestId: identifier(meta.requestId, 'request ID'), name: catalogText(meta.name, 'Source name', 240),
      format: catalogInputFormat(meta.format), bytes: meta.bytes, sha256: meta.sha256, provenance: provenance(meta.provenance) };
    return this.perform('catalog-upload', selected, async operation => {
      const source = { schema: SOURCE_SCHEMA, id: sourceIdentity(selected), ...selected, createdAt: now() };
      delete source.requestId;
      await this.retainBytes(selected, bytes, this.sourcePath(source.id));
      const sample = []; let sampleBytes = 0, sampled = 0;
      source.columns = source.format.columns ?? [];
      for await (const row of readCatalogRows(this.sourcePath(source.id), source.format,
        { db: this.db, expectedBytes: source.bytes, expectedSha256: source.sha256 })) {
        if (!sampled) source.columns = Object.keys(row.record);
        sampled++; const size = Buffer.byteLength(json(row.record));
        if (size + sampleBytes <= 32768) { sample.push(row.record); sampleBytes += size; }
        if (sampled >= 8) break;
      }
      source.sample = sample;
      this.store.transaction(() => {
        const previous = parse(this.db.prepare('SELECT record_json FROM catalog_sources WHERE id=?').get(source.id));
        if (previous) {
          if (sourceIdentity(previous) !== source.id) fail('CATALOG_SOURCE_CONFLICT', 'The saved source identity changed.', 409);
          Object.assign(source, previous);
        } else this.db.prepare('INSERT INTO catalog_sources VALUES(?,?)').run(source.id, json(source));
        this.complete(operation, { source });
      });
      return { source };
    });
  }
  async preview(request) {
    return this.perform('catalog-preview', request, async operation => {
      positiveRevision(request.expectedRevision);
      const catalog = this.catalog(request.catalogId, request.expectedRevision);
      const mode = request.mode ?? 'full';
      if (!['full','delta'].includes(mode)) fail('CATALOG_IMPORT_MODE_INVALID', 'Choose a complete edition or explicit delta operations.');
      const baseId = request.baseEditionId === undefined ? catalog.activeEditionId : request.baseEditionId;
      const base = baseId ? this.edition(baseId) : null;
      if (base && base.catalogId !== catalog.id) fail('CATALOG_BASE_FOREIGN', 'The comparison base belongs to another catalog.');
      if (mode === 'delta' && !base) fail('CATALOG_DELTA_BASE_REQUIRED', 'Select an existing full catalog edition before applying a delta.');
      const source = await this.retainedSource(request.sourceId);
      const compiled = await compileCatalogMapping(catalog.mapping, id => this.retainedSource(id), { db: this.db });
      const editionId = digest('catalog-edition:' + request.requestId).slice(0, 32), at = now();
      const insert = this.db.prepare('INSERT INTO catalog_materials VALUES(?,?,?,?,?) ON CONFLICT(edition_id,material_key) DO UPDATE SET material_id=excluded.material_id,sha256=excluded.sha256,record_json=excluded.record_json');
      const seen = this.db.prepare('INSERT INTO catalog_intake VALUES(?,?,?,?)');
      const remove = this.db.prepare('DELETE FROM catalog_materials WHERE edition_id=? AND material_key=?');
      if (mode === 'delta') this.store.transaction(() =>
        this.db.prepare('INSERT INTO catalog_materials SELECT ?,material_key,material_id,sha256,record_json FROM catalog_materials WHERE edition_id=?').run(editionId, base.id));
      let batch = [], batchBytes = 0, inputRows = 0;
      const flush = () => {
        if (!batch.length) return;
        this.store.transaction(() => {
          for (const row of batch) {
            const operation = compiled.operation(row.record, mode);
            const materialId = compiled.materialId(row.record), key = digest([catalog.tenantId, materialId]);
            if (this.db.prepare('SELECT 1 FROM catalog_intake WHERE edition_id=? AND material_key=?').get(editionId, key))
              fail('CATALOG_DUPLICATE_MATERIAL', 'Input row ' + row.ordinal + ' repeats material ' + materialId + '. Supply one final operation per material.');
            seen.run(editionId, key, row.ordinal, operation);
            if (operation === 'delete') {
              if (!remove.run(editionId, key).changes) fail('CATALOG_DELTA_DELETE_MISSING', 'The delta deletes a material absent from its selected base: ' + materialId + '.');
            } else {
              const material = compiled.material(row.record, catalog.tenantId);
              insert.run(editionId, material.key, material.materialId, material.sha256, json(material));
            }
          }
        });
        batch = []; batchBytes = 0;
      };
      for await (const row of readCatalogRows(source.path, source.format,
        { db: this.db, expectedBytes: source.bytes, expectedSha256: source.sha256 })) {
        inputRows++; batch.push(row); batchBytes += Buffer.byteLength(json(row.record));
        if (batch.length >= 250 || batchBytes >= 2 * 1024 * 1024) flush();
      }
      flush();
      if (!inputRows && mode === 'full') fail('CATALOG_EMPTY_FULL_IMPORT', 'A full replacement must contain at least one material. Use reviewed explicit deletions to retire a catalog.');
      for (const id of new Set([source.id, ...compiled.dependencies.map(item => item.id)])) await this.retainedSource(id);
      const total = count(this.db, 'SELECT COUNT(*) n FROM catalog_materials WHERE edition_id=?', editionId);
      const added = base ? count(this.db, 'SELECT COUNT(*) n FROM catalog_materials a LEFT JOIN catalog_materials b ON b.edition_id=? AND b.material_key=a.material_key WHERE a.edition_id=? AND b.material_key IS NULL', base.id, editionId) : total;
      const removed = base ? count(this.db, 'SELECT COUNT(*) n FROM catalog_materials b LEFT JOIN catalog_materials a ON a.edition_id=? AND a.material_key=b.material_key WHERE b.edition_id=? AND a.material_key IS NULL', editionId, base.id) : 0;
      const changed = base ? count(this.db, 'SELECT COUNT(*) n FROM catalog_materials a JOIN catalog_materials b ON b.edition_id=? AND b.material_key=a.material_key WHERE a.edition_id=? AND a.sha256<>b.sha256', base.id, editionId) : 0;
      const missingUnit = count(this.db, "SELECT COUNT(*) n FROM catalog_materials WHERE edition_id=? AND json_extract(record_json,'$.unit') IS NULL", editionId);
      const value = { schema: EDITION_SCHEMA, id: editionId, catalogId: catalog.id, catalogRevision: catalog.revision,
        title: catalog.title, tenantId: catalog.tenantId, state: 'REVIEW', createdAt: at, requestId: request.requestId,
        mapping: compiled.mapping, mappingSha256: compiled.sha256,
        source: { id: source.id, name: source.name, bytes: source.bytes, sha256: source.sha256, provenance: source.provenance },
        dependencies: compiled.dependencies, baseEditionId: base?.id ?? null, mode, inputRows,
        counts: { added, removed, changed, unchanged: total - added - changed, total, missingUnit },
        materialRootSha256: materialRoot(this.db, editionId) };
      value.reviewSha256 = digest(editionReview(value));
      this.store.transaction(() => {
        this.db.prepare('INSERT INTO catalog_editions VALUES(?,?,?,?)').run(value.id, catalog.id, at, json(value));
        this.buildSearchIndex(value);
        this.complete(operation, { edition: value });
      });
      return { edition: value };
    });
  }
  buildSearchIndex(edition) {
    this.db.prepare('DELETE FROM catalog_refs WHERE edition_id=?').run(edition.id);
    this.db.prepare('DELETE FROM catalog_terms WHERE edition_id=?').run(edition.id);
    const refs = this.db.prepare('INSERT OR IGNORE INTO catalog_refs VALUES(?,?,?,?)');
    const terms = this.db.prepare('INSERT INTO catalog_terms VALUES(?,?,?)');
    for (const row of this.db.prepare('SELECT record_json FROM catalog_materials WHERE edition_id=? ORDER BY material_key').iterate(edition.id)) {
      const value = parse(row), normalize = text => catalogIdentifier(text, edition.mapping.identifierPolicy);
      const values = [{ kind: 'material-id', value: value.materialId }, ...(value.partNumber ? [{ kind: 'part-number', value: value.partNumber }] : []), ...value.references];
      for (const reference of values) refs.run(edition.id, normalize(reference.value), value.key, reference.kind);
      terms.run(edition.id, value.key, [value.materialId,value.partNumber,value.title,value.description,value.manufacturer,value.category,...value.references.map(ref => ref.value)].filter(Boolean).join(' '));
    }
  }
  materials({ editionId, offset = 0, limit = 50, search = '' }) {
    this.edition(editionId); ({ offset, limit } = page(offset, limit));
    if (typeof search !== 'string' || search.length > 2000) fail('CATALOG_SEARCH_INVALID', 'Use at most 2,000 search characters.');
    const condition = search ? " AND (material_id LIKE ? ESCAPE '\\' OR json_extract(record_json,'$.title') LIKE ? ESCAPE '\\')" : '';
    const args = search ? [editionId, like(search), like(search)] : [editionId];
    const total = count(this.db, 'SELECT COUNT(*) n FROM catalog_materials WHERE edition_id=?' + condition, ...args);
    const rows = this.db.prepare('SELECT record_json FROM catalog_materials WHERE edition_id=?' + condition + ' ORDER BY material_id,material_key LIMIT ? OFFSET ?').all(...args, limit, offset).map(parse);
    return { rows, total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
  }
  changes({ editionId, offset = 0, limit = 50 }) {
    const edition = this.edition(editionId); ({ offset, limit } = page(offset, limit));
    const baseId = edition.baseEditionId ?? '';
    const sql = 'SELECT a.material_id material_id,b.record_json before_json,a.record_json after_json FROM catalog_materials a LEFT JOIN catalog_materials b ON b.edition_id=? AND b.material_key=a.material_key WHERE a.edition_id=? AND (b.material_key IS NULL OR b.sha256<>a.sha256)' +
      ' UNION ALL SELECT b.material_id material_id,b.record_json before_json,NULL after_json FROM catalog_materials b LEFT JOIN catalog_materials a ON a.edition_id=? AND a.material_key=b.material_key WHERE b.edition_id=? AND a.material_key IS NULL';
    const rows = this.db.prepare('SELECT * FROM (' + sql + ') ORDER BY material_id LIMIT ? OFFSET ?')
      .all(baseId, edition.id, edition.id, baseId, limit, offset).map(row => {
        const before = row.before_json ? JSON.parse(row.before_json) : null, after = row.after_json ? JSON.parse(row.after_json) : null;
        return { kind: !before ? 'added' : !after ? 'removed' : 'changed', materialId: row.material_id, before, after,
          fields: before && after ? catalogMaterialFields(before, after) : [] };
      });
    const total = edition.counts.added + edition.counts.changed + edition.counts.removed;
    return { rows, total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
  }
  select(request) {
    return this.sync('catalog-select', request, () => {
      positiveRevision(request.expectedRevision);
      const prior = this.catalog(request.catalogId, request.expectedRevision), edition = this.edition(request.editionId);
      if (edition.catalogId !== prior.id || edition.tenantId !== prior.tenantId || edition.mappingSha256 !== prior.mappingSha256)
        fail('CATALOG_EDITION_SCOPE_CHANGED', 'The reviewed edition must use this catalog, tenant and currently selected mapping.', 409);
      if (request.reviewSha256 !== edition.reviewSha256) fail('CATALOG_REVIEW_CHANGED', 'Reopen the complete change review before selecting the edition.', 409);
      if (materialRoot(this.db, edition.id) !== edition.materialRootSha256) fail('CATALOG_MATERIALS_CHANGED', 'The saved material set no longer matches the reviewed edition.', 409);
      const catalog = { ...prior, revision: prior.revision + 1, activeEditionId: edition.id, updatedAt: now() };
      return { catalog: this.putCatalog(catalog), edition };
    });
  }
  material(editionId, key) {
    return parse(this.db.prepare('SELECT record_json FROM catalog_materials WHERE edition_id=? AND material_key=?').get(editionId, key));
  }
  decisionView(value, catalog) {
    const current = catalog.activeEditionId ? this.material(catalog.activeEditionId, value.materialKey) : null;
    return { ...value, currentStatus: current?.sha256 === value.materialSha256 ? value.status : 'NEEDS_REVIEW',
      currentMaterial: current };
  }
  facets({ catalogId, editionId }) {
    const catalog = this.catalog(catalogId), id = editionId ?? catalog.activeEditionId;
    if (!id) return { editionId: null, facets: { category: [], manufacturer: [], unit: [] } };
    const edition = this.edition(id);
    if (edition.catalogId !== catalog.id) fail('CATALOG_EDITION_FOREIGN', 'The selected edition belongs to another catalog.');
    const facets = {};
    for (const name of ['category','manufacturer','unit']) {
      facets[name] = this.db.prepare("SELECT json_extract(record_json,'$." + name + "') value,COUNT(*) count FROM catalog_materials WHERE edition_id=? AND json_extract(record_json,'$." + name + "') IS NOT NULL GROUP BY value ORDER BY count DESC,value").all(id);
    }
    return { editionId: id, facets };
  }
  suggest({ catalogId, text, customerId = '', category, manufacturer, unit, offset = 0, limit = 30 }) {
    const catalog = this.catalog(catalogId); ({ offset, limit } = page(offset, limit));
    const term = catalogText(text, 'Customer description or part number', 2000, true) ?? '';
    if (typeof customerId !== 'string' || customerId.length > 256 || customerId.includes('\0')) fail('CATALOG_CUSTOMER_INVALID', 'Use the original customer identifier.');
    if (!catalog.activeEditionId) return { editionId: null, candidates: [], approved: null, total: 0, nextOffset: null };
    const edition = this.edition(catalog.activeEditionId);
    const decision = term ? parse(this.db.prepare('SELECT record_json FROM catalog_decisions WHERE catalog_id=? AND context_key=?')
      .get(catalog.id, digest([customerId, descriptionKey(term)]))) : null;
    const approved = decision ? this.decisionView(decision, catalog) : null;
    const filters = [], args = [];
    for (const [name, value] of Object.entries({ category, manufacturer, unit })) if (value !== undefined && value !== null && value !== '') {
      filters.push("json_extract(m.record_json,'$." + name + "')=?");
      args.push(catalogText(value, 'Selected ' + name, 256));
    }
    const scope = 'm.edition_id=?' + (filters.length ? ' AND ' + filters.join(' AND ') : '');
    const selectedArgs = [edition.id, ...args];
    const reason = ['approved-customer-match','exact-identifier','catalog-text','catalog-browse'];
    const candidates = []; let total = 0, remainingOffset = offset;
    const append = (from, where, values, priority, order) => {
      const all = count(this.db, 'SELECT COUNT(*) n FROM ' + from + ' WHERE ' + where, ...values);
      total += all;
      if (remainingOffset >= all) { remainingOffset -= all; return; }
      const room = limit - candidates.length;
      if (room > 0) {
        const rows = this.db.prepare('SELECT m.record_json FROM ' + from + ' WHERE ' + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?')
          .all(...values, room, remainingOffset);
        candidates.push(...rows.map(row => ({ material: parse(row), reason: reason[priority] })));
      }
      remainingOffset = 0;
    };
    if (!term) append('catalog_materials m', scope, selectedArgs, 3, 'm.material_id,m.material_key');
    else {
      const approvedKey = approved?.currentStatus === 'APPROVED' ? approved.materialKey : '';
      append('catalog_materials m', scope + ' AND m.material_key=?', [...selectedArgs, approvedKey], 0, 'm.material_key');
      const identity = term.length <= 1024 ? catalogIdentifier(term, edition.mapping.identifierPolicy) : '';
      const exact = 'EXISTS(SELECT 1 FROM catalog_refs r WHERE r.edition_id=m.edition_id AND r.material_key=m.material_key AND r.value=?)';
      append('catalog_materials m', scope + ' AND m.material_key<>? AND ' + exact,
        [...selectedArgs, approvedKey, identity], 1, 'm.material_id,m.material_key');
      const tokens = term.match(/[\p{L}\p{N}]+/gu)?.slice(0, 24) ?? [];
      const expression = tokens.map(token => '"' + token + '"*').join(' AND ');
      if (expression) append('catalog_terms JOIN catalog_materials m ON m.edition_id=catalog_terms.edition_id AND m.material_key=catalog_terms.material_key',
        scope + ' AND catalog_terms MATCH ? AND m.material_key<>? AND NOT ' + exact,
        [...selectedArgs, expression, approvedKey, identity], 2, 'bm25(catalog_terms),m.material_key');
    }
    return { editionId: edition.id, candidates, approved, total, nextOffset: offset + candidates.length < total ? offset + candidates.length : null };
  }
  quantity({ catalogId, materialKey, expectedMaterialSha256, quantity, unit }) {
    const catalog = this.catalog(catalogId);
    if (!catalog.activeEditionId) fail('CATALOG_EDITION_REQUIRED', 'Select the reviewed catalog edition first.');
    const material = this.material(catalog.activeEditionId, materialKey);
    if (!material || material.sha256 !== expectedMaterialSha256) fail('CATALOG_MATCH_CHANGED', 'Review the current selected material before converting its quantity.', 409);
    return { materialId: material.materialId, editionId: catalog.activeEditionId,
      quantity: catalogQuantity(material, quantity, unit) };
  }
  saveDecision(request) {
    return this.sync('catalog-decision', request, () => {
      positiveRevision(request.expectedCatalogRevision);
      const catalog = this.catalog(request.catalogId, request.expectedCatalogRevision);
      if (!catalog.activeEditionId) fail('CATALOG_EDITION_REQUIRED', 'Select the reviewed catalog edition first.');
      const customerId = catalogText(request.customerId, 'Customer identifier', 256);
      const description = catalogText(request.description, 'Original customer description', 2000);
      const contextKey = digest([customerId, descriptionKey(description)]);
      const prior = parse(this.db.prepare('SELECT record_json FROM catalog_decisions WHERE catalog_id=? AND context_key=?').get(catalog.id, contextKey));
      if (prior) {
        positiveRevision(request.expectedRevision);
        if (request.decisionId !== prior.id || request.expectedRevision !== prior.revision)
          fail('CATALOG_DECISION_CHANGED', 'Reopen the existing customer match before changing its decision.', 409);
      } else if (request.decisionId || request.expectedRevision !== undefined) fail('CATALOG_DECISION_NOT_FOUND', 'This customer match does not exist.', 404);
      const material = this.material(catalog.activeEditionId, request.materialKey);
      if (!material || material.sha256 !== request.expectedMaterialSha256) fail('CATALOG_MATCH_CHANGED', 'The selected material changed. Review its current description, references and units.', 409);
      if (!['APPROVED','REJECTED'].includes(request.status)) fail('CATALOG_DECISION_STATUS_INVALID', 'Choose Approve or Reject.');
      const at = now(), decision = { schema: DECISION_SCHEMA, id: prior?.id ?? randomUUID(), revision: (prior?.revision ?? 0) + 1,
        catalogId: catalog.id, catalogRevision: catalog.revision, editionId: catalog.activeEditionId, tenantId: catalog.tenantId,
        customerId, description, materialKey: material.key, materialId: material.materialId, materialSha256: material.sha256,
        status: request.status, note: catalogText(request.note, 'Review note', 4000, true) ?? '', createdAt: prior?.createdAt ?? at, updatedAt: at };
      this.db.prepare('INSERT INTO catalog_decisions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json')
        .run(decision.id, catalog.id, contextKey, decision.revision, json(decision));
      this.db.prepare('INSERT INTO catalog_decision_history VALUES(?,?,?)').run(decision.id, decision.revision, json(decision));
      return { decision: this.decisionView(decision, catalog) };
    });
  }
  decisions({ catalogId, offset = 0, limit = 50 }) {
    const catalog = this.catalog(catalogId); ({ offset, limit } = page(offset, limit));
    const total = count(this.db, 'SELECT COUNT(*) n FROM catalog_decisions WHERE catalog_id=?', catalog.id);
    const rows = this.db.prepare('SELECT record_json FROM catalog_decisions WHERE catalog_id=? ORDER BY id LIMIT ? OFFSET ?').all(catalog.id, limit, offset).map(parse).map(row => this.decisionView(row, catalog));
    return { rows, total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
  }
  export(catalogId, format, options = {}) {
    this.open();
    if (format === 'catalog-bundle.jsonl') return exportCatalogBundle(this, catalogId);
    return exportCatalog(this, catalogId, format, options);
  }
  importBundle(meta, bytes) { return importCatalogBundle(this, meta, bytes); }
  createDraft(request) { this.open(); return createCatalogQueryDraft(this, request); }
  supplierSave(request) { return this.supplier.save(request); }
  supplierCorrection(request) { return this.supplier.saveCorrection(request); }
  supplierReview(request) { return this.supplier.runReview(request); }
}
