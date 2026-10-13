import {promises as fs,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants as fsConstants} from 'node:fs';
import {join,resolve,basename,extname} from 'node:path';
const SCHEMA='upstate.structural-study-browser-receiving/v1';
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

const normalize=value=>{const row=structuredClone(value);row.schema??='upstate.structural-study-selection/v1';row.references??=[];for(const c of row.cases)c.references??=[];return row;};
async function copies(page,workspaceKey,projectId){
  return page.evaluate(async({workspaceKey,projectId})=>{
    const db=await new Promise((ok,no)=>{const r=indexedDB.open('upstate-structural-studies-v1',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
    try{return await new Promise((ok,no)=>{const r=db.transaction('copies','readonly').objectStore('copies').index('scope').getAll(workspaceKey+':'+projectId);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}finally{db.close();}
  },{workspaceKey,projectId});
}
/** One chapter of the original authenticated browser course; no new browser, listener or model. */
export async function operateStructuralStudy({page,workspaceKey,projectId,selection,operationId,directory,request,screenshot,download,waitFor,inspectAttachment,receiveNative,uploadArchive,check=()=>{}}){
  need(page&&request&&screenshot&&download&&waitFor,'Use the original owned browser and authenticated receiving helpers');
  need(selection?.reference_run_id&&Array.isArray(selection.cases)&&selection.cases.length,'Supply the complete actual original study selection');
  selection=normalize(selection);directory=resolve(directory);await fs.mkdir(directory,{recursive:true,mode:0o700});
  const intent={schema:SCHEMA,operation_id:operationId,workspace_key:workspaceKey,project_id:projectId,selection};
  await retain(join(directory,'intent.json'),intent,{immutable:true});
  let ledger=await exists(join(directory,'progress.json'))?await json(join(directory,'progress.json')):{...intent,phases:{},requests:{},files:[],started_at:stamp()};
  need(same(Object.fromEntries(Object.keys(intent).map(k=>[k,ledger[k]])),intent),'This saved continuation belongs to a different original project or source selection');
  const checkpoint=()=>retain(join(directory,'progress.json'),ledger);
  const post=(path,body)=>request({method:'POST',path,body});
  const read=(name,payload={})=>post('/api/structural-studies/'+name,{workspace:workspaceKey,...payload});
  const click=async selector=>{check();await page.locator(selector).first().click();};
  const phase=async(name,fn)=>{
    check();if(ledger.phases[name]?.state==='complete')return ledger.phases[name].result;
    ledger.phases[name]={...ledger.phases[name],state:'running',started_at:ledger.phases[name]?.started_at||stamp()};await checkpoint();
    try{const value=await fn();ledger.phases[name]={...ledger.phases[name],state:'complete',result:value??null,completed_at:stamp()};await checkpoint();return value;}
    catch(e){ledger.phases[name]={...ledger.phases[name],state:'interrupted',message:e.message,observed_at:stamp()};await checkpoint();throw e;}
  };
  const retainFile=async(file,label)=>{
    const row={path:resolve(file),...await hash(file)},old=ledger.files.find(f=>f.path===row.path);
    if(old){need(same({path:old.path,bytes:old.bytes,sha256:old.sha256},row),'An original retained output file changed');old.labels=[...new Set([...old.labels,label])];}
    else ledger.files.push({...row,labels:[label]});await checkpoint();return old||ledger.files.at(-1);
  };
  const nativeWait=async fn=>{for(;;){check();const value=await fn();if(value)return value;check();await new Promise(ok=>setTimeout(ok,1000));}};
  const navigate=async()=>{await click('[data-view="structural-studies"]');await page.locator('.structural-studies').waitFor();await waitFor(async()=>await page.locator('[data-ss-action="new"]').first().isEnabled(),'the original structural desk catalog');};
  const visible=async()=>{const rows=await copies(page,workspaceKey,projectId);return rows.find(r=>r.id===ledger.working_copy_id)?.body;};
  async function openOriginalCopy(){
    const rows=await copies(page,workspaceKey,projectId),copy=rows.find(r=>r.id===ledger.working_copy_id);
    need(copy,'The original course browser profile or working copy is unavailable; receive the original profile/copy instead of creating another request');
    await click('[data-ss-action="local"][data-ss-id="'+copy.id+'"]');return copy;
  }
  async function recover(kind,action,payload){
    const d=await visible();need(d,'Open the original durable working copy before any request recovery');
    const rows=d.operations.filter(op=>op.request.action===action);
    need(rows.length<=1,'The original course has more than one unselected command for this phase');
    for(const row of rows)need(row.request.workspace===workspaceKey&&same(row.request.payload,payload),'A retained browser request differs from its full original phase inputs');
    if(ledger.requests[kind]){
      need(ledger.requests[kind].request.action===action&&same(ledger.requests[kind].request.payload,payload),'The retained course request differs from its original selected command');
      if(rows.length)need(same(rows[0].request,ledger.requests[kind].request),'The browser and original course retained different command UUIDs');
    }else if(rows.length){ledger.requests[kind]={request:rows[0].request,task_id:rows[0].task_id||null,recovered_from_working_copy:ledger.working_copy_id};await checkpoint();}
  }
  async function reconcile(kind){
    const selected=ledger.requests[kind];need(selected?.request,'Retain the complete original command before receiving it');
    let receipt=await read('operation',{operation_id:selected.request.operation_id,task_id:selected.task_id||null,request:selected.request});
    if(receipt.status==='NOT_FOUND'){
      need(selected.request.workspace===workspaceKey,'Receive the original operator task and alias before continuing in another workspace');
      const task=await post('/api/actions',selected.request);selected.task_id=task.id;await checkpoint();
      receipt=await read('operation',{operation_id:selected.request.operation_id,task_id:task.id,request:selected.request});
    }
    selected.task_id=receipt.task_id||receipt.task?.id||selected.task_id;await checkpoint();return receipt;
  }
  async function finishRequest(kind){
    await reconcile(kind);const selected=ledger.requests[kind];
    const receipt=await nativeWait(async()=>{
      const value=await read('operation',{operation_id:selected.request.operation_id,task_id:selected.task_id,request:selected.request});
      if(value.status==='COMPLETE'||value.task?.state==='complete')return value;
      if(['failed','cancelled','interrupted'].includes(value.task?.state))throw Error('The original '+kind+' task is '+value.task.state+'; retain and inspect task '+selected.task_id+': '+JSON.stringify(value.task.error||null));
      return null;
    });
    const result=receipt.result||receipt.task.result;
    if(selected.result)need(same(selected.result,result),'The first accepted original command result changed');else{selected.result=result;await checkpoint();}
    await click('[data-ss-action="receive"][data-ss-operation="'+selected.request.operation_id+'"]');
    await waitFor(async()=>{const d=await visible();return d?.operations.find(op=>op.operation_id===selected.request.operation_id)?.state==='complete';},'the original complete browser receipt');
    const replay=await post('/api/actions',selected.request);need(replay.id===selected.task_id,'Exact original replay created a different task');
    const again=await read('operation',{operation_id:selected.request.operation_id,task_id:selected.task_id,request:selected.request});
    need(same(again.result||again.task?.result,result),'Exact replay changed the immutable original result');
    return result;
  }
  async function submitPhase(kind,action,payload,control,{loseReply=false}={}){
    await recover(kind,action,payload);
    if(!ledger.requests[kind]){
      let caught=false;
      const intercept=async route=>{
        let body;try{body=route.request().postDataJSON();}catch{return route.continue();}
        if(body?.action!==action)return route.continue();
        need(body.workspace===workspaceKey&&same(body.payload,payload),'The actual UI sent different original inputs');
        need(!caught,'The original browser sent this phase twice before reconciliation');caught=true;
        ledger.requests[kind]={request:body};await checkpoint();
        const response=await route.fetch();need(response.ok(),'The original operator rejected task submission: '+response.status());
        const task=await response.json();ledger.requests[kind].task_id=task.id;await checkpoint();
        if(loseReply)return route.abort('connectionreset');
        return route.fulfill({response});
      };
      await page.route('**/api/actions',intercept);
      try{await click(control);await waitFor(async()=>!!ledger.requests[kind]?.task_id,'the original accepted '+kind+' command');}
      finally{await page.unroute('**/api/actions',intercept);}
    }
    return finishRequest(kind);
  }
  if(await exists(join(directory,'browser-receipt.json'))){
    const receipt=await json(join(directory,'browser-receipt.json'));need(same(receipt.intent,intent),'The completed original receipt differs from this selected course');
    for(const row of receipt.files)need(same(await hash(row.path),{bytes:row.bytes,sha256:row.sha256}),'A completed course artifact changed');
    for(const saved of Object.values(receipt.requests)){
      const actual=await read('operation',{operation_id:saved.request.operation_id,task_id:saved.task_id,request:saved.request});
      need(actual.status==='COMPLETE'||actual.task?.state==='complete','A completed original request is unavailable');
      need(same(actual.result||actual.task.result,saved.result),'The completed original request result changed');
    }
    need(receipt.native_receiving&&receipt.project_transfer?.request,'The completed whole-project receiving receipt is incomplete');
    const reopened=await receiveNative({studyId:receipt.study_id,reportOperationId:receipt.requests.report.task_id,report:receipt.requests.report.result});
    need(same(reopened.receipt,receipt.native_receiving),'Reopening changed the original full-project receiving generation');
    const restored=await post('/api/actions',receipt.project_transfer.request);
    need(restored.id===receipt.project_transfer.task_id&&same(restored.result,receipt.project_transfer.result),'The retained registered project restore result changed');
    // The current recipient state may contain later legitimate work. Its head
    // is not substituted into the first immutable receiving receipt.
    return receipt;
  }
  await navigate();
  await phase('original-selection-working-copy',async()=>{
    const input=join(directory,'original-selection-working-copy.json');
    if(!await exists(input))await retain(input,{schema:'upstate.structural-study-working-copy/v1',project:{id:projectId,title:'Original scientific workspace'},
      exported_at:ledger.started_at,draft:{id:operationId,created_at:ledger.started_at,updated_at:ledger.started_at,
      selection,raw:{},study:null,operations:[],frozen:false,origin:{kind:'original-structural-receiving-selection',operation_id:operationId}}},{immutable:true});
    const raw=await fs.readFile(input,'utf8'),matches=rows=>rows.filter(r=>r.body.imported_original?.text===raw);
    let rows=matches(await copies(page,workspaceKey,projectId));
    if(ledger.working_copy_id)need(rows.some(r=>r.id===ledger.working_copy_id),'The original imported course copy is unavailable in this browser profile');
    else{
      if(!rows.length){await page.locator('[data-ss-import]').setInputFiles(input);await waitFor(async()=>{rows=matches(await copies(page,workspaceKey,projectId));return rows.length>0;},'the full original source selection working copy');}
      rows.sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id));ledger.working_copy_id=rows[0].id;await checkpoint();
    }
    await openOriginalCopy();need(same((await visible()).selection,selection),'The browser changed the original complete selection');
    need(await page.locator('[data-ss-field="title"]').inputValue()===selection.title,'The named original study is not visible');
    need(await page.locator('[data-ss-field="reference_run_id"]').inputValue()===selection.reference_run_id,'The original reference run is not selected');
    need(await page.locator('[data-ss-case]').count()===selection.cases.length,'The guided case roster is incomplete');
    for(let index=0;index<selection.cases.length;index++){
      const c=selection.cases[index];need(await page.locator('[data-ss-field="cases.'+index+'.label"]').inputValue()===c.label,'An original case label changed');
      need(await page.locator('[data-ss-field="cases.'+index+'.grid_id"]').inputValue()===c.grid_id,'An original case grid changed');
      if(c.existing_run_id)need(await page.locator('[data-ss-field="cases.'+index+'.existing_run_id"]').inputValue()===c.existing_run_id,'A selected producer run was not retained');
    }
    // Typed editing uses the actual original value and persists the full case;
    // it introduces no synthetic scientific record or alternate calculation.
    await page.locator('[data-ss-field="purpose"]').fill(selection.purpose);
    await waitFor(async()=>same((await visible())?.selection,selection),'full typed study input persistence');
    await page.reload({waitUntil:'domcontentloaded'});await navigate();await openOriginalCopy();
    need(same((await visible()).selection,selection),'Reload lost the complete original study inputs');
    await screenshot(page,'structural-study-inputs',1440);await screenshot(page,'structural-study-inputs',390);
    await click('[data-ss-action="preview"]');
    await waitFor(async()=>await page.locator('.ss-readiness').count()>0,'scientific readiness and exact source-change review');
    const preview=await read('preview',selection);need(preview.eligible,'The actual selected structural study requires source review: '+JSON.stringify(preview.issues));
    need(same(preview.selection,selection),'The original preview changed selected inputs');
    await screenshot(page,'structural-study-scientific-readiness',1440);await screenshot(page,'structural-study-scientific-readiness',390);
    const earlier=ledger.files.find(row=>row.labels.includes('Downloaded typed working copy'));
    if(earlier)need(same(await hash(earlier.path),{bytes:earlier.bytes,sha256:earlier.sha256}),'The first downloaded typed working copy changed');
    const saved=earlier?{file:earlier.path}:await download(page.locator('[data-ss-action="download"]').first(),'Original structural-study working copy');
    need(same((await json(saved.file)).draft.selection,selection),'The actual working-copy file differs from the selected native inputs');
    await retainFile(input,'Original selected input working copy');await retainFile(saved.file,'Downloaded typed working copy');
    return {working_copy_id:ledger.working_copy_id,selection,preview,download:saved.file};
  });
  await openOriginalCopy();
  const prepared=await phase('original-preparation-lost-reply-and-replay',async()=>{
    const result=await submitPhase('prepare','structural-study.prepare',selection,'[data-ss-action="prepare"]',{loseReply:true});
    need(same(result.plan.selection,selection),'The original prepared plan differs from the complete selected inputs');
    ledger.study_id=result.id;await checkpoint();
    const selected=await read('item',{study_id:result.id});need(selected.id===result.id,'The prepared original study is unavailable');
    for(const input of selection.cases)if(input.existing_run_id){
      const actual=selected.cases.find(c=>c.id===input.id);need(actual?.run_id===input.existing_run_id&&actual.reused_original_run===true,'An explicitly selected completed case was replaced with a new run');
    }
    await screenshot(page,'structural-study-saved-plan',1440);await screenshot(page,'structural-study-saved-plan',390);return result;
  });
  ledger.study_id=prepared.id;await checkpoint();
  await phase('original-native-cases-and-replay',async()=>{
    const result=await submitPhase('run','structural-study.run',{study_id:ledger.study_id},'[data-ss-action="execute"]');
    need(result.id===ledger.study_id&&result.state==='complete','The exact original scientific comparison did not complete');
    const actual=await read('item',{study_id:ledger.study_id});
    need(actual.cases.length===selection.cases.length&&actual.cases.every(c=>c.state==='complete'),'The completed original native case roster is incomplete');
    const native=await read('result',{study_id:ledger.study_id});const file=join(directory,'original-scientific-result.json');await retain(file,native,{immutable:true});await retainFile(file,'Complete original comparison and support result');
    await click('[data-ss-action="results"]');
    await page.locator('.ss-results').waitFor({state:'visible'});
    await waitFor(async()=>await page.locator('.ss-results table tbody tr').count()>0,'the actual original scientific result quantities');
    await screenshot(page,'structural-study-native-results',1440);await screenshot(page,'structural-study-native-results',390);
    return {study_id:ledger.study_id,cases:actual.cases,result:native};
  });
  const report=await phase('complete-report-and-original-replay',async()=>{
    const result=await submitPhase('report','structural-study.report',{study_id:ledger.study_id},'[data-ss-action="report"]');
    need(result.schema==='upstate.structural-report/v1'&&result.study_id===ledger.study_id,'The report belongs to a different original scientific result');
    const value=await read('item',{study_id:ledger.study_id});need(same(value.report,result),'The selected saved report differs from its immutable result');
    await screenshot(page,'structural-study-report-files',1440);await screenshot(page,'structural-study-report-files',390);
    return result;
  });
  const nativeReceiving=await phase('complete-editable-project-native-receiving',async()=>{
    need(typeof receiveNative==='function','Continue this same completed study with its original full project receiver before final attachment inspection');
    const value=await receiveNative({studyId:ledger.study_id,reportOperationId:ledger.requests.report.task_id,report});
    need(value?.schema==='upstate.structural-study-receiving/v1'&&value.receipt.request.study_id===ledger.study_id&&value.receipt.request.project_id===projectId&&value.receipt.request.report_operation_id===ledger.requests.report.task_id,'The native receiver selected another original report operation');
    need(value.receipt.received.report_id===report.id&&same(value.receipt.received.files,report.files),'The original full project changed its completed report inventory');
    const file=join(directory,'original-native-receiving.json');await retain(file,value.receipt,{immutable:true});await retainFile(file,'Complete native project receive and attachment inspection');return value.receipt;
  });
  await phase('every-original-report-file-and-readable-preview',async()=>{
    const selected=await read('item',{study_id:ledger.study_id});
    const descriptors=Object.entries(report.files),opened=[];ledger.attachment_openings??={};
    for(const [role,descriptor]of descriptors){
      check();const ticket=selected._downloads.find(row=>row.role===role&&row.bytes===descriptor.bytes&&row.sha256===descriptor.sha256);
      need(ticket,'The complete report inventory has no original download for '+role);
      const already=ledger.files.find(f=>f.labels.includes('Report member '+role));
      let file;
      if(already){need(same(await hash(already.path),{bytes:descriptor.bytes,sha256:descriptor.sha256}),'An original downloaded report member changed');file=already.path;}
      else{
        const result=await download(page.locator('a[download][href="'+ticket.url+'"]').first(),'Report member '+role);
        file=result.file;need(same(await hash(file),{bytes:descriptor.bytes,sha256:descriptor.sha256}),'The original report download changed: '+role);await retainFile(file,'Report member '+role);
      }
      const originalOpening=ledger.attachment_openings[role];
      if(originalOpening){need(originalOpening.path===file,'The retained original attachment opening names another file');opened.push(originalOpening);continue;}
      const extension=extname(ticket.filename).toLowerCase();
      if(['.json','.csv','.md','.txt'].includes(extension)){
        const body=await fs.readFile(file,'utf8');if(extension==='.json')JSON.parse(body);
        opened.push({role,path:file,method:'read_complete_original_text',characters:body.length});
      }else if(extension==='.pdf'){
        const observation=nativeReceiving.attachments.files[role];
        const rendered=observation?.opened?.render;
        need(observation.sha256===descriptor.sha256&&observation.bytes===descriptor.bytes&&rendered?.state==='complete'&&rendered.source_sha256===descriptor.sha256&&rendered.pages.length,'Open every original PDF page through the retained native renderer');
        const pages=[];
        for(const row of rendered.pages){
          check();const image=row.image;
          need(same(await hash(image.absolute_path),{bytes:image.bytes,sha256:image.sha256}),'An original rendered PDF page changed');
          await retainFile(image.absolute_path,'Original PDF page '+row.page);
          const tab=await page.context().newPage();
          try{
            const data=(await fs.readFile(image.absolute_path)).toString('base64');
            await tab.setContent('<!doctype html><meta charset="utf-8"><title>Original report page '+row.page+'</title><style>body{margin:0;background:white}img{display:block;width:100%;height:auto}</style><img alt="Original report page '+row.page+'" src="data:image/png;base64,'+data+'">',{waitUntil:'load'});
            await tab.waitForFunction(()=>document.images.length===1&&document.images[0].complete&&document.images[0].naturalWidth>0);
            await screenshot(tab,'structural-report-'+role+'-page-'+row.page,1440);
            pages.push({page:row.page,image});
          }finally{await tab.close();}
        }
        opened.push({role,path:file,method:'original_pdf_all_pages_native_render_and_browser_open',source_sha256:descriptor.sha256,renderer:rendered.renderer,pages});
      }else if(extension==='.html'||['.png','.jpg','.jpeg','.svg'].includes(extension)){
        const originalURL=extension==='.html'?selected._report_preview_url:ticket.url;need(originalURL,'The readable original report preview is unavailable');
        const tab=await page.context().newPage();
        try{
          const response=await tab.goto(new URL(originalURL,page.url()).href,{waitUntil:'domcontentloaded'});need(response?.ok(),'The actual original file failed to open: '+role);
          if(extension==='.html'){need((await tab.locator('body').innerText()).trim().length>0,'The actual report is empty');
            await tab.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
            const images=await tab.locator('img').evaluateAll(rows=>rows.map(x=>({src:x.getAttribute('src'),complete:x.complete,width:x.naturalWidth})));
            need(images.every(x=>x.complete&&x.width>0),'A scientific report map figure did not render');}
          else if(['.png','.jpg','.jpeg','.svg'].includes(extension))await tab.waitForFunction(()=>[...document.images].length>0&&[...document.images].every(x=>x.complete&&x.naturalWidth>0));
          await screenshot(tab,'structural-report-'+role,1440);
          if(extension==='.html')await screenshot(tab,'structural-report-'+role,390);
          opened.push({role,path:file,method:'opened_original_browser_file',url:originalURL});
        }finally{await tab.close();}
      }else{
        need(typeof inspectAttachment==='function','Keep the original completed report and downloads; the original native receiver must now open '+ticket.filename+' and its contained deliverables before this phase is complete.');
        const receipt=await inspectAttachment({file,descriptor:{...descriptor,role},study:selected,report,nativeReceiving});
        need(receipt?.opened===true,'The original native attachment has no actual opening receipt: '+ticket.filename);
        opened.push({role,path:file,method:'original_native_application',receipt});
      }
      ledger.attachment_openings[role]=opened.at(-1);await checkpoint();
    }
    await retain(join(directory,'original-attachment-inspection.json'),{study_id:ledger.study_id,report_id:report.id,opened},{immutable:true});
    await retainFile(join(directory,'original-attachment-inspection.json'),'All original report attachments and figures opened');return {opened};
  });
  await phase('accepted-working-copy-file-and-reopen',async()=>{
    let file=ledger.completed_working_copy_file||ledger.files.find(row=>row.labels.includes('Completed exact working copy'))?.path;
    if(file&&!ledger.completed_working_copy_file){ledger.completed_working_copy_file=file;await checkpoint();}
    if(file){const descriptor=ledger.files.find(f=>f.path===file);need(descriptor&&same(await hash(file),{bytes:descriptor.bytes,sha256:descriptor.sha256}),'The original completed working-copy file changed');}
    else{const result=await download(page.locator('[data-ss-action="download"]').first(),'Completed structural-study working copy');file=resolve(result.file);await retainFile(file,'Completed exact working copy');ledger.completed_working_copy_file=file;await checkpoint();}
    const raw=await fs.readFile(file,'utf8'),value=JSON.parse(raw);need(value.draft.study.id===ledger.study_id&&value.draft.operations.every(op=>op.state==='complete'),'The completed working copy is missing original accepted commands');
    await retainFile(file,'Completed exact working copy');
    let rows=(await copies(page,workspaceKey,projectId)).filter(r=>r.body.imported_original?.text===raw),chosen=ledger.imported_completed_copy_id?rows.find(r=>r.id===ledger.imported_completed_copy_id):rows[0];
    if(ledger.imported_completed_copy_id)need(chosen,'The original imported completed-copy identity is unavailable');
    if(!chosen){await page.locator('[data-ss-import]').setInputFiles(file);await waitFor(async()=>{rows=(await copies(page,workspaceKey,projectId)).filter(r=>r.body.imported_original?.text===raw);chosen=rows[0];return !!chosen;},'the exact completed file-opened copy');}
    ledger.imported_completed_copy_id=chosen.id;await checkpoint();
    await click('[data-ss-action="local"][data-ss-id="'+chosen.id+'"]');
    for(const op of value.draft.operations)await click('[data-ss-action="receive"][data-ss-operation="'+op.operation_id+'"]');
    await waitFor(async()=>{chosen=(await copies(page,workspaceKey,projectId)).find(r=>r.id===ledger.imported_completed_copy_id);return chosen?.body.operations.every(op=>op.state==='complete');},'all original accepted results in the file-opened copy');
    need(same(chosen.body.selection,selection),'The file-opened completed copy changed the original scientific plan');
    await screenshot(page,'structural-study-reopened-working-copy',1440);await screenshot(page,'structural-study-reopened-working-copy',390);
    return {file,working_copy_id:chosen.id,study_id:ledger.study_id};
  });
  const registered=await phase('complete-project-original-restore-and-browser-open',async()=>{
    need(typeof uploadArchive==='function','Use the original complete-project upload and restore route');
    const archive=nativeReceiving.archive;
    if(!ledger.project_transfer)ledger.project_transfer={archive:{path:archive.path,bytes:archive.bytes,sha256:archive.sha256}};
    const transfer=ledger.project_transfer;need(same(transfer.archive,{path:archive.path,bytes:archive.bytes,sha256:archive.sha256}),'The retained project transfer names another complete archive');
    await checkpoint();
    if(!transfer.upload){transfer.upload=await uploadArchive({file:archive.path,descriptor:archive});need(transfer.upload.bytes===archive.bytes&&transfer.upload.sha256===archive.sha256,'The original upload changed the full project archive');await checkpoint();}
    if(!transfer.request){transfer.request={workspace:workspaceKey,operation_id:'structural-restore-'+createHash('sha256').update(JSON.stringify(sort(intent))).digest('hex').slice(0,40),action:'workspace.restore',payload:{upload_id:transfer.upload.id}};await checkpoint();}
    const task=await post('/api/actions',transfer.request);
    need(task.workspace===workspaceKey&&task.action==='workspace.restore'&&same(task.payload,transfer.request.payload),'The original restore task belongs to another retained request');
    if(transfer.task_id)need(task.id===transfer.task_id,'Exact project restore replay changed its canonical task');else{transfer.task_id=task.id;await checkpoint();}
    const complete=await nativeWait(async()=>{
      const row=await request({method:'GET',path:'/api/task',query:{id:transfer.task_id}});
      if(row.state==='complete')return row;
      if(['failed','cancelled','interrupted'].includes(row.state))throw Error('Inspect the original project restore task '+row.id+': '+JSON.stringify(row.error));return null;
    });
    const result=complete.result;
    need(result.identity==='MATCH'&&result.archive_sha256===archive.sha256&&result.project.id===projectId&&result.workspace_key,'The registered original project is not an exact restore');
    if(transfer.result)need(same(transfer.result,result),'The original restore completion changed');else{transfer.result=result;await checkpoint();}
    const replay=await post('/api/actions',transfer.request);need(replay.id===transfer.task_id&&same(replay.result,result),'Exact original project restore replay changed its accepted result');
    await page.reload({waitUntil:'domcontentloaded'});
    await waitFor(async()=>await page.locator('#workspace-select option[value="'+result.workspace_key+'"]').count()>0,'the original registered restored workspace');
    await page.locator('#workspace-select').selectOption(result.workspace_key);
    const cold=await inspectReceivedStructuralStudy({page,workspaceKey:result.workspace_key,projectId,studyId:ledger.study_id,reportId:report.id,
      expectedCases:ledger.phases['original-native-cases-and-replay'].result.cases,request,screenshot,waitFor});
    const operation=await request({method:'POST',path:'/api/structural-studies/operation',body:{workspace:result.workspace_key,
      task_id:ledger.requests.report.task_id,operation_id:ledger.requests.report.request.operation_id,request:ledger.requests.report.request}});
    need(operation.status==='COMPLETE'&&same(operation.result,report),'The browser-received workspace lost its original native report journal');
    const observed={archive_sha256:archive.sha256,helper_receiver:nativeReceiving.receiver,browser_receiver:result,restored_original_report:operation.result,cold};
    const file=join(directory,'original-browser-project-receiving.json');await retain(file,observed,{immutable:true});await retainFile(file,'Actual restored project opened in the authenticated browser');
    await page.locator('#workspace-select').selectOption(workspaceKey);
    return observed;
  });
  const receipt={schema:SCHEMA,intent,state:'BROWSER_REPORT_RECEIVING_COMPLETE',study_id:ledger.study_id,report_id:report.id,
    native_execution_ownership:'original supervised task and saved case runs',requests:ledger.requests,files:ledger.files,
    phases:ledger.phases,completed_at:stamp(),native_receiving:nativeReceiving,registered_project:registered,project_transfer:ledger.project_transfer};
  await retain(join(directory,'browser-receipt.json'),receipt,{immutable:true});return receipt;
}

/** Open the actual cold-received study on its original authenticated listener. */
export async function inspectReceivedStructuralStudy({page,workspaceKey,projectId,studyId,reportId,expectedCases,request,screenshot,waitFor}){
  need(expectedCases?.length,'Retain the original accepted case roster for cold receiving');
  await page.locator('[data-view="structural-studies"]').click();await page.locator('.structural-studies').waitFor();
  await waitFor(async()=>await page.locator('[data-ss-action="open"][data-ss-id="'+studyId+'"]').count()>0,'the actual cold-received saved study');
  await page.locator('[data-ss-action="open"][data-ss-id="'+studyId+'"]').click();
  const value=await request({method:'POST',path:'/api/structural-studies/item',body:{workspace:workspaceKey,study_id:studyId}});
  need(value.project_id===projectId&&value.id===studyId&&value.report?.id===reportId,'The cold receiver selected another original project, study or report');
  need(same(value.cases.map(c=>({id:c.id,run_id:c.run_id,profile_id:c.profile_id,grid_id:c.grid_id})),expectedCases.map(c=>({id:c.id,run_id:c.run_id,profile_id:c.profile_id,grid_id:c.grid_id}))),'The complete original native case identities changed on cold receive');
  need(value._downloads.length>=Object.keys(value.report.files).length,'The cold-received report file inventory is incomplete');
  await page.locator('[data-ss-study="'+studyId+'"]').waitFor({state:'visible'});
  await waitFor(async()=>await page.locator('[data-ss-study="'+studyId+'"] table').first().locator('tbody tr').count()===expectedCases.length&&await page.locator('[data-ss-action="preview-report"]').isEnabled(),'the populated original cold study and report controls');
  await screenshot(page,'structural-study-cold-received-project',1440);await screenshot(page,'structural-study-cold-received-project',390);
  return {project_id:projectId,study_id:studyId,report_id:reportId,cases:value.cases,report:value.report,actual_project_opened:true};
}


/** One foreground invocation of the installed original receiver; no new model or listener. */
export async function receiveStructuralProjectNative({python,application,workspace,studyId,reportOperationId,directory,check=()=>{}}){
  directory=resolve(directory);await fs.mkdir(directory,{recursive:true,mode:0o700});
  const script=join(resolve(application),'operator','structural_study_receiving.py');
  const receiver=join(directory,'receiver'),argv=['-B',script,'--workspace',resolve(workspace),'--study-id',studyId,'--report-operation-id',reportOperationId,'--output',receiver];
  need(resolve(python)===python&&resolve(application)===application,'Use the actual installed Python and original application paths');
  const command={python,argv,script:await hash(script),workspace:resolve(workspace),study_id:studyId,report_operation_id:reportOperationId};
  await retain(join(directory,'command.json'),command,{immutable:true});
  const processFile=join(directory,'process.json');
  async function info(pid){
    try{const raw=await fs.readFile('/proc/'+pid+'/stat','utf8'),f=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);return {pid:Number(pid),state:f[0],pgrp:Number(f[2]),session:Number(f[3]),started:f[19]};}
    catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
  }
  async function members(owner){
    const found=[];
    for(const id of await fs.readdir('/proc'))if(/^\d+$/.test(id)){
      const row=await info(id);if(row&&row.session===owner.pid&&row.pgrp===owner.pid&&BigInt(row.started)>=BigInt(owner.started))found.push(row);
    }
    return found.filter(row=>row.state!=='Z');
  }
  async function stopOwned(owner){
    const leader=await info(owner.pid);need(!leader||leader.started===owner.started,'The original receiver PID now belongs to another process; no signal was sent');
    const list=await members(owner);if(!list.length)return;
    // This session and process group were created by our detached spawn. Verify
    // every selected inode generation immediately before an owned signal.
    for(const row of list){const current=await info(row.pid);if(current&&current.started===row.started&&current.session===owner.pid&&current.pgrp===owner.pid)try{process.kill(row.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
    const end=Date.now()+10000;
    while(Date.now()<end&&(await members(owner)).length)await new Promise(ok=>setTimeout(ok,100));
    for(const row of await members(owner)){const current=await info(row.pid);if(current&&current.started===row.started&&current.session===owner.pid&&current.pgrp===owner.pid)try{process.kill(row.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
    const killedAt=Date.now();
    while((await members(owner)).length&&Date.now()-killedAt<10000)await new Promise(ok=>setTimeout(ok,100));
    need(!(await members(owner)).length,'The original receiver process group has not finished closing');
  }
  if(await exists(processFile)){
    const prior=await json(processFile);need(same(prior.command,command),'The retained native receiver process belongs to another command');
    if(prior.owner&&prior.state==='running'){
      const leader=await info(prior.owner.pid);
      need(!leader||leader.started===prior.owner.started,'The saved receiver PID was reused; reconcile its original process receipt before continuation');
      need(leader||!(await members(prior.owner)).length,'An orphaned original receiver session requires its original process-owner reconciliation');
      try{while((await members(prior.owner)).length){check();await new Promise(ok=>setTimeout(ok,1000));}}
      catch(error){try{await stopOwned(prior.owner);}catch(cleanupError){throw new AggregateError([error,cleanupError],'Original retained receiver recovery failed and cleanup also reported an error',{cause:error});}throw error;}
    }
  }
  check();
  const attempt=String(Date.now()),stdout=join(directory,'stdout-'+attempt+'.json'),stderr=join(directory,'stderr-'+attempt+'.txt');
  let out,err,child,owner,completion,closed=false,settled,spawnError,primary,result;
  const cleanup=[];
  try{
    out=await fs.open(stdout,'wx',0o600);
    err=await fs.open(stderr,'wx',0o600);
    child=spawn(python,argv,{cwd:application,stdio:['ignore',out.fd,err.fd],detached:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    completion=new Promise(ok=>{child.once('error',error=>{spawnError=error;closed=true;ok({error:error.message});});child.once('close',(code,signal)=>{closed=true;ok({code,signal});});});
    // Spawned PID is in this Node process's namespace; no host PID translation.
    while(!owner&&!closed){owner=await info(child.pid);if(!owner)await new Promise(ok=>setTimeout(ok,5));}
    if(spawnError)throw spawnError;
    need(owner&&owner.pgrp===child.pid&&owner.session===child.pid,'The original receiver did not acquire its owned Linux session');
    await retain(processFile,{command,owner,stdout,stderr,state:'running',started_at:stamp()});
    while(!closed){check();await new Promise(ok=>setTimeout(ok,500));}
    settled=await completion;check();
    await out.sync();await err.sync();
    await retain(processFile,{command,owner,stdout,stderr,state:'exited',result:settled,finished_at:stamp()});
    if(spawnError)throw spawnError;
    need(settled.code===0,'The original complete project receiver failed; inspect '+stderr);
    const value=await json(stdout);
    need(value.schema==='upstate.structural-study-receiving/v1'&&value.receipt.request.study_id===studyId&&value.receipt.request.report_operation_id===reportOperationId,'The original receiver returned another operation');
    result=value;
  }catch(error){primary=error;}
  finally{
    if(child){
      try{
        if(owner&&(await members(owner)).length)await stopOwned(owner);
        else if(!closed)child.kill('SIGTERM');
      }catch(error){cleanup.push(error);if(!closed)try{child.kill('SIGKILL');}catch(extra){cleanup.push(extra);}}
      if(completion)try{await completion;}catch(error){cleanup.push(error);}
    }
    for(const handle of [out,err])if(handle)try{await handle.close();}catch(error){cleanup.push(error);}
  }
  if(primary&&cleanup.length)throw new AggregateError([primary,...cleanup],'Original native receiving failed and cleanup also reported errors',{cause:primary});
  if(primary)throw primary;
  if(cleanup.length)throw new AggregateError(cleanup,'Original native receiving cleanup reported errors');
  return result;
}

/** Stream this exact original archive through the maintained authenticated upload. */
export async function uploadStructuralArchive({file,descriptor,origin,token,workspaceKey,check=()=>{}}){
  check();const handle=await fs.open(file,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
  const control=new AbortController();let timer,source,interruption;
  try{
    const before=await handle.stat({bigint:true});need(before.isFile()&&before.size===BigInt(descriptor.bytes),'The complete original archive size changed');
    const state=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
    const checksum=createHash('sha256');let bytes=0;
    source=handle.createReadStream({autoClose:false});
    async function* body(){for await(const chunk of source){check();bytes+=chunk.length;need(bytes<=descriptor.bytes,'The original archive grew during upload');checksum.update(chunk);yield chunk;}}
    timer=setInterval(()=>{try{check();}catch(error){interruption=error;control.abort(error);source.destroy(error);}},500);
    const response=await fetch(new URL('/api/upload',origin),{method:'POST',headers:{Authorization:'Bearer '+token,Origin:new URL(origin).origin,
      'X-Workspace':workspaceKey,'X-Upload-Filename':encodeURIComponent(basename(file)),'Content-Type':'application/zip','Content-Length':String(descriptor.bytes)},
      body:body(),duplex:'half',signal:control.signal});
    const value=await response.json();
    need(response.ok,'The original project upload failed: '+response.status+' '+(value.error?.message||''));
    need(bytes===descriptor.bytes&&checksum.digest('hex')===descriptor.sha256&&value.bytes===descriptor.bytes&&value.sha256===descriptor.sha256,'The complete uploaded archive changed its original identity');
    const after=await handle.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});
    need(state(before)===state(after)&&state(after)===state(named),'The original archive changed during upload');
    return value;
  }catch(error){throw interruption||error;}
  finally{if(timer)clearInterval(timer);source?.destroy();await handle.close();}
}
