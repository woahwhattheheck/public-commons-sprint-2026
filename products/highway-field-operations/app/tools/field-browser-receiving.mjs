/** Original Highway field-exchange receiving journey; no capture or GIS operation. */
import {readFile,mkdir,open,rename,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createOwner} from './field-browser-owner.mjs';
const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
const need=(v,m)=>{if(!v)throw Error(m);};
const canonical=v=>v===null?'null':typeof v==='string'||typeof v==='boolean'||typeof v==='number'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>canonical(a)===canonical(b);
need(config.schema==='geocove.field-following-browser.v1','Use the complete original following-course input.');
const out=resolve(config.directory),root=resolve(config.sourceRoot),operation=config.operationId;
await mkdir(out,{recursive:true,mode:0o700});
async function maybe(p){try{return await readFile(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomic(p,b){await mkdir(dirname(p),{recursive:true,mode:0o700});const tmp=p+'.new-'+randomUUID(),f=await open(tmp,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}await rename(tmp,p);const d=await open(dirname(p),'r');try{await d.sync();}finally{await d.close();}}
async function fixed(p,b){b=Buffer.from(b);const old=await maybe(p);if(old){need(old.equals(b),'Original complete bytes differ: '+p);return;}await atomic(p,b);}
const stable=Object.fromEntries(Object.entries(config).filter(([k])=>!['url','token','origin'].includes(k)));
await fixed(resolve(out,'input.json'),canonical(stable)+'\n');
const selection=JSON.parse(await readFile(resolve(root,'source-selection.json'),'utf8'));
need(selection.sha256===config.sourceSha256,'Following source selection differs.');
for(const f of selection.files){const b=await readFile(resolve(root,f.path));need(b.length===f.bytes&&sha(b)===f.sha256,'Selected application source differs: '+f.path);}
const journal=resolve(out,'result.json'),old=await maybe(journal);
const report=old?JSON.parse(old):{schema:'geocove.field-following-browser-result.v1',operationId:operation,inputSha256:sha(canonical(stable)),status:'RUNNING',steps:{},launches:[],artifacts:[],createdAt:new Date().toISOString()};
need(report.inputSha256===sha(canonical(stable)),'Original following browser input changed.');
let tail=Promise.resolve();const retain=()=>{const p=tail.then(()=>atomic(journal,JSON.stringify(report,null,2)+'\n'));tail=p.catch(()=>{});return p;};
async function artifact(path){need(path&&!path.startsWith('/')&&!path.split('/').includes('..'),'Unsafe artifact path.');const b=await readFile(resolve(out,path)),d={path,bytes:b.length,sha256:sha(b)},prior=report.artifacts.find(x=>x.path===path);if(prior)need(same(prior,d),'Retained complete artifact changed.');else report.artifacts.push(d);await retain();return d;}
async function writeArtifact(path,b){await fixed(resolve(out,path),b);return artifact(path);}
if(report.status==='COMPLETE'){for(const f of report.artifacts)await artifact(f.path);need(report.browserClosed&&report.serverClosed,'Previous complete browser resources remain unresolved.');console.log(JSON.stringify(report));process.exit(0);}
await retain();
const owner=await createOwner({operation,out,root,report,retain,sourceSelection:selection,guard:Number(process.env.HIGHWAY_FIELD_GUARD_FD)});
const origin=new URL(config.url);need(origin.protocol==='http:'&&origin.hostname==='127.0.0.1','Use the original loopback staff application.');
const auth={Authorization:'Bearer '+config.token,'X-Workspace-Id':config.workspaceId,'X-Workspace-Directory':config.workspaceDirectory};
async function api(path,body,raw=false){owner.assertRunning();const response=await fetch(config.origin+path,{method:body===undefined?'GET':'POST',headers:{...auth,...(body===undefined?{}:raw?{'Content-Type':'application/octet-stream','X-Content-SHA256':sha(body)}:{'Content-Type':'application/json'})},body:body===undefined?undefined:raw?body:canonical(body)});
 const data=Buffer.from(await response.arrayBuffer());if(!response.ok)throw Error('Original HTTP '+response.status+': '+data.toString());return response.headers.get('content-type')?.includes('application/json')?JSON.parse(data):data;}
async function phase(name,input,fn){let row=report.steps[name];if(!row){row=report.steps[name]={state:'PENDING',input:typeof input==='function'?await input():input};await retain();}
 if(row.state==='COMPLETE')return row.result;owner.assertRunning();const result=await fn(row.input);row.result=result;row.state='COMPLETE';await retain();return result;}
async function command(name,kind,body){return phase(name,async()=>{const c=await api('/api/state');return {workspaceId:config.workspaceId,workspaceDirectory:config.workspaceDirectory,expectedRevision:c.revision,command:{requestId:randomUUID(),kind,actor:config.actor,at:new Date().toISOString(),body:typeof body==='function'?await body(c):body}};},input=>api('/api/command',input));}
async function current(){const c=await api('/api/state');need(c.state.id===config.workspaceId&&c.directory===config.workspaceDirectory,'Staff branch changed.');return c;}
async function shot(page,name){const rel='screenshots/'+name+'.png';if(!await maybe(resolve(out,rel))){await mkdir(dirname(resolve(out,rel)),{recursive:true});await page.screenshot({path:resolve(out,rel)+'.partial',fullPage:true});const b=await readFile(resolve(out,rel)+'.partial');need(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.subarray(-8,-4).toString()==='IEND','Screenshot is incomplete.');await fixed(resolve(out,rel),b);}return artifact(rel);}
async function click(p,label){await p.getByRole('button',{name:label,exact:true}).click();}
async function download(p,label){const event=p.waitForEvent('download');await click(p,label);const d=await event;need(!await d.failure(),'Browser download failed.');const path=await d.path();need(path,'Complete original download path is unavailable.');return readFile(path);}
async function offlineSnapshot(p){const b=await download(p,'Save return JSON');const v=JSON.parse(b);await p.evaluate(value=>globalThis.HighwayFieldCopy.validate(value),v);need(v.issueId===report.steps.issue.result.issue.id,'Offline issue differs.');return {bytes:b,value:v};}
async function checkpoint(p,name){const snap=await offlineSnapshot(p);await writeArtifact('field/'+name+'.json',snap.bytes);const html=await download(p,'Save complete HTML');const parsed=await p.evaluate(text=>globalThis.HighwayFieldCopy.parseReturn(text),html.toString());need(same(parsed,snap.value),'HTML and JSON exports differ.');await writeArtifact('field/'+name+'.html',html);return {json:'field/'+name+'.json',html:'field/'+name+'.html',value:snap.value};}
async function offlineOpen(context,file,continueSaved=true){const p=await context.newPage();p.on('dialog',d=>d.accept());await p.goto(pathToFileURL(resolve(out,file)).href);await p.getByRole('button',{name:'Save return JSON',exact:true}).waitFor();if(continueSaved&&await p.getByRole('button',{name:'Continue saved device version',exact:true}).count())await click(p,'Continue saved device version');return p;}

async function deviceRows(page,store){return page.evaluate(name=>new Promise((resolve,reject)=>{const req=indexedDB.open('highway-field-copies-v1');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,t=db.transaction(name,'readonly'),r=t.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>db.close();};}),store);}
async function openJSONcopy(context,path){
 const value=JSON.parse(await readFile(resolve(out,path),'utf8')),p=await offlineOpen(context,'field/issued.html');
 await go(p,'Receive & recover');await p.getByLabel('Open complete returned HTML or JSON',{exact:true}).setInputFiles(resolve(out,path));
 await p.getByRole('button',{name:'Open its original working-copy identity',exact:true}).waitFor();await click(p,'Open its original working-copy identity');
 await p.waitForFunction(id=>document.querySelector('#identity')?.textContent.includes(id),value.draft.fieldCopy.workingCopyId);
 if(await p.getByRole('button',{name:'Continue saved device version',exact:true}).count()){const rows=await deviceRows(p,'copies'),row=rows.find(x=>x.key===value.issued.sha256+':'+value.draft.fieldCopy.workingCopyId);need(row&&same(row.data,value),'Chosen original device copy has later work; retain and review it.');await click(p,'Continue saved device version');}
 const snap=await offlineSnapshot(p);need(same(snap.value,value),'Actual reopened copy differs from selected complete device bytes.');return p;
}

async function go(p,label){await click(p,label);await p.locator('#main h2').first().waitFor();}
async function setNote(p,value){await go(p,'Field form');await p.getByLabel('Field note',{exact:true}).fill(value);await offlineSnapshot(p);}
async function nameEdition(p,label,at){let snap=await offlineSnapshot(p);if(snap.value.editions.some(e=>e.label===label)){need(snap.value.editions.filter(e=>e.label===label).length===1,'Repeated course edition label needs review.');return snap.value.editions.find(e=>e.label===label);}
 await go(p,'Named editions');await p.getByLabel('Operator name',{exact:true}).fill(config.actor.name);await p.getByLabel('Operator reference',{exact:true}).fill(config.actor.id);await p.getByLabel('Edition label',{exact:true}).fill(label);await p.getByLabel('Observed edition time (with timezone)',{exact:true}).fill(at);await click(p,'Name complete current edition');snap=await offlineSnapshot(p);const e=snap.value.editions.find(x=>x.label===label);need(e&&same(e.actor,config.actor)&&e.at===at,'Named edition did not retain original attribution.');return e;}
async function staff(context){const p=await context.newPage();p.on('dialog',d=>d.accept());await p.goto(config.url);await p.locator('#content h2').first().waitFor();await p.locator('[data-section="sources"]').click();const panel=p.locator('section').filter({has:p.getByRole('heading',{name:'Your operating context',exact:true})}).first();await panel.getByLabel('Operator name',{exact:true}).fill(config.actor.name);await panel.getByLabel('Operator reference',{exact:true}).fill(config.actor.id);await panel.getByRole('button',{name:'Use this operator',exact:true}).click();return p;}
async function staffRefresh(p){await p.locator('#refresh').click();await p.waitForFunction(()=>document.querySelector('#status')?.className!=='error');await p.locator('[data-section="field-exchange"]').click();await p.getByRole('heading',{name:'Issue a named field copy',exact:true}).waitFor();}
async function uiMutation(page,name,url,activate){
 let row=report.steps[name];if(row?.state==='COMPLETE')return row.result;
 if(row?.input){const result=await api(url,row.input);row.result=result;row.state='COMPLETE';await retain();return result;}
 let resolveResult,rejectResult;const completed=new Promise((yes,no)=>{resolveResult=yes;rejectResult=no;});
 const handler=async route=>{try{const request=route.request();if(request.method()!=='POST'){await route.continue();return;}
 const input=request.postDataJSON();need(input.workspaceId===config.workspaceId&&input.workspaceDirectory===config.workspaceDirectory,'UI request targets another physical workspace.');
 if(!row){row=report.steps[name]={state:'PENDING',input};await retain();}else need(same(row.input,input),'Original UI mutation changed.');
 const result=await api(url,row.input);row.result=result;row.state='COMPLETE';await retain();await route.fulfill({status:200,contentType:'application/json',body:canonical(result)});resolveResult(result);
 }catch(e){await route.abort().catch(()=>{});rejectResult(e);}};
 await page.route('**'+url,handler);try{await activate();return await Promise.race([completed,new Promise((_,no)=>setTimeout(()=>no(Error('Original UI action did not return; retain its original request.')),60000))]);}finally{await page.unroute('**'+url,handler);}
}
async function receiveUI(p,name,path){if(report.steps[name]?.input)return uiMutation(p,name,'/api/command',async()=>{});
 await staffRefresh(p);await p.getByLabel('Complete returned field file',{exact:true}).setInputFiles(resolve(out,path));
 return uiMutation(p,name,'/api/command',()=>click(p,'Retain and receive selected file'));}
try{
 if(config.mode==='COLD_REOPEN'){
  let context=await owner.launch('cold-received-staff'),p=await staff(context);
  const before=await current();
  await phase('cold-prefix',{},async()=>{need(before.revision===config.expected.revision&&before.sha256===config.expected.sha256,'Cold physical workspace differs from the complete selected archive.');return {revision:before.revision,sha256:before.sha256};});
  await staffRefresh(p);
  await p.getByRole('button',{name:'Open original receiving comparison',exact:true}).first().click();
  need(await p.getByRole('button',{name:'Save receiving decisions',exact:true}).count()===0,'Historical receiving comparison must be read-only.');
  await shot(p,'received-original-comparison');
  await phase('cold-field-downloads',{files:config.expected.files},async f=>{
   const rows=[];for(const item of f.files){const response=await fetch(config.origin+'/api/field-file?kind='+item.kind+'&id='+encodeURIComponent(item.id)+'&format='+item.format,{headers:auth});need(response.ok,'Cold field file is unavailable.');const raw=Buffer.from(await response.arrayBuffer());need(raw.length===item.bytes&&sha(raw)===item.sha256,'Cold actual field download changed.');const path='field/cold-'+item.kind+'-'+item.id+'-'+item.format+(raw.toString('utf8',0,1)==='{'?'.json':'.html');await writeArtifact(path,raw);rows.push({path,bytes:raw.length,sha256:sha(raw)});}return rows;});
  await phase('cold-continuing-edit',async()=>{const c=await current(),iv=await api('/api/inspection?id='+encodeURIComponent(config.inspectionId));need(iv.version.status==='draft','Continue the received draft through its actual original model.');return {workspaceId:config.workspaceId,workspaceDirectory:config.workspaceDirectory,expectedRevision:c.revision,command:{requestId:randomUUID(),kind:'inspection.save',actor:config.actor,at:new Date().toISOString(),body:{id:config.inspectionId,expectedVersion:iv.version.number,answers:iv.version.answers,geometry:iv.version.geometry,attachments:iv.version.attachments,note:iv.version.note+'\nReceiving engineer continued this explicitly labelled local draft on the independent physical workspace.'}}};},f=>api('/api/command',f));
  await staffRefresh(p);
  for(const [width,prefix] of [[1440,'cold-desktop'],[390,'cold-mobile']]){await p.setViewportSize({width,height:width===390?844:1000});for(const section of ['field','field-exchange','history','transfer']){await p.locator('[data-section="'+section+'"]').click();await p.locator('#content h2').first().waitFor();need(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Cold view overflows '+section);await shot(p,prefix+'-'+section);}}
  await phase('final-original',{},async()=>{const c=await current(),iv=await api('/api/inspection?id='+encodeURIComponent(config.inspectionId));await writeArtifact('field/continued-inspection.json',JSON.stringify(iv,null,2)+'\n');return {revision:c.revision,sha256:c.sha256,inspectionVersion:iv.version.number};});
  await owner.closeBrowser();
 }else{
 let context=await owner.launch('staff-issue'),p=await staff(context);
 await phase('baseline',{revision:config.baseline.revision,sha256:config.baseline.sha256},async f=>{const c=await current();need(c.revision===f.revision&&c.sha256===f.sha256,'Review the actual selected staff revision before starting this continuation.');return {revision:c.revision,sha256:c.sha256};});
 if(!report.steps.issue?.input){await staffRefresh(p);await p.getByLabel('Recipient name',{exact:true}).fill(config.actor.name);await p.getByLabel('Recipient reference',{exact:true}).fill(config.actor.id);await p.getByLabel('Field instructions',{exact:true}).fill(config.meaning);
 const label=p.locator('label').filter({hasText:config.inspectionId}); // Use actual displayed object identity below when label omits long inspection ID.
 const checkboxes=p.locator('input[type="checkbox"]');const original=await api('/api/inspection?id='+encodeURIComponent(config.inspectionId));await p.getByLabel('Find inspections',{exact:true}).fill(String(original.source.binding.objectId));need(await checkboxes.count()===1,'The original inspection search must select one actual record.');await checkboxes.check();
 }
 await uiMutation(p,'issue','/api/field-issue',()=>click(p,'Prepare field JSON and editable HTML'));
 const issuedId=report.steps.issue.result.issue.id;
 // The JSON route returns parsed JSON; exact byte download uses a direct response.
 async function exactField(kind,id,format){const response=await fetch(config.origin+'/api/field-file?kind='+kind+'&id='+encodeURIComponent(id)+'&format='+format,{headers:auth});need(response.ok,'Original field download failed.');return Buffer.from(await response.arrayBuffer());}
 const issueBytes=await exactField('issues',issuedId,'json'),issue=JSON.parse(issueBytes),htmlBytes=await exactField('issues',issuedId,'html');
 need(sha(issueBytes)===report.steps.issue.result.issue.document.sha256&&sha(htmlBytes)===report.steps.issue.result.issue.html.sha256,'Issued exact byte identity differs.');
 await writeArtifact('field/issued.json',issueBytes);await writeArtifact('field/issued.html',htmlBytes);await shot(p,'staff-issued');await owner.closeBrowser();

 const unfinished=await phase('device-a-unfinished',()=>({note:config.meaning+' Unfinished draft retained before colleague handoff.',createdAt:new Date().toISOString()}),async f=>{
  context=await owner.launch('device-a');p=await offlineOpen(context,'field/issued.html');
  await setNote(p,f.note);await go(p,'Named editions');await p.getByLabel('Operator name',{exact:true}).fill('');await p.getByLabel('Unfinished notes / arbitrary draft text',{exact:true}).fill('Unfinished colleague draft: retain the complete source and attachments; no named edition yet.');
  const cp=await checkpoint(p,'unfinished');need(cp.value.editions.length===0&&cp.value.selectedEditionId===null,'Unfinished handoff must not invent an edition.');await shot(p,'unfinished-draft');await owner.closeBrowser();return cp;});
 const edited=await phase('device-b-editions',()=>({firstAt:new Date().toISOString(),firstLabel:'Receiving course — complete field edition 1',secondLabel:'Receiving course — complete field edition 2',firstNote:config.meaning+' Field copy proposed note, first edition.',secondNote:config.meaning+' Field copy proposed note, second edition.'}),async f=>{
  context=await owner.launch('device-b');p=await offlineOpen(context,unfinished.html);
  let snap=await offlineSnapshot(p);need(snap.value.draft.fieldCopy.observations[config.inspectionId].note===report.steps['device-a-unfinished'].input.note||snap.value.editions.length>0,'Independent device did not retain unfinished draft.');
  const attachmentSha=sha(issueBytes);await writeArtifact('field/Commissioning_Issued_Source.json',issueBytes);
  if(!snap.value.editions.some(e=>e.label===f.firstLabel)){
   await setNote(p,f.firstNote);await go(p,'Field form');snap=await offlineSnapshot(p);
   const obs=snap.value.draft.fieldCopy.observations[config.inspectionId];
   if(!obs.attachments.some(a=>a.sha256===attachmentSha))await p.getByLabel('Add full original photos or documents',{exact:true}).setInputFiles(resolve(out,'field/Commissioning_Issued_Source.json'));
   await nameEdition(p,f.firstLabel,f.firstAt);
  }
  if(!report.steps['edition-two-time']){report.steps['edition-two-time']={state:'COMPLETE',result:{at:new Date().toISOString()}};await retain();}
  if(!(await offlineSnapshot(p)).value.editions.some(e=>e.label===f.secondLabel)){await setNote(p,f.secondNote);await nameEdition(p,f.secondLabel,report.steps['edition-two-time'].result.at);}
  const cp=await checkpoint(p,'named-editions');need(cp.value.editions.length===2&&cp.value.editions[1].parentId===cp.value.editions[0].id,'Complete original edition chain differs.');
  const a=cp.value.editions[1].items.find(x=>x.inspectionId===config.inspectionId).attachments.find(x=>x.sha256===attachmentSha);need(a,'Actual added source attachment is missing.');
  await go(p,'Field form');const downloaded=await download(p,'Download '+a.name);need(downloaded.equals(issueBytes),'Actual attachment download differs.');
  await writeArtifact('field/reopened-source-attachment.json',downloaded);
  for(const [label,name] of [['Assignments','assignments'],['Field form','form'],['Named editions','editions'],['Sources & files','sources'],['Receive & recover','receiving'],['Operating guide','guide']]){await go(p,label);await shot(p,'offline-desktop-'+name);}
  await p.setViewportSize({width:390,height:844});for(const [label,name] of [['Assignments','assignments'],['Field form','form'],['Named editions','editions'],['Sources & files','sources'],['Receive & recover','receiving'],['Operating guide','guide']]){await go(p,label);need(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Narrow field interface overflows: '+name);await shot(p,'offline-mobile-'+name);}
  await owner.closeBrowser();return cp;});

 const conflicted=await phase('same-copy-conflict',()=>({currentNote:config.meaning+' Later saved device work.',candidateNote:config.meaning+' Concurrent unsaved-tab candidate.',at:new Date().toISOString()}),async f=>{
  context=await owner.launch('device-b');p=await offlineOpen(context,edited.html);
  let intent=report.steps['conflict-cas-input'];
  if(!intent){intent=report.steps['conflict-cas-input']={state:'COMPLETE',result:{existingRecoveryIds:(await deviceRows(p,'recoveries')).map(x=>x.id),copyId:edited.value.draft.fieldCopy.workingCopyId}};await retain();}
  let row=report.steps['conflict-record']?.result,q=null;
  if(!row){
   let matches=(await deviceRows(p,'recoveries')).filter(r=>!intent.result.existingRecoveryIds.includes(r.id)&&r.reason==='COMPARE_AND_SWAP_CONFLICT'&&r.current?.data?.draft.fieldCopy.workingCopyId===intent.result.copyId&&r.current.data.draft.fieldCopy.observations[config.inspectionId].note===f.currentNote&&r.candidate?.data?.draft.fieldCopy.observations[config.inspectionId].note===f.candidateNote);
   need(matches.length<=1,'More than one original stale-tab effect needs reconciliation.');
   if(!matches.length){
    q=await offlineOpen(context,edited.html);await setNote(p,f.currentNote);await go(q,'Field form');await q.getByLabel('Field note',{exact:true}).fill(f.candidateNote);await q.getByRole('heading',{name:'Resolve this working-copy conflict',exact:true}).waitFor();await shot(q,'same-copy-conflict');
    matches=(await deviceRows(q,'recoveries')).filter(r=>!intent.result.existingRecoveryIds.includes(r.id)&&r.reason==='COMPARE_AND_SWAP_CONFLICT'&&r.current?.data?.draft.fieldCopy.workingCopyId===intent.result.copyId&&r.current.data.draft.fieldCopy.observations[config.inspectionId].note===f.currentNote&&r.candidate?.data?.draft.fieldCopy.observations[config.inspectionId].note===f.candidateNote);
   }
   need(matches.length===1,'The complete original CAS result was not retained.');row=matches[0];report.steps['conflict-record']={state:'COMPLETE',result:row};await retain();
  }
  // Reconcile the actual original recovery record before any fork. Read-only
  // IndexedDB discovery never writes replacement application state.
  const actual=(await deviceRows(p,'recoveries')).find(x=>x.id===row.id);need(actual&&same(actual,row),'Original conflict record changed.');
  await writeArtifact('field/conflict-candidate.json',JSON.stringify(row.candidate.data,null,2)+'\n');
  await writeArtifact('field/later-device-copy-input.json',JSON.stringify(row.current.data,null,2)+'\n');
  const savedPage=await openJSONcopy(context,'field/later-device-copy-input.json');
  const saved=await checkpoint(savedPage,'later-device-copy');
  await go(savedPage,'Receive & recover');
  for(const d of await savedPage.locator('details').filter({has:savedPage.locator('summary',{hasText:'Original CAS and copy identities'})}).all())await d.locator('summary').click();
  const recovery=savedPage.locator('section').filter({has:savedPage.locator('pre').filter({hasText:row.id})}).last();
  for(const [name,label,expected] of [['prior','Download prior saved device version',row.current.data],['candidate','Download complete candidate',row.candidate.data]]){
   const rel='field/recovery-'+name+'.json';
   if(!await maybe(resolve(out,rel))){const event=savedPage.waitForEvent('download');await recovery.getByRole('button',{name:label,exact:true}).click();const d=await event,raw=await readFile(await d.path());need(same(JSON.parse(raw),expected),'Original recovery control returned another complete version.');await writeArtifact(rel,raw);}
   else{need(same(JSON.parse(await readFile(resolve(out,rel),'utf8')),expected),'Saved recovery download differs.');await artifact(rel);}
  }
  let fork=report.steps['conflict-fork-input'];
  if(!fork){fork=report.steps['conflict-fork-input']={state:'COMPLETE',result:{existingCopyIds:(await deviceRows(savedPage,'copies')).map(r=>r.data.draft.fieldCopy.workingCopyId),recoveryId:row.id,candidateSha256:sha(canonical(row.candidate.data))}};await retain();}
  const normalized=value=>{const v=JSON.parse(JSON.stringify(value));v.draft.fieldCopy.workingCopyId='';return v;};
  let candidates=(await deviceRows(savedPage,'copies')).filter(r=>!fork.result.existingCopyIds.includes(r.data.draft.fieldCopy.workingCopyId)&&same(normalized(r.data),normalized(row.candidate.data)));
  need(candidates.length<=1,'More than one original independent candidate copy needs reconciliation.');
  if(!candidates.length){
   await recovery.getByRole('button',{name:'Open complete candidate as independent copy',exact:true}).click();
   await savedPage.waitForFunction(id=>!document.querySelector('#identity')?.textContent.includes(id),row.current.data.draft.fieldCopy.workingCopyId);
   await offlineSnapshot(savedPage);
   candidates=(await deviceRows(savedPage,'copies')).filter(r=>!fork.result.existingCopyIds.includes(r.data.draft.fieldCopy.workingCopyId)&&same(normalized(r.data),normalized(row.candidate.data)));
  }
  need(candidates.length===1,'The original independent candidate copy was not retained.');const candidateCopy=candidates[0];
  if(report.steps['conflict-fork-result'])need(report.steps['conflict-fork-result'].result.copyId===candidateCopy.data.draft.fieldCopy.workingCopyId,'Original candidate fork identity differs.');
  else{report.steps['conflict-fork-result']={state:'COMPLETE',result:{copyId:candidateCopy.data.draft.fieldCopy.workingCopyId,sha256:sha(canonical(candidateCopy.data))}};await retain();}
  await writeArtifact('field/separate-conflict-copy-input.json',JSON.stringify(candidateCopy.data,null,2)+'\n');
  const separatePage=await openJSONcopy(context,'field/separate-conflict-copy-input.json'),separate=await checkpoint(separatePage,'separate-conflict-copy');
  need(saved.value.draft.fieldCopy.workingCopyId!==separate.value.draft.fieldCopy.workingCopyId,'Original and candidate did not remain independent.');
  await owner.closeBrowser();return {saved,separate};});

 await phase('independent-file-reopen',{path:conflicted.saved.html},async f=>{
  context=await owner.launch('device-c-cold');p=await offlineOpen(context,f.path);const snap=await offlineSnapshot(p);need(same(snap.value,conflicted.saved.value),'Independent complete HTML reopened with changed history or draft.');await go(p,'Sources & files');await shot(p,'cold-field-file');await owner.closeBrowser();return {sha256:sha(canonical(snap.value)),workingCopyId:snap.value.draft.fieldCopy.workingCopyId};});

 await phase('supervisor-concurrent-edit',async()=>{const c=await current(),iv=await api('/api/inspection?id='+encodeURIComponent(config.inspectionId));const correction=!['draft','returned'].includes(iv.version.status);const body={id:config.inspectionId,expectedVersion:iv.version.number,answers:iv.version.answers,geometry:iv.version.geometry,attachments:iv.version.attachments,note:config.meaning+' Concurrent supervisor note retained locally.'};if(correction)body.reason='Explicit local receiving course correction; not a new field observation or approval.';return {workspaceId:config.workspaceId,workspaceDirectory:config.workspaceDirectory,expectedRevision:c.revision,command:{requestId:randomUUID(),kind:correction?'inspection.correct':'inspection.save',actor:config.actor,at:new Date().toISOString(),body}};},f=>api('/api/command',f));
 context=await owner.launch('staff-return');p=await staff(context);
 const unfinishedReceive=await receiveUI(p,'receive-unfinished',unfinished.json);
 const finalReceive=await receiveUI(p,'receive-named',conflicted.saved.json);
 const returnId=finalReceive.outcome.return.id;
 await phase('supervisor-compare',async()=>({returnId}),async f=>{const v=await api('/api/field-compare?id='+encodeURIComponent(f.returnId));
  need(Number.isSafeInteger(v.workspaceRevision)&&v.items.some(x=>x.conflicts.includes('$note')),'Actual supervisor/field note conflict is missing.');await writeArtifact('field/supervisor-comparison.json',JSON.stringify(v,null,2)+'\n');return v;});
 if(!report.steps.adopt?.input){
  await staffRefresh(p);
  const panel=p.locator('section').filter({has:p.getByRole('heading',{name:'Returned field file · '+returnId.slice(0,8),exact:true})}).first();
  await panel.getByRole('button',{name:'Compare with current inspections',exact:true}).click();
  const review=panel.locator('section').filter({has:panel.getByRole('heading',{name:'Review returned observations',exact:true})}).first();
  await review.getByLabel('Inspection decision',{exact:true}).selectOption('apply');
  await review.getByLabel('Reason for this inspection',{exact:true}).fill('Use explicitly selected returned observations; preserve the concurrent local edition as original history.');
  await review.getByLabel('Overall receiving reason',{exact:true}).fill('Complete field copy reviewed against its issued baseline and the current supervisor edition. No approval or GIS edit is inferred.');
  const compared=await api('/api/field-compare?id='+encodeURIComponent(returnId));
  for(const item of compared.items)for(const f of item.fields){const section=review.locator('section').filter({has:review.getByRole('heading',{name:f.label,exact:true})}).first();await section.getByLabel('Receiving choice',{exact:true}).selectOption(f.key==='$note'||f.key==='$attachments'?'returned':'current');}
  await review.getByRole('button',{name:'Use this reviewed current comparison',exact:true}).click();
 }
 const adopted=await uiMutation(p,'adopt','/api/command',()=>click(p,'Save receiving decisions'));
 await staffRefresh(p);const final=await current(),iv=await api('/api/inspection?id='+encodeURIComponent(config.inspectionId));
 const named=edited.value.editions.at(-1).items.find(x=>x.inspectionId===config.inspectionId);
 need(iv.version.status==='draft'&&iv.version.note===named.note&&same(iv.version.attachments,named.attachments),'Adoption did not create the intended draft inspection with retained original attachments.');
 await writeArtifact('field/adopted-inspection.json',JSON.stringify(iv,null,2)+'\n');
 for(const [width,prefix] of [[1440,'staff-desktop'],[390,'staff-mobile']]){
  await p.setViewportSize({width,height:width===390?844:1000});
  for(const section of ['sources','field','review','field-exchange','dispatch','history','transfer']){
   await p.locator('[data-section="'+section+'"]').click();await p.locator('#content h2').first().waitFor();need(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Staff interface overflows '+section);await shot(p,prefix+'-'+section);}
 }
 await phase('returned-byte-reopen',{issueId:issuedId,returnId,unfinishedId:unfinishedReceive.outcome.return.id},async f=>{
  const rows=[];for(const [kind,id,format,path] of [['issues',f.issueId,'json','issued.json'],['issues',f.issueId,'html','issued.html'],['returns',f.returnId,'original',conflicted.saved.json.split('/').at(-1)],['returns',f.unfinishedId,'original','unfinished.json']]){
   const bytes=await exactField(kind,id,format),expected=await readFile(resolve(out,'field',path));need(bytes.equals(expected),'Retained field download differs after adoption.');rows.push({kind,id,format,sha256:sha(bytes),bytes:bytes.length});}
  return rows;});
 await phase('final-original',{},async()=>({revision:final.revision,sha256:final.sha256,inspectionId:config.inspectionId,inspectionVersion:iv.version.number,issueId:issuedId,returnId,unfinishedReturnId:unfinishedReceive.outcome.return.id,adoptionId:adopted.outcome.adoption.id}));
 await owner.closeBrowser();
 }
 await owner.shutdown();need(!owner.pageErrors.length,'Browser page errors: '+owner.pageErrors.join('\n'));
 report.status='COMPLETE';report.completedAt=new Date().toISOString();await retain();console.log(JSON.stringify(report));
}catch(error){report.status='INCOMPLETE';report.error=error.stack||String(error);try{await owner.shutdown(error);}catch(e){report.cleanupErrors=[...(report.cleanupErrors||[]),e.stack||String(e)];}await retain();throw error;}
finally{try{await owner.shutdown();}finally{owner.removeSignals();await retain();}}
