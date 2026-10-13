// MIT. Pure retained CKAN workbench observations for the original SF93 incident engine.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resolve,isAbsolute,posix} from 'node:path';
import {catalogOrigin,parseCkanJson} from '../sf30-seller-sdk/ckan/capture.mjs';
import {compileQueries} from '../sf30-seller-sdk/ckan/declaration.mjs';
import {checkCkanSemanticReview} from '../sf30-seller-sdk/ckan/semantics.mjs';
import {identity} from '../sf30-seller-sdk/postgres/publisher/files.mjs';

export const CKAN_FILES=['ckan-observation.json','ckan-workbench.json','ckan-files.json'];
export const CKAN_FILE_LIMIT=8*1024*1024;
export const CKAN_OBSERVATION_SCHEMA='stellar-forge.sf93.ckan-observation.v1';
export const CKAN_SNAPSHOTS_SCHEMA='stellar-forge.sf93.ckan-workbench-reads.v1';
export const CKAN_RETAINED_SCHEMA='stellar-forge.sf93.ckan-retained-files.v1';
export const CKAN_KINDS=['CKAN_SOURCE_UNAVAILABLE','CKAN_IDENTITY_CHANGED','CKAN_SOURCE_INTEGRITY',
  'CKAN_OPERATION_FAILED','CKAN_OPERATION_OVERDUE','CKAN_REVIEW_PENDING','CKAN_PUBLICATION_PENDING'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const CODE=/^[A-Z0-9_]{1,120}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const ckanObservationHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value)+'\n');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(condition,code='SF93_CKAN_CAPTURE_INVALID')=>{if(!condition)fail(code);};
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const natural=value=>Number.isSafeInteger(value)&&value>=0;
function fields(value,names,code='SF93_CKAN_CAPTURE_INVALID'){
  need(plain(value)&&Object.keys(value).every(key=>names.includes(key)),code);return value;
}
function text(value,max,code,pattern){
  need(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=max&&
    Buffer.from(value).toString('utf8')===value&&!/[\u0000-\u001f\u007f]/.test(value)&&(!pattern||pattern.test(value)),code);
  return value;
}
function integer(value,min,max,name){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,'CKAN_SOURCE_'+name.toUpperCase()+'_INVALID');return value;
}
export function ckanRetainedPath(value){
  need(typeof value==='string'&&value.length>0&&value.length<=2048&&!value.includes('\\')&&!value.includes('\0')&&
    !posix.isAbsolute(value)&&posix.normalize(value)===value&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'CKAN_RETAINED_PATH_INVALID');
  return value;
}
export function normalizeCkanSource(value){
  fields(value,['directory','projectCreatedAt','catalogOrigin','sourceId','refreshId','publicationId',
    'maxBytes','maxFiles','maxStateBytes','timeoutMs','operationAfterSeconds','reviewAfterSeconds',
    'publicationAfterSeconds','requirePublication'],'CKAN_SOURCE_CONFIGURATION_INVALID');
  const directory=text(value.directory,4096,'CKAN_SOURCE_DIRECTORY_INVALID');
  need(isAbsolute(directory)&&resolve(directory)===directory&&directory!=='/','CKAN_SOURCE_DIRECTORY_INVALID');
  need(instant(value.projectCreatedAt),'CKAN_SOURCE_PROJECT_CREATED_AT_INVALID');
  const origin=catalogOrigin(value.catalogOrigin);
  need(origin===value.catalogOrigin,'CKAN_SOURCE_ORIGIN_INVALID');
  const selected=name=>{const id=value[name]??null;need(id===null||UUID.test(id),'CKAN_SOURCE_SELECTION_INVALID');return id;};
  need(value.requirePublication===undefined||typeof value.requirePublication==='boolean','CKAN_SOURCE_PUBLICATION_POLICY_INVALID');
  return {directory,projectCreatedAt:value.projectCreatedAt,catalogOrigin:origin,
    sourceId:selected('sourceId'),refreshId:selected('refreshId'),publicationId:selected('publicationId'),
    maxBytes:integer(value.maxBytes??4*1024*1024,1024,6*1024*1024-65536,'maxBytes'),
    maxFiles:integer(value.maxFiles??256,1,4096,'maxFiles'),
    maxStateBytes:integer(value.maxStateBytes??2*1024*1024,1024,3*1024*1024-65536,'maxStateBytes'),
    timeoutMs:integer(value.timeoutMs??30000,100,300000,'timeoutMs'),
    operationAfterSeconds:integer(value.operationAfterSeconds??300,1,31536000,'operationAfterSeconds'),
    reviewAfterSeconds:integer(value.reviewAfterSeconds??86400,0,31536000,'reviewAfterSeconds'),
    publicationAfterSeconds:integer(value.publicationAfterSeconds??3600,0,31536000,'publicationAfterSeconds'),
    requirePublication:value.requirePublication??true};
}
function registration(value){
  fields(value,['id','label']);
  return {id:text(value.id,64,'CKAN_REGISTRATION_INVALID',ID),label:text(value.label,120,'CKAN_REGISTRATION_INVALID')};
}
export function readCkanWorkbenchState(bytes){
  const value=parseCkanJson(bytes);
  need(value?.schema==='stellar-forge.ckan-workbench.v1'&&instant(value.createdAt)&&instant(value.updatedAt),
    'CKAN_WORKBENCH_INVALID');
  catalogOrigin(value.catalogOrigin);
  for(const name of ['editions','sources','publications','exports','buyerRequests']){
    need(Array.isArray(value[name]),'CKAN_WORKBENCH_INVALID');
    const seen=new Set();
    for(const row of value[name]){
      need(plain(row)&&UUID.test(row.id??'')&&!seen.has(row.id),'CKAN_WORKBENCH_RECORD_INVALID');seen.add(row.id);
    }
  }
  need(value.refreshes===undefined||Array.isArray(value.refreshes),'CKAN_WORKBENCH_INVALID');
  const seen=new Set();
  for(const row of value.refreshes??[]){
    need(plain(row)&&UUID.test(row.id??'')&&!seen.has(row.id),'CKAN_WORKBENCH_RECORD_INVALID');seen.add(row.id);
  }
  if(value.operation!==null)need(plain(value.operation)&&UUID.test(value.operation.id??'')&&
    instant(value.operation.startedAt)&&['RUNNING','COMPLETE','CANCELLED','FAILED','INTERRUPTED'].includes(value.operation.state),
    'CKAN_WORKBENCH_OPERATION_INVALID');
  return value;
}
const latest=rows=>rows.slice().sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??'')||a.id.localeCompare(b.id)).at(-1)??null;
export function selectCkanRecords(state,selection){
  const find=(rows,id)=>{const value=rows.find(row=>row.id===id);need(value,'CKAN_SELECTION_CHANGED');return value;};
  const refreshes=state.refreshes??[];
  let refresh=selection.refreshId?find(refreshes,selection.refreshId):null;
  let publication=selection.publicationId?find(state.publications,selection.publicationId):null;
  let source=selection.sourceId?find(state.sources,selection.sourceId):
    refresh?find(state.sources,refresh.sourceId):publication?find(state.sources,publication.sourceId):latest(state.sources);
  if(!refresh&&source)refresh=latest(refreshes.filter(row=>row.sourceId===source.id||row.acceptedSourceId===source.id));
  if(refresh&&source)need([refresh.sourceId,refresh.acceptedSourceId].includes(source.id),'CKAN_SELECTION_CHANGED');
  const effectiveSource=refresh?.acceptedSourceId?find(state.sources,refresh.acceptedSourceId):source;
  if(publication)need(effectiveSource&&[source?.id,effectiveSource.id].includes(publication.sourceId),'CKAN_SELECTION_CHANGED');
  else if(effectiveSource)publication=latest(state.publications.filter(row=>row.sourceId===effectiveSource.id));
  const sourceIds=new Set([source?.id,effectiveSource?.id,refresh?.sourceId,publication?.sourceId].filter(Boolean));
  const sources=[...sourceIds].map(id=>find(state.sources,id));
  const editionIds=new Set([...sources.map(row=>row.editionId),refresh?.beforeEditionId,refresh?.afterEditionId].filter(Boolean));
  const editions=[...editionIds].map(id=>find(state.editions,id));
  const exports=publication?state.exports.filter(row=>row.publicationId===publication.id):[];
  return {source,effectiveSource,refresh,publication,sources,editions,exports};
}
export function ckanBytesRecord(buffer){
  need(Buffer.isBuffer(buffer));return {bytes:buffer.length,sha256:ckanObservationHash(buffer),data:buffer.toString('base64')};
}
function originalBytes(value,limit){
  fields(value,['bytes','sha256','data']);
  need(natural(value.bytes)&&value.bytes<=limit&&HASH.test(value.sha256??'')&&typeof value.data==='string');
  const bytes=Buffer.from(value.data,'base64');
  need(bytes.length===value.bytes&&bytes.toString('base64')===value.data&&ckanObservationHash(bytes)===value.sha256,
    'SF93_CKAN_ORIGINAL_BYTES_CHANGED');
  return bytes;
}
function age(now,value){return instant(value)&&Date.parse(value)<=now+5000?Math.max(0,Math.floor((now-Date.parse(value))/1000)):null;}
function codeOf(error){return CODE.test(error?.code??'')?error.code:'CKAN_SOURCE_FORMAT_INVALID';}
const integrityCode=code=>/^(CKAN_(?:RETAINED_(?:DIGEST_CHANGED|FILE_MISSING|PATH_INVALID)|WORKBENCH_(?:INVALID|RECORD_INVALID|OPERATION_INVALID)|SOURCE_BINDING_CHANGED|CAPTURE_.*(?:CHANGED|INVALID|MISSING)|SEMANTIC_.*(?:CHANGED|INVALID)|REFRESH_.*(?:CHANGED|INVALID)|PUBLICATION_.*(?:CHANGED|INVALID)|MERCHANT_.*(?:CHANGED|INVALID)|OUTPUT_INVALID|RESPONSE_.*))$/.test(code??'');
function table(meta,before,after,count,bytes){
  const selected=meta.selection;
  return {coverage:'UNAVAILABLE',
    project:{catalogOrigin:before?.catalogOrigin??after?.catalogOrigin??null,
      createdAt:before?.createdAt??after?.createdAt??null,updatedAt:before?.updatedAt??after?.updatedAt??null,
      identity:before?ckanObservationHash(encoded({catalogOrigin:before.catalogOrigin,createdAt:before.createdAt})):null},
    selection:{sourceId:null,refreshId:null,publicationId:null,effectiveSourceId:null},
    workbench:{beforeSha256:null,afterSha256:null,stable:null},operation:null,source:null,effectiveSource:null,
    editions:[],refresh:null,publication:null,exports:[],
    pending:{review:false,reviewAgeSeconds:null,publication:false,publicationAgeSeconds:null},
    identityContradiction:[before,after].filter(Boolean).some(state=>state.createdAt!==selected.projectCreatedAt||state.catalogOrigin!==selected.catalogOrigin),
    integrityCodes:[],sourceError:meta.errorCode,files:{count,bytes}};
}
function retainedReader(entries){
  const map=new Map(entries.map(row=>[row.path,row]));
  const get=path=>{const row=map.get(path);need(row,'CKAN_RETAINED_FILE_MISSING');return row;};
  const read=path=>get(path).buffer;
  const json=path=>parseCkanJson(read(path));
  const bind=(path,descriptor)=>{
    const row=get(path);need(row.sha256===descriptor.sha256&&(descriptor.bytes===undefined||row.bytes===descriptor.bytes),
      'CKAN_RETAINED_DIGEST_CHANGED');return row.buffer;
  };
  return {map,get,read,json,bind};
}
/** Pure inspection of the complete original source files. No network or workbench owner. */
function selectedContent(selected,reader,selection){
  const captures=new Map();
  for(const edition of selected.editions){
    need(edition.state==='COMPLETE'&&HASH.test(edition.manifestSha256??''),'CKAN_CAPTURE_MANIFEST_INVALID');
    const base='editions/'+edition.id+'/',raw=reader.bind(base+'capture.json',{sha256:edition.manifestSha256});
    const manifest=parseCkanJson(raw);
    need(manifest.schema==='stellar-forge.ckan-capture.v1'&&manifest.provider==='ckan'&&manifest.readOnly===true&&
      manifest.state==='COMPLETE'&&Array.isArray(manifest.files)&&Array.isArray(manifest.fields)&&Array.isArray(manifest.pages)&&
      natural(manifest.rowCount),'CKAN_CAPTURE_MANIFEST_INVALID');
    const rawFiles=new Map();
    for(const item of manifest.files){
      need(!rawFiles.has(item.file),'CKAN_CAPTURE_FILE_INVALID');ckanRetainedPath(item.file);
      rawFiles.set(item.file,reader.bind(base+item.file,item));
    }
    const result=name=>{const value=parseCkanJson(rawFiles.get(name));need(value.success===true&&plain(value.result),'CKAN_CAPTURE_METADATA_INVALID');return value.result;};
    const pkg=result('package.json'),resource=result('resource.json');
    need(pkg.id===manifest.packageId&&resource.id===manifest.resourceId&&pkg.resources?.some(row=>row.id===resource.id),
      'CKAN_CAPTURE_IDENTITY_CHANGED');
    let count=0;
    for(const page of manifest.pages){
      const buffer=rawFiles.get(page.file);need(buffer&&ckanObservationHash(buffer)===page.sha256,'CKAN_CAPTURE_PAGE_CHANGED');
      const value=parseCkanJson(buffer);
      need(value.success===true&&Array.isArray(value.result?.records)&&Array.isArray(value.result.fields)&&
        value.result.records.length===page.returned&&isDeepStrictEqual(value.result.fields,manifest.fields),'CKAN_CAPTURE_PAGE_CHANGED');
      count+=value.result.records.length;
    }
    need(count===manifest.rowCount,'CKAN_CAPTURE_COUNT_CHANGED');
    captures.set(edition.id,{manifest,manifestBytes:raw,manifestSha256:ckanObservationHash(raw),fields:manifest.fields,
      rawFiles,package:pkg,resource});
  }
  for(const source of selected.sources){
    need(HASH.test(source.sha256??''),'CKAN_SOURCE_BINDING_CHANGED');
    const config=parseCkanJson(reader.bind('sources/'+source.id+'.json',{sha256:source.sha256}));
    const capture=captures.get(source.editionId),query=compileQueries(config.queries)[source.query];
    need(config.schema==='stellar-forge.ckan-source.v1'&&capture&&query&&config.connection?.kind==='capture'&&
      config.connection.sha256===capture.manifestSha256&&config.catalogOrigin===capture.manifest.catalogOrigin&&
      config.packageId===capture.manifest.packageId&&config.resourceId===capture.manifest.resourceId&&
      isDeepStrictEqual(query.projection,source.projection),'CKAN_SOURCE_BINDING_CHANGED');
    if(source.semanticReview!==undefined)need(isDeepStrictEqual(source.semanticReview,query.semanticReview),'CKAN_SOURCE_BINDING_CHANGED');
    checkCkanSemanticReview(capture,query);
  }
  let refresh=null;
  if(selected.refresh){
    const record=selected.refresh,base='refreshes/'+record.id+'/';
    let comparison=null,decision=null,decisionSha256=null,changes=null;
    if(record.comparisonSha256){
      comparison=parseCkanJson(reader.bind(base+'comparison.json',{sha256:record.comparisonSha256,bytes:record.comparisonBytes}));
      need(comparison.schema==='stellar-forge.ckan-refresh-comparison.v1'&&
        comparison.before?.manifestSha256===record.beforeCaptureSha256&&comparison.after?.manifestSha256===record.afterCaptureSha256&&
        isDeepStrictEqual(comparison.keys,record.keys)&&comparison.scope==='retained-selections','CKAN_REFRESH_BINDING_CHANGED');
      reader.json(base+'input.json');
      reader.bind(base+'changes.jsonl',comparison.changes);reader.bind(base+'changes.idx',comparison.index);
      changes={path:base+'changes.jsonl',bytes:comparison.changes.bytes,sha256:comparison.changes.sha256,rows:comparison.changes.rows};
    }
    if(reader.map.has(base+'decision.json')){
      const row=reader.get(base+'decision.json');decision=parseCkanJson(row.buffer);decisionSha256=row.sha256;
      const intent=decision.intent;
      need(decision.schema==='stellar-forge.ckan-refresh-decision.v1'&&instant(decision.createdAt)&&
        intent?.refreshId===record.id&&intent.comparisonSha256===record.comparisonSha256&&
        intent.sourceId===record.sourceId&&intent.sourceSha256===record.sourceSha256&&
        intent.afterEditionId===record.afterEditionId&&intent.afterCaptureSha256===record.afterCaptureSha256&&
        ['accept','keep-current','withdraw-source'].includes(intent.decision),'CKAN_REFRESH_DECISION_CHANGED');
      if(record.decisionSha256)need(record.decisionSha256===decisionSha256,'CKAN_REFRESH_DECISION_CHANGED');
      if(record.acceptedSourceId)need(record.acceptedSourceId===intent.acceptedSourceId,'CKAN_REFRESH_DECISION_CHANGED');
    }
    if(record.decisionSha256)need(decision!==null,'CKAN_REFRESH_DECISION_CHANGED');
    const applied=['ACCEPTED','KEPT_CURRENT','SOURCE_WITHDRAWN'].includes(record.state);
    refresh={record,comparison,decision,decisionSha256,decisionPending:decision!==null&&!applied,
      reviewPending:record.state==='READY'&&!applied,reviewAgeSeconds:null,changes};
  }
  let publication=null;
  if(selected.publication){
    const record=selected.publication,base='publications/'+record.id+'/',run=record.run;
    let candidate=null,verifiedOutput=null;
    const declared=run?.data?.candidate;
    if(declared){
      need(UUID.test(record.runId??'')&&run.id===record.runId,'CKAN_PUBLICATION_BINDING_CHANGED');
      const location=base+'runs/'+record.runId+'/',raw=reader.read(location+'candidate.json');candidate=parseCkanJson(raw);
      const {candidateDigest,...body}=candidate;
      need(candidate.schema==='stellar-forge.ckan-dataset-candidate.v1'&&candidate.run===record.runId&&
        candidateDigest===identity(body),'CKAN_PUBLICATION_CANDIDATE_CHANGED');
      reader.bind(location+'dataset.json',{sha256:candidate.configHash});
      const csv=reader.bind(location+'data.csv',{sha256:candidate.csvHash,bytes:candidate.csvBytes});
      const plans=[...reader.map.values()].filter(row=>row.role==='publication-plan'&&row.path.startsWith(base));
      need(plans.length===1,'CKAN_PUBLICATION_PLAN_INVALID');
      const plan=parseCkanJson(plans[0].buffer),{digest,...planBody}=plan,folder=posix.dirname(plans[0].path)+'/';
      // Archive receiving rebases the workbench's local capture path while the
      // original candidate remains byte-for-byte bound to its recorded digest.
      // Only that exact selected capture location may differ from the record.
      let comparableCandidate=candidate;
      if(!isDeepStrictEqual(candidate,declared)){
        const capture=candidate.extraction?.observation?.capture,
          receivedCapture=declared?.extraction?.observation?.capture,
          relative=folder+'capture/capture.json';
        need(typeof capture?.file==='string'&&isAbsolute(capture.file)&&resolve(capture.file)===capture.file&&
          capture.file.endsWith('/'+relative)&&capture.file.length>relative.length+1&&
          receivedCapture?.file===resolve(selection.directory,relative),'CKAN_PUBLICATION_CANDIDATE_CHANGED');
        comparableCandidate={...candidate,extraction:{...candidate.extraction,
          observation:{...candidate.extraction.observation,capture:{...capture,file:receivedCapture.file}}}};
      }
      need(isDeepStrictEqual(comparableCandidate,declared),'CKAN_PUBLICATION_CANDIDATE_CHANGED');
      need(plan.schema==='stellar-forge.ckan-dataset-plan.v1'&&digest===identity(planBody)&&digest===candidate.planDigest&&
        plan.sourceHash===candidate.sourceHash&&plan.queryHash===candidate.queryHash,'CKAN_PUBLICATION_PLAN_CHANGED');
      reader.bind(folder+'original-source.json',{sha256:plan.sourceHash,bytes:plan.sourceBytes});
      reader.bind(folder+'source.json',{sha256:plan.runtimeSourceHash});reader.read(folder+'schema.csv');
      const manifestRaw=reader.bind(folder+'capture/capture.json',{sha256:plan.retainedCapture.manifestSha256});
      for(const file of parseCkanJson(manifestRaw).files)reader.bind(folder+'capture/'+ckanRetainedPath(file.file),file);
      const source=selected.sources.find(row=>row.id===record.sourceId);
      need(source?.sha256===candidate.sourceHash&&captures.get(source.editionId)?.manifestSha256===plan.retainedCapture.manifestSha256,
        'CKAN_PUBLICATION_BINDING_CHANGED');
      if(run.data.review)need(run.data.review.candidateDigest===candidateDigest,'CKAN_PUBLICATION_REVIEW_CHANGED');
      if(run.state==='PUBLISHED')need(run.data.publication?.snapshot===candidate.dataset.snapshot,'CKAN_PUBLICATION_RESULT_CHANGED');
      verifiedOutput={bytes:csv.length,sha256:candidate.csvHash,rowCount:candidate.dataset.rowCount,snapshot:candidate.dataset.snapshot};
    }
    if(run?.state==='PUBLISHED')need(candidate!==null&&run.data.review&&run.data.publication,'CKAN_PUBLICATION_RESULT_CHANGED');
    publication={record,candidate,review:run?.data?.review??null,result:run?.data?.publication??null,
      verifiedOutput,published:run?.state==='PUBLISHED'&&candidate!==null};
  }
  const exports=selected.exports.map(record=>{
    const base='merchant-packages/'+record.id+'/',manifest=parseCkanJson(reader.bind(base+'merchant-manifest.json',{sha256:record.manifestSha256}));
    need(manifest.schema==='stellar-forge.ckan-merchant-package.v1'&&Array.isArray(manifest.files)&&
      manifest.candidate?.candidateDigest===publication?.candidate?.candidateDigest,'CKAN_MERCHANT_BINDING_CHANGED');
    for(const file of manifest.files)reader.bind(base+ckanRetainedPath(file.file),file);
    reader.bind(base+'handlers.mjs',{sha256:record.handlerSha256});
    const semantics=manifest.semantics?reader.json(base+'semantics.json'):null;
    if(semantics)need(semantics.sha256===manifest.semantics.sha256&&semantics.definitionSha256===manifest.semantics.definitionSha256,
      'CKAN_MERCHANT_SEMANTICS_CHANGED');
    return {record,manifest,semantics};
  });
  return {refresh,publication,exports};
}
export function analyzeCkanObservation(meta,snapshots,retained){
  const selection=normalizeCkanSource(meta.selection);registration(meta.registration);
  need(instant(meta.startedAt)&&instant(meta.generatedAt)&&meta.startedAt<=meta.generatedAt&&
    (meta.errorCode===null||CODE.test(meta.errorCode)));
  fields(snapshots,['schema','before','after']);need(snapshots.schema===CKAN_SNAPSHOTS_SCHEMA);
  fields(retained,['schema','files']);need(retained.schema===CKAN_RETAINED_SCHEMA&&Array.isArray(retained.files)&&
    retained.files.length<=selection.maxFiles);
  const entries=[],seen=new Set();let total=0;
  for(const row of retained.files){
    fields(row,['path','role','bytes','sha256','data']);ckanRetainedPath(row.path);
    need(!seen.has(row.path)&&typeof row.role==='string'&&/^[a-z][a-z-]{0,63}$/.test(row.role));seen.add(row.path);
    const buffer=originalBytes({bytes:row.bytes,sha256:row.sha256,data:row.data},selection.maxBytes);
    total+=buffer.length;need(total<=selection.maxBytes);entries.push({...row,buffer});
  }
  let before=null,after=null,beforeRaw=null,afterRaw=null,parseError=null;
  for(const name of ['before','after']){
    const record=snapshots[name];
    if(record===null)continue;
    const buffer=originalBytes(record,selection.maxStateBytes);
    if(name==='before')beforeRaw=buffer;else afterRaw=buffer;
    try{const state=readCkanWorkbenchState(buffer);if(name==='before')before=state;else after=state;}
    catch(error){parseError=codeOf(error);}
  }
  const summary=table(meta,before,after,entries.length,total);
  Object.assign(summary.workbench,{beforeSha256:beforeRaw?ckanObservationHash(beforeRaw):null,
    afterSha256:afterRaw?ckanObservationHash(afterRaw):null,stable:beforeRaw&&afterRaw?beforeRaw.equals(afterRaw):null});
  let contentError=parseError;
  if(before){
    try{
      const selected=selectCkanRecords(before,selection);
      Object.assign(summary.selection,{sourceId:selected.source?.id??null,refreshId:selected.refresh?.id??null,
        publicationId:selected.publication?.id??null,effectiveSourceId:selected.effectiveSource?.id??null});
      summary.source=selected.source;summary.effectiveSource=selected.effectiveSource;summary.editions=selected.editions;
      summary.operation=before.operation?{...before.operation,ageSeconds:age(Date.parse(meta.generatedAt),before.operation.startedAt)}:null;
      Object.assign(summary,selectedContent(selected,retainedReader(entries),selection));
      if(summary.refresh){
        summary.refresh.reviewAgeSeconds=age(Date.parse(meta.generatedAt),summary.refresh.record.completedAt??summary.refresh.record.createdAt);
        summary.pending.review=summary.refresh.reviewPending;
        summary.pending.reviewAgeSeconds=summary.refresh.reviewAgeSeconds;
      }
      const effective=selected.effectiveSource;
      const applied=summary.refresh?.record.state==='ACCEPTED';
      const eligible=effective&&!effective.withdrawal&&(applied||selection.requirePublication);
      const hasPublished=effective&&before.publications.some(row=>row.sourceId===effective.id&&row.run?.state==='PUBLISHED'&&row.run.data?.publication);
      summary.pending.publication=Boolean(eligible&&!hasPublished);
      summary.pending.publicationAgeSeconds=summary.pending.publication?
        age(Date.parse(meta.generatedAt),applied?summary.refresh.record.reviewedAt??summary.refresh.record.completedAt:effective.createdAt):null;
    }catch(error){contentError=codeOf(error);}
  }
  if(contentError==='CKAN_SELECTION_CHANGED')summary.identityContradiction=true;
  const unstable=beforeRaw&&afterRaw&&!beforeRaw.equals(afterRaw)||meta.errorCode==='CKAN_SOURCE_CHANGED_DURING_READ';
  const limited=['CKAN_OBSERVATION_WORKLOAD_LIMIT','CKAN_OBSERVATION_SIZE_LIMIT'].includes(meta.errorCode);
  const codes=[meta.errorCode,...(!meta.errorCode&&contentError?[contentError]:[])].filter(Boolean);
  summary.integrityCodes=unstable?[]:[...new Set(codes.filter(integrityCode))];
  summary.sourceError=meta.errorCode??contentError;
  summary.coverage=limited?'WORKLOAD_LIMIT':unstable?'UNSTABLE':
    summary.identityContradiction||summary.integrityCodes.length||contentError&&!meta.errorCode?'INVALID_SOURCE':
    before&&after&&summary.workbench.stable&&!meta.errorCode&&!contentError?'COMPLETE':'UNAVAILABLE';
  return summary;
}
export function createCkanObservation({registration:selected,selection,startedAt,generatedAt,
  before=null,after=null,files=[],errorCode=null}){
  const snapshots={schema:CKAN_SNAPSHOTS_SCHEMA,before:before===null?null:ckanBytesRecord(before),after:after===null?null:ckanBytesRecord(after)};
  const retained={schema:CKAN_RETAINED_SCHEMA,files:files.map(row=>({path:ckanRetainedPath(row.path),role:row.role,...ckanBytesRecord(row.buffer)}))
    .sort((a,b)=>a.path.localeCompare(b.path))};
  const snapshotBytes=encoded(snapshots),retainedBytes=encoded(retained);
  need(snapshotBytes.length<=CKAN_FILE_LIMIT&&retainedBytes.length<=CKAN_FILE_LIMIT,'CKAN_OBSERVATION_SIZE_LIMIT');
  const meta={schema:CKAN_OBSERVATION_SCHEMA,registration:registration(selected),selection:normalizeCkanSource(selection),
    startedAt,generatedAt,errorCode,sources:{
      'ckan-workbench.json':{bytes:snapshotBytes.length,sha256:ckanObservationHash(snapshotBytes)},
      'ckan-files.json':{bytes:retainedBytes.length,sha256:ckanObservationHash(retainedBytes)}}};
  meta.summary=analyzeCkanObservation(meta,snapshots,retained);
  const metaBytes=encoded(meta);need(metaBytes.length<=CKAN_FILE_LIMIT,'CKAN_OBSERVATION_SIZE_LIMIT');
  return {kind:'CKAN_WORKBENCH',files:{'ckan-observation.json':metaBytes,'ckan-workbench.json':snapshotBytes,'ckan-files.json':retainedBytes},
    ckan:meta,report:{generatedAt,observation:{sessionId:ckanObservationHash(encoded({
      catalogOrigin:meta.selection.catalogOrigin,createdAt:meta.selection.projectCreatedAt}))}}};
}
export function readCkanObservationFiles(files){
  need(plain(files)&&Object.keys(files).length===CKAN_FILES.length&&CKAN_FILES.every(name=>Buffer.isBuffer(files[name])&&
    files[name].length>0&&files[name].length<=CKAN_FILE_LIMIT));
  const meta=parseCkanJson(files['ckan-observation.json']),snapshots=parseCkanJson(files['ckan-workbench.json']),
    retained=parseCkanJson(files['ckan-files.json']);
  fields(meta,['schema','registration','selection','startedAt','generatedAt','errorCode','sources','summary']);
  need(meta.schema===CKAN_OBSERVATION_SCHEMA);
  fields(meta.sources,['ckan-workbench.json','ckan-files.json']);
  for(const name of ['ckan-workbench.json','ckan-files.json']){
    fields(meta.sources[name],['bytes','sha256']);
    need(meta.sources[name].bytes===files[name].length&&meta.sources[name].sha256===ckanObservationHash(files[name]),
      'SF93_CKAN_CAPTURE_FILE_CHANGED');
  }
  const summary=analyzeCkanObservation(meta,snapshots,retained);
  need(isDeepStrictEqual(meta.summary,summary),'SF93_CKAN_CAPTURE_SUMMARY_CHANGED');
  return {meta,snapshots,retained,summary};
}
export function ckanObservationSignals(merchant,observation,now,previous=null){
  const packet=observation.packet,meta=packet?.ckan;
  if(!meta)return {signals:{CKAN_SOURCE_UNAVAILABLE:{bad:true,values:{}}},error:observation.error??'CKAN_SOURCE_READ_FAILED'};
  need(isDeepStrictEqual(meta.selection,merchant.ckan)&&meta.registration.id===merchant.id&&meta.registration.label===merchant.label);
  const summary=meta.summary,captured=Date.parse(meta.generatedAt),sessionId=packet.report.observation.sessionId;
  const same=previous?.sessionId===sessionId;
  const fresh=Number.isFinite(now)&&captured<=now+5000&&now-captured<=30000&&(!same||captured>Date.parse(previous.capturedAt));
  if(!fresh)return {packet,successful:false,fresh:false,signals:{CKAN_SOURCE_UNAVAILABLE:{bad:true,values:{}}},
    error:'CKAN_SOURCE_CLOCK_OR_AGE_INVALID'};
  const complete=summary.coverage==='COMPLETE';
  const condition=(bad,values={},immediate=false)=>({bad:bad?true:complete?false:null,values,...(immediate?{openAfter:1}:{})});
  const pending=(present,seconds,threshold)=>({bad:!complete?null:present?seconds===null?null:seconds>=threshold:false,
    values:{pending:present?1:0,oldestPendingSeconds:seconds??0,thresholdSeconds:threshold}});
  const operation=summary.operation;
  return {packet,successful:complete,fresh:true,previous:{sessionId,startedAt:meta.selection.projectCreatedAt,capturedAt:meta.generatedAt},
    window:{from:meta.startedAt,through:meta.generatedAt,complete,sessionStartedAt:meta.selection.projectCreatedAt},
    error:summary.sourceError??(complete?null:summary.coverage),signals:{
      CKAN_SOURCE_UNAVAILABLE:{bad:summary.identityContradiction?null:!complete,values:{}},
      CKAN_IDENTITY_CHANGED:condition(summary.identityContradiction,{},true),
      CKAN_SOURCE_INTEGRITY:condition(summary.integrityCodes.length>0,{errors:summary.integrityCodes.length},true),
      CKAN_OPERATION_FAILED:{bad:complete?['FAILED','INTERRUPTED'].includes(operation?.state):null,values:{}},
      CKAN_OPERATION_OVERDUE:pending(operation?.state==='RUNNING',operation?.ageSeconds??null,merchant.ckan.operationAfterSeconds),
      CKAN_REVIEW_PENDING:pending(summary.pending.review,summary.pending.reviewAgeSeconds,merchant.ckan.reviewAfterSeconds),
      CKAN_PUBLICATION_PENDING:pending(summary.pending.publication,summary.pending.publicationAgeSeconds,merchant.ckan.publicationAfterSeconds)
    }};
}
