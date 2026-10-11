// MIT. Durable current/hourly acquisition; each actual provider request is retained before dispatch.
import {randomUUID} from 'node:crypto';
import {SOURCE,SCHEMA,DATA_SCHEMA,FIELD_MAP,settings,identifier,integer,epoch,digest,stable,plain,fail,credential,
  requestURL,continuation,normalizePage,retryPolicy,redact,units,text} from './contract.mjs';

const MAX_RESPONSE=1024*1024;
const now=()=>new Date().toISOString();
const id=prefix=>prefix+'-'+randomUUID();
const projectOf=(s,key)=>s.projects[identifier(key)]??fail('PROJECT_MISSING','Project was not found',404);
const jobOf=(s,key)=>s.jobs[identifier(key)]??fail('JOB_MISSING','Acquisition was not found',404);
const cursorKey=url=>{const u=new URL(url);u.searchParams.sort();return u.href;};
const history=(s,action,detail)=>{s.history.push({at:now(),action,...detail});if(s.history.length>20000)s.history.splice(0,s.history.length-20000);};
export async function configureBudget(store,input){
  const label=text(input.label,'Account label'),keyEnv=text(input.keyEnv??'OPENWEATHER_API_KEY','API key environment name',128);
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv))fail('INVALID_INPUT','Use an environment-variable name');
  const start=Date.parse(input.start),end=Date.parse(input.end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('INVALID_INPUT','Use a valid allowance start and end');
  const limit=integer(input.limit,'Account call allowance',1,10000000),externalCalls=integer(input.externalCalls??0,'Calls used elsewhere',0,10000000);
  const budgetId=digest({start,end,keyEnv}).slice(0,32);
  return store.transaction(s=>{
    if(s.account&&s.account.keyEnv!==keyEnv&&Object.values(s.budgets).some(b=>b.used>0))fail('ACCOUNT_CHANGE','Retain this account ledger; use a new workspace for a different key environment',409);
    for(const b of Object.values(s.budgets))if(b.id!==budgetId&&start<b.end&&end>b.start)fail('BUDGET_OVERLAP','The allowance overlaps a retained accounting window',409);
    const previous=s.budgets[budgetId];s.account={label,keyEnv,budgetId};
    s.budgets[budgetId]={id:budgetId,start,end,limit,externalCalls,used:previous?.used??0,updatedAt:now()};
    history(s,'ACCOUNT_ALLOWANCE',{budgetId,limit,externalCalls});return s.budgets[budgetId];
  });
}
export async function saveProject(store,{id:projectId,selection,expectedRevision}){
  identifier(projectId,'Project name');const selected=settings(selection);
  return store.transaction(s=>{
    const previous=s.projects[projectId];
    if(previous&&previous.revision!==expectedRevision)fail('PROJECT_CHANGED','Reload the current project before saving',409);
    if(!previous&&expectedRevision!==undefined&&expectedRevision!==0)fail('PROJECT_CHANGED','Project does not exist at that revision',409);
    const revision=(previous?.revision??0)+1;
    s.projects[projectId]={...(previous??{schema:SCHEMA,id:projectId,createdAt:now(),sources:[],reviews:[],exports:[],activeReview:null,previousReview:null}),
      selection:selected,revision,updatedAt:now(),schedule:null};
    history(s,'PROJECT_SAVED',{project:projectId,revision});return s.projects[projectId];
  });
}
export async function createAcquisition(store,{project:projectId,start,end,requestId}){
  epoch(start,'Hourly start');epoch(end,'Hourly end');
  if(start%3600||end%3600||end<=start||end-start>200000*3600)fail('INVALID_INPUT','Choose increasing UTC hour boundaries, up to 200,000 hours');
  const jobId=requestId?identifier(requestId,'Request identity'):id('weather');
  return store.transaction(s=>{
    const project=projectOf(s,projectId),existing=s.jobs[jobId];
    if(existing){if(existing.project!==projectId||existing.start!==start||existing.end!==end||existing.revision!==project.revision)fail('REQUEST_CONFLICT','This request identity has different inputs',409);return existing;}
    if(Object.keys(s.jobs).length>=1000)fail('STORE_CAPACITY','Retain this workspace and start another after 1,000 acquisitions',409);
    const job={id:jobId,project:projectId,revision:project.revision,selection:structuredClone(project.selection),start,end,createdAt:now(),
      state:'READY',phase:'current',cursor:requestURL('current',project.selection),attempts:[],hourlyPages:0,maxPages:project.selection.maxPages,
      visited:[],stopRequested:false,completedAt:null,reason:null};
    s.jobs[jobId]=job;history(s,'ACQUISITION_CREATED',{project:projectId,job:jobId});return job;
  });
}
async function boundedBody(response){
  let bytes=0;const chunks=[];
  if(response.body)for await(const chunk of response.body){bytes+=chunk.length;if(bytes>MAX_RESPONSE){fail('RESPONSE_LIMIT','Provider page exceeded the 1 MiB response allowance',502);}chunks.push(chunk);}
  const raw=Buffer.concat(chunks).toString('utf8');let body;
  try{body=JSON.parse(raw);}catch{fail('INVALID_JSON','Provider response was not complete JSON',502);}
  return {body,bytes};
}
function finish(job,reason){job.cursor=null;job.state='COMPLETE';job.reason=reason;job.completedAt=now();job.stopRequested=false;}
function applyReceipt(s,job,attempt,receipt,reference){
  if(attempt.state!=='IN_FLIGHT')return job;
  if(receipt.attempt!==attempt.id||receipt.url!==attempt.url||receipt.kind!==attempt.kind)fail('RESPONSE_IDENTITY','Retained response does not match its request');
  attempt.state='RECORDED';attempt.response=reference;attempt.finishedAt=receipt.finishedAt;attempt.status=receipt.status??null;
  s.retainedBytes+=reference.bytes;job.updatedAt=now();
  if(!receipt.page){job.state=receipt.policy.state;job.reason=receipt.policy.message;job.retryAt=receipt.policy.retryAt;job.retryable=receipt.policy.retryable;return job;}
  job.visited.push(cursorKey(attempt.url));attempt.state='APPLIED';job.retryAt=null;job.retryable=false;
  if(attempt.kind==='current'){job.phase='hourly';job.cursor=requestURL('hourly',job.selection,job.start);job.state='READY';return job;}
  job.hourlyPages++;
  const page=receipt.page,last=page.rows.at(-1)?.at;
  if(last!==undefined&&last>=job.end-3600){finish(job,'REQUESTED_RANGE_READ');return job;}
  if(!page.next){finish(job,'SOURCE_EXHAUSTED');return job;}
  const next=continuation(page.next,'hourly',job.selection),nextStart=Number(new URL(next).searchParams.get('start'));
  if(nextStart>=job.end){finish(job,'PROVIDER_CURSOR_PASSED_RANGE');return job;}
  const priorStart=Number(new URL(attempt.url).searchParams.get('start'));
  if(nextStart<=priorStart||job.visited.includes(cursorKey(next))){job.state='INVALID_RESPONSE';job.reason='Provider continuation did not advance';job.retryable=false;return job;}
  job.cursor=next;job.state=job.hourlyPages>=job.maxPages?'PAGE_LIMIT':'READY';job.reason=job.state==='PAGE_LIMIT'?'Saved hourly page allowance reached':null;return job;
}
export function createAcquirer(store,{fetchImpl=globalThis.fetch,env=process.env}={}){
  const running=new Map();let closing=false,sourceGate=Promise.resolve();
  const recover=async()=>{
    const snapshot=store.snapshot();
    for(const old of Object.values(snapshot.jobs).filter(j=>!running.has(j.id)))for(const attempt of old.attempts.filter(a=>a.state==='IN_FLIGHT')){
      let record;
      try{record=await store.read('records',attempt.id);}catch(e){if(e.code!=='ENOENT')throw e;}
      await store.transaction(s=>{
        const job=jobOf(s,old.id),current=job.attempts.find(a=>a.id===attempt.id);if(current.state!=='IN_FLIGHT')return;
        if(record){const ref={id:attempt.id,bytes:record.bytes.length,sha256:record.sha256};applyReceipt(s,job,current,record.value,ref);}
        else{current.state='UNKNOWN';current.finishedAt=now();job.state='UNKNOWN';job.reason='The process ended after reserving this request. Its call remains counted; explicitly resume to make another request.';}
      });
    }
  };
  const step=async jobId=>{
    const selected=jobOf(store.snapshot(),jobId).selection,key=credential(selected,env);
    const attempt=await store.transaction(s=>{
      const job=jobOf(s,jobId);
      if(job.stopRequested){job.state='PAUSED';job.reason='Stopped after the last retained request';job.stopRequested=false;return null;}
      if(!job.cursor||!['READY','RUNNING'].includes(job.state))return null;
      if(job.phase==='hourly'&&job.hourlyPages>=job.maxPages){job.state='PAGE_LIMIT';job.reason='Saved hourly page allowance reached';return null;}
      if(s.account?.keyEnv!==job.selection.keyEnv)fail('ACCOUNT_REQUIRED','Configure this key environment and its account allowance first',409);
      const budget=s.budgets[s.account.budgetId],at=Date.now();
      if(!budget||at<budget.start||at>=budget.end){job.state='BUDGET';job.reason='Choose the current local allowance window';return null;}
      if(budget.used+budget.externalCalls>=budget.limit){job.state='BUDGET';job.reason='Retained calls plus recorded external use reached the account allowance';return null;}
      if(s.retainedBytes+MAX_RESPONSE>256*1024*1024)fail('STORE_CAPACITY','Workspace response allowance is full',409);
      if(job.attempts.length>=30000)fail('STORE_CAPACITY','Acquisition request ledger is full',409);
      const request={id:id('request'),kind:job.phase,url:continuation(job.cursor,job.phase,job.selection),startedAt:now(),state:'IN_FLIGHT',budgetId:budget.id};
      budget.used++;job.attempts.push(request);job.state='RUNNING';job.updatedAt=now();return request;
    });
    if(!attempt)return false;
    let receipt={schema:'stellar-forge.openweather-response.v1',attempt:attempt.id,url:attempt.url,kind:attempt.kind,startedAt:attempt.startedAt};
    try{
      const url=new URL(attempt.url);url.searchParams.set('appid',key);
      const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(selected.timeoutMs)});
      receipt.status=response.status;if(!response.ok)receipt.policy=retryPolicy(response.status,response.headers);receipt.headers={date:response.headers.get('date'),retryAfter:response.headers.get('retry-after'),contentType:response.headers.get('content-type')};
      const {body,bytes}=await boundedBody(response);receipt.receivedBytes=bytes;receipt.body=redact(body,key);
      if(response.ok){receipt.page=normalizePage(receipt.body,attempt.kind,selected);receipt.policy={state:'READY',retryable:false,retryAt:null};}
      else receipt.policy=retryPolicy(response.status,response.headers);
    }catch(e){
      receipt.error={code:e.code??e.name??'SOURCE_REQUEST',message:redact(e.message,key)};
      receipt.policy??={state:['RESPONSE_CONTRACT','INVALID_JSON','RESPONSE_LIMIT'].includes(e.code)?'INVALID_RESPONSE':'SOURCE_ERROR',
        retryable:!['RESPONSE_CONTRACT','INVALID_JSON','RESPONSE_LIMIT'].includes(e.code),retryAt:null,message:redact(e.message,key)};
    }
    receipt.finishedAt=now();
    const reference=await store.write('records',attempt.id,receipt);
    await store.transaction(s=>{const job=jobOf(s,jobId),item=job.attempts.find(a=>a.id===attempt.id);return applyReceipt(s,job,item,receipt,reference);});
    return true;
  };
  const serialStep=jobId=>{const work=sourceGate.then(()=>closing?false:step(jobId));sourceGate=work.catch(()=>{});return work;};
  const run=jobId=>{
    if(closing)fail('SERVER_CLOSING','The application is closing',409);
    if(running.has(jobId))return running.get(jobId);
    const work=Promise.resolve().then(async()=>{
      try{
        while(!closing&&['READY','RUNNING'].includes(jobOf(store.snapshot(),jobId).state)){if(!await serialStep(jobId))break;}
      }catch(e){
        await store.transaction(s=>{
          const job=jobOf(s,jobId);job.state=job.attempts.some(a=>a.state==='IN_FLIGHT')?'UNKNOWN':'PAUSED';
          job.reason=e.message;job.errorCode=e.code??'ACQUISITION_ERROR';return job;
        });
      }finally{running.delete(jobId);}
      return jobOf(store.snapshot(),jobId);
    });running.set(jobId,work);return work;
  };
  const resume=async(jobId,{extraPages=0,acknowledgeUnknown=false,background=false}={})=>{
    await recover();
    await store.transaction(s=>{
      const job=jobOf(s,jobId);
      if(running.has(jobId))fail('ACQUISITION_RUNNING','This acquisition is already running',409);
      if(!job.cursor)fail('ACQUISITION_FINISHED','Create a new acquisition for another range',409);
      if(['INVALID_REQUEST','UNAVAILABLE','REJECTED','INVALID_RESPONSE'].includes(job.state))fail('SOURCE_CORRECTION_REQUIRED','Use a corrected new acquisition; this original request remains retained',409);
      if(job.state==='UNKNOWN'&&!acknowledgeUnknown)fail('UNKNOWN_REQUEST','A previous request may already have consumed a call. Acknowledge it before another attempt',409);
      if(job.retryAt&&Date.now()<Date.parse(job.retryAt))fail('RETRY_LATER','Provider Retry-After has not elapsed: '+job.retryAt,409);
      if(extraPages){integer(extraPages,'Additional hourly pages',1,10000);job.maxPages=integer(job.maxPages+extraPages,'Total hourly pages',1,10000);}
      job.state='READY';job.reason=null;job.stopRequested=false;return job;
    });const work=run(jobId);return background?jobOf(store.snapshot(),jobId):work;
  };
  const stop=jobId=>store.transaction(s=>{const job=jobOf(s,jobId);if(!job.cursor)return job;job.stopRequested=true;if(!running.has(jobId)){job.state='PAUSED';job.reason='Stopped by operator';job.stopRequested=false;}return job;});
  return {recover,run,resume,stop,running:()=>[...running.keys()],close:async()=>{closing=true;await Promise.allSettled([...running.values()]);}};
}
export async function dataset(store,jobId,{conflicts='reject'}={}){
  if(!['reject','first','last'].includes(conflicts))fail('INVALID_INPUT','Choose reject, first or last for conflicting overlapping records');
  const job=jobOf(store.snapshot(),jobId),hours=new Map(),differences=[],sources=[];let current=null,duplicates=0;
  const metadata=[];
  for(const attempt of job.attempts.filter(a=>a.state==='APPLIED')){
    const record=await store.read('records',attempt.id);
    if(record.sha256!==attempt.response.sha256)fail('RESPONSE_CHANGED','A retained provider response changed',409);
    const page=record.value.page;sources.push({id:attempt.id,kind:attempt.kind,url:attempt.url,receivedAt:record.value.finishedAt,sha256:record.sha256,status:record.value.status});
    metadata.push({source:attempt.id,lat:page.lat,lon:page.lon,timezone:page.timezone,timezoneOffset:page.timezoneOffset});
    if(attempt.kind==='current'){current=page.rows[0];continue;}
    for(const row of page.rows){
      if(row.at<job.start||row.at>=job.end)continue;
      const prior=hours.get(row.at);
      if(prior){if(stable(prior)!==stable(row)){differences.push({at:row.at,before:prior,after:row,source:attempt.id});if(conflicts==='last')hours.set(row.at,row);}else duplicates++;}
      else hours.set(row.at,row);
    }
  }
  const gaps=[];let start=null;
  for(let at=job.start;at<job.end;at+=3600){
    if(!hours.has(at)){if(start===null)start=at;}
    else if(start!==null){gaps.push({start,end:at,hours:(at-start)/3600});start=null;}
  }
  if(start!==null)gaps.push({start,end:job.end,hours:(job.end-start)/3600});
  const rows=[...hours.values()].sort((a,b)=>a.at-b.at),complete=Boolean(current)&&gaps.length===0&&(differences.length===0||conflicts!=='reject');
  return {schema:DATA_SCHEMA,project:job.project,revision:job.revision,job:job.id,requested:{lat:job.selection.lat,lon:job.selection.lon,start:job.start,end:job.end},
    units:units(job.selection.units),timezone:metadata[0]?.timezone??null,current,hourly:rows,metadata,sources,
    coverage:{complete,expectedHours:(job.end-job.start)/3600,receivedHours:rows.length,gaps,duplicateRecords:duplicates,conflictingRecords:differences.length},
    conflicts:differences,conflictPolicy:conflicts,acquisition:{state:job.state,reason:job.reason,attemptedCalls:job.attempts.length,successfulPages:sources.length}};
}
export async function reviewAcquisition(store,{job:jobId,notes='',acceptPartial=false,conflicts='reject'}){
  const data=await dataset(store,jobId,{conflicts}),job=jobOf(store.snapshot(),jobId);
  if(!data.current&&!data.hourly.length)fail('NO_DATA','Acquire provider records before creating a data edition',409);
  if(!data.coverage.complete&&(!acceptPartial||!String(notes).trim()))fail('PARTIAL_REVIEW','Review the missing range/conflicts and record an explicit partial-acceptance note',409);
  if(data.coverage.conflictingRecords&&conflicts==='reject')fail('CONFLICT_REVIEW','Select which original overlapping record to retain before acceptance',409);
  if(typeof notes!=='string'||notes.length>4000)fail('INVALID_INPUT','Review note must be at most 4,000 characters');
  const core={data,selection:job.selection,fieldMap:FIELD_MAP,source:SOURCE,decision:{notes,acceptPartial,conflicts}},reviewId=digest(core);
  let existing;try{existing=await store.read('reviews',reviewId);}catch(e){if(e.code!=='ENOENT')throw e;}
  const document=existing?.value??{schema:'stellar-forge.openweather-review.v1',id:reviewId,createdAt:now(),...core};
  if(existing&&digest({data:document.data,selection:document.selection,fieldMap:document.fieldMap,source:document.source,decision:document.decision})!==reviewId)
    fail('REVIEW_CHANGED','Retained data review changed',409);
  const ref=existing?{id:reviewId,bytes:existing.bytes.length,sha256:existing.sha256}:await store.write('reviews',reviewId,document);
  await store.transaction(s=>{
    const project=projectOf(s,job.project);if(!project.reviews.some(r=>r.id===reviewId)){project.reviews.push({...ref,job:jobId,revision:job.revision,createdAt:document.createdAt,complete:data.coverage.complete});s.retainedBytes+=ref.bytes;}
    history(s,'DATA_REVIEWED',{project:job.project,review:reviewId});return ref;
  });return document;
}
export async function readReview(store,projectId,reviewId){
  const project=projectOf(store.snapshot(),projectId),ref=project.reviews.find(r=>r.id===identifier(reviewId));
  if(!ref)fail('REVIEW_MISSING','Review does not belong to this project',404);
  const read=await store.read('reviews',reviewId);if(read.sha256!==ref.sha256)fail('REVIEW_CHANGED','Retained review changed',409);return read.value;
}
export async function selectReview(store,{project:projectId,review:reviewId,expectedRevision}){
  const review=await readReview(store,projectId,reviewId);
  return store.transaction(s=>{
    const project=projectOf(s,projectId);
    if(project.revision!==expectedRevision)fail('PROJECT_CHANGED','Reload the project before selecting a data edition',409);
    if(project.activeReview===reviewId)return project;
    project.previousReview=project.activeReview;project.activeReview=reviewId;history(s,'DATA_SELECTED',{project:projectId,review:reviewId});return project;
  });
}
export async function rollbackReview(store,{project:projectId,expectedReview}){
  return store.transaction(s=>{
    const project=projectOf(s,projectId);if(project.activeReview!==expectedReview)fail('REVIEW_CHANGED','Active data edition changed',409);
    if(!project.previousReview)fail('REVIEW_MISSING','There is no previous selected data edition',409);
    const before=project.activeReview;project.activeReview=project.previousReview;project.previousReview=before;
    history(s,'DATA_ROLLBACK',{project:projectId,review:project.activeReview});return project;
  });
}
