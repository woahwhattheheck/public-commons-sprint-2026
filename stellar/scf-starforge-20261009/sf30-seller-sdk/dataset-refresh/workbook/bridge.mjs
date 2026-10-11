// MIT. Explicit XLSX projection into the ORIGINAL retained dataset publisher.
import { constants } from 'node:fs';
import { open, readFile, rm, readdir, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { loadDatasetConfig } from '../../dataset-handler.mjs';
import { privateDirectory, readPrivate, readJson, createFile, bytes, digest,
  identity, hashPrivate, fault } from '../../postgres/publisher/files.mjs';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LIMITS=Object.freeze({sourceBytes:64*1024**2,expandedBytes:64*1024**2,
  worksheetCells:500000,sheets:128,inspectRows:100,inspectColumns:64,requestBytes:2*1024**2});
const copy=x=>structuredClone(x);
const text=raw=>new TextDecoder('utf-8',{fatal:true}).decode(raw);
const stamp=()=>new Date().toISOString();
const safeName=value=>String(value).split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g,'').slice(0,160)||'workbook.xlsx';
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};

async function held(path,maximum){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||stat.size>maximum)
      throw fault('PRIVATE_WORKBOOK_FILE_REQUIRED','Retained workbook files must be private regular files within their recorded limits.');
    return file;
  }catch(e){await file.close();throw e;}
}
function payloadDocument(raw){
  return {text:text(raw),bytes:raw.length,sha256:digest(raw)};
}

/** No worker is spawned until a workbook action. CSV and native buyer operations
 * retain their original Node-only runtime when Python is not installed. */
