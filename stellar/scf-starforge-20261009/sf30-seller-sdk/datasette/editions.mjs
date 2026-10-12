// MIT. Complete source review, immutable editions and portable Datasette receiving.
import { readdir, lstat, rename, mkdir, rm, unlink, link } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { object, bytes, digest, identity, stamp, fault, privateDirectory, readPrivate, readJson,
  createFile, syncDirectory, acquireWorkspace } from '../postgres/publisher/files.mjs';
import { readDatasetteCapture, retainDatasetteCapture, datasetteMember } from './capture.mjs';
import { isJsonNumber, numericToken, exactCell, exactJson, nativeKind, sourceCellIdentity,
  compareExactNumbers, isSafeIntegerToken, hasLosslessNumberRoundtrip } from './json.mjs';

const EDITION = 'stellar-forge.datasette-edition.v1';
const REVIEW = 'stellar-forge.datasette-review.v1';
const PACKAGE = 'stellar-forge.datasette-source-package.v1';
const MAX_FILE = 67108864, MAX_META = 16777216, MAX_PACKAGE = 536870912;
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const FORBIDDEN = new Set(['constructor', 'prototype', '__proto__']);
const same = (a, b) => identity(a) === identity(b);
const exists = async file => { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const displayed = value => ({ type: nativeKind(value), value: exactCell(value) });
const labelled = value => object(value) && !isJsonNumber(value) && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'label');

function aliasFor(name, index, used) {
  let alias = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48);
  if (!NAME.test(alias) || FORBIDDEN.has(alias) || used.has(alias)) alias = 'Field' + (index + 1);
  while (used.has(alias)) alias = alias.slice(0, 46) + '_';
  used.add(alias); return alias;
}
function normalizedProjection(columns, projection) {
  if (!object(projection) || !Object.keys(projection).length || Object.keys(projection).length > columns.length)
    throw fault('DATASETTE_PROJECTION_REQUIRED');
  const result = {};
  for (const [alias, input] of Object.entries(projection)) {
    if (!NAME.test(alias) || FORBIDDEN.has(alias) || !object(input) ||
        Object.keys(input).some(key => !['column', 'type', 'nullable', 'representation'].includes(key)) ||
        !columns.includes(input.column) || !['string', 'integer', 'number', 'boolean'].includes(input.type) ||
        (input.nullable !== undefined && typeof input.nullable !== 'boolean') ||
        !['native', 'json', 'label', undefined].includes(input.representation))
      throw fault('DATASETTE_PROJECTION_INVALID', alias);
    const spec = { column: input.column, type: input.type, nullable: input.nullable ?? false,
      representation: input.representation ?? 'native' };
    if (spec.representation === 'json' && (spec.type !== 'string' || spec.nullable))
      throw fault('DATASETTE_JSON_PROJECTION_REQUIRES_NON_NULL_STRING', alias);
    result[alias] = spec;
  }
  return result;
}
function projectValue(native, spec, alias) {
  if (spec.representation === 'json') return exactJson(native);
  let value = native;
  if (spec.representation === 'label') {
    if (!labelled(value)) throw fault('DATASETTE_LABEL_VALUE_REQUIRED', alias);
    value = value.label;
  } else if (labelled(value)) {
    // The original label object remains in the immutable source. Choosing native
    // publishes the underlying source value; label is an explicit other choice.
    value = value.value;
  }
  if (value === null) {
    if (!spec.nullable) throw fault('DATASETTE_NULL_NOT_ALLOWED', alias);
    return null;
  }
  if (object(value) || Array.isArray(value)) {
    if (!isJsonNumber(value)) throw fault('DATASETTE_STRUCTURED_VALUE_REQUIRES_JSON', alias);
  }
  const output = exactCell(value);
  if (output === '' && spec.nullable) throw fault('DATASETTE_EMPTY_NULL_CONFLICT',
    'Choose JSON representation for ' + alias + ' to preserve both empty strings and null.');
  if (spec.type === 'integer' && (!isJsonNumber(value) ||
      !/^-?(0|[1-9][0-9]*)$/.test(value.token) || !isSafeIntegerToken(value.token)))
    throw fault('DATASETTE_INTEGER_REQUIRES_EXACT_TEXT', alias);
  if (spec.type === 'number' && (!isJsonNumber(value) || !hasLosslessNumberRoundtrip(value.token)))
    throw fault('DATASETTE_NUMBER_REQUIRES_EXACT_TEXT', alias);
  if (spec.type === 'boolean' && typeof value !== 'boolean') throw fault('DATASETTE_BOOLEAN_TYPE_MISMATCH', alias);
  return output;
}
export function projectDatasetteRow(row, columns, projection) {
  if (!Array.isArray(row) || row.length !== columns.length) throw fault('DATASETTE_ROW_WIDTH_CHANGED');
  return Object.fromEntries(Object.entries(projection).map(([alias, spec]) =>
    [alias, projectValue(row[columns.indexOf(spec.column)], spec, alias)]));
}

