// MIT. Portable review tables, native XLSX and lossless workspace handoff.
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { csv } from './table.mjs';

const STATE_SCHEMA = 'oregon-deq.trace-workbench.v1';
const BUNDLE_SCHEMA = 'oregon-deq.trace-workbench.export.v1';
const SOURCE_SCHEMA = 'oregon-deq.trace-workbench.sources.v1';
export const BUNDLE_LIMITS = Object.freeze({
  archiveBytes: 256 * 1024 * 1024,
  expandedBytes: 512 * 1024 * 1024,
  entryBytes: 256 * 1024 * 1024,
  entries: 4096,
});
const SHA = /^[a-f0-9]{64}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const items = (value) => Array.isArray(value) ? value : [];
const pairs = (value) => object(value) ? Object.entries(value) : [];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new TypeError('Trace handoff: ' + message); };
const cell = (value) => value === undefined || value === null ? '' :
  typeof value === 'object' ? JSON.stringify(value) : String(value);
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const table = (name, columns, rows) => ({ name, columns, rows });

function snapshot(state, report) {
  if (!object(state) || state.schema !== STATE_SCHEMA || !Array.isArray(state.imports) ||
      !object(state.reviews) || typeof state.id !== 'string' || !state.id ||
      !Number.isSafeInteger(state.revision) || !Number.isSafeInteger(state.dataRevision)) {
    fail('a complete portable workspace state is required');
  }
  if (!object(report) || !object(report.summary) ||
      !Number.isSafeInteger(report.summary.errors) || report.summary.errors < 0 ||
      report.revision !== state.revision || report.asOf !== state.asOf ||
      report.maxAgeDays !== state.maxAgeDays) {
    fail('report must describe this exact workspace revision and audit settings');
  }
  if (report.summary.errors === 0 && !object(report.data)) {
    fail('a valid report must contain its normalized graph');
  }
}

function recordTable(name, records, firstColumns) {
  const extra = new Set();
  for (const record of records) for (const key of Object.keys(record || {})) extra.add(key);
  for (const key of firstColumns) extra.delete(key);
  return table(name, [...firstColumns, ...[...extra].sort(compare)], records);
}

