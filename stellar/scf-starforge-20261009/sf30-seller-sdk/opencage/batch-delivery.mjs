// MIT. Joined CSV/customer output using original capture and decision decoders.
import { constants } from 'node:fs';
import { open, mkdir, rename, rm, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { csvCell } from './customer.mjs';
import { CAPTURE, WORKSPACE, requestFor, decodeGeocodeCapture, deliveryForCapture } from './workspace.mjs';
import { compileGeocodeSeller } from './merchant.mjs';
import { BATCH, BATCH_REVIEW, MAX_CSV_ROWS, captureSummary, decodeBatchIntake, decodeBatchAttempt } from './batch.mjs';
import { fail, object, identifier } from './config.mjs';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, jsonBytes, digest, exists, relativeFile, syncDirectory } from '../twelvedata/files.mjs';

export const BATCH_DELIVERY='stellar-forge.opencage-csv-delivery.v1';
const HASH=/^[a-f0-9]{64}$/;
const requestIdFor=(batchId,ordinal,attempt)=>'gb-'+batchId.slice(4)+'-'+ordinal.toString(36)+'-a'+attempt;
const MAX_EXPORT_BYTES=536870912;
const same=(a,b)=>digest(jsonBytes(a))===digest(jsonBytes(b));
const jsonLine=value=>JSON.stringify(value)+'\n';
const csvLine=(values,textual=true)=>values.map(value=>csvCell(value,{text:textual&&typeof value!=='number'})).join(',')+'\r\n';
const metadataColumns=['row','source_id','source_overflow_json','request_id','state','error','candidate_index','latitude','longitude',
  'formatted','confidence','response_sha256','capture_identity','decision_revision'];
function identityOf(manifest){const {identity,...value}=manifest;return digest(jsonBytes(value));}
function descriptor(name,bytes){return {name,bytes:bytes.length,sha256:digest(bytes)};}
function need(ok,code='GEOCODE_CSV_DELIVERY_CHANGED'){if(!ok)fail(code);}
function exportLimit(value=67108864){
  if(!Number.isSafeInteger(value)||value<1048576||value>MAX_EXPORT_BYTES)fail('GEOCODE_CSV_EXPORT_LIMIT_INVALID');
  return value;
}
async function exactBytes(path,expected,max=33554432){
  need(await realpath(path)===path,'GEOCODE_CSV_DELIVERY_PATH_CHANGED');
  const bytes=await readBytes(path,Math.min(max,expected.bytes));
  need(bytes.length===expected.bytes&&digest(bytes)===expected.sha256);
  return bytes;
}
async function verifiedOpen(path,expected){
  need(await realpath(path)===path,'GEOCODE_CSV_DELIVERY_PATH_CHANGED');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();need(before.isFile()&&before.size===expected.bytes);
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<before.size){
      const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);
      need(bytesRead>0);hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
    }
    const after=await handle.stat();
    need(hash.digest('hex')===expected.sha256&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs);
    return handle;
  }catch(error){await handle.close();throw error;}
}
async function writer(root,name,budget){
  relativeFile(name);
  const handle=await open(join(root,name),'wx',0o600),hash=createHash('sha256');let bytes=0,closed=false;
  return {async add(data){
    if(closed)throw new Error('Closed batch output');
    data=Buffer.isBuffer(data)?data:Buffer.from(data);
    if(['rows.jsonl','objects.jsonl','licenses.jsonl'].includes(name)&&bytes+data.length>33554432)
      fail('GEOCODE_CSV_METADATA_SIZE_LIMIT','The retained row or object index exceeds 32 MiB. Select a smaller CSV source.');
    budget.add(data.length);await handle.writeFile(data);hash.update(data);bytes+=data.length;
  },async finish(){
    if(closed)throw new Error('Closed batch output');closed=true;
    try{await handle.sync();return {name,bytes,sha256:hash.digest('hex')};}finally{await handle.close();}
  },async close(){if(!closed){closed=true;await handle.close();}}};
}
function generatedColumns(headers){
  let prefix='geocode.';
  while(metadataColumns.some(name=>headers.includes(prefix+name)))prefix='_'+prefix;
  return {prefix,columns:[...headers,...metadataColumns.map(name=>prefix+name)]};
}
function joinedValues(source,record,selected){
  const values=source.values.slice(0,source.headerCount);
  while(values.length<source.headerCount)values.push('');
  return [...values,...[
    source.ordinal,source.sourceId,source.values.length>source.headerCount?JSON.stringify(source.values.slice(source.headerCount)):'',record.requestId??'',record.status,source.error??(['EXCEPTION','NEEDS_RECONCILIATION'].includes(record.status)?record.outcome??'':''),
    record.selectedIndex,selected?.geometry.lat,selected?.geometry.lng,selected?.formatted,selected?.confidence,
    record.responseSha256,record.captureIdentity,record.decisionRevision,
  ]];
}
function feature(source,record,selected){
  return {type:'Feature',id:String(source.ordinal),
    geometry:{type:'Point',coordinates:[selected.geometry.lng,selected.geometry.lat]},
    properties:{sourceRow:source.ordinal,sourceId:source.sourceId,source:source.values,
      requestId:record.requestId,candidateIndex:record.selectedIndex,formatted:selected.formatted,
      confidence:selected.confidence,confidenceMeaning:'SPATIAL_PRECISION_NOT_CORRECTNESS',
      responseSha256:record.responseSha256,captureIdentity:record.captureIdentity,decisionRevision:record.decisionRevision}};
}