function reviewRows(selected, { key = [], projection } = {}) {
  if (!Array.isArray(key) || key.some(name => typeof name !== 'string' || !selected.columns.includes(name)) ||
      new Set(key).size !== key.length) throw fault('DATASETTE_KEY_COLUMNS_INVALID');
  const profiles = selected.columns.map(name => ({ name,
    types: { integer: 0, number: 0, string: 0, boolean: 0, object: 0, array: 0, null: 0 },
    nullCount: 0, emptyStringCount: 0, labelledCount: 0, unsafeIntegerCount: 0,
    nonRoundtripNumberCount: 0, min: null, max: null }));
  const keys = new Map(), duplicates = [];
  let missingRows = 0, blankRows = 0, duplicateRows = 0;
  const keyIndices = key.map(name => selected.columns.indexOf(name));
  for (let ordinal = 0; ordinal < selected.rows.length; ordinal++) {
    const row = selected.rows[ordinal];
    row.forEach((value, index) => {
      const profile = profiles[index], kind = nativeKind(value);
      if (!Object.hasOwn(profile.types, kind)) throw fault('DATASETTE_NATIVE_VALUE_INVALID');
      profile.types[kind]++;
      if (value === null) profile.nullCount++;
      if (value === '') profile.emptyStringCount++;
      if (labelled(value)) profile.labelledCount++;
      if (isJsonNumber(value)) {
        if (kind === 'integer' && !isSafeIntegerToken(value.token)) profile.unsafeIntegerCount++;
        if (!hasLosslessNumberRoundtrip(value.token)) profile.nonRoundtripNumberCount++;
        if (profile.min === null || compareExactNumbers(value.token, profile.min) < 0) profile.min = value.token;
        if (profile.max === null || compareExactNumbers(value.token, profile.max) > 0) profile.max = value.token;
      }
    });
    if (key.length) {
      const values = keyIndices.map(index => labelled(row[index]) ? row[index].value : row[index]);
      if (values.some(value => value === null)) { missingRows++; continue; }
      if (values.some(value => value === '')) { blankRows++; continue; }
      if (values.some(value => object(value) && !isJsonNumber(value) || Array.isArray(value)))
        throw fault('DATASETTE_KEY_REQUIRES_SCALAR', key.join(', '));
      const encoded = JSON.stringify(values.map(value => sourceCellIdentity(value, { numericValue: true })));
      if (keys.has(encoded)) {
        duplicateRows++;
        duplicates.push({ firstRow: keys.get(encoded), row: ordinal + 1, values: values.map(displayed) });
      } else keys.set(encoded, ordinal + 1);
    }
  }
  const suggested = {}, used = new Set();
  profiles.forEach((profile, index) => {
    const observed = Object.entries(profile.types).filter(([kind, count]) => kind !== 'null' && count).map(([kind]) => kind);
    let type = 'string', representation = 'native', nullable = profile.nullCount > 0;
    if (observed.length && observed.every(kind => ['integer', 'number'].includes(kind)) &&
        !profile.unsafeIntegerCount && !profile.nonRoundtripNumberCount)
      type = observed.includes('number') ? 'number' : 'integer';
    else if (observed.length === 1 && observed[0] === 'boolean') type = 'boolean';
    if (observed.some(kind => ['object', 'array'].includes(kind)) || (nullable && profile.emptyStringCount) ||
        (observed.length > 1 && !observed.every(kind => ['integer', 'number'].includes(kind)))) {
      type = 'string'; representation = 'json'; nullable = false;
    }
    profile.suggestedType = type; profile.suggestedNullable = nullable; profile.suggestedRepresentation = representation;
    suggested[aliasFor(profile.name, index, used)] = { column: profile.name, type, nullable, representation };
  });
  const reviewed = projection === undefined ? null : normalizedProjection(selected.columns, projection);
  if (reviewed) for (const row of selected.rows) projectDatasetteRow(row, selected.columns, reviewed);
  const result = { schema: REVIEW, captureSha256: selected.captureSha256,
    rowCount: selected.rows.length, pageCount: selected.pages.length, sourceColumns: selected.columns,
    columns: profiles, key: { columns: key, unique: key.length > 0 && !missingRows && !blankRows && !duplicateRows,
      missingRows, blankRows, duplicateRows, duplicates, distinctValues: keys.size,
      stability: key.some(name => /^(?:rowid|_rowid_|oid)$/i.test(name)) ? 'database-locator' :
        key.length ? 'reviewed-candidate-key' : 'no-key',
      note: key.some(name => /^(?:rowid|_rowid_|oid)$/i.test(name)) ?
        'A Datasette rowid locates a row in this database edition; it is not a stable business key across editions.' : null },
    suggestedProjection: suggested, projection: reviewed,
    columnTypes: reviewed ? Object.entries(reviewed).map(([name, spec]) => ({
      name, type: spec.type, nullable: spec.nullable, sourceColumn: spec.column, representation: spec.representation })) : [],
    approved: reviewed !== null, consistency: selected.capture.consistency };
  result.digest = identity(result);
  return result;
}
export async function reviewDatasetteCapture(captureFile, options = {}) {
  return reviewRows(await readDatasetteCapture(captureFile), options);
}

