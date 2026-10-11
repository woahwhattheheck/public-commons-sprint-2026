#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeNativeWorkspace, openNativeWorkspace } from './native-workspace.mjs';
import { startMcpWorkspace } from './serve.mjs';
import { openQueue, saveQueueReport } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue.mjs';
import { renderQueueReport } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-report.mjs';

const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const commands = {init:['--workspace','--catalog','--max-response-bytes','--response-timeout-ms'],
  call:['--input'], serve:['--port'], report:['--out'], inspect:[],
  'objects-register':['--description'], 'datasets-register':['--description'],
  'analysis-register':['--name','--database']};
function parse(args) {
  const [command, ...rest] = args;
  if (!Object.hasOwn(commands, command) || rest.length % 2) fail('MCP_NATIVE_CLI_ARGUMENTS_INVALID');
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--dir', ...commands[command]].includes(rest[i]) || Object.hasOwn(values, rest[i]) || !rest[i+1])
      fail('MCP_NATIVE_CLI_ARGUMENTS_INVALID');
    values[rest[i]] = rest[i+1];
  }
  if (!values['--dir']) fail('MCP_NATIVE_DIRECTORY_REQUIRED');
  return {command, values};
}
async function input(path, maximum) {
  if (!path) fail('MCP_NATIVE_INPUT_FILE_REQUIRED');
  const bytes = await readFile(path);
  if (bytes.length > maximum) fail('MCP_NATIVE_INPUT_TOO_LARGE');
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { fail('MCP_NATIVE_INPUT_JSON_INVALID'); }
}
function number(value) {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) fail('MCP_NATIVE_NUMBER_INVALID');
  return Number(value);
}
async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Native MCP buyer using the original SF88 workspace and inbox.\n' +
      'init --dir ABS --workspace EXISTING_SF88 [--catalog JSON] [--max-response-bytes N] [--response-timeout-ms N]\n' +
      'serve --dir ABS [--port N] (requires existing MCP_ACCESS_TOKEN)\n' +
      'call --dir ABS --input REQUEST_JSON\n' +
      'objects-register --dir ABS --description ORIGINAL_S3_OBJECTS_JSON\n' +
      'datasets-register --dir ABS --description ORIGINAL_SF30_DATASET_DESCRIPTION_JSON\n' +
      'analysis-register --dir ABS --name ALIAS --database RUNNING_ORIGINAL_ANALYSIS_DIRECTORY\n' +
      'inspect --dir ABS\nreport --dir ABS --out NEW_HTML\n');
    return;
  }
  const {command, values:v} = parse(args), directory = v['--dir'];
  if (command === 'init') return print(await initializeNativeWorkspace({
    directory, workspace:v['--workspace'],
    ...(v['--catalog'] ? {catalog:await input(v['--catalog'], 65536)} : {}),
    response:{maxBytes:number(v['--max-response-bytes']), timeoutMs:number(v['--response-timeout-ms'])},
  }));
  if (command === 'report') {
    if (!v['--out']) fail('MCP_NATIVE_OUTPUT_REQUIRED');
    // Native opening checks the trusted root and original operator binding.
    const native = await openNativeWorkspace(directory);
    try {
      const queue = await openQueue(join(native.manifest.directory, 'inbox'));
      return print(await saveQueueReport(v['--out'], renderQueueReport({jobs:await queue.list(), queueRoot:queue.root})));
    } finally { await native.close(); }
  }
  const native = await openNativeWorkspace(directory);
  if (command === 'analysis-register') {
    try {
      if (!v['--name'] || !v['--database']) fail('MCP_NATIVE_ANALYSIS_REGISTRATION_REQUIRED');
      return print(await native.registerAnalysis({name:v['--name'],database:v['--database']}));
    } finally {await native.close();}
  }
  if (command === 'objects-register' || command === 'datasets-register') {
    try {
      if(!v['--description'])fail('MCP_NATIVE_INPUT_FILE_REQUIRED');
      return print(await (command === 'datasets-register' ? native.registerDatasets(v['--description']) :
        native.registerObjects(v['--description'])));
    } finally {await native.close();}
  }
  if (command === 'inspect') {
    try { return print({schema:native.manifest.schema, directory:native.manifest.directory,
      originalWorkspace:native.manifest.workspace, route:native.manifest.route,
      network:native.manifest.workspaceBinding.network, response:native.manifest.response,
      history:await native.call({action:'history', limit:25}),
      objectSources:await native.call({action:'object-sources',limit:25}),
      objectAcquisitions:await native.call({action:'object-history',limit:25}),
      datasetSources:await native.call({action:'dataset-sources',limit:25}),
      datasetAcquisitions:await native.call({action:'dataset-history',limit:25})}); }
    finally { await native.close(); }
  }
  if (command === 'call') {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try { return print(await native.call(await input(v['--input'], 2 * 1024 * 1024), {signal:controller.signal})); }
    finally {
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
      await native.close();
    }
  }
  const manifest = native.manifest;
  await native.close();
  const port = v['--port'] === undefined ? '3210' : v['--port'];
  if (!/^(0|[1-9][0-9]*)$/.test(port) || Number(port) > 65535) fail('MCP_NATIVE_PORT_INVALID');
  const server = await startMcpWorkspace({environment:{...process.env,
    BAZAAR_DISCOVERY_URL:manifest.catalog.origin,
    PAID_RESOURCE_ORIGINS:manifest.route.origin,
    MCP_STATE_DIR:join(manifest.directory, 'quotes'),
    MCP_OPERATOR_MODULE:join(manifest.directory, 'operator.mjs'), MCP_PORT:port}});
  print({status:'NATIVE_MCP_LISTENING', url:server.address + '/mcp',
    tool:'sf43_discover_review_and_pay', originalWorkspace:manifest.workspace});
  let closing;
  const stop = () => {
    closing ??= server.close().catch(error => { process.stderr.write((error.code ?? 'MCP_NATIVE_CLOSE_FAILED') + '\n'); process.exitCode = 2; });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main(process.argv.slice(2)).catch(error => {
  const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'MCP_NATIVE_OPERATION_FAILED';
  process.stderr.write(JSON.stringify({error:code, retry:'NO_AUTOMATIC_RETRY'}) + '\n');
  process.exitCode = 1;
});

