// MIT. Exact Snowflake native strings/nulls in an original SQLite merchant source.
import { DatabaseSync } from 'node:sqlite';
import { open, mkdir, lstat, realpath, unlink, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicFile, atomicJson, boundedFile, canonical, sha256 } from '../../sf46-release/release-core.mjs';
import { compileSnowflakeSource, fault, integer } from './declaration.mjs';
import { inspectSnowflakePartition } from './source.mjs';
import { HASH, json } from './store.mjs';
import { snowflakeCloudDeliveryManifest } from './cloud-delivery.mjs';

const q = name => '"' + name.replaceAll('"', '""') + '"';
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || await realpath(path) !== path)
    throw fault('SNOWFLAKE_PRIVATE_DIRECTORY_REQUIRED');
}
function requiredEdition(store, id) {
  const edition = store.edition(id);
  if (!edition.complete || edition.schema !== 'stellar-forge.snowflake-edition.v1')
    throw fault('SNOWFLAKE_COMPLETE_EDITION_REQUIRED');
  return edition;
}
export async function* originalRows(store, editionId) {
  const edition = requiredEdition(store, editionId), operation = store.operation(edition.operationId);
  const source = compileSnowflakeSource(store.source(edition.sourceId).config), query = source.queries[edition.queryName];
  let total = 0;
  for (const [index, part] of edition.partitions.entries()) {
    if (part.index !== index) throw fault('SNOWFLAKE_PARTITION_ORDER_CHANGED');
    const bytes = await store.readObject(part), value = parse(bytes);
    const checked = inspectSnowflakePartition(value, { query, resultMetadata: edition.metadata, index,
      statementHandle: edition.statementHandle });
    if (checked.rows.length !== part.rows) throw fault('SNOWFLAKE_PARTITION_COUNT_CHANGED');
    for (const row of checked.rows) { total++; yield row; }
  }
  if (total !== edition.rowCount || sha256(canonical(operation.body)) !== edition.requestSha256)
    throw fault('SNOWFLAKE_EDITION_CLOSURE_CHANGED');
}

/** Every provider cell is TEXT or SQL NULL. Exact source bodies also travel in
 * the same SQLite file, so the original SF82 native backup carries provenance. */
