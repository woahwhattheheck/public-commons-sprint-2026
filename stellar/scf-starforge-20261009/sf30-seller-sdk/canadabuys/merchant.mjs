// MIT. Source-preserving CANADABUYS packages over the original SF30 seller and SF100 receiver.
import { mkdir, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { scan as scanDelivery } from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import { canonical, sha256 as hash } from './workspace.mjs';

export const CANADABUYS_MERCHANT_SCHEMA = 'starforge.canadabuys.merchant.v1';
import { PACKAGE_SCHEMA, LEGACY_PACKAGE_SCHEMA } from './core.mjs';
import { sourceProvenance, DERIVED_SOURCE_KIND, SOURCE_PACKAGE_SCHEMA } from './source-provenance.mjs';
import { parseCsv } from './csv.mjs';
import { validateDeskEnvelope, mergeBidderDeskPackages } from './bidder-desk-workspace.mjs';
const CHUNK_BYTES = 24 * 1024;
const MAX_BYTES = 256 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const encoded = value => JSON.stringify(value, null, 2) + '\n';
const requireThat = (condition, code, message = code) => { if (!condition) throw Object.assign(new Error(message), { code }); };
const number = (value, label, minimum, maximum) => {
  requireThat(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'CANADABUYS_INVALID_OPTION', label + ' is outside its supported range.');
  return value;
};
const string = value => typeof value === 'string' ? value : null;
const csvCell = value => value === null || value === undefined ? '' : typeof value === 'number' ? String(value)
  : '"' + String(value).replace(/"/g, '""') + '"';
const columnNames = ['entry_id', 'notice_id', 'notice_count', 'reference_number', 'document_kind', 'title', 'buyer_name', 'status',
  'closing_utc', 'package_id', 'payload_sha256', 'payload_bytes', 'part_index', 'part_count', 'part_sha256', 'payload_base64'];
const integerColumns = new Set(['notice_count', 'payload_bytes', 'part_index', 'part_count']);
const nullableColumns = new Set(['reference_number', 'buyer_name', 'status', 'closing_utc']);
const allowedFile = file => ['documents.csv', 'dataset.json', 'source-manifest.json', 'seller.json'].includes(file)
  || /^payloads\/[a-f0-9]{64}\.json$/.test(file);

async function put(path, content) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); }
  finally { await handle.close(); }
}
async function readExact(path, max = MAX_BYTES) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    requireThat(before.isFile() && before.size <= BigInt(max), 'CANADABUYS_MERCHANT_FILE_INVALID', 'Expected a regular retained file within the native limit.');
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    requireThat(bytes.length <= max && BigInt(bytes.length) === after.size
      && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]),
    'CANADABUYS_MERCHANT_FILE_CHANGED', 'The original file changed during the read.');
    return bytes;
  } finally { await handle.close(); }
}
function parse(bytes) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
function same(a, b) { return canonical(a) === canonical(b); }
function checkPackage(pkg) {
  requireThat(object(pkg) && [PACKAGE_SCHEMA, SOURCE_PACKAGE_SCHEMA, LEGACY_PACKAGE_SCHEMA].includes(pkg.schema) && HASH.test(pkg.packageId ?? '')
    && Array.isArray(pkg.sources) && object(pkg.selection) && Array.isArray(pkg.selection.noticeIds)
    && Array.isArray(pkg.reviews) && Array.isArray(pkg.workshares), 'CANADABUYS_PACKAGE_INVALID', 'Expected a complete original CANADABUYS workspace package.');
  if ([PACKAGE_SCHEMA, SOURCE_PACKAGE_SCHEMA].includes(pkg.schema)) validateDeskEnvelope(pkg.bidderDesk);
  else requireThat(pkg.bidderDesk === undefined, 'CANADABUYS_PACKAGE_VERSION_MISMATCH');
  const { packageId, ...body } = pkg;
  requireThat(hash(canonical(body)) === packageId, 'CANADABUYS_PACKAGE_CHANGED', 'The original package digest does not match its content.');
  for (const source of pkg.sources) {
    requireThat(object(source) && typeof source.rawText === 'string' && /^source-[a-f0-9]{64}$/.test(source.id ?? '')
      && HASH.test(source.sha256 ?? '') && hash(Buffer.from(source.rawText, 'utf8')) === source.sha256
      && Array.isArray(source.entryIds) && Buffer.byteLength(source.rawText, 'utf8') === source.bytes,
    'CANADABUYS_SOURCE_CHANGED', 'The original source bytes or SHA256 changed.');
    requireThat(pkg.schema === SOURCE_PACKAGE_SCHEMA || !(source.bodyKind === DERIVED_SOURCE_KIND || source.derivation !== undefined || source.derivationSha256 !== undefined),
      'CANADABUYS_PACKAGE_VERSION_MISMATCH', 'Derived notice evidence requires the complete v3 package.');
    const provenance = sourceProvenance(source, parseCsv(source.rawText), source.stream, source.sha256);
    requireThat(provenance.id === source.id &&
      (source.bodyKind !== DERIVED_SOURCE_KIND || Object.keys(provenance.metadata).every(key => same(provenance.metadata[key], source[key]))),
      'CANADABUYS_SOURCE_CHANGED', 'The separately identified source differs from its complete original evidence.');
  }
  return pkg;
}

