// MIT. FRED editions compose the maintained dataset store, SF30 seller and SF88 Buyer.
import { resolve, join, basename } from 'node:path';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller } from '../dataset-refresh/service.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';
import { readSellerConfig } from '../serve.mjs';
import { compileAssetRouteOffer, MAX_ASSET_BYTES, MAX_ASSET_BUDGET } from '../response-asset.mjs';
import { createWaterNativeFactory } from '../usgs-water/merchant.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { validateDatasetQuery, inspectDatasetPage } from '../../sf88-operator-buyer-cli/dataset-page.mjs';
import { readBytes, writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { need, canonical, clone, COLUMNS, projectionPolicy, observationCsv, operationId, MAX_CAPTURE_BYTES, FRED_NOTICE, FRED_TERMS } from './model.mjs';
import { hash, digest, jsonBytes, optionalJson, validateCapture } from './source.mjs';

const EDITION = 'stellar-forge.fred-edition.v1';
const PLAN = 'stellar-forge.fred-merchant.v1';
const PURCHASE = 'stellar-forge.fred-purchase.v1';
const PAGE_BYTES = 900 * 1024;
async function exactFile(directory, name, bytes) {
  try { await writeBytes(join(directory, name), bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readBytes(join(directory, name), Math.max(bytes.length, 1));
    need(existing.equals(bytes), 'An immutable edition file has different original bytes.', 'FRED_EDITION_CONFLICT', 409);
  }
}
const member = (path, bytes, contentType, role) => ({ path, bytes: bytes.length, sha256: hash(bytes), contentType, role });
function editionIdentity(value) {
  return { schema: EDITION, captureSha256: value.captureSha256, reviewId: value.reviewId,
    selection: value.selection, series: value.series, policy: value.policy, snapshot: value.snapshot,
    sourceNotice: value.sourceNotice, sourceTerms: value.sourceTerms,
    rowCount: value.rowCount, files: value.files };
}
export async function prepareFredEdition({ directory, capture, review } = {}) {
  directory = await privateDirectory(resolve(directory));
  const model = validateCapture(capture), policy = projectionPolicy(review?.policy);
  need(review?.captureId === capture.captureSha256 &&
    review.id === digest({ captureId: review.captureId, policy, note: review.note }), 'Use the original retained source review.');
  return withPrivateLock(directory, 'edition.lock', async () => {
    const csv = Buffer.from(observationCsv(model, policy));
    need(csv.length <= 256 * 1024 * 1024, 'The native dataset exceeds its 256 MiB source capacity.');
    const config = { schema: 'stellar-forge.csv-dataset.v1', file: 'observations.csv',
      name: 'FRED economic observations', columns: Object.fromEntries(policy.fields.map(field => [field, COLUMNS[field]])),
      filters: policy.filters, ranges: policy.ranges, sorts: policy.sorts,
      defaultLimit: policy.defaultLimit, maxLimit: policy.maxLimit, maxRows: 1000000,
      maxBytes: 256 * 1024 * 1024, maxCellChars: 1048576, maxPageBytes: PAGE_BYTES };
    const sourceBytes = jsonBytes(capture), configBytes = jsonBytes(config), reviewBytes = jsonBytes(review);
    const files = [member('capture.json', sourceBytes, 'application/json', 'ORIGINAL_SOURCE'),
      member('observations.csv', csv, 'text/csv', 'CUSTOMER_PROJECTION'),
      member('dataset.json', configBytes, 'application/json', 'NATIVE_DATASET_CONFIG'),
      member('review.json', reviewBytes, 'application/json', 'SAVED_REVIEW')];
    for (const [name, bytes] of [['capture.json', sourceBytes], ['observations.csv', csv], ['dataset.json', configBytes], ['review.json', reviewBytes]])
      await exactFile(directory, name, bytes);
    const dataset = await loadDatasetConfig(join(directory, 'dataset.json')), description = dataset.describe();
    need(description.rowCount === model.rowCount, 'Original dataset projection changed row count.');
    const edition = { schema: EDITION, captureSha256: capture.captureSha256, reviewId: review.id,
      selection: model.selection, series: model.series, policy, snapshot: description.snapshot,
      sourceNotice: FRED_NOTICE, sourceTerms: FRED_TERMS,
      rowCount: model.rowCount, files };
    edition.editionId = 'fred-' + digest(editionIdentity(edition));
    await exactFile(directory, 'edition.json', jsonBytes(edition));
    return { ...edition, directory };
  });
}
export async function readFredEdition(directory) {
  directory = resolve(directory);
  const edition = await readPrivateJson(join(directory, 'edition.json'), 4 * 1024 * 1024);
  need(edition.schema === EDITION && edition.editionId === 'fred-' + digest(editionIdentity(edition)) &&
    Array.isArray(edition.files), 'Retained edition manifest changed.');
  const names = ['capture.json', 'observations.csv', 'dataset.json', 'review.json'];
  need(edition.files.length === names.length && new Set(edition.files.map(file => file.path)).size === names.length &&
    edition.files.every(file => names.includes(file.path)), 'Edition file inventory changed.');
  for (const item of edition.files) {
    need(Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= 256 * 1024 * 1024, 'Invalid edition member size.');
    const bytes = await readBytes(join(directory, item.path), item.bytes);
    need(bytes.length === item.bytes && hash(bytes) === item.sha256, 'Retained edition member changed: ' + item.path);
  }
  const capture = await readPrivateJson(join(directory, 'capture.json'), MAX_CAPTURE_BYTES * 2);
  const model = validateCapture(capture);
  need(capture.captureSha256 === edition.captureSha256 && model.rowCount === edition.rowCount,
    'Edition source binding changed.');
  return { ...edition, directory };
}
function planIdentity(plan) {
  return { schema: PLAN, editionId: plan.editionId, snapshot: plan.snapshot, origin: plan.origin, path: plan.path,
    payment: plan.payment, resource: plan.resource, downloads: plan.downloads, configSha256: plan.configSha256, offersSha256: plan.offersSha256 };
}
export async function stageFredMerchant({ directory, origin, path = '/economic-data', payment } = {}) {
  const edition = await readFredEdition(directory);
  const dataset = await loadDatasetConfig(join(edition.directory, 'dataset.json'));
  const base = path.replace(/\/$/, '') + '/' + edition.editionId;
  const resourcePath = base + '/observations';
  const config = await buildDatasetSellerConfig(dataset, { payment, origin, path: resourcePath });
  const route = config.routes[0];
  route.id = 'fred-observations';
  route.definition.serviceName = 'Economic editions';
  route.definition.description = 'Original FRED observations at vintage ' + edition.selection.asOf + '; one native payment per selected page.';
  route.definition.queryParameters.push(clone(DATASET_SNAPSHOT_PARAMETER));
  const editionBytes = await readBytes(join(edition.directory, 'edition.json'), 4 * 1024 * 1024);
  const candidates = [member('edition.json', editionBytes, 'application/json', 'EDITION_MANIFEST'),
    ...edition.files.filter(file => ['ORIGINAL_SOURCE', 'CUSTOMER_PROJECTION'].includes(file.role))];
  const downloads = [];
  let bytes = 0, maxResponseBytes = PAGE_BYTES;
  for (const file of candidates) {
    // Larger originals stay in the complete receiving bundle; paginated data remains available.
    if (file.bytes > MAX_ASSET_BYTES || bytes + file.bytes > MAX_ASSET_BUDGET) continue;
    bytes += file.bytes; maxResponseBytes = Math.max(maxResponseBytes, file.bytes);
    const assetPath = base + '/files/' + file.path;
    downloads.push({ ...file, resource: config.publicOrigin + assetPath });
    config.routes.push({ id: 'fred-' + file.path.replace(/\./g, '-'), path: assetPath,
      definition: { method: 'GET', serviceName: 'Economic editions', description: 'Exact ' + file.role.toLowerCase().replaceAll('_', ' '), payment },
      responseAsset: { file: file.path, sha256: file.sha256, contentType: file.contentType, downloadName: file.path } });
  }
  config.maxResponseBytes = maxResponseBytes; config.assetBudgetBytes = MAX_ASSET_BUDGET;
  const offers = config.routes.map(item => item.responseAsset
    ? compileAssetRouteOffer(item, config.publicOrigin, compileHttpSellerOffer)
    : compileHttpSellerOffer({ ...item.definition, url: config.publicOrigin + item.path }));
  const configBytes = jsonBytes(config), offersBytes = jsonBytes({ resources: offers });
  const plan = { schema: PLAN, editionId: edition.editionId, snapshot: edition.snapshot, origin: config.publicOrigin, path,
    payment: clone(payment), resource: config.publicOrigin + resourcePath, downloads,
    configSha256: hash(configBytes), offersSha256: hash(offersBytes) };
  plan.planSha256 = digest(planIdentity(plan));
  return withPrivateLock(edition.directory, 'merchant.lock', async () => {
    await exactFile(edition.directory, 'merchant-config.json', configBytes);
    await exactFile(edition.directory, 'offers.json', offersBytes);
    await readSellerConfig(join(edition.directory, 'merchant-config.json'));
    await exactFile(edition.directory, 'merchant-plan.json', jsonBytes(plan));
    return plan;
  });
}
export async function readFredMerchant(directory) {
  const edition = await readFredEdition(directory);
  const plan = await readPrivateJson(join(edition.directory, 'merchant-plan.json'), 4 * 1024 * 1024);
  need(plan.schema === PLAN && plan.planSha256 === digest(planIdentity(plan)) && plan.editionId === edition.editionId &&
    plan.snapshot === edition.snapshot, 'Retained merchant plan changed.');
  const configBytes = await readBytes(join(edition.directory, 'merchant-config.json'), 4 * 1024 * 1024),
    offersBytes = await readBytes(join(edition.directory, 'offers.json'), 4 * 1024 * 1024);
  need(hash(configBytes) === plan.configSha256 && hash(offersBytes) === plan.offersSha256, 'Original seller terms changed.');
  return { edition, plan, config: await readSellerConfig(join(edition.directory, 'merchant-config.json')),
    offersBytes, offers: JSON.parse(offersBytes).resources };
}
export async function startFredMerchant({ directory, port = 0, nativeFactory, facilitator,
  allowLocalFacilitator = false, maxInFlight = 64, drainGraceMs = 60000 } = {}) {
  need(!(nativeFactory && facilitator), 'Choose the original native factory or configured facilitator.');
  const { edition, plan, config } = await readFredMerchant(directory);
  const versionDirectory = join(edition.directory, 'dataset-state');
  const retainedStore = await optionalJson(join(versionDirectory, 'state.json'), 4 * 1024 * 1024);
  const versions = await openDatasetVersions({ directory: versionDirectory, maxCachedVersions: 1, maxResidentRows: 1000000,
    ...(retainedStore ? {} : { initialConfig: join(edition.directory, 'dataset.json'), maxVersions: 4,
      maxRetainedBytes: 256 * 1024 * 1024, retentionMs: 3600000 }) });
  try {
    need(versions.describe().snapshot === edition.snapshot, 'This immutable economic edition contains a changed dataset store.');
    const factory = nativeFactory ?? (facilitator ? await createWaterNativeFactory({ facilitator, allowLocalFacilitator }) : null);
    const session = await startVersionedDatasetSeller({ versions, config, port, nativeFactory: factory,
      controlTransport: 'loopback', maxInFlight, drainGraceMs });
    return { ...session, editionId: edition.editionId, snapshot: edition.snapshot, resource: plan.resource,
      mode: factory ? 'NATIVE_SELLER' : 'CHALLENGE_ONLY' };
  } catch (error) { await versions.close(); throw error; }
}
function queryEntries(query) {
  const entries = query instanceof URLSearchParams ? [...query] : Object.entries(query ?? {});
  need(entries.every(([key, value]) => typeof key === 'string' && typeof value === 'string') &&
    new Set(entries.map(([key]) => key)).size === entries.length, 'Query parameters must have unique string values.');
  return entries;
}
function purchaseIdentity(purchase) {
  return { schema: PURCHASE, editionId: purchase.editionId, captureSha256: purchase.captureSha256,
    snapshot: purchase.snapshot, planSha256: purchase.planSha256, intentId: purchase.intentId, url: purchase.url,
    file: purchase.file, previous: purchase.previous, expected: purchase.expected, configSha256: purchase.configSha256 };
}
export async function prepareFredPurchase({ directory, intentId, query = {}, file = null, previous = null, acceptIndex = 0 } = {}) {
  operationId(intentId);
  const { edition, plan, offersBytes, offers } = await readFredMerchant(directory);
  let resource = plan.resource, expected = null;
  if (file !== null) {
    const download = plan.downloads.find(item => item.path === file);
    need(download && queryEntries(query).length === 0 && previous === null, 'Choose an advertised complete source file without dataset query parameters.');
    resource = download.resource; expected = clone(download);
  }
  const url = new URL(resource);
  if (file === null) {
    const params = new URLSearchParams(queryEntries(query));
    need(!params.has('snapshot') || params.get('snapshot') === edition.snapshot, 'Keep the original edition snapshot.');
    params.set('snapshot', edition.snapshot);
    url.search = params.toString(); url.searchParams.sort();
    validateDatasetQuery(url.href, { initial: previous === null });
    if (previous) need(previous.snapshot === edition.snapshot && previous.nextCursor &&
      previous.nextCursor === url.searchParams.get('cursor'), 'Use the preceding original page and its next cursor.');
    const dataset = await loadDatasetConfig(join(edition.directory, 'dataset.json'));
    params.delete('snapshot');
    const admission = dataset.admit({ query: params });
    need(admission === true, admission?.body?.message ?? 'Original dataset declined the customer query.');
  }
  const rowIndex = offers.findIndex(offer => (typeof offer.resource === 'string' ? offer.resource : offer.resource.url) === resource);
  need(rowIndex >= 0, 'Original offer is unavailable.');
  const root = await privateDirectory(join(edition.directory, 'customer-requests', intentId));
  const destination = join(root, 'response.bin');
  const prepared = prepareReview(offersBytes, { rowIndex, acceptIndex, intentId, url: url.href, method: 'GET', responseOut: destination });
  const config = { ...prepared.draft, responseFile: expected
    ? { destination, maxBytes: Math.max(1, expected.bytes), expectedSha256: expected.sha256, expectedBytes: expected.bytes, expectedContentType: expected.contentType }
    : { destination, maxBytes: PAGE_BYTES } };
  const purchase = { schema: PURCHASE, editionId: edition.editionId, captureSha256: edition.captureSha256,
    snapshot: edition.snapshot, planSha256: plan.planSha256, intentId, url: url.href, file, previous: clone(previous),
    expected, configSha256: hash(jsonBytes(config)), config };
  purchase.purchaseSha256 = digest(purchaseIdentity(purchase));
  await exactFile(root, 'prepared.json', jsonBytes(purchase));
  return purchase;
}
async function originalPurchase(directory, purchase) {
  need(purchase?.schema === PURCHASE && purchase.purchaseSha256 === digest(purchaseIdentity(purchase)) &&
    hash(jsonBytes(purchase.config)) === purchase.configSha256, 'Prepared purchase changed.');
  const current = await prepareFredPurchase({ directory, intentId: purchase.intentId,
    query: purchase.file === null ? new URL(purchase.url).searchParams : {}, file: purchase.file,
    previous: purchase.previous, acceptIndex: purchase.config.preparedFrom.acceptIndex });
  need(current.purchaseSha256 === purchase.purchaseSha256, 'Purchase belongs to another original edition.');
  return current;
}
async function receivedResult(result, binding) {
  result.raiseForStatus();
  const bytes = await result.bytes({ limit: binding.expected ? Math.max(1, binding.expected.bytes) : PAGE_BYTES });
  if (binding.expected) need(bytes.length === binding.expected.bytes && hash(bytes) === binding.expected.sha256,
    'Delivered original source bytes changed.');
  const metadata = binding.file === null
    ? inspectDatasetPage(bytes, { url: binding.url, expectedSnapshot: binding.snapshot, previous: binding.previous })
    : { ...binding.expected };
  return { state: 'DELIVERED', intentId: binding.intentId, editionId: binding.editionId,
    metadata, bytes: bytes.length, sha256: hash(bytes), ...(binding.file === null ? { page: JSON.parse(bytes.toString('utf8')) } : {}), result };
}
async function bindNativePurchase(operation, current) {
  const bytes = await readBytes(operation.configPath, 65536), config = JSON.parse(bytes.toString('utf8'));
  const metadata = await readPrivateJson(join(operation.directory, 'operation.json'), 65536);
  need(metadata.intentId === current.intentId && metadata.state === 'PREPARED' &&
    metadata.configSha256 === hash(bytes) && canonical(config.operation) === canonical(current.config.operation) &&
    canonical(config.preparedFrom) === canonical(current.config.preparedFrom) && config.captureBody === false,
    'Existing native intent belongs to another original request.');
  for (const key of ['maxBytes', 'expectedSha256', 'expectedBytes', 'expectedContentType'])
    need(config.responseFile?.[key] === current.config.responseFile?.[key], 'Original customer delivery policy changed.');
  const binding = { ...purchaseIdentity(current), purchaseSha256: current.purchaseSha256, nativeConfigSha256: hash(bytes) };
  await exactFile(operation.directory, 'fred-edition.json', jsonBytes(binding));
  return binding;
}
export async function executeFredPurchase({ directory, buyer, purchase, signal } = {}) {
  need(buyer && typeof buyer.fromConfig === 'function', 'Supply the maintained SF88 Buyer.');
  const current = await originalPurchase(directory, purchase);
  let operation;
  try { operation = await buyer.fromConfig(current.config, { signal }); }
  catch (error) {
    if (error.code !== 'INTENT_ALREADY_EXISTS_USE_RECOVER') throw error;
    operation = buyer.operation(current.intentId);
  }
  const binding = await bindNativePurchase(operation, current);
  const retained = await operation.recover();
  if (retained !== null) return receivedResult(retained, binding);
  const existing = await optionalJson(join(operation.directory, 'attempt.json'));
  if (existing) return { state: 'AWAITING_NATIVE_RESULT', intentId: current.intentId, editionId: current.editionId };
  const review = await operation.review({ signal });
  need(review.configSha256 === binding.nativeConfigSha256, 'Original reviewed customer configuration changed.');
  try { return receivedResult(await operation.execute({ review, signal }), binding); }
  catch (error) {
    if (error.code === 'ATTEMPT_ALREADY_RECORDED_USE_RECOVER')
      return recoverFredPurchase({ directory, buyer, intentId: current.intentId });
    throw error;
  }
}
export async function recoverFredPurchase({ directory, buyer, intentId } = {}) {
  operationId(intentId);
  const operation = buyer.operation(intentId);
  const prepared = await readPrivateJson(join(resolve(directory), 'customer-requests', intentId, 'prepared.json'), 131072);
  const current = await originalPurchase(directory, prepared);
  const metadata = await optionalJson(join(operation.directory, 'operation.json'));
  if (!metadata) return { state: 'PREPARED_NOT_STARTED', intentId, editionId: current.editionId };
  if (metadata.state !== 'PREPARED') return { state: 'NATIVE_PREPARATION_INCOMPLETE', intentId };
  const binding = await bindNativePurchase(operation, current);
  const result = await operation.recover();
  if (result === null) return { state: 'AWAITING_NATIVE_RESULT', intentId, editionId: binding.editionId };
  need(result.record.configSha256 === binding.nativeConfigSha256, 'Original customer result changed.');
  return receivedResult(result, binding);
}
export async function exportFredPurchase(args) {
  const delivered = await recoverFredPurchase(args);
  need(delivered.result, 'This intent has no completed saved delivery.');
  const bytes = await delivered.result.bytes({ limit: delivered.bytes });
  return { bytes, contentType: delivered.metadata.contentType ?? 'application/json',
    filename: delivered.metadata.path ? basename(delivered.metadata.path) : args.intentId + '.json' };
}
