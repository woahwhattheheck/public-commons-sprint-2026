// MIT. Native n8n production webhook and read-only public execution API.
import { canonical, digest, plain } from '../jobs/config.mjs';
import { REQUEST_SCHEMA, RECEIPT_SCHEMA, fault, fail } from './config.mjs';

export const EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const terminalFailure = new Set(['error', 'canceled', 'crashed']);
function credential(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value || /[\r\n\x00]/.test(value))
    fail('ENVIRONMENT_MISSING', 'Set the configured environment reference ' + name + ' before operating this merchant.', 503);
  return value;
}
/** Validate local references before recording any possible remote dispatch. */
export function validateDispatchEnvironment(configuration, automation, env = process.env) {
  const headers = { 'X-N8N-API-KEY': credential(env, configuration.connection.apiKeyEnvironment) };
  if (automation.webhookHeader) headers[automation.webhookHeader.name] = credential(env, automation.webhookHeader.environment);
  try { new Headers(headers); }
  catch { fail('ENVIRONMENT_INVALID', 'A configured credential cannot be sent as an HTTP header.', 503); }
}
function nextPoll(value, interval) {
  const current = Date.now();
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))
    return new Date(current + Math.max(interval, Number(value) * 1000)).toISOString();
  const parsed = Date.parse(value ?? '');
  return new Date(Number.isFinite(parsed) ? Math.max(current + interval, parsed) : current + interval).toISOString();
}
async function jsonRequest(url, { connection, signal, method = 'GET', headers, body,
  maximum = connection.maxExecutionBytes, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort(signal.reason);
  const timeout = setTimeout(() => controller.abort(fault('REQUEST_TIMEOUT', 'The n8n request timed out.', 504)), connection.requestTimeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { method, headers: { accept: 'application/json', ...headers },
      ...(body !== undefined ? { body: canonical(body) } : {}), redirect: 'error', signal: controller.signal });
    if (response.status === 429) throw Object.assign(fault('RATE_LIMITED', 'n8n asked this merchant to wait before another read.', 429), {
      httpStatus: 429, nextPollAt: nextPoll(response.headers.get('retry-after'), connection.pollIntervalMs),
    });
    if (!response.ok) throw Object.assign(fault('HTTP',
      'n8n returned HTTP ' + response.status + '. The original dispatch record is retained.', 502), { httpStatus: response.status });
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum))
      fail('RESPONSE_LIMIT', 'The n8n response exceeds the configured execution response limit.', 502);
    const chunks = []; let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > maximum) fail('RESPONSE_LIMIT', 'The n8n response exceeds the configured execution response limit.', 502);
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks); let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('RESPONSE_JSON', 'n8n must return the configured JSON response.', 502); }
    if (!plain(data)) fail('RESPONSE_JSON', 'n8n must return a JSON object.', 502);
    return { data, observation: { status: response.status, bytes: size, sha256: digest(bytes),
      receivedAt: new Date().toISOString() } };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? fault('MONITOR_CANCELLED', 'The local monitor stopped.', 409);
    if ((typeof error.code === 'string' && error.code.startsWith('JOB_AUTOMATION_'))) throw error;
    if (controller.signal.aborted) throw fault('REQUEST_TIMEOUT', 'The n8n request timed out; reconcile its retained dispatch.', 504);
    throw fault('TRANSPORT', 'The n8n request did not return a complete response.', 502);
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort);
    try { if (response?.body && !response.body.locked) await response.body.cancel(); } catch { /* Response already consumed. */ }
  }
}

export function dispatchRequest(row, dispatch, input) {
  return { schema: REQUEST_SCHEMA, jobId: row.jobId, functionId: row.functionId,
    dispatchId: dispatch.id, attemptId: dispatch.attemptId, inputSha256: row.inputSha256,
    configurationSha256: row.configurationSha256, input };
}
export function verifyAcknowledgment(data, request, automation) {
  if (data.schema !== RECEIPT_SCHEMA || data.workflowId !== automation.workflowId ||
      typeof data.executionId !== 'string' || !EXECUTION_ID.test(data.executionId) ||
      ['jobId', 'functionId', 'dispatchId', 'attemptId', 'inputSha256', 'configurationSha256'].some(k => data[k] !== request[k]))
    fail('ACKNOWLEDGMENT', 'The webhook response must identify this exact job, dispatch, input and workflow.', 502);
  return { executionId: data.executionId, workflowId: data.workflowId };
}
export async function startExecution(configuration, automation, row, dispatch, input, options = {}) {
  const env = options.env ?? process.env, headers = { 'content-type': 'application/json',
    'idempotency-key': dispatch.id, 'x-sfjobs-job-id': row.jobId, 'x-sfjobs-dispatch-id': dispatch.id };
  if (automation.webhookHeader) headers[automation.webhookHeader.name] = credential(env, automation.webhookHeader.environment);
  // Resolve the API reference before the side-effecting webhook is sent.
  credential(env, configuration.connection.apiKeyEnvironment);
  const request = dispatchRequest(row, dispatch, input);
  const response = await jsonRequest(automation.webhookUrl, { ...options, connection: configuration.connection,
    method: 'POST', headers, body: request, maximum: 65536 });
  if (response.observation.status !== 202) fail('ACKNOWLEDGMENT', 'Configure Respond to Webhook to acknowledge with HTTP 202.', 502);
  return { ...verifyAcknowledgment(response.data, request, automation), observation: response.observation };
}

