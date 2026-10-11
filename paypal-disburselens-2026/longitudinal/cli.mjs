#!/usr/bin/env node
// MIT. Explicit read-only PayPal sandbox capture plus private local lifecycle comparison.
import {readFile,writeFile,mkdir,stat,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeSnapshots,validateSnapshot} from './analysis.mjs';
import {renderCSV,renderHTML} from './render.mjs';
import {fetchBatch} from '../src/paypal.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SCHEMA='disburselens-payout-snapshot/v1';
const help=[
  'DisburseLens lifecycle operator; PayPal Payouts v1 READ-ONLY sandbox only.',
  '  capture --batch EXISTING_BATCH_ID --out NEW_PRIVATE_JSON_FILE',
  '  compare --before SNAPSHOT_JSON --after SNAPSHOT_JSON --out NEW_PRIVATE_DIR [--stale-hours 24]',
  '  demo --out NEW_PRIVATE_DIR  # Original fictional sample, no PayPal calls',
  'No hosted jobs, no payout/refund/approval execution.'
].join('\n');
function options(argv,required,allowed){
  const map=new Map();
  if(argv.length%2!==0)throw new Error(help);
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i];
    if(!allowed.includes(k)||map.has(k)||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(help);
    map.set(k,argv[i+1]);
  }
  for(const k of required)if(!map.has(k))throw new Error('Missing '+k+'\n'+help);
  return map;
}
function digest(data){return createHash('sha256').update(data).digest('hex');}
function freshStamp(){return new Date().toISOString();}
async function writeNew(path,data){
  await writeFile(resolve(path),data,{flag:'wx',mode:0o600});
}
async function privateDirectory(path){
  // Never write into an old report directory or replace an operator's outputs.
  await mkdir(resolve(path),{recursive:false,mode:0o700});
}
async function readSnapshot(path){
  const target=resolve(path),meta=await lstat(target);
  if(!meta.isFile()||meta.isSymbolicLink()||meta.size>5_000_000)throw new Error('Snapshot must be a regular file up to 5 MB');
  const data=await readFile(target,'utf8');
  const parsed=JSON.parse(data);
  validateSnapshot(parsed);
  return {data,parsed};
}
async function capture(argv){
  const opts=options(argv,['--batch','--out'],['--batch','--out']);
  const batch=opts.get('--batch'),destination=resolve(opts.get('--out'));
  if(!/^[A-Za-z0-9_-]{3,64}$/.test(batch))throw new Error('Invalid batch ID');
  const pages=await fetchBatch(batch); // Existing official sandbox client, GET only.
  const snapshot={schema:SCHEMA,source:'PayPal sandbox read-only API',
    capturedAt:freshStamp(),pages};
  validateSnapshot(snapshot); // Original full-page reconciliation BEFORE private write.
  await writeNew(destination,JSON.stringify(snapshot,null,2)+'\n');
  process.stdout.write(JSON.stringify({captured:true,batchId:batch,source:snapshot.source,
    pageCount:pages.length,privateFile:destination,
    evidenceSha256:digest(JSON.stringify(pages))})+'\n');
}
async function compare(argv){
  const opts=options(argv,['--before','--after','--out'],
    ['--before','--after','--out','--stale-hours']);
  const baseline=await readSnapshot(opts.get('--before'));
  const followup=await readSnapshot(opts.get('--after'));
  const staleHours=opts.has('--stale-hours')?Number(opts.get('--stale-hours')):24;
  const result=analyzeSnapshots({before:baseline.parsed,after:followup.parsed,staleHours});
  const out=resolve(opts.get('--out'));
  if([resolve(opts.get('--before')),resolve(opts.get('--after'))].some(p=>p.startsWith(out+'/'))){
    throw new Error('Report directory must not contain the original snapshot inputs');
  }
  await privateDirectory(out);
  const files={
    'report.json':JSON.stringify(result,null,2)+'\n',
    'review.csv':renderCSV(result),
    'review.html':renderHTML(result)
  };
  for(const [name,data] of Object.entries(files))await writeNew(resolve(out,name),data);
  const manifest={
    schema:'disburselens-lifecycle-export/v1',
    source:result.source,batchId:result.batchId,
    inputCaptureSha256:{baseline:digest(baseline.data),followup:digest(followup.data)},
    sourcePageEvidenceSha256:result.originalEvidence,
    outputs:Object.fromEntries(Object.entries(files).map(([name,data])=>[name,digest(data)])),
    counts:result.counts,batchFlags:result.batchFlags
  };
  await writeNew(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  process.stdout.write(JSON.stringify({ok:true,out,source:result.source,
    batchId:result.batchId,counts:result.counts,batchFlags:result.batchFlags})+'\n');
}
async function demo(argv){
  const opts=options(argv,['--out'],['--out']);
  const original=JSON.parse(await readFile(resolve(ROOT,'fixtures/payout_batch.json'),'utf8'));
  const before=structuredClone(original),after=structuredClone(original);
  after.items.find(x=>x.payout_item_id==='ITEM-001').transaction_status='REVERSED';
  after.items.find(x=>x.payout_item_id==='ITEM-003').transaction_status='SUCCESS';
  const source='fictional example';
  const first={schema:SCHEMA,source,capturedAt:'2026-10-09T09:00:00.000Z',pages:[before]};
  const second={schema:SCHEMA,source,capturedAt:'2026-10-11T09:00:00.000Z',pages:[after]};
  validateSnapshot(first);validateSnapshot(second);
  const out=resolve(opts.get('--out'));
  await privateDirectory(out);
  await writeNew(resolve(out,'before.json'),JSON.stringify(first,null,2)+'\n');
  await writeNew(resolve(out,'after.json'),JSON.stringify(second,null,2)+'\n');
  process.stdout.write(JSON.stringify({ok:true,source,privateDirectory:out,
    compareCommand:'node paypal-disburselens-2026/longitudinal/cli.mjs compare --before '+
      resolve(out,'before.json')+' --after '+resolve(out,'after.json')+
      ' --out '+resolve(out,'review')})+'\n');
}
export async function main(args=process.argv.slice(2)){
  const [mode,...argv]=args;
  if(mode==='capture')return capture(argv);
  if(mode==='compare')return compare(argv);
  if(mode==='demo')return demo(argv);
  throw new Error(help);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write('DisburseLens lifecycle: '+String(error.message||error)+'\n');process.exitCode=1;});
}