async function projectRows(review,{csv,exceptions,geo,licenses}){
  const counts={rows:0,selected:0,exceptions:0,invalid:0,unexecuted:0},licensed=new Set();
  const columns=generatedColumns(review.headers);
  await csv.add(csvLine(columns.columns));await exceptions.add(csvLine(columns.columns));
  await geo.add('{"type":"FeatureCollection","features":[');
  return {counts,columns,async add(row,record,result){
    const selected=record.selectedIndex===null?null:result?.candidates?.[record.selectedIndex];
    need(record.selectedIndex===null||selected&&result?.state.providerStatus===200,'GEOCODE_CSV_ROW_PROJECTION_CHANGED');
    if(result?.semantics&&result.state.providerStatus===200&&!licensed.has(record.responseSha256)){
      licensed.add(record.responseSha256);
      await licenses.add(jsonLine({responseSha256:record.responseSha256,licenses:result.semantics.licenses,
        semantics:result.semantics}));
    }
    const source={...row,headerCount:review.headers.length};
    const line=csvLine(joinedValues(source,record,selected));
    await csv.add(line);counts.rows++;
    if(selected){
      if(counts.selected)await geo.add(',');
      await geo.add(JSON.stringify(feature(source,record,selected)));counts.selected++;
    }else{await exceptions.add(line);counts.exceptions++;}
    if(row.error)counts.invalid++;
    if(!record.captureIdentity&&!row.error)counts.unexecuted++;
  },async finish(){await geo.add(']}\n');return {counts,columns};}};
}
function deliverySummary(review,{snapshotIdentity,revision},counts,columns,objects){
  return {schema:BATCH_DELIVERY,batchId:review.batchId,sourceSha256:review.sourceSha256,
    reviewSha256:review.reviewSha256,snapshotIdentity,revision,counts,columns,
    coordinateReferenceSystem:'EPSG:4326',confidenceMeaning:'SPATIAL_PRECISION_NOT_CORRECTNESS',
    rowPolicy:'EVERY_ORIGINAL_SOURCE_ROW',sourceValues:'Original source.csv bytes are preserved. Spreadsheet projections escape formula-like text.',
    candidatePolicy:'Candidates remain in original provider order. Each receiving row has its own saved decision.',
    objects};
}
function projectionDigest(name){
  const hash=createHash('sha256');let bytes=0;
  return {async add(value){value=Buffer.isBuffer(value)?value:Buffer.from(value);hash.update(value);bytes+=value.length;},
    finish(){return {name,bytes,sha256:hash.digest('hex')};}};
}

