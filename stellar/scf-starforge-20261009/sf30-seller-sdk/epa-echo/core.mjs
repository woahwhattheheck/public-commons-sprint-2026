// MIT. Facility portfolios compose the original workspace, dataset, release and buyer engines.
import {openWorkspaceStore,jsonBytes,stable} from '../stellar-expert/store.mjs';
import {WORKSPACE_SCHEMA,workspaceSchema,ACTIONS,SOURCE_CONTRACT,REVIEW_STATUSES} from './schema.mjs';
import {normalisePortfolio,normaliseQuery,queryUrl,pageUrl,reportUrl,metadataUrl,contractUrl,decodeSource,
 fetchEchoResponse,normaliseBundle,importedResponse,text,fault,hashBytes,facilityIds} from './provider.mjs';
import {editionRows,summarizeEdition,facilityReport,compareEditions,exportEdition} from './domain.mjs';
import {prepareEchoDataset,queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,
 controlNativeRelease,inspectBuyer,receiveBuyer,readBuyerOutput} from './dataset.mjs';
import {exportWorkspace,validateWorkspaceBundle,receiveWorkspace,inspectReceivedWorkspace,readReceivedWorkspaceFile} from './portable.mjs';
const select=(list,id,label)=>{const v=list.find(x=>x.id===id);if(!v)throw fault('ECHO_SELECTION','Choose a saved '+label+'.',404);return v;};
const key=op=>hashBytes(Buffer.from(op)).slice(0,24),now=()=>new Date().toISOString();
function errorInfo(error){
 if(['ENOSPC','EDQUOT'].includes(error.code))return {code:'ECHO_STORAGE_FULL',message:'Workspace storage is full. The saved operation can continue after space is available.',status:507,retryable:true};
 if(/^(ECHO_|STELLAR_|DATASET_|SOCRATA_|SELLER_|RELEASE_)/.test(error.code??'')||error.code==='INVALID_DATASET_QUERY')
  return {code:error.code,message:error.message,status:error.status??400,retryable:error.retryable??(error.status===429||error.status>=500),retryAt:error.retryAt??null};
 if(error.name==='AbortError'||error.name==='TimeoutError')return {code:'ECHO_SOURCE_TIMEOUT',message:'The source request timed out; preceding complete responses remain saved.',status:504,retryable:true};
 if(error instanceof TypeError||error instanceof RangeError)return {code:'ECHO_INPUT',message:error.message,status:400,retryable:false};
 return {code:'ECHO_OPERATION_FAILED',message:'This operation could not complete. Review its saved record and continue the same operation.',status:503,retryable:true};
}
function dueDate(value){
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fault('ECHO_REVIEW_DATE','Use a valid YYYY-MM-DD review due date.');
 return value;
}
function reviewInput(p){
 if(!REVIEW_STATUSES.includes(p.status))throw fault('ECHO_REVIEW_STATUS','Choose an advertised review status.');
 if(p.facilityId!==undefined&&p.facilityId!==null&&p.facilityId!=='')facilityIds([p.facilityId]);
 return {subject:text(p.subject,'a review subject',300),note:text(p.note??'','a review note',12000,true),
  status:p.status,owner:text(p.owner??'','a review owner',300,true),dueDate:dueDate(p.dueDate),facilityId:p.facilityId||null};
}
export async function openEchoWorkspace({directory,inboxDirectory,releaseRuntime={port:0},
 userAgent='StellarForgeECHO/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)',fetchImpl=fetch}={}){
 text(userAgent,'an identifying User-Agent',512);
 const store=await openWorkspaceStore(directory,{schema:WORKSPACE_SCHEMA,initialState:{
  portfolios:[],searches:[],reviews:[],receivedWorkspaces:[],sourceCooldownUntil:null}}),
  running=new Map(),operations=new Map(),controllers=new Map(),publishers=nativePublishers(store);
 let closing=false,requestTail=Promise.resolve(),lastRequestAt=0;
 async function retainObject(bytes){
  if(bytes.length>256*1024*1024)throw fault('ECHO_OUTPUT_CAPACITY','This complete serialized file exceeds the original256 MiB retained-object capacity.',413);
  return store.putObject(bytes);
 }
 if(store.read().captures.some(c=>['RUNNING','QUEUED'].includes(c.state))||store.read().searches.some(s=>['RUNNING','QUEUED'].includes(s.state)))
  await store.mutate(s=>{for(const c of [...s.captures,...s.searches])if(['RUNNING','QUEUED'].includes(c.state))c.state='PAUSED';});
 const releaseCapability=()=>({mode:releaseRuntime.facilitator?'NATIVE_X402':'CHALLENGE_ONLY',
  facilitatorConfigured:Boolean(releaseRuntime.facilitator),port:releaseRuntime.port??0});
 const schema=()=>({...workspaceSchema({workspaceId:store.read().workspaceId,inboxConfigured:Boolean(inboxDirectory),userAgent}),releaseRuntime:releaseCapability()});
 function captureCoverage(c){
  const reports=c.tasks.filter(t=>t.kind==='facility-report'),captured=reports.filter(t=>t.state==='COMPLETE').map(t=>t.facilityId);
  return {selectedFacilityCount:c.selection.facilityIds.length,capturedFullReports:captured.length,
   selectedFacilityIds:c.selection.facilityIds,capturedFacilityIds:captured,
   missingFacilityIds:c.selection.facilityIds.filter(id=>!captured.includes(id)),
   sourceResponses:c.pages.length,sourceTasks:c.tasks.length,
   tasks:c.tasks.map(t=>({kind:t.kind,facilityId:t.facilityId??null,state:t.state,records:t.records??0,error:t.error??null})),
   complete:c.tasks.length>0&&c.tasks.every(t=>t.state==='COMPLETE')};
 }
 function searchCoverage(s){
  return {queryRows:s.queryRows,received:s.facilityIds.length,complete:s.state==='COMPLETE',
   queryId:s.queryId,sourcePages:s.pages.length,message:s.message??null,
   reason:s.termination??null};
 }
 function searchView(s){
  const {pages,facilityIds:ids,failedResponses,...meta}=s;
  return {...meta,pageReceipts:pages,pageCount:pages.length,facilityCount:ids.length,coverage:searchCoverage(s),failedResponses:failedResponses??[]};
 }
 async function editions({offset=0,limit=100,portfolioId}={}){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw fault('ECHO_EDITION_RANGE','Choose a nonnegative offset and one to500 editions.');
  const all=[];for(const id of store.read().editionIds.slice().reverse()){
   const e=await store.edition(id);if(!portfolioId||e.portfolio.id===portfolioId)all.push(e);
  }
  return {editions:all.slice(offset,offset+limit).map(({pages,...e})=>e),total:all.length,offset,limit};
 }
 async function view(){
  const s=store.read(),recent=(await editions({limit:100})).editions,releases=[];
  for(const release of s.releases){
   try{const publisher=await publishers.state(release);releases.push({...release,publisher,selection:publisher.releases.state});}
   catch(error){releases.push({...release,publisherError:errorInfo(error)});}
  }
  return {schema:'stellar-forge.epa-echo-workspace-view.v1',workspaceId:s.workspaceId,revision:s.revision,
   portfolios:s.portfolios,searches:s.searches.slice().reverse().map(searchView),
   captures:s.captures.slice().reverse().map(({pages,...c})=>({...c,pageCount:pages.length,pageReceipts:pages,coverage:captureCoverage({...c,pages})})),
   editions:recent,editionCount:s.editionIds.length,selectedEditionId:s.selectedEditionId,
   selectedEdition:s.selectedEditionId?await store.edition(s.selectedEditionId):null,
   reviews:s.reviews,datasets:s.datasets,releases,receipts:s.receipts,exports:s.exports,receivedWorkspaces:s.receivedWorkspaces,
   operations:Object.values(s.operations).slice(-100).reverse().map(({payload,context,materializedResult,...o})=>o),
   capabilities:{inboxConfigured:Boolean(inboxDirectory),releaseRuntime:releaseCapability(),sourceCooldownUntil:s.sourceCooldownUntil??null}};
 }
 async function queueSourceRequest(task,controller){
  const prior=requestTail;let release;requestTail=new Promise(done=>{release=done;});
  try{
   await prior;
   if(closing||controller.signal.aborted)throw new DOMException('Source operation paused','AbortError');
   const cooldown=store.read().sourceCooldownUntil;
   if(cooldown&&Date.parse(cooldown)>Date.now())throw fault('ECHO_SOURCE_RATE_LIMIT','Continue this source operation after the provider’s recorded retry time.',429,{retryAt:cooldown,retryable:true});
   const delay=Math.max(0,lastRequestAt+200-Date.now());if(delay)await new Promise(done=>setTimeout(done,delay));
   if(closing||controller.signal.aborted)throw new DOMException('Source operation paused','AbortError');
   lastRequestAt=Date.now();
   const source=await fetchEchoResponse(task,{fetchImpl,signal:controller.signal,userAgent});
   if(source.error?.retryAt)await store.mutate(s=>{s.sourceCooldownUntil=source.error.retryAt;});
   return source;
  }finally{release();}
 }
 async function retainedResponse(journalId,task,controller,bundle=null){
  const checkpoint=await store.response(journalId,task.url);
  let source;
  if(checkpoint?.parseState==='ACCEPTED')source={body:await store.object(checkpoint.sha256),
   wire:await store.object(checkpoint.responseSha256??checkpoint.sha256),receipt:checkpoint,error:null};
  else source=bundle?importedResponse(bundle,task):await queueSourceRequest(task,controller);
  if(closing||controller.signal.aborted)throw new DOMException('Source operation paused','AbortError');
  await retainObject(source.body);if(source.wire!==source.body)await retainObject(source.wire);
  await store.saveResponse(journalId,task.url,source.receipt);
  if(source.error)throw Object.assign(new Error(source.error.message),source.error,{sourceReceipt:source.receipt});
  let decoded;
  try{decoded=decodeSource(source.body,task.kind,{facilityId:task.facilityId});}
  catch(error){throw Object.assign(error,{sourceReceipt:source.receipt});}
  return {source,decoded,receipt:{...source.receipt,parseState:'ACCEPTED',kind:task.kind,facilityId:task.facilityId??null,records:decoded.records}};
 }
 async function searchRows(searchId,{offset=0,limit=100}={}){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>250000)
   throw fault('ECHO_SEARCH_RANGE','Choose a nonnegative row offset and one to250000 rows.');
  const s=select(store.read().searches,searchId,'search'),rows=[],columns=new Set(['facilityId']);let total=0;
  for(const page of s.pages){
   const decoded=decodeSource(await store.object(page.sha256),'search');
   for(const original of decoded.rows){
    for(const name of Object.keys(original))columns.add(name);
    if(total>=offset&&rows.length<limit)rows.push({facilityId:original.RegistryID,...original});total++;
   }
  }
  if(total!==s.facilityIds.length)throw fault('ECHO_SOURCE_CHANGED','The retained search rows differ from the saved original FRS coverage.',409);
  return {schema:'stellar-forge.epa-echo-search-results.v1',search:searchView(s),columns:[...columns],rows,total,offset,limit};
 }
 async function searchLoop(id){
  const controller=new AbortController();controllers.set('search:'+id,controller);let attemptedReceipt=null;
  try{
   await store.mutate(s=>{const current=select(s.searches,id,'search');current.state='RUNNING';current.error=null;});
   while(!closing&&!controller.signal.aborted){
    const s=select(store.read().searches,id,'search');if(s.state==='COMPLETE')break;
    const requestedPage=s.nextPage,url=s.queryId?pageUrl(s.queryId,requestedPage):queryUrl(s.query),
     task={kind:'search',url},result=await retainedResponse(s.journalId,task,controller),d=result.decoded;
    attemptedReceipt=result.receipt;
    if(s.queryId&&d.queryId!==null&&d.queryId!==s.queryId)throw fault('ECHO_SOURCE_PAGING','The facility page changed the retained query identifier.',502);
    if(s.queryRows!==null&&d.queryRows!==s.queryRows)throw fault('ECHO_SOURCE_PAGING','The original QueryRows changed within the retained query.',502);
    if(s.queryId&&d.pageNo!==null&&d.pageNo!==requestedPage)throw fault('ECHO_SOURCE_PAGING','The provider returned a different original page number.',502);
    if(!s.queryId&&d.queryRows>0&&!d.queryId)throw fault('ECHO_SOURCE_PAGING','The original search returned no query identifier.',502);
    if(d.facilityIds.some(fid=>s.facilityIds.includes(fid)))throw fault('ECHO_SOURCE_PAGING','The original query repeated a facility across pages.',502);
    const received=s.facilityIds.length+d.facilityIds.length;
    if(received>d.queryRows||s.queryId&&d.rows.length===0&&received<d.queryRows)
     throw fault('ECHO_SOURCE_PAGING','The original query page does not close its stated facility coverage.',502);
    if(s.byteCount+result.receipt.bytes>256*1024*1024)throw fault('ECHO_SEARCH_CAPACITY','The complete source search exceeds256 MiB; its original query and completed pages remain retained.',413);
    await store.saveResponse(s.journalId,url,result.receipt);
    await store.mutate(state=>{
     const current=select(state.searches,id,'search');
     if(current.pages.some(p=>p.url===url))return;
     current.pages.push({...result.receipt,queryId:d.queryId??current.queryId,pageNo:current.queryId?requestedPage:d.pageNo,
      queryRows:d.queryRows,message:d.message});
     current.byteCount+=result.receipt.bytes;current.facilityIds.push(...d.facilityIds);current.queryRows=d.queryRows;
     current.queryId=d.queryId??current.queryId;current.message=d.message;current.updatedAt=now();current.error=null;current.retryAt=null;
     current.nextPage=current.pages.length===1?(d.rows.length?2:1):requestedPage+1;
     if(current.facilityIds.length===current.queryRows){current.state='COMPLETE';current.completedAt=current.updatedAt;current.termination='Complete original QueryRows and unique FRS coverage';}
    });
   }
   if(closing||controller.signal.aborted)await store.mutate(s=>{const current=select(s.searches,id,'search');if(current.state!=='COMPLETE')current.state='PAUSED';});
  }catch(error){
   const info=errorInfo(error);if(!error.sourceReceipt&&attemptedReceipt)error.sourceReceipt=attemptedReceipt;
   await store.mutate(s=>{const current=select(s.searches,id,'search');current.state=closing||controller.signal.aborted?'PAUSED':'PARTIAL';
    current.error=info;current.retryAt=info.retryAt??null;current.updatedAt=now();
    if(error.sourceReceipt&&!current.failedResponses.some(p=>p.url===error.sourceReceipt.url&&p.sha256===error.sourceReceipt.sha256))current.failedResponses.push(error.sourceReceipt);
   }).catch(()=>{});
  }finally{controllers.delete('search:'+id);}
 }
 function launchSearch(id){
  const runKey='search:'+id;if(running.has(runKey)||closing)return;
  const s=select(store.read().searches,id,'search');if(s.imported||s.state==='COMPLETE'||s.error&&!s.error.retryable||s.retryAt&&Date.parse(s.retryAt)>Date.now())return;
  const task=searchLoop(id);running.set(runKey,task);void task.finally(()=>running.delete(runKey)).catch(()=>{});
 }
 async function importedSearches(c){
  if(!c.sourcePackageSha256)return [];
  const groups=new Map();
  for(const page of c.pages.filter(p=>p.kind==='search')){
   const decoded=decodeSource(await store.object(page.sha256),'search'),url=new URL(page.url),
    queryId=decoded.queryId??url.searchParams.get('qid'),groupKey=queryId??'empty-'+page.sha256;
   let group=groups.get(groupKey);
   if(!group){
    group={id:'search-import-'+hashBytes(Buffer.from(c.id+'|'+groupKey)).slice(0,24),journalId:c.id,
     originalOperationId:null,sourceCaptureId:c.id,imported:true,label:c.label+' — original source search',query:{},
     queryId,queryRows:decoded.queryRows,nextPage:null,pages:[],facilityIds:[],byteCount:0,failedResponses:[],
     error:null,retryAt:null,createdAt:c.createdAt,updatedAt:c.updatedAt??c.createdAt,message:decoded.message,state:'PARTIAL'};
    groups.set(groupKey,group);
   }
   if(group.queryRows!==decoded.queryRows)throw fault('ECHO_IMPORT_SEARCH','A retained source query changed QueryRows within its imported responses.',409);
   if(url.pathname.endsWith('get_facilities')){
    group.sourceQueryUrl=page.url;
    group.query=Object.fromEntries([...url.searchParams].filter(([k])=>k!=='output').map(([k,v])=>[k,k==='responseset'&&/^\d+$/.test(v)?Number(v):v]));
   }
   if(decoded.facilityIds.some(id=>group.facilityIds.includes(id)))throw fault('ECHO_IMPORT_SEARCH','The source package repeats a facility within one original query; inspect its retained pages.',409);
   group.pages.push(page);group.facilityIds.push(...decoded.facilityIds);group.byteCount+=page.bytes;group.message=decoded.message;
  }
  for(const group of groups.values()){
   if(group.facilityIds.length>group.queryRows)throw fault('ECHO_IMPORT_SEARCH','The source package contains more unique facilities than its original QueryRows.',409);
   group.state=group.facilityIds.length===group.queryRows?'COMPLETE':'PARTIAL';
   if(group.state==='COMPLETE'){group.completedAt=c.completedAt??c.updatedAt??c.createdAt;group.termination='Complete original imported QueryRows and unique FRS coverage';}
  }
  return [...groups.values()];
 }
 async function sealCapture(id,{selectEdition=true}={}){
  const c=select(store.read().captures,id,'capture');if(!c.pages.length)return null;
  const coverage=captureCoverage(c),identity={schema:'stellar-forge.epa-echo-edition.v1',workspaceId:store.read().workspaceId,
   captureId:c.id,portfolio:c.portfolio,selection:c.selection,coverage,pages:c.pages,sourcePackageSha256:c.sourcePackageSha256??null,complete:coverage.complete};
  const editionId=hashBytes(Buffer.from(stable(identity)));let edition;
  try{
   edition=await store.edition(editionId);
   if(edition.id!==editionId||stable(Object.fromEntries(Object.keys(identity).map(k=>[k,edition[k]])))!==stable(identity))
    throw fault('ECHO_EDITION_CHANGED','The retained edition differs from its original source identity.',409);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(!edition){
   edition={...identity,id:editionId,label:c.label,createdAt:c.completedAt??c.updatedAt??c.createdAt,
    sourceContract:SOURCE_CONTRACT,sourceMetadata:c.sourceMetadata??null,pageCount:c.pages.length,byteCount:c.byteCount,
    sourceSha256:hashBytes(Buffer.from(stable(c.pages.map(p=>({kind:p.kind,facilityId:p.facilityId,url:p.url,sha256:p.sha256,bytes:p.bytes}))))) };
   const described=await summarizeEdition(store,edition);
   edition.summary=described.summary;edition.facilitySummaries=described.facilitySummaries;await store.saveEdition(edition);
  }
  const searches=await importedSearches(c);
  await store.mutate(s=>{
   for(const search of searches){
    const index=s.searches.findIndex(x=>x.id===search.id);
    if(index<0)s.searches.push(search);else if(stable(s.searches[index])!==stable(search))s.searches[index]=search;
   }
   const current=select(s.captures,id,'capture'),previousEditionId=current.editionId;current.editionId=editionId;
   if(!s.editionIds.includes(editionId))s.editionIds.push(editionId);
   if(selectEdition||!s.selectedEditionId||s.selectedEditionId===previousEditionId&&previousEditionId!==editionId)s.selectedEditionId=editionId;
   if(current.importedReviews?.length&&!current.reviewsImported){
    for(const original of current.importedReviews){
     const input=reviewInput(original);
     if(input.facilityId&&!c.selection.facilityIds.includes(input.facilityId))throw fault('ECHO_IMPORT_REVIEW_SELECTION','An original review refers to a facility outside this source package.');
     const reviewId='review-import-'+hashBytes(Buffer.from(stable({editionId,original}))).slice(0,24);
     if(!s.reviews.some(r=>r.id===reviewId))s.reviews.push({id:reviewId,portfolioId:c.portfolio.id,editionId,...input,
      createdAt:original.createdAt??c.createdAt,updatedAt:original.updatedAt??c.createdAt,history:original.history??[],
      importedFrom:{sourceReviewId:original.id??null,sourceEditionId:original.editionId??null,sourcePortfolioId:original.portfolioId??null}});
    }
    current.reviewsImported=true;
   }
  });return edition;
 }
 async function captureLoop(id){
  const controller=new AbortController();controllers.set('capture:'+id,controller);
  try{
   await store.mutate(s=>{const c=select(s.captures,id,'capture');c.state='RUNNING';c.pauseRequested=false;c.error=null;});
   const original=select(store.read().captures,id,'capture'),
    bundle=original.sourcePackageSha256?normaliseBundle(JSON.parse((await store.object(original.sourcePackageSha256)).toString('utf8'))):null;
   while(!closing&&!controller.signal.aborted){
    const c=select(store.read().captures,id,'capture'),task=c.tasks.find(t=>t.state==='PENDING');
    if(!task)break;
    try{
     const {decoded,receipt}=await retainedResponse(c.id,task,controller,bundle);
     if(c.byteCount+receipt.bytes>256*1024*1024)throw fault('ECHO_CAPTURE_CAPACITY','The retained capture exceeds256 MiB; complete original responses remain available.',413);
     await store.saveResponse(c.id,task.url,receipt);
     await store.mutate(s=>{
      const current=select(s.captures,id,'capture'),t=select(current.tasks,task.id,'source task');
      if(t.state==='COMPLETE')return;
      current.pages.push({...receipt,taskId:task.id,sourceIndex:task.sourceIndex??null});
      current.byteCount+=receipt.bytes;current.updatedAt=now();
      t.state='COMPLETE';t.records=decoded.records;t.pages=[{url:receipt.url,sha256:receipt.sha256,records:decoded.records}];t.error=null;t.retryAt=null;
     });
    }catch(error){
     if(controller.signal.aborted||closing)break;
     const info=errorInfo(error);
     await store.mutate(s=>{
      const current=select(s.captures,id,'capture'),t=select(current.tasks,task.id,'source task');
      t.state='FAILED';t.error=info;t.retryAt=info.retryAt??null;t.attempts=(t.attempts??0)+1;current.error=info;current.updatedAt=now();
      if(error.sourceReceipt&&!current.failedResponses.some(p=>p.url===error.sourceReceipt.url&&p.sha256===error.sourceReceipt.sha256))
       current.failedResponses.push(error.sourceReceipt);
     });
    }
   }
   await store.mutate(s=>{
    const c=select(s.captures,id,'capture'),complete=captureCoverage(c).complete;
    c.state=complete?'COMPLETE':closing||controller.signal.aborted?'PAUSED':'PARTIAL';c.updatedAt=now();if(complete)c.completedAt=c.updatedAt;
    const retry=c.tasks.map(t=>t.retryAt).filter(Boolean).sort();c.retryAt=retry[0]??null;
   });
   await sealCapture(id);
  }catch(error){
   const info=errorInfo(error);await store.mutate(s=>{const c=select(s.captures,id,'capture');c.state='PAUSED';c.error=info;c.updatedAt=now();}).catch(()=>{});
  }finally{controllers.delete('capture:'+id);}
 }
 function launchCapture(id){
  const runKey='capture:'+id;if(running.has(runKey)||closing)return;
  if(select(store.read().captures,id,'capture').state==='COMPLETE')return;
  const task=captureLoop(id);running.set(runKey,task);void task.finally(()=>running.delete(runKey)).catch(()=>{});
 }
 async function reserve(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['action','payload','operationId','expectedRevision'].includes(k)))
   throw fault('ECHO_ACTION','Use action, payload, operationId and expectedRevision.');
  const {action,payload,operationId,expectedRevision}=request;
  if(!Object.hasOwn(ACTIONS,action)||!payload||typeof payload!=='object'||Array.isArray(payload)||
   Object.keys(payload).some(k=>!ACTIONS[action].includes(k)))throw fault('ECHO_ACTION','Choose an advertised action and its named fields.');
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId))throw fault('ECHO_OPERATION_ID','Supply a stable operationId.');
  const requestSha256=hashBytes(Buffer.from(stable({action,payload}))),prior=store.read().operations[operationId];
  if(prior){
   if(prior.requestSha256!==requestSha256)throw fault('ECHO_OPERATION_CONFLICT','This operationId belongs to another action or payload.',409);
   return {...prior,reused:true};
  }
  let imported=null,packageObject=null,workingSnapshot=null;
  if(action==='capture.import'){
   imported=normaliseBundle(payload.bundle);
   for(const review of imported.reviews){
    const input=reviewInput(review);if(input.facilityId&&!imported.selection.facilityIds.includes(input.facilityId))
     throw fault('ECHO_IMPORT_REVIEW_SELECTION','An original review refers to a facility outside this source package.');
    if(review.history!==undefined&&!Array.isArray(review.history))throw fault('ECHO_IMPORT_REVIEWS','Original review history must be an array.');
   }
   packageObject=await retainObject(jsonBytes(payload.bundle));
  }
  if(action==='workspace.receive'){validateWorkspaceBundle(payload.bundle);packageObject=await retainObject(jsonBytes(payload.bundle));}
  if(action==='workspace.export')workingSnapshot=await retainObject(jsonBytes(store.read()));
  let operation;
  await store.mutate(s=>{
   const current=s.operations[operationId];
   if(current){
    if(current.requestSha256!==requestSha256)throw fault('ECHO_OPERATION_CONFLICT','This operationId belongs to another action or payload.',409);
    operation={...current,reused:true};return;
   }
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==s.revision)
    throw fault('ECHO_REVISION_CHANGED','The workspace changed. Review the current saved view and keep your pending form.',409,{currentRevision:s.revision});
   operation={operationId,action,payload:structuredClone(payload),requestSha256,expectedRevision,
    state:'RUNNING',createdAt:now(),attempts:1,error:null};
   if(['capture.start','capture.import'].includes(action)){
    const portfolio=select(s.portfolios,payload.portfolioId,'portfolio');
    if(!portfolio.active)throw fault('ECHO_PORTFOLIO_ARCHIVED','Reopen this saved portfolio before collecting an edition.',409);
    const active=s.captures.find(c=>c.portfolio.id===portfolio.id&&['RUNNING','QUEUED'].includes(c.state));
    if(active)throw fault('ECHO_CAPTURE_ACTIVE','This portfolio already has an active source capture. Open that saved capture.',409);
    operation.context={portfolio:structuredClone(portfolio),selection:{facilityIds:[...portfolio.facilityIds]}};
    if(action==='capture.import'){
     if(stable(portfolio.facilityIds)!==stable(imported.selection.facilityIds))throw fault('ECHO_IMPORT_SELECTION','The source package belongs to another ordered FRS selection.',409);
     operation.payload={portfolioId:payload.portfolioId,label:payload.label??imported.label};
     Object.assign(operation.context,{sourcePackageSha256:packageObject.sha256,sourceMetadata:imported.sourceMetadata,
      importedReviews:imported.reviews,tasks:imported.responses.map((r,i)=>({id:'source-'+String(i).padStart(5,'0'),kind:r.kind,
       facilityId:r.facilityId??null,url:r.url,sourceIndex:r.index,state:'PENDING',pages:[],records:0}))});
    }
   }
   if(action==='facility.search')operation.context={query:normaliseQuery(payload.query)};
   if(action==='export.create')operation.context={reviews:structuredClone(s.reviews.filter(r=>r.editionId===payload.editionId))};
   if(action==='release.prepare')operation.context={releaseRuntime:structuredClone(releaseRuntime)};
   if(action.startsWith('buyer.'))operation.context={inboxDirectory:inboxDirectory??null};
   if(action==='workspace.export')operation.context={snapshotSha256:workingSnapshot.sha256};
   if(action==='workspace.receive'){operation.payload={};operation.context={packageSha256:packageObject.sha256};}
   s.operations[operationId]=operation;
  });return operation;
 }
 async function commitLocal(op,fn){
  let result;await store.mutate(s=>{
   const saved=s.operations[op.operationId];
   if(Object.hasOwn(saved,'materializedResult')){result=structuredClone(saved.materializedResult);return;}
   result=fn(s);saved.materializedResult=structuredClone(result);
  });return result;
 }
 async function saveMaterialized(op,result){
  await store.mutate(s=>{const saved=s.operations[op.operationId];if(!Object.hasOwn(saved,'materializedResult'))saved.materializedResult=structuredClone(result);});
  return result;
 }
 async function execute(op){
  const p=op.payload,id=key(op.operationId);let result,launchId=null,searchId=null;
  if(Object.hasOwn(op,'materializedResult')){
   result=structuredClone(op.materializedResult);
   if(['capture.start','capture.import','capture.resume'].includes(op.action))launchId=result.captureId;
   if(op.action==='facility.search')searchId=result.searchId;
  }else switch(op.action){
   case 'portfolio.save':{
    const input=normalisePortfolio(p);
    result=await commitLocal(op,s=>{
     const prior=p.portfolioId?select(s.portfolios,p.portfolioId,'portfolio'):null,portfolioId=prior?.id??'portfolio-'+id;
     const next={id:portfolioId,...input,createdAt:prior?.createdAt??op.createdAt,updatedAt:op.createdAt,
      history:prior?[...(prior.history??[]),{...Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='history')),operationId:op.operationId}]:[]};
     s.portfolios=s.portfolios.filter(x=>x.id!==portfolioId);s.portfolios.push(next);return next;
    });break;
   }
   case 'portfolio.archive':result=await commitLocal(op,s=>{
    const portfolio=select(s.portfolios,p.portfolioId,'portfolio');
    if(portfolio.active){portfolio.history.push({...Object.fromEntries(Object.entries(portfolio).filter(([k])=>k!=='history')),operationId:op.operationId});portfolio.active=false;portfolio.updatedAt=op.createdAt;}
    return {portfolioId:portfolio.id,active:false};});break;
   case 'facility.search':{
    searchId='search-'+id;result=await commitLocal(op,s=>{
     if(!s.searches.some(x=>x.id===searchId))s.searches.push({id:searchId,journalId:id,originalOperationId:op.operationId,
      label:text(p.label??'EPA facility search','a search label'),query:op.context.query,state:'QUEUED',queryId:null,queryRows:null,
      nextPage:1,pages:[],facilityIds:[],byteCount:0,failedResponses:[],error:null,retryAt:null,createdAt:op.createdAt,updatedAt:op.createdAt});
     return {searchId,state:select(s.searches,searchId,'search').state};
    });break;
   }
   case 'capture.start':
   case 'capture.import':{
    result=await commitLocal(op,s=>{
     if(!s.captures.some(c=>c.id===id)){
      const tasks=op.context.tasks??[
       {id:'metadata',kind:'source-metadata',url:metadataUrl(),state:'PENDING',pages:[],records:0},
       {id:'contract',kind:'service-contract',url:contractUrl(),state:'PENDING',pages:[],records:0},
       ...op.context.selection.facilityIds.map(facilityId=>({id:'facility-'+facilityId,kind:'facility-report',facilityId,
        url:reportUrl(facilityId),state:'PENDING',pages:[],records:0}))];
      s.captures.push({id,label:text(p.label??op.context.portfolio.label,'a capture label'),portfolio:op.context.portfolio,
       selection:op.context.selection,createdAt:op.createdAt,updatedAt:op.createdAt,state:'QUEUED',tasks,pages:[],byteCount:0,failedResponses:[],
       sourcePackageSha256:op.context.sourcePackageSha256??null,sourceMetadata:op.context.sourceMetadata??null,
       importedReviews:op.context.importedReviews??[],editionId:null,error:null,retryAt:null,pauseRequested:false});
     }
     return {captureId:id,state:select(s.captures,id,'capture').state,source:op.action==='capture.import'?'RETAINED_SOURCE_PACKAGE':'EPA_ECHO_HTTPS'};
    });launchId=id;break;
   }
   case 'capture.resume':{
    const currentCapture=select(store.read().captures,p.captureId,'capture');
    if(currentCapture.pages.length)await sealCapture(currentCapture.id,{selectEdition:false});
    result=await commitLocal(op,s=>{
     const c=select(s.captures,p.captureId,'capture');
     if(c.state==='COMPLETE')return {captureId:c.id,state:c.state,editionId:c.editionId};
     const future=c.tasks.filter(t=>t.state==='FAILED'&&t.retryAt&&Date.parse(t.retryAt)>Date.now());
     const eligible=c.tasks.some(t=>t.state==='PENDING'||t.state==='FAILED'&&(!t.retryAt||Date.parse(t.retryAt)<=Date.now()));
     if(!eligible&&future.length)throw fault('ECHO_SOURCE_RATE_LIMIT','Continue this capture after its original provider retry time.',429,
      {retryAt:future.map(t=>t.retryAt).sort()[0],retryable:true});
     for(const t of c.tasks)if(t.state==='FAILED'&&(!t.retryAt||Date.parse(t.retryAt)<=Date.now())){t.state='PENDING';t.error=null;t.retryAt=null;}
     c.pauseRequested=false;c.state='QUEUED';c.updatedAt=op.createdAt;return {captureId:c.id,state:c.state};
    });if(result.state!=='COMPLETE')launchId=p.captureId;break;
   }
   case 'capture.pause':{
    const c=select(store.read().captures,p.captureId,'capture');controllers.get('capture:'+c.id)?.abort();
    result=await commitLocal(op,s=>{
     const current=select(s.captures,c.id,'capture');current.pauseRequested=true;
     if(current.state!=='COMPLETE')current.state=running.has('capture:'+c.id)?'PAUSING':'PAUSED';
     return {captureId:c.id,state:current.state};
    });break;
   }
   case 'edition.select':{
    const edition=await store.edition(p.editionId);
    result=await commitLocal(op,s=>{
     if(!s.editionIds.includes(edition.id))throw fault('ECHO_EDITION_ID','Choose a saved source edition.',404);
     s.selectedEditionId=edition.id;return {editionId:edition.id};
    });break;
   }
   case 'edition.compare':{
    const full=await compareEditions(store,await store.edition(p.leftId),await store.edition(p.rightId),p.table),
     saved=await retainObject(jsonBytes(full)),item={id:'comparison-'+id,kind:'comparison',editionId:p.rightId,table:p.table,format:'json',
      name:'epa-echo-comparison-'+id+'.json',type:'application/json; charset=utf-8',...saved,createdAt:op.createdAt,
      downloadUrl:'/api/exports/comparison-'+id};
    result={...full,added:full.added.slice(0,200),removed:full.removed.slice(0,200),changed:full.changed.slice(0,200),export:item};
    await commitLocal(op,s=>{if(!s.exports.some(x=>x.id===item.id))s.exports.push(item);return result;});break;
   }
   case 'review.save':{
    const edition=await store.edition(p.editionId),input=reviewInput(p);
    if(edition.portfolio.id!==p.portfolioId||input.facilityId&&!edition.selection.facilityIds.includes(input.facilityId))
     throw fault('ECHO_REVIEW_SELECTION','Attach this review to its saved portfolio, source edition and selected facility.');
    result=await commitLocal(op,s=>{
     select(s.portfolios,p.portfolioId,'portfolio');
     const prior=p.reviewId?select(s.reviews,p.reviewId,'review'):null,reviewId=prior?.id??'review-'+id;
     if(prior&&(prior.portfolioId!==p.portfolioId||prior.editionId!==p.editionId||prior.facilityId!==input.facilityId))
      throw fault('ECHO_REVIEW_SELECTION','A saved review keeps its original portfolio, edition and facility. Add a separate review for another source selection.',409);
     const review={id:reviewId,portfolioId:p.portfolioId,editionId:p.editionId,...input,createdAt:prior?.createdAt??op.createdAt,
      updatedAt:op.createdAt,history:prior?[...(prior.history??[]),{...Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='history')),operationId:op.operationId}]:[]};
     s.reviews=s.reviews.filter(r=>r.id!==reviewId);s.reviews.push(review);return review;
    });break;
   }
   case 'dataset.prepare':{
    result=await prepareEchoDataset(store,{edition:await store.edition(p.editionId),table:p.table,name:p.name,id:'dataset-'+id});
    await commitLocal(op,s=>{if(!s.datasets.some(d=>d.id===result.id))s.datasets.push(result);return result;});break;
   }
   case 'dataset.query':result=await queryNativeDataset(store,select(store.read().datasets,p.datasetId,'dataset'),p.query);break;
   case 'release.prepare':{
    result=await prepareNativeRelease(store,{dataset:select(store.read().datasets,p.datasetId,'dataset'),origin:p.origin,path:p.path??'/facilities',
     payment:p.payment,id:'echo-'+id,runtime:op.context?.releaseRuntime??releaseRuntime,publishers});
    await commitLocal(op,s=>{if(!s.releases.some(r=>r.id===result.id))s.releases.push(result);return result;});break;
   }
   case 'release.inspect':result=await inspectNativeRelease(store,select(store.read().releases,p.releaseId,'release'),publishers);break;
   case 'release.activate':
   case 'release.start':
   case 'release.stop':
   case 'release.rollback':result=await controlNativeRelease(store,select(store.read().releases,p.releaseId,'release'),op.action.split('.')[1],p,publishers);break;
   case 'buyer.inspect':result=await inspectBuyer(op.context?.inboxDirectory??inboxDirectory,p.intentIds);break;
   case 'buyer.receive':{
    result=await receiveBuyer(store,op.context?.inboxDirectory??inboxDirectory,p.intentIds,'buyer-'+id);
    await commitLocal(op,s=>{if(!s.receipts.some(r=>r.id===result.id))s.receipts.push(result);return result;});break;
   }
   case 'export.create':{
    const edition=await store.edition(p.editionId),output=await exportEdition(store,edition,op.context?.reviews??[],p.table??'facilities',p.format),
     saved=await retainObject(output.bytes);
    result={id:'export-'+id,kind:'edition',editionId:edition.id,table:p.table??'facilities',format:p.format,
     name:'epa-echo-'+edition.portfolio.id+'-'+edition.id.slice(0,12)+'.'+output.extension,type:output.type,...saved,
     createdAt:op.createdAt,note:output.note??null,downloadUrl:'/api/exports/export-'+id};
    await commitLocal(op,s=>{if(!s.exports.some(e=>e.id===result.id))s.exports.push(result);return result;});break;
   }
   case 'workspace.export':{
    const snapshot=JSON.parse((await store.object(op.context.snapshotSha256)).toString('utf8')),
     output=await exportWorkspace(store,{snapshot,createdAt:op.createdAt}),saved=await retainObject(output.bytes);
    result={id:'workspace-'+id,kind:'workspace',format:'workspace',name:'epa-echo-workspace-'+snapshot.workspaceId+'-r'+snapshot.revision+'.json',
     type:output.type,...saved,...output.manifest,createdAt:op.createdAt,downloadUrl:'/api/exports/workspace-'+id};
    await commitLocal(op,s=>{if(!s.exports.some(e=>e.id===result.id))s.exports.push(result);return result;});break;
   }
   case 'workspace.receive':{
    const bundle=JSON.parse((await store.object(op.context.packageSha256)).toString('utf8'));
    result=await receiveWorkspace(store,{bundle,id:'received-'+id,createdAt:op.createdAt});
    await commitLocal(op,s=>{if(!s.receivedWorkspaces.some(r=>r.id===result.id))s.receivedWorkspaces.push(result);return result;});break;
   }
   default:throw fault('ECHO_ACTION','Choose an advertised workspace action.');
  }
  await saveMaterialized(op,result);
  const saved=await retainObject(jsonBytes(result));
  await store.mutate(s=>{const current=s.operations[op.operationId];current.state='COMPLETE';current.resultSha256=saved.sha256;
   current.completedAt=now();current.error=null;});
  if(launchId&&!closing)launchCapture(launchId);if(searchId&&!closing)launchSearch(searchId);return result;
 }
 async function action(request){
  let op;
  try{
   op=await reserve(request);
   if(op.state==='COMPLETE'){
    const result=JSON.parse((await store.object(op.resultSha256)).toString('utf8'));
    if(op.action==='facility.search'&&result.searchId)launchSearch(result.searchId);
    if(['capture.start','capture.import','capture.resume'].includes(op.action)&&result.captureId){
     let c=select(store.read().captures,result.captureId,'capture');
     if(c.pages.length){await sealCapture(c.id,{selectEdition:false});c=select(store.read().captures,result.captureId,'capture');}
     if(c.state==='QUEUED'||c.state==='PAUSED'&&!c.pauseRequested)launchCapture(c.id);
    }
    return {operationId:op.operationId,reused:true,result,view:await view()};
   }
   if(op.state==='FAILED'&&!op.error?.retryable)throw Object.assign(new Error(op.error.message),op.error);
   if(op.error?.retryAt&&Date.parse(op.error.retryAt)>Date.now())throw Object.assign(new Error(op.error.message),op.error);
   if(operations.has(op.operationId)){
    const result=await operations.get(op.operationId);
    return {operationId:op.operationId,reused:true,result,view:await view()};
   }
   if(op.state==='FAILED')await store.mutate(s=>{const current=s.operations[op.operationId];current.state='RUNNING';current.attempts++;current.error=null;});
   const task=execute(op);operations.set(op.operationId,task);
   try{return {operationId:op.operationId,reused:Boolean(op.reused),result:await task,view:await view()};}
   finally{operations.delete(op.operationId);}
  }catch(error){
   const info=errorInfo(error);
   if(op)await store.mutate(s=>{const current=s.operations[op.operationId];
    if(current?.state!=='COMPLETE'){current.state='FAILED';current.error=info;current.failedAt=now();}}).catch(()=>{});
   throw Object.assign(new Error(info.message),info,{operationId:op?.operationId,currentRevision:store.read().revision});
  }
 }
 for(const c of store.read().captures)if(c.pages.length)await sealCapture(c.id,{selectEdition:false});
 return {schema,view,action,store,editions,search:searchRows,
  edition:async id=>{if(!store.read().editionIds.includes(id))throw fault('ECHO_EDITION_ID','Choose a saved source edition.',404);return store.edition(id);},
  rows:async(id,options)=>editionRows(store,await store.edition(id),options),
  async facility(id,facilityId){
   const edition=await store.edition(id);
   if(!edition.selection.facilityIds.includes(facilityId))throw fault('ECHO_FACILITY_SELECTION','Choose a facility from this source edition.',404);
   const detail=await facilityReport(store,edition,facilityId);
   return {schema:'stellar-forge.epa-echo-facility.v1',editionId:id,facilityId,...detail,
    reviews:store.read().reviews.filter(r=>r.editionId===id&&r.facilityId===facilityId)};
  },
  async raw(id,pageIndex,{wire=false}={}){
   const e=await store.edition(id);
   if(!Number.isSafeInteger(pageIndex)||pageIndex<0||pageIndex>=e.pages.length)throw fault('ECHO_SOURCE_PAGE','Choose a retained original source page.');
   const receipt=e.pages[pageIndex],sha=wire?receipt.responseSha256??receipt.sha256:receipt.sha256;
   return {bytes:await store.object(sha),receipt,type:'application/json; charset=utf-8'};
  },
  async exported(id){const item=select(store.read().exports,id,'export');return {item,bytes:await store.object(item.sha256)};},
  async received(id,name){return readBuyerOutput(store,select(store.read().receipts,id,'customer receipt'),name);},
  receivedWorkspace:id=>inspectReceivedWorkspace(store,id),
  receivedWorkspaceFile:(id,path)=>readReceivedWorkspaceFile(store,id,path),
  async waitForCaptures(){await Promise.allSettled([...running.values()]);return view();},
  async close(){
   if(closing)return;closing=true;for(const controller of controllers.values())controller.abort();
   await Promise.allSettled([...running.values(),...operations.values()]);
   try{await publishers.close();}finally{await store.close();}
  }
 };
}