/** Every row is an object keyed by its corresponding column names. */
export function exportTables({ state, report }) {
  snapshot(state, report);
  const overview = [
    ['workspaceId', state.id], ['title', state.title], ['schema', state.schema],
    ['revision', state.revision], ['dataRevision', state.dataRevision],
    ['updatedAt', state.updatedAt], ['updatedBy', state.updatedBy],
    ['asOf', report.asOf], ['maxAgeDays', report.maxAgeDays],
    ['normalizedGraphIncluded', report.summary.errors === 0],
  ].map(([metric, value]) => ({ metric, value }));
  for (const [key, value] of pairs(report.summary)) overview.push({ metric: 'summary.' + key, value });
  for (const [key, value] of pairs(report.counts)) overview.push({ metric: 'counts.' + key, value });

  const imports = [], mappings = [], valueMaps = [], corrections = [], exclusions = [];
  for (const source of state.imports) {
    imports.push({
      importId: source.id, kind: source.kind, part: source.part, fileName: source.fileName,
      sha256: source.sha256, format: source.format, enabled: source.enabled,
      enabledNote: source.enabledNote, rowCount: source.rowCount, columns: source.columns,
    });
    for (const [field, column] of pairs(source.mapping)) mappings.push({ importId: source.id, field, column });
    for (const [field, choices] of pairs(source.valueMaps)) {
      for (const [suppliedValue, canonicalValue] of pairs(choices)) {
        valueMaps.push({ importId: source.id, field, suppliedValue, canonicalValue });
      }
    }
    for (const [row, changes] of pairs(source.corrections)) {
      const note = source.correctionNotes?.[row] || {};
      for (const [field, value] of pairs(changes)) {
        corrections.push({ importId: source.id, row, field, value, reason: note.reason, actor: note.actor, at: note.at });
      }
    }
    for (const [row, note] of pairs(source.excluded)) {
      exclusions.push({ importId: source.id, row, reason: note?.reason, actor: note?.actor, at: note?.at });
    }
  }

  const branchRows = [], branchMembers = [];
  for (const branch of items(report.branches)) {
    branchRows.push({
      productId: branch.productId, allProductLinks: branch.allProductLinks,
      disconnectedLinks: branch.disconnectedLinks, missingRiskPairs: branch.missingRiskPairs,
      recentSourceLinks: branch.recentSourceLinks,
      upstreamNodes: items(branch.upstreamNodeIds).length,
      upstreamLinks: items(branch.upstreamLinkIds).length,
      cyclicNodes: items(branch.cyclicNodes).length,
      untracedEndpoints: items(branch.untracedEndpoints).length,
      extractionReachableNodes: items(branch.extractionReachableNodes).length,
    });
    for (const relation of ['upstreamNodeIds', 'upstreamLinkIds', 'cyclicNodes', 'untracedEndpoints', 'extractionReachableNodes']) {
      items(branch[relation]).forEach((entityId, index) => branchMembers.push({
        productId: branch.productId, relation, position: index + 1, entityId,
      }));
    }
  }

  const issues = [], issueSources = [], issueKeys = new Set();
  for (const issue of items(report.issues)) {
    issueKeys.add(issue.key);
    const review = issue.review || {};
    issues.push({
      key: issue.key, code: issue.code, severity: issue.severity, target: issue.target,
      kind: issue.kind, entityId: issue.entityId, productId: issue.productId,
      nodeId: issue.nodeId, category: issue.category, message: issue.message,
      sourceRows: issue.sourceRows,
      reviewStatus: review.status, reviewNote: review.note, reviewActor: review.actor,
      reviewAt: review.at, reviewDataRevision: review.dataRevision,
      reviewStale: issue.review ? (review.stale ?? review.dataRevision !== state.dataRevision) : '',
    });
    items(issue.sourceRows).forEach((source, index) => issueSources.push({
      issueKey: issue.key, position: index + 1, importId: source?.importId,
      fileName: source?.fileName, sha256: source?.sha256, row: source?.row,
      line: source?.line, kind: source?.kind, entityId: source?.entityId, sourceReference: source,
    }));
  }
  const reviews = pairs(state.reviews).map(([key, review]) => ({
    key, status: review?.status, note: review?.note, actor: review?.actor, at: review?.at,
    revision: review?.revision, dataRevision: review?.dataRevision,
    stale: review?.dataRevision !== state.dataRevision,
    issuePresent: issueKeys.has(key),
  }));

  const auditProducts = items(report.audit?.products);
  const selectedPath = [], missingRisk = [];
  for (const product of auditProducts) {
    for (const [field, kind] of [['sourceToMarketNodes', 'node'], ['sourceToMarketEdges', 'link']]) {
      items(product[field]).forEach((entityId, index) => selectedPath.push({
        productId: product.productId, kind, position: index + 1, entityId,
      }));
    }
    for (const risk of items(product.missingRiskRecords)) {
      missingRisk.push({ productId: product.productId, nodeId: risk.nodeId, category: risk.category });
    }
  }

  const data = object(report.data) ? report.data : {};
  const evidence = [];
  for (const [kind, records] of [['link', items(data.links)], ['risk', items(data.risks)]]) {
    for (const record of records) items(record.evidence).forEach((source, index) => evidence.push({
      kind, entityId: record.id, nodeId: record.nodeId, category: record.category,
      position: index + 1, source: source?.source, observedAt: source?.observedAt, record: source,
    }));
  }

  return [
    table('overview', ['metric', 'value'], overview),
    table('imports', ['importId', 'kind', 'part', 'fileName', 'sha256', 'format', 'enabled', 'enabledNote', 'rowCount', 'columns'], imports),
    table('field_mappings', ['importId', 'field', 'column'], mappings),
    table('value_mappings', ['importId', 'field', 'suppliedValue', 'canonicalValue'], valueMaps),
    table('corrections', ['importId', 'row', 'field', 'value', 'reason', 'actor', 'at'], corrections),
    table('exclusions', ['importId', 'row', 'reason', 'actor', 'at'], exclusions),
    recordTable('source_rows', items(report.rows), ['importId', 'fileName', 'sha256', 'row', 'line', 'kind', 'entityId', 'status', 'reason', 'corrected']),
    table('branch_summary', ['productId', 'allProductLinks', 'disconnectedLinks', 'missingRiskPairs', 'recentSourceLinks', 'upstreamNodes', 'upstreamLinks', 'cyclicNodes', 'untracedEndpoints', 'extractionReachableNodes'], branchRows),
    table('branch_members', ['productId', 'relation', 'position', 'entityId'], branchMembers),
    table('issues', ['key', 'code', 'severity', 'target', 'kind', 'entityId', 'productId', 'nodeId', 'category', 'message', 'sourceRows', 'reviewStatus', 'reviewNote', 'reviewActor', 'reviewAt', 'reviewDataRevision', 'reviewStale'], issues),
    table('issue_sources', ['issueKey', 'position', 'importId', 'fileName', 'sha256', 'row', 'line', 'kind', 'entityId', 'sourceReference'], issueSources),
    table('reviews', ['key', 'status', 'note', 'actor', 'at', 'revision', 'dataRevision', 'stale', 'issuePresent'], reviews),
    recordTable('carried_reviews', items(report.carriedReviews), ['key', 'status', 'note', 'actor', 'at', 'revision', 'dataRevision', 'state']),
    recordTable('selected_path_audit', auditProducts, ['productId', 'name', 'pathStatus', 'acceptance', 'riskPairsWithRecentRecords', 'requiredRiskPairsOnSelectedPath', 'sourceToMarketNodes', 'sourceToMarketEdges', 'missingRiskRecords']),
    table('selected_path_members', ['productId', 'kind', 'position', 'entityId'], selectedPath),
    table('selected_missing_risk', ['productId', 'nodeId', 'category'], missingRisk),
    recordTable('mapped_products', items(data.products), ['id', 'name', 'destinationNode']),
    recordTable('mapped_nodes', items(data.nodes), ['id', 'stage']),
    recordTable('mapped_links', items(data.links), ['id', 'productId', 'from', 'to', 'evidence']),
    recordTable('mapped_risks', items(data.risks), ['nodeId', 'category', 'disposition', 'evidence']),
    table('mapped_evidence', ['kind', 'entityId', 'nodeId', 'category', 'position', 'source', 'observedAt', 'record'], evidence),
  ];
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function safePath(name) {
  if (typeof name !== 'string' || !name || name.length > 512 || /[\\:\u0000-\u001f\u007f]/.test(name) ||
      name.startsWith('/') || name.split('/').some((part) =>
        !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    fail('unsafe ZIP entry path');
  }
  return name;
}

function zip(entries) {
  const local = [], central = [], names = new Set();
  let offset = 0, expanded = 0, count = 0;
  for (const entry of entries) {
    const name = safePath(entry.name), folded = name.toLowerCase();
    if (names.has(folded)) fail('repeated ZIP entry path: ' + name);
    names.add(folded);
    const raw = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes, 'utf8');
    expanded += raw.length;
    count++;
    if (count > BUNDLE_LIMITS.entries || raw.length > BUNDLE_LIMITS.entryBytes || expanded > BUNDLE_LIMITS.expandedBytes) {
      fail('export exceeds the documented ZIP entry or expanded-size limit');
    }
    const compressed = entry.compress === false || raw.length < 64 ? raw : deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const body = useDeflate ? compressed : raw, method = useDeflate ? 8 : 0, crc = crc32(raw);
    const encoded = Buffer.from(name, 'utf8');
    if (encoded.length > 65535) fail('ZIP filename is too long');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(encoded.length, 26);
    local.push(header, encoded, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE((3 << 8) | 20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(encoded.length, 28);
    directory.writeUInt32LE((0x8180 << 16) >>> 0, 38); // Regular file, mode 0600.
    directory.writeUInt32LE(offset, 42);
    central.push(directory, encoded);
    offset += header.length + encoded.length + body.length;
    if (offset > BUNDLE_LIMITS.archiveBytes) fail('export exceeds the documented ZIP archive-size limit');
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  if (offset + directory.length + end.length > BUNDLE_LIMITS.archiveBytes) fail('ZIP archive exceeds the documented size limit');
  return Buffer.concat([...local, directory, end], offset + directory.length + end.length);
}

const xml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function xmlCell(value) {
  const text = cell(value).replace(/_x[0-9a-f]{4}_/gi, (match) => '_x005F_' + match.slice(1));
  let escaped = '';
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff && i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      escaped += text[i] + text[++i];
    } else if ((n < 32 && n !== 9 && n !== 10 && n !== 13) ||
               (n >= 0xd800 && n <= 0xdfff) || n === 0xfffe || n === 0xffff) {
      escaped += '_x' + n.toString(16).toUpperCase().padStart(4, '0') + '_';
    } else {
      escaped += n === 13 ? '&#13;' : xml(text[i]);
    }
  }
  return escaped;
}
function columnName(index) {
  let output = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) {
    output = String.fromCharCode(65 + (value - 1) % 26) + output;
  }
  return output;
}
function splitText(value) {
  const chunks = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 30000, value.length);
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff &&
        value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end--;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}
