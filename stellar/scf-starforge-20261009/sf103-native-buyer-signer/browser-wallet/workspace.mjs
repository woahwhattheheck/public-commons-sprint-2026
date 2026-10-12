// MIT. Bind a browser signer to one retained original SF88 operator workspace.
import { mkdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawn } from 'node:child_process';
import { absolute, privateDirectory, readPrivate, readJson, writeNew, readWallet,
  WALLET_SCHEMA, STATE_SCHEMA, requireValue, WalletError, digest } from './common.mjs';
import { inspectBrowserWallet } from './client.mjs';

const sourceModule = fileURLToPath(new URL('../signer.mjs', import.meta.url));

export async function prepareBrowserWallet({buyerConfig, output, rpcUrl, requestLifetimeMs=120000}={}) {
  absolute(buyerConfig); absolute(output);
  requireValue(Number.isSafeInteger(requestLifetimeMs) && requestLifetimeMs>=15000 &&
    requestLifetimeMs<=600000, 'WALLET_REQUEST_LIFETIME_INVALID');
  await privateDirectory(dirname(output));
  const sourceBytes=await readPrivate(buyerConfig,65536);
  const sourceSha=digest(sourceBytes);
  const provider=join(output,'provider.mjs');
  const providerSource=[
    '// Private SF103 SEP-43 provider for this retained wallet workspace.',
    "import { dirname } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'import { createBrowserSigner } from '+JSON.stringify(new URL('./client.mjs',import.meta.url).href)+';',
    'const directory=dirname(fileURLToPath(import.meta.url));',
    'export const createSigner=({network,payer})=>createBrowserSigner({directory,network,payer});',
    '',
  ].join('\n');
  let created=false, nativeCreated=false;
  const owned=[];
  try {
    await mkdir(output,{mode:0o700}); created=true;
    await privateDirectory(output);
    await writeNew(provider,providerSource); owned.push(provider);
    const {prepareNativeBuyer}=await import('../setup.mjs');
    const prepared=await prepareNativeBuyer({
      buyerConfig,output:join(output,'native'),signerProvider:provider,rpcUrl,
    });
    nativeCreated=true;
    const {inspectOperatorConfig}=await import('../operator.mjs');
    const bound=await inspectOperatorConfig(prepared.signerConfig);
    requireValue(digest(await readPrivate(buyerConfig,65536))===sourceSha,'WALLET_SOURCE_BUYER_CHANGED');
    requireValue(/^G[A-Z2-7]{55}$/.test(bound.expected.payer),'WALLET_CLASSIC_ACCOUNT_REQUIRED');
    const config={
      schema:WALLET_SCHEMA,walletId:randomUUID(),directory:output,
      sourceBuyerConfig:buyerConfig,sourceBuyerSha256:sourceSha,
      nativeBuyerConfig:prepared.buyerConfig,buyerSha256:bound.summary.buyerConfigSha256,
      nativeSignerConfig:prepared.signerConfig,nativeSignerSha256:digest(await readPrivate(prepared.signerConfig)),
      provider,providerSha256:digest(providerSource),
      network:bound.expected.operation.expect.network,payer:bound.expected.payer,
      operation:bound.expected.operation,body:bound.expected.body,
      requestLifetimeMs,createdAt:new Date().toISOString(),
    };
    await writeNew(join(output,'wallet.json'),config); owned.push(join(output,'wallet.json'));
    await readWallet(output);
    return {state:'PREPARED',walletId:config.walletId,directory:output,
      sourceBuyerConfig:buyerConfig,buyerConfig:config.nativeBuyerConfig,
      signerConfig:config.nativeSignerConfig,network:config.network,payer:config.payer,
      intentId:config.operation.intentId,provider,
      buyerSha256:config.buyerSha256,sourceBuyerSha256:sourceSha,
      command:'browser-wallet serve --workspace '+JSON.stringify(output)};
  } catch(error) {
    for(const path of owned.reverse()) await unlink(path).catch(()=>{});
    if(nativeCreated) {
      for(const name of ['buyer.json','signer.json']) await unlink(join(output,'native',name)).catch(()=>{});
      await rmdir(join(output,'native')).catch(()=>{});
    }
    if(created) await rmdir(output).catch(()=>{});
    throw error;
  }
}

