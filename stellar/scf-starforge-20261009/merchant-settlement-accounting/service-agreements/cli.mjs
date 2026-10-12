#!/usr/bin/env node
// MIT. The service calendar operates inside the original merchant accounting lease.
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {isAbsolute, resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {accountingWorkspaceBinding} from '../workspace/binding.mjs';
import {RECEIVABLE_REQUEST_BYTES} from '../receivables/store.mjs';
import {json, need, renderCustomerTar} from '../receivables/core.mjs';
import {ServiceAgreementWorkspace} from './store.mjs';

const HELP = 'Merchant service agreements\n\n' +
  'starforge service-agreements serve --directory /private/accounting [--port 8449]\n' +
  'starforge service-agreements state --directory /private/accounting [--as-of YYYY-MM-DD]\n' +
  'starforge service-agreements detail --directory /private/accounting --id UUID [--as-of YYYY-MM-DD]\n' +
  'starforge service-agreements preview --directory /private/accounting --id UUID --period p-0-3 [--as-of YYYY-MM-DD]\n' +
  'starforge service-agreements apply --directory /private/accounting --action create|amend|renew|cancel|bill --input /private/request.json [--id UUID]\n' +
  'starforge service-agreements source --directory /private/accounting --id UUID --source UUID --name quote.json --out /private/original-quote.json\n' +
  'starforge service-agreements export --directory /private/accounting --id UUID --out /private/new-export [--format directory|tar|json|csv|html] [--as-of YYYY-MM-DD]\n\n' +
  'Create and amend requests contain the original accepted SF74 quoteContent and responseContent strings, existing accounting customerId, and explicit monthly terms. Every mutation supplies revision, actor and stable requestId; amendments, renewal, cancellation and billing also supply expectedVersion.\n' +
  'Bill prepares one original receivables draft for the reviewed periodId and previewSha256. Issue the reviewed invoice from the linked Receivables workspace. Retain the original request after an uncertain outcome; preview returns recoveryRequest for a prepared period.\n' +
  'To initialize merchant accounting also supply --outbox /private/outbox --proof-dir /private/proofs --terms /private/terms.json. Existing merchant buyer startup directories can be reopened directly. The original accounting backup and restore include the service calendar and retained source files.\n';

export function parseServiceAgreementsArguments(argv) {
  const [command = 'help', ...rest] = argv, flags = {};
  const known = new Set(['directory','outbox','proof-dir','terms','recovered-dir','port','as-of','id','period',
    'action','input','source','name','out','format','expected-workspace-id','expected-sources-sha256']);
  for (let i = 0; i < rest.length; i += 2) {
    need(/^--[a-z-]+$/.test(rest[i]) && known.has(rest[i].slice(2)) &&
      rest[i + 1] !== undefined && !rest[i + 1].startsWith('--'),
      'INVALID_SERVICE_AGREEMENT_ARGUMENT', 'Use a documented option followed by its value.');
    const key = rest[i].slice(2);
    need(!Object.hasOwn(flags, key), 'DUPLICATE_SERVICE_AGREEMENT_ARGUMENT', 'Supply each option once.');
    flags[key] = rest[i + 1];
  }
  return {command, flags};
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && value === resolve(value) && value !== '/',
    'ABSOLUTE_PATH_REQUIRED', 'Use an absolute normalized ' + label + ' path.');
  return value;
}
async function readInput(path) {
  const handle = await open(absolute(path, 'request'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size > 0 && stat.size <= RECEIVABLE_REQUEST_BYTES,
      'INVALID_SERVICE_AGREEMENT_INPUT', 'Select one regular request JSON file within the request limit.');
    try { return JSON.parse(await handle.readFile('utf8')); }
    catch (error) {
      if (error instanceof SyntaxError) need(false, 'INVALID_REQUEST_JSON', 'The request file must contain valid JSON.');
      throw error;
    }
  } finally { await handle.close(); }
}
async function newFile(path, bytes) {
  path = absolute(path, 'output');
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export async function runServiceAgreementsCli(argv = process.argv.slice(2)) {
  const {command, flags} = parseServiceAgreementsArguments(argv);
  if (command === 'help' || command === '--help') { process.stdout.write(HELP); return; }
  const options = {directory: absolute(flags.directory, 'accounting workspace')};
  for (const [flag, key] of [['outbox','outboxDir'], ['proof-dir','proofDir'], ['terms','termsFile'], ['recovered-dir','recoveredDir']])
    if (flags[flag]) options[key] = absolute(flags[flag], flag);
  if (flags['expected-workspace-id']) options.expectedWorkspaceId = flags['expected-workspace-id'];
  if (flags['expected-sources-sha256']) options.expectedSourcesSha256 = flags['expected-sources-sha256'];
  const asOf = flags['as-of'];
  if (command === 'serve') {
    const port = Number(flags.port ?? 8449);
    need(Number.isInteger(port) && port >= 0 && port <= 65535,
      'INVALID_SERVICE_AGREEMENT_PORT', 'Use an available local port from zero to 65535.');
    const {createServiceAgreementsServer} = await import('./server.mjs');
    const running = await createServiceAgreementsServer({...options, port});
    const binding = accountingWorkspaceBinding(running.workspace.directory, running.workspace.state);
    process.stdout.write(JSON.stringify({schema: 'stellar-forge.merchant-service-agreements-startup.v1',
      directory: running.workspace.directory, workspaceId: binding.workspaceId,
      sourcesSha256: binding.sourcesSha256, url: running.url}) + '\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await running.close(); };
    process.once('SIGINT', () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
    process.once('SIGTERM', () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
    return running;
  }
  const workspace = await openAccountingWorkspace(options);
  try {
    const agreements = await new ServiceAgreementWorkspace(workspace).init();
    let result;
    if (command === 'state') result = await agreements.state({asOf});
    else if (command === 'detail') result = await agreements.detail(flags.id, {asOf});
    else if (command === 'preview') result = await agreements.preview(flags.id, {periodId: flags.period, asOf});
    else if (command === 'apply') {
      const value = await readInput(flags.input);
      if (flags.action === 'create') result = await agreements.create(value);
      else if (['amend','renew','cancel','bill'].includes(flags.action)) result = await agreements[flags.action](flags.id, value);
      else need(false, 'UNKNOWN_SERVICE_AGREEMENT_ACTION', 'Choose create, amend, renew, cancel or bill.');
    } else if (command === 'source') {
      const file = await agreements.sourceFile(flags.id, flags.source, flags.name);
      await newFile(flags.out, file.bytes);
      result = {path: flags.out, bytes: file.bytes.length, type: file.type};
    } else if (command === 'export') {
      const output = absolute(flags.out, 'agreement export'), format = flags.format ?? 'directory';
      need(['directory','tar','json','csv','html'].includes(format), 'INVALID_EXPORT_FORMAT', 'Choose directory, tar, json, csv or html.');
      const exported = await agreements.exportAgreement(flags.id, {asOf});
      if (format === 'directory') {
        const parent = await lstat(dirname(output));
        need(parent.isDirectory() && !parent.isSymbolicLink(), 'INVALID_EXPORT_PARENT', 'Choose an existing output parent directory.');
        await mkdir(output, {mode: 0o700});
        for (const file of exported.files) {
          need(/^[A-Za-z0-9._-]+$/.test(file.name), 'INVALID_EXPORT_NAME', 'The original export filename is invalid.');
          await newFile(join(output, file.name), file.bytes);
        }
        result = {directory: output, workspaceId: exported.workspaceId, revision: exported.revision,
          agreementId: flags.id, asOf: exported.value.asOf,
          files: exported.files.map(file => ({name: file.name, bytes: file.bytes.length}))};
      } else {
        const names = {json: 'agreement.json', csv: 'schedule.csv', html: 'agreement.html'};
        const bytes = format === 'tar' ? renderCustomerTar(exported.files) : exported.files.find(file => file.name === names[format]).bytes;
        await newFile(output, bytes);
        result = {path: output, format, bytes: bytes.length, workspaceId: exported.workspaceId,
          revision: exported.revision, agreementId: flags.id, asOf: exported.value.asOf};
      }
    } else need(false, 'UNKNOWN_SERVICE_AGREEMENT_COMMAND', 'Choose a documented service-agreements command.');
    process.stdout.write(json(result)); return result;
  } finally { await workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runServiceAgreementsCli().catch(error => {
    process.stderr.write(json({error: {code: error.code ?? 'SERVICE_AGREEMENT_FAILED', message: error.message,
      ...(error.details === undefined ? {} : {details: error.details}),
      ...(error.reopenRequired ? {reopenRequired: true} : {})}}));
    process.exitCode = 1;
  });
