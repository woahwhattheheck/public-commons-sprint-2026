#!/usr/bin/env node
// MIT. Installed customer workflow for the original feed merchant provider.
import { parseArgs } from 'node:util';
import { open, lstat, link, unlink, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { openFeedsWorkspaceClient, createFeedsRequest, readFeedsRequest, writeFeedsRequest,
  retainFeedsRequest, inspectFeedsRequest, reopenFeedsDelivery } from './feeds-workspace-client.mjs';
import { actionKeys } from './catalog/feeds-workspace.mjs';
import { feedsClientJson, feedsClientFailure as fail, feedsClientInteger, readFeedsPrivateJson,
  writeFeedsPrivateFile, MAX_FEEDS_REQUEST_BYTES, MAX_FEEDS_RESPONSE_BYTES } from './feeds-workspace-request.mjs';
const TOOL_COMMANDS = Object.freeze({
  workspaces: 'merchant_feeds_workspaces', status: 'merchant_feeds_status', inventory: 'merchant_feeds_inventory',
  read: 'merchant_feeds_read', action: 'merchant_feeds_action', intake: 'merchant_feeds_intake',
  cancel: 'merchant_feeds_cancel', export: 'merchant_feeds_export', exports: 'merchant_feeds_exports',
  receive: 'merchant_feeds_receive', 'publisher-prepare': 'merchant_feeds_publisher_prepare',
  publishers: 'merchant_feeds_publishers', publisher: 'merchant_feeds_publisher',
  'publisher-export': 'merchant_feeds_publisher_export', manifest: 'merchant_feeds_download_manifest',
  file: 'merchant_feeds_download_file', 'file-release': 'merchant_feeds_download_file_release',
});
const NETWORK = ['url','workspace','token-env','timeout','results','response-bytes','output','quiet'];
const READ = ['input','kind','id','array','family','offset','limit','snapshot','query','state','revision'];
const GENERAL = ['input','record','wait','complete'];
const OPTIONS = Object.fromEntries([
  ...['url','workspace','token-env','timeout','results','response-bytes','output','input','kind','id','array','family','offset',
    'limit','snapshot','query','state','revision','record','complete','tool','request','reply','directory','export',
    'manifest-sha256','expected-endpoint','job','operation','poll','wait-ms','chunk-size','max-pages'].map(name => [name, { type: 'string' }]),
  ...['help','repeat','wait','quiet','all'].map(name => [name, { type: 'boolean' }]),
]);
export const FEEDS_WORKSPACE_CLIENT_HELP = String.raw`Usage: starforge feeds-workspace-client COMMAND [options]

Connection:
  --url URL --workspace ALIAS      Original HTTPS or loopback MCP endpoint
  --token-env NAME                 Bearer token environment variable (MCP_ACCESS_TOKEN)
  --timeout MS                    Per-request deadline (300000)
  --results PRIVATE_DIR           Complete result.json deliveries, one directory per export
  --response-bytes N               Original MCP response limit (2097152, maximum 67108864)
  --output PRIVATE_FILE           Create-only complete JSON output
  --quiet                         Omit progress on stderr

Original workspace:
  workspaces | status
  inventory --kind feeds|editions|subscription-sources|collections
  read --kind KIND --id ID [--family feed|collection] [--array ARRAY]
  register | capture | resume | apply | annotate | edition | query | compare
  collection-save | collection-capture | collection-resume | collection-edition
  action | intake | cancel | export | exports | receive
  publisher-prepare | publishers | publisher | publisher-export
  --input PRIVATE_JSON            Complete original tool arguments; native action commands
                                  take their inner input object
  --record PRIVATE_DIR             Save the exact request, invocation and original response
  --wait                          Await the accepted action/intake/receive job
  --complete PRIVATE_DIR           Receive a large original JSON result
  inventory/read/exports --all     Stream original pages as JSONL; optionally --output FILE
  --offset N --limit N --snapshot SHA256 [--max-pages N]
  Live captures/review/records/changes omit --snapshot and --array

Exact request and native continuation:
  prepare --url URL --workspace ALIAS --tool COMMAND --input JSON
          --request PRIVATE_FILE [--record PRIVATE_DIR] [--family FAMILY --operation ID]
  execute --request PRIVATE_FILE --record PRIVATE_DIR [--repeat]
  inspect-request --record PRIVATE_DIR
  reconcile --record PRIVATE_DIR [--results PRIVATE_DIR]
  wait --operation ID --family feed|collection [--job SHA256] [--poll MS] [--wait-ms MS]
  wait-job --job SHA256 [--poll MS] [--wait-ms MS]
  prepare and inspect-request are local. execute returns the saved response on reopen.
  --repeat explicitly resends that same saved request after original-state reconciliation.

Complete retained receiving:
  manifest --export SHA256
  inspect-delivery --export SHA256 [--manifest-sha256 SHA256]
  download --export SHA256 --directory PRIVATE_DIR [--manifest-sha256 SHA256] [--chunk-size N]
  export-download --input ORIGINAL_EXPORT_JSON --directory PRIVATE_DIR [--record PRIVATE_DIR]
  customer --input PRODUCT_OPERATION_CUSTOMER_JSON --directory PRIVATE_DIR [--record PRIVATE_DIR]
  resolve --reply ORIGINAL_TOOL_REPLY_JSON --directory PRIVATE_DIR
  reopen --workspace ALIAS --directory PRIVATE_DIR [--export SHA256] [--manifest-sha256 SHA256]
         [--expected-endpoint ORIGINAL_ENDPOINT]
  download resumes its existing directory. customer receives all four native acquisition files.
  reopen verifies every original completed file locally without a connection.

The original native console retains feed/collection work after a client disconnect.
Cancel explicitly with cancel --job ORIGINAL_RUNNING_JOB_SHA256.
Full workflow and original input examples: FEEDS_WORKSPACE_CLIENT.md
`;
function optionsFor(command) {
  if (command === 'help') return ['help'];
  if (command === 'prepare') return ['help','url','workspace','tool','input','request','record','family','operation','output','quiet'];
  if (command === 'inspect-request') return ['help','record','output','quiet'];
  if (command === 'reopen') return ['help','workspace','directory','export','manifest-sha256','expected-endpoint','output','quiet'];
  if (command === 'execute') return ['help',...NETWORK,'request','record','repeat'];
  if (command === 'reconcile') return ['help',...NETWORK,'record'];
  if (command === 'wait' || command === 'wait-job') return ['help',...NETWORK,'operation','family','job','poll','wait-ms'];
  if (command === 'download') return ['help',...NETWORK,'export','directory','manifest-sha256','chunk-size'];
  if (command === 'inspect-delivery') return ['help',...NETWORK,'export','manifest-sha256'];
  if (command === 'resolve') return ['help',...NETWORK,'reply','directory','chunk-size'];
  if (command === 'export-download' || command === 'customer') return ['help',...NETWORK,'input','directory','chunk-size','record'];
  if (['inventory','read','exports'].includes(command)) return ['help',...NETWORK,...READ,'complete','all','max-pages'];
  if (command === 'cancel') return ['help',...NETWORK,'input','job','record','complete'];
  if (command === 'manifest') return ['help',...NETWORK,'input','export'];
  if (Object.hasOwn(TOOL_COMMANDS, command) || Object.hasOwn(actionKeys, command)) return ['help',...NETWORK,...GENERAL];
  throw fail('FEEDS_CLI_COMMAND', 'Select an original feed client command; use --help.');
}
const required = (value, name) => {
  if (typeof value !== 'string' || !value) throw fail('FEEDS_CLI_ARGUMENT', 'Supply --' + name + '.');
  return value;
};
function number(value, fallback, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw fail('FEEDS_CLI_ARGUMENT', '--' + name + ' must be a decimal integer.');
  return feedsClientInteger(Number(value), minimum, maximum, '--' + name);
}
function endpoint(value) {
  let url;
  try { url = new URL(required(value, 'url')); } catch { throw fail('FEEDS_CLI_URL', 'Select the original HTTPS or loopback MCP URL.'); }
  if (url.username || url.password || url.search || url.hash ||
      url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','[::1]'].includes(url.hostname)))
    throw fail('FEEDS_CLI_URL', 'Use the original HTTPS or loopback endpoint and its token environment variable.');
  return url.href;
}
async function emit(stream, bytes) {
  await new Promise((accept, reject) => stream.write(bytes, error => error ? reject(error) : accept()));
}
function inputSelection(command, input) {
  if (Object.hasOwn(actionKeys, command)) return { tool: 'merchant_feeds_action', input: { action: command, input } };
  const tool = TOOL_COMMANDS[command] ?? (Object.values(TOOL_COMMANDS).includes(command) ? command : null);
  if (!tool) throw fail('FEEDS_CLI_TOOL', 'Select an original tool name or feed command.');
  return { tool, input };
}
function mergeArgument(input, name, value) {
  if (value === undefined) return;
  if (Object.hasOwn(input, name) && JSON.stringify(input[name]) !== JSON.stringify(value))
    throw fail('FEEDS_CLI_INPUT_CONFLICT', 'The saved input and --' + name + ' select different original values.');
  input[name] = value;
}
async function drain(close, stderr) {
  let reported = false;
  for (;;) {
    try { await close(); return; }
    catch (error) {
      if (!reported) {
        await emit(stderr, feedsClientJson({ code: error.code ?? 'FEEDS_CLIENT_CLOSE', message: error.message,
          state: 'DRAINING_ORIGINAL_OWNER' })).catch(() => {}); reported = true;
      }
      await pause(1000);
    }
  }
}
/** Stream complete native pages without retaining the whole collection in memory. */
async function pagesToOutput(pages, path, stdout, signal) {
  let handle, temporary, owned, count = 0, destination;
  if (path !== undefined) {
    destination = resolve(path); const parent = dirname(destination);
    if (await realpath(parent) !== parent) throw fail('FEEDS_CLI_OUTPUT', 'Use a canonical output parent.');
    try { await lstat(destination); throw fail('FEEDS_CLI_OUTPUT_EXISTS', 'The selected page output already exists.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    temporary = join(parent, '.feeds-pages-' + randomUUID());
    handle = await open(temporary, 'wx', 0o600);
    try { owned = await handle.stat({ bigint: true }); } catch (error) { await handle.close(); throw error; }
  }
  try {
    for await (const page of pages) {
      signal.throwIfAborted();
      // One bounded native page at a time; all large native source bytes have
      // already entered their own original retained result.json download.
      const bytes = feedsClientJson(page, 64 * 1024 * 1024);
      const line = Buffer.from(JSON.stringify(JSON.parse(bytes.toString('utf8'))) + '\n');
      if (handle) await handle.writeFile(line); else await emit(stdout, line);
      count++;
    }
    if (handle) {
      await handle.sync(); await link(temporary, destination);
      const directory = await open(dirname(destination), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return count;
  } finally {
    try { await handle?.close(); } finally {
      if (temporary && owned) {
        try { const current = await lstat(temporary, { bigint: true });
          if (current.dev === owned.dev && current.ino === owned.ino) await unlink(temporary);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
}
export async function runFeedsWorkspaceCli(argv = process.argv.slice(2),
  { environment = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  if (values.help || positionals[0] === 'help' || !positionals.length) { await emit(stdout, FEEDS_WORKSPACE_CLIENT_HELP); return 0; }
  if (positionals.length !== 1) throw fail('FEEDS_CLI_ARGUMENT', 'Use one original command and its named options.');
  const command = positionals[0], allowed = new Set(optionsFor(command));
  for (const name of Object.keys(values)) if (!allowed.has(name)) throw fail('FEEDS_CLI_ARGUMENT', '--' + name + ' does not belong to ' + command + '.');
  const controller = new AbortController(); let client, signalCode = 0, firstError, outputError;
  const stop = signal => {
    if (!signalCode) signalCode = signal === 'SIGINT' ? 130 : 143;
    controller.abort(fail('FEEDS_CLI_CANCELLED', 'The original client operation was interrupted.'));
    client?.requestClose();
  };
  const sigint = () => stop('SIGINT'), sigterm = () => stop('SIGTERM');
  const outputFailed = error => {
    outputError ??= error;
    controller.abort(outputError);
    client?.requestClose();
  };
  // Keep stream error ownership through the same client and file cleanup.
  // A write callback alone does not consume the stream's error event.
  const outputStreams = [...new Set([stdout, stderr])];
  for (const stream of outputStreams) stream.on('error', outputFailed);
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  const signal = controller.signal;
  const output = async result => {
    const bytes = feedsClientJson(result, 64 * 1024 * 1024);
    if (values.output) await writeFeedsPrivateFile(values.output, bytes, { maximum: 64 * 1024 * 1024 });
    else await emit(stdout, bytes);
  };
  const progress = async value => { if (!values.quiet) await emit(stderr, feedsClientJson(value)); };
  try {
    if (command === 'inspect-request') {
      await output(await inspectFeedsRequest({ directory: required(values.record, 'record'), signal })); return 0;
    }
    if (command === 'reopen') {
      await output(await reopenFeedsDelivery({ workspace: required(values.workspace, 'workspace'),
        directory: required(values.directory, 'directory'), exportId: values.export,
        expectedManifestSha256: values['manifest-sha256'], expectedEndpoint: values['expected-endpoint'], signal })); return 0;
    }
    let input = values.input ? await readFeedsPrivateJson(values.input, MAX_FEEDS_REQUEST_BYTES, { signal }) : {};
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw fail('FEEDS_CLI_INPUT', 'The original input file must contain a complete JSON object.');
    if (command === 'prepare') {
      const selected = inputSelection(required(values.tool, 'tool'), input);
      if (values.operation !== undefined && values.family === undefined)
        throw fail('FEEDS_CLI_ARGUMENT', '--operation in a prepared request requires its original --family.');
      const originalId = values.operation ?? selected.input.input?.operationId ?? selected.input.operationId;
      const request = createFeedsRequest({ endpoint: endpoint(values.url), workspace: required(values.workspace, 'workspace'),
        tool: selected.tool, input: selected.input, ...(values.family ? { recovery: {
          family: values.family, operationId: required(originalId, 'operation') } } : {}) });
      const saved = await writeFeedsRequest(required(values.request, 'request'), request);
      const record = values.record ? await retainFeedsRequest({ directory: values.record, request, signal }) : null;
      await output({ request, saved, record }); return 0;
    }
    let request, record;
    if (command === 'execute') request = await readFeedsRequest(required(values.request, 'request'), { signal });
    if (command === 'reconcile') { record = await inspectFeedsRequest({ directory: required(values.record, 'record'), signal }); request = record.request; }
    let reply;
    if (command === 'resolve') reply = await readFeedsPrivateJson(required(values.reply, 'reply'), MAX_FEEDS_RESPONSE_BYTES, { signal });
    const workspace = values.workspace ?? request?.workspace ?? reply?.workspace ?? (command === 'workspaces' ? 'discovery' : undefined);
    client = await openFeedsWorkspaceClient({ url: endpoint(values.url ?? request?.endpoint), workspace: required(workspace, 'workspace'),
      tokenEnv: values['token-env'], environment, signal, resultsDirectory: values.results,
      timeoutMs: number(values.timeout, 300000, 'timeout', 1, 2147483647),
      maximumResponseBytes: number(values['response-bytes'], 2097152, 'response-bytes', 1024, 67108864) });
    const options = { signal, resultsDirectory: values.results, onProgress: progress };
    const receiving = { directory: values.directory, expectedManifestSha256: values['manifest-sha256'],
      chunkSize: number(values['chunk-size'], undefined, 'chunk-size', 1, 196608), onProgress: progress };
    let result;
    if (command === 'execute') result = await client.execute(request, { directory: required(values.record, 'record'), repeat: values.repeat, signal });
    else if (command === 'reconcile') result = await client.reconcile({ ...options, directory: record.directory });
    else if (command === 'download') result = await client.downloadDelivery({ ...receiving,
      directory: required(values.directory, 'directory'), exportId: required(values.export, 'export') }, { signal });
    else if (command === 'inspect-delivery') result = await client.inspectDelivery({
      exportId: required(values.export, 'export'), expectedManifestSha256: values['manifest-sha256'] }, { signal });
    else if (command === 'resolve') result = await client.resolveResult(reply, { ...options,
      directory: required(values.directory, 'directory'), chunkSize: receiving.chunkSize });
    else if (command === 'wait' || command === 'wait-job') {
      const waitOptions = { ...options, pollMs: number(values.poll, 1000, 'poll', 250, 60000),
        maximumWaitMs: number(values['wait-ms'], 1800000, 'wait-ms', 1, 2147483647), onActivity: progress };
      result = command === 'wait-job' ? await client.waitForJob(required(values.job, 'job'), waitOptions)
        : await client.waitForOperation({ operationId: required(values.operation, 'operation'), family: values.family ?? 'feed', jobId: values.job }, waitOptions);
    } else {
      if (['inventory','read','exports'].includes(command)) {
        for (const [flag, key] of [['kind','kind'],['id','id'],['array','array'],['family','family'],['snapshot','expectedSnapshot'],
          ['query','query'],['state','state']]) mergeArgument(input, key, values[flag]);
        for (const key of ['offset','limit','revision']) mergeArgument(input, key,
          number(values[key], undefined, key, key === 'offset' ? 0 : 1, key === 'limit' ? 250 : Number.MAX_SAFE_INTEGER));
      }
      if (command === 'cancel') mergeArgument(input, 'jobId', values.job);
      if (command === 'manifest') mergeArgument(input, 'exportId', values.export);
      if (values.all) {
        const pageOptions = { ...options, resultsDirectory: values.results ?? values.complete, maxPages: number(values['max-pages'], undefined, 'max-pages', 1) };
        const pages = command === 'inventory' ? client.inventoryPages(input, pageOptions)
          : command === 'read' ? client.readPages(input, pageOptions) : client.exportPages(input, pageOptions);
        const count = await pagesToOutput(pages, values.output, stdout, signal);
        if (values.output) await progress({ state: 'PAGES_WRITTEN', output: resolve(values.output), pages: count });
        return 0;
      }
      if (values['max-pages'] !== undefined) throw fail('FEEDS_CLI_ARGUMENT', '--max-pages requires --all.');
      const download = command === 'export-download' || command === 'customer';
      const selected = inputSelection(command === 'export-download' ? 'export' : command === 'customer' ? 'publisher-export' : command,
        command === 'customer' ? { ...input, kind: 'customer' } : input);
      if (values.wait && !['merchant_feeds_action','merchant_feeds_intake','merchant_feeds_receive'].includes(selected.tool))
        throw fail('FEEDS_CLI_ARGUMENT', '--wait belongs to the original asynchronous action, intake or receive.');
      if (download) required(values.directory, 'directory');
      if (values.record) {
        const prepared = client.prepare(selected.tool, selected.input);
        const retained = await client.execute(prepared, { directory: values.record, signal });
        result = retained.response.result;
      } else result = await client.call(selected.tool, selected.input, { signal });
      if (download) {
        if (result.state !== 'MANIFEST_RETAINED' || command === 'customer' &&
            (result.kind !== 'publisher-customer' || result.files?.length !== 4 ||
              result.selection?.productId !== input.productId || result.selection?.id !== input.id))
          throw fail('FEEDS_CLI_EXPORT', 'Receive the original complete export and its selected customer identity.');
        const downloaded = await client.downloadDelivery({ ...receiving, exportId: result.exportId,
          expectedManifestSha256: result.manifestSha256 }, { signal });
        result = { workspace, exported: result, download: downloaded };
      } else if (values.wait) {
        const accepted = await client.resolveResult(result, { ...options,
          resultsDirectory: values.results ?? values.complete });
        if (!accepted.native?.id || !['RUNNING','DONE','FAILED'].includes(accepted.native.state))
          throw fail('FEEDS_CLI_NATIVE_JOB', 'The original console did not return an accepted native worker.');
        result = await client.waitForJob(accepted.native.id, { ...options,
          resultsDirectory: values.results ?? values.complete, onActivity: progress });
      } else if (values.complete && (Object.hasOwn(result, 'native') || result.completeResult))
        result = await client.resolveResult(result, { ...options, directory: values.complete });
    }
    await output(result); return 0;
  } catch (error) {
    firstError = error;
    await emit(stderr, feedsClientJson({ code: error.code ?? 'FEEDS_CLIENT_FAILED', message: error.message,
      ...(error.record ? { record: error.record } : {}) })).catch(() => {});
    return signalCode || 1;
  } finally {
    try {
      if (client) await drain(() => client.close(), stderr);
      else if (typeof firstError?.close === 'function') await drain(() => firstError.close(), stderr);
    } finally {
      process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
      for (const stream of outputStreams) stream.off('error', outputFailed);
    }
    if (signalCode || outputError) return signalCode || 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runFeedsWorkspaceCli().then(code => { process.exitCode = code; }, error => {
    process.stderr.write(JSON.stringify({ code: error.code ?? 'FEEDS_CLI_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
