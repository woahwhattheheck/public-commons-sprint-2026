// MIT. Reviewed Census results become the original native dataset and merchant.
import { join, resolve } from 'node:path';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { bytes, digest, identity, readPrivate, readJson, createFile, hashPrivate,
  privateDirectory, acquireWorkspace, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { COLUMNS, COORDINATE_MEANING, API_GUIDE, only } from './source.mjs';

export const EDITION_SCHEMA = 'stellar-forge.census-geocoder-edition.v1';
export async function writeExact(path, value) {
  try { await createFile(path, value); }
  catch (error) {
    if (error.code !== 'EEXIST' || !(await readPrivate(path, Math.max(value.length, 1))).equals(value)) throw error;
  }
}
export function reviewSelection(input, captured) {
  only(input, ['name', 'columns', 'statuses', 'matchTypes', 'excludedIds', 'filters', 'ranges',
    'sorts', 'defaultLimit', 'maxLimit', 'note']);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 128)
    throw fault('GEOCODER_EDITION_NAME', 'Enter a dataset name.');
  const columns = input.columns ?? Object.keys(COLUMNS);
  if (!Array.isArray(columns) || !columns.length || new Set(columns).size !== columns.length ||
      columns.some(name => !Object.hasOwn(COLUMNS, name)) || !columns.includes('record_id') || !columns.includes('match_status'))
    throw fault('GEOCODER_REVIEW_COLUMNS', 'Select known columns, including record_id and match_status.');
  const statuses = input.statuses ?? ['Match', 'No_Match', 'Tie'], matchTypes = input.matchTypes ?? ['Exact', 'Non_Exact'];
  if (!Array.isArray(statuses) || !statuses.length || new Set(statuses).size !== statuses.length ||
      statuses.some(value => !['Match', 'No_Match', 'Tie'].includes(value)) ||
      !Array.isArray(matchTypes) || !matchTypes.length || new Set(matchTypes).size !== matchTypes.length ||
      matchTypes.some(value => !['Exact', 'Non_Exact'].includes(value)))
    throw fault('GEOCODER_REVIEW_STATUS', 'Choose the original match categories to publish.');
  const ids = new Set(captured.rows.map(row => row.record_id)), excludedIds = input.excludedIds ?? [];
  if (!Array.isArray(excludedIds) || excludedIds.length > ids.size || new Set(excludedIds).size !== excludedIds.length ||
      excludedIds.some(id => !ids.has(id))) throw fault('GEOCODER_REVIEW_IDS', 'Exclude only IDs present in this original response.');
  const plan = { name: input.name.trim(), columns: [...columns], statuses: [...statuses], matchTypes: [...matchTypes],
    excludedIds: [...excludedIds], filters: input.filters ?? ['record_id', 'match_status'].filter(name => columns.includes(name)),
    ranges: input.ranges ?? [], sorts: input.sorts ?? ['record_id'],
    defaultLimit: input.defaultLimit ?? 50, maxLimit: input.maxLimit ?? 250, note: input.note ?? '' };
  if (typeof plan.note !== 'string' || plan.note.length > 4000) throw fault('GEOCODER_REVIEW_NOTE');
  const selected = selectRows(captured.rows, plan);
  return { plan, selectedRows: selected.length, omittedRows: captured.rows.length - selected.length };
}
export function selectRows(rows, plan) {
  const omitted = new Set(plan.excludedIds);
  return rows.filter(row => plan.statuses.includes(row.match_status) &&
    (row.match_status !== 'Match' || plan.matchTypes.includes(row.match_type)) && !omitted.has(row.record_id));
}
const safePath = value => typeof value === 'string' && !value.startsWith('/') &&
  value.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..'].includes(part));