/** Publish one complete selected workspace package, sharing each original source only once. */
export async function prepareMerchant(workspace, {
  scope = 'shortlist', noticeIds, expectedRevision, payment, origin, path = '/procurement',
  defaultLimit = 10, maxLimit = 20, name,
} = {}) {
  const { view, revision, selected, packets } = workspace._snapshot(() => {
    const view = workspace.view(), revision = view.workspace.revision;
    if (expectedRevision !== undefined) requireThat(expectedRevision === revision, 'CANADABUYS_REVISION_CONFLICT', 'Read the current workspace before preparing its merchant snapshot.');
    requireThat(['all','shortlist','selected'].includes(scope), 'CANADABUYS_INVALID_SCOPE');
    number(defaultLimit, 'Default page size', 1, 1000); number(maxLimit, 'Maximum page size', defaultLimit, 1000);
    requireThat((payment === undefined) === (origin === undefined), 'CANADABUYS_PAYMENT_AND_ORIGIN_TOGETHER');
    const selected = workspace._selected({ scope, noticeIds }).notices;
    requireThat(selected.length > 0, 'CANADABUYS_EMPTY_SELECTION', 'Choose at least one notice and its saved work to publish.');
    // One frozen packet retains each original source once, even for hundreds of notices.
    const pkg = checkPackage(workspace.exportPackage({ scope, noticeIds }));
    const current = selected.length === 1 ? workspace.getNotice(selected[0].id).currentEntry : null;
    const packets = [{
      entry: current || { id: 'selection-' + hash(canonical(pkg.selection.noticeIds)).slice(0,24),
        noticeId: 'selection', kind: 'procurement-package', sourceId: null,
        summary: { title: { en: selected.length + ' CanadaBuys notices with saved work', fr: '' },
          buyer: { en: '', fr: '' }, status: { en: '', fr: '' }, referenceNumber: '', closing: { utc: null } } },
      package: pkg
    }];
    return { view, revision, selected, packets };
  });
  const merchantId = randomUUID(), parent = join(workspace.directory, 'merchant');
  const directory = join(parent, merchantId), staging = join(parent, '.' + merchantId + '.preparing');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await mkdir(staging, { mode: 0o700 });
  await mkdir(join(staging, 'payloads'), { mode: 0o700 });
  const csvHandle = await open(join(staging, 'documents.csv'), 'wx', 0o600);
  const csvHash = createHash('sha256'), files = {}, provenance = [];
  let csvBytes = 0, rowCount = 0, maximumRowBytes = 0;
  const appendCsv = async line => {
    const bytes = Buffer.from(line, 'utf8');
    requireThat(csvBytes + bytes.length <= MAX_BYTES, 'CANADABUYS_MERCHANT_CAPACITY', 'The selected complete packages exceed the original SF30 dataset capacity.');
    csvBytes += bytes.length; csvHash.update(bytes); await csvHandle.writeFile(bytes);
  };
  try {
    await appendCsv(columnNames.join(',') + '\r\n');
    for (const packet of packets) {
      const bytes = Buffer.from(encoded(packet.package)), payloadSha256 = hash(bytes);
      const file = 'payloads/' + payloadSha256 + '.json';
      await put(join(staging, file), bytes);
      files[file] = { bytes: bytes.length, sha256: payloadSha256 };
      const count = Math.ceil(bytes.length / CHUNK_BYTES), entry = packet.entry, summary = entry.summary ?? {};
      provenance.push({ entryId: entry.id, noticeIds: packet.package.selection.noticeIds, kind: entry.kind, sourceId: entry.sourceId,
        packageId: packet.package.packageId, file, bytes: bytes.length,
        sha256: payloadSha256, parts: count, sourceIds: packet.package.sources.map(source => source.id) });
      for (let index = 0; index < count; index++) {
        const part = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
        const row = { entry_id: entry.id, notice_id: entry.noticeId, notice_count: packet.package.selection.noticeIds.length,
          reference_number: string(summary.referenceNumber), document_kind: 'procurement-package',
          title: string(summary.title?.en || summary.title?.fr) ?? entry.noticeId, buyer_name: string(summary.buyer?.en || summary.buyer?.fr),
          status: string(summary.status?.en || summary.status?.fr), closing_utc: string(summary.closing?.utc), package_id: packet.package.packageId,
          payload_sha256: payloadSha256, payload_bytes: bytes.length, part_index: index, part_count: count,
          part_sha256: hash(part), payload_base64: part.toString('base64') };
        maximumRowBytes = Math.max(maximumRowBytes, Buffer.byteLength(JSON.stringify(row)));
        rowCount++;
        requireThat(rowCount <= 1000000, 'CANADABUYS_MERCHANT_CAPACITY', 'The complete selection exceeds the native row limit.');
        await appendCsv(columnNames.map(column => csvCell(row[column])).join(',') + '\r\n');
      }
    }
    await csvHandle.sync();
  } finally { await csvHandle.close(); }
  files['documents.csv'] = { bytes: csvBytes, sha256: csvHash.digest('hex') };
  const safeLimit = Math.floor(850 * 1024 / Math.max(maximumRowBytes, 1));
  requireThat(safeLimit >= 1, 'CANADABUYS_MERCHANT_ROW_TOO_LARGE', 'One metadata row exceeds the native page capacity.');
  const datasetName = name ?? view.workspace.title ?? 'Procurement documents';
  requireThat(typeof datasetName === 'string' && datasetName.length <= 128, 'CANADABUYS_DATASET_NAME', 'Use a dataset name of at most 128 characters.');
  const datasetConfig = {
    schema: 'stellar-forge.csv-dataset.v1', file: 'documents.csv', name: datasetName,
    columns: Object.fromEntries(columnNames.map(column => [column, { type: integerColumns.has(column) ? 'integer' : 'string', nullable: nullableColumns.has(column) }])),
    filters: ['notice_id', 'document_kind', 'status', 'package_id'], ranges: ['closing_utc'],
    sorts: ['notice_id', 'closing_utc', 'part_index'], nullEncoding: 'unquoted-empty',
    defaultLimit: Math.min(defaultLimit, safeLimit), maxLimit: Math.min(maxLimit, safeLimit),
    maxRows: 1000000, maxBytes: MAX_BYTES, maxCellChars: 1024 * 1024, maxPageBytes: 900 * 1024,
  };
  const configBytes = Buffer.from(encoded(datasetConfig));
  await put(join(staging, 'dataset.json'), configBytes);
  files['dataset.json'] = { bytes: configBytes.length, sha256: hash(configBytes) };
  const sourceManifest = { schema: 'starforge.canadabuys.merchant-source.v1', workspaceId: view.workspace.id,
    workspaceRevision: revision, createdAt: new Date().toISOString(), selection: { scope, noticeIds: selected.map(item => item.id) },
    transport: { encoding: 'base64', chunkBytes: CHUNK_BYTES, requireCompletePackages: true,
      packageSchema: packets[0].package.schema, packageDigest: 'sha256-canonical-json', sourceEncoding: 'original-utf8' },
    packages: provenance };
  const provenanceBytes = Buffer.from(encoded(sourceManifest));
  await put(join(staging, 'source-manifest.json'), provenanceBytes);
  files['source-manifest.json'] = { bytes: provenanceBytes.length, sha256: hash(provenanceBytes) };
  const dataset = await loadDatasetConfig(join(staging, 'dataset.json')), description = dataset.describe();
  let seller = null;
  if (payment !== undefined) {
    const config = await buildDatasetSellerConfig(dataset, { payment, origin, path });
    const bytes = Buffer.from(encoded(config));
    await put(join(staging, 'seller.json'), bytes);
    files['seller.json'] = { bytes: bytes.length, sha256: hash(bytes) };
    seller = { config: 'seller.json', origin: config.publicOrigin, path };
  }
  const bundle = { schema: CANADABUYS_MERCHANT_SCHEMA, id: merchantId, createdAt: sourceManifest.createdAt,
    sourceWorkspaceId: view.workspace.id, sourceRevision: revision, packages: provenance.length,
    dataset: description, files, seller };
  const bundleBytes = Buffer.from(encoded(bundle)), bundleSha256 = hash(bundleBytes);
  await put(join(staging, 'bundle.json'), bundleBytes);
  await rename(staging, directory);
  const publication = workspace.recordPublication({ kind: 'canadabuys-merchant', merchantId, directory, bundleSha256,
    snapshot: description.snapshot, packages: packets.length, rows: rowCount, noticeIds: selected.map(item => item.id), sourceRevision: revision, configured: Boolean(seller) }).publication;
  return { publication, bundle, directory, bundleSha256 };
}