export async function openWorkbookBridge({drafts,status,generation,python='python3',maxUploadBytes=64*1024**2}){
  if(typeof python!=='string'||!python||python.length>4096||python.includes('\0'))
    throw new TypeError('Choose the workbook Python executable at workspace startup.');
  const sourceCode=await readFile(new URL('./reader.py',import.meta.url));
  if(sourceCode.length>256*1024)throw fault('WORKBOOK_PARSER_INVALID');
  const program=text(sourceCode),parserSha256=digest(sourceCode);
  const sources=drafts.workbooks;
  const exportRoot=join(drafts.directory,'workbook-exports');
  await privateDirectory(exportRoot,true);
  // Only unfinished temporary downloads in this original kernel-locked workspace.
  for(const name of await readdir(exportRoot))if(UUID.test(name))
    await rm(join(exportRoot,name),{recursive:true,force:true});
  let reopenRequired=false;
  function available(){
    if(reopenRequired)throw fault('WORKBOOK_SAVE_NEEDS_REOPEN','The original retained save was interrupted after its rename. Reopen this same workspace so its existing recovery adopts the completed candidate.',409);
  }
  async function worker(request,files){
    const input=Buffer.from(JSON.stringify(request));
    if(input.length>LIMITS.requestBytes)
      throw fault('WORKBOOK_REQUEST_CAPACITY','Keep the reviewed mapping and selected source metadata within 2 MiB.',413);
    return new Promise((resolve,reject)=>{
      let child,finished=false,total=0,stderrBytes=0,problem,output=[];
      const fail=e=>{if(!problem)problem=e;child?.kill('SIGKILL');};
      try{
        child=spawn(python,['-I','-B','-c',program],{shell:false,
          stdio:['pipe','pipe','pipe',...files.map(file=>file?file.fd:'ignore')]});
      }catch(e){reject(fault('WORKBOOK_PYTHON_UNAVAILABLE','Start this workspace with an installed Python 3.10+ executable via --workbook-python.',503));return;}
      const timer=setTimeout(()=>fail(fault('WORKBOOK_READ_TIMEOUT','The original workbook exceeded its two-minute read budget. Use a smaller source or range.',422)),120000);
      child.on('error',()=>{problem??=fault('WORKBOOK_PYTHON_UNAVAILABLE','Start this workspace with an installed Python 3.10+ executable via --workbook-python.',503);});
      child.stdin.on('error',()=>{});
      child.stdout.on('data',chunk=>{
        total+=chunk.length;
        if(total>8*1024**2)fail(fault('WORKBOOK_RESULT_CAPACITY','Inspect fewer original cells or a smaller source range.',422));
        else output.push(chunk);
      });
      child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;
        if(stderrBytes>65536)fail(fault('WORKBOOK_PROCESS_FAILED','The workbook reader could not complete within its output budget.',422));
      });
      child.once('close',(code)=>{
        if(finished)return;finished=true;clearTimeout(timer);
        if(problem){reject(problem);return;}
        let envelope;
        try{envelope=JSON.parse(text(Buffer.concat(output)));}
        catch(e){reject(fault('WORKBOOK_PROCESS_FAILED','The workbook reader did not return a complete result. Original bytes remain retained.',422));return;}
        if(code!==0||envelope.ok!==true){
          const known=typeof envelope.error==='string'&&/^[A-Z][A-Z0-9_]+$/.test(envelope.error);
          const error=fault(known?envelope.error:'WORKBOOK_READ_FAILED',
            typeof envelope.message==='string'?envelope.message.slice(0,2000):'Review the original workbook and mapping.',422);
          if(envelope.details&&bytes(envelope.details).length<=256*1024)error.details=envelope.details;
          reject(error);return;
        }
        resolve(envelope.result);
      });
      child.stdin.end(input);
    });
  }
  async function invoke(id,request,outputs=[]){
    const retained=await sources.verify(id),file=await held(retained.sourcePath,LIMITS.sourceBytes);
    try{return await worker({...request,source:{sha256:retained.record.sha256,bytes:retained.record.sourceBytes}},[file,...outputs]);}
    finally{await file.close();}
  }
  async function native(observed){
    const state=observed??await status(),current=await generation(state.current,state);
    const configBytes=await readPrivate(current.configPath,65536);
    if(digest(configBytes)!==current.record.configHash)
      throw fault('SOURCE_CONFIG_CHANGED','The original generation configuration changed during review.',409);
    const columns=Object.entries(current.config.columns).map(([name,spec])=>({
      name,type:typeof spec==='string'?spec:spec.type,nullable:typeof spec==='string'?false:spec.nullable===true}));
    return {state,current,configBytes,summary:{snapshot:state.current,revision:state.revision,
      configHash:current.record.configHash,columns,maxBytes:current.config.maxBytes??64*1024**2,
      maxRows:current.config.maxRows??250000,maxCellChars:current.config.maxCellChars??65536}};
  }
  return {
    runtime:{python,parser:'stellar-forge.xlsx-reader.v1',parserSha256,
      limits:{...LIMITS,sourceBytes:Math.min(LIMITS.sourceBytes,maxUploadBytes)}},
    async schema(observed){return (await native(observed)).summary;},
    async upload(req){
      available();
      if((req.headers['content-type']??'').split(';')[0].trim().toLowerCase()!==XLSX)
        throw fault('XLSX_REQUIRED','Choose an original .xlsx workbook.',415);
      const cap=Math.min(LIMITS.sourceBytes,maxUploadBytes,drafts.capacity(0,{candidate:false}));
      const length=req.headers['content-length'];
      if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>cap)){
        req.resume();throw fault('WORKBOOK_TOO_LARGE','The workbook exceeds the available retained-source capacity.',413);
      }
      const staged=await sources.stage();let adopted=false;
      try{
        const file=await open(staged.sourcePath,'wx',0o600),hash=createHash('sha256');let size=0;
        try{
          for await(const chunk of req.iterator({destroyOnReturn:false})){
            size+=chunk.length;
            if(size>cap){req.resume();throw fault('WORKBOOK_TOO_LARGE','The workbook exceeds the available retained-source capacity.',413);}
            hash.update(chunk);await file.writeFile(chunk);
          }
          if(!size)throw fault('EMPTY_WORKBOOK','Choose an original XLSX workbook.');
          await file.sync();
        }finally{await file.close();}
        const sha256=hash.digest('hex'),source=await held(staged.sourcePath,LIMITS.sourceBytes);
        let workbook;
        try{workbook=await worker({action:'describe',source:{sha256,bytes:size}},[source]);}
        finally{await source.close();}
        let filename='workbook.xlsx';
        try{filename=safeName(decodeURIComponent(req.headers['x-upload-name']??filename));}catch{}
        const record=await sources.adopt(staged,{filename,sha256,sourceBytes:size,workbook,
          parser:{name:'stellar-forge.xlsx-reader.v1',sha256:parserSha256}});
        adopted=true;return {source:record};
      }catch(e){
        if(!adopted&&!await exists(staged.directory)&&await exists(sources.paths(staged.id).directory)){
          reopenRequired=true;
          throw fault('WORKBOOK_SAVE_NEEDS_REOPEN','The original workbook reached its completed rename. Reopen this same workspace to recover it before another upload.',409);
        }
        throw e;
      }finally{if(!adopted)await rm(staged.directory,{recursive:true,force:true});}
    },
    async inspect(input){
      available();
      const result=await invoke(input.id,{action:'inspect',sheet:input.sheet,range:input.range,offset:input.offset,limit:input.limit});
      return {source:sources.source(input.id),inspection:result};
    },
    async savePlan(input){
      available();
      const {state,current,summary}=await native();
      if(input.expectedSnapshot!==state.current||input.expectedRevision!==state.revision)
        throw fault('WORKBOOK_NATIVE_REVIEW_CHANGED','The running publication changed. Review its current schema and save this mapping again.',409);
      await invoke(input.id,{action:'validate',plan:input.plan,config:current.config});
      const saved=await sources.savePlan(input.id,{...input,config:current.config,configHash:summary.configHash});
      return {...saved,workbookSchema:summary,status:state};
    },
    async prepare(input){
      available();
      const source=sources.source(input.id),plan=sources.plan(input.id,input.planId,input.expectedPlanRevision);
      const key=identity({sourceId:source.id,sourceSha256:source.sha256,planId:plan.id,
        planRevision:plan.revision,planSha256:plan.planSha256,parserSha256});
      const previous=drafts.view().candidates.find(x=>x.workbookSource?.preparationKey===key);
      if(previous){
        // A previously completed operation remains an exact retained candidate,
        // including after its native generation was published.
        await sources.verify(source.id);
        await drafts.select(previous.id);
        return {candidate:previous,reused:true};
      }
      const {state,current,configBytes,summary}=await native();
      if(plan.expectedSnapshot!==state.current||plan.expectedRevision!==state.revision||
        plan.configHash!==summary.configHash||identity(plan.config)!==identity(current.config))
        throw fault('WORKBOOK_NATIVE_REVIEW_CHANGED','The mapping belongs to an earlier publication review. Inspect current native columns and explicitly save a new mapping edition.',409);
      const retainedParser=await sources.retainParser(sourceCode);
      const staged=await drafts.stage();let adopted=false;
      try{
        const csv=await open(join(staged.directory,'data.csv'),'wx',0o600);
        let rows;
        try{
          rows=await open(join(staged.directory,'source-rows.jsonl'),'wx',0o600);
          const projection=await invoke(source.id,{action:'prepare',plan:plan.plan,config:current.config,
            maxCsvBytes:Math.min(maxUploadBytes,summary.maxBytes),maxPreparedBytes:drafts.capacity()},[csv,rows]);
          await csv.sync();await rows.sync();
          const configPath=join(staged.directory,'dataset.json');
          await createFile(configPath,configBytes);
          const frozen={schema:'stellar-forge.workbook-candidate-projection.v1',preparedAt:stamp(),
            source:{id:source.id,filename:source.filename,sha256:source.sha256,sourceBytes:source.sourceBytes,
              createdAt:source.createdAt,workbook:copy(source.workbook)},
            plan:Object.fromEntries(Object.entries(plan).filter(([k])=>k!=='editions')),
            parser:{name:'stellar-forge.xlsx-reader.v1',sha256:retainedParser.sha256,bytes:retainedParser.bytes},
            projection};
          const projectionBytes=bytes(frozen);
          if(projectionBytes.length>1024*1024)
            throw fault('WORKBOOK_PROJECTION_CAPACITY','The selected workbook metadata and mapping exceed the retained projection limit.',422);
          await createFile(join(staged.directory,'workbook-projection.json'),projectionBytes);
          let dataset;
          try{dataset=await loadDatasetConfig(configPath);}
          catch(e){throw fault('WORKBOOK_NATIVE_VALIDATION_FAILED',String(e.message).slice(0,1000),422);}
          const workbookSource={schema:'stellar-forge.workbook-candidate-origin.v1',
            sourceId:source.id,sourceSha256:source.sha256,sourceBytes:source.sourceBytes,filename:source.filename,
            planId:plan.id,planRevision:plan.revision,planSha256:plan.planSha256,preparationKey:key,
            parserSha256,projectionSha256:digest(projectionBytes),
            rowMapSha256:projection.rowMapSha256,rowMapBytes:projection.rowMapBytes,
            sheet:projection.sheet,range:projection.range,headerRow:projection.headerRow};
          const record=await drafts.adopt(staged,{filename:safeName(plan.plan.name+'.csv'),dataset:dataset.describe(),
            configHash:digest(configBytes),csvHash:projection.csvSha256,sourceBytes:projection.csvBytes,
            additionalSourceBytes:projection.rowMapBytes,expectedSnapshot:state.current,expectedRevision:state.revision,
            workbookSource});
          adopted=true;return {candidate:record,reused:false,projection};
        }finally{await csv.close();await rows?.close();}
      }catch(e){
        if(!adopted&&!await exists(staged.directory)&&await exists(drafts.files(staged.id).directory)){
          reopenRequired=true;
          throw fault('WORKBOOK_SAVE_NEEDS_REOPEN','The original retained save reached its completed rename. Reopen this same workspace to recover that candidate before another preparation.',409);
        }
        throw e;
      }finally{if(!adopted)await rm(staged.directory,{recursive:true,force:true});}
    },
    async remove(input){available();await sources.remove(input.id,input.expectedSourceRevision);},
    async download(input){
      const source=await sources.verify(input.id),file=await held(source.sourcePath,LIMITS.sourceBytes);
      return {file,filename:source.record.filename,contentType:XLSX,length:source.record.sourceBytes,
        dispose:()=>file.close()};
    },
    async export(input){
      available();
      const candidate=drafts.candidate(input.candidateId),origin=candidate.workbookSource;
      if(!origin)throw fault('WORKBOOK_CANDIDATE_REQUIRED','Choose a retained candidate prepared from a workbook.');
      const source=await sources.verify(origin.sourceId),paths=drafts.files(candidate.id);
      const projectionBytes=await readPrivate(join(paths.directory,'workbook-projection.json'),1024*1024);
      const configBytes=await readPrivate(paths.configPath,65536);
      if(digest(projectionBytes)!==origin.projectionSha256||digest(configBytes)!==candidate.configHash)
        throw fault('WORKBOOK_SOURCE_CHANGED','The retained projection or native configuration differs from its original identity.',409);
      const frozen=JSON.parse(text(projectionBytes));
      if(origin.sourceId!==source.record.id||origin.sourceSha256!==source.record.sha256||
        origin.sourceBytes!==source.record.sourceBytes||frozen.source?.id!==origin.sourceId||
        frozen.source?.sha256!==origin.sourceSha256||frozen.plan?.id!==origin.planId||
        frozen.plan?.revision!==origin.planRevision||frozen.plan?.planSha256!==origin.planSha256||
        frozen.parser?.sha256!==origin.parserSha256||frozen.projection?.csvSha256!==candidate.csvHash||
        frozen.projection?.rowMapSha256!==origin.rowMapSha256)
        throw fault('WORKBOOK_ORIGIN_CHANGED','The candidate, retained original and mapping edition no longer have the same bound identity.',409);
      const reader=await sources.parser(origin.parserSha256),handles=[];
      const id=randomUUID(),directory=join(exportRoot,id);await mkdir(directory,{mode:0o700});
      let output,success=false;
      try{
        for(const [path,max] of [[source.sourcePath,LIMITS.sourceBytes],[paths.csvPath,candidate.sourceBytes],
          [join(paths.directory,'source-rows.jsonl'),origin.rowMapBytes],[reader.path,256*1024]])
          handles.push(await held(path,max));
        output=await open(join(directory,'workbook-private.zip'),'wx+',0o600);
        const review=await drafts.export(candidate.id);
        const files=[
          {fd:3,name:'original.xlsx',bytes:source.record.sourceBytes,sha256:source.record.sha256},
          {fd:4,name:'data.csv',bytes:candidate.sourceBytes,sha256:candidate.csvHash},
          {fd:5,name:'source-rows.jsonl',bytes:origin.rowMapBytes,sha256:origin.rowMapSha256},
          {fd:6,name:'workbook-parser.py',bytes:reader.bytes,sha256:reader.sha256}];
        await worker({action:'bundle',files,documents:{
          'candidate.json':payloadDocument(bytes(candidate)),'dataset.json':payloadDocument(configBytes),
          'workbook-projection.json':payloadDocument(projectionBytes),'review.json':payloadDocument(bytes(review))}},
          [...handles,output]);
        await output.sync();const stat=await output.stat();success=true;
        return {file:output,filename:safeName(candidate.name.replace(/\.csv$/i,'')+'-private-source.zip'),
          contentType:'application/zip',length:stat.size,
          dispose:async()=>{await output.close();await rm(directory,{recursive:true,force:true});}};
      }finally{
        await Promise.allSettled(handles.map(x=>x.close()));
        if(!success){await output?.close();await rm(directory,{recursive:true,force:true});}
      }
    },
  };
}
