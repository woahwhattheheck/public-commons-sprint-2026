import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { sha256, fault, atomicWrite, readJson, writeJson, fetchSource, integer } from './common.mjs';

const execFileAsync = promisify(execFile);
export const ACQUISITION = JSON.parse(await fs.readFile(new URL('./source-acquisition.json', import.meta.url), 'utf8'));
export const REFERENCE_FILES = [
  'acceptance-requirements.json', 'acceptance-response-contract.json', 'engineering-pages.json',
  'interface-response-instructions.json', 'interfaces.json', 'price-response-template.json', 'staffing-response-template.json'
];
const nonempty = values => values.some(value => value !== '' && value !== null && value !== undefined);
const text = value => value === null || value === undefined ? '' : String(value);
const previewName = (attachment, sheet, page) => `attachment${attachment}-sheet${sheet}-page${page}.json`;
const previewUrl = (book, sheet, page) => ACQUISITION.previewRoute.replace('{documentId}', encodeURIComponent(book.documentId)).replace('{page}', page).replace('{sheet}', sheet);
const reference = row => ({ source_row: row.number, values: row.values, source_url: row.url, retained_preview: row.file, retained_preview_sha256: row.sha256 });

export async function verifyReference(directory) {
  const pins = await readJson(path.join(directory, 'SOURCE_PINS.json'));
  if (pins.schema !== 'erp-burbank.source-pins.v1' || !Array.isArray(pins.files)) throw fault('SOURCE_PINS_INVALID', 'Unsupported source pin manifest');
  for (const name of REFERENCE_FILES) {
    const expected = pins.files.find(row => row.file === name);
    if (!expected) throw fault('SOURCE_PIN_MISSING', `Missing pin for ${name}`);
    const bytes = await fs.readFile(path.join(directory, name));
    if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw fault('SOURCE_PIN_CHANGED', `Reference changed: ${name}`);
  }
  return pins;
}
async function getSheet(book, sheet, { directory, cacheDirectory, offline, write, signal, fetchImpl, onProgress }) {
  const pages = [], rows = []; let page = 1, total = 1;
  while (page <= total) {
    signal?.throwIfAborted();
    const filename = previewName(book.attachment, sheet, page), url = previewUrl(book, sheet, page);
    let bytes, receipt, fromCache = false;
    if (cacheDirectory) {
      try {
        bytes = await fs.readFile(path.join(cacheDirectory, filename)); fromCache = true;
        try { receipt = await readJson(path.join(cacheDirectory, filename.replace(/\.json$/, '.receipt.json'))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (receipt?.sha256 && receipt.sha256 !== sha256(bytes)) throw fault('CACHED_SOURCE_CHANGED', `Cached preview changed: ${filename}`);
        if ((receipt?.source_url || receipt?.url) && (receipt.source_url || receipt.url) !== url) throw fault('CACHED_SOURCE_URL_MISMATCH', `Cached receipt belongs to another URL: ${filename}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!bytes) {
      if (offline) throw fault('CACHED_PREVIEW_MISSING', `Offline preview is missing: ${filename}`);
      const fetched = await fetchSource(url, { signal, fetchImpl, maxBytes: 8 * 1024 * 1024 });
      if (!fetched.ok) throw fault('PREVIEW_HTTP_ERROR', `Public preview returned HTTP ${fetched.receipt.status}`, { url });
      bytes = fetched.bytes; receipt = fetched.receipt;
    }
    let result;
    try { result = JSON.parse(bytes.toString('utf8')); } catch { throw fault('PREVIEW_NOT_JSON', 'Public preview did not return JSON', { url }); }
    if (result.kind !== 'sheet' || !Array.isArray(result.rows) || result.rows.some(row => !Array.isArray(row))) throw fault('PREVIEW_SCHEMA_CHANGED', 'Public preview is not a worksheet response', { url });
    const nativePage = integer(result.page, 'preview page', 1), nativeSheet = integer(result.sheet, 'preview sheet', 0);
    const advertised = integer(result.totalPages, 'preview totalPages', 1, 1000);
    if (nativePage !== page || nativeSheet !== sheet || result.sheets?.[sheet] !== book.sheets[sheet]) throw fault('PREVIEW_IDENTITY_CHANGED', 'The returned document page/sheet differs from the selected original source', { url });
    if (page > 1 && advertised !== total) throw fault('PREVIEW_PAGE_COUNT_CHANGED', 'Worksheet page count changed during acquisition; use a fresh reference directory');
    total = advertised;
    const first = integer(result.firstRow, 'preview firstRow', 1);
    if (rows.length && first !== rows.at(-1).number + 1) throw fault('PREVIEW_ROW_GAP', 'Worksheet preview pages have an overlap or gap', { url });
    const hash = sha256(bytes), relative = 'native-previews/' + filename;
    if (write) {
      await atomicWrite(path.join(directory, relative), bytes);
      await writeJson(path.join(directory, relative.replace(/\.json$/, '.receipt.json')), { ...(receipt || {}), source_url: url, sha256: hash, bytes: bytes.length, acquisition: fromCache ? 'operator-supplied retained preview' : 'public GET' });
    }
    const summary = { page, total_pages: total, first_row: first, rows: result.rows.length, truncated: Boolean(result.truncated), retained_preview: relative, retained_preview_sha256: hash, source_url: url };
    pages.push(summary);
    result.rows.forEach((values, index) => rows.push({ number: first + index, values, url, file: relative, sha256: hash }));
    await onProgress({ attachment: book.attachment, sheet: book.sheets[sheet], page, totalPages: total, fromCache });
    page++;
  }
  return { name: book.sheets[sheet], index: sheet, pages, rows };
}
function buildAcceptance(book, sheets) {
  const items = [], summaries = [];
  for (const sheet of sheets.slice(1)) {
    const code = ({ Finance: 'FIN', Budget: 'BUD', 'Human Resources': 'HR', System: 'SYS' })[sheet.name];
    if (!code) throw fault('UNKNOWN_REQUIREMENT_SHEET', `Unmapped acceptance worksheet ${sheet.name}`);
    let previous = null, count = 0, continuationCount = 0;
    const headers = [], other = [];
    for (const row of sheet.rows) {
      const values = row.values, number = text(values[0]).trim();
      if (/^\d+$/.test(number)) {
        const sourceNumber = integer(number, 'native requirement number', 1, 1000000);
        if (sourceNumber !== count + 1) throw fault('REQUIREMENT_NUMBER_GAP', `Requirement numbers changed within ${sheet.name}`);
        previous = {
          id: `BERP-A5-${code}-${String(sourceNumber).padStart(3, '0')}`, worksheet: sheet.name, worksheet_index: sheet.index,
          requirement_number: text(values[0]), functional_area: text(values[1]), process: text(values[2]), requirement: text(values[3]),
          respondent_fields: { response: text(values[4]), module_system: text(values[5]), phase: text(values[6]), comment: text(values[7]) },
          source_record_id: `attachment5/sheet${sheet.index}/row${row.number}`,
          ...reference(row), original_values: values, continuations: []
        };
        delete previous.values; items.push(previous); count++;
      } else if (previous && !number && text(values[3]).trim()) {
        previous.continuations.push({ source_record_id: `attachment5/sheet${sheet.index}/row${row.number}`, ...reference(row) }); continuationCount++;
      } else if (row.number <= 3) headers.push(reference(row));
      else if (nonempty(values)) other.push(reference(row));
    }
    summaries.push({ name: sheet.name, index: sheet.index, numbered_requirement_count: count, continuation_count: continuationCount, native_header_rows: headers, other_populated_rows: other, pages: sheet.pages, page_census_complete: true });
  }
  return {
    schema: 'tjl.burbank-acceptance-requirements.v1', source_workbook: book.filename,
    representation: 'Original worksheet values from public read-only JSON previews. Source hashes identify retained preview JSON, not original XLSX bytes. Native source cells and blank respondent fields are preserved.',
    numbered_requirement_count: items.length, continuation_count: items.reduce((sum, item) => sum + item.continuations.length, 0), sheets: summaries, items
  };
}
function buildResponseContract(book, sheet) {
  const rows = sheet.rows.filter(row => nonempty(row.values));
  const tagged = (codes, codeField) => rows.filter(row => codes.includes(text(row.values[0]).trim())).map(row => ({ [codeField]: text(row.values[0]).trim(), description: text(row.values[1]), source_row: row.number, source_url: row.url }));
  const responseCodes = tagged(['Y', 'Y-WC', 'N', 'I'], 'code'), phases = tagged(['1', '2', 'X'], 'code');
  if (responseCodes.length !== 4 || phases.length !== 3) throw fault('RESPONSE_KEY_CHANGED', 'Original response/phase key rows require source review');
  return {
    schema: 'tjl.burbank-acceptance-response-contract.v1', source_workbook: book.filename,
    representation: 'Original workbook values exposed by the public read-only preview; original XLSX bytes or formulas are not asserted.',
    respondent_columns: rows.filter(row => ['E', 'F', 'G', 'H'].includes(text(row.values[0]).trim())).map(row => ({ column: text(row.values[0]).trim(), header: text(row.values[1]), description: text(row.values[2]), source_row: row.number, source_url: row.url })),
    response_codes: responseCodes, phase_codes: phases,
    source_discrepancies: [
      { topic: 'Conditional response code', workbook: 'Y-WC', rfp_page: 60, rfp_narrative: 'Y-ND', handling: 'Keep the native workbook response key and retain the narrative discrepancy for source clarification.' },
      { topic: 'Functional worksheet title', native_title: 'Attachment 6 - Acceptance Requirements', original_file: 'Attachment 5 - Acceptance Requirements.xlsx', handling: 'Preserve original source cells and identify the workbook by its published filename.' }
    ], instructions: rows.map(reference), instruction_pages: sheet.pages
  };
}
function buildInterfaces(book, sheet) {
  const header = sheet.rows.find(row => row.values[0] === 'Application');
  if (!header) throw fault('INTERFACE_HEADER_CHANGED', 'The original interface header is missing');
  const rows = sheet.rows.filter(row => row.number > header.number && text(row.values[0]).trim());
  return {
    schema: 'tjl.burbank-native-interface-inventory.v1', source_kind: 'original workbook rows through public document preview',
    native_workbook_filename: book.filename, source_document_id: book.documentId, sheet: sheet.name, headers: header.values,
    first_row: sheet.rows[0]?.number || 1, row_count: sheet.rows.length, truncated: sheet.pages.some(page => page.truncated),
    interfaces: rows.map(row => ({
      id: `IF-${String(row.number).padStart(3, '0')}`, source_record_id: `Attachment6/Interfaces/row${row.number}`, source_row: row.number,
      application: text(row.values[0]), application_description: text(row.values[1]), interface_description: text(row.values[2]), city_comments: text(row.values[3]),
      source_url: row.url, source_sha256: row.sha256,
      original_columns: Object.fromEntries(header.values.map((name, index) => [name, row.values[index] ?? ''])), original_values: row.values
    }))
  };
}
function buildTemplate(attachment, sheets, kind) {
  return {
    schema: `tjl.burbank-native-${kind}-template.v1`,
    representation: 'Original publicly previewed worksheet values. Empty respondent cells and native zero placeholders remain source values, not offered hours, prices or commitments. XLSX formatting, validation and formulas are not asserted.',
    attachment: String(attachment),
    sheets: sheets.map(sheet => ({
      name: sheet.name, index: sheet.index,
      pages: sheet.pages.map(({ rows, ...page }) => ({ ...page, row_count: rows })), page_census_complete: true,
      rows: sheet.rows.filter(row => nonempty(row.values)).map(row => ({ source_record_id: `attachment${attachment}/sheet${sheet.index}/row${row.number}`, source_row: row.number, original_values: row.values, source_url: row.url, retained_preview_sha256: row.sha256 }))
    }))
  };
}
export async function materializeReference({ directory, cacheDirectory, offline = false, rfpFile, overwrite = false, write = true, signal, fetchImpl = fetch, onProgress = () => {} }) {
  if (!path.isAbsolute(directory)) throw fault('ABSOLUTE_REFERENCE_REQUIRED', '--reference must be an absolute directory');
  if (write) {
    try { await fs.access(path.join(directory, 'SOURCE_PINS.json')); if (!overwrite) return { existing: true, pins: await verifyReference(directory) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  }
  const collected = new Map();
  for (const book of ACQUISITION.workbooks) {
    const sheets = [];
    for (let sheet = 0; sheet < book.sheets.length; sheet++) sheets.push(await getSheet(book, sheet, { directory, cacheDirectory, offline, write, signal, fetchImpl, onProgress }));
    collected.set(book.attachment, { book, sheets });
  }
  const acceptance = collected.get(5), interfaces = collected.get(6), staffing = collected.get(11), prices = collected.get(18);
  const output = {
    'acceptance-requirements.json': buildAcceptance(acceptance.book, acceptance.sheets),
    'acceptance-response-contract.json': buildResponseContract(acceptance.book, acceptance.sheets[0]),
    'interfaces.json': buildInterfaces(interfaces.book, interfaces.sheets[1]),
    'interface-response-instructions.json': interfaces.sheets[0].rows.filter(row => nonempty(row.values)).map(row => ({ row: row.number, cells: row.values })),
    'staffing-response-template.json': buildTemplate(11, staffing.sheets, 'staffing'),
    'price-response-template.json': buildTemplate(18, prices.sheets, 'price'),
    'engineering-pages.json': {}
  };
  let rfpSha = null;
  if (rfpFile) {
    const pdf = await fs.readFile(rfpFile); rfpSha = sha256(pdf);
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', path.resolve(rfpFile), '-'], { maxBuffer: 16 * 1024 * 1024, signal });
    const pages = stdout.split('\f');
    for (const page of ACQUISITION.rfp.engineeringPages) {
      if (typeof pages[page - 1] !== 'string') throw fault('RFP_PAGE_MISSING', `RFP does not contain page ${page}`);
      output['engineering-pages.json'][page] = pages[page - 1];
    }
  }
  const encoded = Object.fromEntries(REFERENCE_FILES.map(file => [file, Buffer.from(JSON.stringify(output[file], null, 2) + '\n')]));
  const pins = { schema: 'erp-burbank.source-pins.v1', originalRfpSha256: rfpSha,
    representation: 'Original public workbook preview values, including source row and preview response SHA. These are not the original XLSX ZIP bytes.' + (rfpFile ? ' Engineering pages are from the operator-selected PDF using pdftotext.' : ' Engineering-page text is optional and empty; pass --rfp ORIGINAL.pdf with pdftotext installed to materialize it.'),
    files: REFERENCE_FILES.map(file => ({ file, bytes: encoded[file].length, sha256: sha256(encoded[file]) })) };
  if (write) {
    for (const file of REFERENCE_FILES) await atomicWrite(path.join(directory, file), encoded[file]);
    await writeJson(path.join(directory, 'SOURCE_PINS.json'), pins);
  }
  return { existing: false, pins, output, summary: { requirements: output['acceptance-requirements.json'].numbered_requirement_count, continuations: output['acceptance-requirements.json'].continuation_count, interfaces: output['interfaces.json'].interfaces.length, staffingSheets: staffing.sheets.length, priceSheets: prices.sheets.length, engineeringPages: Object.keys(output['engineering-pages.json']).length } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--reference') options.directory = path.resolve(args[++index]);
    else if (flag === '--cache') options.cacheDirectory = path.resolve(args[++index]);
    else if (flag === '--rfp') options.rfpFile = path.resolve(args[++index]);
    else if (flag === '--offline') options.offline = true;
    else if (flag === '--overwrite') options.overwrite = true;
    else if (flag === '--inspect-only') options.write = false;
    else throw fault('UNKNOWN_ARGUMENT', `Unknown argument ${flag}`);
  }
  if (!options.directory) throw fault('REFERENCE_REQUIRED', 'Usage: node materialize-reference.mjs --reference ABS_DIR [--cache ABS_NATIVE_PREVIEWS --offline] [--rfp ORIGINAL.pdf] [--inspect-only]');
  const result = await materializeReference(options);
  console.log(JSON.stringify({ existing: result.existing, summary: result.summary, pins: result.pins }, null, 2));
}
