// MIT. Published Coin Metrics semantics and explicit operator source selections.
import { WorkspaceError, operationId, revisionNumber, sha256, json } from '../workspace/store.mjs';

export const INPUT_SCHEMA = 'stellar-forge.coinmetrics-cloud-input.v1';
export const WORKSPACE_SCHEMA = 'stellar-forge.coinmetrics-cloud-workspace.v1';
export const DELIVERY_SCHEMA = 'stellar-forge.coinmetrics-cloud-handover.v1';
export const LIMITS = Object.freeze({ files: 4096, fileBytes: 2147483648, totalBytes: 8589934592,
  manifestBytes: 2097152, jsonBytes: 33554432, rows: 1000000, columns: 256, outputBytes: 2147483648 });
export const FAMILIES = Object.freeze(['market_trades', 'market_candles', 'market_quotes',
  'market_orderbooks_snapshots', 'market_orderbooks_updates', 'reference_rates',
  'reference_data_markets', 'reference_data_assets', 'reference_data_exchanges', 'reference_data_pairs']);
export const CATALOGS = Object.freeze(FAMILIES.filter(value => value.startsWith('reference_data_')));
export const CONTRACTS = Object.freeze({
  families: FAMILIES, catalogFamilies: CATALOGS,
  cloudOmissions: {
    market_trades: ['mark_price', 'index_price', 'iv_trade', 'liquidation'],
    reference_data_markets: ['pool_config_id', 'fee', 'price_includes_fee', 'variable_fee',
      'base_address', 'quote_address', 'multiplier_size'],
  },
  notes: [
    'The four reference catalogs are current snapshots overwritten daily. Every retained edition keeps its own original bytes and observation time.',
    'dt names the previous UTC data day. Published job times are start times, not completion guarantees.',
    'List every page of each selected prefix. Object names are opaque; partition exchange labels can differ from native exchange IDs.',
    'Cloud Parquet has native numeric types and UTC nanosecond timestamps; API values can be strings. Comparison keeps those types and explicit precision choices.',
    'Candle time is interval start. Retained rows and selected cadence are shown as supplied; missing intervals are never synthesized.',
    'Cloud, API and Snowflake entitlements are distinct. Retention and permitted delivery remain the operator’s source-specific choices.',
    'This application does not request requester-pays data. Import already permitted exports or use an explicitly supplied non-requester-pays source client.',
  ],
  sources: [
    'https://docs.coinmetrics.io/access-our-data/cloud-delivery',
    'https://docs.coinmetrics.io/access-our-data/cloud-delivery/amazon-s3',
    'https://docs.coinmetrics.io/access-our-data/cloud-delivery/snowflake',
    'https://gitbook-docs.coinmetrics.io/market-data/market-data-overview/market-candles',
    'https://docs.snowflake.com/en/developer-guide/sql-api/handling-responses',
  ],
});

