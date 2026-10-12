import fs from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.APEX_OPERATOR_ROOT||path.dirname(here);
const app=process.env.APEX_WORKBENCH_APP||path.join(root,'workbench');
const workspace=process.env.APEX_OPERATOR_WORKSPACE||'/workspace/scratch/62002f3ae951/apex-source-inputs/receiving/workspace';
const output=process.env.APEX_OPERATOR_OUTPUT||path.join(root,'operator-journey','result');
const scratch=process.env.APEX_BROWSER_SCRATCH||path.join(output,'browser-runtime');
const executable=process.env.APEX_BROWSER_EXECUTABLE||'/workspace/scratch/5403360e55a4/fleet-lightweight/shared/swarm/toolchains/browser/chromium-153.0.0/chromium';
const python=process.env.APEX_PYTHON||'python3';
const designPath=path.join(here,'original-case.json');
const nativeHelper=path.join(here,'apex_operator_native.py');
const design=JSON.parse(await fs.readFile(designPath,'utf8'));
const progressPath=path.join(output,'BROWSER-PROGRESS.json');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.APEX_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const labels={method:'Pay structures',roles:'Role classifications',roster:'Workforce editions',scenario:'Placement and cost'};
const groups={method:'methods',roles:'roles',roster:'rosters',scenario:'scenarios'};
const actor='F11 original Apex operator journey';
const proposedName='Apex published M14 upper-bound planning alternative';
const initialTitle='Apex published upper-bound planning alternative';
const finalTitle='Apex published upper-bound planning alternative — source review edition';
const rationale='Planning alternative for the original Fire/Rescue Assistant Fire Chief authorization group. Preserve FTE 3 and the current annual full-time base 104849.06; compare the published M14 maximum 162501.04 with the retained published market salary 128436.88. Original source: CN19-A1 PDF page 2, pay-plan-p2-l38; authorized group: CN20-A1 PDF page 2. Record the placement decision against these original editions.';
let previous=null;
try{previous=JSON.parse(await fs.readFile(progressPath,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;}
if(previous&&(previous.operation_id!==design.operation_id||previous.workspace_id!==design.workspace_id||previous.workspace!==workspace))
  throw new Error('The retained operator journey belongs to another original case.');
if(previous?.status==='complete'){
  const finalPath=path.join(output,'BROWSER-RESULT.json'),expected=json(previous);
  let finalBytes;
  try{finalBytes=await fs.readFile(finalPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(finalBytes&&!finalBytes.equals(expected))throw new Error('The final result differs from its original completed progress.');
  if(!finalBytes)await atomic(finalPath,expected);
  process.stdout.write(JSON.stringify({status:'complete',reused:true,operation_id:design.operation_id,result:finalPath})+'\n');
  process.exit(0);
}
const result={...(previous||{}),schema:'apex.operator.browser-journey.v1',operation_id:design.operation_id,
  workspace,workspace_id:design.workspace_id,started_at:previous?.started_at||new Date().toISOString(),
  mutations:previous?.mutations||{},steps:previous?.steps||{},downloads:previous?.downloads||{},
  attempts:previous?.attempts||[],status:'running'};
const attempt={started_at:new Date().toISOString(),page_errors:[],http_errors:[],route_errors:[]};
result.attempts.push(attempt);
delete result.error;
let server,context,page,activeMutation=null,originals=null,interrupted=false;
const children=new Set();

async function atomic(file,bytes){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=path.join(path.dirname(file),'.'+path.basename(file)+'-'+randomUUID()+'.part');
  let handle;
  try{
    handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    await fs.rename(temporary,file);
    const directory=await fs.open(path.dirname(file),'r');
    try{await directory.sync();}finally{await directory.close();}
  }finally{
    if(handle)await handle.close().catch(()=>{});
    await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function retained(relative,bytes){
  const file=path.join(output,relative);
  let existing;
  try{existing=await fs.readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing&&!existing.equals(bytes))throw new Error('Retained exact bytes differ: '+relative);
  if(!existing)await atomic(file,bytes);
  return {path:file,bytes:bytes.length,sha256:sha(bytes)};
}
async function readRef(ref){
  const bytes=await fs.readFile(ref.path);
  if(bytes.length!==ref.bytes||sha(bytes)!==ref.sha256)throw new Error('Retained bytes changed: '+ref.path);
  return bytes;
}
async function checkpoint(stage,details={}){
  if(stage)result.steps[stage]={completed_at:new Date().toISOString(),...details};
  await atomic(progressPath,json(result));
  if(stage)process.stdout.write(JSON.stringify({stage,...details})+'\n');
}
function within(promise,ms,label){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]).finally(()=>clearTimeout(timer));
}
function child(command,args,options={}){
  const instance=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});
  children.add(instance);instance.once('close',()=>children.delete(instance));
  return instance;
}
async function runNative(mode){
  const instance=child(python,['-B',nativeHelper,mode,app,workspace,root,output,designPath],{cwd:app,env:{...process.env,TMPDIR:scratch}});
  let stdout='',stderr='';
  instance.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>8*1024*1024)instance.kill('SIGTERM');});
  instance.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-12000);});
  const code=await new Promise((resolve,reject)=>{instance.once('error',reject);instance.once('close',resolve);});
  if(code!==0)throw new Error('Original native '+mode+' leg failed ('+code+'): '+stderr);
  return JSON.parse(stdout);
}
async function stopChild(instance){
  if(instance.exitCode!==null||instance.signalCode!==null)return;
  instance.kill('SIGTERM');
  try{await within(new Promise(resolve=>instance.once('close',resolve)),8000,'Owned process shutdown');}
  catch(error){instance.kill('SIGKILL');await within(new Promise(resolve=>instance.once('close',resolve)),5000,'Owned process termination');}
}
async function closeOwned(){
  if(context){const owned=context;context=null;await owned.close();}
  for(const instance of [...children])await stopChild(instance);
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  interrupted=true;attempt.signal=signal;
  void closeOwned().catch(error=>{attempt.cleanup_error=error.message;});
});

