#!/usr/bin/env node
// MIT. Operate payment plans through the original accounting workspace and request journal.
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {resolve, isAbsolute, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from '../../workspace/store.mjs';
import {accountingWorkspaceBinding} from '../../workspace/binding.mjs';
import {PaymentPlanWorkspace, PAYMENT_PLAN_REQUEST_BYTES} from './store.mjs';
import {need, json, sha} from '../core.mjs';

const HELP = 'Merchant payment plans\n\n' +
  'starforge payment-plans serve --directory /private/accounting [--port 8448]\n' +
  'starforge payment-plans state --directory /private/accounting [--as-of YYYY-MM-DD] [--through YYYY-MM-DD] [--customer UUID]\n' +
  'starforge payment-plans detail --directory /private/accounting --id PLAN_UUID [--as-of YYYY-MM-DD]\n' +
  'starforge payment-plans generate --directory /private/accounting --input /private/generate.json\n' +
  'starforge payment-plans preview --directory /private/accounting --id PLAN_UUID\n' +
  'starforge payment-plans apply --directory /private/accounting --action save --input /private/save.json\n' +
  'starforge payment-plans apply --directory /private/accounting --action activate --id PLAN_UUID --input /private/activate.json\n' +
  'starforge payment-plans apply --directory /private/accounting --action cancel --id PLAN_UUID --input /private/cancel.json\n' +
  'starforge payment-plans operation --directory /private/accounting --request ORIGINAL_REQUEST_ID\n' +
  'starforge payment-plans file --directory /private/accounting --id PLAN_UUID --edition EDITION_UUID --name schedule.html --out /private/new-schedule.html\n' +
  'starforge payment-plans export --directory /private/accounting --out /private/new-collections [--as-of YYYY-MM-DD] [--through YYYY-MM-DD] [--customer UUID]\n\n' +
  'Every mutation carries revision, actor and its original stable requestId. An optional workspaceId binds the request to the original accounting directory.\n' +
  'Save JSON contains plan: {id?, invoiceId, balanceDate, title, reference, customerNote, installments: [{id?, dueDate, amount, label?}]}. Updates also carry expectedVersion.\n' +
  'Activation carries expectedVersion and the preview reviewSha256. Cancellation carries expectedVersion, cancelledDate and reason.\n' +
  'Generate JSON contains invoiceId, balanceDate, firstDueDate, count, intervalDays and optional title/reference/customerNote.\n' +
  'File formats: schedule.json, schedule.csv, schedule.html, manifest.json. Outputs are create-only.\n' +
  'For a new accounting directory, also pass --outbox DIRECTORY --proof-dir DIRECTORY --terms FILE. Reopen an initialized directory without replacing its source settings.\n';

const COMMANDS = new Set(['help','--help','serve','state','detail','generate','preview','apply','operation','file','export']);
const FLAGS = new Set(['directory','outbox','proof-dir','terms','recovered-dir','port','as-of','through','customer',
  'id','input','action','request','edition','name','out','expected-workspace-id','expected-sources-sha256']);
export function parsePaymentPlanArguments(argv) {
  const [command = 'help', ...rest] = argv, flags = {};
  need(COMMANDS.has(command), 'UNKNOWN_PAYMENT_PLAN_COMMAND', 'Choose a documented payment-plan command.');
  for (let i = 0; i < rest.length; i += 2) {
    need(/^--[a-z-]+$/.test(rest[i]) && FLAGS.has(rest[i].slice(2)) &&
      typeof rest[i + 1] === 'string' && !rest[i + 1].startsWith('--'),
      'INVALID_PAYMENT_PLAN_ARGUMENT', 'Use a documented option followed by its value.');
    const key = rest[i].slice(2);
    need(!Object.hasOwn(flags, key), 'DUPLICATE_PAYMENT_PLAN_ARGUMENT', 'Supply each option once.');
    flags[key] = rest[i + 1];
  }
  return {command, flags};
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && value === resolve(value) && value !== '/',
    'PAYMENT_PLAN_ABSOLUTE_PATH_REQUIRED', 'Use an absolute normalized ' + label + ' path.');
  return value;
}
async function readInput(path) {
  const handle = await open(absolute(path, 'request'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size > 0 && stat.size <= PAYMENT_PLAN_REQUEST_BYTES,
      'INVALID_PAYMENT_PLAN_INPUT', 'Choose one regular request file within the workspace request size.');
    const bytes = await handle.readFile();
    need(bytes.length === stat.size, 'PAYMENT_PLAN_INPUT_CHANGED', 'The request changed while it was being read.', 409);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { need(false, 'INVALID_PAYMENT_PLAN_JSON', 'Choose a complete UTF-8 JSON request.'); }
    need(value && !Array.isArray(value) && typeof value === 'object', 'INVALID_PAYMENT_PLAN_JSON', 'Use one JSON request object.');
    return value;
  } finally { await handle.close(); }
}
async function createOutput(path, bytes) {
  path = absolute(path, 'output');
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return {path, bytes: bytes.length, sha256: sha(bytes)};
}
export async function runPaymentPlansCli(argv = process.argv.slice(2)) {
  const {command, flags} = parsePaymentPlanArguments(argv);
  if (command === 'help' || command === '--help') { process.stdout.write(HELP); return; }
  const options = {directory: absolute(flags.directory, 'accounting workspace')};
  for (const [flag,key] of [['outbox','outboxDir'],['proof-dir','proofDir'],['terms','termsFile'],['recovered-dir','recoveredDir']])
    if (flags[flag]) options[key] = absolute(flags[flag], flag);
  if (flags['expected-workspace-id']) options.expectedWorkspaceId = flags['expected-workspace-id'];
  if (flags['expected-sources-sha256']) options.expectedSourcesSha256 = flags['expected-sources-sha256'];
  if (command === 'serve') {
    const port = Number(flags.port ?? 8448);
    need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INVALID_PAYMENT_PLAN_PORT', 'Choose a local port from zero to 65535.');
    const {createReceivablesServer} = await import('../server.mjs');
    const running = await createReceivablesServer({...options, port});
    const binding = accountingWorkspaceBinding(running.workspace.directory, running.workspace.state);
    const url = new URL('/payment-plans/', running.url).href;
    process.stdout.write(JSON.stringify({schema: 'stellar-forge.merchant-payment-plans-startup.v1',
      directory: running.workspace.directory, workspaceId: binding.workspaceId, sourcesSha256: binding.sourcesSha256, url}) + '\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await running.close(); };
    const onSignal = () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    return {...running, paymentPlansUrl: url};
  }
  const workspace = await openAccountingWorkspace(options);
  try {
    const plans = await new PaymentPlanWorkspace(workspace).init();
    const query = {asOf: flags['as-of'], through: flags.through, customerId: flags.customer};
    let result;
    if (command === 'state') result = await plans.state(query);
    else if (command === 'detail') result = await plans.detail(flags.id, query);
    else if (command === 'generate') result = await plans.generate(await readInput(flags.input));
    else if (command === 'preview') result = await plans.previewPlan(flags.id);
    else if (command === 'operation') result = await plans.getOperation(flags.request);
    else if (command === 'apply') {
      const value = await readInput(flags.input);
      if (flags.action === 'save') result = await plans.savePlan(value);
      else if (flags.action === 'activate') result = await plans.activate(flags.id, value);
      else if (flags.action === 'cancel') result = await plans.cancelPlan(flags.id, value);
      else need(false, 'UNKNOWN_PAYMENT_PLAN_ACTION', 'Choose save, activate or cancel.');
    } else if (command === 'file') {
      const file = await plans.scheduleFile(flags.id, flags.edition, flags.name);
      result = {...await createOutput(flags.out, file.bytes), type: file.type, planId: flags.id, editionId: flags.edition};
    } else if (command === 'export') {
      const output = absolute(flags.out, 'collections export'), parent = await lstat(dirname(output));
      need(parent.isDirectory() && !parent.isSymbolicLink(), 'INVALID_PAYMENT_PLAN_EXPORT_PARENT', 'Choose an existing output parent directory.');
      const bundle = await plans.collectionsFiles(query);
      await mkdir(output, {mode: 0o700});
      const files = [];
      for (const file of bundle.files) {
        need(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.name), 'INVALID_PAYMENT_PLAN_EXPORT_NAME', 'The collection export filename is invalid.');
        files.push({name: file.name, type: file.type, ...await createOutput(join(output, file.name), file.bytes)});
      }
      const manifest = {schema: 'stellar-forge.merchant-payment-plan-export.v1',
        workspaceId: bundle.workspaceId, revision: bundle.revision, asOf: bundle.report.asOf, through: bundle.report.through,
        customerId: bundle.report.customerId, files: files.map(({name,type,bytes,sha256}) => ({name,type,bytes,sha256}))};
      files.push({name: 'manifest.json', ...await createOutput(join(output, 'manifest.json'), Buffer.from(json(manifest)))});
      result = {directory: output, workspaceId: bundle.workspaceId, revision: bundle.revision,
        asOf: bundle.report.asOf, through: bundle.report.through, files};
    }
    process.stdout.write(json(result));
    return result;
  } finally { await workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runPaymentPlansCli().catch(error => {
    process.stderr.write(json({error: {code: error.code ?? 'PAYMENT_PLANS_FAILED', message: error.message}}));
    process.exitCode = 1;
  });
