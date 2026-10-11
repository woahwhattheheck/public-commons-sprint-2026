// MIT. Original SF100 typed delivery to an Esri FeatureSet; no network or payment calls.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { scan, MAX_DATASET_PAGE_BYTES } from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import { arcgisMetadata, arcgisFeaturePage, readArcgisArtifact, readArcgisCapture } from './capture.mjs';
import { object, bytes, digest, identity, readJson, createFile, privateDirectory, syncDirectory, fault } from '../postgres/publisher/files.mjs';

const HASH = /^[a-f0-9]{64}$/, MAX_EXPORT = 256 * 1024 * 1024;
const fail = (code, message = code) => { throw fault(code, message); };
const same = (a, b) => identity(a) === identity(b);
const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' ||
  typeof value === 'number' && Number.isFinite(value);

/** Prepare the public receiving declaration from the exact retained candidate. */
export async function prepareArcgisReceiving({ publisher, run, output } = {}) {
  if (!publisher || typeof publisher.candidate !== 'function') fail('ARCGIS_PUBLISHER_REQUIRED');
  const candidate = await publisher.candidate(run), saved = publisher.run(run), plan = publisher.plan(saved.plan);
  if (plan.data.schema !== 'stellar-forge.arcgis-dataset-plan.v1') fail('ARCGIS_PLAN_REQUIRED');
  const source = await readJson(join(publisher.directory, 'plans', plan.folder, 'source.json'));
  if (digest(bytes(source)) !== plan.data.runtimeSourceHash) fail('ARCGIS_SOURCE_CHANGED');
  const capture = await readArcgisCapture(source.captureDirectory, plan.data.captureSha256);
  const query = source.queries[plan.data.query], exposed = plan.data.dataset.columns;
  const find = predicate => Object.entries(query.columns).find(([name, spec]) => Object.hasOwn(exposed, name) && predicate(spec))?.[0];
  const columns = { objectId: find(spec => spec.field === capture.metadata.oid),
    attributes: find(spec => spec.source === 'attributes') };
  if (!columns.objectId || !columns.attributes) fail('ARCGIS_RECEIVING_COLUMNS_REQUIRED',
    'Expose the original object-ID column and attributes JSON in the reviewed dataset.');
  if (capture.state.query.returnGeometry) {
    columns.geometry = find(spec => spec.source === 'geometry');
    columns.spatialReference = find(spec => spec.source === 'spatialReference');
    if (!columns.geometry || !columns.spatialReference) fail('ARCGIS_RECEIVING_GEOMETRY_COLUMNS_REQUIRED',
      'Expose the original geometry and spatial-reference JSON columns in the reviewed dataset.');
  }
  const raw = capture.metadata.raw, featureSet = {
    objectIdFieldName: capture.metadata.oid,
    ...(typeof raw.displayField === 'string' && capture.state.query.outFields.includes(raw.displayField) ? { displayFieldName: raw.displayField } : {}),
    fields: capture.state.query.outFields.map(name => structuredClone(capture.metadata.fields.get(name))),
    ...(capture.state.query.returnGeometry ? { geometryType: capture.metadata.geometryType,
      spatialReference: structuredClone(capture.state.spatialReference),
      ...(typeof raw.hasZ === 'boolean' ? { hasZ: raw.hasZ } : {}),
      ...(typeof raw.hasM === 'boolean' ? { hasM: raw.hasM } : {}) } : {})
  };
  const declaration = { schema: 'stellar-forge.arcgis-receiving.v1',
    dataset: { name: candidate.manifest.dataset.name, snapshot: candidate.manifest.dataset.snapshot },
    columns, scalarColumns: Object.fromEntries(Object.entries(query.columns)
      .filter(([name, spec]) => Object.hasOwn(exposed, name) && spec.field !== undefined)
      .map(([name, spec]) => [name, spec.field])),
    featureSet,
    source: { layerUrl: capture.state.settings.layerUrl, where: capture.state.query.where,
      captureSha256: capture.sha256, metadataSha256: capture.state.metadata.sha256,
      pageSha256: capture.pageHashes, representation: capture.state.metadata.representation,
      selectionKind: capture.state.mode, selectedRecords: capture.state.ids.length },
    paymentScope: 'Payment status belongs to the original buyer intent and delivery records.' };
  validateDeclaration(declaration);
  const content = bytes(declaration); await createFile(resolve(output), content);
  await syncDirectory(dirname(resolve(output)));
  return { path: resolve(output), sha256: digest(content), bytes: content.length,
    dataset: declaration.dataset, requiredFields: Object.values(columns) };
}
function validateDeclaration(value) {
  if (!object(value) || value.schema !== 'stellar-forge.arcgis-receiving.v1' ||
      !object(value.dataset) || typeof value.dataset.name !== 'string' || !HASH.test(value.dataset.snapshot ?? '') ||
      !object(value.columns) || !object(value.scalarColumns) || !object(value.featureSet) || !object(value.source) ||
      !HASH.test(value.source.captureSha256 ?? '') || !HASH.test(value.source.metadataSha256 ?? '') ||
      !Array.isArray(value.source.pageSha256) || value.source.pageSha256.some(x => !HASH.test(x))) fail('ARCGIS_RECEIVING_DECLARATION_INVALID');
  const metadata = arcgisMetadata(value.featureSet), geometry = Boolean(metadata.geometryType);
  if (Object.hasOwn(value.featureSet, 'features') || geometry && !object(value.featureSet.spatialReference) ||
      typeof value.columns.objectId !== 'string' || typeof value.columns.attributes !== 'string' ||
      Object.keys(value.columns).some(k => !['objectId', 'attributes', 'geometry', 'spatialReference'].includes(k)) ||
      Object.values(value.columns).some(v => typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(v)) ||
      new Set(Object.values(value.columns)).size !== Object.values(value.columns).length ||
      geometry && (typeof value.columns.geometry !== 'string' || typeof value.columns.spatialReference !== 'string') ||
      !geometry && (value.columns.geometry !== undefined || value.columns.spatialReference !== undefined) ||
      value.scalarColumns[value.columns.objectId] !== metadata.oid ||
      Object.values(value.scalarColumns).some(field => !metadata.fields.has(field))) fail('ARCGIS_RECEIVING_DECLARATION_INVALID');
  return { metadata, geometry, names: [...metadata.fields.keys()] };
}
async function* jsonlRows(handle, expectedBytes, hasher) {
  const before = await handle.stat();
  if (!before.isFile() || before.nlink !== 1 || before.mode & 0o077 || before.size !== expectedBytes ||
      before.size > MAX_EXPORT) fail('ARCGIS_DELIVERY_JSONL_INVALID');
  let pending = Buffer.alloc(0), count = 0;
  for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
    count += chunk.length; if (count > MAX_EXPORT || count > expectedBytes) fail('ARCGIS_DELIVERY_JSONL_TOO_LARGE');
    hasher.update(chunk);
    pending = Buffer.concat([pending, chunk]);
    let at;
    while ((at = pending.indexOf(10)) >= 0) {
      if (at + 1 > MAX_DATASET_PAGE_BYTES) fail('ARCGIS_DELIVERY_ROW_TOO_LARGE');
      yield pending.subarray(0, at + 1); pending = pending.subarray(at + 1);
    }
    if (pending.length > MAX_DATASET_PAGE_BYTES) fail('ARCGIS_DELIVERY_ROW_TOO_LARGE');
  }
  const after = await handle.stat();
  if (pending.length || count !== expectedBytes || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('ARCGIS_DELIVERY_JSONL_CHANGED');
}
function featureFromRow(row, declaration, compiled, ids) {
  const { columns, featureSet, scalarColumns } = declaration;
  for (const field of Object.values(columns)) if (!Object.hasOwn(row, field)) fail('ARCGIS_RECEIVING_FIELD_NOT_REQUESTED',
    'Request every declared receiving field from the original dataset endpoint.');
  let attributes, geometry, spatialReference;
  try {
    if (typeof row[columns.attributes] !== 'string') throw new Error();
    attributes = JSON.parse(row[columns.attributes]);
    if (compiled.geometry) {
      if (typeof row[columns.geometry] !== 'string' || typeof row[columns.spatialReference] !== 'string') throw new Error();
      geometry = JSON.parse(row[columns.geometry]); spatialReference = JSON.parse(row[columns.spatialReference]);
    }
  } catch { fail('ARCGIS_RECEIVING_JSON_INVALID'); }
  if (!object(attributes) || Object.keys(attributes).length !== compiled.names.length ||
      compiled.names.some(name => !Object.hasOwn(attributes, name) || !scalar(attributes[name]))) fail('ARCGIS_RECEIVING_ATTRIBUTES_CHANGED');
  const id = attributes[compiled.metadata.oid];
  if (!Number.isSafeInteger(id) || id !== row[columns.objectId] || ids.has(id)) fail('ARCGIS_RECEIVING_OBJECT_ID_CHANGED');
  for (const [column, field] of Object.entries(scalarColumns)) {
    if (Object.hasOwn(row, column) && !same(row[column], attributes[field])) fail('ARCGIS_RECEIVING_SCALAR_CHANGED');
  }
  if (compiled.geometry && !same(spatialReference, featureSet.spatialReference)) fail('ARCGIS_RECEIVING_CRS_CHANGED');
  const feature = { attributes, ...(compiled.geometry ? { geometry } : {}) };
  arcgisFeaturePage({ geometryType: compiled.metadata.geometryType, spatialReference, features: [feature] },
    compiled.metadata, { outFields: compiled.names, returnGeometry: compiled.geometry }, [id]);
  ids.add(id); return feature;
}