export async function loadMerchant(directory, { expectedBundleSha256 } = {}) {
  directory = resolve(directory);
  const bundleBytes = await readExact(join(directory, 'bundle.json'), 4 * 1024 * 1024);
  if (expectedBundleSha256 !== undefined) requireThat(hash(bundleBytes) === expectedBundleSha256, 'CANADABUYS_MERCHANT_CHANGED');
  const bundle = parse(bundleBytes);
  requireThat(bundle.schema === CANADABUYS_MERCHANT_SCHEMA && object(bundle.files) && object(bundle.dataset), 'CANADABUYS_MERCHANT_INVALID');
  for (const [file, expected] of Object.entries(bundle.files)) {
    requireThat(allowedFile(file) && object(expected) && HASH.test(expected.sha256 ?? ''), 'CANADABUYS_MERCHANT_FILE_INVALID');
    const bytes = await readExact(join(directory, file));
    requireThat(bytes.length === expected.bytes && hash(bytes) === expected.sha256, 'CANADABUYS_MERCHANT_FILE_CHANGED', file + ' differs from its retained manifest.');
  }
  for (const file of ['documents.csv', 'dataset.json', 'source-manifest.json']) requireThat(Object.hasOwn(bundle.files, file), 'CANADABUYS_MERCHANT_INCOMPLETE');
  if (bundle.seller) requireThat(bundle.seller.config === 'seller.json' && Object.hasOwn(bundle.files, 'seller.json'), 'CANADABUYS_MERCHANT_INCOMPLETE');
  const dataset = await loadDatasetConfig(join(directory, 'dataset.json'));
  requireThat(dataset.describe().snapshot === bundle.dataset.snapshot, 'CANADABUYS_MERCHANT_SNAPSHOT_CHANGED');
  return { directory, bundle, bundleSha256: hash(bundleBytes), dataset,
    files: [...Object.entries(bundle.files).map(([file, data]) => ({ file, ...data })),
      { file: 'bundle.json', bytes: bundleBytes.length, sha256: hash(bundleBytes) }] };
}

