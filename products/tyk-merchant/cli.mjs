#!/usr/bin/env node
// MIT. Installed entrypoint over the original Tyk workspace and native request/receiving records.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeTykProduct, inspectTykProduct, openTykProduct } from './workspace.mjs';
import { inspectTykProductLaunch } from './managed.mjs';
import { TykProductClient, tykProductActions } from './client.mjs';
import { privateBytes, decode, need, HASH, UUID } from './common.mjs';
import { TYK_MAX_JSON_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/actions.mjs';

const HELP = [
  'Tyk API operations product',
  '',
  '  tyk-product init --dir PRIVATE_PRODUCT [--workspace ORIGINAL_WORKSPACE] [--name NAME] [--connections PRIVATE_JSON]',
  '  tyk-product inspect --dir PRIVATE_PRODUCT',
  '  tyk-product review|open --dir PRIVATE_PRODUCT [--port 0] [--expected-binding SHA256]',
  '  tyk-product actions [--name ORIGINAL_METHOD]',
  '  tyk-product status --dir PRIVATE_PRODUCT',
  '  tyk-product records --dir PRIVATE_PRODUCT [--kind connection|capture|cohort|rollout|delivery|receiving]',
  '       [--offset 0 --limit 50 --snapshot SHA256]',
  '  tyk-product record --dir PRIVATE_PRODUCT --kind KIND --id RECORD_ID [--revision NUMBER --offset 0 --limit 50]',
  '  tyk-product definition --dir PRIVATE_PRODUCT --capture RECORD_ID --api ORIGINAL_API_ID [--revision NUMBER]',
  '  tyk-product adapt-definition --dir PRIVATE_PRODUCT --capture RECORD_ID --api ORIGINAL_API_ID --connection TARGET_RECORD_ID [--revision NUMBER]',
  '  tyk-product review-fields --dir PRIVATE_PRODUCT --id ROLLOUT_ID [--revision NUMBER --offset 0 --limit 50]',
  '  tyk-product call --dir PRIVATE_PRODUCT --method ORIGINAL_METHOD [--input PRIVATE_ARGUMENTS_JSON] [--out PRIVATE_JSON]',
  '  tyk-product download-source --dir PRIVATE_PRODUCT --reference PRIVATE_REFERENCE_JSON --out PRIVATE_FILE',
  '  tyk-product capture --dir PRIVATE_PRODUCT --request UUID --connection RECORD_ID [--label LABEL]',
  '  tyk-product cohort --dir PRIVATE_PRODUCT --request UUID --capture RECORD_ID --capture-revision NUMBER',
  '       --apis PRIVATE_API_ID_ARRAY --label LABEL [--note TEXT]',
  '  tyk-product prepare --dir PRIVATE_PRODUCT --request UUID --connection RECORD_ID --selection PRIVATE_SELECTION_JSON',
  '       [--cohort RECORD_ID --cohort-revision NUMBER --source-definition PRIVATE_JSON --label LABEL --note TEXT]',
  '  tyk-product dispatch --dir PRIVATE_PRODUCT --request UUID --id RECORD_ID --revision NUMBER --plan-sha256 SHA256',
  '  tyk-product reconcile --dir PRIVATE_PRODUCT --request UUID --id RECORD_ID [--revision NUMBER]',
  '  tyk-product export --dir PRIVATE_PRODUCT --request UUID [--label LABEL]',
  '  tyk-product download --dir PRIVATE_PRODUCT --id ORIGINAL_DELIVERY_ID --out PRIVATE_FILE [--sha256 SHA256]',
  '  tyk-product receive --dir PRIVATE_PRODUCT --request UUID --file ORIGINAL_NDJSON [--label LABEL]',
  '  tyk-product adopt --dir PRIVATE_PRODUCT --request UUID --id RECEIVING_ID --revision NUMBER --manifest-sha256 SHA256',
  '',
  'Use the original method schemas printed by actions for saveConnection, importCapture and complete source reads.',
  'Save each request UUID and its exact arguments before sending. A lost reply is recovered from the same saved record.',
  'Gateway ACCEPTED means the definition was saved and still needs an explicitly reviewed native reload.',
  'download receives an existing frozen delivery; receive inspects the complete file before the separate adopt action.',
  'See products/tyk-merchant/OPERATING.md and RECEIVING.md.',
  '',
].join('\n');
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function parse(args, allowed) {
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const name = args[index], value = args[++index];
    need(allowed.includes(name) && !options.has(name) && typeof value === 'string' &&
      value && !value.startsWith('--'), 'Supply each declared option once: ' + name, 'ARGUMENTS');
    options.set(name, value);
  }
  return options;
}
const required = (options, name) => {
  need(options.has(name), 'Supply ' + name + '.', 'ARGUMENTS'); return options.get(name);
};
function number(options, key, fallback) {
  const text = options.get(key);
  if (text === undefined) return fallback;
  need(/^(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(Number(text)),
    'Use an integer for ' + key + '.', 'ARGUMENTS');
  return Number(text);
}
const inputFile = path => privateBytes(resolve(path), false, TYK_MAX_JSON_BYTES).then(decode);
const optional = (options, key, name = key.slice(2)) => options.has(key) ? { [name]: options.get(key) } : {};
const paging = options => ({ offset: number(options, '--offset', 0), limit: number(options, '--limit', 50) });
function request(options) {
  const requestId = required(options, '--request');
  need(UUID.test(requestId), 'Supply the original request UUID.', 'ARGUMENTS');
  return { requestId };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['help','--help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command,...rest] = args;
  if (command === 'init') {
    const options = parse(rest, ['--dir','--workspace','--name','--connections']);
    const result = await initializeTykProduct({ directory: required(options, '--dir'),
      workspaceDirectory: options.get('--workspace'), name: options.get('--name'),
      connectionsFile: options.get('--connections') });
    print(result); return result;
  }
  if (command === 'inspect') {
    const options = parse(rest, ['--dir']), result = await inspectTykProduct(required(options, '--dir'));
    print(result); return result;
  }
  if (['review','open'].includes(command)) {
    const options = parse(rest, ['--dir','--port','--expected-binding']);
    if (options.has('--expected-binding')) need(HASH.test(options.get('--expected-binding')), 'Supply the reviewed launch SHA-256.', 'ARGUMENTS');
    const selected = { directory: resolve(required(options, '--dir')), port: number(options, '--port', 0),
      ...optional(options, '--expected-binding', 'expectedBindingSha256') };
    if (command === 'review') {
      const result = await inspectTykProductLaunch(selected); print(result); return result;
    }
    const active = await openTykProduct(selected);
    const { workspace, native, close, ...record } = active;
    process.stdout.write(JSON.stringify(record) + '\n');
    let stopping;
    const stop = () => stopping ??= close().then(() => {
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
    }).catch(error => { stopping = null; process.stderr.write((error.code ?? 'TYK_PRODUCT_CLOSE_INCOMPLETE') + '\n'); process.exitCode = 1; });
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return active;
  }
  if (command === 'actions') {
    const options = parse(rest, ['--name']);
    const selected = tykProductActions().filter(item => !options.has('--name') || item.name === options.get('--name'));
    need(selected.length > 0, 'Select an original Tyk method.', 'ARGUMENTS'); print(selected); return selected;
  }
  const allowed = {
    status: ['--dir'], records: ['--dir','--kind','--offset','--limit','--snapshot'],
    record: ['--dir','--kind','--id','--revision','--offset','--limit'],
    definition: ['--dir','--capture','--api','--revision'],
    'adapt-definition': ['--dir','--capture','--api','--revision','--connection'],
    'review-fields': ['--dir','--id','--revision','--offset','--limit'],
    'download-source': ['--dir','--reference','--out'],
    call: ['--dir','--method','--input','--out'],
    capture: ['--dir','--request','--connection','--label'],
    cohort: ['--dir','--request','--capture','--capture-revision','--apis','--label','--note'],
    prepare: ['--dir','--request','--connection','--selection','--cohort','--cohort-revision','--source-definition','--label','--note'],
    dispatch: ['--dir','--request','--id','--revision','--plan-sha256'],
    reconcile: ['--dir','--request','--id','--revision'],
    export: ['--dir','--request','--label'],
    download: ['--dir','--id','--out','--sha256'],
    receive: ['--dir','--request','--file','--label'],
    adopt: ['--dir','--request','--id','--revision','--manifest-sha256'],
  }[command];
  need(allowed, HELP, 'ARGUMENTS');
  const options = parse(rest, allowed), controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let client;
  try {
    client = new TykProductClient({ directory: required(options, '--dir'), signal: controller.signal });
    let result;
    if (command === 'status') result = await client.status();
    if (command === 'records') result = await client.listRecords({
      ...paging(options), ...optional(options, '--kind'), ...optional(options, '--snapshot'),
    });
    if (command === 'record') result = await client.getRecord({
      kind: required(options, '--kind'), id: required(options, '--id'), ...paging(options),
      ...(options.has('--revision') ? { revision: number(options, '--revision') } : {}),
    });
    if (command === 'definition') result = await client.readDefinition({
      captureId: required(options, '--capture'), apiId: required(options, '--api'),
      ...(options.has('--revision') ? { revision: number(options, '--revision') } : {}),
    });
    if (command === 'adapt-definition') result = await client.adaptDefinition({
      captureId: required(options, '--capture'), apiId: required(options, '--api'),
      connectionId: required(options, '--connection'),
      ...(options.has('--revision') ? { revision: number(options, '--revision') } : {}),
    });
    if (command === 'review-fields') result = await client.readReview({
      id: required(options, '--id'), ...paging(options),
      ...(options.has('--revision') ? { revision: number(options, '--revision') } : {}),
    });
    if (command === 'download-source') result = await client.downloadSource({
      reference: await inputFile(required(options, '--reference')), path: resolve(required(options, '--out')),
    });
    if (command === 'call') {
      const method = required(options, '--method'), input = options.has('--input') ? await inputFile(options.get('--input')) : {};
      result = options.has('--out') ? await client.callToFile(method, input, { path: resolve(options.get('--out')) }) :
        await client.call(method, input);
    }
    if (command === 'capture') result = await client.capture({
      ...request(options), connectionId: required(options, '--connection'), ...optional(options, '--label'),
    });
    if (command === 'cohort') result = await client.createCohort({
      ...request(options), captureId: required(options, '--capture'),
      captureRevision: number(options, '--capture-revision'),
      apiIds: await inputFile(required(options, '--apis')), label: required(options, '--label'), ...optional(options, '--note'),
    });
    if (command === 'prepare') result = await client.prepareRollout({
      ...request(options), connectionId: required(options, '--connection'),
      selection: await inputFile(required(options, '--selection')),
      ...(options.has('--source-definition') ? { sourceDefinition: await inputFile(options.get('--source-definition')) } : {}),
      ...optional(options, '--cohort', 'cohortId'),
      ...(options.has('--cohort-revision') ? { cohortRevision: number(options, '--cohort-revision') } : {}),
      ...optional(options, '--label'), ...optional(options, '--note'),
    });
    if (command === 'dispatch') result = await client.dispatchRollout({
      ...request(options), id: required(options, '--id'), expectedRevision: number(options, '--revision'),
      planSha256: required(options, '--plan-sha256'),
    });
    if (command === 'reconcile') result = await client.reconcileRollout({
      ...request(options), id: required(options, '--id'),
      ...(options.has('--revision') ? { expectedRevision: number(options, '--revision') } : {}),
    });
    if (command === 'export') result = await client.exportWorkspace({ ...request(options), ...optional(options, '--label') });
    if (command === 'download') result = await client.downloadDelivery({
      id: required(options, '--id'), path: resolve(required(options, '--out')),
      ...optional(options, '--sha256', 'expectedSha256'),
    });
    if (command === 'receive') result = await client.inspectDeliveryFile({
      ...request(options), path: resolve(required(options, '--file')), ...optional(options, '--label'),
    });
    if (command === 'adopt') result = await client.adoptDelivery({
      ...request(options), id: required(options, '--id'), expectedRevision: number(options, '--revision'),
      manifestSha256: required(options, '--manifest-sha256'),
    });
    print(result); return result;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await client?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'TYK_PRODUCT_ERROR', message: error.message,
      ...(error.requestId ? { requestId: error.requestId } : {}),
      ...(error.recordId ? { recordId: error.recordId } : {}),
      ...(error.outcomeUnknown ? { outcomeUnknown: true } : {}),
    }) + '\n'); process.exitCode = 1;
  });
