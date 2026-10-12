// MIT. Complete original-source Europe PMC receiving on an existing Research listener.
import {readFile,open,rename,link,unlink,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {runEuropePmcCli} from './europe-pmc-cli.mjs';
import {validateEuropePmcPortable} from './europe-pmc-workspace.mjs';
import {sourceDocument,buildEdition,validateEdition,exportRIS,exportCSV,canonical,jsonBytes,SOURCE_TERMS}
  from '../../sf30-seller-sdk/europe-pmc/source.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';

const SCHEMA='stellar-forge.europe-pmc-customer-journey.v1';
const now=()=>new Date().toISOString(),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
async function existing(path){try{const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink(),'EUROPE_PMC_JOURNEY_REGULAR_FILE_REQUIRED');return await readFile(path);}
 catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomic(path,bytes){const candidate=path+'.pending-'+randomUUID(),handle=await open(candidate,'wx',0o600);
 try{try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await rename(candidate,path);}
 finally{await unlink(candidate).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
async function exact(path,bytes){const retained=await existing(path);if(retained){need(retained.equals(bytes),'EUROPE_PMC_JOURNEY_RETAINED_BYTES_CHANGED');return;}
 const candidate=path+'.pending-'+randomUUID(),handle=await open(candidate,'wx',0o600);
 try{try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await link(candidate,path);}catch(error){if(error.code!=='EEXIST')throw error;need((await readFile(path)).equals(bytes),'EUROPE_PMC_JOURNEY_RETAINED_BYTES_CHANGED');}}
 finally{await unlink(candidate).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
function connection(url){const value=new URL(url),token=new URLSearchParams(value.hash.slice(1)).get('token');
 need(value.protocol==='http:'&&['127.0.0.1','[::1]'].includes(value.hostname)&&value.port&&
  !value.username&&!value.password&&/^[a-f0-9]{64}$/.test(token??''),'EUROPE_PMC_JOURNEY_ORIGINAL_LISTENER_REQUIRED');
 return {origin:value.origin,token,url:value.href};}
async function privateRoot(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'EUROPE_PMC_JOURNEY_ABSOLUTE_DIRECTORY_REQUIRED');
 await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'EUROPE_PMC_JOURNEY_PRIVATE_DIRECTORY_REQUIRED');return path;}
async function sourcePins(){const directory=fileURLToPath(new URL('.',import.meta.url)),paths=[
 'europe-pmc-journey.mjs','europe-pmc-workspace.mjs','europe-pmc-routes.mjs','europe-pmc-client.mjs','europe-pmc-cli.mjs',
 'workspace-client.mjs','server.mjs','public/europe-pmc.html','public/europe-pmc.css','public/europe-pmc.js',
 '../../sf30-seller-sdk/europe-pmc/source.mjs','../../sf30-seller-sdk/routescan/quota.mjs','../../sf30-seller-sdk/routescan/config.mjs'];
 const result=[];for(const path of paths){const bytes=await readFile(resolve(directory,path));result.push({path,bytes:bytes.length,sha256:digest(bytes)});}return result;}
async function inputs(directory){need(typeof directory==='string'&&isAbsolute(directory),'EUROPE_PMC_JOURNEY_INPUT_DIRECTORY_REQUIRED');
 const bytes=await readFile(join(directory,'manifest.json')),manifest=JSON.parse(bytes);
 need(manifest.schema==='stellar-forge.europe-pmc-public-inputs.v1'&&manifest.editions?.length===2,'EUROPE_PMC_JOURNEY_INPUT_MANIFEST_REQUIRED');
 const editions=[],files=[{name:'source-input-manifest.json',bytes}];
 for(const selected of manifest.editions){
  need(['baseline','expanded'].includes(selected.id)&&Array.isArray(selected.pages)&&selected.pages.length>0,'EUROPE_PMC_JOURNEY_INPUT_EDITION_INVALID');
  const documents=[];
  for(const page of selected.pages){
   need(/^[a-z0-9][a-z0-9.-]*\.json$/.test(page.name)&&!page.name.includes('..'),'EUROPE_PMC_JOURNEY_INPUT_NAME_INVALID');
   const body=await readFile(join(directory,page.name));
   need(body.length===page.bytes&&digest(body)===page.sha256,'EUROPE_PMC_JOURNEY_ORIGINAL_INPUT_CHANGED');
   files.push({name:'input-'+page.name,bytes:body});
   documents.push(sourceDocument({url:page.url,bytes:body,kind:'retained-document',
    observation:{status:null,headers:null,retrievedAt:null,retainedAt:page.retainedAt},provenance:page.provenance}));
  }
  editions.push({...selected,documents});
 }
 need(editions[0].id==='baseline'&&editions[1].id==='expanded','EUROPE_PMC_JOURNEY_INPUT_ORDER_CHANGED');
 return {manifest,manifestSha256:digest(bytes),editions,files};
}
async function journal(directory,selected,token){
 const path=join(directory,'europe-pmc-journey.json'),prior=await existing(path),state=prior?JSON.parse(prior):{
  schema:SCHEMA,input:selected,createdAt:now(),stage:'PREPARED',requests:{},artifacts:{},preparedArtifacts:{},attempts:[],sourceEditions:[]};
 need(state.schema===SCHEMA&&same(state.input,selected),'EUROPE_PMC_JOURNEY_ORIGINAL_SELECTION_CHANGED');
 const save=async()=>{const bytes=jsonBytes(state);need(!bytes.includes(Buffer.from(token)),'EUROPE_PMC_JOURNEY_SESSION_IN_OUTPUT');await atomic(path,bytes);};
 const recover=async name=>{
  const bytes=await existing(join(directory,name)),descriptor=state.artifacts[name]??state.preparedArtifacts[name];
  if(!bytes){need(!state.artifacts[name],'EUROPE_PMC_JOURNEY_ARTIFACT_MISSING');return null;}
  need(descriptor&&descriptor.filename===name&&descriptor.bytes===bytes.length&&descriptor.sha256===digest(bytes),'EUROPE_PMC_JOURNEY_ARTIFACT_CHANGED');
  need(!bytes.includes(Buffer.from(token)),'EUROPE_PMC_JOURNEY_SESSION_IN_OUTPUT');
  if(!state.artifacts[name]){state.artifacts[name]=descriptor;await save();}return bytes;
 };
 const retain=async(name,value)=>{
  need(/^[a-z0-9][a-z0-9._-]*$/.test(name)&&!name.includes('..'),'EUROPE_PMC_JOURNEY_ARTIFACT_NAME_INVALID');
  const bytes=Buffer.isBuffer(value)?value:jsonBytes(value),old=await recover(name);
  if(old){need(old.equals(bytes),'EUROPE_PMC_JOURNEY_ARTIFACT_CHANGED');return state.artifacts[name];}
  need(!bytes.includes(Buffer.from(token)),'EUROPE_PMC_JOURNEY_SESSION_IN_OUTPUT');
  const descriptor={filename:name,bytes:bytes.length,sha256:digest(bytes)};
  if(state.preparedArtifacts[name]&&!same(state.preparedArtifacts[name],descriptor))
   (state.unpublishedCandidates??=[]).push({...state.preparedArtifacts[name],reconciledAbsentAt:now()});
  state.preparedArtifacts[name]=descriptor;await save();await exact(join(directory,name),bytes);
  state.artifacts[name]=descriptor;await save();return descriptor;
 };
 const request=async(name,make)=>{if(state.requests[name])return state.requests[name];
  state.requests[name]=await make();await save();return state.requests[name];};
 const step=async(name,make)=>{const file=name+'.json',old=await recover(file);if(old)return JSON.parse(old);
  const value=await make();await retain(file,value);return value;};
 const outputs=()=>Object.values(state.artifacts).map(row=>({...row,path:join(directory,row.filename)}));
 const verify=async()=>{for(const name of Object.keys(state.artifacts))await recover(name);};
 return {state,save,recover,retain,request,step,outputs,verify};
}
async function sourceGet(selected,service,name,journal,expectedSha256=null){
 const old=await journal.recover(name);if(old){if(expectedSha256)need(digest(old)===expectedSha256,'EUROPE_PMC_JOURNEY_SOURCE_EXPORT_CHANGED');return old;}
 const target=new URL(selected.path,service.origin);need(target.origin===service.origin&&target.pathname.startsWith('/api/'),'EUROPE_PMC_JOURNEY_LOCAL_ROUTE_REQUIRED');
 const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+service.token,
  ...(selected.library?{'X-Europe-Pmc-Selection':selected.library}:{})}});
 need(response.ok,'EUROPE_PMC_JOURNEY_EXPORT_HTTP_'+response.status);
 const declared=response.headers.get('content-length');need(declared===null||/^[0-9]+$/.test(declared)&&Number(declared)<=128*1024*1024,'EUROPE_PMC_JOURNEY_EXPORT_SIZE_INVALID');
 const chunks=[];let count=0;for await(const chunk of response.body??[]){count+=chunk.length;need(count<=128*1024*1024,'EUROPE_PMC_JOURNEY_EXPORT_SIZE_INVALID');chunks.push(chunk);}
 need(declared===null||Number(declared)===count,'EUROPE_PMC_JOURNEY_EXPORT_INCOMPLETE');const bytes=Buffer.concat(chunks,count);
 if(expectedSha256)need(digest(bytes)===expectedSha256,'EUROPE_PMC_JOURNEY_SOURCE_EXPORT_CHANGED');
 await journal.retain(name,bytes);return bytes;
}
async function allRecords(api,id){const items=[];let offset=0,first;
 do{const page=await api.records(id,{offset,limit:100});first??=page;
  need(page.operationId===id&&page.editionSha256===first.editionSha256,'EUROPE_PMC_JOURNEY_RECORD_PAGE_CHANGED');
  items.push(...page.items);offset=page.nextOffset;}while(offset!==null);
 need(items.length===first.total,'EUROPE_PMC_JOURNEY_RECORDS_INCOMPLETE');return {...first,items,nextOffset:null};
}
async function browserPhase({context,service,api,selected,query,operation,recordKey,journal}){
 need(context&&typeof context.newPage==='function','EUROPE_PMC_JOURNEY_EXISTING_BROWSER_CONTEXT_REQUIRED');
 const {state,save,retain,recover,request}=journal;
 if(state.browser?.complete)return state.browser;
 state.browser??={createdAt:now(),stage:'PREPARED',deniedRequests:[],errors:[]};
 if(state.browser.errors?.length||state.browser.routeError)(state.browser.previousAttempts??=[]).push({
  errors:state.browser.errors,routeError:state.browser.routeError??null,endedAt:now()});
 state.browser.errors=[];delete state.browser.routeError;await save();
 let page,routeTask=null;
 try{
  page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('dialog',dialog=>(dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss()).catch(()=>{}));
  page.on('pageerror',error=>state.browser.errors.push(String(error.message).split(service.token).join('[session]')));
  await page.route('**/*',async route=>{
   try{
    const incoming=route.request(),target=new URL(incoming.url());
    if(target.origin!==service.origin){state.browser.deniedRequests.push({origin:target.origin,path:target.pathname,method:incoming.method()});await route.abort('blockedbyclient');return;}
    if(incoming.method()==='POST'&&target.pathname==='/api/europe-pmc/reviews'){
     const payload=incoming.postDataJSON();
     if(state.browser.reviewRequest)need(same(payload,state.browser.reviewRequest),'EUROPE_PMC_JOURNEY_BROWSER_REPLAY_CHANGED');
     else{need(payload.operationId===operation.plan.id&&payload.editionSha256===operation.operation.editionSha256&&payload.recordKey===recordKey,
       'EUROPE_PMC_JOURNEY_BROWSER_SOURCE_CHANGED');state.browser.reviewRequest=payload;await save();}
     routeTask=(async()=>{const response=await route.fetch({maxRedirects:0}),bytes=Buffer.from(await response.body());
      need(response.ok(),'EUROPE_PMC_JOURNEY_BROWSER_SAVE_FAILED');const value=JSON.parse(bytes);
      need(value.requestId===payload.requestId&&value.recordKey===recordKey,'EUROPE_PMC_JOURNEY_BROWSER_RECEIPT_CHANGED');
      await retain('browser-record-decision.json',jsonBytes(value));state.browser.review={requestId:value.requestId,revision:value.revision};await save();
      await route.fulfill({response,body:bytes});})();
     await routeTask;return;
    }
    await route.continue();
   }catch(error){state.browser.routeError=error.code??'EUROPE_PMC_BROWSER_ROUTE_FAILED';await save().catch(()=>{});await route.abort('failed').catch(()=>{});}
  });
  const url=new URL('/europe-pmc.html',service.origin);url.hash=new URLSearchParams({token:service.token}).toString();
  const ready=async()=>{await page.locator('#connection').filter({hasText:'Workspace '}).waitFor();await page.waitForFunction(()=>!document.documentElement.hasAttribute('aria-busy'));};
  const reopen=async()=>{await page.goto(url.href,{waitUntil:'domcontentloaded'});await ready();};
  const openQuery=async()=>{await page.locator('#queries button').filter({hasText:query.title}).first().click();await ready();};
  const openRecord=async()=>{
   await page.locator('#editions button').filter({hasText:operation.plan.payload.label}).first().click();await ready();
   await page.locator('#records button').filter({hasText:recordKey}).click();await page.getByLabel('Complete metadata triage note',{exact:true}).waitFor();await ready();
  };
  const download=async(action,name)=>{
   const old=await recover(name);if(old)return old;
   const [file]=await Promise.all([page.waitForEvent('download'),Promise.resolve().then(action)]);
   need(!await file.failure(),'EUROPE_PMC_JOURNEY_BROWSER_DOWNLOAD_FAILED');const source=await file.path();
   need(source,'EUROPE_PMC_JOURNEY_BROWSER_DOWNLOAD_MISSING');const bytes=await readFile(source);await retain(name,bytes);return bytes;
  };
  await reopen();await page.locator('#actor').fill('Europe PMC receiving operator');
  if(!state.browser.queryDraft){
   await openQuery();const draft=await request('browserQueryDraft',async()=>({title:query.title+' — retained unsaved operator draft',query:query.selection.query,baseRevision:query.revision}));
   await page.locator('#query-title').fill(draft.title);await page.locator('#query-text').fill(draft.query);
   await page.waitForFunction(({queryId,title})=>new Promise((resolve,reject)=>{const r=indexedDB.open('research-europe-pmc-v1',1);
    r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readonly'),q=tx.objectStore('drafts').getAll();
     q.onsuccess=()=>{db.close();resolve(q.result.some(row=>row.id==='query:'+queryId&&row.value.title===title));};q.onerror=()=>{db.close();reject(q.error);};};}),
    {queryId:query.id,title:draft.title});
   await reopen();await openQuery();need(await page.locator('#query-title').inputValue()===draft.title,'EUROPE_PMC_JOURNEY_QUERY_DRAFT_LOST');
   await retain('browser-recovered-search-draft.json',draft);
   await page.locator('#discard-query').click();await ready();
   need(await page.locator('#query-title').inputValue()===query.title,'EUROPE_PMC_JOURNEY_QUERY_DRAFT_DISCARD_FAILED');
   state.browser.queryDraft=true;await save();
  }
  await openRecord();
  const planned=await request('browserRecordDraft',async()=>({decision:'follow-up',
   note:'Original Europe PMC resource metadata retained for the receiving workflow.\nThe source bytes, DOI, licence and every original cursor page were inspected. This metadata note is not an eligibility decision.\nContinue the substantive scientific review in the selected dossier question.'}));
  if(!state.browser.review){
   if(state.browser.reviewRequest){
    const value=await api.review(state.browser.reviewRequest);
    need(value.requestId===state.browser.reviewRequest.requestId,'EUROPE_PMC_JOURNEY_BROWSER_REPLAY_CHANGED');
    await retain('browser-record-decision.json',jsonBytes(value));state.browser.review={requestId:value.requestId,revision:value.revision};await save();
    await reopen();await openRecord();
   }else{
    await page.getByLabel('Metadata triage decision',{exact:true}).selectOption(planned.decision);
    await page.getByLabel('Complete metadata triage note',{exact:true}).fill(planned.note);
    await page.waitForFunction(({operationId,key,note})=>new Promise((resolve,reject)=>{const r=indexedDB.open('research-europe-pmc-v1',1);
     r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readonly'),q=tx.objectStore('drafts').getAll();
      q.onsuccess=()=>{db.close();resolve(q.result.some(row=>row.id==='record:'+operationId+':'+key&&row.value.note===note));};q.onerror=()=>{db.close();reject(q.error);};};}),
     {operationId:operation.plan.id,key:recordKey,note:planned.note});
    await reopen();await openRecord();
    need(await page.getByLabel('Complete metadata triage note',{exact:true}).inputValue()===planned.note,'EUROPE_PMC_JOURNEY_RECORD_DRAFT_LOST');
    await retain('browser-recovered-record-draft.json',planned);
    const [reply]=await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/europe-pmc/reviews'),
     page.getByRole('button',{name:'Save record decision',exact:true}).click()]);
    need(reply.ok(),'EUROPE_PMC_JOURNEY_BROWSER_SAVE_FAILED');await reply.body();if(routeTask)await routeTask;await ready();
   }
  }
  const reviewed=(await api.records(operation.plan.id,{key:recordKey,limit:1})).items[0];
  need(reviewed.review?.requestId===state.browser.reviewRequest?.requestId&&reviewed.review.note===planned.note&&reviewed.review.decision===planned.decision,
   'EUROPE_PMC_JOURNEY_BROWSER_REVIEW_CHANGED');
  const replay=await api.review(state.browser.reviewRequest);need(same(replay,reviewed.review),'EUROPE_PMC_JOURNEY_BROWSER_REVIEW_REPLAY_CHANGED');
  await retain('browser-original-review-replay.json',replay);
  await page.locator('[data-view="comparison"]').click();
  await page.locator('#compare-before').selectOption(selected.baseline.plan.id);await page.locator('#compare-after').selectOption(selected.expanded.plan.id);
  await page.locator('#compare-button').click();await ready();
  const compared=JSON.parse(await download(()=>page.locator('#export-comparison').click(),'browser-complete-comparison.json'));
  need(compared.queryScopeChanged&&compared.items.length===2&&compared.counts.ADDED===1,'EUROPE_PMC_JOURNEY_BROWSER_COMPARISON_CHANGED');
  await openRecord();
  const original=await download(()=>page.getByRole('button',{name:'Download exact page JSON',exact:true}).click(),'browser-original-page.json');
  need(digest(original)===operation.documents[0].bodySha256,'EUROPE_PMC_JOURNEY_BROWSER_SOURCE_CHANGED');
  for(const size of [{width:1440,height:1000},{width:390,height:844},{width:320,height:760}]){
   const name='browser-record-review-'+size.width+'.png';
   if(!await recover(name)){await page.setViewportSize(size);await page.locator('#record-detail').scrollIntoViewIfNeeded();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    need(!overflow,'EUROPE_PMC_JOURNEY_NARROW_LAYOUT_OVERFLOW');await retain(name,await page.screenshot({fullPage:true}));}
  }
  need(!state.browser.routeError&&state.browser.errors.length===0&&state.browser.deniedRequests.length===0,'EUROPE_PMC_JOURNEY_BROWSER_ERROR');
  state.browser.complete=true;state.browser.stage='COMPLETE';state.browser.completedAt=now();await save();return state.browser;
 }finally{if(routeTask)await routeTask.catch(()=>{});if(page)await page.close({runBeforeUnload:false});}
}

