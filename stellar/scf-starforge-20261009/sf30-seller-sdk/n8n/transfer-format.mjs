// MIT. Complete original n8n job export identity, shared by the merchant and receiver.
import { createHash } from 'node:crypto';
export const N8N_EXPORT_SCHEMA = 'stellar-forge.n8n-job-export.v1';
export const N8N_EXPORT_MANIFEST = 'n8n-job-export.json';
export const N8N_EXPORT_MAX_BYTES = 96 * 1024 * 1024;
export const N8N_EXPORT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const N8N_SHA = /^[a-f0-9]{64}$/;
export const N8N_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const N8N_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = value => Array.isArray(value) ? value.map(normalized) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
export const canonical = value => JSON.stringify(normalized(value));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const encode = value => Buffer.from(canonical(value) + '\n');
export const decode = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
export function failure(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
export function exact(value, allowed, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw failure('N8N_INVALID_PARAMS', 'Supply the original operation fields and every required field.');
}
export function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw failure('N8N_INVALID_PARAMS', 'Select a valid ' + label + '.');
  return value;
}
export function exportIdentity(configurationSha256, requestId) {
  checked(configurationSha256, N8N_SHA, 'configuration SHA256'); checked(requestId, N8N_UUID, 'request UUID');
  return hash(canonical({ schema: N8N_EXPORT_SCHEMA, configurationSha256, requestId }));
}
export function parseN8nJobExport(bytes, expectedExportId) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 65000)
    throw failure('N8N_EXPORT_MANIFEST_INVALID', 'Read the complete original export manifest.');
  let value; try { value = JSON.parse(decode(bytes)); } catch { throw failure('N8N_EXPORT_MANIFEST_INVALID', 'Read the original UTF-8 export manifest.'); }
  exact(value, ['schema','exportId','configurationSha256','request','job','files','totalBytes'],
    ['schema','exportId','configurationSha256','request','job','files','totalBytes']);
  exact(value.request, ['requestId','jobId','expectedRevision','expectedDispatchRevision'],
    ['requestId','jobId','expectedRevision','expectedDispatchRevision']);
  exact(value.job, ['id','functionId','revision','state','inputSha256','configSha256','applicationSha256','result'],
    ['id','functionId','revision','state','inputSha256','configSha256','applicationSha256','result']);
  checked(value.request.jobId, N8N_JOB_ID, 'job identifier');
  if (value.schema !== N8N_EXPORT_SCHEMA || value.exportId !== exportIdentity(value.configurationSha256, value.request.requestId) ||
      expectedExportId !== undefined && value.exportId !== expectedExportId || value.job.id !== value.request.jobId ||
      !Number.isSafeInteger(value.request.expectedRevision) || value.request.expectedRevision < 1 ||
      value.job.revision !== value.request.expectedRevision ||
      value.request.expectedDispatchRevision !== null && (!Number.isSafeInteger(value.request.expectedDispatchRevision) || value.request.expectedDispatchRevision < 1) ||
      typeof value.job.functionId !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(value.job.functionId) ||
      typeof value.job.state !== 'string' || !/^[A-Z_]{1,32}$/.test(value.job.state) ||
      !['inputSha256','configSha256','applicationSha256'].every(key => N8N_SHA.test(value.job[key] ?? '')))
    throw failure('N8N_EXPORT_MANIFEST_INVALID', 'The export differs from its original job, configuration or selected revision.');
  const names = new Set(); let total = 0;
  if (!Array.isArray(value.files) || value.files.length < 2 || value.files.length > 3)
    throw failure('N8N_EXPORT_MANIFEST_INVALID', 'Retain the complete original job, dispatch and available result files.');
  for (const file of value.files) {
    exact(file, ['name','bytes','sha256'], ['name','bytes','sha256']);
    if (!['job.json','dispatch.json','result.json'].includes(file.name) || names.has(file.name) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > N8N_EXPORT_MAX_FILE_BYTES || !N8N_SHA.test(file.sha256 ?? ''))
      throw failure('N8N_EXPORT_MANIFEST_INVALID', 'The original file list contains an invalid or repeated file.');
    names.add(file.name); total += file.bytes;
  }
  if (!names.has('job.json') || !names.has('dispatch.json') || names.has('result.json') !== (value.job.state === 'COMPLETED') ||
      value.totalBytes !== total || total > N8N_EXPORT_MAX_BYTES)
    throw failure('N8N_EXPORT_MANIFEST_INVALID', 'The original export is incomplete or its byte total differs.');
  if (value.job.state === 'COMPLETED') {
    exact(value.job.result, ['bytes','sha256','contentType','filename'], ['bytes','sha256','contentType','filename']);
    const result = value.files.find(file => file.name === 'result.json');
    if (result.bytes !== value.job.result.bytes || result.sha256 !== value.job.result.sha256 ||
        typeof value.job.result.contentType !== 'string' || typeof value.job.result.filename !== 'string')
      throw failure('N8N_EXPORT_MANIFEST_INVALID', 'The delivered result differs from the original completed job.');
  } else if (value.job.result !== null) throw failure('N8N_EXPORT_MANIFEST_INVALID', 'An unfinished job has no completed result file.');
  return value;
}
export function validateN8nExportRecords(manifest, jobBytes, dispatchBytes) {
  const job = JSON.parse(decode(jobBytes)), dispatch = JSON.parse(decode(dispatchBytes));
  if (!plain(job) || dispatch !== null && !plain(dispatch) || job.id !== manifest.job.id || job.functionId !== manifest.job.functionId || job.revision !== manifest.job.revision ||
      job.state !== manifest.job.state || job.inputSha256 !== manifest.job.inputSha256 || hash(canonical(job.input)) !== job.inputSha256 ||
      job.source?.configSha256 !== manifest.job.configSha256 || job.source?.applicationSha256 !== manifest.job.applicationSha256 ||
      (dispatch?.revision ?? null) !== manifest.request.expectedDispatchRevision ||
      dispatch !== null && dispatch.jobId !== job.id)
    throw failure('N8N_EXPORT_RECORD_CHANGED', 'The complete job and dispatch do not match the original export selection.');
  if (manifest.job.result && ['bytes','sha256','contentType','filename'].some(key => job.result?.[key] !== manifest.job.result[key]))
    throw failure('N8N_EXPORT_RECORD_CHANGED', 'The original job result metadata differs from its export.');
  return { job, dispatch };
}
