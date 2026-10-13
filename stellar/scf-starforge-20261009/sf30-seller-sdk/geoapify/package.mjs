// MIT. One complete Geoapify package validator for restore and customer commissioning.
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join,dirname,basename,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {hash,canonical,json,object,own,fail,parseJSON,text,readCsvRecords,readJSONSourceRecords,
  createIntake,inspectIntake,inspectRequest,inspectReply,reviewIntake} from './source.mjs';
import {inheritedMatches,validateComparison} from './source-history.mjs';
import {inspectGeoapifyCustomerReviewHistory} from './customer-review-store.mjs';
const SCHEMA='stellar-forge.geoapify-workspace.v1',PACKAGE='stellar-forge.geoapify-package.v1';
const MAX=256*1024*1024,HASH=/^[a-f0-9]{64}$/,responseTypes=['PENDING','COMPLETE','PARTIAL'];
function safeFile(v){
  if(typeof v!=='string'||!v||v.length>500||isAbsolute(v)||v.includes('\\')||/[\x00-\x1f\x7f]/.test(v)||
      v.split('/').some(p=>!p||p==='.'||p==='..'))throw fail('FILE','Choose an original retained file.');
  return v;
}

function shape(s){
  if(!object(s)||s.schema!==SCHEMA||!HASH.test(s.id??'')||!Number.isSafeInteger(s.revision)||s.revision<0||
      !['jobs','decisions','editions','exports'].every(k=>Array.isArray(s[k]))||!object(s.queries))
    throw fail('WORKSPACE','Read the complete original Geoapify workspace.');
}

/**
 * Validates original bytes, all source histories and actual native dataset snapshots.
 * A private temporary directory exists only for the unchanged native dataset reader.
 * No customer archive member is changed; callers receive the validated original byte map.
 */
