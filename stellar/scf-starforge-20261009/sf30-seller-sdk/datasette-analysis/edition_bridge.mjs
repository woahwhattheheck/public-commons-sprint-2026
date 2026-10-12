// MIT. Read the original reviewed Datasette edition into customer Analysis.
// This module only reads the sibling source edition; its publisher owns capture.
import { dirname, isAbsolute, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readDatasetteEdition, projectDatasetteRow } from '../datasette/editions.mjs';
import { datasetteMember } from '../datasette/capture.mjs';
import { nativeKind } from '../datasette/json.mjs';
import { readPrivate, digest } from '../postgres/publisher/files.mjs';

export const BRIDGE_SCHEMA = 'stellar-forge.datasette-analysis-native-edition.v1';
const HASH = /^[a-f0-9]{64}$/;
const LOCATOR = /^(?:rowid|_rowid_|oid)$/i;
const MAX_OUTPUT = 64 * 1024 * 1024;
const MAX_INPUT = 65536;

function required(condition, code, detail = '') {
  if (!condition) {
    const error = new Error(code + (detail ? ': ' + detail : ''));
    error.code = code;
    throw error;
  }
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function labelObject(value) {
  return object(value) && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'label');
}
function projectedKind(value, spec) {
  if (spec.representation === 'json') return 'string';
  if (spec.representation === 'label') return nativeKind(value.label);
  return nativeKind(labelObject(value) ? value.value : value);
}
function sourceDescription(selected) {
  const capture = selected.capture, selection = capture.selection;
  const metadata = object(selected.edition.sourceMetadata) ? selected.edition.sourceMetadata : {};
  const text = (...values) => values.find(value => typeof value === 'string' && value.trim()) ?? null;
  const started = text(capture.startedAt);
  return {
    url: selection.url, database: selection.database ?? null, table: selection.table ?? null,
    query: selection.query ?? null, selection,
    title: text(metadata.title, selected.edition.name) ?? 'Datasette edition',
    publisher: text(metadata.publisher, metadata.source) ?? 'Datasette publisher',
    license: metadata.license ?? null,
    license_url: metadata.license_url ?? metadata.licenseUrl ?? null,
    publisher_metadata: metadata,
    captured_at: started ?? capture.committedAt,
    capture_time_basis: started ? 'native-retrieval-window' : 'native-capture-commit',
    capture_window: { started_at: capture.startedAt ?? null, completed_at: capture.completedAt ?? null },
    observation_end: capture.completedAt ?? null,
    capture_committed_at: capture.committedAt,
    source_mode: 'native-edition',
    edition_sha256: selected.editionSha256,
    capture_sha256: selected.captureSha256,
    review_sha256: selected.edition.reviewSha256,
    review_digest: selected.review.digest,
    source_selection_hash: capture.selectionHash,
    source_version: capture.sourceVersion ?? null,
    consistency: capture.consistency,
    source_columns: selected.columns,
    row_count: selected.rows.length, page_count: selected.pages.length,
    pages: selected.pages,
  };
}

