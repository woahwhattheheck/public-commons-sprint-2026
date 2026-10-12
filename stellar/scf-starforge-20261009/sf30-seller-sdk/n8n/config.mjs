// MIT. n8n automations compile into the maintained SF30 purchased-job contract.
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonical, digest, plain, compileJobMerchant } from '../jobs/config.mjs';

export const SCHEMA = 'stellar-forge.n8n-merchant.v1';
export const REQUEST_SCHEMA = 'stellar-forge.n8n-dispatch.v1';
export const RECEIPT_SCHEMA = 'stellar-forge.n8n-accepted.v1';
export const fault = (code, message, status = 400) => Object.assign(new Error(message), { code: 'JOB_AUTOMATION_' + code, status });
export const fail = (code, message, status) => { throw fault(code, message, status); };
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const environment = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
function text(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    fail('CONFIG', label + ' must be a nonempty string.');
  return value;
}
function integer(value, fallback, minimum, maximum, label) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail('CONFIG', label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
function endpoint(value, label) {
  let url;
  try { url = new URL(value); } catch { fail('CONFIG', label + ' must be an absolute URL.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && local) || url.username || url.password || url.hash || url.search)
    fail('CONFIG', label + ' requires HTTPS or local HTTP, without credentials, query, or fragment.');
  return url.href.replace(/\/$/, '');
}
function envName(value, label) {
  if (typeof value !== 'string' || !environment.test(value)) fail('CONFIG', label + ' must name an environment variable.');
  return value;
}

/** Pure configuration review. No workflow, payment, or network operation occurs. */
export function compileN8nMerchant(raw, { baseDir = process.cwd() } = {}) {
  if (!plain(raw) || raw.schema !== SCHEMA || !plain(raw.n8n) || !plain(raw.automations))
    fail('CONFIG', 'Use the n8n merchant schema with n8n settings and automations.');
  const apiBaseUrl = endpoint(raw.n8n.apiBaseUrl, 'n8n API base URL');
  if (!new URL(apiBaseUrl).pathname.endsWith('/api/v1')) fail('CONFIG', 'The n8n API base URL must end in /api/v1.');
  const apiKeyEnvironment = envName(raw.n8n.apiKeyEnvironment, 'n8n API key');
  const connection = {
    apiBaseUrl, apiKeyEnvironment,
    requestTimeoutMs: integer(raw.n8n.requestTimeoutMs, 30000, 1000, 90000, 'Request timeout'),
    pollIntervalMs: integer(raw.n8n.pollIntervalMs, 2000, 250, 60000, 'Poll interval'),
    maxExecutionBytes: integer(raw.n8n.maxExecutionBytes, 16777216, 1024, 67108864, 'Execution response limit'),
  };
  const automations = Object.create(null), functions = Object.create(null), names = new Set([apiKeyEnvironment]);
  for (const [id, value] of Object.entries(raw.automations)) {
    if (id === 'then') fail('FUNCTION', 'Choose an automation name other than the JavaScript import hook then.');
    if (!plain(value) || !identifier.test(value.workflowId ?? '')) fail('CONFIG', 'Each automation needs its original workflow ID.');
    const webhookUrl = endpoint(value.webhookUrl, 'Production webhook URL');
    if (new URL(webhookUrl).pathname.split('/').includes('webhook-test')) fail('CONFIG', 'Select the published production webhook URL.');
    let header = null;
    if (value.webhookHeader !== undefined && value.webhookHeader !== null) {
      const h = value.webhookHeader;
      if (!plain(h) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(h.name ?? '') ||
          ['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'x-n8n-api-key',
            'idempotency-key', 'x-sfjobs-job-id', 'x-sfjobs-dispatch-id'].includes(h.name.toLowerCase()))
        fail('CONFIG', 'Use a distinct webhook authentication header name.');
      header = { name: h.name, environment: envName(h.environment, 'Webhook credential') };
      names.add(header.environment);
    }
    const resultFields = value.resultFields;
    if (!Array.isArray(resultFields) || !resultFields.length || resultFields.length > 64 ||
        new Set(resultFields).size !== resultFields.length || resultFields.some(k =>
          typeof k !== 'string' || !k || k.length > 160 || reserved.has(k) || /[\x00-\x1f]/.test(k)))
      fail('CONFIG', 'Select 1–64 distinct public result fields from the final result node.');
    const resultMode = value.resultMode ?? 'items';
    if (!['items', 'single'].includes(resultMode)) fail('CONFIG', 'Result mode must be items or single.');
    const maxResultItems = integer(value.maxResultItems, 10000, 1, 100000, 'Result item limit');
    functions[id] = { path: value.path, description: value.description, inputSchema: value.inputSchema,
      example: value.example, payment: value.payment, timeoutMs: value.timeoutMs,
      maxInputBytes: value.maxInputBytes, maxOutputBytes: value.maxOutputBytes,
      output: { format: 'json', filename: value.filename ?? id + '.json' } };
    automations[id] = {
      workflowId: value.workflowId, webhookUrl, webhookHeader: header,
      webhookNode: text(value.webhookNode, 'Original Webhook node name'),
      resultNode: text(value.resultNode, 'Public result node name'),
      resultFields: [...resultFields], resultMode, maxResultItems,
    };
  }
  const jobs = { schema: 'stellar-forge.paid-jobs.v1', publicOrigin: raw.publicOrigin,
    serviceName: raw.serviceName ?? 'Automation merchant', application: './application.mjs',
    workerCount: raw.workerCount, maxPending: raw.maxPending, maxJobs: raw.maxJobs,
    memoryLimitMb: raw.memoryLimitMb, environment: [...names], functions };
  if (raw.tags !== undefined) jobs.tags = raw.tags;
  const compiledJobs = compileJobMerchant(jobs, { baseDir });
  const normalized = JSON.parse(canonical({ schema: SCHEMA, connection, automations,
    publicOrigin: compiledJobs.publicOrigin, serviceName: compiledJobs.serviceName,
    jobConfiguration: JSON.parse(JSON.stringify(jobs)) }));
  return { normalized, jobs, compiledJobs, configurationSha256: digest(canonical(normalized)) };
}

export async function readN8nConfiguration(path) {
  path = resolve(path);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) fail('CONFIG', 'Select a regular configuration file up to 1 MiB.');
  const bytes = await readFile(path);
  if (bytes.length > 1048576) fail('CONFIG', 'The configuration exceeds 1 MiB.');
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('CONFIG', 'The configuration must contain UTF-8 JSON.'); }
  return { path, bytes, raw, ...compileN8nMerchant(raw) };
}

export function environmentStatus(configuration, env = process.env) {
  return configuration.jobs.environment.map(name => ({ name, present: typeof env[name] === 'string' && env[name].length > 0 }));
}
