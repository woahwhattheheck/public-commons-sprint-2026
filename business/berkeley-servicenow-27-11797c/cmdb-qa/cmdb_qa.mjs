// MIT — Berkeley ServiceNow RFP 27-11797-C: offline, vendor-neutral acceptance aid.
// Not a ServiceNow connector. Requires operator-authorized local CSV exports.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_FIELDS = Object.freeze([
  'name', 'sys_class_name', 'assigned_to', 'install_status', 'serial_number', 'location',
]);
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** RFC 4180-style quoted fields, escaped quotes, embedded line breaks and UTF-8 BOM. */
export function parseCsv(source, { maxRows = MAX_RECORDS } = {}) {
  if (typeof source !== 'string') throw new TypeError('CSV_TEXT_REQUIRED');
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw new RangeError('CSV_BYTE_LIMIT');
  if (source.includes('\0') || source.includes('\uFFFD')) throw new TypeError('CSV_INVALID_ENCODING');
  const s = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const rows = []; let row = []; let field = ''; let quoted = false;
  let closed = false; let rowCount = 0;
  function finishField() { row.push(field); field = ''; closed = false; }
  function finishRow() {
    finishField(); rows.push(row); row = []; rowCount++;
    if (rowCount > maxRows + 1) throw new RangeError('CSV_RECORD_LIMIT');
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i+1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === ',') finishField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i+1] === '\n') i++;
      finishRow();
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else if (c === '"' || closed) throw new TypeError('CSV_QUOTE_INVALID');
    else field += c;
  }
  if (quoted) throw new TypeError('CSV_UNTERMINATED_QUOTE');
  if (field !== '' || row.length > 0 || closed) finishRow();
  if (!rows.length) throw new TypeError('CSV_EMPTY');
  const headers = rows.shift().map(v => v.trim());
  if (headers.some(v => !v || v.length > 128) || new Set(headers).size !== headers.length) {
    throw new TypeError('CSV_HEADER_INVALID_OR_DUPLICATE');
  }
  return { headers, records: rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new TypeError(`CSV_COLUMN_COUNT:${index + 2}`);
    return Object.fromEntries(headers.map((name, col) => [name, cells[col]]));
  }) };
}

function validateTable(text, required, key, label) {
  const table = parseCsv(text);
  for (const name of required) {
    if (!table.headers.includes(name)) throw new TypeError(`${label}_FIELD_MISSING:${name}`);
  }
  const byId = new Map();
  for (const [index, row] of table.records.entries()) {
    const id = row[key];
    if (!id || id !== id.trim() || id.length > 512 || /[\x00-\x1f\x7f]/.test(id)) {
      throw new TypeError(`${label}_RECORD_KEY_INVALID:${index+2}`);
    }
    if (byId.has(id)) throw new TypeError(`${label}_DUPLICATE_KEY:${id}`);
    byId.set(id, row);
  }
  return { byId, count: table.records.length };
}

/** Exact-string comparison, no invented key joins or normalization. Hashes avoid raw value disclosure. */
export function reconcileCsv(beforeText, afterText, { key = 'sys_id', fields = DEFAULT_FIELDS } = {}) {
  if (typeof key !== 'string' || !key.trim() || !Array.isArray(fields) || !fields.length ||
      fields.some(v => typeof v !== 'string' || !v || v === key) ||
      new Set(fields).size !== fields.length) throw new TypeError('AUDIT_FIELD_SPEC_INVALID');
  const required = [key, ...fields];
  const before = validateTable(beforeText, required, key, 'SOURCE');
  const after = validateTable(afterText, required, key, 'TARGET');
  const ids = [...new Set([...before.byId.keys(), ...after.byId.keys()])].sort(cmp);
  const findings = [];
  for (const id of ids) {
    const a = before.byId.get(id), b = after.byId.get(id);
    if (!a || !b) {
      findings.push({ record_key: id, reason: a ? 'RECORD_REMOVED' : 'RECORD_ADDED',
        field: '*', severity: a ? 'critical' : 'review',
        before_sha256: a ? sha256(JSON.stringify(required.map(f => a[f]))) : '',
        after_sha256: b ? sha256(JSON.stringify(required.map(f => b[f]))) : '' });
      continue;
    }
    for (const field of fields) {
      if (a[field] !== b[field]) findings.push({ record_key: id, reason: 'FIELD_CHANGED', field,
        severity: ['sys_class_name', 'assigned_to', 'install_status'].includes(field) ? 'critical' : 'review',
        before_sha256: sha256(a[field]), after_sha256: sha256(b[field]) });
    }
  }
  const reasons = Object.fromEntries([...new Set(findings.map(f => f.reason))].sort(cmp)
    .map(reason => [reason, findings.filter(f => f.reason === reason).length]));
  return {
    schema: 'berkeley-servicenow-cmdb-qa/v1',
    result: findings.length ? 'REVIEW_REQUIRED' : 'PASS',
    source_sha256: sha256(beforeText), target_sha256: sha256(afterText),
    fields: { key, compared: [...fields] },
    summary: { source_records: before.count, target_records: after.count,
      findings: findings.length, critical: findings.filter(f => f.severity === 'critical').length, by_reason: reasons },
    findings,
  };
}

const COLS = ['record_key','reason','field','severity','before_sha256','after_sha256'];
export function findingsCsv(findings) {
  const safe = v => {
    let str = String(v ?? '');
    // Excel/Sheets formula injection protection, even for untrusted identifier strings.
    if (/^[\s]*[=+\-@]/u.test(str)) str = "'" + str;
    return '"' + str.replaceAll('"','""') + '"';
  };
  return [COLS.join(','), ...findings.map(f => COLS.map(k => safe(f[k])).join(','))].join('\r\n') + '\r\n';
}

function argsOf(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i+=2) {
    const flag = argv[i];
    if (!['--source','--target','--out','--fields'].includes(flag) || !argv[i+1] || opts[flag]) {
      throw new TypeError('CLI_USAGE: --source before.csv --target after.csv --out DIRECTORY [--fields col,col]');
    }
    opts[flag] = argv[i+1];
  }
  if (!opts['--source'] || !opts['--target'] || !opts['--out']) throw new TypeError('CLI_USAGE');
  return opts;
}

export function runCli(argv) {
  const options = argsOf(argv);
  const fields = options['--fields'] ? options['--fields'].split(',') : DEFAULT_FIELDS;
  const source = readFileSync(resolve(options['--source']), 'utf8');
  const target = readFileSync(resolve(options['--target']), 'utf8');
  const audit = reconcileCsv(source, target, { fields });
  const dir = resolve(options['--out']); mkdirSync(dir, { recursive: true });
  // The two outputs are deterministic for identical inputs and settings.
  for (const [name, value] of [
    ['audit.json', JSON.stringify(audit, null, 2) + '\n'],
    ['discrepancies.csv', findingsCsv(audit.findings)],
  ]) {
    const tmp = join(dir, `.${name}.${process.pid}.tmp`);
    writeFileSync(tmp, value, { mode: 0o600 });
    renameSync(tmp, join(dir, name));
  }
  console.log(`${audit.result} findings=${audit.summary.findings} critical=${audit.summary.critical}`);
  return audit.result === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = runCli(process.argv.slice(2)); }
  catch (e) { console.error(`INPUT_REJECTED: ${e.message}`); process.exitCode = 2; }
}
