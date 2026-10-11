// MIT. Reviewed workbook publication -> exact original dataset buyer selection.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareReview } from '../../../sf88-operator-buyer-cli/prepare.mjs';
import { validateDatasetQuery } from '../../../sf88-operator-buyer-cli/dataset-page.mjs';
import { absolute, privateDirectory, readBytes, parseJson, digest, jsonBytes,
  writeBytes, writeJson, exists, need, object, intent } from '../../../sf88-operator-buyer-cli/node/store.mjs';

export const PACKET_SCHEMA = 'stellar-forge.workbook-customer-packet.v1';
export const REQUEST_SCHEMA = 'stellar-forge.workbook-customer-request.v1';
const REVIEW_SCHEMA = 'stellar-forge.dataset-publisher-review.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const PACKET_FILES = Object.freeze(['publisher-review.json', 'buyer.json', 'request.json']);
export const MAX_REVIEW_BYTES = 8 * 1024 * 1024;
const LIMITS = Object.freeze({'publisher-review.json':MAX_REVIEW_BYTES, 'buyer.json':65536, 'request.json':MAX_REVIEW_BYTES});
const clone = value => structuredClone(value);

function originalReview(raw) {
  need(raw instanceof Uint8Array && raw.byteLength <= MAX_REVIEW_BYTES, 'WORKBOOK_REVIEW_SIZE_INVALID');
  const review = parseJson(raw), candidate = review?.candidate;
  need(review?.schema === REVIEW_SCHEMA && object(candidate) &&
    candidate.schema === 'stellar-forge.dataset-publisher-candidate.v1' &&
    UUID.test(candidate.id ?? '') && HASH.test(candidate.csvHash ?? '') &&
    HASH.test(candidate.configHash ?? '') && HASH.test(candidate.dataset?.snapshot ?? '') &&
    Number.isSafeInteger(candidate.sourceBytes) && candidate.sourceBytes > 0 &&
    Number.isSafeInteger(candidate.revision) && candidate.revision > 0 &&
    object(review.datasetConfig) && Array.isArray(candidate.dataset.columns) &&
    candidate.dataset.columns.length > 0 && candidate.dataset.columns.length <= 256 &&
    candidate.dataset.columns.every(column => object(column) && typeof column.name === 'string' &&
      column.name.length > 0 && typeof column.type === 'string') &&
    new Set(candidate.dataset.columns.map(column => column.name)).size === candidate.dataset.columns.length &&
    Number.isSafeInteger(candidate.dataset.rowCount) && candidate.dataset.rowCount >= 0,
  'WORKBOOK_ORIGINAL_PUBLISHER_REVIEW_REQUIRED');
  if (candidate.workbookSource !== undefined) {
    const source = candidate.workbookSource;
    need(object(source) && source.schema === 'stellar-forge.workbook-candidate-origin.v1' &&
      ['sourceSha256','planSha256','parserSha256','projectionSha256','rowMapSha256'].every(key => HASH.test(source[key] ?? '')) &&
      ['sourceId','filename','planId','preparationKey'].every(key => typeof source[key] === 'string' && source[key].length > 0) &&
      Number.isSafeInteger(source.sourceBytes) && source.sourceBytes > 0 &&
      Number.isSafeInteger(source.planRevision) && source.planRevision > 0 &&
      Number.isSafeInteger(source.rowMapBytes) && source.rowMapBytes >= 0,
    'WORKBOOK_SOURCE_PROVENANCE_INVALID');
  }
  // The merchant's complete workbook selection/date/formula/source coordinates
  // remain in these original bytes. This receiving boundary does not re-parse
  // Excel or regenerate the original publisher's review.
  return {review, candidate};
}

function originalPreparation(raw) {
  need(raw instanceof Uint8Array && raw.byteLength <= 65536, 'WORKBOOK_BUYER_CONFIG_SIZE_INVALID');
  const config = parseJson(raw), origin = config?.preparedFrom, op = config?.operation;
  need(object(origin?.originalListing) && origin.rowIndex === 0 &&
    Number.isSafeInteger(origin.acceptIndex) && origin.acceptIndex >= 0 &&
    op?.method === 'GET' && typeof op.url === 'string',
  'WORKBOOK_ORIGINAL_BUYER_PREPARATION_REQUIRED');
  const generated = prepareReview(jsonBytes({resources:[origin.originalListing]}), {
    rowIndex:0, acceptIndex:origin.acceptIndex, intentId:op.intentId, url:op.url, method:'GET',
  });
  need(Buffer.from(raw).equals(generated.data), 'WORKBOOK_PREPARED_CONFIG_CHANGED');
  const query = validateDatasetQuery(op.url, {initial:true});
  const snapshots = query.getAll('snapshot');
  need(snapshots.length === 1 && HASH.test(snapshots[0]), 'WORKBOOK_SELECTED_SNAPSHOT_REQUIRED');
  return {config, query, snapshot:snapshots[0]};
}

