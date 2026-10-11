#!/usr/bin/env node
// MIT. Private merchant receiving review over original source and public reads.
import { readFile, open, mkdir, rm, stat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reviewSellerSacReadiness, merchantReadinessHtml, merchantReadinessCsv } from './merchant.mjs';
import { sha256 } from './readiness.mjs';

const HELP = `Usage: node merchant-cli.mjs --config SELLER_JSON --asset-map ASSET_MAP_JSON --out NEW_PRIVATE_DIRECTORY
  [--rpc-map RPC_MAP_JSON] [--https-proxy-env ENV_NAME] [--timeout-ms 12000] [--fee-operations 0]

Reviews every configured SF30 payment option against its exact StellarAssetContract
and the original Horizon receiving checks. Testnet defaults to official Stellar RPC;
public-network or provider RPC endpoints are selected in --rpc-map.
Writes review.json, review.html, options.csv and manifest.json, then prints the result.
Exit 0: all recipients ready. Exit 2: merchant action/configuration needed.
Exit 1: provider read failed. Exit 3: invalid input or output failure.
Guide: MERCHANT_READINESS.md`;

async function jsonInput(path) {
  const absolute = resolve(path), info = await stat(absolute);
  if (!info.isFile() || info.size > 1024*1024) throw new Error('INPUT_MUST_BE_JSON_FILE_UNDER_1_MIB');
  const bytes = await readFile(absolute);
  if (bytes.length > 1024*1024) throw new Error('INPUT_TOO_LARGE');
  return {json:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),
    source:{path:absolute,bytes:bytes.length,sha256:sha256(bytes)}};
}

/** Reuse the original explicit CONNECT/TLS transport only when requested. */
export async function createReadinessFetch(proxyEnv, {environment = process.env, timeoutMs = 12000} = {}) {
  if (proxyEnv === undefined) return globalThis.fetch;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(proxyEnv) || typeof environment[proxyEnv] !== 'string')
    throw new Error('EXPLICIT_PROXY_ENVIRONMENT_REQUIRED');
  const {createPublicHttpsFetch,normalizeBuyerTransport,resolveBuyerProxy} = await import('../sf31-buyer-client/public-transport.mjs');
  // Resolve this caller's environment now; the original transport receives the
  // same verified proxy URL and retains the exact target origin/TLS identity.
  const transports = new Map();
  return (url, init) => {
    const origin = new URL(url).origin;
    if (!transports.has(origin)) {
      const profile = normalizeBuyerTransport({mode:'explicit-connect',origin,proxyEnv});
      resolveBuyerProxy(profile,environment);
      transports.set(origin,createPublicHttpsFetch({timeoutMs,
        trustedProxy:{mode:'explicit-connect',origin,proxyUrl:environment[proxyEnv]}}));
    }
    return transports.get(origin)(url,init);
  };
}

export async function writeMerchantReview(directory, report, sources) {
  if (!isAbsolute(directory) || resolve(directory) !== directory) throw new Error('ABSOLUTE_NORMALIZED_OUTPUT_REQUIRED');
  // Own the directory only after this exclusive creation succeeds.
  await mkdir(directory,{mode:0o700});
  try {
    const files = {'review.json':JSON.stringify(report,null,2)+'\n','review.html':merchantReadinessHtml(report),
      'options.csv':merchantReadinessCsv(report)};
    const manifest = {schema:'stellar-forge.merchant-readiness-manifest.v1',createdAt:new Date().toISOString(),
      sources,planDigest:report.planDigest,files:Object.entries(files).map(([name,text])=>
        ({name,bytes:Buffer.byteLength(text),sha256:sha256(text)}))};
    files['manifest.json'] = JSON.stringify(manifest,null,2)+'\n';
    for (const [name,text] of Object.entries(files)) {
      const handle = await open(join(directory,name),'wx',0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    }
    return manifest;
  } catch (error) {
    await rm(directory,{recursive:true,force:true});
    throw error;
  }
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help')) { console.log(HELP); return 0; }
  const values = new Map(), allowed = new Set(['--config','--asset-map','--out','--rpc-map',
    '--https-proxy-env','--timeout-ms','--fee-operations']);
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index]) || values.has(argv[index]) || !argv[index+1] || argv[index+1].startsWith('--'))
      throw new Error('INVALID_COMMAND_ARGUMENT');
    values.set(argv[index],argv[index+1]);
  }
  for (const key of ['--config','--asset-map','--out']) if (!values.has(key)) throw new Error('MISSING_REQUIRED_ARGUMENT');
  const number = (key,fallback) => {
    if (!values.has(key)) return fallback;
    if (!/^(0|[1-9]\d{0,8})$/.test(values.get(key))) throw new Error('INVALID_NUMERIC_ARGUMENT');
    return Number(values.get(key));
  };
  const [seller,assets,rpc] = await Promise.all([jsonInput(values.get('--config')),jsonInput(values.get('--asset-map')),
    values.has('--rpc-map') ? jsonInput(values.get('--rpc-map')) : null]);
  const timeoutMs = number('--timeout-ms',12000), feeOperations = number('--fee-operations',0);
  const fetchImpl = await createReadinessFetch(values.get('--https-proxy-env'),{timeoutMs});
  const report = await reviewSellerSacReadiness(seller.json,{assetMap:assets.json,rpcEndpoints:rpc?.json ?? {},
    timeoutMs,feeOperations,fetchImpl});
  const output = values.get('--out');
  await writeMerchantReview(output,report,{seller:seller.source,assetMap:assets.source,...(rpc ? {rpcMap:rpc.source} : {})});
  console.log(JSON.stringify({status:report.status,...report.summary,output}));
  return report.summary.readFailed ? 1 : report.summary.ready === report.summary.options ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await run(); }
  catch (error) {
    // Provider URLs and bodies may contain credentials. Emit stable codes only.
    const code = error.code ?? error.message;
    console.error(JSON.stringify({error:typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'MERCHANT_READINESS_FAILED'}));
    process.exitCode = 3;
  }
}