export async function previewMerchant(directory, query = {}, options = {}) {
  const merchant = await loadMerchant(directory, options), context = { query };
  const admission = await merchant.dataset.admit(context);
  requireThat(admission === true, 'CANADABUYS_DATASET_QUERY_REJECTED', admission?.body?.message ?? 'The native dataset rejected the query.');
  const response = await merchant.dataset.handle(context);
  requireThat(response.status === 200, 'CANADABUYS_DATASET_QUERY_REJECTED', response.body?.message);
  return { snapshot: merchant.bundle.dataset.snapshot, result: response };
}

export async function serveMerchant(directory, {
  expectedBundleSha256, port = 0, facilitator, allowLocalFacilitator = false, nativeFactory = null, availabilityDirectory,
} = {}) {
  const merchant = await loadMerchant(directory, { expectedBundleSha256 });
  requireThat(merchant.bundle.seller, 'CANADABUYS_MERCHANT_PAYMENT_REQUIRED', 'Configure this merchant with the operator public payment terms and HTTPS origin.');
  requireThat(!nativeFactory || !facilitator, 'CANADABUYS_ONE_NATIVE_FACTORY_REQUIRED');
  const config = parse(await readExact(join(merchant.directory, 'seller.json'), 65536));
  if (facilitator) {
    const endpoint = new URL(facilitator);
    requireThat(!endpoint.username && !endpoint.password && !endpoint.hash && !endpoint.search
      && (endpoint.protocol === 'https:' || allowLocalFacilitator && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'),
    'CANADABUYS_FACILITATOR_URL_INVALID');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([import('@x402/core/server'), import('../native-factory.mjs')]);
    nativeFactory = compiled => createNativeSellerServer(compiled, { facilitatorClient: new HTTPFacilitatorClient({ url: endpoint.href.replace(/\/$/, '') }) });
  }
  const { startSellerService } = await import('../serve.mjs');
  const session = await startSellerService({ config, port,
    handlers: { queryDataset: context => merchant.dataset.handle(context), admitDataset: context => merchant.dataset.admit(context) },
    nativeFactory, availabilityDirectory });
  return Object.assign(session, { merchantId: merchant.bundle.id, snapshot: merchant.bundle.dataset.snapshot });
}

/** Reconstruct complete packets only after the original SF100 page and final-output chain passes. */
export async function adoptDelivery(workspace, directory, { expectedRevision } = {}) {
  directory = resolve(directory);
  const state = await scanDelivery(directory, { retainPayload: true });
  requireThat(state.finalized && state.pages.length > 0 && state.nextCursor === null && state.count === state.total, 'CANADABUYS_NATIVE_DELIVERY_INCOMPLETE');
  const prior = workspace.view().publications?.find(item => item.kind === 'canadabuys-native-delivery' && item.chainDigest === state.chain);
  if (prior) return { publication: prior, replay: true };
  if (expectedRevision !== undefined) requireThat(workspace.view().workspace.revision === expectedRevision, 'CANADABUYS_REVISION_CONFLICT');
  const manifestBytes = await readExact(join(directory, 'manifest.json'), 4 * 1024 * 1024), manifest = parse(manifestBytes);
  requireThat(manifest.schema === 'stellar-forge.buyer-delivery-manifest.v1' && manifest.dataset?.snapshot === state.snapshot
    && manifest.dataset.rows === state.count && manifest.chainDigest === state.chain
    && manifest.dataset.originalQueryHash === state.queryHash && same(manifest.dataset.projectedFields, state.fields),
  'CANADABUYS_NATIVE_DELIVERY_CHANGED');
  const sourcePages = state.pages.map(page => ({ index: page.index, intent: page.intent, sourceSha256: page.sourceSha256,
    evidenceSha256: page.evidenceSha256, recordDigest: page.chain, rows: page.payload.rows.length, requestedCursor: page.requestCursor }));
  requireThat(same(manifest.sourcePages, sourcePages), 'CANADABUYS_NATIVE_DELIVERY_CHANGED');
  const output = await readExact(join(directory, 'dataset.jsonl')), outputRecord = manifest.outputs?.['dataset.jsonl'];
  const expectedOutput = createHash('sha256');
  for (const page of state.pages) for (const row of page.payload.rows) expectedOutput.update(JSON.stringify(row) + '\n');
  requireThat(outputRecord && outputRecord.bytes === output.length && outputRecord.sha256 === hash(output)
    && expectedOutput.digest('hex') === hash(output), 'CANADABUYS_NATIVE_OUTPUT_CHANGED');
  const groups = new Map();
  for (const page of state.pages) for (const row of page.payload.rows) {
    requireThat(object(row) && HASH.test(row.package_id ?? '') && HASH.test(row.payload_sha256 ?? '')
      && HASH.test(row.part_sha256 ?? '') && typeof row.payload_base64 === 'string', 'CANADABUYS_DELIVERY_COLUMNS_REQUIRED',
    'Receive the complete CANADABUYS transport columns from the original dataset query.');
    number(row.part_count, 'Part count', 1, 1000000); number(row.part_index, 'Part index', 0, row.part_count - 1);
    number(row.payload_bytes, 'Payload bytes', 1, MAX_BYTES);
    const part = Buffer.from(row.payload_base64, 'base64');
    requireThat(part.toString('base64') === row.payload_base64 && part.length <= CHUNK_BYTES && hash(part) === row.part_sha256, 'CANADABUYS_DELIVERY_PART_CHANGED');
    let group = groups.get(row.package_id);
    if (!group) {
      group = { packageId: row.package_id, sha256: row.payload_sha256, bytes: row.payload_bytes, count: row.part_count, parts: new Map() };
      groups.set(row.package_id, group);
    }
    requireThat(group.sha256 === row.payload_sha256 && group.bytes === row.payload_bytes
      && group.count === row.part_count && !group.parts.has(row.part_index), 'CANADABUYS_DELIVERY_PART_CONFLICT');
    group.parts.set(row.part_index, part);
  }
  const packets = [];
  for (const group of groups.values()) {
    requireThat(group.parts.size === group.count, 'CANADABUYS_DELIVERY_PACKET_INCOMPLETE', 'Receive every part of each selected contracting-process package.');
    const bytes = Buffer.concat(Array.from({ length: group.count }, (_, index) => group.parts.get(index)));
    requireThat(bytes.length === group.bytes && hash(bytes) === group.sha256, 'CANADABUYS_DELIVERY_PACKET_CHANGED');
    const pkg = checkPackage(parse(bytes));
    requireThat(pkg.packageId === group.packageId, 'CANADABUYS_DELIVERY_PACKET_CHANGED');
    packets.push(pkg);
  }
  requireThat(packets.length > 0, 'CANADABUYS_EMPTY_DELIVERY');
  const sources = new Map(), noticeIds = new Set(), entryIds = new Set();
  const reviews = new Map(), workshares = new Map(), observations = new Map(), captures = new Map();
  const mergeRecord = (map, id, item, label) => {
    requireThat(typeof id === 'string' && (!map.has(id) || same(map.get(id), item)),
      'CANADABUYS_DELIVERY_' + label + '_CONFLICT', 'Original delivery packages disagree on ' + label.toLowerCase());
    map.set(id, item);
  };
  for (const pkg of packets) {
    requireThat(pkg.workspace?.id === packets[0].workspace?.id && pkg.workspace?.revision === packets[0].workspace?.revision,
      'CANADABUYS_DELIVERY_WORKSPACE_CONFLICT');
    for (const source of pkg.sources) {
      const { entryIds: selectedIds, ...original } = source;
      if (sources.has(source.id)) {
        const prior = sources.get(source.id), { entryIds: previousIds, ...previous } = prior;
        requireThat(same(previous, original), 'CANADABUYS_DELIVERY_SOURCE_CONFLICT');
        prior.entryIds = [...new Set([...previousIds, ...selectedIds])].sort();
      } else sources.set(source.id, { ...original, entryIds: [...selectedIds].sort() });
      for (const entryId of selectedIds) entryIds.add(entryId);
    }
    for (const noticeId of pkg.selection.noticeIds) noticeIds.add(noticeId);
    for (const review of pkg.reviews) mergeRecord(reviews, review.noticeId, review, 'REVIEW');
    for (const workshare of pkg.workshares) mergeRecord(workshares, workshare.id, workshare, 'WORKSHARE');
    for (const observation of pkg.sourceObservations || []) mergeRecord(observations, observation.id, observation, 'OBSERVATION');
    for (const capture of pkg.captures || []) mergeRecord(captures, capture.id, capture, 'CAPTURE');
  }
  const bidderPackets = packets.filter(pkg => [PACKAGE_SCHEMA, SOURCE_PACKAGE_SCHEMA].includes(pkg.schema)).map(pkg => pkg.bidderDesk);
  const body = { schema: packets.some(pkg => pkg.schema === SOURCE_PACKAGE_SCHEMA) ? SOURCE_PACKAGE_SCHEMA : bidderPackets.length ? PACKAGE_SCHEMA : LEGACY_PACKAGE_SCHEMA,
    ...(bidderPackets.length ? { bidderDesk: mergeBidderDeskPackages(bidderPackets) } : {}),
    exportedAt: packets.map(pkg => pkg.exportedAt).sort().at(-1), workspace: packets[0].workspace,
    sources: [...sources.values()].sort((a,b) => a.id.localeCompare(b.id)),
    selection: { scope: 'selected', noticeIds: [...noticeIds].sort() },
    sourceObservations: [...observations.values()], reviews: [...reviews.values()], workshares: [...workshares.values()],
    captures: [...captures.values()], publications: [], receivingHistory: [],
    provenance: { mode: 'original-sf100-delivery', packageIds: packets.map(pkg => pkg.packageId), snapshot: state.snapshot, chainDigest: state.chain } };
  const pkg = packets.length === 1 ? packets[0] : { ...body, packageId: hash(canonical(body)) };
  const currentRevision = workspace.view().workspace.revision;
  if (expectedRevision !== undefined) requireThat(currentRevision === expectedRevision, 'CANADABUYS_REVISION_CONFLICT');
  const received = workspace.receivePackage(pkg, { expectedRevision: currentRevision });
  const publication = workspace.recordPublication({ kind: 'canadabuys-native-delivery', directory, packageId: pkg.packageId,
    snapshot: state.snapshot, chainDigest: state.chain, manifestSha256: hash(manifestBytes), packages: packets.length,
    entries: entryIds.size, noticeIds: [...noticeIds], originalIntents: state.pages.map(page => page.intent), sourcePages }).publication;
  return { received, publication, packageId: pkg.packageId, packages: packets.length, entries: entryIds.size,
    snapshot: state.snapshot, chainDigest: state.chain };
}
