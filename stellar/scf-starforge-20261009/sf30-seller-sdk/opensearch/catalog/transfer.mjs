// MIT. Streaming portable catalog handover with original bytes, history and customer decisions.
import { createReadStream, constants } from 'node:fs';
import { open, mkdir, lstat, chmod, link } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { WorkspaceError, canonical, digest, identifier, now } from '../workspace/store.mjs';
import { normalizeCatalogMapping, verifyCatalogMaterial, catalogText } from './mapping.mjs';
import { catalogInputFormat } from './input.mjs';
import { trackCatalogStorageWork, retireCompletedCatalogImport } from './import-storage.mjs';
import { CATALOG_TABLES, CATALOG_SCHEMA, SOURCE_SCHEMA, EDITION_SCHEMA, DECISION_SCHEMA,
  sourceIdentity, editionReview, materialRoot, hashCatalogFile } from './workspace.mjs';

import { SUPPLIER_TABLES, SUPPLIER_KEYS, SUPPLIER_MUTABLE, SUPPLIER_MERGE_ORDER, setupSupplierTables } from './supplier/model.mjs';
import { captureSupplier, supplierRecords, validateSupplierRow, validateSupplierClosure } from './supplier/transfer.mjs';

export const CATALOG_BUNDLE_SCHEMA = 'stellar-forge.material-catalog-bundle.v1';
export const CATALOG_SUPPLIER_BUNDLE_SCHEMA = 'stellar-forge.material-catalog-bundle.v2';
const tables = () => ({ ...CATALOG_TABLES, ...SUPPLIER_TABLES });
const fail = (code, message, status = 422) => { throw new WorkspaceError(code, message, status); };
const parse = row => row ? JSON.parse(row.record_json) : null;
const keys = {
  catalog_catalogs: ['id'], catalog_history: ['catalog_id','revision'], catalog_sources: ['id'],
  catalog_editions: ['id'], catalog_materials: ['edition_id','material_key'],
  catalog_decisions: ['id'], catalog_decision_history: ['decision_id','revision'], ...SUPPLIER_KEYS
};
function lookups(value, ids = new Set()) {
  if (!value || typeof value !== 'object') return ids;
  if (value.lookup?.sourceId) ids.add(value.lookup.sourceId);
  for (const child of Object.values(value)) if (child && typeof child === 'object') lookups(child, ids);
  return ids;
}
function snapshot(workspace, catalogId) {
  const catalog = workspace.catalog(catalogId), catalogHistory = workspace.history(catalogId);
  const editions = workspace.db.prepare('SELECT record_json FROM catalog_editions WHERE catalog_id=? ORDER BY created_at,id').all(catalog.id).map(parse);
  const decisions = workspace.db.prepare('SELECT record_json FROM catalog_decisions WHERE catalog_id=? ORDER BY id').all(catalog.id).map(parse);
  const sourceIds = new Set();
  for (const item of catalogHistory) lookups(item.mapping, sourceIds);
  for (const edition of editions) {
    sourceIds.add(edition.source.id);
    for (const source of edition.dependencies) sourceIds.add(source.id);
  }
  return { catalog, catalogHistory, editions, decisions, sources: [...sourceIds].sort().map(id => workspace.source(id)),
    supplier: captureSupplier(workspace, catalogId) };
}
export function exportCatalogBundle(workspace, catalogId) {
  const saved = workspace.store.transaction(() => snapshot(workspace, catalogId));
  const withSupplier = saved.supplier.plans.length > 0;
  const schema = withSupplier ? CATALOG_SUPPLIER_BUNDLE_SCHEMA : CATALOG_BUNDLE_SCHEMA;
  async function* body() {
    const hash = createHash('sha256'); let frames = 0;
    const rows = Object.fromEntries(Object.keys(withSupplier ? tables() : CATALOG_TABLES).map(name => [name, 0]));
    let sourceBytes = 0;
    const frame = value => { const raw = JSON.stringify(value) + '\n'; hash.update(raw); frames++; return raw; };
    const record = (table, values) => { rows[table]++; return frame({ type: 'record', table, values }); };
    const header = { type: 'header', schema, catalogId: saved.catalog.id,
      catalogRevision: saved.catalog.revision, tenantId: saved.catalog.tenantId,
      sourceWorkspaceId: workspace.store.id, exportedAt: now() };
    yield frame(header);
    yield record('catalog_catalogs', [saved.catalog.id, saved.catalog.revision, JSON.stringify(saved.catalog)]);
    for (const item of saved.catalogHistory)
      yield record('catalog_history', [item.id, item.revision, JSON.stringify(item)]);
    for (const source of saved.sources) {
      const retained = await workspace.retainedSource(source.id);
      yield record('catalog_sources', [source.id, JSON.stringify(source)]);
      yield frame({ type: 'source-start', id: source.id });
      let offset = 0;
      for await (const bytes of createReadStream(retained.path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW, highWaterMark: 196608 })) {
        yield frame({ type: 'source-chunk', id: source.id, offset, base64: bytes.toString('base64') });
        offset += bytes.length;
      }
      if (offset !== source.bytes) fail('CATALOG_BUNDLE_SOURCE_CHANGED', 'A source changed while creating the catalog handover.', 409);
      await workspace.retainedSource(source.id);
      sourceBytes += offset;
      yield frame({ type: 'source-end', id: source.id, bytes: source.bytes, sha256: source.sha256 });
    }
    for (const edition of saved.editions) {
      if (materialRoot(workspace.db, edition.id) !== edition.materialRootSha256)
        fail('CATALOG_BUNDLE_EDITION_CHANGED', 'A retained material edition changed before handover.', 409);
      yield record('catalog_editions', [edition.id, edition.catalogId, edition.createdAt, JSON.stringify(edition)]);
      for (const row of workspace.db.prepare('SELECT edition_id,material_key,material_id,sha256,record_json FROM catalog_materials WHERE edition_id=? ORDER BY material_key').iterate(edition.id))
        yield record('catalog_materials', CATALOG_TABLES.catalog_materials.map(name => row[name]));
    }
    for (const decision of saved.decisions) {
      const context = digest([decision.customerId, decision.description.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim()]);
      yield record('catalog_decisions', [decision.id, decision.catalogId, context, decision.revision, JSON.stringify(decision)]);
      for (const row of workspace.db.prepare('SELECT decision_id,revision,record_json FROM catalog_decision_history WHERE decision_id=? AND revision<=? ORDER BY revision').iterate(decision.id, decision.revision))
        yield record('catalog_decision_history', CATALOG_TABLES.catalog_decision_history.map(name => row[name]));
    }
    if (withSupplier) for (const item of supplierRecords(workspace, saved.supplier)) yield record(item.table, item.values);
    yield JSON.stringify({ type: 'complete', schema, catalogId: saved.catalog.id,
      frames, rows, sourceBytes, payloadSha256: hash.digest('hex') }) + '\n';
  }
  return { filename: 'material-catalog-' + saved.catalog.id + '-r' + saved.catalog.revision + '.jsonl',
    type: 'application/x-ndjson; charset=utf-8', body: body() };
}
async function* lines(filename) {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '';
  for await (const bytes of createReadStream(filename, { flags: constants.O_RDONLY | constants.O_NOFOLLOW, highWaterMark: 262144 })) {
    pending += decoder.decode(bytes, { stream: true });
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index + 1); pending = pending.slice(index + 1);
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) fail('CATALOG_BUNDLE_RECORD_LIMIT', 'A handover record exceeds 8 MiB.');
      yield line;
    }
    if (Buffer.byteLength(pending) > 8 * 1024 * 1024) fail('CATALOG_BUNDLE_RECORD_LIMIT', 'A handover record exceeds 8 MiB.');
  }
  pending += decoder.decode();
  if (pending.length) fail('CATALOG_BUNDLE_INCOMPLETE', 'The original bundle must end with its complete final record and newline.');
}
function stageTables(db) {
  for (const [name, columns] of Object.entries(CATALOG_TABLES)) {
    const definition = columns.map(column => column + (column === 'revision' ? ' INTEGER NOT NULL' : ' TEXT NOT NULL')).join(',');
    db.exec('CREATE TABLE ' + name + '(' + definition + ',PRIMARY KEY(' + keys[name].join(',') + '));');
  }
  db.exec('CREATE UNIQUE INDEX catalog_decision_context ON catalog_decisions(catalog_id,context_key);');
  setupSupplierTables(db);
}
function count(db, sql, ...values) { return Number(db.prepare(sql).get(...values).n); }
function validRevision(value) { return Number.isSafeInteger(value) && value > 0 && value <= 1000000; }
function requireRecord(row, expectedSchema) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== expectedSchema) fail('CATALOG_BUNDLE_SCHEMA_INVALID', 'A retained record has an unsupported schema.');
  identifier(row.id);
}
function validateRow(table, values, header) {
  if (Object.hasOwn(SUPPLIER_TABLES, table)) {
    if (header.schema !== CATALOG_SUPPLIER_BUNDLE_SCHEMA) fail('CATALOG_BUNDLE_VERSION_REQUIRED', 'Supplier records require the complete v2 catalog bundle.');
    return validateSupplierRow(table, values, header);
  }
  const columns = CATALOG_TABLES[table];
  if (!columns || !Array.isArray(values) || values.length !== columns.length)
    fail('CATALOG_BUNDLE_ROW_INVALID', 'The handover contains an unknown table or row shape.');
  const selected = Object.fromEntries(columns.map((name, index) => [name, values[index]]));
  for (const [name, value] of Object.entries(selected)) {
    if (name === 'revision' ? !validRevision(value) : typeof value !== 'string' || !value.length || value.includes('\0'))
      fail('CATALOG_BUNDLE_ROW_INVALID', 'A retained database field has an invalid type.');
  }
  let record;
  try { record = JSON.parse(selected.record_json); canonical(record); }
  catch { fail('CATALOG_BUNDLE_JSON_INVALID', 'A retained database record is invalid JSON.'); }
  if (table === 'catalog_catalogs' || table === 'catalog_history') {
    requireRecord(record, CATALOG_SCHEMA);
    if (record.id !== header.catalogId || record.tenantId !== header.tenantId || selected.revision !== record.revision ||
        (selected.id ?? selected.catalog_id) !== record.id || record.mappingSha256 !== digest(normalizeCatalogMapping(record.mapping)))
      fail('CATALOG_BUNDLE_CATALOG_SCOPE', 'The catalog identity, tenant, revision or mapping does not match its original record.');
    catalogText(record.title, 'Catalog title', 120);
  } else if (table === 'catalog_sources') {
    requireRecord(record, SOURCE_SCHEMA);
    if (selected.id !== record.id || sourceIdentity(record) !== record.id ||
        canonical(catalogInputFormat(record.format)) !== canonical(record.format) ||
        !Number.isSafeInteger(record.bytes) || record.bytes < 1 || !/^[a-f0-9]{64}$/.test(record.sha256))
      fail('CATALOG_BUNDLE_SOURCE_INVALID', 'A retained source identity or format is invalid.');
  } else if (table === 'catalog_editions') {
    requireRecord(record, EDITION_SCHEMA);
    if (record.id !== selected.id || record.catalogId !== header.catalogId || record.catalogId !== selected.catalog_id ||
        record.tenantId !== header.tenantId || record.createdAt !== selected.created_at || !validRevision(record.catalogRevision) ||
        record.mappingSha256 !== digest(normalizeCatalogMapping(record.mapping)) ||
        record.reviewSha256 !== digest(editionReview(record)))
      fail('CATALOG_BUNDLE_EDITION_INVALID', 'A retained edition differs from its original review.');
  } else if (table === 'catalog_materials') {
    verifyCatalogMaterial(record, header.tenantId);
    if (record.key !== selected.material_key || record.materialId !== selected.material_id || record.sha256 !== selected.sha256)
      fail('CATALOG_BUNDLE_MATERIAL_INVALID', 'The retained material identity or content digest changed.');
  } else {
    requireRecord(record, DECISION_SCHEMA);
    if (record.catalogId !== header.catalogId || record.tenantId !== header.tenantId || record.revision !== selected.revision ||
        (selected.id ?? selected.decision_id) !== record.id || !['APPROVED','REJECTED'].includes(record.status))
      fail('CATALOG_BUNDLE_DECISION_INVALID', 'A retained customer decision has a different identity or scope.');
    catalogText(record.customerId, 'Customer ID', 256); catalogText(record.description, 'Customer description', 2000);
    if (table === 'catalog_decisions' && (record.catalogId !== selected.catalog_id ||
      selected.context_key !== digest([record.customerId, record.description.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim()])))
      fail('CATALOG_BUNDLE_DECISION_INVALID', 'The retained customer decision context changed.');
  }
  return record;
}
function validateClosure(db, header, completedSources) {
  if (count(db, 'SELECT COUNT(*) n FROM catalog_catalogs') !== 1) fail('CATALOG_BUNDLE_CATALOG_REQUIRED', 'The handover must contain one complete catalog.');
  const catalog = parse(db.prepare('SELECT record_json FROM catalog_catalogs').get());
  if (catalog.revision !== header.catalogRevision ||
      count(db, 'SELECT COUNT(*) n FROM catalog_history') !== catalog.revision ||
      count(db, 'SELECT COUNT(*) n FROM catalog_history WHERE revision<1 OR revision>?', catalog.revision))
    fail('CATALOG_BUNDLE_HISTORY_INCOMPLETE', 'The original catalog revision history is incomplete.');
  const latest = parse(db.prepare('SELECT record_json FROM catalog_history WHERE catalog_id=? AND revision=?').get(catalog.id, catalog.revision));
  if (!latest || canonical(latest) !== canonical(catalog)) fail('CATALOG_BUNDLE_HISTORY_CHANGED', 'The current catalog differs from its retained revision.');
  const requireSource = (id, sha256) => {
    const source = parse(db.prepare('SELECT record_json FROM catalog_sources WHERE id=?').get(id));
    if (!source || !completedSources.has(id) || sha256 && source.sha256 !== sha256)
      fail('CATALOG_BUNDLE_SOURCE_MISSING', 'A material edition or mapping is missing its original source bytes.');
    return source;
  };
  if (completedSources.size !== count(db, 'SELECT COUNT(*) n FROM catalog_sources'))
    fail('CATALOG_BUNDLE_SOURCE_INCOMPLETE', 'Every retained source must have exactly one complete byte stream.');
  for (const row of db.prepare('SELECT record_json FROM catalog_history').iterate())
    for (const id of lookups(parse(row).mapping)) requireSource(id);
  const editions = db.prepare('SELECT record_json FROM catalog_editions').all().map(parse);
  const byId = new Map(editions.map(edition => [edition.id, edition]));
  if (catalog.activeEditionId && !byId.has(catalog.activeEditionId)) fail('CATALOG_BUNDLE_ACTIVE_EDITION_MISSING', 'The selected edition is missing.');
  for (const edition of editions) {
    const revision = parse(db.prepare('SELECT record_json FROM catalog_history WHERE catalog_id=? AND revision=?').get(catalog.id, edition.catalogRevision));
    if (!revision || revision.mappingSha256 !== edition.mappingSha256) fail('CATALOG_BUNDLE_MAPPING_HISTORY_CHANGED', 'The edition does not match its original mapping revision.');
    requireSource(edition.source.id, edition.source.sha256);
    for (const source of edition.dependencies) requireSource(source.id, source.sha256);
    for (const id of lookups(edition.mapping)) requireSource(id);
    const ancestors = new Set([edition.id]); let ancestor = edition.baseEditionId;
    while (ancestor) {
      if (ancestors.has(ancestor) || !byId.has(ancestor)) fail('CATALOG_BUNDLE_BASE_INVALID', 'The edition base history is missing or cyclic.');
      ancestors.add(ancestor); ancestor = byId.get(ancestor).baseEditionId;
    }
    const base = edition.baseEditionId;
    const total = count(db, 'SELECT COUNT(*) n FROM catalog_materials WHERE edition_id=?', edition.id);
    const added = base ? count(db, 'SELECT COUNT(*) n FROM catalog_materials a LEFT JOIN catalog_materials b ON b.edition_id=? AND b.material_key=a.material_key WHERE a.edition_id=? AND b.material_key IS NULL', base, edition.id) : total;
    const removed = base ? count(db, 'SELECT COUNT(*) n FROM catalog_materials b LEFT JOIN catalog_materials a ON a.edition_id=? AND a.material_key=b.material_key WHERE b.edition_id=? AND a.material_key IS NULL', edition.id, base) : 0;
    const changed = base ? count(db, 'SELECT COUNT(*) n FROM catalog_materials a JOIN catalog_materials b ON b.edition_id=? AND b.material_key=a.material_key WHERE a.edition_id=? AND a.sha256<>b.sha256', base, edition.id) : 0;
    const missingUnit = count(db, "SELECT COUNT(*) n FROM catalog_materials WHERE edition_id=? AND json_extract(record_json,'$.unit') IS NULL", edition.id);
    if (canonical(edition.counts) !== canonical({ total, added, removed, changed, unchanged: total - added - changed, missingUnit }) ||
        materialRoot(db, edition.id) !== edition.materialRootSha256)
      fail('CATALOG_BUNDLE_MATERIAL_SET_CHANGED', 'The retained material set or complete change counts differ from the reviewed edition.');
  }
  if (count(db, 'SELECT COUNT(*) n FROM catalog_materials m LEFT JOIN catalog_editions e ON e.id=m.edition_id WHERE e.id IS NULL'))
    fail('CATALOG_BUNDLE_FOREIGN_MATERIALS', 'The handover contains materials outside its retained editions.');
  for (const row of db.prepare('SELECT record_json FROM catalog_decisions').iterate()) {
    const decision = parse(row);
    if (count(db, 'SELECT COUNT(*) n FROM catalog_decision_history WHERE decision_id=?', decision.id) !== decision.revision ||
        count(db, 'SELECT COUNT(*) n FROM catalog_decision_history WHERE decision_id=? AND (revision<1 OR revision>?)', decision.id, decision.revision))
      fail('CATALOG_BUNDLE_DECISION_HISTORY_MISSING', 'A customer decision is missing its original revisions.');
    const saved = parse(db.prepare('SELECT record_json FROM catalog_decision_history WHERE decision_id=? AND revision=?').get(decision.id, decision.revision));
    if (!saved || canonical(saved) !== canonical(decision)) fail('CATALOG_BUNDLE_DECISION_HISTORY_CHANGED', 'A current decision differs from its retained revision.');
  }
  for (const row of db.prepare('SELECT record_json FROM catalog_decision_history').iterate()) {
    const decision = parse(row);
    if (!db.prepare('SELECT 1 FROM catalog_decisions WHERE id=?').get(decision.id))
      fail('CATALOG_BUNDLE_FOREIGN_DECISION', 'The handover contains an orphaned customer decision.');
    const original = parse(db.prepare('SELECT record_json FROM catalog_materials WHERE edition_id=? AND material_key=?').get(decision.editionId, decision.materialKey));
    const revision = parse(db.prepare('SELECT record_json FROM catalog_history WHERE catalog_id=? AND revision=?').get(catalog.id, decision.catalogRevision));
    if (!original || original.sha256 !== decision.materialSha256 || original.materialId !== decision.materialId ||
        !revision || revision.activeEditionId !== decision.editionId)
      fail('CATALOG_BUNDLE_DECISION_MATERIAL_CHANGED', 'A customer decision does not match its originally selected material and edition.');
  }
  return { catalog, editions, supplier: validateSupplierClosure(db, header) };
}
function mergeRows(workspace, staged, table) {
  const columns = tables()[table], selected = keys[table];
  const where = selected.map(key => key + '=?').join(' AND ');
  const get = workspace.db.prepare('SELECT * FROM ' + table + ' WHERE ' + where);
  const insert = workspace.db.prepare('INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')');
  const mutable = table === 'catalog_catalogs' || table === 'catalog_decisions' || SUPPLIER_MUTABLE.has(table);
  for (const row of staged.prepare('SELECT * FROM ' + table).iterate()) {
    const prior = get.get(...selected.map(key => row[key]));
    if (!prior) { insert.run(...columns.map(key => row[key])); continue; }
    if (table === 'catalog_sources') {
      if (sourceIdentity(parse(prior)) !== sourceIdentity(parse(row))) fail('CATALOG_BUNDLE_EXISTING_SOURCE_CHANGED', 'A source conflicts with existing retained work.', 409);
      continue;
    }
    if (SUPPLIER_MUTABLE.has(table) && columns.some(key => !['revision','record_json'].includes(key) && prior[key] !== row[key]))
      fail('SUPPLIER_BUNDLE_EXISTING_IDENTITY_CHANGED', 'The supplier plan or correction conflicts with an existing identity.', 409);
    if (mutable && prior.revision !== row.revision) {
      if (prior.revision > row.revision) continue;
      workspace.db.prepare('UPDATE ' + table + ' SET revision=?,record_json=? WHERE id=?').run(row.revision, row.record_json, row.id);
      continue;
    }
    if (columns.some(key => key !== 'record_json' && prior[key] !== row[key]) ||
        canonical(parse(prior)) !== canonical(parse(row)))
      fail('CATALOG_BUNDLE_EXISTING_HISTORY_CHANGED', 'The handover conflicts with retained ' + table.replace('catalog_', '') + ' history.', 409);
  }
}
export function importCatalogBundle(workspace, meta, iterable) {
  const request = { requestId: identifier(meta.requestId, 'request ID'), name: catalogText(meta.name, 'Bundle name', 240),
    bytes: meta.bytes, sha256: meta.sha256 };
  workspace.open();
  const imported = workspace.perform('catalog-import', request, async operation => {
    await workspace.directories();
    const bundle = join(workspace.root, 'transfers', request.requestId + '.jsonl');
    await workspace.retainBytes(request, iterable, bundle);
    const directory = join(workspace.root, 'transfers', request.requestId + '.stage');
    await mkdir(directory, { mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('CATALOG_BUNDLE_STAGE_INVALID', 'Use the original private receiving directory.');
    const databasePath = join(directory, 'catalog.sqlite3');
    const created = await open(databasePath, 'wx', 0o600); await created.close();
    const db = new DatabaseSync(databasePath); let liveSource;
    workspace.importStageReaders.set(operation.id, db);
    try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'); stageTables(db);
    const hash = createHash('sha256'); let frames = 0, header, footer, sourceBytes = 0;
    let rowCounts = Object.fromEntries(Object.keys(CATALOG_TABLES).map(name => [name, 0]));
    const completedSources = new Set();
    let pendingRows = [], pendingBytes = 0;
    const inserts = Object.fromEntries(Object.entries(tables()).map(([table, columns]) => [table,
      db.prepare('INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')')]));
    const flushRows = () => {
      if (!pendingRows.length) return;
      db.exec('BEGIN IMMEDIATE');
      try { for (const item of pendingRows) inserts[item.table].run(...item.values); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      pendingRows = []; pendingBytes = 0;
    };
      for await (const raw of lines(bundle)) {
        let frame; try { frame = JSON.parse(raw); } catch { fail('CATALOG_BUNDLE_JSON_INVALID', 'The handover contains an invalid JSON record.'); }
        if (footer) fail('CATALOG_BUNDLE_TRAILING_CONTENT', 'The handover contains records after completion.');
        if (!header) {
          if (frame?.type !== 'header' || ![CATALOG_BUNDLE_SCHEMA,CATALOG_SUPPLIER_BUNDLE_SCHEMA].includes(frame.schema) || !validRevision(frame.catalogRevision))
            fail('CATALOG_BUNDLE_HEADER_REQUIRED', 'Select a complete material catalog handover.');
          identifier(frame.catalogId); catalogText(frame.tenantId, 'Tenant ID', 256);
          header = frame;
          if (header.schema === CATALOG_SUPPLIER_BUNDLE_SCHEMA)
            rowCounts = Object.fromEntries(Object.keys(tables()).map(name => [name, 0]));
        } else if (frame.type === 'complete') {
          flushRows();
          if (liveSource || frame.schema !== header.schema || frame.catalogId !== header.catalogId ||
              frame.frames !== frames || canonical(frame.rows) !== canonical(rowCounts) || frame.sourceBytes !== sourceBytes ||
              frame.payloadSha256 !== hash.digest('hex'))
            fail('CATALOG_BUNDLE_COMPLETION_CHANGED', 'The complete bundle manifest does not match its original records and source streams.');
          footer = frame; continue;
        } else if (frame.type === 'record') {
          if (liveSource) fail('CATALOG_BUNDLE_SOURCE_INTERLEAVED', 'Complete each original source stream before the next record.');
          validateRow(frame.table, frame.values, header);
          pendingRows.push(frame); pendingBytes += Buffer.byteLength(raw);
          rowCounts[frame.table]++;
          if (pendingRows.length >= 1000 || pendingBytes >= 2 * 1024 * 1024) flushRows();
        } else if (frame.type === 'source-start') {
          flushRows();
          if (liveSource || completedSources.has(frame.id)) fail('CATALOG_BUNDLE_SOURCE_REPEATED', 'Each source must have one original byte stream.');
          identifier(frame.id);
          const expected = parse(db.prepare('SELECT record_json FROM catalog_sources WHERE id=?').get(frame.id));
          if (!expected) fail('CATALOG_BUNDLE_SOURCE_MANIFEST_MISSING', 'Source bytes require their original manifest first.');
          const path = join(directory, 'source-' + frame.id + '.bin');
          liveSource = { expected, path, hash: createHash('sha256'), bytes: 0, file: await open(path, 'wx', 0o600) };
        } else if (frame.type === 'source-chunk') {
          if (!liveSource || frame.id !== liveSource.expected.id || frame.offset !== liveSource.bytes ||
              typeof frame.base64 !== 'string' || frame.base64.length > 524288)
            fail('CATALOG_BUNDLE_SOURCE_CHUNK_INVALID', 'The source byte stream has an invalid identity, offset or encoding.');
          const bytes = Buffer.from(frame.base64, 'base64');
          if (bytes.toString('base64') !== frame.base64) fail('CATALOG_BUNDLE_SOURCE_ENCODING_INVALID', 'Use the exact original base64 source encoding.');
          liveSource.bytes += bytes.length;
          if (liveSource.bytes > liveSource.expected.bytes) fail('CATALOG_BUNDLE_SOURCE_TOO_LONG', 'The source stream exceeds its original byte count.');
          liveSource.hash.update(bytes); await liveSource.file.writeFile(bytes);
        } else if (frame.type === 'source-end') {
          if (!liveSource || frame.id !== liveSource.expected.id || frame.bytes !== liveSource.expected.bytes ||
              liveSource.bytes !== frame.bytes || frame.sha256 !== liveSource.expected.sha256 || liveSource.hash.digest('hex') !== frame.sha256)
            fail('CATALOG_BUNDLE_SOURCE_CHANGED', 'The original source bytes do not match their retained manifest.');
          await liveSource.file.sync(); await liveSource.file.close();
          sourceBytes += liveSource.bytes; completedSources.add(frame.id); liveSource = null;
        } else fail('CATALOG_BUNDLE_RECORD_INVALID', 'The handover contains an unsupported record type.');
        hash.update(raw); frames++;
      }
      if (!header || !footer || liveSource) fail('CATALOG_BUNDLE_INCOMPLETE', 'The original handover is incomplete.');
      const closure = validateClosure(db, header, completedSources);
      for (const id of completedSources) {
        const sourcePath = join(directory, 'source-' + id + '.bin'), destination = workspace.sourcePath(id);
        try { await link(sourcePath, destination); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const expected = parse(db.prepare('SELECT record_json FROM catalog_sources WHERE id=?').get(id));
          const actual = await hashCatalogFile(destination);
          if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
            fail('CATALOG_BUNDLE_TARGET_SOURCE_CHANGED', 'An existing retained source has different bytes.', 409);
        }
        await chmod(destination, 0o600);
      }
      const sourceDirectory = await open(join(workspace.root, 'sources'), 'r');
      try { await sourceDirectory.sync(); } finally { await sourceDirectory.close(); }
      return workspace.store.transaction(() => {
        // Immutable histories are checked before current pointers advance. Newer local
        // revisions survive a replay of an earlier handover from the same history.
        for (const table of ['catalog_sources','catalog_history','catalog_editions','catalog_materials',
          'catalog_decision_history','catalog_decisions','catalog_catalogs', ...SUPPLIER_MERGE_ORDER]) mergeRows(workspace, db, table);
        for (const edition of closure.editions) workspace.buildSearchIndex(edition);
        const catalog = workspace.catalog(closure.catalog.id);
        const result = { catalog, importedRevision: closure.catalog.revision,
          supplier: closure.supplier,
          handover: { schema: header.schema, sha256: request.sha256, bytes: request.bytes,
            sourceWorkspaceId: header.sourceWorkspaceId, payloadSha256: footer.payloadSha256,
            rows: rowCounts, sourceBytes } };
        workspace.complete(operation, result); return result;
      });
    } finally {
      if (liveSource) await liveSource.file.close().catch(() => {});
      db.close();
      workspace.importStageReaders.delete(operation.id); workspace.importClosedStages.add(operation.id);
    }
  });
  return trackCatalogStorageWork(workspace, async () => {
    const result = await imported;
    // The successful close marker, or ended original owner, gates stage retirement.
    // Cleanup has its own receipt; storage errors never rewrite COMPLETE business work.
    await retireCompletedCatalogImport(workspace, result);
    return result;
  });
}
