// MIT. Immutable Cloud Delivery editions joined to the original DuckDB workspace.
import { constants, createReadStream } from 'node:fs';
import { open, lstat, readdir, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { operationId, revisionNumber, json, sha256 } from '../workspace/store.mjs';
import { readDuckdbSourceFile } from '../config.mjs';
import { prepareWorkbenchSource } from '../workbench/bootstrap.mjs';
import { createCloudStore } from './store.mjs';
import { INPUT_SCHEMA, WORKSPACE_SCHEMA, DELIVERY_SCHEMA, CONTRACTS, LIMITS, manifest as validateManifest,
  comparison as validateComparison, identifier, digest, byteCount, text, plain, issue, identity, relativePath } from './contract.mjs';
import { privateDirectory, within, readBytes, readJson, atomicJson, atomicBytes, fileDigest, retainFile, acceptStream } from './files.mjs';
import { runNative } from './native.mjs';

export async function emptyCloudSource(directory) {
  const root = await privateDirectory(resolve(directory, 'cloud', 'bootstrap'));
  const path = join(root, 'source.json');
  await atomicJson(path, { schema: 'stellar-forge.duckdb-source.v1', database: ':memory:', parquetFiles: [],
    queries: { workbenchSeed: { sql: 'SELECT CAST(1 AS BIGINT) AS workbench_seed', parameters: {},
      columns: ['workbench_seed'], maxRows: 1, maxBytes: 1024, timeoutMs: 1500 } } });
  return path;
}

export async function createCloudDelivery({ workspaceStore, python = 'python3', environment = process.env,
  currentSource, canSelect, inspectPackage, packageDirectory } = {}) {
  const store = workspaceStore.extension(createCloudStore), directory = workspaceStore.directory;
  const root = await privateDirectory(resolve(directory, 'cloud'));
  const at = () => new Date().toISOString();
  const pathFor = (kind, id) => resolve(root, kind, identifier(id));
  const editionFor = id => {
    const value = store.get('edition', identifier(id));
    if (!value) throw issue('CLOUD_EDITION_NOT_FOUND', undefined, 404);
    return value;
  };
  const comparisonFor = id => {
    const value = store.get('comparison', identifier(id));
    if (!value) throw issue('CLOUD_COMPARISON_NOT_FOUND', undefined, 404);
    return value;
  };
  const selectedPath = record => {
    if (record.storagePath) return resolve(directory, relativePath(record.storagePath));
    throw issue('CLOUD_RETAINED_PATH_MISSING', undefined, 409);
  };
  const editionInput = value => ({ root: selectedPath(value), manifest: value.manifest, inspection: value.inspection });
  const native = (input, where) => runNative(input, { directory: where, python, environment });
  const publicEdition = record => ({ id: record.id, label: record.manifest.label, transport: record.manifest.transport,
    capturedAt: record.manifest.capturedAt, createdAt: record.createdAt, state: record.state,
    manifestSha256: record.manifestSha256, files: record.manifest.files.length,
    bytes: String(record.manifest.files.reduce((sum, file) => sum + BigInt(file.bytes), 0n)),
    families: [...new Set(record.manifest.files.map(file => file.family))],
    coverage: record.inspection?.coverage ?? { state: 'NOT_INSPECTED', complete: false },
    inspection: record.inspection ?? null, error: record.error ?? null, receivedFrom: record.receivedFrom ?? null });
  function publicComparison(record) {
    return { id: record.id, state: record.state, createdAt: record.createdAt, request: record.request,
      requestSha256: record.requestSha256, counts: record.counts ?? null, schemaChanges: record.schemaChanges ?? null,
      coverage: record.coverage ?? null, scope: record.scope ?? null, findingsCount: record.findingsCount ?? 0, reportSha256: record.reportSha256 ?? null,
      reportUrl: '/api/cloud/report?id=' + encodeURIComponent(record.id),
      summaryUrl: '/api/cloud/report?id=' + encodeURIComponent(record.id) + '&kind=summary',
      review: record.review ?? { revision: 0, decision: 'unreviewed', note: null, reviewedAt: null, history: [] },
      error: record.error ?? null };
  }
  async function uploads(record) {
    const isArchive = Boolean(record.archive), files = isArchive ? [record.archive] : record.manifest.files;
    const base = isArchive ? pathFor('uploads', record.id) : selectedPath(record);
    const values = [];
    for (const file of files) {
      let present = false;
      try { const saved = await fileDigest(await within(base, file.path), isArchive ? LIMITS.totalBytes : LIMITS.fileBytes); present = saved.bytes === file.bytes && (!file.sha256 || saved.sha256 === file.sha256); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      values.push({ id: file.id, name: file.path, bytes: file.bytes, sha256: file.sha256, present,
        url: '/api/cloud/upload?edition=' + encodeURIComponent(record.id) + '&file=' + encodeURIComponent(file.id) });
    }
    return values;
  }
  async function editionDetail(id) {
    const record = store.get('edition', identifier(id)) ?? store.get('upload', id);
    if (!record) throw issue('CLOUD_EDITION_NOT_FOUND', undefined, 404);
    if (record.archive) return { id: record.id, archive: record.archive, state: record.state, uploads: await uploads(record), revision: store.revision() };
    return { ...publicEdition(record), manifest: record.manifest, uploads: await uploads(record), revision: store.revision() };
  }
  async function intake(input) {
    operationId(input.operationId); revisionNumber(input.expectedRevision);
    if (input.archive) {
      if (!plain(input.archive)) throw issue('CLOUD_ARCHIVE_DESCRIPTION_REQUIRED');
      const archive = { id: 'archive', path: 'handover.zip', name: text(input.archive.name, 240, 'archive filename'),
        bytes: byteCount(input.archive.bytes, LIMITS.totalBytes), ...(input.archive.sha256 === undefined ? {} : { sha256: digest(input.archive.sha256) }) };
      const request = { operationId: input.operationId, expectedRevision: input.expectedRevision, archive };
      const value = store.reserve('upload', input.operationId, request, 'UPLOADING', { archive }).record;
      await privateDirectory(pathFor('uploads', value.id));
      return { edition: await editionDetail(value.id), uploads: await uploads(value), revision: store.revision() };
    }
    const manifest = validateManifest(input.manifest);
    const request = { operationId: input.operationId, expectedRevision: input.expectedRevision, manifest };
    const destination = pathFor('editions', input.operationId), source = join(destination, 'source');
    const value = store.reserve('edition', input.operationId, request, 'UPLOADING', { manifest,
      manifestSha256: identity(manifest), storagePath: relative(directory, source), error: null }).record;
    await privateDirectory(source); await atomicJson(join(destination, 'manifest.json'), manifest);
    await atomicJson(join(destination, 'original-input.json'), input.manifest);
    return { edition: await editionDetail(value.id), uploads: await uploads(value), revision: store.revision() };
  }
  async function commit({ editionId }) {
    let value = editionFor(editionId);
    if (value.state === 'READY') return { edition: await editionDetail(value.id), revision: store.revision() };
    const missing = (await uploads(value)).filter(file => !file.present);
    if (missing.length) throw issue('CLOUD_ORIGINAL_FILES_MISSING', 'Retain every declared original file before finishing this edition.');
    value = store.update('edition', value.id, 'INSPECTING', { error: null }, 'inspection-started');
    const output = await privateDirectory(pathFor('editions', value.id));
    try {
      const result = await native({ action: 'inspect', edition: editionInput(value) }, output);
      store.update('edition', value.id, 'READY', { inspection: result.result, inspectedAt: at(), error: null }, 'inspection-completed');
      return { edition: await editionDetail(value.id), revision: store.revision() };
    } catch (error) {
      store.update('edition', value.id, 'FAILED', { error: error.code ?? 'CLOUD_INSPECTION_FAILED' }, 'inspection-failed'); throw error;
    }
  }
  async function importPacket(input) {
    if (typeof input.manifestPath !== 'string' || !input.manifestPath || input.manifestPath.includes('\0')) throw issue('CLOUD_MANIFEST_PATH_REQUIRED');
    const packetPath = await realpath(resolve(input.manifestPath));
    const bytes = await readBytes(packetPath, LIMITS.manifestBytes);
    let raw;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw issue('CLOUD_INPUT_MANIFEST_INVALID'); }
    const result = await intake({ ...input, manifest: raw });
    const value = editionFor(result.edition.id), target = pathFor('editions', value.id);
    await atomicBytes(join(target, 'original-packet.json'), bytes);
    for (const file of value.manifest.files) {
      const source = await within(dirname(packetPath), file.path), destination = await within(selectedPath(value), file.path, true);
      await retainFile(source, destination, file);
    }
    return commit({ editionId: value.id });
  }
  async function comparison(input) {
    const request = validateComparison(input), id = request.operationId;
    const left = editionFor(request.leftEditionId), right = editionFor(request.rightEditionId);
    if (left.state !== 'READY' || right.state !== 'READY') throw issue('CLOUD_INSPECT_BOTH_EDITIONS_FIRST');
    const out = await privateDirectory(pathFor('comparisons', id));
    let value = store.reserve('comparison', id, request, 'COMPARING', { storagePath: relative(directory, out), error: null }).record;
    if (value.state === 'READY') return { comparison: publicComparison(value), revision: store.revision() };
    try {
      const result = await native({ action: 'compare', left: editionInput(left), right: editionInput(right), request, outDir: out }, out);
      const summary = { schema: 'stellar-forge.coinmetrics-cloud-comparison.v1', id, request,
        requestSha256: value.requestSha256, leftManifestSha256: left.manifestSha256, rightManifestSha256: right.manifestSha256,
        ...result.result };
      await atomicJson(join(out, 'report.json'), summary);
      const header = JSON.stringify({ recordType: 'comparison', ...summary }) + '\n';
      const checksum = createHash('sha256').update(header);
      for await (const chunk of createReadStream(join(out, 'findings.jsonl'))) checksum.update(chunk);
      const stat = await lstat(join(out, 'findings.jsonl'), { bigint: true });
      value = store.update('comparison', id, 'READY', { ...result.result, error: null, reportHeader: header,
        reportSha256: checksum.digest('hex'), findingsIdentity: { size: String(stat.size), modifiedNs: String(stat.mtimeNs), inode: String(stat.ino) },
        review: { revision: 0, decision: 'unreviewed', note: null, reviewedAt: null, history: [] } }, 'comparison-completed');
      return { comparison: publicComparison(value), revision: store.revision() };
    } catch (error) {
      store.update('comparison', id, 'FAILED', { error: error.code ?? 'CLOUD_COMPARISON_FAILED' }, 'comparison-failed'); throw error;
    }
  }
  async function checkFindings(value) {
    const path = join(selectedPath(value), 'findings.jsonl'), stat = await lstat(path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || String(stat.size) !== value.findings.bytes)
      throw issue('CLOUD_COMPARISON_CHANGED', undefined, 409);
    const exact = value.findingsIdentity;
    if (!exact || String(stat.mtimeNs) !== exact.modifiedNs || String(stat.ino) !== exact.inode) {
      const found = await fileDigest(path);
      if (found.sha256 !== value.findings.sha256 || found.bytes !== value.findings.bytes) throw issue('CLOUD_COMPARISON_CHANGED', undefined, 409);
    }
    return path;
  }
  async function comparisonPage({ id, offset = 0, limit = 50 }) {
    const value = comparisonFor(id);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw issue('CLOUD_FINDING_PAGE_INVALID');
    if (value.state !== 'READY') return { ...publicComparison(value), findings: [], offset, limit, total: 0, nextOffset: null };
    const total = value.findingsCount, findings = [];
    if (offset < total) {
      const index = await readJson(join(selectedPath(value), 'findings.index.json'));
      const page = Math.floor(offset / index.stride), start = index.offsets[page];
      const path = await checkFindings(value);
      if (!Number.isSafeInteger(start)) throw issue('CLOUD_COMPARISON_INDEX_INVALID', undefined, 409);
      const stream = createReadStream(path, { start }), lines = createInterface({ input: stream, crlfDelay: Infinity });
      let position = page * index.stride, bytes = 0;
      try {
        for await (const line of lines) {
          if (position++ < offset) continue;
          bytes += Buffer.byteLength(line);
          if (bytes > 4194304) throw issue('CLOUD_FINDING_PAGE_BYTES_LIMIT', 'Download the complete comparison for these large source rows.');
          findings.push(JSON.parse(line));
          if (findings.length >= limit) break;
        }
      } finally { lines.close(); stream.destroy(); }
    }
    return { ...publicComparison(value), findings, offset, limit, total,
      nextOffset: offset + findings.length < total ? offset + findings.length : null };
  }
  async function review(input) {
    operationId(input.operationId); revisionNumber(input.expectedRevision); revisionNumber(input.expectedReviewRevision);
    if (!['accepted', 'changes-requested', 'reopened'].includes(input.decision)) throw issue('CLOUD_REVIEW_DECISION_INVALID');
    const request = { operationId: input.operationId, expectedRevision: input.expectedRevision,
      comparisonId: identifier(input.comparisonId), expectedReviewRevision: input.expectedReviewRevision,
      decision: input.decision, note: text(input.note, 8192, 'review note') };
    const old = store.get('review', input.operationId);
    if (old) {
      if (old.requestSha256 !== identity(request)) throw issue('CLOUD_OPERATION_CONTENT_CONFLICT', undefined, 409);
      if (old.state === 'READY') return { comparison: publicComparison(comparisonFor(request.comparisonId)), revision: store.revision() };
    }
    const value = comparisonFor(request.comparisonId), prior = publicComparison(value).review;
    if (value.state !== 'READY' || prior.revision !== request.expectedReviewRevision) throw issue('CLOUD_REVIEW_REVISION_CHANGED', undefined, 409);
    store.reserve('review', input.operationId, request, 'REVIEWING');
    const entry = { revision: prior.revision + 1, decision: request.decision, note: request.note, reviewedAt: at(), operationId: request.operationId };
    const updated = { ...entry, history: [...prior.history, entry] };
    store.update('review', input.operationId, 'READY', { comparisonId: value.id, review: entry }, 'review-saved',
      () => store.patchBody('comparison', value.id, { review: updated }));
    return { comparison: publicComparison(comparisonFor(value.id)), revision: store.revision() };
  }
  async function select(input) {
    operationId(input.operationId); revisionNumber(input.expectedRevision);
    const edition = editionFor(input.editionId);
    if (edition.state !== 'READY' || !Array.isArray(input.relationIds) || !input.relationIds.length || input.relationIds.length > 32 ||
        new Set(input.relationIds).size !== input.relationIds.length || input.relationIds.some(id => !edition.inspection.relations.some(row => row.id === id)))
      throw issue('CLOUD_SELECT_INSPECTED_RELATIONS');
    const request = { operationId: input.operationId, expectedRevision: input.expectedRevision, editionId: edition.id,
      relationIds: input.relationIds.map(digest), note: text(input.note ?? '', 8192, 'selection note', true),
      ...(input.comparisonId ? { comparisonId: comparisonFor(input.comparisonId).id } : {}) };
    let value = store.get('selection', request.operationId);
    if (value?.state === 'READY') {
      if (value.requestSha256 !== identity(request)) throw issue('CLOUD_OPERATION_CONTENT_CONFLICT', undefined, 409);
      return { selection: value.selection, revision: store.revision() };
    }
    await canSelect();
    const previousSource = workspaceStore.sourceFile;
    value = store.reserve('selection', request.operationId, request, 'MATERIALIZING', { previousSource }).record;
    const out = await privateDirectory(pathFor('selections', value.id));
    try {
      const result = await native({ action: 'materialize', edition: editionInput(edition), relationIds: request.relationIds,
        destination: out }, out);
      const { sourceFile } = await prepareWorkbenchSource({ dataDirectory: out, database: 'data.duckdb', parquetFiles: [], workspace: directory });
      const declaration = await readDuckdbSourceFile(sourceFile);
      const selection = { editionId: edition.id, relationIds: request.relationIds, sourceSha256: declaration.sourceSha256,
        sourceFile, materializationSha256: identity(result.result), selectedAt: at(), tables: result.result.tables };
      store.update('selection', value.id, 'READY', { selection, materialization: result.result,
        storagePath: relative(directory, out) }, 'source-selected',
      () => workspaceStore.selectSourceFile(sourceFile, value.previousSource));
      return { selection, revision: store.revision() };
    } catch (error) {
      store.update('selection', value.id, 'FAILED', { error: error.code ?? 'CLOUD_SOURCE_SELECTION_FAILED' }, 'source-selection-failed'); throw error;
    }
  }
  async function inventory(rootPath, prefix = '') {
    const result = [];
    for (const entry of await readdir(rootPath, { withFileTypes: true })) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw issue('CLOUD_HANDOVER_SYMLINK_FORBIDDEN');
      if (entry.isDirectory()) result.push(...await inventory(join(rootPath, entry.name), name));
      else if (entry.isFile()) result.push({ path: name, ...await fileDigest(join(rootPath, entry.name), LIMITS.totalBytes) });
      else throw issue('CLOUD_HANDOVER_REGULAR_FILES_REQUIRED');
    }
    return result;
  }
  async function exportDelivery(input) {
    operationId(input.operationId); revisionNumber(input.expectedRevision);
    if (!Array.isArray(input.editionIds) || !Array.isArray(input.comparisonIds ?? []) || !input.editionIds.length)
      throw issue('CLOUD_DELIVERY_SELECTION_REQUIRED');
    const request = { operationId: input.operationId, expectedRevision: input.expectedRevision,
      editionIds: [...new Set(input.editionIds.map(identifier))], comparisonIds: [...new Set((input.comparisonIds ?? []).map(identifier))],
      note: text(input.note ?? '', 8192, 'handover note', true), ...(input.packageId ? { packageId: operationId(input.packageId) } : {}) };
    let value = store.get('delivery', request.operationId);
    if (value) {
      if (value.requestSha256 !== identity(request)) throw issue('CLOUD_OPERATION_CONTENT_CONFLICT', undefined, 409);
      if (value.state === 'READY') return { delivery: value.delivery, revision: store.revision() };
    } else {
      const comparisons = request.comparisonIds.map(comparisonFor);
      const editionIds = new Set([...request.editionIds, ...comparisons.flatMap(item => [item.request.leftEditionId, item.request.rightEditionId])]);
      const editions = [...editionIds].map(editionFor);
      if (editions.some(item => item.state !== 'READY') || comparisons.some(item => item.state !== 'READY')) throw issue('CLOUD_READY_DELIVERY_RECORDS_REQUIRED');
      const selected = store.list('selection').find(item => item.state === 'READY' && editionIds.has(item.selection.editionId)) ?? null;
      const originalPackage = request.packageId ? await inspectPackage(request.packageId) : null;
      value = store.reserve('delivery', request.operationId, request, 'EXPORTING',
        { snapshot: { editions, comparisons, selected, originalPackage } }).record;
    }
    const { editions, comparisons, selected, originalPackage } = value.snapshot;
    const out = await privateDirectory(pathFor('deliveries', request.operationId)), destination = join(out, 'handover.zip');
    try {
      let manifest;
      try { manifest = await readJson(join(out, 'handover.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!manifest) {
        const roots = editions.map(item => ({ path: selectedPath(item), relative: item.storagePath, original: true }));
        roots.push(...comparisons.map(item => ({ path: selectedPath(item), relative: item.storagePath,
          allowed: ['report.json', 'findings.jsonl', 'findings.index.json'] })));
        if (originalPackage) roots.push({ path: packageDirectory(request.packageId),
          relative: relative(directory, packageDirectory(request.packageId)), original: true });
        if (selected) roots.push({ path: selectedPath(selected), relative: selected.storagePath,
          allowed: ['data.duckdb', 'materialization.json'] });
        const files = new Map();
        for (const entry of roots) for (const file of await inventory(entry.path)) {
          if (entry.allowed && !entry.allowed.includes(file.path)) continue;
          const path = entry.relative + '/' + file.path; files.set(path, { ...file, path });
        }
        for (const edition of editions) {
          const parent = dirname(selectedPath(edition));
          for (const name of ['manifest.json', 'original-input.json', 'original-packet.json']) {
            const path = join(parent, name);
            try { files.set(relative(directory, path), { path: relative(directory, path), ...await fileDigest(path) }); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
        }
        manifest = { schema: DELIVERY_SCHEMA, id: request.operationId, createdAt: value.createdAt,
          originalWorkspaceId: workspaceStore.workspaceId, request, editions, comparisons,
          selection: selected, originalPackage, files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
          contracts: CONTRACTS };
        await atomicJson(join(out, 'handover.json'), manifest);
      }
      if (manifest.id !== value.id || identity(manifest.request) !== value.requestSha256)
        throw issue('CLOUD_HANDOVER_SNAPSHOT_CONFLICT', undefined, 409);
      const result = await native({ action: 'archive', source: directory, destination, inventory: manifest.files, manifest }, out);
      const delivery = { id: request.operationId, ...result.result.archive, filename: 'coinmetrics-cloud-' + request.operationId + '.zip',
        url: '/api/cloud/delivery?id=' + encodeURIComponent(request.operationId), manifest: { schema: manifest.schema,
          originalWorkspaceId: manifest.originalWorkspaceId, files: manifest.files.length, editions: editions.map(item => item.id),
          comparisons: comparisons.map(item => item.id), packageId: request.packageId ?? null } };
      store.update('delivery', value.id, 'READY', { delivery, storagePath: relative(directory, out) }, 'handover-exported');
      return { delivery, revision: store.revision() };
    } catch (error) {
      store.update('delivery', value.id, 'FAILED', { error: error.code ?? 'CLOUD_EXPORT_FAILED' }, 'handover-export-failed'); throw error;
    }
  }
  async function receive(input) {
    operationId(input.operationId); revisionNumber(input.expectedRevision);
    if (Boolean(input.archivePath) === Boolean(input.intakeId)) throw issue('CLOUD_SELECT_ONE_ARCHIVE');
    let archive;
    if (input.intakeId) {
      const upload = store.get('upload', identifier(input.intakeId));
      if (!upload || (await uploads(upload)).some(file => !file.present)) throw issue('CLOUD_HANDOVER_UPLOAD_INCOMPLETE');
      archive = join(pathFor('uploads', upload.id), 'handover.zip');
    } else archive = await realpath(resolve(text(input.archivePath, 4096, 'archive path')));
    const pin = await fileDigest(archive, LIMITS.totalBytes);
    const request = { operationId: input.operationId, expectedRevision: input.expectedRevision, archiveSha256: pin.sha256,
      archiveBytes: pin.bytes, ...(input.intakeId ? { intakeId: input.intakeId } : { archivePath: archive }) };
    let value = store.reserve('receiving', request.operationId, request, 'RECEIVING').record;
    if (value.state === 'READY') return { delivery: value.delivery, received: value.received, revision: store.revision() };
    const out = await privateDirectory(pathFor('receivings', request.operationId)), destination = join(out, 'payload');
    try {
      const result = await native({ action: 'extract', archive, destination }, out), manifest = result.result.manifest;
      const origin = { deliveryId: manifest.id, archiveSha256: pin.sha256, workspaceId: manifest.originalWorkspaceId, receivedAt: at() };
      if (!Array.isArray(manifest.editions) || !Array.isArray(manifest.comparisons)) throw issue('CLOUD_HANDOVER_RECORDS_INVALID');
      for (const item of manifest.editions) {
        identifier(item.id); digest(item.requestSha256); validateManifest(item.manifest);
        if (identity(item.request) !== item.requestSha256 || item.request.operationId !== item.id ||
            identity(item.request.manifest) !== item.manifestSha256) throw issue('CLOUD_HANDOVER_EDITION_REQUEST_INVALID');
        if (identity(item.manifest) !== item.manifestSha256 || item.state !== 'READY') throw issue('CLOUD_HANDOVER_EDITION_INVALID');
        item.storagePath = relative(directory, resolve(destination, relativePath(item.storagePath)));
        const checked = await native({ action: 'inspect', edition: editionInput(item) }, out);
        for (const key of ['relations', 'files', 'coverage'])
          if (identity(checked.result[key]) !== identity(item.inspection?.[key])) throw issue('CLOUD_RECEIVED_INSPECTION_MISMATCH');
        item.receivedVerification = { engineVersion: checked.result.engineVersion, inspectedAt: at() };
      }
      for (const item of manifest.comparisons) {
        identifier(item.id); digest(item.requestSha256);
        if (identity(validateComparison(item.request)) !== item.requestSha256 || item.request.operationId !== item.id)
          throw issue('CLOUD_HANDOVER_COMPARISON_REQUEST_INVALID');
        if (item.state !== 'READY') throw issue('CLOUD_HANDOVER_COMPARISON_INVALID');
        item.storagePath = relative(directory, resolve(destination, relativePath(item.storagePath)));
        delete item.findingsIdentity;
      }
      const delivery = { id: manifest.id, ...pin, receivedFrom: origin, manifest: { schema: manifest.schema, files: manifest.files.length } };
      const received = { editions: manifest.editions.map(item => item.id), comparisons: manifest.comparisons.map(item => item.id),
        originalPackage: manifest.originalPackage ?? null, sourceSelectionRequired: true };
      store.update('receiving', value.id, 'READY', { delivery, received, storagePath: relative(directory, out) }, 'handover-received', () => {
        for (const item of manifest.editions) store.importRecord('edition', item, origin);
        for (const item of manifest.comparisons) store.importRecord('comparison', item, origin);
      });
      return { delivery, received, revision: store.revision() };
    } catch (error) {
      store.update('receiving', value.id, 'FAILED', { error: error.code ?? 'CLOUD_RECEIVE_FAILED' }, 'handover-receive-failed'); throw error;
    }
  }
  return {
    state() { return { schema: WORKSPACE_SCHEMA, revision: store.revision(), contracts: CONTRACTS,
      editions: store.list('edition').map(publicEdition), comparisons: store.list('comparison').map(publicComparison),
      deliveries: store.list('delivery').map(item => ({ id: item.id, state: item.state, ...item.delivery, error: item.error ?? null })),
      archiveIntakes: store.list('upload').map(item => ({ id: item.id, state: item.state, archive: item.archive })),
      receivings: store.list('receiving').map(item => ({ id: item.id, state: item.state, ...item.received, delivery: item.delivery, error: item.error ?? null })),
      selection: store.list('selection').find(item => item.state === 'READY')?.selection ?? null,
      events: store.history() }; },
    intake, commit, import: importPacket, edition: editionDetail, compare: comparison, comparison: comparisonPage,
    review, select, export: exportDelivery, receive,
    async upload({ editionId, fileId, stream, signal }) {
      const value = store.get('edition', identifier(editionId)) ?? store.get('upload', editionId);
      if (!value) throw issue('CLOUD_EDITION_NOT_FOUND', undefined, 404);
      const file = (value.archive ? [value.archive] : value.manifest.files).find(item => item.id === fileId);
      if (!file) throw issue('CLOUD_FILE_NOT_DECLARED', undefined, 404);
      const base = value.archive ? pathFor('uploads', value.id) : selectedPath(value);
      const saved = await acceptStream(await within(base, file.path, true), stream, file, { signal });
      if (value.archive && !value.archive.sha256) store.update('upload', value.id, 'UPLOADED',
        { archive: { ...value.archive, sha256: saved.sha256 } }, 'archive-uploaded');
      return { file: { id: file.id, ...saved }, revision: store.revision() };
    },
    async file({ editionId, fileId }) {
      const value = editionFor(editionId), file = value.manifest.files.find(item => item.id === fileId);
      if (!file) throw issue('CLOUD_FILE_NOT_FOUND', undefined, 404);
      const path = await within(selectedPath(value), file.path), pin = await fileDigest(path);
      if (pin.sha256 !== file.sha256 || pin.bytes !== file.bytes) throw issue('CLOUD_ORIGINAL_FILE_CHANGED', undefined, 409);
      return { path, filename: file.path.split('/').pop(), type: 'application/octet-stream', bytes: pin.bytes };
    },
    async report({ id, kind }) {
      const value = comparisonFor(id);
      if (value.state !== 'READY') throw issue('CLOUD_COMPARISON_NOT_READY', undefined, 409);
      if (kind === 'summary') return { path: join(selectedPath(value), 'report.json'), filename: id + '.json', type: 'application/json' };
      return { path: await checkFindings(value), prefix: value.reportHeader, filename: id + '.jsonl', type: 'application/x-ndjson',
        bytes: String(BigInt(value.findings.bytes) + BigInt(Buffer.byteLength(value.reportHeader))) };
    },
    async delivery({ id }) {
      const value = store.get('delivery', identifier(id));
      if (value?.state !== 'READY') throw issue('CLOUD_DELIVERY_NOT_READY', undefined, 409);
      const path = join(selectedPath(value), 'handover.zip'), pin = await fileDigest(path, LIMITS.totalBytes);
      if (pin.sha256 !== value.delivery.sha256 || pin.bytes !== value.delivery.bytes) throw issue('CLOUD_HANDOVER_CHANGED', undefined, 409);
      return { path, filename: value.delivery.filename, type: 'application/zip', bytes: pin.bytes };
    },
  };
}
