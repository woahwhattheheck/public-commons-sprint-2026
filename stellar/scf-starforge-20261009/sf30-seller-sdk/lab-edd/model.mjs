// MIT. Source-bound review and complete native reissue for explicit laboratory EDD profiles.
import { createHash } from 'node:crypto';
import { decodeCsvFiles, headerKeys, writeDelimited, encodeText, labError } from './table.mjs';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const HASH = /^[0-9a-f]{64}$/;
export const LAB_SOURCE_SCHEMA = 'starforge.lab-edd-source.v1';
export const LAB_DECISIONS_SCHEMA = 'starforge.lab-edd-decisions.v1';
export const LAB_REVIEW_SCHEMA = 'starforge.lab-edd-review.v1';
export const canonicalJson = value => JSON.stringify(order(value));
function order(value) {
  if (Array.isArray(value)) return value.map(order);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, order(value[key])]));
  return value;
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys, label) => {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)))
    labError('SHAPE', 'Unexpected ' + label + ' field.');
};
export function safeSourceName(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(name) ||
      name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..'))
    labError('FILE_NAME', 'Use a relative original member name with no traversal components.');
  return name;
}
function checkedProfile(profile) {
  if (!plain(profile) || !/^[a-z][a-z0-9-]{1,79}$/.test(profile.id ?? '') ||
      typeof profile.version !== 'string' || !profile.version.length || profile.version.length > 80 ||
      typeof profile.analyze !== 'function' || typeof profile.decode !== 'function' && typeof profile.match !== 'function')
    labError('PROFILE', 'Select an installed, versioned source-format profile.');
  return profile;
}
function makeRow(table, record) {
  if (!plain(record) || !Array.isArray(record.fields) || record.fields.length !== table.headers.length ||
      record.fields.some(value => typeof value !== 'string') || !Number.isSafeInteger(record.rowNumber) || record.rowNumber < 2)
    labError('ROW', 'A decoded row must preserve every original cell and its worksheet or delimited row number.');
  if (record.cells !== undefined && (!Array.isArray(record.cells) || record.cells.length !== record.fields.length))
    labError('CELLS', 'Workbook cell provenance must match every original source cell.');
  const identity = [table.filename, table.sha256, table.origin?.sheetName ?? null, table.origin?.sheetIndex ?? null, record.rowNumber];
  const row = {
    recordId: 'row-' + sha256(canonicalJson(identity)).slice(0,32), rowNumber: record.rowNumber,
    ...(record.line === undefined ? {} : { line: record.line }), fields: [...record.fields],
    ...(record.cells === undefined ? {} : { cells: structuredClone(record.cells) }),
    values: Object.fromEntries(table.keys.map((key,index) => [key,record.fields[index]])),
  };
  row.rowSha256 = sha256(canonicalJson({ headers: table.headers, fields: row.fields, cells: row.cells ?? null }));
  return row;
}
function analyze(profile, source, tables) {
  const report = profile.analyze({ sourceSha256: source.sourceSha256, tables });
  if (!plain(report) || !plain(report.summary) || !Array.isArray(report.issues) || !Array.isArray(report.lineage ?? []))
    labError('PROFILE_RESULT', 'The selected profile must return a complete summary, issues and lineage.');
  const records = new Map(tables.flatMap(table => table.rows.map(row => [row.recordId, { row, table }])));
  for (const issue of report.issues) {
    if (!plain(issue) || typeof issue.code !== 'string' || !['error','review','info'].includes(issue.severity) ||
        typeof issue.message !== 'string' || !Array.isArray(issue.targets))
      labError('PROFILE_ISSUE', 'A profile issue must identify its actual source targets.');
    for (const target of issue.targets) {
      const found = records.get(target.recordId);
      if (!found || target.field !== undefined && !found.table.keys.includes(target.field))
        labError('PROFILE_TARGET', 'A profile issue refers to a missing original source field.');
    }
  }
  const counts = { error: 0, review: 0, info: 0 };
  for (const issue of report.issues) counts[issue.severity]++;
  return { ...report, lineage: report.lineage ?? [], counts,
    disposition: counts.error ? 'CORRECTION_REQUIRED' : counts.review ? 'REVIEW_REQUIRED' : 'PROFILE_CHECKS_COMPLETE' };
}
export async function inspectDelivery(files, profile, { encoding = 'utf-8', signal } = {}) {
  checkedProfile(profile); signal?.throwIfAborted();
  if (!Array.isArray(files) || !files.length || files.length > 128) labError('FILES', 'Supply between one and 128 complete original files.');
  const names = new Set(), originals = [];
  let total = 0;
  for (const input of files) {
    safeSourceName(input.filename);
    if (names.has(input.filename) || !(input.bytes instanceof Uint8Array)) labError('FILES', 'Original member names must be unique and retain actual bytes.');
    if ((total += input.bytes.byteLength) > 67108864) labError('SOURCE_SIZE', 'The complete decoded input exceeds the declared 64 MiB source allowance.');
    names.add(input.filename);
    const bytes = input.bytes;
    originals.push({ filename: input.filename, bytes, sha256: sha256(bytes),
      ...(input.mediaType ? { mediaType: input.mediaType } : {}) });
  }
  originals.sort((a,b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0);
  const manifest = originals.map(file => ({ filename: file.filename, bytes: file.bytes.byteLength, sha256: file.sha256,
    }));
  const binding = { profile: { id: profile.id, version: profile.version }, files: manifest,
    textEncoding: typeof profile.decode === 'function' ? null : encoding };
  const source = { schema: LAB_SOURCE_SCHEMA, ...binding, sourceSha256: sha256(canonicalJson(binding)) };
  let decoded = typeof profile.decode === 'function' ?
    await profile.decode({ files: originals, signal }) : decodeCsvFiles(originals, profile, { encoding });
  if (Array.isArray(decoded)) decoded = { tables: decoded, unassigned: [] };
  if (!plain(decoded) || !Array.isArray(decoded.tables) || !decoded.tables.length)
    labError('NO_TABLES', 'The selected profile found no complete source tables.');
  const tables = [], recordIds = new Set();
  let rowCount = 0;
  for (const original of decoded.tables) {
    signal?.throwIfAborted();
    const file = originals.find(item => item.filename === original.filename);
    if (!file || typeof original.id !== 'string' || !Array.isArray(original.headers) ||
        original.headers.some(value => typeof value !== 'string') || !Array.isArray(original.records))
      labError('TABLE', 'The decoded table must retain its original container and exact header cells.');
    const table = { id: original.id, filename: file.filename, sha256: file.sha256, bytes: file.bytes.byteLength,
      headers: [...original.headers], keys: original.keys === undefined ? headerKeys(original.headers) : [...original.keys],
      origin: structuredClone(original.origin ?? {}) };
    if (table.keys.length !== table.headers.length || table.keys.some(key => typeof key !== 'string' || !key || key.length > 1024) ||
        new Set(table.keys).size !== table.keys.length)
      labError('COLUMN_KEYS', 'Decoded worksheet columns need distinct stable field identifiers while their exact original headers remain retained.');
    table.rows = original.records.map(record => makeRow(table, record));
    rowCount += table.rows.length;
    if (rowCount > 100000) labError('ROW_COUNT', 'The delivery exceeds the declared 100,000-row review allowance.');
    for (const row of table.rows) {
      if (recordIds.has(row.recordId)) labError('ROW_IDENTITY', 'Two decoded rows share the same original file, sheet and row identity.');
      recordIds.add(row.recordId);
    }
    tables.push(table);
  }
  const unassigned = decoded.unassigned ?? [];
  if (!Array.isArray(unassigned)) labError('SOURCE_MEMBERS', 'Retain unmatched source members as explicit source observations.');
  const delivery = { source, tables, unassigned, originals, profile };
  delivery.report = analyze(profile, source, tables);
  return delivery;
}
export function normalizeDecisions(delivery, input) {
  if (input === undefined || input === null) input = {
    schema: LAB_DECISIONS_SCHEMA, sourceSha256: delivery.source.sourceSha256,
    profile: delivery.source.profile, decisions: [],
  };
  exact(input,['schema','sourceSha256','profile','decisions'],'decision document');
  exact(input.profile,['id','version'],'decision profile');
  if (input.schema !== LAB_DECISIONS_SCHEMA || !HASH.test(input.sourceSha256 ?? '') ||
      input.sourceSha256 !== delivery.source.sourceSha256 ||
      canonicalJson(input.profile) !== canonicalJson(delivery.source.profile))
    labError('SOURCE_CHANGED', 'The decision document belongs to a different original delivery or source format.');
  if (!Array.isArray(input.decisions) || input.decisions.length > 250000)
    labError('DECISION_COUNT', 'Use an explicit supported number of field decisions.');
  const records = new Map(delivery.tables.flatMap(table => table.rows.map(row => [row.recordId,{table,row}])));
  const seen = new Set(), decisions = [];
  for (const value of input.decisions) {
    exact(value,['recordId','rowSha256','field','before','action','value','reason'],'field decision');
    const found = records.get(value.recordId);
    if (!found || value.rowSha256 !== found.row.rowSha256 || !found.table.keys.includes(value.field) ||
        value.before !== found.row.values[value.field])
      labError('ROW_CHANGED', 'A decision must match its exact original row, field and value.', { recordId: value.recordId, field: value.field });
    const key = canonicalJson([value.recordId,value.field]);
    if (seen.has(key)) labError('DUPLICATE_DECISION', 'Choose one action for each source field.');
    seen.add(key);
    if (!['keep','set','clear'].includes(value.action) || typeof (value.reason ?? '') !== 'string' ||
        (value.reason ?? '').length > 24000 || value.action !== 'keep' && !(value.reason ?? '').trim())
      labError('DECISION', 'Changed fields need an explicit keep, set or clear action and a reason.');
    if (value.action === 'set' ? typeof value.value !== 'string' || value.value.length > 1048576 : own(value,'value'))
      labError('DECISION_VALUE', 'Set requires an exact string value. Keep and clear do not take a replacement value.');
    decisions.push({
      recordId: value.recordId, rowSha256: value.rowSha256, field: value.field, before: value.before,
      action: value.action, ...(value.action === 'set' ? { value: value.value } : {}), reason: value.reason ?? '',
    });
  }
  decisions.sort((a,b) => a.recordId.localeCompare(b.recordId,'en') || a.field.localeCompare(b.field,'en'));
  return { schema: LAB_DECISIONS_SCHEMA, sourceSha256: delivery.source.sourceSha256,
    profile: { ...delivery.source.profile }, decisions };
}
function preparedTables(delivery, document) {
  const byRow = new Map();
  for (const choice of document.decisions) {
    if (!byRow.has(choice.recordId)) byRow.set(choice.recordId,[]);
    byRow.get(choice.recordId).push(choice);
  }
  const tables = delivery.tables.map(table => ({ ...table, rows: table.rows.map(row => {
    const changes = byRow.get(row.recordId) ?? [];
    if (!changes.length) return row;
    const fields = [...row.fields];
    for (const choice of changes) {
      if (choice.action === 'set') fields[table.keys.indexOf(choice.field)] = choice.value;
      if (choice.action === 'clear') fields[table.keys.indexOf(choice.field)] = '';
    }
    return { ...row, fields, values: Object.fromEntries(table.keys.map((key,index) => [key,fields[index]])),
      sourceRowSha256: row.rowSha256, changes,
      rowSha256: sha256(canonicalJson({ headers: table.headers, fields, cells: row.cells ?? null })) };
  }) }));
  return tables;
}
export function previewDelivery(delivery, input) {
  const document = normalizeDecisions(delivery,input), tables = preparedTables(delivery,document);
  const report = analyze(delivery.profile,delivery.source,tables);
  const changed = document.decisions.filter(choice => choice.action === 'clear' ? choice.before !== '' :
    choice.action === 'set' && choice.value !== choice.before);
  const output = {
    schema: LAB_REVIEW_SCHEMA, source: delivery.source, document,
    documentSha256: sha256(canonicalJson(document)), tables, report, originalReport: delivery.report,
    changes: { decisions: document.decisions.length, changedFields: changed.length,
      changedRecords: new Set(changed.map(choice => choice.recordId)).size,
      keep: document.decisions.filter(choice => choice.action === 'keep').length,
      set: document.decisions.filter(choice => choice.action === 'set').length,
      clear: document.decisions.filter(choice => choice.action === 'clear').length },
  };
  output.reviewSha256 = sha256(canonicalJson({
    sourceSha256: delivery.source.sourceSha256, documentSha256: output.documentSha256,
    rows: tables.map(table => ({ filename: table.filename, section: table.id, rows: table.rows.map(row => row.rowSha256) })),
    report,
  }));
  return output;
}
export async function renderPreparedFiles(delivery, review, { signal } = {}) {
  if (review.source.sourceSha256 !== delivery.source.sourceSha256 ||
      review.documentSha256 !== sha256(canonicalJson(normalizeDecisions(delivery,review.document))))
    labError('REVIEW_CHANGED', 'Use the preview of the same source-bound decision document.');
  const tables = preparedTables(delivery,normalizeDecisions(delivery,review.document));
  let files;
  if (typeof delivery.profile.renderPrepared === 'function') {
    files = await delivery.profile.renderPrepared({ source: delivery.source, originals: delivery.originals,
      tables: tables, decisions: review.document.decisions, signal });
  } else {
    const tableByFile = new Map();
    for (const table of tables) {
      if (table.origin.format !== 'delimited' || tableByFile.has(table.filename))
        labError('NATIVE_WRITER', 'This source format requires its installed native receiving writer.');
      tableByFile.set(table.filename,table);
    }
    files = delivery.originals.map(file => {
      const table = tableByFile.get(file.filename);
      if (!table || !table.rows.some(row => row.changes?.some(choice => choice.action !== 'keep')))
        return { filename: file.filename, bytes: file.bytes, mediaType: file.mediaType ?? 'application/octet-stream' };
      const records = [table.headers], byNumber = new Map(table.rows.map(row => [row.rowNumber,row.fields]));
      let last = 1;
      for (const row of table.rows) if (row.rowNumber > last) last = row.rowNumber;
      for (const number of table.origin.blankRows ?? []) if (number > last) last = number;
      const blankRows = new Set(table.origin.blankRows ?? []);
      for (let number = 2; number <= last; number++) {
        if (byNumber.has(number)) records.push(byNumber.get(number));
        else if (blankRows.has(number)) records.push(table.headers.map(() => ''));
        else labError('ROW_ORDER', 'The original delimited row sequence is incomplete.');
      }
      const text = (table.origin.bom ? '\uFEFF' : '') + writeDelimited(records,table.origin.delimiter,table.origin.newline);
      return { filename: file.filename, bytes: encodeText(text,table.origin.encoding), mediaType: 'text/csv' };
    });
  }
  if (!Array.isArray(files) || !files.length || files.length > 128) labError('NATIVE_FILES', 'The native writer must produce a complete receiving file set.');
  const names = new Set();
  return files.map(file => {
    safeSourceName(file.filename);
    if (names.has(file.filename) || !(file.bytes instanceof Uint8Array)) labError('NATIVE_FILES', 'Prepared native members must be unique actual files.');
    names.add(file.filename); signal?.throwIfAborted();
    return { ...file, sha256: sha256(file.bytes), size: file.bytes.byteLength };
  });
}
export function compareDeliveries(current, baseline) {
  if (canonicalJson(current.source.profile) !== canonicalJson(baseline.source.profile))
    labError('COMPARE_PROFILE', 'Compare two deliveries using the same explicit source-format profile.');
  const keyFor = current.profile.recordKey;
  if (typeof keyFor !== 'function') return { disposition: 'NO_PROFILE_COMPARISON_KEY',
    currentSourceSha256: current.source.sourceSha256, baselineSourceSha256: baseline.source.sourceSha256 };
  const groups = delivery => {
    const out = new Map();
    for (const table of delivery.tables) for (const row of table.rows) {
      const key = canonicalJson([table.id,keyFor({ table, row })]);
      if (!out.has(key)) out.set(key,[]);
      out.get(key).push({ filename: table.filename, section: table.id, recordId: row.recordId,
        rowNumber: row.rowNumber, values: row.values, cells: row.cells ?? null });
    }
    return out;
  };
  const a=groups(baseline),b=groups(current), entries=[], counts={added:0,removed:0,unchanged:0,changed:0,ambiguous:0};
  for (const key of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const before=a.get(key)??[],after=b.get(key)??[];
    let status,fields=[];
    if(before.length>1||after.length>1) status='ambiguous';
    else if(!before.length) status='added';
    else if(!after.length) status='removed';
    else {
      fields=[...new Set([...Object.keys(before[0].values),...Object.keys(after[0].values)])]
        .filter(field=>before[0].values[field]!==after[0].values[field])
        .map(field=>({field,before:before[0].values[field]??null,after:after[0].values[field]??null}));
      status=fields.length||canonicalJson(before[0].cells)!==canonicalJson(after[0].cells)?'changed':'unchanged';
    }
    counts[status]++;entries.push({key:JSON.parse(key),status,before,after,fields});
  }
  return {disposition:'COMPLETE',currentSourceSha256:current.source.sourceSha256,
    baselineSourceSha256:baseline.source.sourceSha256,counts,entries};
}
