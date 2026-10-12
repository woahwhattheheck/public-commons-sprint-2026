#!/usr/bin/env node
// MIT. Operate one retained Snowflake source through the original workspace.
import { realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedFile } from '../../sf46-release/release-core.mjs';
import { openSnowflakeWorkspace } from './workspace.mjs';
import { fault, integer } from './declaration.mjs';

export const HELP = `Stellar Forge | Snowflake retained data workspace

  init        --directory PRIVATE_DIR
  inspect     --directory PRIVATE_DIR
  serve       --directory PRIVATE_DIR [--port 0]
              [--source-root SOURCE_ROOT --expected-workspace-id UUID
               --expected-source-sha256 SHA256]
  source-save --directory PRIVATE_DIR --source SOURCE_JSON
  status      --directory PRIVATE_DIR [--request-id ORIGINAL_UUID]
  capture     --directory PRIVATE_DIR --query NAME [--input ARGUMENTS_JSON]
              [--request-id ORIGINAL_UUID]
  resume      --directory PRIVATE_DIR --request-id ORIGINAL_UUID
  cancel      --directory PRIVATE_DIR --request-id ORIGINAL_UUID
  receive     --directory PRIVATE_DIR --manifest ORIGINAL_RECEIVING_JSON
  list        --directory PRIVATE_DIR --kind sources|operations|editions|publications
              [--offset 0] [--limit 50]
  page        --directory PRIVATE_DIR --edition EDITION_ID [--offset 0] [--limit 50]
  compare     --directory PRIVATE_DIR --before EDITION_ID --after EDITION_ID [--limit 50]
  review      --directory PRIVATE_DIR --edition EDITION_ID
              --decision ACCEPTED|REJECTED --actor NAME --note TEXT [--compare EDITION_ID]
  export      --directory PRIVATE_DIR --edition EDITION_ID --out NEW_DIRECTORY
              [--cloud-scope ACTUAL_SCOPE_JSON]
  prepare     --directory PRIVATE_DIR --edition EDITION_ID --draft MERCHANT_DRAFT_JSON
              [--publication-id ORIGINAL_UUID] [--runtime RUNTIME_JSON] [--label TEXT]
  console     --directory PRIVATE_DIR [--port 0]

Run with: starforge snowflake COMMAND OPTIONS
Source checkout: node snowflake/cli.mjs COMMAND OPTIONS

The source JSON names existing host environment variables for the account origin
and OAuth, key-pair JWT or programmatic access token. Its warehouse, database,
schema and role are the existing case-sensitive context. Capture reads the saved
named query through Snowflake's original SQL API and retains every partition.
Original result strings and SQL nulls remain exact in the native SQLite edition.

Capture prints the retained request ID before dispatch. Resume uses that same
request ID, body and statement handle. Receiving imports the original files
without issuing another Snowflake query. The browser also receives complete
original folders with resumable partition uploads.

Review selects an exact edition for the original SQLite merchant workbench.
Prepare stages its native SF82 release. Console opens the existing activation,
rollback, seller, receiving and customer export interface.
publication --directory DIR --publication-id UUID reopens the saved merchant request.
resume-publication --directory DIR --publication-id UUID continues that request.
Keep foreground commands open; Ctrl-C closes their owned operation lifetimes.
`;
const COMMANDS = {
  init: ['directory'], inspect: ['directory'],
  serve: ['directory', 'port', 'source-root', 'expected-workspace-id', 'expected-source-sha256'],
  'source-save': ['directory', 'source'],
  status: ['directory', 'request-id'], capture: ['directory', 'query', 'input', 'request-id'],
  resume: ['directory', 'request-id'], cancel: ['directory', 'request-id'],
  receive: ['directory', 'manifest'], list: ['directory', 'kind', 'offset', 'limit'],
  page: ['directory', 'edition', 'offset', 'limit'], compare: ['directory', 'before', 'after', 'limit'],
  review: ['directory', 'edition', 'decision', 'actor', 'note', 'compare'],
  export: ['directory', 'edition', 'out', 'cloud-scope'],
  prepare: ['directory', 'edition', 'draft', 'publication-id', 'runtime', 'label'],
  publication: ['directory', 'publication-id'], 'resume-publication': ['directory', 'publication-id'], console: ['directory', 'port'],
};
const REQUIRED = { 'source-save': ['source'], capture: ['query'], resume: ['request-id'], cancel: ['request-id'],
  receive: ['manifest'], list: ['kind'], page: ['edition'], compare: ['before', 'after'],
  review: ['edition', 'decision', 'actor', 'note'], export: ['edition', 'out'], prepare: ['edition', 'draft'], publication: ['publication-id'], 'resume-publication': ['publication-id'] };
