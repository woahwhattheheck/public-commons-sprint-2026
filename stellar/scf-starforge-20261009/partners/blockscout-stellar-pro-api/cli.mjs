#!/usr/bin/env node
// MIT. Offline preparation, original merchant launch and private provider operations.
import { readFile, open, mkdir, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareProduct, prepareTokenBuyer, PLAN_SCHEMA, LIMITS, error } from './product.mjs';
import { privateDirectory, restoreProviderBackup } from './accounting.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const json = x => JSON.stringify(x, null, 2) + '\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const own = (o, key) => Object.hasOwn(o, key);
export const HELP = [
  'Blockscout token merchant — Node 24+, Linux, complete Stellar Forge source',
  '', '  template', '  inspect --plan PLAN.json',
  '  prepare --plan PLAN.json --out NEW_PRIVATE_PACKAGE',
  '  serve --package PACKAGE --state PRIVATE_MERCHANT_ROOT --facilitator HTTPS_URL',
  '        [--port 8423] [--operations-port 8424] [--desk-port 8425]',
  '        [--drain-grace-ms 60000] [--allow-local-facilitator]',
  '  buyer --package PACKAGE --chain CHAIN_ID --address 0xADDRESS --intent STABLE_ID',
  '        --out NEW_REVIEW.json --response-out NEW_RESPONSE.json',
  '  status --url PRIVATE_DESK_URL [--token-env VARIABLE]',
  '  attempts --url PRIVATE_DESK_URL [--token-env VARIABLE] [--after N] [--chain CHAIN_ID] [--address 0xADDRESS]',
  '  probe --url PRIVATE_DESK_URL [--token-env VARIABLE] --chain CHAIN_ID --address 0xADDRESS',
  '  backup --url PRIVATE_DESK_URL [--token-env VARIABLE] --out NEW_PRIVATE.sqlite',
  '  download-backup --url PRIVATE_DESK_URL [--token-env VARIABLE] --id BACKUP_ID --sha256 SHA256 --out NEW_PRIVATE.sqlite',
  '  restore --source PRIVATE.sqlite --sha256 SHA256 --out NEW_PRIVATE_PROVIDER_DIRECTORY',
  '', 'The startup desk URL carries its private capability in the fragment. Preparation',
  'uses the original SF61/SF88 compilers; probe performs one provider read. Backup',
  'retains the provider database. The original merchant/buyer tools retain payment',
  'and settlement state. Reopening a saved buyer result does not call the provider.',
].join('\n');
const commands = {
  inspect: { required: ['plan'] }, prepare: { required: ['plan', 'out'] },
  serve: { required: ['package', 'state', 'facilitator'], optional: ['port', 'operations-port', 'desk-port', 'drain-grace-ms'], switches: ['allow-local-facilitator'] },
  buyer: { required: ['package', 'chain', 'address', 'intent', 'out', 'response-out'] },
  status: { required: ['url'], optional: ['token-env'] },
  attempts: { required: ['url'], optional: ['token-env', 'after', 'chain', 'address'] },
  probe: { required: ['url', 'chain', 'address'], optional: ['token-env'] },
  backup: { required: ['url', 'out'], optional: ['token-env'] },
  'download-backup': { required: ['url', 'id', 'sha256', 'out'], optional: ['token-env'] },
  restore: { required: ['source', 'sha256', 'out'] },
};
function options(args) {
  const [command, ...rest] = args, spec = commands[command], result = {};
  if (!spec) throw error('BLOCKSCOUT_COMMAND_UNKNOWN');
  const names = [...spec.required, ...(spec.optional ?? []), ...(spec.switches ?? [])];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].slice(2);
    if (!rest[i].startsWith('--') || !names.includes(key) || own(result, key)) throw error('BLOCKSCOUT_COMMAND_OPTIONS_INVALID');
    if (spec.switches?.includes(key)) result[key] = true;
    else { const value = rest[++i]; if (!value || value.startsWith('--')) throw error('BLOCKSCOUT_COMMAND_OPTIONS_INVALID'); result[key] = value; }
  }
  if (spec.required.some(key => !own(result, key))) throw error('BLOCKSCOUT_COMMAND_OPTIONS_REQUIRED');
  return { command, options: result };
}
export async function readJSON(path, max = 131072) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > max) throw error('BLOCKSCOUT_JSON_FILE_INVALID');
    const bytes = await file.readFile(); if (bytes.length > max) throw error('BLOCKSCOUT_JSON_FILE_INVALID');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
