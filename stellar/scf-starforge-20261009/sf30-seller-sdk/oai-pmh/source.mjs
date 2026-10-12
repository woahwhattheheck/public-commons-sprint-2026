// MIT. Complete OAI capture custody and the ORIGINAL SF30 dataset query engine.
import { constants } from 'node:fs';
import { open, realpath, readdir, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { absolute, privateDirectory, readPrivate, hashPrivate, digest,
  createFile, syncDirectory, object, fault } from '../postgres/publisher/files.mjs';
import { OAI_CAPTURE_SCHEMA, OAI_QUERY, OAI_LIMITS, HASH, member, only,
  validateOaiSource, bindOaiInput } from './declaration.mjs';

const parse = (value, code) => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw fault(code, 'The retained source is not valid UTF-8 JSON.'); }
};
const natural = value => Number.isSafeInteger(value) && value >= 0;
const requiredText = (value, maximum) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
function captureShape(capture) {
  if (!object(capture) || capture.schema !== OAI_CAPTURE_SCHEMA || capture.provider !== 'oai-pmh' ||
      capture.readOnly !== true || capture.state !== 'COMPLETE' ||
      !object(capture.repository) || !requiredText(capture.repository.id, 512) ||
      !requiredText(capture.repository.baseURL, 8192) || !object(capture.repository.identify) ||
      !object(capture.selection) || !requiredText(capture.selection.metadataPrefix, 256) ||
      !requiredText(capture.operationId, 512) || !Number.isSafeInteger(capture.attempt) || capture.attempt < 1)
    throw fault('OAI_CAPTURE_INCOMPLETE', 'Choose a completed capture from the original OAI-PMH workspace.');
  let url;
  try { url = new URL(capture.repository.baseURL); } catch { throw fault('OAI_REPOSITORY_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw fault('OAI_REPOSITORY_URL');
  const edition = capture.edition, build = capture.build, review = edition?.review;
  if (!object(edition) || !HASH.test(edition.id ?? '') || !natural(edition.activeRecords) ||
      !natural(edition.deletedRecords) || !object(review) || !HASH.test(review.digest ?? '') ||
      !requiredText(review.reviewer, 128) || !requiredText(review.note, 8192) ||
      typeof review.recordedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(review.recordedAt) ||
      !Number.isFinite(Date.parse(review.recordedAt)) || !object(build) ||
      !requiredText(build.id, 512) || !requiredText(build.planId, 512) ||
      !HASH.test(build.datasetSnapshot ?? '') || !natural(build.rowCount) ||
      build.rowCount !== edition.activeRecords)
    throw fault('OAI_REVIEWED_EDITION_REQUIRED', 'The capture must retain its reviewed edition and matching native build.');
  const paths = {
    dataFile: 'data.csv', datasetFile: 'dataset.json', mappingFile: 'mapping.json',
    lineageFile: 'lineage.json', recordsFile: 'records.jsonl', requestsFile: 'requests.jsonl',
  };
  if (Object.entries(paths).some(([key, path]) => capture[key] !== path) ||
      !Array.isArray(capture.files) || capture.files.length < Object.keys(paths).length ||
      capture.files.length > OAI_LIMITS.members)
    throw fault('OAI_CAPTURE_FILES');
  const files = new Map(); let total = 0;
  for (const item of capture.files) {
    only(item, ['file', 'bytes', 'sha256'], 'OAI_CAPTURE_DESCRIPTOR');
    const name = member(item.file);
    if (name === 'capture.json' || files.has(name) || !natural(item.bytes) ||
        item.bytes > OAI_LIMITS.memberBytes || !HASH.test(item.sha256 ?? ''))
      throw fault('OAI_CAPTURE_DESCRIPTOR', 'Every retained member needs one exact length and SHA-256.');
    total += item.bytes;
    if (!Number.isSafeInteger(total) || total > OAI_LIMITS.captureBytes) throw fault('OAI_CAPTURE_SIZE', 'The complete capture exceeds 2 GiB.', 413);
    files.set(name, { file: name, bytes: item.bytes, sha256: item.sha256 });
  }
  if (Object.values(paths).some(path => !files.has(path))) throw fault('OAI_CAPTURE_FILES');
  return { files, total };
}
async function canonicalFile(path) {
  if (await realpath(path) !== resolve(path)) throw fault('OAI_CAPTURE_SYMLINK', 'Retained files must use their canonical paths.');
}
async function verifyInventory(root, expected) {
  const found = new Set();
  async function visit(directory, prefix = '') {
    await privateDirectory(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = member(prefix + entry.name), path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw fault('OAI_CAPTURE_SYMLINK');
      if (entry.isDirectory()) await visit(path, name + '/');
      else {
        if (!entry.isFile() || found.size >= OAI_LIMITS.members + 1 ||
            name !== 'capture.json' && !expected.has(name)) throw fault('OAI_CAPTURE_UNLISTED_MEMBER', 'The capture inventory differs from its manifest.');
        found.add(name);
      }
    }
  }
  await visit(root);
  if (found.size !== expected.size + 1 || !found.has('capture.json') ||
      [...expected.keys()].some(name => !found.has(name))) throw fault('OAI_CAPTURE_MEMBER_MISSING');
}
export function oaiDatasetConfig(config) {
  return { ...structuredClone(config), file: 'data.csv',
    columns: Object.fromEntries(Object.entries(config.columns).map(([name, supplied]) => {
      const spec = typeof supplied === 'string' ? { type: supplied } : supplied;
      return [name, { type: spec.type, nullable: spec.nullable ?? false }];
    })),
    filters: config.filters ?? [], ranges: config.ranges ?? [], sorts: config.sorts ?? [],
    maxBytes: config.maxBytes ?? 64 * 1024 * 1024, maxRows: config.maxRows ?? 250000,
    maxCellChars: config.maxCellChars ?? 65536, defaultLimit: config.defaultLimit ?? 50,
    maxLimit: config.maxLimit ?? 250, maxPageBytes: config.maxPageBytes ?? 900 * 1024 };
}

/** Verify every member before opening the maintained immutable dataset loader. */
export async function readOaiSourceFile(path, { loadDataset = true } = {}) {
  if (typeof loadDataset !== 'boolean') throw fault('OAI_SOURCE_OPTIONS');
  const sourceFile = absolute(resolve(path), 'source file');
  await privateDirectory(dirname(sourceFile)); await canonicalFile(sourceFile);
  const original = await readPrivate(sourceFile, OAI_LIMITS.sourceBytes);
  const config = validateOaiSource(parse(original, 'OAI_SOURCE_JSON'));
  const captureFile = resolve(dirname(sourceFile), config.connection.file), root = dirname(captureFile);
  await privateDirectory(root); await canonicalFile(captureFile);
  const captureBytes = await readPrivate(captureFile, OAI_LIMITS.manifestBytes);
  if (digest(captureBytes) !== config.connection.sha256) throw fault('OAI_CAPTURE_CHANGED', 'The source manifest SHA-256 has changed.', 409);
  const capture = parse(captureBytes, 'OAI_CAPTURE_JSON'), { files, total } = captureShape(capture);
  await verifyInventory(root, files);
  for (const [name, expected] of files) {
    const file = join(root, name); await canonicalFile(file);
    const actual = await hashPrivate(file, OAI_LIMITS.memberBytes);
    if (actual.hash !== expected.sha256 || actual.bytes !== expected.bytes)
      throw fault('OAI_CAPTURE_CHANGED', 'A retained capture member differs: ' + name, 409);
  }
  const datasetBytes = await readPrivate(join(root, capture.datasetFile), 65536);
  const datasetConfig = parse(datasetBytes, 'OAI_DATASET_JSON');
  if (datasetConfig.file !== capture.dataFile) throw fault('OAI_DATASET_BINDING', 'Use the adjacent captured data.csv.');
  const lineage = parse(await readPrivate(join(root, capture.lineageFile), OAI_LIMITS.lineageBytes), 'OAI_LINEAGE_JSON');
  const edition = Array.isArray(lineage.editions) ? lineage.editions.find(value => value?.id === capture.edition.id) : null;
  if (lineage.schema !== 'stellar-forge.oai-pmh-lineage.v1' || !edition ||
      !Object.entries(capture.build).every(([key, value]) => isDeepStrictEqual(lineage.build?.[key], value)) ||
      !Object.entries(capture.edition).every(([key, value]) => isDeepStrictEqual(edition[key], value)) ||
      !isDeepStrictEqual(edition.repository, capture.repository) || !isDeepStrictEqual(edition.selection, capture.selection) ||
      edition.operationId !== capture.operationId || edition.attempt !== capture.attempt)
    throw fault('OAI_LINEAGE_CHANGED', 'The captured lineage does not describe this exact reviewed edition and build.', 409);
  if (!loadDataset) return { sourceFile, original, sourceHash: digest(original), config, captureFile, captureBytes,
    capture, root, files: [...files.values()], totalBytes: total, datasetConfig };
  const dataset = await loadDatasetConfig(join(root, capture.datasetFile)), description = dataset.describe();
  if (description.rowCount !== capture.build.rowCount || description.snapshot !== capture.build.datasetSnapshot)
    throw fault('OAI_DATASET_CHANGED', 'The original dataset row count or snapshot differs from the captured build.', 409);
  const csv = await hashPrivate(join(root, capture.dataFile), OAI_LIMITS.memberBytes);
  if (csv.hash !== files.get(capture.dataFile).sha256 || csv.bytes !== files.get(capture.dataFile).bytes ||
      !datasetBytes.equals(await readPrivate(join(root, capture.datasetFile), 65536)) ||
      !captureBytes.equals(await readPrivate(captureFile, OAI_LIMITS.manifestBytes)) ||
      !original.equals(await readPrivate(sourceFile, OAI_LIMITS.sourceBytes)))
    throw fault('OAI_SOURCE_CHANGED_DURING_OPEN', 'The retained source changed while its original dataset was loading.', 409);
  return { sourceFile, original, sourceHash: digest(original), config, captureFile, captureBytes,
    capture, root, files: [...files.values()], totalBytes: total, datasetConfig, dataset, description };
}

/** Copy only manifest-declared original bytes, hashing while streaming. */
export async function copyOaiCapture(retained, destination) {
  absolute(destination, 'capture directory');
  let created = false;
  try {
    await mkdir(destination, { mode: 0o700 }); created = true;
    for (const expected of retained.files) {
      const source = join(retained.root, expected.file), target = join(destination, expected.file);
      await canonicalFile(source); await privateDirectory(dirname(target), true);
      const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let output;
      try {
        const before = await input.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.mode & 0o077n ||
            before.size !== BigInt(expected.bytes)) throw fault('OAI_CAPTURE_CHANGED');
        output = await open(target, 'wx', 0o600);
        const hash = createHash('sha256'); let count = 0;
        for await (const chunk of input.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
          count += chunk.length;
          if (count > expected.bytes) throw fault('OAI_CAPTURE_CHANGED');
          hash.update(chunk); await output.writeFile(chunk);
        }
        const after = await input.stat({ bigint: true });
        if (count !== expected.bytes || hash.digest('hex') !== expected.sha256 ||
            before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
          throw fault('OAI_CAPTURE_CHANGED', 'The retained capture changed during its plan copy.', 409);
        await output.sync();
      } finally { await output?.close(); await input.close(); }
    }
    await createFile(join(destination, 'capture.json'), retained.captureBytes);
    const directories = new Set(retained.files.map(item => dirname(join(destination, item.file))));
    for (const directory of directories) await syncDirectory(directory);
    await syncDirectory(destination); await syncDirectory(dirname(destination));
    return { manifestSha256: retained.config.connection.sha256, files: retained.files.length + 1, bytes: retained.totalBytes + retained.captureBytes.length };
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function openOaiSourceFile(path) {
  const retained = await readOaiSourceFile(path);
  let dataset = retained.dataset, closed = false, active = false;
  delete retained.dataset;
  const types = retained.description.columns.map(({ name, type, nullable }) => ({ name, type, nullable }));
  function available() { if (closed) throw fault('OAI_SOURCE_CLOSED'); }
  function inspect() {
    available();
    return { schema: 'stellar-forge.oai-pmh-source-inspection.v1', provider: 'oai-pmh', readOnly: true,
      sourceHash: retained.sourceHash, manifestSha256: retained.config.connection.sha256,
      repository: structuredClone(retained.capture.repository), selection: structuredClone(retained.capture.selection),
      edition: structuredClone(retained.capture.edition), build: structuredClone(retained.capture.build),
      queries: { records: { columns: types.map(value => value.name), parameters: {}, dataset: structuredClone(retained.description) } },
      columnTypes: { records: structuredClone(types) } };
  }
  async function exportDataset(query, input = {}, options = {}) {
    available();
    if (active) throw fault('OAI_EXTRACTION_BUSY', 'This retained source already has an extraction in progress.', 409);
    if (query !== OAI_QUERY) throw fault('OAI_QUERY_NOT_FOUND');
    const selected = bindOaiInput(input, retained.description);
    const maxRows = options.maxRows ?? retained.datasetConfig.maxRows ?? 250000;
    const maxBytes = options.maxBytes ?? retained.datasetConfig.maxBytes ?? 64 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 300000;
    let limit = options.pageRows ?? Math.min(250, retained.description.maxLimit);
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1000000 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > retained.description.maxLimit ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000 ||
        typeof options.onRow !== 'function') throw fault('OAI_EXTRACTION_OPTIONS');
    if (retained.description.rowCount > maxRows) throw fault('OAI_EXTRACTION_ROW_LIMIT', 'The reviewed edition exceeds this extraction row limit.', 413);
    const started = Date.now(), cursors = new Set();
    let cursor = null, count = 0, pageCount = 0;
    const interrupt = () => {
      available();
      if (options.signal?.aborted) throw fault('OAI_EXTRACTION_CANCELLED');
      if (Date.now() - started > timeoutMs) throw fault('OAI_EXTRACTION_TIMEOUT');
    };
    active = true;
    try {
      do {
        interrupt();
        const parameters = { ...selected, limit: String(limit), ...(cursor ? { cursor } : {}) };
        let response = dataset.handle({ query: parameters });
        // Preserve the original cursor and query while respecting its byte budget.
        while (response.status === 413 && response.body?.error === 'DATASET_PAGE_TOO_LARGE' && limit > 1) {
          limit = Math.max(1, Math.floor(limit / 2));
          parameters.limit = String(limit); response = dataset.handle({ query: parameters });
        }
        if (response.status !== 200) throw fault(response.body?.error ?? 'OAI_NATIVE_PAGE_FAILED', response.body?.message, response.status);
        const body = response.body;
        if (body.schema !== 'stellar-forge.dataset-page.v1' || body.dataset.snapshot !== retained.description.snapshot ||
            body.page.total !== retained.description.rowCount || body.page.returned !== body.rows.length ||
            !isDeepStrictEqual(body.fields, types.map(value => value.name)))
          throw fault('OAI_NATIVE_POPULATION_CHANGED');
        pageCount++;
        for (const row of body.rows) {
          interrupt(); count++;
          if (count > maxRows || count > retained.description.rowCount) throw fault('OAI_EXTRACTION_ROW_LIMIT');
          await options.onRow(row, structuredClone(types), { rowCount: count, page: pageCount });
        }
        const next = body.page.nextCursor;
        if (next !== null && (typeof next !== 'string' || !next || cursors.has(next) || body.rows.length === 0))
          throw fault('OAI_NATIVE_CURSOR_CHANGED');
        if (next !== null) cursors.add(next);
        cursor = next;
      } while (cursor !== null);
      if (count !== retained.description.rowCount) throw fault('OAI_NATIVE_POPULATION_CHANGED');
      return { schema: 'stellar-forge.oai-pmh-dataset-extraction.v1', provider: 'oai-pmh',
        complete: true, readOnly: true, sourceHash: retained.sourceHash,
        manifestSha256: retained.config.connection.sha256, operationId: retained.capture.operationId,
        attempt: retained.capture.attempt, editionId: retained.capture.edition.id,
        reviewDigest: retained.capture.edition.review.digest, buildId: retained.capture.build.id,
        datasetSnapshot: retained.description.snapshot, rowCount: count, sourceRowCount: retained.capture.build.rowCount,
        deletedRecords: retained.capture.edition.deletedRecords, pageCount, order: selected.sort ?? 'csv-record-order',
        columns: types.map(value => value.name), columnTypes: structuredClone(types), valueEncoding: 'sf30-native-scalars' };
    } finally { active = false; }
  }
  const source = Object.freeze({
    inspect, exportDataset,
    handle(context) { available(); return dataset.handle(context); },
    admit(context) { available(); return dataset.admit(context); },
    async close() { closed = true; dataset = null; },
  });
  return { sourceFile: retained.sourceFile, config: retained.config, source };
}
