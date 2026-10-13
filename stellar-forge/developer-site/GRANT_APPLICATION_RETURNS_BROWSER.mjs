// MIT. Complete author/colleague course in the existing retained browser operation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const OPERATION='SCF-APPLICATION-RETURN-RECONCILIATION-D76C-20261013';
const need=(value,message)=>{if(!value)throw new Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value)+'\n';
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
async function readJSON(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function exact(file,body){
 const bytes=Buffer.from(body);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 try{const stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink()&&(await fs.readFile(file)).equals(bytes),'Preserve different original receiving bytes: '+file);return;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=file+'.'+randomUUID()+'.pending';let handle;
 try{
  handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;need((await fs.readFile(file)).equals(bytes),'Another original receiver retained different bytes.');}
  const parent=await fs.open(path.dirname(file),'r');try{await parent.sync();}finally{await parent.close();}
 }finally{if(handle)await handle.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
/**
 * The caller retains the original Page/profile/controller lock. This function
 * records no external submission. The native author exercise uses the ordinary
 * separate-copy control once; every later native mutation retains its complete
 * candidate first and reconciles the same saved record after an interruption.
 */
export async function receiveApplicationReturns({page,baseUrl,draftId,directory}){
 need(page&&typeof page.goto==='function'&&typeof draftId==='string'&&draftId,'Supply the existing Page and original saved application.');
 directory=path.resolve(directory);await fs.mkdir(directory,{recursive:true,mode:0o700});
 need(!(await fs.lstat(directory)).isSymbolicLink(),'Keep the original ordinary receiving directory.');
 const app=new URL('grant-submission.html',baseUrl);app.searchParams.set('draft',draftId);
 const binding={operation:OPERATION,application:app.href,draftId};
 await exact(path.join(directory,'binding.json'),json(binding));
 const stages=new Map();
 const verified=async item=>{
  need(item&&typeof item.name==='string'&&!path.isAbsolute(item.name)&&!item.name.includes('\\')&&item.name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Retain an ordinary complete output member.');
  const target=path.join(directory,item.name),stat=await fs.lstat(target),bytes=await fs.readFile(target);
  need(stat.isFile()&&!stat.isSymbolicLink()&&bytes.length===item.bytes&&hash(bytes)===item.sha256,'Preserve the complete original file: '+item.name);
  return bytes;
 };
 const stage=async(name,value)=>{
  const target=path.join(directory,'stages',name+'.json');
  if(value!==undefined)await exact(target,json({schema:'stellar-forge.application-return-receiving-stage.v1',binding,value}));
  const stored=await readJSON(target);if(!stored)return null;
  need(stored.schema==='stellar-forge.application-return-receiving-stage.v1'&&same(stored.binding,binding),'Keep the original application-return selection.');
  for(const item of stored.value.files||[])await verified(item);
  stages.set(name,stored.value);return stored.value;
 };
 const completed=await readJSON(path.join(directory,'application-return-result.json'));
 if(completed){
  need(completed.state==='OPERATED_AWAITING_PIXEL_INSPECTION'&&same(completed.binding,binding),'Keep the original complete browser outcome.');
  for(const item of completed.files)await verified(item);
  for(const item of completed.stages){
   const bytes=await verified(item),value=JSON.parse(bytes);
   need(same(value.binding,binding),'Keep the original stage selection.');
   for(const file of value.value.files||[])await verified(file);
  }
  return completed;
 }
 const attempt='attempts/'+randomUUID();await fs.mkdir(path.join(directory,attempt),{recursive:true,mode:0o700});
 const record=async(name,body,mediaType='application/json')=>{
  const member=attempt+'/'+name;await exact(path.join(directory,member),body);
  const item={name:member,path:path.join(directory,member),bytes:Buffer.byteLength(body),sha256:hash(body),mediaType};await verified(item);return item;
 };
 const download=async(p,button,name,mediaType='application/json')=>{
  const waiting=p.waitForEvent('download');await button.click();const item=await waiting;
  const temp=path.join(directory,attempt,randomUUID()+'.download');await item.saveAs(temp);
  const result=await record(name,await fs.readFile(temp),mediaType);await fs.unlink(temp);return result;
 };
 const settled=p=>p.waitForFunction(()=>document.getElementById('working-status')?.textContent.includes('Complete working copy saved')&&!document.getElementById('workspace-root').inert);
 const ready=p=>p.waitForFunction(()=>document.getElementById('workspace-root')?.dataset.draftId&&!document.getElementById('workspace-root').inert);
 const snapshot=p=>p.evaluate(async()=>{
  const root=document.getElementById('workspace-root');
  return (await(await import('./grant-submission-working-copy.mjs')).loadSubmissionWorkingCopy(root.dataset.workingId)).input;
 });
 const native=id=>page.evaluate(async value=>(await import('./drafts.mjs')).loadDraft(value),id);
 const currentNative=()=>page.evaluate(async()=>(await import('./drafts.mjs')).loadDraft(document.getElementById('workspace-root').dataset.savedDraftId));
 const loadNative=async id=>{const url=new URL(app);url.searchParams.set('draft',id);await page.goto(url.href);await settled(page);need((await currentNative())?.id===id,'Open the selected original browser record.');};
 const contentKeys=['draft','incoming','incomingLabel','limits','workbook','applicationReturn','native'];
 const openCheckpoint=async working=>{
  const saved=await page.evaluate(async value=>{
   const m=await import('./grant-submission-working-copy.mjs');await m.verifySubmissionWorkingCopy(value);
   const next=await m.forkSubmissionWorkingCopy(value,{localNative:true});return m.saveSubmissionWorkingCopy(next,{revision:0});
  },working);
  const url=new URL(app);url.searchParams.set('working',saved.id);await page.goto(url.href);await settled(page);
  const opened=await snapshot(page);for(const key of contentKeys)need(same(opened[key],working[key]),'Checkpoint receiving changed complete '+key+'.');
  return opened;
 };
 const screen=async(p,name,width)=>{
  await p.setViewportSize({width,height:980});
  const size=await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
  need(size.scrollWidth<=size.clientWidth+1,'The actual returned-application view overflows at '+width+'px.');
  return {...await record(name,await p.screenshot({fullPage:true}),'image/png'),width,height:980,viewed:false};
 };
 await loadNative(draftId);
 const runtime=await page.evaluate(async()=>{
  const names=['grant-application-return.mjs','grant-application-return-workspace.mjs','grant-application-return-working.mjs','grant-submission-working-copy.mjs','grant-submission-workspace.mjs','grant-submission-core.mjs','drafts.mjs'];
  const result=[];
  for(const name of names){const response=await fetch(new URL(name,location.href));if(!response.ok)throw new Error('Receive the complete selected runtime: '+name);
   const bytes=new Uint8Array(await response.arrayBuffer()),digest=await crypto.subtle.digest('SHA-256',bytes);
   result.push({name,bytes:bytes.length,sha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')});}
  return result;
 });
 let initial=await stage('01-original');
 if(!initial){const original=await native(draftId),working=await snapshot(page);
  need(original?.id===draftId&&same(working.draft,original.input)&&working.native.id===draftId,'Select the actual original saved application.');
  initial=await stage('01-original',{original,working,runtime,token:randomUUID(),files:[await record('original-native-record.json',json(original))]});
 }
 need(same(initial.runtime,runtime),'Resume with this course’s complete original runtime edition.');
 need(same(await native(draftId),initial.original),'The original saved application advanced; preserve its new source boundary.');
 const title='Internal returned-application exercise '+initial.token;
 let copyIntent=await stage('02-copy-intent'),authorStage=await stage('03-author-copy');
 const verifyCopy=async candidate=>{
  need(candidate&&candidate.revision===1&&candidate.id!==draftId&&candidate.input.id!==initial.original.input.id,'Keep the first separate author draft.');
  const last=candidate.input.versions.at(-1);need(last?.label==='Separate working copy'&&last.savedAt,'Retain the original separate-copy save.');
  const expected=await page.evaluate(async({draft,record,at})=>{
   const value=(await import('./grant-submission-core.mjs')).retainVersion(draft,'Separate working copy',at);
   value.id=record.input.id;value.title=draft.title+' copy';value.folder='SCF submission — '+value.title;value.updatedAt=record.input.updatedAt;return value;
  },{draft:copyIntent.working.draft,record:candidate,at:last.savedAt});
  need(same(expected,candidate.input),'The saved author copy differs from the retained separate-copy candidate.');return candidate;
 };
 if(!authorStage){
  if(!copyIntent){
   await openCheckpoint(initial.working);await page.locator('#draft-title').fill(title);await settled(page);
   copyIntent=await stage('02-copy-intent',{working:await snapshot(page),title:title+' copy'});
  }
  const matches=await page.evaluate(async value=>{
   const m=await import('./drafts.mjs'),rows=await m.listDrafts(),result=[];
   for(const row of rows)if(row.name==='SCF submission — '+value)result.push(await m.loadDraft(row.id));return result;
  },copyIntent.title);
  need(matches.length<=1,'Reconcile multiple existing copies with the original exercise label.');
  let author=matches[0];
  if(!author){
   await openCheckpoint(copyIntent.working);await page.locator('#save-copy').click();await settled(page);author=await currentNative();
  }
  await verifyCopy(author);await loadNative(author.id);
  authorStage=await stage('03-author-copy',{record:author,working:await snapshot(page),files:[await record('separate-author-record.json',json(author))]});
 }
 const authorId=authorStage.record.id;
 let issueIntent=await stage('04-issue-intent'),issued=await stage('05-issued');
 if(!issued){
  if(!issueIntent){
   need(same(await native(authorId),authorStage.record),'The separate author copy changed before issue preparation.');
   await openCheckpoint(authorStage.working);await page.locator('#view').selectOption('returns');
   await page.getByLabel('Copy label',{exact:true}).fill('Author/colleague receiving '+initial.token);
   await page.getByLabel('Colleague or receiving team',{exact:true}).fill('Internal receiving colleague');
   await page.getByLabel('Instructions for this copy',{exact:true}).fill('Preserve the original sources. Return edited answer text to the issuing author.');
   await settled(page);const working=await snapshot(page),p=working.applicationReturn;
   issueIntent=await stage('04-issue-intent',{before:authorStage.record,working,options:{label:p.issueLabel,recipient:p.recipient,note:p.issueNote}});
  }
  let current=await native(authorId);
  if(same(current,issueIntent.before)){
   await openCheckpoint(issueIntent.working);await page.locator('#view').selectOption('returns');
   await page.getByRole('button',{name:'Save and issue editable copy',exact:true}).click();await settled(page);current=await native(authorId);
  }
  need(current?.revision===issueIntent.before.revision+1,'Reconcile the original issued-copy revision.');
  const checked=await page.evaluate(async({before,current,options})=>{
   const r=await import('./grant-application-return.mjs'),old=r.listApplicationReturns(before.input),now=r.listApplicationReturns(current.input);
   const added=now.issues.filter(x=>!old.issues.some(y=>y.id===x.id));if(added.length!==1)throw new Error('Reconcile the single original issued copy.');
   const issue=added[0],expected=await r.createIssue(before.input,{...options,id:issue.id,at:issue.at});
   return {issue,expected:expected.draft};
  },{before:issueIntent.before,current,options:issueIntent.options});
  need(same(current.input,checked.expected),'The native issued copy differs from its retained first candidate.');
  issued=await stage('05-issued',{record:current,issue:checked.issue,files:[await record('issued-author-record.json',json(current))]});
 }
 let issuedFiles=await stage('06-issued-files');
 if(!issuedFiles){
  need(same(await native(authorId),issued.record),'The author changed before complete issued files were retained.');
  await loadNative(authorId);await page.locator('#view').selectOption('returns');
  const card=page.locator('[data-application-issue="'+issued.issue.id+'"]');
  const draftFile=await download(page,card.getByRole('button',{name:'Download issued draft',exact:true}),'issued-application.json');
  const offline=await download(page,card.getByRole('button',{name:'Download issued offline editor',exact:true}),'issued-editor.html','text/html;charset=utf-8');
  const wide=await screen(page,'issued-author-wide.png',1360);
  issuedFiles=await stage('06-issued-files',{draftFile,offline,files:[draftFile,offline,wide],screenshots:[wide]});
 }
 let editIntent=await stage('07-author-edit-intent'),edited=await stage('08-author-edited');
 const authorProject=issued.record.input.answers.find(row=>row.id==='project').text+'\n ';
 if(!edited){
  if(!editIntent){
   need(same(await native(authorId),issued.record),'The original author edition changed before its exercise edit.');
   await loadNative(authorId);await page.locator('#view').selectOption('answers');await page.locator('[data-grant-answer-id="project"]').click();
   await page.getByLabel('Draft answer',{exact:true}).fill(authorProject);await settled(page);
   editIntent=await stage('07-author-edit-intent',{before:issued.record,working:await snapshot(page)});
  }
  let current=await native(authorId);
  if(same(current,editIntent.before)){
   await openCheckpoint(editIntent.working);await page.locator('#save').click();await settled(page);current=await native(authorId);
  }
  need(current?.revision===editIntent.before.revision+1,'Reconcile the original saved author edit.');
  const last=current.input.versions.at(-1);need(last?.label==='Saved submission version'&&last.savedAt,'Keep the actual original Save identity.');
  const expected=await page.evaluate(async({draft,at})=>(await import('./grant-submission-core.mjs')).retainVersion(draft,'Saved submission version',at),{draft:editIntent.working.draft,at:last.savedAt});
  need(same(current.input,expected),'The author save differs from the first complete edit candidate.');
  await loadNative(authorId);edited=await stage('08-author-edited',{record:current,working:await snapshot(page),files:[await record('saved-author-edit.json',json(current))]});
 }
 let colleague;
 try{
  let returned=await stage('09-returned');
  if(!returned){
   colleague=await page.context().newPage();await colleague.goto(pathToFileURL(path.join(directory,issuedFiles.offline.name)).href);await ready(colleague);
   await colleague.locator('#view').selectOption('answers');await colleague.locator('[data-grant-answer-id="project"]').click();
   await colleague.getByLabel('Draft answer',{exact:true}).fill(issued.record.input.answers.find(row=>row.id==='project').text+'\n');
   await colleague.locator('[data-grant-answer-id="need"]').click();const returnedNeed=issued.record.input.answers.find(row=>row.id==='need').text+'\n';
   await colleague.getByLabel('Draft answer',{exact:true}).fill(returnedNeed);await colleague.locator('#view').selectOption('returns');
   const image=await screen(colleague,'issued-colleague-narrow.png',390);
   const file=await download(colleague,colleague.getByRole('button',{name:'Download complete returned application',exact:true}),'returned-application.json');
   const raw=(await verified(file)).toString('utf8'),draft=JSON.parse(raw).draft;
   need(draft.answers.find(row=>row.id==='need').text===returnedNeed,'The complete colleague return differs.');
   returned=await stage('09-returned',{file,returnedNeed,files:[file,image],screenshots:[image]});
  }
  const raw=(await verified(returned.file)).toString('utf8');
  let pending=await stage('10-pending'),applyIntent=await stage('11-apply-intent'),accepted=await stage('12-accepted');
  if(!accepted){
   if(!pending){
    need(same(await native(authorId),edited.record),'The retained author edit changed before return review.');
    await openCheckpoint(edited.working);await page.locator('#view').selectOption('returns');
    await page.getByLabel('Returned application file',{exact:true}).setInputFiles(path.join(directory,returned.file.name));await settled(page);
    await page.getByRole('button',{name:'Preview returned changes',exact:true}).click();await settled(page);
    await page.getByRole('button',{name:'Keep all current author values',exact:true}).click();
    await page.locator('[data-application-return-key="answer:need:text"] select').selectOption('returned');
    await page.getByLabel('Reviewing author',{exact:true}).fill('Internal receiving author');
    await page.getByLabel('Acceptance note',{exact:true}).fill('Retain the current project answer and accept the colleague’s need answer in this separate internal exercise.');
    await settled(page);const working=await snapshot(page);
    need(working.applicationReturn.raw===raw&&working.applicationReturn.choices['answer:need:text']==='returned','Retain the complete incoming file and explicit choices.');
    const file=await download(page,page.getByRole('button',{name:'Download complete working file',exact:true}),'pending-return-working.json');
    need(JSON.parse((await verified(file)).toString('utf8')).working.applicationReturn.raw===raw,'The working file lost the original return.');
    const wide=await screen(page,'returned-comparison-wide.png',1360);
    pending=await stage('10-pending',{working,files:[file,wide],screenshots:[wide]});
   }
   if(!applyIntent){
    need(same(await native(authorId),edited.record),'The author changed before acceptance.');
    await openCheckpoint(pending.working);await page.reload();await settled(page);await page.locator('#view').selectOption('returns');
    await page.getByRole('button',{name:'Preview returned changes',exact:true}).click();await settled(page);
    need(await page.locator('[data-application-return-key="answer:need:text"] select').inputValue()==='returned','Reload lost the reviewed original choice.');
    const narrow=await screen(page,'returned-comparison-narrow.png',390),working=await snapshot(page),p=working.applicationReturn;
    applyIntent=await stage('11-apply-intent',{before:edited.record,working,options:{issueId:issued.issue.id,basisSha256:p.basisSha256,choices:p.choices,reviewer:p.reviewer,note:p.note},files:[narrow],screenshots:[narrow]});
   }
   let current=await native(authorId);
   if(same(current,applyIntent.before)){
    await openCheckpoint(applyIntent.working);await page.locator('#view').selectOption('returns');await page.getByRole('button',{name:'Preview returned changes',exact:true}).click();await settled(page);
    const working=await snapshot(page);need(same(working.applicationReturn,applyIntent.working.applicationReturn),'The original return comparison changed before Save.');
    await page.getByRole('button',{name:'Save chosen changes to original draft',exact:true}).click();await settled(page);current=await native(authorId);
   }
   need(current?.revision===applyIntent.before.revision+1,'Reconcile the original accepted-return revision.');
   const check=await page.evaluate(async({before,current,raw,options})=>{
    const r=await import('./grant-application-return.mjs'),old=r.listApplicationReturns(before.input),now=r.listApplicationReturns(current.input);
    const added=now.adoptions.filter(x=>!old.adoptions.some(y=>y.id===x.id));if(added.length!==1)throw new Error('Reconcile the single original adoption.');
    const adoption=added[0];return {adoption,expected:await r.applyReturned(before.input,raw,{...options,id:adoption.id,at:adoption.at})};
   },{before:applyIntent.before,current,raw,options:applyIntent.options});
   need(same(current.input,check.expected),'The accepted result differs from the retained first choices.');
   need(current.input.answers.find(x=>x.id==='project').text===authorProject&&current.input.answers.find(x=>x.id==='need').text===returned.returnedNeed,'Retain the author conflict and selected colleague answer.');
   accepted=await stage('12-accepted',{record:current,adoption:check.adoption,files:[await record('accepted-author-record.json',json(current))]});
  }
  let branches=await stage('13-branches');
  if(!branches){
   need(same(await native(authorId),accepted.record),'The author advanced after this acceptance; preserve its current work.');
   await loadNative(authorId);await page.locator('#view').selectOption('returns');
   if(!colleague){colleague=await page.context().newPage();await colleague.goto(pathToFileURL(path.join(directory,issuedFiles.offline.name)).href);await ready(colleague);}
   const card=page.locator('[data-application-adoption="'+accepted.adoption.id+'"]'),files=[],screenshots=[],exports={};
   for(const [branch,label]of [['baseline','issued baseline'],['current','author before acceptance'],['returned','returned application'],['result','accepted result']]){
    const file=await download(page,card.getByRole('button',{name:'Download '+label,exact:true}),branch+'-application.json'),packet=JSON.parse((await verified(file)).toString('utf8'));
    exports[branch]=packet.draft;files.push(file);
    const precedingWorkingId=await colleague.locator('#workspace-root').getAttribute('data-working-id');
    await colleague.locator('#file-input').setInputFiles(path.join(directory,file.name));
    await colleague.waitForFunction(({previous,id})=>{
     const root=document.getElementById('workspace-root');
     return root?.dataset.draftId===id&&root.dataset.workingId&&root.dataset.workingId!==previous&&!root.inert&&
      document.getElementById('status')?.textContent.startsWith('Opened the complete draft, including ');
    },{previous:precedingWorkingId,id:packet.draft.id});
    const reopened=await download(colleague,colleague.getByRole('button',{name:'Download full draft',exact:true}),branch+'-reopened-application.json');
    const reopenedDraft=JSON.parse((await verified(reopened)).toString('utf8')).draft;
    need(same(reopenedDraft,packet.draft),'The complete '+branch+' received application differs from its original export.');files.push(reopened);
    await colleague.locator('#view').selectOption('answers');await colleague.locator('[data-grant-answer-id="project"]').click();
    need(await colleague.getByLabel('Draft answer',{exact:true}).inputValue()===packet.draft.answers.find(x=>x.id==='project').text,'The complete '+branch+' application did not reopen.');
    const image=await screen(colleague,branch+'-reopened.png',branch==='returned'?390:1360);files.push(image);screenshots.push(image);
   }
   need(exports.current.answers.find(x=>x.id==='project').text===authorProject&&exports.returned.answers.find(x=>x.id==='need').text===returned.returnedNeed&&exports.result.answers.find(x=>x.id==='need').text===returned.returnedNeed,'The complete retained branches differ.');
   files.push(await download(page,page.getByRole('button',{name:'Download full draft',exact:true}),'accepted-full-application.json'));
   const wide=await screen(page,'accepted-return-history-wide.png',1360);files.push(wide);screenshots.push(wide);
   branches=await stage('13-branches',{files,screenshots});
  }
  need(same(await native(draftId),initial.original),'The internal course changed the original saved application.');
  const fileMap=new Map(),screenshots=[],stageFiles=[];
  for(const name of ['01-original','02-copy-intent','03-author-copy','04-issue-intent','05-issued','06-issued-files','07-author-edit-intent','08-author-edited','09-returned','10-pending','11-apply-intent','12-accepted','13-branches']){
   const value=await stage(name);need(value,'Keep the complete original stage '+name);
   for(const item of value.files||[])fileMap.set(item.name,item);screenshots.push(...value.screenshots||[]);
   const member='stages/'+name+'.json',bytes=await fs.readFile(path.join(directory,member));stageFiles.push({name:member,path:path.join(directory,member),bytes:bytes.length,sha256:hash(bytes),mediaType:'application/json'});
  }
  const result={schema:'stellar-forge.grant-application-return-receiving.v1',state:'OPERATED_AWAITING_PIXEL_INSPECTION',binding,runtime,
   originalDraftId:draftId,authorDraftId:accepted.record.id,issueId:issued.issue.id,adoptionId:accepted.adoption.id,
   beforeRevision:applyIntent.before.revision,afterRevision:accepted.record.revision,files:[...fileMap.values()],stages:stageFiles,screenshots,
   instruction:'Open every complete delivered file and personally view the actual desktop/narrow images. Their presence does not record that viewing.'};
  await exact(path.join(directory,'application-return-result.json'),json(result));return result;
 }finally{if(colleague)await colleague.close();}
}
