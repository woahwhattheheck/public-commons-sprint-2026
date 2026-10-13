#!/usr/bin/env node
/** Optional same-operation receiving of actual Chiques originals; no fixture/model run. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const options={};for(let i=2;i<process.argv.length;i+=2){assert(process.argv[i].startsWith('--')&&process.argv[i+1],'Use --name value pairs');options[process.argv[i].slice(2)]=process.argv[i+1];}
for(const key of ['workspace','recipient','operation','source','guard-fd'])assert(options[key],'Supply --'+key);
const root=path.resolve(options.operation),application=fileURLToPath(new URL('../../',import.meta.url));
const selectedWorkspace=path.resolve(options.workspace),selectedRecipient=path.resolve(options.recipient);
const inside=(a,b)=>a===b||a.startsWith(b+path.sep);
assert(!inside(selectedWorkspace,selectedRecipient)&&!inside(selectedRecipient,selectedWorkspace),'Keep original author and independent recipient at separate non-nested paths');
const hash=b=>createHash('sha256').update(b).digest('hex'),json=x=>JSON.stringify(x,null,2)+'\n';
const guard=await fs.stat('/proc/self/fd/'+Number(options['guard-fd'])),guardFile=await fs.stat(path.join(root,'receiving.lock'));
assert.equal(guard.ino,guardFile.ino);assert.equal(guard.dev,guardFile.dev);
async function syncDir(dir){const f=await fs.open(dir,'r');try{await f.sync();}finally{await f.close();}}
async function mkdir(dir){try{await fs.mkdir(dir,{mode:0o700});}catch(e){if(e.code==='ENOENT'){await mkdir(path.dirname(dir));await mkdir(dir);return;}if(e.code!=='EEXIST')throw e;}const st=await fs.lstat(dir);assert(st.isDirectory()&&!st.isSymbolicLink(),'Retain an ordinary original output directory: '+dir);await syncDir(dir);await syncDir(path.dirname(dir));}
async function exact(name,value){
 const target=path.join(root,name),data=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:json(value));await mkdir(path.dirname(target));
 try{const old=await fs.readFile(target);assert.deepEqual(old,data,'Retained complete output differs: '+name);}
 catch(e){if(e.code!=='ENOENT')throw e;const temporary=target+'.partial-'+randomUUID(),h=await fs.open(temporary,'wx',0o600);try{await h.writeFile(data);await h.sync();}finally{await h.close();}
  try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await fs.readFile(target),data);}finally{await fs.unlink(temporary);}
 }
 const file=await fs.open(target,'r');try{await file.sync();}finally{await file.close();}await syncDir(path.dirname(target));return {path:name,bytes:data.length,sha256:hash(data)};
}
async function retained(name){try{return JSON.parse(await fs.readFile(path.join(root,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const originalStat=await fs.lstat(selectedWorkspace);assert(originalStat.isDirectory()&&!originalStat.isSymbolicLink(),'Borrow an existing original author workspace directory');
await mkdir(selectedRecipient);
const workspacePath=await fs.realpath(selectedWorkspace),recipientPath=await fs.realpath(selectedRecipient);
assert(!inside(workspacePath,recipientPath)&&!inside(recipientPath,workspacePath),'The author and recipient must be physically distinct, non-nested original workspaces');
const sourceFiles=new Map();
async function sourceClosure(file){
 const absolute=path.resolve(file);if(sourceFiles.has(absolute))return;
 assert(absolute.startsWith(application+path.sep),'Original source import escaped the application');
 const raw=await fs.readFile(absolute),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
 sourceFiles.set(absolute,{path:path.relative(application,absolute),bytes:raw.length,sha256:hash(raw),content:text});
 for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g))await sourceClosure(path.resolve(path.dirname(absolute),match[1]));
}
await sourceClosure(fileURLToPath(import.meta.url));
await sourceClosure(fileURLToPath(new URL('./run-chiques-nutrients.py',import.meta.url)));
for(const file of ['../engine/workspace.mjs','../engine/chiques_nutrient_workspace.mjs','../engine/collections.mjs','../engine/cli.mjs'])await sourceClosure(fileURLToPath(new URL(file,import.meta.url)));
async function verifySource(){for(const [file,row]of sourceFiles)assert.equal(hash(await fs.readFile(file)),row.sha256,'Selected full source changed: '+row.path);}
await exact('complete-source.json',[...sourceFiles.values()]);
const engine=await import('../engine/chiques_nutrients.mjs'),service=await import('../engine/chiques_nutrient_workspace.mjs'),collections=await import('../engine/collections.mjs');
const {MeasurementWorkspace}=await import('../engine/workspace.mjs'),{stable}=await import('../engine/normalise.mjs');await verifySource();
const sourceBytes=await fs.readFile(path.resolve(options.source)),sourcePacket=JSON.parse(sourceBytes),attachments=[];
if(options.companions){const manifest=path.resolve(options.companions),list=JSON.parse(await fs.readFile(manifest,'utf8'));assert(Array.isArray(list));for(const selected of list){const file=path.resolve(path.dirname(manifest),selected),bytes=await fs.readFile(file);attachments.push({name:path.basename(file),bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')});}}
const selection={operation:'ECO-CHIQUES-NUTRIENT-SOURCES-RD12-20261013',workspace:workspacePath,recipient:recipientPath,sourceFile:path.resolve(options.source),sourceBytes:sourceBytes.length,sourceSha256:hash(sourceBytes),attachments:attachments.map(({base64,...f})=>f),sourceFiles:[...sourceFiles.values()].map(({content,...f})=>f)};
await exact('selection.json',selection);await exact('original-source-transfer.json',sourceBytes);await exact('original-companions.json',attachments);
const first=engine.prepareChiquesNutrients({sourcePacket}),final=engine.prepareChiquesNutrients({sourcePacket,attachments});
assert.equal(first.report.tables[0].rows.length,37);assert.equal(first.report.tables[1].rows.length,43);
assert.equal(first.imports.reduce((n,i)=>n+i.rows,0),240);assert.equal(first.report.tables.reduce((n,t)=>n+t.summary.missingValues,0),6);
assert.deepEqual(final.imports,first.imports,'Optional originals must retain native table identities');
for(const a of first.collection.files.filter(f=>f.kind==='wqp'))assert.deepEqual(final.collection.files.find(f=>f.path===a.path),a);
await exact('initial-preparation.json',first);await exact('final-preparation.json',final);
let w=new MeasurementWorkspace(workspacePath);const files=[];
try{
 let before=await retained('original-workspace-before.json');if(!before){before=w.portable();await exact('original-workspace-before.json',before);}
 const firstPreview=service.chiquesOperation(w,'POST',['preview'],{preparation:first});
 const selectedPreview=service.chiquesOperation(w,'POST',['preview'],{preparation:final});
 const request={preparation:final,expectedId:selectedPreview.preview.id};
 await exact('selected-request.json',request);
 const sizes=await retained('complete-request-sizes.json')||{initialPreviewBytes:Buffer.byteLength(json(firstPreview)),finalPreviewBytes:Buffer.byteLength(json(selectedPreview)),receiveRequestBytes:Buffer.byteLength(json(request)),sourceOriginalBytes:final.report.files.reduce((n,f)=>n+f.bytes,0)};
 assert.equal(sizes.receiveRequestBytes,Buffer.byteLength(json(request)),'Retained selected request size differs');
 assert(sizes.receiveRequestBytes<=128*1024*1024,'Actual request exceeds the original HTTP route');await exact('complete-request-sizes.json',sizes);
 service.chiquesOperation(w,'POST',['receive'],{preparation:first,expectedId:firstPreview.preview.id});
 const revisionBeforeCompanions=w.revision();
 const received=service.chiquesOperation(w,'POST',['receive'],request);
 assert.equal(received.id,selectedPreview.preview.id);assert(received.complete);assert.equal(w.revision(),revisionBeforeCompanions,'Later companions must not re-import unchanged native tables');
 const accepted=w.portable(),priorAccepted=await retained('accepted-workspace.json');
 if(priorAccepted)assert.deepEqual({...accepted,createdAt:''},{...priorAccepted,createdAt:''},'Original accepted workspace advanced; retain current work and inspect before another course');
 files.push(await exact('accepted-workspace.json',priorAccepted||accepted));
 // Accepted whole output is retained before cold receiving or browser work.
 for(const [name,rows]of Object.entries(before.tables)){
  if(name==='events')assert.deepEqual(accepted.tables.events.slice(0,rows.length),rows);
  else if(name==='stations'){for(const row of rows){const next=accepted.tables.stations.find(x=>x.id===row.id);assert(next,'Original station disappeared');const old=JSON.parse(row.data),now=JSON.parse(next.data);for(const [key,value]of Object.entries(old))if(key==='sourceImports'){for(const id of value)assert(now.sourceImports.includes(id));}else assert.deepEqual(now[key],value,'Original station metadata changed: '+key);}}
  else{const current=new Set(accepted.tables[name].map(stable));for(const row of rows)assert(current.has(stable(row)),'Original '+name+' row changed');}
 }
 assert.deepEqual(accepted.tables.reviews,before.tables.reviews,'Source receiving must not choose scientific review outcomes');
 assert.deepEqual(accepted.tables.mappings,before.tables.mappings);assert.deepEqual(accepted.tables.selected_versions,before.tables.selected_versions);
 const replayRevision=w.revision();service.chiquesOperation(w,'POST',['receive'],request);assert.equal(w.revision(),replayRevision);
 const view=service.readChiquesCollection(w,received.id);assert.deepEqual(view.preparation,final);
 const edition=collections.publishCollection(w,received.id);await exact('selected-edition.json',edition);
 const bundle=collections.editionBundle(w,received.id,edition.id),bytes=Buffer.from(bundle.base64,'base64');assert.equal(bytes.length,bundle.bytes);assert.equal(hash(bytes),bundle.sha256);
 files.push(await exact('complete-study.zip',bytes));
 const projectMember=collections.editionMember(w,received.id,edition.id,'project.json');files.push(await exact('independent-project.json',projectMember.data));
 for(const name of ['nutrient-source-review.json','nutrient-source-diagnostics.csv','nutrient-source-review.html'])files.push(await exact(name,final.collection.files.find(f=>f.path===name).text));
 const native={...selection,status:'NATIVE_COMPLETE',collectionId:received.id,initialCollectionId:firstPreview.preview.id,editionId:edition.id,requestSha256:hash(json(request)),sourceIdentity:final.sourceIdentity,sizes,rows:240,originalSampleRows:80,missingValues:6,companions:attachments.map(x=>x.name),files};
 await exact('NATIVE_COMPLETE.json',native);
}finally{w.close();}
w=new MeasurementWorkspace(workspacePath);
try{
 const native=await retained('NATIVE_COMPLETE.json'),view=service.readChiquesCollection(w,native.collectionId);assert.deepEqual(view.preparation,final);
 const original=JSON.parse(await fs.readFile(path.join(root,'independent-project.json'),'utf8')),recipient=new MeasurementWorkspace(recipientPath);
 try{
  if(!recipient.summary().imports.length)recipient.receive(original);
  const current=recipient.portable();
  for(const [name,rows]of Object.entries(original.tables)){if(name==='events'){assert.deepEqual(current.tables.events.slice(0,rows.length),rows);assert.equal(current.tables.events.length,rows.length+1);assert.equal(current.tables.events.at(-1).kind,'receive');}else assert.deepEqual(current.tables[name],rows,'Independent original '+name+' differs');}
  assert.deepEqual(current.intake,original.intake);
  const before=recipient.revision();service.chiquesOperation(recipient,'POST',['receive'],{preparation:final,expectedId:native.collectionId});assert.equal(recipient.revision(),before);
  assert.deepEqual(service.readChiquesCollection(recipient,native.collectionId).preparation,final);
  files.push(await exact('independent-received-source.json',{collectionId:native.collectionId,sourceIdentity:final.sourceIdentity,revision:recipient.revision()}));
 }finally{recipient.close();}
 await verifySource();
 const completion={...native,status:'NATIVE_AND_COLD_COMPLETE',files:[...native.files,...files.filter(f=>!native.files.some(p=>p.path===f.path))],browser:'Run the original installed UI on these same collection IDs; rendered use is not asserted by this API course.'};
 await exact('COMPLETE.json',completion);process.stdout.write(json(completion));
}finally{w.close();}