export async function readNativeDatasetteEdition(input) {
  required(object(input) && Object.keys(input).every(key => ['edition', 'sha256'].includes(key)),
    'DATASETTE_NATIVE_EDITION_INPUT_INVALID');
  required(typeof input.edition === 'string' && isAbsolute(input.edition) &&
    !input.edition.includes('\0') && resolve(input.edition) === input.edition,
    'DATASETTE_ABSOLUTE_EDITION_REQUIRED');
  required(typeof input.sha256 === 'string' && HASH.test(input.sha256),
    'DATASETTE_NATIVE_EDITION_SHA256_REQUIRED');
  required(await realpath(input.edition) === input.edition, 'DATASETTE_CANONICAL_EDITION_REQUIRED');

  // The original reader reopens every declared source member and reconstructs
  // the complete original review. No alternate capture or projection is made.
  const selected = await readDatasetteEdition(input.edition, { expectedSha256: input.sha256 });
  const projection = selected.review.projection;
  required(object(projection) && selected.review.approved === true,
    'DATASETTE_REVIEWED_PROJECTION_REQUIRED');
  const entries = Object.entries(projection), columns = entries.map(([alias]) => alias);
  required(columns.length > 0 && columns.length <= 63,
    'DATASETTE_ANALYSIS_COLUMN_CAPACITY', 'The reviewed Analysis selection supports 1 to 63 columns.');

  const sourceColumnAliases = Object.fromEntries(selected.columns.map(column => [column, []]));
  const aliasMapping = entries.map(([alias, spec]) => {
    sourceColumnAliases[spec.column].push(alias);
    return { alias, column: spec.column, source_index: selected.columns.indexOf(spec.column),
      representation: spec.representation ?? 'native', type: spec.type, nullable: spec.nullable };
  });
  // Multiple projections of one source field remain distinct columns. The
  // semantic map is explicit and only selects an unambiguous native projection,
  // its same-named native projection, or a sole declared projection.
  const semanticAliases = {}, ambiguousSourceColumns = [];
  for (const column of selected.columns) {
    const choices = aliasMapping.filter(item => item.column === column);
    const native = choices.filter(item => item.representation === 'native');
    const chosen = native.length === 1 ? native[0] :
      native.find(item => item.alias === column) ?? (choices.length === 1 ? choices[0] : null);
    if (chosen) semanticAliases[column] = chosen.alias;
    else if (choices.length) ambiguousSourceColumns.push(column);
  }

  const rows = [], kinds = [], sourceKinds = [];
  for (const row of selected.rows) {
    rows.push(projectDatasetteRow(row, selected.columns, projection));
    kinds.push(Object.fromEntries(aliasMapping.map(item => [
      item.alias, projectedKind(row[item.source_index], projection[item.alias]),
    ])));
    sourceKinds.push(row.map(nativeKind));
  }
  const sourceKey = selected.review.key;
  const keyMapping = (sourceKey.columns ?? []).map(column => {
    const projected = aliasMapping.filter(item => item.column === column);
    const semantic = projected.find(item => item.alias === semanticAliases[column] &&
      item.representation === 'native');
    return { column, projected_aliases: projected.map(item => item.alias),
      native_aliases: projected.filter(item => item.representation === 'native').map(item => item.alias),
      selected_alias: semantic?.alias ?? null, database_locator: LOCATOR.test(column) };
  });
  const keyComplete = keyMapping.length > 0 && keyMapping.every(item => item.selected_alias !== null);
  const keyAliases = keyComplete ? keyMapping.map(item => item.selected_alias) : [];
  const keyEligible = keyComplete && new Set(keyAliases).size === keyAliases.length &&
    sourceKey.unique === true && sourceKey.stability !== 'database-locator' &&
    !keyMapping.some(item => item.database_locator);
  const localLocatorAliases = aliasMapping.filter(item => LOCATOR.test(item.column)).map(item => item.alias);
  const nativeKey = {
    review: sourceKey, mapping: keyMapping, projection_complete: keyComplete,
    projected_aliases: keyAliases, business_key_eligible: keyEligible,
    recommended_source_columns: keyEligible ? [...sourceKey.columns] : [],
    recommended_projected_aliases: keyEligible ? keyAliases : [],
    local_locator_aliases: localLocatorAliases,
  };

  const root = dirname(selected.editionFile);
  const editionRaw = await readPrivate(selected.editionFile, 16 * 1024 * 1024);
  required(digest(editionRaw) === selected.editionSha256, 'DATASETTE_NATIVE_EDITION_CHANGED');
  const bodyNames = new Set(selected.pages.map(page => 'capture/' + page.body.file));
  const files = [{ file: 'edition.json', absolute_path: selected.editionFile,
    bytes: editionRaw.length, sha256: selected.editionSha256,
    content_type: 'application/json', role: 'original-native-edition' }];
  const seen = new Set(['edition.json']);
  for (const descriptor of selected.edition.files) {
    const file = datasetteMember(descriptor.file);
    required(!seen.has(file), 'DATASETTE_NATIVE_EDITION_MEMBER_DUPLICATE', file);
    seen.add(file);
    const rawBody = bodyNames.has(file);
    const role = file === 'capture/capture.json' ? 'original-native-capture' :
      file === 'review.json' ? 'original-native-projection-and-key-review' :
      rawBody ? 'original-native-response-body' : 'original-native-source-member';
    files.push({ file, absolute_path: resolve(root, file),
      bytes: descriptor.bytes, sha256: descriptor.sha256,
      content_type: file.endsWith('.json') || rawBody ? 'application/json' : 'application/octet-stream',
      role });
  }
  return {
    schema: BRIDGE_SCHEMA, edition_file: selected.editionFile, edition_root: root,
    edition_sha256: selected.editionSha256, capture_sha256: selected.captureSha256,
    review_sha256: selected.edition.reviewSha256,
    projection_mode: 'reviewed', projection,
    source: sourceDescription(selected),
    source_columns: selected.columns, columns, rows, kinds, source_kinds: sourceKinds,
    alias_mapping: aliasMapping, source_column_aliases: sourceColumnAliases,
    semantic_aliases: semanticAliases,
    semantic_alias_rule: 'unique-native-or-same-named-native-or-sole-declared-projection',
    ambiguous_source_columns: ambiguousSourceColumns,
    reviewed_key: nativeKey, files,
    edition: selected.edition, review: selected.review, capture: selected.capture,
  };
}

async function main() {
  try {
    required(process.argv.length === 2, 'DATASETTE_NATIVE_BRIDGE_STDIN_REQUIRED',
      'Pass one JSON object with edition and sha256 on standard input.');
    const parts = []; let size = 0;
    for await (const part of process.stdin) {
      size += part.length;
      required(size <= MAX_INPUT, 'DATASETTE_NATIVE_BRIDGE_INPUT_CAPACITY');
      parts.push(part);
    }
    let input;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
    catch { required(false, 'DATASETTE_NATIVE_BRIDGE_JSON_INVALID'); }
    const result = await readNativeDatasetteEdition(input);
    const output = JSON.stringify(result) + '\n';
    required(Buffer.byteLength(output, 'utf8') <= MAX_OUTPUT, 'DATASETTE_NATIVE_BRIDGE_OUTPUT_CAPACITY');
    await new Promise((accept, reject) => process.stdout.write(output, error => error ? reject(error) : accept()));
  } catch (error) {
    process.stderr.write(JSON.stringify({ schema: BRIDGE_SCHEMA,
      error: error.code ?? 'DATASETTE_NATIVE_BRIDGE_FAILED', message: String(error.message ?? error) }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