export async function inspectWalletWorkspace(directory) {
  const config=await readWallet(directory);
  let state,launch;
  try {state=await readJson(join(directory,'wallet-state.json'),16777216);}
  catch(e) {if(e.code!=='ENOENT') throw e;}
  try {launch=await readJson(join(directory,'launch.json'),16384);}
  catch(e) {if(e.code!=='ENOENT') throw e;}
  requireValue(!state || state.schema===STATE_SCHEMA && state.walletId===config.walletId &&
    state.buyerSha256===config.buyerSha256 && Array.isArray(state.requests),'WALLET_STATE_BINDING_INVALID');
  const counts={};
  for(const row of state?.requests ?? []) counts[row.state]=(counts[row.state]??0)+1;
  let connection;
  try {connection=await inspectBrowserWallet(directory);}
  catch(e) {connection={state:launch?.state==='LISTENING'?'UNREACHABLE':launch?.state??'NOT_STARTED',
    code:e instanceof WalletError?e.code:'WALLET_NOT_RUNNING'};}
  return {state:'INSPECTED',walletId:config.walletId,directory,network:config.network,payer:config.payer,
    operation:config.operation,body:config.body,sourceBuyerConfig:config.sourceBuyerConfig,
    sourceBuyerSha256:config.sourceBuyerSha256,buyerSha256:config.buyerSha256,
    connection,requests:counts,instanceId:launch?.instanceId,createdAt:config.createdAt};
}

/** Load original accounting keys and compare the complete original operation.
 * The accounting reader validates the existing manifest, ledger, policy,
 * transport, payer, and terms without asking the displaced signer for a key.
 */
export async function loadWalletOperator(directory, operatorWorkspace) {
  absolute(operatorWorkspace);
  const config=await readWallet(directory);
  const {openWorkspace}=await import('../../sf88-operator-buyer-cli/workspace.mjs');
  const original=await openWorkspace(['--dir',operatorWorkspace],{accounting:true});
  requireValue(original.configPath===config.sourceBuyerConfig &&
    digest(await readPrivate(original.configPath,65536))===config.sourceBuyerSha256,
  'WALLET_ORIGINAL_OPERATOR_CHANGED');
  const derived=await readJson(config.nativeBuyerConfig,65536);
  requireValue(derived.signerModule===sourceModule &&
    isDeepStrictEqual(derived,{...original.config,signerModule:sourceModule}),
  'WALLET_ORIGINAL_OPERATION_CHANGED');
  const {inspectOperatorConfig}=await import('../operator.mjs');
  const bound=await inspectOperatorConfig(config.nativeSignerConfig);
  requireValue(bound.config.signerProvider===config.provider &&
    bound.config.buyerConfig===config.nativeBuyerConfig &&
    bound.summary.buyerConfigSha256===config.buyerSha256 &&
    bound.expected.payer===config.payer &&
    isDeepStrictEqual(bound.expected.operation,config.operation) &&
    isDeepStrictEqual(bound.expected.body,config.body),'WALLET_NATIVE_BUYER_BINDING_CHANGED');
  return {config,original,derived,rpcUrl:bound.rpcUrl};
}

/** A fresh process binds SF103's lazy session to exactly one wallet configuration.
 * Its original terminal, policy, keys, ledger and transport remain in use.
 */
export async function executeWalletOperation({directory,operatorWorkspace,signal}={}) {
  const {config}=await loadWalletOperator(directory,operatorWorkspace);
  requireValue(signal===undefined || signal instanceof AbortSignal,'WALLET_ABORT_SIGNAL_INVALID');
  requireValue(!signal?.aborted,'WALLET_EXECUTION_ABORTED');
  const child=spawn(process.execPath,[fileURLToPath(new URL('./execute.mjs',import.meta.url)),
    '--workspace',directory,'--operator-workspace',operatorWorkspace],{
    stdio:'inherit',env:{...process.env,SF103_SIGNER_CONFIG:config.nativeSignerConfig},shell:false,
  });
  const stop=()=>{if(child.exitCode===null && child.signalCode===null) child.kill(signal?.reason==='SIGINT'?'SIGINT':'SIGTERM');};
  signal?.addEventListener('abort',stop,{once:true});
  try {
    return await new Promise((resolve,reject)=>{
      child.once('error',()=>reject(new WalletError('WALLET_EXECUTION_START_FAILED')));
      child.once('exit',(exitCode,endedBy)=>resolve({state:exitCode===0?'FINISHED':'ENDED',
        exitCode:exitCode??(endedBy==='SIGINT'?130:endedBy==='SIGTERM'?143:1),signal:endedBy,walletId:config.walletId}));
    });
  } finally {signal?.removeEventListener('abort',stop);}
}
