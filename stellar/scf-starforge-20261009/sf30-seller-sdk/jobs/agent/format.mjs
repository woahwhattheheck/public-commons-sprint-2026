// MIT. Complete paid-job files and native case/accounting identities.
import { createHash } from 'node:crypto';
import { JOB_ID, canonical } from '../config.mjs';
import { INPUT_FILES_FIELD, MAX_TOTAL_BYTES, validateFile, validateFilePolicy, inputManifest, fileUploadIdentity } from '../inputs/protocol.mjs';
import { validateCase, jobBinding, publicReceipt, json as resolutionJson,
  hash as resolutionHash, EXPORT_SCHEMA as CASE_EXPORT_SCHEMA } from '../resolution/contract.mjs';
import { ADJUSTMENT_EXPORT_SCHEMA } from '../../../merchant-settlement-accounting/adjustments.mjs';

export { JOB_ID, canonical };
export const JOB_EXPORT_SCHEMA = 'stellar-forge.paid-job-agent-export.v1';
export const JOB_EXPORT_MANIFEST = 'paid-job-export.json';
export const JOB_EXPORT_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const JOB_EXPORT_FILE_BYTES = 8 * 1024 * 1024 * 1024;
export const JOB_EXPORT_MAX_BYTES = MAX_TOTAL_BYTES + JOB_EXPORT_FILE_BYTES + 5 * JOB_EXPORT_DOCUMENT_BYTES;
export const SHA = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const SLOT = /^[A-Za-z][A-Za-z0-9_]{0,55}$/;
export const CLAIM = /^[A-Za-z0-9_-]{43,128}$/;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const encode = value => Buffer.from(canonical(value) + '\n');
export const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
export function need(condition, code, message, status = 400) {
  if (!condition) throw failure(code, message, status);
}
export function exact(value, allowed, required = []) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'JOB_AGENT_INVALID_PARAMS', 'Use the declared fields and every required field.');
}
export function checked(value, pattern, label) {
  need(typeof value === 'string' && pattern.test(value), 'JOB_AGENT_INVALID_PARAMS', 'Select the original ' + label + '.');
  return value;
}
export function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'JOB_AGENT_INVALID_PARAMS', 'Use an integer within the declared range.');
  return value;
}
export function text(value, maximum, { empty = false, multiline = false } = {}) {
  need(typeof value === 'string' && (empty || value.trim()) && value.length <= maximum &&
    !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value),
    'JOB_AGENT_INVALID_PARAMS', 'Use text within the declared length and format.');
  return value;
}
export function exportIdentity(sourceSha256, requestId) {
  checked(sourceSha256, SHA, 'source SHA256'); checked(requestId, UUID, 'request UUID');
  return hash(canonical({ schema: JOB_EXPORT_SCHEMA, sourceSha256, requestId }));
}
export function exportFileName(value) {
  return ['job.json', 'result.bin', 'resolution.json', 'customer-receipt.json', 'accounting.json', 'input-policy.json'].includes(value) ||
    typeof value === 'string' && /^input_[A-Za-z][A-Za-z0-9_]{0,55}\.bin$/.test(value);
}
export function parsePaidJobExport(bytes, expectedExportId) {
  need(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 65000,
    'JOB_AGENT_MANIFEST_INVALID', 'Read the complete original job export manifest.');
  let value;
  try { value = JSON.parse(decode(bytes)); }
  catch { throw failure('JOB_AGENT_MANIFEST_INVALID', 'Read the complete UTF-8 export manifest.'); }
  exact(value, ['schema','exportId','sourceSha256','request','job','resolution','accounting','inputPolicy','inputs','files','totalBytes'],
    ['schema','exportId','sourceSha256','request','job','resolution','accounting','inputPolicy','inputs','files','totalBytes']);
  exact(value.request, ['requestId','jobId','expectedRevision','expectedCaseRevision'],
    ['requestId','jobId','expectedRevision','expectedCaseRevision']);
  const job = value.job;
  exact(job, ['id','functionId','revision','state','inputSha256','configSha256','applicationSha256','result'],
    ['id','functionId','revision','state','inputSha256','configSha256','applicationSha256','result']);
  checked(job.id, JOB_ID, 'job ID'); checked(job.functionId, SLOT, 'function ID');
  integer(job.revision, 1); checked(job.state, /^[A-Z_]{1,32}$/, 'job state');
  for (const key of ['inputSha256','configSha256','applicationSha256']) checked(job[key], SHA, key);
  need(value.schema === JOB_EXPORT_SCHEMA && value.exportId === exportIdentity(value.sourceSha256, value.request.requestId) &&
    (expectedExportId === undefined || value.exportId === expectedExportId) &&
    value.request.jobId === job.id && value.request.expectedRevision === job.revision,
    'JOB_AGENT_MANIFEST_INVALID', 'The export differs from its original request, source or job revision.');
  if (value.request.expectedCaseRevision !== null) integer(value.request.expectedCaseRevision);
  need(Array.isArray(value.files) && value.files.length >= 1 && value.files.length <= 22 &&
    Array.isArray(value.inputs) && value.inputs.length <= 16,
    'JOB_AGENT_MANIFEST_INVALID', 'Retain every original job, result, case and input file.');
  const files = new Map(); let total = 0;
  for (const file of value.files) {
    exact(file, ['name','bytes','sha256'], ['name','bytes','sha256']);
    need(exportFileName(file.name) && !files.has(file.name),
      'JOB_AGENT_MANIFEST_INVALID', 'Use unique files from the original export.');
    integer(file.bytes, 0, JOB_EXPORT_FILE_BYTES); checked(file.sha256, SHA, 'file SHA256');
    if (!file.name.startsWith('input_') && file.name !== 'result.bin')
      integer(file.bytes, 0, JOB_EXPORT_DOCUMENT_BYTES);
    total += file.bytes; files.set(file.name, file);
  }
  need(files.has('job.json') && value.totalBytes === total && total <= JOB_EXPORT_MAX_BYTES,
    'JOB_AGENT_MANIFEST_INVALID', 'The original complete file list or byte total differs.');
  need(files.has('result.bin') === (job.state === 'COMPLETED'),
    'JOB_AGENT_MANIFEST_INVALID', 'A completed job includes its exact original output.');
  if (job.state === 'COMPLETED') {
    exact(job.result, ['bytes','sha256','filename','contentType'], ['bytes','sha256','filename','contentType']);
    const result = files.get('result.bin');
    text(job.result.filename, 1000); text(job.result.contentType, 300);
    need(result.bytes === job.result.bytes && result.sha256 === job.result.sha256,
      'JOB_AGENT_MANIFEST_INVALID', 'The result file differs from the original job output.');
  } else need(job.result === null, 'JOB_AGENT_MANIFEST_INVALID', 'An unfinished job has no completed result file.');
  if (value.resolution === null) {
    need(value.request.expectedCaseRevision === null && !files.has('resolution.json') &&
      !files.has('customer-receipt.json') && value.accounting === null && !files.has('accounting.json'),
      'JOB_AGENT_MANIFEST_INVALID', 'An unsettled job has no selected settlement case.');
  } else {
    exact(value.resolution, ['revision','caseSha256'], ['revision','caseSha256']);
    integer(value.resolution.revision); checked(value.resolution.caseSha256, SHA, 'case SHA256');
    need(value.resolution.revision === value.request.expectedCaseRevision &&
      files.has('resolution.json') && files.has('customer-receipt.json'),
      'JOB_AGENT_MANIFEST_INVALID', 'Retain the selected complete merchant case and buyer receipt.');
  }
  if (value.accounting !== null) {
    exact(value.accounting, ['runId','eventId','sha256'], ['runId','eventId','sha256']);
    checked(value.accounting.runId, UUID, 'accounting run UUID');
    checked(value.accounting.eventId, SHA, 'settlement event ID');
    need(files.get('accounting.json')?.sha256 === value.accounting.sha256 && value.resolution !== null,
      'JOB_AGENT_MANIFEST_INVALID', 'Retain the unchanged original accounting export.');
  } else need(!files.has('accounting.json'), 'JOB_AGENT_MANIFEST_INVALID', 'The accounting file has no original selection.');
  if (value.inputPolicy === null) {
    need(value.inputs.length === 0 && !files.has('input-policy.json'), 'JOB_AGENT_MANIFEST_INVALID',
      'An application without declared file inputs has no upload policy or retained file slots.');
  } else {
    exact(value.inputPolicy, ['file','policySha256'], ['file','policySha256']);
    checked(value.inputPolicy.policySha256, SHA, 'input policy SHA256');
    need(value.inputPolicy.file === 'input-policy.json' && files.has(value.inputPolicy.file),
      'JOB_AGENT_MANIFEST_INVALID', 'Retain the complete selected original input policy.');
  }
  const slots = new Set(), inputFiles = new Set();
  for (const input of value.inputs) {
    exact(input, ['slot','uploadId','file','descriptor'], ['slot','uploadId','file','descriptor']);
    checked(input.slot, SLOT, 'input slot'); checked(input.uploadId, SHA, 'upload ID');
    validateFile(input.descriptor);
    need(!slots.has(input.slot) && input.file === 'input_' + input.slot + '.bin' &&
      files.get(input.file)?.bytes === input.descriptor.bytes && files.get(input.file)?.sha256 === input.descriptor.sha256,
      'JOB_AGENT_MANIFEST_INVALID', 'Retain the original bytes for each selected input slot.');
    slots.add(input.slot); inputFiles.add(input.file);
  }
  need([...files.keys()].filter(name => name.startsWith('input_')).every(name => inputFiles.has(name)),
    'JOB_AGENT_MANIFEST_INVALID', 'Every input file must retain its original slot and descriptor.');
  return value;
}
export function validatePaidJobExportRecords(manifest, { jobBytes, resolutionBytes, receiptBytes, accountingBytes, policyBytes } = {}) {
  const fileBytes = { 'job.json': jobBytes, 'resolution.json': resolutionBytes,
    'customer-receipt.json': receiptBytes, 'accounting.json': accountingBytes, 'input-policy.json': policyBytes };
  for (const [name, bytes] of Object.entries(fileBytes)) {
    const file = manifest.files.find(item => item.name === name);
    need(Boolean(file) === (bytes instanceof Uint8Array), 'JOB_AGENT_RECORD_CHANGED', 'Read every declared original document.');
    if (file) need(bytes.length === file.bytes && hash(bytes) === file.sha256,
      'JOB_AGENT_RECORD_CHANGED', 'The complete document differs from the original manifest.');
  }
  const job = JSON.parse(decode(jobBytes));
  need(plain(job) && job.id === manifest.job.id && job.functionId === manifest.job.functionId &&
    job.revision === manifest.job.revision && job.state === manifest.job.state &&
    job.inputSha256 === manifest.job.inputSha256 && hash(canonical(job.input)) === job.inputSha256 &&
    job.source?.configSha256 === manifest.job.configSha256 &&
    job.source?.applicationSha256 === manifest.job.applicationSha256 &&
    hash(canonical(job.source)) === manifest.sourceSha256,
    'JOB_AGENT_RECORD_CHANGED', 'The complete job differs from its original source, input or revision.');
  if (manifest.job.result) need(['bytes','sha256','contentType','filename'].every(key =>
    job.result?.[key] === manifest.job.result[key]), 'JOB_AGENT_RECORD_CHANGED', 'The original output metadata changed.');
  const policy = manifest.inputPolicy ? validateFilePolicy(JSON.parse(decode(policyBytes))) : null;
  need(policy ? policy.policySha256 === manifest.inputPolicy.policySha256 : manifest.inputs.length === 0,
    'JOB_AGENT_RECORD_CHANGED', 'The complete original input policy differs from the selected export.');
  // An application without an inputFiles declaration may use $files as ordinary
  // application data. Only an explicit original policy declares upload slots.
  const inputs = policy ? inputManifest(policy, job.input) : {};
  need(Object.keys(inputs).length === manifest.inputs.length &&
    manifest.inputs.every(input => canonical(inputs[input.slot]) === canonical(input.descriptor) &&
      input.uploadId === fileUploadIdentity({ origin: job.source.publicOrigin, reference: job.id,
        functionId: job.functionId, slot: input.slot, file: input.descriptor })),
    'JOB_AGENT_RECORD_CHANGED', 'The export must retain every declared original input descriptor and file.');
  let resolution = null, receipt = null, accounting = null;
  if (resolutionBytes) {
    resolution = JSON.parse(decode(resolutionBytes)); receipt = JSON.parse(decode(receiptBytes));
    need(resolution.schema === CASE_EXPORT_SCHEMA && resolution.caseSha256 === manifest.resolution.caseSha256 &&
      resolution.caseSha256 === resolutionHash(resolutionJson(resolution.case)) &&
      resolution.case.revision === manifest.resolution.revision,
      'JOB_AGENT_RECORD_CHANGED', 'The complete resolution differs from its selected case.');
    validateCase(resolution.case, jobBinding(job));
    need(canonical(resolution.customerReceipt) === canonical(receipt) &&
      canonical(receipt) === canonical(publicReceipt(resolution.case, job)),
      'JOB_AGENT_RECORD_CHANGED', 'The buyer receipt must describe the same original case and job.');
    need(Boolean(resolution.case.accounting) === (manifest.accounting !== null),
      'JOB_AGENT_RECORD_CHANGED', 'Retain the original selected accounting export.');
  } else need(!job.settlement, 'JOB_AGENT_RECORD_CHANGED', 'A settled job export includes its complete original case.');
  if (accountingBytes) {
    accounting = JSON.parse(decode(accountingBytes));
    const source = resolution.case.accounting.source;
    need(accounting.schema === ADJUSTMENT_EXPORT_SCHEMA && accounting.source?.runId === manifest.accounting.runId &&
      source.runId === manifest.accounting.runId && source.eventId === manifest.accounting.eventId &&
      accounting.source.reportSha256 === source.reportSha256 &&
      accounting.source.inputManifestSha256 === source.inputManifestSha256 &&
      Array.isArray(accounting.events) && accounting.events.filter(event =>
        event.original?.eventId === manifest.accounting.eventId).length === 1,
      'JOB_AGENT_RECORD_CHANGED', 'The accounting export must retain its original selected event and source.');
  }
  return { job, resolution, receipt, accounting, policy };
}