function workbookTables(tables) {
  const overflow = [], output = [];
  let reference = 0;
  for (const source of tables) {
    if (source.columns.length > 16384) fail('workbook has too many columns');
    const rows = source.rows.map((row, index) => {
      let result = row;
      for (const column of source.columns) {
        const value = cell(row[column]);
        if (value.length <= 32767) continue;
        if (result === row) result = { ...row };
        const id = String(++reference), chunks = splitText(value);
        result[column] = 'Complete value in text_overflow, reference ' + id + ' (' + value.length + ' UTF-16 code units)';
        chunks.forEach((text, part) => overflow.push({
          reference: id, table: source.name, row: index + 2, column, part: part + 1, parts: chunks.length, text,
        }));
      }
      return result;
    });
    output.push({ ...source, rows });
  }
  if (overflow.length) output.push(table('text_overflow', ['reference', 'table', 'row', 'column', 'part', 'parts', 'text'], overflow));
  const sheets = [], names = new Set();
  for (const source of output) {
    const count = Math.max(1, Math.ceil(source.rows.length / 1048575));
    for (let part = 0; part < count; part++) {
      const suffix = count === 1 ? '' : '_' + (part + 1);
      const name = source.name.slice(0, 31 - suffix.length) + suffix;
      if (names.has(name.toLowerCase())) fail('duplicate worksheet name');
      names.add(name.toLowerCase());
      sheets.push({ name, columns: source.columns, rows: source.rows.slice(part * 1048575, (part + 1) * 1048575) });
    }
  }
  return sheets;
}
function worksheet(source) {
  const last = columnName(source.columns.length - 1) + (source.rows.length + 1);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<dimension ref="A1:' + last + '"/>',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="15"/>',
    '<cols><col min="1" max="' + source.columns.length + '" width="30" customWidth="1"/></cols><sheetData>',
  ];
  function rowXml(values, row, style) {
    return '<row r="' + row + '">' + values.map((value, index) =>
      '<c r="' + columnName(index) + row + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlCell(value) + '</t></is></c>').join('') + '</row>';
  }
  lines.push(rowXml(source.columns, 1, 1));
  source.rows.forEach((row, index) => lines.push(rowXml(source.columns.map((column) => row[column]), index + 2, 2)));
  lines.push('</sheetData><autoFilter ref="A1:' + last + '"/></worksheet>');
  return Buffer.from(lines.join(''), 'utf8');
}