async function retainRequestObjects(original,objectOf){
  const refs={requestObject:await objectOf(await readBytes(join(original.directory,'request.json'),1048576)),
    stateObject:null,captureManifestObject:null};
  if(original.capture){
    const manifest=await readBytes(join(original.directory,'capture','manifest.json'),1048576);
    need(digest(manifest)===original.capture.manifestSha256);
    refs.captureManifestObject=await objectOf(manifest);
    for(const bytes of original.capture.files.values())await objectOf(bytes);
  }else if(await exists(join(original.directory,'state.json')))
    refs.stateObject=await objectOf(await readBytes(join(original.directory,'state.json'),65536));
  return refs;
}
function nativeResult(value){
  return {request:value.request,state:value.state,responseSha256:value.state.responseSha256??null,
    captureIdentity:value.capture?.manifest.identity??null,candidates:value.parsed?.candidates??[]};
}

function snapshotOf(reviewSha256,rows){
  return digest(jsonBytes({reviewSha256,rows:rows.map(row=>({ordinal:row.ordinal,requestId:row.requestId,
    status:row.status,attempt:row.attempt,summary:row.summary}))}));
}

export async function exportGeocodeBatch(workspace,manager,entry,{expectedRevision,maxBytes}={}) {
  const snapshotRows=entry.db.prepare('SELECT ordinal,request_id AS requestId,status,attempt,summary FROM rows ORDER BY ordinal').all()
    .map(row=>({...row,summary:row.summary?JSON.parse(row.summary):null}));
  const snapshotIdentity=snapshotOf(entry.review.reviewSha256,snapshotRows);
  const limit=exportLimit(maxBytes),exportId=identifier(entry.id+'-'+snapshotIdentity.slice(0,16));
  const root=await privateDirectory(join(workspace.directory,'batch-deliveries')),destination=join(root,exportId);
  if(await exists(destination)){
    const prior=await GeocodeBatchDelivery.open(destination);
    need(prior.manifest.batchId===entry.id&&prior.manifest.snapshotIdentity===snapshotIdentity&&
      prior.manifest.reviewSha256===entry.review.reviewSha256,'GEOCODE_CSV_EXPORT_DESTINATION_CHANGED');
    return {exportId,directory:destination,reused:true,manifest:prior.manifest};
  }
  const temporary=join(root,'.geocode-csv-'+randomUUID());await mkdir(temporary,{mode:0o700});
  const budget={bytes:0,add(count){if((this.bytes+=count)>limit)fail('GEOCODE_CSV_EXPORT_SIZE_LIMIT',
    'The selected complete output exceeds maxBytes. Increase the reviewed export budget or export a smaller source selection.');}};
  const files=[],objects=new Map(),streams=[];
  try{
    await mkdir(join(temporary,'objects'),{mode:0o700});
    async function keep(name,bytes){
      budget.add(bytes.length);await writeBytes(join(temporary,name),bytes,{exclusive:true});files.push(descriptor(name,bytes));
    }
    async function objectOf(bytes){
      const sha256=digest(bytes),name='objects/'+sha256;
      if(!objects.has(sha256)){
        budget.add(bytes.length);await writeBytes(join(temporary,name),bytes,{exclusive:true});
        objects.set(sha256,descriptor(name,bytes));
      }
      return sha256;
    }
    await keep('source.csv',entry.intake.files.get('source.csv'));
    await keep('review.json',entry.intake.files.get('review.json'));
    await keep('intake-rows.json',entry.intake.files.get('rows.json'));
    await keep('configuration.json',await readBytes(join(workspace.directory,'configuration.json'),1048576));
    const rowsOut=await writer(temporary,'rows.jsonl',budget);streams.push(rowsOut);
    const csvOut=await writer(temporary,'results.csv',budget);streams.push(csvOut);
    const exceptionsOut=await writer(temporary,'exceptions.csv',budget);streams.push(exceptionsOut);
    const geoOut=await writer(temporary,'selected.geojson',budget);streams.push(geoOut);
    const licensesOut=await writer(temporary,'licenses.jsonl',budget);streams.push(licensesOut);
    const projection=await projectRows(entry.review,{csv:csvOut,exceptions:exceptionsOut,geo:geoOut,licenses:licensesOut});
    for(const row of entry.rows){
      workspace.lease.assertHeld();
      const current=await manager._readCurrent(entry,row.ordinal),value=current.value;
      const record={ordinal:row.ordinal,sourceId:row.sourceId,attempt:current.native.attempt,
        requestId:current.native.request_id,status:current.native.status,summary:value?captureSummary(value):null,
        outcome:value?.state.outcome??value?.state.state??null,responseSha256:value?.responseSha256??null,
        captureIdentity:value?.captureIdentity??null,decisionRevision:value?.decision.revision??0,
        selectedIndex:value?.decision.current?.index??null,candidateCount:value?.candidates.length??0,
        decision:value?.decision??{revision:0,current:null,history:[]},
        requestObject:null,stateObject:null,captureManifestObject:null,retryHistory:[]};
      if(value){
        const original=await workspace._read(value.request.id);
        need(original.request.id===record.requestId&&original.state.responseSha256===value.state.responseSha256);
        Object.assign(record,await retainRequestObjects(original,objectOf));
        if(original.parsed&&original.state.providerStatus===200)
          record.deliveryIdentity=deliveryForCapture(original).identity;
      }
      for(let attempt=2;attempt<=record.attempt;attempt++){
        const receiptBytes=await readBytes(join(entry.root,'attempts',requestIdFor(entry.id,row.ordinal,attempt)+'.json'),65536);
        const receipt=JSON.parse(receiptBytes.toString('utf8')),previous=await workspace._read(receipt.previousRequestId);
        decodeBatchAttempt(entry.review,row,attempt,receipt,previous.request,nativeResult(previous));
        record.retryHistory.push({attempt,receiptObject:await objectOf(receiptBytes),
          previous:await retainRequestObjects(previous,objectOf)});
      }
      await rowsOut.add(jsonLine(record));await projection.add(row,record,value);
    }
    const {counts,columns}=await projection.finish();
    for(const stream of streams)files.push(await stream.finish());
    const objectsOut=await writer(temporary,'objects.jsonl',budget);streams.push(objectsOut);
    for(const item of objects.values())await objectsOut.add(jsonLine(item));
    files.push(await objectsOut.finish());
    const summary=deliverySummary(entry.review,{snapshotIdentity,revision:expectedRevision},counts,columns,
      {count:objects.size,bytes:[...objects.values()].reduce((n,item)=>n+item.bytes,0)});
    await keep('delivery.json',jsonBytes(summary));
    await keep('README.md',Buffer.from('# Geocoding CSV delivery\n\n'+
      'source.csv contains the exact original bytes; review.json retains the reviewed column mapping and query rules. '+
      'results.csv contains every source row. exceptions.csv contains rows without a selected candidate, including invalid input, '+
      'unexecuted queries, provider errors, empty results and candidates awaiting review. selected.geojson contains only explicit saved choices.\n\n'+
      'The original capture manifests, request/response bytes and complete decision histories are referenced by rows.jsonl and stored in objects/. '+
      'Equal byte objects are stored once. licenses.jsonl carries the returned data licenses and source semantics. '+
      'Use opencage-workbench batch-read --delivery THIS_DIRECTORY or batch-serve --delivery THIS_DIRECTORY to reopen the customer review.\n'));
    const base={schema:BATCH_DELIVERY,exportId,batchId:entry.id,reviewSha256:entry.review.reviewSha256,
      workspaceIdentity:workspace.configuration.identity,snapshotIdentity,revision:expectedRevision,sourceSha256:entry.review.sourceSha256,
      counts,objects:summary.objects,bytes:budget.bytes,files};
    const manifest={...base,identity:digest(jsonBytes(base))};
    const manifestBytes=jsonBytes(manifest);budget.add(manifestBytes.length);
    await writeBytes(join(temporary,'manifest.json'),manifestBytes,{exclusive:true});
    await syncDirectory(join(temporary,'objects'));await syncDirectory(temporary);
    await rename(temporary,destination);await syncDirectory(root);
    return {exportId,directory:destination,reused:false,manifest};
  }finally{
    await Promise.allSettled(streams.map(value=>value.close()));
    await rm(temporary,{recursive:true,force:true});
  }
}

