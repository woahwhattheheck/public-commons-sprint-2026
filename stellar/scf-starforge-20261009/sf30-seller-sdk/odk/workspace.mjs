// MIT. Complete original Central cohorts, form generations and submission history.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { parsePage } from '../odata/source.mjs';
import { createCentralSource, decodeCentralCatalog, compileCentralQuery, normalizeScope, repeatRelations,
  formPath, formVersionPath, submissionPath, originalSpreadsheet, segment, CENTRAL_SOURCE } from './source.mjs';
import { openCentralStore } from './store.mjs';
import { digest, fault, formatted, identifier, now, stable } from '../odata/state.mjs';
import { analyzeCapture, compareCaptures, exportCentralDataset, createCentralReport } from './analysis.mjs';
import { createCentralArchive } from './archive.mjs';
import { openODataPublisher } from '../odata/publisher.mjs';
import { initReleaseStore, inspectRelease, normalizeReleaseRuntime } from '../../sf82-seller-pilot/releases.mjs';
import { prepareDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { capturePublisherSnapshot, receivePublisherSnapshot, publisherTransferState } from './publisher-transfer.mjs';

const copy = value => structuredClone(value);
const keyFor = value => digest(stable(value));
const formKey = form => keyFor([String(form.projectId),form.formId]).slice(0,24);
const tableKey = (key,name) => key+'_'+digest(name).slice(0,24);
const detail = error => ({code:error.code||'CENTRAL_OPERATION',message:error.message,status:error.status||500,
  ...(error.providerStatus?{providerStatus:error.providerStatus}:{}),...(error.receipt?{receipt:error.receipt}:{}),
  ...(error.retryAfter?{retryAfter:error.retryAfter}:{})});
const cleanReceipt = ({raw,value,...record}) => record;
function array(value,label) {
  if(!Array.isArray(value))throw fault('CENTRAL_COLLECTION','Central returned an invalid '+label+' collection.',502);
  return value;
}
function summary(capture) {
  const {forms,tables,quality,decisions,...value}=capture;
  return {...value,quality:quality?{issueCount:quality.issues.length,history:quality.history,formHistory:quality.formHistory}:null,
    decision:decisions?.at(-1)?{id:decisions.at(-1).id,decision:decisions.at(-1).decision,note:decisions.at(-1).note}:null,forms:forms.map(({catalog,versions,generations,metadata,...form})=>({...form,formVersionCount:versions?.length??0})),
    tables:tables.map(({query,...table})=>({...table,fieldCount:query.fields.length})),
    rowCount:tables.reduce((sum,table)=>sum+table.rowCount,0)};
}
export async function openCentralWorkspace({directory,fetchImpl=globalThis.fetch,extend}={}) {
  if(extend!==undefined&&typeof extend!=='function')throw fault('CENTRAL_EXTENSION','Use a trusted workspace extension function.');
  const store=await openCentralStore(directory),root=store.directory,running=new Map(),operations=new Set();
  let closed=false,closing=null,publisher=null,publisherQueue=Promise.resolve();
  for(const capture of store.list('capture'))if(capture.status==='CAPTURING')
    store.update('capture',capture.id,value=>({...value,status:'PAUSED',error:null,resumeReason:'The previous owner ended; continue the retained capture.'}));
  function ensureOpen(){if(closed)throw fault('CENTRAL_CLOSED','Reopen the Central workspace.');}
  const sourceFor=connection=>createCentralSource({...connection,fetchImpl});
  function state() {
    const identity=store.identity(),transfers=publisherTransferState(store);
    return {schema:identity.schema,id:identity.workspaceId,revision:Number(identity.revision),createdAt:identity.createdAt,
      receivedArchive:identity.receivedArchive?JSON.parse(identity.receivedArchive):null,
      connections:store.list('connection'),plans:store.list('plan'),captures:store.list('capture').map(summary),
      reviews:store.list('review').map(({quality,findings,indicators,...record})=>record),
      exports:store.list('export').map(({receipts,mapping,...record})=>record),
      reports:store.list('report').map(({receipts,indicators,...record})=>record),archives:store.list('archive'),running:[...running.keys()],
      publisherSnapshots:transfers.snapshots.map(({selection,files,sourceFiles,request,...value})=>({...value,
        selection:selection?{generation:selection.releaseState?.generation??null,active:selection.releaseState?.active??null,
          previous:selection.releaseState?.previous??null,datasetCount:selection.datasets.length,releaseCount:selection.releases.length}:null})),
      publisherReceiving:transfers.receiving.map(({request,datasets,packages,releases,originalSelection,...value})=>({...value,
        snapshotId:request.snapshotId,datasetCount:datasets.length,packageCount:packages.length,releaseCount:releases.length,
        releases:releases.map(({originalId,originalDigest,localId,localDigest})=>({originalId,originalDigest,localId,localDigest}))}))};
  }
  async function connect(input={}) {
    ensureOpen();const id=identifier(input.id||randomUUID(),'connection ID');
    const selected={id,name:String(input.name||id).slice(0,128),url:input.url,authEnv:input.authEnv,allowLoopback:input.allowLoopback===true};
    const source=sourceFor(selected);selected.url=source.baseUrl;
    const old=store.get('connection',id,false);
    if(old){if(stable({...selected})!==stable(Object.fromEntries(Object.keys(selected).map(key=>[key,old[key]]))))
      throw fault('CENTRAL_CONNECTION_EXISTS','This connection ID already identifies another Central server or credential reference.',409);return old;}
    const user=await source.json('users/current'),projects=await source.json('projects');
    array(projects.value,'projects');
    const userBody=await store.retain(user.raw),projectBody=await store.retain(projects.raw);
    return store.put('connection',id,{...selected,createdAt:now(),actor:user.value,
      verifiedAt:user.receivedAt,receipts:{actor:{...cleanReceipt(user),...userBody},projects:{...cleanReceipt(projects),...projectBody}}},0);
  }
  async function projects({connectionId}) {
    ensureOpen();const connection=store.get('connection',connectionId),result=await sourceFor(connection).json('projects');
    array(result.value,'projects');await store.retain(result.raw);
    return {projects:result.value,receipt:cleanReceipt(result)};
  }
  async function forms({connectionId,projectId}) {
    ensureOpen();const connection=store.get('connection',connectionId),result=await sourceFor(connection).json('projects/'+segment(projectId)+'/forms');
    array(result.value,'forms');await store.retain(result.raw);
    return {forms:result.value,receipt:cleanReceipt(result)};
  }
  function createPlan(input={}) {
    ensureOpen();store.get('connection',input.connectionId);
    const id=identifier(input.id||randomUUID(),'plan ID');
    if(!Array.isArray(input.forms)||!input.forms.length)throw fault('CENTRAL_PLAN_FORMS','Select the project and form or forms for this reporting cohort.');
    const forms=input.forms.map(item=>{
      segment(item.projectId,'project ID');segment(item.formId,'XML form ID');
      return {projectId:String(item.projectId),formId:item.formId};
    });
    if(new Set(forms.map(formKey)).size!==forms.length)throw fault('CENTRAL_PLAN_DUPLICATE','Select each form once.');
    const record={id,name:String(input.name||id).slice(0,160),connectionId:input.connectionId,forms,scope:normalizeScope(input.scope)};
    const old=store.get('plan',id,false);
    if(old){if(stable(record)!==stable(Object.fromEntries(Object.keys(record).map(key=>[key,old[key]]))))
      throw fault('CENTRAL_PLAN_EXISTS','This plan ID already has another immutable cohort definition.',409);return old;}
    return store.put('plan',id,{...record,createdAt:now()},0);
  }
  async function resource(captureId,key,kind,source,path,{format='json',signal,optional=false,context={}}={}) {
    let receipt=store.resource(captureId,key);
    if(!receipt){
      const result=await source.request(path,{signal,optional,
        accept:format==='json'?'application/json':format==='page'?'application/json;IEEE754Compatible=true':format==='xml'?'application/xml':'*/*',
        ...(format==='binary'?{consume:body=>store.retainStream(body)}:{})});
      const bytes=result.raw ? await store.retain(result.raw) : {};
      receipt=store.saveResource(captureId,key,kind,{...cleanReceipt(result),...bytes,...context});
    }
    if(format==='binary')return receipt;
    const raw=await store.raw(receipt.sha256);
    if(format!=='json'||receipt.outcome==='missing')return {...receipt,raw,value:null};
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{throw fault('CENTRAL_JSON','A retained Central resource is not valid UTF-8 JSON.',502);}
    return {...receipt,raw,value};
  }
  async function initializeForm(captureId,selection,source,signal) {
    const key=formKey(selection),existing=store.get('capture',captureId).forms.find(value=>value.key===key);
    if(existing)return existing;
    const path=formPath(selection.projectId,selection.formId),context={formKey:key,projectId:selection.projectId,formId:selection.formId};
    const metadata=await resource(captureId,key+'/form','form-metadata',source,path,{signal,context});
    const versions=await resource(captureId,key+'/versions','form-version-list',source,path+'/versions',{signal,context});
    array(versions.value,'published form versions');
    const service=await resource(captureId,key+'/service','service',source,path+'.svc',{signal,context});
    const csdl=await resource(captureId,key+'/csdl','csdl',source,path+'.svc/$metadata',{signal,format:'xml',context});
    const decoded=decodeCentralCatalog({root:new URL(path+'.svc',source.apiRoot).href,apiRoot:source.apiRoot,service,metadata:csdl});
    const {original,...catalog}=decoded,relations=repeatRelations(catalog),capture=store.get('capture',captureId);
    const form={...selection,key,name:String(metadata.value?.name||selection.formId),metadata:metadata.value,
      catalog,catalogHash:keyFor({service:catalog.receipts.service.sha256,metadata:catalog.receipts.metadata.sha256}),
      versions:versions.value,versionsComplete:false,submissionsComplete:false,finalMetadata:null};
    const tables=catalog.entitySets.map(set=>{
      const relation=relations.find(item=>item.table===set.name);
      const query=compileCentralQuery(catalog,set.name,capture.scope);
      return {id:tableKey(key,set.name),formKey:key,name:set.name,query,status:'PENDING',
        rowCount:0,pageCount:0,nextLink:query.url,observedCounts:[],
        relation:relation?{...relation,parentTableId:tableKey(key,relation.parentTable)}:null};
    });
    store.update('capture',captureId,value=>{
      if(value.forms.some(item=>item.key===key))throw fault('CENTRAL_FORM_RACE','This form was initialized by another capture operation.',409);
      value.forms.push(form);value.tables.push(...tables);return value;
    });
    return form;
  }
  async function attachments(captureId,key,kind,source,path,signal,context) {
    const listing=await resource(captureId,key+'/list',kind+'-list',source,path,{signal,optional:true,context});
    if(listing.outcome==='missing')return {list:cleanReceipt(listing),expected:null,present:0,missing:[],unavailable:true,items:[]};
    const entries=array(listing.value,kind),items=[];let present=0;
    const names=new Set();
    for(const entry of entries){
      signal.throwIfAborted();
      if(typeof entry.name!=='string'||typeof entry.exists!=='boolean'||names.has(entry.name))
        throw fault('CENTRAL_ATTACHMENT_LIST','The original attachment list has invalid or repeated names.',502);
      names.add(entry.name);
      if(!entry.exists){items.push({...entry,outcome:'not-uploaded'});continue;}
      const receipt=await resource(captureId,key+'/'+digest(entry.name),kind,source,path+'/'+segment(entry.name,'attachment filename'),
        {signal,format:'binary',optional:true,context:{...context,filename:entry.name,expected:true,
          ...(entry.datasetExists===true?{linkedDataset:true}:{})}});
      if(receipt.outcome==='retained')present++;
      items.push({...entry,outcome:receipt.outcome,sha256:receipt.sha256,bytes:receipt.bytes,receivedAt:receipt.receivedAt,etag:receipt.headers.etag??null});
    }
    return {list:cleanReceipt(listing),expected:entries.length,present,
      missing:items.filter(item=>item.outcome!=='retained').map(item=>item.name),items};
  }
  async function retainFormVersions(captureId,form,source,signal) {
    if(store.get('capture',captureId).forms.find(item=>item.key===form.key).versionsComplete)return;
    const versions=new Map();
    for(const version of form.versions){
      if(typeof version.version!=='string')throw fault('CENTRAL_FORM_VERSION','A published form generation lacks its original version string.',502);
      if(versions.has(version.version))throw fault('CENTRAL_FORM_VERSION','Central repeated a published form version.',502);
      versions.set(version.version,version);
    }
    const rootTable=tableKey(form.key,'Submissions');
    for(const row of store.iterateRows(captureId,rootTable)){
      const version=row.__system?.formVersion;
      if(typeof version==='string'&&!versions.has(version))versions.set(version,{version,observedInSubmission:true});
    }
    const generations=[];
    for(const version of versions.values()){
      signal.throwIfAborted();const path=formVersionPath(form.projectId,form.formId,version.version),
        key=form.key+'/generation/'+digest(version.version),context={formKey:form.key,formVersion:version.version};
      const xml=await resource(captureId,key+'/xml','form-xml',source,path+'.xml',{signal,format:'binary',optional:true,context});
      const fields=await resource(captureId,key+'/fields','form-fields',source,path+'/fields',{signal,optional:true,context});
      const extension=originalSpreadsheet(version);
      const spreadsheet=extension?await resource(captureId,key+'/spreadsheet','form-spreadsheet',source,path+extension,
        {signal,format:'binary',optional:true,context:{...context,filename:form.formId+extension}}):null;
      const media=await attachments(captureId,key+'/media','form-attachment',source,path+'/attachments',signal,context);
      generations.push({version:version.version,metadata:version,xml,fields:cleanReceipt(fields),spreadsheet,media});
    }
    store.update('capture',captureId,value=>{
      const selected=value.forms.find(item=>item.key===form.key);selected.generations=generations;selected.versionsComplete=true;return value;
    });
  }
  async function retainSubmissions(captureId,form,source,signal) {
    if(store.get('capture',captureId).forms.find(item=>item.key===form.key).submissionsComplete)return;
    let after='';
    while(true){
      const page=store.rows(captureId,tableKey(form.key,'Submissions'),{after,limit:250});
      for(const row of page.rows){
        signal.throwIfAborted();
        if(store.submission(captureId,form.key,row.__id)?.complete)continue;
        const key=form.key+'/submission/'+digest(row.__id),path=submissionPath(form.projectId,form.formId,row.__id),
          context={formKey:form.key,initialInstanceId:row.__id};
        const listing=await resource(captureId,key+'/versions','submission-version-list',source,path+'/versions',
          {signal,optional:true,context});
        const versions=[],seen=new Set();
        if(listing.outcome!=='missing')for(const version of array(listing.value,'submission versions')){
          signal.throwIfAborted();segment(version.instanceId,'submission version instance ID');
          if(seen.has(version.instanceId))throw fault('CENTRAL_SUBMISSION_VERSION','Central repeated a submission version identity.',502);
          seen.add(version.instanceId);
          const versionPath=path+'/versions/'+segment(version.instanceId),versionKey=key+'/version/'+digest(version.instanceId),
            versionContext={...context,versionInstanceId:version.instanceId,formVersion:version.formVersion??null};
          const xml=await resource(captureId,versionKey+'/xml','submission-xml',source,versionPath+'.xml',
            {signal,format:'binary',optional:true,context:versionContext});
          const media=await attachments(captureId,versionKey+'/media','submission-attachment',source,versionPath+'/attachments',signal,versionContext);
          versions.push({metadata:version,xml,media});
        }
        const record={instanceId:row.__id,complete:true,completedAt:now(),sourceSystem:row.__system??null,
          listing:cleanReceipt(listing),versions,
          unavailable:listing.outcome==='missing'||versions.length===0,
          missingAttachments:versions.reduce((sum,version)=>sum+version.media.missing.length,0),
          missingXml:versions.filter(version=>version.xml.outcome!=='retained').length};
        store.transaction(()=>{
          store.saveSubmission(captureId,form.key,row.__id,record);
          const value=store.get('capture',captureId);
          store.writeRecord('capture',captureId,{...value,submissionCount:value.submissionCount+1,
            progress:{stage:'submission-history',form:form.formId,instanceId:row.__id}},value.revision);
        });
      }
      if(!page.next)break;after=page.next;
    }
    store.update('capture',captureId,value=>{value.forms.find(item=>item.key===form.key).submissionsComplete=true;return value;});
  }
  async function runCapture(id,controller) {
    const signal=controller.signal;
    try{
      let capture=store.get('capture',id),source=sourceFor(store.get('connection',capture.connectionId));
      for(const selection of capture.selection){signal.throwIfAborted();await initializeForm(id,selection,source,signal);}
      capture=store.get('capture',id);
      for(const selected of capture.tables){
        let table=store.get('capture',id).tables.find(item=>item.id===selected.id);
        const form=capture.forms.find(item=>item.key===table.formKey);
        while(table.nextLink!==null){
          signal.throwIfAborted();const requestedUrl=table.nextLink,pageKey='page/'+table.id+'/'+digest(requestedUrl);
          const retained=await resource(id,pageKey,'odata-page',source,requestedUrl,{signal,format:'page',
            context:{formKey:form.key,tableId:table.id}});
          const page=parsePage({catalog:form.catalog,query:table.query,raw:retained.raw,url:retained.url,
            headers:retained.headers,status:retained.status,receivedAt:retained.receivedAt});
          const rowsBody=await store.retain(formatted(page.rows));
          signal.throwIfAborted();
          store.commitPage(id,table.id,requestedUrl,page,cleanReceipt(retained),rowsBody,table.relation);
          table=store.get('capture',id).tables.find(item=>item.id===selected.id);
        }
      }
      for(const form of store.get('capture',id).forms){
        signal.throwIfAborted();
        store.update('capture',id,value=>({...value,progress:{stage:'form-versions',form:form.formId}}));
        await retainFormVersions(id,form,source,signal);await retainSubmissions(id,form,source,signal);
        const final=await resource(id,form.key+'/final-csdl','csdl-final',source,formPath(form.projectId,form.formId)+'.svc/$metadata',
          {signal,format:'xml',context:{formKey:form.key}});
        store.update('capture',id,value=>{const item=value.forms.find(item=>item.key===form.key);
          item.finalMetadata=cleanReceipt(final);item.schemaChangedDuringCapture=final.sha256!==item.catalog.receipts.metadata.sha256;return value;});
      }
      signal.throwIfAborted();
      store.update('capture',id,value=>{
        value.status='COMPLETE';value.completedAt=now();value.error=null;value.progress={stage:'complete'};
        value.contentHash=keyFor(value.tables.map(table=>({id:table.id,pages:store.pageRecords(id,table.id).map(page=>page.source.sha256)})));
        return value;
      });
      const quality=analyzeCapture(store,id);
      store.update('capture',id,value=>({...value,quality}));
    }catch(error){
      const paused=signal.aborted;
      store.update('capture',id,value=>({...value,status:paused?'PAUSED':'FAILED',error:paused?null:detail(error),
        progress:{...value.progress,stage:paused?'paused':'failed'}}));
    }finally{running.delete(id);}
    return summary(store.get('capture',id));
  }
  function resume({id}) {
    ensureOpen();const capture=store.get('capture',id);
    if(capture.status==='COMPLETE'||running.has(id))return summary(capture);
    store.update('capture',id,value=>({...value,status:'CAPTURING',error:null,resumedAt:now()}));
    const controller=new AbortController(),entry={controller,promise:null};running.set(id,entry);
    entry.promise=runCapture(id,controller);return summary(store.get('capture',id));
  }
  function capture(input={}) {
    ensureOpen();const id=identifier(input.id||randomUUID(),'capture ID'),plan=store.get('plan',input.planId),
      request={planId:plan.id,label:String(input.label||plan.name).slice(0,160)};
    const existing=store.get('capture',id,false);
    if(existing){if(stable(existing.request)!==stable(request))throw fault('CENTRAL_CAPTURE_EXISTS','This capture ID already identifies another reporting cohort.',409);
      return summary(existing);}
    const startedAt=now(),scope={...plan.scope,submittedBefore:plan.scope.submittedBefore??startedAt};
    if(scope.submittedFrom&&scope.submittedFrom>=scope.submittedBefore)throw fault('CENTRAL_COHORT_RANGE','This cohort begins after its capture boundary.');
    store.put('capture',id,{id,request,planId:plan.id,connectionId:plan.connectionId,label:request.label,
      selection:plan.forms,scope,startedAt,status:'PENDING',forms:[],tables:[],submissionCount:0,progress:{stage:'discovery'},
      source: CENTRAL_SOURCE,decisions:[],error:null},0);
    return resume({id});
  }
  async function pause({id}) {
    ensureOpen();store.get('capture',id);const entry=running.get(id);
    if(entry){entry.controller.abort();await entry.promise;}
    return summary(store.get('capture',id));
  }
  async function wait({id}) {const entry=running.get(id);return entry?await entry.promise:summary(store.get('capture',id));}
  function edition({id}){return store.get('capture',id);}
  function quality({id}){return analyzeCapture(store,id);}
  function review({id,expectedRevision,decision,note,reviewer='',findings=[],indicators=[]}) {
    ensureOpen();const capture=store.get('capture',id);
    if(!['accept','revise'].includes(decision)||typeof note!=='string'||!note.trim())
      throw fault('CENTRAL_REVIEW','Choose accept or revise and record the source interpretation or remaining corrections.');
    if(capture.status!=='COMPLETE')throw fault('CENTRAL_REVIEW_CAPTURE','Finish the capture before accepting its reporting edition.',409);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==capture.revision)
      throw fault('CENTRAL_REVISION_CHANGED','Reopen the current capture before recording this review.',409);
    if(!Array.isArray(findings)||!Array.isArray(indicators))throw fault('CENTRAL_REVIEW_CONTENT','Use findings and indicators arrays.');
    const record={id:randomUUID(),captureId:id,decision,note,reviewer,findings,indicators,createdAt:now(),
      contentHash:capture.contentHash,quality:analyzeCapture(store,id)};
    return store.transaction(()=>{
      store.writeRecord('review',record.id,record,0);
      capture.decisions.push(record);
      return store.writeRecord('capture',id,capture,expectedRevision);
    });
  }
  async function exportFile({id,path}) {
    const record=store.get('export',id,false)??store.get('report',id,false)??store.get('archive',id,false);
    if(!record||!record.files.includes(path))throw fault('CENTRAL_EXPORT_FILE','Choose an original retained export file.',404);
    const directory=record.kind==='report'?'reports':record.kind==='archive'?'transfers':'exports';
    return {path:join(root,directory,record.id,path),name:path.split('/').at(-1),...(record.receipts?.[path]??{})};
  }
  function serialPublisher(operation){
    const pending=publisherQueue.then(operation);publisherQueue=pending.catch(()=>{});return pending;
  }
  const getPublisher=()=>publisher??=((async()=>{
    await mkdir(join(root,'publisher'),{recursive:true,mode:0o700});
    await initReleaseStore(join(root,'publisher','releases'),{resume:true});
    return openODataPublisher({workspace});
  })().catch(error=>{publisher=null;throw error;}));
  async function preparePublisherRelease(input){
    const releaseId=identifier(input?.releaseId,'release ID'),exportId=identifier(input?.exportId,'export ID');
    const request={exportId,releaseId,label:input.label??null,runtime:input.runtime??{port:0}},
      preparationId='prepare-'+digest(stable([root,releaseId])).slice(0,48),
      old=store.get('publisher-preparation',preparationId,false);
    if(old&&stable(old.request)!==stable(request))
      throw fault('CENTRAL_RELEASE_REQUEST','Keep the original export, release ID, label and runtime for this preparation.',409);
    if(old?.status==='COMPLETE')return old.result;
    const operation=old??store.put('publisher-preparation',preparationId,{status:'PREPARING',request,directory:root,createdAt:now()},0);
    const publisher=await getPublisher();let result;
    try{result=await publisher.prepare(input);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const packageDirectory=join(root,'publisher','packages',exportId),datasetDirectory=join(root,'publisher','datasets',exportId);
      const prepared=await prepareDatasetRelease(packageDirectory),staged=await inspectRelease(publisher.releases,releaseId);
      if(staged.label!==(input.label||prepared.description.name)||stable(staged.dataset)!==stable(prepared.dataset)||
        stable(staged.runtime)!==stable(normalizeReleaseRuntime(input.runtime??{port:0})))
        throw fault('CENTRAL_RELEASE_CHANGED','The existing native release differs from this original dataset preparation.',409);
      result={exportId,releaseId,packageDirectory,datasetDirectory,dataset:prepared.description,staged};
    }
    store.put('publisher-preparation',preparationId,{...operation,status:'COMPLETE',completedAt:now(),result},operation.revision);
    return result;
  }
  const workspace={directory:root,state,connect,projects,forms,createPlan,capture,resume,pause,wait,edition,quality,review,
    rows:({id,tableId,...options})=>{store.get('capture',id);return store.rows(id,tableId,options);},
    row:({id,tableId,rowId})=>{const value=store.row(id,tableId,rowId),capture=store.get('capture',id),table=capture.tables.find(item=>item.id===tableId);
      return {row:value,history:table.name==='Submissions'?store.submission(id,table.formKey,rowId):null};},
    resources:({id,...options})=>{store.get('capture',id);return store.resourceList(id,options);},
    compare:options=>compareCaptures(store,options),exportDataset:options=>exportCentralDataset(store,options),
    report:options=>createCentralReport(store,options),backup:options=>serialPublisher(()=>createCentralArchive(store,options)),
    sourceFile:({hash})=>store.sourceFile(hash),exportFile,
    capturePublisher:input=>serialPublisher(()=>capturePublisherSnapshot(store,input)),
    receivePublisher:input=>serialPublisher(()=>receivePublisherSnapshot(store,input)),
    publisherTransfers:()=>publisherTransferState(store),
    prepareRelease:input=>serialPublisher(()=>preparePublisherRelease(input)),
    releaseStatus:()=>serialPublisher(async()=>(await getPublisher()).status()),
    activateRelease:input=>serialPublisher(async()=>(await getPublisher()).activate(input)),
    rollbackRelease:input=>serialPublisher(async()=>(await getPublisher()).rollback(input)),
    async close(){if(closing)return closing;closed=true;closing=(async()=>{
      const entries=[...running.values()];for(const entry of entries)entry.controller.abort();
      await Promise.allSettled([...entries.map(entry=>entry.promise),...operations]);await store.close();
    })();return closing;}};
  for(const name of ['connect','projects','forms','exportDataset','report','backup','prepareRelease','releaseStatus','activateRelease','rollbackRelease','capturePublisher','receivePublisher']){
    const method=workspace[name];
    workspace[name]=(...args)=>{ensureOpen();const operation=Promise.resolve().then(()=>method(...args));operations.add(operation);
      return operation.finally(()=>operations.delete(operation));};
  }
  try{if(extend)await extend({workspace,store});return workspace;}
  catch(error){await workspace.close();throw error;}
}
