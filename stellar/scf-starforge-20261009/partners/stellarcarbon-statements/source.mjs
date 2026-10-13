// MIT. Native sc-audit records retain their original numeric lexemes and table relationships.
export const SOURCE_SCHEMA = 'stellar-forge.stellarcarbon-source-edition.v1';
export const TABLES = {
  distribution_txs: ['hash','created_at','sender','recipient','carbon_amount','toid'],
  minted_blocks: ['serial_hash','transaction_hash','created_at','vcs_project_id','serial_number','block_start','block_end','sub_account_id','sub_account_name','vintage_start','vintage_end','toid'],
  retirement_from_block: ['retirement_id','block_hash','vcu_amount'],
  retirements: ['certificate_id','vcu_amount','serial_number','retirement_date','retirement_beneficiary','retirement_details','vcs_project_id','issuance_date','instrument_type','vintage_start','vintage_end','total_vintage_quantity'],
  sink_status: ['sinking_tx_hash','certificate_id','amount_filled','finalized'],
  sinking_txs: ['hash','created_at','contract_id','funder','recipient','carbon_amount','source_asset_code','source_asset_issuer','source_asset_amount','dest_asset_code','dest_asset_issuer','dest_asset_amount','vcs_project_id','memo_type','memo_value','toid'],
  vcs_projects: ['id','name','category','protocol','additional_certifications','region','country'],
};
export const KEYS = {
  distribution_txs:['toid'], minted_blocks:['serial_hash'], retirement_from_block:['retirement_id','block_hash'],
  retirements:['certificate_id'], sink_status:['sinking_tx_hash','certificate_id'], sinking_txs:['hash'], vcs_projects:['id'],
};
export const copy = value => structuredClone(value);
export function need(condition, code, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message || code), {code,status});
}
export function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function text(value, label, maximum = 1000, empty = false) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0') && (empty || value.trim()),
    'INVALID_TEXT', 'Enter ' + label + '.');
  return value.trim();
}
export function id(value, label = 'identifier') {
  const result = text(value, label, 160);
  need(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(result), 'INVALID_ID', 'Use a simple ' + label + '.');
  return result;
}
export function civilDate(value, label = 'date') {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
    'INVALID_DATE', 'Use YYYY-MM-DD for ' + label + '.');
  const date = new Date(value + 'T00:00:00Z');
  need(Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value,
    'INVALID_DATE', 'Use a real calendar date for ' + label + '.');
  return value;
}
export function dayOf(value) {
  need(typeof value === 'string', 'INVALID_SOURCE_DATE', 'Keep the original source date.');
  const day = civilDate(value.slice(0,10), 'source date');
  if (value.length > 10) need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) &&
    Number.isFinite(Date.parse(value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value) ? value : value + 'Z')),
    'INVALID_SOURCE_DATE', 'Keep an ISO source timestamp.');
  // sc-audit stores timezone-naive UTC. A supplied explicit offset is normalized to UTC.
  return value.length > 10 && /[+-]\d{2}:\d{2}$/.test(value)
    ? new Date(value).toISOString().slice(0,10) : day;
}
export function windowOf(value = {}) {
  const fromDate = civilDate(value.fromDate, 'period start');
  const beforeDate = civilDate(value.beforeDate, 'exclusive period end');
  need(fromDate < beforeDate, 'INVALID_PERIOD', 'The period end must follow its start.');
  return {fromDate,beforeDate};
}
export const inWindow = (value, period) => dayOf(value) >= period.fromDate && dayOf(value) < period.beforeDate;

/** JSON number tokens become exact strings before JSON.parse can round them.
 * Quoted strings are copied as whole spans, including multi-megabyte native XDR.
 */
