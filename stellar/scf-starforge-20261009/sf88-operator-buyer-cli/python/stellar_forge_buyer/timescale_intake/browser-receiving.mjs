// SPDX-License-Identifier: MIT
// Actual browser receiving through the original DuckDB owner's visible controls.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const SCHEMA='stellar-forge.duckdb-timescale-intake.browser-receiving.v1';
const API='/api/timescale-intake',PAIR='/api/reconciliation';
const ID=/^[a-f0-9]{64}$/,REQUEST=/^[a-f0-9]{32}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
function need(value,message){if(!value)throw new Error(message);}
function stable(value){
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
 const encoded=JSON.stringify(value);need(encoded!==undefined,'Input must be complete JSON.');return encoded;
}
function withoutId(body){const result={...body};delete result.request_id;return result;}
async function regular(file){
 const info=await fs.lstat(file);
 need(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&(info.mode&0o077)===0,'Receiving metadata must be one private original file.');
 return info;
}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function readJson(file){await regular(file);return JSON.parse(await fs.readFile(file,'utf8'));}
async function syncDirectory(directory){const fd=await fs.open(directory,constants.O_RDONLY);try{await fd.sync();}finally{await fd.close();}}
async function retain(file,bytes){
 // The surrounding original receiving owns this directory. A deterministic
 // stage retains only these exact input bytes and can be continued after a
 // failed write; the immutable final pathname is published create-only.
 const staged=file+'.'+hash(bytes)+'.pending';
 async function info(name){try{return await fs.lstat(name);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
 function privateFile(value){
  need(value?.isFile()&&!value.isSymbolicLink()&&(value.mode&0o077)===0&&
   (value.nlink===1||value.nlink===2),'Receiving metadata must remain a private original file.');
 }
 async function finish(){
  const published=await info(file);if(!published)return false;
  privateFile(published);need((await fs.readFile(file)).equals(bytes),'The original receiving input changed.');
  const pending=await info(staged);
  if(pending){
   privateFile(pending);
   const same=pending.dev===published.dev&&pending.ino===published.ino;
   need(same?(published.nlink===2&&pending.nlink===2):(published.nlink===1&&pending.nlink===1),
    'The original receiving stage has an unexpected file binding.');
   // If publication completed before interruption, remove only its original
   // stage link. A failed earlier private stage can also be discarded once the
   // exact immutable final bytes have been recovered.
   await fs.unlink(staged);
  }
  const original=await regular(file),fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const opened=await fd.stat();
   need(opened.dev===original.dev&&opened.ino===original.ino,'The original receiving metadata changed while reopening.');
   await fd.sync();
  }finally{await fd.close();}
  await syncDirectory(path.dirname(file));return true;
 }
 if(await finish())return;
 const pending=await info(staged);
 if(pending){privateFile(pending);need(pending.nlink===1,'Reopen the published original receiving stage.');}
 const fd=await fs.open(staged,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
 try{
  const opened=await fd.stat();privateFile(opened);need(opened.nlink===1,'The pending original metadata has another file owner.');
  if(pending)need(opened.dev===pending.dev&&opened.ino===pending.ino,'The original receiving stage changed.');
  await fd.truncate(0);await fd.writeFile(bytes);await fd.sync();
 }finally{await fd.close();}
 try{await fs.link(staged,file);}catch(error){if(error.code!=='EEXIST')throw error;}
 need(await finish(),'The original receiving metadata was not published.');
}
async function publish(file,value){
 const temp=file+'.'+randomBytes(12).toString('hex')+'.partial';
 const fd=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}
 await fs.rename(temp,file);await syncDirectory(path.dirname(file));
}
async function prepare(directory){
 const root=path.resolve(directory);need(root!==path.parse(root).root,'Use the original private receiving directory.');
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const info=await fs.lstat(root);
 need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&await fs.realpath(root)===root,'Use a canonical private receiving directory.');
 return root;
}
async function engineFor(provided){
 if(provided&&typeof provided==='object')return provided.chromium??provided.default?.chromium;
 const module=provided?await import(pathToFileURL(path.resolve(provided)).href):await import('playwright');
 return module.chromium??module.default?.chromium;
}
function requestRoute(family,id){return (family==='pair'?PAIR:API)+'/requests/'+id;}

