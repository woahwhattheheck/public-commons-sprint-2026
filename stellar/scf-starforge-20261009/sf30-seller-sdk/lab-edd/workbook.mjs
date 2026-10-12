// MIT. Native lab workbook transport over the existing XLSX reader and file job.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const HELPER = fileURLToPath(new URL('./workbook_bridge.py', import.meta.url));
const SCHEMA = 'stellar-forge.lab-edd-workbook.v1';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SOURCE_BYTES = 64 * 1024 * 1024;
const CONTROL_BYTES = 128 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const error = (code, message, details) => Object.assign(new Error(message), { code, ...(details === undefined ? {} : { details }) });
function sourceIdentity(file) {
  if (!file || typeof file.filename !== 'string' || !(file.bytes instanceof Uint8Array) ||
      file.bytes.byteLength === 0 || file.bytes.byteLength > SOURCE_BYTES || !HASH.test(file.sha256 ?? ''))
    throw error('LAB_EDD_WORKBOOK_SOURCE', 'Use the complete original workbook and its retained SHA-256.');
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  if (sha256 !== file.sha256) throw error('LAB_EDD_WORKBOOK_CHANGED', 'The original workbook changed before native decoding.');
  return { bytes: file.bytes.byteLength, sha256 };
}
function nativeWorkbook(operation, file, control, signal) {
  signal?.throwIfAborted();
  const source = sourceIdentity(file);
  const input = Buffer.from(JSON.stringify({ schema: SCHEMA, operation, filename: file.filename, source, ...control }), 'utf8');
  if (input.byteLength > CONTROL_BYTES)
    throw error('LAB_EDD_CONTROL_SIZE', 'The complete workbook control document exceeds the original job input capacity.');
  const allowance = operation === 'decode' ? 512 * 1024 * 1024 : 128 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(process.env.LAB_EDD_PYTHON || 'python3', [HELPER], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (cause) {
      reject(error('LAB_EDD_WORKBOOK_START', 'Start the installed Python 3.10+ workbook reader.', { message: cause.message }));
      return;
    }
    const chunks = [], diagnostics = [];
    let size = 0, diagnosticSize = 0, failure, inputFailure, killTimer, closed = false;
    const stop = cause => {
      if (closed) return;
      failure ??= cause;
      child.stdin.destroy(); child.stdio[3]?.destroy();
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2000);
      killTimer.unref?.();
    };
    const aborted = () => stop(signal.reason ?? error('LAB_EDD_CANCELLED', 'The original file job was cancelled.'));
    signal?.addEventListener('abort', aborted, { once: true });
    child.once('error', cause => stop(error('LAB_EDD_WORKBOOK_START',
      'The installed workbook reader could not start.', { message: cause.message })));
    child.stdin.on('error', cause => { inputFailure ??= cause; });
    child.stdio[3].on('error', cause => { inputFailure ??= cause; });
    child.stdout.on('error', cause => stop(cause));
    child.stderr.on('error', cause => stop(cause));
    child.stdout.on('data', block => {
      size += block.byteLength;
      if (size > allowance) stop(error('LAB_EDD_WORKBOOK_OUTPUT_SIZE', 'The complete native result exceeds the file job output capacity.'));
      else if (!failure) chunks.push(block);
    });
    child.stderr.on('data', block => {
      diagnosticSize += block.byteLength;
      if (diagnosticSize > 2 * 1024 * 1024) stop(error('LAB_EDD_WORKBOOK_DIAGNOSTICS', 'The native reader exceeded its diagnostic capacity.'));
      else diagnostics.push(block);
    });
    child.once('close', (code, nativeSignal) => {
      closed = true; clearTimeout(killTimer);
      signal?.removeEventListener('abort', aborted);
      if (failure) { reject(failure); return; }
      const stderr = Buffer.concat(diagnostics).toString('utf8').trim();
      if (code !== 0) {
        let detail;
        try { detail = JSON.parse(stderr); } catch {}
        reject(error(detail?.error ?? 'LAB_EDD_WORKBOOK_FAILED',
          detail?.message ?? 'The native workbook reader returned an error.',
          detail?.details ?? { exitCode: code, signal: nativeSignal, stderr, input: inputFailure?.message }));
        return;
      }
      if (inputFailure) { reject(error('LAB_EDD_WORKBOOK_TRANSFER', 'The original workbook transfer did not complete.', { message: inputFailure.message })); return; }
      const bytes = Buffer.concat(chunks, size);
      if (operation === 'render') { resolve(bytes); return; }
      try {
        const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (decoded?.schema !== SCHEMA || !Array.isArray(decoded.tables) ||
            decoded.tables.some(table => table.filename !== file.filename || table.origin?.containerSha256 !== source.sha256))
          throw error('LAB_EDD_WORKBOOK_REPLY', 'The native reader returned a different workbook identity.');
        resolve(decoded);
      } catch (cause) {
        reject(cause.code ? cause : error('LAB_EDD_WORKBOOK_REPLY', 'The native reader returned an invalid complete result.', { message: cause.message }));
      }
    });
    if (signal?.aborted) { aborted(); return; }
    // Both independent streams are drained by the same child: JSON first, then exact binary source.
    child.stdin.end(input);
    child.stdio[3].end(Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength));
  });
}
export async function decodeLabWorkbooks({ files, signal }) {
  if (!Array.isArray(files)) throw error('LAB_EDD_WORKBOOK_SOURCE', 'Supply the original source file set.');
  const tables = [], unassigned = [];
  for (const file of files) {
    signal?.throwIfAborted();
    if (!/\.xlsx$/i.test(file.filename)) {
      if (/\.xls$/i.test(file.filename))
        throw error('DTS8D_XLSX_REQUIRED', 'Save the original DTS workbook as XLSX for this native receiving profile.', { filename: file.filename });
      unassigned.push({ filename: file.filename, sha256: file.sha256, reason: 'Retained supporting source member.' });
      continue;
    }
    const decoded = await nativeWorkbook('decode', file, {}, signal);
    tables.push(...decoded.tables);
  }
  if (!tables.length) throw error('DTS8D_XLSX_REQUIRED', 'Select the original XLSX workbook with the DTS8D observation worksheet.');
  return { tables, unassigned };
}
export async function renderLabWorkbooks({ originals, tables, fieldDefinitions, signal }) {
  if (!Array.isArray(originals) || !Array.isArray(tables) || !Array.isArray(fieldDefinitions))
    throw error('LAB_EDD_WORKBOOK_REVIEW', 'Use the complete source-bound workbook review and native field contract.');
  const native = [];
  for (const file of originals) {
    signal?.throwIfAborted();
    const selected = tables.filter(table => table.filename === file.filename);
    if (!selected.length) { native.push({ ...file, mediaType: file.mediaType ?? 'application/octet-stream' }); continue; }
    if (selected.length !== 1 || selected[0].origin?.sheetCount !== 1)
      throw error('DTS8D_ONE_SHEET', 'DTS8D requires the first and only worksheet.', { filename: file.filename });
    const table = selected[0];
    if (table.origin.containerSha256 !== file.sha256 || table.sha256 !== file.sha256 ||
        table.headers.length !== fieldDefinitions.length ||
        table.headers.some((name,index) => name !== fieldDefinitions[index].name))
      throw error('DTS8D_COLUMN_LAYOUT', 'Use the exact original workbook and all 150 ordered DTS8D headers.');
    const rows = table.rows.map(row => ({
      rowNumber: row.rowNumber, fields: row.fields,
      literalColumns: [...new Set((row.changes ?? []).filter(choice => choice.action !== 'keep')
        .map(choice => table.keys.indexOf(choice.field) + 1))],
    }));
    const bytes = await nativeWorkbook('render', file, {
      sheetName: table.origin.sheetName, headers: table.headers,
      fieldTypes: fieldDefinitions.map(field => field.type), rows,
    }, signal);
    native.push({ filename: file.filename, bytes, mediaType: XLSX });
  }
  return native;
}
