#!/usr/bin/env node
// MIT. One operator entrypoint over the original accounting lease and receivables controller.
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {isAbsolute, join, resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {accountingWorkspaceBinding} from '../workspace/binding.mjs';
import {ReceivablesWorkspace, RECEIVABLE_REQUEST_BYTES} from './store.mjs';
import {json, need} from './core.mjs';

const HELP = 'Merchant receivables\n\n' +
  'starforge receivables serve --directory /private/accounting [--port 8448]\n' +
  'starforge receivables state --directory /private/accounting [--as-of YYYY-MM-DD]\n' +
  'starforge receivables detail --directory /private/accounting --id UUID [--as-of YYYY-MM-DD]\n' +
  'starforge receivables preview --directory /private/accounting --id UUID\n' +
  'starforge receivables ledger --directory /private/accounting --run UUID [--customer UUID] [--offset 0] [--limit 100]\n' +
  'starforge receivables apply --directory /private/accounting --action ACTION --input /private/request.json [--id UUID]\n' +
  'starforge receivables file --directory /private/accounting --id UUID --name invoice.html --out /private/new-file.html\n' +
  'starforge receivables export --directory /private/accounting --customer UUID --out /private/new-account-export [--as-of YYYY-MM-DD]\n\n' +
  'Actions: settings, customer, draft, import-quote, issue, credit, void-invoice, receipt, import-settlement, allocate, release, void-receipt.\n' +
  'Mutation JSON supplies the current revision, operator actor and a stable requestId. Draft updates also supply expectedVersion; issue supplies the reviewed previewSha256.\n' +
  'Reopen the initialized accounting directory. To initialize merchant accounting, also pass --outbox /private/outbox --proof-dir /private/proofs --terms /private/terms.json.\n';

export function parseReceivablesArguments(argv) {
  const [command = 'help', ...rest] = argv, flags = {};
  const known = new Set(['directory','outbox','proof-dir','terms','recovered-dir','port','as-of','id','run','customer','offset','limit','action','input','name','out','expected-workspace-id','expected-sources-sha256']);
  for (let i = 0; i < rest.length; i += 2) {
    need(/^--[a-z-]+$/.test(rest[i]) && known.has(rest[i].slice(2)) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--'),
      'INVALID_RECEIVABLES_ARGUMENT', 'Use a documented option followed by its value.');
    const key = rest[i].slice(2);
    need(!Object.hasOwn(flags, key), 'DUPLICATE_RECEIVABLES_ARGUMENT', 'Supply each option once.');
    flags[key] = rest[i + 1];
  }
  return {command, flags};
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && value === resolve(value) && value !== '/',
    'ABSOLUTE_PATH_REQUIRED', 'Use an absolute normalized ' + label + ' path.');
  return value;
}
async function input(path) {
  const handle = await open(absolute(path, 'request'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size > 0 && stat.size <= RECEIVABLE_REQUEST_BYTES, 'INVALID_RECEIVABLE_INPUT', 'Select one regular request JSON file within the request limit.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function newFile(path, bytes) {
  path = absolute(path, 'output');
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export async function runReceivablesCli(argv = process.argv.slice(2)) {
  const {command, flags} = parseReceivablesArguments(argv);
  if (command === 'help' || command === '--help') { process.stdout.write(HELP); return; }
  const options = {directory: absolute(flags.directory, 'accounting workspace')};
  for (const [flag, key] of [['outbox','outboxDir'], ['proof-dir','proofDir'], ['terms','termsFile'], ['recovered-dir','recoveredDir']])
    if (flags[flag]) options[key] = absolute(flags[flag], flag);
  if (flags['expected-workspace-id']) options.expectedWorkspaceId = flags['expected-workspace-id'];
  if (flags['expected-sources-sha256']) options.expectedSourcesSha256 = flags['expected-sources-sha256'];
  const asOf = flags['as-of'];
  if (command === 'serve') {
    const port = Number(flags.port ?? 8448);
    need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INVALID_RECEIVABLES_PORT', 'Use an available local port from zero to 65535.');
    const {createReceivablesServer} = await import('./server.mjs');
    const running = await createReceivablesServer({...options, port});
    const binding = accountingWorkspaceBinding(running.workspace.directory, running.workspace.state);
    process.stdout.write(JSON.stringify({schema: 'stellar-forge.merchant-receivables-startup.v1', directory: running.workspace.directory,
      workspaceId: binding.workspaceId, sourcesSha256: binding.sourcesSha256, url: running.url}) + '\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await running.close(); };
    process.once('SIGINT', () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
    process.once('SIGTERM', () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
    return running;
  }
  const workspace = await openAccountingWorkspace(options);
  try {
    const receivables = await new ReceivablesWorkspace(workspace).init();
    let result;
    if (command === 'state') result = await receivables.state({asOf});
    else if (command === 'detail') result = await receivables.detail(flags.id, {asOf});
    else if (command === 'preview') result = await receivables.preview(flags.id);
    else if (command === 'ledger') result = await receivables.ledger({runId: flags.run, customerId: flags.customer, offset: flags.offset, limit: flags.limit});
    else if (command === 'apply') {
      const value = await input(flags.input);
      const direct = {settings: 'settings', customer: 'saveCustomer', draft: 'saveDraft', 'import-quote': 'importQuote',
        receipt: 'receipt', 'import-settlement': 'importSettlement', allocate: 'allocate'};
      const selected = {issue: 'issue', credit: 'credit', 'void-invoice': 'voidInvoice', release: 'release', 'void-receipt': 'voidReceipt'};
      if (Object.hasOwn(direct, flags.action)) result = await receivables[direct[flags.action]](value);
      else if (Object.hasOwn(selected, flags.action)) result = await receivables[selected[flags.action]](flags.id, value);
      else need(false, 'UNKNOWN_RECEIVABLE_ACTION', 'Choose a documented mutation action.');
    } else if (command === 'file') {
      const file = await receivables.file(flags.id, flags.name);
      await newFile(flags.out, file.bytes);
      result = {path: flags.out, bytes: file.bytes.length, type: file.type};
    } else if (command === 'export') {
      const output = absolute(flags.out, 'customer export'), resultFiles = await receivables.exportCustomer(flags.customer, {asOf});
      const parent = await lstat(dirname(output));
      need(parent.isDirectory() && !parent.isSymbolicLink(), 'INVALID_EXPORT_PARENT', 'Choose an existing output parent directory.');
      await mkdir(output, {mode: 0o700}); // Exclusive directory prevents overwriting another export.
      for (const file of resultFiles.files) {
        need(/^(?:documents\/)?[A-Za-z0-9._-]+$/.test(file.name), 'INVALID_EXPORT_NAME', 'The original export filename is invalid.');
        if (file.name.startsWith('documents/')) await mkdir(join(output, 'documents'), {mode: 0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
        await newFile(join(output, file.name), file.bytes);
      }
      result = {directory: output, asOf: resultFiles.value.asOf, customerId: flags.customer,
        revision: resultFiles.revision, files: resultFiles.files.map(file => ({name: file.name, bytes: file.bytes.length}))};
    } else need(false, 'UNKNOWN_RECEIVABLES_COMMAND', 'Choose a documented receivables command.');
    process.stdout.write(json(result)); return result;
  } finally { await workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runReceivablesCli().catch(error => { process.stderr.write(json({error: {code: error.code ?? 'RECEIVABLES_FAILED', message: error.message}})); process.exitCode = 1; });
