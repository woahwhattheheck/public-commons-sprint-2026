// MIT. Private operator setup for the original SF88 -> SF81 -> SF36 buyer.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abs, config, execution, need, operation, operator, InputError } from './config.mjs';

const SCHEMA = 'stellar-forge.sf88.operator-workspace.v1';
const KEY_NAMES = ['SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64'];
const MAX_ATOMIC = 9223372036854775807n; // Original SF36 SQLite policy limit.
const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const governorPath = fileURLToPath(new URL('../sf36-spend-governor/', import.meta.url));
const signerUrl = new URL('./native-signer.mjs', import.meta.url).href;
const schemaObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';

function amount(value, code) {
  need(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= MAX_ATOMIC, code);
  return value;
}
function options(args, allowed) {
  need(args.length % 2 === 0, 'WORKSPACE_ARGUMENT_VALUE_REQUIRED');
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    need(allowed.includes(args[i]) && !Object.hasOwn(result, args[i]) &&
      typeof args[i + 1] === 'string' && args[i + 1].length > 0,
      'WORKSPACE_ARGUMENT_INVALID_OR_REPEATED');
    result[args[i]] = args[i + 1];
  }
  return result;
}
function privateMode(info) { return (info.mode & 0o077) === 0; }
async function privateDirectory(path) {
  abs(path, 'WORKSPACE_PATH_NOT_ABSOLUTE');
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && privateMode(info),
    'WORKSPACE_DIRECTORY_MUST_BE_PRIVATE');
  return info;
}
async function privateJson(path, max = 65536) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    need(info.isFile() && privateMode(info) && info.size <= max, 'WORKSPACE_FILE_NOT_PRIVATE');
    const raw = await file.readFile();
    need(raw.length <= max, 'WORKSPACE_FILE_TOO_LARGE');
    try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
    catch { throw new InputError('WORKSPACE_JSON_INVALID'); }
  } finally { await file.close(); }
}
function keys(environment, { create = false } = {}) {
  const present = KEY_NAMES.filter(name => environment[name] !== undefined);
  need(present.length === 0 && create || present.length === KEY_NAMES.length,
    'WORKSPACE_OPERATOR_KEYS_INCOMPLETE');
  const result = {};
  for (const name of KEY_NAMES) {
    const value = present.length ? environment[name] : randomBytes(32).toString('base64');
    need(typeof value === 'string' && value.length <= 4096 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value), 'WORKSPACE_OPERATOR_KEY_INVALID');
    const decoded = Buffer.from(value, 'base64');
    need(decoded.length >= 32 && decoded.toString('base64') === value,
      'WORKSPACE_OPERATOR_KEY_INVALID');
    result[name] = value;
  }
  return { values:result, source:present.length ? 'EXISTING_OPERATOR_ENVIRONMENT' : 'NEW_LOCAL_WORKSPACE' };
}

// This is the original Governor constructor, not a second ledger implementation.
const INITIALIZE_LEDGER = `import base64,json,os,sys
from pathlib import Path
if sys.version_info < (3,11): raise RuntimeError('PYTHON_311_REQUIRED')
sys.path.insert(0,sys.argv[1])
from governor import Governor
os.umask(0o077)
policy=json.loads(Path(sys.argv[2]).read_text())
keys=json.load(sys.stdin)
names=('SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64')
ledger=Governor(sys.argv[3],policy,*(base64.b64decode(keys[n],validate=True) for n in names))
try:
    count=ledger.db.execute('SELECT count(*) FROM reservations').fetchone()[0]
    if count != 0: raise RuntimeError('NEW_LEDGER_NOT_EMPTY')
    print(json.dumps({'schema':'stellar-forge.sf88.ledger-init.v1','reservations':count,'journalMode':ledger.db.execute('PRAGMA journal_mode').fetchone()[0]}))
finally: ledger.close()
`;
async function initializeLedger(python, policy, ledger, keyValues) {
  return new Promise((accept, reject) => {
    const child = spawn(python, ['-I', '-B', '-c', INITIALIZE_LEDGER, governorPath, policy, ledger], {
      shell:false, env:{LANG:'C.UTF-8', LC_ALL:'C.UTF-8'}, stdio:['pipe', 'pipe', 'ignore'],
    });
    let output = '', settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      error ? reject(error) : accept(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL'); finish(new InputError('WORKSPACE_LEDGER_INIT_TIMEOUT'));
    }, 15000);
    child.once('error', () => finish(new InputError('WORKSPACE_PYTHON_START_FAILED')));
    child.stdin.once('error', () => finish(new InputError('WORKSPACE_LEDGER_INIT_FAILED')));
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 8192) {
        child.kill('SIGKILL'); finish(new InputError('WORKSPACE_LEDGER_INIT_FAILED'));
      }
    });
    child.once('close', code => {
      if (code !== 0) return finish(new InputError('WORKSPACE_LEDGER_INIT_FAILED'));
      try {
        const result = JSON.parse(output);
        need(result.schema === 'stellar-forge.sf88.ledger-init.v1' &&
          result.reservations === 0 && result.journalMode === 'wal', 'WORKSPACE_LEDGER_INIT_FAILED');
        finish(null, result);
      } catch { finish(new InputError('WORKSPACE_LEDGER_INIT_FAILED')); }
    });
    child.stdin.end(JSON.stringify(keyValues));
  });
}