export async function getExecution(configuration, executionId, options = {}) {
  if (typeof executionId !== 'string' || !EXECUTION_ID.test(executionId)) fail('EXECUTION_ID', 'Select the original n8n execution ID.');
  const key = credential(options.env ?? process.env, configuration.connection.apiKeyEnvironment);
  const url = configuration.connection.apiBaseUrl + '/executions/' + encodeURIComponent(executionId) + '?includeData=true';
  return jsonRequest(url, { ...options, connection: configuration.connection, headers: { 'X-N8N-API-KEY': key } });
}

function firstWebhookBody(data, name) {
  const runs = data?.data?.resultData?.runData?.[name];
  if (!Array.isArray(runs) || runs.length !== 1) return null;
  const output = runs[0]?.data?.main?.[0];
  if (!Array.isArray(output) || output.length !== 1 || !plain(output[0]?.json?.body)) return null;
  return output[0].json.body;
}
/** Project only declared public output fields; raw execution headers never enter the journal. */
export function inspectExecution(response, automation, row, dispatch, input, { requireBinding = false, maxOutputBytes } = {}) {
  const data = response.data;
  if (data.dataTooLargeToDisplay === true)
    fail('EXECUTION_TOO_LARGE', 'n8n could not expose this execution data. Select a workflow with a retained public result small enough for its execution API.', 409);
  if (data.data?.redactionInfo?.isRedacted === true)
    fail('EXECUTION_REDACTED', 'The selected execution data is redacted by its n8n configuration.', 409);
  if (typeof data.id !== 'string' || !EXECUTION_ID.test(data.id) || data.workflowId !== automation.workflowId ||
      dispatch.executionId && data.id !== dispatch.executionId)
    fail('EXECUTION_IDENTITY', 'The n8n execution belongs to a different workflow or dispatch.', 409);
  if (data.mode !== 'webhook') fail('EXECUTION_MODE', 'Select the production webhook execution for this dispatch.', 409);
  if (data.data?.version !== undefined && ![0, 1].includes(data.data.version))
    fail('EXECUTION_DATA_VERSION', 'This execution uses an unsupported retained-data version.', 409);
  const source = firstWebhookBody(data, automation.webhookNode), request = dispatchRequest(row, dispatch, input);
  if (source && canonical(source) !== canonical(request))
    fail('EXECUTION_BINDING', 'The original Webhook input does not match this paid job and dispatch.', 409);
  const status = data.status;
  if (!['new', 'running', 'waiting', 'success', 'error', 'canceled', 'crashed', 'unknown'].includes(status))
    fail('EXECUTION_STATE', 'n8n returned an unsupported execution state.', 502);
  const complete = status === 'success' || terminalFailure.has(status);
  if ((requireBinding || complete) && !source)
    fail('EXECUTION_DATA_REQUIRED', 'Save production execution data so this job can verify its original Webhook input.', 409);
  const observation = { ...response.observation, executionId: data.id, workflowId: data.workflowId,
    status, mode: typeof data.mode === 'string' ? data.mode : null,
    startedAt: typeof data.startedAt === 'string' ? data.startedAt : null,
    stoppedAt: typeof data.stoppedAt === 'string' ? data.stoppedAt : null, inputVerified: Boolean(source) };
  if (!complete) return { state: 'PENDING', observation };
  if (terminalFailure.has(status)) return { state: 'FAILED', observation, error: 'JOB_AUTOMATION_WORKFLOW_FAILED' };
  if (!data.stoppedAt) fail('EXECUTION_STATE', 'The successful execution has not finished retaining its result.', 409);
  const runs = data?.data?.resultData?.runData?.[automation.resultNode];
  if (!Array.isArray(runs) || !runs.length) fail('RESULT_NODE', 'The configured public result node is absent from the saved execution.', 409);
  const items = [];
  for (const run of runs) {
    if (run.error || run.executionStatus && run.executionStatus !== 'success')
      fail('RESULT_NODE', 'The selected public result node did not complete successfully.', 409);
    const output = run?.data?.main?.[0];
    if (!Array.isArray(output)) fail('RESULT_NODE', 'The selected result node has no original first output.');
    for (const item of output) {
      if (item?.redaction?.redacted === true) fail('EXECUTION_REDACTED', 'The selected public result item is redacted.', 409);
      if (!plain(item?.json)) fail('RESULT_SHAPE', 'The selected result node must return JSON objects.', 409);
      const projected = Object.create(null);
      for (const field of automation.resultFields) {
        if (!Object.hasOwn(item.json, field)) fail('RESULT_FIELD', 'The selected result is missing public field ' + field + '.', 409);
        projected[field] = item.json[field];
      }
      items.push(projected);
      if (items.length > automation.maxResultItems) fail('RESULT_LIMIT', 'The selected result exceeds its configured item limit.', 413);
    }
  }
  if (automation.resultMode === 'single' && items.length !== 1)
    fail('RESULT_SHAPE', 'Single result mode requires exactly one original public item.', 409);
  const result = automation.resultMode === 'single' ? items[0] : items;
  const body = Buffer.from(canonical(result));
  if (body.length > maxOutputBytes) fail('RESULT_LIMIT', 'The selected result exceeds the original paid-job output limit.', 413);
  return { state: 'SUCCEEDED', observation, body };
}