async function buildEdition(store, editionId) {
  const edition = requiredEdition(store, editionId), root = join(store.directory, 'editions');
  await directory(root);
  const path = join(root, editionId + '.sqlite');
  try {
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.mode & 0o077) throw fault('SNOWFLAKE_EDITION_DATABASE_INVALID');
    const saved = store.derivative(editionId);
    if (!saved) {
      await rename(path, path + '.interrupted-' + randomUUID());
      throw Object.assign(new Error('Rebuild interrupted local materialization from retained originals.'), { code: 'ENOENT' });
    }
    await verifyDatabase(path, saved);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (db.prepare("SELECT value FROM __sf30_snowflake_meta WHERE name='editionId'").get()?.value !== editionId ||
          db.prepare('SELECT count(*) AS n FROM records').get().n !== edition.rowCount)
        throw fault('SNOWFLAKE_EDITION_DATABASE_CHANGED');
      const originals = db.prepare('SELECT partition_number AS partitionNumber,sha256,bytes,length(body) AS actualBytes FROM __sf30_snowflake_originals ORDER BY partition_number').all();
      if (originals.length !== edition.partitions.length || originals.some((item, index) =>
        item.partitionNumber !== index || item.sha256 !== edition.partitions[index].sha256 ||
        item.bytes !== edition.partitions[index].bytes || item.actualBytes !== item.bytes))
        throw fault('SNOWFLAKE_EDITION_DATABASE_CHANGED');
      return { path, editionId, rowCount: edition.rowCount };
    } finally { db.close(); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.building-' + randomUUID();
  const owned = await open(temporary, 'wx', 0o600); await owned.close();
  let db;
  try {
    db = new DatabaseSync(temporary);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    db.exec('CREATE TABLE records (__sf30_row_number INTEGER PRIMARY KEY, ' +
      edition.columns.map(name => q(name) + ' TEXT').join(', ') + ') STRICT;');
    db.exec('CREATE TABLE __sf30_snowflake_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
    db.exec('CREATE TABLE __sf30_snowflake_originals (partition_number INTEGER PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, body BLOB NOT NULL) STRICT;');
    db.exec('BEGIN IMMEDIATE');
    const put = db.prepare('INSERT INTO records VALUES (' + Array(edition.columns.length + 1).fill('?').join(',') + ')');
    let rowNumber = 0;
    for await (const row of originalRows(store, editionId)) put.run(++rowNumber, ...row);
    const original = db.prepare('INSERT INTO __sf30_snowflake_originals VALUES (?,?,?,?)');
    for (const part of edition.partitions) original.run(part.index, part.sha256, part.bytes, await store.readObject(part));
    const metadata = db.prepare('INSERT INTO __sf30_snowflake_meta VALUES (?,?)');
    const operation = store.operation(edition.operationId);
    for (const [name, value] of Object.entries({ editionId, edition: json(edition), request: json(operation.body),
      accountOrigin: operation.origin, sourceConfiguration: json(store.source(edition.sourceId).config) })) metadata.run(name, value);
    if (edition.keyColumns.length) db.exec('CREATE INDEX records_comparison_key ON records (' + edition.keyColumns.map(q).join(',') + ')');
    db.exec('COMMIT');
    db.close(); db = null;
    const file = await open(temporary, 'r'); try { await file.sync(); } finally { await file.close(); }
    // One original workspace owner and one memoized build own this destination.
    const descriptor = await digestDatabase(temporary);
    await rename(temporary, path);
    store.saveDerivative(editionId, descriptor);
    const folder = await open(root, 'r'); try { await folder.sync(); } finally { await folder.close(); }
    return { path, editionId, rowCount: rowNumber };
  } catch (error) { try { db?.exec('ROLLBACK'); } catch {} db?.close(); await unlink(temporary).catch(() => {}); throw error; }
}

const pendingBuilds = new WeakMap();
const verifiedFiles = new Map();
async function digestDatabase(path) {
  const input = await open(path, 'r');
  try {
    const before = await input.stat({ bigint: true }), hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of input.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += chunk.length; }
    const after = await input.stat({ bigint: true });
    if (before.size !== BigInt(bytes) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw fault('SNOWFLAKE_EDITION_DATABASE_CHANGED');
    return { bytes, sha256: hash.digest('hex') };
  } finally { await input.close(); }
}
async function verifyDatabase(path, expected) {
  const stat = await lstat(path, { bigint: true });
  const fingerprint = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':') + ':' + expected.sha256;
  if (verifiedFiles.get(path) === fingerprint) return;
  const actual = await digestDatabase(path);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
    throw fault('SNOWFLAKE_EDITION_DATABASE_CHANGED');
  verifiedFiles.set(path, fingerprint);
}
export async function materializeSnowflakeEdition(store, editionId) {
  let builds = pendingBuilds.get(store);
  if (!builds) { builds = new Map(); pendingBuilds.set(store, builds); }
  if (builds.has(editionId)) return builds.get(editionId);
  const task = buildEdition(store, editionId).finally(() => builds.delete(editionId));
  builds.set(editionId, task); return task;
}

export async function pageSnowflakeEdition(store, editionId, { offset = 0, limit = 50 } = {}) {
  integer(offset, 0, Number.MAX_SAFE_INTEGER, 'offset'); integer(limit, 1, 200, 'limit');
  const edition = requiredEdition(store, editionId), { path } = await materializeSnowflakeEdition(store, editionId);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare('SELECT ' + edition.columns.map(q).join(',') + ' FROM records ORDER BY __sf30_row_number LIMIT ? OFFSET ?').all(limit, offset);
    return { editionId, columns: edition.metadata.rowType, rows, offset, total: edition.rowCount,
      nextOffset: offset + rows.length < edition.rowCount ? offset + rows.length : null };
  } finally { db.close(); }
}

