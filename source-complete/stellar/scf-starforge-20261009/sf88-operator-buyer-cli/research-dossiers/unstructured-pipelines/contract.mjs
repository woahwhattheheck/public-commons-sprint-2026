// MIT. Managed Unstructured Pipelines contract; account selection is launcher-owned.
import { BuyerError, need, object, digest, jsonBytes } from '../../node/store.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.unstructured-pipelines-config.v1';
export const PLAN_SCHEMA = 'stellar-forge.unstructured-pipelines-plan.v1';
export const STATE_SCHEMA = 'stellar-forge.unstructured-pipelines-operation.v1';
export const SDK_SOURCE = Object.freeze({
  repository: 'Unstructured-IO/unstructured-python-client',
  commit: 'ba25d2537151e0cbd6bdfadd97167a47f1e7d948',
  version: '0.46.3', openapiVersion: '1.2.31',
});
export const JOB_STATUSES = Object.freeze(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'STOPPED', 'FAILED']);
export const PROCESSING_STATUSES = Object.freeze(['SCHEDULED', 'IN_PROGRESS', 'SUCCESS', 'COMPLETED_WITH_ERRORS', 'STOPPED', 'FAILED']);
export const SERVICE_LIMITS = Object.freeze({
  maxInputs: 10, maxInputBytes: 50000000, minimumLaunchIntervalMs: 1000,
  maxRunningJobs: 5,
});
export const DEFAULT_LIMITS = Object.freeze({
  maxInputs: SERVICE_LIMITS.maxInputs, maxInputBytes: SERVICE_LIMITS.maxInputBytes,
  maxTotalInputBytes: 256 * 1024 * 1024,
  maxRequestDataBytes: 1024 * 1024, maxResponseBytes: 8 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024, requestTimeoutMs: 120000,
});
const CEILINGS = Object.freeze({
  maxInputs: SERVICE_LIMITS.maxInputs, maxInputBytes: SERVICE_LIMITS.maxInputBytes,
  maxTotalInputBytes: SERVICE_LIMITS.maxInputs * SERVICE_LIMITS.maxInputBytes,
  maxRequestDataBytes: 4 * 1024 * 1024, maxResponseBytes: 64 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024, requestTimeoutMs: 300000,
});
export function text(value, code, max = 512) {
  need(typeof value === 'string' && value.trim().length > 0 &&
    Buffer.byteLength(value) <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value), code);
  return value;
}
export const requestId = value => text(value, 'PIPELINE_REQUEST_ID_INVALID', 256);
export function providerId(value) {
  text(value, 'PIPELINE_PROVIDER_ID_INVALID');
  need(value !== '.' && value !== '..', 'PIPELINE_PROVIDER_ID_INVALID');
  return value;
}
export function operationId(value) {
  need(typeof value === 'string' && /^up_[a-f0-9]{64}$/.test(value), 'PIPELINE_OPERATION_ID_INVALID');
  return value;
}
export function inputId(value) {
  need(typeof value === 'string' && /^in_[a-f0-9]{64}$/.test(value), 'PIPELINE_INPUT_ID_INVALID');
  return value;
}
export function outputId(value) {
  need(typeof value === 'string' && /^out_[a-f0-9]{64}$/.test(value), 'PIPELINE_OUTPUT_ID_INVALID');
  return value;
}
export function profileId(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'PIPELINE_PROFILE_ID_INVALID');
  return value;
}
export function canonical(value) {
  let count = 0;
  function visit(item, depth) {
    need(depth <= 64 && ++count <= 1000000, 'PIPELINE_JSON_COMPLEXITY_LIMIT');
    if (typeof item === 'string') { need(item.isWellFormed(), 'PIPELINE_JSON_INVALID'); return item; }
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') { need(Number.isFinite(item), 'PIPELINE_JSON_INVALID'); return item; }
    if (Array.isArray(item)) return item.map(part => visit(part, depth + 1));
    need(object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'PIPELINE_JSON_INVALID');
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key], depth + 1)]));
  }
  return visit(value, 0);
}
export const jsonDigest = value => digest(jsonBytes(canonical(value)));
export function boundedJson(value, max, code = 'PIPELINE_JSON_TOO_LARGE') {
  const normalized = canonical(value);
  need(jsonBytes(normalized).length <= max, code);
  return normalized;
}
export function normalizeApiUrl(value) {
  text(value, 'PIPELINE_API_URL_INVALID', 4096);
  let url;
  try { url = new URL(value); } catch { throw new BuyerError('PIPELINE_API_URL_INVALID'); }
  need(url.protocol === 'https:' && url.hostname && !url.username && !url.password &&
    !url.search && !url.hash, 'PIPELINE_API_URL_INVALID');
  // A dedicated or in-VPC deployment may have its own trusted host and prefix.
  // The operator selects this address; provider resource fields never select it.
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
export function apiEndpoint(apiUrl, path, query = {}) {
  const base = normalizeApiUrl(apiUrl);
  need(typeof path === 'string' && !path.startsWith('/') && !path.includes('\\') &&
    !path.includes('?') && !path.includes('#'), 'PIPELINE_API_PATH_INVALID');
  const url = new URL(path, base);
  need(url.origin === new URL(base).origin && url.href.startsWith(base), 'PIPELINE_API_PATH_INVALID');
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null)
    url.searchParams.set(key, String(value));
  return url.href;
}
export const jobPath = (id, suffix = '') => 'api/v1/jobs/' + encodeURIComponent(providerId(id)) + suffix;
export function normalizeLimits(value = {}) {
  need(object(value) && Object.keys(value).every(key => key in DEFAULT_LIMITS), 'PIPELINE_LIMITS_INVALID');
  const limits = { ...DEFAULT_LIMITS, ...value };
  for (const [key, item] of Object.entries(limits))
    need(Number.isSafeInteger(item) && item >= 1 && item <= CEILINGS[key], 'PIPELINE_LIMITS_INVALID');
  need(limits.maxTotalInputBytes >= limits.maxInputBytes, 'PIPELINE_LIMITS_INVALID');
  return Object.freeze(limits);
}
export function normalizeProfile(value, limits = DEFAULT_LIMITS) {
  need(object(value) && Object.keys(value).every(key => ['id', 'label', 'requestData'].includes(key)),
    'PIPELINE_PROFILE_INVALID');
  const id = profileId(value.id), label = value.label === undefined ? id : text(value.label, 'PIPELINE_PROFILE_LABEL_INVALID', 256);
  need(object(value.requestData), 'PIPELINE_REQUEST_DATA_REQUIRED');
  const requestData = boundedJson(value.requestData, limits.maxRequestDataBytes, 'PIPELINE_REQUEST_DATA_TOO_LARGE');
  const template = Object.hasOwn(requestData, 'template_id'), nodes = Object.hasOwn(requestData, 'job_nodes');
  need(template !== nodes, 'PIPELINE_TEMPLATE_OR_NODES_REQUIRED');
  if (template) providerId(requestData.template_id);
  else need(Array.isArray(requestData.job_nodes) && requestData.job_nodes.length > 0 &&
    requestData.job_nodes.length <= 1000 && requestData.job_nodes.every(object), 'PIPELINE_JOB_NODES_INVALID');
  const sha256 = jsonDigest({ id, requestData });
  const summary = { id, label, sha256, mode: template ? 'template' : 'nodes' };
  if (template) summary.templateId = requestData.template_id;
  else summary.nodeCount = requestData.job_nodes.length;
  return { id, label, requestData, sha256, summary };
}
export function normalizeConfiguration(value) {
  need(object(value) && value.schema === CONFIG_SCHEMA &&
    Object.keys(value).every(key => ['schema', 'account', 'apiUrl', 'apiKeyEnv', 'profiles', 'limits'].includes(key)),
    'PIPELINE_CONFIGURATION_INVALID');
  const limits = normalizeLimits(value.limits);
  const account = text(value.account, 'PIPELINE_ACCOUNT_REQUIRED', 256), apiUrl = normalizeApiUrl(value.apiUrl);
  need(typeof value.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.apiKeyEnv), 'PIPELINE_KEY_ENV_INVALID');
  need(Array.isArray(value.profiles) && value.profiles.length > 0 && value.profiles.length <= 1000, 'PIPELINE_PROFILES_REQUIRED');
  const profiles = value.profiles.map(row => normalizeProfile(row, limits));
  need(new Set(profiles.map(row => row.id)).size === profiles.length, 'PIPELINE_DUPLICATE_PROFILE');
  const configSha256 = jsonDigest({
    schema: CONFIG_SCHEMA, account, apiUrl, apiKeyEnv: value.apiKeyEnv, limits,
    profiles: profiles.map(row => ({ id: row.id, label: row.label, requestData: row.requestData })),
  });
  return { account, apiUrl, apiKeyEnv: value.apiKeyEnv, profiles, limits, configSha256 };
}
export function publicSource(configuration) {
  return {
    identity: { account: configuration.account, apiUrl: configuration.apiUrl, configSha256: configuration.configSha256 },
    profiles: configuration.profiles.map(profile => ({ ...profile.summary })),
    limits: { ...configuration.limits },
  };
}
export function validateJob(value, expectedId = null) {
  need(object(value), 'PIPELINE_JOB_RESPONSE_INVALID');
  providerId(value.id); providerId(value.workflow_id);
  need(typeof value.workflow_name === 'string' && Buffer.byteLength(value.workflow_name) <= 4096,
    'PIPELINE_JOB_RESPONSE_INVALID');
  text(value.created_at, 'PIPELINE_JOB_RESPONSE_INVALID', 256);
  need(JOB_STATUSES.includes(value.status), 'PIPELINE_JOB_STATUS_UNSUPPORTED');
  if (expectedId !== null) need(value.id === expectedId, 'PIPELINE_JOB_ID_MISMATCH');
  if (value.input_file_ids !== undefined && value.input_file_ids !== null) {
    need(Array.isArray(value.input_file_ids), 'PIPELINE_JOB_INPUT_IDS_INVALID');
    value.input_file_ids.forEach(providerId);
  }
  if (value.output_node_files !== undefined && value.output_node_files !== null) {
    need(Array.isArray(value.output_node_files), 'PIPELINE_JOB_OUTPUT_IDS_INVALID');
    for (const row of value.output_node_files) {
      need(object(row), 'PIPELINE_JOB_OUTPUT_IDS_INVALID');
      providerId(row.file_id); providerId(row.node_id);
      need(typeof row.node_type === 'string' && typeof row.node_subtype === 'string' &&
        Buffer.byteLength(row.node_type) <= 256 && Buffer.byteLength(row.node_subtype) <= 256,
        'PIPELINE_JOB_OUTPUT_IDS_INVALID');
    }
  }
  return value;
}
export function validateDetails(value, expectedId) {
  need(object(value) && value.id === expectedId && PROCESSING_STATUSES.includes(value.processing_status) &&
    Array.isArray(value.node_stats), 'PIPELINE_JOB_DETAILS_INVALID');
  for (const row of value.node_stats) {
    need(object(row), 'PIPELINE_JOB_DETAILS_INVALID');
    for (const key of ['node_name', 'node_type', 'node_subtype'])
      need(row[key] === undefined || row[key] === null ||
        (typeof row[key] === 'string' && Buffer.byteLength(row[key]) <= 4096), 'PIPELINE_JOB_DETAILS_INVALID');
    for (const key of ['ready', 'in_progress', 'success', 'failure'])
      need(Number.isSafeInteger(row[key]) && row[key] >= 0, 'PIPELINE_JOB_DETAILS_INVALID');
  }
  return value;
}
export function phaseForJob(job) {
  return ['COMPLETED', 'STOPPED', 'FAILED'].includes(job.status) ? job.status : 'ACTIVE';
}
/** Real provider identities only. The API does not specify local input ordering. */
export function pipelineOutputOptions(job) {
  if (job === null || job === undefined) return [];
  validateJob(job);
  const rows = [], seen = new Set();
  for (const fileId of job.input_file_ids ?? []) {
    const key = JSON.stringify([fileId, null]);
    if (!seen.has(key)) {
      seen.add(key); rows.push({ fileId, nodeId: null, label: 'Final node / ' + fileId, source: 'input_file_ids' });
    }
  }
  for (const item of job.output_node_files ?? []) {
    const key = JSON.stringify([item.file_id, item.node_id]);
    if (!seen.has(key)) {
      seen.add(key); rows.push({
        fileId: item.file_id, nodeId: item.node_id,
        label: item.node_type + ' / ' + item.node_subtype + ' / ' + item.node_id + ' / ' + item.file_id,
        source: 'output_node_files',
      });
    }
  }
  return rows;
}
export function selectedOutput(job, fileId, nodeId = null) {
  providerId(fileId); if (nodeId !== null) providerId(nodeId);
  const selected = pipelineOutputOptions(job).find(row => row.fileId === fileId && row.nodeId === nodeId);
  need(selected, 'PIPELINE_OUTPUT_NOT_ADVERTISED');
  return selected;
}