/**
 * Receive one complete original commissioning report through the existing
 * owner's browser. The caller supplies the running original DuckDB server;
 * this function owns only its persistent browser context and receiving files.
 * Every write goes through a visible original browser control.
 *
 * input = {operation_id,source_commit,workspace_id,
 *   report:{path,sha256,filename},
 *   baseline:{source_id,columns,interpretation,keys},
 *   observed:{source_id,columns,interpretation,keys},
 *   pair:{name,label,columns,window_column,windows,notes},actor,reason}.
 *
 * The returned definition and original pair request are consumed by
 * runReconciliationBrowserReceiving. That receiver continues the same pair
 * through a native run, decision, report and full portable handover.
 */
export async function runTimescaleIntakeBrowserReceiving({url,input,outputDirectory,playwright,chromium}={}){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 need(plain(input)&&typeof input.operation_id==='string'&&input.operation_id.trim()&&
  /^[a-f0-9]{40}$/.test(input.source_commit??'')&&REQUEST.test(input.workspace_id??'')&&
  plain(input.report)&&ID.test(input.report.sha256??'')&&typeof input.report.path==='string'&&path.isAbsolute(input.report.path)&&
  typeof input.report.filename==='string'&&input.report.filename&&
  !/[/\\\u0000-\u001f]/.test(input.report.filename)&&plain(input.baseline)&&plain(input.observed)&&
  UUID.test(input.baseline.source_id??'')&&UUID.test(input.observed.source_id??'')&&
  input.baseline.source_id!==input.observed.source_id&&plain(input.pair)&&
  typeof input.actor==='string'&&input.actor.trim()&&typeof input.reason==='string'&&input.reason.trim(),
  'Use the complete original report, two native source identities, operation, workspace, source commit and reviewer.');
 for(const side of ['baseline','observed']){
  const source=input[side],meaning=source.interpretation;
  need(Array.isArray(source.columns)&&source.columns.length>0&&source.columns.length<=512&&Array.isArray(source.keys)&&
   source.keys.length===0&&plain(meaning)&&Array.isArray(meaning.columns)&&
   meaning.columns.length===source.columns.length&&typeof meaning.allow_approximate==='boolean'&&
   ['scope_note','null_note','time_note'].every(key=>typeof meaning[key]==='string'&&meaning[key].trim()),
   'Provide the complete ordered field mapping and interpretation for the original '+side+' source.');
  need(source.columns.every((column,index)=>plain(column)&&typeof column.source==='string'&&column.source&&
   typeof column.name==='string'&&column.name&&typeof column.type==='string'&&column.type&&typeof column.nullable==='boolean'&&
   plain(meaning.columns[index])&&meaning.columns[index].source===column.source&&
   ['tag','time','value','quality','attribute'].includes(meaning.columns[index].role)&&
   typeof meaning.columns[index].meaning==='string'&&meaning.columns[index].meaning.trim()&&
   ['units','timezone','precision'].every(key=>typeof meaning.columns[index][key]==='string'))&&
   new Set(source.columns.map(column=>column.source)).size===source.columns.length&&
   new Set(source.columns.map(column=>column.name)).size===source.columns.length&&
   source.keys.every(key=>source.columns.some(column=>column.name===key)),
   'Keep every original field, explicit native type, meaning and empty import keys in the '+side+' mapping.');
 }
 const pairInput=input.pair;
 need(typeof pairInput.name==='string'&&pairInput.name.trim()&&typeof pairInput.label==='string'&&pairInput.label.trim()&&
  Array.isArray(pairInput.columns)&&pairInput.columns.length>0&&Array.isArray(pairInput.windows)&&
  (pairInput.window_column===null||typeof pairInput.window_column==='string')&&typeof pairInput.notes==='string'&&
  pairInput.columns.every(column=>plain(column)&&['name','source','target','meaning'].every(key=>typeof column[key]==='string'&&column[key].trim())&&
   ['key','value'].includes(column.role)&&Array.isArray(column.source_map)&&column.source_map.length===0&&
   Array.isArray(column.target_map)&&column.target_map.length===0)&&
  pairInput.columns.some(column=>column.role==='key')&&
  pairInput.windows.every(window=>plain(window)&&typeof window.id==='string'&&window.id&&
   typeof window.start==='string'&&typeof window.end==='string'&&['native','lexical'].includes(window.basis)),
  'Provide the complete original pair definition; this intake editor preserves values with empty source and target maps.');
 const launch=new URL(url);
 need(['http:','https:'].includes(launch.protocol)&&!launch.username&&!launch.password&&launch.hash.length>1,
  'Use the original private browser launch URL.');
 const capability=launch.hash.slice(1),origin=launch.origin;
 launch.pathname='/timescale-intake/';launch.search='';
 const root=await prepare(outputDirectory);
 const inputBytes=Buffer.from(stable({schema:SCHEMA,input})+'\n');
 await retain(path.join(root,'intake-browser-input.json'),inputBytes);
 const inputHash=hash(inputBytes),stateFile=path.join(root,'intake-browser-receiving.json');
 let record=await exists(stateFile)?await readJson(stateFile):{
  schema:SCHEMA,input_sha256:inputHash,operation_id:input.operation_id,source_commit:input.source_commit,
  workspace_id:input.workspace_id,created_at:new Date().toISOString(),phase:'PREPARED',complete:false,steps:{}
 };
 need(record.schema===SCHEMA&&record.input_sha256===inputHash&&record.workspace_id===input.workspace_id&&plain(record.steps),
  'The original intake receiving binding changed.');
 const previouslyComplete=record.complete===true;
 let reportBytes=null,reportBytesOrigin='original-local-file';
 try{
  const fileInfo=await regular(input.report.path);
  need(fileInfo.size>0&&fileInfo.size<=256000000,'Use the complete original report within the native report size limit.');
  reportBytes=await fs.readFile(input.report.path);
  need(reportBytes.length===fileInfo.size&&hash(reportBytes)===input.report.sha256,
   'The complete original commissioning report bytes changed.');
 }catch(error){
  if(error.code!=='ENOENT')throw error;
  reportBytes=null;reportBytesOrigin='completed-original-native-upload';
 }
 await publish(stateFile,record);
 const engine=await engineFor(playwright);
 need(engine&&typeof engine.launchPersistentContext==='function','The installed Playwright Chromium engine is required.');
 let context,page;const errors=[];
 function uploadPayload(){
  need(reportBytes,'This incomplete original upload still needs its original local file or retained browser File.');
  return {name:input.report.filename,mimeType:'application/json',buffer:reportBytes};
 }
 function expectedBody(kind,body){
  const result=withoutId(body);
  // The browser retains byte count with the File. The native raw-upload
  // journal has exactly workspace_id, filename and sha256.
  if(kind==='retain')delete result.bytes;
  return result;
 }
 async function save(){record.updated_at=new Date().toISOString();await publish(stateFile,record);}
 async function idle(checkError=true){
  await page.locator('body[data-busy="false"]').waitFor({state:'attached',timeout:300000});
  const notice=page.locator('#notice');
  if(checkError&&await notice.getAttribute('data-level')==='error')throw new Error(await notice.innerText());
 }
 async function visibleAction(locator){await locator.click();await idle();}
 async function intake(){
  if(new URL(page.url()).pathname!=='/timescale-intake/'){
   await page.goto(launch.href,{waitUntil:'domcontentloaded',timeout:60000});await idle();
  }
 }
 async function screen(name){
  await intake();await page.locator('nav [data-screen="'+name+'"]').click();
  await page.locator('#screen-'+name).waitFor({state:'visible'});await idle(false);
 }
 async function get(route,allowMissing=false){
  need(route.startsWith('/api/'),'Use the original native read routes.');
  const response=await page.request.get(origin+route,{headers:{
   'X-DuckDB-Capability':capability,'X-DuckDB-Workspace-ID':input.workspace_id
  },timeout:300000});
  if(response.status()===404&&allowMissing)return null;
  need(response.ok(),'Original native read failed '+response.status()+' for '+route);
  const result=await response.json();
  if(result.workspace_id)need(result.workspace_id===input.workspace_id,'The original workspace identity changed.');
  return result;
 }
 async function detail(title,within=page){
  const container=within.locator('details').filter({has:page.getByText(title,{exact:true})});
  need(await container.count()===1,'Open the complete native '+title+' record.');
  return JSON.parse(await container.locator('pre').textContent());
 }
 async function localRequests(){
  await screen('requests');
  await visibleAction(page.getByRole('button',{name:'Refresh original requests',exact:true}));
  return page.locator('#screen-requests [data-request-id]').evaluateAll(nodes=>nodes.map(node=>{
   const detail=Array.from(node.querySelectorAll('details')).find(item=>item.querySelector('summary')?.textContent==='Complete original request and returned result');
   return JSON.parse(detail.querySelector('pre').textContent);
  }));
 }
 async function catalog(kind){
  let offset=0;const result=[],seen=new Set(),route=kind==='pair'?PAIR:API;
  for(;;){
   const pageResult=await get(route+'/operations?offset='+offset+'&limit=100');
   need(Array.isArray(pageResult.operations),'The original operation journal did not return its catalog.');
   for(const item of pageResult.operations){
    if(REQUEST.test(item.request_id??'')&&!seen.has(item.request_id)){seen.add(item.request_id);result.push(item);}
   }
   if(pageResult.next_offset===null||pageResult.next_offset===undefined)return result;
   need(Number.isSafeInteger(pageResult.next_offset)&&pageResult.next_offset>offset,'The original journal continuation did not advance.');
   offset=pageResult.next_offset;
  }
 }
 function matches(item,step){
  return item.kind===(step.kind==='pair'?'pairs':step.kind)&&REQUEST.test(item.request_id??'')&&plain(item.body)&&
   item.body.request_id===item.request_id&&(!step.request_id||step.request_id===item.request_id)&&
   stable(expectedBody(step.kind,item.body))===stable(step.expected_body);
 }
 async function findRequest(step){
  if(step.request_id){
   const remote=await get(requestRoute(step.kind,step.request_id),true);
   if(remote){need(matches(remote,step),'The complete original native request body changed.');return remote;}
   const local=(await localRequests()).find(item=>item.request_id===step.request_id);
   need(local&&local.kind===step.kind&&stable(expectedBody(step.kind,local.body))===stable(step.expected_body),
    'Reopen the original workspace and browser request before continuing this existing operation.');
   return local;
  }
  const locals=(await localRequests()).filter(item=>item.kind===step.kind&&
   stable(expectedBody(step.kind,item.body))===stable(step.expected_body));
  const candidates=[];
  for(const local of locals){
   const remote=await get(requestRoute(step.kind,local.request_id),true);
   if(remote)need(matches(remote,step),'The browser request and original native body differ.');
   candidates.push(remote??local);
  }
  if(!candidates.length){
   for(const item of await catalog(step.kind)){
    if(item.kind!==(step.kind==='pair'?'pairs':step.kind))continue;
    const full=item.body?item:await get(requestRoute(step.kind,item.request_id));
    if(matches(full,step))candidates.push(full);
   }
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>(a.state==='COMPLETE'?0:1)-(b.state==='COMPLETE'?0:1)||
   String(a.created_at??'').localeCompare(String(b.created_at??''))||a.request_id.localeCompare(b.request_id));
  step.request_id=candidates[0].request_id;step.matching_original_requests=candidates.map(item=>item.request_id);await save();
  return candidates[0];
 }
 async function nativeRow(id){
  await screen('requests');
  await visibleAction(page.getByRole('button',{name:'Refresh original requests',exact:true}));
  for(;;){
   const row=page.locator('#screen-requests [data-native-request-id="'+id+'"]');
   if(await row.count()){
    await visibleAction(row.getByRole('button',{name:'Reopen native request',exact:true}));return row;
   }
   const native=page.locator('#screen-requests > section').filter({has:page.getByRole('heading',{name:'Native intake journal',exact:true})});
   const next=native.getByRole('button',{name:'Next',exact:true});
   need(await next.count()===1&&await next.isEnabled(),'The original request is absent from its complete native journal.');
   await visibleAction(next);
  }
 }
 async function reopenPair(step){
  const target=new URL('/reconciliation/',origin);target.hash=capability;
  await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:60000});await idle();
  await page.locator('nav [data-screen="requests"]').click();
  await page.locator('#screen-requests').waitFor({state:'visible'});await idle(false);
  await visibleAction(page.getByRole('button',{name:'Refresh request catalogs',exact:true}));
  let local=page.locator('[data-request-id="'+step.request_id+'"]');
  if(!await local.count()){
   const section=page.locator('#screen-requests > section').filter({has:page.getByRole('heading',{name:'Reconciliation journal',exact:true})});
   for(;;){
    const row=section.locator('[data-native-request-id="'+step.request_id+'"]');
    if(await row.count()){await visibleAction(row.getByRole('button',{name:'Reopen original request',exact:true}));break;}
    const next=section.getByRole('button',{name:'Next',exact:true});
    need(await next.count()===1&&await next.isEnabled(),'The original saved pair request is absent from its native journal.');
    await visibleAction(next);
   }
   local=page.locator('[data-request-id="'+step.request_id+'"]');
  }
  need(await local.count()===1,'The original pair request could not be reopened.');
  await visibleAction(local.getByRole('button',{name:'Inspect original request',exact:true}));
  local=page.locator('[data-request-id="'+step.request_id+'"]');
  const saved=local.getByRole('button',{name:'Open saved result',exact:true});
  await visibleAction(await saved.count()?saved:local.getByRole('button',{name:'Continue original request',exact:true}));
 }
 async function reopen(step){
  const locals=await localRequests();
  if(locals.some(item=>item.request_id===step.request_id)){
   const local=page.locator('[data-request-id="'+step.request_id+'"]');
   await visibleAction(local.getByRole('button',{name:'Continue original request',exact:true}));
  }else if(step.kind==='pair')await reopenPair(step);
  else{
   let row=await nativeRow(step.request_id);
   const remote=await get(requestRoute(step.kind,step.request_id));
   need(matches(remote,step),'The original native request body changed.');
   if(remote.state==='COMPLETE')await visibleAction(row.getByRole('button',{name:'Open returned result',exact:true}));
   else if(step.kind==='retain'){
    await row.getByLabel('Restore original report for this upload',{exact:true}).setInputFiles(uploadPayload());await idle();
    const local=page.locator('[data-request-id="'+step.request_id+'"]');
    if(await local.count())await visibleAction(local.getByRole('button',{name:'Continue original request',exact:true}));
    else need((await get(requestRoute(step.kind,step.request_id))).state==='COMPLETE','The exact original upload request was not retained.');
   }else await visibleAction(row.getByRole('button',{name:'Continue retained native operation',exact:true}));
  }
  const remote=await get(requestRoute(step.kind,step.request_id));
  need(matches(remote,step)&&remote.state==='COMPLETE'&&plain(remote.result),
   'The original browser operation has not returned its complete native result.');
  step.result=remote.result;step.complete=true;step.completed_at=new Date().toISOString();await save();return remote.result;
 }
 async function step(name,kind,body,create){
  let item=record.steps[name];
  if(item)need(item.kind===kind&&stable(item.expected_body)===stable(body),'The prepared '+name+' operation changed.');
  else{item={kind,expected_body:body,prepared_at:new Date().toISOString()};record.steps[name]=item;await save();}
  record.phase=name.toUpperCase();await save();
  const prior=await findRequest(item);
  if(prior)return reopen(item);
  need(!item.complete&&!item.request_id,'The original completed request cannot be replaced.');
  try{await create();}
  catch(error){
   try{await findRequest(item);}catch(reconcileError){item.reconcile_error=String(reconcileError.message);}
   item.last_error=String(error.message);await save();throw error;
  }
  need(await findRequest(item),'The browser did not retain its complete original request before dispatch.');
  return reopen(item);
 }
 async function prepareSourceUI(side,report){
  const source=input[side],descriptor=report.sources.find(item=>item.id===source.source_id);
  need(descriptor&&descriptor.role===(side==='baseline'?'BASELINE':'OBSERVED')&&
   Array.isArray(descriptor.columns)&&descriptor.columns.length===source.columns.length&&
   descriptor.columns.every((column,index)=>column.name===source.columns[index].source),
   'The '+side+' field mapping must cover every original field in its native order and source role.');
  await reopen(record.steps.retain);
  const choice=page.locator('#screen-reports [data-source-id="'+source.source_id+'"]');
  need(await choice.count()===1,'The complete report did not expose its original '+side+' source.');
  await visibleAction(choice);
  const shown=await detail('Complete native source descriptor',page.locator('#screen-source'));
  need(stable(shown)===stable(descriptor),'The visible source descriptor differs from the complete original report.');
  const preview=await get(API+'/reports/'+report.report_id+'/sources/'+source.source_id+'?offset=0&limit=25');
  need(preview.report_id===report.report_id&&preview.source_id===source.source_id&&preview.source_rows===descriptor.rows&&
   stable(preview.columns)===stable(descriptor.columns)&&Array.isArray(preview.rows),
   'The browser preview changed its complete original source identity.');
  if(preview.rows.length){
   const values=await page.locator('#source-preview .source-table tbody tr').evaluateAll(rows=>rows.map(row=>
    Array.from(row.querySelectorAll('td')).map(cell=>{
     const marker=cell.querySelector('.native-marker');
     return marker?(marker.textContent==='NULL'?null:''):cell.textContent;
    })));
   need(stable(values)===stable(preview.rows),'The visible source preview did not preserve original text, NULL and empty strings.');
  }
  record.source_previews={...record.source_previews,[side]:{report_id:report.report_id,source_id:source.source_id,
   rows:descriptor.rows,columns:descriptor.columns.length,preview_rows:preview.rows.length,
   preview_sha256:hash(stable(preview)),native_sha256:descriptor.sha256,table_digest:descriptor.tableDigest}};await save();
  const clearKeys=page.getByRole('button',{name:'Clear import-key selection',exact:true});
  if(await clearKeys.count())await visibleAction(clearKeys);
  await page.getByLabel('Find a field',{exact:true}).fill('');
  await visibleAction(page.getByRole('button',{name:'Apply field filter',exact:true}));
  let mappingPage=0;
  async function rowFor(index){
   const targetPage=Math.floor(index/40),mapping=page.locator('#source-column-mapping');
   while(mappingPage<targetPage){await visibleAction(mapping.getByRole('button',{name:'Next',exact:true}));mappingPage++;}
   while(mappingPage>targetPage){await visibleAction(mapping.getByRole('button',{name:'Previous',exact:true}));mappingPage--;}
   const row=mapping.locator('tr[data-source-field]').nth(index%40);
   need(await row.getAttribute('data-source-field')===source.columns[index].source,'The complete field mapping order changed.');
   return row;
  }
  for(const [index,column]of source.columns.entries()){
   const row=await rowFor(index),meaning=source.interpretation.columns[index];
   await row.getByLabel('SQL column',{exact:true}).fill(column.name);
   await row.getByLabel('DuckDB type for '+column.source,{exact:true}).fill(column.type);
   await row.getByLabel('Allow NULL for '+column.source,{exact:true}).setChecked(column.nullable);
   await row.getByLabel('Field role',{exact:true}).selectOption(meaning.role);
   await row.getByLabel('Meaning',{exact:true}).fill(meaning.meaning);
   await row.getByLabel('Units',{exact:true}).fill(meaning.units);
   await row.getByLabel('Time zone',{exact:true}).fill(meaning.timezone);
   await row.getByLabel('Precision',{exact:true}).fill(meaning.precision);
  }
  await page.getByLabel('Source scope',{exact:true}).fill(source.interpretation.scope_note);
  await page.getByLabel('Null and empty-string handling',{exact:true}).fill(source.interpretation.null_note);
  await page.getByLabel('Time interpretation',{exact:true}).fill(source.interpretation.time_note);
  await page.getByLabel('Allow explicitly selected approximate DOUBLE conversions',{exact:true}).setChecked(source.interpretation.allow_approximate);
 }
 function checkReview(review,side,report){
  const source=input[side],descriptor=report.sources.find(item=>item.id===source.source_id),native=review.timescale_source;
  need(ID.test(review.review_id??'')&&ID.test(review.manifest_sha256??'')&&review.row_count===descriptor.rows&&
   Array.isArray(review.columns)&&review.columns.length===source.columns.length&&Array.isArray(review.keys)&&
   native?.report_id===report.report_id&&native.source_id===source.source_id&&native.native_sha256===descriptor.sha256&&
   native.table_digest===descriptor.tableDigest&&stable(native.native_columns)===stable(descriptor.columns)&&
   native.descriptor?.workspace_id===input.workspace_id,
   'The original '+side+' review did not preserve its complete native source and mapping.');
 }
 function checkEdition(value,review){
  need(value.edition_id===review.review_id&&value.review_id===review.review_id&&value.manifest_sha256===review.manifest_sha256&&
   value.row_count===review.row_count&&stable(value.columns)===stable(review.columns)&&
   stable(value.keys)===stable(review.keys)&&stable(value.timescale_source)===stable(review.timescale_source),
   'The imported immutable edition differs from its complete original source review.');
 }
 async function preparePairUI(baseline,observed){
  await screen('pair');await visibleAction(page.getByRole('button',{name:'New pair',exact:true}));
  await page.getByLabel('Pair name',{exact:true}).fill(pairInput.name);
  await page.getByLabel('Display label',{exact:true}).fill(pairInput.label);
  for(const [side,id]of [['source',baseline.edition_id],['target',observed.edition_id]]){
   await page.getByLabel('Open an exact earlier edition',{exact:true}).fill(id);
   await page.getByLabel('Use as',{exact:true}).selectOption(side);
   await visibleAction(page.getByRole('button',{name:'Open edition',exact:true}));
  }
  for(const [index,column]of pairInput.columns.entries()){
   await visibleAction(page.getByRole('button',{name:'Add field',exact:true}));
   const row=page.locator('#screen-pair tr[data-pair-column="'+index+'"]');
   await row.locator('input').fill(column.name);
   await row.locator('select').nth(0).selectOption(column.source);
   await row.locator('select').nth(1).selectOption(column.target);
   await row.locator('select').nth(2).selectOption(column.role);
   await row.locator('textarea').fill(column.meaning);
  }
  await page.getByLabel('Window field',{exact:true}).selectOption(pairInput.window_column??'');
  for(const [index,window]of pairInput.windows.entries()){
   await visibleAction(page.getByRole('button',{name:'Add window',exact:true}));
   const fields=page.locator('#screen-pair [data-pair-window="'+index+'"]');
   await fields.getByLabel('Window name',{exact:true}).fill(window.id);
   await fields.getByLabel('Comparison basis',{exact:true}).selectOption(window.basis);
   await fields.getByLabel('Start, included',{exact:true}).fill(window.start);
   await fields.getByLabel('End, excluded',{exact:true}).fill(window.end);
  }
  await page.locator('#screen-pair > section').filter({has:page.getByRole('heading',{name:'Operator notes',exact:true})}).locator('textarea').fill(pairInput.notes);
  await visibleAction(page.getByRole('button',{name:'Review pair definition',exact:true}));
  const review=await detail('Complete native pair review',page.locator('#pair-review-result'));
  need(review.workspace_id===input.workspace_id&&ID.test(review.review_sha256??'')&&
   review.definition?.source_edition===baseline.edition_id&&review.definition.target_edition===observed.edition_id,
   'The complete native pair review changed the original editions.');
  return {workspace_id:input.workspace_id,expected_revision:0,definition:review.definition,review_sha256:review.review_sha256};
 }
 async function capture(name){
  const file=path.join(root,name+'.png');await page.screenshot({path:file,fullPage:true,animations:'disabled'});await fs.chmod(file,0o600);
  const bytes=await fs.readFile(file);return{name:path.basename(file),bytes:bytes.length,sha256:hash(bytes)};
 }
 async function openSavedPair(pair){
  const target=new URL('/reconciliation/',origin);target.searchParams.set('pair',pair.pair_id);target.hash=capability;
  await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:60000});await idle();
  await page.locator('#screen-editor').waitFor({state:'visible'});
  need((await page.getByLabel('Pair name',{exact:true}).inputValue())===pair.definition.name&&
   (await page.getByLabel('Source edition',{exact:true}).inputValue())===pair.definition.source_edition&&
   (await page.getByLabel('Target edition',{exact:true}).inputValue())===pair.definition.target_edition,
   'The saved-pair handover did not open the original pair and both original editions.');
  const saved=await get(PAIR+'/pairs/'+pair.pair_id);
  need(saved.pair_id===pair.pair_id&&saved.revision===pair.revision&&
   saved.definition_sha256===pair.definition_sha256&&stable(saved.definition)===stable(pair.definition),
   'The native saved pair changed before its original reconciliation handover.');
 }
 try{
  context=await engine.launchPersistentContext(path.join(root,'browser-profile'),{
   headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
   ...(chromium?{executablePath:chromium}:{}),
   args:['--disable-dev-shm-usage','--disk-cache-size=1','--media-cache-size=1','--disable-background-networking']
  });
  page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(String(error.message)));
  await page.goto(launch.href,{waitUntil:'domcontentloaded',timeout:60000});await idle();
  need((await page.locator('#workspace-id').textContent())===input.workspace_id,'The visible browser is attached to another native workspace.');
  const identity=await get('/api/identity');need(identity.workspace_id===input.workspace_id,'The original native workspace identity changed.');
  const retained=await step('retain','retain',{workspace_id:input.workspace_id,filename:input.report.filename,sha256:input.report.sha256},async()=>{
   await screen('reports');await page.locator('#report-file').setInputFiles(uploadPayload());
   await visibleAction(page.getByRole('button',{name:'Retain report',exact:true}));
  });
  need(retained.report_id===input.report.sha256&&retained.sha256===input.report.sha256&&
   Number.isSafeInteger(retained.bytes)&&retained.bytes>0&&retained.bytes<=256000000&&
   retained.filename===input.report.filename,'The visible upload did not retain the complete original commissioning report.');
  const report=await get(API+'/reports/'+retained.report_id);
  need(report.report_id===retained.report_id&&report.sha256===input.report.sha256&&report.bytes===retained.bytes&&
   report.filename===input.report.filename&&Array.isArray(report.sources),'The complete original native source catalog changed.');
  if(reportBytes===null){
   // Only a COMPLETE original request reached this point. The retained file
   // route reads those same immutable bytes; it never captures another source.
   const original=await page.request.get(origin+API+'/reports/'+report.report_id+'/file',{headers:{
    'X-DuckDB-Capability':capability,'X-DuckDB-Workspace-ID':input.workspace_id
   },timeout:300000});
   need(original.ok(),'The completed original upload could not return its retained report file.');
   reportBytes=await original.body();
   need(reportBytes.length===report.bytes&&hash(reportBytes)===input.report.sha256,
    'The retained complete commissioning report bytes changed.');
  }
  need(retained.bytes===reportBytes.length,'The complete original commissioning report byte count changed.');
  await retain(path.join(root,'original-report-catalog.json'),Buffer.from(JSON.stringify(report,null,2)+'\n'));
  // Exercise the original browser's complete-file download, not a projected
  // source preview or a reconstructed commissioning report.
  await reopen(record.steps.retain);
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:300000}),
   visibleAction(page.getByRole('button',{name:'Download original report',exact:true}))]);
  need(!await download.failure(),'The original complete report download failed.');
  const downloaded=await fs.readFile(await download.path());
  need(downloaded.equals(reportBytes),'The browser download differs from the exact original report bytes.');
  record.original_report={report_id:report.report_id,filename:input.report.filename,bytes:reportBytes.length,
   sha256:input.report.sha256,bytes_origin:reportBytesOrigin,download_verified:true};await save();await download.delete();
  const imported={};
  for(const side of ['baseline','observed']){
   const source=input[side],body={workspace_id:input.workspace_id,report_id:report.report_id,source_id:source.source_id,
    columns:source.columns,interpretation:source.interpretation,keys:source.keys};
   let sourcePrepared=false;
   if(!record.source_previews?.[side]){await prepareSourceUI(side,report);sourcePrepared=true;}
   const review=await step(side+'_review','review',body,async()=>{
    if(!sourcePrepared)await prepareSourceUI(side,report);
    await screen('source');await visibleAction(page.getByRole('button',{name:'Review complete source',exact:true}));
   });
   checkReview(review,side,report);
   imported[side]=await step(side+'_import','import',{workspace_id:input.workspace_id,review_id:review.review_id},async()=>{
    await reopen(record.steps[side+'_review']);
    await visibleAction(page.getByRole('button',{name:'Import this reviewed edition',exact:true}));
   });
   checkEdition(imported[side],review);
  }
  let preparedPair=null;
  if(!record.steps.pair)preparedPair=await preparePairUI(imported.baseline,imported.observed);
  const pairBody=record.steps.pair?.expected_body??preparedPair;
  const pair=await step('pair','pair',pairBody,async()=>{
   if(!preparedPair)preparedPair=await preparePairUI(imported.baseline,imported.observed);
   need(stable(preparedPair)===stable(pairBody),'The original prepared pair review changed.');
   await screen('pair');await visibleAction(page.getByRole('button',{name:'Save reviewed pair',exact:true}));
  });
  need(ID.test(pair.pair_id??'')&&pair.revision===1&&ID.test(pair.definition_sha256??'')&&
   pair.definition?.source_edition===imported.baseline.edition_id&&pair.definition.target_edition===imported.observed.edition_id&&
   stable(pair.definition)===stable(pairBody.definition),'The complete saved pair differs from the original native review.');
  await openSavedPair(pair);
  const screenshots=[await capture('timescale-original-pair-handover')];
  await page.setViewportSize({width:480,height:900});
  screenshots.push(await capture('timescale-original-pair-handover-mobile'));
  need(errors.length===0,'The real browser reported an application error: '+errors.join('; '));
  record.phase='COMPLETE';record.complete=true;record.completed_at=new Date().toISOString();
  record.result={schema:SCHEMA,complete:true,operation_id:input.operation_id,source_commit:input.source_commit,
   workspace_id:input.workspace_id,report_id:report.report_id,baseline_edition:imported.baseline.edition_id,
   observed_edition:imported.observed.edition_id,pair_id:pair.pair_id,pair_revision:pair.revision,
   definition:pair.definition,definition_sha256:pair.definition_sha256,
   request_ids:Object.fromEntries(Object.entries(record.steps).map(([name,item])=>[name,item.request_id])),
   original_report:record.original_report,source_previews:record.source_previews??{},browser_errors:errors,screenshots,directory:root,
   continuation:'Pass this actual saved definition to the original reconciliation browser receiver, then receive the complete original report and portable warehouse through the existing typed client.'};
  await save();return record.result;
 }catch(error){
  record.phase=previouslyComplete?'COMPLETE':'RETURNED_ERROR';record.complete=previouslyComplete;
  record.last_error={message:String(error.message).split(capability).join('[private launch]'),at:new Date().toISOString()};
  try{await save();}catch(storageError){error.receivingStorageError=String(storageError.message);}
  throw error;
 }finally{if(context)await context.close();}
}
