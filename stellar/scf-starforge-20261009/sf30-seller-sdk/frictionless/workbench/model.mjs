// SPDX-License-Identifier: MIT
// Retained source authoring around the ORIGINAL Frictionless parser and publisher.
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, lstat, chmod, readdir, unlink, link, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { privateDirectory, acquireWorkspace, bytes, digest, readPrivate, readJson, hashPrivate, createFile,
  syncDirectory, fault, stamp } from '../../postgres/publisher/files.mjs';
import { inspectFrictionlessSource, runFrictionlessCommand } from '../source.mjs';
import { frictionlessPlanInput } from '../plan.mjs';
import { UUID, SHA, SCHEMA, MAX_JSON, MAX_SOURCE_FILE, need, exact, uuid, hash, label, count, page, validateMutation } from './contracts.mjs';

const NATIVE_JSON = 16 * 1024 * 1024;
const payloadHash = value => digest(bytes(value)); // projection insertion order is part of the request
const errorView = issue => ({ code: issue?.code || 'FRICTIONLESS_OPERATION_FAILED',
  status: Number.isInteger(issue?.status) ? issue.status : 500,
  message: issue?.path || issue?.syscall ? 'Original private storage is unavailable; inspect the retained request.' :
    String(issue?.message || 'The original source operation did not complete.').slice(0,2000) });
async function exists(path) { try { await lstat(path); return true; } catch(e) { if(e.code === 'ENOENT') return false; throw e; } }
async function cleanWrites(directory) {
  // Only this model's reserved unfinished publications, under its live kernel lease.
  for (const name of await readdir(directory)) if (/^\.fw-write-[a-f0-9-]{36}$/.test(name)) {
    const path = join(directory,name), info = await lstat(path);
    need(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077), 'FRICTIONLESS_STAGING_CHANGED');
    await unlink(path);
  }
  await syncDirectory(directory);
}
async function publishTemp(temporary, path) {
  try { await link(temporary,path); await syncDirectory(dirname(path)); }
  catch(e) { if(e.code !== 'EEXIST') throw e; }
  finally { await unlink(temporary).catch(e => { if(e.code !== 'ENOENT') throw e; }); await syncDirectory(dirname(path)); }
}
async function writeOnce(path, content) {
  await privateDirectory(dirname(path),true); await cleanWrites(dirname(path));
  if (await exists(path)) {
    const old = await readPrivate(path,Math.max(content.length,1));
    need(old.equals(content),'FRICTIONLESS_RETAINED_BYTES_CHANGED','The original request already retains different bytes.',409);
    await syncDirectory(dirname(path)); return { bytes:content.length,sha256:digest(content) };
  }
  const temporary = join(dirname(path),'.fw-write-'+randomUUID());
  await createFile(temporary,content); await publishTemp(temporary,path);
  const old = await readPrivate(path,Math.max(content.length,1));
  need(old.equals(content),'FRICTIONLESS_RETAINED_BYTES_CHANGED','The original publication differs.',409);
  return { bytes:old.length,sha256:digest(old) };
}
async function retainFile(source,path,expected) {
  await privateDirectory(dirname(path),true); await cleanWrites(dirname(path));
  if (await exists(path)) {
    const old = await hashPrivate(path,MAX_SOURCE_FILE);
    need(old.hash === expected.sha256 && old.bytes === expected.bytes,'FRICTIONLESS_RETAINED_BYTES_CHANGED',undefined,409);
    await syncDirectory(dirname(path)); return;
  }
  const from = await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
  const temporary=join(dirname(path),'.fw-write-'+randomUUID()); let to;
  try {
    const before=await from.stat();
    need(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size===expected.bytes&&before.size<=MAX_SOURCE_FILE,'FRICTIONLESS_INPUT_CHANGED',undefined,409);
    to=await open(temporary,'wx',0o600);
    const buffer=Buffer.alloc(1024*1024),sha=createHash('sha256');let total=0;
    for(;;){
      const result=await from.read(buffer,0,buffer.length,total);if(!result.bytesRead)break;
      const chunk=buffer.subarray(0,result.bytesRead);total+=chunk.length;need(total<=expected.bytes,'FRICTIONLESS_INPUT_CHANGED',undefined,409);sha.update(chunk);
      let offset=0;while(offset<chunk.length){const part=await to.write(chunk,offset,chunk.length-offset,null);need(part.bytesWritten>0,'FRICTIONLESS_WRITE_FAILED');offset+=part.bytesWritten;}
    }
    const after=await from.stat();
    need(total===expected.bytes&&sha.digest('hex')===expected.sha256&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'FRICTIONLESS_INPUT_CHANGED',undefined,409);
    await to.sync();await to.close();to=null;await publishTemp(temporary,path);
  }finally{await from.close();await to?.close();}
  const result=await hashPrivate(path,MAX_SOURCE_FILE);
  need(result.hash===expected.sha256&&result.bytes===expected.bytes,'FRICTIONLESS_RETAINED_BYTES_CHANGED',undefined,409);
}
async function finishNativeLink(path) {
  if(!await exists(path))return;
  const target=await lstat(path);
  if(target.nlink===1)return;
  need(target.isFile()&&!target.isSymbolicLink()&&target.nlink===2&&!(target.mode&0o077),'FRICTIONLESS_NATIVE_OUTPUT_CHANGED');
  for(const name of await readdir(dirname(path))) if(/^\.frictionless-export-[a-z0-9_]{8}$/.test(name)){
    const temporary=join(dirname(path),name),info=await lstat(temporary);
    if(info.isFile()&&!info.isSymbolicLink()&&info.ino===target.ino&&info.dev===target.dev){
      await unlink(temporary);await syncDirectory(dirname(path));return;
    }
  }
  throw fault('FRICTIONLESS_NATIVE_OUTPUT_CHANGED','The original native export has an unexpected hard link.',409);
}
function queryView(value) { return value && typeof value==='object' ? structuredClone(value) : null; }

