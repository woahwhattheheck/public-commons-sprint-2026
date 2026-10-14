/** Operate workbook returns in the caller's existing authenticated Eco browser.
 * TokenJunkie Labs. Caller owns browser/listener/runtime and the receiving lock.
 */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const SCHEMA='upstate.profile-workbook-return-browser/v1',END='/api/profile-workbench/workbook-return/';
const same=(a,b)=>canonical(a)===canonical(b);
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(v).digest('hex');
const need=(v,m)=>{if(!v)throw Error(m);};
const selector=(name,value)=>'['+name+'='+JSON.stringify(value)+']';
const base=v=>{const out=clone(v);delete out.preview_sha256;return out;};
async function exists(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function json(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function descriptor(file){
 const info=await fs.lstat(file);need(info.isFile()&&!info.isSymbolicLink()&&await fs.realpath(file)===file,'Use an ordinary original receiving file.');
 const h=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){bytes+=chunk.length;h.update(chunk);}
 const after=await fs.stat(file);need(info.dev===after.dev&&info.ino===after.ino&&info.size===after.size&&info.mtimeMs===after.mtimeMs&&info.ctimeMs===after.ctimeMs,'Receiving file changed while hashing.');
 return {path:file,bytes,sha256:h.digest('hex')};
}
async function folder(value){
 const target=path.resolve(value);await fs.mkdir(target,{recursive:true});
 need(await fs.realpath(target)===target,'Use a canonical receiving output directory.');
 let current=path.parse(target).root;
 for(const part of target.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const info=await fs.lstat(current);need(info.isDirectory()&&!info.isSymbolicLink(),'Receiving output has a nonordinary parent.');}
 return target;
}
async function write(file,value,{immutable=false}={}){
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
 if(immutable&&await exists(file)){need((await fs.readFile(file)).equals(bytes),'Preserve the first complete receiving member: '+file);return;}
 const temporary=file+'.'+randomUUID()+'.pending';let handle,primary;
 try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  if(immutable){try{await fs.link(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(file)).equals(bytes),'Another original receiving member already exists.');}await fs.unlink(temporary);}
  else await fs.rename(temporary,file);
  if(process.platform!=='win32'){const parent=await fs.open(path.dirname(file),'r');try{await parent.sync();}finally{await parent.close();}}
 }catch(e){primary=e;}
 finally{const errors=[];if(handle)try{await handle.close();}catch(e){errors.push(e);}try{await fs.unlink(temporary);}catch(e){if(e.code!=='ENOENT')errors.push(e);}
  if(primary&&errors.length)throw new AggregateError([primary,...errors],'Receiving publication and cleanup failed',{cause:primary});
  if(primary)throw primary;if(errors.length)throw new AggregateError(errors,'Receiving publication cleanup failed');
 }
}
async function originalDrafts(page,workspace,project,profile){
 const scope=workspace+':'+project+':'+profile;
 return page.evaluate(scope=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('upstate-profile-workbook-return-v1');
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('copies')){db.close();resolve([]);return;}
   const tx=db.transaction('copies','readonly'),get=tx.objectStore('copies').index('scope').getAll(scope);
   get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();tx.onabort=()=>db.close();
  };
 }),scope);
}
function requireRecord(record,selection,project){
 need(record?.id&&record.project_id===project&&same(record.preview?.selection,base(selection)),'The saved return differs from its original complete mapping.');
 return record;
}

function reportMembers(result,downloads){
 const members=new Map();
 for(const [role,original]of Object.entries(result.files)){
  const prefix='profile-workbook-returns/'+result.id+'/files/';
  need(original.path.startsWith(prefix),'Report member is outside the exact original return files.');
  const relative=original.path.slice(prefix.length);
  need(relative&&relative.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!relative.includes('\\'),'Report member has an invalid original relative path.');
  const downloaded=downloads.find(item=>item.role===role);
  need(downloaded&&downloaded.file.bytes===original.bytes&&downloaded.file.sha256===original.sha256,'Report member lacks its exact original downloaded bytes.');
  need(!members.has(relative),'Report member paths must be unique.');
  members.set(relative,downloaded);
 }
 return members;
}
const reportUrl=relative=>'https://workbook-receiving.invalid/'+relative.split('/').map(encodeURIComponent).join('/');

