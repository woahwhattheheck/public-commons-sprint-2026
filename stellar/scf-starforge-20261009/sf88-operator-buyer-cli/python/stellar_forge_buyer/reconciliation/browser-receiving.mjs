// SPDX-License-Identifier: MIT
// Actual browser receiving through the original DuckDB owner's visible controls.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const SCHEMA='stellar-forge.duckdb-reconciliation.browser-receiving.v1';
const API='/api/reconciliation';
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
function requestRoute(family,id){return (family==='export'?'/api':API)+'/requests/'+id;}

/**
 * The supplied URL is the ORIGINAL private DuckDB browser launch URL.
 * input = {operation_id, source_commit, workspace_id, definition, actor, reason}.
 * The caller owns the original native server and the complete typed-client
 * receiving/reopen continuation. This function closes only its browser context.
 */
export async function runReconciliationBrowserReceiving({url,input,outputDirectory,playwright,chromium}={}){
 need(plain(input)&&typeof input.operation_id==='string'&&input.operation_id.length>0&&
  /^[a-f0-9]{40}$/.test(input.source_commit??'')&&REQUEST.test(input.workspace_id??'')&&
  plain(input.definition)&&ID.test(input.definition.source_edition??'')&&ID.test(input.definition.target_edition??'')&&
  typeof input.actor==='string'&&input.actor.trim()&&typeof input.reason==='string'&&input.reason.trim(),
  'Use the complete original operation, source commit, workspace, definition, reviewer and observation.');
 const launch=new URL(url);
 need(['http:','https:'].includes(launch.protocol)&&!launch.username&&!launch.password&&launch.hash.length>1,
  'Use the original private browser launch URL.');
 const capability=launch.hash.slice(1),origin=launch.origin;
 launch.pathname='/reconciliation/';launch.search='';
 const root=await prepare(outputDirectory);
 const inputBytes=Buffer.from(stable({schema:SCHEMA,input})+'\n');
 await retain(path.join(root,'browser-input.json'),inputBytes);
 const inputHash=hash(inputBytes),stateFile=path.join(root,'browser-receiving.json');
 let record=await exists(stateFile)?await readJson(stateFile):{
  schema:SCHEMA,input_sha256:inputHash,operation_id:input.operation_id,source_commit:input.source_commit,
  workspace_id:input.workspace_id,created_at:new Date().toISOString(),phase:'PREPARED',complete:false,steps:{}
 };
 need(record.schema===SCHEMA&&record.input_sha256===inputHash&&record.workspace_id===input.workspace_id&&plain(record.steps),
  'The original browser receiving binding changed.');
 const previouslyComplete=record.complete===true;
 await publish(stateFile,record);
 const engine=await engineFor(playwright);
 need(engine&&typeof engine.launchPersistentContext==='function','The installed Playwright Chromium engine is required.');
 let context,page;
 const errors=[];
 async function save(){record.updated_at=new Date().toISOString();await publish(stateFile,record);}
 async function idle(checkError=true){
  await page.locator('body[data-busy="false"]').waitFor({state:'attached',timeout:300000});
  const notice=page.locator('#notice');
  if(checkError&&await notice.getAttribute('data-level')==='error')throw new Error(await notice.innerText());
 }
 async function visibleAction(locator){await locator.click();await idle();}
 async function screen(name){
  await page.locator('nav [data-screen="'+name+'"]').click();
  await page.locator('#screen-'+name).waitFor({state:'visible'});await idle(false);
 }
 async function get(route,allowMissing=false){
  need(route.startsWith('/api/'),'Only original native read routes are used here.');
  const response=await page.request.get(origin+route,{headers:{
   'X-DuckDB-Capability':capability,'X-DuckDB-Workspace-ID':input.workspace_id
  },timeout:300000});
  if(response.status()===404&&allowMissing)return null;
  need(response.ok(),'Original native read failed '+response.status()+' for '+route);
  const result=await response.json();
  if(result.workspace_id)need(result.workspace_id===input.workspace_id,'The original workspace identity changed.');
  return result;
 }
 async function localRequests(){
  await screen('requests');
  await visibleAction(page.getByRole('button',{name:'Refresh request catalogs',exact:true}));
  return page.locator('#screen-requests [data-request-id]').evaluateAll(nodes=>nodes.map(node=>{
   const detail=Array.from(node.querySelectorAll('details')).find(item=>item.querySelector('summary')?.textContent==='Complete original request body');
   return {request_id:node.dataset.requestId,route:node.dataset.requestRoute,state:node.dataset.requestState,
    body:JSON.parse(detail.querySelector('pre').textContent)};
  }));
 }
 async function catalog(family){
  const route=family==='export'?'/api/catalog/operations':API+'/operations';
  let offset=0;const rows=[],seen=new Set();
  for(;;){
   const result=await get(route+'?offset='+offset+'&limit=100');
   for(const item of result.operations??[]){
    if(REQUEST.test(item.request_id??'')&&!seen.has(item.request_id)){rows.push(item);seen.add(item.request_id);}
   }
   if(result.next_offset===null||result.next_offset===undefined)return rows;
   need(Number.isSafeInteger(result.next_offset)&&result.next_offset>offset,'The original request continuation did not advance.');
   offset=result.next_offset;
  }
 }
 async function findRequest(step,family,route){
  if(step.request_id){
   const remote=await get(requestRoute(family,step.request_id),true);
   if(remote){need(stable(withoutId(remote.body))===stable(step.expected_body),'The original native request body changed.');return remote;}
   const local=(await localRequests()).find(item=>item.request_id===step.request_id);
   need(local&&local.route===route&&stable(withoutId(local.body))===stable(step.expected_body),'The retained original request body is unavailable at this browser origin.');
   return local;
  }
  const locals=(await localRequests()).filter(item=>item.route===route&&stable(withoutId(item.body))===stable(step.expected_body));
  const candidates=[];
  for(const item of locals){
   const remote=await get(requestRoute(family,item.request_id),true);candidates.push(remote??item);
  }
  // A host restart may choose another port; its original native journal still
  // retains the complete request if the browser's origin storage differs.
  if(!candidates.length){
   for(const item of await catalog(family)){
    const kind=family==='export'?item.route:API+'/'+item.kind;
    if(kind!==route)continue;
    const full=item.body?item:await get(requestRoute(family,item.request_id));
    if(stable(withoutId(full.body))===stable(step.expected_body))candidates.push(full);
   }
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>(a.state==='COMPLETE'?0:1)-(b.state==='COMPLETE'?0:1)||
   String(a.created_at??'').localeCompare(String(b.created_at??''))||a.request_id.localeCompare(b.request_id));
  const chosen=candidates[0];
  step.request_id=chosen.request_id;step.matching_original_requests=candidates.map(item=>item.request_id);await save();
  return chosen;
 }
 async function adoptVisibleRequest(id,family){
  await screen('requests');
  await visibleAction(page.getByRole('button',{name:'Refresh request catalogs',exact:true}));
  let local=page.locator('[data-request-id="'+id+'"]');
  if(await local.count())return local;
  const title=family==='export'?'Original dataset export journal':'Reconciliation journal';
  const section=page.locator('#screen-requests > section').filter({has:page.getByRole('heading',{name:title,exact:true})});
  for(;;){
   const remote=section.locator('[data-native-request-id="'+id+'"]');
   if(await remote.count()){
    await visibleAction(remote.getByRole('button',{name:'Reopen original request',exact:true}));
    local=page.locator('[data-request-id="'+id+'"]');need(await local.count()===1,'The complete original browser request was not reopened.');return local;
   }
   const next=section.getByRole('button',{name:'Next',exact:true});
   need(await next.count()===1&&await next.isEnabled(),'The original native request is absent from its complete journal.');
   await visibleAction(next);
  }
 }
 async function reopen(step,family){
  let local=await adoptVisibleRequest(step.request_id,family);
  await visibleAction(local.getByRole('button',{name:'Inspect original request',exact:true}));
  local=page.locator('[data-request-id="'+step.request_id+'"]');
  const saved=local.getByRole('button',{name:'Open saved result',exact:true});
  if(await saved.count())await visibleAction(saved);
  else await visibleAction(local.getByRole('button',{name:'Continue original request',exact:true}));
  const remote=await get(requestRoute(family,step.request_id));
  need(remote.state==='COMPLETE'&&plain(remote.result)&&stable(withoutId(remote.body))===stable(step.expected_body),
   'The original browser request has not returned its complete native result.');
  step.result=remote.result;step.complete=true;step.completed_at=new Date().toISOString();await save();return remote.result;
 }
 async function step(name,route,body,create){
  const family=route===API+'/exports'?'export':'reconciliation';
  let item=record.steps[name];
  if(item)need(stable(item.expected_body)===stable(body),'The prepared '+name+' operation changed.');
  else{item={route,family,expected_body:body,prepared_at:new Date().toISOString()};record.steps[name]=item;await save();}
  record.phase=name.toUpperCase();await save();
  const prior=await findRequest(item,family,route);
  if(prior)return reopen(item,family);
  need(!item.complete&&!item.request_id,'The original completed browser request cannot be replaced.');
  try{await create();}
  catch(error){
   try{await findRequest(item,family,route);}catch(reconcileError){item.reconcile_error=String(reconcileError.message);}
   item.last_error=String(error.message);await save();throw error;
  }
  const returned=await findRequest(item,family,route);
  need(returned,'The browser did not retain the original request before dispatch.');
  return reopen(item,family);
 }
 async function detail(title,within){
  const container=within??page;
  const element=container.locator('details').filter({has:page.getByText(title,{exact:true})});
  need(await element.count()===1,'Open the complete native '+title+' record.');
  return JSON.parse(await element.locator('pre').textContent());
 }
 async function capture(name){
  const file=path.join(root,name+'.png');
  await page.screenshot({path:file,fullPage:true,animations:'disabled'});
  await fs.chmod(file,0o600);
  const bytes=await fs.readFile(file);return{name:path.basename(file),bytes:bytes.length,sha256:hash(bytes)};
 }

 function normalizedCell(value){
  return plain(value)&&Object.hasOwn(value,'text')&&Object.hasOwn(value,'type')?(value.type==='null'?null:value.text):value;
 }
 function normalizedDisplay(value){
  const raw=normalizedCell(value);return raw===null||raw===undefined?'NULL':raw===''?'EMPTY STRING':typeof raw==='object'?JSON.stringify(raw):String(raw);
 }
 function normalizedObjects(native,visibleColumns){
  need(Array.isArray(native.columns)&&Array.isArray(native.rows),'Read the complete native conversion page.');
  const names=native.columns.map(column=>typeof column==='string'?column:column.name);
  need(visibleColumns.every(name=>names.includes(name)),'The original conversion page lacks a displayed field.');
  return native.rows.map(row=>Array.isArray(row)?Object.fromEntries(names.map((name,index)=>[name,row[index]])):row);
 }
 async function assertNormalizedGrid(locator,native,visibleColumns){
  const objects=normalizedObjects(native,visibleColumns);
  const visible=await locator.locator('tbody tr').evaluateAll(lines=>lines.map(line=>Array.from(line.querySelectorAll('td.value')).map(cell=>cell.textContent)).filter(cells=>cells.length));
  need(stable(visible)===stable(objects.map(row=>visibleColumns.map(name=>normalizedDisplay(row[name])))),
   'The visible conversion page differs from its complete native original and canonical values.');
  return objects;
 }
 async function conversionPreviewAction(locator,column,side,offset){
  const pending=page.waitForResponse(response=>{
   try{
    if(new URL(response.url()).pathname!==API+'/normalization-preview'||response.request().method()!=='POST')return false;
    const body=response.request().postDataJSON();
    return body.side===side&&body.column_name===column.name&&(body.offset??0)===offset;
   }catch{return false;}
  },{timeout:300000});
  pending.catch(()=>{});
  await visibleAction(locator);
  const response=await pending;
  need(response.ok(),'The original conversion preview returned '+response.status()+'.');
  const result=await response.json();
  need(result.workspace_id===input.workspace_id&&result.side===side&&result.column_name===column.name&&
   result.offset===offset&&ID.test(result.review_sha256??''),'The conversion preview changed its original definition binding.');
  return result;
 }
 async function observeDraftNormalizationsUI(){
  const observed=[],previews=[];let reviewId=null;
  const visibleColumns=['side','row','column_name','original_value_text','original_unit','canonical_value_text','canonical_unit','state','reason'];
  for(const [index,column] of input.definition.columns.entries()){
   const policy=column.normalization;if(policy===undefined)continue;
   need(plain(policy)&&['numeric-affine','time-utc'].includes(policy.mode),'The original normalization policy must be complete before receiving.');
   const controls=page.locator('[data-normalization-column="'+index+'"]');
   need(await controls.count()===1,'The complete original normalization controls are absent from the definition.');
   const value=name=>controls.locator('[data-normalization-path="'+name+'"]').inputValue();
   const actual={mode:await value('mode'),canonical_type:await value('canonical_type'),source:{},target:{},basis:await value('basis')};
   if(policy.mode==='numeric-affine'){
    actual.canonical_unit=await value('canonical_unit');
    for(const side of ['source','target'])actual[side]={unit:await value(side+'.unit'),scale:await value(side+'.scale'),offset:await value(side+'.offset')};
   }else{
    for(const side of ['source','target'])actual[side]={format:await value(side+'.format'),offset:await value(side+'.offset')};
   }
   need(stable(actual)===stable(policy),'The visible normalization changed its original literal policy.');
   observed.push({column_index:index,column_name:column.name,normalization:actual});
   for(const side of ['source','target']){
    let offset=0,total=null,rows=0,pages=0,last=null;const digest=createHash('sha256'),states={};
    for(;;){
     const action=offset===0?controls.locator('[data-normalization-preview-action="'+side+'"]'):
      controls.locator('[data-normalization-preview="'+side+'"]').getByRole('button',{name:'Next',exact:true});
     const native=await conversionPreviewAction(action,column,side,offset);
     if(reviewId===null)reviewId=native.review_sha256;
     need(native.review_sha256===reviewId,'The original definition changed between conversion preview pages.');
     const preview=controls.locator('[data-normalization-preview="'+side+'"]');
     const objects=await assertNormalizedGrid(preview.locator(':scope > .table-scroll'),native,visibleColumns);
     if(total===null)total=native.total;
     need(Number.isSafeInteger(total)&&total>=0&&native.total===total,'The immutable original conversion-preview total changed.');
     digest.update(stable(native.rows)+'\n');pages++;rows+=objects.length;
     if(objects.length)last=objects[0];
     for(const row of objects){const state=String(normalizedCell(row.state));states[state]=(states[state]||0)+1;}
     if(native.next_offset===null||native.next_offset===undefined)break;
     need(Number.isSafeInteger(native.next_offset)&&native.next_offset>offset,'The original conversion preview continuation did not advance.');
     offset=native.next_offset;
    }
    need(rows===total,'The conversion preview did not include every original observation for its side and field.');
    if(last){
     const preview=controls.locator('[data-normalization-preview="'+side+'"]');
     await visibleAction(preview.getByRole('button',{name:'Inspect conversion',exact:true}).first());
     const inspected=await detail('Complete recorded normalization',preview);
     need(stable(inspected)===stable(last),'The visible preview inspection changed its exact original conversion record.');
    }
    previews.push({column_index:index,column_name:column.name,side,total,rows,pages,states,
     ordered_page_rows_sha256:digest.digest('hex'),inspected_original_conversion:last});
   }
  }
  if(observed.length){
   record.observed_normalization_previews={complete:true,review_sha256:reviewId,controls:observed,pages:previews,completed_at:new Date().toISOString()};
   await save();
  }
  return reviewId;
 }

 async function preparePairUI(){
  await screen('pairs');await visibleAction(page.getByRole('button',{name:'New pair',exact:true}));
  await page.locator('#screen-editor input[type="file"]').setInputFiles({
   name:'original-definition.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input.definition))
  });
  await idle();
  need((await page.getByLabel('Pair name',{exact:true}).inputValue())===input.definition.name,'The complete original definition was not imported.');
  const observedRules=[];
  for(const [index,column] of input.definition.columns.entries()){
   const rule=column.comparison;if(!plain(rule)||rule.mode!=='numeric-tolerance')continue;
   const controls=page.locator('[data-comparison-column="'+index+'"]');
   need(await controls.count()===1,'The original numeric field rule is absent from the visible definition.');
   const values={
    mode:await controls.getByLabel(/^Comparison mode(?:\s|$)/).inputValue(),
    absolute:await controls.getByLabel(/^Absolute allowance(?:\s|$)/).inputValue(),
    relative:await controls.getByLabel(/^Relative fraction(?:\s|$)/).inputValue(),
    unit:await controls.getByLabel(/^Comparison unit(?:\s|$)/).inputValue(),
    nulls:await controls.getByLabel('Two SQL NULL values',{exact:true}).inputValue(),
    basis:await controls.getByLabel(/^Review basis(?:\s|$)/).inputValue()
   };
   need(stable(values)===stable(rule),'The visible numeric rule changed its original literal values.');
   observedRules.push({column_index:index,column_name:column.name,comparison:values});
  }
  if(observedRules.length){record.observed_rule_controls=observedRules;await save();}
  const normalizationReview=await observeDraftNormalizationsUI();
  await visibleAction(page.getByRole('button',{name:'Review mapping',exact:true}));
  const review=await detail('Complete native mapping review',page.locator('#mapping-review'));
  need(review.workspace_id===input.workspace_id&&review.definition.source_edition===input.definition.source_edition&&
   review.definition.target_edition===input.definition.target_edition&&ID.test(review.review_sha256??''),
   'The visible mapping review changed its original source editions.');
  if(normalizationReview)need(review.review_sha256===normalizationReview,'The saved mapping review differs from the complete original conversion previews.');
  return {workspace_id:input.workspace_id,expected_revision:0,definition:review.definition,review_sha256:review.review_sha256};
 }
 async function observeFieldsUI(run){
  if(!run.comparison_rules&&!run.normalizations)return;
  if(record.observed_fields?.complete&&(!run.normalizations||record.observed_fields.normalizations)){
   need(record.observed_fields.run_id===run.run_id&&
    stable(record.observed_fields.comparison_rules??null)===stable(run.comparison_rules??null)&&
    stable(record.observed_fields.normalizations??null)===stable(run.normalizations??null),
    'The original recorded field observation belongs to another run, normalization or rule set.');
   return;
  }
  record.phase='FIELDS';await save();
  await reopen(record.steps.run,'reconciliation');
  await visibleAction(page.getByRole('tab',{name:'Field differences',exact:true}));
  const visibleColumns=['group_id','column_name','source_value_text','target_value_text','state','absolute_difference','allowed_difference','unit'];
  const scalar=value=>plain(value)&&Object.hasOwn(value,'text')&&Object.hasOwn(value,'type')?(value.type==='null'?null:value.text):value;
  const displayed=value=>{const raw=scalar(value);return raw===null||raw===undefined?'NULL':raw===''?'EMPTY STRING':typeof raw==='object'?JSON.stringify(raw):String(raw);};
  const digest=createHash('sha256'),states={};let offset=0,rows=0,pages=0,total=null,first=null;
  for(;;){
   const native=await get(API+'/runs/'+run.run_id+'/fields?offset='+offset+'&limit=50');
   need(native.run_id===run.run_id&&Array.isArray(native.columns)&&Array.isArray(native.rows),
    'The original field page has a different run binding.');
   const names=native.columns.map(column=>typeof column==='string'?column:column.name);
   need(visibleColumns.every(name=>names.includes(name)),'The native field page lacks an original displayed field.');
   const objects=native.rows.map(row=>Array.isArray(row)?Object.fromEntries(names.map((name,index)=>[name,row[index]])):row);
   const visible=await page.locator('#run-grid tbody tr').evaluateAll(lines=>lines.map(line=>Array.from(line.querySelectorAll('td.value')).map(cell=>cell.textContent)).filter(cells=>cells.length));
   need(stable(visible)===stable(objects.map(row=>visibleColumns.map(name=>displayed(row[name])))),
    'The visible field page differs from its complete native values.');
   if(total===null)total=native.total;
   need(native.total===total,'The original immutable field total changed while reading.');
   digest.update(stable(native.rows)+'\n');pages++;rows+=objects.length;
   if(!first&&objects.length)first=objects[0];
   for(const row of objects){const key=String(scalar(row.state));states[key]=(states[key]||0)+1;}
   if(native.next_offset===null||native.next_offset===undefined)break;
   need(Number.isSafeInteger(native.next_offset)&&native.next_offset>offset,'The original field continuation did not advance.');
   await visibleAction(page.locator('#run-grid-pager').getByRole('button',{name:'Next',exact:true}));
   offset=native.next_offset;
  }
  need(rows===total,'The recorded field continuation did not include every native row.');
  if(first){
   await page.getByLabel('Field group identifier',{exact:true}).fill(String(scalar(first.group_id)));
   await page.getByLabel('Canonical value field',{exact:true}).fill(String(scalar(first.column_name)));
   await page.getByLabel('Field result',{exact:true}).selectOption(String(scalar(first.state)));
   await visibleAction(page.getByRole('button',{name:'Apply field filters',exact:true}));
   const inspect=page.locator('#run-grid').getByRole('button',{name:'Inspect field',exact:true});
   need(await inspect.count()===1,'The original group/field/state selection did not retain its exact field.');
   await visibleAction(inspect);
   const observed=await detail('Complete recorded field',page.locator('#selected-subject'));
   need(stable(observed)===stable(first),'The full visible field record changed an original value, rule or difference.');
   await visibleAction(page.locator('#selected-subject').getByRole('button',{name:'All group rows',exact:true}));
   need(await page.getByRole('tab',{name:'Original rows',exact:true}).getAttribute('aria-selected')==='true',
    'The recorded field did not reopen its original group observations.');
  }
  record.observed_fields={complete:true,run_id:run.run_id,comparison_rules:run.comparison_rules??null,normalizations:run.normalizations??null,
   total,rows,pages,states,ordered_page_rows_sha256:digest.digest('hex'),
   inspected_original_field:first,completed_at:new Date().toISOString()};
  await save();
 }

 async function observeNormalizationsUI(run){
  if(!run.normalizations)return;
  if(record.observed_normalizations?.complete){
   need(record.observed_normalizations.run_id===run.run_id&&
    stable(record.observed_normalizations.normalizations)===stable(run.normalizations),
    'The original recorded conversion observation belongs to another run or normalization policy.');
   return;
  }
  record.phase='NORMALIZATIONS';await save();
  await reopen(record.steps.run,'reconciliation');
  await visibleAction(page.getByRole('tab',{name:'Normalizations',exact:true}));
  const visibleColumns=['group_id','side','row','column_name','original_value_text','original_unit','canonical_value_text','canonical_unit','state','reason'];
  const digest=createHash('sha256'),states={};let offset=0,rows=0,pages=0,total=null,first=null;
  for(;;){
   const native=await get(API+'/runs/'+run.run_id+'/normalizations?offset='+offset+'&limit=50');
   need(native.run_id===run.run_id,'The original conversion page belongs to another run.');
   const objects=await assertNormalizedGrid(page.locator('#run-grid'),native,visibleColumns);
   if(total===null)total=native.total;
   need(Number.isSafeInteger(total)&&total>=0&&native.total===total,'The immutable original conversion total changed while reading.');
   digest.update(stable(native.rows)+'\n');pages++;rows+=objects.length;
   if(!first&&objects.length)first=objects[0];
   for(const row of objects){const state=String(normalizedCell(row.state));states[state]=(states[state]||0)+1;}
   if(native.next_offset===null||native.next_offset===undefined)break;
   need(Number.isSafeInteger(native.next_offset)&&native.next_offset>offset,'The original conversion continuation did not advance.');
   await visibleAction(page.locator('#run-grid-pager').getByRole('button',{name:'Next',exact:true}));
   offset=native.next_offset;
  }
  need(rows===total,'The saved conversion observation did not include every original native record.');
  let original=null;
  if(first){
   const group=normalizedCell(first.group_id),side=String(normalizedCell(first.side)),row=String(normalizedCell(first.row));
   await page.getByLabel('Normalization side',{exact:true}).selectOption(side);
   await page.getByLabel('Normalized field',{exact:true}).fill(String(normalizedCell(first.column_name)));
   await page.getByLabel('Conversion result',{exact:true}).selectOption(String(normalizedCell(first.state)));
   await page.getByLabel('Normalization group identifier',{exact:true}).fill(group===null||group===undefined?'':String(group));
   await visibleAction(page.getByRole('button',{name:'Apply normalization filters',exact:true}));
   const inspect=page.locator('#run-grid').getByRole('button',{name:'Inspect conversion',exact:true});
   need(await inspect.count()>0,'The original normalization filters lost their complete conversion record.');
   await visibleAction(inspect.first());
   const inspected=await detail('Complete recorded normalization',page.locator('#selected-subject'));
   need(stable(inspected)===stable(first),'The complete visible conversion changed its original values, policy or result.');
   original=await detail('Complete original and canonical row',page.locator('#selected-subject'));
   const nativeOriginal=await get(API+'/runs/'+run.run_id+'/row?side='+encodeURIComponent(side)+'&row='+encodeURIComponent(row));
   need(stable(original)===stable(nativeOriginal)&&original.side===side&&String(original.row)===row&&
    plain(original.original)&&plain(original.canonical),'The conversion did not reopen every field in its exact original row.');
  }
  record.observed_normalizations={complete:true,run_id:run.run_id,normalizations:run.normalizations,
   total,rows,pages,states,ordered_page_rows_sha256:digest.digest('hex'),
   inspected_original_conversion:first,inspected_original_row:original,completed_at:new Date().toISOString()};
  await save();
 }

 async function prepareDecisionUI(runId){
  await reopen(record.steps.run,'reconciliation');
  await visibleAction(page.getByRole('tab',{name:'Original rows',exact:true}));
  const rows=page.locator('#run-grid').getByRole('button',{name:'Open full row',exact:true});
  need(await rows.count()>0,'The original receiving editions have no row available for full review.');
  await visibleAction(rows.first());
  const original=await detail('Complete original and canonical row',page.locator('#selected-subject'));
  need(['source','target'].includes(original.side)&&plain(original.original)&&plain(original.canonical),
   'The visible row review did not include its complete original and canonical values.');
  record.observed_row=original;await save();
  await visibleAction(page.getByRole('tab',{name:'Key groups',exact:true}));
  const groups=await get(API+'/runs/'+runId+'/groups?offset=0&limit=50');
  need(Array.isArray(groups.rows)&&groups.rows.length>0,'The supplied native receiving editions have no observed group to review.');
  const names=groups.columns.map(column=>typeof column==='string'?column:column.name);
  const raw=groups.rows[0],cell=Array.isArray(raw)?raw[names.indexOf('group_id')]:raw.group_id;
  const group=Number(plain(cell)&&Object.hasOwn(cell,'text')?cell.text:cell);
  need(Number.isSafeInteger(group)&&group>0,'The original visible group has no exact native index.');
  await visibleAction(page.locator('#run-grid').getByRole('button',{name:'Review group',exact:true}).first());
  await page.locator('#decision-editor').getByLabel('Reviewer',{exact:true}).fill(input.actor);
  await page.locator('#decision-editor').getByLabel('Decision',{exact:true}).selectOption('OPEN');
  await page.locator('#decision-editor').getByLabel('Reason',{exact:false}).fill(input.reason);
  const current=await get(API+'/runs/'+runId);
  return {workspace_id:input.workspace_id,run_id:runId,expected_revision:current.review_revision,
   subject:{kind:'group',group_id:group},outcome:'OPEN',actor:input.actor,reason:input.reason};
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
  need((await page.locator('#workspace-id').textContent())===input.workspace_id,'The visible browser is attached to another workspace.');
  const identity=await get('/api/identity');
  need(identity.workspace_id===input.workspace_id,'The original native workspace identity changed.');
  let preparedPair=null;
  if(!record.steps.pair)preparedPair=await preparePairUI();
  const pairBody=record.steps.pair?.expected_body??preparedPair;
  const pair=await step('pair',API+'/pairs',pairBody,async()=>{
   if(!preparedPair)preparedPair=await preparePairUI();
   need(stable(preparedPair)===stable(pairBody),'The original prepared mapping review changed.');
   await screen('editor');await visibleAction(page.getByRole('button',{name:'Save reviewed pair',exact:true}));
  });
  need(ID.test(pair.pair_id??'')&&pair.definition.source_edition===input.definition.source_edition&&
   pair.definition.target_edition===input.definition.target_edition,'The original saved pair changed.');
  const run=await step('run',API+'/run',{workspace_id:input.workspace_id,pair_id:pair.pair_id,
   expected_revision:pair.revision,definition_sha256:pair.definition_sha256},async()=>{
    await reopen(record.steps.pair,'reconciliation');
    await visibleAction(page.getByRole('button',{name:'Run reconciliation',exact:true}));
   });
  need(ID.test(run.run_id??'')&&run.pair_id===pair.pair_id&&run.summary?.accounting_balanced===true,
   'The native run did not account for all original rows.');
  await observeFieldsUI(run);
  await observeNormalizationsUI(run);
  // OPEN records an actual observation without inventing a correction.
  let preparedDecision=null;
  if(!record.steps.decision)preparedDecision=await prepareDecisionUI(run.run_id);
  const decisionBody=record.steps.decision?.expected_body??preparedDecision;
  const decision=await step('decision',API+'/decision',decisionBody,async()=>{
   if(!preparedDecision)preparedDecision=await prepareDecisionUI(run.run_id);
   need(stable(preparedDecision)===stable(decisionBody),'The original prepared decision or review revision changed.');
   await screen('runs');
   await visibleAction(page.locator('#decision-editor').getByRole('button',{name:'Save review decision',exact:true}));
  });
  need(decision.run?.run_id===run.run_id,'The original decision belongs to another run.');
  const report=await step('report',API+'/report',{workspace_id:input.workspace_id,run_id:run.run_id,
   expected_revision:decision.run.review_revision},async()=>{
    await reopen(record.steps.decision,'reconciliation');
    await visibleAction(page.getByRole('button',{name:'Create complete report',exact:true}));
   });
  need(ID.test(report.report_id??'')&&report.run_id===run.run_id,'The browser report belongs to another run.');
  if(run.normalizations)need(stable(report.review?.normalizations??null)===stable(run.normalizations)&&
   Array.isArray(report.queries)&&['fields','normalizations'].every(kind=>report.queries.some(query=>query.kind===kind)),
   'The complete report lost its frozen normalization policies or original saved conversion queries.');
  const exported=await step('export',API+'/exports',{report_id:report.report_id},async()=>{
   await reopen(record.steps.report,'reconciliation');
   await visibleAction(page.getByRole('button',{name:'Prepare complete handover',exact:true}));
  });
  need(ID.test(exported.export_id??'')&&exported.report_id===report.report_id&&exported.complete===true&&
   exported.state==='COMPLETE'&&Array.isArray(exported.files),'The actual complete native handover was not returned.');
  const manifestFile=exported.files.find(file=>file.name==='manifest.json');
  need(manifestFile&&ID.test(manifestFile.sha256??'')&&Number.isSafeInteger(manifestFile.bytes)&&
   manifestFile.bytes>0&&manifestFile.bytes<=16*1024*1024,'The original complete export manifest is missing.');
  const manifestResponse=await page.request.get(origin+'/api/exports/'+exported.export_id+'/file?name=manifest.json',{
   headers:{'X-DuckDB-Capability':capability,'X-DuckDB-Workspace-ID':input.workspace_id},timeout:300000
  });
  need(manifestResponse.ok(),'The original browser file route could not read its saved manifest.');
  const manifestBytes=await manifestResponse.body();
  need(manifestBytes.length===manifestFile.bytes&&hash(manifestBytes)===manifestFile.sha256,
   'The original complete export manifest bytes changed.');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  need(manifest.schema==='stellar-forge.duckdb-reconciliation.v1.export'&&
   manifest.export_id===exported.export_id&&manifest.report_id===report.report_id&&
   manifest.workspace_id===input.workspace_id&&manifest.complete===true&&manifest.state==='COMPLETE'&&Array.isArray(manifest.files),
   'The complete native export manifest has a different receiving binding.');
  const described=new Map(exported.files.map(file=>[file.name,file]));
  need(described.size===exported.files.length&&manifest.files.length+1===described.size,'The native export file sets differ.');
  const names=new Set();
  for(const file of manifest.files){
   const original=described.get(file.name);
   need(!names.has(file.name)&&original&&original.bytes===file.bytes&&original.sha256===file.sha256,
    'An original full export file differs from its manifest.');names.add(file.name);
  }
  await retain(path.join(root,'original-export-manifest.json'),manifestBytes);
  record.phase='EXPORT_COMPLETE';record.export_id=exported.export_id;record.report_id=report.report_id;
  record.manifest_sha256=manifestFile.sha256;record.original_file_count=exported.files.length;await save();
  // Reopen the original export after completion, using its original journals.
  await page.reload({waitUntil:'domcontentloaded'});await idle();
  const reopened=await reopen(record.steps.export,'export');
  need(reopened.export_id===exported.export_id&&reopened.report_id===report.report_id,'Reload did not reopen the original complete export.');
  const screenshots=[await capture('reconciliation-complete-handover')];
  await page.setViewportSize({width:480,height:900});
  screenshots.push(await capture('reconciliation-complete-handover-mobile'));
  need(errors.length===0,'The real browser reported an application error: '+errors.join('; '));
  record.phase='COMPLETE';record.complete=true;record.completed_at=new Date().toISOString();
  record.result={schema:SCHEMA,complete:true,operation_id:input.operation_id,source_commit:input.source_commit,
   workspace_id:input.workspace_id,pair_id:pair.pair_id,pair_revision:pair.revision,run_id:run.run_id,
   report_id:report.report_id,export_id:exported.export_id,manifest_sha256:manifestFile.sha256,
   request_ids:Object.fromEntries(Object.entries(record.steps).map(([name,item])=>[name,item.request_id])),
   original_file_count:exported.files.length,original_total_bytes:exported.files.reduce((sum,file)=>sum+file.bytes,0),
   source_edition:input.definition.source_edition,target_edition:input.definition.target_edition,
   browser_errors:errors,screenshots,directory:root,
   ...(record.observed_fields?{observed_fields:record.observed_fields}:{}),
   ...(record.observed_normalization_previews?{observed_normalization_previews:record.observed_normalization_previews}:{}),
   ...(record.observed_normalizations?{observed_normalizations:record.observed_normalizations}:{}),
   continuation:'Receive every original export file through the same native typed client, then reopen the original report from the separate sparse working warehouse.'};
  await save();return record.result;
 }catch(error){
  record.phase=previouslyComplete?'COMPLETE':'RETURNED_ERROR';record.complete=previouslyComplete;
  record.last_error={message:String(error.message).split(capability).join('[private launch]'),at:new Date().toISOString()};
  try{await save();}catch(storageError){error.receivingStorageError=String(storageError.message);}
  throw error;
 }finally{if(context)await context.close();}
}