function makeWorkbook(tables) {
  const sheets = workbookTables(tables);
  const base = 'http://schemas.openxmlformats.org/';
  const entries = [
    { name: '[Content_Types].xml', bytes:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + base + 'package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
    { name: '_rels/.rels', bytes:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + base + 'package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + base + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', bytes:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + base + 'spreadsheetml/2006/main" xmlns:r="' + base + 'officeDocument/2006/relationships">' +
      '<bookViews><workbookView/></bookViews><sheets>' +
      sheets.map((source, index) => '<sheet name="' + xml(source.name) + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', bytes:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + base + 'package/2006/relationships">' +
      sheets.map((_, index) => '<Relationship Id="rId' + (index + 1) + '" Type="' + base + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + base + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', bytes:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + base + 'spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
  ];
  function* allEntries() {
    yield* entries;
    for (let index = 0; index < sheets.length; index++) {
      yield { name: 'xl/worksheets/sheet' + (index + 1) + '.xml', bytes: worksheet(sheets[index]) };
    }
  }
  return zip(allEntries());
}

/** An OOXML workbook with inline text cells; supplier strings cannot become formulas. */
export function exportWorkbook({ state, report }) {
  return makeWorkbook(exportTables({ state, report }));
}

function importIndex(state) {
  const found = new Map();
  for (const source of state.imports) {
    if (!object(source) || typeof source.id !== 'string' || !source.id ||
        found.has(source.id) || typeof source.fileName !== 'string' ||
        !SHA.test(source.sha256)) fail('workspace contains invalid or duplicate source identities');
    found.set(source.id, source);
  }
  return found;
}
function sourceName(fileName) {
  const original = String(fileName).split(/[\\/]/).pop() || 'input';
  const clean = Buffer.from(original, 'utf8').toString('utf8')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '');
  const clipped = Array.from(clean || 'input').slice(0, 120).join('');
  return 'original-' + clipped;
}

function retainedSources(state, sources) {
  if (!Array.isArray(sources)) fail('retained source bytes are required');
  const imports = importIndex(state), supplied = new Map(), files = new Map(), hashed = new WeakMap();
  for (const source of sources) {
    if (!object(source) || !Buffer.isBuffer(source.bytes) || typeof source.id !== 'string' ||
        supplied.has(source.id) || !SHA.test(source.sha256)) {
      fail('every source must carry one import ID, SHA-256 and original Buffer');
    }
    const selected = imports.get(source.id);
    if (!selected || selected.sha256 !== source.sha256 || selected.fileName !== source.fileName) {
      fail('source identity does not match its workspace import');
    }
    if (source.bytes.length > BUNDLE_LIMITS.entryBytes) fail('supplied source exceeds the entry-size limit');
    let actual = hashed.get(source.bytes);
    if (!actual) { actual = digest(source.bytes); hashed.set(source.bytes, actual); }
    if (actual !== source.sha256) fail('supplied source SHA-256 mismatch: ' + source.id);
    if (files.has(actual) && !files.get(actual).bytes.equals(source.bytes)) fail('inconsistent bytes share one source digest');
    supplied.set(source.id, source);
    if (!files.has(actual)) files.set(actual, { bytes: source.bytes, names: [] });
    files.get(actual).names.push(source.fileName);
  }
  if (supplied.size !== imports.size) fail('the handoff must include every retained import, including disabled imports');
  for (const [sha256, record] of files) {
    record.names.sort(compare);
    record.path = 'sources/' + sha256 + '/' + sourceName(record.names[0]);
  }
  const bindings = state.imports.map((selected) => {
    const source = supplied.get(selected.id), file = files.get(source.sha256);
    return {
      id: selected.id, fileName: selected.fileName, sha256: selected.sha256,
      bytes: source.bytes.length, path: file.path, kind: selected.kind,
      format: selected.format, part: selected.part,
    };
  });
  return { bindings, files };
}

const HANDOFF_README = [
  'Oregon product-trace review handoff',
  '',
  'workspace.json is the exact portable mapping, correction, exclusion and review state.',
  'report.json contains the full row reconciliation, branches, issues and selected-path audit.',
  'audit-report.json is the unchanged original selected-path engine result for this snapshot.',
  'normalized-graph.json is included only when the report has zero structural errors.',
  'source-manifest.json binds every import, including graph parts, to its exact supplied bytes.',
  'Duplicate source bytes are retained once by SHA-256; every import binding is preserved.',
  'review-workbook.xlsx provides native Excel worksheets with every cell stored as text.',
  'tables/ contains UTF-8 BOM CSVs using the workbench formula-protection policy.',
  'For direct spreadsheet use choose the XLSX workbook, which preserves zero-padded IDs.',
  'When importing CSV manually, select text column types for identifiers and source values.',
  'Long workbook cells continue in numbered text_overflow rows; CSV and JSON retain full values.',
  'Mapped worksheets remain available during correction and follow report.summary.errors.',
  '',
  'manifest.json records SHA-256 and byte count for every payload file.',
  'SHA256SUMS contains the same sorted payload checksums. Both index files exclude themselves.',
  'Use the workbench restore action to verify all paths, sizes, CRCs, digests and source bindings.',
  'Restore writes the original state and source bytes into a new private directory.',
  'The native service generates the access key separately and recomputes the current report.',
  '',
  'Archive format: classic ZIP, UTF-8 names, stored/raw-deflate members, no links or executable entries.',
  'Limits: 256 MiB compressed, 512 MiB expanded, 256 MiB per member, 4096 members.',
  '',
].join('\n');

/** Export original bytes, review state and useful tables even while structural errors remain. */
export function exportBundle({ state, report, sources }) {
  snapshot(state, report);
  const tables = exportTables({ state, report });
  const retained = retainedSources(state, sources);
  const entries = [
    { name: 'workspace.json', bytes: json(state) },
    { name: 'report.json', bytes: json(report) },
    { name: 'audit-report.json', bytes: json(report.audit ?? null) },
    { name: 'source-manifest.json', bytes: json({
      schema: SOURCE_SCHEMA, workspaceId: state.id,
      revision: state.revision, dataRevision: state.dataRevision,
      imports: retained.bindings,
    }) },
    { name: 'README.txt', bytes: Buffer.from(HANDOFF_README, 'utf8') },
  ];
  if (report.summary.errors === 0) entries.push({ name: 'normalized-graph.json', bytes: json(report.data) });
  for (const current of tables) {
    entries.push({ name: 'tables/' + current.name + '.csv', bytes: Buffer.from(csv(current.columns, current.rows.map((row) => current.columns.map((column) => cell(row[column])))), 'utf8') });
  }
  entries.push({ name: 'review-workbook.xlsx', bytes: makeWorkbook(tables), compress: false });
  for (const [, source] of [...retained.files].sort(([a], [b]) => compare(a, b))) {
    entries.push({ name: source.path, bytes: source.bytes, compress: false });
  }
  entries.sort((a, b) => compare(a.name, b.name));
  const files = entries.map((entry) => ({ path: entry.name, bytes: entry.bytes.length, sha256: digest(entry.bytes) }));
  const manifest = {
    schema: BUNDLE_SCHEMA, workspaceId: state.id,
    revision: state.revision, dataRevision: state.dataRevision,
    asOf: state.asOf, maxAgeDays: state.maxAgeDays,
    normalizedGraphIncluded: report.summary.errors === 0,
    sourceCount: retained.bindings.length, uniqueSourceCount: retained.files.size,
    tables: tables.map((current) => ({ name: current.name, rows: current.rows.length, columns: current.columns })),
    files,
  };
  entries.push({ name: 'manifest.json', bytes: json(manifest) });
  entries.push({ name: 'SHA256SUMS', bytes: Buffer.from(files.map((file) => file.sha256 + '  ' + file.path + '\n').join(''), 'utf8') });
  return zip(entries);
}

function decodeUtf8(bytes, label) {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) fail(label + ' is not valid UTF-8');
  return value;
}
function parseJson(bytes, label) {
  try { return JSON.parse(decodeUtf8(bytes, label)); }
  catch (error) { fail(label + ' is not valid UTF-8 JSON: ' + error.message); }
}
function assertRange(bytes, offset, length, limit = bytes.length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 ||
      length < 0 || offset > limit || length > limit - offset) fail('truncated ZIP structure');
}

function unzip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > BUNDLE_LIMITS.archiveBytes) {
    fail('ZIP buffer is empty, incomplete or exceeds the archive-size limit');
  }
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0 ||
      bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) {
    fail('expected a single-volume workbench ZIP with no trailing comment');
  }
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12), directoryAt = bytes.readUInt32LE(end + 16);
  if (!count || count > BUNDLE_LIMITS.entries || bytes.readUInt16LE(end + 8) !== count ||
      directoryAt + directorySize !== end) fail('invalid ZIP directory');
  assertRange(bytes, directoryAt, directorySize, end);
  const records = [], names = new Set();
  let position = directoryAt, total = 0;
  for (let index = 0; index < count; index++) {
    assertRange(bytes, position, 46, end);
    if (bytes.readUInt32LE(position) !== 0x02014b50) fail('invalid ZIP directory member');
    const version = bytes.readUInt16LE(position + 6), flags = bytes.readUInt16LE(position + 8);
    const method = bytes.readUInt16LE(position + 10), crc = bytes.readUInt32LE(position + 16);
    const packed = bytes.readUInt32LE(position + 20), size = bytes.readUInt32LE(position + 24);
    const nameSize = bytes.readUInt16LE(position + 28), extraSize = bytes.readUInt16LE(position + 30);
    const commentSize = bytes.readUInt16LE(position + 32), disk = bytes.readUInt16LE(position + 34);
    const attributes = bytes.readUInt32LE(position + 38), localAt = bytes.readUInt32LE(position + 42);
    if (version !== 20 || flags !== 0x0800 || ![0, 8].includes(method) || extraSize || commentSize || disk ||
        (attributes >>> 16 & 0xf000) !== 0x8000 || size > BUNDLE_LIMITS.entryBytes ||
        packed > BUNDLE_LIMITS.archiveBytes || (method === 0 && packed !== size)) {
      fail('unsupported, unsafe or oversized ZIP member');
    }
    assertRange(bytes, position + 46, nameSize, end);
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameSize);
    const name = safePath(decodeUtf8(nameBytes, 'ZIP filename'));
    if (names.has(name.toLowerCase())) fail('duplicate ZIP filename');
    names.add(name.toLowerCase());
    total += size;
    if (total > BUNDLE_LIMITS.expandedBytes) fail('expanded ZIP exceeds the size limit');
    records.push({
      name, nameBytes, flags, method, crc, packed, size, localAt,
      time: bytes.readUInt16LE(position + 12), date: bytes.readUInt16LE(position + 14),
    });
    position += 46 + nameSize;
  }
  if (position !== end) fail('ZIP directory length disagrees with its members');
  records.sort((a, b) => a.localAt - b.localAt);
  let expected = 0;
  // Check every local range before decompression; hidden members and overlaps are rejected.
  for (const record of records) {
    if (record.localAt !== expected) fail('ZIP contains overlapping or unindexed local data');
    assertRange(bytes, record.localAt, 30, directoryAt);
    const at = record.localAt, nameSize = bytes.readUInt16LE(at + 26), extraSize = bytes.readUInt16LE(at + 28);
    if (bytes.readUInt32LE(at) !== 0x04034b50 || bytes.readUInt16LE(at + 4) !== 20 ||
        bytes.readUInt16LE(at + 6) !== record.flags || bytes.readUInt16LE(at + 8) !== record.method ||
        bytes.readUInt16LE(at + 10) !== record.time || bytes.readUInt16LE(at + 12) !== record.date ||
        bytes.readUInt32LE(at + 14) !== record.crc || bytes.readUInt32LE(at + 18) !== record.packed ||
        bytes.readUInt32LE(at + 22) !== record.size || extraSize || nameSize !== record.nameBytes.length) {
      fail('ZIP local member disagrees with its directory entry');
    }
    assertRange(bytes, at + 30, nameSize + record.packed, directoryAt);
    if (!bytes.subarray(at + 30, at + 30 + nameSize).equals(record.nameBytes)) fail('ZIP local filename mismatch');
    record.dataAt = at + 30 + nameSize;
    expected = record.dataAt + record.packed;
  }
  if (expected !== directoryAt) fail('ZIP has extra unindexed data');
  const output = new Map();
  for (const record of records) {
    const packed = bytes.subarray(record.dataAt, record.dataAt + record.packed);
    let value;
    if (record.method === 0) {
      value = packed;
    } else {
      let inflated;
      try {
        inflated = inflateRawSync(packed, { maxOutputLength: Math.max(1, record.size), info: true });
      } catch { fail('ZIP member cannot be inflated within its declared size'); }
      if (inflated.engine.bytesWritten !== packed.length) fail('ZIP member contains unused compressed bytes');
      value = inflated.buffer;
    }
    if (value.length !== record.size || crc32(value) !== record.crc) fail('ZIP member size or CRC mismatch: ' + record.name);
    output.set(record.name, value);
  }
  return output;
}

