import {pathToFileURL} from 'node:url';
import {workingSelection} from './web/delivery_preparation_storage.mjs';
/** Operate saved map preparations inside the original authenticated browser course. */
import {promises as fs,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,basename,extname} from 'node:path';
const SCHEMA='upstate.delivery-preparation-receiving/v1';
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
const same=(a,b)=>JSON.stringify(sort(a))===JSON.stringify(sort(b));
const need=(v,m)=>{if(!v)throw Error(m);};
const stamp=()=>new Date().toISOString();
async function json(path){return JSON.parse(await fs.readFile(path,'utf8'));}
async function hash(path){const h=createHash('sha256');let bytes=0;for await(const b of createReadStream(path)){bytes+=b.length;h.update(b);}return {bytes,sha256:h.digest('hex')};}
async function retain(path,value,{immutable=false}={}){
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');try{const old=await fs.readFile(path);if(immutable){need(old.equals(raw),'Original receiving receipt changed');return;}}catch(e){if(e.code!=='ENOENT')throw e;}
  const temp=path+'.writing',file=await fs.open(temp,'w',0o600);try{await file.writeFile(raw);await file.sync();}finally{await file.close();}await fs.rename(temp,path);
  const dir=await fs.open(resolve(path,'..'),'r');try{await dir.sync();}finally{await dir.close();}
}
async function exists(path){try{await fs.access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function workingCopies(page,workspaceKey,projectId){
  return page.evaluate(async({workspaceKey,projectId})=>{
    const db=await new Promise((ok,no)=>{const q=indexedDB.open('upstate-delivery-preparation-v1',1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
    try{return await new Promise((ok,no)=>{const q=db.transaction('copies','readonly').objectStore('copies').index('scope').getAll(workspaceKey+':'+projectId);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});}finally{db.close();}
  },{workspaceKey,projectId});
}
async function openExactWorkingCopy({page,workspaceKey,projectId,file,workingCopyId,waitFor,onSelected=async()=>{}}){
  const raw=await fs.readFile(file,'utf8'),expected=JSON.parse(raw);
  const matching=rows=>rows.filter(row=>row.body.imported_original?.text===raw&&row.body.base?.preparation_id===expected.draft.base?.preparation_id);
  let matches=matching(await workingCopies(page,workspaceKey,projectId));
  let chosen=workingCopyId?matches.find(row=>row.id===workingCopyId):matches.sort((a,b)=>a.body.imported_at.localeCompare(b.body.imported_at)||a.id.localeCompare(b.id))[0];
  if(workingCopyId)need(chosen,'The original imported working-copy identity is unavailable');
  if(!chosen){
    await page.locator('[data-dp-import]').setInputFiles(file);
    await waitFor(async()=>{matches=matching(await workingCopies(page,workspaceKey,projectId));chosen=matches.sort((a,b)=>a.body.imported_at.localeCompare(b.body.imported_at)||a.id.localeCompare(b.id))[0];return !!chosen;},'the exact original file-opened working copy');
  }
  await onSelected(chosen.id);
  await page.locator('[data-dp-action="draft"][data-dp-id="'+chosen.id+'"]').click();
  for(const op of chosen.body.operations)if(op.state!=='complete')await page.locator('[data-dp-action="receive"][data-dp-operation="'+op.operation_id+'"]').click();
  await waitFor(async()=>{chosen=(await workingCopies(page,workspaceKey,projectId)).find(row=>row.id===chosen.id);return chosen?.body.operations.every(op=>op.state==='complete');},'exact original imported operation receipts');
  need(same(chosen.body.selection,expected.draft.selection)&&same(chosen.body.base,expected.draft.base),'The original imported copy has different selected inputs or revision; preserve its later changes and select the retained course copy');
  return chosen;
}
/**
 * request({method,path,body,query}) is the existing authenticated course's
 * transport. screenshot/download/waitFor keep that course's owned browser and
 * artifact journal. This module never creates a browser, listener or model run.
 */
export async function operateDeliveryPreparation({page,workspaceKey,projectId,deliveryId,operationId,directory,request,screenshot,download,waitFor,check=()=>{}}){
  need(page&&request&&screenshot&&download&&waitFor,'Use the original populated browser course and its complete receiving helpers');
  need(typeof operationId==='string'&&operationId.length>=16,'Retain the original whole-course operation ID');
  directory=resolve(directory);await fs.mkdir(directory,{recursive:true,mode:0o700});
  const intent={schema:SCHEMA,operation_id:operationId,workspace_key:workspaceKey,project_id:projectId,original_delivery_id:deliveryId};
  await retain(join(directory,'intent.json'),intent,{immutable:true});
  let ledger=await exists(join(directory,'progress.json'))?await json(join(directory,'progress.json')):{...intent,phases:{},files:[],requests:{},started_at:stamp()};
  need(same(Object.fromEntries(Object.keys(intent).map(k=>[k,ledger[k]])),intent),'The saved browser continuation belongs to another original project');
  const checkpoint=async()=>retain(join(directory,'progress.json'),ledger);
  const saveFile=async(path,label)=>{
    const identity=await hash(path),row={path:resolve(path),label,labels:[label],...identity},prior=ledger.files.find(r=>r.path===row.path);
    if(prior){need(same({path:prior.path,bytes:prior.bytes,sha256:prior.sha256},{path:row.path,...identity}),'A retained course artifact changed');prior.labels=[...new Set([...(prior.labels||[prior.label]),label])];}
    else ledger.files.push(row);
    await checkpoint();return prior||row;
  };
  const phase=async(name,fn)=>{
    check();if(ledger.phases[name]?.state==='complete')return ledger.phases[name].result;
    ledger.phases[name]={...(ledger.phases[name]||{}),state:'running',started_at:ledger.phases[name]?.started_at||stamp()};await checkpoint();
    try{const result=await fn();ledger.phases[name]={...ledger.phases[name],state:'complete',completed_at:stamp(),result:result??null};await checkpoint();return result;}
    catch(e){ledger.phases[name]={...ledger.phases[name],state:'interrupted',message:e.message,observed_at:stamp()};await checkpoint();throw e;}
  };
  const awaitNativeCompletion=async predicate=>{
    for(;;){check();if(await predicate())return;check();await new Promise(resolve=>setTimeout(resolve,1000));}
  };
  const post=(path,body)=>request({method:'POST',path,body});
  const read=(operation,payload={})=>post('/api/delivery-preparation/'+operation,{workspace:workspaceKey,...payload});
  const item=()=>request({method:'GET',path:'/api/item',query:{workspace:workspaceKey,kind:'deliveries',id:deliveryId}});
  async function recoverPersistedRequest(kind,workingCopyId,action,payload){
    const rows=await workingCopies(page,workspaceKey,projectId),copy=rows.find(row=>row.id===workingCopyId);
    need(copy,'Open the original durable course working copy before recovering its request');
    const candidates=copy.body.operations.filter(op=>op.request?.action===action);
    for(const op of candidates)need(op.request.workspace===workspaceKey&&same(op.request.payload,payload),'The retained original working copy has a different '+kind+' request; preserve it for explicit original-course review');
    need(candidates.length<=1,'The original course copy contains multiple unselected '+kind+' operations');
    if(ledger.requests[kind]){
      need(ledger.requests[kind].request.action===action&&ledger.requests[kind].request.workspace===workspaceKey&&same(ledger.requests[kind].request.payload,payload),'The course journal differs from its original complete request');
      if(candidates.length)need(same(ledger.requests[kind].request,candidates[0].request),'The browser and course retained different original requests');
      return;
    }
    if(candidates.length){
      const original=candidates[0];ledger.requests[kind]={request:original.request,...(original.task_id?{task_id:original.task_id}:{}),recovered_from_working_copy:workingCopyId};await checkpoint();
    }
  }
  async function reconcileRequest(kind){
    const selected=ledger.requests[kind];need(selected?.request,'Retain the exact original course request');
    let receipt=await read('operation',{operation_id:selected.request.operation_id,task_id:selected.task_id||null,request:selected.request});
    if(receipt.status==='NOT_FOUND'){
      need(selected.request.workspace===workspaceKey,'Receive the original operator alias history before continuing another workspace');
      const task=await post('/api/actions',selected.request);selected.task_id=task.id;await checkpoint();
      receipt=await read('operation',{operation_id:selected.request.operation_id,task_id:task.id,request:selected.request});
    }
    if(receipt.task_id||receipt.task?.id){selected.task_id=receipt.task_id||receipt.task.id;await checkpoint();}
    return receipt;
  }
  const click=async selector=>{check();await page.locator(selector).first().click();};
  const navigate=async()=>{await click('[data-view="delivery-preparation"]');await page.locator('.delivery-preparation').waitFor();await waitFor(async()=>await page.locator('[data-dp-action="delivery"][data-dp-id="'+deliveryId+'"]').count()>0,'saved original delivery in preparation desk');};
  const visibleCopy=async()=>{const rows=await workingCopies(page,workspaceKey,projectId);return rows.find(r=>r.id===ledger.working_copy_id)?.body;};
  const original=await item();need(original.id===deliveryId&&original.selection,'Open the selected original complete delivery');
  if(await exists(join(directory,'browser-receipt.json'))){
    const receipt=await json(join(directory,'browser-receipt.json'));need(same(receipt.intent,intent),'Completed browser receipt belongs to another original course');
    for(const row of receipt.files)need(same(await hash(row.path),{bytes:row.bytes,sha256:row.sha256}),'A completed original course artifact changed');
    for(const selected of Object.values(receipt.requests)){
      const out=await read('operation',{operation_id:selected.request.operation_id,task_id:selected.task_id,request:selected.request});
      need(['SAVED','COMPLETE'].includes(out.status)||out.task?.state==='complete','The original accepted operation is unavailable on reopen');
    }
    return receipt;
  }
  await navigate();
  await phase('complete-working-copy',async()=>{
    const title='Delivery preparation · '+operationId;
    const rows=await workingCopies(page,workspaceKey,projectId),existing=rows.filter(row=>row.body.title===title);
    need(existing.length<=1,'The original preparation name has multiple unselected working copies');
    if(existing.length){ledger.working_copy_id=existing[0].id;await click('[data-dp-action="draft"][data-dp-id="'+existing[0].id+'"]');}
    else{
      await click('[data-dp-action="delivery"][data-dp-id="'+deliveryId+'"]');
      await page.locator('[data-dp-field="@title"]').fill(title);
      await waitFor(async()=>{const selected=(await workingCopies(page,workspaceKey,projectId)).find(r=>r.body.title===title);if(selected){ledger.working_copy_id=selected.id;ledger.preparation_id=selected.body.preparation_id;}return !!selected;},'complete durable preparation draft');
    }
    const copy=await visibleCopy();ledger.preparation_id=copy.preparation_id;await checkpoint();
    need(same(copy.selection,original.selection),'The new preparation dropped or changed an original native delivery field');
    const notes=[...(copy.selection.notes||[]),'Preparation receiving: original source selection and interpretations retained.'].join('\n');
    await page.locator('[data-dp-field="notes"]').fill(notes);
    await waitFor(async()=>((await visibleCopy())?.raw.notes)===notes,'complete browser note persistence');
    await page.reload({waitUntil:'domcontentloaded'});await navigate();
    await click('[data-dp-action="draft"][data-dp-id="'+ledger.working_copy_id+'"]');
    need(await page.locator('[data-dp-field="notes"]').inputValue()===notes,'Reload lost the complete unsent preparation');
    await screenshot(page,'delivery-preparation-editor',1440);await screenshot(page,'delivery-preparation-editor',390);
    const saved=await download(page.locator('[data-dp-action="download"]').first(),'Complete preparation working copy');
    const value=await json(saved.file);need(value.draft.id===ledger.working_copy_id&&value.draft.raw.notes===notes,'The actual working-copy download differs from the visible draft');
    await saveFile(saved.file,'original complete working copy');return {working_copy_id:ledger.working_copy_id,preparation_id:ledger.preparation_id,download:saved.file};
  });
  await click('[data-dp-action="draft"][data-dp-id="'+ledger.working_copy_id+'"]');
  await phase('save-and-lost-reply',async()=>{
    const input=ledger.phases['complete-working-copy'].result.download,retained=ledger.files.find(file=>file.path===resolve(input));
    need(retained&&same(await hash(input),{bytes:retained.bytes,sha256:retained.sha256}),'The original complete draft input changed');
    const source=(await json(input)).draft;
    const expectedPayload={preparation_id:ledger.preparation_id,expected_revision:0,title:source.title,purpose:source.purpose,selection:workingSelection(source)};
    await recoverPersistedRequest('save',ledger.working_copy_id,'delivery.preparation.save',expectedPayload);
    if(!ledger.requests.save){
      let intercepted=false;
      const route=async route=>{
        const r=route.request();let body;try{body=r.postDataJSON();}catch{return route.continue();}
        if(body?.action!=='delivery.preparation.save'||body.payload?.preparation_id!==ledger.preparation_id)return route.continue();
        need(body.workspace===workspaceKey&&same(body.payload,expectedPayload),'The browser save differs from the original complete draft');
        need(!intercepted,'The browser sent the original save twice before reconciliation');intercepted=true;
        ledger.requests.save={request:body};await checkpoint();
        const response=await route.fetch();need(response.ok(),'Original preparation save submission failed');
        const task=await response.json();ledger.requests.save.task_id=task.id;ledger.requests.save.accepted=task;await checkpoint();
        // Actual server acceptance is retained while the browser observes a lost reply.
        await route.abort('connectionreset');
      };
      await page.route('**/api/actions',route);
      try{await click('[data-dp-action="save"]');await waitFor(async()=>!!ledger.requests.save?.task_id,'original accepted save before lost reply');}
      finally{await page.unroute('**/api/actions',route);}
    }
    await reconcileRequest('save');const selected=ledger.requests.save;
    await page.reload({waitUntil:'domcontentloaded'});await navigate();
    await click('[data-dp-action="draft"][data-dp-id="'+ledger.working_copy_id+'"]');
    await click('[data-dp-action="receive"][data-dp-operation="'+selected.request.operation_id+'"]');
    let out;
    await waitFor(async()=>{out=await read('operation',{operation_id:selected.request.operation_id,task_id:selected.task_id,request:selected.request});return out.status==='SAVED'||out.task?.state==='complete';},'exact original save receipt');
    await click('[data-dp-action="receive"][data-dp-operation="'+selected.request.operation_id+'"]');
    const result=out.result||out.task.result,prepared=result.preparation;
    need(prepared.id===ledger.preparation_id&&prepared.revision===1,'Save recovery created another preparation revision');
    selected.result=result;ledger.saved_revision=prepared.revision;await checkpoint();
    const before=await read('item',{preparation_id:ledger.preparation_id});
    const originalSaved=await read('item',{preparation_id:ledger.preparation_id,revision:prepared.revision});
    need(same(originalSaved.preparation,prepared),'The selected original accepted save generation changed');
    const replay=await post('/api/actions',selected.request);need(replay.id===selected.task_id,'Exact save replay changed the original task');
    const current=await read('item',{preparation_id:ledger.preparation_id});need(current.preparation.revision===before.preparation.revision&&current.preparation.revision_id===before.preparation.revision_id,'Exact replay changed the current saved head');
    await screenshot(page,'delivery-preparation-saved',1440);await screenshot(page,'delivery-preparation-saved',390);
    return {revision:prepared.revision,revision_id:prepared.revision_id,task_id:selected.task_id};
  });
  await phase('working-copy-file-reopen',async()=>{
    if(!ledger.accepted_copy){
      const saved=await download(page.locator('[data-dp-action="download"]').first(),'Complete accepted preparation and original requests');
      ledger.accepted_copy=await saveFile(saved.file,'accepted complete working copy');await checkpoint();
    }
    const reopened=await openExactWorkingCopy({page,workspaceKey,projectId,file:ledger.accepted_copy.path,workingCopyId:ledger.imported_working_copy_id,waitFor,onSelected:async id=>{ledger.imported_working_copy_id=id;await checkpoint();}});
    const copy=reopened.body;
    await screenshot(page,'delivery-preparation-file-reopened',390);
    return {working_copy_id:copy.id,base:copy.base};
  });
  await phase('native-build-and-replay',async()=>{
    await click('[data-dp-action="draft"][data-dp-id="'+ledger.imported_working_copy_id+'"]');
    await recoverPersistedRequest('build',ledger.imported_working_copy_id,'delivery.preparation.build',{preparation_id:ledger.preparation_id,revision:ledger.saved_revision});
    if(!ledger.requests.build){
      const route=async route=>{
        let body;try{body=route.request().postDataJSON();}catch{return route.continue();}
        if(body?.action!=='delivery.preparation.build'||body.payload?.preparation_id!==ledger.preparation_id)return route.continue();
        need(body.workspace===workspaceKey&&same(body.payload,{preparation_id:ledger.preparation_id,revision:ledger.saved_revision}),'The browser build differs from the original saved revision');
        ledger.requests.build={request:body};await checkpoint();const response=await route.fetch();need(response.ok(),'Original preparation build submission failed');
        const task=await response.json();ledger.requests.build.task_id=task.id;await checkpoint();await route.fulfill({response});
      };
      await page.route('**/api/actions',route);
      try{await click('[data-dp-action="build"]');await waitFor(async()=>!!ledger.requests.build?.task_id,'retained original build operation');}
      finally{await page.unroute('**/api/actions',route);}
    }
    await reconcileRequest('build');const selected=ledger.requests.build;let out;
    await awaitNativeCompletion(async()=>{
      out=await read('operation',{operation_id:selected.request.operation_id,task_id:selected.task_id,request:selected.request});
      if(['FAILED','SOURCE_CHANGED'].includes(out.status)||['failed','interrupted','cancelled'].includes(out.task?.state)){
        selected.last_observation=out;await checkpoint();throw Error(out.error?.message||out.task?.error?.message||'Continue the same original build operation and retained source before resuming this course');
      }
      return out.status==='COMPLETE'||out.task?.state==='complete';
    });
    selected.result=out.result||out.task.result;ledger.delivery_id=selected.result.delivery_id;need(ledger.delivery_id,'Original builder returned no delivery identity');await checkpoint();
    const replay=await post('/api/actions',selected.request);need(replay.id===selected.task_id,'Build replay changed the original task');
    await click('[data-dp-action="receive"][data-dp-operation="'+selected.request.operation_id+'"]');
    await screenshot(page,'delivery-preparation-built',1440);await screenshot(page,'delivery-preparation-built',390);
    return {delivery_id:ledger.delivery_id,operation_id:selected.task_id,revision:ledger.saved_revision};
  });
  await phase('complete-original-output-inspection',async()=>{
    const record=await request({method:'GET',path:'/api/item',query:{workspace:workspaceKey,kind:'deliveries',id:ledger.delivery_id}});
    need(['complete','received_snapshot'].includes(record.state),'The retained build has no complete original output');
    await click('[data-dp-action="output"][data-dp-id="'+ledger.delivery_id+'"]');
    await page.locator('#detail-dialog').waitFor();
    await screenshot(page,'delivery-preparation-complete-output',1440);await screenshot(page,'delivery-preparation-complete-output',390);
    const pageSize=page.locator('[data-delivery-inspection-size]');if(await pageSize.count())await pageSize.selectOption('250');
    const files=record._downloads||[];need(files.length>0,'The complete delivery contains no original file tickets');
    const reviewed=[];
    for(const ticket of files){
      check();const selector='#detail-dialog a[download]';
      let link;const seen=new Set();
      while(!link){
        for(const candidate of await page.locator(selector).all()){const href=await candidate.getAttribute('href');if(href&&new URL(href,page.url()).pathname===new URL(ticket.url,page.url()).pathname){link=candidate;break;}}
        if(link)break;
        const label=page.locator('[data-delivery-inspection-files] [role="status"]'),status=await label.textContent();
        need(!seen.has(status),'An original delivery file has no actual download control: '+ticket.filename);seen.add(status);
        const next=page.locator('[data-action="delivery-inspection-page"][data-direction="1"]');
        need(await next.count(),'Open the complete retained delivery file list');
        if(await next.isDisabled()){
          const previous=page.locator('[data-action="delivery-inspection-page"][data-direction="-1"]');
          need(await previous.count()&&!await previous.isDisabled(),'The retained delivery inventory omits '+ticket.filename);
          while(!await previous.isDisabled()){const before=await label.textContent();await previous.click();await waitFor(async()=>await label.textContent()!==before,'previous complete delivery file page');}
        }else{await next.click();await waitFor(async()=>await label.textContent()!==status,'next complete delivery file page');}
      }
      const saved=await download(link,'Original delivery member: '+ticket.filename,ticket);await saveFile(saved.file,'delivery '+ticket.filename);
      const extension=extname(ticket.filename).toLowerCase();
      const reportKind=[['scientific',record.files?.report_html],['client',record.files?.client_report_html]].find(([,file])=>file&&file.sha256===ticket.sha256&&file.bytes===ticket.bytes&&basename(file.path||file.relative_path||ticket.filename)===ticket.filename)?.[0];
      if(['.html','.htm'].includes(extension)&&!reportKind){
        reviewed.push({id:ticket.id,filename:ticket.filename,view:'retain complete native directory and relative assets for original HTML viewing',...await hash(saved.file)});
      }else if(reportKind||['.pdf','.svg','.png','.jpg','.jpeg'].includes(extension)){
        const child=await page.context().newPage();
        try{
          const url=reportKind?new URL('/api/file/delivery-report',page.url()):new URL(ticket.url,page.url());
          if(reportKind)url.search=new URLSearchParams({workspace:workspaceKey,id:record.id,report:reportKind}).toString();
          await child.goto(url.href,{waitUntil:'load'});
          await screenshot(child,'preparation-member-'+ticket.id.slice(0,16),1440);
          if(reportKind)await screenshot(child,'preparation-member-'+ticket.id.slice(0,16),390);
          reviewed.push({id:ticket.id,filename:ticket.filename,view:reportKind?'maintained authenticated '+reportKind+' report preview with original linked assets':'actual browser file',...await hash(saved.file)});
        }finally{await child.close();}
      }else if(['.txt','.md','.csv','.json','.xml','.prj'].includes(extension)){
        const body=await fs.readFile(saved.file,'utf8'),viewer=join(directory,'view-'+ticket.id+'.html');
        const escaped=body.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        await fs.writeFile(viewer,'<!doctype html><meta charset="utf-8"><title>Original delivery file</title><style>body{font:14px monospace;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+ticket.filename.replace(/[&<>]/g,'_')+'</h1><pre>'+escaped+'</pre>',{mode:0o600});
        const child=await page.context().newPage();try{await child.goto(pathToFileURL(viewer).href,{waitUntil:'load'});await screenshot(child,'preparation-text-'+ticket.id.slice(0,16),1440);}finally{await child.close();}
        await saveFile(viewer,'full original text viewer');
        reviewed.push({id:ticket.id,filename:ticket.filename,view:'complete original text viewed',...await hash(saved.file)});
      }else reviewed.push({id:ticket.id,filename:ticket.filename,view:'retained for original native archive/GIS inspection',...await hash(saved.file)});
    }
    await retain(join(directory,'delivery-file-inspection.json'),{project_id:projectId,delivery_id:record.id,files:reviewed},{immutable:true});
    await saveFile(join(directory,'delivery-file-inspection.json'),'complete original delivery file inspection');
    await click('#detail-dialog [data-action="detail-close"]');
    return {delivery_id:record.id,file_count:files.length,completion_scope:ledger.requests.build.result.completion_scope};
  });
  await phase('saved-history-reopen',async()=>{
    await page.reload({waitUntil:'domcontentloaded'});await navigate();
    await click('[data-dp-action="open"][data-dp-id="'+ledger.preparation_id+'"]');await click('[data-dp-action="history"]');
    await page.locator('[data-dp-history] table').waitFor();await screenshot(page,'delivery-preparation-history',1440);await screenshot(page,'delivery-preparation-history',390);
    const value=await read('item',{preparation_id:ledger.preparation_id,revision:ledger.saved_revision});
    need(value.preparation.revision===ledger.saved_revision&&value.builds.some(r=>r.operation_id===ledger.requests.build.task_id),'Reopened history lost the original saved preparation or build');
    return {revision:value.preparation.revision,revision_id:value.preparation.revision_id};
  });
  const receipt={schema:SCHEMA,state:'BROWSER_COURSE_COMPLETE',intent,preparation_id:ledger.preparation_id,revision:ledger.saved_revision,build_operation_id:ledger.requests.build.task_id,delivery_id:ledger.delivery_id,
    working_copy:ledger.accepted_copy,requests:ledger.requests,files:ledger.files,phases:ledger.phases,completed_at:stamp(),
    remaining_native_join:'Run the maintained delivery_preparation_receiving.py against this actual completed build, then open its received original workspace and inspectReceivedDeliveryPreparation. Native archive/GIS and personal viewing acceptance must be retained before final handoff.'};
  await retain(join(directory,'browser-receipt.json'),receipt,{immutable:true});return receipt;
}

export async function inspectReceivedDeliveryPreparation({page,workspaceKey,receipt,nativeReceipt,request,screenshot,waitFor}){
  need(receipt?.state==='BROWSER_COURSE_COMPLETE','Select the exact completed preparation browser receipt');
  const native=nativeReceipt?.receipt;
  need(nativeReceipt?.schema===SCHEMA&&native?.schema===SCHEMA&&native.receiver?.application&&native.receiver?.workspace&&native.archive?.sha256,'Select the complete original native backup and receiving result');
  const selected=native.request;
  need(selected.project_id===receipt.intent.project_id&&selected.preparation_id===receipt.preparation_id&&selected.revision===receipt.revision&&selected.operation_id===receipt.build_operation_id&&selected.delivery_id===receipt.delivery_id,'The native receiving result belongs to another original preparation or build');
  need(native.received.preparation_sha256===selected.preparation_sha256&&native.received.result_sha256===selected.result_sha256,'The original native receipt lost its selected source identities');
  await page.locator('[data-view="delivery-preparation"]').click();await page.locator('.delivery-preparation').waitFor();
  const read=(operation,payload)=>request({method:'POST',path:'/api/delivery-preparation/'+operation,body:{workspace:workspaceKey,...payload}});
  const current=await read('item',{preparation_id:receipt.preparation_id,revision:receipt.revision});
  need(current.project_id===receipt.intent.project_id&&current.preparation.revision_id===receipt.phases['saved-history-reopen'].result.revision_id,'Received preparation differs from the original selected revision');
  for(const op of Object.values(receipt.requests)){
    const original=await read('operation',{operation_id:op.request.operation_id,task_id:op.task_id,request:op.request});
    need(['SAVED','COMPLETE'].includes(original.status),'The cold project lost the original preparation operation');
    need(original.origin?.task_id===op.task_id,'Cold receiving replaced the original canonical task identity');
  }
  await page.locator('[data-dp-action="open"][data-dp-id="'+receipt.preparation_id+'"]').click();
  await page.locator('[data-dp-action="history"]').click();await page.locator('[data-dp-history] table').waitFor();
  await screenshot(page,'received-delivery-preparation',1440);await screenshot(page,'received-delivery-preparation',390);
  await openExactWorkingCopy({page,workspaceKey,projectId:receipt.intent.project_id,file:receipt.working_copy.path,waitFor});
  await screenshot(page,'received-complete-preparation-copy',390);
  return {schema:SCHEMA,state:'COLD_BROWSER_RECEIVING_COMPLETE',project_id:receipt.intent.project_id,preparation_id:receipt.preparation_id,revision:receipt.revision,original_build_operation_id:receipt.build_operation_id,delivery_id:receipt.delivery_id,workspace_key:workspaceKey,original_native_receipt:{completed_at:native.completed_at,archive:native.archive,receiver:native.receiver,received:native.received},current_native_received:nativeReceipt.current_received};
}
