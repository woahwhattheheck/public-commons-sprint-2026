#!/usr/bin/env node
// MIT. Native configuration, serving, recovery and original job commands.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readN8nConfiguration, fail } from './config.mjs';
import { prepareN8nMerchant, inspectN8nMerchant, createAutomationWorkflow } from './prepare.mjs';
import { writePrivate } from './store.mjs';
import { openN8nMerchant, serveN8nMerchant } from './merchant.mjs';
import { runJobCommand } from '../jobs/cli.mjs';

const HELP = `Starforge n8n automation merchant

  n8n-merchant review --input FILE
  n8n-merchant workflow --input FILE --function ID --child-workflow ID --out NEW_JSON
      [--header-credential ID] [--header-credential-name NAME]
  n8n-merchant prepare --input FILE --directory NEW_PRIVATE_DIRECTORY
  n8n-merchant inspect --directory DIRECTORY
  n8n-merchant serve --directory DIRECTORY [--native-factory MODULE] [--start-worker]
      [--seller-port N] [--customer-port N] [--operations-port N]
      [--operator-port N] [--jobs-operator-port N]
  n8n-merchant reconcile --directory DIRECTORY --job ID --revision N
      [--execution ID --reason TEXT]
  n8n-merchant rerun --directory DIRECTORY --job ID --revision N --job-revision N --reason TEXT
  n8n-merchant jobs --directory DIRECTORY -- ORIGINAL_JOB_COMMAND [ORIGINAL_ARGUMENTS]

Workflow export creates a new wrapper for an existing child whose Execute Workflow
Trigger accepts all data. Import it in n8n, select the original header credential,
publish it, and put its actual workflow ID and production URL in the input file.
Preparation fixes those selections in the original SF30 application source.

The serve process owns the native seller, settlement journal, worker, customer
endpoint and both private operator consoles. Other offline commands open the same
original directory after that process closes. Use the browser while it is running.
`;
const declarations = {
  review: ['input'], workflow: ['input', 'function', 'child-workflow', 'out', 'header-credential', 'header-credential-name'],
  prepare: ['input', 'directory'], inspect: ['directory'],
  serve: ['directory', 'native-factory', 'start-worker', 'seller-port', 'customer-port', 'operations-port', 'operator-port', 'jobs-operator-port'],
  reconcile: ['directory', 'job', 'revision', 'execution', 'reason'],
  rerun: ['directory', 'job', 'revision', 'job-revision', 'reason'], jobs: ['directory'],
};
function parse(argv) {
  const [command, ...args] = argv;
  if (!Object.hasOwn(declarations, command)) fail('COMMAND', 'Choose a command from --help.');
  const options = {}, remaining = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--' && command === 'jobs') { remaining.push(...args.slice(i + 1)); break; }
    if (!args[i].startsWith('--')) fail('COMMAND', 'Use named command options.');
    const key = args[i].slice(2);
    if (!declarations[command].includes(key) || Object.hasOwn(options, key)) fail('COMMAND', 'Unknown or repeated option: ' + args[i]);
    if (key === 'start-worker') { options[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) fail('COMMAND', 'Supply a value for --' + key + '.');
    options[key] = value;
  }
  return { command, options, remaining };
}
const required = (values, key) => values[key] ?? fail('COMMAND', 'Supply --' + key + '.');
function number(values, key, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (values[key] === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(values[key]) || !Number.isSafeInteger(Number(values[key])) || Number(values[key]) > maximum)
    fail('COMMAND', '--' + key + ' requires an integer from 0 to ' + maximum + '.');
  return Number(values[key]);
}
export async function runN8nMerchantCommand(argv = process.argv.slice(2), { print = value => console.log(value) } = {}) {
  if (!argv.length || argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) { print(HELP); return; }
  const { command, options, remaining } = parse(argv), emit = value => print(JSON.stringify(value, null, 2));
  if (command === 'review') {
    const source = await readN8nConfiguration(required(options, 'input'));
    return emit({ configurationSha256: source.configurationSha256, configuration: source.normalized,
      functions: Object.keys(source.jobs.functions) });
  }
  if (command === 'workflow') {
    const source = await readN8nConfiguration(required(options, 'input'));
    const workflow = createAutomationWorkflow(source.raw, { functionId: required(options, 'function'),
      childWorkflowId: required(options, 'child-workflow'), headerCredentialId: options['header-credential'],
      headerCredentialName: options['header-credential-name'] });
    const destination = resolve(required(options, 'out'));
    await writePrivate(destination, Buffer.from(JSON.stringify(workflow, null, 2) + '\n'));
    return emit({ file: destination, workflowName: workflow.name, nodes: workflow.nodes.length });
  }
  const directory = resolve(required(options, 'directory'));
  if (command === 'prepare') return emit(await prepareN8nMerchant({ directory, configPath: required(options, 'input') }));
  if (command === 'inspect') return emit(await inspectN8nMerchant(directory));
  if (command === 'jobs') {
    if (!remaining.length || remaining.some(arg => ['--config', '--state'].includes(arg)))
      fail('COMMAND', 'Supply the original job command after --; this merchant selects its configuration and state.');
    await inspectN8nMerchant(directory);
    return runJobCommand([remaining[0], '--config', join(directory, 'merchant.json'), '--state', join(directory, 'jobs'), ...remaining.slice(1)], { print });
  }
  if (command === 'serve') {
    const service = await serveN8nMerchant({ directory, nativeFactoryPath: options['native-factory'], startWorker: Boolean(options['start-worker']),
      sellerPort: number(options, 'seller-port', 0, 65535), customerPort: number(options, 'customer-port', 0, 65535),
      operationsPort: number(options, 'operations-port', 0, 65535), operatorPort: number(options, 'operator-port', 0, 65535),
      jobsOperatorPort: number(options, 'jobs-operator-port', 0, 65535) });
    let done, stopped = false;
    const wait = new Promise(resolve => { done = resolve; });
    const close = () => { if (stopped) return; stopped = true; service.close().then(done, error => {
      process.exitCode = 1; print(JSON.stringify({ code: error.code ?? 'JOB_AUTOMATION_CLOSE_FAILED' })); done();
    }); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
    emit({ service: 'starforge-n8n-merchant', directory, operator: service.url, seller: service.seller,
      customer: service.customer, operations: service.operations, jobsOperator: service.jobsOperator });
    try { await wait; } finally { process.off('SIGINT', close); process.off('SIGTERM', close); await service.close(); }
    return;
  }
  const merchant = await openN8nMerchant(directory);
  try {
    const id = required(options, 'job'), decision = { expectedRevision: number(options, 'revision', undefined),
      ...(options.reason ? { reason: options.reason } : {}) };
    if (command === 'reconcile') return emit(await merchant.reconcile(id, { ...decision,
      ...(options.execution ? { executionId: options.execution } : {}) }));
    return emit(await merchant.authorizeRerun(id, { ...decision, reason: required(options, 'reason'),
      jobRevision: number(options, 'job-revision', undefined) }));
  } finally { await merchant.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runN8nMerchantCommand().catch(error => { console.error(JSON.stringify({ code: error.code ?? 'JOB_AUTOMATION_COMMAND_FAILED', message: error.message })); process.exitCode = 1; });
}
