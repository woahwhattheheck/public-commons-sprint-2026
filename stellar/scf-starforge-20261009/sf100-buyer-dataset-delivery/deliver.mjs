// MIT. SF100 buyer delivery for original SF30 dataset-page.v1 responses.
// Never contacts a seller, signer, facilitator, wallet or payment service.
import { readFile, writeFile, mkdir, readdir, open, rm, stat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_INPUT = 2 * 1024 * 1024;
const MAX_PAGES = 4096;
const MAX_TOTAL_ROWS = 1_000_000;
const MAX_EXPORT = 256 * 1024 * 1024;
const MAX_ARCHIVE = 256 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
const RANGE_OPS = ['gt', 'gte', 'lt', 'lte'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const obj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const sha = x => createHash('sha256').update(x).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };
const safeInt = x => Number.isSafeInteger(x) && x >= 0;
const compact = x => JSON.stringify(x);
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pageName = n => String(n).padStart(5, '0') + '.json';
const message = x => process.stdout.write(JSON.stringify(x, null, 2) + '\n');

function argumentsOf(tokens) {
  const [command, ...tail] = tokens;
  need(['init', 'append', 'status', 'finalize'].includes(command),
    'Use init|append|status|finalize; see README.md');
  const args = { command };
  for (let i = 0; i < tail.length; i += 2) {
    need(/^--[a-z-]+$/.test(tail[i]) && tail[i + 1] !== undefined,
      'Expected --name value pairs');
    const key = tail[i].slice(2);
    need(['out', 'page', 'cursor', 'intent', 'evidence'].includes(key) && !own(args, key),
      'Unexpected or repeated option: ' + key);
    args[key] = tail[i + 1];
  }
  need(typeof args.out === 'string' && args.out.length > 0, '--out required');
  for (const option of Object.keys(args)) {
    if (option === 'out' || option === 'command') continue;
    need(command === 'append', 'Only append accepts --' + option);
  }
  if (command === 'append') {
    need(typeof args.page === 'string' && args.page.length > 0, '--page required');
    need(typeof args.intent === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(args.intent),
      'Stable independent original buyer intent --intent required');
  }
  return args;
}

async function bounded(path, limit = MAX_INPUT) {
  const file = await stat(path);
  need(file.isFile() && file.size <= limit, 'Input must be a regular file within byte limit');
  const raw = await readFile(path);
  need(raw.length <= limit, 'Input too large');
  return raw;
}

function checkPage(page) {
  need(obj(page) && page.schema === 'stellar-forge.dataset-page.v1',
    'Expected an ORIGINAL SF30 dataset-page.v1 response');
  const d = page.dataset;
  need(obj(d) && typeof d.name === 'string' && d.name.length > 0 &&
    typeof d.snapshot === 'string' && DIGEST.test(d.snapshot) &&
    safeInt(d.rowCount) && d.rowCount <= MAX_TOTAL_ROWS &&
    d.order === 'csv-record-order' && Array.isArray(d.columns),
    'Invalid ORIGINAL SF30 dataset metadata');
  need(d.columns.length > 0 && d.columns.length <= 64, 'Invalid source column count');
  const names = new Map();
  const advancedColumns = d.columns.some(col => obj(col) &&
    (own(col, 'rangeFilterable') || own(col, 'sortable')));
  for (const col of d.columns) {
    need(obj(col) && typeof col.name === 'string' && FIELD.test(col.name) &&
      !RESERVED.has(col.name) && !names.has(col.name) &&
      ['string', 'integer', 'number', 'boolean'].includes(col.type) &&
      typeof col.nullable === 'boolean' && typeof col.filterable === 'boolean' &&
      (!advancedColumns || (typeof col.rangeFilterable === 'boolean' &&
        typeof col.sortable === 'boolean' && !(col.rangeFilterable && col.type === 'boolean'))),
      'Invalid source column declaration');
    names.set(col.name, col);
  }
  const filterColumns = d.columns.filter(col => col.filterable).length;
  const rangeColumns = d.columns.filter(col => col.rangeFilterable).length;
  const sortColumns = d.columns.filter(col => col.sortable).length;
  need(filterColumns <= 8 && rangeColumns <= 8 && sortColumns <= 8 &&
    3 + filterColumns + 4 * rangeColumns + (sortColumns ? 1 : 0) <= 32,
    'Source dataset capabilities exceed original SF30 limits');
  need(Array.isArray(page.fields) && page.fields.length > 0 &&
    new Set(page.fields).size === page.fields.length && page.fields.every(x => names.has(x)),
    'Invalid requested field projection');
  need(obj(page.filters) && Object.keys(page.filters).length <= 8, 'Invalid filters');
  for (const [key, value] of Object.entries(page.filters)) {
    need(names.get(key)?.filterable && typed(value, names.get(key)), 'Invalid typed filter: ' + key);
  }
  const ranges = own(page, 'ranges') ? page.ranges : [];
  need(Array.isArray(ranges) && ranges.length <= 16 &&
    (!own(page, 'ranges') || ranges.length > 0), 'Invalid original range filters');
  const bounds = new Set();
  const triples = ranges.map(range => {
    need(obj(range) && Object.keys(range).sort().join(',') === 'column,operator,value',
      'Invalid original range declaration');
    const col = names.get(range.column);
    need(col?.rangeFilterable === true && col.type !== 'boolean' &&
      RANGE_OPS.includes(range.operator) && range.value !== null && typed(range.value, col),
      'Invalid typed or disabled range: ' + range.column);
    const bound = range.column + ':' + (range.operator.startsWith('g') ? 'lower' : 'upper');
    need(!bounds.has(bound), 'Duplicate or conflicting range bound: ' + range.column);
    bounds.add(bound);
    return [range.column, range.operator, range.value];
  }).sort(([a, ao], [b, bo]) => compareText(a, b) || RANGE_OPS.indexOf(ao) - RANGE_OPS.indexOf(bo));
  let order = null;
  if (own(page, 'order')) {
    const selected = page.order;
    need(obj(selected) && Object.keys(selected).sort().join(',') === 'column,direction,nulls,ties' &&
      names.get(selected.column)?.sortable === true && ['asc', 'desc'].includes(selected.direction) &&
      selected.nulls === 'last' && selected.ties === 'csv-record-order',
      'Invalid or disabled original source ordering');
    order = { column: selected.column, direction: selected.direction,
      nulls: 'last', ties: 'csv-record-order' };
  }
  const meta = page.page;
  need(obj(meta) && safeInt(meta.limit) && meta.limit > 0 && meta.limit <= 1000 &&
    safeInt(meta.total) && meta.total <= d.rowCount && safeInt(meta.returned) &&
    meta.returned <= meta.limit && Array.isArray(page.rows) &&
    page.rows.length === meta.returned &&
    (meta.nextCursor === null || typeof meta.nextCursor === 'string'),
    'Invalid original SF30 page bounds');
  for (const row of page.rows) {
    need(obj(row) && Object.keys(row).length === page.fields.length, 'Unexpected row columns');
    for (const field of page.fields)
      need(own(row, field) && typed(row[field], names.get(field)), 'Row type mismatch: ' + field);
  }
  const advanced = triples.length > 0 || order !== null;
  const query = { fields: page.fields,
    filters: Object.entries(page.filters).sort(([a], [b]) => compareText(a, b)),
    ...(advanced ? { ranges: triples, sort: order } : {}) };
  // Keep the original signature and cursor bytes when no advanced query is selected.
  const signature = [d, page.fields, page.filters, meta.total];
  if (advanced) signature.push({ ranges: triples, sort: order });
  return { signature: sha(compact(signature)),
    fields: page.fields, snapshot: d.snapshot, total: meta.total,
    name: d.name, filters: page.filters,
    ranges: triples.map(([column, operator, value]) => ({ column, operator, value })),
    order, query, queryHash: sha(compact(query)) };
}

function typed(value, col) {
  if (value === null) return col.nullable;
  if (col.type === 'string') return typeof value === 'string' && !(col.nullable && value === '');
  if (col.type === 'integer') return Number.isSafeInteger(value);
  if (col.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
}

function checkCursor(text, snapshot, q, offset) {
  need(typeof text === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(text),
    'Invalid original SF30 cursor encoding');
  const bytes = Buffer.from(text, 'base64url');
  need(bytes.toString('base64url') === text, 'Noncanonical source cursor');
  const c = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  need(obj(c) && Object.keys(c).sort().join(',') === 'n,q,s,v' &&
    c.v === 1 && c.s === snapshot && c.q === q && c.n === offset,
    'Original SF30 cursor is not bound to this snapshot/query/page boundary');
}

function continuation(state, payload, requestCursor) {
  const check = checkPage(payload);
  if (state.pages.length === 0) {
    need(requestCursor === null, 'First page must have no request cursor');
  } else {
    need(state.nextCursor !== null, 'Original source pagination is already complete');
    need(requestCursor === state.nextCursor && check.signature === state.pages[0].signature,
      'Page query, snapshot or request cursor drift');
  }
  const count = state.count + payload.rows.length;
  need(count <= check.total, 'Page overruns original total');
  need(payload.rows.length === Math.min(payload.page.limit, check.total - state.count),
    'Returned rows differ from the original query page boundary');
  const nextCursor = payload.page.nextCursor;
  if (nextCursor !== null) {
    need(count < check.total && payload.rows.length > 0,
      'Page cursor continues past final row or fails to advance');
    checkCursor(nextCursor, check.snapshot, check.queryHash, count);
  } else need(count === check.total, 'Original source ended pagination prematurely');
  let exportBytes = state.exportBytes + (state.pages.length === 0
    ? Buffer.byteLength(check.fields.map(csvCell).join(',') + '\r\n') : 0);
  for (const row of payload.rows) {
    exportBytes += Buffer.byteLength(JSON.stringify(row) + '\n') +
      Buffer.byteLength(check.fields.map(field => csvCell(row[field])).join(',') + '\r\n');
    need(exportBytes <= MAX_EXPORT, 'Dataset exceeds combined private CSV/JSONL output byte limit');
  }
  return { check, count, nextCursor, exportBytes };
}

function acceptRecord(state, archive, next, archiveBytes, retainPayload) {
  const { check } = next;
  Object.assign(state, { count: next.count, total: check.total, name: check.name,
    snapshot: check.snapshot, fields: check.fields, filters: check.filters,
    ranges: check.ranges, order: check.order, queryHash: check.queryHash,
    nextCursor: next.nextCursor, exportBytes: next.exportBytes,
    chain: archive.chain, archiveBytes: state.archiveBytes + archiveBytes });
  if (retainPayload) state.pages.push(archive);
  else {
    state.pages.push({ schema: archive.schema, index: archive.index, previous: archive.previous,
      intent: archive.intent, requestCursor: archive.requestCursor,
      sourceSha256: archive.sourceSha256, evidenceSha256: archive.evidenceSha256,
      signature: archive.signature, chain: archive.chain, returned: archive.payload.page.returned });
  }
}

async function readArchive(out, index) {
  const filename = pageName(index);
  const bytes = await bounded(join(out, 'pages', filename), MAX_INPUT + 4096);
  const archive = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  need(obj(archive) && archive.schema === 'stellar-forge.buyer-page-archive.v1',
    'Invalid private page archive: ' + filename);
  const { chain, ...record } = archive;
  need(typeof chain === 'string' && chain === sha(compact(record)) && record.index === index &&
    typeof record.intent === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(record.intent) &&
    typeof record.sourceSha256 === 'string' && DIGEST.test(record.sourceSha256) &&
    (record.evidenceSha256 === null || DIGEST.test(record.evidenceSha256)),
    'Page archive custody mismatch: ' + filename);
  return { archive, bytes: bytes.length };
}

async function scan(out, { retainPayload = true } = {}) {
  for (const dir of [out, join(out, 'pages')]) {
    const info = await stat(dir);
    need(info.isDirectory() && (process.platform === 'win32' || (info.mode & 0o077) === 0),
      'Buyer delivery session requires private directories (0700)');
  }
  const session = JSON.parse((await bounded(join(out, 'session.json'), 4096)).toString('utf8'));
  need(obj(session) && session.schema === 'stellar-forge.buyer-delivery.v1', 'Invalid private session');
  const files = (await readdir(join(out, 'pages'))).sort();
  need(files.length <= MAX_PAGES && files.every((x, i) => x === pageName(i)),
    'Page directory must contain contiguous append-only numbered records');
  const state = { out, session, pages: [], count: 0, total: null, name: null,
    snapshot: null, fields: null, filters: null, ranges: [], order: null, queryHash: null,
    nextCursor: null, chain: null, archiveBytes: 0, exportBytes: 0,
    finalized: (await readdir(out)).includes('manifest.json') };
  const intents = new Set(), sourceHashes = new Set();
  for (let i = 0; i < files.length; i++) {
    const { archive, bytes } = await readArchive(out, i);
    need(state.archiveBytes + bytes <= MAX_ARCHIVE, 'Private page archive exceeds total byte limit');
    need(archive.previous === state.chain, 'Page archive chain mismatch: ' + files[i]);
    need(!intents.has(archive.intent) && !sourceHashes.has(archive.sourceSha256),
      'Duplicate buyer intent or source payload');
    intents.add(archive.intent); sourceHashes.add(archive.sourceSha256);
    const next = continuation(state, archive.payload, archive.requestCursor);
    need(archive.signature === next.check.signature, 'Recorded page query signature differs from source');
    acceptRecord(state, archive, next, bytes, retainPayload);
  }
  return state;
}

async function init(out) {
  await mkdir(out, { mode: 0o700 });
  await mkdir(join(out, 'pages'), { mode: 0o700 });
  await writeFile(join(out, 'session.json'), JSON.stringify({
    schema: 'stellar-forge.buyer-delivery.v1', protocol: 'SF30 dataset-page.v1',
    authorization: 'EACH_PAGE_REQUIRES_INDEPENDENT_ORIGINAL_BUYER_APPROVAL',
  }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { action: 'INITIALIZED', directory: out };
}

async function append(out, args) {
  return { ...await appendMany(out, [args]), action: 'PAGE_ACCEPTED' };
}

async function appendMany(out, inputs) {
  need(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= MAX_PAGES,
    'Supply one or more independently approved page inputs within the page limit');
  const state = await scan(out, { retainPayload: false });
  need(!state.finalized && state.pages.length + inputs.length <= MAX_PAGES,
    'Session already finalized or page limit reached');
  const intents = new Set(state.pages.map(page => page.intent));
  const sourceHashes = new Set(state.pages.map(page => page.sourceSha256));
  for (const args of inputs) {
    need(obj(args) && typeof args.page === 'string' && args.page.length > 0 &&
      typeof args.intent === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(args.intent),
      'Page path and stable independent original buyer intent required');
    need(state.pages.length === 0 ? args.cursor === undefined : args.cursor === state.nextCursor,
      'Supply exactly the previous original page.nextCursor as --cursor');
    need(!intents.has(args.intent), 'Buyer intent already recorded');
    const source = await bounded(resolve(args.page));
    const payload = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(source));
    // Validate the complete next-page transition before creating its archive.
    const next = continuation(state, payload, args.cursor ?? null);
    const evidenceSha256 = args.evidence ? sha(await bounded(resolve(args.evidence))) : null;
    const sourceSha256 = sha(source);
    need(!sourceHashes.has(sourceSha256), 'Page payload already recorded');
    const record = { schema: 'stellar-forge.buyer-page-archive.v1',
      index: state.pages.length, previous: state.chain, intent: args.intent,
      requestCursor: args.cursor ?? null, sourceSha256, evidenceSha256,
      signature: next.check.signature, payload };
    const archive = { ...record, chain: sha(compact(record)) };
    const encoded = JSON.stringify(archive) + '\n';
    const archiveBytes = Buffer.byteLength(encoded);
    need(archiveBytes <= MAX_INPUT + 4096 && state.archiveBytes + archiveBytes <= MAX_ARCHIVE,
      'Private page archive exceeds individual or total byte limit');
    const path = join(out, 'pages', pageName(state.pages.length));
    await writeFile(path, encoded, { mode: 0o600, flag: 'wx' });
    acceptRecord(state, archive, next, archiveBytes, false);
    intents.add(args.intent); sourceHashes.add(sourceSha256);
  }
  const current = await scan(out, { retainPayload: false });
  return summary(current, 'PAGES_ACCEPTED');
}

function summary(state, action) {
  return { action, dataset: state.name, snapshot: state.snapshot,
    pages: state.pages.length, rows: state.count, total: state.total,
    complete: state.pages.length > 0 && state.nextCursor === null,
    nextCursor: state.nextCursor, finalized: state.finalized,
    lastRecordDigest: state.chain };
}

function csvCell(value) {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[\x00-\x20]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const escapeHtml = x => String(x).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
function html(state, manifest) {
  const details = [
    ['Dataset', state.name], ['Snapshot', state.snapshot], ['Rows', state.count],
    ['Pages', state.pages.length], ['Original response chain', state.chain],
    ['Selected fields', state.fields.join(', ')], ['Equality filters', compact(state.filters)],
    ['Range filters', compact(state.ranges)],
    ['Result order', state.order ? compact(state.order) : 'csv-record-order'],
    ['Original query hash', state.queryHash],
    ['Data files', 'dataset.jsonl · dataset.csv'],
    ['Acceptance', 'Operator review only; source response and digest are not chain finality'],
  ];
  const lines = details.map(([k, v]) => '<div><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd></div>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Buyer dataset delivery review</title><style>body{margin:0;background:#f7f7f7;color:#182026;font:15px system-ui,Arial}' +
    'main{max-width:920px;margin:52px auto;padding:28px;background:white;border:1px solid #cbd2d6}' +
    'h1{font-size:24px;font-weight:650;margin:5px 0 4px}small{color:#56636b}dl{display:grid;grid-template-columns:1fr 1fr;gap:13px}' +
    'dl div{border-top:1px solid #dce0e3;padding:12px 4px}dt{color:#56636b;font-size:12px;text-transform:uppercase;letter-spacing:.05em}' +
    'dd{margin:6px 0;overflow-wrap:anywhere}p{line-height:1.55}.foot{border-top:1px solid #dce0e3;padding-top:16px;color:#56636b}</style>' +
    '<main><small>STELLAR FORGE / SF100 / PRIVATE BUYER REVIEW</small><h1>Dataset delivery package</h1>' +
    '<p>Original SF30 paginated response files were stitched in their original response order, including any selected sort. Review the query below, the local manifest and each independent SF88 buyer operation before commercial use.</p>' +
    '<dl>' + lines + '</dl><p class="foot">Hashes establish local source custody, not seller identity, accepted payment, transfer finality, contract, or revenue. CSV strings with spreadsheet formula prefixes are neutralized. JSONL preserves typed source rows.</p></main></html>';
}

async function finalize(out) {
  const state = await scan(out, { retainPayload: false });
  need(!state.finalized && state.pages.length > 0 && state.nextCursor === null &&
    state.count === state.total, 'All original pages must be present and not yet finalized');
  const files = ['dataset.jsonl', 'dataset.csv', 'review.html', 'manifest.json'];
  need(!(await readdir(out)).some(f => files.includes(f)), 'A prior export exists');
  const jsonPath = join(out, files[0]), csvPath = join(out, files[1]);
  let jsonHandle, csvHandle, jsonBytes = 0, csvBytes = 0;
  const created = [];
  const jsonDigest = createHash('sha256'), csvDigest = createHash('sha256');
  async function createOutput(path) {
    const handle = await open(path, 'wx', 0o600);
    try {
      const info = await handle.stat();
      created.push({ path, dev: info.dev, ino: info.ino });
      return handle;
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }
  async function writeOutput(path, content) {
    const handle = await createOutput(path);
    try { await handle.writeFile(content, { encoding: 'utf8' }); }
    finally { await handle.close(); }
  }
  try {
    jsonHandle = await createOutput(jsonPath);
    csvHandle = await createOutput(csvPath);
    async function push(handle, digest, content, kind) {
      const size = Buffer.byteLength(content);
      if (kind === 'json') jsonBytes += size; else csvBytes += size;
      need(jsonBytes + csvBytes <= MAX_EXPORT, 'Export exceeds private output byte limit');
      digest.update(content); await handle.writeFile(content, { encoding: 'utf8' });
    }
    await push(csvHandle, csvDigest, state.fields.map(csvCell).join(',') + '\r\n', 'csv');
    for (const expected of state.pages) {
      const { archive } = await readArchive(out, expected.index);
      need(archive.chain === expected.chain && archive.previous === expected.previous,
        'Page archive changed after delivery review: ' + pageName(expected.index));
      const rows = archive.payload.rows;
      await push(jsonHandle, jsonDigest, rows.map(x => JSON.stringify(x) + '\n').join(''), 'json');
      await push(csvHandle, csvDigest,
        rows.map(row => state.fields.map(f => csvCell(row[f])).join(',') + '\r\n').join(''), 'csv');
    }
    await jsonHandle.close(); jsonHandle = null;
    await csvHandle.close(); csvHandle = null;
    const manifest = {
      schema: 'stellar-forge.buyer-delivery-manifest.v1',
      dataset: { name: state.name, snapshot: state.snapshot, rows: state.count,
        projectedFields: state.fields, filters: state.filters, ranges: state.ranges,
        order: state.order ?? 'csv-record-order', originalQueryHash: state.queryHash,
        originalQuerySignature: state.pages[0].signature },
      sourcePages: state.pages.map(x => ({index: x.index, intent: x.intent,
        sourceSha256: x.sourceSha256, evidenceSha256: x.evidenceSha256,
        recordDigest: x.chain, rows: x.returned,
        requestedCursor: x.requestCursor})),
      chainDigest: state.chain,
      outputs: { 'dataset.jsonl': {sha256:jsonDigest.digest('hex'), bytes:jsonBytes},
        'dataset.csv': {sha256:csvDigest.digest('hex'), bytes:csvBytes} },
      paymentStatus: 'NOT_INFERRED_FROM_SOURCE_HTTP_OR_LOCAL_HASHES',
      nextStep: 'Owner reviews independent original SF88 evidence and settlement before any paid-delivery claim',
    };
    const review = html(state, manifest);
    await writeOutput(join(out, 'review.html'), review);
    manifest.outputs['review.html'] = { sha256:sha(review), bytes:Buffer.byteLength(review) };
    await writeOutput(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { ...summary(state, 'EXPORTED'), output:out, outputs:manifest.outputs };
  } catch (error) {
    if (jsonHandle) await jsonHandle.close().catch(() => {});
    if (csvHandle) await csvHandle.close().catch(() => {});
    for (const file of created) {
      const current = await lstat(file.path).catch(() => null);
      // A competing finalizer's EEXIST must never delete its output. A replaced
      // path likewise belongs to another writer, even if we created the old one.
      if (current?.isFile() && !current.isSymbolicLink() &&
          current.dev === file.dev && current.ino === file.ino)
        await rm(file.path, { force:true }).catch(() => {});
    }
    throw error;
  }
}

export { init, append, appendMany, scan, finalize, checkPage, checkCursor };
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = argumentsOf(process.argv.slice(2));
    const out = resolve(args.out);
    if (args.command === 'init') message(await init(out));
    if (args.command === 'append') message(await append(out, args));
    if (args.command === 'status') message(summary(await scan(out, { retainPayload: false }), 'STATUS'));
    if (args.command === 'finalize') message(await finalize(out));
  } catch (error) {
    process.stderr.write('SF100: ' + error.message + '\n'); process.exitCode = 1;
  }
}