/**
 * Existing Research listener and native controller remain with the caller.
 * browser is its persistent BrowserContext (or {context}); this function owns only its page.
 * The source inputs are exact retained public JSON files, never fabricated provider responses.
 */
export async function runEuropePmcWorkflow({url,dossierId,questionIds,runDirectory,inputDirectory,browser,merchant=null}){
 const service=connection(url);await privateRoot(runDirectory);
 need(typeof dossierId==='string'&&questionIds&&typeof questionIds.baseline==='string'&&typeof questionIds.expanded==='string'&&
  questionIds.baseline!==questionIds.expanded,'EUROPE_PMC_JOURNEY_ORIGINAL_QUESTIONS_REQUIRED');
 const original=await inputs(inputDirectory),input={origin:service.origin,dossierId,questionIds,manifestSha256:original.manifestSha256};
 return withPrivateLock(runDirectory,'journey.lock',async()=>{
  const j=await journal(runDirectory,input,service.token),{state,save,retain,recover,request,step}=j;
  if(state.stage==='COMPLETE'){await j.verify();return {...state.result,nativeOutputs:j.outputs()};}
  const attempt={startedAt:now(),stage:state.stage};state.attempts.push(attempt);await save();
  const pins=await sourcePins(),fingerprint=digest(jsonBytes(pins));
  if(state.sourceEditions.at(-1)?.fingerprint!==fingerprint)state.sourceEditions.push({fingerprint,selectedAt:now(),files:pins});
  attempt.sourceFingerprint=fingerprint;await save();
  const client=new ResearchWorkspaceClient({url}),api=client.europePmc();
  try{
   const library=await api.list({limit:100}),metadata=await client.metadata(dossierId);
   need(metadata.questions.some(row=>row.id===questionIds.baseline)&&metadata.questions.some(row=>row.id===questionIds.expanded),
    'EUROPE_PMC_JOURNEY_QUESTION_CHANGED');
   need(!state.workspaceId||state.workspaceId===client.workspaceId,'EUROPE_PMC_JOURNEY_WORKSPACE_CHANGED');
   state.workspaceId=client.workspaceId;state.libraryId??=library.id;state.originalSelection??=library.selection.library;
   need(library.id===state.libraryId,'EUROPE_PMC_JOURNEY_LIBRARY_CHANGED');await save();
   for(const file of original.files)await retain(file.name,file.bytes);
   const prefix='epmc-native-'+digest(jsonBytes(input)).slice(0,24),actor='Europe PMC receiving operator',selected={};
   let queryId=null;
   for(const edition of original.editions){
    const queryInput=await request('query-'+edition.id,async()=>({requestId:prefix+'-query-'+edition.id,actor,
     ...(queryId?{id:queryId}:{}),expectedRevision:edition.id==='baseline'?0:1,title:'Europe PMC resource-paper update',
     selection:edition.selection,sourceTerms:SOURCE_TERMS}));
    const query=await step('saved-query-'+edition.id,()=>api.saveQuery(queryInput));queryId=query.id;
    const prepareInput=await request('prepare-'+edition.id,async()=>({requestId:prefix+'-prepare-'+edition.id,actor,
     queryId:query.id,queryRevision:query.revision,label:edition.label,mode:'documents'}));
    const prepared=await step('prepared-'+edition.id,()=>api.prepare(prepareInput));
    need(prepared.plan.payload.query.sha256===query.sha256,'EUROPE_PMC_JOURNEY_QUERY_PLAN_CHANGED');
    const imported=await step('imported-'+edition.id,()=>api.importDocuments(prepared.plan.id,{expectedPlanSha256:prepared.plan.sha256,documents:edition.documents,stopReason:null}));
    const current=await api.inspect(prepared.plan.id);
    need(current.operation.phase==='READY'&&current.operation.coverage.complete,'EUROPE_PMC_JOURNEY_SOURCE_INCOMPLETE');
    const expected=buildEdition({selection:edition.selection,documents:edition.documents,label:edition.label,
     createdAt:prepared.plan.preparedAt,sourceTerms:SOURCE_TERMS,pagination:prepared.plan.payload.pagination});
    need(digest(jsonBytes(expected))===current.operation.editionSha256,'EUROPE_PMC_JOURNEY_EDITION_CHANGED');
    const records=await allRecords(api,current.plan.id);
    need(same(records.items.map(row=>row.id),edition.expectedKeys)&&same(records.items.map(({review,...row})=>row),expected.results),
     'EUROPE_PMC_JOURNEY_RECORD_IDENTITIES_CHANGED');
    selected[edition.id]={...current,documents:edition.documents,expected};
    await step('native-records-'+edition.id,async()=>records);
    for(let index=0;index<edition.documents.length;index++){
     const document=edition.documents[index],descriptor=await api.source(current.plan.id,index);
     need(descriptor.documentId===document.documentId&&descriptor.kind==='retained-document'&&descriptor.observation.status===null&&
      descriptor.observation.headers===null&&descriptor.observation.retrievedAt===null&&descriptor.bodySha256===document.bodySha256,
      'EUROPE_PMC_JOURNEY_SOURCE_PROVENANCE_CHANGED');
     await retain('source-'+edition.id+'-'+index+'-descriptor.json',descriptor);
     await sourceGet({path:'/api/europe-pmc/operations/'+current.plan.id+'/source?index='+index,library:library.selection.library},
      service,'source-'+edition.id+'-'+index+'.json',j,document.bodySha256);
    }
    await sourceGet({path:'/api/europe-pmc/operations/'+current.plan.id+'/files/edition',library:library.selection.library},
     service,'edition-'+edition.id+'.json',j,current.operation.editionSha256);
    await sourceGet({path:'/api/europe-pmc/operations/'+current.plan.id+'/files/ris',library:library.selection.library},
     service,'records-'+edition.id+'.ris',j,digest(exportRIS(expected)));
    await sourceGet({path:'/api/europe-pmc/operations/'+current.plan.id+'/files/csv',library:library.selection.library},
     service,'records-'+edition.id+'.csv',j,digest(exportCSV(expected)));
   }
   state.selected=Object.fromEntries(Object.entries(selected).map(([id,value])=>[id,{operationId:value.plan.id,planSha256:value.plan.sha256,
    editionSha256:value.operation.editionSha256,editionBytes:value.operation.editionBytes,queryId:value.plan.payload.query.id,
    queryRevision:value.plan.payload.query.revision,records:value.expected.results.length,pages:value.documents.length}]));
   await save();
   const comparison=await step('complete-comparison',async()=>{
    const items=[];let first,offset=0;
    do{const page=await api.comparison({before:selected.baseline.plan.id,after:selected.expanded.plan.id,offset,limit:1});
     first??=page;need(page.before.sha256===first.before.sha256&&page.after.sha256===first.after.sha256,'EUROPE_PMC_JOURNEY_COMPARISON_CHANGED');
     items.push(...page.items);offset=page.nextOffset;}while(offset!==null);return {...first,items,nextOffset:null};});
   need(comparison.queryScopeChanged&&comparison.counts.ADDED===1&&comparison.counts.UNCHANGED===1&&comparison.items.length===2,
    'EUROPE_PMC_JOURNEY_COMPARISON_SCOPE_CHANGED');
   if(!state.apiReview){
    const reviewInput=await request('baseline-review',async()=>({requestId:prefix+'-baseline-review',actor,operationId:selected.baseline.plan.id,
     editionSha256:selected.baseline.operation.editionSha256,recordKey:original.editions[0].expectedKeys[0],expectedRevision:0,
     decision:'include',note:'Retained resource paper selected for the source-operation example. This records metadata triage, not a scientific eligibility judgement.'}));
    const review=await step('baseline-record-decision',()=>api.review(reviewInput));
    need(same(await api.review(reviewInput),review),'EUROPE_PMC_JOURNEY_REVIEW_REPLAY_CHANGED');
    state.apiReview={requestId:review.requestId,revision:review.revision};await save();
   }
   const query=await api.query(queryId);need(query.revision===2&&query.versions.length===2,'EUROPE_PMC_JOURNEY_QUERY_HISTORY_CHANGED');
   await browserPhase({context:browser?.context??browser,service,api,selected,query,operation:selected.expanded,
    recordKey:original.editions[1].expectedKeys.at(-1),journal:j});
   for(const name of ['baseline','expanded']){
    const value=selected[name],receiveInput=await request('receive-'+name,async()=>({requestId:prefix+'-receive-'+name,actor,dossierId,
     questionId:questionIds[name],label:original.editions.find(row=>row.id===name).label,expectedRevision:(await client.metadata(dossierId)).revision,
     expectedPlanSha256:value.plan.sha256,expectedEditionSha256:value.operation.editionSha256}));
    const received=await step('dossier-received-'+name,()=>api.receive(value.plan.id,receiveInput));
    const replay=await api.receive(value.plan.id,receiveInput);
    need(replay.duplicate&&same(replay.receipt,received.receipt),'EUROPE_PMC_JOURNEY_DOSSIER_RECEIPT_CHANGED');
    (state.received??={})[name]=received.receipt;await save();
   }
   if(!state.cli){
    const connectionFile=join(runDirectory,'connection.private.json');await atomic(connectionFile,jsonBytes({url}));
    const result=await step('cli-complete-comparison',()=>runEuropePmcCli(['compare-all','--connection',connectionFile,
     '--before',selected.baseline.plan.id,'--after',selected.expanded.plan.id]));
    need(same(result,comparison),'EUROPE_PMC_JOURNEY_CLI_COMPARISON_CHANGED');
    state.cli={complete:true,command:'compare-all'};await save();
   }
   for(const name of ['baseline','expanded'])await sourceGet({path:'/api/europe-pmc/operations/'+selected[name].plan.id+'/files/review',
    library:library.selection.library},service,'review-history-'+name+'.json',j);
   const dossier=await step('received-dossier-metadata',()=>client.metadata(dossierId));state.dossierRevision=dossier.revision;await save();
   for(const [name,revision]of [['baseline',state.received.baseline.revision],['expanded',state.received.expanded.revision]])
    for(const format of ['html','md','json.gz']){
     const bytes=await sourceGet({path:'/api/dossiers/'+encodeURIComponent(dossierId)+'/export?'+new URLSearchParams({format,revision:String(revision)})},
      service,'dossier-'+name+'.'+format,j);
     if(format==='html'||format==='md')need(bytes.includes(Buffer.from('Europe PMC')),'EUROPE_PMC_JOURNEY_REPORT_SOURCE_MISSING');
    }
   if(merchant&&!state.merchant){
    const value=await merchant({url,workspaceId:state.workspaceId,runDirectory,library:state.originalSelection,
     selected:state.selected,reviewRequest:state.browser.reviewRequest,queryId,dossierId});
    need(value&&Array.isArray(value.nativeOutputs)&&value.nativeOutputs.length>0,'EUROPE_PMC_JOURNEY_MERCHANT_RESULT_REQUIRED');
    const retained=[];
    for(const [index,file]of value.nativeOutputs.entries()){
     need(typeof file.filename==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.filename)&&!file.filename.includes('..')&&
      typeof file.path==='string'&&isAbsolute(file.path)&&resolve(file.path).startsWith(resolve(runDirectory)+'/'),
      'EUROPE_PMC_JOURNEY_MERCHANT_ARTIFACT_SELECTION_INVALID');
     const body=await existing(file.path);
     need(body&&body.length===file.bytes&&digest(body)===file.sha256,'EUROPE_PMC_JOURNEY_MERCHANT_ARTIFACT_CHANGED');
     const filename='merchant-'+String(index).padStart(2,'0')+'-'+file.filename.toLowerCase();
     const artifact=await retain(filename,body);
     retained.push({originalFilename:file.filename,...artifact});
    }
    const {nativeOutputs,...summary}=value;
    state.merchant={...summary,retainedArtifacts:retained};await save();
   }
   // The full Merchant phase may save native requests; freeze the final history afterwards.
   const history=await step('source-library-history',()=>api.history());
   const exportInput=await request('workspace-export',async()=>({requestId:prefix+'-workspace-export',actor}));
   const exported=await step('source-workspace-export-receipt',()=>api.exportWorkspace(exportInput));
   const archive=await sourceGet({path:'/api/europe-pmc/exports/'+encodeURIComponent(exportInput.requestId),library:library.selection.library},
    service,'europe-pmc-workspace.json.gz',j,exported.sha256);
   validateEuropePmcPortable(archive);
   const restoreInput=await request('workspace-restore',async()=>({requestId:prefix+'-workspace-restore',actor,
    file:join(runDirectory,'europe-pmc-workspace.json.gz'),expectedSha256:exported.sha256}));
   const restored=await step('source-workspace-received',()=>api.restoreFile(restoreInput));
   const current=await api.list({limit:100});
   need(current.id===state.libraryId&&current.selection.library===restored.selected.library&&current.receiving?.archiveSha256===exported.sha256,
    'EUROPE_PMC_JOURNEY_RECEIVED_LIBRARY_CHANGED');
   need(same(await api.history(),history),'EUROPE_PMC_JOURNEY_RECEIVED_HISTORY_CHANGED');
   need(same(await api.query(queryId),query),'EUROPE_PMC_JOURNEY_RECEIVED_QUERY_CHANGED');
   for(const name of ['baseline','expanded']){
    const operation=await api.inspect(selected[name].plan.id);
    need(operation.operation.editionSha256===selected[name].operation.editionSha256&&
     operation.receipts.some(row=>row.requestId===state.received[name].requestId),'EUROPE_PMC_JOURNEY_RECEIVED_SOURCE_CHANGED');
    const receipt=await api.receive(operation.plan.id,state.requests['receive-'+name]);
    need(receipt.duplicate&&same(receipt.receipt,state.received[name]),'EUROPE_PMC_JOURNEY_RECEIVED_RECEIPT_CHANGED');
   }
   state.finalSelection??={schema:SCHEMA,completedAt:now(),workspaceId:state.workspaceId,libraryId:state.libraryId,
    selectedLibrary:current.selection.library,inputManifestSha256:original.manifestSha256,sourceEditions:state.sourceEditions,
    queryId,queryRevisions:2,editions:state.selected,comparison:comparison.counts,queryScopeChanged:true,
    received:state.received,dossierId,dossierRevision:state.dossierRevision,workspaceArchive:{bytes:exported.bytes,sha256:exported.sha256},
    browser:{complete:state.browser.complete,review:state.browser.review},cli:state.cli,
    merchant:state.merchant??{state:'NOT_SELECTED'},freshProcessReopen:'AWAITING_ORIGINAL_OWNER_RESTART'};
   await save();await retain('europe-pmc-completed-receiving.json',state.finalSelection);
   state.result=state.finalSelection;state.stage='COMPLETE';attempt.completedAt=now();await save();await j.verify();
   return {...state.result,nativeOutputs:j.outputs()};
  }catch(error){attempt.error=error.code??'EUROPE_PMC_JOURNEY_FAILED';attempt.endedAt=now();await save().catch(()=>{});throw error;}
  finally{await client.close();}
 });
}