export async function reopenEdition(directory) {
  directory = resolve(directory); await privateDirectory(directory);
  const manifest = await readJson(join(directory, 'edition.json'), 4 * 1024 * 1024);
  if (manifest.schema !== EDITION_SCHEMA || !Array.isArray(manifest.files) ||
      !manifest.files.length || manifest.files.length > 512 ||
      new Set(manifest.files.map(file => file.path)).size !== manifest.files.length)
    throw fault('GEOCODER_EDITION_INVALID');
  for (const file of manifest.files) {
    if (!safePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
      throw fault('GEOCODER_EDITION_FILE');
    const actual = await hashPrivate(join(directory, file.path), 64 * 1024 * 1024);
    if (actual.hash !== file.sha256 || actual.bytes !== file.bytes) throw fault('GEOCODER_EDITION_CHANGED', file.path);
  }
  for (const required of ['dataset.csv', 'dataset.json', 'review.json', 'source.json', 'source/batch.json',
    'source/input.csv', 'source/submitted.csv', 'source/response.csv', 'source/http.json'])
    if (!manifest.files.some(file => file.path === required)) throw fault('GEOCODER_EDITION_INCOMPLETE', required);
  const config = await readJson(join(directory, 'dataset.json'), 65536);
  if (config.file !== 'dataset.csv') throw fault('GEOCODER_EDITION_CONFIG');
  const native = await loadDatasetConfig(join(directory, 'dataset.json'));
  if (identity(native.describe()) !== identity(manifest.dataset)) throw fault('GEOCODER_EDITION_CHANGED');
  return { ...manifest, directory, datasetPath: join(directory, 'dataset.json'),
    sellerPath: manifest.files.some(file => file.path === 'seller.json') ? join(directory, 'seller.json') : null };
}
export async function createEdition({ directory, batch, attempt, review, captured, originals, payment, origin, path = '/geocodes' }) {
  if ((payment === undefined) !== (origin === undefined)) throw fault('GEOCODER_TERMS_REQUIRED', 'Set public payment terms and origin together.');
  const reviewed = reviewSelection(review.plan, captured);
  if (review.responseSha256 !== captured.responseSha256 || review.batchId !== batch.id || review.attemptId !== attempt.id ||
      review.selectedRows !== reviewed.selectedRows || review.omittedRows !== reviewed.omittedRows)
    throw fault('GEOCODER_REVIEW_CHANGED', 'Review this exact retained response before building its edition.');
  const plan = reviewed.plan, operationId = identity({ batch: batch.id, attempt: attempt.id, review: review.id,
    responseSha256: captured.responseSha256, payment: payment ?? null, origin: origin ?? null, path });
  directory = resolve(directory); await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    try {
      const saved = await reopenEdition(directory);
      if (saved.operationId !== operationId) throw fault('GEOCODER_EDITION_ALREADY_USED');
      return saved;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeExact(join(directory, 'preparing.json'), bytes({ schema: EDITION_SCHEMA, operationId }));
    const rows = selectRows(captured.rows, plan);
    const csv = Buffer.from(csvLine(plan.columns) + rows.map(row => csvLine(plan.columns.map(name =>
      row[name] === null ? '' : String(row[name])))).join(''));
    if (csv.length > 64 * 1024 * 1024) throw fault('GEOCODER_EDITION_SIZE');
    await writeExact(join(directory, 'dataset.csv'), csv);
    const config = { schema: 'stellar-forge.csv-dataset.v1', file: 'dataset.csv', name: plan.name,
      columns: Object.fromEntries(plan.columns.map(name => [name, COLUMNS[name]])),
      filters: plan.filters, ranges: plan.ranges, sorts: plan.sorts,
      maxRows: 10000, maxBytes: 64 * 1024 * 1024, maxCellChars: 65536,
      defaultLimit: plan.defaultLimit, maxLimit: plan.maxLimit, maxPageBytes: 900 * 1024 };
    await writeExact(join(directory, 'dataset.json'), bytes(config));
    const native = await loadDatasetConfig(join(directory, 'dataset.json'));
    if (native.describe().rowCount !== rows.length) throw fault('GEOCODER_EDITION_ROW_COUNT');
    await writeExact(join(directory, 'review.json'), bytes(review));
    await privateDirectory(join(directory, 'source'), true);
    const files = ['dataset.csv', 'dataset.json', 'review.json'];
    for (const [name, value] of Object.entries(originals)) {
      if (!safePath(name) || name.includes('/')) throw fault('GEOCODER_ORIGINAL_NAME');
      await writeExact(join(directory, 'source', name), value); files.push('source/' + name);
    }
    const source = { schema: 'stellar-forge.census-geocoder-provenance.v1', provider: 'U.S. Census Bureau',
      apiGuide: API_GUIDE, batchId: batch.id, attemptId: attempt.id, selection: batch.selection,
      inputSha256: batch.input.originalSha256, submittedSha256: batch.input.submittedSha256,
      responseSha256: captured.responseSha256, responseReceivedAt: attempt.exchange.receivedAt,
      originalRows: captured.rows.length, publishedRows: rows.length, counts: captured.counts,
      coordinateMeaning: COORDINATE_MEANING, numericCoordinates: 'Native numeric columns use IEEE-754; coordinate_text retains the original provider coordinate token.',
      geographyCodes: 'FIPS, tract, block and derived GEOIDs are text with original leading zeros.',
      reviewId: review.id, reviewSha256: digest(bytes(review)), retainedSourceDirectory: 'source' };
    await writeExact(join(directory, 'source.json'), bytes(source)); files.push('source.json');
    if (payment !== undefined) {
      const seller = await buildDatasetSellerConfig(native, { payment, origin, path });
      await writeExact(join(directory, 'seller.json'), bytes(seller)); files.push('seller.json');
    }
    const manifest = { schema: EDITION_SCHEMA, operationId, createdAt: stamp(), batchId: batch.id,
      attemptId: attempt.id, reviewId: review.id, dataset: native.describe(), source, files: [] };
    for (const name of files) {
      const file = await hashPrivate(join(directory, name), 64 * 1024 * 1024);
      manifest.files.push({ path: name, bytes: file.bytes, sha256: file.hash });
    }
    await syncDirectory(join(directory, 'source'));
    await createFile(join(directory, 'edition.json'), bytes(manifest)); await syncDirectory(directory);
    return { ...manifest, directory, datasetPath: join(directory, 'dataset.json'),
      sellerPath: payment === undefined ? null : join(directory, 'seller.json') };
  } finally { await release(); }
}
export async function copyEdition(source, destination) {
  const edition = await reopenEdition(source); destination = resolve(destination);
  if (destination === edition.directory || destination.startsWith(edition.directory + '/'))
    throw fault('GEOCODER_EXPORT_DESTINATION', 'Choose a separate destination.');
  await privateDirectory(destination, true); const release = await acquireWorkspace(destination);
  try {
    for (const file of edition.files) {
      const segments = file.path.split('/');
      if (segments.length > 1) await privateDirectory(join(destination, ...segments.slice(0, -1)), true);
      await writeExact(join(destination, file.path), await readPrivate(join(edition.directory, file.path), 64 * 1024 * 1024));
    }
    await writeExact(join(destination, 'edition.json'), await readPrivate(join(edition.directory, 'edition.json'), 4 * 1024 * 1024));
    await syncDirectory(join(destination, 'source')); await syncDirectory(destination);
    return await reopenEdition(destination);
  } finally { await release(); }
}
