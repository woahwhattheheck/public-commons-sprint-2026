#!/usr/bin/env node
/** MIT. Configure and inspect the native MCP buyer's original SF36 spending owner. */
import {constants} from 'node:fs';
import {open, realpath, stat, link, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isAbsolute, dirname, resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createMcpSpendingClient, createGovernedNativeMcpOperator} from './native-spend-governor.mjs';
import {readMcpSpendingHost, requireMcpSpendingAbsolutePath as absolute,
  requireMcpSpendingPrivateParent as privateParent} from './native-spend-configuration.mjs';
export {readMcpSpendingHost} from './native-spend-configuration.mjs';

const SCHEMA = 'stellar-forge.mcp-spending-host.v1';
function need(ok, message) { if (!ok) throw new TypeError(message); }

/** Embedders can provide their original approval UI and native SDK/signer objects. */
export async function openMcpSpendingHost(configPath, {environment = process.env,
  approveQuote, sdk, signer, reconciliationFetchImpl} = {}) {
  const config = await readMcpSpendingHost(configPath);
  if (!sdk) {
    const {loadNativeSdk} = await import(
      '../../stellar/scf-starforge-20261009/sf103-native-buyer-signer/adapter.mjs');
    sdk = await loadNativeSdk();
  }
  if (!signer) {
    const secret = environment[config.signerSecretEnv];
    need(typeof secret === 'string' && secret.length > 0,
      'The configured signer credential must be present on the operator host.');
    signer = sdk.createEd25519Signer(secret,config.limits.network);
  }
  need(signer.address === config.payer, 'The configured signer must match the existing public payer.');
  return createGovernedNativeMcpOperator({payer:config.payer,signer,sdk,limits:config.limits,
    rpcUrl:config.rpcUrl,reconciliationRpcUrl:config.reconciliationRpcUrl,
    reconciliationHttpsProxyEnv:config.reconciliationHttpsProxyEnv,reconciliationFetchImpl,
    ...(approveQuote === undefined ? {} : {approveQuote}),
    spending:{...config.spending,environment}});
}

/** Create one private module for the existing HTTP/stdio workspace launchers. */
export async function configureMcpSpendingModule(configPath, modulePath) {
  await readMcpSpendingHost(configPath);
  absolute(modulePath); await privateParent(modulePath);
  const source = [
    'import {openMcpSpendingHost, readMcpSpendingHost} from ' + JSON.stringify(import.meta.url) + ';',
    'const configPath = ' + JSON.stringify(resolve(configPath)) + ';',
    'export const spendingConfigurationFile = configPath;',
    'const configured = await readMcpSpendingHost(configPath);',
    'export const openOperator = ({environment = process.env} = {}) => openMcpSpendingHost(configPath,{environment});',
    '// Declarative host metadata is available before a signing operator is needed.',
    'export let readiness = Object.freeze({provider:"ORIGINAL_X402_STELLAR",network:configured.limits.network,payer:configured.payer,',
    '  asset:configured.limits.asset,payTo:configured.limits.payTo,maxAtomic:configured.limits.maxAtomic,',
    '  sdkVersions:null,aggregateSpending:Object.freeze({provider:"ORIGINAL_SF36",',
    '    actor:configured.spending.actor,service:configured.spending.service,',
    '    reservationPoint:"LIVE_CHALLENGE_BEFORE_NATIVE_SIGNING"})});',
    'let opening, closing, closed = false;',
    'const stopped = () => Object.assign(new Error("MCP_SPENDING_OPERATOR_CLOSED"),{code:"MCP_SPENDING_OPERATOR_CLOSED"});',
    'async function shared() {',
    '  if (closed) throw stopped();',
    '  opening ??= openOperator().then(operator => {readiness = operator.readiness;return operator;},',
    '    error => {opening = undefined;throw error;});',
    '  const operator = await opening;',
    '  if (closed) throw stopped();',
    '  return operator;',
    '}',
    'export const approve = async (...args) => (await shared()).approve(...args);',
    'export const signPayment = async (...args) => (await shared()).signPayment(...args);',
    'export const spendingStatus = async (...args) => (await shared()).spendingStatus(...args);',
    'export const reconcilePayment = async (...args) => (await shared()).reconcilePayment(...args);',
    'export function close() {',
    '  if (closing) return closing;',
    '  closed = true;',
    '  closing = (async () => {',
    '    try {if (opening) await (await opening).close();}',
    '    finally {opening = undefined;}',
    '  })();',
    '  return closing;',
    '}',
  ].join('\n') + '\n';
  const temporary = join(dirname(modulePath),'.mcp-module-'+randomUUID());
  const file = await open(temporary,'wx',0o600);
  try {
    try { await file.writeFile(source,'utf8'); await file.sync(); }
    finally { await file.close(); }
    await link(temporary,modulePath);
    const directory = await open(dirname(modulePath),constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  return {schema:SCHEMA,outcome:'CONFIGURED',operatorModule:modulePath,
    config:configPath,launcherEnvironment:{MCP_OPERATOR_MODULE:modulePath}};
}

export async function nativeSpendingMain(argv = process.argv.slice(2), {environment = process.env} = {}) {
  const [action, configPath, value, ...rest] = argv;
  need(rest.length === 0 && ['setup','status'].includes(action) && configPath && value,
    'Usage: native-spend-workspace.mjs setup /absolute/private/config.json /absolute/private/operator.mjs\n' +
    '       native-spend-workspace.mjs status /absolute/private/config.json QUOTE_UUID');
  if (action === 'setup') return configureMcpSpendingModule(configPath,value);
  const config = await readMcpSpendingHost(configPath);
  const client = createMcpSpendingClient({...config.spending,environment});
  try {
    const result = await client.status(value);
    const {binding,...report} = result;
    if (binding && binding.payer !== config.payer) throw new Error('MCP_SPENDING_PAYER_MISMATCH');
    // Status deliberately works without loading a signing SDK or payer secret.
    return {...report,...(binding ? {operation:JSON.parse(binding.invocationJson)} : {})};
  } finally { await client.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  nativeSpendingMain().then(result => process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error => {
    process.stderr.write(JSON.stringify({schema:SCHEMA,outcome:'ERROR',
      reason:error.code ?? error.message,operatorReason:error.operatorReason})+'\n');
    process.exitCode = 2;
  });
}