async function requestJson(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  let value;
  try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('Original JSON response is malformed: '+url);}
  if(!response.ok)throw new Error('Original read returned '+response.status+': '+JSON.stringify(value));
  return value;
}
function safeHeaders(headers){
  return Object.fromEntries(Object.entries(headers).filter(([name])=>!['content-length','content-encoding','transfer-encoding','connection'].includes(name.toLowerCase())));
}
async function recordResponse(step,status,headers,bytes,transport){
  const entry=result.mutations[step],hash=sha(bytes);
  const ref=await retained('responses/'+step+'-'+hash+'.json',bytes);
  const receipt={status,headers,body:ref,transport,observed_at:new Date().toISOString()};
  entry.responses=entry.responses||[];entry.responses.push(receipt);
  if(status>=200&&status<300)entry.success=receipt;
  await checkpoint(null);
  return receipt;
}
async function mutationValue(step){
  const entry=result.mutations[step];
  if(!entry?.success)throw new Error('The original mutation has no successful result: '+step);
  const value=JSON.parse((await readRef(entry.success.body)).toString('utf8'));
  if(!Object.hasOwn(value,'result'))throw new Error('The original mutation omitted its result: '+step);
  return value.result;
}
async function reconcileMutations(){
  for(const [step,entry]of Object.entries(result.mutations)){
    await readRef(entry.request);
    if(entry.success){await readRef(entry.success.body);continue;}
    const last=entry.responses?.at(-1);
    if(last&&last.status<500)throw new Error('The retained '+step+' request returned '+last.status+'; its exact response remains available.');
    const body=await readRef(entry.request),parsed=JSON.parse(body.toString('utf8'));
    if(parsed.operation_id!==entry.operation_id)throw new Error('Original operation identity changed: '+step);
    const response=await fetch(result.server_url+entry.path,{method:'POST',headers:{'content-type':'application/json'},
      body,signal:AbortSignal.timeout(30000)});
    const bytes=Buffer.from(await response.arrayBuffer());
    await recordResponse(step,response.status,Object.fromEntries(response.headers),bytes,'exact original operation replay');
    if(!response.ok)throw new Error('Original operation replay returned '+response.status+' for '+step);
    await checkpoint('reconciled-'+step,{operation_id:entry.operation_id});
  }
}
async function captureRoute(route){
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='POST')return route.continue();
  try{
    if(url.origin!==result.server_url)throw new Error('A mutation left the original local workspace.');
    const bytes=request.postDataBuffer(),body=JSON.parse(bytes.toString('utf8'));
    if(typeof body.operation_id!=='string'||!body.operation_id)throw new Error('The original mutation has no stable operation ID.');
    let step=Object.keys(result.mutations).find(key=>result.mutations[key].operation_id===body.operation_id);
    if(!step){
      if(!activeMutation||activeMutation.path!==url.pathname)throw new Error('Unexpected mutation outside the active original step: '+url.pathname);
      step=activeMutation.step;
      if(result.mutations[step])throw new Error('A new operation attempted to replace the retained step: '+step);
      const ref=await retained('requests/'+step+'-'+sha(bytes)+'.json',bytes);
      result.mutations[step]={path:url.pathname,operation_id:body.operation_id,request:ref,
        request_headers:request.headers(),captured_at:new Date().toISOString(),responses:[]};
      await checkpoint(null);
    }
    const entry=result.mutations[step],original=await readRef(entry.request);
    if(entry.path!==url.pathname||!original.equals(bytes))throw new Error('The browser changed the exact retained operation: '+step);
    let receipt=entry.success;
    if(!receipt){
      const response=await route.fetch({timeout:30000,maxRedirects:0});
      receipt=await recordResponse(step,response.status(),response.headers(),await response.body(),'original browser request');
    }
    const returned=await readRef(receipt.body);
    await route.fulfill({status:receipt.status,headers:safeHeaders(receipt.headers),body:returned});
  }catch(error){
    attempt.route_errors.push(error.message);
    await route.abort('failed').catch(()=>{});
  }
}
async function ready(){
  if(interrupted)throw new Error('The original operator run was interrupted.');
  await page.locator('.classification').waitFor({state:'visible'});
  await page.waitForFunction(()=>{const node=document.querySelector('.classification');return node&&!node.hasAttribute('aria-busy');});
}
function classification(){return page.locator('.classification');}
async function enterClassification(){
  await page.locator('#nav [data-view="classification"]').click();await ready();
}
async function tab(name){
  await classification().getByRole('tab',{name,exact:true}).click();await ready();
}
async function mutation(step,pathname,trigger){
  if(result.mutations[step]?.success)return mutationValue(step);
  if(result.mutations[step])throw new Error('Reconcile the original pending request before continuing '+step);
  activeMutation={step,path:pathname};
  try{
    const observed=page.waitForResponse(response=>new URL(response.url()).pathname===pathname&&response.request().method()==='POST');
    observed.catch(()=>{});
    await trigger();const response=await observed;
    if(response.status()>=400)throw new Error('The original '+step+' request returned '+response.status());
    const value=await mutationValue(step);await ready();
    return value;
  }finally{activeMutation=null;}
}
async function currentDoc(kind,id){
  const doc=await requestJson(result.server_url+'/api/extensions/classification/document/'+kind+'/'+encodeURIComponent(id));
  if(doc.id!==id||doc.kind!==kind)throw new Error('The native original document identity differs.');
  return doc;
}
async function openDocument(kind,id){
  await tab('Review and exports');
  const state=await requestJson(result.server_url+'/api/extensions/classification/state');
  const rows=state[groups[kind]],index=rows.findIndex(row=>row.id===id);
  if(index<0)throw new Error('The original history lacks '+id);
  const panel=classification().locator('section.panel').filter({has:page.getByRole('heading',{name:labels[kind],exact:true})});
  if(await panel.count()!==1)throw new Error('The original '+kind+' history is ambiguous.');
  const history=panel.locator('table tbody tr');
  if(await history.count()!==rows.length)throw new Error('The rendered history differs from its original source rows.');
  const row=history.nth(index),text=await row.innerText();
  if(!text.includes(rows[index].created_at))throw new Error('The rendered row differs from the selected original edition.');
  await row.getByRole('button',{name:'Inspect / review',exact:true}).click();await ready();
  const doc=await currentDoc(kind,id);
  await classification().getByText('ID: '+id+' · SHA-256 '+doc.sha256,{exact:true}).waitFor();
  return doc;
}
function inspection(kind){
  return classification().locator('section.panel').filter({
    has:page.getByRole('heading',{name:'Original '+labels[kind].toLowerCase()+' edition',exact:true})
  });
}
async function browserDownload(key,locator,expected){
  const [download]=await Promise.all([page.waitForEvent('download'),locator.click()]);
  const stream=await download.createReadStream(),chunks=[];
  for await(const bytes of stream)chunks.push(bytes);
  const actual=Buffer.concat(chunks),original=await readRef(expected);
  if(!actual.equals(original))throw new Error('The complete browser download differs: '+key);
  result.downloads[key]={control:await locator.innerText(),filename:download.suggestedFilename(),
    bytes:actual.length,sha256:sha(actual),original:expected.path,exact_match:true,observed_at:new Date().toISOString()};
  await download.delete();await checkpoint(null);
  return actual;
}
async function layout(name){
  const observed=await page.evaluate(()=>({viewport:innerWidth,document_width:document.documentElement.scrollWidth,
    body_width:document.body.scrollWidth,scroll_tables:[...document.querySelectorAll('.classification .scroll')].filter(node=>node.getBoundingClientRect().width>0).map(node=>({width:node.clientWidth,content_width:node.scrollWidth}))}));
  if(observed.document_width>observed.viewport+2)throw new Error(name+' exceeds the document width: '+JSON.stringify(observed));
  await checkpoint(name,observed);
}
async function draft(){
  return page.evaluate(async key=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('staff-market-classification-drafts',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
    finally{db.close();}
  },design.workspace_id);
}
async function waitDraft(expected){
  await page.waitForFunction(async ({key,rowId,proposed,name,rawHash})=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('staff-market-classification-drafts',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{
      const value=await new Promise((resolve,reject)=>{const request=db.transaction('drafts','readonly').objectStore('drafts').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const saved=value?.drafts?.roster,row=saved?.document?.rows?.find(row=>row.id===rowId);
      if(!row||row.proposed_annual_base_rate!==proposed||saved.document.name!==name||!saved.edited_rows||!saved.original)return false;
      const bytes=new TextEncoder().encode(saved.original.content),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
      return hash===rawHash;
    }finally{db.close();}
  },{key:design.workspace_id,rowId:design.planning_row.id,proposed:design.planning_row.proposed,name:proposedName,rawHash:expected.sha256});
}

function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
async function sourceRows(kind){
  const original=originals.sources[kind],rows=original.content[kind==='method'?'grades':'rows'];
  await openDocument(kind,original.id);
  const observed=[];
  while(true){
    const panel=inspection(kind);
    const table=panel.locator('table').filter({has:page.getByRole('columnheader',{name:'Full source row',exact:true})});
    const pageRows=table.locator('tbody tr');
    if(await pageRows.count()){
      await pageRows.first().getByText('Inspect complete row',{exact:true}).click();
      await pageRows.first().locator('pre').waitFor({state:'visible'});
    }
    const full=await pageRows.locator('pre').allTextContents();
    observed.push(...full.map(text=>JSON.parse(text)));
    const next=panel.getByRole('button',{name:'Next original rows',exact:true});
    if(await next.isDisabled())break;
    await next.click();await ready();
  }
  if(canonical(observed)!==canonical(rows))throw new Error('The complete visible source rows differ: '+kind);
  const ref=await retained('source-rows/'+kind+'-'+sha(json(observed))+'.json',json(observed));
  await checkpoint('complete-source-rows-'+kind,{id:original.id,rows:observed.length,source:ref});
}
async function acceptedDownloads(){
  for(const [label,reference]of Object.entries(design.scenarios)){
    const doc=await openDocument('scenario',reference.id);
    if(doc.sha256!==originals.scenarios[label].sha256||doc.reviews?.at(-1)?.outcome!=='accepted')
      throw new Error('The original accepted scenario changed: '+label);
    for(const [extension,title]of [['csv','Accepted placement and cost CSV'],['json','Accepted complete source package']])
      await browserDownload(label+'-'+extension,inspection('scenario').getByRole('link',{name:title,exact:true}),originals.exports[label+'-accepted.'+extension]);
    await checkpoint('accepted-downloads-'+label,{id:doc.id,sha256:doc.sha256});
  }
}
async function checkedDerivedRoster(doc){
  const original=originals.sources.roster,source=design.planning_row;
  if(doc.kind!=='roster'||doc.parents.roles.id!==design.sources.roles.id||doc.supersedes?.id!==original.id)
    throw new Error('The planning workforce lost its exact parent/superseded edition.');
  if(doc.original_input?.raw_sha256!==originals.editable_roster.sha256||doc.original_input?.edited_rows!==true)
    throw new Error('The derived edition did not retain the exact imported file and explicit row edits.');
  if(!Buffer.from(doc.original_input.content,'utf8').equals(await readRef(originals.editable_roster)))
    throw new Error('The retained original imported bytes differ.');
  if(doc.content.name!==proposedName||doc.content.rate_basis!==original.content.rate_basis||
      doc.content.total_fte!==original.content.total_fte||doc.content.rows.length!==original.content.rows.length)
    throw new Error('The derived planning edition changed its original workforce basis.');
  for(let index=0;index<original.content.rows.length;index++){
    const before=original.content.rows[index],after=doc.content.rows[index];
    const expected=before.id===source.id?{...before,proposed_annual_base_rate:source.proposed,placement_rationale:rationale}:before;
    if(canonical(after)!==canonical(expected))throw new Error('The planning edit changed another source row or field: '+before.id);
  }
  if(doc.content.errors?.length)throw new Error('The retained planning source contains errors.');
  result.derived_roster={id:doc.id,sha256:doc.sha256,original:original.id,raw_source:originals.editable_roster,
    current_review:doc.reviews?.at(-1)||null};
  await checkpoint('derived-workforce-retained',{id:doc.id,sha256:doc.sha256,rows:doc.content.rows.length});
  return doc;
}
async function prepareDerivedRoster(){
  if(result.mutations['save-derived-workforce']?.success){
    const receipt=await mutationValue('save-derived-workforce');
    const doc=await currentDoc('roster',receipt.id);
    await checkedDerivedRoster(doc);await openDocument('roster',doc.id);return doc;
  }
  await openDocument('roster',design.sources.roster.id);
  await browserDownload('original-editable-workforce',inspection('roster').getByRole('link',{name:'Editable source JSON',exact:true}),originals.editable_roster);
  await inspection('roster').getByRole('button',{name:'Use as a new draft',exact:true}).click();await ready();
  await classification().getByRole('textbox',{name:'Person recording editions',exact:true}).fill(actor);
  await classification().getByLabel('Import Workforce editions',{exact:true}).setInputFiles(originals.editable_roster.path);
  await ready();
  await classification().getByRole('status').filter({hasText:/is loaded with its original bytes/}).waitFor();
  await classification().getByRole('textbox',{name:'Edition name',exact:true}).fill(proposedName);
  await classification().getByRole('textbox',{name:'Source and decision basis',exact:true}).fill(originals.sources.roster.content.basis+'\n\n'+rationale);
  const source=design.planning_row;
  const input=classification().locator('section.panel').filter({has:page.getByRole('heading',{name:'Workforce input',exact:true})});
  const row=input.locator('table tbody tr').filter({hasText:source.id});
  if(await row.count()!==1)throw new Error('The original workforce editor did not expose the selected source row.');
  await row.getByRole('button',{name:'Edit row',exact:true}).click();await ready();
  const editor=classification().locator('.cl-row-editor');
  if(await editor.getByRole('textbox',{name:'Current annual full-time base rate',exact:true}).inputValue()!==source.annual_base_rate||
     await editor.getByRole('textbox',{name:'FTE',exact:true}).inputValue()!==source.fte)
    throw new Error('The editable original current rate/FTE differs.');
  await editor.getByRole('textbox',{name:'Explicit proposed full-time base rate',exact:true}).fill(source.proposed);
  await editor.getByRole('textbox',{name:'Explicit placement basis',exact:true}).fill(rationale);
  await waitDraft(originals.editable_roster);
  const before=await draft();
  const beforeRef=await retained('drafts/before-reload-'+sha(json(before))+'.json',json(before));
  await page.reload({waitUntil:'networkidle'});await enterClassification();await waitDraft(originals.editable_roster);
  const after=await draft();
  if(canonical(after.drafts.roster)!==canonical(before.drafts.roster)||after.actor!==actor)
    throw new Error('The original editor draft changed across reload.');
  await checkpoint('original-import-decimal-edit-reload',{draft:beforeRef,raw_source:originals.editable_roster,
    workforce_row:source.id,original_current_rate:source.annual_base_rate,fte:source.fte,
    proposed_rate:source.proposed,source_grade:source.grade_id});
  await page.locator('#nav [data-view="reports"]').click();
  await page.locator('.classification').waitFor({state:'hidden'});
  await enterClassification();
  if(await classification().getByRole('textbox',{name:'Person recording editions',exact:true}).inputValue()!==actor)
    throw new Error('The cached controller lost the recording actor.');
  const returnedEditor=classification().locator('.cl-row-editor');
  if(await returnedEditor.getByRole('textbox',{name:'Explicit proposed full-time base rate',exact:true}).inputValue()!==source.proposed||
     await returnedEditor.getByRole('textbox',{name:'Explicit proposed full-time base rate',exact:true}).isDisabled())
    throw new Error('The cached controller lost or locked its editable original row.');
  await checkpoint('cached-workspace-navigation-retains-draft',{workspace_id:design.workspace_id});
  await returnedEditor.getByRole('button',{name:'Finish editing row',exact:true}).click();await ready();
  const saved=await mutation('save-derived-workforce','/api/extensions/classification/save_roster',()=>
    classification().getByRole('button',{name:'Retain workforce editions edition',exact:true}).click());
  const doc=await currentDoc('roster',saved.id);
  await checkedDerivedRoster(doc);return doc;
}
function previewStep(name){
  return result.mutations[name]?.success?name+'-render-attempt-'+result.attempts.length:name;
}
async function prepareDerivedScenario(roster){
  if(result.mutations['save-derived-scenario']?.success){
    const receipt=await mutationValue('save-derived-scenario'),doc=await currentDoc('scenario',receipt.id);
    await checkedDerivedScenario(doc,roster);await openDocument('scenario',doc.id);return doc;
  }
  await openDocument('scenario',design.scenarios.immediate.id);
  await inspection('scenario').getByRole('button',{name:'Use as a new draft',exact:true}).click();await ready();
  await classification().getByRole('combobox',{name:'Proposed pay structure',exact:true}).selectOption(design.sources.method.id);await ready();
  await classification().getByRole('combobox',{name:'Role edition',exact:true}).selectOption(design.sources.roles.id);await ready();
  await classification().getByRole('combobox',{name:'Workforce edition',exact:true}).selectOption(roster.id);
  await classification().getByRole('combobox',{name:'Placement rule',exact:true}).selectOption('manual');await ready();
  await classification().getByRole('textbox',{name:'Scenario title',exact:true}).fill(initialTitle);
  await classification().getByRole('textbox',{name:'Purpose and placement decision basis',exact:true}).fill(rationale);
  const first=await mutation(previewStep('preview-source-alternative'),'/api/extensions/classification/preview_scenario',()=>
    classification().getByRole('button',{name:'Calculate complete placement and cost',exact:true}).click());
  const source=design.planning_row;
  if(first.rows.length!==design.sources.roster.rows||first.rows.find(row=>row.id===source.id)?.proposed_annual_base_rate!==source.proposed)
    throw new Error('The first planning preview lost the published row/maximum.');
  const retain=classification().getByRole('button',{name:'Retain this exact scenario',exact:true});
  if(await retain.isDisabled())throw new Error('The calculated current preview cannot be retained.');
  await classification().getByRole('textbox',{name:'Scenario title',exact:true}).fill(finalTitle);
  await page.waitForFunction(()=>{
    const root=document.querySelector('.classification'),button=root?.querySelector('[data-retain-scenario]'),status=root?.querySelector('[data-scenario-preview-status]');
    return button?.disabled&&status?.textContent.includes('inputs changed');
  });
  await checkpoint('changed-input-invalidated-original-preview',{first_preview_sha256:first.preview_sha256,changed_field:'title'});
  const second=await mutation(previewStep('preview-current-alternative'),'/api/extensions/classification/preview_scenario',()=>
    classification().getByRole('button',{name:'Calculate complete placement and cost',exact:true}).click());
  if(second.preview_sha256===first.preview_sha256||second.config.title!==finalTitle||canonical(second.totals)!==canonical(first.totals))
    throw new Error('The current preview did not bind the changed title while preserving its original arithmetic.');
  if(second.errors?.length)throw new Error('The planning scenario contains calculation errors: '+second.errors.join('; '));
  await checkpoint('current-preview-recalculated',{preview_sha256:second.preview_sha256,totals:second.totals});
  const saved=await mutation('save-derived-scenario','/api/extensions/classification/save_scenario',()=>
    classification().getByRole('button',{name:'Retain this exact scenario',exact:true}).click());
  const doc=await currentDoc('scenario',saved.id);
  if(doc.content.preview_sha256!==second.preview_sha256)throw new Error('The retained scenario differs from its current preview.');
  await checkedDerivedScenario(doc,roster);return doc;
}
async function checkedDerivedScenario(doc,roster){
  if(doc.kind!=='scenario'||doc.parents.method.id!==design.sources.method.id||doc.parents.roles.id!==design.sources.roles.id||
     doc.parents.roster.id!==roster.id||doc.parents.roster.sha256!==roster.sha256||doc.content.config.title!==finalTitle)
    throw new Error('The retained planning scenario lost an original input or decision.');
  if(doc.content.rows.find(row=>row.id===design.planning_row.id)?.proposed_annual_base_rate!==design.planning_row.proposed)
    throw new Error('The saved planning scenario changed the published upper-bound proposal.');
  result.derived_scenario={id:doc.id,sha256:doc.sha256,parents:doc.parents,totals:doc.content.totals,
    current_review:doc.reviews?.at(-1)||null};
  await checkpoint('derived-scenario-retained',{id:doc.id,sha256:doc.sha256,rows:doc.content.rows.length});
}
async function startServerAndBrowser(){
  const requestedPort=result.server_port??0;
  server=child(python,['-B','cli.py','--workspace',workspace,'serve','--port',String(requestedPort)],{cwd:app,env:{...process.env,TMPDIR:scratch}});
  let serverError='';
  server.stderr.on('data',bytes=>{serverError=(serverError+bytes).slice(-12000);});
  const info=await within(new Promise((resolve,reject)=>{
    const reader=createInterface({input:server.stdout});
    reader.once('line',line=>{try{resolve(JSON.parse(line));}catch(error){reject(error);}});
    server.once('error',reject);server.once('close',code=>reject(new Error('Original server exited '+code+': '+serverError)));
  }),20000,'Original workspace startup');
  if(info.workspace_id!==design.workspace_id)throw new Error('The original server opened another workspace.');
  const url=new URL(info.url);
  if(result.server_url&&result.server_url!==url.origin)throw new Error('The persistent browser origin differs from its original workspace.');
  result.server_url=url.origin;result.server_port=Number(url.port);
  await checkpoint('original-workspace-opened',{workspace_id:info.workspace_id,url:result.server_url});
  await reconcileMutations();
  context=await chromium.launchPersistentContext(path.join(scratch,'profile'),{
    executablePath:executable,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
    downloadsPath:path.join(scratch,'downloads'),env:{...process.env,TMPDIR:scratch},
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-gpu','--renderer-process-limit=1']
  });
  await context.route('**/api/**',captureRoute);
  page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>attempt.page_errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))attempt.http_errors.push({url:response.url(),status:response.status()});});
  await page.goto(result.server_url,{waitUntil:'networkidle'});await enterClassification();
}
async function browserJourney(){
  await startServerAndBrowser();
  await classification().getByRole('textbox',{name:'Person recording editions',exact:true}).fill(actor);
  for(const kind of ['method','roles','roster'])if(!result.steps['complete-source-rows-'+kind])await sourceRows(kind);
  await acceptedDownloads();
  await layout('desktop-original-accepted-scenario');
  await page.screenshot({path:path.join(output,'apex-desktop.png'),fullPage:false});
  const roster=await prepareDerivedRoster();
  const scenario=await prepareDerivedScenario(roster);
  await openDocument('scenario',scenario.id);
  await page.setViewportSize({width:390,height:844});
  await layout('mobile-planning-review');
  // The original tables own horizontal scrolling; the document keeps its viewport width.
  const horizontal=await classification().locator('.scroll').evaluateAll(nodes=>{
    const node=nodes.find(node=>node.getBoundingClientRect().width>0&&node.scrollWidth>node.clientWidth+2);
    if(!node)return null;
    node.scrollLeft=node.scrollWidth;
    return {client_width:node.clientWidth,content_width:node.scrollWidth,scroll_left:node.scrollLeft};
  });
  if(!horizontal||horizontal.scroll_left<=0)throw new Error('The complete mobile tables did not expose horizontal access.');
  await checkpoint('mobile-complete-table-access',horizontal);
  await page.screenshot({path:path.join(output,'apex-mobile.png'),fullPage:false});
  await page.reload({waitUntil:'networkidle'});await enterClassification();
  await openDocument('scenario',scenario.id);
  await layout('mobile-saved-planning-review-after-reload');
  const after=await requestJson(result.server_url+'/api/state');
  if(attempt.page_errors.length||attempt.http_errors.length||attempt.route_errors.length)
    throw new Error('The original browser returned errors: '+JSON.stringify({page:attempt.page_errors,http:attempt.http_errors,route:attempt.route_errors}));
  await checkpoint('ui-complete',{revision:after.workspace.revision,derived_scenario:scenario.id,derived_roster:roster.id});
}