/** Consume the ORIGINAL finalized SF100 archives and exact typed JSONL; publish one GIS file. */
export async function receiveArcgisDelivery({ deliveryDirectory, planFile, output } = {}) {
  const delivery = resolve(deliveryDirectory), target = resolve(output), parent = dirname(target);
  await privateDirectory(parent);
  const plan = await readArcgisArtifact(planFile, 2097152), declaration = plan.value, compiled = validateDeclaration(declaration);
  const state = await scan(delivery, { retainPayload: false });
  if (!state.finalized || !state.pages.length || state.nextCursor !== null || state.count !== state.total ||
      state.snapshot !== declaration.dataset.snapshot || state.name !== declaration.dataset.name)
    fail('ARCGIS_FINALIZED_DELIVERY_REQUIRED', 'Use the complete original SF100 delivery for this exact dataset snapshot.');
  const manifest = await readArcgisArtifact(join(delivery, 'manifest.json'), 4194304), value = manifest.value;
  const jsonl = value.outputs?.['dataset.jsonl'];
  if (value.schema !== 'stellar-forge.buyer-delivery-manifest.v1' || value.chainDigest !== state.chain ||
      !same(value.dataset, { name: state.name, snapshot: state.snapshot, rows: state.count,
        projectedFields: state.fields, filters: state.filters, ranges: state.ranges,
        order: state.order ?? 'csv-record-order', originalQueryHash: state.queryHash,
        originalQuerySignature: state.pages[0].signature }) ||
      !object(jsonl) || !HASH.test(jsonl.sha256 ?? '') || !Number.isSafeInteger(jsonl.bytes) ||
      jsonl.bytes < 0 || jsonl.bytes > MAX_EXPORT) fail('ARCGIS_DELIVERY_MANIFEST_CHANGED');
  const expectedPages = state.pages.map(page => ({ index: page.index, intent: page.intent,
    sourceSha256: page.sourceSha256, evidenceSha256: page.evidenceSha256,
    recordDigest: page.chain, rows: page.returned, requestedCursor: page.requestCursor }));
  if (!same(value.sourcePages, expectedPages)) fail('ARCGIS_DELIVERY_MANIFEST_CHANGED');
  const temporary = join(parent, '.arcgis-receiving-' + randomUUID() + '.tmp');
  let input, out, iterator, outputBytes = 0, count = 0;
  const inputHash = createHash('sha256'), outputHash = createHash('sha256'), ids = new Set();
  try {
    input = await open(join(delivery, 'dataset.jsonl'), constants.O_RDONLY | constants.O_NOFOLLOW);
    iterator = jsonlRows(input, jsonl.bytes, inputHash)[Symbol.asyncIterator]();
    out = await open(temporary, 'wx', 0o600);
    async function write(content) {
      const data = Buffer.from(content); outputBytes += data.length;
      if (outputBytes > MAX_EXPORT) fail('ARCGIS_RECEIVING_OUTPUT_TOO_LARGE');
      outputHash.update(data); await out.writeFile(data);
    }
    await write(JSON.stringify(declaration.featureSet).slice(0, -1) + ',"features":[');
    for (const expected of state.pages) {
      const page = await readArcgisArtifact(join(delivery, 'pages', String(expected.index).padStart(5, '0') + '.json'),
        MAX_DATASET_PAGE_BYTES + 4096);
      const { chain, ...record } = page.value;
      if (chain !== expected.chain || chain !== digest(JSON.stringify(record)) ||
          record.previous !== expected.previous) fail('ARCGIS_DELIVERY_ARCHIVE_CHANGED');
      for (const row of record.payload.rows) {
        const next = await iterator.next(), exact = Buffer.from(JSON.stringify(row) + '\n');
        if (next.done || !next.value.equals(exact)) fail('ARCGIS_DELIVERY_JSONL_CHANGED');
        const received = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(next.value));
        const feature = featureFromRow(received, declaration, compiled, ids);
        await write((count++ ? ',' : '') + JSON.stringify(feature));
      }
    }
    if (!(await iterator.next()).done || count !== state.count || inputHash.digest('hex') !== jsonl.sha256)
      fail('ARCGIS_DELIVERY_JSONL_CHANGED');
    await write(']}\n'); await out.sync(); await out.close(); out = null;
    const finalSource = await scan(delivery, { retainPayload: false });
    if (finalSource.chain !== state.chain || finalSource.count !== count ||
        (await readArcgisArtifact(join(delivery, 'manifest.json'), 4194304)).sha256 !== manifest.sha256)
      fail('ARCGIS_DELIVERY_CHANGED');
    const sha256 = outputHash.digest('hex');
    try { await link(temporary, target); }
    catch (issue) {
      if (issue.code !== 'EEXIST') throw issue;
      const previous = await readArcgisArtifact(target, MAX_EXPORT);
      if (previous.sha256 !== sha256 || previous.bytes !== outputBytes) fail('ARCGIS_RECEIVING_OUTPUT_EXISTS',
        'Choose a new output filename or retain the existing exact receiving file.');
    }
    await syncDirectory(parent);
    return { schema: 'stellar-forge.arcgis-received.v1', path: target, sha256, bytes: outputBytes, features: count,
      dataset: declaration.dataset, geometryType: compiled.metadata.geometryType,
      spatialReference: declaration.featureSet.spatialReference ?? null, sourceCaptureSha256: declaration.source.captureSha256,
      receivingPlanSha256: plan.sha256, originalDeliveryManifestSha256: manifest.sha256,
      originalDeliveryChain: state.chain, typedJsonlSha256: jsonl.sha256,
      query: { fields: state.fields, filters: state.filters, ranges: state.ranges, order: state.order },
      paymentScope: 'Payment status remains in the original buyer records; this conversion makes no payment inference.' };
  } finally {
    await iterator?.return?.().catch(() => {}); await input?.close().catch(() => {}); await out?.close().catch(() => {});
    await unlink(temporary).catch(issue => { if (issue.code !== 'ENOENT') throw issue; });
  }
}
