#!/usr/bin/env node
// MIT. Xero document handovers use the original accounting workspace owner.
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {isAbsolute, join, resolve, dirname, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from '../../workspace/store.mjs';
import {accountingWorkspaceBinding} from '../../workspace/binding.mjs';
import {ReceivablesWorkspace} from '../store.mjs';
import {renderCustomerTar, json, need} from '../core.mjs';
import {XeroReceivablesWorkspace} from './store.mjs';

const REQUEST_BYTES = 32 * 1024 * 1024;
const COMMANDS = new Set(['serve', 'state', 'profile', 'preview', 'prepare', 'detail', 'receive', 'correct', 'file', 'export']);
const HELP = 'Xero customer invoice and credit handovers\n\n' +
  'starforge receivables-xero serve --directory /private/accounting [--port 8449]\n' +
  'starforge receivables-xero state --directory /private/accounting [--as-of YYYY-MM-DD]\n' +
  'starforge receivables-xero profile --directory /private/accounting --input /private/profile.json [--invoice-template /private/invoices.csv] [--credit-template /private/credits.csv]\n' +
  'starforge receivables-xero preview --directory /private/accounting --input /private/selection.json\n' +
  'starforge receivables-xero prepare --directory /private/accounting --input /private/reviewed-selection.json\n' +
  'starforge receivables-xero detail --directory /private/accounting --id UUID\n' +
  'starforge receivables-xero receive --directory /private/accounting --id UUID --input /private/receipt.json --file /private/Invoices.json --format NATIVE_JSON\n' +
  '  Use --format CSV_SUMMARY with an explicit mapped document-summary CSV.\n' +
  'starforge receivables-xero correct --directory /private/accounting --id UUID --input /private/reviewed-correction.json\n' +
  'starforge receivables-xero file --directory /private/accounting --id UUID --name invoices.csv --out /private/new-invoices.csv\n' +
  'starforge receivables-xero export --directory /private/accounting --id UUID --out /private/new-handover [--format directory|tar|json]\n\n' +
  'Mutation JSON includes revision, actor and a stable requestId. Profile updates also include expectedVersion.\n' +
  'Prepare and correct include previewSha256 from a successful preview of the same profile and documents.\n' +
  'File flags read the original source bytes into {name,dataBase64}; explicit result-column mappings remain in the request JSON.\n' +
  'The export path must be new. Directory exports retain every original template, document, result file and status record.\n' +
  'Use --expected-workspace-id and --expected-sources-sha256 to pin an existing workspace.\n' +
  'Initialization inputs, when needed: --outbox DIRECTORY --proof-dir DIRECTORY --terms FILE [--recovered-dir DIRECTORY].\n';

export function parseXeroReceivablesArguments(argv) {
  const [command = 'help', ...rest] = argv, flags = {};
  const known = new Set(['directory', 'outbox', 'proof-dir', 'terms', 'recovered-dir', 'port', 'as-of', 'id',
    'input', 'invoice-template', 'credit-template', 'file', 'name', 'out', 'format',
    'expected-workspace-id', 'expected-sources-sha256']);
  for (let i = 0; i < rest.length; i += 2) {
    need(/^--[a-z-]+$/.test(rest[i]) && known.has(rest[i].slice(2)) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--'),
      'INVALID_XERO_ARGUMENT', 'Use a documented option followed by its value.');
    const key = rest[i].slice(2);
    need(!Object.hasOwn(flags, key), 'DUPLICATE_XERO_ARGUMENT', 'Supply each option once.');
    flags[key] = rest[i + 1];
  }
  return {command, flags};
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && value === resolve(value) && value !== '/',
    'ABSOLUTE_PATH_REQUIRED', 'Use an absolute normalized ' + label + ' path.');
  return value;
}
async function readInput(path, label, maximum = REQUEST_BYTES) {
  const handle = await open(absolute(path, label), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size > 0 && stat.size <= maximum,
      'INVALID_XERO_INPUT', 'Select a nonempty regular input file within the request limit.');
    const bytes = await handle.readFile();
    need(bytes.length <= maximum, 'XERO_REQUEST_TOO_LARGE', 'The input exceeds the request limit.');
    return bytes;
  } finally { await handle.close(); }
}
async function requestInput(path) {
  let value;
  const bytes = await readInput(path, 'request');
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { need(false, 'INVALID_XERO_JSON', 'The request file must contain valid JSON.'); }
  need(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_XERO_JSON', 'The request must be a JSON object.');
  return value;
}
async function sourceFile(path, maximum) {
  return {name: basename(path), dataBase64: (await readInput(path, 'original source', maximum)).toString('base64')};
}
async function newFile(path, bytes) {
  path = absolute(path, 'output');
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
function requestSize(value) {
  need(Buffer.byteLength(JSON.stringify(value)) <= REQUEST_BYTES, 'XERO_REQUEST_TOO_LARGE',
    'The encoded request exceeds the request limit.');
}
export async function runXeroReceivablesCli(argv = process.argv.slice(2)) {
  const {command, flags} = parseXeroReceivablesArguments(argv);
  if (command === 'help' || command === '--help') { process.stdout.write(HELP); return; }
  need(COMMANDS.has(command), 'UNKNOWN_XERO_COMMAND', 'Choose a documented Xero handover command.');
  const options = {directory: absolute(flags.directory, 'accounting workspace')};
  for (const [flag, key] of [['outbox','outboxDir'], ['proof-dir','proofDir'], ['terms','termsFile'], ['recovered-dir','recoveredDir']])
    if (flags[flag]) options[key] = absolute(flags[flag], flag);
  if (flags['expected-workspace-id']) options.expectedWorkspaceId = flags['expected-workspace-id'];
  if (flags['expected-sources-sha256']) options.expectedSourcesSha256 = flags['expected-sources-sha256'];
  if (command === 'serve') {
    const port = Number(flags.port ?? 8449);
    need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INVALID_XERO_PORT', 'Use a local port from zero to 65535.');
    const {createXeroReceivablesServer} = await import('./server.mjs');
    const running = await createXeroReceivablesServer({...options, port});
    const binding = accountingWorkspaceBinding(running.workspace.directory, running.workspace.state);
    process.stdout.write(JSON.stringify({schema: 'stellar-forge.merchant-receivables-xero-startup.v1',
      directory: running.workspace.directory, workspaceId: binding.workspaceId, sourcesSha256: binding.sourcesSha256, url: running.url}) + '\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await running.close(); };
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
    return running;
  }
  const workspace = await openAccountingWorkspace(options);
  try {
    const receivables = await new ReceivablesWorkspace(workspace).init();
    const controller = await new XeroReceivablesWorkspace(receivables).init();
    let result;
    if (command === 'state') result = await controller.state({asOf: flags['as-of']});
    else if (command === 'detail') result = await controller.detail(flags.id);
    else if (['profile', 'preview', 'prepare', 'receive', 'correct'].includes(command)) {
      const value = await requestInput(flags.input);
      if (command === 'profile') {
        if (flags['invoice-template']) value.invoiceTemplate = await sourceFile(flags['invoice-template'], 256 * 1024);
        if (flags['credit-template']) value.creditTemplate = await sourceFile(flags['credit-template'], 256 * 1024);
      }
      if (command === 'receive') {
        if (flags.file) value.file = await sourceFile(flags.file, 8 * 1024 * 1024);
        if (flags.format) {
          need(['NATIVE_JSON', 'CSV_SUMMARY'].includes(flags.format), 'INVALID_XERO_RETURN_FORMAT', 'Choose NATIVE_JSON or CSV_SUMMARY.');
          value.format = flags.format;
        }
      }
      requestSize(value);
      if (command === 'profile') result = await controller.saveProfile(value);
      else if (command === 'preview') result = await controller.preview(value);
      else if (command === 'prepare') result = await controller.prepare(value);
      else if (command === 'receive') result = await controller.receive(flags.id, value);
      else result = await controller.correct(flags.id, value);
    } else if (command === 'file') {
      const selected = await controller.file(flags.id, flags.name);
      await newFile(flags.out, selected.bytes);
      result = {path: flags.out, name: selected.name, bytes: selected.bytes.length, type: selected.type};
    } else if (command === 'export') {
      const format = flags.format || 'directory';
      need(['directory', 'tar', 'json'].includes(format), 'INVALID_XERO_EXPORT_FORMAT', 'Choose directory, tar or json.');
      const output = absolute(flags.out, 'handover export'), bundle = await controller.export(flags.id);
      const names = new Set();
      for (const file of bundle.files) {
        need(typeof file.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.name) && !names.has(file.name),
          'INVALID_XERO_EXPORT_NAME', 'The handover export contains an invalid or repeated filename.');
        names.add(file.name);
      }
      if (format === 'tar') await newFile(output, renderCustomerTar(bundle.files));
      else if (format === 'json') await newFile(output, Buffer.from(json(bundle.value)));
      else {
        const parent = await lstat(dirname(output));
        need(parent.isDirectory() && !parent.isSymbolicLink(), 'INVALID_EXPORT_PARENT', 'Choose an existing output parent directory.');
        await mkdir(output, {mode: 0o700});
        for (const selected of bundle.files) await newFile(join(output, selected.name), selected.bytes);
      }
      result = {path: output, format, packageId: flags.id, files: bundle.files.map(file => ({name: file.name, bytes: file.bytes.length}))};
    }
    process.stdout.write(json(result)); return result;
  } finally { await workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runXeroReceivablesCli().catch(error => {
    process.stderr.write(json({error: {code: error.code ?? 'XERO_HANDOVER_FAILED', message: error.message}}));
    process.exitCode = 1;
  });
