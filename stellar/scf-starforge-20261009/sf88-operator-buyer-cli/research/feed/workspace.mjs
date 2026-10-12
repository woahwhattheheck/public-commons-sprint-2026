// MIT. Versioned feed contracts, source-bound review, immutable delivery.
import {readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {privateDirectory,readJson,readBytes,writeBytes,writeJson,jsonBytes,digest,exists} from '../../node/store.mjs';
import {canonical,safeId} from '../workspace.mjs';
import {check,normalizeContract,contractHash,defaultContract,valueError,jsonValue} from './contract.mjs';
import {sourceFingerprint,projectEdition,compareProjections,csv,feedCSV,feedJSONL} from './projection.mjs';
import {renderFeedReport,RECEIVING_GUIDE} from './report.mjs';

export const RELEASE_SCHEMA='stellar-forge.research-feed-release.v1';
export const REVIEW_SCHEMA='stellar-forge.research-feed-review.v1';
export const MAX_FEED_FILE_BYTES=268435456;
export const reviewContext=(contractSha,sourceSha)=>digest(contractSha+':'+sourceSha);
const validRevision=n=>Number.isSafeInteger(n)&&n>=0;
export async function exactFile(path,bytes){
  if(await exists(path)){const retained=await readBytes(path,MAX_FEED_FILE_BYTES);check(retained.equals(bytes),'FEED_FILE_CONFLICT','An existing delivery file has different bytes.',409);return;}
  try{await writeBytes(path,bytes,{exclusive:true});}catch(e){if(e.code!=='EEXIST')throw e;const retained=await readBytes(path,MAX_FEED_FILE_BYTES);check(retained.equals(bytes),'FEED_FILE_CONFLICT',undefined,409);}
}
export function safeMember(name){check(typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_./-]{0,300}$/.test(name)&&!name.split('/').some(p=>!p||p==='.'||p==='..'),'FEED_MEMBER_INVALID');return name;}
export async function openFeedWorkspace(research){
  check(research&&typeof research.transaction==='function','FEED_RESEARCH_WORKSPACE_REQUIRED');
  const root=await privateDirectory(join(research.root,'feeds'));
  for(const name of ['contracts','reviews','releases'])await privateDirectory(join(root,name));
  async function contract(id,revision){
    safeId(id);check(revision===undefined||validRevision(revision)&&revision>0,'FEED_REVISION_INVALID');
    const value=await readJson(join(root,'contracts',id,revision===undefined?'current.json':'revisions/'+revision+'.json'),1048576);
    check(value.schema==='stellar-forge.research-feed-contract-revision.v1'&&value.contract.id===id&&value.sha256===contractHash(value.contract)&&validRevision(value.revision)&&value.revision>0,'FEED_CONTRACT_CHANGED');
    return value;
  }
  async function saveContract(input){
    const normalized=normalizeContract(input.contract??input),expected=input.expectedRevision??0;check(validRevision(expected),'FEED_REVISION_INVALID');
    return research.transaction(async()=>{
      let prior;try{prior=await contract(normalized.id);}catch(e){if(e.code!=='ENOENT')throw e;}
      check(expected===(prior?.revision??0),'FEED_CONTRACT_REVISION_CHANGED','Reload the current contract before saving.',409);
      const sha256=contractHash(normalized);if(prior?.sha256===sha256)return prior;
      const directory=await privateDirectory(join(root,'contracts',normalized.id));await privateDirectory(join(directory,'revisions'));
      const version=join(directory,'revisions',String(expected+1)+'.json');
      let next={schema:'stellar-forge.research-feed-contract-revision.v1',contract:normalized,revision:expected+1,sha256,createdAt:prior?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()};
      if(await exists(version)){const old=await readJson(version,1048576);check(old.sha256===sha256,'FEED_CONTRACT_REVISION_CONFLICT',undefined,409);next=old;}
      else await writeJson(version,next,{exclusive:true});
      await writeJson(join(directory,'current.json'),next);return next;
    });
  }
  async function contracts(){const out=[];for(const item of await readdir(join(root,'contracts'),{withFileTypes:true}))if(item.isDirectory())try{out.push(await contract(item.name));}catch(e){if(e.code!=='ENOENT')throw e;}return out.sort((a,b)=>a.contract.label.localeCompare(b.contract.label));}
  async function reviews(contractSha,sourceSha){
    const context=reviewContext(contractSha,sourceSha),path=join(root,'reviews',context,'current.json');
    if(!await exists(path))return {schema:REVIEW_SCHEMA,context,contractSha256:contractSha,sourceFingerprint:sourceSha,revision:0,items:{}};
    const value=await readJson(path,16777216);
    check(value.schema===REVIEW_SCHEMA&&value.context===context&&value.contractSha256===contractSha&&value.sourceFingerprint===sourceSha&&validRevision(value.revision)&&value.items&&typeof value.items==='object'&&!Array.isArray(value.items),'FEED_REVIEW_CHANGED');return value;
  }
  async function preview({contractId,editionId,contractRevision}){
    const c=await contract(contractId,contractRevision),e=await research.edition(editionId),r=await reviews(c.sha256,sourceFingerprint(e));
    return {...projectEdition(e,c.contract,r),contractRevision:c.revision,contractSha256:c.sha256,reviewContext:r.context};
  }
  async function resolveException({contractId,contractRevision,editionId,sourceFingerprint:expectedSource,expectedRevision,exceptionId,action,note,value}){
    check(validRevision(expectedRevision)&&typeof exceptionId==='string'&&/^[a-f0-9]{32}$/.test(exceptionId),'FEED_REVIEW_INPUT_INVALID');
    check(typeof note==='string'&&note.trim().length>0&&note.length<=10000,'FEED_REVIEW_NOTE_REQUIRED','Explain the field decision for the receiving operator.');
    return research.transaction(async()=>{
      const c=await contract(contractId,contractRevision),e=await research.edition(editionId),source=sourceFingerprint(e);
      check(source===expectedSource,'FEED_SOURCE_CHANGED','The edition or its research review changed. Reopen the feed.',409);
      const prior=await reviews(c.sha256,source);check(prior.revision===expectedRevision,'FEED_REVIEW_REVISION_CHANGED','A newer review exists. Reload before saving.',409);
      const p=projectEdition(e,c.contract,prior),ex=p.exceptions.find(x=>x.id===exceptionId);check(ex,'FEED_EXCEPTION_NOT_FOUND',undefined,404);
      const field=c.contract.fields.find(f=>f.target===ex.field);let decision;
      if(action==='clear')decision=null;
      else if(ex.code==='DUPLICATE_CONFLICT'){check(action==='keep-first','FEED_DUPLICATE_DECISION_INVALID','Retain the first occurrence with a documented review decision.');decision={action,note:note.trim()};}
      else if(ex.code==='MISSING_WORK_ID'){check(action==='exclude','FEED_IDENTITY_DECISION_INVALID','A source record without work identity can be explicitly excluded.');decision={action,note:note.trim()};}
      else{
        check(['replace','omit','exclude'].includes(action),'FEED_DECISION_INVALID');
        if(action==='replace'){check(field&&field.target!==c.contract.identityField,'FEED_IDENTITY_IMMUTABLE');value=jsonValue(value);const error=valueError(value,field);check(!error,'FEED_REPLACEMENT_INVALID','The replacement must satisfy '+field.type+' and the contract null rule.');}
        if(action==='omit')check(field&&!field.required,'FEED_REQUIRED_FIELD_CANNOT_BE_OMITTED');
        decision={action,note:note.trim(),...(action==='replace'?{value}:{} )};
      }
      if(decision)decision.updatedAt=new Date().toISOString();
      const items={...prior.items};if(decision)items[exceptionId]=decision;else delete items[exceptionId];
      const next={...prior,revision:prior.revision+1,items},directory=await privateDirectory(join(root,'reviews',prior.context));await privateDirectory(join(directory,'revisions'));
      // The revision file is the exact recovery input if a process stops before updating current.
      const version=join(directory,'revisions',String(next.revision)+'.json');
      if(await exists(version)){
        const retained=await readJson(version,16777216),a=structuredClone(retained.items),b=structuredClone(items);
        for(const item of Object.values(a))delete item.updatedAt;for(const item of Object.values(b))delete item.updatedAt;
        check(canonical(a)===canonical(b),'FEED_REVIEW_REVISION_CONFLICT',undefined,409);await writeJson(join(directory,'current.json'),retained);return retained;
      }
      await writeJson(version,next,{exclusive:true});await writeJson(join(directory,'current.json'),next);return next;
    });
  }
  async function compare({contractId,contractRevision,beforeId,editionId}){
    const c=await contract(contractId,contractRevision);
    const before=await preview({contractId,contractRevision:c.revision,editionId:beforeId}),after=await preview({contractId,contractRevision:c.revision,editionId});
    return compareProjections(before,after);
  }
  async function release(id){
    safeId(id);const directory=join(root,'releases',id),manifest=await readJson(join(directory,'manifest.json'),16777216);
    check(manifest.schema===RELEASE_SCHEMA&&manifest.id===id&&manifest.files&&typeof manifest.files==='object','FEED_RELEASE_CHANGED');return {directory,manifest};
  }
  async function releases({contractId,editionId}={}){
    const out=[];for(const item of await readdir(join(root,'releases'),{withFileTypes:true}))if(item.isDirectory())try{const {manifest}=await release(item.name);if((!contractId||manifest.contractId===contractId)&&(!editionId||manifest.editionId===editionId))out.push(manifest);}catch(e){if(e.code!=='ENOENT')throw e;}
    return out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async function freeze({contractId,contractRevision,editionId,beforeId,sourceFingerprint:expectedSource,expectedReviewRevision}){
    return research.transaction(async()=>{
      const c=await contract(contractId,contractRevision),p=await preview({contractId,contractRevision:c.revision,editionId});
      check(p.sourceFingerprint===expectedSource&&p.reviewRevision===expectedReviewRevision,'FEED_RELEASE_INPUT_CHANGED','Reopen the feed preview before freezing a delivery.',409);
      check(p.summary.ready,'FEED_REVIEW_REQUIRED','Resolve the open exceptions and select the contract coverage rule before freezing.');
      const comparison=beforeId?await compare({contractId,contractRevision:c.revision,beforeId,editionId}):null;
      const identity={contractSha256:c.sha256,editionId,sourceFingerprint:p.sourceFingerprint,reviewRevision:p.reviewRevision,before:comparison?{id:beforeId,source:comparison.before.sourceFingerprint,reviewRevision:(await preview({contractId,contractRevision:c.revision,editionId:beforeId})).reviewRevision}:null};
      const id='feed-'+digest(canonical(identity)).slice(0,32),directory=await privateDirectory(join(root,'releases',id));
      if(await exists(join(directory,'manifest.json'))){const found=await release(id);await verifyRelease(found);return found.manifest;}
      const review=await reviews(c.sha256,p.sourceFingerprint),files={};
      async function put(name,bytes){safeMember(name);await privateDirectory(resolve(directory,join(name,'..')));await exactFile(join(directory,name),bytes);files[name]={bytes:bytes.length,sha256:digest(bytes)};}
      const sourceEditions=[...new Set([editionId,...(beforeId?[beforeId]:[])])];
      for(const sourceId of sourceEditions)for await(const [name,bytes] of research.exportEntries(sourceId,{includePages:true,includeNative:true}))await put('source/'+sourceId+'/'+name,bytes);
      await put('contract.json',jsonBytes(c));await put('review.json',jsonBytes(review));
      await put('feed.jsonl',Buffer.from(feedJSONL(p)));await put('feed.csv',Buffer.from(feedCSV(p)));
      await put('summary.json',jsonBytes({...p.summary,edition:p.edition,sourceFingerprint:p.sourceFingerprint,contractSha256:c.sha256,reviewRevision:p.reviewRevision}));
      await put('field-report.csv',Buffer.from(csv(p.fieldStats,['field','present','absent','null','errors','resolved'])));
      await put('exceptions.json',jsonBytes({items:p.exceptions}));await put('omissions.json',jsonBytes({items:p.omitted}));await put('doi-collisions.json',jsonBytes({items:p.doiCollisions}));
      if(comparison){await put('comparison.json',jsonBytes(comparison));const b=await preview({contractId,contractRevision:c.revision,editionId:beforeId});await put('before-review.json',jsonBytes(await reviews(c.sha256,b.sourceFingerprint)));}
      await put('report.html',Buffer.from(renderFeedReport(p,comparison)));await put('RECEIVING.md',Buffer.from(RECEIVING_GUIDE));
      const manifest={schema:RELEASE_SCHEMA,id,...identity,contractId,contractRevision:c.revision,sourceEditions,createdAt:new Date().toISOString(),summary:p.summary,files};
      await exactFile(join(directory,'manifest.json'),jsonBytes(manifest));return manifest;
    });
  }
  async function verifyRelease({directory,manifest}){for(const [name,meta] of Object.entries(manifest.files)){safeMember(name);const bytes=await readBytes(join(directory,name),MAX_FEED_FILE_BYTES);check(bytes.length===meta.bytes&&digest(bytes)===meta.sha256,'FEED_RELEASE_BYTES_CHANGED');}return manifest;}
  async function* releaseEntries(id){const selected=await release(id);await verifyRelease(selected);for(const name of Object.keys(selected.manifest.files))yield [name,await readBytes(join(selected.directory,name),MAX_FEED_FILE_BYTES)];yield ['manifest.json',jsonBytes(selected.manifest)];}
  async function releaseFile(id,name){safeMember(name);const r=await release(id);if(name==='manifest.json')return jsonBytes(r.manifest);const meta=r.manifest.files[name];check(meta,'FEED_RELEASE_FILE_NOT_FOUND',undefined,404);const bytes=await readBytes(join(r.directory,name),MAX_FEED_FILE_BYTES);check(bytes.length===meta.bytes&&digest(bytes)===meta.sha256,'FEED_RELEASE_BYTES_CHANGED');return bytes;}
  async function exportRelease(id,destination){const out=resolve(destination);check(!out.startsWith(root+'/')&&out!==root,'FEED_EXPORT_DESTINATION_INVALID');await privateDirectory(out);for await(const [name,bytes] of releaseEntries(id)){await privateDirectory(resolve(out,join(name,'..')));await exactFile(join(out,name),bytes);}return {directory:out,manifest:(await release(id)).manifest};}
  return {root,research,contract,saveContract,contracts,defaultContract,reviews,preview,resolveException,compare,freeze,release,releases,releaseEntries,releaseFile,exportRelease};
}
