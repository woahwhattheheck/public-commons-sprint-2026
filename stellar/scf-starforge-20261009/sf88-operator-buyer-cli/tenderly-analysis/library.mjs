// MIT. Receiving and local analysis of the original completed buyer response.
import { readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { BuyerResult } from '../node/result.mjs';
import { privateDirectory, readBytes, writeBytes, writeJson, readJson, digest, exists } from '../node/store.mjs';
import { analyzeSimulation, compareSimulations, canonical, object, requireValue, AnalysisError,
  MAX_RESPONSE_BYTES, TABLE_COLUMNS, tableCsv } from './analyze.mjs';
import { renderReview } from './report.mjs';

const SCHEMA = 'stellar-forge.tenderly-capture.v1';
const HASH = /^[a-f0-9]{64}$/;
const MAX_METADATA = 4 * 1024 * 1024;
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function decodeJson(data) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(data)); }
  catch { throw new AnalysisError('JSON_INVALID', 'The selected file must contain complete UTF-8 JSON.'); }
}
export function captureId(id) {
  requireValue(typeof id === 'string' && HASH.test(id), 'CAPTURE_ID_INVALID'); return id;
}
async function rootAt(directory) {
  const root = await privateDirectory(resolve(directory));
  requireValue(await realpath(root) === root, 'WORKSPACE_SYMLINK_REFUSED');
  for (const name of ['captures','reviews']) await privateDirectory(join(root, name));
  return root;
}
async function exactExisting(path, data) {
  try {
    const existing = await readBytes(path, data.length);
    requireValue(existing.equals(data), 'RETAINED_INPUT_CONFLICT');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    if (error.code === 'FILE_SIZE_OR_TYPE_INVALID') throw new AnalysisError('RETAINED_INPUT_CONFLICT');
    throw error;
  }
}
async function exactWrite(path, data) {
  // A completed file needs no second disk copy, including retries after ENOSPC.
  if (await exactExisting(path, data)) return;
  try { await writeBytes(path, data, {exclusive:true}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    requireValue(await exactExisting(path, data), 'RETAINED_INPUT_CONFLICT');
  }
}
function nativeFrom(record) {
  const native = object(record?.native) ? record.native : record;
  requireValue(object(native) && native.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT' &&
    typeof native.intentId === 'string' && object(native.responseFile), 'ORIGINAL_BUYER_RESULT_REQUIRED');
  return native;
}
function inputBytes(value, code) {
  requireValue(Buffer.isBuffer(value) || value instanceof Uint8Array, code);
  requireValue(value.length > 0 && value.length <= MAX_METADATA, code);
  return Buffer.from(value);
}
function savedDelivery(native) {
  const saved = native.responseFile;
  requireValue(saved.status === 'SAVED' && Number.isSafeInteger(saved.bytes) && saved.bytes > 0 &&
    saved.bytes <= MAX_RESPONSE_BYTES && typeof saved.sha256 === 'string' && HASH.test(saved.sha256),
    'SAVED_BUYER_RESPONSE_REQUIRED');
  return saved;
}
async function retainCaptureRecord(path, record) {
  const readExisting = async () => {
    try { return await readJson(path, MAX_METADATA); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  let existing = await readExisting();
  if (existing === null) {
    try { await writeJson(path, record, {exclusive:true}); return; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      existing = await readExisting();
    }
  }
  requireValue(existing !== null && existing.schema === SCHEMA && existing.id === record.id &&
    canonical(existing.binding) === canonical(record.binding), 'RETAINED_CAPTURE_CONFLICT');
}
export async function receiveBytes(responseBytes, {workspace, request = null, requestBytes = null,
  nativeBytes = null, label = '', payloadPointer = ''} = {}) {
  requireValue(Buffer.isBuffer(responseBytes) || responseBytes instanceof Uint8Array, 'RESPONSE_BYTES_REQUIRED');
  responseBytes = Buffer.from(responseBytes);
  requireValue(responseBytes.length > 0 && responseBytes.length <= MAX_RESPONSE_BYTES, 'RESPONSE_SIZE_LIMIT');
  requireValue(typeof label === 'string' && label.length <= 160, 'CAPTURE_LABEL_INVALID');
  const source = decodeJson(responseBytes);
  if (requestBytes !== null) {
    requestBytes = inputBytes(requestBytes, 'REQUEST_SIZE_LIMIT');
    request = decodeJson(requestBytes);
  } else if (request !== null) requestBytes = inputBytes(bytes(request), 'REQUEST_SIZE_LIMIT');
  if (nativeBytes !== null) nativeBytes = inputBytes(nativeBytes, 'BUYER_RESULT_SIZE_LIMIT');
  const nativeRecord = nativeBytes === null ? null : decodeJson(nativeBytes);
  const native = nativeBytes === null ? null : nativeFrom(nativeRecord);
  if (native) {
    const saved = savedDelivery(native);
    requireValue(saved.bytes === responseBytes.length && saved.sha256 === digest(responseBytes),
    'ORIGINAL_BUYER_DELIVERY_MISMATCH', 'The saved response must match the original buyer delivery size and SHA-256.');
  }
  const analysis = analyzeSimulation(source, {request, payloadPointer});
  const binding = {responseSha256:digest(responseBytes), responseBytes:responseBytes.length,
    requestSha256:requestBytes === null ? null : digest(requestBytes),
    nativeSha256:nativeBytes === null ? null : digest(nativeBytes), payloadPointer};
  const id = digest(canonical({schema:SCHEMA, ...binding}));
  const root = await rootAt(workspace), directory = await privateDirectory(join(root, 'captures', id));
  await exactWrite(join(directory, 'response.json'), responseBytes);
  if (requestBytes !== null) await exactWrite(join(directory, 'request.json'), requestBytes);
  if (nativeBytes !== null) await exactWrite(join(directory, 'buyer-result.json'), nativeBytes);
  await exactWrite(join(directory, 'analysis.json'), bytes(analysis));
  const recordPath = join(directory, 'capture.json');
  const record = {schema:SCHEMA, id, createdAt:new Date().toISOString(), label:label.trim() || analysis.simulationId || id.slice(0,12),
    sourceKind:native === null ? 'PROVIDER_RESPONSE' : 'NATIVE_BUYER_RESPONSE', binding,
    summary:{simulationId:analysis.simulationId, context:analysis.context, outcome:analysis.outcome, counts:analysis.counts},
    buyer:native === null ? null : {intentId:native.intentId, status:native.status ?? null,
      httpStatus:native.httpStatus ?? null, deliveryStatus:native.responseFile.status}};
  await retainCaptureRecord(recordPath, record);
  return openCapture(root, id);
}

/** Accept the original SDK result across package copies, retaining its native record binding. */
export async function receiveBuyerResult(result, options) {
  requireValue(object(result) && typeof result.bytes === 'function' && object(result.record) &&
    object(result.record.native), 'ORIGINAL_NODE_BUYER_RESULT_REQUIRED');
  const nativeBytes = inputBytes(bytes(result.record), 'BUYER_RESULT_SIZE_LIMIT');
  const native = nativeFrom(decodeJson(nativeBytes));
  requireValue(object(result.native) && canonical(result.native) === canonical(native),
    'ORIGINAL_NODE_BUYER_RESULT_REQUIRED');
  savedDelivery(native);
  const response = await result.bytes({limit:MAX_RESPONSE_BYTES});
  return receiveBytes(response, {...options, nativeBytes});
}

/** Read an existing SF88 CLI summary or Node SDK record; never execute or recover a purchase. */
export async function receiveResultFile(resultFile, options) {
  const nativeBytes = await readBytes(resolve(resultFile), MAX_METADATA), record = decodeJson(nativeBytes);
  const native = nativeFrom(record), saved = savedDelivery(native);
  requireValue(typeof saved.path === 'string', 'SAVED_BUYER_RESPONSE_REQUIRED');
  const result = new BuyerResult(object(record.native) ? record : {native:record},
    {destination:saved.path, maxBytes:MAX_RESPONSE_BYTES});
  const response = await result.bytes({limit:MAX_RESPONSE_BYTES});
  return receiveBytes(response, {...options, nativeBytes});
}
export async function receiveResponseFile(responseFile, {requestFile, nativeResultFile, ...options} = {}) {
  return receiveBytes(await readBytes(resolve(responseFile), MAX_RESPONSE_BYTES), {...options,
    ...(requestFile ? {requestBytes:await readBytes(resolve(requestFile), MAX_METADATA)} : {}),
    ...(nativeResultFile ? {nativeBytes:await readBytes(resolve(nativeResultFile), MAX_METADATA)} : {})});
}

export async function listCaptures(workspace) {
  const root = await rootAt(workspace), records = [];
  for (const name of await readdir(join(root, 'captures'))) {
    if (!HASH.test(name)) continue;
    const path = join(root, 'captures', name, 'capture.json');
    if (!await exists(path)) continue;
    const record = await readJson(path, MAX_METADATA);
    requireValue(record.schema === SCHEMA && record.id === name, 'RETAINED_CAPTURE_INVALID');
    records.push(record);
  }
  return records.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export async function openCapture(workspace, id) {
  const root = await rootAt(workspace), directory = await privateDirectory(join(root,'captures',captureId(id)), {create:false});
  const record = await readJson(join(directory,'capture.json'), MAX_METADATA);
  requireValue(record.schema === SCHEMA && record.id === id &&
    digest(canonical({schema:SCHEMA,...record.binding})) === id, 'RETAINED_CAPTURE_INVALID');
  const responseBytes = await readBytes(join(directory,'response.json'), MAX_RESPONSE_BYTES);
  requireValue(responseBytes.length === record.binding.responseBytes && digest(responseBytes) === record.binding.responseSha256,
    'RETAINED_RESPONSE_CHANGED');
  const inputs = {};
  for (const [name,key] of [['request.json','requestSha256'],['buyer-result.json','nativeSha256']]) {
    if (record.binding[key] === null) continue;
    const data = await readBytes(join(directory,name), MAX_METADATA);
    requireValue(digest(data) === record.binding[key], 'RETAINED_CONTEXT_CHANGED'); inputs[name] = data;
  }
  const source = decodeJson(responseBytes), request = inputs['request.json'] ? decodeJson(inputs['request.json']) : null;
  const analysis = analyzeSimulation(source, {request, payloadPointer:record.binding.payloadPointer});
  const savedAnalysis = decodeJson(await readBytes(join(directory,'analysis.json'), MAX_RESPONSE_BYTES * 3));
  requireValue(canonical(analysis) === canonical(savedAnalysis), 'RETAINED_ANALYSIS_CHANGED');
  return {id, directory, analysisPath:join(directory,'analysis.json'), record, analysis, responseBytes, source, inputs};
}
export async function compareCaptures(workspace, beforeId, afterId) {
  const before = await openCapture(workspace, beforeId), after = await openCapture(workspace, afterId);
  return {before, after, comparison:compareSimulations(before.analysis, after.analysis)};
}
export async function saveReview(workspace, {beforeId, afterId = null, title = '', notes = ''}) {
  requireValue(typeof title === 'string' && title.length <= 160 && typeof notes === 'string' && notes.length <= 20000,
    'REVIEW_TEXT_INVALID');
  const root = await rootAt(workspace), before = await openCapture(root, beforeId);
  const after = afterId === null ? null : await openCapture(root, afterId);
  const comparison = after ? compareSimulations(before.analysis, after.analysis) : null;
  const binding = {schema:'stellar-forge.tenderly-review.v1',beforeId,afterId,title,notes};
  const id = digest(canonical(binding)), directory = await privateDirectory(join(root,'reviews',id));
  const review = {...binding, id, before:before.record, after:after?.record ?? null,
    comparison, analysis:before.analysis};
  await exactWrite(join(directory,'review.json'), bytes(review));
  await exactWrite(join(directory,'review.html'), Buffer.from(renderReview(review)));
  return {id, directory, review};
}
export async function listReviews(workspace) {
  const root = await rootAt(workspace), rows = [];
  for (const name of await readdir(join(root,'reviews'))) {
    if (!HASH.test(name) || !await exists(join(root,'reviews',name,'review.json'))) continue;
    const value = await readJson(join(root,'reviews',name,'review.json'), MAX_RESPONSE_BYTES * 3);
    rows.push({id:name,title:value.title,beforeId:value.beforeId,afterId:value.afterId,notes:value.notes});
  }
  return rows;
}
export async function exportCapture(workspace, id, destination) {
  const capture = await openCapture(workspace,id), out = resolve(destination);
  requireValue(out !== capture.directory && !out.startsWith(capture.directory + sep), 'EXPORT_DESTINATION_INVALID');
  const intent = {schema:'stellar-forge.tenderly-export-intent.v1',captureId:id,binding:capture.record.binding};
  const files = {'export-intent.json':bytes(intent), 'response.json':capture.responseBytes, ...capture.inputs,
    'capture.json':bytes(capture.record), 'analysis.json':bytes(capture.analysis),
    'review.html':Buffer.from(renderReview({title:capture.record.label,notes:'',before:capture.record,
      analysis:capture.analysis,comparison:null}))};
  for (const name of Object.keys(TABLE_COLUMNS)) files[name+'.csv'] = Buffer.from(tableCsv(name,capture.analysis.tables[name]));
  const manifest = {schema:'stellar-forge.tenderly-export.v1',captureId:id,files:{}};
  for (const [name,data] of Object.entries(files)) manifest.files[name] = {bytes:data.length,sha256:digest(data)};
  const expected = {...files, 'manifest.json':bytes(manifest)};
  await privateDirectory(out);
  requireValue(await realpath(out) === out, 'EXPORT_SYMLINK_REFUSED');
  const retained = await readdir(out);
  requireValue(retained.every(name => Object.hasOwn(expected,name)), 'EXPORT_DESTINATION_CONFLICT',
    'The export directory contains files outside this capture export.');
  // Check all existing bytes before extending either an empty or interrupted export.
  for (const name of retained) await exactExisting(join(out,name),expected[name]);
  // The intent binds the original response, request and native buyer record before payload writes.
  for (const [name,data] of Object.entries(files)) await exactWrite(join(out,name),data);
  // The final manifest is published only after every expected file is retained.
  await exactWrite(join(out,'manifest.json'),expected['manifest.json']);
  return {directory:out,manifest};
}