/** Validate and restore a complete handoff without extracting any archive path. */
export function readBundle(bytes) {
  const files = unzip(bytes);
  const required = (name) => {
    const value = files.get(name);
    if (!value) fail('required handoff file is missing: ' + name);
    return value;
  };
  const manifest = parseJson(required('manifest.json'), 'manifest.json');
  if (!object(manifest) || manifest.schema !== BUNDLE_SCHEMA || !Array.isArray(manifest.files) ||
      typeof manifest.normalizedGraphIncluded !== 'boolean') fail('unknown handoff manifest schema');
  const indexed = new Set(), records = [];
  for (const record of manifest.files) {
    if (!object(record) || typeof record.path !== 'string' || indexed.has(record.path) ||
        record.path === 'manifest.json' || record.path === 'SHA256SUMS' ||
        !SHA.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 0) {
      fail('invalid or repeated manifest entry');
    }
    safePath(record.path);
    const value = required(record.path);
    if (value.length !== record.bytes || digest(value) !== record.sha256) fail('handoff payload digest mismatch: ' + record.path);
    indexed.add(record.path);
    records.push(record);
  }
  if (indexed.size !== files.size - 2) fail('handoff contains unindexed payload files');
  const checksums = Buffer.from(records.sort((a, b) => compare(a.path, b.path))
    .map((record) => record.sha256 + '  ' + record.path + '\n').join(''), 'utf8');
  if (!required('SHA256SUMS').equals(checksums)) fail('checksum index disagrees with the manifest');
  for (const name of ['workspace.json', 'report.json', 'audit-report.json', 'source-manifest.json', 'review-workbook.xlsx', 'README.txt']) {
    if (!indexed.has(name)) fail('manifest lacks required payload: ' + name);
  }
  const state = parseJson(required('workspace.json'), 'workspace.json');
  const report = parseJson(required('report.json'), 'report.json');
  snapshot(state, report);
  if (manifest.workspaceId !== state.id || manifest.revision !== state.revision ||
      manifest.dataRevision !== state.dataRevision || manifest.asOf !== state.asOf ||
      manifest.maxAgeDays !== state.maxAgeDays ||
      manifest.normalizedGraphIncluded !== (report.summary.errors === 0) ||
      files.has('normalized-graph.json') !== manifest.normalizedGraphIncluded) {
    fail('manifest and workspace snapshot disagree');
  }
  if (!required('audit-report.json').equals(json(report.audit ?? null))) fail('audit report differs from the retained snapshot');
  if (manifest.normalizedGraphIncluded && !required('normalized-graph.json').equals(json(report.data))) {
    fail('normalized graph differs from the retained report');
  }
  const sourceManifest = parseJson(required('source-manifest.json'), 'source-manifest.json');
  if (!object(sourceManifest) || sourceManifest.schema !== SOURCE_SCHEMA ||
      sourceManifest.workspaceId !== state.id || sourceManifest.revision !== state.revision ||
      sourceManifest.dataRevision !== state.dataRevision || !Array.isArray(sourceManifest.imports)) {
    fail('source manifest does not describe this workspace');
  }
  const imports = importIndex(state), associations = new Set(), sourcePaths = new Set(), uniqueDigests = new Set();
  const sources = [];
  for (const binding of sourceManifest.imports) {
    const selected = imports.get(binding?.id);
    if (!object(binding) || !selected || associations.has(binding.id) ||
        binding.fileName !== selected.fileName || binding.sha256 !== selected.sha256 ||
        binding.kind !== selected.kind || binding.format !== selected.format || binding.part !== selected.part ||
        typeof binding.path !== 'string' || !binding.path.startsWith('sources/' + selected.sha256 + '/') ||
        !indexed.has(binding.path) || !Number.isSafeInteger(binding.bytes) || binding.bytes < 0) {
      fail('invalid original-source binding');
    }
    const value = required(binding.path);
    if (value.length !== binding.bytes || digest(value) !== binding.sha256) fail('original source does not match its import');
    associations.add(binding.id);
    sourcePaths.add(binding.path);
    uniqueDigests.add(binding.sha256);
    sources.push({ id: binding.id, fileName: binding.fileName, sha256: binding.sha256, bytes: value });
  }
  if (associations.size !== imports.size || manifest.sourceCount !== sources.length ||
      manifest.uniqueSourceCount !== uniqueDigests.size || sourcePaths.size !== uniqueDigests.size ||
      [...files.keys()].filter((name) => name.startsWith('sources/')).length !== sourcePaths.size) {
    fail('source bindings are incomplete or contain duplicate raw copies');
  }
  if (!Array.isArray(manifest.tables)) fail('manifest lacks its table index');
  const tableNames = new Set();
  for (const current of manifest.tables) {
    if (!object(current) || typeof current.name !== 'string' || !/^[a-z_]+$/.test(current.name) ||
        tableNames.has(current.name) || !Number.isSafeInteger(current.rows) || current.rows < 0 ||
        !Array.isArray(current.columns) || current.columns.some((name) => typeof name !== 'string') ||
        !indexed.has('tables/' + current.name + '.csv')) fail('invalid exported-table index');
    tableNames.add(current.name);
  }
  if ([...files.keys()].filter((name) => name.startsWith('tables/')).length !== tableNames.size) {
    fail('table index is incomplete');
  }
  return { state, sources };
}
