// MIT. Continue the original saved application/browser operation and retain its first Save.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const json=value=>JSON.stringify(value)+'\n';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const OPERATION='SCF-SUBMISSION-WORKING-CONTINUITY-D76C-20261013';
async function readJSON(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function exact(file,body){
  const bytes=Buffer.from(body);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  try{const stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink()&&(await fs.readFile(file)).equals(bytes),'Preserve different retained receiving file: '+file);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=file+'.'+randomUUID()+'.pending';let handle;
  try{
    handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;need((await fs.readFile(file)).equals(bytes),'Another original receiver retained different bytes.');}
    const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
  }finally{if(handle)await handle.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
/**
 * Receives the complete working-copy successor in the original browser and native
 * record. The caller retains its original browser/profile/process lock. Every
 * completed stage is immutable; an interrupted stage gets a new artifact folder.
 * Initial native bytes and the exact first Save candidate survive a lost response.
 */
export async function receiveSubmissionWorkingCopy({page,baseUrl,draftId,directory}){
  need(page&&typeof page.goto==='function'&&typeof draftId==='string'&&draftId,'Supply the original browser and saved application identity.');
  directory=path.resolve(directory);await fs.mkdir(directory,{recursive:true,mode:0o700});
  need(!(await fs.lstat(directory)).isSymbolicLink(),'Use the original ordinary receiving directory.');
  const app=new URL('grant-submission.html',baseUrl);app.searchParams.set('draft',draftId);
  const binding={operation:OPERATION,draftId,application:app.href};
  await exact(path.join(directory,'binding.json'),json(binding));
  const stages=new Map();
  const verified=async item=>{
    need(item&&typeof item.name==='string'&&!path.isAbsolute(item.name)&&!item.name.includes('\\')&&item.name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Keep an ordinary complete receiving member.');
    const file=path.join(directory,item.name),stat=await fs.lstat(file),bytes=await fs.readFile(file);
    need(stat.isFile()&&!stat.isSymbolicLink()&&bytes.length===item.bytes&&sha(bytes)===item.sha256,'Keep the complete original receiving member: '+item.name);
    return bytes;
  };
  const stage=async(name,value)=>{
    const file=path.join(directory,'stages',name+'.json');
    if(value!==undefined)await exact(file,json({schema:'stellar-forge.submission-working-stage.v1',binding,value}));
    const kept=await readJSON(file);if(!kept)return null;
    need(kept.schema==='stellar-forge.submission-working-stage.v1'&&same(kept.binding,binding),'Retain the selected original receiving stage.');
    for(const item of kept.value.files||[])await verified(item);
    stages.set(name,kept.value);return kept.value;
  };
  const previousResult=await readJSON(path.join(directory,'working-receiving-result.json'));
  if(previousResult){
    need(previousResult.state==='OPERATED_AWAITING_PIXEL_INSPECTION'&&same(previousResult.binding,binding),'Keep the complete original receiving outcome.');
    for(const item of previousResult.files)await verified(item);
    return previousResult;
  }
  const attempt='attempts/'+randomUUID();await fs.mkdir(path.join(directory,attempt),{recursive:true,mode:0o700});
  const record=async(name,bytes,mediaType)=>{
    const member=attempt+'/'+name;await exact(path.join(directory,member),bytes);
    const value={name:member,path:path.join(directory,member),bytes:Buffer.byteLength(bytes),sha256:sha(bytes),mediaType};
    await verified(value);return value;
  };
  const download=async(label,name,mediaType)=>{
    const waiting=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const item=await waiting;
    const temporary=path.join(directory,attempt,randomUUID()+'.download');await item.saveAs(temporary);
    const bytes=await fs.readFile(temporary),result=await record(name,bytes,mediaType);await fs.unlink(temporary);return result;
  };
  const snapshot=()=>page.evaluate(async()=>{
    const node=document.getElementById('workspace-root'),module=await import('./grant-submission-working-copy.mjs');
    return (await module.loadSubmissionWorkingCopy(node.dataset.workingId)).input;
  });
  const nativeRecord=()=>page.evaluate(async id=>(await import('./drafts.mjs')).loadDraft(id),draftId);
  const settled=()=>page.waitForFunction(()=>{
    const root=document.getElementById('workspace-root'),status=document.getElementById('working-status');
    return status?.textContent.includes('Complete working copy saved')&&!root.inert;
  });
  const screen=async(name,width)=>{
    await page.setViewportSize({width,height:980});
    const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    need(size.scrollWidth<=size.clientWidth+1,'The actual submission view overflows at '+width+'px.');
    const value=await record(name,await page.screenshot({fullPage:true}),'image/png');return {...value,width,viewed:false};
  };
  const contentKeys=['draft','incoming','limits','workbook'];
  // A recovered checkpoint becomes a distinct original working record. Existing
  // local work remains in the same store; only the explicit native Save writes
  // the application record, under its original expected revision.
  const openCheckpoint=async(working)=>{
    const received=await page.evaluate(async value=>{
      const module=await import('./grant-submission-working-copy.mjs');
      await module.verifySubmissionWorkingCopy(value);
      const next=await module.forkSubmissionWorkingCopy(value,{localNative:true});
      return module.saveSubmissionWorkingCopy(next,{revision:0});
    },working);
    const url=new URL(app);url.searchParams.set('working',received.id);await page.goto(url.href);await settled();
    const opened=await snapshot();
    for(const key of [...contentKeys,'native'])need(same(opened[key],working[key]),'Checkpoint receiving changed complete '+key+'.');
    return opened;
  };
  await page.goto(app.href);await settled();
  let initial=await stage('01-original');
  if(!initial){
    const working=await snapshot(),native=await nativeRecord();
    need(working.draft&&working.native.id===draftId&&native?.id===draftId&&same(native.input,working.draft),'The original saved application was not selected.');
    need(working.draft.answers.some(row=>row.id==='project'),'Keep the original project answer.');
    initial=await stage('01-original',{working,native,files:[await record('original-native-record.json',json(native),'application/json')]});
  }
  const original=initial.working,field=original.draft.fields[0]??null,answer=original.draft.answers.find(row=>row.id==='project');
  let intent=await stage('07-save-intent'),saved=await stage('08-saved');
  const verifySaved=async candidate=>{
    const record=await nativeRecord();
    need(record?.id===draftId&&record.revision===initial.native.revision+1,'Reconcile the original saved revision before continuing.');
    const last=record.input.versions.at(-1);
    need(last?.label==='Saved submission version'&&last.savedAt,'Keep the actual original Save timestamp.');
    const expected=await page.evaluate(async({draft,at})=>(await import('./grant-submission-core.mjs')).retainVersion(draft,'Saved submission version',at),{draft:candidate,at:last.savedAt});
    need(same(record.input,expected),'The current native application differs from the retained first Save candidate; preserve its current work.');
    return record;
  };
  if(saved){
    need(same(await nativeRecord(),saved.native),'The original native record changed after this completed Save; retain that newer work.');
  }else if(intent&&!same(await nativeRecord(),initial.native)){
    const native=await verifySaved(intent.working.draft);
    const working={...intent.working,draft:native.input,native:{id:native.id,revision:native.revision,dirty:false}};
    saved=await stage('08-saved',{native,working,files:[await record('reconciled-saved-native-record.json',json(native),'application/json')]});
  }else{
    need(same(await nativeRecord(),initial.native),'The original native application changed before this receiving; retain the current edition.');
  }
  let pending=await stage('02-unfinished'),reopened=await stage('03-reloaded'),incomplete=await stage('04-incomplete'),portable=await stage('05-portable');
  if(!saved&&!intent){
    if(!pending){
      await openCheckpoint(original);await page.locator('#view').selectOption('fields');
      await page.getByRole('button',{name:'Prepare workbook from current form',exact:true}).click();await settled();
      await page.getByText('Edit or paste complete worksheet text',{exact:true}).click();
      const sheet=await page.getByLabel('Fields worksheet',{exact:true}).inputValue();
      await page.getByLabel('Fields worksheet',{exact:true}).fill(sheet+'"');
      if(field)await page.getByLabel('Issuer word limit',{exact:true}).fill('0.');
      await page.locator('#view').selectOption('answers');
      await page.getByLabel('Draft answer',{exact:true}).fill(answer.text+'\n');
      await page.locator('#refresh-source').click();
      await page.waitForFunction(()=>document.getElementById('workspace-root').dataset.sourceReadState==='idle');await settled();
      const working=await snapshot();
      need(working.incoming?.bundle&&working.draft.currentSource===original.draft.currentSource,'Reading source must retain a full comparison without receiving it.');
      need(working.workbook?.fields===sheet+'"','Keep the complete raw unapplied worksheet.');
      if(field)need(working.limits.find(row=>row.fieldId===field.id)?.wordLimit==='0.','Keep the actual field and incomplete limit.');
      need(working.draft.answers.find(row=>row.id==='project').text===answer.text+'\n','Keep the exact original answer edit.');
      pending=await stage('02-unfinished',{working,sheet,files:[]});
    }
    if(!reopened){
      const preceding=await openCheckpoint(pending.working),oldId=preceding.id;await page.reload();await settled();
      const working=await snapshot();
      need(working.id!==oldId&&working.receivedFrom?.id===oldId,'Reload must fork the retained original working record.');
      for(const key of [...contentKeys,'native'])need(same(working[key],preceding[key]),'Reload changed complete '+key+'.');
      reopened=await stage('03-reloaded',{working,files:[await screen('submission-working-source-wide.png',1360)]});
    }
    if(!incomplete){
      await openCheckpoint(reopened.working);await page.locator('#view').selectOption('fields');await settled();
      if(field){
        need(await page.getByLabel('Issuer word limit',{exact:true}).inputValue()==='0.','The unfinished issuer value was coerced.');
        await page.locator('#save').click();await page.waitForFunction(()=>!document.getElementById('error').hidden);await settled();
      }
      need(same(await nativeRecord(),initial.native),'Unfinished preparation changed the original native application.');
      incomplete=await stage('04-incomplete',{working:await snapshot(),limitExercised:!!field,files:[await screen('submission-working-incomplete-narrow.png',390)]});
    }
    if(!portable){
      await openCheckpoint(incomplete.working);
      const workingFile=await download('Download complete working file','complete-working.json','application/json');
      const offline=await download('Download offline editor','complete-working-editor.html','text/html;charset=utf-8');
      const before=JSON.parse((await verified(workingFile)).toString('utf8')).working;
      await page.goto(pathToFileURL(offline.path).href);
      await page.waitForFunction(()=>document.getElementById('workspace-root')?.dataset.draftId&&!document.getElementById('workspace-root').inert);
      if(field)need(await page.getByLabel('Issuer word limit',{exact:true}).inputValue()==='0.','Offline opening lost unfinished issuer text.');
      const capture=await screen('submission-offline-working-wide.png',1360);
      const reopenedFile=await download('Download complete working file','offline-reopened-working.json','application/json');
      const after=JSON.parse((await verified(reopenedFile)).toString('utf8')).working;
      for(const key of contentKeys)need(same(before[key],after[key]),'Offline receiving changed complete '+key+'.');
      need(after.native.id===null&&after.native.revision===0,'Portable recovery must not target the original browser-native save.');
      portable=await stage('05-portable',{working:before,files:[workingFile,offline,capture,reopenedFile]});
      await page.goto(app.href);await settled();
    }
    let candidate=await stage('06-candidate');
    if(!candidate){
      await openCheckpoint(portable.working);
      if(field){await page.locator('#view').selectOption('fields');await page.getByLabel('Issuer word limit',{exact:true}).fill(field.wordLimit===null?'':String(field.wordLimit));}
      await page.locator('#view').selectOption('answers');await page.getByLabel('Draft answer',{exact:true}).fill(answer.text);await settled();
      const working=await snapshot();
      need(working.native.id===draftId&&working.native.revision===initial.native.revision,'Keep the original writer and expected revision.');
      const expected=structuredClone(original.draft);expected.updatedAt=working.draft.updatedAt;
      need(same(working.draft,expected),'Preparation must preserve every original answer, source, form and history before Save.');
      need(working.workbook?.fields===pending.sheet+'"','Keep the complete unapplied workbook before Save.');
      candidate=await stage('06-candidate',{working,files:[await download('Download complete working file','first-save-candidate.json','application/json')]});
    }
    intent=await stage('07-save-intent',{working:candidate.working,before:initial.native,files:[]});
  }
  if(!saved){
    need(same(await nativeRecord(),initial.native),'Reconcile the original native record before repeating a dispatched Save.');
    await openCheckpoint(intent.working);
    need(same(await nativeRecord(),initial.native),'The original native record changed while reopening its exact Save candidate.');
    await page.locator('#save').click();await settled();
    const native=await verifySaved(intent.working.draft),working=await snapshot();
    need(working.native.id===draftId&&working.native.revision===native.revision&&same(working.draft,native.input),'Keep the original Save and its complete recovered working record.');
    saved=await stage('08-saved',{native,working,files:[await record('saved-native-record.json',json(native),'application/json')]});
  }
  let final=await stage('09-final');
  if(!final){
    await openCheckpoint(saved.working);
    const nativeFile=await download('Download full draft','saved-native-draft.json','application/json');
    const workingFile=await download('Download complete working file','final-complete-working.json','application/json');
    const working=await snapshot();
    need(same(working.draft,saved.native.input)&&working.workbook?.fields===pending.sheet+'"','The complete saved handover changed its native draft or unapplied workbook.');
    final=await stage('09-final',{working,files:[nativeFile,workingFile,await screen('submission-working-saved-narrow.png',390)]});
  }
  const files=[],screenshots=[];
  for(const name of ['01-original','02-unfinished','03-reloaded','04-incomplete','05-portable','06-candidate','07-save-intent','08-saved','09-final']){
    const value=await stage(name);need(value,'Retain every completed original receiving stage.');
    for(const file of value.files||[]){files.push(file);if(file.mediaType==='image/png')screenshots.push(file);}
    const bytes=await fs.readFile(path.join(directory,'stages',name+'.json'));
    files.push({name:'stages/'+name+'.json',path:path.join(directory,'stages',name+'.json'),bytes:bytes.length,sha256:sha(bytes),mediaType:'application/json'});
  }
  const result={schema:'stellar-forge.grant-submission-working-receiving.v1',state:'OPERATED_AWAITING_PIXEL_INSPECTION',binding,originalDraftId:draftId,
    native:{beforeRevision:initial.native.revision,afterRevision:saved.native.revision},working:{before:original.id,after:final.working.id},
    originalFields:original.draft.fields.length,unfinishedLimitExercised:!!field,files,screenshots,
    inspection:'Producing operator must open every actual attachment and LOOK at every exact desktop/narrow image; this function does not assert personal visual inspection.'};
  await exact(path.join(directory,'working-receiving-result.json'),json(result));return result;
}
