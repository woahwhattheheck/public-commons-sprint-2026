/** Original native Measurements handover: complete project custody and explicit source selection. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {MeasurementWorkspace} from './workspace.mjs';
import {exportEdition,editionMemberFile,validateReceived} from './large_delivery.mjs';
import {listCollections,readEdition} from './collections.mjs';
import {resultSourceSelection} from './result_handback.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError} from './parse.mjs';
import {CHUNK,identifier,safePath,readJSON,fileDigest,fileChunks,copyVerified,withDirectoryLock,atomicJSON} from './large_io.mjs';

export const HANDOVER_SCHEMA='upper-savannah-measurements-handover/v1';
export const SOURCE_SCHEMA='eco-measurements-source-v1';
export const MAX_HANDOVER_BYTES=384*1024*1024;
const MAX_TEXT=8*1024*1024,MAX_BATCH=64*1024*1024,MAX_PROJECTION=96*1024*1024;
const encoder=v=>JSON.stringify(v,null,2)+'\n';
const fail=(message,status=400)=>{throw new InputError(message,status);};
const need=(condition,message,status=400)=>{if(!condition)fail(message,status);};
const helper=name=>fileURLToPath(new URL(name,import.meta.url));
function python(name,...args){return JSON.parse(execFileSync(process.env.MEASUREMENTS_PYTHON||'python3',[helper(name),...args],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));}
function syncDir(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function durableDir(directory){
 directory=path.resolve(directory);
 if(fs.existsSync(directory)){const st=fs.lstatSync(directory);need(st.isDirectory()&&!st.isSymbolicLink(),'Use an ordinary handover directory');syncDir(directory);syncDir(path.dirname(directory));return;}
 durableDir(path.dirname(directory));fs.mkdirSync(directory,{mode:0o700});syncDir(directory);syncDir(path.dirname(directory));
}
function publish(file,bytes){
 bytes=Buffer.from(bytes);durableDir(path.dirname(file));
 if(fs.existsSync(file)){need(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink()&&fs.readFileSync(file).equals(bytes),'Retained handover file differs',409);const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(file));return;}
 const temporary=file+'.'+randomUUID()+'.pending';let fd;
 try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temporary,file);}catch(error){if(error.code!=='EEXIST'||!fs.readFileSync(file).equals(bytes))throw error;}syncDir(path.dirname(file));
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
function record(file,value){atomicJSON(file,value);syncDir(path.dirname(file));}
function sourceName(value){need(typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f]/.test(value),'Choose a complete saved result identity');return value;}
function selectionRequest(input){
 need(input&&identifier(input.id),'Keep the original handover request identifier');
 need(typeof input.title==='string'&&input.title.trim()&&input.title.length<=200,'Name this complete handover (up to 200 characters)');
 need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,'Keep the reviewed Measurements revision');
 need(Array.isArray(input.collections)&&Array.isArray(input.results),'Choose explicit collection and saved-result lists');
 const collections=input.collections.map(c=>{need(c&&identifier(c.id)&&Array.isArray(c.editions),'Choose a collection and its exact saved editions');const editions=c.editions.map(id=>{need(identifier(id),'Invalid collection edition');return id;});need(new Set(editions).size===editions.length,'A saved edition is selected twice');return {id:c.id,editions:[...editions].sort()};}).sort((a,b)=>a.id.localeCompare(b.id));
 const results=input.results.map(sourceName).sort();
 need(new Set(collections.map(x=>x.id)).size===collections.length&&new Set(results).size===results.length,'Retain distinct explicit selections');
 return {id:input.id,title:input.title.trim(),expectedRevision:input.expectedRevision,collections,results};
}
function rootFor(w,id){need(identifier(id),'Invalid handover identifier');return path.join(w.directory,'.large','handovers',id);}
function mime(name){const ext=path.extname(name).toLowerCase();return ({'.json':'application/json','.jsonl':'application/x-ndjson','.geojson':'application/geo+json','.csv':'text/csv','.tsv':'text/tab-separated-values','.txt':'text/plain','.md':'text/markdown','.html':'text/html','.xml':'application/xml','.zip':'application/zip','.pdf':'application/pdf','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})[ext]||'application/octet-stream';}
function facade(directory){
 const db=new DatabaseSync(path.join(directory,'measurements.sqlite'),{readOnly:true});db.exec('PRAGMA trusted_schema=OFF;PRAGMA query_only=ON');
 const w=Object.create(MeasurementWorkspace.prototype);w.directory=directory;w.db=db;return w;
}
function unpackProject(archive,directory){const manifest=python('./large_archive.py','unpack',archive,directory);const validation=validateReceived(directory);need(validation.revision===manifest.revision,'Original project revision differs');return {manifest,validation};}
function assertEdition(edition,root,revision){
 need(edition?.format==='upper-savannah-measurements-edition/v1'&&identifier(edition.id)&&edition.workspaceRevision===revision&&Array.isArray(edition.files),'Original complete edition identity differs');
 const expected=['project.zip','records.csv','calibration.json','calibration.csv','accepted.jsonl','excluded.jsonl'];
 need(stable(edition.files.map(x=>x.path).sort())===stable(expected.sort()),'Keep every original edition population');
 for(const f of edition.files){const actual=fileDigest(path.join(root,safePath(f.path)));need(actual.bytes===f.bytes&&actual.sha256===f.sha256,'Original edition member differs: '+f.path);}
}
function savedCollectionPopulation(w,collectionId,id){
 const base=path.join(w.directory,'collections',collectionId),bindingFile=path.join(base,'large-editions',id,'selection.json');
 const binding=readJSON(bindingFile),directory=path.join(w.directory,'saved-measurement-editions',id),descriptor=path.join(directory,'edition.json'),edition=readJSON(descriptor);
 need(binding.format==='upper-savannah-collection-large-edition/v1'&&binding.collectionId===collectionId&&binding.editionId===id&&binding.documentSha256===collectionId,'Original large collection binding differs',409);
 const document=readJSON(path.join(base,'collection.json'));
 need(hash(stable(document))===collectionId&&Array.isArray(document.files)&&stable(binding.sourcePaths)===stable(document.files.map(f=>'collections/'+collectionId+'/sources/'+f.path)),'Saved population source paths differ from the original collection',409);
 need(stable(edition.filters)===stable(binding.filters),'Saved population filters differ from its original selection',409);
 need(edition.format==='upper-savannah-measurements-edition/v1'&&edition.id===id&&edition.workspaceRevision===binding.expectedRevision&&stable(edition.collectionBinding)===stable(binding),'Saved population belongs to another original collection selection',409);
 const names=['records.csv','calibration.json','calibration.csv','accepted.jsonl','excluded.jsonl'];
 need(Array.isArray(edition.files)&&stable(edition.files.map(f=>f.path).sort())===stable(names.sort()),'Keep every original saved population',409);
 for(const member of edition.files){const actual=fileDigest(path.join(directory,safePath(member.path)));need(actual.bytes===member.bytes&&actual.sha256===member.sha256,'Saved population member differs: '+member.path,409);}
 return {binding,bindingFile,edition,directory,descriptor};
}
function buildProjection(root,project,edition,request,source,{includeText=true}={}){
 const w=facade(project),documents=[],source_documents={},contents=new Map();let textBytes=0;
 const selectedCollections=[],selectedResults=[],associations=new Map();
 function add(kind,title,ref,filename,file,raw){
  const selector={id:hash(stable([kind,ref]))},id=selector.id;
  if(contents.has(id))return id;
  const identity=file?fileDigest(file):{bytes:raw.length,sha256:hash(raw)},media_type=mime(filename);
  let eligible=false,reason,text;
  if(!/^(text\/|application\/(?:json|x-ndjson|geo\+json|xml))/.test(media_type))reason='Binary original; download the complete file';
  else if(identity.bytes>MAX_TEXT)reason='Complete text exceeds the 8 MiB Brief source limit';
  else{
   try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(file?fs.readFileSync(file):raw);if(text.includes('\u0000'))reason='Original contains binary NUL characters';else eligible=true;}
   catch(error){if(!(error instanceof TypeError))throw error;reason='Original is not valid UTF-8 text';}
  }
  if(eligible&&includeText){textBytes+=identity.bytes;need(textBytes<=MAX_BATCH,'Complete readable selection exceeds 64 MiB. Keep this archive and select fewer source documents for LDA.',413);}
  documents.push({id,kind,title,ref,selector,filename,media_type,...identity,brief_text:eligible});
  contents.set(id,{file,raw,identity});
  if(includeText)source_documents[id]=eligible?{id,eligible:true,text}:{id,eligible:false,reason};
  return id;
 }
 try{
  need(request.expectedRevision===w.revision()&&edition.workspaceRevision===w.revision(),'Selected request and frozen project revisions differ',409);
  add('project',request.title,{editionId:edition.id,workspaceRevision:edition.workspaceRevision},'project.zip',path.join(root,'project.zip'));
  for(const name of ['edition.json',...edition.files.filter(f=>f.path!=='project.zip').map(f=>f.path)])add('file','Complete edition · '+name,{editionId:edition.id,path:name},name,path.join(root,name));
  for(const chosen of request.collections){
   const base=path.join(project,'collections',chosen.id),file=path.join(base,'collection.json'),document=readJSON(file),complete=readJSON(path.join(base,'complete.json'));
   need(document.format==='upper-savannah-measurement-collection/v1'&&hash(stable(document))===chosen.id&&complete.id===chosen.id&&stable(complete.files)===stable(document.files),'Selected original collection is incomplete or differs',409);
   need(Array.isArray(document.files),'Original collection file list is absent');
   const refs={id:chosen.id,title:document.title,descriptor:{...fileDigest(file)},editions:[]};
   add('collection',document.title,{collectionId:chosen.id,path:'collection.json'},'collection.json',file);
   const seen=new Set();
   for(const member of document.files){
    need(!seen.has(member.path),'Duplicate original collection path');seen.add(member.path);
    const sourceFile=path.join(base,'sources',safePath(member.path)),actual=fileDigest(sourceFile);
    need(actual.bytes===member.bytes&&actual.sha256===member.sha256,'Selected collection original differs');
    if(member.importId){const original=w.db.prepare('SELECT sha FROM imports WHERE id=?').get(member.importId);need(original?.sha===member.sha256,'Selected collection native source is absent');}
    add('file',document.title+' · '+member.path,{collectionId:chosen.id,path:member.path,importId:member.importId??null},path.basename(member.path),sourceFile);
   }
   for(const editionId of chosen.editions){
    const ordinary=fs.existsSync(path.join(base,'editions',editionId,'edition.json')),large=fs.existsSync(path.join(base,'large-editions',editionId,'selection.json'));
    need(ordinary!==large,'Choose one unambiguous saved collection edition',409);
    if(ordinary){
     const saved=readEdition(w,chosen.id,editionId),editionRoot=path.join(base,'editions',editionId);
     refs.editions.push({id:editionId,kind:'collection-edition',workspaceRevision:saved.workspaceRevision,descriptor:fileDigest(path.join(editionRoot,'edition.json')),files:saved.files});
     add('collection',document.title+' · saved edition',{collectionId:chosen.id,editionId,path:'edition.json'},'edition.json',path.join(editionRoot,'edition.json'));
     for(const member of saved.files)add('file',document.title+' · '+member.path,{collectionId:chosen.id,editionId,path:member.path},path.basename(member.path),path.join(editionRoot,safePath(member.path)));
    }else{
     const population=savedCollectionPopulation(w,chosen.id,editionId),saved=population.edition;
     refs.editions.push({id:editionId,kind:'native-saved-population',workspaceRevision:saved.workspaceRevision,descriptor:fileDigest(population.descriptor),binding:population.binding,files:saved.files});
     add('collection',document.title+' · native saved population',{collectionId:chosen.id,editionId,path:'edition.json'},'edition.json',population.descriptor);
     add('file',document.title+' · native edition selection',{collectionId:chosen.id,editionId,path:'selection.json'},'selection.json',population.bindingFile);
     for(const member of saved.files)add('file',document.title+' · '+member.path,{collectionId:chosen.id,editionId,path:member.path},path.basename(member.path),path.join(population.directory,safePath(member.path)));
    }
   }
   selectedCollections.push(refs);
  }
  for(const id of request.results){
   const row=w.db.prepare('SELECT * FROM exports WHERE id=?').get(id);need(row,'Selected saved result is absent',404);
   const result=JSON.parse(row.content),ref={id:row.id,kind:row.kind,savedAt:row.created_at,workspaceRevision:row.revision,contentBytes:Buffer.byteLength(row.content),contentSha256:hash(row.content)};
   // Only the original result-source reader can assert its supported associations.
   if(['calibration','paired-loads'].includes(row.kind)){
    ref.provenance=resultSourceSelection(w,id);
    for(const original of ref.provenance.sources)associations.set(original.id,original);
   }else ref.provenance={sourceSelectionComplete:false,notes:['Complete original saved result retained. This result kind has no original resultSourceSelection adapter; no source association is inferred.']};
   selectedResults.push(ref);
   add('result',row.kind+' · '+row.id,{exportId:row.id,kind:row.kind,workspaceRevision:row.revision},'saved-result-'+hash(row.id).slice(0,16)+'.json',null,Buffer.from(row.content));
  }
  for(const original of associations.values()){
   const directory=path.join(project,'original-source-files',original.id),name=original.kind==='usgs-daily'?'original.geojson':'original.csv',file=path.join(directory,name),actual=fileDigest(file);
   need(actual.bytes===original.bytes&&actual.sha256===original.sha256,'Original saved-result source differs');
   add('file',original.label,{importId:original.id,path:name},name,file);
  }
  const selection={schema:HANDOVER_SCHEMA,request,collections:selectedCollections,results:selectedResults};
  const selectionBytes=Buffer.from(encoder(selection));
  add('file','Complete selected source identities',{handoverId:request.id,path:'selection.json'},'selection.json',null,selectionBytes);
  const projection={schema:SOURCE_SCHEMA,source,native:{workspaceRevision:edition.workspaceRevision,editionId:edition.id,createdAt:edition.createdAt,edition},title:request.title,documents,selection,
   coverage:{completeNativeProject:true,originalCollectionCount:listCollections(w).length,selectedCollections:selectedCollections.length,selectedResults:selectedResults.length,documents:documents.length,eligibleTextDocuments:documents.filter(d=>d.brief_text).length,notes:['The unchanged project.zip retains all original project tables, files and histories. Selection controls readable source documents, not project custody.','Saved results remain historical. Current mappings and later decisions are not substituted into their original contents.','Native large collection editions retain their complete original five-file population and binding inside this project. Earlier project ZIPs are not recursively reconstructed.']}};
  return {body:{projection,source_documents},selection,contents};
 }finally{w.close();}
}
function withPackage(inputFile,operation,{includeText=true}={}){
 const stat=fs.lstatSync(inputFile);need(stat.isFile()&&!stat.isSymbolicLink(),'Choose an ordinary complete handover ZIP');
 need(stat.size<=MAX_HANDOVER_BYTES,'Complete handover exceeds the 384 MiB LDA native-input limit',413);
 const source=fileDigest(inputFile),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eco-handover-read-'));
 try{
  const selected=path.join(temp,'selected.zip');copyVerified(inputFile,selected,source);
  const root=path.join(temp,'envelope'),manifest=python('./handover_archive.py','unpack',selected,root),edition=readJSON(path.join(root,'edition.json')),selection=readJSON(path.join(root,'selection.json'));
  need(selection?.schema===HANDOVER_SCHEMA,'Unknown handover source selection');
  const request=selectionRequest(selection.request);
  need(stable(request)===stable(selection.request),'Original handover request differs');
  const expected=[...edition.files.map(f=>f.path),'edition.json','selection.json'].sort();
  need(stable(manifest.files.map(f=>f.path).sort())===stable(expected),'Unexpected or missing original handover members');
  const project=path.join(temp,'project');const {validation}=unpackProject(path.join(root,'project.zip'),project);
  assertEdition(edition,root,validation.revision);
  const result=buildProjection(root,project,edition,request,source,{includeText});
  need(stable(result.selection)===stable(selection),'Saved selections differ from their complete frozen original project');
  if(includeText)need(Buffer.byteLength(JSON.stringify(result.body))<=MAX_PROJECTION,'Complete source projection exceeds the 96 MiB receiving limit',413);
  return operation(result);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
export function inspectHandover(inputFile){return withPackage(inputFile,result=>result.body);}
export function readHandoverDocument(inputFile,selector,outputFile){
 need(selector&&identifier(selector.id)&&Object.keys(selector).length===1,'Choose the exact native source-document selector');
 return withPackage(inputFile,({body,contents})=>{
  const document=body.projection.documents.find(d=>d.id===selector.id);need(document,'Selected source document does not exist',404);
  const content=contents.get(document.id);
  durableDir(path.dirname(path.resolve(outputFile)));
  if(content.file)copyVerified(content.file,outputFile,content.identity);else publish(outputFile,content.raw);
  const actual=fileDigest(outputFile);need(actual.bytes===document.bytes&&actual.sha256===document.sha256,'Selected complete output differs');
  syncDir(path.dirname(path.resolve(outputFile)));
  return {source:body.projection.source,native:body.projection.native,filename:document.filename,media_type:document.media_type,...actual};
 },{includeText:false});
}
export function handoverChoices(w){
 return w.readConsistent(()=>{
  const collections=listCollections(w).map(c=>{
   const base=path.join(w.directory,'collections',c.id),largeRoot=path.join(base,'large-editions');
   const editions=c.editions.map(id=>{const e=readJSON(path.join(base,'editions',id,'edition.json'));return {id,kind:'collection-edition',complete:true,workspaceRevision:e.workspaceRevision,recordCount:e.recordCount,counts:e.counts};});
   if(fs.existsSync(largeRoot))for(const id of fs.readdirSync(largeRoot).filter(identifier).sort()){
    if(c.editions.includes(id)){for(const e of editions)if(e.id===id){e.complete=false;e.reason='This ID names two original edition families';}continue;}
    try{const {edition:e}=savedCollectionPopulation(w,c.id,id);editions.push({id,kind:'native-saved-population',complete:true,workspaceRevision:e.workspaceRevision,recordCount:e.recordCount,counts:e.counts});}
    catch(error){editions.push({id,kind:'native-saved-population',complete:false,reason:error.message});}
   }
   return {...c,editions};
  });
  const results=[];for(const r of w.db.prepare('SELECT id,kind,created_at,revision,length(CAST(content AS BLOB)) bytes,content FROM exports ORDER BY created_at DESC,id').iterate())results.push({id:r.id,kind:r.kind,createdAt:r.created_at,workspaceRevision:r.revision,bytes:r.bytes,sha256:hash(r.content)});
  return {workspaceRevision:w.revision(),collections,results};
 });
}
function describedFile(file){const chunks=[];for(const chunk of fileChunks(file))chunks.push(hash(chunk));return {...fileDigest(file),chunks};}
export function handoverInfo(w,id){
 const root=rootFor(w,id),result=path.join(root,'result.json'),status=path.join(root,'status.json');
 if(fs.existsSync(result)){const value=readJSON(result),actual=fileDigest(path.join(root,'handover.zip'));need(actual.bytes===value.source.bytes&&actual.sha256===value.source.sha256,'Retained complete handover changed',409);return value;}
 if(fs.existsSync(status))return readJSON(status);fail('Handover not found',404);
}
export async function exportHandover(w,input){
 const request=selectionRequest(input),root=rootFor(w,request.id);durableDir(root);
 return withDirectoryLock(root,async()=>{
  const intent=path.join(root,'request.json');publish(intent,encoder(request));
  if(fs.existsSync(path.join(root,'result.json')))return handoverInfo(w,request.id);
  record(path.join(root,'status.json'),{id:request.id,phase:'preparing',title:request.title,request});
  try{
   const editionId=hash(stable(['eco-measurements-handover-edition/v1',request.id])),edition=await exportEdition(w,{id:editionId,filters:{},expectedRevision:request.expectedRevision});
   need(edition.workspaceRevision===request.expectedRevision,'Measurements changed before capture. Retain this original request and create a new selection from the current revision.',409);
   const staging=path.join(root,'members');durableDir(staging);
   for(const member of edition.files){const selected=editionMemberFile(w,edition.id,member.path);copyVerified(selected.file,path.join(staging,safePath(member.path)),member);}
   publish(path.join(staging,'edition.json'),encoder(edition));
   const temp=fs.mkdtempSync(path.join(root,'.projection-'));
   let selection;
   try{
    const project=path.join(temp,'project');unpackProject(path.join(staging,'project.zip'),project);assertEdition(edition,staging,request.expectedRevision);
    selection=buildProjection(staging,project,edition,request,null,{includeText:false}).selection;
   }finally{fs.rmSync(temp,{recursive:true,force:true});}
   publish(path.join(staging,'selection.json'),encoder(selection));
   const file=path.join(root,'handover.zip');
   if(!fs.existsSync(file))python('./handover_archive.py','pack',staging,file);
   const source=describedFile(file);need(source.bytes<=MAX_HANDOVER_BYTES,'Complete native handover exceeds the 384 MiB LDA limit. Original project and retained edition remain available.',413);
   // A renamed archive may predate a lost response; validate that same archive.
   const body=inspectHandover(file);need(stable(body.projection.selection)===stable(selection),'Recovered handover selection differs',409);
   const result={id:request.id,phase:'complete',title:request.title,selection,edition,source,filename:'eco-measurements-'+request.id.slice(0,12)+'.zip',media_type:'application/zip',chunkBytes:CHUNK};
   publish(path.join(root,'result.json'),encoder(result));record(path.join(root,'status.json'),result);return result;
  }catch(error){try{record(path.join(root,'status.json'),{id:request.id,phase:'interrupted',title:request.title,request,error:error.message});}catch(receiptError){error.receiptError=receiptError.message;}throw error;}
 });
}
export function handoverChunk(w,id,index){
 const root=rootFor(w,id),receipt=path.join(root,'result.json');need(fs.existsSync(receipt),'Wait for this original handover to complete',409);
 const result=readJSON(receipt);need(result.id===id&&result.phase==='complete','Retained handover result differs',409);
 const st=fs.lstatSync(path.join(root,'handover.zip'));need(st.isFile()&&!st.isSymbolicLink()&&st.size===result.source.bytes,'Retained complete handover size differs',409);
 need(Number.isSafeInteger(index)&&index>=0&&index<result.source.chunks.length,'Unknown complete handover chunk',404);
 const bytes=Buffer.alloc(Math.min(CHUNK,result.source.bytes-index*CHUNK)),fd=fs.openSync(path.join(rootFor(w,id),'handover.zip'),'r');let n;
 try{n=fs.readSync(fd,bytes,0,bytes.length,index*CHUNK);}finally{fs.closeSync(fd);}
 need(n===bytes.length&&hash(bytes)===result.source.chunks[index],'Retained handover chunk differs',409);
 return {id,index,bytes:bytes.length,sha256:result.source.chunks[index],base64:bytes.toString('base64')};
}
export function handoverFile(w,id){const result=handoverInfo(w,id);need(result.phase==='complete','Original handover is not complete',409);return {file:path.join(rootFor(w,id),'handover.zip'),result};}
export function handoverOperation(w,method,parts,body={}){
 if(method==='GET'&&parts.length===1&&parts[0]==='choices')return handoverChoices(w);
 if(method==='POST'&&!parts.length)return exportHandover(w,body);
 if(method==='GET'&&parts.length===1)return handoverInfo(w,parts[0]);
 if(method==='GET'&&parts.length===3&&parts[1]==='chunks'&&/^(0|[1-9]\d*)$/.test(parts[2]))return handoverChunk(w,parts[0],Number(parts[2]));
 fail('Measurements handover route not found',404);
}
