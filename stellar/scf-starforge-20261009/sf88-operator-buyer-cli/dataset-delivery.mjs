// MIT. Local SF88 acquisition -> original SF100 delivery CLI. No buyer/network calls.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir } from 'node:fs/promises';
import { dirname, basename, join, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { InputError, need } from './config.mjs';
import { canonical, digest, inspectDatasetPage, nativeDatasetContract, object } from './dataset-page.mjs';

const NATIVE = fileURLToPath(new URL('../sf100-buyer-dataset-delivery/deliver.mjs', import.meta.url));
const WORKER = fileURLToPath(new URL('./dataset-export-worker.mjs', import.meta.url));
const MAX_INPUT = 2 * 1024 * 1024, MAX_PAGES = 4096, MAX_EXPORT = 256 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const exactPath = value => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0');
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const equal = (a, b) => canonical(a) === canonical(b);
const fail = code => { throw new InputError(code); };

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function directory(path, privateMode = true) {
  need(exactPath(path), 'DATASET_DELIVERY_PATH_INVALID');
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (!privateMode || (info.mode & 0o077) === 0), 'DATASET_DELIVERY_DIRECTORY_INVALID');
}
async function file(path, limit, privateMode = true) {
  need(exactPath(path), 'DATASET_DELIVERY_PATH_INVALID');
  need(await realpath(path) === path, 'DATASET_DELIVERY_SYMLINK_REFUSED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= limit &&
      (!privateMode || (info.mode & 0o077) === 0), 'DATASET_DELIVERY_FILE_INVALID');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
async function bounded(path, limit, privateMode = true) {
  const handle = await file(path, limit, privateMode);
  try {
    // Read at most limit+1 even if a file grows after stat.
    const bytes = Buffer.allocUnsafe(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const {bytesRead} = await handle.read(bytes, size, bytes.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    need(size <= limit, 'DATASET_DELIVERY_NATIVE_INPUT_LIMIT');
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}
function json(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { fail('DATASET_DELIVERY_JSON_INVALID'); }
}
async function jsonFile(path, limit) { return json(await bounded(path, limit)); }
async function hashFile(path, limit) {
  const handle = await file(path, limit);
  try {
    const hash = createHash('sha256'), bytes = Buffer.allocUnsafe(65536);
    let size = 0;
    while (true) {
      const {bytesRead} = await handle.read(bytes, 0, bytes.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      need(size <= limit, 'DATASET_DELIVERY_OUTPUT_LIMIT');
      hash.update(bytes.subarray(0, bytesRead));
    }
    return {sha256:hash.digest('hex'), bytes:size};
  } finally { await handle.close(); }
}
async function createMarker(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  const parent = await open(dirname(path), constants.O_RDONLY);
  try { await parent.sync(); } finally { await parent.close(); }
}

async function nativeFingerprint() {
  // Read the original CLI at its exact repository path. Its fingerprint records provenance;
  // compatible owner updates remain subject to the archive, native scan, and output contracts.
  const source = await bounded(NATIVE, 256 * 1024, false);
  return createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
}
function native(command, out, extra = [], inputs = null) {
  const batch = command === 'append-batch';
  need(batch === (inputs !== null), 'DATASET_DELIVERY_NATIVE_INPUT_INVALID');
  const input = batch ? Buffer.from(JSON.stringify(inputs)) : null;
  need(!input || input.length <= 16 * 1024 * 1024, 'DATASET_DELIVERY_BATCH_INPUT_LIMIT');
  return new Promise((accept, reject) => {
    // In particular: no NODE_OPTIONS, SF36 signing material, provider keys, or inherited HOME.
    const child = spawn(process.execPath, batch ? [WORKER, out] : [NATIVE, command, '--out', out, ...extra], {
      shell:false, cwd:dirname(NATIVE), env:{LANG:'C', LC_ALL:'C', TZ:'UTC'},
      stdio:[batch ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let stdoutBytes = 0, stderrBytes = 0, reason = null, killTimer;
    const stop = code => {
      if (reason) return;
      reason = code;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    const timer = setTimeout(() => stop('DATASET_DELIVERY_NATIVE_TIMEOUT'), 120000);
    timer.unref();
    if (batch) {
      child.stdin.on('error', () => stop('DATASET_DELIVERY_NATIVE_INPUT_FAILED'));
      child.stdin.end(input);
    }
    child.stdout.on('data', bytes => {
      stdoutBytes += bytes.length;
      if (stdoutBytes > 65536) stop('DATASET_DELIVERY_NATIVE_OUTPUT_LIMIT');
      else chunks.push(bytes);
    });
    // Drain but never echo native diagnostics, which can quote untrusted file content.
    child.stderr.on('data', bytes => {
      stderrBytes += bytes.length;
      if (stderrBytes > 8192) stop('DATASET_DELIVERY_NATIVE_OUTPUT_LIMIT');
    });
    child.on('error', () => { reason = 'DATASET_DELIVERY_NATIVE_START_FAILED'; });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (reason || code !== 0) {
        const error = new InputError(reason || 'DATASET_DELIVERY_NATIVE_FAILED');
        error.nativeCommand = command;
        error.nativeExitCode = code;
        reject(error); return;
      }
      try {
        const value = json(Buffer.concat(chunks));
        need(object(value), 'DATASET_DELIVERY_NATIVE_RESULT_INVALID');
        accept(value);
      } catch (error) { reject(error); }
    });
  });
}

async function preflight(report) {
  need(object(report) && report.schema === 'stellar-forge.sf88.dataset-acquisition.v1' &&
    report.status === 'COMPLETE' && Array.isArray(report.pages) &&
    integer(report.pages.length, 1, MAX_PAGES) && report.completedPages === report.pages.length &&
    HEX.test(report.configurationSha256) && HEX.test(report.snapshot) &&
    typeof report.sessionId === 'string' && integer(report.totalRows, 0, 1000000) &&
    report.acquiredRows === report.totalRows, 'DATASET_DELIVERY_COMPLETE_REPORT_REQUIRED');
  await directory(report.directory);
  await directory(join(report.directory, 'pages'));
  await directory(join(report.directory, 'evidence'));
  const records = [], seenSources = new Set(), seenIntents = new Set();
  let previous = null, signature;
  for (let i = 0; i < report.pages.length; i++) {
    const p = report.pages[i], pageDir = join(report.directory, 'pages', String(i + 1).padStart(6, '0'));
    need(object(p) && p.index === i + 1 && typeof p.intentId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p.intentId) && typeof p.requestUrl === 'string',
    'DATASET_DELIVERY_PAGE_IDENTITY_INVALID');
    const expectedIntent = 'dataset:' + digest(canonical({session:report.configurationSha256,
      id:report.sessionId, index:i + 1, url:p.requestUrl}));
    need(p.intentId === expectedIntent && p.responsePath === join(pageDir, 'response.json') &&
      p.evidencePath === join(report.directory, 'evidence', digest(p.intentId) + '.json'),
    'DATASET_DELIVERY_SOURCE_PATH_MISMATCH');
    await directory(pageDir);
    const bytes = await bounded(p.responsePath, MAX_INPUT);
    const inspected = inspectDatasetPage(bytes, {url:p.requestUrl, previous,
      expectedSnapshot:report.snapshot, maxRows:1000000});
    need(i === report.pages.length - 1 ? inspected.nextCursor === null : inspected.nextCursor !== null,
      'DATASET_DELIVERY_TERMINAL_PAGE_MISMATCH');
    need(Object.entries(inspected).every(([key, value]) => equal(p[key], value)) &&
      inspected.total === report.totalRows && !seenSources.has(inspected.sha256) && !seenIntents.has(p.intentId),
    'DATASET_DELIVERY_SOURCE_CHANGED');
    const payload = json(bytes), evidenceBytes = await bounded(p.evidencePath, MAX_INPUT);
    const evidence = json(evidenceBytes), evidenceSha256 = digest(evidenceBytes);
    need(evidenceSha256 === p.evidenceSha256 && evidence.schema === 'scf82.checkout-evidence.v1' &&
      evidence.intentId === p.intentId && evidence.observation?.intentId === p.intentId,
    'DATASET_DELIVERY_EVIDENCE_CHANGED');
    const pageSignature = nativeDatasetContract(payload).signature;
    need(signature === undefined || signature === pageSignature, 'DATASET_DELIVERY_NATIVE_SIGNATURE_MISMATCH');
    signature = pageSignature;
    records.push({index:i, intent:p.intentId, responsePath:p.responsePath, evidencePath:p.evidencePath,
      sourceSha256:inspected.sha256, evidenceSha256, payloadSha256:digest(JSON.stringify(payload)),
      signature, requestCursor:previous?.nextCursor ?? null, nextCursor:inspected.nextCursor,
      returned:inspected.returned});
    seenSources.add(inspected.sha256); seenIntents.add(p.intentId);
    previous = inspected;
  }
  need(previous.nextCursor === null && previous.nextOffset === report.totalRows,
    'DATASET_DELIVERY_INCOMPLETE_SOURCE');
  return records;
}

async function prefix(out, records) {
  await directory(out); await directory(join(out, 'pages'));
  need(equal(await jsonFile(join(out, 'session.json'), 4096), {
    schema:'stellar-forge.buyer-delivery.v1', protocol:'SF30 dataset-page.v1',
    authorization:'EACH_PAGE_REQUIRES_INDEPENDENT_ORIGINAL_BUYER_APPROVAL',
  }), 'DATASET_DELIVERY_NATIVE_SESSION_MISMATCH');
  const names = (await readdir(join(out, 'pages'))).sort();
  need(names.length <= records.length && names.every((name, i) => name === String(i).padStart(5, '0') + '.json'),
    'DATASET_DELIVERY_ARCHIVE_PREFIX_MISMATCH');
  let previous = null;
  const chains = [];
  for (let i = 0; i < names.length; i++) {
    const archive = await jsonFile(join(out, 'pages', names[i]), MAX_INPUT + 4096), expected = records[i];
    need(object(archive), 'DATASET_DELIVERY_ARCHIVE_INVALID');
    const {chain, ...record} = archive;
    need(record.schema === 'stellar-forge.buyer-page-archive.v1' && record.index === i &&
      record.previous === previous && record.intent === expected.intent &&
      record.sourceSha256 === expected.sourceSha256 && record.evidenceSha256 === expected.evidenceSha256 &&
      record.requestCursor === expected.requestCursor && record.signature === expected.signature &&
      object(record.payload) && digest(JSON.stringify(record.payload)) === expected.payloadSha256 &&
      chain === digest(JSON.stringify(record)), 'DATASET_DELIVERY_ARCHIVE_SOURCE_MISMATCH');
    previous = chain; chains.push(chain);
  }
  return {count:names.length, chains, lastRecordDigest:previous};
}
function checkStatus(status, records, state, report) {
  const count = state.count;
  need(status.pages === count && status.lastRecordDigest === state.lastRecordDigest &&
    status.rows === records.slice(0, count).reduce((sum, p) => sum + p.returned, 0) &&
    status.nextCursor === (count ? records[count - 1].nextCursor : null) &&
    status.complete === (count > 0 && records[count - 1].nextCursor === null) &&
    typeof status.finalized === 'boolean' &&
    (!count || (status.snapshot === report.snapshot && status.total === report.totalRows)),
  'DATASET_DELIVERY_NATIVE_STATUS_MISMATCH');
}

async function exported(out, records, state, report) {
  const manifestPath = join(out, 'manifest.json');
  const manifest = await jsonFile(manifestPath, 4 * 1024 * 1024);
  need(manifest.schema === 'stellar-forge.buyer-delivery-manifest.v1' &&
    manifest.dataset?.snapshot === report.snapshot && manifest.dataset.rows === report.totalRows &&
    manifest.dataset.originalQuerySignature === records[0].signature &&
    manifest.chainDigest === state.lastRecordDigest && Array.isArray(manifest.sourcePages) &&
    manifest.sourcePages.length === records.length && object(manifest.outputs) &&
    equal(Object.keys(manifest.outputs).sort(), ['dataset.csv','dataset.jsonl','review.html']),
  'DATASET_DELIVERY_MANIFEST_MISMATCH');
  for (let i = 0; i < records.length; i++) {
    const p = records[i];
    need(equal(manifest.sourcePages[i], {index:i, intent:p.intent, sourceSha256:p.sourceSha256,
      evidenceSha256:p.evidenceSha256, recordDigest:state.chains[i], rows:p.returned,
      requestedCursor:p.requestCursor}), 'DATASET_DELIVERY_MANIFEST_SOURCE_MISMATCH');
  }
  const outputs = {};
  for (const name of ['dataset.jsonl','dataset.csv','review.html']) {
    const path = join(out, name), actual = await hashFile(path, MAX_EXPORT);
    need(equal(actual, manifest.outputs[name]), 'DATASET_DELIVERY_OUTPUT_CHANGED');
    outputs[name] = {path, ...actual};
  }
  need(outputs['dataset.jsonl'].bytes + outputs['dataset.csv'].bytes <= MAX_EXPORT,
    'DATASET_DELIVERY_OUTPUT_LIMIT');
  outputs['manifest.json'] = {path:manifestPath, ...await hashFile(manifestPath, 4 * 1024 * 1024)};
  return {outputs, paymentStatus:manifest.paymentStatus};
}

/** Caller holds the original acquisition session lock for inspection and this entire call.
 * Only existing, independently acquired pages enter SF100. Errors retain every native file.
 * The adjacent 0600 marker also survives a failed init; unrelated existing outputs are refused.
 */
export async function buildNativeDataRoom(report, destination) {
  let out;
  try {
    need(exactPath(destination), 'DATASET_DELIVERY_PATH_INVALID');
    out = destination;
    const records = await preflight(report);
    need(out !== report.directory && !report.directory.startsWith(out + sep) &&
      out !== join(report.directory, 'pages') && !out.startsWith(join(report.directory, 'pages') + sep) &&
      out !== join(report.directory, 'evidence') && !out.startsWith(join(report.directory, 'evidence') + sep),
    'DATASET_DELIVERY_DESTINATION_OVERLAPS_SOURCE');
    await directory(dirname(out), false);
    const nativeBlob = await nativeFingerprint();
    const markerPath = join(dirname(out), '.' + basename(out) + '.sf88-source.json');
    const sourceBindingSha256 = digest(canonical({schema:report.schema, directory:report.directory,
      configurationSha256:report.configurationSha256, sessionId:report.sessionId,
      snapshot:report.snapshot, totalRows:report.totalRows, records}));
    const marker = {schema:'stellar-forge.sf88.native-delivery-source.v1', destination:out,
      sourceDirectory:report.directory, sourceBindingSha256};
    const resumed = await exists(out);
    let initialNativeBlob = nativeBlob;
    if (await exists(markerPath)) {
      const saved = await jsonFile(markerPath, 4096);
      need(object(saved), 'DATASET_DELIVERY_SOURCE_BINDING_MISMATCH');
      const {nativeBlob:recordedNativeBlob, ...binding} = saved;
      need(typeof recordedNativeBlob === 'string' && /^[a-f0-9]{40}$/.test(recordedNativeBlob) &&
        equal(binding, marker), 'DATASET_DELIVERY_SOURCE_BINDING_MISMATCH');
      initialNativeBlob = recordedNativeBlob;
    } else {
      need(!resumed, 'DATASET_DELIVERY_SOURCE_BINDING_MISSING');
      await createMarker(markerPath, {...marker, nativeBlob});
    }
    if (!resumed) await native('init', out);
    let state = await prefix(out, records), status = await native('status', out);
    checkStatus(status, records, state, report);
    const initialPages = state.count;
    if (!status.finalized) {
      // An interrupted native finalize is preserved for native recovery, never silently deleted.
      for (const name of ['dataset.jsonl','dataset.csv','review.html','manifest.json']) {
        need(!await exists(join(out, name)), 'DATASET_DELIVERY_PARTIAL_NATIVE_EXPORT');
      }
      const inputs = [];
      for (let i = state.count; i < records.length; i++) {
        const p = records[i];
        need(digest(await bounded(p.responsePath, MAX_INPUT)) === p.sourceSha256 &&
          digest(await bounded(p.evidencePath, MAX_INPUT)) === p.evidenceSha256,
        'DATASET_DELIVERY_SOURCE_CHANGED');
        inputs.push({page:p.responsePath, intent:p.intent, evidence:p.evidencePath,
          ...(p.requestCursor !== null ? {cursor:p.requestCursor} : {})});
      }
      // Original appendMany scans the saved prefix once, then streams native page inputs.
      // Complete native prefixes resume; a torn final record is retained for a fresh export.
      if (inputs.length) await native('append-batch', out, [], inputs);
      state = await prefix(out, records);
      need(state.count === records.length, 'DATASET_DELIVERY_ARCHIVE_PREFIX_MISMATCH');
      await native('finalize', out);
      // The original finalize summary reflects its pre-write scan; status reports final state.
      status = await native('status', out);
    }
    checkStatus(status, records, state, report);
    need(status.finalized && state.count === records.length, 'DATASET_DELIVERY_NOT_FINALIZED');
    const result = await exported(out, records, state, report);
    return {schema:'stellar-forge.sf88.dataset-delivery.v1', directory:out,
      sourceDirectory:report.directory, sourceBindingSha256, nativeBlob, initialNativeBlob, resumed,
      appendedPages:state.count - initialPages, nativeStatus:status, ...result};
  } catch (error) {
    const clean = error instanceof InputError ? error : new InputError('DATASET_DELIVERY_IO_FAILED');
    if (out) clean.outputDirectory = out;
    clean.partialWorkPreserved = true;
    throw clean;
  }
}
