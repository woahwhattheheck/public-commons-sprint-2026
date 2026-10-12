#!/usr/bin/env node
// MIT. Original workspace operations with an Intrinio customer workflow.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createIntrinioWorkspace, openIntrinioWorkspace, importIntrinioWorkspace,
  startIntrinioWorkspace, writeNewOutput } from './workspace.mjs';

const HELP = [
  'Intrinio retained statement review', '',
  '  node cli.mjs create --workspace NEW_DIR [--config MERCHANT_JSON] [--python PYTHON] [--label NAME]',
  '  node cli.mjs serve --workspace DIR [--port 0]',
  '  node cli.mjs state --workspace DIR [--revision REVISION_ID]',
  '  node cli.mjs import-capture --workspace DIR --manifest MANIFEST --actor NAME [--operation ID] [--expected-head ID]',
  '  node cli.mjs inspect --workspace DIR --edition ID [--offset 0] [--limit 50] [--search TEXT] [--review-status all]',
  '  node cli.mjs compare --workspace DIR --left ID --right ID [--mode revision|period] [--changes-only true|false]',
  '  node cli.mjs review --workspace DIR --command REVIEW_JSON',
  '  node cli.mjs bind-comparison --workspace DIR --command BINDING_JSON',
  '  node cli.mjs build --workspace DIR [--edition ORIGINAL_EDITION_ID]',
  '  node cli.mjs select --workspace DIR --command SELECTION_JSON',
  '  node cli.mjs export-selection --workspace DIR --selection ID --format json|csv|html --out NEW_FILE',
  '  node cli.mjs preview --workspace DIR --id ORIGINAL_PREVIEW_ID',
  '  node cli.mjs output --workspace DIR --id ORIGINAL_PREVIEW_ID --out NEW_FILE',
  '  node cli.mjs export-workspace --workspace DIR --out NEW_FILE',
  '  node cli.mjs import-workspace --workspace NEW_DIR --bundle ORIGINAL_EXPORT',
  '  node cli.mjs restore-revision --workspace DIR --revision ID --expected-head ID', '',
  'Original saved source, previews and full portable recovery remain in the SF30',
  'Python workspace. No provider request, wallet, payment or seller starts here.',
  'Review/selection command formats are in README.md. Output files are create-only.', '',
].join('\n');
const OPTION_NAMES = new Set(['workspace', 'config', 'python', 'label', 'port', 'revision', 'manifest', 'actor', 'operation',
  'expected-head', 'edition', 'offset', 'limit', 'search', 'review-status', 'left', 'right', 'mode', 'changes-only',
  'command', 'selection', 'format', 'out', 'id', 'bundle', 'binding', 'external-custody', 'managed-selection', 'help']);
