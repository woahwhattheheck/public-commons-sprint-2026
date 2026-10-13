#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {disclosure as model} from './disclosure.mjs';
const usage='Commands:\n  node cli.mjs mapping OUTPUT.json\n  node cli.mjs ingest SOURCE.csv META.json OUTPUT.json [EXISTING.json]\n  node cli.mjs inspect WORKSPACE.json [SNAPSHOT_ID]\n  node cli.mjs export WORKSPACE.json NEW_DIRECTORY [SNAPSHOT_ID]\nMETA.json: format, url, retrievedAt, representation, scope, population, mapping; optional expectedRows/completenessNote.\n';
const read=async p=>{const b=await fs.readFile(p);if(b.length>128*1024*1024)throw Error('Input exceeds 128 MiB.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);};
async function writeNew(file,text){const folder=path.dirname(path.resolve(file));const temp=path.join(folder,'.disclosure-'+process.pid+'-'+Date.now()+'.tmp');let made=false;try{await fs.writeFile(temp,text,{encoding:'utf8',flag:'wx'});made=true;await fs.link(temp,file);}finally{if(made)await fs.unlink(temp);}}
async function run(){
 const [command,...a]=process.argv.slice(2);
 if(command==='mapping'&&a.length===1){await writeNew(a[0],JSON.stringify(model.eitiMapping,null,2)+'\n');return;}
 if(command==='ingest'&&(a.length===3||a.length===4)){
  const [source,metaFile,out,existing]=a,meta=JSON.parse((await read(metaFile)).replace(/^\uFEFF/,''));
  const old=existing?model.reopen(await read(existing)):model.create({title:meta.title||'Public disclosure handover',createdAt:new Date().toISOString()});
  const result=model.addSource(old,{...meta,content:await read(source)});await writeNew(out,model.serialize(result.workspace));
  process.stdout.write(JSON.stringify({output:out,snapshotId:result.snapshotId,replayed:result.replayed,profile:summary(model.profile(result.workspace,result.snapshotId))},null,2)+'\n');return;
 }
 if(command==='inspect'&&(a.length===1||a.length===2)){const state=model.reopen(await read(a[0]));process.stdout.write(JSON.stringify(summary(model.profile(state,a[1]||state.selected)),null,2)+'\n');return;}
 if(command==='export'&&(a.length===2||a.length===3)){
  const state=model.reopen(await read(a[0])),id=a[2]||state.selected,p=model.profile(state,id),s=model.source(state,id),dir=a[1];
  const outputs={'workspace.json':model.serialize(state),'profile.json':JSON.stringify(p),'observations.csv':model.exportObservations(state,id),'review-history.json':JSON.stringify({snapshotId:id,sourceSha256:p.sourceSha256,reviews:p.reviews}),'review-history.csv':model.exportReviews(state,id),['original-source.'+(s.format==='csv'?'csv':'json')]:s.content,'source-metadata.json':JSON.stringify({identity:s.identity,metadata:s.metadata,mapping:s.mapping},null,2)+'\n'};
  await fs.mkdir(dir,{recursive:false});
  for(const [name,content]of Object.entries(outputs))await fs.writeFile(path.join(dir,name),content,{encoding:'utf8',flag:'wx'});
  process.stdout.write(JSON.stringify({directory:dir,files:Object.keys(outputs),sourceSha256:s.identity.sha256},null,2)+'\n');return;
 }
 throw Error(usage);
}
function summary(p){const {observations,repeatedKeys,...out}=p;return {...out,repeatedKeys};}
run().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
