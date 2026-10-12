#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createCustomer, openCustomer, customerSummary, backupCustomer, restoreCustomer,
  createAgentRequest, customerLaunchArguments, archiveOperation } from './workspace.mjs';

const HELP = `Finance reconciliation customer workspace

  create --directory NEW_PRIVATE_DIRECTORY --name CUSTOMER --peer APPROVED_CALLER_HEX
         [--profile PROFILE_JSON] [--adopt-service ORIGINAL_SERVICE]
         [--adopt-provider ORIGINAL_PROVIDER_ROOT] [--adopt-agx-home ORIGINAL_AGX_HOME]
         [--max-input-bytes N] [--max-report-bytes N] [--timeout-ms N] [--max-heap-mib N]
  open --directory CUSTOMER_DIRECTORY [--port N]
  status --directory CUSTOMER_DIRECTORY
  request --directory CUSTOMER_DIRECTORY --job JOB_ID --out PRIVATE_REQUEST_JSON
  backup --directory CUSTOMER_DIRECTORY --out NEW_PRIVATE_BACKUP_ZIP
  verify --archive PRIVATE_BACKUP_ZIP [--sha256 ORIGINAL_ARCHIVE_SHA256]
  restore --archive PRIVATE_BACKUP_ZIP --directory NEW_PRIVATE_DIRECTORY
          [--sha256 ORIGINAL_ARCHIVE_SHA256]
  agent --directory CUSTOMER_DIRECTORY -- ORIGINAL_AGX_CLI_ARGUMENTS
  serve-agent --directory CUSTOMER_DIRECTORY [--profile PROVIDER_PROFILE]

create installs one approved peer's retained customer service. Adoption copies
that existing service and its complete history into the new installation.
open launches the maintained browser against that same service and saved profile.
backup captures the whole customer workspace; restore requires a new destination.
request authorizes the already retained job and engine for that approved caller.
agent runs the pinned published AGX CLI using this customer's private AGX home.
serve-agent uses the same provider root, bindings, jobs and saved AGX identity.

Linux, Node.js 22.12+, Python 3 and flock are required. Install the pinned AGX
dependencies from ../agx when configuring or serving the remote agent.
`;
const fields = {
  create: ['directory', 'name', 'peer', 'profile', 'adopt-service', 'adopt-provider',
    'adopt-agx-home', 'max-input-bytes', 'max-report-bytes', 'timeout-ms', 'max-heap-mib'],
  open: ['directory', 'port'], status: ['directory'], request: ['directory', 'job', 'out'],
  backup: ['directory', 'out'], verify: ['archive', 'sha256'],
  restore: ['archive', 'directory', 'sha256'], agent: ['directory'],
  'serve-agent': ['directory', 'profile'],
};
const fail = code => { throw Object.assign(new Error(code), { code }); };
const here = dirname(fileURLToPath(import.meta.url));
function parse() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['--help', 'help'].includes(command)) return { help: true };
  if (!Object.hasOwn(fields, command)) fail('UNKNOWN_COMMAND');
  const values = {}, forwarded = [];
  for (let i = 0; i < args.length; i++) {
    if (command === 'agent' && args[i] === '--') { forwarded.push(...args.slice(i + 1)); break; }
    const key = args[i].startsWith('--') ? args[i].slice(2) : '';
    if (!fields[command].includes(key) || Object.hasOwn(values, key)) fail('INVALID_ARGUMENT');
    const value = args[++i];
    if (typeof value !== 'string' || !value || value.startsWith('--')) fail('ARGUMENT_VALUE_REQUIRED');
    values[key] = value;
  }
  return { command, values, forwarded };
}
function required(values, name) {
  if (typeof values[name] !== 'string' || !values[name]) fail('MISSING_' + name.toUpperCase().replaceAll('-', '_'));
  return values[name];
}
async function foreground(args, env = {}) {
  const child = spawn(process.execPath, args, { stdio: 'inherit',
    env: { ...process.env, ...env } });
  const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise((yes, no) => {
      child.once('error', no); child.once('close', code => yes(code ?? 1));
    });
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
}
async function nativeAgx() {
  const local = createRequire(new URL('../agx/package.json', import.meta.url));
  let packageFile;
  try { packageFile = local.resolve('@nostr-agx/cli/package.json'); }
  catch { fail('PINNED_AGX_DEPENDENCIES_REQUIRED'); }
  const config = JSON.parse(await readFile(packageFile, 'utf8'));
  if (config.version !== '0.3.0') fail('PINNED_AGX_VERSION_REQUIRED');
  return join(dirname(packageFile), 'dist', 'agx.js');
}
async function main() {
  process.umask(0o077);
  const { help, command, values: v, forwarded } = parse();
  if (help) { process.stdout.write(HELP); return; }
  let output;
  if (command === 'create') {
    if (v['adopt-service'] && v['adopt-provider']) fail('SELECT_ONE_ORIGINAL_SERVICE');
    const limits = {};
    for (const [flag, field] of [['max-input-bytes', 'maxInputBytes'],
      ['max-report-bytes', 'maxReportBytes'], ['timeout-ms', 'timeoutMs'], ['max-heap-mib', 'maxHeapMiB']]) {
      if (v[flag] !== undefined) {
        if (!/^[1-9][0-9]*$/.test(v[flag])) fail('INVALID_LIMIT');
        limits[field] = Number(v[flag]);
      }
    }
    const customer = await createCustomer({ directory: required(v, 'directory'),
      name: required(v, 'name'), peer: required(v, 'peer'), profile: v.profile,
      adoptService: v['adopt-service'], adoptProvider: v['adopt-provider'],
      adoptAgxHome: v['adopt-agx-home'], limits });
    output = await customerSummary(customer.root);
  } else if (command === 'status') output = await customerSummary(required(v, 'directory'));
  else if (command === 'backup') output = await backupCustomer({
    directory: required(v, 'directory'), destination: required(v, 'out') });
  else if (command === 'restore') output = await restoreCustomer({
    directory: required(v, 'directory'), archive: required(v, 'archive'), sha256: v.sha256 });
  else if (command === 'verify') {
    const args = ['verify', '--archive', required(v, 'archive')];
    if (v.sha256) args.push('--sha256', v.sha256);
    output = await archiveOperation(args);
  } else if (command === 'request') output = await createAgentRequest({
    directory: required(v, 'directory'), jobId: required(v, 'job'), destination: required(v, 'out') });
  else {
    const customer = await openCustomer(required(v, 'directory'));
    if (command === 'open') {
      const port = v.port === undefined ? 0 : Number(v.port);
      await foreground(customerLaunchArguments(customer, port)); return;
    }
    const native = await nativeAgx();
    const env = { AGX_HOME: customer.agxHome, ERP_AGX_ROOT: customer.providerRoot };
    if (command === 'agent') {
      if (!forwarded.length || forwarded.includes('--home')) fail('AGX_COMMAND_REQUIRED');
      await foreground([native, ...forwarded], env); return;
    }
    if (command === 'serve-agent') {
      const profile = v.profile ?? customer.configuration.providerProfile;
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(profile)) fail('INVALID_AGX_PROFILE');
      await foreground([native, 'serve', '--profile', profile,
        '--handler', join(here, '..', 'agx', 'handler.mjs'), '--no-reply'], env); return;
    }
  }
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
await main().catch(error => {
  process.stderr.write(JSON.stringify({ schema: 'erp-reconciliation.customer-error.v1',
    error: { code: String(error.code ?? 'CUSTOMER_OPERATION_FAILED') } }) + '\n');
  process.exitCode = 1;
});
