import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import * as Engine from './engine.mjs';
import * as Portable from './portable.mjs';
import {openMigrationReceiving} from '../migration-receiving/continuation.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function regular(file){const s=await fs.lstat(file);need(s.isFile()&&!s.isSymbolicLink(),'Retain a regular original file: '+file);return fs.readFile(file);}
async function optional(file){try{return await regular(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function immutable(file,body){
 const old=await optional(file);if(old){need(old.equals(body),'The retained original receiving bytes differ: '+file);return;}
 await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';let h;
 try{h=await fs.open(temporary,'wx',0o600);await h.writeFile(body);await h.sync();await h.close();h=null;try{await fs.link(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;need((await regular(file)).equals(body),'The original selected output changed: '+file);}}
 finally{await h?.close().catch(()=>{});await fs.rm(temporary,{force:true});}
}
const esc=x=>String(x).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
const field=(form,name)=>form.locator('[name="'+esc(name)+'"]');
async function fill(form,name,value){const control=field(form,name);const tag=await control.evaluate(n=>({tag:n.tagName,type:n.type}));if(tag.type==='checkbox')await control.setChecked(value===true);else if(tag.tag==='SELECT')await control.selectOption(String(value));else await control.fill(String(value));}
async function values(form,data){for(const [key,value]of Object.entries(data))await fill(form,key,value);}
async function submit(form){await form.locator('button[type="submit"]').click();}
async function section(page,id){await page.locator('nav button[data-section="'+id+'"]').click();await page.locator('nav button[data-section="'+id+'"][aria-current="page"]').waitFor();}
async function frozenSource(root,file){
 need(path.isAbsolute(root)&&path.isAbsolute(file),'Use absolute original receiving and source-workspace paths.');
 const dir=path.join(root,'attempts','selected-source'),manifest=path.join(dir,'source-selection.json'),retained=path.join(dir,'complete-original-workspace.json'),old=await optional(manifest);
 const current=await optional(file);
 let selection;
 if(old){selection=JSON.parse(old);need(selection.path===path.resolve(file),'Continue the exact original source-workspace selection.');const original=await regular(retained);need(original.length===selection.bytes&&sha(original)===selection.sha256,'The retained complete original workspace changed.');if(current)need(current.equals(original),'The original source workspace changed; preserve this run and select an explicit successor edition.');return{selection,bytes:original,retained};}
 need(current,'Select the complete original source workspace.');Engine.importWorkspace(current.toString('utf8'));selection={schema:'tjlabs.tourism-receiving-source.v1',path:path.resolve(file),bytes:current.length,sha256:sha(current)};
 // Publish original bytes before the selected identity; an interrupted first write cannot create a false complete manifest.
 await immutable(retained,current);await immutable(manifest,json(selection));return{selection,bytes:current,retained};
}
async function frozenAttachments(root,paths){
 need(Array.isArray(paths)&&paths.length>=2&&paths.every(p=>typeof p==='string'&&path.isAbsolute(p))&&new Set(paths.map(p=>path.resolve(p))).size===paths.length,'Select the exact complete workshare and practical-guide attachment paths.');
 const dir=path.join(root,'attempts','selected-attachments'),manifest=path.join(dir,'attachment-selection.json'),old=await optional(manifest),resolved=paths.map(p=>path.resolve(p));
 if(old){const saved=JSON.parse(old);need(same(saved.map(x=>x.originalPath),resolved),'Continue the exact original outgoing attachment selection.');for(const item of saved){const body=await regular(item.retainedPath);need(body.length===item.bytes&&sha(body)===item.sha256,'The complete retained outgoing attachment changed.');const current=await optional(item.originalPath);if(current)need(current.equals(body),'An exact outgoing attachment changed; select a deliberate successor edition.');}return saved;}
 const saved=[];
 for(const [index,file]of resolved.entries()){const body=await regular(file),ext=path.extname(file).toLowerCase();need(['.html','.htm','.json','.csv','.txt','.md'].includes(ext),'This current four-attachment course accepts complete HTML, JSON and text; use the existing actual page viewer for an additional PDF edition.');const retainedPath=path.join(dir,'attachment-'+index+ext);await immutable(retainedPath,body);saved.push({originalPath:file,retainedPath,filename:path.basename(file),bytes:body.length,sha256:sha(body),extension:ext});}
 await immutable(manifest,json(saved));return saved;
}
async function waitFileOpened(page){await page.waitForFunction(()=>{const files=[...document.querySelectorAll('main input[type="file"]')];return files.length&&files.every(n=>!n.value);});await page.locator('#workspace-revision').waitFor();}
function bootOf(html){const match=html.match(/(<script id="tourism-boot" type="application\/json">)([\s\S]*?)(<\/script>)/);need(match,'Use the actual Tourism Series standalone application.');return{match,data:JSON.parse(match[2])};}
function seedHTML(html,{copyId,portable}){const b=bootOf(html),record=Portable.parseRecovery(portable);record.copyId=copyId;return html.replace(b.match[0],()=>b.match[1]+Portable.safeJSON({...b.data,copyId,record})+b.match[3]);}
const model={id:'tourism-complete-recovery-envelope-v1',identity:r=>({id:r.workspace.id,title:r.workspace.title,createdAt:r.workspace.createdAt}),revision:r=>r.workspace.revision,operations:r=>r.workspace.operations,sequence:o=>o.revision};
const facade={createWorkspace:input=>Portable.recovery(Engine.createWorkspace(input)),exportWorkspace:record=>Portable.json(Portable.recovery(record.workspace,record.drafts,record.selection,record.copyId)),importWorkspace:Portable.parseRecovery};
async function beforeCheckpoint(page){const old=await page.locator('nav button[aria-current="page"]').getAttribute('data-section');if(old!=='workspace')await section(page,'workspace');return async()=>{if(old&&old!=='workspace')await section(page,old);};}
async function setContext(page,registryId,sourceIds){
 await page.locator('select[name="registrySelection"]').selectOption(registryId);
 const open=async()=>{const details=page.locator('details').filter({has:page.getByText('Select complete source series',{exact:true})});if(await details.getAttribute('open')===null)await details.locator('summary').click();};
 const ids=await page.locator('input[name^="context:"]:checked').evaluateAll(nodes=>nodes.map(n=>n.name.slice(8)));
 for(const id of ids){await open();await page.locator('input[name="'+esc('context:'+id)+'"]').uncheck();}
 for(const id of sourceIds){await open();await page.locator('input[name="'+esc('context:'+id)+'"]').check();}
}
function stripped(input){const out={...input};delete out.operationId;delete out.expectedRevision;delete out.at;delete out.content_base64;delete out.text;delete out.actor;return out;}
async function chooseAndSubmit(page,session,fixture,operation,revision,actor,files){
 const input=operation.input,expected={kind:operation.kind,input:stripped(input)};
 return session.mutation('original-source-operation-'+operation.revision,revision,expected,async()=>{
  await page.locator('#operator-name').fill(actor);
  if(operation.kind==='import-file'){
   const original=fixture.files.find(f=>f.id===operation.fileInputId);need(original,'Retain the original file for '+operation.id);
   await section(page,'sources');const form=page.locator('form[data-action="importFile"]');
   await values(form,{id:original.id,source_url:original.source_url,publisher:original.publisher,published_at:original.published_at,retrieved_at:original.retrieved_at,representation:original.representation,note:original.note});
   await field(form,'file').setInputFiles({name:original.filename,mimeType:original.mime_type,buffer:Buffer.from(original.content_base64,'base64')});await submit(form);
  }else if(operation.kind==='import-csv'){
   const source=fixture.sources.find(s=>s.id===operation.sourceInputId);need(source,'Retain the original CSV for '+operation.id);
   await section(page,'sources');const form=page.locator('form[data-action="importCsv"]');await values(form,{id:source.id,role:source.role});await field(form,'file').setInputFiles({name:source.filename,mimeType:'text/csv',buffer:Buffer.from(source.text,'utf8')});await submit(form);
  }else if(operation.kind==='save-registry'){
   await section(page,'registry');const form=page.locator('form[data-action="saveRegistry"]');await fill(form,'registry',JSON.stringify(input.registry,null,2));await submit(form);
  }else if(operation.kind==='save-mapping'){
   await section(page,'mapping');await setContext(page,input.registryId,[input.sourceId]);await page.locator('select[name="sourceSelection"]').selectOption(input.sourceId);
   const form=page.locator('form[data-action="'+esc('saveMapping:'+input.sourceId+':'+input.registryId)+'"]');
   for(const name of Engine.FIELDS){const mode=Object.hasOwn(input.columns,name)?'column':Object.hasOwn(input.constants,name)?'constant':'unmapped';await fill(form,'mode:'+name,mode);if(mode==='column')await fill(form,'column:'+name,input.columns[name]);if(mode==='constant')await fill(form,'constant:'+name,input.constants[name]);}
   await submit(form);
  }else if(operation.kind==='save-correction'){
   const originalMapping=fixture.mappingHistory.filter(m=>m.sourceId===input.sourceId&&m.revision<operation.revision).at(-1);need(originalMapping,'Select the correction’s original registry mapping.');await section(page,'observations');await setContext(page,originalMapping.registryId,[input.sourceId]);
   // Inspect by actual row identity; move through the visible complete row pages.
   while(!(await page.locator('button[data-row-id="'+esc(input.rowId)+'"]').count())){const next=page.getByRole('button',{name:'Next 50',exact:true});need(await next.isEnabled(),'The original correction row is absent from the complete projected source.');await next.click();}
   await page.locator('button[data-row-id="'+esc(input.rowId)+'"]').click();const form=page.locator('form[data-action="'+esc('saveCorrection:'+input.rowId)+'"]');await values(form,{column:input.column,value:input.value,reason:input.reason});await submit(form);
  }else if(operation.kind==='save-analysis'){
   await section(page,'analyses');await setContext(page,input.analysis.registryId,input.analysis.sourceIds);const form=page.locator('form[data-action="'+esc('saveAnalysis:'+input.analysis.registryId)+'"]');
   await values(form,{id:input.id,title:input.title,note:input.note,kind:input.analysis.kind,rowIds:input.analysis.rowIds.join('\n'),dimension:input.analysis.dimension||'',partitionId:input.analysis.partitionId||'',ratioPairId:input.analysis.ratioPairId||'',reconciliationId:input.analysis.reconciliationId||'',tolerance:input.analysis.tolerance??''});
   await page.locator('#analysis-preview-button').click();await page.locator('#analysis-preview .metric').waitFor();await submit(form);
  }else if(operation.kind==='save-report'){
   await section(page,'reports');const form=page.locator('form[data-action="saveReport"]');await values(form,{id:input.id,title:input.title,note:input.note});for(const id of input.analysisIds)await fill(form,'analysis:'+id,true);await submit(form);
  }else if(operation.kind==='prepare-target'){
   await section(page,'target');await setContext(page,input.registryId,input.sourceIds);await page.locator('select[name="templateSelection"]').selectOption(input.templateFileId);const form=page.locator('form[data-action="'+esc('prepareTarget:'+input.templateFileId+':'+input.registryId)+'"]');
   await values(form,{id:input.id,rowIds:input.rowIds.join('\n'),note:input.note});for(const c of input.columns){await fill(form,'kind:'+c.column,Object.hasOwn(c,'field')?'field':'constant');await fill(form,(Object.hasOwn(c,'field')?'field:':'constant:')+c.column,c.field??c.constant);}for(const column of input.keyColumns)await fill(form,'key:'+column,true);await submit(form);
  }else if(operation.kind==='record-target-return'){
   await section(page,'target');await page.locator('select[name="planSelection"]').selectOption(input.planId);await page.locator('select[name="returnedSelection"]').selectOption(input.sourceId);const form=page.locator('form[data-action="'+esc('recordTargetReturn:'+input.planId+':'+input.sourceId)+'"]');await values(form,{id:input.id,note:input.note});for(const c of input.columns)await fill(form,'column:'+c.preparedColumn,c.returnedColumn);await submit(form);
  }else throw Error('The selected source course contains an unsupported native action: '+operation.kind);
 });
}
async function download(page,locator,file){const waiting=page.waitForEvent('download');await locator.click();const d=await waiting;await d.saveAs(file);const bytes=await regular(file);return{path:file,name:d.suggestedFilename(),bytes:bytes.length,sha256:sha(bytes)};}
async function capture(page,dir,name,screens,{fullPage=true}={}){for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const file=path.join(dir,name+'-'+width+'.png');await page.screenshot({path:file,fullPage});screens.push(file);}}
function zipMembers(bytes){
 const map=new Map();let p=0;
 while(p+4<=bytes.length&&bytes.readUInt32LE(p)===0x04034b50){need(p+30<=bytes.length&&bytes.readUInt16LE(p+8)===0,'Open the complete stored ZIP generated by the actual application.');const size=bytes.readUInt32LE(p+18),n=bytes.readUInt16LE(p+26),extra=bytes.readUInt16LE(p+28),name=bytes.subarray(p+30,p+30+n).toString('utf8'),start=p+30+n+extra;need(start+size<=bytes.length&&!map.has(name),'Retain every complete distinct ZIP member.');map.set(name,bytes.subarray(start,start+size));p=start+size;}
 need(map.size&&bytes.readUInt32LE(p)===0x02014b50,'Open the complete ZIP directory.');return map;
}
async function verifyHandover(bytes,source,record){
 const members=zipMembers(bytes),expected=Portable.completeFiles(source,record);need(members.size===expected.length,'The complete ZIP member count differs from the selected delivery.');
 for(const f of expected){const body=f.base64===undefined?Buffer.from(f.content,'utf8'):Buffer.from(f.base64,'base64');need(members.get(f.path)?.equals(body),'The exact complete ZIP member differs: '+f.path);}
 return members;
}
export async function runTourismReceiving({page,context,outputDirectory,applicationPath,sourceWorkspacePath,attachmentPaths}){
 await page.setViewportSize({width:1440,height:1000});
 const attachments=await frozenAttachments(outputDirectory,attachmentPaths);
 const frozen=await frozenSource(outputDirectory,sourceWorkspacePath),fixture=Engine.importWorkspace(frozen.bytes.toString('utf8')),actor='Original tourism receiving operator';
 const session=await openMigrationReceiving({page,outputDirectory,applicationPath,engine:facade,title:'Tourism Series complete source receiving',resultFilename:'tourism-receiving-result.json',workspaceModel:model,browserControls:{ready:'#workspace-revision',workspaceDownload:'#top-json',seedHTML,beforeCheckpoint}});
 if(session.completed)return session.completed;
 const outputs=[],screens=[],errors=[];const listen=error=>errors.push(error.message);page.on('pageerror',listen);
 try{
  const app=await regular(applicationPath);need(app.length===session.intent.application.bytes&&sha(app)===session.intent.application.sha256,'The original application changed after its receiving intent was pinned.');const source=bootOf(app.toString('utf8')).data.source;
  const exactOutgoing=await session.phase('open-exact-outgoing-attachments',async()=>{
   const fresh=await context.browser().newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),view=await fresh.newPage();view.on('pageerror',listen);
   try{
    const directory=path.join(session.attempt,'exact-outgoing');await fs.mkdir(directory,{recursive:true});
    const actual=path.join(directory,'Tourism_Series_Workspace.html');await immutable(actual,app);await view.goto(pathToFileURL(actual).href);
    if(bootOf(app.toString('utf8')).data.record)await view.locator('#workspace-revision').waitFor();else await view.locator('#create-workspace').waitFor();
    await capture(view,directory,'actual-outgoing-application',screens,{fullPage:false});
    if(await view.locator('#workspace-revision').count())await section(view,'workspace');
    await view.locator('main input[type="file"]').setInputFiles(frozen.retained);await waitFileOpened(view);
    for(const sectionId of ['workspace','observations','analyses','reports']){await section(view,sectionId);if(['observations','analyses'].includes(sectionId))await setContext(view,fixture.registries.at(-1).id,fixture.sources.filter(s=>s.role==='source').map(s=>s.id));await capture(view,directory,'actual-reference-'+sectionId,screens);}
    const opened=await beforeCheckpoint(view);let downloaded;try{downloaded=await download(view,view.locator('#top-workspace'),path.join(directory,'opened-original-reference.json'));}finally{await opened();}
    need((await regular(downloaded.path)).equals(Buffer.from(Engine.exportWorkspace(fixture))),'The exact outgoing reference JSON did not reopen unchanged.');outputs.push(downloaded);
    const selected=[{path:actual,bytes:app.length,sha256:sha(app),role:'exact outgoing application'}, {path:frozen.retained,bytes:frozen.selection.bytes,sha256:frozen.selection.sha256,role:'exact outgoing reference JSON'}];
    for(const [index,attachment]of attachments.entries()){
     const body=await regular(attachment.retainedPath),file=path.join(directory,'attachment-'+index+attachment.extension);await immutable(file,body);
     if(['.html','.htm'].includes(attachment.extension)){await view.goto(pathToFileURL(file).href);await view.locator('body').waitFor();await capture(view,directory,'actual-attachment-'+index,screens);await view.emulateMedia({media:'print'});await capture(view,directory,'actual-attachment-'+index+'-print',screens,{fullPage:false});await view.emulateMedia({media:'screen'});}
     else{const text=body.toString('utf8');need(Buffer.from(text,'utf8').equals(body),'Open the exact UTF-8 attachment.');for(let part=0;part<Math.max(1,Math.ceil(text.length/12000));part++){await view.setContent('<!doctype html><meta charset="utf-8"><style>body{font:15px/1.5 monospace;margin:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre></pre>');await view.locator('pre').evaluate((node,value)=>{node.textContent=value;},text.slice(part*12000,(part+1)*12000));await capture(view,directory,'actual-attachment-'+index+'-part-'+part,screens,{fullPage:false});}}
     selected.push({path:file,originalPath:attachment.originalPath,bytes:body.length,sha256:sha(body),role:'exact outgoing attachment'});
    }
    return{selected,visualInspection:'Return these actual rendered views to the producing worker for personal inspection.'};
   }finally{await fresh.close();}
  },{outputs,screens});
  const imported=await session.phase('complete-original-source-operations',async()=>{
   let current;for(let i=0;i<fixture.operations.length;i++)current=await chooseAndSubmit(page,session,fixture,fixture.operations[i],i+1,actor,outputs);
   need(current&&current.workspace.revision===fixture.revision,'Complete every original source operation.');const w=current.workspace;
   need(same(w.files,fixture.files)&&same(w.sources,fixture.sources)&&same(w.registries,fixture.registries),'The complete original files/CSV/registries differ from the selected source edition.');
   // New native operation IDs may produce new mapping IDs; source fields and frozen arithmetic remain exact.
   for(const a of fixture.analyses){const actual=w.analyses.find(x=>x.id===a.id);need(actual&&same(actual.request,a.request)&&same(actual.result.result,a.result.result),'The actual rendered calculation differs from its original source-qualified selection: '+a.id);}
   return{revision:w.revision,workspaceId:w.id,sourceIds:w.sources.map(s=>s.id),fileIds:w.files.map(f=>f.id)};
  },{outputs,screens});
  await session.phase('current-rendered-source-and-reports',async()=>{
   for(const id of ['sources','registry','mapping','observations','analyses','reports','target','history']){await section(page,id);await capture(page,session.attempt,'current-'+id,screens);}
   return{sections:8,layouts:[1440,390]};
  },{outputs,screens});
  const delivered=await session.phase('complete-download-and-independent-reopen',async()=>{
   await section(page,'reports');const draft=page.locator('form[data-action="saveReport"]');await fill(draft,'title','Unfinished report title retained across reopening');await fill(draft,'note','Original unfinished note\n\nDo not replace published totals or collapse incompatible populations.');
   const record=await session.checkpoint();need(record.drafts.saveReport?.fields.note.includes('Do not replace'),'Retain actual unfinished writing before download.');
   await section(page,'workspace');
   const working=await download(page,page.locator('#top-working-html'),path.join(session.attempt,'Tourism_Series_Workspace.html'));
   const recovery=await download(page,page.locator('#top-json'),path.join(session.attempt,'Working_Recovery.json'));
   const original=await download(page,page.locator('#top-workspace'),path.join(session.attempt,'workspace.json'));
   const zip=await download(page,page.locator('#top-zip'),path.join(session.attempt,'Tourism_Series_Complete.zip'));outputs.push(working,recovery,original,zip);
   const complete=Portable.parseRecovery((await regular(recovery.path)).toString('utf8'));need(same(complete.workspace,record.workspace)&&same(complete.drafts,record.drafts),'Actual saved recovery differs from the original complete workspace and unfinished writing.');
   const members=await verifyHandover(await regular(zip.path),source,complete);
   for(const [name,body]of members){need(!path.isAbsolute(name)&&!name.split('/').some(p=>p==='..'||p==='.'),'Keep original ZIP members within the extracted delivery.');await immutable(path.join(session.attempt,'opened-complete-delivery',name),body);}
   const fresh=await context.browser().newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),other=await fresh.newPage();other.on('pageerror',listen);
   try{
    await other.goto(pathToFileURL(working.path).href);await other.locator('#workspace-revision').waitFor();await section(other,'reports');need(await field(other.locator('form[data-action="saveReport"]'),'note').inputValue()===record.drafts.saveReport.fields.note,'The downloaded working HTML lost unfinished text.');
    await capture(other,session.attempt,'independent-working-html',screens);
    await section(other,'workspace');const opened=await download(other,other.locator('#top-json'),path.join(session.attempt,'independent-reopened-recovery.json'));outputs.push(opened);const reopened=Portable.parseRecovery((await regular(opened.path)).toString('utf8'));need(same(reopened.workspace,complete.workspace)&&same(reopened.drafts,complete.drafts),'Independent working HTML changed full workspace/draft bytes.');
    await other.locator('input[type="file"]').setInputFiles(recovery.path);await waitFileOpened(other);await section(other,'observations');await capture(other,session.attempt,'opened-downloaded-json',screens);
    const reportName=[...members.keys()].find(x=>x==='reports/complete-report.html');need(reportName,'Retain complete readable report.');await other.goto(pathToFileURL(path.join(session.attempt,'opened-complete-delivery',reportName)).href);await other.locator('h1').waitFor();await capture(other,session.attempt,'opened-readable-report',screens,{fullPage:false});
    const headings=other.locator('section h2');for(let i=0;i<Math.min(8,await headings.count());i++){await headings.nth(i).scrollIntoViewIfNeeded();await capture(other,session.attempt,'opened-readable-report-section-'+i,screens,{fullPage:false});}await other.emulateMedia({media:'print'});await capture(other,session.attempt,'opened-readable-report-print',screens,{fullPage:false});await other.emulateMedia({media:'screen'});
    // Open every original byte member through its ordinary viewer. Image/PDF pages are returned for actual operator inspection below.
    const attachments=[];for(const originalFile of record.workspace.files){const manifest=Engine.buildHandover(record.workspace).manifest.originalFilenames.find(x=>x.id===originalFile.id),file=path.join(session.attempt,'opened-complete-delivery',manifest.path);need((await regular(file)).equals(Buffer.from(originalFile.content_base64,'base64')),'The opened original attachment changed.');attachments.push({id:originalFile.id,path:file,mime_type:originalFile.mime_type,bytes:originalFile.bytes,sha256:originalFile.sha256});}
    return{workspaceId:complete.workspace.id,revision:complete.workspace.revision,workingHTML:working.path,recovery:recovery.path,zip:zip.path,memberCount:members.size,attachments,unfinished:complete.drafts.saveReport};
   }finally{await fresh.close();}
  },{outputs,screens});
  await session.phase('same-copy-two-tab-recovery',async()=>{
   // An independent isolated copy exercises the local concurrency controls. The original source programme remains unchanged.
   const exercise=await context.browser().newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),first=await exercise.newPage(),second=await exercise.newPage();first.on('pageerror',listen);second.on('pageerror',listen);
   const baseline=Portable.parseRecovery((await regular(delivered.recovery)).toString('utf8'));baseline.copyId=session.intent.copyId+'-concurrency';baseline.drafts={};baseline.selection={section:'reports'};
   const file=path.join(session.attempt,'concurrency-original.html');await immutable(file,Buffer.from(Portable.workingHTML(source,baseline)));
   try{
    await first.goto(pathToFileURL(file).href);await first.locator('#workspace-revision').waitFor();await second.goto(pathToFileURL(file).href);await second.locator('#workspace-revision').waitFor();
    await section(first,'reports');await section(second,'reports');await first.locator('#operator-name').fill(actor);await second.locator('#operator-name').fill(actor);
    const a=first.locator('form[data-action="saveReport"]'),b=second.locator('form[data-action="saveReport"]'),analysisId=baseline.workspace.analyses[0]?.id;need(analysisId,'The source course must retain a complete analysis.');
    await values(a,{id:'receiving-original-branch',title:'Receiving original branch',note:'Authored operator exercise; source observations remain unchanged.'});
    await values(b,{id:'receiving-other-branch',title:'Receiving other-tab branch',note:'Distinct unfinished branch preserved after the first tab saves.'});
    await fill(a,'analysis:'+analysisId,true);await fill(b,'analysis:'+analysisId,true);await submit(a);await first.waitForFunction(n=>document.querySelector('#workspace-revision').textContent==='Revision '+n,baseline.workspace.revision+1);
    await submit(b);await second.locator('#conflicts h2').waitFor();await capture(second,session.attempt,'two-tab-conflict',screens);
    const conflict=await download(second,second.getByRole('button',{name:'Download both versions and draft values',exact:true}),path.join(session.attempt,'Both_Original_Branches.json'));outputs.push(conflict);const body=JSON.parse((await regular(conflict.path)).toString('utf8'));need(body.current.reports.some(r=>r.id==='receiving-original-branch')&&body.candidate.reports.some(r=>r.id==='receiving-other-branch'),'Retain both actual complete report branches.');
    await second.getByRole('button',{name:'Continue my version as a new copy',exact:true}).click();await section(second,'workspace');const recovered=await download(second,second.locator('#top-json'),path.join(session.attempt,'Independent_Conflict_Branch.json'));outputs.push(recovered);need(Portable.parseRecovery((await regular(recovered.path)).toString('utf8')).workspace.reports.some(r=>r.id==='receiving-other-branch'),'Continue the actual second branch through normal controls.');
    // Reopen the older file in the first copy. The newer saved workspace must survive.
    await first.goto(pathToFileURL(file).href);await first.locator('#workspace-revision').waitFor();need(await first.locator('#workspace-revision').textContent()==='Revision '+(baseline.workspace.revision+1),'Older working HTML overwrote a newer saved local revision.');
    return{originalSourceRevision:baseline.workspace.revision,independentExerciseRevision:baseline.workspace.revision+1,conflict:conflict.path,recovered:recovered.path};
   }finally{await exercise.close();}
  },{outputs,screens});
  const targetCourse=await session.phase('explicit-software-target-course',async()=>{
   const base=await session.checkpoint(),registry=base.workspace.registries.at(-1),sourceIds=base.workspace.sources.filter(s=>s.role==='source').map(s=>s.id),rows=Engine.project(base.workspace,{registryId:registry.id,sourceIds}).rows.filter(r=>r.valid&&r.normalized_value!==null).slice(0,3);need(rows.length>0,'Select real qualified observations for the separate authored target exercise.');
   const start=imported.revision,templateId='receiving-authored-target-template',planId='receiving-authored-target-plan',returnSource='receiving-authored-return',returnId='receiving-authored-return-review';
   const templateText='\ufeffsource_row,geography,metric,value\r\n';
   let record=await session.mutation('authored-template',start+1,{kind:'import-file',input:{id:templateId,representation:'authored_transcription'}},async()=>{
    await section(page,'sources');await page.locator('#operator-name').fill(actor);const form=page.locator('form[data-action="importFile"]');await values(form,{id:templateId,source_url:'',publisher:'Software receiving course',published_at:'',retrieved_at:session.intent.createdAt,representation:'authored_transcription',note:'Authored target-template exercise. No vendor schema or platform import was obtained.'});
    await field(form,'file').setInputFiles({name:'Authored_Target_Template.csv',mimeType:'text/csv',buffer:Buffer.from(templateText,'utf8')});await submit(form);
   });
   record=await session.mutation('authored-prepared-target',start+2,{kind:'prepare-target',input:{id:planId,templateFileId:templateId,rowIds:rows.map(r=>r.rowId),keyColumns:[0]}},async()=>{
    await section(page,'target');await setContext(page,registry.id,sourceIds);await page.locator('select[name="templateSelection"]').selectOption(templateId);const form=page.locator('form[data-action="'+esc('prepareTarget:'+templateId+':'+registry.id)+'"]');await values(form,{id:planId,rowIds:rows.map(r=>r.rowId).join('\n'),note:'Software-only CSV preparation and return exercise; no executed vendor import.'});for(const [i,name]of ['rowId','geography_id','metric_id','normalized_value'].entries()){await fill(form,'kind:'+i,'field');await fill(form,'field:'+i,name);}await fill(form,'key:0',true);await submit(form);
   });
   const plan=record.workspace.targetPlans.find(p=>p.id===planId);need(plan&&plan.rows.length===rows.length,'Prepare every selected actual source row.');
   const returnedText=Engine.encodeCsv([['native_reference',...plan.headers],...plan.rows.map((r,i)=>['authored-'+(i+1),...r.cells])]);
   record=await session.mutation('authored-returned-csv',start+3,{kind:'import-csv',input:{id:returnSource,role:'target'}},async()=>{
    await section(page,'sources');const form=page.locator('form[data-action="importCsv"]');await values(form,{id:returnSource,role:'target'});await field(form,'file').setInputFiles({name:'Authored_Target_Return.csv',mimeType:'text/csv',buffer:Buffer.from(returnedText)});await submit(form);
   });
   record=await session.mutation('authored-return-comparison',start+4,{kind:'record-target-return',input:{id:returnId,planId,sourceId:returnSource}},async()=>{
    await section(page,'target');await page.locator('select[name="planSelection"]').selectOption(planId);await page.locator('select[name="returnedSelection"]').selectOption(returnSource);const form=page.locator('form[data-action="'+esc('recordTargetReturn:'+planId+':'+returnSource)+'"]');await values(form,{id:returnId,note:'Comparison of an explicitly authored return; this is a software receiving exercise.'});for(let i=0;i<plan.headers.length;i++)await fill(form,'column:'+i,i+1);await submit(form);
   });
   const received=record.workspace.targetReturns.find(r=>r.id===returnId);need(received?.ready&&received.matched.length===rows.length&&received.extraColumns[0]?.name==='native_reference','The real controls must preserve native extras and reconcile every authored returned row.');
   await section(page,'target');await capture(page,session.attempt,'authored-target-return',screens);await section(page,'workspace');const output=await download(page,page.locator('#top-zip'),path.join(session.attempt,'Software_Target_Exercise_Complete.zip'));outputs.push(output);const final=await session.checkpoint();await verifyHandover(await regular(output.path),source,final);return{meaning:'Explicit software demonstration, separate from the original customer reference delivery',revision:final.workspace.revision,planId,returnId,matched:received.matched.length,zip:output.path};
  },{outputs,screens});
  need((await regular(applicationPath)).equals(app),'The exact original application changed during receiving.');
  const currentOriginal=await optional(sourceWorkspacePath);if(currentOriginal)need(currentOriginal.equals(frozen.bytes),'The original selected source workspace changed during receiving.');
  for(const attachment of attachments){const current=await optional(attachment.originalPath);if(current)need(current.length===attachment.bytes&&sha(current)===attachment.sha256,'An original outgoing attachment changed during receiving.');}
  need(errors.length===0,'Repair actual browser errors: '+errors.join('\n'));
  const complete=await session.checkpoint();
  return await session.finish({schema:'tjlabs.tourism-browser-receiving.v1',state:'COMPLETE',application:{path:applicationPath,bytes:app.length,sha256:sha(app)},source:frozen.selection,workspaceId:complete.workspace.id,revision:complete.workspace.revision,sourceCourse:imported,exactOutgoing,delivery:delivered,targetCourse,outputs,screenshots:screens,pageErrors:errors,visualInspection:{state:'AWAITING_PRODUCING_WORKER_LOOK',instruction:'Open the returned exact desktop/mobile PNGs and all outgoing attachments, including every applicable original PDF page, and record actual inspection in this original programme.'}});
 }finally{page.off('pageerror',listen);await session.close();}
}
