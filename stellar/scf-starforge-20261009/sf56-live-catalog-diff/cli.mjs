#!/usr/bin/env node
// Source-connected, GET-only snapshot exporter and offline review.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzePages, fetchVellar, diffSnapshots, renderReportHtml, PROVIDER } from './catalog.mjs';

function flags(args) {
  const out={};
  for(let i=0;i<args.length;i++) {
    if(!['--input','--before','--after','--out'].includes(args[i]) || !args[i+1]) throw Error(`Unknown or incomplete argument: ${args[i]}`);
    if(out[args[i]]) throw Error(`Duplicate argument: ${args[i]}`);
    out[args[i]]=args[++i];
  }
  return out;
}
const usage = 'Usage: node cli.mjs live --out DIR | inspect --input VELLAR_RAW_JSON --out DIR | compare --before SNAPSHOT_JSON --after SNAPSHOT_JSON --out DIR';
async function loadSnapshot(file) {
  const item=JSON.parse(await readFile(file,'utf8'));
  if(item?.schemaVersion===1) return item;
  if(item?.pages) return analyzePages(item.pages,{source:PROVIDER,capturedAt:item.capturedAt||new Date().toISOString()});
  if(item?.items) return analyzePages([{offset:0,payload:item}],{source:PROVIDER,capturedAt:new Date().toISOString()});
  throw Error('Expected raw vendor items/total, pages, or SF56 snapshot');
}

async function main(argv) {
  const [mode,...rest]=argv;
  const o=flags(rest);
  if(!['live','inspect','compare'].includes(mode)||!o['--out']) throw Error(usage);
  let snapshot, delta=null, capture=null;
  if(mode==='live') {
    if(Object.keys(o).some(k=>k!=='--out')) throw Error(usage);
    const live=await fetchVellar();snapshot=live.snapshot;
    capture={source:PROVIDER,capturedAt:snapshot.capturedAt,pages:live.pages.map(({offset,body})=>({offset,body}))};
  } else if(mode==='inspect') {
    if(!o['--input']||Object.keys(o).some(k=>!['--out','--input'].includes(k))) throw Error(usage);
    const raw=JSON.parse(await readFile(o['--input'],'utf8'));
    snapshot=await loadSnapshot(o['--input']);
    if(raw?.items || raw?.pages) capture=raw;
  } else {
    if(!o['--before']||!o['--after']||Object.keys(o).some(k=>!['--out','--before','--after'].includes(k))) throw Error(usage);
    const before=await loadSnapshot(o['--before']);
    snapshot=await loadSnapshot(o['--after']);
    delta=diffSnapshots(before,snapshot);
  }
  const dir=resolve(o['--out']); await mkdir(dir,{recursive:true});
  await writeFile(resolve(dir,'snapshot.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'w',mode:0o600});
  if(capture) await writeFile(resolve(dir,'capture.json'),JSON.stringify(capture,null,2)+'\n',{flag:'w',mode:0o600});
  if(delta) await writeFile(resolve(dir,'changes.json'),JSON.stringify(delta,null,2)+'\n',{flag:'w',mode:0o600});
  await writeFile(resolve(dir,'review.html'),renderReportHtml(snapshot,delta),{flag:'w',mode:0o600});
  console.log(JSON.stringify({status:'REVIEW_ONLY',mode,files:['snapshot.json',...(capture?['capture.json']:[]),...(delta?['changes.json']:[]),'review.html'],
    declaredTotal:snapshot.declaredTotal,listed:snapshot.offerCount,quarantined:snapshot.quarantinedCount,
    changed:delta?.summary.changed??null,paymentRequests:0,source:snapshot.source,out:dir},null,2));
}
main(process.argv.slice(2)).catch(err=>{console.error(`SF56: ${err.message}`);process.exitCode=1;});