export async function inspectGeoapifyPackage(raw,{expectedArchiveSha256}={}){
  if(!Buffer.isBuffer(raw)||raw.length>MAX)throw fail('PACKAGE_LIMIT','Read the complete compressed workspace within256MiB.');
  const archive={bytes:raw.length,sha256:hash(raw)};
  if(expectedArchiveSha256!==undefined&&(!HASH.test(expectedArchiveSha256)||archive.sha256!==expectedArchiveSha256))
    throw fail('PACKAGE_CHANGED','The complete original workspace archive differs from the selected SHA-256.',409);
  const packet=parseJSON(gunzipSync(raw,{maxOutputLength:512*1024*1024}));
  if(packet.schema!==PACKAGE||!Array.isArray(packet.files)||packet.files.length>10000)throw fail('PACKAGE','Read the original full Geoapify package.');
    const saved=packet.state;shape(saved);const entries=new Map();let total=0;
    for(const item of packet.files){
      safeFile(item.file);if(!/^(source|requests|provider|editions|customer-reviews)\//.test(item.file)||entries.has(item.file)||typeof item.base64!=='string')throw fail('PACKAGE','Invalid or duplicate retained file path.');
      const b=Buffer.from(item.base64,'base64');total+=b.length;
      if(total>512*1024*1024||b.toString('base64')!==item.base64||b.length!==item.bytes||hash(b)!==item.sha256)throw fail('PACKAGE','A retained source differs from its hash or byte count.');
      entries.set(item.file,b);
    }
    const check=d=>{const b=entries.get(safeFile(d?.file));if(!b||b.length!==d.bytes||hash(b)!==d.sha256)throw fail('PACKAGE','A required original file is missing.');return b;};
    const sources=saved.sources??(saved.intake?[{intake:saved.intake,createdAt:saved.createdAt,activatedAt:saved.createdAt,baselineEditionId:null}]:[]);
    if(!Array.isArray(sources)||sources.length>10000||new Set(sources.map(e=>e.intake?.sha256)).size!==sources.length)
      throw fail('PACKAGE','Retained intake history must have distinct original identities.');
    const sourceMap=new Map();
    for(const entry of sources){
      const source=parseJSON(check(entry.intake)),original=check(entry.intake.original);inspectIntake(source);
      if(hash(original)!==source.source.sha256||original.length!==source.source.bytes)throw fail('PACKAGE','Original source bytes differ.');
      const records=source.source.format==='csv'?readCsvRecords(original).rows:source.source.format==='json'?readJSONSourceRecords(original):null;
      if(!records||canonical(createIntake({records,source:source.source,mapping:source.mapping}))!==canonical(source))
        throw fail('PACKAGE','The intake mapping differs from its complete original source bytes.');
      sourceMap.set(entry.intake.sha256,source);
    }
    const originalSha=sources[0]?.intake.sha256,savedBinding=record=>record.intakeSha256??originalSha;
    const source=saved.intake?sourceMap.get(saved.intake.sha256):null;
    if(saved.intake&&(!source||canonical(saved.intake)!==canonical(sources.find(e=>e.intake.sha256===saved.intake.sha256).intake)))
      throw fail('PACKAGE','The active source must be an exact retained intake.');
    if(!source&&(saved.jobs.length||saved.editions.length||saved.decisions.length||sources.length))
      throw fail('PACKAGE','A populated workspace needs its original source.');
    for(const d of saved.decisions){
      const intake=sourceMap.get(savedBinding(d));
      if(!object(d)||!own(intake?.queries??{},d.queryId)||!['accept','keep-source'].includes(d.action)||!['preserve-source','use-provider','fill-missing'].includes(d.coordinateChoice)||
        d.action==='accept'&&(!HASH.test(d.candidateId??'')||!HASH.test(d.responseSha256??'')))throw fail('PACKAGE','A retained decision has a different source or candidate binding.');
      text(d.reviewer,'Retained reviewer',200);text(d.note,'Retained decision reason');
    }
    for(const job of saved.jobs){
      const intake=sourceMap.get(savedBinding(job));if(!intake)throw fail('PACKAGE','The original job source is missing.');
      const req=parseJSON(check(job.request));inspectRequest(intake,req);
      if(canonical(req.body.inputs.map(i=>i.id))!==canonical(job.queryIds)||!Array.isArray(job.events))throw fail('PACKAGE','A retained job has changed source IDs.');
      for(const event of job.events){
        const b=check(event.response);
        if(responseTypes.includes(event.outcome))inspectReply({body:parseJSON(b),request:req,expectedJobId:job.jobId,status:event.status});
      }
    }
    for(const e of saved.editions){
      const intake=sourceMap.get(savedBinding(e));if(!intake)throw fail('PACKAGE','A frozen edition source is missing.');
      for(const key of ['csv','config','basis','review','geojson','report'])check(e[key]);
      if(e.comparisonReport)check(e.comparisonReport);
      const config=parseJSON(check(e.config)),basis=parseJSON(check(e.basis)),reviewed=parseJSON(check(e.review));
      if(basis.intake!==savedBinding(e)||canonical(reviewed.source)!==canonical(intake.source)||canonical(reviewed.mapping)!==canonical(intake.mapping))
        throw fail('PACKAGE','The frozen edition is bound to another original source.');
      if(config.file!=='dataset.csv'||basename(e.csv.file)!=='dataset.csv'||dirname(e.csv.file)!==dirname(e.config.file))
        throw fail('PACKAGE','An edition must bind its adjacent original CSV.');
    }
    for(const entry of sources){
      if(entry.baselineEditionId){
        const edition=saved.editions.find(e=>e.id===entry.baselineEditionId);
        if(!edition)throw fail('PACKAGE','The original comparison baseline edition is missing.');
        validateComparison(parseJSON(check(entry.comparison)),{before:sourceMap.get(savedBinding(edition)),
          after:sourceMap.get(entry.intake.sha256),beforeSha256:savedBinding(edition),afterSha256:entry.intake.sha256,edition});
      }else if(entry.comparison)throw fail('PACKAGE','A retained comparison needs its original frozen edition.');
    }
    if(saved.editors!==undefined&&(!object(saved.editors)||Object.keys(saved.editors).some(k=>!sourceMap.has(k))||
      Object.values(saved.editors).some(e=>!object(e)||json(e).length>262144)))throw fail('PACKAGE','Retained working forms must stay bound to original intake identities.');
    if(saved.activeEditionId&&!saved.editions.some(e=>e.id===saved.activeEditionId))throw fail('PACKAGE','The selected edition is missing.');

  // Validate the same complete review projection used by the original workspace.
  for(const entry of sources){
    const sha=entry.intake.sha256,intake=sourceMap.get(sha);
    const baseline=entry.baselineEditionId?saved.editions.find(e=>e.id===entry.baselineEditionId):null;
    const matches=inheritedMatches({intake,baselineReview:baseline?parseJSON(check(baseline.review)):null});
    for(const job of saved.jobs.filter(j=>savedBinding(j)===sha)){
      const request=parseJSON(check(job.request));
      for(const event of job.events){
        if(!responseTypes.includes(event.outcome))continue;
        const parsed=inspectReply({body:parseJSON(check(event.response)),request,expectedJobId:job.jobId,status:event.status});
        if(parsed.status==='PENDING')continue;
        for(const [id,match]of Object.entries(parsed.matches))matches[id]={...match,responseSha256:event.response.sha256,jobId:job.id};
      }
    }
    reviewIntake({intake,matches,decisions:saved.decisions.filter(d=>savedBinding(d)===sha)});
  }
  await inspectGeoapifyCustomerReviewHistory({saved,check,sourceIntakes:sourceMap,boundSource:savedBinding});
  let scratch;
  try{
    if(saved.editions.length){
      scratch=await mkdtemp(join(await realpath(tmpdir()),'starforge-geoapify-package-'));
      // mkdtemp creates the private leaf; write exclusively into that new owned directory.
      const written=new Set();
      for(const edition of saved.editions){
        for(const descriptor of [edition.csv,edition.config]){
          if(written.has(descriptor.file))continue;
          const path=join(scratch,safeFile(descriptor.file));await mkdir(dirname(path),{recursive:true,mode:0o700});
          await writeFile(path,check(descriptor),{flag:'wx',mode:0o600});written.add(descriptor.file);
        }
        const model=await loadDatasetConfig(join(scratch,edition.config.file)),description=model.describe();
        if(description.snapshot!==edition.snapshot||description.rowCount!==edition.rowCount)
          throw fail('PACKAGE','Restored native dataset identity differs.');
      }
    }
  }finally{if(scratch)await rm(scratch,{recursive:true,force:true});}
  return {state:saved,files:entries,sources,sourceIntakes:sourceMap,archive:{...archive,files:entries.size},exportedAt:packet.exportedAt};
}