async function save(path, bytes) {
  if (!isAbsolute(path) || resolve(path) !== path) throw error('BLOCKSCOUT_ABSOLUTE_OUTPUT_REQUIRED');
  await privateDirectory(dirname(path), false);
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export function template() {
  return { schema: PLAN_SCHEMA, publicOrigin: 'https://your-merchant.example', accountAlias: 'blockscout-provider',
    apiKeyEnv: 'BLOCKSCOUT_PRO_API_KEY', payment: { network: 'stellar:testnet',
      asset: 'REPLACE_WITH_ACTUAL_ASSET_CONTRACT', payTo: 'REPLACE_WITH_ACTUAL_MERCHANT_RECIPIENT', maxTimeoutSeconds: 60 },
    chains: [{ chainId: '8453', name: 'Base', amountAtomic: 'REPLACE_WITH_EXPLICIT_ATOMIC_PRICE' }], limits: { ...LIMITS } };
}
function entry(plan) {
  return '// Generated trusted entry for the original SF82 release/seller tools.\n' +
    'import { createBlockscoutApplication } from ' + JSON.stringify(pathToFileURL(join(here, 'application.mjs')).href) + ';\n' +
    'const app = await createBlockscoutApplication(' + JSON.stringify(plan) + ', {directory:process.env.BLOCKSCOUT_ACCOUNTING_DIRECTORY});\n' +
    plan.chains.map(row => {
      const id = 'blockscout_' + row.chainId;
      return 'export const ' + id + '=app.handlers.' + id + ';\nexport const admit_' + id + '=app.handlers.admit_' + id + ';';
    }).join('\n') + '\nexport const blockscoutSnapshot=app.snapshot;\nexport const close=app.close;\n';
}
const FILES = ['plan.json', 'openapi.json', 'selections.json', 'route-bindings.json', 'seller-service.json', 'seller-offers.json', 'handlers.mjs', 'RUN.md'];
export async function preparePackage(input, directory) {
  const prepared = prepareProduct(input);
  if (!isAbsolute(directory) || resolve(directory) !== directory) throw error('BLOCKSCOUT_ABSOLUTE_OUTPUT_REQUIRED');
  await privateDirectory(dirname(directory), false); await mkdir(directory, { mode: 0o700 });
  const documents = { 'plan.json': json(prepared.plan), 'openapi.json': json(prepared.spec),
    'selections.json': json(prepared.selections), 'route-bindings.json': json(prepared.bindings),
    'seller-service.json': json(prepared.service), 'seller-offers.json': json({ resources: prepared.imported.offers.map(row => row.seller) }),
    'handlers.mjs': entry(prepared.plan), 'RUN.md': '# Blockscout token merchant\n\n' +
      'Use the complete matching source release at ' + root + '. The private API key belongs in the environment named ' + prepared.plan.apiKeyEnv + '.\n\n' +
      'Run node ' + join(here, 'cli.mjs') + ' serve --package ' + directory + ' --state /private/blockscout-merchant --facilitator https://YOUR_FACILITATOR.\n\n' +
      'Keep the same merchant state directory across restarts, credential rotation and selected price rollback. The startup URLs open the provider desk and original native operations.\n\n' +
      'The source README contains complete install, buyer, recovery, backup and original SF82 release commands.\n' };
  const manifest = { schema: 'stellar-forge.blockscout-package.v1', planSha256: prepared.planSha256,
    files: Object.fromEntries(FILES.map(name => [name, { sha256: hash(documents[name]), bytes: Buffer.byteLength(documents[name]) }])) };
  for (const name of FILES) await save(join(directory, name), documents[name]);
  await save(join(directory, 'package.json'), json(manifest));
  return { status: 'PREPARED', directory, planSha256: prepared.planSha256, routes: prepared.plan.chains.length,
    paymentNetwork: prepared.plan.payment.network, requiredEnvironment: prepared.plan.apiKeyEnv, manifest };
}
export async function readPackage(directory) {
  await privateDirectory(directory, false);
  const manifest = await readJSON(join(directory, 'package.json'));
  if (manifest.schema !== 'stellar-forge.blockscout-package.v1' || !manifest.files ||
      Object.keys(manifest.files).length !== FILES.length || FILES.some(name => !own(manifest.files, name)))
    throw error('BLOCKSCOUT_PACKAGE_MANIFEST_INVALID');
  for (const name of FILES) {
    const record = manifest.files[name];
    const info = await lstat(join(directory, name));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw error('BLOCKSCOUT_PACKAGE_FILE_INVALID');
    const bytes = await readFile(join(directory, name));
    if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw error('BLOCKSCOUT_PACKAGE_CHANGED');
  }
  const prepared = prepareProduct(await readJSON(join(directory, 'plan.json')));
  if (prepared.planSha256 !== manifest.planSha256) throw error('BLOCKSCOUT_PACKAGE_PLAN_CHANGED');
  return prepared;
}
export function operatorTarget(value, tokenEnvironment, env = process.env) {
  let url; try { url = new URL(value); } catch { throw error('BLOCKSCOUT_DESK_URL_INVALID'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port ||
      Number(url.port) > 65535 || url.username || url.password || url.search || url.pathname !== '/') throw error('BLOCKSCOUT_DESK_URL_INVALID');
  if (url.hash && tokenEnvironment !== undefined) throw error('BLOCKSCOUT_DESK_TOKEN_SELECTION_AMBIGUOUS');
  if (tokenEnvironment !== undefined && !/^[A-Z_][A-Z0-9_]{0,79}$/.test(tokenEnvironment)) throw error('BLOCKSCOUT_DESK_TOKEN_ENV_INVALID');
  const token = url.hash ? url.hash.slice(1) : env[tokenEnvironment];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw error('BLOCKSCOUT_DESK_TOKEN_REQUIRED');
  const origin = url.origin; url.hash = ''; url.hostname = '127.0.0.1';
  return { origin, networkOrigin: url.origin, token };
}
async function control(target, path, body, binary = false) {
  const response = await fetch(target.networkOrigin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    credentials: 'omit', signal: AbortSignal.timeout(binary ? 300000 : 75000),
    headers: { origin: target.origin, 'x-blockscout-operator-token': target.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (binary && response.ok) return response;
  const parts = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 2097152) throw error('BLOCKSCOUT_DESK_RESPONSE_TOO_LARGE'); parts.push(chunk); }
  let data; try { data = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw error('BLOCKSCOUT_DESK_RESPONSE_INVALID'); }
  if (!response.ok) throw error(/^BLOCKSCOUT_[A-Z0-9_]+$/.test(data.error ?? '') ? data.error : 'BLOCKSCOUT_DESK_REQUEST_FAILED', response.status);
  return data;
}
async function downloadBackup(target, receipt, destination) {
  if (!/^[0-9a-f-]{36}$/.test(receipt.id) || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw error('BLOCKSCOUT_BACKUP_IDENTITY_INVALID');
  if (!isAbsolute(destination) || resolve(destination) !== destination) throw error('BLOCKSCOUT_ABSOLUTE_OUTPUT_REQUIRED');
  await privateDirectory(dirname(destination), false);
  const response = await control(target, '/api/backups/' + receipt.id, undefined, true);
  if (response.headers.get('x-content-sha256') !== receipt.sha256) throw error('BLOCKSCOUT_BACKUP_SHA_MISMATCH');
  const file = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const checksum = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 1200000000) throw error('BLOCKSCOUT_BACKUP_TOO_LARGE');
      checksum.update(chunk); await file.writeFile(chunk); }
    if (checksum.digest('hex') !== receipt.sha256) throw error('BLOCKSCOUT_BACKUP_SHA_MISMATCH');
    await file.sync(); return { ...receipt, localDestination: destination, downloadedBytes: bytes };
  } catch (e) { await file.close(); await unlink(destination).catch(() => {}); throw e; }
  finally { await file.close().catch(() => {}); }
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  if (args.length === 1 && args[0] === 'template') { const value = template(); process.stdout.write(json(value)); return value; }
  const { command, options: o } = options(args); let result;
  if (command === 'prepare') result = await preparePackage(await readJSON(resolve(o.plan)), o.out);
  else if (command === 'inspect') {
    const p = prepareProduct(await readJSON(resolve(o.plan))); result = { plan: p.plan, planSha256: p.planSha256,
      routes: p.imported.offers.map(row => ({ method: row.method, path: row.path, offer: row.seller })) };
  } else if (command === 'buyer') {
    const p = await readPackage(o.package);
    const review = prepareTokenBuyer(p.plan, { chainId: o.chain, addressHash: o.address, intentId: o.intent, responseOut: o['response-out'] });
    await save(o.out, review.data); result = { status: 'BUYER_REVIEW_PREPARED', destination: o.out,
      configSha256: review.configSha256, planSha256: review.planSha256, token: review.token };
  } else if (command === 'restore') result = await restoreProviderBackup({ source: o.source, sha256: o.sha256, directory: o.out });
  else if (command === 'serve') {
    const prepared = await readPackage(o.package), { startBlockscoutMerchant } = await import('./launch.mjs');
    const value = (name, fallback) => {
      if (!own(o, name)) return fallback;
      if (!/^(?:0|[1-9]\d*)$/.test(o[name])) throw error('BLOCKSCOUT_COMMAND_NUMBER_INVALID'); return Number(o[name]);
    };
    const runtime = await startBlockscoutMerchant({ plan: prepared.plan, directory: o.state, facilitator: o.facilitator,
      port: value('port', 8423), operationsPort: value('operations-port', 8424), deskPort: value('desk-port', 8425),
      drainGraceMs: value('drain-grace-ms', 60000), allowLocalFacilitator: o['allow-local-facilitator'] ?? false });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.close().catch(() => { process.exitCode = 1; }));
    process.stdout.write(json({ status: 'BLOCKSCOUT_MERCHANT_RUNNING', planSha256: prepared.planSha256, ...runtime.endpoints })); return runtime;
  } else {
    const target = operatorTarget(o.url, o['token-env']);
    if (command === 'status') result = await control(target, '/api/status');
    else if (command === 'attempts') {
      const query = new URLSearchParams();
      for (const [flag, field] of [['after', 'after'], ['chain', 'chainId'], ['address', 'addressHash']]) if (own(o, flag)) query.set(field, o[flag]);
      result = await control(target, '/api/attempts?' + query);
    } else if (command === 'probe') {
      result = await control(target, '/api/diagnose', { chainId: o.chain, addressHash: o.address });
      if (result.status >= 400) process.exitCode = 1;
    } else {
      const receipt = command === 'backup' ? await control(target, '/api/backup', {}) : { id: o.id, sha256: o.sha256 };
      try { result = await downloadBackup(target, receipt, o.out); }
      catch (e) { e.retainedBackup = receipt; throw e; }
    }
  }
  process.stdout.write(json(result)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  process.stderr.write(json({ error: /^BLOCKSCOUT_[A-Z0-9_]+$/.test(e.code ?? '') ? e.code : 'BLOCKSCOUT_COMMAND_FAILED',
    ...(e.retainedBackup ? { retainedBackup: e.retainedBackup } : {}) })); process.exitCode = 1;
});