async function immutable(directory, file, content) {
  const target = join(directory, datasetteMember(file)), parent = dirname(target);
  await privateDirectory(parent, true);
  const receipt = { file, sha256: digest(content), bytes: content.length };
  if (await exists(target)) {
    if (!(await readPrivate(target, Math.max(content.length, MAX_META))).equals(content))
      throw fault('DATASETTE_EDITION_IMMUTABLE_CONFLICT', file);
    return receipt;
  }
  const temporary = join(parent, '.pending-' + randomUUID());
  try {
    await createFile(temporary, content);
    if (await exists(target)) {
      if (!(await readPrivate(target, Math.max(content.length, MAX_META))).equals(content))
        throw fault('DATASETTE_EDITION_IMMUTABLE_CONFLICT', file);
    } else await rename(temporary, target);
    await syncDirectory(parent);
  } finally { try { await unlink(temporary); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; } }
  return receipt;
}

export async function createDatasetteEdition({ captureFile, directory, name, review, operationId }) {
  directory = resolve(directory); captureFile = resolve(captureFile);
  if (typeof name !== 'string' || !name.trim() || name.length > 128 ||
      typeof operationId !== 'string' || !operationId || operationId.length > 256) throw fault('DATASETTE_EDITION_NAME_OR_OPERATION_REQUIRED');
  if (!object(review) || review.schema !== REVIEW || review.approved !== true)
    throw fault('DATASETTE_EXPLICIT_PROJECTION_REVIEW_REQUIRED');
  const selected = await readDatasetteCapture(captureFile, { expectedSha256: review.captureSha256 });
  const reviewed = reviewRows(selected, { key: review.key?.columns ?? [], projection: review.projection });
  if (!same(reviewed, review)) throw fault('DATASETTE_REVIEW_CHANGED');
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    if (await exists(join(directory, 'edition.json'))) {
      const retained = await readDatasetteEdition(join(directory, 'edition.json'));
      if (retained.edition.operationId !== operationId || retained.edition.name !== name.trim() ||
          retained.captureSha256 !== selected.captureSha256 || retained.edition.reviewDigest !== reviewed.digest)
        throw fault('DATASETTE_EDITION_OPERATION_CONFLICT');
      return retained;
    }
    const operationFile = await immutable(directory, 'edition-operation.json', bytes({ schema: 'stellar-forge.datasette-edition-operation.v1',
      operationId, name: name.trim(), captureSha256: selected.captureSha256, reviewDigest: reviewed.digest }));
    const retained = await retainDatasetteCapture(captureFile, join(directory, 'capture'), selected.captureSha256);
    const reviewBytes = bytes(reviewed); await immutable(directory, 'review.json', reviewBytes);
    const edition = { schema: EDITION, state: 'REVIEWED', operationId, name: name.trim(), createdAt: stamp(),
      captureFile: 'capture/capture.json', captureSha256: retained.captureSha256,
      reviewFile: 'review.json', reviewSha256: digest(reviewBytes), reviewDigest: reviewed.digest,
      rowCount: retained.rows.length, pageCount: retained.pages.length, columns: retained.columns,
      sourceSelectionHash: retained.capture.selectionHash,
      sourceKey: reviewed.key, projection: reviewed.projection, columnTypes: reviewed.columnTypes,
      consistency: retained.capture.consistency, sourceMetadata: retained.capture.selection.metadata ?? null,
      files: [operationFile, { file: 'capture/capture.json', sha256: retained.captureSha256,
        bytes: (await readPrivate(retained.captureFile, MAX_META)).length },
        ...retained.capture.files.map(file => ({ ...file, file: 'capture/' + file.file })),
        { file: 'review.json', sha256: digest(reviewBytes), bytes: reviewBytes.length }] };
    const content = bytes(edition); await immutable(directory, 'edition.json', content);
    return { editionFile: join(directory, 'edition.json'), editionSha256: digest(content), edition, review: reviewed,
      ...retained };
  } finally { await release(); }
}

