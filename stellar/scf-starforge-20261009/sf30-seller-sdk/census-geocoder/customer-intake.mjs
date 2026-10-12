// MIT. Customer records remain intact while the original Census parser owns addresses.
import { csvRecords, inputAddresses, COLUMNS, MAX_INPUT_BYTES, only } from './source.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { bytes, digest, identity, fault } from '../postgres/publisher/files.mjs';

export const CUSTOMER_SOURCE_SCHEMA = 'stellar-forge.census-customer-source.v1';
export const CUSTOMER_MAPPING_SCHEMA = 'stellar-forge.census-customer-mapping.v1';
export const CUSTOMER_BINDING_SCHEMA = 'stellar-forge.census-customer-binding.v1';
export const CUSTOMER_RESULTS_SCHEMA = 'stellar-forge.census-customer-results.v1';
const FIELDS = ['id', 'street', 'city', 'state', 'zip', 'urbanization'];
const HASH = /^[a-f0-9]{64}$/;
const suffixes = ['source_row', 'submission', 'exclusion_reason', 'selected_by_review', ...Object.keys(COLUMNS)];
const fail = (code, message) => { throw fault(code, message); };
function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    fail('GEOCODER_CUSTOMER_REASON', 'Retain a reason of 1–1,000 characters for each correction or exclusion.');
  return value;
}
const brief = (value, length = 100) => String(value).length > length ? String(value).slice(0, length) + '…' : String(value);
export function customerSource(original, { header = true } = {}) {
  if (typeof header !== 'boolean') fail('GEOCODER_CUSTOMER_HEADER', 'Choose whether the original file has a header.');
  const parsed = csvRecords(original, { maximum: MAX_INPUT_BYTES, maxRecords: 10001 });
  const headers = header ? parsed.shift() ?? [] : null;
  if (!parsed.length || parsed.length > 10000) fail('GEOCODER_RECORD_LIMIT', 'Choose 1–10,000 customer records.');
  const width = Math.max(headers?.length ?? 0, ...parsed.map(row => row.length));
  if (!width || width > 256) fail('GEOCODER_CUSTOMER_COLUMNS', 'Choose an original CSV with 1–256 columns.');
  const names = Array.from({ length: width }, (_, index) => headers ? headers[index] ?? '' : 'column_' + (index + 1));
  return { original, header, headerCells: headers, records: parsed, names, width, rowCount: parsed.length,
    inputSha256: digest(original), inputBytes: original.length,
    columns: names.map((name, index) => ({ index, label: (index + 1) + ' · ' + brief(name || '(unnamed column)', 40) })) };
}
export function customerPlan(input, source) {
  only(input, ['idMode', 'columns', 'corrections', 'exclusions', 'outputPrefix']);
  if (!['column', 'row'].includes(input.idMode)) fail('GEOCODER_CUSTOMER_ID_MODE', 'Select a source ID column or explicit stable source-row IDs.');
  only(input.columns ?? {}, FIELDS);
  const columns = Object.fromEntries(FIELDS.map(name => {
    const value = input.columns?.[name] ?? null;
    if (value !== null && (!Number.isInteger(value) || value < 0 || value >= source.width))
      fail('GEOCODER_CUSTOMER_COLUMN', 'Map only a displayed original column index.');
    return [name, value];
  }));
  if (input.idMode === 'row' && columns.id !== null)
    fail('GEOCODER_CUSTOMER_ID_MODE', 'Row identity does not consume an ID column; the original business ID remains in the source.');
  const prefix = input.outputPrefix ?? 'census_';
  if (typeof prefix !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(prefix))
    fail('GEOCODER_CUSTOMER_PREFIX', 'Choose an output prefix of 1–48 letters, numbers or underscores, starting with a letter or underscore.');
  if (suffixes.some(name => source.names.includes(prefix + name)))
    fail('GEOCODER_CUSTOMER_PREFIX_COLLISION', 'A joined result column would overwrite an original column name. Choose another explicit output prefix.');
  const row = value => {
    if (!Number.isInteger(value) || value < 1 || value > source.rowCount)
      fail('GEOCODER_CUSTOMER_ROW', 'Select an original 1-based customer record number.');
    return value;
  };
  const normalize = (values, correction) => {
    if (!Array.isArray(values) || values.length > source.rowCount) fail('GEOCODER_CUSTOMER_DECISIONS', 'Use one decision per original row.');
    const seen = new Set();
    return values.map(value => {
      only(value, correction ? ['row', 'values', 'reason'] : ['row', 'reason']);
      const ordinal = row(value.row);
      if (seen.has(ordinal)) fail('GEOCODER_CUSTOMER_DECISIONS', 'A row has more than one decision of the same kind.');
      seen.add(ordinal);
      if (!correction) return { row: ordinal, reason: reason(value.reason) };
      only(value.values, FIELDS);
      if (!Object.keys(value.values).length || input.idMode === 'row' && Object.hasOwn(value.values, 'id'))
        fail('GEOCODER_CUSTOMER_CORRECTION', 'Select at least one address field; stable row IDs cannot be corrected.');
      const fields = {};
      for (const name of FIELDS) if (Object.hasOwn(value.values, name)) {
        const field = value.values[name];
        if (typeof field !== 'string' || field.length > 65536)
          fail('GEOCODER_CUSTOMER_CORRECTION', 'A corrected field must be text of at most 65,536 characters.');
        fields[name] = field;
      }
      return { row: ordinal, values: fields, reason: reason(value.reason) };
    }).sort((a, b) => a.row - b.row);
  };
  const plan = { idMode: input.idMode, columns, outputPrefix: prefix,
    corrections: normalize(input.corrections ?? [], true), exclusions: normalize(input.exclusions ?? [], false) };
  if (bytes(plan).length > 1024 * 1024) fail('GEOCODER_CUSTOMER_PLAN_SIZE', 'The retained mapping and row decisions exceed 1 MiB.');
  return plan;
}
export function compileCustomer(source, input) {
  const plan = customerPlan(input, source), corrections = new Map(plan.corrections.map(value => [value.row, value]));
  const exclusions = new Map(plan.exclusions.map(value => [value.row, value])), ids = new Map();
  const hasUrbanization = plan.columns.urbanization !== null || plan.corrections.some(value => Object.hasOwn(value.values, 'urbanization'));
  const rows = source.records.map((cells, index) => {
    const ordinal = index + 1, correction = corrections.get(ordinal), exclusion = exclusions.get(ordinal);
    const mapped = Object.fromEntries(FIELDS.map(name => [name, plan.columns[name] === null ? '' : cells[plan.columns[name]] ?? '']));
    if (plan.idMode === 'row') mapped.id = 'row-' + String(ordinal).padStart(6, '0');
    if (correction) Object.assign(mapped, correction.values);
    const address = FIELDS.slice(0, hasUrbanization ? 6 : 5).map(name => mapped[name]);
    const result = { row: ordinal, cells, mapped, address, excluded: Boolean(exclusion),
      exclusionReason: exclusion?.reason ?? null, correction: correction ?? null, errors: [] };
    if (!result.excluded) {
      try { inputAddresses(Buffer.from(csvLine(address))); }
      catch (error) { result.errors.push({ code: error.code ?? 'GEOCODER_ADDRESS_INVALID', message: error.message }); }
      if (!ids.has(mapped.id)) ids.set(mapped.id, []);
      ids.get(mapped.id).push(result);
    }
    return result;
  });
  for (const duplicates of ids.values()) if (duplicates.length > 1) for (const row of duplicates)
    row.errors.push({ code: 'GEOCODER_ID_INVALID', message: 'The selected address ID occurs in ' + duplicates.length + ' included rows. Choose stable row IDs, correct an ID, or explicitly exclude a row.' });
  const included = rows.filter(row => !row.excluded), invalid = included.filter(row => row.errors.length);
  const errors = [];
  if (!included.length) errors.push({ code: 'GEOCODER_RECORD_LIMIT', message: 'Include at least one customer row.' });
  let parsed = null;
  if (included.length && !invalid.length) {
    try { parsed = inputAddresses(Buffer.from(included.map(row => csvLine(row.address)).join(''))); }
    catch (error) { errors.push({ code: error.code ?? 'GEOCODER_BATCH_SIZE', message: error.message }); }
  }
  const summary = { originalRows: rows.length, includedRows: included.length, excludedRows: rows.length - included.length,
    invalidRows: invalid.length, correctedRows: plan.corrections.length, ready: Boolean(parsed) && !errors.length,
    submittedBytes: parsed?.submittedBytes ?? null, submittedSha256: parsed?.submittedSha256 ?? null };
  const reviewSha256 = identity({ schema: CUSTOMER_MAPPING_SCHEMA, sourceSha256: source.inputSha256,
    header: source.header, plan, summary, addressRecords: included.map(row => row.address) });
  return { source, plan, rows, summary, errors, reviewSha256, submitted: parsed?.submitted ?? null,
    records: parsed?.records ?? null, addressRecordsSha256: parsed ? identity(parsed.records) : null };
}
export function customerPreview(compiled, { offset = 0, limit = 20, filter = 'all' } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      !['all', 'exceptions', 'excluded', 'corrected'].includes(filter)) fail('GEOCODER_CUSTOMER_PAGE', 'Choose a valid bounded customer review page.');
  const selected = compiled.rows.filter(row => filter === 'all' || filter === 'exceptions' && row.errors.length ||
    filter === 'excluded' && row.excluded || filter === 'corrected' && row.correction);
  const result = { sourceSha256: compiled.source.inputSha256, columns: compiled.source.columns, header: compiled.source.header,
    reviewSha256: compiled.reviewSha256, summary: compiled.summary, errors: compiled.errors,
    total: selected.length, offset, limit, next: null, rows: selected.slice(offset, offset + limit).map(row => ({
      row: row.row, originalCells: row.cells.slice(0, 8).map(value => brief(value, 80)), originalCellCount: row.cells.length,
      previewOnly: true, mapped: Object.fromEntries(FIELDS.map(name => [name, brief(row.mapped[name], 120)])),
      excluded: row.excluded, exclusionReason: row.exclusionReason === null ? null : brief(row.exclusionReason, 200),
      correctedFields: Object.keys(row.correction?.values ?? {}), errors: row.errors.map(error => ({ code: error.code, message: brief(error.message, 400) }))
    })) };
  while (result.rows.length && bytes(result).length > 96 * 1024) result.rows.pop();
  if (selected.length > offset && !result.rows.length) fail('GEOCODER_CUSTOMER_PREVIEW_SIZE');
  result.next = offset + result.rows.length < selected.length ? offset + result.rows.length : null;
  return result;
}
export function verifyCustomerBinding({ source, mapping, binding }, batch, submitted) {
  if (mapping.schema !== CUSTOMER_MAPPING_SCHEMA || binding.schema !== CUSTOMER_BINDING_SCHEMA ||
      mapping.sourceSha256 !== source.inputSha256 || mapping.sourceHeader !== source.header ||
      binding.mappingId !== mapping.id || binding.sourceId !== mapping.sourceId ||
      binding.sourceSha256 !== source.inputSha256 || binding.batchId !== batch.id ||
      binding.submittedSha256 !== batch.input.submittedSha256 ||
      binding.mappingSha256 !== digest(bytes(mapping)) || !HASH.test(binding.addressRecordsSha256 ?? ''))
    fail('GEOCODER_CUSTOMER_BINDING_CHANGED', 'The original customer mapping does not belong to this retained batch.');
  const compiled = compileCustomer(source, mapping.plan);
  const native = inputAddresses(submitted);
  if (!compiled.summary.ready || compiled.reviewSha256 !== mapping.reviewSha256 ||
      identity(compiled.summary) !== identity(mapping.summary) ||
      compiled.addressRecordsSha256 !== binding.addressRecordsSha256 ||
      identity(native.records) !== compiled.addressRecordsSha256 || digest(submitted) !== binding.submittedSha256)
    fail('GEOCODER_CUSTOMER_BINDING_CHANGED', 'The mapped addresses differ from the exact submitted records.');
  return compiled;
}
export function customerResults(bundle, batch, submitted, captured, review, selectedIds) {
  const compiled = verifyCustomerBinding(bundle, batch, submitted), { source, mapping, binding } = bundle;
  const byId = new Map(captured.rows.map(row => [row.record_id, row])), selected = new Set(selectedIds);
  if (byId.size !== compiled.records.length || compiled.records.some(row => !byId.has(row[0])) ||
      selectedIds.some(id => !byId.has(id))) fail('GEOCODER_CUSTOMER_RESPONSE_CHANGED');
  const columns = [...source.names, ...suffixes.map(name => compiled.plan.outputPrefix + name)];
  const joined = compiled.rows.map(row => {
    const result = row.excluded ? null : byId.get(row.mapped.id);
    return { sourceRow: row.row, original: [...row.cells], submission: row.excluded ? 'EXCLUDED' : 'SUBMITTED',
      exclusionReason: row.exclusionReason, correction: row.correction,
      submittedAddress: row.excluded ? null : { ...row.mapped }, selectedByReview: Boolean(result && selected.has(result.record_id)),
      result: result ?? null };
  });
  const description = { schema: CUSTOMER_RESULTS_SCHEMA, sourceId: mapping.sourceId, sourceSha256: source.inputSha256,
    mappingId: mapping.id, mappingSha256: digest(bytes(mapping)), bindingSha256: digest(bytes(binding)),
    batchId: batch.id, reviewId: review.id, editionReviewSha256: digest(bytes(review)),
    reviewSha256: mapping.reviewSha256, responseSha256: captured.responseSha256,
    originalRows: joined.length, submittedRows: compiled.summary.includedRows, excludedRows: compiled.summary.excludedRows,
    outputPrefix: compiled.plan.outputPrefix, files: { input: 'source/customer-input.csv', mapping: 'source/customer-mapping.json',
      binding: 'source/customer-binding.json', csv: 'customer-results.csv', json: 'customer-results.json' } };
  const resultJson = bytes({ ...description, originalHeader: source.header ? [...source.headerCells] : null,
    originalColumns: [...source.names], resultColumns: suffixes.map(name => compiled.plan.outputPrefix + name), rows: joined });
  const resultCsv = Buffer.from(csvLine(columns) + joined.map(row => csvLine([
    ...Array.from({ length: source.width }, (_, index) => row.original[index] ?? ''),
    String(row.sourceRow), row.submission, row.exclusionReason ?? '', String(row.selectedByReview),
    ...Object.keys(COLUMNS).map(name => row.result?.[name] == null ? '' : String(row.result[name]))
  ])).join(''));
  if (resultCsv.length > 64 * 1024 * 1024 || resultJson.length > 64 * 1024 * 1024)
    fail('GEOCODER_CUSTOMER_RESULT_SIZE', 'The joined customer result exceeds the retained 64 MiB member limit.');
  return { description, files: { 'customer-results.csv': resultCsv, 'customer-results.json': resultJson },
    originals: { 'customer-input.csv': source.original, 'customer-mapping.json': bytes(mapping), 'customer-binding.json': bytes(binding) } };
}
