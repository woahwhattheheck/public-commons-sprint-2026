// MIT. Compose the original research receiver with the source-bound feed extension.
import {lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {readBytes,privateDirectory,writeJson,jsonBytes,digest,exists} from '../../node/store.mjs';
import {openResearchWorkspace,canonical} from '../workspace.mjs';
import {inspectResearchExports,receiveResearchExports} from '../receive-export.mjs';
import {normalizeContract,contractHash,check,valueError,jsonValue} from './contract.mjs';
import {projectEdition,sourceFingerprint,feedCSV,feedJSONL} from './projection.mjs';
import {openFeedWorkspace,RELEASE_SCHEMA,REVIEW_SCHEMA,reviewContext,safeMember,exactFile,MAX_FEED_FILE_BYTES} from './workspace.mjs';

const MAX_TOTAL_BYTES=536870912;
async function regularBytes(root,name,limit=MAX_FEED_FILE_BYTES){
  safeMember(name);let at=root;const parts=name.split('/');
  for(let i=0;i<parts.length;i++){at=join(at,parts[i]);const stat=await lstat(at);check(!stat.isSymbolicLink()&&(i===parts.length-1?stat.isFile():stat.isDirectory()),'FEED_RECEIVING_FILE_TYPE');}
  return readBytes(at,limit);
}
async function loadDelivery(sourceDirectory,{maxBytes=MAX_TOTAL_BYTES}={}){
  check(typeof sourceDirectory==='string'&&Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=MAX_TOTAL_BYTES,'FEED_RECEIVING_OPTIONS_INVALID');
  const root=resolve(sourceDirectory);check(await realpath(root)===root,'FEED_RECEIVING_SOURCE_SYMLINK');
  const manifestBytes=await regularBytes(root,'manifest.json',16777216),manifest=JSON.parse(manifestBytes);
  check(manifest.schema===RELEASE_SCHEMA&&/^feed-[a-f0-9]{32}$/.test(manifest.id)&&Array.isArray(manifest.sourceEditions)&&manifest.sourceEditions.length>0&&manifest.sourceEditions.length<=2&&manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files),'FEED_RECEIVING_MANIFEST_INVALID');
  check(manifest.sourceEditions.includes(manifest.editionId)&&new Set(manifest.sourceEditions).size===manifest.sourceEditions.length,'FEED_RECEIVING_EDITIONS_INVALID');
  let total=manifestBytes.length;
  const entries=Object.entries(manifest.files);check(entries.length>0&&entries.length<=10000,'FEED_RECEIVING_MEMBER_LIMIT');
  for(const [name,meta]of entries){
    safeMember(name);check(name!=='manifest.json'&&Number.isSafeInteger(meta.bytes)&&meta.bytes>=0&&meta.bytes<=MAX_FEED_FILE_BYTES&&/^[a-f0-9]{64}$/.test(meta.sha256),'FEED_RECEIVING_MEMBER_INVALID');
    total+=meta.bytes;check(total<=maxBytes,'FEED_RECEIVING_SIZE_LIMIT');
    const bytes=await regularBytes(root,name);check(bytes.length===meta.bytes&&digest(bytes)===meta.sha256,'FEED_RECEIVING_BYTES_CHANGED');
  }
  for(const name of ['contract.json','review.json','feed.jsonl','feed.csv','summary.json','exceptions.json','omissions.json','field-report.csv','report.html','RECEIVING.md'])check(Object.hasOwn(manifest.files,name),'FEED_RECEIVING_INCOMPLETE');
  if(manifest.before)check(manifest.sourceEditions.includes(manifest.before.id)&&Object.hasOwn(manifest.files,'before-review.json')&&Object.hasOwn(manifest.files,'comparison.json'),'FEED_RECEIVING_COMPARISON_INCOMPLETE');
  else check(manifest.sourceEditions.length===1,'FEED_RECEIVING_COMPARISON_REQUIRED');
  const read=async name=>{check(Object.hasOwn(manifest.files,name),'FEED_RECEIVING_REQUIRED_FILE');return JSON.parse(await regularBytes(root,name));};
  const c=await read('contract.json'),review=await read('review.json');normalizeContract(c.contract);
  check(c.schema==='stellar-forge.research-feed-contract-revision.v1'&&c.sha256===contractHash(c.contract)&&c.sha256===manifest.contractSha256&&c.contract.id===manifest.contractId&&c.revision===manifest.contractRevision&&Number.isSafeInteger(c.revision)&&c.revision>0,'FEED_RECEIVING_CONTRACT_CHANGED');
  const identity={contractSha256:manifest.contractSha256,editionId:manifest.editionId,sourceFingerprint:manifest.sourceFingerprint,reviewRevision:manifest.reviewRevision,before:manifest.before};
  check(manifest.id==='feed-'+digest(canonical(identity)).slice(0,32),'FEED_RECEIVING_IDENTITY_CHANGED');
  const sourceDirectories=manifest.sourceEditions.map(id=>{check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id),'FEED_RECEIVING_EDITION_ID');check(Object.hasOwn(manifest.files,'source/'+id+'/manifest.json'),'FEED_RECEIVING_SOURCE_REQUIRED');return join(root,'source',id);});
  const research=await inspectResearchExports(sourceDirectories,{maxBytes});
  return {root,manifest,manifestBytes,contract:c,review,total,sourceDirectories,research,read};
}
function validateReview(e,c,r,expectedRevision){
  check(r.schema===REVIEW_SCHEMA&&r.contractSha256===c.sha256&&r.sourceFingerprint===sourceFingerprint(e)&&r.context===reviewContext(c.sha256,r.sourceFingerprint)&&Number.isSafeInteger(r.revision)&&r.revision>=0&&r.revision===expectedRevision&&r.items&&typeof r.items==='object'&&!Array.isArray(r.items),'FEED_RECEIVING_REVIEW_CHANGED');
  const initial=projectEdition(e,c.contract),byId=new Map(initial.exceptions.map(ex=>[ex.id,ex]));
  for(const [id,d]of Object.entries(r.items)){
    const ex=byId.get(id),field=c.contract.fields.find(f=>f.target===ex?.field);
    check(ex&&d&&typeof d.note==='string'&&d.note.trim().length>0&&d.note.length<=10000&&typeof d.updatedAt==='string'&&!Number.isNaN(Date.parse(d.updatedAt)),'FEED_RECEIVING_RESOLUTION_INVALID');
    if(ex.code==='DUPLICATE_CONFLICT')check(d.action==='keep-first','FEED_RECEIVING_DUPLICATE_DECISION');
    else if(ex.code==='MISSING_WORK_ID')check(d.action==='exclude','FEED_RECEIVING_IDENTITY_DECISION');
    else{
      check(['replace','omit','exclude'].includes(d.action),'FEED_RECEIVING_DECISION_INVALID');
      if(d.action==='omit')check(field&&!field.required,'FEED_RECEIVING_REQUIRED_FIELD');
      if(d.action==='replace')check(field&&field.target!==c.contract.identityField&&!valueError(jsonValue(d.value),field),'FEED_RECEIVING_REPLACEMENT_INVALID');
    }
  }
  return projectEdition(e,c.contract,r);
}
export async function inspectFeedRelease(sourceDirectory,options={}){
  const x=await loadDelivery(sourceDirectory,options);
  return {schema:'stellar-forge.research-feed-inspection.v1',releaseId:x.manifest.id,contractId:x.contract.contract.id,contractRevision:x.contract.revision,sourceEditions:x.manifest.sourceEditions,summary:x.manifest.summary,files:Object.keys(x.manifest.files).length+1,bytes:x.total,research:x.research};
}
export async function receiveFeedRelease({sourceDirectory,destination,maxBytes=MAX_TOTAL_BYTES,python='python3'}){
  const x=await loadDelivery(sourceDirectory,{maxBytes}),target=resolve(destination),receiptName='received-feed-'+x.manifest.id+'.json';
  check(target!==x.root&&!target.startsWith(x.root+'/')&&!x.root.startsWith(target+'/'),'FEED_RECEIVING_SOURCE_DESTINATION_OVERLAP');
  const native=await receiveResearchExports({sourceDirectories:x.sourceDirectories,destination:target,maxBytes,python});
  const research=await openResearchWorkspace(target);
  try{
    const feeds=await openFeedWorkspace(research),receiptPath=join(feeds.root,receiptName);
    const existing=await exists(receiptPath);
    if(existing){
      const old=JSON.parse(await readBytes(receiptPath,65536));check(old.manifestSha256===digest(x.manifestBytes),'FEED_RECEIVING_RECEIPT_CHANGED');
      const release=await feeds.release(x.manifest.id);for await(const _entry of feeds.releaseEntries(release.manifest.id)){}
      return {releaseId:x.manifest.id,destination:target,reused:true,research:native,receipt:old};
    }
    // On first adoption the original receiving snapshot must still match the delivered edition.
    const edition=await research.edition(x.manifest.editionId),projection=validateReview(edition,x.contract,x.review,x.manifest.reviewRevision);
    check(projection.sourceFingerprint===x.manifest.sourceFingerprint&&projection.summary.ready,'FEED_RECEIVING_SOURCE_CONTEXT_CHANGED');
    check(Buffer.from(feedJSONL(projection)).equals(await regularBytes(x.root,'feed.jsonl'))&&Buffer.from(feedCSV(projection)).equals(await regularBytes(x.root,'feed.csv')),'FEED_RECEIVING_PROJECTION_CHANGED');
    const reviewStates=[x.review];
    if(x.manifest.before){
      const before=await research.edition(x.manifest.before.id),r=await x.read('before-review.json');validateReview(before,x.contract,r,x.manifest.before.reviewRevision);check(r.sourceFingerprint===x.manifest.before.source,'FEED_RECEIVING_COMPARISON_CONTEXT_CHANGED');reviewStates.push(r);
    }
    await research.transaction(async()=>{
      const directory=await privateDirectory(join(feeds.root,'contracts',x.contract.contract.id));await privateDirectory(join(directory,'revisions'));
      const version=join(directory,'revisions',String(x.contract.revision)+'.json');await exactFile(version,jsonBytes(x.contract));
      const current=join(directory,'current.json');
      if(!await exists(current))await writeJson(current,x.contract);
      else{const c=JSON.parse(await readBytes(current,1048576));check(c.contract.id===x.contract.contract.id&&c.revision>=x.contract.revision,'FEED_RECEIVING_CONTRACT_CONFLICT');}
      for(const r of reviewStates){
        const dir=await privateDirectory(join(feeds.root,'reviews',r.context));await privateDirectory(join(dir,'revisions'));
        if(r.revision>0)await exactFile(join(dir,'revisions',String(r.revision)+'.json'),jsonBytes(r));
        const current=join(dir,'current.json');if(!await exists(current))await writeJson(current,r);
        else{const saved=JSON.parse(await readBytes(current,16777216));check(saved.context===r.context&&saved.revision>=r.revision,'FEED_RECEIVING_REVIEW_CONFLICT');}
      }
      const releaseDir=await privateDirectory(join(feeds.root,'releases',x.manifest.id));
      for(const name of Object.keys(x.manifest.files)){await privateDirectory(dirname(join(releaseDir,name)));await exactFile(join(releaseDir,name),await regularBytes(x.root,name));}
      await exactFile(join(releaseDir,'manifest.json'),x.manifestBytes);
      const receipt={schema:'stellar-forge.research-feed-receiving.v1',releaseId:x.manifest.id,manifestSha256:digest(x.manifestBytes),contractSha256:x.contract.sha256,sourceFingerprint:x.manifest.sourceFingerprint,receivedAt:new Date().toISOString()};
      await exactFile(receiptPath,jsonBytes(receipt));
    });
    return {releaseId:x.manifest.id,destination:target,reused:false,research:native,summary:projection.summary,receipt:JSON.parse(await readBytes(receiptPath,65536))};
  }finally{await research.close();}
}