export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const issue = (code, message = code, status = 422) => new WorkspaceError(code, status, message);
export const canonical = value => JSON.stringify(value, (_key, item) => plain(item) ?
  Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const identity = value => sha256(canonical(value));
export function text(value, maximum = 4096, label = 'text', allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw issue('CLOUD_TEXT_INVALID', 'Invalid ' + label + '.');
  return value;
}
export function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value))
    throw issue('CLOUD_IDENTIFIER_INVALID');
  return value;
}
export function digest(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw issue('CLOUD_SHA256_REQUIRED');
  return value;
}
export function byteCount(value, maximum = LIMITS.fileBytes) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) value = String(value);
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > BigInt(maximum))
    throw issue('CLOUD_FILE_SIZE_INVALID');
  return value;
}
export function relativePath(value) {
  text(value, 2048, 'relative source filename');
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some(piece => !piece || ['.', '..'].includes(piece)) ||
      /^[A-Za-z]:/.test(value)) throw issue('CLOUD_RELATIVE_PATH_REQUIRED');
  return value;
}
export function timestamp(value) {
  text(value, 80, 'timezone-aware timestamp');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value))) throw issue('CLOUD_AWARE_TIMESTAMP_REQUIRED');
  return value;
}
function safeMetadata(value, name) {
  if (value === undefined) return {};
  if (!plain(value) || Buffer.byteLength(json(value)) > 32768) throw issue('CLOUD_METADATA_INVALID', 'Invalid ' + name + '.');
  const visit = item => {
    if (Array.isArray(item)) { for (const v of item) visit(v); return; }
    if (!plain(item)) return;
    for (const [key, v] of Object.entries(item)) {
      if (/^(?:authorization|cookie|set-cookie|apikey|api_key|access_token|refresh_token|secret_access_key|session_token|password)$/i.test(key))
        throw issue('CLOUD_CREDENTIAL_METADATA_FORBIDDEN', 'Keep credentials out of source metadata.');
      visit(v);
    }
  };
  visit(value); return structuredClone(value);
}
export function columns(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > LIMITS.columns) throw issue('CLOUD_COLUMNS_INVALID');
  const names = new Set();
  return value.map(item => {
    if (!plain(item)) throw issue('CLOUD_COLUMNS_INVALID');
    const name = text(item.name, 512, 'column name'), type = text(item.type, 256, 'original column type');
    if (names.has(name)) throw issue('CLOUD_DUPLICATE_COLUMN');
    names.add(name); return { name, type, nullable: item.nullable !== false };
  });
}
export function manifest(input) {
  if (!plain(input) || input.schema !== INPUT_SCHEMA || Buffer.byteLength(json(input)) > LIMITS.manifestBytes)
    throw issue('CLOUD_INPUT_MANIFEST_INVALID');
  if (!['retained-s3', 'retained-snowflake', 'api-export', 'local-export'].includes(input.transport))
    throw issue('CLOUD_TRANSPORT_INVALID');
  const provenance = safeMetadata(input.provenance, 'source provenance');
  text(provenance.description, 8192, 'source description');
  text(provenance.entitlement, 8192, 'permitted retention and delivery note');
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > LIMITS.files)
    throw issue('CLOUD_FILES_REQUIRED');
  const ids = new Set(), paths = new Set(); let total = 0n;
  const files = input.files.map(item => {
    if (!plain(item)) throw issue('CLOUD_FILE_INVALID');
    const id = identifier(item.id), path = relativePath(item.path), bytes = byteCount(item.bytes);
    if (ids.has(id) || paths.has(path)) throw issue('CLOUD_DUPLICATE_FILE');
    ids.add(id); paths.add(path); total += BigInt(bytes);
    if (total > BigInt(LIMITS.totalBytes)) throw issue('CLOUD_TOTAL_BYTES_LIMIT');
    if (!['parquet', 'json', 'ndjson', 'csv', 'snowflake-json'].includes(item.format) ||
        !['data', 'catalog', 'receipt'].includes(item.role) || !FAMILIES.includes(item.family))
      throw issue('CLOUD_FILE_ROLE_INVALID');
    if (CATALOGS.includes(item.family) && item.role === 'data' || !CATALOGS.includes(item.family) && item.role === 'catalog')
      throw issue('CLOUD_CATALOG_ROLE_INVALID');
    if (item.format === 'parquet' && !path.toLowerCase().endsWith('.parquet')) throw issue('CLOUD_PARQUET_EXTENSION_REQUIRED');
    const rowPath = item.rowsPath ?? (input.transport === 'api-export' && item.format === 'json' ? '/data' : '');
    if (typeof rowPath !== 'string' || rowPath.length > 2048 || rowPath && !rowPath.startsWith('/'))
      throw issue('CLOUD_JSON_POINTER_REQUIRED');
    const result = { id, path, bytes, sha256: digest(item.sha256), format: item.format, role: item.role,
      family: item.family, rowsPath: rowPath, origin: safeMetadata(item.origin, 'original file identity') };
    if (item.columns !== undefined) result.columns = columns(item.columns);
    if (item.nullToken !== undefined) {
      if (item.format !== 'csv') throw issue('CLOUD_CSV_NULL_TOKEN_INVALID');
      result.nullToken = text(item.nullToken, 128, 'explicit CSV null token');
    }
    if (item.timezone !== undefined) {
      if (item.timezone !== 'UTC') throw issue('CLOUD_EXPLICIT_UTC_REQUIRED');
      result.timezone = 'UTC';
    }
    return result;
  });
  const scope = safeMetadata(input.scope, 'selected scope');
  if (scope.start !== undefined) timestamp(scope.start);
  if (scope.end !== undefined) timestamp(scope.end);
  if ((scope.start === undefined) !== (scope.end === undefined)) throw issue('CLOUD_WINDOW_PAIR_REQUIRED');
  if (scope.start && Date.parse(scope.end) <= Date.parse(scope.start)) throw issue('CLOUD_WINDOW_ORDER_INVALID');
  for (const key of ['market', 'frequency', 'marketType', 'partitionExchange'])
    if (scope[key] !== undefined) text(scope[key], 512, key);
  const coverage = safeMetadata(input.coverage ?? { kind: 'selected-files' }, 'coverage');
  if (!['selected-files', 's3-listing', 'snowflake-query', 'api-pages'].includes(coverage.kind)) throw issue('CLOUD_COVERAGE_INVALID');
  if (!files.some(file => file.role !== 'receipt') && coverage.kind === 'selected-files') throw issue('CLOUD_DATA_FILES_REQUIRED');
  if (coverage.groups !== undefined) {
    if (!Array.isArray(coverage.groups) || coverage.groups.length > LIMITS.files) throw issue('CLOUD_COVERAGE_GROUPS_INVALID');
    for (const group of coverage.groups) {
      if (!plain(group) || !FAMILIES.includes(group.family) || !Array.isArray(group.pages) || !group.pages.length ||
          group.pages.some(id => !ids.has(id)) || new Set(group.pages).size !== group.pages.length)
        throw issue('CLOUD_COVERAGE_PAGES_INVALID');
      if (coverage.kind === 's3-listing') text(group.prefix, 2048, 'full native prefix');
    }
  } else if (coverage.kind !== 'selected-files') throw issue('CLOUD_COVERAGE_GROUPS_REQUIRED');
  return { schema: INPUT_SCHEMA, label: text(input.label, 240, 'edition label'), transport: input.transport,
    capturedAt: timestamp(input.capturedAt), provenance, scope, files, coverage };
}
function decimal(value = '0') {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,127})(?:\.[0-9]{1,128})?(?:[eE][+-]?[0-9]{1,3})?$/.test(value))
    throw issue('CLOUD_NONNEGATIVE_DECIMAL_REQUIRED');
  const exponent = Number(value.match(/[eE]([+-]?[0-9]+)$/)?.[1] ?? 0);
  if (Math.abs(exponent) > 256) throw issue('CLOUD_DECIMAL_EXPONENT_LIMIT');
  return value;
}
export function comparison(input) {
  if (!plain(input)) throw issue('CLOUD_COMPARISON_REQUIRED');
  operationId(input.operationId); revisionNumber(input.expectedRevision);
  if (!FAMILIES.includes(input.family)) throw issue('CLOUD_FAMILY_INVALID');
  const kinds = ['text', 'integer', 'decimal', 'timestamp-ns', 'boolean', 'json'];
  const pairs = (items, keys) => {
    if (!Array.isArray(items) || items.length > 128 || keys && !items.length) throw issue('CLOUD_FIELD_MAPPING_INVALID');
    const seen = new Set();
    return items.map(item => {
      if (!plain(item) || !kinds.includes(item.kind)) throw issue('CLOUD_FIELD_MAPPING_INVALID');
      const left = text(item.left, 512, 'left field'), right = text(item.right, 512, 'right field');
      if (seen.has(left + '\0' + right)) throw issue('CLOUD_DUPLICATE_FIELD_MAPPING');
      seen.add(left + '\0' + right);
      const pair = { left, right, kind: item.kind };
      if (!keys && item.kind === 'decimal') {
        pair.absoluteTolerance = decimal(item.absoluteTolerance); pair.relativeTolerance = decimal(item.relativeTolerance);
      }
      for (const side of ['left', 'right']) if (item[side + 'TimeUnit'] !== undefined) {
        if (item.kind !== 'timestamp-ns' || !['iso', 'ns', 'us', 'ms', 's'].includes(item[side + 'TimeUnit']))
          throw issue('CLOUD_TIMESTAMP_UNIT_INVALID');
        pair[side + 'TimeUnit'] = item[side + 'TimeUnit'];
      }
      return pair;
    });
  };
  const omissions = input.omissions ?? [];
  if (!Array.isArray(omissions) || omissions.length > 256) throw issue('CLOUD_OMISSIONS_INVALID');
  return { operationId: input.operationId, expectedRevision: input.expectedRevision,
    leftEditionId: identifier(input.leftEditionId), rightEditionId: identifier(input.rightEditionId),
    leftRelationId: digest(input.leftRelationId), rightRelationId: digest(input.rightRelationId),
    family: input.family, keys: pairs(input.keys, true), fields: pairs(input.fields ?? [], false),
    omissions: omissions.map(item => {
      if (!plain(item) || !['left', 'right'].includes(item.side)) throw issue('CLOUD_OMISSIONS_INVALID');
      return { side: item.side, field: text(item.field, 512, 'omitted field'), reason: text(item.reason, 4096, 'omission reason') };
    }), note: text(input.note ?? '', 8192, 'comparison note', true) };
}
