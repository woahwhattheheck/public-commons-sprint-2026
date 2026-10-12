// MIT. Complete native subscription captures and closed, portable dataset editions.
import { open, copyFile, lstat, rename, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { acquireWorkspace } from '../postgres/publisher/files.mjs';
import { fail, object, exact, bound, identity, digest, bytes, now, privateDirectory, optionalJson, atomicJson, readJson,
  fileInfo, writeAll, createFile, syncDirectory, canonical, canonicalCsvLine, checkAbort, contained, SOURCE_PIN, errorValue, epochMs } from './common.mjs';
import { bindRisingWaveParameters, validateNativeColumns } from './declaration.mjs';
import { inspectQuerySource, columnsSignature } from './catalogue.mjs';
import { declareRisingWaveCursor, fetchRisingWaveCursor, closeRisingWaveCursor } from './cursor.mjs';
import { RisingWaveMirror } from './mirror.mjs';
export const CAPTURE_FILES=Object.freeze({json:'data.json',ndjson:'data.ndjson',csv:'data.csv',events:'events.ndjson',
  checkpoint:'checkpoint.json',state:'state.sqlite',manifest:'capture.json'});
const EXTRACTION_FIELDS=['mode','onGap','maxRows','maxBytes','maxRowBytes','batchSize','timeoutSeconds','maxDurationMs','timeoutMs'];
export function risingWaveDatasetExtractionOptions(_query,supplied={}){
  exact(supplied,EXTRACTION_FIELDS,'RISINGWAVE_EXTRACTION_OPTIONS_INVALID');
  if(supplied.mode!==undefined&&!['full','changes','auto'].includes(supplied.mode)||supplied.onGap!==undefined&&!['error','rebuild'].includes(supplied.onGap))
    throw fail('RISINGWAVE_EXTRACTION_MODE_INVALID');
  if(supplied.timeoutMs!==undefined&&supplied.maxDurationMs!==undefined&&supplied.timeoutMs!==supplied.maxDurationMs)throw fail('RISINGWAVE_DURATION_OPTIONS_CONFLICT');
  return {mode:supplied.mode??'auto',onGap:supplied.onGap??'error',
    maxRows:bound(supplied.maxRows??1000000,1,100000000,'RISINGWAVE_CAPTURE_ROW_LIMIT_INVALID'),
    maxBytes:bound(supplied.maxBytes??268435456,1048576,8589934592,'RISINGWAVE_CAPTURE_BYTE_LIMIT_INVALID'),
    maxRowBytes:bound(supplied.maxRowBytes??1048576,1024,33554432,'RISINGWAVE_CAPTURE_ROW_BYTES_INVALID'),
    batchSize:bound(supplied.batchSize??1000,1,10000,'RISINGWAVE_FETCH_BATCH_INVALID'),
    timeoutSeconds:bound(supplied.timeoutSeconds??1,0,30,'RISINGWAVE_FETCH_TIMEOUT_INVALID'),
    maxDurationMs:bound(supplied.maxDurationMs??supplied.timeoutMs??300000,1000,86400000,'RISINGWAVE_CAPTURE_DURATION_INVALID')};
}
function mirrorMeta(path,readOnly=true){
  const db=new DatabaseSync(path,{readOnly});
  try{
    db.exec((readOnly?'PRAGMA query_only=ON; ':'')+'PRAGMA trusted_schema=OFF;');
    const rows=db.prepare('SELECT key,value FROM meta').all();
    if(rows.length>100)throw fail('RISINGWAVE_MIRROR_METADATA_INVALID');
    return Object.fromEntries(rows.map(row=>[row.key,JSON.parse(row.value)]));
  }finally{db.close();}
}
async function exists(path){try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw fail('RISINGWAVE_CAPTURE_FILE_INVALID');return true;}catch(issue){if(issue.code==='ENOENT')return false;throw issue;}}
export async function inspectRisingWaveCapture(directory){
  await privateDirectory(directory);
  const manifest=await optionalJson(join(directory,CAPTURE_FILES.manifest));
  if(manifest)return {schema:'stellar-forge.risingwave-capture-status.v1',directory,state:'COMPLETE',mode:manifest.mode,
    effectiveMode:manifest.effectiveMode,rows:manifest.sourceRowCount,selectedRows:manifest.rowCount,events:manifest.events,
    checkpoint:manifest.checkpoint,barrier:manifest.barrier,updatedAt:manifest.completedAt,manifest};
  const progress=await optionalJson(join(directory,'progress.json'));
  return progress?{...progress,directory}:{schema:'stellar-forge.risingwave-capture-status.v1',directory,state:'PREPARING',rows:0,events:0,checkpoint:null,barrier:null};
}
export async function readRisingWaveCapture(directory,{expectedManifestSha256}={}){
  await privateDirectory(directory);
  const manifestFile=await fileInfo(join(directory,CAPTURE_FILES.manifest),CAPTURE_FILES.manifest);
  if(expectedManifestSha256&&manifestFile.sha256!==expectedManifestSha256)throw fail('RISINGWAVE_CAPTURE_MANIFEST_CHANGED');
  const manifest=await readJson(join(directory,CAPTURE_FILES.manifest));
  if(manifest.schema!=='stellar-forge.risingwave-capture.v1'||manifest.complete!==true||!object(manifest.files)||
      !/^[a-f0-9]{64}$/.test(manifest.sourceHash)||!Array.isArray(manifest.columns)||!Array.isArray(manifest.columnTypes)||
      !Number.isSafeInteger(manifest.rowCount)||manifest.rowCount<0||!Number.isSafeInteger(manifest.sourceRowCount)||
      manifest.sourceRowCount<manifest.rowCount||manifest.barrier?.state?.kind!=='InitLogStoreQuery')
    throw fail('RISINGWAVE_CAPTURE_MANIFEST_INVALID');
  const files={};
  for(const [key,filename]of Object.entries(CAPTURE_FILES)){
    if(key==='manifest')continue;
    const expected=manifest.files[key];
    if(!expected||expected.path!==filename||!Number.isSafeInteger(expected.bytes)||expected.bytes<0||!/^[a-f0-9]{64}$/.test(expected.sha256))
      throw fail('RISINGWAVE_CAPTURE_FILE_IDENTITY_INVALID');
    const actual=await fileInfo(contained(directory,filename),filename);
    if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw fail('RISINGWAVE_CAPTURE_FILE_CHANGED','A retained capture file differs from its committed manifest.',{file:filename});
    files[key]=actual;
  }
  const checkpoint=await readJson(join(directory,CAPTURE_FILES.checkpoint)),meta=mirrorMeta(join(directory,CAPTURE_FILES.state));
  if(checkpoint.complete!==true||checkpoint.rawBindingHash!==manifest.rawBindingHash||checkpoint.rows!==manifest.sourceRowCount||
      identity(checkpoint)!==identity(manifest.checkpoint)||meta.rawBindingHash!==manifest.rawBindingHash||meta.complete!==true||
      meta.captureBinding!==manifest.requestHash||meta.eventOffset!==checkpoint.eventOffset)
    throw fail('RISINGWAVE_CAPTURE_CHECKPOINT_CHANGED');
  files.manifest=manifestFile;
  return {directory,manifest,files};
}
export async function* readRisingWaveRows(retained,{signal,maxRowBytes=33554432}={}){
  const expected=retained.files.ndjson,path=contained(retained.directory,expected.path);
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  const hash=createHash('sha256'),decoder=new TextDecoder('utf-8',{fatal:true}),buffer=Buffer.alloc(65536);
  let pending='',size=0,count=0;
  try{
    for(;;){
      checkAbort(signal);
      const r=await file.read(buffer,0,buffer.length,null);if(!r.bytesRead)break;
      const chunk=buffer.subarray(0,r.bytesRead);hash.update(chunk);size+=chunk.length;pending+=decoder.decode(chunk,{stream:true});
      for(;;){
        const end=pending.indexOf('\n');if(end<0)break;
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        if(Buffer.byteLength(line)>maxRowBytes)throw fail('RISINGWAVE_CAPTURE_ROW_TOO_LARGE');
        let row;try{row=JSON.parse(line);}catch{throw fail('RISINGWAVE_CAPTURE_ROW_INVALID');}
        if(!object(row)||Object.keys(row).length!==retained.manifest.columns.length||retained.manifest.columns.some(name=>!Object.hasOwn(row,name)))
          throw fail('RISINGWAVE_CAPTURE_ROW_COLUMNS_CHANGED');
        count+=1;yield row;
      }
      if(Buffer.byteLength(pending)>maxRowBytes)throw fail('RISINGWAVE_CAPTURE_ROW_TOO_LARGE');
    }
    pending+=decoder.decode();
    if(pending!==''||size!==expected.bytes||hash.digest('hex')!==expected.sha256||count!==retained.manifest.rowCount)
      throw fail('RISINGWAVE_CAPTURE_ROWS_CHANGED');
  }finally{await file.close();}
}
async function finishRestart(directory,intent){
  const path=join(directory,'restart.json'),journal=await optionalJson(path);
  if(!journal)return;
  if(journal.phase==='DONE'&&intent.archives?.some(item=>item.id===journal.id))return;
  const destination=contained(directory,journal.destination);await privateDirectory(destination,true);
  for(const entry of journal.files){
    const old=contained(directory,entry.path),target=join(destination,entry.path);
    if(await exists(old)){
      const original=await fileInfo(old,entry.path);
      if(original.sha256!==entry.sha256||original.bytes!==entry.bytes)throw fail('RISINGWAVE_RESTART_SOURCE_CHANGED');
      if(await exists(target))throw fail('RISINGWAVE_RESTART_TARGET_EXISTS');
      await rename(old,target);
    }
    const retained=await fileInfo(target,entry.path);
    if(retained.sha256!==entry.sha256||retained.bytes!==entry.bytes)throw fail('RISINGWAVE_RESTART_ARCHIVE_CHANGED');
  }
  await syncDirectory(destination);await syncDirectory(directory);
  if(journal.phase!=='DONE')await atomicJson(path,{...journal,phase:'DONE',completedAt:now()});
  intent.archives??=[];
  if(!intent.archives.some(item=>item.id===journal.id)){
    intent.archives.push({id:journal.id,directory:journal.destination,reason:journal.reason,files:journal.files});
    await atomicJson(join(directory,'intent.json'),intent);
  }
}
async function restartCapture(directory,intent,reason){
  await finishRestart(directory,intent);
  const files=[];
  for(const filename of ['state.sqlite','state.sqlite-journal','state.seed.sqlite','events.ndjson','checkpoint.json','data.json','data.ndjson','data.csv']){
    if(await exists(join(directory,filename)))files.push(await fileInfo(join(directory,filename),filename));
  }
  const id=randomUUID(),destination='attempts/'+id;
  await atomicJson(join(directory,'restart.json'),{schema:'stellar-forge.risingwave-capture-restart.v1',id,destination,phase:'PREPARED',reason,files,at:now()});
  await finishRestart(directory,intent);
}
function rawBinding(nativeIdentity,query){
  return identity({catalogueHash:nativeIdentity.catalogueHash,
    keys:query.key.map(alias=>query.columns[alias].column)});
}
function rawEvents(response,fields){
  const expected=fields.map(field=>({name:field.name,typeOid:String(field.typeOid)}));
  const actual=response.fields.slice(0,-2).map(field=>({name:field.name,typeOid:String(field.typeOid)}));
  if(identity(expected)!==identity(actual)||response.fields.at(-2)?.name!=='op'||response.fields.at(-1)?.name!=='rw_timestamp'||
      !['20','21','23'].includes(response.fields.at(-1)?.typeOid))throw fail('RISINGWAVE_SUBSCRIPTION_FIELDS_CHANGED');
  return response.rows.map(row=>({row:row.slice(0,-2),op:row.at(-2),timestamp:row.at(-1)}));
}
async function outputWriter(path,budget){
  const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|(constants.O_NOFOLLOW??0),0o600);
  const hash=createHash('sha256');let size=0,pieces=[],buffered=0,closed=false;
  return {
    async append(value){
      const data=Buffer.isBuffer(value)?value:Buffer.from(value);budget.used+=data.length;
      if(budget.used>budget.max)throw fail('RISINGWAVE_CAPTURE_BYTE_LIMIT','The complete retained edition exceeds its declared byte budget.',{maxBytes:budget.max});
      size+=data.length;hash.update(data);pieces.push(data);buffered+=data.length;
      if(buffered>=65536){await writeAll(file,Buffer.concat(pieces,buffered));pieces=[];buffered=0;}
    },
    async close(){
      if(closed)return;closed=true;
      try{if(buffered)await writeAll(file,Buffer.concat(pieces,buffered));await file.sync();return {bytes:size,sha256:hash.digest('hex')};}
      finally{await file.close();}
    }
  };
}
async function materialize(directory,intent,mirror,nativeIdentity,query,input,options,notify,signal){
  const checkpoint=mirror.checkpoint();
  if(!checkpoint.complete||checkpoint.pendingDeltas)throw fail('RISINGWAVE_COMPLETE_MIRROR_REQUIRED');
  await notify('MATERIALIZING',{checkpoint,barrier:checkpoint.barrier});
  const stateStat=await lstat(join(directory,'state.sqlite')),eventStat=await lstat(join(directory,'events.ndjson'));
  const budget={used:stateStat.size+eventStat.size,max:options.maxBytes};
  const outputs={},columns=Object.keys(query.columns);
  const columnTypes=columns.map(name=>{
    const spec=query.columns[name],field=nativeIdentity.relation.columns.find(value=>value.name===spec.column);
    return {name,type:spec.type,nullable:spec.nullable,source:{column:spec.column,type:field.type,typeOid:field.typeOid},counts:{null:0,value:0}};
  });
  let rowCount=0;const ordered=createHash('sha256');
  try{
    for(const key of ['json','ndjson','csv'])outputs[key]=await outputWriter(join(directory,CAPTURE_FILES[key]),budget);
    await outputs.json.append('{"schema":"stellar-forge.risingwave-data.v1","columns":'+JSON.stringify(columns)+',"rows":[');
    await outputs.csv.append(canonicalCsvLine(columns));
    for(const item of mirror.records(input)){
      const row=item.row,line=JSON.stringify(row);
      if(Buffer.byteLength(line)>options.maxRowBytes)throw fail('RISINGWAVE_CAPTURE_ROW_TOO_LARGE');
      checkAbort(signal);
      await outputs.json.append((rowCount?',':'')+line);await outputs.ndjson.append(line+'\n');
      await outputs.csv.append(canonicalCsvLine(columns.map(name=>row[name])));ordered.update(line+'\n');
      for(const type of columnTypes)type.counts[row[type.name]===null?'null':'value']+=1;
      rowCount+=1;
    }
    await outputs.json.append('],"rowCount":'+rowCount+'}\n');
    for(const value of Object.values(outputs))await value.close();
  }catch(issue){for(const value of Object.values(outputs))await value.close().catch(()=>{});throw issue;}
  const checkpointBytes=bytes(checkpoint);
  if(budget.used+checkpointBytes.length>options.maxBytes)throw fail('RISINGWAVE_CAPTURE_BYTE_LIMIT');
  await atomicJson(join(directory,'checkpoint.json'),checkpoint);
  mirror.close();
  const files={};
  for(const [key,filename]of Object.entries(CAPTURE_FILES))if(key!=='manifest')files[key]=await fileInfo(join(directory,filename),filename);
  const manifest={schema:'stellar-forge.risingwave-capture.v1',id:intent.id,complete:true,sourcePin:SOURCE_PIN,
    sourceHash:intent.request.sourceHash,sourceConfigHash:intent.sourceConfigHash,query:intent.request.query,
    input,queryHash:query.queryHash,rawBindingHash:checkpoint.rawBindingHash,requestHash:intent.requestHash,
    request:intent.request,mode:options.mode,effectiveMode:intent.effectiveMode,sourceIdentity:nativeIdentity,
    sourceRowCount:checkpoint.rows,rowCount,columns,columnTypes,
    valueEncoding:'risingwave-pgwire-text-with-declared-scalars',nullEncoding:'unquoted-empty',
    snapshot:'native-subscription-complete-boundary',orderedRowsSha256:ordered.digest('hex'),
    checkpoint,barrier:checkpoint.barrier,
    baseCapture:intent.baseCapture??null,events:{received:checkpoint.events-(intent.baseCounters?.events??0),
      applied:checkpoint.appliedEvents-(intent.baseCounters?.appliedEvents??0),replayed:checkpoint.replayedEvents-(intent.baseCounters?.replayedEvents??0),
      cumulative:checkpoint.events},gap:intent.gap??null,archives:intent.archives??[],
    createdAt:intent.createdAt,completedAt:now(),files};
  const total=Object.values(files).reduce((sum,file)=>sum+file.bytes,0)+bytes(manifest).length;
  if(total>options.maxBytes)throw fail('RISINGWAVE_CAPTURE_BYTE_LIMIT');
  await atomicJson(join(directory,CAPTURE_FILES.manifest),manifest);
  const result={directory,manifest,files:{...files,manifest:await fileInfo(join(directory,CAPTURE_FILES.manifest),CAPTURE_FILES.manifest)}};
  await notify('COMPLETE',{rows:manifest.sourceRowCount,selectedRows:rowCount,events:manifest.events,checkpoint,barrier:manifest.barrier,manifest});
  return result;
}


