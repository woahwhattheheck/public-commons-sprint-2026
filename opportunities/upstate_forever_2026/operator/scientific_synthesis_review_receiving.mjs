/** Read retained evidence and compare full authored editions on the original owner's Page. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {stableJSON,validateWorking,WORK_SCHEMA} from './web/scientific_synthesis_core.mjs';
import {evidencePacket,tableWindow,EVIDENCE_PAGE_ROWS} from './web/scientific_synthesis_evidence.mjs';
import {createComparisonPackage,openComparisonPackage,comparisonText} from './web/scientific_synthesis_compare_core.mjs';
import {buildComparisonReport} from './web/scientific_synthesis_compare_report.mjs';
const SCHEMA='upstate.scientific-synthesis-review-receiving/v1';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b)=>stableJSON(a)===stableJSON(b);
const copy=v=>JSON.parse(JSON.stringify(v));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function present(p){try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function retain(p,bytes,{mutable=false}={}){
 await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});const temp=p+'.'+randomUUID()+'.pending',body=Buffer.from(bytes);
 try{const h=await fs.open(temp,'wx',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}
  if(mutable)await fs.rename(temp,p);else try{await fs.link(temp,p);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(p)).equals(body),'The complete retained review differs: '+path.basename(p));}
  const d=await fs.open(path.dirname(p),'r');try{await d.sync();}finally{await d.close();}
 }finally{await fs.rm(temp,{force:true});}
}
export async function receiveScientificSynthesisReview(page,{control,workspace,api,ownerCheck,outputDirectory,freshContext=false}){
 need(control?.schema===SCHEMA&&['original','restored'].includes(control.mode),'Use the complete same-operation review input.');
 need(typeof ownerCheck==='function'&&typeof api==='function','Use the existing owner and authenticated API.');
 need(Array.isArray(control.editions)&&control.editions.length===2&&Array.isArray(control.collections)&&control.collections.length===2,'Retain both full authored editions.');
 const output=path.resolve(outputDirectory),receipt=path.join(output,'synthesis-review-receiving.json');
 await fs.mkdir(output,{recursive:true,mode:0o700});
 const identity={schema:SCHEMA,operation_id:control.operation_id,project_id:control.project_id,selection_sha256:control.selection_sha256,mode:control.mode};
 let state=await present(receipt)?JSON.parse(await fs.readFile(receipt,'utf8')):{...identity,artifacts:{},phases:{},complete:false};
 for(const[k,v]of Object.entries(identity))need(state[k]===v,'Continue the exact original review selection.');
 const checkpoint=()=>retain(receipt,JSON.stringify(state,null,2)+'\n',{mutable:true});
 const panel=()=>page.locator('.scientific-synthesis');
 const action=name=>panel().locator('[data-synthesis-action="'+name+'"]');
 const endpoint=(route,params={})=>route+'?'+new URLSearchParams({workspace,...params});
 const read=(route,params)=>api(endpoint(route,params));
 async function keep(name,bytes){
  need(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name),'Keep each review artifact in its original directory.');
  const body=Buffer.from(bytes),pin={path:name,bytes:body.length,sha256:hash(body)};
  if(state.artifacts[name])need(same(state.artifacts[name],pin),'The retained artifact identity changed.');
  await retain(path.join(output,name),body);state.artifacts[name]=pin;await checkpoint();return body;
 }
 async function saved(name){
  const p=state.artifacts[name];if(!p)return null;
  const b=await fs.readFile(path.join(output,name));need(b.length===p.bytes&&hash(b)===p.sha256,'The original review artifact changed: '+name);return b;
 }
 async function download(name,click,check){
  let body=await saved(name);
  if(!body){await ownerCheck();const awaiting=page.waitForEvent('download');awaiting.catch(()=>{});await click();const d=await awaiting;
   need(await d.failure()===null,'The full outgoing review download failed.');const temp=path.join(output,'.download-'+randomUUID());
   try{await d.saveAs(temp);body=await fs.readFile(temp);await check(body);await keep(name,body);}finally{await fs.rm(temp,{force:true});}
  }await check(body);return body;
 }
 async function screen(name,target){
  if(await saved(name))return;
  await ownerCheck();await keep(name,target?await target.screenshot():await page.screenshot({fullPage:true}));
 }
 async function working(){
  const value=await page.evaluate(async ws=>{
   const tab=sessionStorage.getItem('scientific-synthesis-tab');if(!tab)return null;
   const db=await new Promise((res,rej)=>{const r=indexedDB.open('tjlabs-scientific-synthesis-v1',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
   try{return await new Promise((res,rej)=>{const tx=db.transaction('working','readonly'),r=tx.objectStore('working').get(ws+':'+tab);let v;r.onsuccess=()=>v=r.result;tx.oncomplete=()=>res(v||null);tx.onerror=()=>rej(tx.error);});}finally{db.close();}
  },workspace);
  return value?validateWorking(value.schema==='upstate.scientific-synthesis-browser/v1'?value.working:value):null;
 }
 async function waitWorking(expected){
  const limit=Date.now()+60000;let value;
  while(!(value=await working())||!same(value.document,expected.document)||!same(value.pending,expected.pending)){
   need(Date.now()<limit,'The complete original working copy did not reopen.');await page.waitForTimeout(100);
  }return value;
 }
 async function ready(){await page.waitForFunction(ids=>{const root=document.querySelector('.scientific-synthesis'),refresh=root?.querySelector('[data-synthesis-action="refresh"]'),compare=root?.querySelector('[data-synthesis-compare-action="compare"]'),select=root?.querySelector('[data-synthesis-compare-side="before"]');return refresh&&!refresh.disabled&&compare&&!compare.disabled&&select&&ids.every(id=>[...select.options].some(row=>row.value===id));},control.collections);}
 async function sources(){
  await ownerCheck();for(const[id,close]of[['form-dialog','form-close'],['detail-dialog','detail-close']]){
   const dialog=page.locator('#'+id);if(await dialog.count()&&await dialog.evaluate(e=>e.open))await dialog.locator('[data-action="'+close+'"]').click();
  }
  const selected=page.locator('#workspace-select');if(await selected.inputValue()!==workspace)await selected.selectOption(workspace);
  await page.locator('[data-view="sources"]').click();await panel().waitFor();await ready();
 }
 async function openWorking(value){
  await ownerCheck();validateWorking(value);const current=await working();
  if(current?.pending){need(same(current.pending,value.pending)&&same(current.document,value.document)&&same(current.catalog,value.catalog)&&current.base_collection_id===value.base_collection_id,'Keep the existing pending authored request before selecting another review input.');return current;}
  await panel().locator('[data-synthesis-open]').setInputFiles({name:'synthesis-review-working.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await ready();return waitWorking(value);
 }
 async function edition(id,index){
  await ownerCheck();const result=await read('/api/source-reports/synthesis-edition',{collection_id:id}),original=control.editions[index];
  need(result.project_id===control.project_id&&result.collection_id===id&&same(result.record,original.record)&&same(result.history,original.history)&&same(result.catalog,original.catalog),'The original full authored edition changed.');
  return result;
 }
 async function reveal(ref){
  const detail=panel().locator('[data-synthesis-evidence='+JSON.stringify(ref.id)+']').first();
  await ownerCheck();await detail.evaluate(node=>{for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;node.open=true;});
  await detail.locator('[data-evidence-action="download"]').waitFor();return detail;
 }
 async function readableEvidence(value,label){
  const before=await working(),catalog=value.catalog;
  need(before&&same(before.catalog,catalog),'Read the exact current working catalogue.');
  const refs=catalog.references,selected=new Set(value.record.document.sections.flatMap(s=>s.reference_ids));
  for(const ref of refs.filter(r=>selected.has(r.id))){
   const detail=await reveal(ref),expected=evidencePacket(catalog,ref.id);
   await download(label+'-evidence-'+ref.id+'.json',()=>detail.locator('[data-evidence-action="download"]').click(),body=>need(same(JSON.parse(body.toString('utf8')),expected),'The downloaded whole evidence reference/source differs.'));
   await screen(label+'-reference-'+ref.id+'.png',detail);
  }
  // Operate every real retained table, including the 217-row watershed source.
  const tables=refs.filter(r=>r.kind==='block'&&r.content?.kind==='table');
  for(const ref of tables){
   const detail=await reveal(ref),pages=Math.max(1,Math.ceil(ref.content.rows.length/EVIDENCE_PAGE_ROWS));
   for(let p=0;p<pages;p++){
    const expected=tableWindow(ref.content,{page:p}),positions=await detail.locator('tbody th[scope="row"]').allTextContents();
    need(same(positions,expected.rows.map(r=>String(r.index+1))),'Readable evidence lost original row positions.');
    const rendered=await detail.locator('tbody tr').allTextContents();
    for(let i=0;i<expected.rows.length;i++)for(const cell of expected.rows[i].row){
     if(cell===null||typeof cell!=='object')need(rendered[i].includes(cell===null?'null':String(cell)),'The retained table changed a literal value.');
    }
    if(p+1<pages){await ownerCheck();await detail.locator('[data-evidence-action="page"][data-evidence-page="'+(p+1)+'"]').click();}
   }
   const query=ref.content.rows.length?String(ref.content.rows.at(-1).find(v=>typeof v==='string')??''):'';
   if(query){await ownerCheck();await detail.locator('[data-evidence-query]').fill(query);const expected=tableWindow(ref.content,{query});need(same(await detail.locator('tbody th[scope="row"]').allTextContents(),expected.rows.map(r=>String(r.index+1))),'Evidence search lost exact original positions.');await detail.locator('[data-evidence-query]').fill('');}
   for(const width of[1440,390]){await ownerCheck();await page.setViewportSize({width,height:1000});await screen(label+'-table-'+ref.id+'-'+width+'.png',detail);}
   state.phases[label+'-table-'+ref.id]={rows:ref.content.rows.length,pages};await checkpoint();
  }
  need(same(await working(),before),'Reading/download/paging changed the complete authored draft or original pending request.');
  return before;
 }
 async function sourceReader(value,label){
  const before=await working(),ref=value.catalog.references.find(r=>r.kind==='source');
  need(ref,'Open the complete original source reference.');const detail=await reveal(ref);
  await ownerCheck();const response=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/source-reports/scientific-source'&&u.searchParams.get('source_collection_id')===ref.source_collection_id&&u.searchParams.get('source_id')===ref.source_id;});response.catch(()=>{});
  await detail.locator('[data-evidence-action="source"]').click();
  const reply=await response,opened=await reply.json();
  need(reply.ok()&&opened.source.source_collection_id===ref.source_collection_id&&opened.source.source_id===ref.source_id&&opened.source.body_sha256===ref.body_sha256,'The original reader opened another complete source.');
  await page.waitForFunction(id=>{const d=[...document.querySelectorAll('[data-synthesis-evidence]')].find(x=>x.dataset.synthesisEvidence===id);return d?.querySelector('[data-evidence-status]')?.textContent.includes('Original study opened below');},ref.id);
  const reader=page.locator('.scientific-source-reader');await reader.waitFor();
  need(same(await reader.locator('[data-source-reader-content] > section > h4').allTextContents(),opened.recipe.sections.map(s=>s[0])),'The complete source reader lost its original section order.');
  for(const width of[1440,390]){await ownerCheck();await page.setViewportSize({width,height:1000});await screen(label+'-original-source-'+width+'.png',reader);}
  need(same(await working(),before),'Opening the original complete study changed the author draft.');
 }
 const compare=()=>panel().locator('.synthesis-comparison');
 const compareAction=name=>compare().locator('[data-synthesis-compare-action="'+name+'"]');
 async function compareReady(){await page.waitForFunction(()=>{const n=document.querySelector('[data-synthesis-compare-action="compare"]');return n&&!n.disabled;});}
 async function comparisonZip(side,expected){
  const name=side+'-source.zip',old=await saved(name);
  if(old){need(state.phases[side+'-source']&&old.length===state.phases[side+'-source'].download.bytes&&hash(old)===state.phases[side+'-source'].download.sha256,'The retained complete source ZIP changed.');return;}
  await ownerCheck();
  const response=page.waitForResponse(r=>{if(new URL(r.url()).pathname!=='/api/source-reports/archive')return false;try{return r.request().postDataJSON()?.collection_id===expected.collection_id;}catch{return false;}});
  response.catch(()=>{});const downloaded=page.waitForEvent('download');downloaded.catch(()=>{});
  await compareAction(side+'-zip').click();
  const reply=await response,body=await reply.json();
  need(reply.ok()&&body.workspace_key===workspace&&body.collection_id===expected.collection_id&&body.source_ids?.includes(expected.source_id),'The original source ZIP names another selected edition.');
  state.phases[side+'-source']=copy(body);await checkpoint();
  const d=await downloaded;need(await d.failure()===null,'The literal original source ZIP download failed.');
  const temp=path.join(output,'.source-'+randomUUID());
  try{await d.saveAs(temp);const bytes=await fs.readFile(temp);need(bytes.length===body.download.bytes&&hash(bytes)===body.download.sha256,'The downloaded native source ZIP differs from its original ticket.');await keep(name,bytes);}finally{await fs.rm(temp,{force:true});}
 }
 async function comparisonCourse(editions){
  const beforeWorking=await working(),expected=await createComparisonPackage({before:editions[0],after:editions[1]});
  await ownerCheck();await compare().locator('[data-synthesis-compare-side="before"]').selectOption(editions[0].collection_id);
  await compare().locator('[data-synthesis-compare-side="after"]').selectOption(editions[1].collection_id);
  await compareAction('compare').click();await compareReady();await compare().locator('[data-synthesis-comparison-result]').waitFor();
  const check=async bytes=>{const value=JSON.parse(bytes.toString('utf8')),opened=await openComparisonPackage(value);need(same(opened.package,expected),'The literal comparison differs from its two complete native editions.');};
  await download('comparison.json',()=>compareAction('json').click(),check);
  const expectedHTML=await buildComparisonReport(expected);
  await download('comparison.html',()=>compareAction('html').click(),bytes=>need(bytes.toString('utf8')===expectedHTML,'The actual complete HTML differs from its validated source report.'));
  for(const side of['before','after'])await comparisonZip(side,editions[side==='before'?0:1]);
  for(const width of[1440,390]){await ownerCheck();await page.setViewportSize({width,height:1000});await screen('comparison-installed-'+width+'.png',compare());}
  for(const file of['comparison.json','comparison.html']){
   await ownerCheck();await compare().locator('[data-synthesis-compare-open]').setInputFiles(path.join(output,file));await compareReady();
   await download('reopened-'+file+'.json',()=>compareAction('json').click(),check);
  }
  need(same(await working(),beforeWorking),'Comparing, receiving or downloading complete editions changed the authored draft/pending request.');
  // Open the literal outgoing file on this same owned Page, then use every
  // standalone download and both complete original editions.
  const originalURL=page.url();
  await ownerCheck();await page.goto(pathToFileURL(path.join(output,'comparison.html')).href,{waitUntil:'domcontentloaded'});
  await page.locator('#download-comparison').waitFor();
  const embedded=await page.locator('#scientific-synthesis-comparison-data').textContent();need(same((await openComparisonPackage(JSON.parse(embedded))).package,expected),'The opened actual HTML embeds another complete source.');
  for(const width of[1440,390]){
   await ownerCheck();await page.setViewportSize({width,height:1000});
   const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));need(dimensions.scroll<=dimensions.width+1,'The final comparison overflows the recipient viewport.');
   await screen('comparison-offline-'+width+'.png');
   const sections=page.locator('.section-change');
   for(let i=0;i<await sections.count();i++){await ownerCheck();await sections.nth(i).scrollIntoViewIfNeeded();await screen('comparison-offline-section-'+i+'-'+width+'.png',sections.nth(i));}
  }
  await ownerCheck();await page.locator('#show-unchanged').uncheck();
  need(await page.locator('body').evaluate(e=>e.classList.contains('hide-unchanged')),'Unchanged section control did not apply.');
  await page.locator('#show-unchanged').check();
  await download('offline-comparison.json',()=>page.locator('#download-comparison').click(),check);
  for(const [side,edition]of[['before',editions[0]],['after',editions[1]]])
   await download('offline-'+side+'.json',()=>page.locator('#download-'+side).click(),body=>need(same(JSON.parse(body.toString('utf8')),edition),'Standalone edition download lost full native source or history.'));
  await ownerCheck();await page.goto(originalURL,{waitUntil:'domcontentloaded'});await sources();
  need(same(await working(),beforeWorking),'Reopening the installed reader changed the retained author draft.');
  state.comparison={source_sha256:expected.source_sha256,source_bytes:expected.source_bytes,before:editions[0].collection_id,after:editions[1].collection_id};await checkpoint();
 }
 try{
  await checkpoint();for(const name of Object.keys(state.artifacts))await saved(name);
  const editions=[];for(let i=0;i<control.collections.length;i++)editions.push(await edition(control.collections[i],i));
  if(state.complete)return{receipt,complete:true,reused:true};
  await sources();
  // Use one dedicated draft key in the existing owned Page, preserving any
  // original author copy and its actual pending request without dispatch.
  const currentTab=await page.evaluate(()=>sessionStorage.getItem('scientific-synthesis-tab'));
  const currentWorking=await working();
  if(!state.review_tab)state.review_tab=randomUUID();
  if(!Object.hasOwn(state,'original_browser')){
   if(currentWorking)await keep('original-browser-working.json',Buffer.from(JSON.stringify(currentWorking,null,2)+'\n'));
   state.original_browser={tab:currentTab,has_working:!!currentWorking,working:state.artifacts['original-browser-working.json']||null};
   await checkpoint();
  }
  const custody=state.original_browser;
  need(custody&&Object.hasOwn(custody,'tab')&&typeof custody.has_working==='boolean','Retain the complete original browser custody before switching drafts.');
  const owned=new Set([state.review_tab,state.review_tab+'-edition-1',state.review_tab+'-edition-2',state.review_tab+'-pending']);
  need(currentTab===custody.tab||owned.has(currentTab)||(freshContext&&!custody.has_working&&!currentWorking),'Resume the original author tab or this operation\'s retained review tab.');
  const before=custody.has_working?validateWorking(JSON.parse((await saved('original-browser-working.json')).toString('utf8'))):null;
  if(custody.has_working)need(same(custody.working,state.artifacts['original-browser-working.json']),'The original complete author working copy identity changed.');
  if(currentTab===custody.tab)need(same(currentWorking,before),'The retained original author copy changed before review.');
  await page.evaluate(key=>sessionStorage.setItem('scientific-synthesis-tab',key),state.review_tab);
  await page.reload({waitUntil:'domcontentloaded'});await sources();
  try{
   for(let i=0;i<editions.length;i++){
    const value=editions[i],input={schema:WORK_SCHEMA,project_id:control.project_id,document:copy(value.record.document),base_collection_id:value.collection_id,catalog:copy(value.catalog),pending:null,import_history:[]};
    await page.evaluate(key=>sessionStorage.setItem('scientific-synthesis-tab',key),state.review_tab+'-edition-'+(i+1));await page.reload({waitUntil:'domcontentloaded'});await sources();
    await openWorking(input);await readableEvidence(value,'edition-'+(i+1));await sourceReader(value,'edition-'+(i+1));
   }
   state.evidence_complete=true;await checkpoint();
   // Preserve a real retained original request as the portable pending view.
   // Reading it sends no action to the queue, including in the restored Workspace.
   const phase=control.original_phases.first,request=phase.request;
   need(request.action==='source-reports.synthesis-save'&&request.payload.operation_id===editions[0].record.operation_id&&same(request.payload.document,editions[0].record.document),'The retained original pending request differs from its native edition.');
   const pending={schema:WORK_SCHEMA,project_id:control.project_id,document:copy(request.payload.document),base_collection_id:request.payload.base_collection_id,catalog:copy(editions[0].catalog),
    pending:{operation_id:request.operation_id,action:request.action,task_id:phase.task_id,payload:copy(request.payload)},import_history:[]};
   await page.evaluate(key=>sessionStorage.setItem('scientific-synthesis-tab',key),state.review_tab+'-pending');await page.reload({waitUntil:'domcontentloaded'});await sources();
   await openWorking(pending);const retainedPending=await working();
   await readableEvidence(editions[0],'pending-original');await sourceReader(editions[0],'pending-original');
   await download('pending-original-working.json',()=>action('download').click(),body=>{const prior=validateWorking(JSON.parse(body.toString('utf8')));need(same(prior.document,retainedPending.document)&&same(prior.pending,retainedPending.pending)&&same(prior.catalog,retainedPending.catalog)&&prior.base_collection_id===retainedPending.base_collection_id,'The full retained pending draft download changed its original request/source.');});
   await comparisonCourse(editions);
   need(same(await working(),retainedPending),'The complete pending original request changed during read-only comparison.');
   state.pending_preserved={operation_id:request.operation_id,task_id:phase.task_id};await checkpoint();
  }finally{
   await page.evaluate(key=>{if(key===null)sessionStorage.removeItem('scientific-synthesis-tab');else sessionStorage.setItem('scientific-synthesis-tab',key);},custody.tab);
   await page.reload({waitUntil:'domcontentloaded'});await sources();
   need(same(await working(),before),'The existing author working copy changed after review.');
  }
  for(let i=0;i<control.collections.length;i++)await edition(control.collections[i],i);
  state.complete=true;state.completed_at=new Date().toISOString();delete state.error;await checkpoint();
  return{receipt,complete:true,reused:false,artifacts:Object.keys(state.artifacts).length};
 }catch(error){state.error={name:error.name,message:error.message};await checkpoint();throw error;}
}
