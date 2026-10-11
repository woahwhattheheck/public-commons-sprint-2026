#!/usr/bin/env node
// MIT. Saved Tenderly merchant handover using the original native engines.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { templatePlan, inspectPlan, prepareProduct, readPreparedProduct, describeResult } from './product.mjs';
import { createTenderlyApplication, startTenderlyMerchant } from './application.mjs';
import { prepareBuyer, readBuyerPreparation } from './customer.mjs';
import { writeTicket } from '../../sf30-seller-sdk/upstream-operation.mjs';
import { parseOperationResponse } from '../../sf30-seller-sdk/upstream-operation-response.mjs';
import { privateDirectory, readBytes, writeNew, syncDirectory, json, parse } from '../../sf102-cube-paid-query-adapter/onboarding/files.mjs';

const HELP = `Tenderly saved simulation merchant — Node 22.16+ or Node 24

node cli.mjs template --out /private/plan.json
node cli.mjs inspect --plan /private/plan.json
node cli.mjs prepare --plan /private/plan.json --out /private/merchant
node cli.mjs prepared --prepared /private/merchant
node cli.mjs serve --prepared /private/merchant
  [--facilitator https://selected-facilitator.example] [--port 8423]
  [--operations-port 8424|off] [--max-in-flight 64] [--drain-grace-ms 60000]

node cli.mjs issue --prepared /private/merchant --body /private/request.json
  --id REQUEST_ID --subject CUSTOMER_ID --expires ISO_TIME --out /private/ticket.json
node cli.mjs list --prepared /private/merchant [--state STATE] [--cursor CURSOR] [--limit 25]
node cli.mjs status --prepared /private/merchant --operation-key SHA256
node cli.mjs audit --prepared /private/merchant --operation-key SHA256 [--after 0] [--limit 25]
node cli.mjs result --prepared /private/merchant --operation-key SHA256 --out /private/result.json
  [--response-out /private/response-envelope.json]
node cli.mjs recover --prepared /private/merchant --operation-key SHA256
  --generation N --request-hash SHA256 --action complete|retry --reference PROVIDER_REFERENCE
  [--response /private/response-envelope.json]

node cli.mjs lookup --prepared /private/merchant --operation-key SHA256 --simulation-id PROVIDER_ID [--refresh true]
node cli.mjs lookups --prepared /private/merchant --operation-key SHA256 [--before LOOKUP_ID] [--limit 25]
node cli.mjs lookup-inspect --prepared /private/merchant --lookup-id SHA256
node cli.mjs lookup-result --prepared /private/merchant --lookup-id SHA256 --observation-id UUID --out /private/saved-result.json
node cli.mjs recover-saved --prepared /private/merchant --lookup-id SHA256 --observation-id UUID
  --generation N --reference ORIGINAL_PROVIDER_RECORD

node cli.mjs buyer-prepare --prepared /private/merchant --body /private/request.json
  --ticket /private/ticket.json --intent INTENT_ID --out /private/buyer.json
  [--response-out /private/buyer-response.json]
node cli.mjs buyer-inspect --config /private/buyer.json
node cli.mjs workspace --state /private/tenderly-workspace [--plan /private/plan.json]
  [--port 0] [--facilitator https://selected-facilitator.example]

Preparation resumes the same exact plan and output after interruption. Existing
files with different bytes are retained for inspection. Output parents must exist
with private permissions. Keep the same package path, operation scope and key.
See README.md, CUSTOMER.md and WORKSPACE.md for the complete merchant journey.`;
const FLAGS = {
  template: [['out'], []], inspect: [['plan'], []], prepare: [['plan', 'out'], []], prepared: [['prepared'], []],
  serve: [['prepared'], ['facilitator', 'port', 'operations-port', 'max-in-flight', 'drain-grace-ms']],
  issue: [['prepared', 'body', 'id', 'subject', 'expires', 'out'], []],
  list: [['prepared'], ['state', 'cursor', 'limit']], status: [['prepared', 'operation-key'], []],
  audit: [['prepared', 'operation-key'], ['after', 'limit']],
  result: [['prepared', 'operation-key', 'out'], ['response-out']],
  recover: [['prepared', 'operation-key', 'generation', 'request-hash', 'action', 'reference'], ['response']],
  lookup: [['prepared', 'operation-key', 'simulation-id'], ['refresh']],
  lookups: [['prepared', 'operation-key'], ['before', 'limit']],
  'lookup-inspect': [['prepared', 'lookup-id'], []],
  'lookup-result': [['prepared', 'lookup-id', 'observation-id', 'out'], []],
  'recover-saved': [['prepared', 'lookup-id', 'observation-id', 'generation', 'reference'], []],
  'buyer-prepare': [['prepared', 'body', 'ticket', 'intent', 'out'], ['response-out']],
  'buyer-inspect': [['config'], []],
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function options(args) {
  const command = args[0], spec = FLAGS[command];
  if (!spec) throw new TypeError(HELP);
  const [required, optional] = spec, values = {};
  for (let i = 1; i < args.length; i += 2) {
    const name = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || ![...required, ...optional].includes(name) ||
        Object.hasOwn(values, name) || !value || value.startsWith('--')) throw new TypeError(HELP);
    values[name] = value;
  }
  if (required.some(name => !Object.hasOwn(values, name))) throw new TypeError(HELP);
  return { command, values };
}
function number(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError('Use an exact nonnegative integer');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new TypeError('Number is outside the supported range');
  return result;
}
async function readJson(path, max = 1048576) {
  return parse(await readBytes(resolve(path), { privateFile: true, max }), path);
}
async function writePrivate(path, bytes) {
  const target = resolve(path);
  await privateDirectory(dirname(target)); await writeNew(target, bytes); await syncDirectory(dirname(target));
  return target;
}
function output(value) { process.stdout.write(JSON.stringify(value) + '\n'); return value; }
function signalShutdown(runtime) {
  let stopping;
  const stop = () => stopping ??= runtime.close().then(result => {
    output({ status: 'TENDERLY_MERCHANT_STOPPED', shutdown: result });
  }).catch(error => { process.stderr.write((error.code ?? error.message) + '\n'); process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) {
    process.stdout.write(HELP + '\n'); return null;
  }
  if (args[0] === 'workspace') return (await import('./workspace/server.mjs')).main(args.slice(1));
  const { command, values: o } = options(args);
  if (command === 'template') return output({ status: 'PLAN_SAVED', path: await writePrivate(o.out, json(templatePlan())) });
  if (command === 'inspect') return output(inspectPlan(await readJson(o.plan)));
  if (command === 'prepare') return output(await prepareProduct({ plan: await readJson(o.plan), out: resolve(o.out) }));
  if (command === 'buyer-inspect') return output(await readBuyerPreparation({ configFile: resolve(o.config) }));
  const prepared = await readPreparedProduct(resolve(o.prepared));
  if (command === 'prepared') return output(prepared);
  if (command === 'buyer-prepare') return output(await prepareBuyer({ plan: prepared.plan,
    bodyFile: resolve(o.body), ticketFile: resolve(o.ticket), intentId: o.intent, out: resolve(o.out),
    ...(o['response-out'] ? { responseOut: resolve(o['response-out']) } : {}) }));
  if (command === 'serve') {
    const runtime = await startTenderlyMerchant({ plan: prepared.plan, stateDirectory: prepared.stateDirectory,
      port: number(o.port, 8423, 0, 65535), operationsPort: o['operations-port'] === 'off' ? null : number(o['operations-port'], 8424, 0, 65535),
      facilitator: o.facilitator, maxInFlight: number(o['max-in-flight'], 64, 1, 10000),
      drainGraceMs: number(o['drain-grace-ms'], 60000, 1, 300000),
      historyDirectory: join(prepared.stateDirectory, 'history'), availabilityDirectory: join(prepared.stateDirectory, 'availability'),
      ...(o.facilitator ? { deliveryStateDirectory: join(prepared.stateDirectory, 'delivery') } : {}) });
    signalShutdown(runtime);
    output({ status: 'TENDERLY_MERCHANT_LISTENING', mode: runtime.mode, url: runtime.url,
      operations: runtime.operations?.url ?? null, operationControl: runtime.operations?.operationControlUrl ?? null,
      planSha256: prepared.planSha256, stateDirectory: prepared.stateDirectory });
    return runtime;
  }
  const application = createTenderlyApplication({ plan: prepared.plan, stateDirectory: prepared.stateDirectory });
  try {
    const operations = application.operations;
    if (command === 'lookup') {
      if (o.refresh !== undefined && !['true', 'false'].includes(o.refresh)) throw new TypeError('--refresh must be true or false');
      return output(await application.providerRecovery.lookup({ operationKey: o['operation-key'],
        simulationId: o['simulation-id'], refresh: o.refresh === 'true' }));
    }
    if (command === 'lookups') return output(await application.providerRecovery.list({
      operationKey: o['operation-key'], before: o.before ?? '', limit: number(o.limit, 25, 1, 100) }));
    if (command === 'lookup-inspect') return output(await application.providerRecovery.inspect(o['lookup-id']));
    if (command === 'lookup-result') {
      const saved = await application.providerRecovery.response({ lookupId: o['lookup-id'], observationId: o['observation-id'] });
      return output({ status: 'PROVIDER_RESULT_SAVED', path: await writePrivate(o.out, saved.bytes),
        bytes: saved.bytes.length, sha256: saved.sha256, observation: saved.record });
    }
    if (command === 'recover-saved') return output(await application.providerRecovery.complete({
      lookupId: o['lookup-id'], observationId: o['observation-id'],
      expectedGeneration: number(o.generation, undefined, 1), reference: o.reference }));
    if (command === 'issue') {
      const issued = await operations.issue({ body: await readJson(o.body), id: o.id, subject: o.subject, expiresAt: Date.parse(o.expires) });
      const path = await writeTicket(resolve(o.out), issued);
      return output({ status: 'TICKET_SAVED', path, operationKey: issued.operationKey, requestHash: issued.requestHash, expiresAt: issued.expiresAt });
    }
    if (command === 'list') return output(await operations.list({ limit: number(o.limit, 25, 1, 100),
      ...(o.state ? { state: o.state } : {}), ...(o.cursor ? { cursor: o.cursor } : {}) }));
    if (command === 'status') return output(await operations.inspect(o['operation-key']) ?? { state: 'ABSENT', operationKey: o['operation-key'] });
    if (command === 'audit') return output(await operations.audit(o['operation-key'], {
      after: number(o.after, 0), limit: number(o.limit, 25, 1, 100) }));
    if (command === 'result') {
      if (o['response-out'] && resolve(o.out) === resolve(o['response-out'])) throw new TypeError('Result and response envelope paths must differ');
      const response = await operations.response(o['operation-key']);
      if (!response) throw Object.assign(new Error('TENDERLY_RESULT_NOT_FOUND'), { code: 'TENDERLY_RESULT_NOT_FOUND' });
      const path = await writePrivate(o.out, response.body);
      const responseEnvelope = o['response-out'] ? await writePrivate(o['response-out'], json({ status: response.status,
        headers: response.headers, bodyBase64: response.body.toString('base64') })) : undefined;
      return output({ status: 'RESULT_SAVED', path, responseEnvelope, operationKey: o['operation-key'],
        httpStatus: response.status, bytes: response.body.length, sha256: sha256(response.body), summary: describeResult(response) });
    }
    if (command === 'recover') {
      if (!['complete', 'retry'].includes(o.action) || (o.action === 'complete') !== Boolean(o.response))
        throw new TypeError('Complete recovery requires the original response file; retry uses only the provider reference');
      const response = o.response ? parseOperationResponse(await readJson(o.response, 24000000)) : undefined;
      return output(await operations.recover({ operationKey: o['operation-key'], expectedGeneration: number(o.generation, undefined, 1),
        requestHash: o['request-hash'], action: o.action, reference: o.reference, response }));
    }
    throw new TypeError(HELP);
  } finally { await application.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write((error.code ? error.code + ': ' : '') + error.message + '\n'); process.exitCode = 1; });