const GAP_CODES=new Set(['RISINGWAVE_RETENTION_GAP','RISINGWAVE_REPLAY_PREFIX_MISSING',
  'RISINGWAVE_BEFORE_IMAGE_MISMATCH','RISINGWAVE_MIRROR_SOURCE_MISMATCH',
  'RISINGWAVE_SUBSCRIPTION_FIELDS_CHANGED','RISINGWAVE_SUBSCRIPTION_SOURCE_CHANGED',
  'RISINGWAVE_CAPTURE_SOURCE_CHANGED','RISINGWAVE_CHECKPOINT_NOT_RESUMABLE']);
function canResume(meta){
  return !!(meta?.snapshotComplete&&typeof meta.lastTimestamp==='string'&&typeof meta.snapshotEpoch==='string'&&
    BigInt(meta.lastTimestamp)>BigInt(epochMs(meta.snapshotEpoch)));
}
async function seedMirror(directory,retained){
  const source=contained(retained.directory,CAPTURE_FILES.state),destination=join(directory,'state.sqlite'),
    partial=join(directory,'state.seed.sqlite'),expected=retained.files.state;
  if(await exists(partial)){
    const info=await fileInfo(partial);
    if(info.bytes!==expected.bytes||info.sha256!==expected.sha256)
      throw fail('RISINGWAVE_BASE_COPY_INCOMPLETE','The retained base copy is incomplete; preserve this attempt and reopen a new capture directory.');
  }else{
    await copyFile(source,partial,constants.COPYFILE_EXCL|(constants.COPYFILE_FICLONE??0));
    const copied=await fileInfo(partial);
    if(copied.bytes!==expected.bytes||copied.sha256!==expected.sha256)throw fail('RISINGWAVE_BASE_CAPTURE_CHANGED');
    const f=await open(partial,'r');try{await f.sync();}finally{await f.close();}
  }
  if(await exists(destination))throw fail('RISINGWAVE_MIRROR_ALREADY_EXISTS');
  await rename(partial,destination);await syncDirectory(directory);
}
export async function captureRisingWave(context,name,input={},supplied={}){
  const query=context.queries[name];if(!query)throw fail('QUERY_NOT_FOUND');
  exact(supplied,[...EXTRACTION_FIELDS,'directory','baseCaptureDirectory','onProgress','signal'],'RISINGWAVE_CAPTURE_OPTIONS_INVALID');
  const {directory,baseCaptureDirectory=null,onProgress,signal}=supplied;
  if(onProgress!==undefined&&typeof onProgress!=='function')throw fail('RISINGWAVE_PROGRESS_CALLBACK_INVALID');
  const extraction=Object.fromEntries(EXTRACTION_FIELDS.filter(key=>supplied[key]!==undefined).map(key=>[key,supplied[key]]));
  const options=risingWaveDatasetExtractionOptions(query,extraction),normalized=bindRisingWaveParameters(query,input);
  await privateDirectory(directory,true);
  if(baseCaptureDirectory!==null){await privateDirectory(baseCaptureDirectory);if(baseCaptureDirectory===directory)throw fail('RISINGWAVE_BASE_CAPTURE_SELF');}
  const request={sourceHash:context.sourceHash,query:name,input:normalized,extraction:options,baseCaptureDirectory},
    requestHash=identity(request),release=await acquireWorkspace(directory);
  let mirror=null,eventsFile=null,intent=null,progress=null;
  async function notify(state,values={}){
    progress={schema:'stellar-forge.risingwave-capture-status.v1',directory,state,mode:options.mode,
      effectiveMode:intent?.effectiveMode??null,rows:0,events:0,checkpoint:null,barrier:null,...progress,...values,
      state,updatedAt:now()};
    await atomicJson(join(directory,'progress.json'),progress);
    if(onProgress)await onProgress(structuredClone(progress));
  }
  try{
    const completed=await optionalJson(join(directory,CAPTURE_FILES.manifest));
    if(completed){
      if(completed.requestHash!==requestHash)throw fail('RISINGWAVE_CAPTURE_REQUEST_CONFLICT');
      return await readRisingWaveCapture(directory);
    }
    intent=await optionalJson(join(directory,'intent.json'));
    if(intent&&(intent.schema!=='stellar-forge.risingwave-capture-intent.v1'||intent.requestHash!==requestHash||
        identity(intent.request)!==requestHash))throw fail('RISINGWAVE_CAPTURE_REQUEST_CONFLICT');
    if(!intent){
      intent={schema:'stellar-forge.risingwave-capture-intent.v1',id:randomUUID(),request,requestHash,
        sourceConfigHash:context.sourceConfigHash,createdAt:now(),archives:[]};
      await atomicJson(join(directory,'intent.json'),intent);
    }
    await finishRestart(directory,intent);
    progress=await optionalJson(join(directory,'progress.json'));
    let activeMeta=await exists(join(directory,'state.sqlite'))?mirrorMeta(join(directory,'state.sqlite'),false):null;
    if(activeMeta?.captureBinding===requestHash&&activeMeta.complete===true){
      const nativeIdentity=activeMeta.sourceIdentity;
      if(!nativeIdentity||rawBinding(nativeIdentity,query)!==activeMeta.rawBindingHash)throw fail('RISINGWAVE_MIRROR_SOURCE_MISMATCH');
      mirror=new RisingWaveMirror(join(directory,'state.sqlite'),{query,fields:nativeIdentity.relation.columns,rawBindingHash:activeMeta.rawBindingHash});
      return await materialize(directory,intent,mirror,nativeIdentity,query,normalized,options,notify,signal);
    }
    checkAbort(signal);
    const base=baseCaptureDirectory?await readRisingWaveCapture(baseCaptureDirectory):null;
    if(base){
      const binding={directory:base.directory,id:base.manifest.id,manifestSha256:base.files.manifest.sha256,
        rawBindingHash:base.manifest.rawBindingHash,checkpoint:base.manifest.checkpoint};
      if(intent.baseCapture&&identity(intent.baseCapture)!==identity(binding))throw fail('RISINGWAVE_BASE_CAPTURE_CHANGED');
      if(!intent.baseCapture){intent.baseCapture=binding;await atomicJson(join(directory,'intent.json'),intent);}
    }
    if(!activeMeta&&base&&await exists(join(directory,'state.seed.sqlite'))){
      const partial=await fileInfo(join(directory,'state.seed.sqlite'));
      if(partial.bytes!==base.files.state.bytes||partial.sha256!==base.files.state.sha256)
        await restartCapture(directory,intent,'Retain an interrupted base-copy attempt and repeat its exact immutable source copy.');
    }
    if(activeMeta&&activeMeta.captureBinding!==requestHash){
      if(!base||activeMeta.captureBinding!==base.manifest.requestHash)throw fail('RISINGWAVE_MIRROR_REQUEST_CONFLICT');
      // This is the exact base copy whose metadata reset was interrupted.
      const info=await fileInfo(join(directory,'state.sqlite'));
      if(info.bytes!==base.files.state.bytes||info.sha256!==base.files.state.sha256)throw fail('RISINGWAVE_BASE_CAPTURE_CHANGED');
    }
    if(activeMeta?.captureBinding===requestHash&&!canResume(activeMeta)){
      await restartCapture(directory,intent,'The interrupted native snapshot has no unambiguous inclusive change checkpoint; restart FULL.');
      activeMeta=null;
    }
    let forceFull=false,rebuilds=0,nativeIdentity=null;
    const started=Date.now();
    for(;;){
      checkAbort(signal);
      try{
        await context.withConnection(async connection=>{
          const inspected=await inspectQuerySource(connection,query);
          if(!inspected.identity)throw fail('RISINGWAVE_SUBSCRIPTION_REQUIRED');
          nativeIdentity=inspected.identity;
          const fields=inspected.relation.columns,binding=rawBinding(nativeIdentity,query);
          validateNativeColumns(query,fields);
          activeMeta=await exists(join(directory,'state.sqlite'))?mirrorMeta(join(directory,'state.sqlite'),false):null;
          let mode;
          if(activeMeta){
            if(activeMeta.rawBindingHash!==binding)throw fail('RISINGWAVE_MIRROR_SOURCE_MISMATCH');
            if(!canResume(activeMeta))throw fail('RISINGWAVE_CHECKPOINT_NOT_RESUMABLE');
            mode='changes';
          }else if(!forceFull&&options.mode!=='full'&&base){
            if(base.manifest.rawBindingHash!==binding)throw fail('RISINGWAVE_MIRROR_SOURCE_MISMATCH');
            if(base.manifest.checkpoint.resumeAvailable){
              await seedMirror(directory,base);activeMeta=mirrorMeta(join(directory,'state.sqlite'),false);mode='changes';
            }else if(options.mode==='changes')throw fail('RISINGWAVE_CHECKPOINT_NOT_RESUMABLE');
            else mode='full';
          }else if(!forceFull&&options.mode==='changes')throw fail('RISINGWAVE_CHECKPOINT_NOT_RESUMABLE');
          else mode='full';
          mirror=new RisingWaveMirror(join(directory,'state.sqlite'),{query,fields,rawBindingHash:binding,create:!activeMeta});
          if(mirror.get('captureBinding')!==requestHash){
            const counters=activeMeta?{events:mirror.get('events'),appliedEvents:mirror.get('appliedEvents'),replayedEvents:mirror.get('replayedEvents')}:
              {events:0,appliedEvents:0,replayedEvents:0};
            intent.baseCounters=counters;
            mirror.db.exec('BEGIN IMMEDIATE');
            try{
              mirror.set('captureBinding',requestHash);mirror.set('sourceIdentity',nativeIdentity);mirror.set('eventOffset',0);
              mirror.set('complete',false);mirror.db.exec('COMMIT');
            }catch(issue){mirror.db.exec('ROLLBACK');throw issue;}
          }
          intent.effectiveMode=mode;
          await atomicJson(join(directory,'intent.json'),intent);
          eventsFile=await open(join(directory,'events.ndjson'),constants.O_RDWR|constants.O_APPEND|constants.O_CREAT|(constants.O_NOFOLLOW??0),0o600);
          let offset=(await eventsFile.stat()).size;
          const committed=mirror.get('eventOffset')??0;
          if(committed>offset)throw fail('RISINGWAVE_EVENT_LOG_TRUNCATED');
          async function frame(value){
            const data=Buffer.from(JSON.stringify(value)+'\n');
            if(data.length>Math.max(options.maxRowBytes*options.batchSize,1048576)+16777216)throw fail('RISINGWAVE_EVENT_FRAME_TOO_LARGE');
            if(offset+data.length+(await lstat(join(directory,'state.sqlite'))).size>options.maxBytes)throw fail('RISINGWAVE_CAPTURE_BYTE_LIMIT');
            await writeAll(eventsFile,data);await eventsFile.sync();offset+=data.length;return offset;
          }
          await frame({schema:'stellar-forge.risingwave-event-session.v1',at:now(),capture:intent.id,requestHash,
            sourceIdentity:nativeIdentity,mode,sinceMs:mode==='changes'?mirror.get('lastTimestamp'):null,
            precedingCommittedOffset:committed,orphanBytes:offset-committed,
            baseCapture:intent.baseCapture?{id:intent.baseCapture.id,manifestSha256:intent.baseCapture.manifestSha256}:null});
          let cursor=null;
          try{
            cursor=await declareRisingWaveCursor(connection,query,{mode,sinceMs:mode==='changes'?mirror.get('lastTimestamp'):null});
            await frame({schema:'stellar-forge.risingwave-cursor-open.v1',statement:cursor.statement,observation:cursor.initial});
            mirror.beginCursor(mode,cursor.initial);mirror.set('eventOffset',offset);
            await notify(mode==='full'?'SNAPSHOT':'REPLAYING',{...mirror.progress(),cursor:cursor.initial,checkpoint:mirror.checkpoint()});
            for(;;){
              checkAbort(signal);
              if(Date.now()-started>options.maxDurationMs)throw fail('RISINGWAVE_CAPTURE_DURATION_EXCEEDED',
                'The native operation reached its declared time budget before a complete source boundary.',{maxDurationMs:options.maxDurationMs});
              const fetched=await fetchRisingWaveCursor(connection,cursor,{...options,timeoutMs:Math.min(context.config.queryTimeoutMs,
                Math.max(1000,options.maxDurationMs-(Date.now()-started)))});
              const rows=rawEvents(fetched.response,fields);
              if(rows.some(row=>Buffer.byteLength(JSON.stringify(row))>options.maxRowBytes))throw fail('RISINGWAVE_CAPTURE_ROW_TOO_LARGE');
              await frame({schema:'stellar-forge.risingwave-native-fetch.v1',statement:fetched.statement,at:fetched.at,
                fields:fetched.response.fields,rows:fetched.response.rows,observation:fetched.observation,nativeEof:fetched.nativeEof});
              mirror.applyBatch(rows,{maxRows:options.maxRows,eventOffset:offset,observation:fetched.observation});
              await notify(mirror.get('replaying')?'REPLAYING':mirror.get('snapshotComplete')?'CHANGES':'SNAPSHOT',
                {...mirror.progress(),cursor:fetched.observation});
              if(fetched.nativeEof){
                const after=await inspectQuerySource(connection,query);
                if(!after.identity||after.identity.catalogueHash!==nativeIdentity.catalogueHash||
                    columnsSignature(after.relation.columns)!==columnsSignature(fields))throw fail('RISINGWAVE_CAPTURE_SOURCE_CHANGED');
                await frame({schema:'stellar-forge.risingwave-native-barrier.v1',at:now(),observation:fetched.observation,
                  sourceIdentity:after.identity,fieldsSha256:columnsSignature(fields),nativeFetchRows:0});
                mirror.set('eventOffset',offset);
                const checkpoint=mirror.completeBoundary(fetched.observation,true,options.maxRows);
                await notify('MATERIALIZING',{...mirror.progress(),checkpoint,barrier:fetched.observation});
                break;
              }
            }
          }finally{
            if(cursor)await closeRisingWaveCursor(connection,cursor).catch(()=>{});
            await eventsFile.close();eventsFile=null;
          }
        },{signal});
        break;
      }catch(issue){
        if(mirror){mirror.close();mirror=null;}
        if(eventsFile){await eventsFile.close().catch(()=>{});eventsFile=null;}
        if(GAP_CODES.has(issue.code)&&options.onGap==='rebuild'&&rebuilds===0&&!signal?.aborted){
          const gap={at:now(),error:errorValue(issue),priorBase:intent.baseCapture??null};
          intent.gap=gap;await atomicJson(join(directory,'intent.json'),intent);
          await notify('GAP',{error:gap.error});
          await restartCapture(directory,intent,'Explicit onGap=rebuild: '+issue.code);
          forceFull=true;rebuilds+=1;continue;
        }
        throw issue;
      }
    }
    return await materialize(directory,intent,mirror,nativeIdentity,query,normalized,options,notify,signal);
  }catch(issue){
    if(mirror&&!mirror.closed)mirror.close();
    if(eventsFile)await eventsFile.close().catch(()=>{});
    if(intent){
      const state=GAP_CODES.has(issue.code)?'GAP':['RISINGWAVE_CANCELLED','RISINGWAVE_QUERY_TIMEOUT','RISINGWAVE_CAPTURE_DURATION_EXCEEDED'].includes(issue.code)?'INTERRUPTED':'FAILED';
      await notify(state,{error:errorValue(issue)}).catch(()=>{});
    }
    throw issue;
  }finally{if(mirror&&!mirror.closed)mirror.close();await release();}
}
