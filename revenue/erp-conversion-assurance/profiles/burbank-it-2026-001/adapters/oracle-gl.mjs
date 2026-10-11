// MIT. Prepare exact native GL_INTERFACE columns for the selected loading process.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  sha256, fault, fingerprint, integer, now, readJson, maybeJson, writeJson,
  writeProjection, withCaptureLock, fileInside
} from './common.mjs';

export const GL_INTERFACE_CONTRACT = JSON.parse(await fs.readFile(new URL('./oracle-gl-contract.json', import.meta.url), 'utf8'));
const definitions = new Map(GL_INTERFACE_CONTRACT.columns.map(column => [column.name, column]));
const present = value => value !== null && value !== undefined && String(value).trim() !== '';
const SEGMENT = /^SEGMENT(?:[1-9]|[12][0-9]|30)$/;
const AMOUNTS = ['ENTERED_DR', 'ENTERED_CR', 'ACCOUNTED_DR', 'ACCOUNTED_CR'];
const FX = ['USER_CURRENCY_CONVERSION_TYPE', 'CURRENCY_CONVERSION_DATE', 'CURRENCY_CONVERSION_RATE', 'ACCOUNTED_DR', 'ACCOUNTED_CR'];

// Decimal arithmetic exists only for exact source summaries; the shared conversion
// engine remains responsible for comparing declared accounting populations.
function decimal(value) {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match || value.length > 256) throw fault('NUMBER_FORMAT', 'Use an exact ungrouped decimal value');
  const fraction = match[3] ?? match[4] ?? '', exponent = Number(match[5] || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000) throw fault('NUMBER_RANGE', 'Decimal exponent exceeds the Oracle NUMBER range');
  let coefficient = BigInt((match[2] || '0') + fraction) * (match[1] === '-' ? -1n : 1n), scale = fraction.length - exponent;
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString();
  if (coefficient && (digits.length - scale - 1 < -130 || digits.length - scale - 1 > 125)) throw fault('NUMBER_RANGE', 'Nonzero Oracle NUMBER must fit its native exponent range');
  if (digits.replace(/0+$/, '').length > 38) throw fault('NUMBER_PRECISION', 'This value would exceed 38 significant Oracle NUMBER digits');
  return { coefficient, scale };
}
function addDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return { coefficient: a.coefficient * 10n ** BigInt(scale - a.scale) + b.coefficient * 10n ** BigInt(scale - b.scale), scale };
}
function decimalText({ coefficient, scale }) {
  const negative = coefficient < 0n, digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  return (negative ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
}
function validDate(value, format) {
  if (format === 'preserve') return true;
  const pattern = format === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = pattern.exec(value); if (!match) return false;
  const [year, month, day, hour = 0, minute = 0, second = 0] = match.slice(1).map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}
function compileSelection({ mapping = {}, defaults = {}, enabledSegments = [], approvedLookups = {}, dateFormat = 'YYYY-MM-DD', textLengthSemantics = 'characters', sourceRecordField }) {
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object' || !defaults || Array.isArray(defaults) || typeof defaults !== 'object') throw fault('GL_MAPPING_REQUIRED', 'Use explicit native-column to source-column mappings and default values');
  for (const [column, field] of Object.entries(mapping)) {
    if (!definitions.has(column) || typeof field !== 'string' || !field) throw fault('GL_MAPPING_INVALID', `Unrecognized native column or source field: ${column}`);
    if (column in defaults) throw fault('GL_MAPPING_CONFLICT', `${column} has both a mapping and a default; select one`);
  }
  for (const [column, value] of Object.entries(defaults)) if (!definitions.has(column) || (value !== null && typeof value !== 'string')) throw fault('GL_DEFAULT_INVALID', 'Defaults must use native column names and exact string values');
  if (!Array.isArray(enabledSegments) || enabledSegments.some(column => !SEGMENT.test(column)) || new Set(enabledSegments).size !== enabledSegments.length) throw fault('GL_SEGMENTS_INVALID', 'Declare the exact enabled SEGMENT columns from the selected chart');
  if (!['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'preserve'].includes(dateFormat)) throw fault('GL_DATE_FORMAT_INVALID', 'Choose an explicit supported loader date representation');
  if (!['characters', 'utf8-bytes'].includes(textLengthSemantics)) throw fault('GL_TEXT_LENGTH_INVALID', 'Choose character or UTF-8 byte length checks to match the selected loader/database');
  for (const [column, values] of Object.entries(approvedLookups)) if (!definitions.has(column) || !Array.isArray(values) || values.some(value => typeof value !== 'string')) throw fault('GL_LOOKUP_INVALID', 'Tenant-approved lookup values must be lists of exact text keyed by native column');
  if (sourceRecordField !== undefined && (typeof sourceRecordField !== 'string' || !sourceRecordField)) throw fault('GL_SOURCE_KEY_INVALID', 'sourceRecordField must name an original source column');
  const effectiveDefaults = { ...defaults };
  if (!('STATUS' in mapping) && !('STATUS' in effectiveDefaults)) effectiveDefaults.STATUS = 'NEW';
  const selected = new Set([...definitions.values()].filter(column => column.required).map(column => column.name).concat(Object.keys(mapping), Object.keys(effectiveDefaults)));
  return { mapping, defaults: effectiveDefaults, enabledSegments, approvedLookups, dateFormat, textLengthSemantics, sourceRecordField,
    columns: [...definitions.keys()].filter(column => selected.has(column)) };
}
function prepareRow(input, selection) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw fault('GL_SOURCE_ROW_INVALID', 'Every selected source row must be a keyed record');
  const record = {}, issues = [], numeric = {};
  const issue = (column, code, message, severity = 'error') => issues.push({ column, code, message, severity });
  for (const column of selection.columns) {
    const definition = definitions.get(column), field = selection.mapping[column];
    let value = field === undefined ? selection.defaults[column] ?? null : input[field];
    if (field !== undefined && !Object.hasOwn(input, field)) issue(column, 'SOURCE_COLUMN_MISSING', `Selected source column ${field} is absent`);
    if (value !== undefined && value !== null && typeof value !== 'string') { issue(column, 'EXACT_TEXT_REQUIRED', 'Supply original text values; JavaScript numeric input cannot establish source precision'); value = null; }
    record[column] = value ?? null;
    if (!present(value)) { if (definition.required) issue(column, 'REQUIRED_VALUE', 'The native interface requires this value'); continue; }
    if (definition.mustBeNull) issue(column, 'INTERNAL_COLUMN', 'Oracle reserves this column for internal processing; leave it NULL');
    if (definition.maxLength) {
      const size = selection.textLengthSemantics === 'utf8-bytes' ? Buffer.byteLength(value, 'utf8') : [...value].length;
      if (size > definition.maxLength) issue(column, 'TEXT_LENGTH', `Value exceeds the selected ${definition.maxLength} ${selection.textLengthSemantics} length`);
    }
    if (definition.type === 'NUMBER') {
      try {
        const parsed = decimal(value); numeric[column] = parsed;
        if (definition.precision) {
          const unit = 10n ** BigInt(parsed.scale);
          if (parsed.coefficient % unit || (parsed.coefficient / unit).toString().replace('-', '').length > definition.precision) issue(column, 'INTEGER_PRECISION', `NUMBER(${definition.precision}) requires an integer fitting that precision`);
        }
      } catch (error) { issue(column, error.code || 'NUMBER_FORMAT', error.message); }
    }
    if (definition.type === 'DATE' && !validDate(value, selection.dateFormat)) issue(column, 'DATE_FORMAT', `Value does not match a valid ${selection.dateFormat} date`);
    if (selection.approvedLookups[column] && !selection.approvedLookups[column].includes(value)) issue(column, 'TENANT_LOOKUP', 'Value is absent from the supplied tenant-approved lookup');
  }
  if (present(record.STATUS) && record.STATUS !== 'NEW') issue('STATUS', 'NEW_STATUS_REQUIRED', 'A new Journal Import preparation uses STATUS NEW');
  if (present(record.ACTUAL_FLAG) && !['A', 'B', 'E'].includes(record.ACTUAL_FLAG)) issue('ACTUAL_FLAG', 'ACTUAL_FLAG_INVALID', 'Use A, B or E from the native interface');
  const required = (column, reason) => { if (!present(record[column])) issue(column, 'CONDITIONAL_REQUIRED', reason); };
  if (record.ACTUAL_FLAG === 'E') required('ENCUMBRANCE_TYPE_ID', 'Encumbrance rows require the selected encumbrance type');
  if (record.ACTUAL_FLAG === 'B') { required('BUDGET_VERSION_ID', 'Budget rows require the selected budget version'); required('PERIOD_NAME', 'Budget rows require a period in the approved budget fiscal year'); }
  const segments = Object.keys(record).filter(column => SEGMENT.test(column) && present(record[column]));
  if (segments.length) {
    if (!selection.enabledSegments.length) issue('SEGMENT1', 'CHART_SEGMENTS_UNSPECIFIED', 'The row retains segment values; supply the actual enabled columns to verify complete chart coverage', 'warning');
    for (const column of selection.enabledSegments) required(column, 'Every enabled chart segment needs an exact value');
    for (const column of segments) if (selection.enabledSegments.length && !selection.enabledSegments.includes(column)) issue(column, 'DISABLED_SEGMENT', 'This column is outside the declared enabled chart segments');
    if (present(record.CODE_COMBINATION_ID)) issue('CODE_COMBINATION_ID', 'SEGMENTS_TAKE_PRECEDENCE', 'Native Journal Import uses supplied segment values ahead of this code combination ID', 'warning');
  } else required('CODE_COMBINATION_ID', 'Select either a code combination ID or complete enabled segment values');
  if (['B', 'E'].includes(record.ACTUAL_FLAG)) for (const column of FX) if (present(record[column])) issue(column, 'ACTUAL_ONLY_CURRENCY_FIELD', 'The native guide limits this conversion field to actual amounts');
  const conversion = record.USER_CURRENCY_CONVERSION_TYPE;
  if (present(conversion)) {
    if (conversion.toUpperCase() === 'USER') required('CURRENCY_CONVERSION_RATE', 'The User conversion type requires an explicit rate');
    else { required('CURRENCY_CONVERSION_DATE', 'A non-User conversion type requires its conversion date'); if (present(record.CURRENCY_CONVERSION_RATE)) issue('CURRENCY_CONVERSION_RATE', 'NON_USER_RATE', 'Leave this rate empty for a non-User conversion type'); }
  } else if (present(record.CURRENCY_CONVERSION_RATE) || present(record.CURRENCY_CONVERSION_DATE)) required('USER_CURRENCY_CONVERSION_TYPE', 'Conversion date/rate fields need the selected conversion type');
  if (present(record.ACCOUNTED_DR)) required('ENTERED_DR', 'A directly supplied accounted debit requires an entered debit');
  if (present(record.ACCOUNTED_CR)) required('ENTERED_CR', 'A directly supplied accounted credit requires an entered credit');
  // The native guide explicitly permits both debit and credit in one record.
  if (record.REFERENCE7 === 'Yes') required('REFERENCE8', 'A reversal request requires its target period');
  const taxColumns = ['INVOICE_DATE', 'INVOICE_AMOUNT', 'INVOICE_IDENTIFIER', 'TAX_CODE'];
  if (record.CONTEXT2 === 'Yes') for (const column of taxColumns) required(column, 'The selected VAT descriptive flexfield requires this native value');
  if (record.CONTEXT2 === 'No') for (const column of taxColumns) if (present(record[column])) issue(column, 'NON_TAX_COLUMN', 'The native VAT fields must be NULL when CONTEXT2 is No');
  return { record, issues, numeric };
}
export async function reopenGlPreparation(directory) {
  const manifest = await readJson(path.join(directory, 'preparation.json'));
  if (manifest.schema !== 'tjl.oracle-gl-preparation.v1') throw fault('GL_PREPARATION_SCHEMA', 'This directory is not a native GL preparation');
  for (const member of [manifest.projection?.csv, manifest.projection?.jsonl].filter(Boolean)) {
    if (sha256(await fs.readFile(fileInside(directory, member.file))) !== member.sha256) throw fault('CAPTURE_HASH_MISMATCH', `Prepared member changed: ${member.file}`);
  }
  return manifest;
}
export async function prepareGlInterface({ directory, sourceRows, source = {}, maxRecords = 1000000, signal, onProgress = () => {}, ...options }) {
  const selection = compileSelection(options), config = { ...selection, source, maxRecords: integer(maxRecords, 'maxRecords', 1, 10000000) };
  if (!sourceRows || (!sourceRows[Symbol.iterator] && !sourceRows[Symbol.asyncIterator])) throw fault('GL_SOURCE_ROWS_REQUIRED', 'Supply the selected native source records as an iterable');
  const configSha256 = fingerprint(config);
  return withCaptureLock(directory, async () => {
    const filename = path.join(directory, 'preparation.json'), previous = await maybeJson(filename);
    if (previous && ['prepared', 'review_required'].includes(previous.status)) throw fault('GL_PREPARATION_EXISTS', 'Reopen this completed preparation or choose a new directory for a new source population');
    if (previous && previous.configSha256 !== configSha256) throw fault('GL_PREPARATION_CONFIG_CHANGED', 'Use a new directory for a changed source mapping');
    const manifest = { schema: 'tjl.oracle-gl-preparation.v1', startedAt: previous?.startedAt || now(), config, configSha256,
      attempts: (previous?.attempts || 0) + 1, status: 'preparing', documentation: GL_INTERFACE_CONTRACT.source,
      contractSha256: fingerprint(GL_INTERFACE_CONTRACT), sourceDiscrepancies: GL_INTERFACE_CONTRACT.sourceDiscrepancies };
    let count = 0, errors = 0, warnings = 0; const issueCounts = {}, examples = [], totals = new Map(), inputHash = createHash('sha256');
    await writeJson(filename, manifest);
    async function* rows() {
      for await (const input of sourceRows) {
        signal?.throwIfAborted(); count++;
        if (count > config.maxRecords) throw fault('GL_SOURCE_LIMIT', 'Selected source exceeds maxRecords');
        const inputSha256 = fingerprint(input); inputHash.update(inputSha256 + '\n');
        const prepared = prepareRow(input, selection), identity = selection.sourceRecordField ? input[selection.sourceRecordField] : String(count);
        for (const issue of prepared.issues) {
          if (issue.severity === 'error') errors++; else warnings++;
          issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
          if (examples.length < 200) examples.push({ row: count, sourceRecord: identity, ...issue });
        }
        const groupKey = JSON.stringify([prepared.record.LEDGER_ID, prepared.record.CURRENCY_CODE, prepared.record.ACTUAL_FLAG]);
        if (!totals.has(groupKey)) totals.set(groupKey, Object.fromEntries(AMOUNTS.map(column => [column, { coefficient: 0n, scale: 0 }])));
        for (const column of AMOUNTS) if (prepared.numeric[column]) totals.get(groupKey)[column] = addDecimal(totals.get(groupKey)[column], prepared.numeric[column]);
        yield { record: prepared.record, source: { row: count, recordId: identity ?? null, inputSha256, originalValues: input }, issues: prepared.issues };
        if (count % 200 === 0) await onProgress({ stage: 'prepare', records: count, errors, warnings });
      }
    }
    try {
      manifest.projection = await writeProjection({ directory, columns: selection.columns, rows: rows(), csvFile: 'gl-interface.csv', jsonlFile: 'gl-interface.jsonl.gz' });
      if (!count) { errors++; issueCounts.EMPTY_SOURCE = 1; examples.push({ code: 'EMPTY_SOURCE', severity: 'error', message: 'The selected population contains no source rows' }); }
      manifest.sourcePopulationSha256 = inputHash.digest('hex'); manifest.records = count;
      manifest.review = { errors, warnings, issueCounts, examples, completeIssues: manifest.projection.jsonl.file,
        tenantLookupsSupplied: Object.keys(selection.approvedLookups), dateFormat: selection.dateFormat,
        textLengthSemantics: selection.textLengthSemantics,
        scope: 'Native column structure and explicitly supplied tenant lookups. Oracle tenant validation, Journal Import and posting are separate operations.' };
      manifest.numericSummary = [...totals].map(([key, amounts]) => { const [ledger, currency, actualFlag] = JSON.parse(key); return { ledger, currency, actualFlag, ...Object.fromEntries(Object.entries(amounts).map(([column, value]) => [column, decimalText(value)])) }; });
      manifest.numericSummaryMeaning = 'Exact sums of parseable source amount fields, grouped by ledger/currency/actual flag. These totals do not establish balanced journals or successful import.';
      manifest.status = errors ? 'review_required' : 'prepared'; manifest.completedAt = now();
      await writeJson(filename, manifest); await onProgress({ stage: 'complete', status: manifest.status, records: count, errors, warnings }); return manifest;
    } catch (error) {
      manifest.status = signal?.aborted ? 'cancelled' : 'interrupted'; manifest.processedRows = count;
      manifest.error = { code: error.code || error.name || 'GL_PREPARATION_FAILED', message: error.message };
      await writeJson(filename, manifest); throw error;
    }
  });
}