/** Provision a NEW operator workspace from an existing offline-reviewed operation. */
export async function initializeWorkspace(args, { environment = process.env } = {}) {
  need(process.platform !== 'win32', 'WORKSPACE_POSIX_OPERATOR_REQUIRED');
  const opt = options(args, ['--config', '--dir', '--actor', '--service', '--payer', '--python',
    '--secret-env', '--signer-provider', '--rpc', '--total-atomic', '--daily-atomic']);
  const inputPath = abs(opt['--config'], 'WORKSPACE_REVIEW_CONFIG_REQUIRED');
  const directory = resolve(abs(opt['--dir'], 'WORKSPACE_PATH_NOT_ABSOLUTE'));
  const source = await config(inputPath);
  need(['operator','signerModule','evidenceDir'].every(name => source[name] === undefined),
    'WORKSPACE_SOURCE_ALREADY_CONFIGURED');
  const op = operation(source.operation);
  need(op.expect.network === 'stellar:testnet', 'WORKSPACE_TESTNET_REQUIRED');
  need(/^C[A-Z2-7]{55}$/.test(op.expect.asset) && /^[GC][A-Z2-7]{55}$/.test(op.expect.payTo),
    'WORKSPACE_STELLAR_TERMS_INVALID');
  const payer = opt['--payer'];
  need(typeof payer === 'string' && /^G[A-Z2-7]{55}$/.test(payer), 'WORKSPACE_PAYER_REQUIRED');
  need(source.trustedPayer === undefined || source.trustedPayer === payer, 'WORKSPACE_PAYER_CONFLICT');
  const maximum = amount(op.expect.maxAtomic, 'WORKSPACE_SINGLE_AMOUNT_INVALID');
  const total = amount(opt['--total-atomic'] ?? maximum, 'WORKSPACE_TOTAL_AMOUNT_INVALID');
  const daily = amount(opt['--daily-atomic'] ?? total, 'WORKSPACE_DAILY_AMOUNT_INVALID');
  need(BigInt(total) >= BigInt(maximum) && BigInt(daily) >= BigInt(maximum) &&
    BigInt(daily) <= BigInt(total), 'WORKSPACE_BUDGET_LIMITS_INCONSISTENT');
  const signerProvider = opt['--signer-provider'];
  need(signerProvider === undefined || opt['--secret-env'] === undefined,
    'WORKSPACE_ONE_SIGNER_SOURCE_REQUIRED');
  const secretEnv = signerProvider === undefined ? opt['--secret-env'] ?? 'STELLAR_SECRET' : undefined;
  need(secretEnv === undefined || /^[A-Z][A-Z0-9_]{0,127}$/.test(secretEnv) && !KEY_NAMES.includes(secretEnv),
    'WORKSPACE_WALLET_ENV_NAME_INVALID');
  const owner = operator({python:opt['--python'], actor:opt['--actor'], service:opt['--service'],
    policy:join(directory, 'policy.json'), ledger:join(directory, 'reservations.sqlite')});
  need((await stat(owner.python)).isFile(), 'WORKSPACE_PYTHON_FILE_REQUIRED');
  await access(owner.python, constants.X_OK);
  // Resolve the parent once and refuse aliasing through a symlinked directory.
  need(await realpath(dirname(directory)) === dirname(directory), 'WORKSPACE_PARENT_PATH_AMBIGUOUS');
  const keySet = keys(environment, {create:true});
  const policy = {schema:'stellar-spend-governor/v1', assets:[{
    network:op.expect.network, asset:op.expect.asset,
    max_single:maximum, max_total:total, max_per_utc_day:daily,
    max_per_actor_utc_day:daily, max_per_service_utc_day:daily,
  }]};
  const cfg = {...source, operation:op, operator:owner,
    signerModule:join(directory, 'signer.mjs'), evidenceDir:join(directory, 'evidence'),
    trustedPayer:payer};
  execution(cfg);
  const configuredBytes = Buffer.from(json(cfg));
  need(configuredBytes.length <= 65536, 'WORKSPACE_CONFIG_TOO_LARGE');
  const signerPins = {network:op.expect.network, asset:op.expect.asset, payTo:op.expect.payTo,
    maxAtomic:maximum, expectedPayer:payer, secretEnv, signerProvider, rpcUrl:opt['--rpc']};
  const {validateNativeSignerConfiguration, inspectSignerProvider} = await import('./native-signer.mjs');
  validateNativeSignerConfiguration(signerPins);
  if (signerProvider !== undefined) await inspectSignerProvider(signerProvider);
  const factory = signerProvider === undefined ? 'createEnvironmentStellarSigner' : 'createProviderStellarSigner';
  const signerSource = `// Private operator adapter. No wallet key is stored in this file.\n` +
    `import {${factory}, validateNativeSignerInput} from ${JSON.stringify(signerUrl)};\n` +
    `const pins = Object.freeze(${JSON.stringify(signerPins)});\nlet adapter;\n` +
    `export async function sign(payload) {\n` +
    `  validateNativeSignerInput(payload, pins);\n` +
    `  adapter ??= ${factory}({...pins, environment:process.env});\n` +
    `  return (await adapter).sign(payload);\n}\n`;
  const manifest = {schema:SCHEMA, createdAt:new Date().toISOString(), directory,
    config:'operator.json', keys:'operator-keys.json', sourceCli:cliPath,
    sourceConfig:inputPath, signer:signerPins,
    operatorKeySource:keySet.source, walletKeyEnvironment:secretEnv, signerProvider,
    network:op.expect.network, payer};
  let created;
  try {
    try { await mkdir(directory, {mode:0o700}); }
    catch (error) {
      if (error.code === 'EEXIST') throw new InputError('WORKSPACE_ALREADY_EXISTS');
      throw error;
    }
    created = await privateDirectory(directory);
    await mkdir(cfg.evidenceDir, {mode:0o700});
    for (const [name, contents] of [
      ['operator.json', configuredBytes], ['policy.json', json(policy)],
      ['operator-keys.json', json({schema:SCHEMA, keys:keySet.values})], ['signer.mjs', signerSource],
    ]) await writeFile(join(directory, name), contents, {flag:'wx', mode:0o600});
    const ledger = await initializeLedger(owner.python, owner.policy, owner.ledger, keySet.values);
    // The manifest is written last; partial initialization is never executable.
    await writeFile(join(directory, 'workspace.json'), json(manifest), {flag:'wx', mode:0o600});
    return {mode:'PRIVATE_OPERATOR_WORKSPACE_CREATED', directory,
      config:join(directory, 'operator.json'), network:manifest.network, payer,
      operatorKeySource:keySet.source, walletKeyEnvironment:secretEnv,
      signerSource:signerProvider === undefined ? 'ENVIRONMENT' : 'TRUSTED_SEP43_PROVIDER',
      walletKeyStored:false, policy, ledger,
      commands:{review:[process.execPath, cliPath, '--review-workspace', '--dir', directory],
        execute:[process.execPath, cliPath, '--execute-workspace', '--dir', directory]}};
  } catch (error) {
    // Only remove the new directory this invocation owns, never an existing workspace.
    if (created) {
      const current = await lstat(directory).catch(() => null);
      if (current?.dev === created.dev && current?.ino === created.ino)
        await rm(directory, {recursive:true, force:true}).catch(() => {});
    }
    throw error;
  }
}

