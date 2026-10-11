#!/usr/bin/env node
// MIT. Operate original application functions through purchased SF101 allowance.
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openJobStore } from '../../sf30-seller-sdk/jobs/store.mjs';
import { canonical, digest, jobError } from '../../sf30-seller-sdk/jobs/config.mjs';
import { configureApplication, readApplication, KEY_HEADER, KEY_ENV, OPERATION } from './configuration.mjs';
import { startApplication, executionView, executionExport, validateExecution, cancelUnstartedExecution, CONTROL_PATH } from './worker.mjs';
import { allowance } from './allowance-client.mjs';

const help = String.raw`Purchased API application operations

  api-application configure --merchant JOBS_JSON --gateway API_GATEWAY_JSON
      --out NEW_PRIVATE_DIRECTORY --worker-port PORT --route PASS_ROUTE FUNCTION
      [--route PASS_ROUTE FUNCTION ...] [--bind-routes]
  api-application serve --config APPLICATION_JSON [--api-port 0] [--console-port 0]
  api-application worker --config APPLICATION_JSON
  api-application status|list --config APPLICATION_JSON [--after OPERATION] [--limit 50] [--offline]
  api-application inspect --config APPLICATION_JSON --order ORDER --request-id REQUEST [--offline]
  api-application recover|release --config APPLICATION_JSON --order ORDER --request-id REQUEST
      --revision CALL_REVISION --operation-id OPERATOR_OPERATION --actor ACTOR --reason REASON [--offline]
  api-application backup-inputs --config APPLICATION_JSON

configure retains the original application and input schema. --bind-routes writes
a new pinned merchant config using the purchased route paths and response limits.
serve starts the private application worker and the existing customer API gateway.
worker starts the private backend alone for an already managed gateway.

inspect also accepts --operation sf101-<64 hex>. list is explicitly paginated.
recover attaches the exact completed native result through the original API-pass
operator transaction. release first makes an unstarted native operation terminal.
Use the same revision, operation ID, actor and reason when replaying recovery.
An interrupted or failed execution with an attempt remains available for original
operator review; issuing a new customer request uses a new paid operation.

Customer purchase and API calls use api-purchase and api-pass-client.
`;
const fail = (code, status = 400) => { throw jobError(code, status); };
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function parse(argv) {
  const command = argv.shift() || 'help', options = { routes: [] };
  const values = new Set(['merchant', 'gateway', 'out', 'worker-port', 'config', 'api-port', 'console-port',
    'after', 'limit', 'operation', 'order', 'request-id', 'revision', 'operation-id', 'actor', 'reason', 'python']);
  const flags = new Set(['bind-routes', 'offline']);
  while (argv.length) {
    const item = argv.shift();
    if (!item.startsWith('--')) fail('APP_OPTION_REQUIRED');
    const name = item.slice(2);
    if (name === 'route') {
      const id = argv.shift(), functionId = argv.shift();
      if (!id || !functionId || id.startsWith('--') || functionId.startsWith('--')) fail('APP_ROUTE_MAPPING_REQUIRED');
      options.routes.push({ id, functionId }); continue;
    }
    if (flags.has(name)) {
      if (options[name] !== undefined) fail('APP_DUPLICATE_OPTION');
      options[name] = true; continue;
    }
    if (!values.has(name) || !argv.length || options[name] !== undefined) fail('APP_OPTION_REQUIRED');
    options[name] = argv.shift();
  }
  return { command, options };
}
function required(options, ...names) {
  for (const name of names) if (typeof options[name] !== 'string' || !options[name]) fail('APP_' + name.toUpperCase().replaceAll('-', '_') + '_REQUIRED');
}
function integer(value, fallback, minimum, maximum, code) {
  const result = value === undefined ? fallback : /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) fail(code);
  return result;
}
export const applicationOperation = (order, requestId) => 'sf101-' + digest(canonical([order, requestId]));
function selectedOperation(options) {
  if (options.operation) {
    if (!OPERATION.test(options.operation)) fail('APP_OPERATION_REQUIRED');
    if ((options.order || options['request-id']) &&
        options.operation !== applicationOperation(options.order, options['request-id'])) fail('APP_OPERATION_REFERENCE_CHANGED');
    return options.operation;
  }
  required(options, 'order', 'request-id');
  return applicationOperation(options.order, options['request-id']);
}
function privateRequest(runtime, path, { method = 'GET', value } = {}) {
  return new Promise((resolve, reject) => {
    const body = value === undefined ? null : Buffer.from(canonical(value));
    const request = httpRequest(new URL(path, runtime.profile.origin), {
      method, headers: { [KEY_HEADER]: runtime.capability, 'Accept': 'application/json',
        'Content-Type': 'application/json', ...(body ? { 'Content-Length': body.length } : {}),
        'Connection': 'close' }, timeout: 20000,
    }, response => {
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 7 * 1024 * 1024) response.destroy(jobError('APP_PRIVATE_REPLY_TOO_LARGE', 503));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(jobError('APP_PRIVATE_REPLY_INVALID', 503)); return; }
        if (response.statusCode !== 200) {
          const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(value.error ?? '') ? value.error : 'APP_PRIVATE_OPERATION_FAILED';
          reject(jobError(code, response.statusCode)); return;
        }
        resolve(value);
      });
    });
    request.on('timeout', () => request.destroy(jobError('APP_PRIVATE_BACKEND_TIMED_OUT', 503)));
    request.on('error', error => reject(Object.assign(jobError(error.code === 'ECONNREFUSED'
      ? 'APP_PRIVATE_BACKEND_OFFLINE' : 'APP_PRIVATE_BACKEND_UNAVAILABLE', 503), { transportCode: error.code })));
    request.end(body);
  });
}
async function withOfflineStore(runtime, operation) {
  const store = await openJobStore(runtime.profile.store, runtime.source);
  try {
    for (const row of store.rows()) validateExecution(runtime, row);
    return await operation(store);
  } finally { await store.close(); }
}
async function readExecution(runtime, id, { body = false, offline = false } = {}) {
  if (!offline) {
    try { return await privateRequest(runtime, CONTROL_PATH + '/executions/' + id + (body ? '/recovery' : '')); }
    catch (error) { if (error.transportCode !== 'ECONNREFUSED') throw error; }
  }
  return withOfflineStore(runtime, store => executionExport(runtime, store, id, { body }));
}
async function nativeSummary(runtime, command, options) {
  const after = options.after || '', limit = integer(options.limit, 50, 1, 200, 'APP_PAGE_REQUIRED');
  if (after && !OPERATION.test(after)) fail('APP_PAGE_REQUIRED');
  if (!options.offline) {
    try {
      const path = command === 'status' ? '/status' : '/executions?limit=' + limit + (after ? '&after=' + after : '');
      return await privateRequest(runtime, CONTROL_PATH + path);
    } catch (error) { if (error.transportCode !== 'ECONNREFUSED') throw error; }
  }
  return withOfflineStore(runtime, async store => {
    const rows = store.rows();
    if (command === 'status') {
      const counts = {}; let resultBytes = 0;
      for (const row of rows) { counts[row.state] = (counts[row.state] || 0) + 1; resultBytes += row.result?.bytes || 0; }
      return { schema: 'stellar-forge.sf101.api-application-status.v1', running: false,
        source: runtime.source.identity, profileSha256: runtime.profileSha256, counts,
        retainedExecutions: rows.length, retainedResultBytes: resultBytes, activeWorkers: 0,
        fault: store.fault, interruptedOnRestart: rows.filter(row => ['QUEUED', 'RUNNING', 'CANCELLING'].includes(row.state)).length };
    }
    const selected = rows.filter(row => row.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit + 1);
    const page = selected.slice(0, limit);
    return { schema: 'stellar-forge.sf101.api-application-executions.v1',
      executions: page.map(row => executionView(row)), nextAfter: selected.length > limit ? page.at(-1).id : null };
  });
}
async function cancel(runtime, id, current, options) {
  if (current.execution.state === 'CANCELLED' && current.execution.attempts.length === 0) return current;
  const value = { expectedRevision: current.execution.revision, operationId: options['operation-id'], reason: options.reason };
  if (!options.offline) {
    try { return await privateRequest(runtime, CONTROL_PATH + '/executions/' + id + '/cancel-unstarted', { method: 'POST', value }); }
    catch (error) { if (error.transportCode !== 'ECONNREFUSED') throw error; }
  }
  return withOfflineStore(runtime, async store => {
    await cancelUnstartedExecution(runtime, store, id, value);
    return executionExport(runtime, store, id, { body: false });
  });
}
async function runService(runtime, options, withGateway) {
  const apiPort = withGateway ? integer(options['api-port'], 0, 0, 65535, 'APP_API_PORT_REQUIRED') : 0;
  const consolePort = withGateway ? integer(options['console-port'], 0, 0, 65535, 'APP_CONSOLE_PORT_REQUIRED') : 0;
  const service = await startApplication(runtime, { python: options.python });
  print({ status: 'API_APPLICATION_RUNNING', privateWorkerOrigin: service.origin,
    profile: runtime.profilePath, routes: runtime.routes.map(route => ({ id: route.id, functionId: route.functionId, path: route.path })),
    source: runtime.source.identity });
  let child = null, childDone = Promise.resolve(), stopping = null, finish;
  const ended = new Promise(resolve => { finish = resolve; });
  async function stop(code = 0) {
    if (stopping) return stopping;
    stopping = (async () => {
      child?.kill('SIGTERM');
      await service.stop();
      await childDone;
      process.exitCode = code; finish();
    })();
    return stopping;
  }
  const signal = () => { stop().catch(error => { process.stderr.write(JSON.stringify({ ok: false, error: error.code || 'APP_STOP_FAILED' }) + '\n'); process.exitCode = 1; finish(); }); };
  process.once('SIGINT', signal); process.once('SIGTERM', signal);
  if (withGateway) {
    const cli = fileURLToPath(new URL('../api-access/cli.py', import.meta.url));
    child = spawn(options.python || process.env.PYTHON || 'python3', [cli, 'serve',
      '--config', runtime.profile.gateway, '--api-port', String(apiPort), '--console-port', String(consolePort)], {
      env: { ...process.env, [KEY_ENV]: runtime.capability, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'inherit', 'inherit'],
    });
    childDone = new Promise(resolve => { child.once('close', resolve); child.once('error', resolve); });
    child.once('error', () => { stop(1).catch(() => finish()); });
    child.once('close', (code, signal) => { if (!stopping) stop(code ?? (signal ? 1 : 0)).catch(() => finish()); });
  }
  try { await ended; }
  finally { process.off('SIGINT', signal); process.off('SIGTERM', signal); await service.stop(); }
}
export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parse([...argv]);
  if (['help', '--help', '-h'].includes(command)) { process.stdout.write(help); return; }
  if (command === 'configure') {
    required(options, 'merchant', 'gateway', 'out', 'worker-port');
    print(await configureApplication({ merchant: options.merchant, gateway: options.gateway, directory: options.out,
      port: integer(options['worker-port'], undefined, 1, 65535, 'APP_PRIVATE_PORT_REQUIRED'),
      mappings: options.routes, bindRoutes: Boolean(options['bind-routes']) }));
    return;
  }
  if (!['serve', 'worker', 'status', 'list', 'inspect', 'recover', 'release', 'backup-inputs'].includes(command))
    fail('APP_COMMAND_REQUIRED');
  required(options, 'config');
  const runtime = await readApplication(options.config);
  if (command === 'serve' || command === 'worker') { await runService(runtime, options, command === 'serve'); return; }
  if (command === 'status' || command === 'list') { print(await nativeSummary(runtime, command, options)); return; }
  if (command === 'backup-inputs') {
    print({ schema: 'stellar-forge.sf101.api-application-backup-inputs.v1',
      merchantState: runtime.gateway.state, applicationDirectory: dirname(runtime.profilePath),
      executionDirectory: runtime.profile.store,
      files: [runtime.profilePath, runtime.profile.gateway, runtime.profile.key, runtime.profile.merchant, runtime.source.identity.application],
      source: runtime.source.identity, profileSha256: runtime.profileSha256,
      environmentNames: runtime.source.compiled.environment,
      restore: 'Stop both services, retain the complete execution directory and all listed private files with the original merchant snapshot, and restore their original absolute paths.' });
    return;
  }
  const id = selectedOperation(options);
  if (command === 'inspect') {
    const result = await readExecution(runtime, id, { offline: options.offline });
    if (options.order && options['request-id'])
      result.allowance = await allowance(runtime, 'describe', {}, { order: options.order, requestId: options['request-id'], python: options.python });
    print(result); return;
  }
  required(options, 'order', 'request-id', 'revision', 'operation-id', 'actor', 'reason');
  const revision = integer(options.revision, undefined, 1, Number.MAX_SAFE_INTEGER, 'APP_CALL_REVISION_REQUIRED');
  let execution = await readExecution(runtime, id, { body: command === 'recover', offline: options.offline });
  if (command === 'release') execution = await cancel(runtime, id, execution, options);
  const result = await allowance(runtime, command, execution, {
    order: options.order, requestId: options['request-id'], revision, operationId: options['operation-id'],
    actor: options.actor, reason: options.reason, python: options.python,
  });
  print(result);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'APP_OPERATION_FAILED';
    process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n'); process.exitCode = 1;
  });
}