/** Original caller passes api(path,{method,body}), with its existing auth.
 * openProfile(profileId) navigates that same page through the maintained
 * Profile workbench; if omitted, actual existing navigation/selectors are used.
 */
export async function receiveProfileWorkbookReturn({page,api,workspace,workspaceDirectory,selection,directory,operationId,openProfile,signal,cutoff}){
 need(page&&typeof api==='function'&&typeof workspace==='string'&&path.isAbsolute(workspaceDirectory||'')&&selection?.profile_id&&operationId,'Supply the original page, authenticated API, Workspace and complete actual selection.');
 const chosen=base(selection),root=await folder(path.resolve(directory,'profile-workbook-return'));
 const source=await descriptor(fileURLToPath(import.meta.url));
 const native=await api(END+'profile',{method:'POST',body:{workspace,profile_id:chosen.profile_id}});
 need(native.profile_id===chosen.profile_id&&native.project_id,'Use an actual saved profile.');
 const identity={schema:SCHEMA,operation_id:operationId,workspace,workspace_directory:workspaceDirectory,project_id:native.project_id,selection:chosen,source:{bytes:source.bytes,sha256:source.sha256}};
 await write(path.join(root,'identity.json'),identity,{immutable:true});
 const journalFile=path.join(root,'progress.json'),resultFile=path.join(root,'browser-result.json');
 let journal=await exists(journalFile)?await json(journalFile):{identity,started_at:new Date().toISOString()};
 need(same(journal.identity,identity),'Continue the same original browser receiving operation.');
 const save=async patch=>{Object.assign(journal,clone(patch));await write(journalFile,journal);};
 const check=()=>{if(signal?.aborted)throw signal.reason||Error('Original receiving stopped.');if(cutoff&&Date.now()>=Date.parse(cutoff))throw Error('Original receiving cutoff reached; retain the same request.');};
 const attempt=await folder(path.join(root,'attempts',randomUUID())),screenshots=[];
 const viewport=page.viewportSize();let ownPage=null,routeHandler=null,primary=null,result;
 const panel=()=>page.locator(selector('data-pwr-profile',chosen.profile_id));
 const action=(name)=>panel().locator(selector('data-pwr-action',name));
 const capture=async(name,width,height)=>{check();await page.setViewportSize({width,height});const file=path.join(attempt,name+'.png');await page.screenshot({path:file,fullPage:true});screenshots.push({name,...await descriptor(file)});};
 const open=async()=>{
  if(openProfile)await openProfile(chosen.profile_id);
  else{await page.locator('[data-view="profile-workbench"]').click();await page.locator('[data-pw-action="open"]'+selector('data-pw-id',chosen.profile_id)).click();}
  await panel().waitFor();await action('new').waitFor({state:'visible'});
  await page.waitForFunction(profile=>{const el=document.querySelector('[data-pwr-profile="'+profile+'"] [data-pwr-action="new"]');return el&&!el.disabled;},chosen.profile_id);
  need(await panel().getAttribute('data-pwr-project')===native.project_id,'The visible profile belongs to another project.');
 };
 const matching=async()=>{
  const rows=(await originalDrafts(page,workspace,native.project_id,chosen.profile_id)).filter(row=>row.body?.origin?.kind==='profile-workbook-return-receiving'&&row.body.origin.operation_id===operationId);
  need(rows.length<=1,'More than one original receiving working copy exists; preserve and reconcile the originals.');
  if(rows.length){need(rows[0].body.selection.profile_id===chosen.profile_id,'The retained browser copy names another profile.');if(journal.draft_id)need(rows[0].id===journal.draft_id,'The original receiving draft identity changed.');}
  return rows[0]||null;
 };
 const selectDraft=async row=>{await panel().locator('[data-pwr-action="local"]'+selector('data-pwr-id',row.id)).click();await action('download').waitFor();};
 const output=async(locator,name,expected)=>{
  const file=path.join(root,'members',name);await folder(path.dirname(file));
  if(await exists(file)){const d=await descriptor(file);if(expected)need(d.bytes===expected.bytes&&d.sha256===expected.sha256,'The original received member changed.');return d;}
  const temporary=path.join(attempt,randomUUID()+'.download');
  const pending=page.waitForEvent('download');await locator.click();const download=await pending;
  await download.saveAs(temporary);const d=await descriptor(temporary);
  if(expected)need(d.bytes===expected.bytes&&d.sha256===expected.sha256,'The downloaded member differs from the exact native bytes.');
  try{await fs.link(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;const present=await descriptor(file);need(present.bytes===d.bytes&&present.sha256===d.sha256,'Do not replace another received member.');}
  return descriptor(file);
 };
 try{
  check();await open();
  let row=await matching();
  if(!row){
   const original={schema:'upstate.profile-workbook-return-working-copy/v1',project:{id:native.project_id,title:'Original scientific project'},exported_at:journal.started_at,
    draft:{id:hash(operationId).slice(0,32),created_at:journal.started_at,updated_at:journal.started_at,
      selection:{...chosen,mappings:[],exclusions:[]},record:null,operations:[],frozen:false,
      origin:{kind:'profile-workbook-return-receiving',operation_id:operationId}}};
   const file=path.join(root,'original-empty-working-copy.json');await write(file,original,{immutable:true});
   await action('import').click();await panel().locator('[data-pwr-import]').setInputFiles(file);
   await page.waitForFunction(profile=>{const root=document.querySelector('[data-pwr-profile="'+profile+'"]');return root?.querySelector('[data-pwr-action="download"]')&&!root.querySelector('[data-pwr-action="new"]').disabled;},chosen.profile_id);
   row=await matching();need(row,'The original browser did not retain the complete imported working copy.');
   await save({draft_id:row.id});
  }else await selectDraft(row);
  if(!journal.draft_id)await save({draft_id:row.id});
  const operations=row.body.operations||[];need(operations.length<=1,'Keep the one original workbook-return request.');
  if(!operations.length&&!journal.authored){
   // No request exists: rebuild this explicitly owned editable mapping after an
   // interrupted field entry, preserving its earlier draft in selection_history.
   const book=canonical(chosen.workbook);
   await panel().locator('[data-pwr-field="workbook"]').selectOption('');
   await panel().locator('[data-pwr-field="workbook"]').selectOption(book);
   await panel().locator('[data-pwr-field="title"]').fill(chosen.title);
   await panel().locator('[data-pwr-field="author"]').fill(chosen.author);
   await panel().locator('[data-pwr-field="reason"]').fill(chosen.reason);
   const all=new Map(native.source_values.map(v=>[canonical(v.source),v]));
   for(const [kind,items]of[['map',chosen.mappings],['exclude',chosen.exclusions]]){
    for(const item of items){check();const key=canonical(item.source);need(all.has(key),'Selection contains a field outside this original profile.');
     await panel().locator('[data-pwr-field="@filter"]').fill(key);
     const choice=panel().locator(selector('data-pwr-choice',key));await choice.waitFor();await choice.selectOption(kind);
     if(kind==='map'){await panel().locator(selector('data-pwr-sheet',key)).selectOption(item.sheet);await panel().locator(selector('data-pwr-cell',key)).fill(item.cell);}
     else await panel().locator(selector('data-pwr-exclusion',key)).fill(item.reason);
    }
   }
   await panel().locator('[data-pwr-field="@filter"]').fill('');
   await action('preview').click();await action('create').waitFor();
   need(await action('create').isEnabled(),'The full original-cell preview is not eligible; inspect actual issues.');
   row=await matching();need(same(row.body.selection,chosen),'Typed controls did not retain the full original ordered mapping.');
   await save({authored:true});
  }
  row=await matching();need(same(row.body.selection,chosen),'The actual saved draft selection differs from the receiving source.');
  if(!row.body.operations.length){
   await action('preview').click();await action('create').waitFor();need(await action('create').isEnabled(),'Review actual native original-cell issues before creating.');
   await capture('reviewed-desktop',1440,1000);await capture('reviewed-narrow',390,844);
   routeHandler=async route=>{
    const request=route.request();let body;try{body=request.postDataJSON();}catch{return route.continue();}
    if(body?.action!=='profile.workbook_return.create')return route.continue();
    need(body.workspace===workspace&&same(base(body.payload),chosen),'The original browser dispatched a different mapping.');
    await save({request:body,dispatch_observed:true});
    const response=await route.fetch();const bytes=await response.body();
    await write(path.join(root,'first-action-response.json'),bytes,{immutable:true});
    await save({first_action_status:response.status(),observed_response:true});
    // Exercise one real accepted-response interruption, retaining original IDB,
    // provider response and UUID; never dispatch a replacement operation.
    await route.abort('failed');
   };
   await page.route('**/api/actions',routeHandler);
   await action('create').click();
   for(let n=0;n<100;n++){check();row=await matching();if(row?.body.operations?.length&&journal.observed_response)break;await page.waitForTimeout(100);}
   need(row?.body.operations?.length===1,'The original browser must retain its request before dispatch.');
   if(routeHandler){await page.unroute('**/api/actions',routeHandler);routeHandler=null;}
  }
  row=await matching();const op=row.body.operations[0];
  need(op?.request?.workspace===workspace&&op.request.action==='profile.workbook_return.create'&&same(base(op.request.payload),chosen),'Receive the exact retained original request.');
  if(journal.request)need(same(journal.request,op.request),'The original queued request changed.');
  await save({request:op.request,draft_id:row.id});
  let receipt=await api(END+'operation',{method:'POST',body:{workspace,operation_id:op.operation_id,request:op.request,task_id:op.task_id||null}});
  if(receipt.status==='NOT_FOUND'){
   await panel().locator('[data-pwr-action="retry"]'+selector('data-pwr-operation',op.operation_id)).click();
  }
  while(receipt.status!=='COMPLETE'){
   check();if(['FAILED','CANCELLED','INTERRUPTED'].includes(receipt.status)||['failed','cancelled','interrupted'].includes(receipt.task?.state))throw Error('Continue the same native workbook task after resolving its actual error: '+canonical(receipt.error||receipt.task?.error||receipt.status));
   await page.waitForTimeout(700);
   receipt=await api(END+'operation',{method:'POST',body:{workspace,operation_id:op.operation_id,request:op.request,task_id:receipt.task_id||null}});
  }
  const accepted=requireRecord(receipt.result,chosen,native.project_id);
  need(accepted.preview_sha256===op.request.payload.preview_sha256,'Original preview identity differs.');
  await save({return_id:accepted.id,accepted_task_id:receipt.task_id,accepted_result:accepted});
  await panel().locator('[data-pwr-action="receive"]'+selector('data-pwr-operation',op.operation_id)).click();
  await panel().locator('.pwr-result').waitFor();
  const exact=await api('/api/actions',{method:'POST',body:clone(op.request)});
  need(exact.state==='complete'&&exact.result?.id===accepted.id&&same(exact.result.preview,accepted.preview),'Exact original request replay must return the original workbook.');
  const detail=requireRecord(await api(END+'inspect',{method:'POST',body:{workspace,id:accepted.id}}),chosen,native.project_id);
  const downloads=[];
  for(const file of detail._downloads||[]){
   check();need(file.role&&file.sha256&&Number.isSafeInteger(file.bytes),'Every output needs its native descriptor.');
   const label=file.role.replace(/[^A-Za-z0-9._-]/g,'_')+'--'+path.basename(file.filename);
   const link=panel().locator('.pwr-result a').filter({hasText:file.label});
   const saved=await output(link,label,file);downloads.push({role:file.role,descriptor:file,file:saved});
  }
  need(downloads.length===Object.keys(detail.files).length+1,'Open every output and original receipt.');
  const working=await output(action('download'),'complete-working-copy.json');
  const workingBody=await json(working.path);need(same(workingBody.draft.selection,chosen)&&workingBody.draft.record.id===accepted.id,'Complete working file must preserve the exact accepted return.');
  await capture('created-desktop',1440,1000);await capture('created-narrow',390,844);
  // Remount through the real existing panel, then use its original local copy.
  await open();row=await matching();await selectDraft(row);await action('receive').first().click();await panel().locator('.pwr-result').waitFor();
  const html=downloads.find(x=>x.role==='html');need(html,'Keep the complete readable workbook report.');
  const reportFiles=reportMembers(detail,downloads),linkedMembers=[];let reportRouteError=null;
  ownPage=await page.context().newPage();await ownPage.route('https://workbook-receiving.invalid/**',async route=>{
   try{const url=new URL(route.request().url()),relative=decodeURIComponent(url.pathname.slice(1));
   const match=reportFiles.get(relative);
   if(!match||route.request().method()!=='GET')return route.fulfill({status:404,body:'Retained member not found'});
   const bytes=await fs.readFile(match.file.path);
   need(bytes.length===match.file.bytes&&hash(bytes)===match.file.sha256,'The exact report member changed before browser receiving.');
   return route.fulfill({status:200,contentType:match.descriptor.media_type||'application/octet-stream',body:bytes});
   }catch(error){reportRouteError=error;await route.fulfill({status:500,body:'Retained report member could not be verified.'});}
  });
  const htmlPath=detail.files.html.path.split('/files/',2)[1];
  await ownPage.goto(reportUrl(htmlPath));
  need((await ownPage.locator('body').innerText()).includes(chosen.title),'Render the original readable workbook report.');
  // Use the document's actual links and the same browser route, preserving
  // nested implementation paths. Check every complete response before success.
  const links=await ownPage.locator('a[href]').evaluateAll(nodes=>nodes.map(node=>({href:node.getAttribute('href'),url:node.href})));
  for(const link of links){
   check();const url=new URL(link.url),relative=decodeURIComponent(url.pathname.slice(1));
   need(url.origin==='https://workbook-receiving.invalid'&&!url.search&&!url.hash&&reportFiles.has(relative),'Readable report links outside its retained complete inventory.');
   const expected=reportFiles.get(relative);
   const observed=await ownPage.evaluate(async url=>{
    const response=await fetch(url);if(!response.ok)throw Error('Retained report link failed: '+response.status+' '+url);
    const bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
    return {status:response.status,bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};
   },url.href);
   need(observed.bytes===expected.file.bytes&&observed.sha256===expected.file.sha256,'Actual browser-linked member differs from its original native descriptor.');
   linkedMembers.push({href:link.href,path:relative,role:expected.role,...observed});
  }
  if(reportRouteError)throw reportRouteError;
  const linkedPaths=new Set(linkedMembers.map(item=>item.path));
  need([...reportFiles.keys()].every(relative=>relative===htmlPath||linkedPaths.has(relative)),'The original report must link every retained result member other than itself.');
  await write(path.join(attempt,'report-linked-members.json'),linkedMembers,{immutable:true});
  for(const [name,width,height]of[['attachment-desktop',1440,1000],['attachment-narrow',390,844]]){await ownPage.setViewportSize({width,height});const file=path.join(attempt,name+'.png');await ownPage.screenshot({path:file,fullPage:true});screenshots.push({name,...await descriptor(file)});}
  await write(path.join(attempt,'captures.json'),screenshots,{immutable:true});
  result={schema:SCHEMA,state:'OPERATED_AWAITING_LITERAL_INSPECTION',identity,return_id:accepted.id,request:op.request,
   accepted_result:accepted,downloads,working_copy:working,report_linked_members:linkedMembers,
   native_receiving:{script:'source_tools/receive_profile_workbook_return.py',workspace:workspaceDirectory,return_id:accepted.id,operation_id:operationId,output:path.join(root,'native-receiving')},
   literal_inspection:{required:true,office_opened:false,formulas_recalculated:false,
    instruction:'Personally view all retained frames, readable report, CSV/JSON and original/derived workbook in the recipient spreadsheet application. Open every sheet and changed cell, verify formula and formatting preservation, then use the copied application and complete selected Study. Source reading and screenshots alone do not claim Office or human inspection.'}};
  if(await exists(resultFile)){const saved=await json(resultFile);need(same(saved.identity,identity)&&saved.return_id===result.return_id&&same(saved.request,result.request)&&same(saved.accepted_result,result.accepted_result),'Preserve the first completed browser generation.');for(const item of saved.downloads){const actual=await descriptor(item.file.path);need(same(actual,item.file),'Original completed download changed.');}result=saved;}
  else await write(resultFile,result,{immutable:true});
  await save({completed:true,result_file:resultFile,last_attempt:attempt});
 }catch(e){primary=e;try{await save({last_error:{message:e.message,at:new Date().toISOString()},last_attempt:attempt});}catch(writeError){primary=new AggregateError([e,writeError],'Original receiving and error retention failed',{cause:e});}}
 finally{const errors=[];if(routeHandler)try{await page.unroute('**/api/actions',routeHandler);}catch(e){errors.push(e);}if(ownPage)try{await ownPage.close();}catch(e){errors.push(e);}if(viewport)try{await page.setViewportSize(viewport);}catch(e){errors.push(e);}
  if(primary&&errors.length)throw new AggregateError([primary,...errors],'Original receiving and owned cleanup failed',{cause:primary});
  if(primary)throw primary;if(errors.length)throw new AggregateError(errors,'Owned workbook receiving cleanup failed');
 }
 return result;
}

/** Inspect an already cold-received selected Study through its original caller. */
export async function inspectReceivedProfileWorkbookReturn({page,api,workspace,receipt,browserReceipt,directory,openProfile}){
 const native=receipt.selected_study?.cold?.return;need(native?.return_id===browserReceipt.return_id,'Use the same original selected-Study receiver.');
 const result=requireRecord(await api(END+'inspect',{method:'POST',body:{workspace,id:native.return_id}}),browserReceipt.identity.selection,browserReceipt.identity.project_id);
 need(result.preview_sha256===browserReceipt.accepted_result.preview_sha256&&same(result.preview,browserReceipt.accepted_result.preview),'Cold retained workbook cells and exact source values changed.');
 if(openProfile)await openProfile(result.profile_id);else{await page.locator('[data-view="profile-workbench"]').click();await page.locator('[data-pw-action="open"]'+selector('data-pw-id',result.profile_id)).click();}
 const panel=page.locator(selector('data-pwr-profile',result.profile_id));await panel.waitFor();
 await panel.locator('[data-pwr-action="open"]'+selector('data-pwr-id',result.id)).click();await panel.locator('.pwr-result').waitFor();
 const out=await folder(path.join(directory,'profile-workbook-return-cold',randomUUID())),captures=[],old=page.viewportSize();
 try{for(const [name,width,height]of[['cold-desktop',1440,1000],['cold-narrow',390,844]]){await page.setViewportSize({width,height});const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:true});captures.push({name,...await descriptor(file)});}}
 finally{if(old)await page.setViewportSize(old);}
 const value={schema:SCHEMA,workspace,return_id:result.id,project_id:result.project_id,preview_sha256:result.preview_sha256,captures,literal_inspection_pending:true};
 await write(path.join(out,'cold-browser.json'),value,{immutable:true});return value;
}
