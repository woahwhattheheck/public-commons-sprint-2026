// SPDX-License-Identifier: MIT
// One retained research project, original source responses and the native SF30 dataset.
import { join, dirname } from 'node:path';
import { lstat, readdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readPrivate, readJson, createFile, atomicJson, acquireWorkspace, bytes, digest, identity, absolute, syncDirectory } from '../postgres/publisher/files.mjs';
import { SCHEMA, SOURCE, COLUMNS, clone, stable, key, need, label, plan, assembleCapture, reviewInput, compareRecords, csv, reportHtml } from './core.mjs';
import { newCapture, captureSource, importCapture } from './source.mjs';
import { monitoringPreview as previewMonitoring, monitoringProjectBytes, buildMonitoringHandover } from './monitoring-portfolio.mjs';
const MAX=256*1024*1024;
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function immutableFile(path,raw) {
  need(raw.length<=MAX,'GLEIF_FILE_TOO_LARGE','The retained file exceeds its complete-file limit.',413);
  const same=async()=>need((await readPrivate(path,MAX)).equals(raw),'GLEIF_IMMUTABLE_CHANGED','The existing retained file differs from the original bytes.',409);
  if(await exists(path)){await same();return;}
  const temporary=join(dirname(path),'.gleif-write-'+randomUUID());
  try{
    await createFile(temporary,raw);
    // The project lock and operation queue own this destination. Readers only receive the completed filename.
    if(await exists(path))await same();else await rename(temporary,path);
    await syncDirectory(dirname(path));
  }finally{try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
const actions=['capture','capture.resume','source.import','review.save','review.batch','report.prepare','dataset.prepare','monitoring.prepare'];
const now=()=>new Date().toISOString();
const entry=record=>({id:record.id,action:record.action,state:record.state,createdAt:record.createdAt,updatedAt:record.updatedAt,error:record.error??null,result:record.result??null});
const publicError=error=>({code:error?.code??'GLEIF_OPERATION_FAILED',message:String(error?.message??error).slice(0,4000),...(error?.status?{status:error.status}:{}),...(error?.notBefore?{notBefore:error.notBefore}:{})});
export const GLEIF_ACTIONS=Object.freeze(actions);
export async function openGleifWorkspace({directory,create=false,title,fetchImpl=globalThis.fetch}={}) {
  absolute(directory);await privateDirectory(directory,create);const unlock=await acquireWorkspace(directory);
  let state,closed=false,active=null,queue=Promise.resolve(),persistenceFailure=null;
  try {
    if(create) {
      need(!await exists(join(directory,'workspace.json')),'GLEIF_WORKSPACE_EXISTS','Open the existing project.',409);
      const metadata={schema:SCHEMA,id:randomUUID(),title:label(title,'project title',200),createdAt:now(),source:SOURCE};
      for(const folder of ['objects','datasets'])await privateDirectory(join(directory,folder),true);
      // state is the authoritative current value; immutable identity is written last at creation.
      state={schema:SCHEMA+'.state',workspaceId:metadata.id,revision:0,captures:[],reviews:[],reports:[],datasets:[],operations:[]};
      await atomicJson(directory,'state.json',state);await immutableFile(join(directory,'workspace.json'),bytes(metadata));
    }
    const metadata=await readJson(join(directory,'workspace.json'));state=await readJson(join(directory,'state.json'),MAX);
    need(metadata.schema===SCHEMA&&state.schema===SCHEMA+'.state'&&state.workspaceId===metadata.id,'GLEIF_WORKSPACE_IDENTITY','The saved project identity differs.',409);
    for(const folder of ['objects','datasets'])await privateDirectory(join(directory,folder));
    const check=()=>{need(!closed,'GLEIF_CLOSED','This project is closing.',409);if(persistenceFailure)throw persistenceFailure;};
    async function save(completion=null) {
      if(persistenceFailure)throw persistenceFailure;
      state.revision++;
      // Keep the live operation RUNNING until its terminal snapshot is durable.
      const snapshot=completion?{...state,operations:state.operations.map(record=>record===completion.record?{...record,...completion.value}:record)}:state;
      try{need(bytes(snapshot).length<=MAX,'GLEIF_PROJECT_SIZE','The complete project state exceeds 256 MiB. Reopen its last retained state and select a source operation that fits the project.',413);await atomicJson(directory,'state.json',snapshot);}catch(error){persistenceFailure=Object.assign(new Error('The project write could not be confirmed: '+error.message+'. Reopen this same project to reconcile its retained state.'),{code:error.code??'GLEIF_PROJECT_WRITE',status:error.status??503});throw persistenceFailure;}
    }
    function serial(fn) {const pending=queue.then(()=>{check();return fn();});queue=pending.catch(()=>{});return pending;}
    async function put(raw) {
      const data=Buffer.isBuffer(raw)?raw:Buffer.from(raw);need(data.length<=MAX,'GLEIF_OBJECT_TOO_LARGE');
      const sha256=digest(data),path=join(directory,'objects',sha256);
      if(await exists(path))need((await readPrivate(path,MAX)).equals(data),'GLEIF_OBJECT_CHANGED','The saved source differs.',409);
      else await immutableFile(path,data);
      return {sha256,bytes:data.length};
    }
    async function object(sha) {
      need(typeof sha==='string'&&/^[a-f0-9]{64}$/.test(sha),'GLEIF_OBJECT_ID');
      const value=await readPrivate(join(directory,'objects',sha),MAX);need(digest(value)===sha,'GLEIF_OBJECT_CHANGED','The saved file differs.',409);return value;
    }
    const capture=id=>{const value=state.captures.find(c=>c.id===key(id));need(value,'GLEIF_CAPTURE_NOT_FOUND','Choose a retained source edition.',404);return value;};
    async function entities(id) {
      const value=capture(id),pages=[];
      for(const page of value.pages){const data=await object(page.sha256);need(data.length===page.bytes,'GLEIF_PAGE_CHANGED');pages.push(new TextDecoder('utf-8',{fatal:true}).decode(data));}
      return {capture:clone(value),...assembleCapture(value,pages)};
    }
    function latestReviews() {
      const rows=new Map();for(const r of state.reviews)rows.set(r.lei,r);return [...rows.values()];
    }
    async function selection(input) {
      need(Array.isArray(input.captureIds)&&input.captureIds.length>0&&new Set(input.captureIds).size===input.captureIds.length,'GLEIF_SELECTION','Select distinct complete source editions.');
      const captures=[],records=[];
      for(const id of input.captureIds){const full=await entities(id);need(full.complete,'GLEIF_SOURCE_INCOMPLETE','Complete the selected original source capture.');captures.push(full.capture);records.push(...full.records);}
      const byEdition=new Map();for(const review of state.reviews)if(input.captureIds.includes(review.captureId))byEdition.set(review.lei+'/'+review.captureId,review);
      const reviews=[...byEdition.values()];
      const selected=input.selection??'all';need(['all','included'].includes(selected),'GLEIF_SELECTION','Choose all source records or the included shortlist.');
      const rows=selected==='all'?records:records.filter(r=>reviews.some(v=>v.captureId===r.row.captureId&&v.lei===r.row.lei&&v.decision==='include'&&v.resourceSha256===identity(r.resource)));
      return {captures,records:rows,reviews,selection:selected};
    }
    async function frozenSelection(input,record) {
      if(!record.sourceSelection) {
        const selected=await selection(input);
        record.sourceSelection={selection:selected.selection,captureIds:selected.captures.map(c=>c.id),
          reviews:selected.reviews.map(r=>({id:r.id,version:r.version})),
          records:selected.records.map(r=>({captureId:r.row.captureId,lei:r.row.lei,resourceSha256:identity(r.resource)}))};
        // Retain the accepted source and decision editions before creating any customer file.
        await save();return selected;
      }
      const saved=record.sourceSelection,captures=[],available=new Map(),records=[],reviews=[];
      for(const id of saved.captureIds){const full=await entities(id);need(full.complete,'GLEIF_SOURCE_INCOMPLETE');captures.push(full.capture);
        for(const item of full.records)available.set(item.row.captureId+'/'+item.row.lei,item);}
      for(const selected of saved.records){const item=available.get(selected.captureId+'/'+selected.lei);
        need(item&&identity(item.resource)===selected.resourceSha256,'GLEIF_PREPARED_SOURCE_CHANGED','The originally selected source record differs.',409);records.push(item);}
      for(const selected of saved.reviews){const review=state.reviews.find(r=>r.id===selected.id&&r.version===selected.version);
        need(review,'GLEIF_PREPARED_REVIEW_CHANGED','The original selected review version is missing.',409);reviews.push(clone(review));}
      return {captures,records,reviews,selection:saved.selection};
    }
    async function compare(beforeId,afterId) {
      const before=await entities(beforeId),after=await entities(afterId);
      need(before.complete&&after.complete,'GLEIF_COMPARISON_INCOMPLETE','Complete both source captures.');
      need(stable(plan(before.capture.plan))===stable(plan(after.capture.plan)),'GLEIF_COMPARISON_SCOPE','Compare successive editions of the same source query.');
      return {schema:SCHEMA+'.comparison',before:before.capture,after:after.capture,...compareRecords(before.records,after.records)};
    }
    async function saveReview(input,record) {
      const value=reviewInput(input,state.captures),full=await entities(value.captureId);
      need(!full.issues.length,'GLEIF_SOURCE_REVIEW_REQUIRED','Acquire a complete source edition without repeated records before saving company decisions.',409);
      const company=latestReviews().find(r=>r.lei===value.lei);need(!company||company.id===value.id,'GLEIF_REVIEW_IDENTITY','Continue this company under its existing review ID '+company?.id+'.',409);
      const item=full.records.find(r=>r.resource.id===value.lei);need(item,'GLEIF_REVIEW_ENTITY','The selected LEI is absent from this source capture.');
      const previous=state.reviews.filter(r=>r.id===value.id).at(-1);
      need((previous?.version??0)===(input.expectedVersion??0),'GLEIF_REVIEW_CHANGED','Reopen the latest saved review before editing.',409);
      if(previous)need(previous.lei===value.lei,'GLEIF_REVIEW_IDENTITY','An existing company review keeps its original LEI.');
      const revision={...value,version:(previous?.version??0)+1,previousVersion:previous?.version??null,resourceSha256:identity(item.resource),
        originalResource:clone(item.resource),sourcePage:clone(full.capture.pages[item.page-1]),operationId:record.id,createdAt:record.createdAt};
      state.reviews.push(revision);return clone(revision);
    }
    async function retainedFile(name,content) {const raw=Buffer.isBuffer(content)?content:Buffer.from(content);return {name,...await put(raw)};}
    async function prepareReport(input,record) {
      const selected=await frozenSelection(input,record),title=label(input.title,'report title',200);
      let comparison=null;if(input.compare)comparison=await compare(input.compare.before,input.compare.after);
      const report={schema:SCHEMA+'.report',id:record.id,title,createdAt:record.createdAt,workspaceId:metadata.id,source:SOURCE,
        ...selected,comparison};
      const files=[];
      files.push(await retainedFile('report.json',bytes(report)));
      files.push(await retainedFile('report.html',reportHtml(report)));
      files.push(await retainedFile('entities.csv',csv(selected.records.map(r=>r.row))));
      files.push(await retainedFile('entities.spreadsheet.csv',csv(selected.records.map(r=>r.row),{spreadsheet:true})));
      files.push(await retainedFile('entities.jsonl',selected.records.map(r=>JSON.stringify(r)).join('\n')+(selected.records.length?'\n':'')));
      const result={id:record.id,title,createdAt:record.createdAt,captureIds:input.captureIds,selection:selected.selection,records:selected.records.length,files};
      state.reports.push(result);return clone(result);
    }
    async function monitoringPreview(input) {
      return serial(async()=>previewMonitoring(await selection(input),input,metadata.id));
    }
    async function prepareMonitoring(input,record) {
      need(record.originalProject,'GLEIF_MONITORING_PROJECT','The original research snapshot is missing.');
      const projectBytes=await object(record.originalProject.sha256);
      need(projectBytes.length===record.originalProject.bytes,'GLEIF_MONITORING_PROJECT');
      const selected=await frozenSelection(input,record);
      const built=buildMonitoringHandover(selected,input,{workspaceId:metadata.id,operationId:record.id,createdAt:record.createdAt,projectBytes});
      const files=[];
      for(const file of built.files)files.push(await retainedFile(file.name,file.raw));
      files.unshift(await retainedFile('gleif-monitoring-portfolio.json',built.handover));
      const result={id:record.id,kind:'monitoring-portfolio',title:built.preview.options.title,createdAt:record.createdAt,
        captureIds:built.preview.captureIds,selection:selected.selection,records:selected.records.length,
        portfolioKey:built.preview.options.portfolioKey,previewSha256:built.preview.previewSha256,handoverId:built.manifest?JSON.parse(built.handover).id:null,files};
      const prior=state.reports.find(value=>value.id===record.id);
      if(prior)need(stable(prior)===stable(result),'GLEIF_MONITORING_CHANGED','The retained handover differs from the original operation.',409);
      else state.reports.push(result);
      return clone(result);
    }
    async function datasetFile(id,name,data) {
      key(id);need(['dataset.csv','dataset.json','source.json'].includes(name),'GLEIF_DATASET_FILE');
      const root=join(directory,'datasets',id);await privateDirectory(root,true);const path=join(root,name);
      if(await exists(path))need((await readPrivate(path,MAX)).equals(data),'GLEIF_DATASET_CHANGED','The original dataset files differ.',409);
      else await createFile(path,data);
      return retainedFile(name,data);
    }
    async function prepareDataset(input,record) {
      const selected=await frozenSelection(input,record),name=label(input.name,'dataset name',128);
      need(selected.records.length>0,'GLEIF_DATASET_EMPTY','Select at least one source record.');
      const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,columns:Object.fromEntries(COLUMNS.map(k=>[k,'string'])),
        filters:['lei','legalName','entityStatus','registrationStatus','legalJurisdiction','captureId'],ranges:[],
        sorts:['lei','legalName','registrationStatus','sourceObservedAt'],defaultLimit:50,maxLimit:200,maxBytes:MAX,maxRows:1000000};
      const source={schema:SCHEMA+'.dataset-source',id:record.id,workspaceId:metadata.id,source:SOURCE,captures:selected.captures,reviews:selected.reviews,
        selection:selected.selection,columns:COLUMNS,sourceFiles:selected.captures.flatMap(c=>c.pages.map(p=>({captureId:c.id,...p}))),
        interpretation:'All projected columns are strings. Structured source fields are JSON strings; original JSON:API resources and response bodies remain in the project.'};
      const files=[];
      files.push(await datasetFile(record.id,'dataset.csv',Buffer.from(csv(selected.records.map(r=>r.row)))));
      files.push(await datasetFile(record.id,'dataset.json',bytes(config)));
      files.push(await datasetFile(record.id,'source.json',bytes(source)));
      const {loadDatasetConfig}=await import('../dataset-handler.mjs');
      const native=await loadDatasetConfig(join(directory,'datasets',record.id,'dataset.json'));
      const description=native.describe(),result={id:record.id,name,createdAt:record.createdAt,captureIds:input.captureIds,selection:selected.selection,
        rows:selected.records.length,relativeDirectory:'datasets/'+record.id,files,description,snapshot:description.snapshot};
      state.datasets.push(result);return clone(result);
    }
    async function perform(record,signal) {
      const input=record.input;
      if(record.action==='capture'||record.action==='capture.resume') {
        let current=record.action==='capture.resume'?capture(input.captureId):state.captures.find(c=>c.id===record.id);
        if(!current){current=newCapture(record.id,input.plan,record.createdAt);state.captures.push(current);await save();}
        await captureSource(current,{put,save:async()=>save(),fetchImpl,signal});
        const full=await entities(current.id);if(full.issues.length){current.state='SOURCE_REVIEW';current.error=full.issues[0];}
        return {capture:clone(current),records:full.records.length,issues:full.issues};
      }
      if(record.action==='source.import') {
        const received=importCapture(record.id,input,record.createdAt);
        const inspected=assembleCapture(received.capture,input.pages.map(p=>p.body));
        if(inspected.issues.length){received.capture.state='SOURCE_REVIEW';received.capture.error=inspected.issues[0];}
        for(const data of received.objects)await put(data);
        state.captures.push(received.capture);return {capture:clone(received.capture),records:received.capture.pages.reduce((a,p)=>a+p.records,0)};
      }
      if(record.action==='review.save')return saveReview(input,record);
      if(record.action==='review.batch') {
        need(Array.isArray(input.items)&&input.items.length>0&&new Set(input.items.map(v=>v.id)).size===input.items.length,'GLEIF_REVIEW_BATCH','Select distinct saved company reviews.');
        const previous=clone(state.reviews);try{const result=[];for(const item of input.items)result.push(await saveReview(item,record));return result;}catch(e){state.reviews=previous;throw e;}
      }
      if(record.action==='report.prepare')return prepareReport(input,record);
      if(record.action==='dataset.prepare')return prepareDataset(input,record);
      if(record.action==='monitoring.prepare')return prepareMonitoring(input,record);
      need(false,'GLEIF_ACTION','Choose a supported project action.');
    }
    async function start(request) {
      return serial(async()=>{
        key(request.id,'operation ID');need(actions.includes(request.action)&&request.input&&typeof request.input==='object'&&!Array.isArray(request.input),'GLEIF_REQUEST');
        let record=state.operations.find(r=>r.id===request.id);
        if(record) {
          need(record.action===request.action&&stable(record.input)===stable(request.input),'GLEIF_REQUEST_CHANGED','Continue the original request with its exact input.',409);
          if(record.state==='COMPLETE'||active?.record.id===record.id)return entry(record);
        } else {
          need(!active,'GLEIF_BUSY','The current project operation is still running.',409);
          if(request.expectedRevision!==undefined)need(state.revision===request.expectedRevision,'GLEIF_REVISION_CHANGED','The project changed. Retain your edits and reload its saved state.',409);
          record={id:request.id,action:request.action,input:clone(request.input),createdAt:now(),updatedAt:now(),state:'PENDING',attempts:0};
          if(record.action==='monitoring.prepare'){
            const preview=previewMonitoring(await selection(record.input),record.input,metadata.id);
            need(record.input.expectedPreviewSha256===preview.previewSha256,'GLEIF_MONITORING_PREVIEW_CHANGED','Review the current source mapping before preparing.',409);
            record.originalProject=await retainedFile('gleif-project.json',monitoringProjectBytes(await portable()));
          }
          state.operations.push(record);
        }
        need(!active,'GLEIF_BUSY','The current project operation is still running.',409);
        if(record.action==='capture'||record.action==='capture.resume'){const c=state.captures.find(v=>v.id===(record.action==='capture.resume'?record.input.captureId:record.id));if(c?.notBefore)need(Date.now()>=Date.parse(c.notBefore),'GLEIF_PROVIDER_COOLDOWN','Resume after '+c.notBefore+'.',429);}
        record.state='RUNNING';record.attempts++;record.updatedAt=now();record.error=null;await save();
        const controller=new AbortController(),item={record,controller,promise:null};active=item;
        item.promise=(async()=>{
          let completion;
          try{completion={result:await perform(record,controller.signal),error:null,state:'COMPLETE'};}
          catch(error){completion={result:null,error:publicError(error),state:'INTERRUPTED'};
            if(record.action==='capture'||record.action==='capture.resume'){const captured=state.captures.find(c=>c.id===(record.action==='capture.resume'?record.input.captureId:record.id));if(captured&&captured.state!=='COMPLETE'){captured.state='INTERRUPTED';captured.error=completion.error;}}}
          finally{try{const value={...completion,updatedAt:now()};await save({record,value});Object.assign(record,value);}finally{if(active===item)active=null;}}
          return entry(record);
        })();item.promise.catch(()=>{});return entry(record);
      });
    }
    const operation=id=>{check();const r=state.operations.find(v=>v.id===key(id));need(r,'GLEIF_OPERATION_NOT_FOUND','Choose a saved operation.',404);return clone(r);};
    async function wait(id) {const record=operation(id);if(active?.record.id===id)await active.promise;return entry(operation(id));}
    async function pause(id) {need(active?.record.id===id,'GLEIF_NOT_RUNNING','This operation is not running.',409);active.controller.abort(new Error('Operator paused source acquisition.'));return wait(id);}
    function status() {
      need(!closed,'GLEIF_CLOSED','This project is closing.',409);return {schema:SCHEMA,workspace:metadata,revision:state.revision,persistenceFailure:persistenceFailure?publicError(persistenceFailure):null,active:active?entry(active.record):null,
        captures:state.captures.map(c=>({...clone(c),attempts:undefined,pages:c.pages.map(p=>({url:p.url,observedAt:p.observedAt,records:p.records,sha256:p.sha256,bytes:p.bytes})),rows:c.pages.reduce((a,p)=>a+p.records,0)})),
        reviews:latestReviews().map(clone),reports:clone(state.reports),datasets:clone(state.datasets),operations:state.operations.map(entry)};
    }
    async function rows(id,{offset=0,limit=50,search=''}={}) {
      need(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>0&&limit<=250,'GLEIF_ROWS');
      const full=await entities(id),needle=String(search).toLocaleLowerCase();
      const records=full.records.filter(r=>!needle||[r.row.lei,r.row.legalName,r.row.legalJurisdiction,r.row.registrationStatus].some(v=>v.toLocaleLowerCase().includes(needle)));
      const reviews=state.reviews;
      return {capture:full.capture,issues:full.issues,usable:full.complete,sourceComplete:full.sourceComplete,offset,total:records.length,nextOffset:offset+limit<records.length?offset+limit:null,
        items:records.slice(offset,offset+limit).map(item=>{const candidates=reviews.filter(r=>r.lei===item.row.lei);const review=candidates.filter(r=>r.captureId===id).at(-1)??candidates.at(-1)??null;
          return {...item,review:review?clone(review):null,needsReview:!!review&&review.resourceSha256!==identity(item.resource)};})};
    }
    async function datasetQuery(id,query='') {
      const selected=state.datasets.find(d=>d.id===key(id));need(selected,'GLEIF_DATASET_NOT_FOUND','Choose a saved dataset.',404);
      const {loadDatasetConfig}=await import('../dataset-handler.mjs'),native=await loadDatasetConfig(join(directory,selected.relativeDirectory,'dataset.json'));
      need(native.describe().snapshot===selected.snapshot,'GLEIF_DATASET_CHANGED','The original native dataset differs.',409);
      const context={query:new URLSearchParams(query)},admitted=native.admit(context),result=admitted===true?native.handle(context):admitted;return result;
    }
    async function portable() {
      check();need(!active,'GLEIF_BUSY','Finish or pause the current source operation before exporting.',409);
      const snapshot=clone(state),hashes=new Set();
      for(const c of snapshot.captures)for(const page of c.attempts)hashes.add(page.sha256);
      for(const r of [...snapshot.reports,...snapshot.datasets])for(const file of r.files)hashes.add(file.sha256);
      for(const operation of snapshot.operations)if(operation.originalProject)hashes.add(operation.originalProject.sha256);
      const objects=[];for(const sha of [...hashes].sort()){const raw=await object(sha);objects.push({sha256:sha,bytes:raw.length,base64:raw.toString('base64')});}
      const body={schema:SCHEMA+'.package',metadata:clone(metadata),state:snapshot,objects};return {...body,sha256:identity(body)};
    }
    let recovered=false;
    for(const operation of state.operations)if(['PENDING','RUNNING'].includes(operation.state)){operation.state='INTERRUPTED';operation.updatedAt=now();
      operation.error={code:'GLEIF_PROCESS_REOPENED',message:'The previous process stopped. Resume this exact saved request.'};recovered=true;}
    for(const capture of state.captures)if(capture.state==='FETCHING'){capture.state='INTERRUPTED';capture.error={code:'GLEIF_PROCESS_REOPENED',message:'The previous source process stopped. Continue its retained next page.'};recovered=true;}
    if(recovered)await save();
    return {directory,metadata,start,wait,pause,operation,status,rows,entities,compare,monitoringPreview,datasetQuery,portable,object,async packageFile(){return {name:'gleif-project.json',...await put(bytes(await portable()))};},
      async close(){if(closed)return;closed=true;if(active){active.controller.abort(new Error('Project closed.'));await active.promise;}await queue;await unlock();}};
  } catch(e) {await unlock();throw e;}
}
export async function receiveGleifWorkspace({directory,package:input}={}) {
  absolute(directory);const {sha256,...body}=input??{};
  need(body.schema===SCHEMA+'.package'&&sha256===identity(body)&&body.metadata?.schema===SCHEMA&&body.state?.schema===SCHEMA+'.state'&&body.state?.workspaceId===body.metadata?.id&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.metadata?.id??'')&&Number.isSafeInteger(body.state?.revision)&&body.state.revision>=0,
    'GLEIF_PACKAGE','Choose the complete original research project package.');
  need(Array.isArray(body.objects)&&Array.isArray(body.state.captures)&&Array.isArray(body.state.reviews)&&Array.isArray(body.state.reports)&&Array.isArray(body.state.datasets)&&Array.isArray(body.state.operations),
    'GLEIF_PACKAGE','The original project collections are missing.');
  label(body.metadata.title,'project title',200);
  for(const name of ['captures','reports','datasets','operations'])need(new Set(body.state[name].map(item=>key(item.id))).size===body.state[name].length,'GLEIF_PACKAGE_IDENTITIES');
  const rawByHash=new Map();
  for(const item of body.objects){need(/^[a-f0-9]{64}$/.test(item.sha256)&&typeof item.base64==='string'&&!rawByHash.has(item.sha256),'GLEIF_PACKAGE_OBJECT');
    need(item.base64.length<=Math.ceil(MAX/3)*4,'GLEIF_PACKAGE_OBJECT_SIZE');const raw=Buffer.from(item.base64,'base64');need(raw.toString('base64')===item.base64&&raw.length===item.bytes&&digest(raw)===item.sha256,'GLEIF_PACKAGE_OBJECT','A retained source file differs.');rawByHash.set(item.sha256,raw);}
  const required=new Set();
  for(const c of body.state.captures){for(const page of c.attempts){required.add(page.sha256);need(rawByHash.get(page.sha256)?.length===page.bytes,'GLEIF_PACKAGE_SOURCE');}
    assembleCapture(c,c.pages.map(p=>{const raw=rawByHash.get(p.sha256);need(raw&&raw.length===p.bytes,'GLEIF_PACKAGE_SOURCE');return new TextDecoder('utf-8',{fatal:true}).decode(raw);}));}
  for(const value of [...body.state.reports,...body.state.datasets])for(const file of value.files){required.add(file.sha256);need(rawByHash.get(file.sha256)?.length===file.bytes,'GLEIF_PACKAGE_FILE');}
  for(const operation of body.state.operations)if(operation.originalProject){const file=operation.originalProject;need(operation.action==='monitoring.prepare'&&file.name==='gleif-project.json'&&rawByHash.get(file.sha256)?.length===file.bytes,'GLEIF_PACKAGE_MONITORING_PROJECT');required.add(file.sha256);}
  need([...required].every(sha=>rawByHash.has(sha))&&required.size===rawByHash.size,'GLEIF_PACKAGE_FILES','The complete source/file inventory differs.');
  for(const dataset of body.state.datasets){
    need(dataset.relativeDirectory==='datasets/'+dataset.id&&dataset.files.length===3&&new Set(dataset.files.map(file=>file.name)).size===3&&dataset.files.every(file=>['dataset.csv','dataset.json','source.json'].includes(file.name)),'GLEIF_PACKAGE_DATASET');
    const config=JSON.parse(rawByHash.get(dataset.files.find(file=>file.name==='dataset.json').sha256));
    need(config.schema==='stellar-forge.csv-dataset.v1'&&config.file==='dataset.csv'&&stable(config.columns)===stable(Object.fromEntries(COLUMNS.map(k=>[k,'string'])))&&config.maxBytes===MAX&&config.maxRows===1000000,'GLEIF_PACKAGE_DATASET_CONFIG','The native dataset must select its retained CSV and declared original columns.');
  }
  for(const review of body.state.reviews){
    key(review.id);need(review.resourceSha256===identity(review.originalResource)&&review.lei===review.originalResource?.id&&Number.isSafeInteger(review.version)&&review.version>0,'GLEIF_PACKAGE_REVIEW');
    const source=body.state.captures.find(c=>c.id===review.captureId);need(source&&source.pages.some(page=>page.sha256===review.sourcePage?.sha256),'GLEIF_PACKAGE_REVIEW_SOURCE');
  }
  if(await exists(directory)){await privateDirectory(directory);const names=await readdir(directory);need(names.length===0||(names.every(n=>(['receiving.json','objects','datasets','publisher.lock','state.json','workspace.json'].includes(n)||/^\.gleif-write-[a-f0-9-]{36}$/.test(n)))&&(names.includes('receiving.json')||names.every(n=>n==='publisher.lock'||/^\.gleif-write-[a-f0-9-]{36}$/.test(n)))),'GLEIF_RECEIVE_DESTINATION','Choose an empty private receiving directory or resume its original receiving.',409);}
  else await privateDirectory(directory,true);
  const unlock=await acquireWorkspace(directory);
  try{
    const receiving={schema:SCHEMA+'.receiving',sha256,workspaceId:body.metadata.id};
    if(await exists(join(directory,'receiving.json')))need(stable(await readJson(join(directory,'receiving.json')))===stable(receiving),'GLEIF_RECEIVE_CHANGED');
    else await immutableFile(join(directory,'receiving.json'),bytes(receiving));
    const immutable=async(path,raw)=>{if(await exists(path))need((await readPrivate(path,MAX)).equals(raw),'GLEIF_RECEIVE_CHANGED');else await immutableFile(path,raw);};
    // A stopped receiver can already have written either final identity file. Reconcile the same package before continuing.
    for(const[name,value]of [['state.json',body.state],['workspace.json',body.metadata]])if(await exists(join(directory,name)))need((await readPrivate(join(directory,name),MAX)).equals(bytes(value)),'GLEIF_RECEIVE_CHANGED','Open the existing received project or resume its original unchanged package.',409);
    for(const folder of ['objects','datasets'])await privateDirectory(join(directory,folder),true);
    for(const[sha,raw]of rawByHash)await immutable(join(directory,'objects',sha),raw);
    for(const dataset of body.state.datasets){key(dataset.id);need(dataset.relativeDirectory==='datasets/'+dataset.id,'GLEIF_PACKAGE_DATASET');await privateDirectory(join(directory,dataset.relativeDirectory),true);
      for(const file of dataset.files){need(['dataset.csv','dataset.json','source.json'].includes(file.name),'GLEIF_PACKAGE_DATASET');await immutable(join(directory,dataset.relativeDirectory,file.name),rawByHash.get(file.sha256));}}
    await immutable(join(directory,'state.json'),bytes(body.state));await immutable(join(directory,'workspace.json'),bytes(body.metadata));
    return {schema:SCHEMA+'.receiving',workspaceId:body.metadata.id,sha256,directory,files:rawByHash.size,state:'COMPLETE'};
  } finally {await unlock();}
}