export function workbookRequest(reviewBytes, configBytes, {datasetId} = {}) {
  datasetId = intent(datasetId);
  const {candidate} = originalReview(reviewBytes);
  const {config, query, snapshot} = originalPreparation(configBytes);
  need(candidate.dataset.snapshot === snapshot, 'WORKBOOK_REVIEW_AND_BUYER_SNAPSHOT_DIFFER');
  const fields = query.has('fields') ? query.get('fields').split(',') : candidate.dataset.columns.map(column => column.name);
  need(fields.length > 0 && new Set(fields).size === fields.length &&
    fields.every(name => candidate.dataset.columns.some(column => column.name === name)),
  'WORKBOOK_SELECTED_COLUMNS_DIFFER');
  return {
    schema:REQUEST_SCHEMA, datasetId, intentId:config.operation.intentId, snapshot,
    candidate:{id:candidate.id, revision:candidate.revision,
      csvSha256:candidate.csvHash, configSha256:candidate.configHash, sourceBytes:candidate.sourceBytes,
      reviewSha256:digest(reviewBytes)},
    prepared:{configSha256:digest(configBytes), offerSha256:config.preparedFrom.discoveryFileSha256,
      acceptIndex:config.preparedFrom.acceptIndex, url:config.operation.url, method:'GET',
      query:query.toString(), fields},
    dataset:clone(candidate.dataset),
    ...(candidate.workbookSource === undefined ? {} : {workbookSource:clone(candidate.workbookSource)}),
  };
}

export async function retainSame(path, data) {
  data = Buffer.from(data);
  if (await exists(path)) {
    need((await readBytes(path, data.length)).equals(data), 'WORKBOOK_RETAINED_FILE_CHANGED');
    return false;
  }
  try { await writeBytes(path, data, {exclusive:true}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readBytes(path, data.length)).equals(data), 'WORKBOOK_RETAINED_FILE_CHANGED');
  }
  return true;
}

export function fileRecord(raw) { return {bytes:raw.byteLength, sha256:digest(raw)}; }

export function validateFileRecords(files, expected) {
  need(object(files) && Object.keys(files).length === expected.length &&
    expected.every(name => Object.hasOwn(files, name)), 'WORKBOOK_FILE_INVENTORY_CHANGED');
  for (const name of expected) {
    const value = files[name];
    need(object(value) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
      HASH.test(value.sha256 ?? ''), 'WORKBOOK_FILE_METADATA_INVALID');
  }
}

export async function readRecorded(path, record, maximum) {
  need(record.bytes <= maximum, 'WORKBOOK_FILE_LIMIT_EXCEEDED');
  const raw = await readBytes(path, maximum);
  need(raw.length === record.bytes && digest(raw) === record.sha256, 'WORKBOOK_RETAINED_FILE_CHANGED');
  return raw;
}

export async function createWorkbookPacket({directory, reviewFile, configFile, datasetId}) {
  directory = absolute(directory);
  const [review, config] = await Promise.all([
    readBytes(absolute(reviewFile), MAX_REVIEW_BYTES), readBytes(absolute(configFile), 65536),
  ]);
  const request = workbookRequest(review, config, {datasetId});
  const contents = {'publisher-review.json':review, 'buyer.json':config, 'request.json':jsonBytes(request)};
  const files = Object.fromEntries(PACKET_FILES.map(name => [name, fileRecord(contents[name])]));
  const identity = {schema:PACKET_SCHEMA, files};
  const proposed = {...identity, packetSha256:digest(jsonBytes(identity))};
  await privateDirectory(directory);
  const allowed = new Set([...PACKET_FILES, 'manifest.json', 'acquisition.json', 'deliveries', 'analysis']);
  need((await readdir(directory)).every(name => allowed.has(name) || /^\.write-[a-f0-9-]{36}$/.test(name)),
    'WORKBOOK_SEPARATE_CUSTOMER_DIRECTORY_REQUIRED');
  if (await exists(join(directory, 'manifest.json'))) {
    const retained = await openWorkbookPacket(directory);
    need(retained.manifest.packetSha256 === proposed.packetSha256, 'WORKBOOK_CUSTOMER_PACKET_EXISTS_DIFFERENT_SOURCE');
    return retained;
  }
  // A failed import retains its exact completed prefix. Repeating the same
  // import can finish it; a changed source cannot replace that prefix.
  for (const name of PACKET_FILES) await retainSame(join(directory, name), contents[name]);
  await retainSame(join(directory, 'manifest.json'), jsonBytes(proposed));
  return openWorkbookPacket(directory);
}

export async function openWorkbookPacket(directory) {
  directory = await privateDirectory(absolute(directory), {create:false});
  const manifest = parseJson(await readBytes(join(directory, 'manifest.json'), 65536));
  need(manifest?.schema === PACKET_SCHEMA && HASH.test(manifest.packetSha256 ?? ''),
    'WORKBOOK_CUSTOMER_PACKET_INVALID');
  validateFileRecords(manifest.files, PACKET_FILES);
  need(manifest.packetSha256 === digest(jsonBytes({schema:PACKET_SCHEMA, files:manifest.files})),
    'WORKBOOK_CUSTOMER_PACKET_CHANGED');
  const raw = {};
  for (const name of PACKET_FILES) raw[name] = await readRecorded(join(directory, name), manifest.files[name], LIMITS[name]);
  const request = parseJson(raw['request.json']);
  const reconstructed = workbookRequest(raw['publisher-review.json'], raw['buyer.json'], {datasetId:request?.datasetId});
  need(jsonBytes(request).equals(jsonBytes(reconstructed)), 'WORKBOOK_REQUEST_BINDING_CHANGED');
  return Object.freeze({directory, manifest:Object.freeze(clone(manifest)), request:Object.freeze(clone(request)),
    review:clone(parseJson(raw['publisher-review.json'])), config:clone(parseJson(raw['buyer.json']))});
}
