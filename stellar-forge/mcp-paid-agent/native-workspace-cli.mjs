#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, isAbsolute, resolve } from 'node:path';
import { initializeNativeWorkspace, openNativeWorkspace } from './native-workspace.mjs';
import { startMcpWorkspace } from './serve.mjs';
import { openQueue, saveQueueReport } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue.mjs';
import { renderQueueReport } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-report.mjs';

const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const commands = {init:['--workspace','--catalog','--max-response-bytes','--response-timeout-ms'],
  call:['--input'], serve:['--port','--duckdb-description','--duckdb-description-sha256','--duckdb-workspace-id'], report:['--out'], inspect:[],
  'objects-register':['--description'], 'datasets-register':['--description'],
  'datasets-receive':['--id','--room','--session'],
  'analysis-register':['--name','--database'], 'analysis-inbox-register':['--name','--inbox'],
  'collections-register':['--description'], 'duckdb-register':['--description']};
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
async function input(path, maximum, expectedSha256) {
  if (!path) fail('MCP_NATIVE_INPUT_FILE_REQUIRED');
  const bytes = await readFile(path);
  if (bytes.length > maximum) fail('MCP_NATIVE_INPUT_TOO_LARGE');
  if (expectedSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedSha256) ||
      createHash('sha256').update(bytes).digest('hex') !== expectedSha256))
    fail('MCP_NATIVE_INPUT_CHANGED');
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
      'serve --dir ABS [--port N] [--duckdb-description PRIVATE_JSON] (requires existing MCP_ACCESS_TOKEN)\n' +
      '  [--duckdb-description-sha256 SHA256 --duckdb-workspace-id ORIGINAL_32_HEX_ID]\n' +
      'duckdb-register --dir ABS --description PRIVATE_ORIGINAL_DUCKDB_REGISTRATION_JSON\n' +
      'call --dir ABS --input REQUEST_JSON\n' +
      'objects-register --dir ABS --description ORIGINAL_S3_OBJECTS_JSON\n' +
      'datasets-register --dir ABS --description ORIGINAL_SF30_DATASET_DESCRIPTION_JSON\n' +
      'datasets-receive --dir ABS --id ID --room FINALIZED_ORIGINAL_SF100 [--session COMPLETE_ORIGINAL_SF88]\n' +
      'analysis-register --dir ABS --name ALIAS --database RUNNING_ORIGINAL_ANALYSIS_DIRECTORY\n' +
      'analysis-inbox-register --dir ABS --name ALIAS --inbox EXISTING_ORIGINAL_SF88_INBOX\n' +
      'collections-register --dir ABS --description PRIVATE_ORIGINAL_COLLECTION_REGISTRATION_JSON\n' +
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
  if (command === 'duckdb-register') {
    try { return print(await native.registerDuckDB(await input(v['--description'], 256 * 1024))); }
    finally { await native.close(); }
  }
  if (command === 'collections-register') {
    try { return print(await native.registerCollections(await input(v['--description'], 256 * 1024))); }
    finally { await native.close(); }
  }
  if (command === 'analysis-inbox-register') {
    try {
      if(!v['--name']||!v['--inbox'])fail('MCP_NATIVE_SOURCE_INBOX_REGISTRATION_REQUIRED');
      return print(await native.registerSourceInbox({name:v['--name'],inbox:v['--inbox']}));
    } finally {await native.close();}
  }
  if (command === 'analysis-register') {
    try {
      if (!v['--name'] || !v['--database']) fail('MCP_NATIVE_ANALYSIS_REGISTRATION_REQUIRED');
      return print(await native.registerAnalysis({name:v['--name'],database:v['--database']}));
    } finally {await native.close();}
  }
  if (command === 'datasets-receive') {
    try {
      if(!v['--id']||!v['--room'])fail('MCP_DATASET_RECEIVING_ARGUMENTS_REQUIRED');
      return print(await native.registerReceivedDataset({acquisitionId:v['--id'],room:v['--room'],
        session:v['--session']??null}));
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
      datasetAcquisitions:await native.call({action:'dataset-history',limit:25}),
      duckdbWorkspaces:await native.call({action:'duckdb',duckdbOperation:'workspaces'})}); }
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
  let nativeClosing, server;
  const closeNative = () => nativeClosing ??= native.close();
  try {
    const port = v['--port'] === undefined ? '3210' : v['--port'];
    if (!/^(0|[1-9][0-9]*)$/.test(port) || Number(port) > 65535) fail('MCP_NATIVE_PORT_INVALID');
    const descriptionFile = v['--duckdb-description'];
    const expectedWorkspaceId = v['--duckdb-workspace-id'];
    if ((expectedWorkspaceId !== undefined || v['--duckdb-description-sha256'] !== undefined) && !descriptionFile)
      fail('MCP_NATIVE_DUCKDB_DESCRIPTION_REQUIRED');
    if (expectedWorkspaceId !== undefined && !/^[a-f0-9]{32}$/.test(expectedWorkspaceId))
      fail('MCP_NATIVE_DUCKDB_WORKSPACE_ID_INVALID');
    let duckdb;
    if (descriptionFile) {
      if (!isAbsolute(descriptionFile) || resolve(descriptionFile) !== descriptionFile)
        fail('MCP_NATIVE_DUCKDB_DESCRIPTION_ABSOLUTE_REQUIRED');
      const description = await input(descriptionFile, 256 * 1024, v['--duckdb-description-sha256']);
      duckdb = await native.registerDuckDB(description, {expectedWorkspaceId});
    }
    // Serve this installed native owner. A retained generated operator.mjs may
    // still import an older source directory; it must not replace this instance.
    server = await startMcpWorkspace({environment:{...process.env,
      BAZAAR_DISCOVERY_URL:manifest.catalog.origin,
      PAID_RESOURCE_ORIGINS:manifest.route.origin,
      MCP_STATE_DIR:join(manifest.directory, 'quotes'),
      MCP_OPERATOR_MODULE:undefined, MCP_PORT:port},
      operatorAdapter:{
        agentCommerce:(args, context) => native.call(args, context),
        approve:async () => false,
        signPayment:async () => { fail('MCP_NATIVE_TOOL_REQUIRED'); },
        close:closeNative,
      }});
    const startup = {status:'NATIVE_MCP_LISTENING', url:server.address + '/mcp',
      tool:'sf43_discover_review_and_pay', originalWorkspace:manifest.workspace};
    if (duckdb) {
      // This private host announcement carries the original browser capability.
      // Model-facing DuckDB tool results never include this URL or host paths.
      process.stdout.write(JSON.stringify({
        schema:'stellar-forge.duckdb-agent-workspace-startup.v1', ...startup,
        directory:manifest.directory, descriptionFile,
        ...(v['--duckdb-description-sha256'] ? {descriptionSha256:v['--duckdb-description-sha256']} : {}),
        consoleUrl:server.consoleUrl,
        duckdb:{schema:duckdb.schema,status:duckdb.status,name:duckdb.name,
          workspaceId:duckdb.workspaceId,database:duckdb.database,browserUrl:duckdb.browserUrl,
          sourceCount:duckdb.sources.length},
      }) + '\n');
    } else print(startup);
  } catch (error) {
    try { if (server) await server.close(); else await closeNative(); }
    catch { /* preserve the original startup failure */ }
    throw error;
  }
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


