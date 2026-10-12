// MIT. Native lab workbook transport over the existing XLSX reader and file job.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
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
const brokerDirectories = new WeakMap();
async function pythonExecutable() {
  const selected = process.env.LAB_EDD_PYTHON || 'python3';
  const candidates = isAbsolute(selected) || selected.includes('/') || selected.includes('\\') ?
    [resolve(selected)] : (process.env.PATH || '/usr/local/bin:/usr/bin:/bin').split(delimiter)
      .filter(Boolean).map(directory => resolve(directory, selected));
  for (const candidate of candidates) {
    try {
      const filename = await realpath(candidate);
      await access(filename, constants.X_OK);
      return filename;
    } catch (cause) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(cause.code)) throw cause;
    }
  }
  throw error('LAB_EDD_WORKBOOK_START', 'Select the installed Python 3.10+ workbook reader.', { executable: selected });
}
function nativeFailure(code, nativeSignal, diagnostics, inputFailure) {
  const stderr = Buffer.from(diagnostics).toString('utf8').trim();
  let detail;
  try { detail = JSON.parse(stderr); } catch {}
  return error(detail?.error ?? 'LAB_EDD_WORKBOOK_FAILED',
    detail?.message ?? 'The native workbook reader returned an error.',
    detail?.details ?? { exitCode: code, signal: nativeSignal, stderr, input: inputFailure?.message });
}
function nativeReply(operation, file, source, bytes) {
  if (operation === 'render') return bytes;
  try {
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (decoded?.schema !== SCHEMA || !Array.isArray(decoded.tables) ||
        decoded.tables.some(table => table.filename !== file.filename || table.origin?.containerSha256 !== source.sha256))
      throw error('LAB_EDD_WORKBOOK_REPLY', 'The native reader returned a different workbook identity.');
    return decoded;
  } catch (cause) {
    throw cause.code ? cause : error('LAB_EDD_WORKBOOK_REPLY', 'The native reader returned an invalid complete result.', { message: cause.message });
  }
}
async function brokerWorkbook(operation, file, source, input, allowance, signal, processes) {
  if (typeof processes?.directory !== 'function' || typeof processes?.run !== 'function')
    throw error('LAB_EDD_WORKBOOK_PROCESS_HOST', 'Use the original file job native process manager.');
  signal?.throwIfAborted();
  const python = await pythonExecutable();
  signal?.throwIfAborted();
  let directoryPromise = brokerDirectories.get(processes);
  if (!directoryPromise) {
    directoryPromise = processes.directory();
    brokerDirectories.set(processes, directoryPromise);
  }
  const root = await directoryPromise;
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(root, 'lab-edd-'));
  let submitted = false, returned = false, failure;
  try {
    await chmod(directory, 0o700);
    const controlPath = join(directory, 'control.json');
    const sourcePath = join(directory, 'source.xlsx');
    const outputPath = join(directory, operation === 'decode' ? 'decoded.json' : 'prepared.xlsx');
    await writeFile(controlPath, input, { flag: 'wx', mode: 0o600, signal });
    await writeFile(sourcePath, file.bytes, { flag: 'wx', mode: 0o600, signal });
    signal?.throwIfAborted();
    // The original process manager owns Python and its process group even when the
    // worker is terminated. Complete source/result files stay in its private root;
    // the broker's bounded diagnostic pipes never carry the workbook payload.
    submitted = true;
    const result = await processes.run({
      command: [python, HELPER, '--files', controlPath, sourcePath, outputPath],
      cwd: directory, maxStdoutBytes: 4096, maxStderrBytes: 1024 * 1024,
    });
    returned = true;
    signal?.throwIfAborted();
    if (result.exitCode !== 0) throw nativeFailure(result.exitCode, result.signal, result.stderr);
    if (result.stdout.byteLength !== 0)
      throw error('LAB_EDD_WORKBOOK_REPLY', 'The native file reader returned an unexpected stdout payload.');
    const output = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await output.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > allowance)
        throw error('LAB_EDD_WORKBOOK_OUTPUT_SIZE', 'The complete native result exceeds the file job output capacity.');
      const bytes = await output.readFile();
      signal?.throwIfAborted();
      if (bytes.byteLength !== stat.size)
        throw error('LAB_EDD_WORKBOOK_REPLY', 'The complete native result changed during delivery.');
      return nativeReply(operation, file, source, bytes);
    } finally { await output.close(); }
  } catch (cause) {
    failure = cause; throw cause;
  } finally {
    // A rejected broker request can precede process retirement. Its host removes
    // the root after terminating descendants; only a returned result is ours to clean.
    if (!submitted || returned) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch (cause) {
        if (!failure) throw error('LAB_EDD_WORKBOOK_CLEANUP', 'The completed workbook staging could not be removed.', { message: cause.message });
      }
    }
  }
}
function nativeWorkbook(operation, file, control, signal, processes) {
  signal?.throwIfAborted();
  const source = sourceIdentity(file);
  const input = Buffer.from(JSON.stringify({ schema: SCHEMA, operation, filename: file.filename, source, ...control }), 'utf8');
  if (input.byteLength > CONTROL_BYTES)
    throw error('LAB_EDD_CONTROL_SIZE', 'The complete workbook control document exceeds the original job input capacity.');
  const allowance = operation === 'decode' ? 512 * 1024 * 1024 : 128 * 1024 * 1024;
  if (processes != null) return brokerWorkbook(operation, file, source, input, allowance, signal, processes);
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
      if (code !== 0) {
        reject(nativeFailure(code, nativeSignal, Buffer.concat(diagnostics), inputFailure)); return;
      }
      if (inputFailure) { reject(error('LAB_EDD_WORKBOOK_TRANSFER', 'The original workbook transfer did not complete.', { message: inputFailure.message })); return; }
      try { resolve(nativeReply(operation, file, source, Buffer.concat(chunks, size))); }
      catch (cause) { reject(cause); }
    });
    if (signal?.aborted) { aborted(); return; }
    // Both independent streams are drained by the same child: JSON first, then exact binary source.
    child.stdin.end(input);
    child.stdio[3].end(Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength));
  });
}
export async function decodeLabWorkbooks({ files, signal, processes }) {
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
    const decoded = await nativeWorkbook('decode', file, {}, signal, processes);
    tables.push(...decoded.tables);
  }
  if (!tables.length) throw error('DTS8D_XLSX_REQUIRED', 'Select the original XLSX workbook with the DTS8D observation worksheet.');
  return { tables, unassigned };
}
export async function renderLabWorkbooks({ originals, tables, fieldDefinitions, signal, processes }) {
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
    }, signal, processes);
    native.push({ filename: file.filename, bytes, mediaType: XLSX });
  }
  return native;
}