export async function readDatasetteEdition(editionFile, { expectedSha256 } = {}) {
  editionFile = resolve(editionFile);
  const directory = dirname(editionFile); await privateDirectory(directory);
  const raw = await readPrivate(editionFile, MAX_META), editionSha256 = digest(raw);
  if (expectedSha256 !== undefined && expectedSha256 !== editionSha256) throw fault('DATASETTE_EDITION_CHANGED');
  const edition = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (edition.schema !== EDITION || edition.state !== 'REVIEWED' || edition.captureFile !== 'capture/capture.json' ||
      edition.reviewFile !== 'review.json' || !HASH.test(edition.captureSha256 ?? '') ||
      !HASH.test(edition.reviewSha256 ?? '') || !Array.isArray(edition.files))
    throw fault('DATASETTE_EDITION_INVALID');
  const reviewRaw = await readPrivate(join(directory, edition.reviewFile), MAX_META);
  if (digest(reviewRaw) !== edition.reviewSha256) throw fault('DATASETTE_EDITION_REVIEW_CHANGED');
  const review = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reviewRaw));
  const selected = await readDatasetteCapture(join(directory, edition.captureFile), { expectedSha256: edition.captureSha256 });
  const observed = reviewRows(selected, { key: review.key?.columns ?? [], projection: review.projection });
  if (!same(observed, review) || !review.approved || review.digest !== edition.reviewDigest ||
      edition.rowCount !== selected.rows.length || edition.pageCount !== selected.pages.length ||
      !same(edition.columns, selected.columns) || !same(edition.projection, review.projection) ||
      !same(edition.columnTypes, review.columnTypes) || !same(edition.sourceKey, review.key) ||
      !same(edition.consistency, selected.capture.consistency) ||
      edition.sourceSelectionHash !== selected.capture.selectionHash)
    throw fault('DATASETTE_EDITION_BINDING_CHANGED');
  const operationRaw = await readPrivate(join(directory, 'edition-operation.json'), MAX_META);
  const operation = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(operationRaw));
  if (operation.schema !== 'stellar-forge.datasette-edition-operation.v1' ||
      operation.operationId !== edition.operationId || operation.name !== edition.name ||
      operation.captureSha256 !== selected.captureSha256 || operation.reviewDigest !== review.digest ||
      !same(edition.sourceMetadata, selected.capture.selection.metadata ?? null))
    throw fault('DATASETTE_EDITION_OPERATION_CHANGED');
  const expectedFiles = [
    { file: 'edition-operation.json', sha256: digest(operationRaw), bytes: operationRaw.length },
    { file: 'capture/capture.json', sha256: selected.captureSha256,
      bytes: (await readPrivate(selected.captureFile, MAX_META)).length },
    ...selected.capture.files.map(file => ({ ...file, file: 'capture/' + file.file })),
    { file: 'review.json', sha256: digest(reviewRaw), bytes: reviewRaw.length },
  ];
  if (!same(edition.files, expectedFiles)) throw fault('DATASETTE_EDITION_FILES_CHANGED');
  return { editionFile, editionSha256, edition, review, ...selected };
}

