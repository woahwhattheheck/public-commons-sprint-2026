#!/usr/bin/env node
// SF101 read-only merchant account readiness CLI. Node 22+, no dependencies.
import { readFile, mkdir, open, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateSnapshots, fetchOfficialSnapshots, reportHtml, reportCsv, validateGAddress } from './readiness.mjs';

function err(code, message) { const e = new Error(message || code); e.code = code; throw e; }
function argsOf(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k?.startsWith('--') || i+1>=argv.length || argv[i+1].startsWith('--') || k in result) err('INVALID_ARGS', 'Each unique --key requires a value');
    result[k.slice(2)] = argv[i+1];
  }
  const allowed = new Set(['network','account','asset','asset-code','asset-issuer','amount','ops','account-file','ledger-file','out','timeout-ms']);
  for (const k of Object.keys(result)) if (!allowed.has(k)) err('INVALID_ARGS','Unknown flag --'+k);
  return result;
}
function sha(data) { return createHash('sha256').update(data).digest('hex'); }
async function readSnapshot(file) {
  const path = resolve(file);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 262_144) err('INVALID_SNAPSHOT_FILE','Require an ordinary JSON file <=256KiB');
  const raw = await readFile(path,'utf8');
  let json;
  try { json = JSON.parse(raw); } catch { err('INVALID_SNAPSHOT_JSON'); }
  return {json,source:{sourcePath:path,sha256:sha(raw),bytes:Buffer.byteLength(raw)}};
}
async function createOnly(path, content) {
  const h = await open(path,'wx',0o600);
  try { await h.writeFile(content,'utf8'); await h.sync(); } finally { await h.close(); }
}
async function emit(outDir, report, source) {
  const dir=resolve(outDir);
  try { await mkdir(dir,{mode:0o700}); } catch(e) { if(e.code !== 'EEXIST') throw e; }
  const stat=await lstat(dir);
  if(!stat.isDirectory() || stat.isSymbolicLink()) err('INVALID_OUTPUT_DIR','Output must be a normal directory');
  const files = {
    'readiness.json':JSON.stringify(report,null,2)+'\n',
    'review.html':reportHtml(report),
    'review.csv':reportCsv(report),
  };
  // A preexisting manifest means this run must not change the bundle.
  let gate;
  try { gate=await open(join(dir,'manifest.json'),'wx',0o600); }
  catch(e) { if(e.code==='EEXIST') err('OUTPUT_EXISTS','Manifest exists; choose a new directory'); throw e; }
  const metadata={schema:'stellar-forge.sf101.bundle.v1',generatedAt:report.observedAt,
    source:{account:source.account,ledger:source.ledger},
    files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,{sha256:sha(v),bytes:Buffer.byteLength(v)}])),
  };
  try {
    for (const [name,value] of Object.entries(files)) await createOnly(join(dir,name),value);
    await gate.writeFile(JSON.stringify(metadata,null,2)+'\n','utf8');
    await gate.sync();
  } finally { await gate.close(); }
  return {directory:dir,manifest:join(dir,'manifest.json'),files:Object.keys(files)};
}

async function main() {
  const a=argsOf(process.argv.slice(2));
  if (!a.account || !a.network || !a.amount || !a.out) err('REQUIRED_ARGS','--account --network --amount --out required');
  validateGAddress(a.account);
  if(!['testnet','public'].includes(a.network)) err('INVALID_NETWORK','--network testnet|public');
  const asset = a.asset === 'native' ? 'native' : {code:a['asset-code'],issuer:a['asset-issuer']};
  if ((a.asset === 'native') === Boolean(a['asset-code']||a['asset-issuer'])) err('INVALID_ASSET_ARGS','Provide --asset native OR --asset-code and --asset-issuer');
  if (asset !== 'native' && (!asset.code || !asset.issuer)) err('INVALID_ASSET_ARGS');
  const n = a.ops === undefined ? 10 : Number(a.ops);
  const both=Boolean(a['account-file'] && a['ledger-file']);
  if(Boolean(a['account-file']) !== Boolean(a['ledger-file'])) err('INVALID_SNAPSHOT_PAIR','Both --account-file and --ledger-file required together');
  if (a['timeout-ms'] && both) err('INVALID_ARGS','Timeout only applies to live request');
  let account,ledgerEnvelope,source,mode;
  if(both) {
    const ac=await readSnapshot(a['account-file']);
    const le=await readSnapshot(a['ledger-file']);
    account=ac.json;ledgerEnvelope=le.json;
    source={account:ac.source,ledger:le.source};mode='offline';
  } else {
    const live=await fetchOfficialSnapshots({accountId:a.account,network:a.network,
      timeoutMs:a['timeout-ms']===undefined?12000:Number(a['timeout-ms'])});
    ({account,ledgerEnvelope}=live);
    source=live.source;mode='live';
  }
  const report=evaluateSnapshots({account,ledgerEnvelope,accountId:a.account,network:a.network,asset,
    inboundAmount:a.amount,feeOperations:n,mode});
  const bundle=await emit(a.out,report,source);
  process.stdout.write(JSON.stringify({status:report.status,reasons:report.reasons,mode:report.mode,
    bundle:bundle.directory,source:report.officialHorizon},null,2)+'\n');
  process.exitCode=report.status==='ACTION_REQUIRED'?2:report.status==='REVIEW'?1:0;
}
main().catch(error => {console.error((error.code||'SF101_FAILED')+': '+error.message);process.exitCode=3;});