/** Call only after the original owner has closed and freshly opened its Research process. */
export async function verifyEuropePmcReopened({url,runDirectory}){
 const service=connection(url),state=JSON.parse(await readFile(join(runDirectory,'europe-pmc-journey.json')));
 need(state.schema===SCHEMA&&state.stage==='COMPLETE','EUROPE_PMC_JOURNEY_COMPLETE_OPERATION_REQUIRED');
 const j=await journal(runDirectory,state.input,service.token),client=new ResearchWorkspaceClient({url}),api=client.europePmc();
 try{
  const current=await api.list({limit:100});need(client.workspaceId===state.workspaceId&&current.id===state.libraryId&&
   current.selection.library===state.result.selectedLibrary&&current.receiving?.archiveSha256===state.result.workspaceArchive.sha256,
   'EUROPE_PMC_JOURNEY_COLD_SELECTION_CHANGED');
  const history=JSON.parse(await j.recover('source-library-history.json'));
  need(same(await api.history(),history),'EUROPE_PMC_JOURNEY_COLD_HISTORY_CHANGED');
  for(const [name,selected]of Object.entries(state.selected)){
   const operation=await api.inspect(selected.operationId);
   need(operation.plan.sha256===selected.planSha256&&operation.operation.editionSha256===selected.editionSha256&&
    operation.receipts.some(row=>row.requestId===state.received[name].requestId),'EUROPE_PMC_JOURNEY_COLD_SOURCE_CHANGED');
   const original=validateEdition(JSON.parse(await j.recover('edition-'+name+'.json'))),records=await allRecords(api,selected.operationId);
   need(same(records.items.map(({review,...row})=>row),original.results),'EUROPE_PMC_JOURNEY_COLD_RECORD_CHANGED');
   for(let index=0;index<original.originalDocuments.length;index++){
    const document=original.originalDocuments[index],actual=await api.source(selected.operationId,index);
    need(actual.documentId===document.documentId&&actual.bodySha256===document.bodySha256,'EUROPE_PMC_JOURNEY_COLD_PAGE_CHANGED');
   }
  }
  const metadata=await client.metadata(state.input.dossierId,{revision:state.dossierRevision});
  for(const receipt of Object.values(state.received))need(metadata.editions.some(row=>row.id===receipt.editionId&&row.raw?.sha256===receipt.sourceSha256),
   'EUROPE_PMC_JOURNEY_COLD_DOSSIER_CHANGED');
  const report={schema:'stellar-forge.europe-pmc-cold-reopen.v1',workspaceId:state.workspaceId,libraryId:state.libraryId,
   selectedLibrary:current.selection.library,dossierId:state.input.dossierId,dossierRevision:state.dossierRevision,
   sourceEditions:state.selected,originalWorkspaceArchiveSha256:state.result.workspaceArchive.sha256};
  await j.retain('europe-pmc-fresh-process-reopen.json',report);await j.verify();return {...report,nativeOutputs:j.outputs()};
 }finally{await client.close();}
}