export class GeocodeBatchDelivery {
  static async open(directory,{expectedIdentity}={}) {
    directory=await privateDirectory(resolve(directory),{create:false});
    need(await realpath(directory)===directory,'GEOCODE_CSV_DELIVERY_PATH_CHANGED');
    const manifestBytes=await readBytes(join(directory,'manifest.json'),1048576);
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
    need(object(manifest)&&manifest.schema===BATCH_DELIVERY&&HASH.test(manifest.identity??'')&&
      identityOf(manifest)===manifest.identity&&(!expectedIdentity||expectedIdentity===manifest.identity)&&
      Array.isArray(manifest.files)&&manifest.files.length<=32&&Number.isSafeInteger(manifest.counts?.rows)&&
      manifest.counts.rows>=1&&manifest.counts.rows<=MAX_CSV_ROWS&&HASH.test(manifest.snapshotIdentity??''));
    const files=new Map();
    for(const value of manifest.files){
      relativeFile(value.name);
      need(!value.name.startsWith('objects/')&&!files.has(value.name)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&
        value.bytes<=MAX_EXPORT_BYTES&&HASH.test(value.sha256));files.set(value.name,value);
    }
    const required=['source.csv','review.json','intake-rows.json','configuration.json','rows.jsonl',
      'results.csv','exceptions.csv','selected.geojson','licenses.jsonl','objects.jsonl','delivery.json','README.md'];
    need(required.length===files.size&&required.every(name=>files.has(name)));
    const bytes=async name=>exactBytes(join(directory,name),files.get(name));
    const parse=async name=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(name)));
    const review=await parse('review.json'),intake=await parse('intake-rows.json'),configuration=await parse('configuration.json');
    const {reviewSha256,batchId,...reviewFields}=review;
    need(review.schema===BATCH_REVIEW&&digest(jsonBytes(reviewFields))===reviewSha256&&
      reviewSha256===manifest.reviewSha256&&batchId===manifest.batchId&&review.rowCount===manifest.counts.rows&&
      digest(jsonBytes(intake))===review.rowsSha256&&Array.isArray(intake)&&intake.length===review.rowCount);
    need(digest(await bytes('source.csv'))===review.sourceSha256&&review.sourceSha256===manifest.sourceSha256);
    const built=compileGeocodeSeller(configuration.plan,configuration.terms);
    need(configuration.schema===WORKSPACE&&configuration.identity===digest(jsonBytes({plan:built.plan,terms:built.terms}))&&
      configuration.identity===manifest.workspaceIdentity&&configuration.identity===review.workspaceIdentity&&
      configuration.planSha256===built.planSha256&&configuration.termsSha256===built.termsSha256&&
      configuration.planSha256===review.planSha256&&configuration.termsSha256===review.termsSha256);
    decodeBatchIntake(configuration,new Map([['source.csv',await bytes('source.csv')],['review.json',await bytes('review.json')],
      ['rows.json',await bytes('intake-rows.json')]]),manifest.batchId);
    const lines=async name=>{
      const text=new TextDecoder('utf-8',{fatal:true}).decode(await bytes(name));
      if(!text.length)return [];
      need(text.endsWith('\n'));return text.slice(0,-1).split('\n').filter(Boolean).map(line=>JSON.parse(line));
    };
    const rows=await lines('rows.jsonl'),inventory=await lines('objects.jsonl'),objects=new Map();
    need(rows.length===intake.length&&inventory.length===manifest.objects.count&&
      snapshotOf(reviewSha256,rows)===manifest.snapshotIdentity&&manifest.exportId===batchId+'-'+manifest.snapshotIdentity.slice(0,16));
    for(const item of inventory){
      need(object(item)&&item.name==='objects/'+item.sha256&&HASH.test(item.sha256)&&!objects.has(item.sha256)&&
        Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=33554432);
      objects.set(item.sha256,item);
    }
    need([...objects.values()].reduce((n,item)=>n+item.bytes,0)===manifest.objects.bytes&&
      Number.isSafeInteger(manifest.bytes)&&manifest.bytes===manifest.objects.bytes+[...files.values()].reduce((n,item)=>n+item.bytes,0)&&
      manifest.bytes+manifestBytes.length<=MAX_EXPORT_BYTES);
    for(let index=0;index<rows.length;index++){
      const row=rows[index],source=intake[index];
      need(row.ordinal===index+1&&source.ordinal===row.ordinal&&row.sourceId===source.sourceId&&
        Number.isSafeInteger(row.attempt)&&row.attempt>=1&&row.attempt<=100&&
        (source.error?row.requestId===null:row.requestId==='gb-'+batchId.slice(4)+'-'+row.ordinal.toString(36)+'-a'+row.attempt));
      const refs=value=>{
        need(object(value));
        for(const key of ['requestObject','stateObject','captureManifestObject'])
          need(value[key]===null||HASH.test(value[key])&&objects.has(value[key]));
        need(value.captureManifestObject===null||value.stateObject===null);
      };
      refs(row);
      need(Array.isArray(row.retryHistory)&&row.retryHistory.length===row.attempt-1);
      for(const [index,item] of row.retryHistory.entries()){
        need(object(item)&&item.attempt===index+2&&HASH.test(item.receiptObject)&&objects.has(item.receiptObject));
        refs(item.previous);need(item.previous.requestObject!==null);
      }
    }
    const result=new GeocodeBatchDelivery(directory,manifest,files,objects,review,intake,rows,configuration);
    result.manifestFile=descriptor('manifest.json',manifestBytes);return result;
  }
  constructor(directory,manifest,files,objects,review,intake,rows,configuration){
    Object.assign(this,{directory,manifest,files,objects,review,intake,rows,configuration});
  }
  inspect({offset=0,limit=50}={}){
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'GEOCODE_BATCH_PAGE_INVALID');
    return {schema:BATCH_DELIVERY,identity:this.manifest.identity,exportId:this.manifest.exportId,
      manifest:this.manifest,review:this.review,offset,total:this.rows.length,
      rows:this.rows.slice(offset,offset+limit).map((row,index)=>({...row,source:this.intake[offset+index]})),
      nextOffset:offset+limit<this.rows.length?offset+limit:null};
  }
  async _object(sha256){
    const expected=this.objects.get(sha256);need(expected,'GEOCODE_CSV_OBJECT_UNKNOWN');
    return exactBytes(join(this.directory,expected.name),expected);
  }
  async _capture(request,manifestSha256,decision){
    const manifestBytes=await this._object(manifestSha256),manifest=JSON.parse(manifestBytes.toString('utf8'));
    need(manifest.schema===CAPTURE&&Array.isArray(manifest.files)&&manifest.files.length<=128);
    const files=new Map();let total=0;
    for(const file of manifest.files){
      relativeFile(file.name);need(!files.has(file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&HASH.test(file.sha256));
      const bytes=await this._object(file.sha256);total+=bytes.length;
      need(bytes.length===file.bytes&&total<=33554432);files.set(file.name,bytes);
    }
    return decodeGeocodeCapture(request,{manifest,manifestSha256:digest(manifestBytes),files},decision);
  }
  async _retryHistory(source,row){
    for(const item of row.retryHistory){
      const receipt=JSON.parse((await this._object(item.receiptObject)).toString('utf8'));
      const request=JSON.parse((await this._object(item.previous.requestObject)).toString('utf8'));
      const expected=requestFor(this.configuration,requestIdFor(this.review.batchId,source.ordinal,item.attempt-1),
        this.review.productId,source.query);
      need(same(request,expected),'GEOCODE_CSV_ATTEMPT_PREDECESSOR_CHANGED');
      const native=item.previous.captureManifestObject
        ?await this._capture(request,item.previous.captureManifestObject)
        :{request,state:item.previous.stateObject?JSON.parse((await this._object(item.previous.stateObject)).toString('utf8')):
          {state:'PREPARED',dispatched:false},capture:null,parsed:null};
      decodeBatchAttempt(this.review,source,item.attempt,receipt,request,nativeResult(native));
    }
  }
  async row(ordinal){
    need(Number.isSafeInteger(ordinal)&&ordinal>=1&&ordinal<=this.rows.length,'GEOCODE_BATCH_ROW_INVALID');
    const row=this.rows[ordinal-1],source=this.intake[ordinal-1];
    await this._retryHistory(source,row);
    if(row.requestObject===null){
      need(row.captureManifestObject===null&&row.stateObject===null&&row.summary===null&&
        row.status===(source.error?'INVALID':'READY')&&row.responseSha256===null&&row.captureIdentity===null&&
        row.decisionRevision===0&&row.selectedIndex===null&&row.candidateCount===0&&row.outcome===null&&
        same(row.decision,{revision:0,current:null,history:[]}));
      return {source,row,result:null};
    }
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await this._object(row.requestObject)));
    need(same(request,requestFor(this.configuration,row.requestId,this.review.productId,source.query)));
    if(row.captureManifestObject===null){
      const state=row.stateObject?JSON.parse((await this._object(row.stateObject)).toString('utf8')):{state:'PREPARED',dispatched:false};
      const result={request,state,decision:row.decision,responseSha256:null,captureIdentity:null,candidates:[]};
      need(same(row.decision,{revision:0,current:null,history:[]})&&same(captureSummary(result),row.summary)&&
        row.status===row.summary.status&&row.outcome===row.summary.outcome&&row.responseSha256===null&&row.captureIdentity===null&&
        row.decisionRevision===0&&row.selectedIndex===null&&row.candidateCount===0);
      return {source,row,result};
    }
    const value=await this._capture(request,row.captureManifestObject,row.decision),manifest=value.capture.manifest;
    need(value.state.responseSha256===row.responseSha256&&manifest.identity===row.captureIdentity&&
      value.decision.revision===row.decisionRevision&&(value.decision.current?.index??null)===row.selectedIndex);
    const result={request,state:value.state,decision:value.decision,responseSha256:row.responseSha256,
      captureIdentity:manifest.identity,semantics:value.parsed?.semantics??null,
      candidates:value.parsed?.candidates.map((item,index)=>({...item,index,selected:index===row.selectedIndex}))??[]};
    need(same(captureSummary(result),row.summary)&&row.status===row.summary.status&&row.outcome===row.summary.outcome&&
      row.candidateCount===result.candidates.length);
    if(value.parsed&&value.state.providerStatus===200)
      need(deliveryForCapture(value).identity===row.deliveryIdentity,'GEOCODE_CSV_ROW_DELIVERY_CHANGED');
    return {source,row,result};
  }
  async openFile(name){
    relativeFile(name);let expected=name==='manifest.json'?this.manifestFile:this.files.get(name);
    if(!expected&&name.startsWith('objects/'))expected=this.objects.get(name.slice(8));
    need(expected&&expected.name===name,'GEOCODE_CSV_FILE_UNKNOWN');
    return {handle:await verifiedOpen(join(this.directory,name),expected),file:expected};
  }
  async readFile(name){
    relativeFile(name);const expected=name==='manifest.json'?this.manifestFile:this.files.get(name)??this.objects.get(name.slice(8));
    need(expected?.name===name,'GEOCODE_CSV_FILE_UNKNOWN');
    return exactBytes(join(this.directory,name),expected);
  }
  async verify(){
    for(const name of this.files.keys()){const {handle}=await this.openFile(name);await handle.close();}
    for(const item of this.objects.values())await this._object(item.sha256);
    const csv=projectionDigest('results.csv'),exceptions=projectionDigest('exceptions.csv'),
      geo=projectionDigest('selected.geojson'),licenses=projectionDigest('licenses.jsonl');
    const projection=await projectRows(this.review,{csv,exceptions,geo,licenses});
    for(let ordinal=1;ordinal<=this.rows.length;ordinal++){
      const {source,row,result}=await this.row(ordinal);await projection.add(source,row,result);
    }
    const {counts,columns}=await projection.finish();
    for(const sink of [csv,exceptions,geo,licenses]){
      const expected=sink.finish();need(same(expected,this.files.get(expected.name)),'GEOCODE_CSV_ROW_PROJECTION_CHANGED');
    }
    const summary=deliverySummary(this.review,this.manifest,counts,columns,
      {count:this.objects.size,bytes:[...this.objects.values()].reduce((n,item)=>n+item.bytes,0)});
    need(same(counts,this.manifest.counts)&&
      same(descriptor('delivery.json',jsonBytes(summary)),this.files.get('delivery.json')),'GEOCODE_CSV_SUMMARY_CHANGED');
    return {identity:this.manifest.identity,rows:this.rows.length,objects:this.objects.size,files:this.files.size,
      projections:['results.csv','exceptions.csv','selected.geojson','licenses.jsonl','delivery.json'],counts,verified:true};
  }
  async close(){}
}
