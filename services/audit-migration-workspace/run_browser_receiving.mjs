import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import * as Engine from './engine.mjs';
import * as Portable from './portable.mjs';
import {loadSource} from './build.mjs';
import {buildReceivingFixture} from './receiving-fixture.mjs';
import {openMigrationReceiving} from '../migration-receiving/continuation.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const same=(a,b)=>Portable.canonical(a)===Portable.canonical(b);
async function regular(file){const stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'Keep a regular original file: '+file);return fs.readFile(file);}
async function optional(file){try{return await regular(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function immutable(file,bytes){
 const body=Buffer.from(bytes),old=await optional(file);if(old){need(old.equals(body),'Original receiving bytes changed: '+file);return;}
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;try{await fs.link(temp,file);}catch(error){if(error.code!=='EEXIST')throw error;need((await regular(file)).equals(body),'Original output differs: '+file);}}
 finally{await handle?.close().catch(()=>{});await fs.rm(temp,{force:true});}
}
function bootOf(html){const re=/<script type="application\/json" id="audit-boot">([\s\S]*?)<\/script>/,match=html.match(re);need(match,'Read the exact complete Audit Source Workspace application.');return{match,data:JSON.parse(match[1])};}
function seedHTML(html,{copyId,portable}){const {match,data}=bootOf(html),record=Portable.parseRecovery(portable);record.copyId=copyId;return html.replace(match[0],()=>'<script type="application/json" id="audit-boot">'+Portable.safeJSON({...data,record,copyId})+'</script>');}
const model={id:'audit-complete-recovery-v1',identity:r=>({id:r.workspace.id,title:r.workspace.title,createdAt:r.workspace.createdAt}),revision:r=>r.workspace.revision,operations:r=>r.workspace.operations,sequence:op=>op.revision};
const facade={createWorkspace:input=>Portable.recovery(Engine.createWorkspace(input)),importWorkspace:Portable.parseRecovery,exportWorkspace:r=>Portable.json(Portable.recovery(r.workspace,r.drafts,r.selection,r.copyId))};
const esc=x=>String(x).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
const field=(form,name)=>form.locator('[name="'+esc(name)+'"]');
async function ready(page){await page.locator('#audit-app[aria-busy="false"]').waitFor();}
async function section(page,name){await ready(page);await page.locator('[data-section="'+name+'"]').click();await page.locator('[data-section="'+name+'"][aria-current="true"]').waitFor();await ready(page);}
async function fill(form,name,value){const selected=field(form,name),kind=await selected.evaluate(el=>({tag:el.tagName,type:el.type}));if(kind.type==='checkbox')await selected.setChecked(value===true);else if(kind.tag==='SELECT')await selected.selectOption(String(value));else await selected.fill(String(value));}
async function values(form,data){for(const [key,value]of Object.entries(data))await fill(form,key,value);}
async function checks(form,prefix,selected){const wanted=new Set(selected.map(String)),nodes=await form.locator('input[type="checkbox"][name^="'+esc(prefix+':')+'"]').evaluateAll(list=>list.map(el=>el.name));for(const name of nodes)await fill(form,name,wanted.has(name.slice(prefix.length+1)));}
async function submit(form){await form.locator('button[type="submit"]').click();}
async function beforeCheckpoint(page){await ready(page);const previous=await page.locator('nav button[aria-current="true"]').getAttribute('data-section');if(previous!=='workspace')await section(page,'workspace');return async()=>{if(previous&&previous!=='workspace')await section(page,previous);};}
async function originalInputs(root,applicationPath,fixturePath,attachmentPaths){
 need(path.isAbsolute(root)&&path.isAbsolute(applicationPath)&&path.isAbsolute(fixturePath),'Use the same original absolute application, authored course and receiving directory.');
 need(Array.isArray(attachmentPaths)&&attachmentPaths.length>0&&attachmentPaths.every(path.isAbsolute),'Select every exact outgoing attachment by its absolute original path.');
 need(attachmentPaths.includes(applicationPath),'The exact application must be included in the outgoing attachment selection.');
 const manifestPath=path.join(root,'selected-inputs','inputs.json'),mirrorPath=path.join(root,'attempts','selected-inputs','inputs.json');let prior=await optional(manifestPath)||await optional(mirrorPath);
 if(!prior){const completed=await optional(path.join(root,'audit-receiving-result.json'));if(completed){const row=JSON.parse(completed).receiving?.files?.find(r=>r.path===path.join('attempts','selected-inputs','inputs.json'));need(row,'Retain the completed original selected-input manifest identity.');const body=await regular(path.join(root,'retained-bytes',row.sha256));need(body.length===row.bytes&&sha(body)===row.sha256,'The original manifest recovery bytes changed.');prior=body;}}
 if(prior)await immutable(manifestPath,prior);else need(!(await optional(path.join(root,'receiving-intent.json'))),'Recover the original selected-input manifest before resuming this existing programme.');
 const paths=[{role:'application',path:applicationPath},{role:'authored-course',path:fixturePath},...attachmentPaths.map((file,index)=>({role:'outgoing-'+index,path:file}))];
 let manifest;if(prior){manifest=JSON.parse(prior);need(same(manifest.inputs.map(({role,path})=>({role,path})),paths),'Continue the exact original outgoing selection and authored course.');}
 else{
  manifest={schema:'commons.audit-browser-inputs.v1',inputs:[]};
  for(const row of paths){const body=await regular(row.path),identity={...row,bytes:body.length,sha256:sha(body)},retainedPath=path.join(root,'selected-inputs','bytes',identity.sha256);await immutable(retainedPath,body);manifest.inputs.push({...identity,retainedPath});}
  await immutable(manifestPath,json(manifest));
 }
 for(const row of manifest.inputs){const current=await optional(row.path),body=await optional(row.retainedPath)||await optional(path.join(root,'retained-bytes',row.sha256))||current;need(body&&body.length===row.bytes&&sha(body)===row.sha256,'The retained original input changed or is unavailable: '+row.role);if(current)need(current.equals(body),'The original selected input changed: '+row.path);await immutable(row.retainedPath,body);await immutable(path.join(root,'retained-bytes',row.sha256),body);await immutable(path.join(root,'attempts','selected-inputs',row.sha256),body);}
 await immutable(mirrorPath,json(manifest));return manifest;
}
async function checkOriginals(manifest){for(const row of manifest.inputs){const body=await regular(row.retainedPath);need(body.length===row.bytes&&sha(body)===row.sha256,'The retained input changed during receiving.');const current=await optional(row.path);if(current)need(current.equals(body),'The current original input changed during receiving: '+row.path);}}
function translate(value,ids){
 if(Array.isArray(value))return value.map(v=>translate(v,ids));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,translate(v,ids)]));
 if(typeof value!=='string')return value;
 if(ids.has(value))return ids.get(value);
 for(const [before,after]of ids)if(value.startsWith(before+':r'))return after+value.slice(before.length);
 return value;
}
function identityMap(fixture,current){
 const map=new Map();for(let i=0;i<Math.min(fixture.operations.length,current.operations.length);i++){
  const a=fixture.operations[i],b=current.operations[i];need(a.kind===b.kind,'The original authored operation order differs.');
  for(const key of ['fileId','sourceId','mappingId','selectionId','reviewId','contractId','preparationId','returnId'])if(typeof a.result[key]==='string'){need(typeof b.result[key]==='string','The original browser result omitted '+key);map.set(a.result[key],b.result[key]);}
 }return map;
}
function stripped(input){const out={...input};for(const key of ['operationId','expectedRevision','at','actor','base64','text'])delete out[key];return out;}
async function actor(page,value){await ready(page);await page.locator('#current-operator').fill(value);await page.locator('#current-operator').blur();}
async function scope(page,control,id){await page.locator('#'+control).selectOption(id);await ready(page);}
async function performOperation(page,operation,input,fixture){
 const who=operation.actor||input.actor||'Original authored receiving operator';
 if(operation.kind==='import-file'||operation.kind==='import-csv'){
  await section(page,'files');await actor(page,who);const isFile=operation.kind==='import-file',form=page.locator('#'+(isFile?'import-file':'import-csv'));
  const original=fixture.files.find(f=>f.id===operation.contentRef?.fileId);need(original,'Retain the complete original input for '+operation.id);
  if(isFile){await values(form,{'file-id':input.fileId||'','file-purpose':input.purpose,'file-url':input.sourceUrl||'','file-representation':input.representation||'original'});await field(form,'original-file').setInputFiles({name:input.filename,mimeType:input.mimeType,buffer:Buffer.from(original.base64,'base64')});}
  else{await values(form,{'csv-file-id':input.fileId||'','csv-purpose':input.purpose||'','csv-url':input.sourceUrl||'','csv-representation':input.representation||'original','csv-side':input.side,'csv-role':input.role});await field(form,'csv-file').setInputFiles({name:input.filename,mimeType:'text/csv',buffer:Buffer.from(original.base64,'base64')});}
  await submit(form);return;
 }
 if(operation.kind==='save-mapping'){
  await section(page,'mapping');await page.locator('#mapping-source').selectOption(input.sourceId);await ready(page);await actor(page,who);const form=page.locator('#mapping-form');
  await values(form,{'mapping-namespace':input.namespace,'mapping-extra':JSON.stringify(input.fields),'mapping-references':JSON.stringify(input.references||[]),'mapping-note':input.note});await checks(form,'mapping-key',input.keyColumns);
  // The advanced complete field object preserves constants and actual duplicate-heading occurrences.
  for(const name of await form.locator('select[name^="field:"]').evaluateAll(list=>list.map(el=>el.name)))await fill(form,name,'');
  await submit(form);return;
 }
 if(operation.kind==='save-selection'){
  await section(page,'scope');await actor(page,who);const form=page.locator('#scope-form');await checks(form,'scope-mapping',input.mappingIds);await checks(form,'scope-file',input.fileIds||[]);
  for(const [role,declaration]of Object.entries(input.roles))await values(form,{['role:'+role]:declaration.status,['reason:'+role]:declaration.reason});
  for(const name of ['permission','history','evidence']){const basis=input[name+'Basis'];await values(form,{[name+'-status']:basis.status,[name+'-note']:basis.note});await checks(form,name+'-file',basis.sourceFileIds);}
  if(input.evidenceBasis.externalReferences?.length)await fill(form,'evidence-external',JSON.stringify(input.evidenceBasis.externalReferences));
  await values(form,{'scope-acyclic':JSON.stringify(input.declaredAcyclicRelations||[]),'scope-note':input.note});await submit(form);return;
 }
 if(operation.kind==='save-correction'){
  await section(page,'records');await page.locator('#records-source').selectOption(input.sourceId);await ready(page);
  while(!(await page.locator('[data-record="'+esc(input.rowId)+'"]').count())){need(await page.locator('#records-next').isEnabled(),'The original row is absent from complete source pages.');await page.locator('#records-next').click();await ready(page);}
  await page.locator('[data-record="'+esc(input.rowId)+'"]').click();await ready(page);await actor(page,who);const form=page.locator('#correction-form');await values(form,{'correction-column':input.column,'correction-value':input.value,'correction-reason':input.reason});await submit(form);return;
 }
 if(operation.kind==='save-review'){
  await section(page,'review');await scope(page,'review-scope',input.selectionId);await actor(page,who);const form=page.locator('#review-form');await values(form,{'review-decision':input.decision,'review-note':input.note});await submit(form);return;
 }
 if(operation.kind==='save-contract'){
  await section(page,'contract');await scope(page,'contract-scope',input.selectionId);await actor(page,who);const form=page.locator('#contract-form');
  await values(form,{'contract-title':input.title,'contract-authority':input.authority,'contract-tables':JSON.stringify(input.tables),'contract-crosswalks':JSON.stringify(input.crosswalks||[]),'contract-note':input.note});await checks(form,'contract-original',input.sourceFileIds);await submit(form);return;
 }
 if(operation.kind==='prepare-target'){
  await section(page,'returns');await actor(page,who);const form=page.locator('#prepare-form');await values(form,{'prepare-contract':input.contractId,'prepare-review':input.reviewId,'prepare-note':input.note});await submit(form);return;
 }
 if(operation.kind==='record-return'){
  await section(page,'returns');await page.locator('#return-preparation').selectOption(input.preparationId);await ready(page);await actor(page,who);const form=page.locator('#return-form');
  await values(form,{'return-tables':JSON.stringify(input.tables),'return-reference':input.submissionReference||'','return-note':input.note});await submit(form);return;
 }
 throw Error('The full authored course contains an unsupported operation: '+operation.kind);
}
async function download(page,control,file){const pending=page.waitForEvent('download');await control.click();const d=await pending;await d.saveAs(file);const body=await regular(file);return{path:file,name:d.suggestedFilename(),bytes:body.length,sha256:sha(body)};}
async function capture(page,directory,name,screens){for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(directory,name+'-'+width+'.png'),fullPage:false});screens.push(path.join(directory,name+'-'+width+'.png'));}}
async function documentViews(page,directory,name,screens){
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const height=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0,index=0;y<height;y+=850,index++){await page.evaluate(y=>window.scrollTo(0,y),y);const file=path.join(directory,name+'-'+width+'-'+index+'.png');await page.screenshot({path:file,fullPage:false});screens.push(file);}await page.evaluate(()=>scrollTo(0,0));}
 await page.emulateMedia({media:'print'});await page.setViewportSize({width:1440,height:1000});const printHeight=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0,index=0;y<printHeight;y+=850,index++){await page.evaluate(y=>window.scrollTo(0,y),y);const file=path.join(directory,name+'-print-'+index+'.png');await page.screenshot({path:file,fullPage:false});screens.push(file);}await page.evaluate(()=>scrollTo(0,0));await page.emulateMedia({media:'screen'});
}
function zipMembers(bytes){
 const result=new Map();let p=0;
 while(p+30<=bytes.length&&bytes.readUInt32LE(p)===0x04034b50){need(bytes.readUInt16LE(p+8)===0,'The application ZIP must retain original stored members.');const size=bytes.readUInt32LE(p+18),n=bytes.readUInt16LE(p+26),extra=bytes.readUInt16LE(p+28),start=p+30+n+extra,name=bytes.subarray(p+30,p+30+n).toString('utf8');need(start+size<=bytes.length&&!result.has(name),'The complete ZIP member is truncated or repeated.');result.set(name,bytes.subarray(start,start+size));p=start+size;}
 need(result.size&&p+4<=bytes.length&&bytes.readUInt32LE(p)===0x02014b50,'Retain the complete ZIP directory.');return result;
}
async function openRecord(page,applicationPath,inputPath,expected){
 await page.goto(pathToFileURL(applicationPath).href);await ready(page);await section(page,'workspace');await page.locator('#open-file').setInputFiles(inputPath);await submit(page.locator('#open-work'));await ready(page);
 if(await page.locator('#receive-independent').count()){await page.locator('#receive-independent').click();await ready(page);}
 await page.waitForFunction(({id,revision})=>document.querySelector('#workspace-heading')?.textContent.includes(id)&&document.querySelector('#workspace-revision')?.textContent.startsWith('Revision '+revision+' ·'),{id:expected.id,revision:expected.revision});
}
async function openExactAttachments({context,selected,application,source,attempt,outputs,screens,errors,renderBinaryAttachment}){
 const browser=context.browser();need(browser,'Use the existing equipped browser context.');const fresh=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),view=await fresh.newPage();view.on('pageerror',e=>errors.push(e.message));
 const directory=path.join(attempt,'outgoing');await fs.mkdir(directory,{recursive:true});const reviewed=[],renderedApp=path.join(directory,'Selected_Original_Application.html');await immutable(renderedApp,await regular(application));
 try{
  for(const [index,row]of selected.entries()){
   const body=await regular(row.retainedPath),ext=path.extname(row.path).toLowerCase(),file=path.join(directory,'attachment-'+index+ext);await immutable(file,body);outputs.push({path:file,bytes:body.length,sha256:sha(body)});
   if(['.html','.htm'].includes(ext)){
    await view.goto(pathToFileURL(file).href);
    if(body.includes(Buffer.from('id="audit-boot"'))){await ready(view);await capture(view,directory,'outgoing-app-'+index,screens);}
    else{await view.locator('body').waitFor();await documentViews(view,directory,'outgoing-html-'+index,screens);}
   }else if(ext==='.json'){
    let record=null;try{record=Portable.parseRecovery(body.toString('utf8'));}catch{}
    if(record){
     await openRecord(view,renderedApp,file,record.workspace);
     for(const name of ['workspace','files','mapping','scope','records','review','contract','returns','history']){await section(view,name);await capture(view,directory,'outgoing-record-'+index+'-'+name,screens);}
     await section(view,'workspace');const delivered=await download(view,view.locator('#top-json'),path.join(directory,'reopened-'+index+'.json'));outputs.push(delivered);const actual=Portable.parseRecovery((await regular(delivered.path)).toString('utf8'));
     need(same(actual.workspace,record.workspace)&&Object.entries(record.drafts).filter(([key])=>key!=='$selection').every(([key,value])=>same(actual.drafts[key],value)),'The actual outgoing working file did not reopen every original operation and unfinished value.');
     const complete=await download(view,view.locator('#top-zip'),path.join(directory,'actual-outgoing-complete-'+index+'.zip'));outputs.push(complete);const members=zipMembers(await regular(complete.path)),expected=Portable.completeFiles(source,actual);need(members.size===expected.length,'The actual outgoing reference ZIP selects a different complete file set.');for(const f of expected)need(members.get(f.path)?.equals(Buffer.from(Portable.memberBytes(f))),'The actual outgoing reference ZIP member differs: '+f.path);
     for(const original of actual.workspace.files.filter(f=>/\.pdf$/i.test(f.filename))){need(typeof renderBinaryAttachment==='function','The actual outgoing reference retains an original PDF; return every rendered applicable page.');const pdf=path.join(directory,'reference-original-'+original.sha256+'.pdf');await immutable(pdf,Buffer.from(original.base64,'base64'));const result=await renderBinaryAttachment({page:view,file:pdf,outputDirectory:directory,prefix:'reference-'+original.sha256.slice(0,12),widths:[1440,390]});need(result?.screens?.length,'Retain the actual original PDF page pixels.');screens.push(...result.screens);outputs.push(...(result.outputs||[]));}
    }else{
     const text=body.toString('utf8');need(Buffer.from(text).equals(body),'Retain the complete original UTF-8 JSON.');
     for(let offset=0,part=0;offset<text.length;offset+=10000,part++){await view.setContent('<!doctype html><meta charset="utf-8"><style>pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 monospace}</style><pre></pre>');await view.locator('pre').evaluate((el,text)=>{el.textContent=text;},text.slice(offset,offset+10000));await documentViews(view,directory,'outgoing-json-'+index+'-'+part,screens);}
    }
   }else{
    need(typeof renderBinaryAttachment==='function','The actual outgoing '+ext+' attachment needs its equipped original renderer and every applicable page/image returned.');
    const result=await renderBinaryAttachment({page:view,file,outputDirectory:directory,prefix:'outgoing-binary-'+index,widths:[1440,390]});need(Array.isArray(result?.screens)&&result.screens.length,'Retain actual rendered attachment pixels.');screens.push(...result.screens);outputs.push(...(result.outputs||[]));
   }
   reviewed.push({originalPath:row.path,retainedPath:file,bytes:body.length,sha256:sha(body)});
  }
  return reviewed;
 }finally{await fresh.close();}
}
export async function runAuditReceiving({page,context,outputDirectory,applicationPath,fixturePath,attachmentPaths,renderBinaryAttachment}){
 await page.setViewportSize({width:1440,height:1000});
 const selected=await originalInputs(outputDirectory,applicationPath,fixturePath,attachmentPaths),appRow=selected.inputs.find(r=>r.role==='application'),fixtureRow=selected.inputs.find(r=>r.role==='authored-course');
 const application=(await regular(appRow.retainedPath)).toString('utf8'),fixture=Engine.importWorkspace((await regular(fixtureRow.retainedPath)).toString('utf8')),source=bootOf(application).data.source;
 need(same(source,await loadSource()),'The exact outgoing application and executing complete maintained source differ.');
 need(same(fixture,buildReceivingFixture().workspace),'Select the exact maintained explicitly authored receiving fixture.');
 need(fixture.sources.length&&fixture.preparations.length&&fixture.returns.length,'Use the complete explicitly authored source-to-return course, separate from a partial public reference.');
 const session=await openMigrationReceiving({page,outputDirectory,applicationPath:appRow.retainedPath,engine:facade,title:'Audit Source Workspace complete authored receiving',resultFilename:'audit-receiving-result.json',workspaceModel:model,browserControls:{ready:'#audit-app[aria-busy="false"]',workspaceDownload:'#top-json',seedHTML,beforeCheckpoint}});
 if(session.completed){await checkOriginals(selected);return session.completed;}
 const outputs=[{path:path.join(outputDirectory,'attempts','selected-inputs','inputs.json'),bytes:json(selected).length,sha256:sha(json(selected))},...selected.inputs.map(row=>({path:path.join(outputDirectory,'attempts','selected-inputs',row.sha256),bytes:row.bytes,sha256:row.sha256}))],screens=[],errors=[],listen=error=>errors.push(error.message);page.on('pageerror',listen);
 try{
  const outgoing=await session.phase('exact-outgoing-attachments',()=>openExactAttachments({context,selected:selected.inputs.filter(r=>r.role.startsWith('outgoing-')),application:appRow.retainedPath,source,attempt:session.attempt,outputs,screens,errors,renderBinaryAttachment}),{outputs,screens});
  const imported=await session.phase('whole-authored-original-course',async()=>{
   let record=await session.checkpoint();
   for(let i=0;i<fixture.operations.length;i++){
    const operation=fixture.operations[i],map=identityMap(fixture,record.workspace),input=translate(operation.input,map),expected={kind:operation.kind,input:stripped(input)};
    record=await session.mutation('original-authored-'+(i+1),i+1,expected,()=>performOperation(page,operation,input,fixture));
   }
   const map=identityMap(fixture,record.workspace);
   for(const original of fixture.files){const received=record.workspace.files.find(f=>f.id===(map.get(original.id)||original.id));need(received&&received.base64===original.base64&&received.sha256===original.sha256&&received.filename===original.filename,'A complete original file differs after actual UI import.');}
   const expected=fixture.returns.at(-1).comparison,actual=record.workspace.returns.at(-1).comparison;need(same(actual.summary,expected.summary),'The actual browser target receiving counts differ from the complete authored course.');
   return{workspaceId:record.workspace.id,revision:record.workspace.revision,files:record.workspace.files.length,sources:record.workspace.sources.length,returnSummary:actual.summary};
  },{outputs,screens});
  await session.phase('meaningful-current-controls',async()=>{
   for(const name of ['files','mapping','scope','records','review','contract','returns','history']){await section(page,name);await capture(page,session.attempt,'current-'+name,screens);}
   await section(page,'returns');const controls=await page.locator('[data-prepared-table]').count();for(let i=0;i<controls;i++){const control=page.locator('[data-prepared-table]').nth(i),details=control.locator('xpath=ancestor::details[1]');if(await details.getAttribute('open')===null)await details.locator('summary').first().click();outputs.push(await download(page,control,path.join(session.attempt,'prepared-table-'+i+'.csv')));}
   return{sections:8,preparedFiles:controls,layouts:[1440,390]};
  },{outputs,screens});

  const corrected=await session.phase('attributed-correction-and-successor-return',async()=>{
   let record=await session.checkpoint(),map=identityMap(fixture,record.workspace);
   const originalSource=fixture.sources[0],originalRows=Engine.sourceRows(fixture,originalSource.id),row=originalRows.rows[0],sourceId=map.get(originalSource.id)||originalSource.id;
   need(originalRows.headers.length>1&&row.cells.length>1,'The authored full course retains an actual editable original text column.');
   const correction={sourceId,rowId:translate(row.id,map),column:1,expectedValue:row.cells[1],value:row.cells[1]+' — attributed receiving correction',reason:'Explicit authored source correction; preserve the frozen original preparation and returned files.'};
   record=await session.mutation('source-successor-correction',fixture.revision+1,{kind:'save-correction',input:correction},()=>performOperation(page,{kind:'save-correction',actor:'Receiving operator'},correction,fixture));
   const originalScope=fixture.operations.find(o=>o.kind==='save-selection'),scopeInput=translate(stripped(originalScope.input),map);
   record=await session.mutation('source-successor-scope',fixture.revision+2,{kind:'save-selection',input:scopeInput},()=>performOperation(page,{kind:'save-selection',actor:'Receiving operator'},scopeInput,fixture));
   const selectionId=record.workspace.operations[fixture.revision+1].result.selectionId,reviewInput={selectionId,decision:'accepted',note:'Accept the exact authored successor source after inspecting the attributed correction.'};
   record=await session.mutation('source-successor-review',fixture.revision+3,{kind:'save-review',input:reviewInput},()=>performOperation(page,{kind:'save-review',actor:'Receiving operator'},reviewInput,fixture));
   const originalContract=fixture.operations.find(o=>o.kind==='save-contract'),contractInput={...translate(stripped(originalContract.input),map),selectionId,title:'Authored successor target contract'};
   record=await session.mutation('source-successor-contract',fixture.revision+4,{kind:'save-contract',input:contractInput},()=>performOperation(page,{kind:'save-contract',actor:'Receiving operator'},contractInput,fixture));
   const prepareInput={contractId:record.workspace.operations[fixture.revision+3].result.contractId,reviewId:record.workspace.operations[fixture.revision+2].result.reviewId,note:'Freeze the corrected authored successor without replacing the original prepared files.'};
   record=await session.mutation('source-successor-preparation',fixture.revision+5,{kind:'prepare-target',input:prepareInput},()=>performOperation(page,{kind:'prepare-target',actor:'Receiving operator'},prepareInput,fixture));
   const originalReturn=fixture.operations.find(o=>o.kind==='record-return'),returnInput={...translate(stripped(originalReturn.input),map),preparationId:record.workspace.operations[fixture.revision+4].result.preparationId,note:'The retained earlier actual return is compared against the explicit corrected preparation; its original differing value remains visible.'};
   record=await session.mutation('source-successor-return',fixture.revision+6,{kind:'record-return',input:returnInput},()=>performOperation(page,{kind:'record-return',actor:'Receiving operator'},returnInput,fixture));
   const first=record.workspace.preparations[0],last=record.workspace.returns.at(-1);
   need(first.assessment.tables.every((t,i)=>t.text===fixture.preparations[0].assessment.tables[i].text),'A later correction changed the original frozen CSV bytes.');
   need(last.comparison.summary.changed===1&&last.comparison.summary.matched===fixture.returns.at(-1).comparison.summary.matched-1,'The successor comparison must retain the one actual changed source value.');
   await section(page,'returns');await capture(page,session.attempt,'successor-actual-return-difference',screens);
   const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Actual returned table universe'})}).last();if(await details.count()){if(await details.getAttribute('open')===null)await details.locator('summary').first().click();await details.scrollIntoViewIfNeeded();await capture(page,session.attempt,'successor-changed-cell',screens);}
   return{revision:record.workspace.revision,selectionId,preparationId:last.preparationId,returnId:last.id,summary:last.comparison.summary};
  },{outputs,screens});


  await session.phase('complete-readable-preparation-and-returns',async()=>{
   await section(page,'returns');const reports=[await download(page,page.locator('#prepared-report'),path.join(session.attempt,'Complete_Prepared_Report.html'))];
   const count=await page.locator('[data-return-report]').count();for(let i=0;i<count;i++)reports.push(await download(page,page.locator('[data-return-report]').nth(i),path.join(session.attempt,'Complete_Return_Report_'+i+'.html')));
   outputs.push(...reports);const fresh=await context.browser().newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),view=await fresh.newPage();view.on('pageerror',listen);
   try{for(let i=0;i<reports.length;i++){await view.goto(pathToFileURL(reports[i].path).href);await view.locator('body').waitFor();await documentViews(view,session.attempt,'actual-prepared-return-report-'+i,screens);}}finally{await fresh.close();}
   return{reports};
  },{outputs,screens});

  const exit=await session.phase('complete-exit-and-independent-reopen',async()=>{
   await section(page,'contract');await page.locator('#contract-note').fill('Unfinished supplier clarification — source remains exact; no implicit authorization.');await section(page,'workspace');
   const recovery=await download(page,page.locator('#top-json'),path.join(session.attempt,'Working_Recovery.json')),html=await download(page,page.locator('#top-html'),path.join(session.attempt,'Audit_Source_Workspace.html')),zip=await download(page,page.locator('#top-zip'),path.join(session.attempt,'Audit_Complete_Workspace.zip'));outputs.push(recovery,html,zip);
   const record=Portable.parseRecovery((await regular(recovery.path)).toString('utf8')),members=zipMembers(await regular(zip.path)),expected=Portable.completeFiles(source,record);
   need(members.size===expected.length,'The complete ZIP omitted or added an original selected member.');for(const file of expected)need(members.get(file.path)?.equals(Buffer.from(Portable.memberBytes(file))),'The complete ZIP member changed: '+file.path);
   const fresh=await context.browser().newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),view=await fresh.newPage();view.on('pageerror',listen);
   try{
    await view.goto(pathToFileURL(html.path).href);await ready(view);await section(view,'contract');need((await view.locator('#contract-note').inputValue()).includes('Unfinished supplier clarification'),'The complete working HTML lost its unfinished form.');
    await capture(view,session.attempt,'independent-unfinished-reopen',screens);await section(view,'workspace');
    const again=await download(view,view.locator('#top-json'),path.join(session.attempt,'Independent_Reopened_Recovery.json'));outputs.push(again);const reopened=Portable.parseRecovery((await regular(again.path)).toString('utf8'));need(same(reopened.workspace,record.workspace)&&Object.entries(record.drafts).filter(([key])=>key!=='$selection').every(([key,value])=>same(reopened.drafts[key],value))&&reopened.copyId===record.copyId,'Independent reopen lost complete history or unfinished values.');
    // Open every generated complete HTML report from the same downloaded archive, plus its print view.
    let index=0;for(const [name,body]of members)if(name.endsWith('.html')&&!name.endsWith('Audit_Source_Workspace.html')){const file=path.join(session.attempt,'report-'+index+'.html');await immutable(file,body);outputs.push({path:file,bytes:body.length,sha256:sha(body)});await view.goto(pathToFileURL(file).href);await view.locator('body').waitFor();await documentViews(view,session.attempt,'full-report-'+index,screens);index++;}
    for(const original of record.workspace.files.filter(f=>/\.pdf$/i.test(f.filename))){need(typeof renderBinaryAttachment==='function','The complete original PDF in the outgoing workspace needs every applicable page rendered.');const file=path.join(session.attempt,'original-'+original.sha256+'.pdf');await immutable(file,Buffer.from(original.base64,'base64'));const result=await renderBinaryAttachment({page:view,file,outputDirectory:session.attempt,prefix:'original-'+original.sha256.slice(0,12),widths:[1440,390]});need(result?.screens?.length,'Retain actual original PDF page pixels.');screens.push(...result.screens);outputs.push(...(result.outputs||[]));}
   }finally{await fresh.close();}
   return{recovery,html,zip,members:members.size,revision:record.workspace.revision};
  },{outputs,screens});
  const competing=await session.phase('two-tabs-original-revision-conflict',async()=>{
   const base=Portable.parseRecovery((await regular(exit.recovery.path)).toString('utf8')),copyId=session.intent.copyId+'-competing',record={...base,copyId},file=path.join(session.attempt,'Competing_Original.html');
   await immutable(file,Buffer.from(Portable.workingHTML(source,record)));
   const fresh=await context.browser().newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),one=await fresh.newPage(),two=await fresh.newPage();one.on('pageerror',listen);two.on('pageerror',listen);
   try{
    await one.goto(pathToFileURL(file).href);await ready(one);await two.goto(pathToFileURL(file).href);await ready(two);
    for(const [p,title]of [[one,'First attributed later review'],[two,'Second independent proposed review']]){await section(p,'review');await actor(p,'Concurrent receiving operator');await fill(p.locator('#review-form'),'review-decision','needs-work');await fill(p.locator('#review-form'),'review-note',title);}
    await submit(one.locator('#review-form'));await one.waitForFunction(n=>document.querySelector('#workspace-revision')?.textContent.startsWith('Revision '+n+' ·'),base.workspace.revision+1);await ready(one);
    await submit(two.locator('#review-form'));await two.locator('#open-conflict').waitFor();await ready(two);await capture(two,session.attempt,'competing-branch-preserved',screens);
    await two.locator('#open-conflict').click();await ready(two);await section(two,'workspace');const branch=await download(two,two.locator('#top-json'),path.join(session.attempt,'Competing_Proposed_Branch.json'));outputs.push(branch);
    await section(one,'workspace');const current=await download(one,one.locator('#top-json'),path.join(session.attempt,'Competing_Current_Original.json'));outputs.push(current);
    const a=Portable.parseRecovery((await regular(current.path)).toString('utf8')),b=Portable.parseRecovery((await regular(branch.path)).toString('utf8'));
    need(a.workspace.revision===base.workspace.revision+1&&b.workspace.revision===base.workspace.revision+1&&Portable.compare(a.workspace,b.workspace)==='diverged','Both complete original competing branches must survive.');
    return{current,branch,relationship:'diverged'};
   }finally{await fresh.close();}
  },{outputs,screens});
  need(errors.length===0,'Actual browser page errors: '+errors.join('; '));await checkOriginals(selected);
  return await session.finish({schema:'commons.audit-migration-rendered-receiving.v1',state:'CONTROLS_AND_EXPORTS_COMPLETED',originalInputs:selected,imported,corrected,outgoing,exit,competing,outputs,screens,pageErrors:errors,producerInspection:'Producing worker must personally LOOK at these exact returned pixels and all applicable attachment pages before marking the selected outgoing product ready.'});
 }finally{page.off('pageerror',listen);await session.close();}
}
