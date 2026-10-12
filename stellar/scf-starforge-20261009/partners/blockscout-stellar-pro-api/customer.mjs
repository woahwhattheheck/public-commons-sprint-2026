#!/usr/bin/env node
// MIT. A complete token consumer on the original durable Node buyer.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';
import { error, ADDRESS } from './product.mjs';

const runtimeDirectory = fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url));
const json = value => JSON.stringify(value, null, 2) + '\n';
const required = (value, code) => { if (!value) throw error(code); };
async function configuration(path) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    required(stat.isFile() && stat.size <= 65536 && (stat.mode & 0o077) === 0, 'BLOCKSCOUT_BUYER_CONFIG_INVALID');
    return JSON.parse(await fd.readFile('utf8'));
  } finally { await fd.close(); }
}
function tokenSelection(config) {
  const op = config.operation;
  let url; try { url = new URL(op.url); } catch { throw error('BLOCKSCOUT_BUYER_ROUTE_INVALID'); }
  const match = /^\/([1-9]\d{0,19})\/api\/v2\/tokens\/(0x[A-Fa-f0-9]{40})$/.exec(url.pathname);
  required(op.method === 'GET' && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    match && ADDRESS.test(match[2]) && ['stellar:testnet', 'stellar:pubnet'].includes(op.expect?.network),
    'BLOCKSCOUT_BUYER_ROUTE_INVALID');
  return { chainId: match[1], addressHash: match[2], dataNetwork: 'eip155:' + match[1],
    paymentNetwork: op.expect.network, url: url.href, intentId: op.intentId };
}
function client({ stateDirectory, node = process.execPath, environment = process.env }) {
  required(typeof stateDirectory === 'string' && isAbsolute(stateDirectory), 'BLOCKSCOUT_BUYER_STATE_REQUIRED');
  return new Buyer({ runtimeDirectory, stateDirectory, node, environment, timeoutMs: 360000 });
}
export async function prepareCustomer({ workspaceDirectory, ...options }) {
  const buyer = client(options), operation = await buyer.fromWorkspace(workspaceDirectory);
  const selection = tokenSelection(await configuration(operation.configPath));
  return { selection, operation, review: await operation.review() };
}
export async function reviewCustomer({ intentId, ...options }) {
  const operation = client(options).operation(intentId);
  return { operation, review: await operation.review(), selection: tokenSelection(await configuration(operation.configPath)) };
}
export async function executeCustomer({ workspaceDirectory, intentId, configSha256, ...options }) {
  required(/^[a-f0-9]{64}$/.test(configSha256 ?? ''), 'BLOCKSCOUT_REVIEW_SHA_REQUIRED');
  const operation = client(options).operation(intentId), saved = await configuration(operation.configPath);
  required(tokenSelection(saved).intentId === intentId, 'BLOCKSCOUT_BUYER_INTENT_CHANGED');
  const review = await operation.review();
  required(review.configSha256 === configSha256, 'BLOCKSCOUT_BUYER_REVIEW_CHANGED');
  required(review.nativeWorkspace === workspaceDirectory, 'BLOCKSCOUT_BUYER_WORKSPACE_BINDING_CHANGED');
  const result = await operation.execute({ review });
  return { operation, result, selection: tokenSelection(saved) };
}
export async function recoverCustomer({ intentId, ...options }) {
  const operation = client(options).operation(intentId);
  return { operation, result: await operation.recover(), inspection: await operation.inspect() };
}
function resultView(operation, result) {
  return { intentId: operation.intentId, directory: operation.directory, status: result.status,
    httpStatus: result.native.httpStatus ?? null, ok: result.ok, delivery: result.delivery };
}
export const HELP = [
  'Blockscout Node customer — original SF88 workspace and durable Node buyer',
  '  prepare --workspace PRIVATE_OPERATOR --state PRIVATE_NODE_STATE [--node ABS_NODE]',
  '  review --state PRIVATE_NODE_STATE --intent STABLE_ID [--node ABS_NODE]',
  '  execute --workspace PRIVATE_OPERATOR --state PRIVATE_NODE_STATE --intent STABLE_ID',
  '          --config-sha256 REVIEWED_CONFIG_SHA256 [--node ABS_NODE]',
  '  recover --state PRIVATE_NODE_STATE --intent STABLE_ID [--node ABS_NODE]',
  '  save --state PRIVATE_NODE_STATE --intent STABLE_ID --out NEW_FILE [--node ABS_NODE]',
  '',
  'Prepare and review retain the original operation. Execute uses its exact reviewed',
  'configuration and original operator approval. Recover and save reopen the existing',
  'result and verify its bytes through the original buyer.',
].join('\n');
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const [command, ...args] = argv, o = {};
  const specs = { prepare: ['workspace', 'state'], review: ['state', 'intent'],
    execute: ['workspace', 'state', 'intent', 'config-sha256'], recover: ['state', 'intent'], save: ['state', 'intent', 'out'] };
  required(Object.hasOwn(specs, command) && args.length % 2 === 0, 'BLOCKSCOUT_CUSTOMER_OPTIONS_INVALID');
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].slice(2);
    required(args[i].startsWith('--') && [...specs[command], 'node'].includes(name) && !Object.hasOwn(o, name) &&
      args[i + 1] && !args[i + 1].startsWith('--'), 'BLOCKSCOUT_CUSTOMER_OPTIONS_INVALID');
    o[name] = args[i + 1];
  }
  required(specs[command].every(name => Object.hasOwn(o, name)), 'BLOCKSCOUT_CUSTOMER_OPTIONS_REQUIRED');
  const options = { stateDirectory: o.state, ...(o.node ? { node: o.node } : {}) };
  let value;
  if (command === 'prepare' || command === 'review') {
    const result = command === 'prepare' ? await prepareCustomer({ ...options, workspaceDirectory: o.workspace }) :
      await reviewCustomer({ ...options, intentId: o.intent });
    value = { selection: result.selection, directory: result.operation.directory, review: result.review };
  } else if (command === 'execute') {
    const result = await executeCustomer({ ...options, workspaceDirectory: o.workspace, intentId: o.intent, configSha256: o['config-sha256'] });
    value = resultView(result.operation, result.result);
    if (!result.result.ok) process.exitCode = 1;
  } else {
    const result = await recoverCustomer({ ...options, intentId: o.intent });
    value = result.result ? resultView(result.operation, result.result) : { ...result.inspection, status: 'RESULT_NOT_AVAILABLE' };
    if (command === 'save') {
      required(result.result, 'BLOCKSCOUT_BUYER_RESULT_UNAVAILABLE');
      value.savedAs = await result.result.saveAs(o.out);
    }
  }
  process.stdout.write(json(value)); return value;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  process.stderr.write(json({ error: /^[A-Z][A-Z0-9_]+$/.test(e.code ?? '') ? e.code : 'BLOCKSCOUT_CUSTOMER_FAILED' }));
  process.exitCode = 1;
});