export async function listDatasetteEditions(directory) {
  directory = resolve(directory); await privateDirectory(directory);
  const paths = [];
  if (await exists(join(directory, 'edition.json'))) paths.push(join(directory, 'edition.json'));
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(join(directory, entry.name, 'edition.json')))
      paths.push(join(directory, entry.name, 'edition.json'));
  const results = [];
  for (const path of paths) {
    const value = await readDatasetteEdition(path);
    results.push({ editionFile: value.editionFile, editionSha256: value.editionSha256,
      name: value.edition.name, createdAt: value.edition.createdAt, operationId: value.edition.operationId,
      captureSha256: value.captureSha256, rowCount: value.rows.length, pageCount: value.pages.length });
  }
  return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.editionFile.localeCompare(b.editionFile));
}

function selectionScope(selection) {
  const url = new URL(selection.url); url.searchParams.delete('_next');
  return { url: url.href, kind: selection.kind, database: selection.database ?? null,
    table: selection.table ?? null, query: selection.query ?? null, account: selection.account ?? null,
    authentication: selection.authentication ?? null };
}
function compareRows(left, right, key) {
  const alignedColumns = left.columns.filter(name => right.columns.includes(name));
  const rowKey = (row, columns) => JSON.stringify(key.map(name => {
    let value = row[columns.indexOf(name)]; if (labelled(value)) value = value.value;
    return sourceCellIdentity(value, { numericValue: true });
  }));
  const output = { added: [], removed: [], changed: [], unchangedRows: 0 };
  if (key.length) {
    const old = new Map(left.rows.map((row, ordinal) => [rowKey(row, left.columns), { row, ordinal }]));
    const fresh = new Map(right.rows.map((row, ordinal) => [rowKey(row, right.columns), { row, ordinal }]));
    for (const [encoded, item] of old) {
      const next = fresh.get(encoded);
      const values = key.map(name => displayed(item.row[left.columns.indexOf(name)]));
      if (!next) {
        output.removed.push({ row: item.ordinal + 1, key: values }); continue;
      }
      const fields = alignedColumns.flatMap(column => {
        const before = item.row[left.columns.indexOf(column)], after = next.row[right.columns.indexOf(column)];
        return sourceCellIdentity(before) === sourceCellIdentity(after) ? [] : [{ column, before: displayed(before), after: displayed(after) }];
      });
      if (fields.length) output.changed.push({ key: values, beforeRow: item.ordinal + 1, afterRow: next.ordinal + 1, fields });
      else output.unchangedRows++;
    }
    for (const [encoded, item] of fresh)
      if (!old.has(encoded)) output.added.push({ row: item.ordinal + 1,
        key: key.map(name => displayed(item.row[right.columns.indexOf(name)])) });
    return output;
  }
  // Without a reviewed cross-edition key, compare the complete row multiset.
  // A database locator is deliberately never used to assert business identity.
  const canonical = (row, columns) => JSON.stringify(columns.map((name, index) =>
    [name, sourceCellIdentity(row[index])]).sort(([a], [b]) => a.localeCompare(b)));
  const old = new Map();
  left.rows.forEach((row, ordinal) => {
    const encoded = canonical(row, left.columns);
    if (!old.has(encoded)) old.set(encoded, []);
    old.get(encoded).push(ordinal + 1);
  });
  right.rows.forEach((row, ordinal) => {
    const encoded = canonical(row, right.columns), prior = old.get(encoded);
    if (prior?.length) { prior.pop(); output.unchangedRows++; }
    else output.added.push({ row: ordinal + 1 });
  });
  for (const ordinals of old.values()) for (const ordinal of ordinals) output.removed.push({ row: ordinal });
  return output;
}
export async function compareDatasetteEditions(beforeFile, afterFile) {
  const before = await readDatasetteEdition(beforeFile), after = await readDatasetteEdition(afterFile);
  const keyCompatible = before.review.key.unique && after.review.key.unique &&
    before.review.key.stability !== 'database-locator' && after.review.key.stability !== 'database-locator' &&
    same(before.review.key.columns, after.review.key.columns);
  const key = keyCompatible ? before.review.key.columns : [];
  const changes = compareRows(before, after, key);
  const addedColumns = after.columns.filter(name => !before.columns.includes(name));
  const removedColumns = before.columns.filter(name => !after.columns.includes(name));
  const schemaChanged = !same(before.columns, after.columns);
  const selectionChanged = !same(selectionScope(before.capture.selection), selectionScope(after.capture.selection));
  const projectionChanged = !same(before.review.projection, after.review.projection);
  const sourceVersionChanged = !same(before.capture.sourceVersion, after.capture.sourceVersion);
  const result = { schema: 'stellar-forge.datasette-edition-comparison.v1', before: before.editionSha256,
    after: after.editionSha256, beforeCaptureSha256: before.captureSha256, afterCaptureSha256: after.captureSha256,
    beforeName: before.edition.name, afterName: after.edition.name,
    comparison: key.length ? 'reviewed-source-key' : 'complete-source-row-multiset', key,
    beforeRows: before.rows.length, afterRows: after.rows.length, addedRows: changes.added.length,
    removedRows: changes.removed.length, changedRows: changes.changed.length, unchangedRows: changes.unchangedRows,
    sourceValuesUnchanged: !schemaChanged && !changes.added.length && !changes.removed.length && !changes.changed.length,
    httpBodiesUnchanged: same(before.pages.map(page => page.body.sha256), after.pages.map(page => page.body.sha256)),
    schemaChanged, addedColumns, removedColumns, selectionChanged, projectionChanged, sourceVersionChanged,
    sourceMetadataChanged: !same(before.capture.selection.metadata ?? null, after.capture.selection.metadata ?? null),
    keyChanged: !same(before.review.key.columns, after.review.key.columns),
    orderChanged: !same(before.rows.map(row => identity(row.map(sourceCellIdentity))),
      after.rows.map(row => identity(row.map(sourceCellIdentity)))),
    requiresReview: schemaChanged || selectionChanged || projectionChanged || sourceVersionChanged ||
      !same(before.review.key.columns, after.review.key.columns),
    observationWindows: { before: before.capture.consistency, after: after.capture.consistency },
    ...changes };
  result.digest = identity(result);
  return result;
}

