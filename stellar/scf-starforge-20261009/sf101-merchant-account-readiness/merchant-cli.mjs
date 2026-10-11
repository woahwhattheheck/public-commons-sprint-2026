#!/usr/bin/env node
// MIT. Private merchant receiving review and exact-source replay.
import {readFile,lstat,mkdir,open,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectMerchantReceiving,compareMerchantReadiness,merchantReadinessHtml,merchantReadinessCsv} from './merchant.mjs';
import {fault} from './native-reader.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const USAGE = `Usage: node merchant-cli.mjs --config SELLER_JSON --out NEW_PRIVATE_DIRECTORY
       [--origin ACTUAL_LOOPBACK_ORIGIN] [--rpc-testnet HTTPS_URL] [--rpc-public HTTPS_URL]
       [--timeout-ms 12000] [--ops 10] [--previous PRIOR_BUNDLE_DIRECTORY]
       [--from-capture PRIOR_BUNDLE_DIRECTORY]

Uses the original SF30 seller compiler, native Stellar SDK reads and SF101 account calculator.
Each payment alternative retains its original atomic amount, asset, network and recipient.
--from-capture reopens the original recorded requests from a verified previous bundle.
The existing single-account classic command remains cli.mjs.`;

function parse(argv) {
  const result = {};
  const allowed = new Set(['config','out','origin','rpc-testnet','rpc-public','timeout-ms','ops','previous','from-capture']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (!argv[i]?.startsWith('--') || !allowed.has(key) || Object.hasOwn(result,key) ||
      i+1 >= argv.length || argv[i+1].startsWith('--')) throw fault('INVALID_ARGUMENTS',USAGE);
    result[key] = argv[i+1];
  }
  if (!result.config || !result.out) throw fault('REQUIRED_ARGUMENTS',USAGE);
  return result;
}
async function jsonFile(path,limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw fault('INVALID_INPUT_FILE');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw fault('INPUT_FILE_TOO_LARGE');
  return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),bytes};
}
export async function readReceivingBundle(directory,filename) {
  if (!['capture.json','report.json'].includes(filename)) throw fault('INVALID_BUNDLE_FILE');
  const path = resolve(directory), manifest = (await jsonFile(join(path,'manifest.json'),65536)).value;
  if (manifest.schema !== 'stellar-forge.sf101.merchant-bundle.v1') throw fault('BUNDLE_SCHEMA_MISMATCH');
  const file = await jsonFile(join(path,filename),80 * 1024 * 1024);
  if (manifest.files?.[filename]?.sha256 !== hash(file.bytes) || manifest.files[filename].bytes !== file.bytes.length)
    throw fault('BUNDLE_FILE_DIGEST_MISMATCH');
  return file.value;
}

export async function writeReceivingBundle(directory,{plan,report,capture}) {
  const path = resolve(directory);
  const files = {
    'plan.json':JSON.stringify(plan,null,2)+'\n',
    'report.json':JSON.stringify(report,null,2)+'\n',
    'options.csv':merchantReadinessCsv(report),
    'review.html':merchantReadinessHtml(report),
    'capture.json':JSON.stringify(capture,null,2)+'\n',
  };
  const manifest = {schema:'stellar-forge.sf101.merchant-bundle.v1',observedAt:report.observedAt,
    planSha256:plan.planSha256,configurationSha256:plan.configuration.sha256,mode:report.mode,
    files:Object.fromEntries(Object.entries(files).map(([name,value]) => [name,{bytes:Buffer.byteLength(value),sha256:hash(value)}]))};
  await mkdir(path,{mode:0o700}); // Existing output is preserved; one directory per review.
  try {
    for (const [name,value] of [...Object.entries(files),['manifest.json',JSON.stringify(manifest,null,2)+'\n']]) {
      const handle = await open(join(path,name),'wx',0o600);
      try { await handle.writeFile(value,'utf8'); await handle.sync(); } finally { await handle.close(); }
    }
  } catch (error) {
    await rm(path,{recursive:true,force:true}); // Only the directory this invocation just created.
    throw error;
  }
  return {directory:path,manifestSha256:hash(JSON.stringify(manifest,null,2)+'\n'),files:Object.keys(manifest.files)};
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { console.log(USAGE); return; }
  const args = parse(argv);
  let capture, endpoints = {};
  if (args['from-capture']) {
    if (args['rpc-testnet'] || args['rpc-public']) throw fault('CAPTURE_RETAINS_ORIGINAL_ENDPOINTS');
    capture = await readReceivingBundle(args['from-capture'],'capture.json');
    endpoints = capture.endpoints ?? {};
  } else {
    if (args['rpc-testnet']) endpoints['stellar:testnet'] = args['rpc-testnet'];
    if (args['rpc-public']) endpoints['stellar:pubnet'] = args['rpc-public'];
  }
  const result = await inspectMerchantReceiving({configPath:args.config,origin:args.origin,endpoints,capture,
    timeoutMs:args['timeout-ms'] === undefined ? 12000 : Number(args['timeout-ms']),
    feeOperations:args.ops === undefined ? 10 : Number(args.ops)});
  if (args.previous) result.report.comparison = compareMerchantReadiness(
    await readReceivingBundle(args.previous,'report.json'),result.report);
  const bundle = await writeReceivingBundle(args.out,result);
  console.log(JSON.stringify({mode:result.report.mode,...result.report.summary,bundle},null,2));
  process.exitCode = result.report.summary.statusCounts.ACTION_REQUIRED ? 2 : result.report.summary.statusCounts.REVIEW ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error((error.code ?? 'MERCHANT_READINESS_FAILED')+': '+error.message); process.exitCode = 3; });
}
