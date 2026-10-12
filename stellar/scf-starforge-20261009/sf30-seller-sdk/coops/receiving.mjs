// MIT. One connected operator journey in an existing original CO-OPS console.
// The caller owns the server, browser, admission record and private session URL.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const assert=(value,message)=>{if(!value)throw new Error(message);};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function within(promise,timeout,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeout);})]);}finally{clearTimeout(timer);}}
const redact=value=>String(value).replace(/(https?:\/\/[^\s"'<>#]+)#[A-Za-z0-9_-]+/g,'$1#[private-session]').slice(0,4000);
const DEFAULT_CAPTURE=Object.freeze({stationId:'9410230',beginDate:'2025-01-01',endDate:'2025-01-07',products:['water_level'],units:'metric',timeZone:'gmt',datum:'MLLW',predictionInterval:'6'});
const DEFAULT_HISTORY=Object.freeze({beginDate:'2024-01-01',endDate:'2025-12-31',products:['hourly_height'],units:'metric',timeZone:'gmt',datum:'MLLW',predictionInterval:'6'});
function regular(path,maximum=128*1024*1024){
 const info=fs.lstatSync(path);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=maximum,'Use the selected bounded regular file: '+path);return info;
}
async function identity(path){regular(path,1024*1024*1024);const digest=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(path)){bytes+=chunk.length;digest.update(chunk);}return{path,bytes,sha256:digest.digest('hex')};}
function atomic(path,bytes){
 if(fs.existsSync(path))regular(path);
 const temporary=path+'.tmp-'+randomUUID();let fd;
 try{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temporary,path);const parent=fs.openSync(resolve(path,'..'),fs.constants.O_RDONLY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
 finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function readJSON(path){regular(path);return JSON.parse(fs.readFileSync(path,'utf8'));}
function selectedURL(value){
 const url=new URL(value);assert(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search,'Use the original loopback console URL, with its private session only in the fragment.');
 assert(!url.hash||/^#[A-Za-z0-9_-]{43}$/.test(url.hash),'Use the exact original private session fragment.');return url;
}
function captureSelection(value){
 const selected={...DEFAULT_CAPTURE,...clone(value??{})};
 assert(/^[0-9]{7}$/.test(selected.stationId),'Select an original seven-digit NOAA station ID.');
 assert(/^\d{4}-\d{2}-\d{2}$/.test(selected.beginDate)&&/^\d{4}-\d{2}-\d{2}$/.test(selected.endDate)&&selected.beginDate<=selected.endDate,'Select explicit inclusive source dates.');
 assert(Array.isArray(selected.products)&&selected.products.length&&selected.products.every(p=>['water_level','hourly_height','predictions'].includes(p)),'Select native NOAA products.');
 assert(selected.units==='metric'&&selected.timeZone==='gmt'&&selected.datum==='MLLW','This receiving convention is explicitly metric/GMT/MLLW; select another reviewed journey for a different convention.');
 return selected;
}

/**
 * @param initialPage Existing Playwright Page in the caller's retained browser.
 * @param options workspaceUrl, outputDirectory, reviewEdition, restart are required.
 * reviewEdition receives exact packet/files and returns its actual independent decision. mappingFile defaults to the exact published example JSON.
 * restart receives a stable phaseKey and same-origin identity and returns
 * {workspaceUrl, page?}; it must reuse its original restart intent after interruption.
 * historical defaults to the declared two-year hourly study; pass null to omit it.
 */
export async function runCoopsOperatorJourney(initialPage,options={}){
 assert(initialPage&&typeof initialPage.goto==='function','Supply the existing native browser page.');
 assert(typeof options.outputDirectory==='string'&&options.outputDirectory,'Supply one retained operator output directory.');
 assert(typeof options.reviewEdition==='function','Supply the independent source-review callback; there is no default approval.');
 assert(typeof options.restart==='function','Supply the original same-origin restart callback.');
 let page=initialPage,sessionURL=selectedURL(options.workspaceUrl??page.url());
 const origin=sessionURL.origin,output=resolve(options.outputDirectory),checkpointPath=join(output,'coops-operator-checkpoint.json'),resultPath=join(output,'coops-operator-result.json');
 fs.mkdirSync(output,{recursive:true,mode:0o700});assert(fs.lstatSync(output).isDirectory()&&!fs.lstatSync(output).isSymbolicLink(),'Use the original physical operator output directory.');
 const selection=captureSelection(options.capture),historical=options.historical===null?null:{...DEFAULT_HISTORY,...clone(options.historical??{})};
 const mappingFile=resolve(options.mappingFile??fileURLToPath(new URL('./examples/model-input-columns.json',import.meta.url))),mappingFileIdentity=await identity(mappingFile);
 assert(mappingFileIdentity.bytes>0&&mappingFileIdentity.bytes<=65536,'Select the exact bounded original mapping example or declared input convention.');
 const selected={capture:selection,historical,mappingFile:mappingFileIdentity,role:'public_reference',operator:String(options.operator??'Internal coastal source receiving')};
 const selectedSha256=hash(stable(selected)),moduleIdentity=await identity(fileURLToPath(import.meta.url));
 let cp=fs.existsSync(checkpointPath)?readJSON(checkpointPath):{schema:'stellar-forge.coops-operator-checkpoint.v1',id:randomUUID(),origin,selected,selectedSha256,workspaceId:null,createdAt:new Date().toISOString(),status:'IN_PROGRESS',phases:{},issued:{},restarts:{},ids:{},artifacts:{},sourceHistory:[]};
 assert(cp.schema==='stellar-forge.coops-operator-checkpoint.v1'&&cp.origin===origin&&cp.selectedSha256===selectedSha256,'Reopen the same original operator selection, output and origin.');
 const persist=()=>atomic(checkpointPath,Buffer.from(JSON.stringify(cp,null,2)+'\n'));
 if(cp.status==='PASS'){
  assert(cp.result&&fs.existsSync(resultPath),'The completed original result file must remain retained.');const exact=await identity(resultPath);assert(exact.sha256===cp.result.sha256&&exact.bytes===cp.result.bytes,'The completed operator result changed.');return readJSON(resultPath);
 }
 if(!cp.sourceHistory.length||cp.sourceHistory.at(-1).sha256!==moduleIdentity.sha256){
  assert(!cp.sourceHistory.length||String(options.continuationNote??'').trim(),'Record a concrete fix-forward continuation note before changing an incomplete operator module.');
  cp.sourceHistory.push({...moduleIdentity,note:options.continuationNote??'Original selected operator source',at:new Date().toISOString()});persist();
 }
 const operationTimeout=Number(options.operationTimeoutMs??180000),captureTimeout=Number(options.captureTimeoutMs??1800000);
 const progress=async(message,extra={})=>{if(options.onProgress)await options.onProgress({operationId:cp.id,message,...extra});};
 async function waitUntil(read,label,timeout=operationTimeout){
  const end=Date.now()+timeout;let next=0;
  while(Date.now()<end){const value=await read();if(value)return value;if(Date.now()>next){next=Date.now()+15000;await progress(label);}await delay(500);}
  throw new Error(label+' did not complete. The original request and workspace remain retained.');
 }
 async function api(path){
  assert(path.startsWith('/api/'),'Use the existing read-only workspace API.');
  return page.evaluate(async path=>{const token=sessionStorage.getItem('coops-session')||'',response=await fetch(path,{headers:{Authorization:'Bearer '+token}});let value;try{value=await response.json();}catch{throw new Error('The original workspace read returned an incomplete response.');}if(!response.ok)throw new Error((value.code||value.error||response.status)+': '+(value.message||'Original workspace read failed.'));return value;},path);
 }
 async function browserState(){
  return page.evaluate(async key=>new Promise((resolve,reject)=>{const opened=indexedDB.open('coops-original-operations',1);opened.onerror=()=>reject(opened.error);opened.onsuccess=()=>{const db=opened.result;if(!db.objectStoreNames.contains('state')){db.close();resolve(null);return;}const tx=db.transaction('state','readonly'),request=tx.objectStore('state').get(key);let value;request.onsuccess=()=>value=request.result;tx.oncomplete=()=>{db.close();resolve(value??null);};tx.onerror=()=>{db.close();reject(tx.error);};};}),cp.workspaceId);
 }
 async function openSession(url){
  const selected=selectedURL(url);assert(selected.origin===origin,'Restart must reopen the same original browser origin.');
  const accept=async dialog=>{if(dialog.type()==='beforeunload')await dialog.accept();else await dialog.dismiss();};page.on('dialog',accept);
  try{await page.goto(selected.href,{waitUntil:'domcontentloaded'});}finally{page.off('dialog',accept);}
  await page.locator('#identity').filter({hasText:/Workspace .+ · revision/}).waitFor({timeout:operationTimeout});
  const schema=await api('/api/schema');assert(schema.workspaceId&&(!cp.workspaceId||schema.workspaceId===cp.workspaceId),'The original workspace UUID changed.');
  cp.workspaceId=schema.workspaceId;persist();sessionURL=selected;return schema;
 }
 async function closeDialog(){if(await page.locator('#dialog[open]').count())await page.locator('#close-dialog').click();}
 async function navigate(tab){await closeDialog();await page.locator('[data-tab="'+tab+'"]').click();await page.locator('[data-tab="'+tab+'"][aria-current="page"]').waitFor();}
 async function refreshVisible(){
  await closeDialog();const response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/view',{timeout:operationTimeout});await page.locator('#refresh').click();const observed=await (await response).json();assert(observed.workspaceId===cp.workspaceId,'The refreshed workspace changed.');await page.waitForFunction(revision=>Number(document.querySelector('#identity')?.textContent.match(/revision (\d+)/)?.[1])>=revision,observed.revision,{timeout:operationTimeout});
 }
 async function input(form,field,value){const control=page.locator('[data-form="'+form+'"][data-field="'+field+'"]');const tag=await control.evaluate(el=>el.tagName);if(tag==='SELECT')await control.selectOption(String(value));else await control.fill(String(value));}
 async function nativeOperation(entry){return api('/api/operation?operationId='+encodeURIComponent(entry.request.operationId));}
 function compactResponse(value,status=200){return{operationId:value.operationId,reused:value.reused===true,state:value.state??null,result:value.result??null,status};}
 async function settleIssued(key,{fresh=false}={}){
  const entry=cp.issued[key];assert(entry?.request,'The original UI request must remain retained for '+key);
  const record=await waitUntil(async()=>{const r=await nativeOperation(entry);if(r.state==='FAILED'||r.state==='NOT_RESERVED')throw new Error('Original '+entry.request.action+' is '+r.state+': '+(r.error?.message??'inspect the saved browser request before retrying'));return r.state==='COMPLETE'?r:null;},'Waiting for original '+entry.request.action);
  if(fresh)await waitUntil(async()=>{const p=(await browserState())?.pending;return !p||['uncertain','rejected','running'].includes(p.state);},'Completing the visible native reply');
  const journal=await browserState(),pending=journal?.pending;
  if(pending){
   assert(pending.request.operationId===entry.request.operationId&&stable(pending.request)===stable(entry.request),'A different original browser request is pending.');
   await closeDialog();
   const responsePromise=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/action'&&response.request().postDataJSON()?.operationId===entry.request.operationId,{timeout:operationTimeout});
   await page.locator('[data-cmd="retry"]').click();const response=await responsePromise,value=await response.json();
   assert(response.ok()&&value.operationId===entry.request.operationId&&value.reused===true,'Exact retry must return the original saved operation.');
   entry.replay=compactResponse(value,response.status());persist();
   await waitUntil(async()=>!(await browserState())?.pending,'Completing the original browser request journal');
  }
  entry.result=clone(record.result);entry.native={operationId:record.operationId,state:record.state,resultSha256:record.resultSha256??null,completedAt:record.completedAt??null};entry.state='COMPLETE';persist();return entry.result;
 }
 async function action(key,name,submit,{loseResponse=false,onCommitted}={}){
  let entry=cp.issued[key];
  if(entry?.request){
   if(loseResponse&&entry.lossInjected){const r=await nativeOperation(entry);assert(r.state==='COMPLETE','The original intentionally interrupted save must already be committed.');entry.result=clone(r.result);persist();return entry.result;}
   return settleIssued(key);
  }
  const pending=(await browserState())?.pending;assert(!pending,'Resolve the original retained request before a new operator action.');
  await refreshVisible();
  entry=cp.issued[key]={action:name,state:'PREPARED',createdAt:new Date().toISOString(),request:null};persist();
  let done,failed;const handled=new Promise((resolve,reject)=>{done=resolve;failed=reject;});handled.catch(()=>{});
  const routeHandler=async route=>{
   let response;
   try{
    const request=route.request(),body=request.postDataJSON();assert(request.method()==='POST'&&body.action===name,'The visible action differs from the selected native operation.');
    assert(body.operationId&&Number.isSafeInteger(body.expectedRevision),'The native UI did not retain an original action identity.');
    if(entry.request)assert(stable(entry.request)===stable(body),'Do not replace an accepted original request.');
    else{entry.request=clone(body);entry.state='ISSUED';persist();}
    response=await route.fetch({maxRetries:0,timeout:operationTimeout});const value=await response.json();
    entry.response=compactResponse(value,response.status());entry.state=response.ok()?'REPLIED':'REJECTED';persist();
    if(!response.ok()){await route.fulfill({response});throw new Error(value.message||value.error||'The original native action was rejected.');}
    assert(value.operationId===body.operationId&&value.view?.workspaceId===cp.workspaceId,'The native reply changed its operation/workspace identity.');
    if(loseResponse){
     assert(value.state!=='RUNNING'&&value.result,'The response-loss continuation requires an actually committed native result.');
     entry.lossInjected=true;entry.result=clone(value.result);persist();
     if(onCommitted)await onCommitted(value.result);
     await route.abort('failed');done(value);return;
    }
    await route.fulfill({response});done(value);
   }catch(error){try{await route.abort('failed');}catch{}failed(error);}
   finally{if(response)await response.dispose();}
  };
  await page.route('**/api/action',routeHandler);
  try{
   await submit();await within(handled,operationTimeout,'The original visible action did not return.');
  }finally{await page.unroute('**/api/action',routeHandler);}
  if(loseResponse){await waitUntil(async()=>{const p=(await browserState())?.pending;return p?.request.operationId===entry.request.operationId&&p.state==='uncertain';},'Retaining the actually lost save response');return entry.result;}
  return settleIssued(key,{fresh:true});
 }
 async function phase(name,work){
  if(cp.phases[name]?.status==='COMPLETE')return cp.phases[name].result;
  cp.currentPhase=name;cp.phases[name]??={status:'IN_PROGRESS',startedAt:new Date().toISOString()};persist();await progress(name);
  const result=await work();cp.phases[name]={...cp.phases[name],status:'COMPLETE',completedAt:new Date().toISOString(),result:clone(result??{})};persist();return result;
 }
 async function restart(key){
  if(cp.restarts[key]?.state==='REOPENED'){const current=await api('/api/schema');assert(current.workspaceId===cp.workspaceId,'The original reopened workspace changed.');return{workspaceUrl:sessionURL.href,page};}
  cp.restarts[key]??={phaseKey:cp.id+':'+key,state:'REQUESTED',workspaceId:cp.workspaceId,origin,requestedAt:new Date().toISOString()};persist();
  const receipt=await options.restart({phaseKey:cp.restarts[key].phaseKey,workspaceId:cp.workspaceId,baseURL:origin,page,checkpointPath,prior:clone(cp.restarts[key])});
  assert(receipt&&typeof receipt.workspaceUrl==='string','The original restart owner must return the actual current private session URL.');
  if(receipt.page)page=receipt.page;
  await openSession(receipt.workspaceUrl);cp.restarts[key]={...cp.restarts[key],state:'REOPENED',reopenedAt:new Date().toISOString()};persist();return receipt;
 }
 async function downloaded(key,click,name,expected){
  const path=join(output,name),prior=cp.artifacts[key];
  if(prior&&fs.existsSync(prior.path)){const current=await identity(prior.path);assert(current.sha256===prior.sha256&&current.bytes===prior.bytes,'A retained original download changed.');return prior;}
  const pending=page.waitForEvent('download',{timeout:operationTimeout});await click();const download=await pending;await download.saveAs(path);const failure=await download.failure();assert(!failure,'The native download failed: '+failure);
  const exact=await identity(path);if(expected)assert(exact.bytes===expected.bytes&&exact.sha256===expected.sha256,'Downloaded bytes differ from their original native receipt.');
  const result={...exact,suggestedFilename:download.suggestedFilename()};cp.artifacts[key]=result;persist();await download.delete();return result;
 }
 async function saveJSON(key,name,value){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),path=join(output,name),prior=cp.artifacts[key];
  if(prior){assert(prior.sha256===hash(bytes),'The retained evidence changed for '+key);assert((await identity(prior.path)).sha256===prior.sha256,'Retained evidence bytes changed.');return prior;}
  atomic(path,bytes);cp.artifacts[key]={path,bytes:bytes.length,sha256:hash(bytes)};persist();return cp.artifacts[key];
 }
 async function screenshot(name,width=1365,height=1000){
  await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The current operator page overflows the selected viewport.');
  const path=join(output,name+'.png');await page.screenshot({path,fullPage:true});const value=await identity(path);cp.artifacts[name]=value;persist();return value;
 }


 async function openEdition(key,id){
  await navigate('editions');
  const journal=await browserState();
  if(journal?.edition===id&&(await api('/api/view')).selectedEditionId===id)return api('/api/edition?editionId='+id);
  await action(key,'edition.select',async()=>{
   await page.locator('#edition-select').selectOption(id);await page.locator('[data-cmd="load-edition"]').click();
  });
  await waitUntil(async()=>{const j=await browserState();return j?.edition===id;},'Opening the selected retained edition');
  return api('/api/edition?editionId='+id);
 }
 async function fillCapture(query,mode,label){
  await navigate('capture');await input('capture','profileId',cp.ids.station);
  for(const key of ['beginDate','endDate','units','timeZone','datum','predictionInterval'])await input('capture',key,query[key]);
  await input('capture','mode',mode);await input('capture','label',label);
  for(const product of ['water_level','hourly_height','predictions'])await page.locator('[data-form="capture"][data-product="'+product+'"]').setChecked(query.products.includes(product));
 }
 async function waitCapture(id){
  const result=await waitUntil(async()=>{const view=await api('/api/view'),capture=view.captures.find(c=>c.id===id);assert(capture,'The original capture identity is absent.');if(['FAILED','PAUSED'].includes(capture.state))throw new Error('Original capture '+id+' is '+capture.state+': '+(capture.error?.message??'inspect the retained response ledger'));return capture.state==='COMPLETE'&&capture.editionId?capture:null;},'Capturing the selected original NOAA source requests',captureTimeout);
  const edition=await api('/api/edition?editionId='+result.editionId);assert(edition.captureId===id&&edition.workspaceId===cp.workspaceId,'The captured edition changed native ownership.');
  return{capture:result,edition};
 }
 async function exportFile(key,editionId,format,{table='observations',mappingId=null,backfillId=null,name}={}){
  await navigate(backfillId?'backfills':'editions');
  const actionName=backfillId?'backfill.export':'export.create';
  if(!backfillId&&!cp.issued['export-'+key]?.request)await openEdition('select-for-export-'+key,editionId);
  const item=await action('export-'+key,actionName,async()=>{
   await page.locator('[data-cmd="'+(backfillId?'backfill-export':'export-edition')+'"][data-id="'+(backfillId??editionId)+'"]').click();
   await page.locator('#export-form select[name="table"]').selectOption(table);
   await page.locator('#export-form select[name="format"]').selectOption(format);
   await page.locator('#export-form select[name="mappingId"]').selectOption(mappingId??'');
   await page.locator('#export-form button[type="submit"]').click();
  });
  assert(item?.id&&/^[a-f0-9]{64}$/.test(item.sha256)&&Number.isSafeInteger(item.bytes),'The native export must retain its immutable byte identity.');
  await navigate('exports');
  const artifact=await downloaded(key,()=>page.locator('[data-cmd="download-export"][data-id="'+item.id+'"]').click(),name??item.name,item);
  const receipt=await saveJSON(key+'-receipt',key+'-receipt.json',item);return{item,artifact,receipt};
 }
 async function projectRows(key,edition,table='observations'){
  const filename=key+'.jsonl',path=join(output,filename);
  if(cp.artifacts[key]){const exact=await identity(cp.artifacts[key].path);assert(exact.sha256===cp.artifacts[key].sha256,'The retained projected row ledger changed.');return cp.artifacts[key];}
  const temporary=path+'.tmp-'+randomUUID(),fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600),digest=createHash('sha256');
  let offset=0,total=null,bytes=0,first=[],quality={};
  try{
   do{
    const selected=await api('/api/rows?'+new URLSearchParams({editionId:edition.id,table,offset:String(offset),limit:'500'}));
    assert(selected.table===table&&selected.offset===offset&&selected.selection.beginDate===edition.query.beginDate&&selected.selection.endDate===edition.query.endDate,'The paged source projection changed its selected identity.');
    if(total===null)total=selected.total;assert(total===selected.total&&Array.isArray(selected.rows),'The immutable projected source row count changed.');
    for(const row of selected.rows){
     assert(row.editionId===edition.id&&row.stationId===edition.query.stationId,'A projected row lost its original edition or station.');
     if(table==='observations'||table==='predictions'){
      assert(row.timestamp.slice(0,10)>=edition.query.beginDate&&row.timestamp.slice(0,10)<=edition.query.endDate,'An out-of-window source row entered the selected projection.');
      assert(row.datum===edition.query.datum&&row.timeZone===edition.query.timeZone,'A source row changed its declared datum or time basis.');
      if(edition.query.timeZone==='gmt')assert(typeof row.timestampUtc==='string'&&row.timestampUtc.endsWith('Z'),'The declared GMT timestamp needs its original UTC projection.');
     }
     const line=Buffer.from(JSON.stringify(row)+'\n');fs.writeSync(fd,line);digest.update(line);bytes+=line.length;
     if(first.length<100)first.push(row);quality[row.quality||'not_reported']=(quality[row.quality||'not_reported']??0)+1;
    }
    assert(selected.rows.length||offset===total,'The complete source projection stopped before its retained total.');offset+=selected.rows.length;
   }while(offset<total);
   fs.fsyncSync(fd);fs.closeSync(fd);fs.renameSync(temporary,path);
  }catch(error){try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(temporary);}catch{}throw error;}
  const artifact={path,bytes,sha256:digest.digest('hex'),rows:offset,table,editionId:edition.id,sample:first,quality};cp.artifacts[key]=artifact;persist();return artifact;
 }
 function verifySourcePackage(artifact,edition){
  regular(artifact.path,64*1024*1024);const value=readJSON(artifact.path);
  assert(value.schema==='stellar-forge.coops-capture-package.v1'&&stable(value.edition)===stable(edition),'The exported package must contain the exact selected source edition.');
  const groups=[[value.responses,edition.pages],[value.failedResponses??[],edition.failedResponses??[]]];let decodedBytes=0;
  for(const [rows,receipts]of groups){
   assert(Array.isArray(rows)&&rows.length===receipts.length,'Every retained accepted/unavailable/failed response must travel with the source package.');
   for(let index=0;index<rows.length;index++){
    const row=rows[index],receipt=receipts[index],bytes=Buffer.from(row.base64,'base64');
    assert(bytes.toString('base64')===row.base64&&stable(row.receipt)===stable(receipt),'The original response receipt or encoded bytes changed.');
    assert(bytes.length===receipt.bytes&&hash(bytes)===receipt.sha256,'A source-package response does not match its original SHA/byte count.');decodedBytes+=bytes.length;
   }
  }
  const originalDigest=hash(stable(edition.pages.map(p=>({url:p.url,sha256:p.sha256,bytes:p.bytes}))));
  assert(originalDigest===edition.sourceSha256,'The edition source digest differs from the retained original receipt sequence.');
  return{schema:value.schema,editionId:edition.id,sourceSha256:edition.sourceSha256,acceptedOrUnavailableResponses:value.responses.length,failedResponses:(value.failedResponses??[]).length,decodedOriginalBytes:decodedBytes,annotations:value.annotations};
 }
 async function resolveSourceReview(packet,files){
  const packetFile=await saveJSON('source-review-packet','source-review-packet.json',packet);
  if(!cp.review){
   const response=await options.reviewEdition({operationId:cp.id,workspaceId:cp.workspaceId,editionId:packet.edition.id,sourceSha256:packet.edition.sourceSha256,packet,packetPath:packetFile.path,packetSha256:packetFile.sha256,files:clone(files)});
   assert(response&&response.packetSha256===packetFile.sha256&&response.editionId===packet.edition.id&&response.sourceSha256===packet.edition.sourceSha256,'The independent decision must bind this exact original source packet.');
   assert(['reviewed','follow_up'].includes(response.status)&&typeof response.reviewer==='string'&&response.reviewer.trim()&&typeof response.note==='string'&&response.note.trim(),'An actual reviewer must supply a decision and substantive source note.');
   cp.review={...clone(response),subject:String(response.subject??'Source, datum and coverage review'),performedAt:response.performedAt??new Date().toISOString()};persist();
  }
  assert(cp.review.packetSha256===packetFile.sha256,'Keep the accepted original review packet after interruption.');
  await saveJSON('source-review-response','source-review-response.json',cp.review);return cp.review;
 }
 async function queryDataset(key,dataset,query){
  await navigate('datasets');
  const result=await action(key,'dataset.query',async()=>{
   await page.locator('[data-cmd="query-dataset"][data-id="'+dataset.id+'"]').click();
   await page.locator('#query-form textarea[name="query"]').fill(query);
   await page.locator('#query-form button[type="submit"]').click();
  });
  assert(result.schema==='stellar-forge.dataset-page.v1'&&result.dataset.snapshot===dataset.snapshot,'The query must use the original SF30 handler and selected immutable snapshot.');
  assert(result.page.total===dataset.rows&&result.rows.length===result.page.returned,'The native dataset page changed its saved row identity.');return result;
 }


 async function ensurePreview(key,query,mode,label){
  const prefix=mode==='backfill'?'backfill':'capture';
  cp.previews??={};let selectedKey=cp.previews[key]?.at(-1);
  if(selectedKey&&cp.issued[selectedKey]?.request&&(await browserState())?.pending?.request.operationId===cp.issued[selectedKey].request.operationId)await settleIssued(selectedKey);
  const current=await browserState(),expected={profileId:cp.ids.station,label,beginDate:query.beginDate,endDate:query.endDate,products:query.products,units:query.units,timeZone:query.timeZone,datum:query.datum,predictionInterval:query.predictionInterval};
  const preview=current?.preview;
  if(selectedKey&&preview?.kind===mode&&preview.payload===JSON.stringify(expected)){
   return settleIssued(selectedKey);
  }
  await fillCapture(query,mode,label);
  if(!selectedKey||cp.issued[selectedKey]?.request){selectedKey=key+'-'+String((cp.previews[key]?.length??0)+1);(cp.previews[key]??=[]).push(selectedKey);persist();}
  const result=await action(selectedKey,prefix+'.preview',()=>page.locator('#capture-form button[type="submit"]').click());
  assert(result.planSha256&&result.schema==='stellar-forge.coops-'+(mode==='backfill'?'backfill-plan':'request-plan')+'.v1','The visible request preview must be the original native plan.');
  return result;
 }
 try{
  await openSession(sessionURL.href);
  await phase('station_save_and_original_response_recovery',async()=>{
   const key='station-profile-save',originalNote='Public regional coastal source reference. Station 9410230 has not been established as a project boundary or a site-specific hydraulic model.',
    laterNote=originalNote+'\nLater unsaved receiving note: retain the original datum and quality review before choosing model-input use.';
   await navigate('stations');
   const saved=await action(key,'station.save',async()=>{
    await page.locator('[data-cmd="new-station"]').click();
    for(const [field,value]of Object.entries({stationId:selection.stationId,label:'La Jolla original source receiving '+cp.id.slice(0,8),owner:selected.operator,note:originalNote,active:'true'}))await input('station',field,value);
    await page.locator('#station-form button[type="submit"]').click();
   },{loseResponse:true,onCommitted:async record=>{
    cp.ids.station=record.id;cp.stationLaterNote=laterNote;const journal=await browserState();cp.stationDraftToken=journal?.pending?.draftEffect?.token??null;persist();
    await input('station','note',laterNote);
    await waitUntil(async()=>{const j=await browserState();return j?.drafts.station.note===laterNote;},'Retaining the later unsaved station note');
   }});
   cp.ids.station=saved.id;cp.stationLaterNote=laterNote;persist();
   const before=await browserState();
   if(before?.drafts.station.note!==laterNote){
    assert(!before?.pending||before.pending.request.operationId===cp.issued[key].request.operationId,'A different saved request is pending.');
    await navigate('stations');await input('station','note',laterNote);await waitUntil(async()=>(await browserState())?.drafts.station.note===laterNote,'Retaining the original later draft');
   }
   await restart('after-committed-station-save');
   const original=await settleIssued(key),journal=await browserState(),view=await api('/api/view');
   assert(original.id===cp.ids.station&&journal?.drafts.station.profileId===original.id,'Exact replay must restore the saved ID to its original station draft.');
   assert(journal.drafts.station.note===laterNote,'Later unsaved fields must survive exact replay and same-origin restart.');
   if(cp.stationDraftToken)assert(journal.draftTokens.station===cp.stationDraftToken,'The original station draft identity changed.');
   assert(view.stations.filter(p=>p.id===original.id).length===1&&view.stations.find(p=>p.id===original.id).note===originalNote,'Recovery must retain one saved original profile and keep later edits unsaved.');
   assert(cp.issued[key].replay?.reused===true,'The original committed request must be observed as an exact replay.');
   await navigate('stations');await screenshot('station-recovery-desktop');
   return{stationId:original.id,nativeOperation:cp.issued[key].native,replay:cp.issued[key].replay,originalSavedNote:originalNote,laterUnsavedNoteRetained:true};
  });
  await phase('capture_original_reference',async()=>{
   const key='reference-capture-start',label='Original NOAA '+selection.stationId+' '+selection.beginDate+' through '+selection.endDate;
   if(!cp.issued[key]?.request){
    const preview=await ensurePreview('reference-request-preview',selection,'capture',label);
    assert(preview.query.stationId===selection.stationId&&preview.query.beginDate===selection.beginDate&&preview.query.endDate===selection.endDate&&stable(preview.query.products)===stable(selection.products),'The reviewed source request changed its selected station, dates or products.');
    await saveJSON('reference-request-plan','reference-request-plan.json',preview);
   }
   const started=await action(key,'capture.start',()=>page.locator('[data-cmd="start-capture"]').click());cp.ids.capture=started.captureId;persist();
   const received=await waitCapture(started.captureId);cp.ids.edition=received.edition.id;cp.ids.sourceSha256=received.edition.sourceSha256;persist();
   assert(received.edition.query.stationId===selection.stationId,'The original source edition belongs to another station.');
   const actual=received.edition.summary.products.water_level;
   assert(actual&&actual.rowsInsideWindow>0,'The actual reference capture has no water-level observations to review.');
   await saveJSON('reference-edition','reference-edition.json',received.edition);
   return{captureId:started.captureId,editionId:received.edition.id,sourceSha256:received.edition.sourceSha256,sourceRequestComplete:received.edition.complete,actualCoverage:received.edition.summary};
  });
  await phase('original_source_packet_and_independent_review',async()=>{
   const edition=await openEdition('select-original-edition',cp.ids.edition);
   await page.locator('[data-cmd="table"][data-id="observations"]').click();
   await waitUntil(async()=>{const rows=await page.locator('#rows-panel').innerText();return rows.includes('complete selected records');},'Opening the native source projection');
   const ledger=await projectRows('reference-observations',edition);
   const packageFile=await exportFile('unreviewed-source-package',edition.id,'source-package',{name:'La_Jolla_Original_Source_Package.json'});
   const verified=verifySourcePackage(packageFile.artifact,edition);
   await openEdition('reopen-original-response-register',edition.id);
   const sourceIndex=edition.pages.findIndex(p=>p.product==='water_level'&&!p.unavailable);assert(sourceIndex>=0,'The water-level source response is absent.');
   await page.locator('[data-cmd="source-detail"][data-id="'+sourceIndex+'"]').click();
   await screenshot('original-response-receipt-desktop');await closeDialog();
   const source=await downloaded('water-level-original',()=>page.locator('[data-cmd="source-download"][data-id="'+sourceIndex+'"]').click(),'La_Jolla_Water_Level_Original.json',edition.pages[sourceIndex]);
   const packet={schema:'stellar-forge.coops-independent-source-review.v1',role:'public_reference',operatorId:cp.id,workspaceId:cp.workspaceId,edition,
    capture:cp.phases.capture_original_reference.result,sourcePackage:packageFile.artifact,verifiedSourcePackage:verified,projection:{...ledger,sample:ledger.sample},
    reviewScope:{reference:'Regional coastal datum and observation handoff; project-boundary suitability is unestablished.',measurementVsRequestCompletion:'Use the actual separate source/measurement coverage fields; no missing slots are filled.',
     expectedSlotBasis:'For the default seven-day six-minute GMT choice, the theoretical grid is 1680 slots. This is not a count of valid observations.',
     quality:'Original q and f control the flag meaning: verified f[0] is an inferred-value flag; preliminary f[0] is an excluded-sample count. Preserve unknown fields and original numeric strings.',
     declaration:'An independent reviewer must inspect these exact original receipts and values before providing reviewed or follow_up. No response is supplied by this journey.'}};
   const review=await resolveSourceReview(packet,{sourcePackage:packageFile.artifact,sourcePackageReceipt:packageFile.receipt,originalResponse:source,projection:ledger,edition:cp.artifacts['reference-edition']});
   const reviewKey='review:'+edition.id;
   if(!cp.issued['save-independent-source-review']?.request)await openEdition('select-edition-for-independent-review',edition.id);
   const annotation=await action('save-independent-source-review','annotation.save',async()=>{
    await input(reviewKey,'subject',review.subject);await input(reviewKey,'status',review.status);
    await input(reviewKey,'note',review.note+'\nReviewer: '+review.reviewer+'\nReviewed source packet SHA-256: '+review.packetSha256+'\nReview performed: '+review.performedAt);
    await page.locator('#review-form button[type="submit"]').click();
   });
   assert(annotation.editionId===edition.id&&annotation.status===review.status&&annotation.note.includes(review.packetSha256),'The saved independent review lost its original source packet.');
   cp.ids.annotation=annotation.id;persist();
   await screenshot('reviewed-source-desktop');await screenshot('reviewed-source-mobile',390,844);await page.setViewportSize({width:1365,height:1000});
   return{editionId:edition.id,sourceSha256:edition.sourceSha256,annotation,reviewPacket:cp.artifacts['source-review-packet'],reviewResponse:cp.artifacts['source-review-response'],sourcePackage:packageFile,projection:ledger};
  });
  await phase('explicit_model_input_mapping',async()=>{
   await navigate('mappings');
   const mapping=await action('model-input-mapping-save','mapping.save',async()=>{
    await page.locator('[data-cmd="new-mapping"]').click();
    await page.locator('[data-cmd="mapping-file-open"]').click();
    await page.locator('#mapping-file').setInputFiles(mappingFile);
    await page.locator('#mapping-file-target').selectOption('');
    await page.locator('#mapping-file-note').fill('Internal receiving imports the published public-reference convention as a distinct mapping. The model owner must supply and approve their actual project convention; imported record IDs are provenance only.');
    await page.locator('#mapping-file-import-form button[type="submit"]').click();
    await page.locator('#dialog[open] [data-cmd="mapping-file-apply"]').waitFor();
    const inspected=await browserState();
    assert(inspected.mappingImport.preview.source.sha256===mappingFileIdentity.sha256&&inspected.mappingImport.preview.source.bytes===mappingFileIdentity.bytes&&!inspected.mappingImport.targetId,'The reviewed incoming file must match the exact selected original and distinct target.');
    await page.locator('#dialog[open] [data-cmd="mapping-file-apply"]').click();
    await input('mapping','name','Public regional model-input convention '+cp.id.slice(0,8));
    await input('mapping','table','observations');
    await input('mapping','note','Internal receiving convention for the selected public NOAA source: retain metric/GMT/MLLW values and provenance. The heading water_level_m denotes the original metre-valued field; no numerical, time or datum conversion occurs. A client model owner must choose their actual input convention.');
    const source=await browserState(),valueIndex=source.drafts.mapping.columns.findIndex(c=>c.source==='value');
    assert(valueIndex>=0,'The selected original mapping must expose the native value field.');
    await page.locator('[data-column="'+valueIndex+'"][data-part="heading"]').fill('water_level_m');
    await page.locator('#mapping-form button[type="submit"]').click();
   });
   cp.ids.mapping=mapping.id;persist();
   const journal=await browserState();assert(journal?.drafts.mapping.mappingId===mapping.id&&!journal.drafts.mapping.mappingSource,'The original mapping form must retain its saved identity and the saved input-file effect.');
   assert(mapping.sourceFile?.sha256===mappingFileIdentity.sha256&&mapping.sourceFile.bytes===mappingFileIdentity.bytes&&mapping.revision===1,'The first mapping lost its exact selected input file or native version.');
   assert(mapping.columns.find(c=>c.source==='value')?.heading==='water_level_m'&&['editionId','recordId','sourcePageSha256'].every(k=>mapping.columns.some(c=>c.source===k)),'The explicit receiving mapping lost its source/value meaning.');
   await saveJSON('selected-model-input-mapping','selected-model-input-mapping.json',mapping);
   cp.artifacts.mapping_draft=await downloaded('mapping-convention-draft',()=>page.locator('[data-cmd="mapping-json"]').click(),'La_Jolla_Model_Input_Convention.json');persist();
   await screenshot('selected-mapping-desktop');await screenshot('selected-mapping-mobile',390,844);await page.setViewportSize({width:1365,height:1000});
   return mapping;
  });
  await phase('complete_reviewed_model_input_handoff',async()=>{
   const edition=await api('/api/edition?editionId='+cp.ids.edition),files={};
   for(const format of ['csv','json','jsonl','report','source-package']){
    const mapped=['csv','json','jsonl'].includes(format);
    files[format]=await exportFile('reviewed-'+format,edition.id,format,{mappingId:mapped?cp.ids.mapping:null,name:'La_Jolla_Reviewed_'+(format==='source-package'?'Source_Package.json':format==='report'?'Source_Report.html':'Model_Input.'+format)});
   }
   const packageIdentity=verifySourcePackage(files['source-package'].artifact,edition);
   const annotation=packageIdentity.annotations.find(a=>a.id===cp.ids.annotation);
   assert(annotation?.note.includes(cp.review.packetSha256),'The complete receiving package must carry the independently saved source review.');
   const json=readJSON(files.json.artifact.path);
   assert(json.schema==='stellar-forge.coops-table-export.v1'&&json.mapping?.id===cp.ids.mapping&&json.editionIds.includes(edition.id),'The model-input export lost its original mapping or edition.');
   assert(json.rows.length===cp.artifacts['reference-observations'].rows&&json.rows.every(row=>Object.hasOwn(row,'water_level_m')&&row.editionId===edition.id),'The complete mapped export changed its selected rows or value heading.');
   cp.ids.reviewedSourceExport=files['source-package'].item.id;cp.ids.reviewedSourcePackageSha256=files['source-package'].artifact.sha256;persist();
   return{files,packageIdentity,completeMappedRows:json.rows.length};
  });
  await phase('returned_mapping_file_and_versioned_handoff',async()=>{
   const first=cp.phases.explicit_model_input_mapping.result,returned=cp.artifacts.mapping_draft;
   assert(returned&&first.revision===1,'Keep the original downloaded mapping convention and first saved revision.');
   const exact=await identity(returned.path);assert(exact.bytes===returned.bytes&&exact.sha256===returned.sha256,'The returned convention differs from the original native mapping download.');
   const document=readJSON(returned.path);assert(document.schema==='stellar-forge.coops-model-input-mapping-file.v1'&&document.source.mappingId===first.id&&document.source.revision===first.revision,'The returned file lost its original source mapping identity.');
   await navigate('mappings');
   const revised=await action('reviewed-returned-mapping-save','mapping.save',async()=>{
    await page.locator('[data-cmd="edit-mapping"][data-id="'+first.id+'"]').click();
    await page.locator('[data-cmd="mapping-file-open"]').click();
    await page.locator('#mapping-file').setInputFiles(returned.path);
    await page.locator('#mapping-file-target').selectOption(first.id);
    await page.locator('#mapping-file-note').fill('Internal receiving reviews its own complete mapping export against the same saved target. Retain version 1 and its earlier handoff. This explicit version changes only the source-URL receiving heading and records that the source values stay unchanged.');
    await page.locator('#mapping-file-import-form button[type="submit"]').click();
    await page.locator('#dialog[open] [data-cmd="mapping-file-apply"]').waitFor();
    const j=await browserState();assert(j.mappingImport.preview.source.sha256===returned.sha256&&j.mappingImport.targetId===first.id&&j.mappingImport.targetRecord.revision===1,'The returned file comparison must bind the exact original file and reviewed target revision.');
    await page.locator('#dialog[open] [data-cmd="mapping-file-apply"]').click();
    const current=await browserState(),index=current.drafts.mapping.columns.findIndex(c=>c.source==='sourceUrl');assert(index>=0,'The complete source URL column must remain selected.');
    await page.locator('[data-column="'+index+'"][data-part="heading"]').fill('source_request_url');
    await input('mapping','note',first.note+'\n\nVersion 2: explicitly rename the original sourceUrl output heading to source_request_url; retain every source value and the previously exported version 1 convention.');
    await page.locator('#mapping-form button[type="submit"]').click();
   });
   assert(revised.id===first.id&&revised.revision===2&&revised.sourceFile?.sha256===returned.sha256,'The received convention must become version 2 of the explicitly chosen mapping.');
   const {history:firstHistory,...firstRecord}=first;assert(stable(revised.history.find(m=>m.revision===1))===stable(firstRecord),'The first saved mapping and original input source changed.');
   const view=await api('/api/view');assert(view.mappings.filter(m=>m.id===first.id).length===1,'The returned mapping intake created a duplicate target.');
   for(const file of Object.values(cp.phases.complete_reviewed_model_input_handoff.result.files)){
    const original=view.exports.find(e=>e.id===file.item.id);assert(stable(original)===stable(file.item),'A later mapping revision changed an earlier immutable source handoff.');
   }
   await saveJSON('revised-model-input-mapping','revised-model-input-mapping.json',revised);
   cp.ids.mappingRevision=revised.revision;persist();
   const originals=[];
   for(const version of [first,revised]){
    await navigate('mappings');await page.locator('[data-cmd="mapping-history"][data-id="'+first.id+'"]').click();
    const file=await downloaded('mapping-original-v'+version.revision,()=>page.locator('#dialog[open] [data-cmd="mapping-source-download"][data-id="'+first.id+'"][data-revision="'+version.revision+'"]').click(),'Model_Input_Original_v'+version.revision+'.json',version.sourceFile);
    originals.push({revision:version.revision,sourceFile:version.sourceFile,file});await closeDialog();
   }
   const current=await exportFile('revised-model-input-jsonl',cp.ids.edition,'jsonl',{mappingId:revised.id,name:'La_Jolla_Model_Input_v2.jsonl'});
   assert(current.item.mapping.revision===2&&current.item.mapping.sourceFile.sha256===returned.sha256,'The new handoff lost the returned file and current mapping revision.');
   await navigate('mappings');await page.locator('[data-cmd="edit-mapping"][data-id="'+first.id+'"]').click();
   await screenshot('mapping-version-receiving-desktop');await screenshot('mapping-version-receiving-mobile',390,844);await page.setViewportSize({width:1365,height:1000});
   return{mapping:revised,originals,current,priorHandoffPreserved:true};
  });

  await phase('retain_original_package_and_compare_source_identity',async()=>{
   const original=cp.phases.complete_reviewed_model_input_handoff.result.files['source-package'];
   await navigate('capture');
   const imported=await action('import-original-reviewed-package','capture.import',async()=>{
    await input('capture','profileId',cp.ids.station);await input('capture','label','Receiving the exact reviewed original source package '+cp.id.slice(0,8));
    await page.locator('#source-package').setInputFiles(original.artifact.path);
    await page.locator('#source-import-form button[type="submit"]').click();
   });
   cp.ids.importCapture=imported.captureId;persist();assert(imported.source==='RETAINED_SOURCE_PACKAGE','Receiving must use the retained source package, not a new NOAA acquisition.');
   const received=await waitCapture(imported.captureId);cp.ids.importedEdition=received.edition.id;persist();
   const earlier=await api('/api/edition?editionId='+cp.ids.edition),later=received.edition;
   assert(later.id!==earlier.id&&later.sourceSha256===earlier.sourceSha256&&later.sourcePackageSha256===original.artifact.sha256,'The received edition must retain the original source bytes under its distinct native import identity.');
   const receipts=edition=>edition.pages.map(p=>({url:p.url,bytes:p.bytes,sha256:p.sha256,sourceObservedAt:p.sourceObservedAt,startedAt:p.startedAt,finishedAt:p.finishedAt}));
   assert(stable(receipts(later))===stable(receipts(earlier)),'Receiving changed the original observed source times or response identities.');
   const view=await api('/api/view');assert(view.annotations.some(a=>a.editionId===later.id&&a.importedFrom?.editionId===earlier.id&&a.note.includes(cp.review.packetSha256)),'The receiving edition omitted its original reviewed provenance.');
   await saveJSON('received-original-edition','received-original-edition.json',later);
   await navigate('compare');
   const comparison=await action('compare-original-and-received-source','edition.compare',async()=>{
    await input('compare','leftId',earlier.id);await input('compare','rightId',later.id);await input('compare','table','observations');
    await page.locator('#compare-form button[type="submit"]').click();
   });
   assert(comparison.schema==='stellar-forge.coops-comparison.v1'&&comparison.compatible,'The source-preserving receiving comparison must retain compatible original conventions.');
   for(const kind of ['added','removed','changed','scopeAdded','scopeRemoved'])assert(comparison.counts[kind]===0,'The original package receiving changed '+kind+' source records.');
   // Native ambiguous duplicate groups remain evidence, even on a byte-identical import.
   assert(comparison.counts.ambiguous>=0,'The original duplicate-key evidence must remain explicit.');
   const complete=await downloaded('source-receiving-comparison',async()=>{await navigate('exports');await page.locator('[data-cmd="download-export"][data-id="'+comparison.export.id+'"]').click();},'Original_and_Received_Source_Comparison.json',comparison.export);
   const native=readJSON(complete.path);assert(stable(native.counts)===stable(comparison.counts)&&native.changes.length===Object.values(native.counts).reduce((a,b)=>a+b,0),'The complete streamed comparison must include every native change entry.');
   await saveJSON('source-receiving-comparison-receipt','source-receiving-comparison-receipt.json',comparison.export);
   await navigate('compare');await screenshot('source-receiving-comparison-desktop');
   return{captureId:imported.captureId,editionId:later.id,sourcePackageSha256:original.artifact.sha256,originalObservedTimesPreserved:true,comparison,complete};
  });
  await phase('prepare_and_query_original_sf30_dataset',async()=>{
   const pinned=cp.phases.returned_mapping_file_and_versioned_handoff.result.mapping;
   await navigate('datasets');
   const dataset=await action('prepare-original-sf30-dataset','dataset.prepare',async()=>{
    await input('dataset','editionId',cp.ids.importedEdition);await input('dataset','table','observations');await input('dataset','mappingId',pinned.id);
    await input('dataset','name','La Jolla original received observations '+cp.id.slice(0,8));
    for(const field of ['beginDate','endDate','products'])await input('dataset',field,'');
    await page.locator('#dataset-form button[type="submit"]').click();
   });
   cp.ids.dataset=dataset.id;persist();
   assert(dataset.mode==='ORIGINAL_SF30_DATASET'&&dataset.editionId===cp.ids.importedEdition&&dataset.sourceSha256===cp.ids.sourceSha256,'The dataset must use the original SF30 package and received source identity.');
   assert(dataset.rows===cp.artifacts['reference-observations'].rows,'The native dataset omitted selected original observation rows.');
   assert(dataset.mapping?.id===pinned.id&&dataset.mapping.revision===pinned.revision&&dataset.mapping.sourceFileSha256===pinned.sourceFile.sha256&&stable(dataset.mapping.columns)===stable(pinned.columns),'The native dataset lost its exact reviewed mapping revision, selected headings or original input file.');
   cp.ids.datasetMappingRevision=dataset.mapping.revision;persist();
   await saveJSON('native-dataset-receipt','native-dataset-receipt.json',dataset);
   const first=await queryDataset('query-original-sf30-first-page',dataset,'limit=20&sort=timestampUtc');
   for(const row of first.rows){
    assert(row.editionId===cp.ids.importedEdition&&row.stationId===selection.stationId&&Object.hasOwn(row,'valueType'),'A native query row lost its original source/type fields.');
    assert(pinned.columns.every(c=>Object.hasOwn(row,c.heading))&&Object.hasOwn(row,'water_level_m')&&Object.hasOwn(row,'source_request_url')&&!Object.hasOwn(row,'value'),'The native query did not use the selected receiving headings.');
   }
   await saveJSON('native-query-first-page','native-query-first-page.json',first);
   let second=null;
   if(first.page.nextCursor){
    second=await queryDataset('query-original-sf30-next-page',dataset,'limit=20&sort=timestampUtc&cursor='+encodeURIComponent(first.page.nextCursor));
    assert(second.dataset.snapshot===first.dataset.snapshot,'The original cursor changed its immutable dataset snapshot.');
    await saveJSON('native-query-next-page','native-query-next-page.json',second);
   }
   await screenshot('original-sf30-query-desktop');await closeDialog();
   return{dataset,first,second,nativePublisherAndPayment:'No release, payment or customer transaction was configured or executed by this source receiving journey.'};
  });
  await phase('preserve_prepared_dataset_across_later_mapping_revision',async()=>{
   const pinned=cp.phases.returned_mapping_file_and_versioned_handoff.result.mapping,dataset=cp.phases.prepare_and_query_original_sf30_dataset.result.dataset;
   await navigate('mappings');
   const revised=await action('later-mapping-after-dataset','mapping.save',async()=>{
    await page.locator('[data-cmd="edit-mapping"][data-id="'+pinned.id+'"]').click();
    const draft=(await browserState()).drafts.mapping,index=draft.columns.findIndex(c=>c.source==='value');assert(index>=0,'Keep the original value field in this later receiving convention.');
    await page.locator('[data-column="'+index+'"][data-part="heading"]').fill('water_level_m_v3');
    await input('mapping','note',pinned.note+'\n\nVersion 3: a later internal receiving convention uses water_level_m_v3. The already prepared native dataset and earlier complete exports retain their original version 2 or version 1 headings and original source files.');
    await page.locator('#mapping-form button[type="submit"]').click();
   });
   assert(revised.id===pinned.id&&revised.revision===pinned.revision+1&&revised.sourceFile.sha256===pinned.sourceFile.sha256,'The later mapping must preserve its target and acquired original file.');
   const {history,...pinnedRecord}=pinned;assert(stable(revised.history.find(m=>m.revision===pinned.revision))===stable(pinnedRecord),'The prepared dataset’s source mapping revision changed.');
   cp.ids.mappingRevision=revised.revision;persist();await saveJSON('mapping-after-native-dataset','mapping-after-native-dataset.json',revised);
   const retained=(await api('/api/view')).datasets.find(d=>d.id===dataset.id);assert(stable(retained)===stable(dataset),'A later mapping edit changed the retained original dataset receipt.');
   const query=await queryDataset('query-pinned-dataset-after-mapping-edit',dataset,'limit=20&sort=timestampUtc');
   assert(stable(query)===stable(cp.phases.prepare_and_query_original_sf30_dataset.result.first),'A later mapping revision changed an earlier native query snapshot or its selected receiving headings.');
   await saveJSON('native-query-after-mapping-edit','native-query-after-mapping-edit.json',query);await screenshot('pinned-query-after-mapping-edit-desktop');await closeDialog();
   return{mappingId:pinned.id,preparedMappingRevision:dataset.mapping.revision,currentMappingRevision:revised.revision,sourceFileSha256:pinned.sourceFile.sha256,datasetId:dataset.id,snapshot:dataset.snapshot,originalQueryPreserved:true};
  });
  if(historical)await phase('serial_historical_capture_and_complete_streamed_handoff',async()=>{
   const key='historical-backfill-start',label='Selected historical '+selection.stationId+' hourly source study '+historical.beginDate+' through '+historical.endDate;
   if(!cp.issued[key]?.request){
    const preview=await ensurePreview('historical-request-preview',historical,'backfill',label);
    assert(preview.parts.length>=2&&preview.parts.every(p=>p.query.days<=366),'The selected historical study must use multiple original bounded capture editions.');
    for(let i=1;i<preview.parts.length;i++)assert(Date.parse(preview.parts[i].query.beginDate+'T00:00:00Z')===Date.parse(preview.parts[i-1].query.endDate+'T00:00:00Z')+86400000,'The original backfill parts must remain consecutive and nonoverlapping.');
    await saveJSON('historical-request-plan','historical-request-plan.json',preview);
   }
   const started=await action(key,'backfill.start',()=>page.locator('[data-cmd="start-capture"]').click());cp.ids.backfill=started.backfillId;persist();
   const study=await waitUntil(async()=>{
    const view=await api('/api/view'),value=view.backfills.find(b=>b.id===started.backfillId);assert(value,'The original backfill identity is absent.');
    if(['FAILED','PAUSED'].includes(value.state))throw new Error('The original historical study is '+value.state+': '+(value.error?.message??'inspect its retained child capture'));
    return value.state==='COMPLETE'?value:null;
   },'Capturing the selected original historical parts in sequence',captureTimeout);
   assert(study.parts.length>=2&&study.parts.every(p=>p.editionId&&p.state==='COMPLETE'),'The complete study must retain each original child edition.');
   cp.ids.historicalEditions=study.parts.map(p=>p.editionId);persist();
   const children=[];
   for(const part of study.parts){
    const edition=await api('/api/edition?editionId='+part.editionId);
    assert(edition.query.stationId===selection.stationId&&edition.query.beginDate===part.query.beginDate&&edition.query.endDate===part.query.endDate,'A retained child changed its original historical window.');
    children.push({id:edition.id,sourceSha256:edition.sourceSha256,query:edition.query,summary:edition.summary});
   }
   await saveJSON('historical-native-study','historical-native-study.json',study);
   await saveJSON('historical-child-source-coverage','historical-child-source-coverage.json',children);
   const jsonl=await exportFile('historical-complete-jsonl',null,'jsonl',{backfillId:study.id,mappingId:cp.ids.mapping,name:'Historical_Original_Model_Input.jsonl'});
   const csv=await exportFile('historical-complete-csv',null,'csv',{backfillId:study.id,mappingId:cp.ids.mapping,name:'Historical_Original_Model_Input.csv'});
   const expected=children.reduce((n,e)=>n+Object.entries(e.summary.products).filter(([p])=>p!=='predictions').reduce((a,[,p])=>a+p.rowsInsideWindow,0),0);
   const stream=fs.createReadStream(jsonl.artifact.path,{encoding:'utf8'});let rows=0,tail='';
   for await(const chunk of stream){const lines=(tail+chunk).split('\n');tail=lines.pop();for(const line of lines)if(line){const row=JSON.parse(line);assert(cp.ids.historicalEditions.includes(row.editionId)&&row.stationId===selection.stationId,'A streamed historical row lost its child source identity.');rows++;}}
   assert(!tail&&rows===expected,'The complete historical export must include every native selected row.');
   assert(stable(jsonl.item.editionIds)===stable(cp.ids.historicalEditions)&&jsonl.item.metadata.backfill.sourceComplete,'The export must pin the completed original child sequence.');
   await navigate('backfills');await screenshot('historical-study-desktop');await screenshot('historical-study-mobile',390,844);await page.setViewportSize({width:1365,height:1000});
   return{backfillId:study.id,selectedWindow:{beginDate:study.plan.beginDate,endDate:study.plan.endDate},children,rows,jsonl,csv,coverage:'Native actual child summaries are retained; request completion does not imply complete valid measurements.'};
  });
  await phase('same_origin_reopen_and_saved_receiving',async()=>{
   const before=await api('/api/view'),pins={workspaceId:before.workspaceId,stationId:cp.ids.station,editionId:cp.ids.edition,receivedEditionId:cp.ids.importedEdition,mapping:before.mappings.find(m=>m.id===cp.ids.mapping),annotation:before.annotations.find(a=>a.id===cp.ids.annotation),dataset:before.datasets.find(d=>d.id===cp.ids.dataset),exports:before.exports.filter(e=>[...Object.values(cp.phases.complete_reviewed_model_input_handoff.result.files),cp.phases.returned_mapping_file_and_versioned_handoff.result.current].some(f=>f.item.id===e.id)),historicalEditionIds:cp.ids.historicalEditions??[]};
   await saveJSON('before-reopen-source-pins','before-reopen-source-pins.json',pins);
   await restart('after-complete-source-and-query-handoff');
   const after=await api('/api/view');assert(after.workspaceId===pins.workspaceId,'Reopen changed the original workspace UUID.');
   assert(stable(after.mappings.find(m=>m.id===cp.ids.mapping))===stable(pins.mapping)&&stable(after.annotations.find(a=>a.id===cp.ids.annotation))===stable(pins.annotation),'Reopen changed the selected mapping or source review.');
   assert(stable(after.datasets.find(d=>d.id===cp.ids.dataset))===stable(pins.dataset),'Reopen changed the native dataset receipt.');
   for(const item of pins.exports)assert(stable(after.exports.find(e=>e.id===item.id))===stable(item),'Reopen changed an earlier immutable source export.');
   for(const id of [pins.editionId,pins.receivedEditionId,...pins.historicalEditionIds])assert((await api('/api/edition?editionId='+id)).id===id,'Reopen lost a retained source edition.');
   const journal=await browserState();assert(journal?.drafts.station.note===cp.stationLaterNote&&journal.drafts.station.profileId===cp.ids.station,'The original later station draft was lost across the complete workflow.');
   const query=await queryDataset('query-original-sf30-after-reopen',pins.dataset,'limit=20&sort=timestampUtc');
   assert(stable(query)===stable(cp.phases.prepare_and_query_original_sf30_dataset.result.first),'The saved native dataset query changed after same-origin reopen.');
   await saveJSON('native-query-after-reopen','native-query-after-reopen.json',query);await closeDialog();
   await openEdition('open-original-edition-after-reopen',cp.ids.edition);await screenshot('saved-source-after-reopen-desktop');await screenshot('saved-source-after-reopen-mobile',390,844);await page.setViewportSize({width:1365,height:1000});
   return{workspaceId:after.workspaceId,revision:after.revision,originalSourceAndReviewPreserved:true,mappingAndNativeDatasetPreserved:true,earlierExportsPreserved:true,laterUnsavedDraftPreserved:true};
  });
  const finalView=await api('/api/view'),result={schema:'stellar-forge.coops-operator-result.v1',status:'PASS',operationId:cp.id,workspaceId:cp.workspaceId,completedAt:new Date().toISOString(),resultPath,checkpointPath,
   scope:'Actual original NOAA capture, independent source review, explicit mapping-file intake/versioned complete model-input handoff, retained-package receiving/comparison, mapped native SF30 cursor/query preserved across a later mapping revision, declared serial historical capture and same-origin saved-workspace reopen.',
   sourceModule:moduleIdentity,selected:cp.selected,ids:cp.ids,reviewStatus:cp.review.status,sourceCoverage:cp.phases.capture_original_reference.result.actualCoverage,finalRevision:finalView.revision,
   checks:Object.fromEntries(Object.entries(cp.phases).map(([key,value])=>[key,value.result])),artifacts:cp.artifacts,
   nativeOperations:Object.fromEntries(Object.entries(cp.issued).map(([key,value])=>[key,{action:value.action,operationId:value.request?.operationId,state:value.state,native:value.native??null,replayed:value.replay?.reused===true}])),
   receivingBoundary:'This result records only completed original operations. It establishes no project-boundary suitability, client model acceptance, payment or customer purchase.'};
  atomic(resultPath,Buffer.from(JSON.stringify(result,null,2)+'\n'));cp.result=await identity(resultPath);cp.status='PASS';cp.completedAt=result.completedAt;cp.currentPhase=null;delete cp.error;persist();
  await progress('Completed original coastal-source receiving', {resultPath,workspaceId:cp.workspaceId,ids:cp.ids});
  return result;
 }catch(error){
  cp.status='INCOMPLETE';cp.error={at:new Date().toISOString(),phase:cp.currentPhase,message:redact(error.message)};try{persist();}catch{}
  error.checkpointPath=checkpointPath;error.operationId=cp.id;throw error;
 }
}