export function parseNativeJSON(source) {
  need(typeof source === 'string', 'SOURCE_TEXT_REQUIRED', 'Supply the original JSON text.');
  const parts = [], stack = [], number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let start = 0, previous = '';
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === '"') {
      let end = i;
      do {
        end = source.indexOf('"',end + 1);
        if (end < 0) { i = source.length; break; }
        let backslashes = 0;
        for (let p = end - 1; p >= i && source[p] === '\\'; p--) backslashes++;
        if (backslashes % 2 === 0) { i = end + 1; break; }
      } while (true);
      previous = '"'; continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      number.lastIndex = i;
      const match = number.exec(source);
      need(match, 'INVALID_SOURCE_JSON', 'The source contains an invalid number.');
      // An unquoted numeric object key is invalid JSON. Do not repair its syntax
      // while preserving numeric values; JSON.parse remains the grammar checker.
      const objectKey = stack.at(-1) === '{' && (previous === '{' || previous === ',');
      if (!objectKey) { parts.push(source.slice(start,i),'"',match[0],'"'); start = number.lastIndex; }
      i = number.lastIndex; previous = 'number'; continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
    if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') previous = ch;
    i++;
  }
  try { return JSON.parse(parts.length ? (parts.push(source.slice(start)),parts.join('')) : source); }
  catch (error) { throw Object.assign(new Error('The original JSON is invalid: ' + error.message), {code:'INVALID_SOURCE_JSON',status:400}); }
}
export function integer(value, label = 'source integer') {
  need(typeof value === 'string' && /^(0|[1-9]\d{0,38})$/.test(value),
    'INVALID_SOURCE_INTEGER', 'Keep ' + label + ' as an exact nonnegative integer.');
  return value;
}
function expandedDecimal(value) {
  need(typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value),
    'INVALID_SOURCE_AMOUNT', 'Keep source amounts as nonnegative decimal strings.');
  const [mantissa, exponentText = '0'] = value.toLowerCase().split('e');
  const exponent = Number(exponentText);
  need(Number.isInteger(exponent) && Math.abs(exponent) <= 40, 'SOURCE_AMOUNT_RANGE', 'The source decimal exponent is out of range.');
  const [whole, fraction = ''] = mantissa.split('.');
  let digits = whole + fraction, point = whole.length + exponent;
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return digits.slice(0,point) + '.' + digits.slice(point);
}
export function units(value, scale = 3) {
  const expanded = expandedDecimal(value), [whole, fraction = ''] = expanded.split('.');
  need(fraction.slice(scale).replace(/0/g,'') === '' && whole.replace(/^0+/,'').length <= 32,
    'SOURCE_AMOUNT_PRECISION', 'The source amount exceeds its declared precision.');
  return BigInt((whole.replace(/^0+(?=\d)/,'') || '0') + fraction.slice(0,scale).padEnd(scale,'0'));
}
export function decimal(value, scale = 3) {
  need(typeof value === 'bigint', 'DECIMAL_UNITS_REQUIRED', 'Use exact decimal units.');
  const negative = value < 0n, digits = (negative ? -value : value).toString().padStart(scale + 1,'0');
  const result = scale ? digits.slice(0,-scale) + '.' + digits.slice(-scale) : digits;
  return (negative ? '-' : '') + result;
}
export const sum = (rows, field, scale = 3) => decimal(rows.reduce((total,row) => total + units(row[field],scale),0n),scale);
export const rowKey = (table,row) => KEYS[table].map(key => String(row[key])).join(':');
const nullable = new Set(['contract_id','source_asset_issuer','dest_asset_issuer','memo_value']);
const intFields = new Set(['toid','certificate_id','retirement_id','vcs_project_id','block_start','block_end','sub_account_id','total_vintage_quantity','id','vcu_amount']);
const amountFields = new Set(['carbon_amount','amount_filled','source_asset_amount','dest_asset_amount']);
const dateFields = new Set(['created_at','retirement_date','issuance_date','vintage_start','vintage_end']);
export function normalizeRow(table, input) {
  need(TABLES[table], 'UNKNOWN_SOURCE_TABLE', 'Choose a native sc-audit table.');
  let row;
  if (Array.isArray(input)) {
    need(input.length === TABLES[table].length, 'SOURCE_COLUMN_COUNT',
      table + ' must have ' + TABLES[table].length + ' native columns per row.');
    row = Object.fromEntries(TABLES[table].map((name,index) => [name,input[index]]));
  } else {
    need(plain(input), 'INVALID_SOURCE_ROW', 'A source row must be an array or object.');
    need(TABLES[table].every(name => Object.hasOwn(input,name)), 'SOURCE_COLUMNS_MISSING', 'Keep all native ' + table + ' columns.');
    row = copy(input);
  }
  for (const name of TABLES[table]) {
    const value = row[name];
    if (nullable.has(name) && value === null) continue;
    if (name === 'finalized') need(typeof value === 'boolean','INVALID_SOURCE_STATUS','Keep the native finalized boolean.');
    else if (intFields.has(name)) integer(value, name);
    else if (amountFields.has(name)) units(value, name.includes('asset_amount') ? 7 : 3);
    else if (dateFields.has(name)) dayOf(value);
    else need(typeof value === 'string' && value.length <= 20000 && !value.includes('\0'),
      'INVALID_SOURCE_FIELD', 'Keep the native text for ' + table + '.' + name + '.');
  }
  for (const name of ['hash','serial_hash','transaction_hash','block_hash','sinking_tx_hash'])
    if (Object.hasOwn(row,name)) need(/^[a-fA-F0-9]{64}$/.test(row[name]),'INVALID_SOURCE_HASH','Use the original 64-character source hash.');
  return row;
}
export function parseTable(table, content) {
  need(typeof content === 'string', 'SOURCE_TABLE_REQUIRED', 'Supply all original ' + table + '.ndjson bytes.');
  const rows = [], seen = new Set();
  for (const [index,line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row;
    try { row = normalizeRow(table,parseNativeJSON(line)); }
    catch (error) { error.message = table + ' line ' + (index + 1) + ': ' + error.message; throw error; }
    const key = rowKey(table,row);
    need(!seen.has(key),'DUPLICATE_SOURCE_RECORD',table + ' has duplicate native key ' + key + '.');
    seen.add(key); rows.push(row);
  }
  return rows;
}
export function indexTables(tables) {
  return Object.fromEntries(Object.keys(TABLES).map(table =>
    [table,new Map((tables[table] || []).map(row => [rowKey(table,row),row]))]));
}
export function validateTables(tables, {format = 'native-backup'} = {}) {
  need(Object.keys(TABLES).every(table => Array.isArray(tables[table])), 'SOURCE_TABLES_MISSING', 'Receive all seven native tables together.');
  for (const table of Object.keys(TABLES)) {
    const seen = new Set();
    for (const row of tables[table]) {
      normalizeRow(table,row);
      const key = rowKey(table,row);
      need(!seen.has(key),'DUPLICATE_SOURCE_RECORD','Keep distinct native '+table+' records.');
      seen.add(key);
    }
  }
  const index = indexTables(tables), toids = new Set();
  for (const tx of tables.sinking_txs) {
    need(!toids.has(tx.toid),'DUPLICATE_SOURCE_TOID','Sinking TOIDs must be unique.');
    toids.add(tx.toid);
    if (format === 'native-backup') need(index.vcs_projects.has(tx.vcs_project_id),'SOURCE_PROJECT_MISSING','Receive the impact project referenced by ' + tx.hash + '.');
  }
  for (const row of tables.retirements)
    if (format === 'native-backup') need(index.vcs_projects.has(row.vcs_project_id),'SOURCE_PROJECT_MISSING','Receive every retirement impact project.');
  for (const row of tables.minted_blocks) {
    need(BigInt(row.block_end) >= BigInt(row.block_start),'INVALID_SOURCE_BLOCK','A minted block ends before it starts.');
    if (format === 'native-backup') need(index.vcs_projects.has(row.vcs_project_id),'SOURCE_PROJECT_MISSING','Receive every minted block project.');
  }
  const fills = new Map(), certificates = new Map(), blockRetirements = new Map();
  for (const row of tables.sink_status) {
    need(index.sinking_txs.has(row.sinking_tx_hash) && index.retirements.has(row.certificate_id),
      'SOURCE_RELATION_MISSING','Receive each sinking transaction and certificate referenced by its allocations.');
    const amount = units(row.amount_filled);
    fills.set(row.sinking_tx_hash,(fills.get(row.sinking_tx_hash) || 0n) + amount);
    certificates.set(row.certificate_id,(certificates.get(row.certificate_id) || 0n) + amount);
  }
  for (const [hash,amount] of fills) need(amount <= units(index.sinking_txs.get(hash).carbon_amount),
    'SOURCE_ALLOCATION_EXCEEDS_SINK','Retirement allocations exceed contribution ' + hash + '.');
  for (const [certificate,amount] of certificates) need(amount <= units(index.retirements.get(certificate).vcu_amount),
    'SOURCE_ALLOCATION_EXCEEDS_CERTIFICATE','Allocated contribution exceeds certificate ' + certificate + '.');
  for (const row of tables.retirement_from_block) {
    need(index.retirements.has(row.retirement_id) && (format !== 'native-backup' || index.minted_blocks.has(row.block_hash)),
      'SOURCE_BLOCK_RELATION_MISSING','Receive the source certificate and minted block.');
    blockRetirements.set(row.block_hash,(blockRetirements.get(row.block_hash) || 0n) + BigInt(row.vcu_amount));
  }
  if (format === 'native-backup') for (const [hash,amount] of blockRetirements) {
    const block = index.minted_blocks.get(hash);
    need(amount <= BigInt(block.block_end) - BigInt(block.block_start) + 1n,'SOURCE_BLOCK_OVERDRAWN','Retirements exceed the original minted block.');
  }
  return tables;
}
export function receiveBackup(files, metadata = {}) {
  need(plain(files) && Object.keys(TABLES).every(table => typeof files[table] === 'string'),
    'SOURCE_TABLES_MISSING','Choose all seven original sc-audit NDJSON files.');
  const tables = Object.fromEntries(Object.keys(TABLES).map(table => [table,parseTable(table,files[table])]));
  validateTables(tables);
  return {schema:SOURCE_SCHEMA,format:'native-backup',metadata:copy(metadata),files:copy(files),responses:[],tables};
}
export function sourceSummary(source) {
  const count = Object.fromEntries(Object.entries(source.tables).map(([table,rows]) => [table,rows.length]));
  const contributions = source.tables.sinking_txs, allocations = source.tables.sink_status;
  const filled = new Map();
  for (const row of allocations) filled.set(row.sinking_tx_hash,(filled.get(row.sinking_tx_hash) || 0n) + units(row.amount_filled));
  const carbon = contributions.reduce((total,row) => total + units(row.carbon_amount),0n);
  const retired = allocations.reduce((total,row) => total + units(row.amount_filled),0n);
  const dates = contributions.map(row => dayOf(row.created_at)).sort();
  return {counts:count,carbon:decimal(carbon),allocated:decimal(retired),remaining:decimal(carbon-retired),
    completeContributions:contributions.filter(row => (filled.get(row.hash) || 0n) === units(row.carbon_amount)).length,
    firstContribution:dates[0] || null,lastContribution:dates.at(-1) || null};
}