let failure=null;
try{
  await fs.mkdir(output,{recursive:true});await fs.mkdir(scratch,{recursive:true});await fs.mkdir(path.join(scratch,'downloads'),{recursive:true});
  if(previous){
    const bytes=await fs.readFile(progressPath);
    await retained('history/progress-'+sha(bytes)+'.json',bytes);
  }
  await checkpoint(null);
  attempt.source={};
  for(const file of ['core.py','server.py','web/app.js','classification/engine.py','classification/host.py','classification/browser.mjs']){
    const bytes=await fs.readFile(path.join(app,file));attempt.source[file]={bytes:bytes.length,sha256:sha(bytes)};
  }
  if(!result.steps['ui-complete']&&attempt.source['classification/browser.mjs'].sha256!==design.source_browser_sha256)
    throw new Error('The selected classification browser differs from the reviewed original source.');
  if(!result.steps['ui-complete']&&attempt.source['classification/host.py'].sha256!==design.source_host_sha256)
    throw new Error('The selected classification bridge differs from the reviewed original source.');
  const captured=await runNative('capture');originals=captured.original;
  result.initial_revision=result.initial_revision??captured.observed_revision;
  await checkpoint('original-accepted-inputs-reopened',{observed_revision:captured.observed_revision,
    accepted_zip:originals.accepted_zip,source_rows:{method:design.sources.method.rows,roles:design.sources.roles.rows,roster:design.sources.roster.rows}});
  if(!result.steps['ui-complete'])await browserJourney();
  await closeOwned();
  const finalNative=await runNative('backup');result.final_native=finalNative;
  await checkpoint('complete-native-backup-reopened',{backup:finalNative.backup,restored_path:finalNative.restored_path,
    accepted_exports:finalNative.original_exports.length,revision:finalNative.revision});
  if(interrupted)throw new Error('The original operator run was interrupted.');
}catch(error){failure=error;}
finally{
  try{await closeOwned();}catch(error){failure=failure||error;attempt.cleanup_error=error.message;}
}
attempt.completed_at=new Date().toISOString();
if(failure){
  result.status=interrupted?'interrupted':'failed';attempt.status=result.status;
  result.error={message:failure.message,stack:failure.stack};
  try{await checkpoint('operator-journey-stopped',{message:failure.message});}
  catch(error){process.stderr.write(JSON.stringify({stage:'retained-progress-write-failed',message:error.message})+'\n');}
  process.stderr.write(JSON.stringify({status:result.status,operation_id:design.operation_id,message:failure.message,progress:progressPath})+'\n');
  process.exitCode=1;
}else{
  result.status='complete';attempt.status='complete';result.completed_at=new Date().toISOString();
  result.steps['owned-browser-and-host-closed']={completed_at:new Date().toISOString()};
  const completed=json(result);
  await atomic(path.join(output,'BROWSER-RESULT.json'),completed);
  await atomic(progressPath,completed);
  process.stdout.write(JSON.stringify({status:'complete',operation_id:design.operation_id,workspace_id:design.workspace_id,
    accepted_scenario_exports:6,browser_downloads:Object.keys(result.downloads).length,source_rows:93,derived_roster:result.derived_roster.id,
    derived_scenario:result.derived_scenario.id,backup:result.final_native.backup,result:path.join(output,'BROWSER-RESULT.json')})+'\n');
}