export async function openFrictionlessSourceWorkbench({publisher,inputs={},environment=process.env}={}) {
  need(publisher && typeof publisher.selectSource==='function' && publisher.sourceName==='Frictionless Data Package',
    'FRICTIONLESS_PUBLISHER_REQUIRED','Borrow the original Frictionless publisher.');
  const directory=join(publisher.directory,'frictionless-source-workbench');
  await privateDirectory(directory,true); const release=await acquireWorkspace(directory); let db,active=null,closing=false,closed=null;
  try{
    const dbPath=join(directory,'workbench.sqlite');
    if(await exists(dbPath)){const info=await lstat(dbPath);need(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&!(info.mode&0o077),'FRICTIONLESS_DATABASE_CHANGED');}
    db=new DatabaseSync(dbPath);await chmod(dbPath,0o600);
    db.exec([
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;',
      'CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, kind TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, edition TEXT NOT NULL REFERENCES editions(id), created TEXT NOT NULL, data TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS selections(id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS saved_plans(id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL);',
    ].join('\n'));
    function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
    const binding=payloadHash({directory:publisher.directory,createdAt:publisher.settings.createdAt,
      sourceFile:publisher.settings.sourceFile,targetDirectory:publisher.settings.targetDirectory});
    if(!db.prepare('SELECT id FROM settings WHERE id=1').get())transaction(()=>{
      db.prepare('INSERT INTO settings(id,data) VALUES(1,?)').run(JSON.stringify({schema:SCHEMA,workspaceId:randomUUID(),publisherBinding:binding,version:0,createdAt:stamp()}));
    });
    const settings=()=>JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get().data);
    need(settings().schema===SCHEMA&&settings().publisherBinding===binding,'FRICTIONLESS_WORKSPACE_BINDING_CHANGED',undefined,409);
    const workspaceId=uuid(settings().workspaceId);
    for(const name of ['captures','editions','reviews','plans','comparisons','exports'])await privateDirectory(join(directory,name),true);
    const rows=(table)=>db.prepare('SELECT * FROM '+table+' ORDER BY created DESC,id DESC').all().map(r=>({...r,data:JSON.parse(r.data)}));
    function item(table,id){uuid(id);const r=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);need(r,'FRICTIONLESS_RECORD_NOT_FOUND','Choose an original retained '+table+' record.',404);return{...r,data:JSON.parse(r.data)};}
    function operation(id){const r=item('operations',id);return{id:r.id,kind:r.kind,createdAt:r.created,updatedAt:r.updated,state:r.state,
      input:structuredClone(r.data.input),stage:structuredClone(r.data.stage??{}),result:structuredClone(r.data.result??null),error:structuredClone(r.data.error??null)};}
    function updateOperation(id,patch,state){const r=item('operations',id);db.prepare('UPDATE operations SET state=?,updated=?,data=? WHERE id=?')
      .run(state??r.state,stamp(),JSON.stringify({...r.data,...patch}),id);}
    for(const r of db.prepare("SELECT id FROM operations WHERE state='RUNNING'").all())updateOperation(r.id,{error:{code:'FRICTIONLESS_INTERRUPTED',status:409,message:'The original process ended; inspect and explicitly resume this same request.'}},'INTERRUPTED');
    function checkWorkspace(input){need(input.workspaceId===workspaceId,'FRICTIONLESS_WORKSPACE_CHANGED','Use the original source workbench UUID.',409);}
    const run=(args,signal)=>runFrictionlessCommand(args,{env:environment,stdout:null,signal,timeoutMs:300000});
    async function runJSON(args,signal){
      const parts=[];let size=0;
      // The ORIGINAL bridge owns process lifetime and stdout delivery. Retain its
      // exact complete UTF-8 report rather than reserializing native integer tokens.
      const stdout={write(chunk){size+=chunk.length;need(size<=NATIVE_JSON,'FRICTIONLESS_NATIVE_REPORT_TOO_LARGE',undefined,413);parts.push(Buffer.from(chunk));return true;}};
      await runFrictionlessCommand(args,{env:environment,stdout,signal,timeoutMs:300000});
      const raw=Buffer.concat(parts,size),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      return{raw,value};
    }
    async function current(){
      const native=await publisher.source();
      return{sourceHash:native.hash,captureSha256:native.captureSha256,queries:native.queries,queriesText:native.queriesText,
        selection:publisher.status({limit:1}).sourceSelection,observedAt:stamp()};
    }
    async function input(name){
      if(name==='current'){const source=await current();return{input:'current',label:'Current publisher source',kind:'current',
        sha256:source.sourceHash,captureSha256:source.captureSha256,expectedSha256Required:true};}
      const value=inputs[name];need(value,'FRICTIONLESS_INPUT_NOT_CONFIGURED','Choose a host-declared package input.',404);
      if(value.path){const observed=await hashPrivate(value.path,value.kind==='source-archive'?MAX_SOURCE_FILE:MAX_JSON);
        return{input:name,label:value.label??name,kind:value.kind,bytes:observed.bytes,sha256:observed.hash,resources:value.resources??[],expectedSha256Required:true};}
      return{input:name,label:value.label??name,kind:value.kind,url:value.url,resources:value.resources??[],expectedSha256Required:false};
    }
    function publicCapture(r){return{id:r.id,createdAt:r.created,...structuredClone(r.data.summary)};}
    function publicEdition(r){return{id:r.id,createdAt:r.created,...structuredClone(r.data.summary),
      reviews:db.prepare("SELECT id,created,json_extract(data,'$.summary') AS summary FROM reviews WHERE edition=? ORDER BY created DESC,id DESC")
        .all(r.id).map(x=>({id:x.id,createdAt:x.created,...JSON.parse(x.summary)}))};}
    function catalogPage(table,offset,limit,convert){
      count(offset);count(limit,100,1);
      const total=db.prepare('SELECT COUNT(*) AS total FROM '+table).get().total;
      const selected=db.prepare("SELECT id,created,json_extract(data,'$.summary') AS summary FROM "+table+' ORDER BY created DESC,id DESC LIMIT ? OFFSET ?').all(limit,offset);
      return{items:selected.map(r=>convert({id:r.id,created:r.created,data:{summary:JSON.parse(r.summary)}})),
        offset,limit,total,next:offset+limit<total?offset+limit:null};
    }
    function operationsPage(offset,limit){
      count(offset);count(limit,100,1);const total=db.prepare('SELECT COUNT(*) AS total FROM operations').get().total;
      const selected=db.prepare("SELECT id,kind,state,created,updated,json_extract(data,'$.error') AS error FROM operations ORDER BY created DESC,id DESC LIMIT ? OFFSET ?").all(limit,offset);
      return{items:selected.map(r=>({id:r.id,kind:r.kind,state:r.state,createdAt:r.created,updatedAt:r.updated,error:r.error?JSON.parse(r.error):null})),
        offset,limit,total,next:offset+limit<total?offset+limit:null};
    }
    async function status({limit=25,capturesOffset=0,editionsOffset=0,operationsOffset=0}={}){
      const saved=settings(),native=publisher.status({limit:1});
      return{schema:SCHEMA,workspaceId,version:saved.version,createdAt:saved.createdAt,active:active?{id:active.id,kind:active.kind,stage:operation(active.id).stage}:null,
        publisher:{sourceName:publisher.sourceName,sourceSelection:native.sourceSelection,active:native.active},
        inputs:[{input:'current',label:'Current publisher source',kind:'current'},...Object.entries(inputs).map(([input,v])=>({input,label:v.label??input,kind:v.kind,remote:!!v.url}))],
        captures:catalogPage('captures',capturesOffset,limit,publicCapture),
        editions:catalogPage('editions',editionsOffset,limit,publicEdition),
        operations:operationsPage(operationsOffset,limit)};
    }
    async function captureData(id){
      const record=item('captures',id),file=join(directory,record.data.captureFile),raw=await readPrivate(file,MAX_JSON);
      need(digest(raw)===record.data.summary.captureSha256,'FRICTIONLESS_CAPTURE_CHANGED',undefined,409);
      return{record,file,manifest:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
    }
    async function capture(id,{section='overview',resource,offset=0,limit=25}={}){
      const {record,file,manifest}=await captureData(id);
      const inspectionBytes=await readPrivate(join(directory,record.data.inspectionFile),NATIVE_JSON);
      need(digest(inspectionBytes)===record.data.inspectionSha256,'FRICTIONLESS_INSPECTION_CHANGED',undefined,409);
      const report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inspectionBytes));
      const inspected=report.schema==='stellar-forge.frictionless-inspection.v1'?{native:report,error:null}:{native:null,error:report.error};
      let suggestion=null;
      if(record.data.suggestionFile){const raw=await readPrivate(join(directory,record.data.suggestionFile),MAX_JSON);
        need(digest(raw)===record.data.suggestionSha256,'FRICTIONLESS_SOURCE_SUGGESTION_CHANGED',undefined,409);suggestion=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
      if(section==='queries')return{capture:publicCapture(record),queries:queryView(suggestion?.queries),queriesText:record.data.queriesText??null,error:record.data.suggestionError??null};
      if(section==='files')return{capture:publicCapture(record),...page(manifest.files.map(f=>({name:f.file,bytes:f.bytes,sha256:f.sha256})),offset,limit)};
      if(section==='resource'){
        const original=manifest.resources.find(r=>r.name===resource);need(original,'FRICTIONLESS_RESOURCE_NOT_FOUND',undefined,404);
        return{capture:publicCapture(record),resource:original,inspection:inspected.native?.resources?.find(r=>r.name===resource)??null,
          error:inspected.error??null,references:manifest.references??[],licenses:manifest.package.licenses??[]};
      }
      need(section==='overview','FRICTIONLESS_SECTION_INVALID');
      return{capture:publicCapture(record),package:manifest.package,references:manifest.references??[],inspectionError:inspected.error??null,
        resources:page(manifest.resources.map(r=>{const report=inspected.native?.resources?.find(x=>x.name===r.name);return{name:r.name,format:r.descriptor.format??null,
          state:report?.state??'SOURCE_REVIEW_REQUIRED',rows:report?.rows??null,rowsRead:report?.rowsRead??null,error:report?.error??inspected.error??null};}),offset,limit),
        suggestionAvailable:!!suggestion,importedSource:Boolean(record.data.importedSource)};
    }
    async function editionData(id){
      const record=item('editions',id),file=join(directory,record.data.sourceFile),raw=await readPrivate(file,MAX_JSON);
      need(digest(raw)===record.data.summary.sourceHash,'FRICTIONLESS_SOURCE_EDITION_CHANGED',undefined,409);
      return{record,file,raw,config:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
    }
    async function edition(id){const {record,config}=await editionData(id);return{edition:publicEdition(record),queries:config.queries,queriesText:record.data.queriesText};}
    async function review(id){
      const record=item('reviews',id),raw=await readPrivate(join(directory,record.data.reportFile),NATIVE_JSON);
      need(digest(raw)===record.data.reportSha256,'FRICTIONLESS_REVIEW_CHANGED',undefined,409);
      return{id:record.id,createdAt:record.created,editionId:record.data.editionId,...record.data.summary,
        inspection:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
    }
    async function reviewed(editionId,reviewId){
      const selected=await editionData(editionId),record=item('reviews',reviewId);
      need(record.data.editionId===editionId&&record.data.summary.ready===true&&record.data.summary.sourceHash===selected.record.data.summary.sourceHash,
        'FRICTIONLESS_CURRENT_REVIEW_REQUIRED','Choose a successful full review of this exact source edition.',409);
      const native=await review(reviewId);need(native.inspection.sourceHash===selected.record.data.summary.sourceHash&&
        native.inspection.resources.length>0&&native.inspection.resources.every(x=>x.state==='COMPLETE'),'FRICTIONLESS_CURRENT_REVIEW_REQUIRED',undefined,409);
      return selected;
    }
    async function planInput(editionId,query){
      const selected=await editionData(editionId),native=await inspectFrictionlessSource(selected.file,{env:environment});
      need(native.hash===selected.record.data.summary.sourceHash,'FRICTIONLESS_SOURCE_EDITION_CHANGED',undefined,409);
      return{editionId,sourceHash:native.hash,plan:frictionlessPlanInput(native,query)};
    }
    function checkpoint(id,stage){const old=item('operations',id).data.stage??{};updateOperation(id,{stage:{...old,...stage}});}
    async function resolvedIntake(body){
      const observed=await input(body.input);
      if(observed.expectedSha256Required)need(body.expectedSha256===observed.sha256,'FRICTIONLESS_INPUT_CHANGED','Inspect and choose the exact original input digest.',409);
      if(body.input==='current')return{kind:'current',sourceFile:publisher.status({limit:1}).sourceFile,sha256:observed.sha256};
      return{...structuredClone(inputs[body.input]),sha256:observed.sha256??null,bytes:observed.bytes??null};
    }
    async function intakeWork(op,signal){
      const body=op.data.input,resolved=op.data.resolved,folder=join(directory,'captures',op.id),native=join(folder,'native');
      await privateDirectory(folder,true);let captureFile,importedSource=null;
      if(resolved.kind==='descriptor'){
        captureFile=join(native,'capture.json');
        if(!await exists(native)){
          if(resolved.path){const before=await hashPrivate(resolved.path,MAX_JSON);need(before.hash===resolved.sha256&&before.bytes===resolved.bytes,'FRICTIONLESS_INPUT_CHANGED',undefined,409);}
          checkpoint(op.id,{phase:'capturing original package',attempt:(op.data.stage?.attempt??0)+1});
          const args=['capture','--descriptor',resolved.path??resolved.url,'--output',native,'--timeout',String(resolved.timeoutSeconds??60)];
          for(const value of resolved.resources??[])args.push('--resource',value);
          for(const value of resolved.references??[])args.push('--reference',value);
          await run(args,signal);
        }
      }else{
        const archive=join(folder,'input-source.tar.gz');
        if(resolved.kind==='current'){
          if(!await exists(archive)){
            const original=await inspectFrictionlessSource(resolved.sourceFile,{env:environment});
            need(original.hash===resolved.sha256,'FRICTIONLESS_INPUT_CHANGED',undefined,409);
            checkpoint(op.id,{phase:'retaining original publisher source'});
            await run(['source-export','--source',resolved.sourceFile,'--output',archive],signal);
          }
          await finishNativeLink(archive);
        }else await retainFile(resolved.path,archive,{sha256:resolved.sha256,bytes:resolved.bytes});
        const archiveIdentity=await hashPrivate(archive,MAX_SOURCE_FILE);
        if(resolved.kind==='source-archive')need(archiveIdentity.hash===resolved.sha256,'FRICTIONLESS_INPUT_CHANGED',undefined,409);
        checkpoint(op.id,{phase:'receiving original source archive',archive:{bytes:archiveIdentity.bytes,sha256:archiveIdentity.hash}});
        if(!await exists(native))await run(['source-receive','--archive',archive,'--sha256',archiveIdentity.hash,'--output',native],signal);
        importedSource=join(native,'source.json');captureFile=join(native,'capture','capture.json');
        const received=await inspectFrictionlessSource(importedSource,{env:environment});
        const original=await readPrivate(join(native,'original-source.json'),MAX_JSON);
        if(resolved.kind==='current')need(digest(original)===resolved.sha256,'FRICTIONLESS_INPUT_CHANGED',undefined,409);
        need(received.config.connection.file==='capture/capture.json','FRICTIONLESS_NATIVE_RECEIVE_CHANGED',undefined,409);
      }
      await privateDirectory(native); await syncDirectory(folder);
      const captureRaw=await readPrivate(captureFile,MAX_JSON),manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(captureRaw));
      need(manifest.schema==='stellar-forge.frictionless-capture.v1'&&manifest.state==='COMPLETE','FRICTIONLESS_CAPTURE_INCOMPLETE',undefined,409);
      if(resolved.kind==='descriptor'&&resolved.path)need(manifest.files.find(x=>x.file===manifest.descriptorFile)?.sha256===resolved.sha256,'FRICTIONLESS_INPUT_CHANGED',undefined,409);
      let inspection,inspectionError=null;const inspectionFile=join(folder,'inspection.json');
      checkpoint(op.id,{phase:'inspecting complete original resources',captureSha256:digest(captureRaw)});
      if(await exists(inspectionFile)){
        const prior=await readJson(inspectionFile,NATIVE_JSON);
        need(prior.captureSha256===digest(captureRaw),'FRICTIONLESS_INSPECTION_CHANGED',undefined,409);
        if(prior.schema==='stellar-forge.frictionless-inspection.v1')inspection=prior;
        else{need(prior.schema==='stellar-forge.frictionless-inspection-error.v1','FRICTIONLESS_INSPECTION_CHANGED',undefined,409);inspectionError=prior.error;}
      }else{
        let raw;
        try{const result=await runJSON(['inspect-capture','--capture',captureFile,'--sha256',digest(captureRaw)],signal);inspection=result.value;raw=result.raw;}
        catch(e){if(signal.aborted)throw e;inspectionError=errorView(e);
          raw=bytes({schema:'stellar-forge.frictionless-inspection-error.v1',captureSha256:digest(captureRaw),error:inspectionError});}
        await writeOnce(inspectionFile,raw);
      }
      if(inspection)need(inspection.schema==='stellar-forge.frictionless-inspection.v1'&&inspection.captureSha256===digest(captureRaw)&&Array.isArray(inspection.resources),'FRICTIONLESS_INSPECTION_CHANGED',undefined,409);
      const inspectedRaw=await readPrivate(inspectionFile,NATIVE_JSON);
      const suggestionFile=join(folder,'suggested-source.json'),suggestionOutcome=join(folder,'suggestion-result.json');let suggestionError=null;
      if(importedSource){
        const originalSource=await readPrivate(importedSource,MAX_JSON);await writeOnce(suggestionFile,originalSource);
      }else if(!await exists(suggestionFile)){
        if(await exists(suggestionOutcome))suggestionError=(await readJson(suggestionOutcome,MAX_JSON)).error;
        else{
          // The original suggestion writes one file. Keep that write private until its
          // native result and exact bytes have both returned, then publish once.
          await cleanWrites(folder);const temporary=join(folder,'.fw-write-'+randomUUID());
          try{
            await run(['suggest-source','--capture',captureFile,'--output',temporary],signal);
            const raw=await readPrivate(temporary,MAX_JSON);
            const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
            need(value.schema==='stellar-forge.frictionless-source.v1'&&value.connection.sha256===digest(captureRaw),'FRICTIONLESS_SOURCE_SUGGESTION_CHANGED',undefined,409);
            await publishTemp(temporary,suggestionFile);
          }catch(e){
            if(signal.aborted)throw e;suggestionError=errorView(e);
            await writeOnce(suggestionOutcome,bytes({captureSha256:digest(captureRaw),error:suggestionError}));
          }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});await syncDirectory(folder);}
        }
      }
      if(await exists(suggestionFile)){
        const suggested=await readJson(suggestionFile,MAX_JSON);
        need(suggested.schema==='stellar-forge.frictionless-source.v1'&&suggested.connection.sha256===digest(captureRaw),'FRICTIONLESS_SOURCE_SUGGESTION_CHANGED',undefined,409);
      }
      const summary={label:label(body.label),kind:resolved.kind,captureSha256:digest(captureRaw),
        descriptorSha256:manifest.files.find(x=>x.file===manifest.descriptorFile)?.sha256,
        resources:manifest.resources.length,files:manifest.files.length,bytes:manifest.files.reduce((n,x)=>n+x.bytes,0),
        inspected:!!inspection,requiresReview:!inspection||inspection.resources.some(x=>x.state!=='COMPLETE')};
      const suggestionRaw=await exists(suggestionFile)?await readPrivate(suggestionFile,MAX_JSON):null;
      const queriesText=importedSource?(await inspectFrictionlessSource(importedSource,{env:environment})).queriesText:
        suggestionRaw?JSON.stringify(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(suggestionRaw)).queries,null,2):null;
      if(importedSource)need(typeof queriesText==='string','FRICTIONLESS_QUERY_TEXT_REQUIRED','Use the maintained original source inspector.',409);
      const data={queriesText,summary,captureFile:captureFile.slice(directory.length+1),inspectionFile:'captures/'+op.id+'/inspection.json',
        inspectionSha256:digest(inspectedRaw),suggestionSha256:suggestionRaw?digest(suggestionRaw):null,
        suggestionFile:suggestionRaw?'captures/'+op.id+'/suggested-source.json':null,suggestionError,importedSource:!!importedSource};
      return{result:{captureId:op.id,...summary},commit:()=>db.prepare('INSERT INTO captures(id,created,data) VALUES(?,?,?)').run(op.id,op.created,JSON.stringify(data))};
    }
    async function editionWork(op,signal){
      const body=op.data.input,captured=await captureData(body.captureId),folder=join(directory,'editions',op.id),file=join(folder,'source.json');
      const queriesText=body.queriesText??JSON.stringify(body.queries,null,2),queries=JSON.parse(queriesText);
      const connection=JSON.stringify({file:captured.file,sha256:captured.record.data.summary.captureSha256});
      const raw=Buffer.from('{"schema":"stellar-forge.frictionless-source.v1","connection":'+connection+',"queries":'+queriesText+'}\n');
      need(raw.length<=MAX_JSON,'FRICTIONLESS_SOURCE_TOO_LARGE',undefined,413);
      await writeOnce(file,raw);checkpoint(op.id,{phase:'validating original query declarations'});
      const inspected=await inspectFrictionlessSource(file,{env:environment});
      need(inspected.hash===digest(raw)&&inspected.captureSha256===captured.record.data.summary.captureSha256,'FRICTIONLESS_SOURCE_EDITION_CHANGED',undefined,409);
      if(signal.aborted)throw fault('PACKAGE_CANCELLED');
      const summary={label:label(body.label),captureId:body.captureId,captureSha256:inspected.captureSha256,sourceHash:inspected.hash,
        queries:Object.keys(queries),state:'DRAFT'};
      const data={summary,queriesText,sourceFile:'editions/'+op.id+'/source.json'};
      return{result:{editionId:op.id,...summary},commit:()=>db.prepare('INSERT INTO editions(id,created,data) VALUES(?,?,?)').run(op.id,op.created,JSON.stringify(data))};
    }
    async function reviewWork(op,signal){
      const body=op.data.input,selected=await editionData(body.editionId),path=join(directory,'reviews',op.id,'review.json');
      let report;if(await exists(path))report=await readJson(path,NATIVE_JSON);
      else{checkpoint(op.id,{phase:'reviewing every selected original row'});const result=await runJSON(['review-source','--source',selected.file],signal);report=result.value;await writeOnce(path,result.raw);}
      need(report.schema==='stellar-forge.frictionless-inspection.v1'&&report.sourceHash===selected.record.data.summary.sourceHash&&
        report.captureSha256===selected.record.data.summary.captureSha256&&Array.isArray(report.resources),'FRICTIONLESS_REVIEW_CHANGED',undefined,409);
      const raw=await readPrivate(path,NATIVE_JSON),summary={reviewer:label(body.reviewer,80),note:body.note.trim(),sourceHash:report.sourceHash,
        ready:report.resources.length>0&&report.resources.every(x=>x.state==='COMPLETE'),
        resources:report.resources.map(x=>({query:x.selection,resource:x.name,state:x.state,rows:x.rows,error:x.error}))};
      const data={editionId:body.editionId,summary,reportFile:'reviews/'+op.id+'/review.json',reportSha256:digest(raw)};
      return{result:{reviewId:op.id,editionId:body.editionId,...summary},commit:()=>db.prepare('INSERT INTO reviews(id,edition,created,data) VALUES(?,?,?,?)').run(op.id,body.editionId,op.created,JSON.stringify(data))};
    }
    async function selectWork(op){
      const body=op.data.input,selected=await reviewed(body.editionId,body.reviewId);
      checkpoint(op.id,{phase:'selecting under the original publisher writer'});
      const result=await publisher.selectSource({requestId:op.id,sourceFile:selected.file,sourceHash:selected.record.data.summary.sourceHash,
        expectedSourceHash:body.expectedSourceHash,label:selected.record.data.summary.label});
      const data={editionId:body.editionId,reviewId:body.reviewId,...result};
      return{result:data,commit:()=>db.prepare('INSERT INTO selections(id,created,data) VALUES(?,?,?)').run(op.id,op.created,JSON.stringify(data))};
    }
    async function planWork(op){
      const body=op.data.input,selected=await reviewed(body.editionId,body.reviewId);
      need(body.plan.sourceHash===selected.record.data.summary.sourceHash,'FRICTIONLESS_PLAN_SOURCE_CHANGED',undefined,409);
      await writeOnce(join(directory,'plans',op.id,'input.json'),bytes(body.plan));
      checkpoint(op.id,{phase:'saving the original immutable publisher plan'});
      const result=await publisher.savePlan(body.plan,{requestId:op.id});
      const data={editionId:body.editionId,reviewId:body.reviewId,planId:result.id,planDigest:result.data.digest,sourceHash:result.data.sourceHash};
      return{result:data,commit:()=>db.prepare('INSERT INTO saved_plans(id,created,data) VALUES(?,?,?)').run(op.id,op.created,JSON.stringify(data))};
    }
    async function compareWork(op,signal){
      const body=op.data.input,before=await captureData(body.before),after=await captureData(body.after),path=join(directory,'comparisons',op.id,'comparison.json');
      let result;if(await exists(path))result=await readJson(path,NATIVE_JSON);
      else{checkpoint(op.id,{phase:'comparing original source files and declarations'});const native=await runJSON(['compare','--before',before.file,'--after',after.file],signal);result=native.value;await writeOnce(path,native.raw);}
      need(result.before===before.record.data.summary.captureSha256&&result.after===after.record.data.summary.captureSha256,'FRICTIONLESS_COMPARISON_CHANGED',undefined,409);
      const raw=await readPrivate(path,NATIVE_JSON),data={label:label(body.label),before:body.before,after:body.after,file:'comparisons/'+op.id+'/comparison.json',sha256:digest(raw),bytes:raw.length};
      return{result:{comparisonId:op.id,...data,file:'comparison.json'},commit:()=>db.prepare('INSERT INTO comparisons(id,created,data) VALUES(?,?,?)').run(op.id,op.created,JSON.stringify(data))};
    }
    async function exportWork(op,signal){
      const body=op.data.input,selected=await editionData(body.editionId),folder=join(directory,'exports',op.id),archive=join(folder,'source.tar.gz');
      if(body.reviewId)await reviewed(body.editionId,body.reviewId);
      await privateDirectory(folder,true);
      let snapshot=item('operations',op.id).data.exportSnapshot;
      if(!snapshot){
        const captureRow=item('captures',selected.record.data.summary.captureId);
        const guide=await readFile(new URL('./RECEIVING.md',import.meta.url));
        need(guide.length<=1024*1024,'FRICTIONLESS_GUIDE_TOO_LARGE');
        snapshot={edition:publicEdition(selected.record),capture:publicCapture(captureRow),queriesText:selected.record.data.queriesText,
          inspectionFile:captureRow.data.inspectionFile,inspectionSha256:captureRow.data.inspectionSha256,
          reviews:rows('reviews').filter(r=>r.data.editionId===body.editionId).map(r=>({id:r.id,file:r.data.reportFile,sha256:r.data.reportSha256})),
          selectionHistory:rows('selections').filter(r=>r.data.editionId===body.editionId).map(r=>({id:r.id,createdAt:r.created,...r.data})),
          savedPlans:rows('saved_plans').filter(r=>r.data.editionId===body.editionId).map(r=>({id:r.id,createdAt:r.created,...r.data})),
          guide:{text:new TextDecoder('utf-8',{fatal:true}).decode(guide),sha256:digest(guide),bytes:guide.length}};
        // Freeze the original review/selection/guide snapshot before exporting.
        // A later edition review does not alter a resumed export's identity.
        updateOperation(op.id,{exportSnapshot:snapshot});
      }
      need(snapshot.edition.id===body.editionId&&snapshot.edition.sourceHash===selected.record.data.summary.sourceHash,'FRICTIONLESS_EXPORT_BINDING_CHANGED',undefined,409);
      if(!await exists(archive)){checkpoint(op.id,{phase:'exporting complete original source'});await run(['source-export','--source',selected.file,'--output',archive],signal);}
      await finishNativeLink(archive);const original=await hashPrivate(archive,MAX_SOURCE_FILE);
      const verified=join(folder,'verified-source');
      if(!await exists(verified))await run(['source-receive','--archive',archive,'--sha256',original.hash,'--output',verified],signal);
      await syncDirectory(folder);
      const restored=await inspectFrictionlessSource(join(verified,'source.json'),{env:environment});
      const retainedOriginal=await readPrivate(join(verified,'original-source.json'),MAX_JSON);
      need(digest(retainedOriginal)===selected.record.data.summary.sourceHash&&restored.captureSha256===selected.record.data.summary.captureSha256,
        'FRICTIONLESS_SOURCE_EXPORT_CHANGED',undefined,409);
      const provenance={schema:'stellar-forge.frictionless-source-edition.v1',workspaceId,edition:snapshot.edition,
        capture:snapshot.capture,queriesText:snapshot.queriesText,selectionHistory:snapshot.selectionHistory,savedPlans:snapshot.savedPlans,
        selectedReviewId:body.reviewId??null,receivingSourceHash:restored.hash};
      const files=[{name:'source.tar.gz',bytes:original.bytes,sha256:original.hash}];
      const add=async(name,raw)=>{const v=await writeOnce(join(folder,name),raw);files.push({name,...v});};
      await add('source-edition.json',bytes(provenance));
      const nativeInspection=await readPrivate(join(directory,snapshot.inspectionFile),NATIVE_JSON);
      need(digest(nativeInspection)===snapshot.inspectionSha256,'FRICTIONLESS_INSPECTION_CHANGED',undefined,409);
      await add('capture-inspection.json',nativeInspection);
      for(const r of snapshot.reviews){const raw=await readPrivate(join(directory,r.file),NATIVE_JSON);need(digest(raw)===r.sha256,'FRICTIONLESS_REVIEW_CHANGED',undefined,409);await add('reviews/'+r.id+'.json',raw);}
      const guide=Buffer.from(snapshot.guide.text,'utf8');
      need(guide.length===snapshot.guide.bytes&&digest(guide)===snapshot.guide.sha256,'FRICTIONLESS_GUIDE_CHANGED',undefined,409);await add('RECEIVING.md',guide);
      need(files.length<10000,'FRICTIONLESS_EXPORT_TOO_MANY_FILES','The complete source-review export exceeds 10000 declared files.',413);
      const manifest={schema:'stellar-forge.frictionless-workbench-export.v1',exportId:op.id,workspaceId,editionId:body.editionId,
        sourceHash:selected.record.data.summary.sourceHash,captureSha256:selected.record.data.summary.captureSha256,label:label(body.label),
        files,totalBytes:files.reduce((n,x)=>n+x.bytes,0)};
      const raw=bytes(manifest);need(raw.length<=64*1024*1024,'FRICTIONLESS_EXPORT_MANIFEST_TOO_LARGE',undefined,413);
      await writeOnce(join(folder,'manifest.json'),raw);await syncDirectory(folder);
      return{result:{...manifest,manifestFile:{name:'manifest.json',bytes:raw.length,sha256:digest(raw)}}};
    }
    async function work(op,signal){
      if(op.kind==='intake')return intakeWork(op,signal);
      if(op.kind==='edition')return editionWork(op,signal);
      if(op.kind==='review')return reviewWork(op,signal);
      if(op.kind==='select')return selectWork(op);
      if(op.kind==='plan')return planWork(op);
      if(op.kind==='compare')return compareWork(op,signal);
      if(op.kind==='export')return exportWork(op,signal);
      throw fault('FRICTIONLESS_ACTION_NOT_FOUND');
    }
    function launch(id){
      need(!closing,'FRICTIONLESS_CLOSING',undefined,409);
      need(!active,'FRICTIONLESS_BUSY','Finish or cancel the original active source request.',409);
      const op=item('operations',id),controller=new AbortController();
      updateOperation(id,{error:null},'RUNNING'); const running={id,kind:op.kind,controller,promise:null};active=running;
      running.promise=(async()=>{
        try{
          const completed=await work(item('operations',id),controller.signal);
          transaction(()=>{
            completed.commit?.();
            const saved=settings();saved.version++;db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(saved));
            updateOperation(id,{result:completed.result,error:null,stage:{...item('operations',id).data.stage,phase:'complete'}},'COMPLETE');
          });
        }catch(e){updateOperation(id,{error:errorView(e)},controller.signal.aborted?'CANCELLED':'FAILED');}
        finally{if(active===running)active=null;}
        return operation(id);
      })();
      running.promise.catch(()=>{});return{operation:operation(id)};
    }
    async function start(kind,body){
      need(!closing,'FRICTIONLESS_CLOSING',undefined,409);validateMutation(kind,body);checkWorkspace(body);
      const retained=db.prepare('SELECT id FROM operations WHERE id=?').get(body.requestId);
      if(retained){const old=item('operations',body.requestId);need(old.kind===kind&&old.data.inputHash===payloadHash(body),'FRICTIONLESS_REQUEST_CHANGED','Retry the exact original request input, including projection order.',409);return{operation:operation(body.requestId)};}
      need(!active,'FRICTIONLESS_BUSY',undefined,409);
      need(body.expectedVersion===settings().version,'FRICTIONLESS_VERSION_CHANGED','Refresh the current source workbench before a new action.',409);
      const resolved=kind==='intake'?await resolvedIntake(body):null;
      if(db.prepare('SELECT id FROM operations WHERE id=?').get(body.requestId)){
        const old=item('operations',body.requestId);need(old.kind===kind&&old.data.inputHash===payloadHash(body),'FRICTIONLESS_REQUEST_CHANGED',undefined,409);
        return{operation:operation(body.requestId)};
      }
      need(!active&&!closing,'FRICTIONLESS_BUSY',undefined,409);
      need(body.expectedVersion===settings().version,'FRICTIONLESS_VERSION_CHANGED',undefined,409);
      const now=stamp();db.prepare('INSERT INTO operations(id,kind,created,updated,state,data) VALUES(?,?,?,?,?,?)')
        .run(body.requestId,kind,now,now,'PREPARED',JSON.stringify({input:structuredClone(body),inputHash:payloadHash(body),resolved,stage:{phase:'prepared'}}));
      return launch(body.requestId);
    }
    async function resume(body){
      exact(body,['workspaceId','requestId'],['workspaceId','requestId']);checkWorkspace(body);uuid(body.requestId);
      const old=item('operations',body.requestId);
      need(old.kind!=='cancel','FRICTIONLESS_REQUEST_NOT_RESUMABLE',undefined,409);
      if(old.state==='COMPLETE'||active?.id===body.requestId)return{operation:operation(body.requestId)};
      return launch(body.requestId);
    }
    async function cancel(body){
      exact(body,['workspaceId','requestId','operationId'],['workspaceId','requestId','operationId']);checkWorkspace(body);uuid(body.requestId);uuid(body.operationId);
      const old=db.prepare('SELECT id FROM operations WHERE id=?').get(body.requestId);
      if(old){const r=item('operations',body.requestId);need(r.kind==='cancel'&&r.data.inputHash===payloadHash(body),'FRICTIONLESS_REQUEST_CHANGED',undefined,409);return{operation:operation(body.requestId)};}
      const target=operation(body.operationId),result={operationId:body.operationId,state:target.state,cancelRequested:active?.id===body.operationId};
      const now=stamp();db.prepare('INSERT INTO operations(id,kind,created,updated,state,data) VALUES(?,?,?,?,?,?)')
        .run(body.requestId,'cancel',now,now,'COMPLETE',JSON.stringify({input:body,inputHash:payloadHash(body),stage:{phase:'complete'},result}));
      if(active?.id===body.operationId)active.controller.abort();
      return{operation:operation(body.requestId)};
    }
    async function comparison(id){const r=item('comparisons',id),raw=await readPrivate(join(directory,r.data.file),NATIVE_JSON);
      need(digest(raw)===r.data.sha256,'FRICTIONLESS_COMPARISON_CHANGED',undefined,409);return{id:r.id,label:r.data.label,before:r.data.before,after:r.data.after,
        native:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};}
    async function file(kind,id,name){
      uuid(id);let path,expected;
      if(kind==='export'){
        const op=operation(id);need(op.kind==='export'&&op.state==='COMPLETE','FRICTIONLESS_EXPORT_NOT_COMPLETE',undefined,409);
        expected=name==='manifest.json'?op.result.manifestFile:op.result.files.find(f=>f.name===name);
        need(expected,'FRICTIONLESS_FILE_NOT_FOUND',undefined,404);path=join(directory,'exports',id,name);
      }else if(kind==='capture'){
        const {record,file:source,manifest}=await captureData(id);
        if(name==='capture.json'){expected={name,bytes:(await readPrivate(source,MAX_JSON)).length,sha256:record.data.summary.captureSha256};path=source;}
        else if(name==='inspection.json'){path=join(directory,record.data.inspectionFile);expected={name,sha256:record.data.inspectionSha256};}
        else if(name==='suggested-source.json'&&record.data.suggestionFile){path=join(directory,record.data.suggestionFile);expected={name,sha256:record.data.suggestionSha256};}
        else{expected=manifest.files.find(f=>f.file===name);need(expected,'FRICTIONLESS_FILE_NOT_FOUND',undefined,404);path=join(dirname(source),expected.file);expected={name,bytes:expected.bytes,sha256:expected.sha256};}
      }else if(kind==='edition'&&name==='source.json'){const e=await editionData(id);path=e.file;expected={name,bytes:e.raw.length,sha256:e.record.data.summary.sourceHash};}
      else if(kind==='review'&&name==='review.json'){const r=item('reviews',id);path=join(directory,r.data.reportFile);expected={name,sha256:r.data.reportSha256};}
      else if(kind==='comparison'&&name==='comparison.json'){const r=item('comparisons',id);path=join(directory,r.data.file);expected={name,bytes:r.data.bytes,sha256:r.data.sha256};}
      else throw fault('FRICTIONLESS_FILE_NOT_FOUND','Choose an original retained file.',404);
      const observed=await hashPrivate(path,MAX_SOURCE_FILE);
      if(expected)need(observed.hash===expected.sha256&&(expected.bytes===undefined||observed.bytes===expected.bytes),'FRICTIONLESS_RETAINED_BYTES_CHANGED',undefined,409);
      return{name,bytes:observed.bytes,sha256:observed.hash,path};
    }
    async function close(){
      if(closed)return closed;closing=true;active?.controller.abort();
      closed=(async()=>{try{await active?.promise;}finally{db.close();await release();}})();return closed;
    }
    return Object.freeze({directory,workspaceId,publisher,status,current,input,capture,edition,review,planInput,comparison,operation,start,resume,cancel,
      wait:async id=>active?.id===id?active.promise:operation(id),file,close});
  }catch(e){db?.close();await release();throw e;}
}