async function sourcePackageEntries(selected) {
  const directory = dirname(selected.editionFile), names = [
    'edition.json', 'edition-operation.json', ...selected.edition.files.map(file => file.file),
  ];
  const entries = [];
  for (const file of [...new Set(names)]) {
    const content = await readPrivate(join(directory, datasetteMember(file)), MAX_FILE);
    entries.push({ file, sha256: digest(content), bytes: content.length, base64: content.toString('base64') });
  }
  return entries;
}
export async function exportDatasetteEdition({ editionFile, outputFile }) {
  const selected = await readDatasetteEdition(editionFile);
  outputFile = resolve(outputFile ?? join(dirname(selected.editionFile), 'edition.datasette.json.gz'));
  await privateDirectory(dirname(outputFile), true);
  const files = await sourcePackageEntries(selected);
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  if (files.length > 20000 || totalBytes > MAX_PACKAGE / 2) throw fault('DATASETTE_PACKAGE_LIMIT_EXCEEDED');
  const manifest = { schema: PACKAGE, encoding: 'gzip-json-base64', editionFile: 'edition.json',
    editionSha256: selected.editionSha256, captureSha256: selected.captureSha256,
    files, totalBytes };
  // The portable source package has no execution hooks. The native merchant's
  // existing release store continues to own publication, offers and acquisition.
  const content = gzipSync(bytes(manifest), { level: 6, mtime: 0 });
  if (content.length > MAX_PACKAGE) throw fault('DATASETTE_PACKAGE_LIMIT_EXCEEDED');
  const temporary = join(dirname(outputFile), '.pending-export-' + randomUUID());
  let reused = false;
  try {
    await createFile(temporary, content);
    try { await link(temporary, outputFile); }
    catch (issue) {
      if (issue.code !== 'EEXIST') throw issue;
      reused = true;
    }
  } finally {
    try { await unlink(temporary); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  }
  if (reused && !(await readPrivate(outputFile, MAX_PACKAGE)).equals(content))
    throw fault('DATASETTE_PACKAGE_OUTPUT_CONFLICT');
  await syncDirectory(dirname(outputFile));
  return { archiveFile: outputFile, file: outputFile, sha256: digest(content), bytes: content.length,
    editionSha256: selected.editionSha256, captureSha256: selected.captureSha256,
    files: files.length, totalBytes, format: 'stellar-forge-datasette-source-package', reused };
}
async function verifyReceived(directory, manifest, members) {
  await privateDirectory(directory);
  for (const member of members) {
    const actual = await readPrivate(join(directory, member.file), MAX_FILE);
    if (actual.length !== member.bytes || digest(actual) !== member.sha256)
      throw fault('DATASETTE_RECEIVE_DIRECTORY_CONFLICT', member.file);
  }
  const selected = await readDatasetteEdition(join(directory, 'edition.json'), { expectedSha256: manifest.editionSha256 });
  if (selected.captureSha256 !== manifest.captureSha256) throw fault('DATASETTE_PACKAGE_CAPTURE_CHANGED');
  const expected = new Set(['edition.json', 'edition-operation.json', ...selected.edition.files.map(file => file.file)]);
  if (members.length !== expected.size || members.some(member => !expected.has(member.file)))
    throw fault('DATASETTE_PACKAGE_MEMBERS_CHANGED');
  const operation = await readJson(join(directory, 'edition-operation.json'), MAX_META);
  if (operation.operationId !== selected.edition.operationId || operation.name !== selected.edition.name ||
      operation.captureSha256 !== selected.captureSha256 || operation.reviewDigest !== selected.review.digest)
    throw fault('DATASETTE_PACKAGE_OPERATION_CHANGED');
  return selected;
}
export async function receiveDatasettePackage({ archiveFile, directory, sha256 }) {
  archiveFile = resolve(archiveFile); directory = resolve(directory);
  if (!HASH.test(sha256 ?? '')) throw fault('DATASETTE_PACKAGE_HASH_REQUIRED');
  const compressed = await readPrivate(archiveFile, MAX_PACKAGE);
  if (digest(compressed) !== sha256) throw fault('DATASETTE_PACKAGE_HASH_MISMATCH');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    gunzipSync(compressed, { maxOutputLength: MAX_PACKAGE }))); }
  catch { throw fault('DATASETTE_PACKAGE_INVALID'); }
  if (!object(manifest) || manifest.schema !== PACKAGE || manifest.encoding !== 'gzip-json-base64' || manifest.editionFile !== 'edition.json' ||
      !HASH.test(manifest.editionSha256 ?? '') || !HASH.test(manifest.captureSha256 ?? '') ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 20000)
    throw fault('DATASETTE_PACKAGE_INVALID');
  const names = new Set(), members = []; let total = 0;
  for (const item of manifest.files) {
    if (!object(item)) throw fault('DATASETTE_PACKAGE_MEMBER_INVALID');
    const name = datasetteMember(item.file);
    if (names.has(name) || !HASH.test(item.sha256 ?? '') || !Number.isSafeInteger(item.bytes) ||
        item.bytes < 0 || item.bytes > MAX_FILE || typeof item.base64 !== 'string' ||
        (item.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)))
      throw fault('DATASETTE_PACKAGE_MEMBER_INVALID');
    names.add(name);
    const content = Buffer.from(item.base64, 'base64');
    if (content.length !== item.bytes || digest(content) !== item.sha256 ||
        content.toString('base64') !== item.base64) throw fault('DATASETTE_PACKAGE_MEMBER_CHANGED', name);
    total += content.length;
    if (total > MAX_PACKAGE / 2) throw fault('DATASETTE_PACKAGE_LIMIT_EXCEEDED');
    members.push({ file: name, bytes: item.bytes, sha256: item.sha256, content });
  }
  if (total !== manifest.totalBytes) throw fault('DATASETTE_PACKAGE_BYTE_COUNT_CHANGED');
  const result = (selected, reused) => ({ directory, archiveSha256: sha256, files: names.size, ...selected, reused });
  // A completed receive is its own operation receipt: every retained member and
  // the edition's full source/review bindings must match the verified archive.
  if (await exists(directory)) return result(await verifyReceived(directory, manifest, members), true);
  const parent = dirname(directory); await privateDirectory(parent, true);
  const temporary = join(parent, '.datasette-receive-' + randomUUID());
  await privateDirectory(temporary, true);
  try {
    for (const member of members) await immutable(temporary, member.file, member.content);
    await verifyReceived(temporary, manifest, members);
    await syncDirectory(temporary);
    if (await exists(directory)) return result(await verifyReceived(directory, manifest, members), true);
    try { await rename(temporary, directory); }
    catch (issue) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(issue.code)) throw issue;
      return result(await verifyReceived(directory, manifest, members), true);
    }
    await syncDirectory(parent);
    return result(await verifyReceived(directory, manifest, members), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