/** Review never opens the operator-key file or loads the signer/SDK. */
export async function openWorkspace(args, { execute = false, environment = process.env } = {}) {
  need(process.platform !== 'win32', 'WORKSPACE_POSIX_OPERATOR_REQUIRED');
  const opt = options(args, ['--dir']);
  const directory = resolve(abs(opt['--dir'], 'WORKSPACE_PATH_NOT_ABSOLUTE'));
  await privateDirectory(directory);
  const manifest = await privateJson(join(directory, 'workspace.json'));
  need(manifest.schema === SCHEMA && manifest.directory === directory &&
    manifest.config === 'operator.json' && manifest.keys === 'operator-keys.json',
    'WORKSPACE_MANIFEST_INVALID');
  const configPath = join(directory, manifest.config);
  await privateJson(configPath);
  const cfg = await config(configPath);
  const {op, owner} = execution(cfg);
  need(op.expect.network === 'stellar:testnet' && cfg.trustedPayer === manifest.payer &&
    owner.policy === join(directory, 'policy.json') && owner.ledger === join(directory, 'reservations.sqlite') &&
    cfg.signerModule === join(directory, 'signer.mjs') && cfg.evidenceDir === join(directory, 'evidence'),
    'WORKSPACE_CONFIG_BINDING_CHANGED');
  need(schemaObject(manifest.signer) && manifest.signer.network === op.expect.network &&
    manifest.signer.asset === op.expect.asset && manifest.signer.payTo === op.expect.payTo &&
    manifest.signer.expectedPayer === cfg.trustedPayer &&
    BigInt(amount(op.expect.maxAtomic, 'WORKSPACE_SINGLE_AMOUNT_INVALID')) <=
      BigInt(amount(manifest.signer.maxAtomic, 'WORKSPACE_SIGNER_CAP_INVALID')),
    'WORKSPACE_SIGNER_BINDING_CHANGED');
  await privateDirectory(cfg.evidenceDir);
  let operatorEnvironment;
  if (execute) {
    // Surface missing local setup before an inbox attempt or SF36 reservation.
    const {checkNativeSignerPrerequisites} = await import('./native-signer.mjs');
    await checkNativeSignerPrerequisites({...manifest.signer, environment});
    const stored = await privateJson(join(directory, manifest.keys), 16384);
    need(stored.schema === SCHEMA && schemaObject(stored.keys) &&
      Object.keys(stored.keys).length === KEY_NAMES.length, 'WORKSPACE_KEY_FILE_INVALID');
    // SF81 accepts only these three values; do not copy unrelated credentials.
    operatorEnvironment = keys(stored.keys).values;
  }
  return {config:cfg, configPath, manifest, operatorEnvironment};
}