export async function compareSnowflakeEditions(store, beforeId, afterId, { limit = 50 } = {}) {
  integer(limit, 1, 200, 'comparison sample limit');
  const before = requiredEdition(store, beforeId), after = requiredEdition(store, afterId);
  const schema = { before: before.metadata.rowType, after: after.metadata.rowType,
    changed: canonical(before.metadata.rowType) !== canonical(after.metadata.rowType) };
  if (canonical(before.columns) !== canonical(after.columns))
    return { beforeId, afterId, mode: 'SCHEMA_CHANGED', schema, beforeRows: before.rowCount, afterRows: after.rowCount, changes: null };
  const [oldFile, newFile] = await Promise.all([materializeSnowflakeEdition(store, beforeId), materializeSnowflakeEdition(store, afterId)]);
  const db = new DatabaseSync(newFile.path, { readOnly: true });
  try {
    db.prepare('ATTACH DATABASE ? AS prior').run(oldFile.path); db.exec('PRAGMA query_only=ON');
    const keys = canonical(before.keyColumns) === canonical(after.keyColumns) ? after.keyColumns : [];
    const columns = after.columns;
    if (keys.length) {
      const grouped = keys.map(q).join(',');
      const duplicate = table => db.prepare('SELECT ' + grouped + ',count(*) AS duplicates FROM ' + table +
        ' GROUP BY ' + grouped + ' HAVING count(*)>1 LIMIT ?').all(limit);
      const oldDuplicates = duplicate('prior.records'), newDuplicates = duplicate('main.records');
      if (oldDuplicates.length || newDuplicates.length)
        return { beforeId, afterId, mode: 'DUPLICATE_KEYS', keys, schema, duplicates: { before: oldDuplicates, after: newDuplicates }, changes: null };
      const match = keys.map(name => 'a.' + q(name) + ' IS b.' + q(name)).join(' AND ');
      const equal = columns.map(name => 'a.' + q(name) + ' IS b.' + q(name)).join(' AND ');
      const added = 'FROM main.records a LEFT JOIN prior.records b ON ' + match + ' WHERE b.__sf30_row_number IS NULL';
      const removed = 'FROM prior.records a LEFT JOIN main.records b ON ' + match + ' WHERE b.__sf30_row_number IS NULL';
      const joined = 'FROM main.records a JOIN prior.records b ON ' + match;
      const count = sql => db.prepare('SELECT count(*) AS n ' + sql).get().n;
      const sample = sql => db.prepare('SELECT a.* ' + sql + ' ORDER BY a.__sf30_row_number LIMIT ?').all(limit);
      const updated = db.prepare('SELECT a.__sf30_row_number AS afterRow,b.__sf30_row_number AS beforeRow ' + joined +
        ' WHERE NOT (' + equal + ') ORDER BY a.__sf30_row_number LIMIT ?').all(limit);
      const originalColumns = columns.map(q).join(',');
      const beforeRow = db.prepare('SELECT ' + originalColumns + ' FROM prior.records WHERE __sf30_row_number=?');
      const afterRow = db.prepare('SELECT ' + originalColumns + ' FROM main.records WHERE __sf30_row_number=?');
      return { beforeId, afterId, mode: 'KEYED', keys, schema,
        counts: { added: count(added), removed: count(removed), updated: count(joined + ' WHERE NOT (' + equal + ')'),
          unchanged: count(joined + ' WHERE ' + equal) },
        samples: { added: sample(added), removed: sample(removed),
          updated: updated.map(item => ({ ...item, before: beforeRow.get(item.beforeRow), after: afterRow.get(item.afterRow) })) } };
    }
    const names = columns.map(q).join(',');
    const sql = 'WITH both AS (SELECT ' + names + ',1 AS __sf30_old_count,0 AS __sf30_new_count FROM prior.records UNION ALL SELECT ' +
      names + ',0 AS __sf30_old_count,1 AS __sf30_new_count FROM main.records), groups AS (SELECT ' + names +
      ',sum(__sf30_old_count) AS __sf30_old_count,sum(__sf30_new_count) AS __sf30_new_count FROM both GROUP BY ' + names + ') ';
    const counts = db.prepare(sql + 'SELECT coalesce(sum(max(__sf30_new_count-__sf30_old_count,0)),0) AS added,' +
      'coalesce(sum(max(__sf30_old_count-__sf30_new_count,0)),0) AS removed,coalesce(sum(min(__sf30_old_count,__sf30_new_count)),0) AS unchanged FROM groups').get();
    const rows = db.prepare(sql + 'SELECT * FROM groups WHERE __sf30_old_count<>__sf30_new_count LIMIT ?').all(limit);
    return { beforeId, afterId, mode: 'ROW_MULTISET', schema, counts: { ...counts, updated: null },
      samples: rows, explanation: 'Without unique declared keys, added and removed counts preserve duplicate-row multiplicity.' };
  } finally { db.close(); }
}

