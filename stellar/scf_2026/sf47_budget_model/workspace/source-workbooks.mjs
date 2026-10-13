// MIT. Original XLSX materials and selected cells travel with native planning.
import {sha256, parseTable} from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';

export const WORKBOOK_SOURCE_SCHEMA = 'stellar-forge.planning-workbook-source.v1';
export const WORKBOOK_SELECTION_SCHEMA = 'stellar-forge.planning-workbook-selection.v1';
export const WORKBOOK_MAPPING_SCHEMA = 'stellar-forge.planning-workbook-mapping.v1';
export const MAX_WORKBOOK_PROJECT_BYTES = 32 * 1024 * 1024;
const READER_PATH = 'stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workbook/reader.py';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const HASH = /^[a-f0-9]{64}$/;
const utf8 = value => new TextEncoder().encode(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export class PlanningWorkbookError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PlanningWorkbookError'; this.code = code; Object.assign(this, details); }
}
function need(value, code, message, details) { if (!value) throw new PlanningWorkbookError(code, message, details); }
function text(value, label, maximum = 4000, required = false) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0') && (!required || value.trim()),
    'WORKBOOK_TEXT', label + ' needs ordinary text.');
  return value;
}
export function encodeWorkbookBytes(bytes) {
  need(bytes instanceof Uint8Array && bytes.length > 0, 'WORKBOOK_BYTES', 'Choose the complete original XLSX file.');
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 12288) {
    let part = '';
    for (let i = offset; i < Math.min(offset + 12288, bytes.length); i += 3) {
      const left = bytes[i], middle = i + 1 < bytes.length ? bytes[i + 1] : 0, right = i + 2 < bytes.length ? bytes[i + 2] : 0;
      part += alphabet[left >> 2] + alphabet[(left & 3) << 4 | middle >> 4] +
        (i + 1 < bytes.length ? alphabet[(middle & 15) << 2 | right >> 6] : '=') +
        (i + 2 < bytes.length ? alphabet[right & 63] : '=');
    }
    chunks.push(part);
  }
  return chunks.join('');
}
export function decodeWorkbookBytes(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 4 * Math.ceil(MAX_WORKBOOK_PROJECT_BYTES / 3) &&
    value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    'WORKBOOK_BYTES', 'Retain the complete original workbook byte encoding.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(value.length / 4 * 3 - padding);
  let written = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]), b = alphabet.indexOf(value[i + 1]),
      c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]), d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]);
    bytes[written++] = a << 2 | b >> 4;
    if (written < bytes.length) bytes[written++] = (b & 15) << 4 | c >> 2;
    if (written < bytes.length) bytes[written++] = (c & 3) << 6 | d;
  }
  need(encodeWorkbookBytes(bytes) === value, 'WORKBOOK_BYTES', 'Retain the canonical complete workbook bytes.');
  return bytes;
}
export async function workbookUpload(filename, bytes) {
  text(filename, 'Original workbook filename', 500, true);
  need(!/[\\/]/.test(filename), 'WORKBOOK_FILENAME', 'Use the original workbook filename without a directory.');
  need(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_WORKBOOK_PROJECT_BYTES,
    'WORKBOOK_CAPACITY', 'The complete workbook must fit the retained 32 MiB source project.');
  return {filename, bytes: bytes.length, sha256: await sha256(bytes), dataBase64: encodeWorkbookBytes(bytes)};
}
export function requireWorkbookProjectCapacity(book) {
  need(utf8(json(book)).length <= MAX_WORKBOOK_PROJECT_BYTES, 'WORKBOOK_CAPACITY',
    'The complete source project, original workbooks, selections and reviews must fit the original 32 MiB planning input allowance.');
}
function readerIdentity(value) {
  need(object(value) && value.path === READER_PATH && value.parser === 'stellar-forge.xlsx-reader.v1' && HASH.test(value.sha256 || ''),
    'WORKBOOK_READER', 'Retain the selected workbook reader identity.');
}
export async function validateWorkbookSource(source) {
  need(object(source) && source.schema === WORKBOOK_SOURCE_SCHEMA && HASH.test(source.sha256 || '') &&
    source.id === 'xlsx-' + source.sha256 && Number.isSafeInteger(source.bytes),
    'WORKBOOK_SOURCE', 'Retain the complete original workbook identity.');
  text(source.filename, 'Original workbook filename', 500, true);
  need(!/[\\/]/.test(source.filename), 'WORKBOOK_FILENAME', 'Use the original filename without a directory.');
  const bytes = decodeWorkbookBytes(source.dataBase64);
  need(bytes.length === source.bytes && await sha256(bytes) === source.sha256,
    'WORKBOOK_BYTES', 'The retained workbook differs from its original bytes.');
  need(object(source.description) && source.description.sourceSha256 === source.sha256 &&
    source.description.sourceBytes === source.bytes && Array.isArray(source.description.sheets),
    'WORKBOOK_DESCRIPTION', 'Retain the complete original sheet description.');
  readerIdentity(source.decoder);
  return source;
}
export function workbookSelectionBody(selection) {
  need(object(selection) && typeof selection.text === 'string' && HASH.test(selection.sha256 || ''),
    'WORKBOOK_SELECTION', 'Open the complete original workbook selection.');
  let value;
  try { value = JSON.parse(selection.text); } catch { throw new PlanningWorkbookError('WORKBOOK_SELECTION', 'Open the complete saved workbook selection.'); }
  need(object(value) && value.schema === WORKBOOK_SELECTION_SCHEMA, 'WORKBOOK_SELECTION', 'Use the original workbook-selection format.');
  return value;
}
export async function validateWorkbookProjection(selection, source) {
  const raw = utf8(selection?.text || ''), body = workbookSelectionBody(selection);
  need(raw.length > 0 && raw.length <= MAX_WORKBOOK_PROJECT_BYTES && await sha256(raw) === selection.sha256 &&
    (selection.bytes === undefined || selection.bytes === raw.length), 'WORKBOOK_SELECTION',
    'The complete selected workbook projection differs from its retained identity.');
  need(body.sourceId === source.id && body.sourceSha256 === source.sha256 && body.sourceBytes === source.bytes,
    'WORKBOOK_SELECTION', 'Retain the original workbook for this selected worksheet.');
  readerIdentity(body.decoder);
  need(object(body.mapping) && body.mapping.schema === WORKBOOK_MAPPING_SCHEMA && object(body.mapping.plan) &&
    object(body.mapping.numericText) && Array.isArray(body.mapping.plan.columns),
    'WORKBOOK_MAPPING', 'Retain the complete worksheet, range and conversion choices.');
  need(object(body.csv) && typeof body.csv.text === 'string' && body.csv.bytes === utf8(body.csv.text).length &&
    await sha256(body.csv.text) === body.csv.sha256, 'WORKBOOK_CSV', 'Retain the exact projected CSV.');
  need(object(body.rowMap) && typeof body.rowMap.text === 'string' && body.rowMap.bytes === utf8(body.rowMap.text).length &&
    await sha256(body.rowMap.text) === body.rowMap.sha256, 'WORKBOOK_ROW_MAP', 'Retain the complete original worksheet-row map.');
  const table = parseTable(body.csv.text, {delimiter:',',header:true,skipEmptyRecords:false});
  let sourceRows;
  try { sourceRows = body.rowMap.text.split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { throw new PlanningWorkbookError('WORKBOOK_ROW_MAP', 'Retain every original projected row.'); }
  need(Array.isArray(body.rows) && body.rows.length === table.rows.length && sourceRows.length === table.rows.length &&
    body.readerProjection?.rowCount === table.rows.length && Array.isArray(body.excludedRanges) && Array.isArray(body.transformations),
    'WORKBOOK_ROW_MAP', 'Retain all included rows, excluded source ranges and exact decimal conversions.');
  need(table.headings.length === body.mapping.plan.columns.length &&
    table.headings.every((name, index) => name === body.mapping.plan.columns[index].name),
    'WORKBOOK_COLUMNS', 'The projected CSV headings must match the saved column choices.');
  for (let index = 0; index < table.rows.length; index++) {
    const row = body.rows[index], map = sourceRows[index];
    need(object(row) && object(map) && row.record === table.rows[index].record && row.dataRecord === index + 1 &&
      map.record === index && map.row === row.row && Number.isSafeInteger(row.row) && row.row > 0 &&
      Array.isArray(row.cells) && row.cells.length === table.width,
      'WORKBOOK_ROW_MAP', 'Keep each projected CSV row attached to its original worksheet row.');
    for (let column = 0; column < table.width; column++) {
      const cell = row.cells[column], binding = body.mapping.plan.columns[column];
      need(object(cell) && cell.field === table.headings[column] && object(cell.original) &&
        cell.original.cell === binding.source + row.row && cell.original.row === row.row &&
        cell.output === table.rows[index].cells[column], 'WORKBOOK_CELL_MAP',
        'Keep every projected field attached to its complete original cell and chosen output.');
    }
  }
  return body;
}
export async function validateWorkbookMaterials(book) {
  if (!['workbookSources','workbookSelections','selectedWorkbooks'].some(key => own(book, key))) return book;
  const sources = book.workbookSources || [], selections = book.workbookSelections || [], active = book.selectedWorkbooks || {};
  need(Array.isArray(sources) && Array.isArray(selections) && object(active), 'WORKBOOK_SOURCE',
    'Retain the original workbooks, complete selections and current source references.');
  requireWorkbookProjectCapacity(book);
  const originals = new Map();
  for (const source of sources) {
    await validateWorkbookSource(source);
    need(!originals.has(source.id), 'WORKBOOK_SOURCE', 'Retain each original workbook once.');
    originals.set(source.id, source);
  }
  const ids = new Map();
  for (const selection of selections) {
    const source = originals.get(selection.sourceId), doc = book.project.documents.find(row => row.id === selection.documentId);
    need(source && doc && !ids.has(selection.id), 'WORKBOOK_SELECTION', 'Retain each original workbook selection with its source document.');
    const body = await validateWorkbookProjection(selection, source), edition = doc.editions.find(row => row.id === selection.editionId);
    need(selection.id === 'wbsel-' + await sha256(source.id + '\n' + doc.id + '\n' + selection.sha256),
      'WORKBOOK_SELECTION', 'Retain the selected worksheet identity for this source document.');
    text(selection.receivedAt, 'Selection date', 100, true);
    need(edition && edition.sha256 === body.csv.sha256 && edition.sourceText === body.csv.text && edition.bytes === body.csv.bytes,
      'WORKBOOK_SELECTION', 'The selected worksheet must match its complete retained CSV edition.');
    ids.set(selection.id, selection);
  }
  for (const [documentId, selectionId] of Object.entries(active))
    need(book.project.documents.some(doc => doc.id === documentId) && (selectionId === null || ids.get(selectionId)?.documentId === documentId), 'WORKBOOK_SELECTION', 'Choose a workbook selection for its original source document.');
  return book;
}
export function selectedPlanningWorkbook(book, documentId, editionId, {required = false} = {}) {
  const candidates = (book.workbookSelections || []).filter(row => row.documentId === documentId && row.editionId === editionId);
  if (own(book.selectedWorkbooks || {}, documentId) && book.selectedWorkbooks[documentId] === null) return null;
  const explicit = candidates.find(row => row.id === book.selectedWorkbooks?.[documentId]);
  if (explicit) return explicit;
  if (candidates.length === 1) return candidates[0];
  need(!required || candidates.length === 0, 'WORKBOOK_SELECTION_REQUIRED',
    'This CSV edition has more than one workbook selection. Choose its intended original sheet and conversion choices.');
  return null;
}
export function planningWorkbookRows(book, documentId, editionId) {
  const selected = selectedPlanningWorkbook(book, documentId, editionId, {required:true});
  if (!selected) return null;
  const body = workbookSelectionBody(selected), source = book.workbookSources.find(item => item.id === selected.sourceId);
  const common = {sourceId: source.id, filename: source.filename, sourceSha256: source.sha256,
    selectionId: selected.id, selectionSha256: selected.sha256, sheet: body.mapping.plan.sheet,
    range: body.mapping.plan.range};
  return new Map(body.rows.map(row => [row.record, {...common, row:row.row, hidden:row.hidden,
    cells:row.cells.map(cell => ({field:cell.field, cell:cell.original.cell, selection:cell.selection}))}]));
}
export function workbookOperatingGuide(book) {
  const sources = book.workbookSources || [], selections = book.workbookSelections || [];
  if (!sources.length) return '';
  return '\n## Original workbooks\n\n' +
    sources.map(source => '- ' + source.filename + ': ' + source.bytes + ' original bytes; ' + source.description.sheets.length + ' sheets.').join('\n') +
    '\n\nThe complete source project retains ' + selections.length + ' worksheet selections, their saved column policies, exact cell positions, projected CSVs and earlier editions. ' +
    'In Source tables, open Excel workbook selections to choose a retained workbook, review a saved selection, download its original XLSX or prepare a new selection for any of the four planning tables.\n\n' +
    'Choose the worksheet, range and header row, then set hidden-row, blank-row and merged-cell handling. Each projected column has explicit formula, empty-cell, error, date and decimal-text choices. ' +
    'Saved result uses the value present in the workbook when it was last saved. The stored formula and its original value remain in the selection. Recalculate and save a new workbook in the originating spreadsheet application when a fresh result is required, then receive that file as another edition.\n\n' +
    'Keep original spelling retains the complete numeric token. Exact decimal expansion writes scientific notation as decimal text without binary floating-point conversion. ' +
    'Calendar conversion uses the workbook’s 1900 or 1904 date system; date-only conversion rejects a time fraction. Date and time conversion rounds to the nearest millisecond, with ties to even. ' +
    'Merged-cell anchor handling keeps the original anchor and uses empty cells for the other covered positions; it does not fill values across the range.\n\n' +
    'After Use selection, finish the existing field mapping, Review current table mapping, Calculate native preview, apply the reviewed changes, and Save revision. ' +
    'Every original workbook, selected cell, source edition and review then travels in the full planning ZIP. Native save and receiving replay the selected values against the original XLSX before accepting them.\n';
}


/** Browser controls on the original authenticated Grant Operations listener. */
export function createPlanningWorkbookIntake(context) {
  const node = (name, value, className) => {
    const element = document.createElement(name);
    if (value !== undefined) element.textContent = String(value);
    if (className) element.className = className;
    return element;
  };
  const {button, field, select, checkbox, section, table, details, download} = context;
  let disposed = false, serial = 0, currentRole = '', currentBookId = '', state = {};
  const roleState = new Map(), PAGE = 25;
  const alive = () => !disposed && context.alive();
  const source = () => context.getBook().workbookSources?.find(item => item.id === state.sourceId);
  const redraw = () => { if (alive()) context.redraw(); };
  const invalidate = () => { state.projected = null; state.outputPage = 0; redraw(); };
  const valueLabel = value => value === null || value === undefined || value === '' ? 'Empty' : String(value);
  const previewText = value => { const raw = valueLabel(value); return raw.length > 600 ? raw.slice(0,600) + '… (complete value retained)' : raw; };
  const columnNumber = value => [...value].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
  const sourceRange = value => {
    const match = /^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/.exec(value || '');
    need(match, 'WORKBOOK_RANGE', 'Enter a worksheet range such as A1:K9.');
    return {firstColumn:columnNumber(match[1]), firstRow:Number(match[2]), lastColumn:columnNumber(match[3]), lastRow:Number(match[4])};
  };
  function draftFromPreview(response, headerRow, previous = null) {
    const preview = response.preview, headers = response.headerCells?.length ? response.headerCells :
      preview.rows.find(row => row.row === headerRow)?.cells || [];
    const used = new Set();
    const columns = preview.columns.map((letter, index) => {
      const rawName = headerRow === null ? 'Column ' + letter : headers[index]?.value;
      const base = (String(rawName ?? '').trim() || 'Column ' + letter).slice(0,110);
      let name = base, suffix = 2;
      while (used.has(name)) name = base + '_' + suffix++;
      used.add(name);
      return {name, source:letter, include:true, blank:'empty', formula:'reject', error:'reject',
        date:'raw', trim:false, valueMap:[], numeric:'source',
        originalHeader:rawName === null || rawName === undefined ? '' : String(rawName)};
    });
    return {name:previous?.name || context.roleLabel() + ' worksheet selection', notes:previous?.notes || '',
      sheet:preview.metadata.name, range:preview.range, headerRow,
      hiddenRows:'include', blankRows:'skip', mergedCells:'reject', columns};
  }
  function draftFromMapping(mapping) {
    return {...copy(mapping.plan), columns:mapping.plan.columns.map(column =>
      ({...copy(column), include:true, numeric:mapping.numericText[column.name], originalHeader:''}))};
  }
  function selectedMapping() {
    const draft = state.draft;
    need(draft, 'WORKBOOK_MAPPING', 'Inspect the intended source worksheet and range first.');
    const {columns, ...base} = draft;
    const included = columns.filter(column => column.include);
    need(included.length, 'WORKBOOK_COLUMNS', 'Include at least one original source column.');
    return {schema:WORKBOOK_MAPPING_SCHEMA, plan:{...copy(base), columns:included.map(column => {
      const {include, numeric, originalHeader, ...binding} = column; return copy(binding);
    })}, numericText:Object.fromEntries(included.map(column => [column.name, column.numeric]))};
  }
  async function inspect(selected, {sheet, range, headerRow, reset = false, offset = 0} = {}) {
    const request = ++serial, choice = {sheet, ...(range ? {range} : {}), offset, limit:PAGE};
    const response = await context.api('/api/source-tables/workbook/inspect', {source:selected, preview:choice,
      ...(headerRow !== undefined ? {headerRow} : {})});
    if (!alive() || request !== serial) return;
    const next = await context.retainSource(context.getBook(), response.source);
    if (!alive() || request !== serial) return;
    state.sourceId = response.source.id; state.preview = response.preview;
    if (reset || !state.draft) {
      const row = headerRow === undefined ? sourceRange(response.preview.range).firstRow : headerRow;
      state.draft = draftFromPreview(response, row, state.draft);
      state.projected = null; state.outputPage = 0;
    }
    if (context.getBook().workbookSources?.some(item => item.id === response.source.id)) redraw();
    else context.store(next, {redraw:true});
    context.status('Retained the original workbook. Choose the range and column policies, then prepare its selected values.');
  }
  async function receiveFile(file) {
    need(file.size > 0 && file.size <= MAX_WORKBOOK_PROJECT_BYTES, 'WORKBOOK_CAPACITY',
      'Choose a complete workbook within the original 32 MiB source allowance.');
    const upload = await workbookUpload(file.name, new Uint8Array(await file.arrayBuffer()));
    if (alive()) await inspect(upload, {reset:true});
  }
  function cellView(cell) {
    const wrap = node('div', undefined, 'pt-workbook-cell');
    wrap.append(node('span', previewText(cell.value), 'pt-workbook-value'));
    if (cell.formula) {
      wrap.append(node('span', cell.formula.text === null ? 'Shared formula; equation retained at its source anchor' : '=' + previewText(cell.formula.text), 'pt-help'));
      wrap.append(node('span', cell.cachedPresent ? 'Stored result present' : 'Stored result absent', 'pt-help'));
    }
    if (cell.dateStyle || cell.type === 'date') wrap.append(node('span', 'Date cell · ' + (cell.numberFormat || 'ISO date'), 'pt-help'));
    else if (cell.numberFormat && cell.numberFormat !== 'General') wrap.append(node('span', 'Display format: ' + previewText(cell.numberFormat), 'pt-help'));
    if (cell.type === 'error') wrap.append(node('span','Workbook error value','pt-help'));
    return wrap;
  }
  function sourcePreview() {
    const preview = state.preview;
    if (!preview) return node('p', 'Choose a retained workbook and inspect its source worksheet.', 'pt-help');
    const rows = preview.rows.map(row => [row.row, row.hidden ? 'Hidden' : 'Visible', ...row.cells.map(cellView)]);
    const group = node('div');
    group.append(node('h4', preview.metadata.name + ' · ' + preview.range),
      node('p', 'Original worksheet rows ' + (preview.offset + 1) + '–' + Math.min(preview.offset + preview.rows.length, preview.totalRows) +
        ' of ' + preview.totalRows + ' in this range. Stored numeric values and formulas are shown before conversion.', 'pt-help'),
      table(['Worksheet row','Visibility',...preview.columns],rows));
    const actions = node('div', undefined, 'pt-actions'), selected = source();
    const page = offset => inspect(selected, {sheet:preview.metadata.name, range:preview.range, offset});
    const previous = button('Previous worksheet rows', () => page(Math.max(0, preview.offset - PAGE)));
    const next = button('Next worksheet rows', () => page(preview.nextOffset));
    previous.disabled = preview.offset === 0; next.disabled = preview.nextOffset === null;
    previous.dataset.fixedDisabled = String(previous.disabled); next.dataset.fixedDisabled = String(next.disabled);
    actions.append(previous,next); group.append(actions);
    return group;
  }
  function mappingPanel() {
    const draft = state.draft;
    if (!draft) return null;
    const panel = node('div'), choices = node('div', undefined, 'pt-grid');
    const edit = (key, value) => { draft[key] = value; invalidate(); };
    choices.append(field('Selection name', draft.name, value => edit('name',value), {maximum:200}),
      field('Selection note', draft.notes, value => edit('notes',value), {area:true,maximum:4000}),
      field('Original range', draft.range, value => edit('range',value.toUpperCase()), {maximum:30}),
      field('Header row · leave empty for no header', draft.headerRow ?? '', value => {
        need(value === '' || /^[1-9]\d*$/.test(value), 'WORKBOOK_HEADER', 'Choose an original worksheet row or leave the header empty.');
        edit('headerRow',value === '' ? null : Number(value));
      }, {maximum:7}));
    choices.append(button('Use this range and header', () => inspect(source(), {sheet:draft.sheet, range:draft.range,
      headerRow:draft.headerRow, reset:true})));
    panel.append(choices, node('p','Use this range and header resets the projected column list from the selected original cells. Then set the policies below.', 'pt-help'));
    const policies = node('div', undefined, 'pt-grid');
    policies.append(select('Hidden worksheet rows',draft.hiddenRows,[['include','Include hidden rows'],['exclude','Exclude hidden rows and retain their source positions']],value=>edit('hiddenRows',value)),
      select('Completely blank source rows',draft.blankRows,[['keep','Keep blank rows'],['skip','Skip blank rows and retain their source positions']],value=>edit('blankRows',value)),
      select('Merged data cells',draft.mergedCells,[['reject','Require a source selection without merged data cells'],['anchor','Keep original anchor; other covered cells become empty']],value=>edit('mergedCells',value)));
    panel.append(policies, node('p',
      'Saved result reads the value already stored in the workbook. The complete original formula and cache state remain available. Choose exact decimal expansion when a planning number uses scientific notation. Calendar conversion uses the workbook’s recorded date system.',
      'pt-help'));
    const rows = draft.columns.map(column => {
      const set = (key, value) => { column[key] = value; invalidate(); };
      const policy = node('div', undefined, 'pt-workbook-policies');
      policy.append(select('Formula handling',column.formula,[['reject','Require ordinary values'],['cached','Use stored result'],['text','Keep original formula text']],value=>set('formula',value)),
        select('Empty cells',column.blank,[['empty','Keep empty text'],['reject','Require a value']],value=>set('blank',value)),
        select('Workbook error cells',column.error,[['reject','Require a valid source value'],['text','Keep original error text']],value=>set('error',value)),
        select('Date handling',column.date,[['raw','Keep original serial or date text'],['iso-date','Convert to calendar date'],['iso-datetime-ms','Convert to date and time · nearest millisecond']],value=>set('date',value)),
        select('Numeric text',column.numeric,[['source','Keep original spelling'],['decimal','Expand exact decimal text']],value=>set('numeric',value)),
        checkbox('Trim surrounding whitespace',column.trim,value=>set('trim',value)));
      const replacements = field('Exact value replacements · optional JSON array',column.valueMap.length ? json(column.valueMap) : '',
        value => {
          const selected = value.trim() ? JSON.parse(value) : [];
          need(Array.isArray(selected), 'WORKBOOK_VALUE_MAP', 'Use an array of {"from":"original","to":"replacement"} entries.');
          set('valueMap',selected);
        },{area:true,maximum:16000});
      return [checkbox('Include '+column.source,column.include,value=>set('include',value)),
        column.source + (column.originalHeader ? ' · ' + previewText(column.originalHeader) : ''),
        field('Projected field',column.name,value=>set('name',value),{maximum:128}), policy, replacements];
    });
    panel.append(table(['Use','Original column','Projected field','Conversion choices','Exact replacements'],rows));
    const actions = node('div',undefined,'pt-actions');
    actions.append(button('Prepare selected worksheet values', async () => {
      const selected = source(), mapping = selectedMapping(), request = ++serial;
      const response = await context.api('/api/source-tables/workbook/project',{source:selected,mapping});
      await validateWorkbookProjection(response.projection,response.source);
      if (!alive() || request !== serial) return;
      state.projected = response; state.outputPage = 0; redraw();
      const body = workbookSelectionBody(response.projection);
      context.status('Prepared '+body.rows.length+' complete worksheet rows. Review these values, then use the selection for '+context.roleLabel().toLowerCase()+'.');
    }), button('Download selection choices', () => download(json(selectedMapping()),'workbook-mapping.json')));
    panel.append(actions);
    return details('Worksheet selection and conversion choices',panel);
  }
  function outputPanel() {
    if (!state.projected) return null;
    const body = workbookSelectionBody(state.projected.projection), start = (state.outputPage || 0) * PAGE;
    const panel = node('section',undefined,'pt-panel');
    panel.append(node('h4','Prepared worksheet values'),
      node('p',body.rows.length+' rows · '+body.mapping.plan.columns.length+' fields · '+
        body.readerProjection.skippedHiddenRows+' hidden rows excluded · '+body.readerProjection.skippedBlankRows+
        ' blank rows excluded · '+body.transformations.length+' exact decimal expansions.'),
      table(['Original worksheet row',...body.mapping.plan.columns.map(column=>column.name)],
        body.rows.slice(start,start+PAGE).map(row=>[row.row,...row.cells.map(cell=>previewText(cell.output))])));
    const pages = node('div',undefined,'pt-actions'), previous = button('Previous prepared rows',()=>{state.outputPage--;redraw();}),
      next = button('Next prepared rows',()=>{state.outputPage++;redraw();});
    previous.disabled = start === 0; next.disabled = start + PAGE >= body.rows.length;
    previous.dataset.fixedDisabled = String(previous.disabled); next.dataset.fixedDisabled = String(next.disabled);
    pages.append(previous,node('span','Prepared rows '+(body.rows.length?start+1:0)+'–'+Math.min(start+PAGE,body.rows.length)+' of '+body.rows.length),next);
    panel.append(pages);
    if (body.excludedRanges.length) panel.append(details('Original header and excluded worksheet rows',
      table(['From row','Through row','Selection choice'],body.excludedRanges.map(row=>[row.fromRow,row.toRow,
        {'before-header':'Before selected header',header:'Column header',hidden:'Hidden row excluded',blank:'Blank row skipped'}[row.reason] || row.reason]))));
    const actions = node('div',undefined,'pt-actions');
    actions.append(button('Use selection for '+context.roleLabel().toLowerCase(),async()=>{
      const nextBook = await context.receive(context.getBook(), {role:context.getRole(),
        source:state.projected.source, projection:state.projected.projection});
      if (!alive()) return;
      context.store(nextBook,{redraw:true});
      context.status('Retained the original workbook, selected cells and projected CSV. Finish the planning-field mapping and Review current table mapping.');
    }),button('Download complete worksheet selection',()=>download(json(state.projected),'workbook-selection.json')),
      button('Download projected CSV',()=>download(body.csv.text,'selected-worksheet.csv','text/csv;charset=utf-8')),
      button('Download original worksheet row map',()=>download(body.rowMap.text,'selected-worksheet-rows.jsonl','application/x-ndjson')));
    panel.append(actions); return panel;
  }
  async function openRetainedSelection(id) {
    const selected = context.getBook().workbookSelections.find(item=>item.id===id);
    const body = workbookSelectionBody(selected), original = context.getBook().workbookSources.find(item=>item.id===selected.sourceId);
    const response = await context.api('/api/source-tables/workbook/inspect',{source:original,preview:{
      sheet:body.mapping.plan.sheet,range:body.mapping.plan.range,offset:0,limit:PAGE},headerRow:body.mapping.plan.headerRow});
    if (!alive()) return;
    state.sourceId = original.id; state.preview = response.preview; state.draft = draftFromMapping(body.mapping);
    state.projected = {source:original,projection:{text:selected.text,bytes:utf8(selected.text).length,sha256:selected.sha256}};
    state.outputPage = 0;
    context.store(context.chooseSelection(context.getBook(),id),{redraw:true});
    context.status('Selected the retained worksheet and its original CSV edition. Its saved conversion choices are ready for review or another source edition.');
  }
  function render() {
    if (!alive()) return node('div');
    const selectedBook = context.getBook();
    if (selectedBook.id !== currentBookId) {
      serial++; roleState.clear(); state = {}; currentRole = ''; currentBookId = selectedBook.id;
    }
    const role = context.getRole();
    if (role !== currentRole) {
      if (currentRole) roleState.set(currentRole,state);
      currentRole = role; state = roleState.get(role) || {};
    }
    const book = context.getBook(), sources = book.workbookSources || [];
    if (!source() && sources.length) state.sourceId = sources[0].id;
    const panel = section('Excel workbook selections',
      'Receive the complete XLSX, select an original worksheet and range, and keep the source cells beside the projected planning table.');
    const actions = node('div',undefined,'pt-actions');
    actions.append(button('Open Excel workbook',()=>context.fileChooser('.xlsx',receiveFile)));
    const original = source();
    if (original) actions.append(button('Download original workbook',()=>download(
      decodeWorkbookBytes(original.dataBase64),original.filename,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')));
    panel.append(actions);
    if (sources.length) {
      panel.append(select('Retained original workbook',state.sourceId,sources.map(item=>[item.id,item.filename+' · '+item.bytes.toLocaleString()+' bytes']),
        value=>context.work(()=>{state.sourceId=value;state.draft=null;state.projected=null;state.preview=null;return inspect(source(),{reset:true});})));
      if (original) {
        const choice = state.draft?.sheet || original.description.sheets[0]?.name;
        panel.append(select('Original worksheet',choice,original.description.sheets.map(item=>[item.name,
          item.name+' · '+(item.state||'visible')+' · '+(item.observedRange||'no stored cells')]),
          value=>context.work(()=>inspect(original,{sheet:value,reset:true}))));
        if (!state.preview) panel.append(button('Inspect selected worksheet',()=>inspect(original,{sheet:choice,reset:true})));
        const description = original.description;
        panel.append(node('p',description.sheets.length+' worksheets · '+description.epoch+
          ' date system · '+description.externalRelationships+' external workbook relationships retained.','pt-help'));
        const summary = description.sheets.map(item=>[item.name,item.state||'visible',item.observedRange||'Empty',
          item.formulaCells,item.errorCells,item.hiddenRowCount,item.mergedRangeCount]);
        panel.append(details('Complete workbook structure',
          table(['Worksheet','Visibility','Stored range','Formula cells','Error cells','Hidden rows','Merged ranges'],summary),
          table(['Defined name','Sheet scope','Original reference'],(description.definedNames||[]).map(item=>
            [item.name,item.localSheetId??'Workbook',previewText(item.text)])),
          node('p','Original calculation settings: '+JSON.stringify(description.calculationProperties)+'. External references remain in the original workbook.','pt-help')));
      }
    }
    const doc = context.getDocument(), saved = (book.workbookSelections||[]).filter(item=>item.documentId===doc?.id);
    if (saved.length) {
      const selected = selectedPlanningWorkbook(book,doc.id,doc.selectedEditionId);
      panel.append(select('Saved selection for this planning table',selected?.id||'',
        [['','Choose a complete retained worksheet selection'],...saved.map(item=>{
          const body = workbookSelectionBody(item), file=book.workbookSources.find(source=>source.id===item.sourceId);
          return [item.id,body.mapping.plan.name+' · '+file.filename+' · '+body.mapping.plan.sheet+'!'+body.mapping.plan.range];
        })],value=>{if(value)context.work(()=>openRetainedSelection(value));}));
      if (!selected && saved.some(item=>item.editionId===doc.selectedEditionId)) panel.append(node('p',
        'Choose the intended saved worksheet selection for this CSV edition before preparing the native plan.','pt-help'));
    }
    if (state.preview) panel.append(sourcePreview());
    const mapping = mappingPanel(); if (mapping) panel.append(mapping);
    const output = outputPanel(); if (output) panel.append(output);
    return panel;
  }
  return {render, dispose(){disposed=true;serial++;roleState.clear();state={};}};
}
