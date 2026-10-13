'use strict';
/** Original capture work stays with its selected lead revisions and customer case. */
const {sha256Utf8,utf8ByteLength}=require('../../host/connected_sha256.cjs');
const {planJobs}=require('./capture/capture_core.cjs');
const VERSION='dealscout.lead-captures.v1';
const BUNDLE='dealscout.lead-working-record.v2';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?v.map(canonical):plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>sha256Utf8(JSON.stringify(canonical(v))).sha256;
const need=(v,message,status=422)=>{if(!v)throw Object.assign(new Error(message),{status,code:'LEAD_CAPTURE'});};
function text(v,label,max=4000,required=false){
  need(typeof(v??'')==='string',label+' must be text.');const s=(v??'').trim();
  need(s.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)&&(!required||s),'Enter '+label+'.');utf8ByteLength(s);return s;
}
function id(v,label){const s=text(v,label,160,true);need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s),'Use a valid '+label+'.');return s;}
function instant(v,label){const s=text(v,label,40,true);need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s)),label+' needs its original date, time and timezone.');return new Date(s).toISOString();}
function find(rows,value,label){const r=rows.find(x=>x.id===value);need(r,'Choose an existing '+label+'.',404);return r;}
function sameId(rows,value,label){need(!rows.some(x=>x.id===value),'This '+label+' already has saved work. Use its original request to recover the result.',409);}
function sealed(document){return {...document,sha256:hash(document)};}
function verify(row,label){need(plain(row),'The '+label+' is incomplete.');const{sha256,...document}=row;need(sha256===hash(document),'The '+label+' differs from its saved original.');}
function empty(){return {version:VERSION,plans:[],results:[],reviews:[]};}
function captures(root){return root.captures??empty();}
function revision(row,n){return row?.revision===n?row:row?.history.find(x=>x.revision===n);}
const STATUSES=['in_flight','uncertain','waiting','account_required','failed','complete'];
function validateManifest(plan,manifest,files){
  need(plain(manifest)&&manifest.schema_version===1&&plain(manifest.jobs)&&Array.isArray(manifest.attempts),'Choose the complete original capture manifest.');
  need(Array.isArray(files),'Supply the original image references.');
  const jobs=new Map(plan.jobs.map(j=>[j.id,j])),seen=new Set();
  for(const [key,row]of Object.entries(manifest.jobs)){
    const job=jobs.get(key);need(job&&plain(row)&&row.id===key&&row.signature===job.signature&&row.url===job.url&&hash(row.options)===hash(job.options)&&row.account_id===job.account_id,
      'A capture differs from the selected job, source URL or rendering options.');
    need(STATUSES.includes(row.status),'The capture status is unsupported.');instant(row.started_at,'capture start');
    if(row.status==='complete'){
      instant(row.completed_at,'capture completion');
      need(row.http_status===200&&Number.isSafeInteger(row.byte_size)&&row.byte_size>0&&row.byte_size<=25*1024*1024&&/^[a-f0-9]{64}$/.test(row.sha256),'The completed image needs its original HTTP result, byte count and SHA-256.');
      need(typeof row.file==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:png|jpe?g|webp)$/.test(row.file),'Use the original image filename.');
      need(row.file.endsWith('.'+job.options.format),'The original image filename must match its planned image format.');
    }
  }
  for(const attempt of manifest.attempts){
    need(plain(attempt)&&jobs.has(attempt.id),'A capture attempt belongs to a different job.');instant(attempt.at,'request start');
  }
  for(const file of files){
    need(plain(file)&&Object.keys(file).every(k=>['job_id','filename','bytes','sha256','storage'].includes(k)),'Use the original image reference.');
    const row=manifest.jobs[file.job_id];
    need(row?.status==='complete'&&!seen.has(file.job_id)&&file.filename===row.file&&file.bytes===row.byte_size&&file.sha256===row.sha256&&file.storage==='workspace',
      'An image reference differs from its original complete capture.');
    seen.add(file.job_id);
  }
  need(Object.values(manifest.jobs).filter(r=>r.status==='complete').every(r=>seen.has(r.id)),'Retain each completed original image before receiving the manifest.');
}
function validateCaptureState(root){
  if(root.captures===undefined)return;
  const c=root.captures;need(plain(c)&&c.version===VERSION,'Open a compatible capture workspace.');
  for(const k of ['plans','results','reviews']){
    need(Array.isArray(c[k]),'The saved capture '+k+' are incomplete.');
    const ids=new Set();for(const row of c[k]){id(row?.id,'capture record ID');need(!ids.has(row.id),'The saved capture list repeats an ID.');ids.add(row.id);verify(row,'capture '+k.slice(0,-1));}
  }
  for(const plan of c.plans){
    const pack=find(root.packs,plan.pack_id,'customer brief');instant(plan.prepared_at,'capture preparation');
    text(plan.title,'capture title',300,true);need(Array.isArray(plan.jobs)&&plan.jobs.length>0&&plan.jobs.length<=200,'A capture plan needs 1–200 exact requests.');
    const planned=planJobs(plan.source_jobs);
    need(planned.length===plan.jobs.length,'The original capture job list is incomplete.');
    plan.jobs.forEach((job,i)=>{
      const {lead_id,lead_revision,lead_sha256,...original}=job;
      need(hash(original)===hash(planned[i]),'The saved capture options differ from the original job file.');
      const lead=find(root.leads,lead_id,'lead'),version=revision(lead,lead_revision);
      need(lead.pack_id===pack.id&&version?.sha256===lead_sha256,'The capture has lost its original selected lead revision.');
    });
    if(plan.edition_id){
      const edition=find(root.editions,plan.edition_id,'customer edition');
      need(edition.pack_id===pack.id&&plan.jobs.every(j=>edition.leads.some(l=>l.id===j.lead_id&&l.revision===j.lead_revision&&l.sha256===j.lead_sha256)),
        'The capture plan differs from its selected customer edition.');
    }
  }
  for(const result of c.results){
    const plan=find(c.plans,result.plan_id,'capture plan');
    need(result.pack_id===plan.pack_id&&result.plan_sha256===plan.sha256,'The returned captures have lost their original plan.');
    instant(result.received_at,'capture receiving');validateManifest(plan,result.manifest,result.files);
  }
  for(const review of c.reviews){
    const result=find(c.results,review.result_id,'capture result');
    need(review.pack_id===result.pack_id&&review.result_sha256===result.sha256,'The image review has lost its original result.');
    instant(review.reviewed_at,'editorial review');text(review.reviewer,'reviewer',300,true);
    need(Array.isArray(review.decisions)&&review.decisions.length>0&&new Set(review.decisions.map(d=>d.job_id)).size===review.decisions.length,'Review distinct completed images.');
    for(const d of review.decisions){need(result.files.some(f=>f.job_id===d.job_id)&&['selected','revise','exclude'].includes(d.decision),'Choose a completed image and editorial decision.');text(d.note,'review note',4000,d.decision!=='selected');}
  }
}
function applyCapture(root,kind,input,at){
  root.captures??=empty();const c=root.captures;at=instant(at,'operation time');
  if(kind==='capture-plan'){
    const pack=find(root.packs,id(input.pack_id,'pack ID'),'customer brief'),planId=id(input.id,'capture plan ID');sameId(c.plans,planId,'plan');
    need(plain(input.jobs)&&Array.isArray(input.jobs.jobs)&&input.jobs.jobs.length>0&&input.jobs.jobs.length<=200,'Choose 1–200 original capture jobs.');
    need(Array.isArray(input.associations)&&input.associations.length===input.jobs.jobs.length&&new Set(input.associations.map(x=>x.job_id)).size===input.associations.length,'Associate each capture job with one selected lead.');
    const edition=input.edition_id?find(root.editions,id(input.edition_id,'edition ID'),'customer edition'):null;
    need(!edition||edition.pack_id===pack.id,'Choose an edition from this customer pack.');
    const jobs=planJobs(input.jobs).map(job=>{
      const association=input.associations.find(x=>x.job_id===job.id);need(association,'Associate every job with its lead.');
      const lead=edition?find(edition.leads,association.lead_id,'selected edition lead'):find(root.leads,association.lead_id,'lead');
      need(lead.pack_id===pack.id,'Choose a lead from this customer pack.');
      return {...job,lead_id:lead.id,lead_revision:lead.revision,lead_sha256:lead.sha256};
    });
    const plan=sealed({id:planId,pack_id:pack.id,title:text(input.title,'capture title',300,true),edition_id:edition?.id??'',
      prepared_at:at,source_jobs:clone(input.jobs),jobs});
    c.plans.push(plan);return {pack_id:pack.id,capture_plan_id:plan.id,capture_plan_sha256:plan.sha256,jobs:jobs.length};
  }
  if(kind==='capture-receive'){
    const plan=find(c.plans,id(input.plan_id,'capture plan ID'),'capture plan'),resultId=id(input.id,'capture result ID');sameId(c.results,resultId,'result');
    need(input.expected_plan_sha256===plan.sha256,'Reopen the selected original capture plan.',409);
    validateManifest(plan,input.manifest,input.files);
    for(const row of Object.values(input.manifest.jobs))need(Date.parse(row.completed_at||row.started_at)<=Date.parse(at),'Receive an existing capture result.');
    const result=sealed({id:resultId,pack_id:plan.pack_id,plan_id:plan.id,plan_sha256:plan.sha256,received_at:at,
      manifest:clone(input.manifest),files:clone(input.files)});
    const old=c.results.find(x=>x.plan_id===plan.id&&hash(x.manifest)===hash(result.manifest)&&hash(x.files)===hash(result.files));
    if(old)return {pack_id:plan.pack_id,capture_plan_id:plan.id,capture_result_id:old.id,unchanged:true};
    c.results.push(result);return {pack_id:plan.pack_id,capture_plan_id:plan.id,capture_result_id:result.id,
      completed:result.files.length,recorded:Object.keys(result.manifest.jobs).length};
  }
  if(kind==='capture-review'){
    const result=find(c.results,id(input.result_id,'capture result ID'),'capture result'),reviewId=id(input.id,'capture review ID');sameId(c.reviews,reviewId,'review');
    need(input.expected_result_sha256===result.sha256,'Reopen the original capture result before reviewing it.',409);
    need(Array.isArray(input.decisions)&&input.decisions.length,'Review at least one completed image.');
    const decisions=input.decisions.map(d=>({job_id:id(d.job_id,'job ID'),decision:text(d.decision,'decision',30,true),note:text(d.note,'review note',4000)}));
    const review=sealed({id:reviewId,pack_id:result.pack_id,result_id:result.id,result_sha256:result.sha256,reviewed_at:at,
      reviewer:text(input.reviewer,'reviewer',300,true),decisions});
    c.reviews.push(review);return {pack_id:result.pack_id,capture_result_id:result.id,capture_review_id:review.id,reviewed:decisions.length};
  }
  need(false,'Choose a capture preparation, receiving or review operation.');
}
function captureForPack(root,packId){
  const c=captures(root);return {version:VERSION,...Object.fromEntries(['plans','results','reviews'].map(k=>[k,clone(c[k].filter(r=>r.pack_id===packId))]))};
}
function mergeCaptures(root,incoming,packId,report){
  if(!incoming)return;
  root.captures??=empty();
  for(const key of ['plans','results','reviews'])for(const row of incoming[key]){
    const entity='capture_'+key,current=root.captures[key].find(x=>x.id===row.id);
    report.added[entity]??=0;
    if(row.pack_id!==packId){report.conflicts.push({entity,id:row.id,reason:'The capture belongs to a different customer case.'});continue;}
    if(!current){root.captures[key].push(clone(row));report.added[entity]++;report.records.push({entity,id:row.id,name:row.title||row.id,action:'add'});}
    else if(hash(current)!==hash(row))report.conflicts.push({entity,id:row.id,reason:'The original capture record has different content.'});
    else{report.unchanged++;report.records.push({entity,id:row.id,name:row.title||row.id,action:'unchanged'});}
  }
}
module.exports={VERSION,BUNDLE,hash,validateCaptureState,applyCapture,captureForPack,mergeCaptures};