/** Portable exact original SQL API files for the existing cloud-delivery intake. */
export async function exportSnowflakeOriginals(store, editionId, destination, { cloudDelivery } = {}) {
  const edition = requiredEdition(store, editionId), operation = store.operation(edition.operationId), root = resolve(destination);
  const descriptors = edition.partitions.map(part => ({ path: 'partition-' + String(part.index).padStart(5, '0') + '.json',
    bytes: part.bytes, sha256: part.sha256, partition: part.index }));
  const cloudManifest = cloudDelivery ? snowflakeCloudDeliveryManifest(edition, operation, descriptors, cloudDelivery) : null;
  await mkdir(root, { mode: 0o700 });
  if (await realpath(root) !== root) throw fault('SNOWFLAKE_EXPORT_DIRECTORY_INVALID');
  const files = [];
  for (const part of edition.partitions) {
    const name = 'partition-' + String(part.index).padStart(5, '0') + '.json';
    const bytes = await store.readObject(part);
    await atomicFile(join(root, name), bytes, 0o600, { exclusive: true });
    files.push({ path: name, bytes: bytes.length, sha256: part.sha256, partition: part.index });
  }
  const receiving = { schema: 'stellar-forge.snowflake-receiving.v1',
    source: store.source(edition.sourceId).config, sourceId: edition.sourceId,
    queryName: edition.queryName, arguments: operation.arguments, requestId: operation.requestId,
    origin: operation.origin, body: operation.body, statementHandle: edition.statementHandle,
    editionId, complete: true, capturedAt: edition.createdAt, partitions: files };
  await atomicJson(join(root, 'receiving.json'), receiving, { exclusive: true });
  await atomicJson(join(root, 'edition.json'), edition, { exclusive: true });
  if (cloudManifest) await atomicJson(join(root, 'cloud-delivery.json'), cloudManifest, { exclusive: true });
  await atomicFile(join(root, 'README.md'), '# Snowflake original result\n\nRead receiving.json, verify each complete partition length and SHA-256, then receive the same statement through the Snowflake workspace. Native string values and JSON nulls are preserved. The existing cloud-delivery intake uses format snowflake-json and transport retained-snowflake, with origin.statementHandle and origin.partition on each original file. All partitions belong to one ordered coverage family. Credentials are host-held environment references.\n', 0o600, { exclusive: true });
  return { directory: root, editionId, rows: edition.rowCount, partitions: files.length, receiving: join(root, 'receiving.json'),
    ...(cloudManifest ? { cloudDelivery: join(root, 'cloud-delivery.json') } : {}) };
}

export async function readSnowflakeReceiving(filename) {
  const path = resolve(filename), root = await realpath(dirname(path));
  const manifest = parse(await boundedFile(root, path.slice(root.length + 1), 2097152));
  if (manifest.schema !== 'stellar-forge.snowflake-receiving.v1' || !Array.isArray(manifest.partitions) ||
      !manifest.partitions.length || manifest.partitions.length > 20000)
    throw fault('SNOWFLAKE_RECEIVING_MANIFEST_INVALID');
  async function* partitions() {
    let totalBytes = 0;
    for (const [index, item] of manifest.partitions.entries()) {
      if (item.partition !== index || !HASH.test(item.sha256 ?? '') || !Number.isSafeInteger(item.bytes) ||
          item.bytes < 0 || item.bytes > 67108864 || (totalBytes += item.bytes) > 1073741824)
        throw fault('SNOWFLAKE_RECEIVING_DESCRIPTOR_INVALID');
      const bytes = await boundedFile(root, item.path, item.bytes);
      if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw fault('SNOWFLAKE_RECEIVING_BYTES_CHANGED');
      yield bytes;
    }
  }
  return { manifest, partitions: partitions() };
}