function options(args) {
  if (!args.length || args.some(value => ['--help', '-h', 'help'].includes(value))) return null;
  const [command, ...rest] = args, allowed = COMMANDS[command];
  if (!allowed || rest.length % 2) throw fault('SNOWFLAKE_COMMAND_INVALID', HELP);
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].slice(2), value = rest[i + 1];
    if (!rest[i].startsWith('--') || !allowed.includes(key) || Object.hasOwn(values, key) || !value)
      throw fault('SNOWFLAKE_OPTION_INVALID', 'Unknown, repeated or empty option: ' + rest[i]);
    values[key] = value;
  }
  for (const name of ['directory', ...(REQUIRED[command] ?? [])])
    if (!values[name]) throw fault('SNOWFLAKE_OPTION_REQUIRED', '--' + name + ' is required.');
  return { command, values };
}
async function jsonFile(filename, maximum = 1048576) {
  const path = resolve(filename), root = await realpath(dirname(path));
  const content = await boundedFile(root, path.slice(root.length + 1), maximum);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
}
function number(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw fault('SNOWFLAKE_OPTION_INVALID', 'Invalid --' + name);
  return integer(Number(value), minimum, maximum, name);
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
export async function main(args = process.argv.slice(2)) {
  const parsed = options(args);
  if (!parsed) { process.stdout.write(HELP); return; }
  const { command, values: o } = parsed, directory = resolve(o.directory);
  const port = () => number(o.port, 0, 0, 65535, 'port');
  if (command === 'inspect') {
    const { inspectSnowflakeWorkspace } = await import('./managed.mjs');
    const result = await inspectSnowflakeWorkspace(directory); print(result); return result;
  }
  if (command === 'serve') {
    const selection = ['source-root', 'expected-workspace-id', 'expected-source-sha256'];
    const managed = selection.some(name => o[name] !== undefined);
    if (managed && !selection.every(name => o[name]))
      throw fault('SNOWFLAKE_MANAGED_SELECTION_REQUIRED', 'Managed launch requires all reviewed source and workspace fields.');
    let session;
    if (managed) {
      const { startManagedSnowflakeWorkspace } = await import('./managed.mjs');
      session = await startManagedSnowflakeWorkspace({
        directory, port: port(), sourceRoot: resolve(o['source-root']),
        expectedWorkspaceId: o['expected-workspace-id'],
        expectedSourceSha256: o['expected-source-sha256'],
      });
      process.stdout.write(JSON.stringify(session.startup) + '\n');
    } else {
      const { startSnowflakeWorkspace } = await import('./server.mjs');
      session = await startSnowflakeWorkspace({ directory, port: port() });
      print({ workspace: session.url, directory });
    }
    const stop = () => session.close().catch(error => { console.error(error.message); process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return session;
  }
  const workspace = await openSnowflakeWorkspace({ directory });
  const stop = () => workspace.close().catch(() => { process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let retained = false;
  try {
    let result;
    const page = { offset: number(o.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset'),
      limit: number(o.limit, 50, 1, 200, 'limit') };
    switch (command) {
      case 'source-save': result = workspace.saveSource(await jsonFile(o.source)); break;
      case 'init': result = await workspace.state(); break;
      case 'status': result = o['request-id'] ? workspace.store.operation(o['request-id']) : await workspace.state(); break;
      case 'capture': {
        const operation = workspace.begin({ queryName: o.query, arguments: o.input ? await jsonFile(o.input) : {},
          ...(o['request-id'] ? { requestId: o['request-id'] } : {}) });
        process.stderr.write(JSON.stringify({ requestId: operation.requestId, status: operation.status }) + '\n');
        result = await workspace.continueOperation(operation.id); break;
      }
      case 'resume': result = await workspace.continueOperation(o['request-id']); break;
      case 'cancel': result = await workspace.cancel(o['request-id']); break;
      case 'receive': result = await workspace.receive(o.manifest); break;
      case 'list': result = workspace.store.list(o.kind, { offset: page.offset, pageSize: page.limit }); break;
      case 'page': result = await workspace.page(o.edition, page); break;
      case 'compare': result = await workspace.compare(o.before, o.after, { limit: page.limit }); break;
      case 'review': result = await workspace.review(o.edition, { decision: o.decision, actor: o.actor, note: o.note, comparisonId: o.compare ?? null }); break;
      case 'export': result = await workspace.exportOriginals(o.edition, resolve(o.out),
        { cloudDelivery: o['cloud-scope'] ? await jsonFile(o['cloud-scope']) : undefined }); break;
      case 'prepare': result = await workspace.prepareMerchant({ editionId: o.edition, draft: await jsonFile(o.draft),
        ...(o['publication-id'] ? { publicationId: o['publication-id'] } : {}),
        ...(o.runtime ? { runtime: await jsonFile(o.runtime) } : {}), ...(o.label ? { label: o.label } : {}) }); break;
      case 'publication':
        result = workspace.store.getPublication(o['publication-id']);
        if (!result) throw fault('SNOWFLAKE_PUBLICATION_UNKNOWN', undefined, 404);
        break;
      case 'resume-publication': result = await workspace.resumeMerchant(o['publication-id']); break;
      case 'console': result = await workspace.openReleaseConsole({ port: port() }); retained = true; break;
      default: throw fault('SNOWFLAKE_COMMAND_INVALID', HELP);
    }
    print(result);
    if (['capture', 'resume', 'receive', 'cancel'].includes(command) &&
        ['FAILED', 'REJECTED', 'AUTH_REQUIRED', 'RESULT_UNAVAILABLE', 'INTERRUPTED'].includes(result.status)) process.exitCode = 2;
    if (retained) return { ...result, workspace, close: () => workspace.close() };
    return result;
  } finally {
    if (!retained) {
      process.off('SIGINT', stop); process.off('SIGTERM', stop); await workspace.close();
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error: error.code ?? 'SNOWFLAKE_COMMAND_FAILED', detail: error.message })); process.exitCode = 1; });