function argumentsFor(argv) {
  const [command = 'help', ...rest] = argv, options = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (!key.startsWith('--') || !OPTION_NAMES.has(key.slice(2)) || Object.hasOwn(options, key.slice(2)))
      throw new Error('Unknown or repeated option: ' + key);
    if (key === '--help') { options.help = true; continue; }
    const value = rest[++index];
    if (value === undefined || value.startsWith('--')) throw new Error('Missing value for ' + key);
    options[key.slice(2)] = value;
  }
  return {command, options};
}
function required(options, key) {
  if (!options[key]) throw new Error('Supply --' + key);
  return options[key];
}
function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Expected a nonnegative integer.');
  return Number(value);
}
async function commandFile(path) {
  const raw = await readFile(resolve(path));
  if (raw.length > 524288) throw new Error('The complete command exceeds the original 512 KiB preview input limit.');
  const value = JSON.parse(raw.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The command must be a JSON object.');
  return value;
}
function write(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
export async function main(argv = process.argv.slice(2)) {
  const {command, options} = argumentsFor(argv);
  if (command === 'help' || command === '--help' || command === '-h' || options.help) { process.stdout.write(HELP); return; }
  if (options['managed-selection'] !== undefined && command !== 'serve')
    throw new Error('--managed-selection belongs to the original serve command.');
  const directory = resolve(required(options, 'workspace'));
  if (command === 'serve') {
    let server;
    if (options['managed-selection'] !== undefined) {
      if (Buffer.byteLength(options['managed-selection']) > 65536)
        throw new Error('Managed selection exceeds 64 KiB.');
      const { startManagedIntrinioWorkspace } = await import('./managed.mjs');
      server = await startManagedIntrinioWorkspace(directory, {
        selection: JSON.parse(options['managed-selection']), port: integer(options.port, 0),
      });
      process.stdout.write(JSON.stringify(server.startup) + '\n');
    } else {
      server = await startIntrinioWorkspace(directory, {port: integer(options.port, 0)});
      write({operatorUrl: server.operatorUrl, nativeOperatorUrl: server.nativeOperatorUrl, workspace: directory});
    }
    let closing;
    const close = () => { closing ??= server.close(); return closing; };
    const stop = () => { close().catch(() => {}); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try { await server.closed; }
    finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return;
  }
  let workspace;
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Caller interrupted the original native operation.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'create') {
      workspace = await createIntrinioWorkspace(directory, {config: options.config, python: options.python, label: options.label});
      write(await workspace.state()); return;
    }
    if (command === 'import-workspace') {
      workspace = await importIntrinioWorkspace(directory, resolve(required(options, 'bundle')));
      write(await workspace.state()); return;
    }
    workspace = await openIntrinioWorkspace(directory);
    const preview = (name, input) => workspace.preview(name, input, {
      revisionId: options.revision, operationId: options.operation ?? command + '-' + randomUUID(), signal: controller.signal,
    });
    switch (command) {
      case 'state': write(await workspace.state(options.revision)); break;
      case 'import-capture':
        write(await workspace.importCapture(required(options, 'manifest'), {actor: required(options, 'actor'),
          operationId: options.operation, expectedHead: options['expected-head'], externalCustody: options['external-custody']})); break;
      case 'inspect':
        write(await preview('inspect_statement', {edition_id: required(options, 'edition'), offset: integer(options.offset, 0),
          limit: integer(options.limit, 50), search: options.search ?? '', review_status: options['review-status'] ?? 'all'})); break;
      case 'compare':
        if (options['changes-only'] !== undefined && !['true', 'false'].includes(options['changes-only'])) throw new Error('--changes-only must be true or false.');
        write(await preview('compare_statements', {left_id: required(options, 'left'), right_id: required(options, 'right'),
          mode: options.mode ?? 'revision', changes_only: options['changes-only'] !== 'false',
          offset: integer(options.offset, 0), limit: integer(options.limit, 50), ...(options.binding ? {binding_id: options.binding} : {})})); break;
      case 'build': write(await preview('build_fundamentals', options.edition ? {edition_id: options.edition} : {})); break;
      case 'bind-comparison': write(await workspace.bindComparison(await commandFile(required(options, 'command')), {signal: controller.signal})); break;
      case 'review': write(await workspace.review(await commandFile(required(options, 'command')), {signal: controller.signal})); break;
      case 'select': write(await workspace.select(await commandFile(required(options, 'command')), {signal: controller.signal})); break;
      case 'export-selection':
        write(await workspace.exportSelection(required(options, 'selection'), required(options, 'format'), required(options, 'out'),
          {operationId: options.operation, revisionId: options.revision, signal: controller.signal})); break;
      case 'preview': write(await workspace.native.previewDetail(required(options, 'id'))); break;
      case 'output': {
        const result = await workspace.native.previewOutput(required(options, 'id'));
        await writeNewOutput(required(options, 'out'), result.bytes);
        write({path: resolve(options.out), bytes: result.bytes.length, sha256: result.sha256, previewId: options.id}); break;
      }
      case 'export-workspace': write(await workspace.exportWorkspace(required(options, 'out'))); break;
      case 'restore-revision':
        write(await workspace.native.restore({revisionId: required(options, 'revision'),
          expectedHead: required(options, 'expected-head'), note: 'Restored the selected Intrinio source and review revision'})); break;
      default: throw new Error('Unknown command: ' + command);
    }
  } finally {
    await workspace?.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({error: error.code ?? 'INTRINIO_CLI', message: error.message,
      ...(error.preview ? {preview: error.preview} : {})}) + '\n');
    process.exitCode = 1;
  });