/** Review the original workspace plus package/source availability, without custody. */
export async function diagnoseWorkspace(args, {environment = process.env} = {}) {
  const workspace = await openWorkspace(args);
  const {manifest} = workspace;
  const {inspectNativeSignerRuntime, inspectSignerProvider, validateNativeSignerConfiguration} =
    await import('./native-signer.mjs');
  const checks = [];
  let sdk = null;
  const code = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '')
    ? error.code : 'WORKSPACE_RUNTIME_UNAVAILABLE';
  const pins = validateNativeSignerConfiguration(manifest.signer);
  try {
    sdk = await inspectNativeSignerRuntime();
    checks.push({check:'official-sdk', status:'AVAILABLE'});
  } catch (error) { checks.push({check:'official-sdk', status:'UNAVAILABLE', code:code(error)}); }
  const provider = manifest.signer.signerProvider;
  if (provider !== undefined) {
    try {
      await inspectSignerProvider(provider);
      checks.push({check:'signer-provider', status:'PRESENT_NOT_IMPORTED', filename:basename(provider)});
    } catch (error) {
      checks.push({check:'signer-provider', status:'UNAVAILABLE', code:code(error)});
    }
  } else {
    const name = manifest.signer.secretEnv ?? 'STELLAR_SECRET';
    checks.push({check:'key-environment', name,
      status:Object.hasOwn(environment, name) ? 'PRESENT_NOT_LOADED' : 'MISSING'});
  }
  const ready = checks.every(check => !['UNAVAILABLE','MISSING'].includes(check.status));
  return {mode:'OPERATOR_WORKSPACE_DIAGNOSTICS', status:ready ? 'READY_TO_EXECUTE' : 'SETUP_REQUIRED',
    directory:manifest.directory, network:pins.network, payer:pins.expectedPayer,
    signerSource:provider === undefined ? 'ENVIRONMENT' : 'TRUSTED_SEP43_PROVIDER',
    rpcOrigin:new URL(pins.rpcUrl).origin, sdk, checks,
    next:ready ? 'Review the operation, then use --execute-workspace for original terminal approval.' :
      'Resolve the listed runtime requirements and diagnose this same workspace again.'};
}
