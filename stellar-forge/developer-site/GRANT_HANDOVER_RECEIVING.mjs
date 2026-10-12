// MIT. Continuation callback for the owner's existing SCF Page and native operation.
// Starts no browser, server, source collector or issuer submission.
import * as fs from 'node:fs/promises';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
import {join,resolve,isAbsolute,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateRawSync} from 'node:zlib';

const COMPONENT='SCF-SUBMISSION-HANDOVER-1B40-20261012';
const SCHEMA='stellar-forge.grant-handover-receiving.v1';
const active=new WeakSet(),MAX=32*1024*1024+65536;
const MODULES=[
  'grant-handover.mjs','grant-submission.mjs',
  'dist/grant-submission-core.mjs','dist/grant-submission-workspace.mjs',
  'dist/grant-submission.html','dist/grant-submission.css','dist/drafts.mjs',
  'dist/grant-plan-core.mjs','dist/grant-plan-source.mjs','dist/grant-plan-workspace.mjs',
  'dist/grant-handover-core.mjs','dist/grant-handover-source.mjs','dist/grant-handover-workspace.mjs',
];
const SOURCES=['application.md','source-index.json','budget.csv','product-and-finance.md'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const now=()=>new Date().toISOString();
async function exists(path){try{return await fs.lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(path){const handle=await fs.open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function identity(path){
  const stat=await fs.lstat(path);need(stat.isFile()&&!stat.isSymbolicLink(),'Retain a regular original file: '+path);
  const handle=await fs.open(path,'r'),digest=createHash('sha256');let bytes=0;
  try{const buffer=Buffer.alloc(256*1024);for(;;){const read=await handle.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;digest.update(buffer.subarray(0,read.bytesRead));bytes+=read.bytesRead;}}
  finally{await handle.close();}
  need(bytes===stat.size,'The file changed during complete receiving: '+path);return {bytes,sha256:digest.digest('hex')};
}
async function createOnly(path,bytes){
  const wanted={bytes:bytes.length,sha256:hash(bytes)},present=await exists(path);
  if(present){const actual=await identity(path);need(JSON.stringify(actual)===JSON.stringify(wanted),'Preserve the existing different receiving file: '+path);await syncDirectory(resolve(path,'..'));return wanted;}
  const temporary=path+'.partial-'+randomUUID(),handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await fs.link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
  const actual=await identity(path);need(JSON.stringify(actual)===JSON.stringify(wanted),'The receiving publication differs; its original temporary file is preserved.');
  await syncDirectory(resolve(path,'..'));
  const retained=await identity(temporary);
  if(JSON.stringify(retained)===JSON.stringify(actual)){await fs.unlink(temporary);await syncDirectory(resolve(path,'..'));}
  return actual;
}
async function publishRetained(temporary,path){
  const expected=await identity(temporary),handle=await fs.open(temporary,'r');
  try{await handle.sync();}finally{await handle.close();}
  try{await fs.link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
  const actual=await identity(path);need(same(actual,expected),'Keep the different receiving publication and complete temporary file.');
  await syncDirectory(resolve(path,'..'));
  if(same(await identity(temporary),actual)){await fs.unlink(temporary);await syncDirectory(resolve(path,'..'));}
  return actual;
}
async function readJson(path){const stat=await fs.lstat(path);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=MAX,'Read a complete bounded receiving JSON file.');return JSON.parse(await fs.readFile(path,'utf8'));}
function safeOrigin(value){
  const url=new URL(value);need(url.origin===value&&['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'Select the original reader origin.');
  need(url.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Use the existing HTTPS or loopback reader.');return url;
}
function confined(root,path){const result=resolve(root,path),rel=relative(root,result);need(rel&&rel!=='..'&&!rel.startsWith('../')&&!isAbsolute(rel),'Use the original receiving directory.');return result;}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function receiveGrantHandover(page,{
  sourceDirectory,outputDirectory,expectedOrigin,
  operationId='SCF-GRANT-REVIEWER-PUBLICATION-8910-20261012',
  actor='Original SCF receiving operator',outputKind='answers',format='plain',
  expectedDraftId=null,onProgress=()=>{},
}={}) {
  need(page&&typeof page.locator==='function'&&typeof page.waitForEvent==='function','Pass the existing owner-controlled Playwright Page.');
  need(!active.has(page),'This same Page already has an active handover continuation.');
  need(typeof sourceDirectory==='string'&&isAbsolute(sourceDirectory)&&typeof outputDirectory==='string'&&isAbsolute(outputDirectory),'Use explicit original source and receiving directories.');
  need(typeof operationId==='string'&&operationId.length>0&&typeof actor==='string','Retain the original operation and operator.');
  need(['answers','fields'].includes(outputKind)&&['plain','markdown'].includes(format),'Select the actual prepared output mode.');
  safeOrigin(expectedOrigin);const initialUrl=new URL(page.url());
  need(initialUrl.origin===expectedOrigin&&initialUrl.pathname==='/grant-submission.html','Continue the already-open original submission Page; this callback does not open a replacement app or draft.');
  const root=resolve(sourceDirectory),out=resolve(outputDirectory);
  await fs.mkdir(out,{recursive:true,mode:0o700});
  const outStat=await fs.lstat(out);need(outStat.isDirectory()&&!outStat.isSymbolicLink(),'Use an ordinary receiving directory.');
  const sourceFiles=[],moduleFiles=[];
  for(const file of SOURCES)sourceFiles.push({file,...await identity(join(root,'dist','grant-data',file))});
  for(const file of MODULES)moduleFiles.push({file,...await identity(join(root,file))});
  const configuration={schema:SCHEMA,component:COMPONENT,operationId,expectedOrigin,outputKind,format,actor,sourceFiles,moduleFiles};
  const selectionPath=join(out,'SELECTION.json'),resultPath=join(out,'RESULT.json');
  if(await exists(selectionPath))need(same((await readJson(selectionPath)).configuration,configuration),
    'Resume with the original selected source/modules and operation. Preserve a changed edition as a separate receiving selection.');
  else await createOnly(selectionPath,json({configuration,selectedAt:now()}));
  if(await exists(resultPath)){
    const result=await readJson(resultPath);need(result.schema===SCHEMA&&same(result.configuration,configuration),'The completed result belongs to another original selection.');
    if(expectedDraftId)need(result.draftId===expectedDraftId,'The completed receiving result belongs to a different original draft.');
    for(const file of result.files){const actual=await identity(confined(out,file.path));need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'A completed receiving artifact differs: '+file.path);}
    return {...result,reused:true};
  }
  const attempt='attempt-'+now().replace(/[^0-9TZ]/g,'')+'-'+randomUUID(),directory=join(out,attempt),files=[];
  await fs.mkdir(directory,{mode:0o700});
  globalThis.crypto ||= webcrypto;
  const {openDraftEnvelope,comparePrepared}=await import(pathToFileURL(join(root,'dist','grant-handover-source.mjs')).href);
  const {applicationOutput}=await import(pathToFileURL(join(root,'dist','grant-submission-core.mjs')).href);
  const planningOptions={
    digest:async bytes=>hash(bytes),
    inflate:async(bytes,maximum)=>new Uint8Array(inflateRawSync(bytes,{maxOutputLength:maximum})),
  };
  const recordFile=async(path,label)=>{
    const value={path:relative(out,path).split('\\').join('/'),label,...await identity(path)};files.push(value);return value;
  };
  const progress=async(phase,values={})=>{
    const event={component:COMPONENT,operationId,attempt,at:now(),phase,...values};
    const path=join(directory,String(files.length).padStart(3,'0')+'-'+phase+'.json');
    await createOnly(path,json(event));await recordFile(path,phase+'-progress');onProgress(event);
  };
  const waitEditor=async()=>{
    await page.waitForFunction(()=>{const root=document.getElementById('workspace-root');return root&&!root.inert;},{},{timeout:30000});
    const error=page.locator('#error');if(await error.isVisible())throw new Error(await error.innerText());
  };
  const download=async(trigger,label,extension='.json')=>{
    const [received]=await Promise.all([page.waitForEvent('download',{timeout:30000}),trigger()]);
    const path=join(directory,label+extension+'.partial-'+randomUUID());await received.saveAs(path);
    const failure=await received.failure();need(!failure,'The browser download did not complete: '+failure);
    const target=join(directory,label+extension),published=await publishRetained(path,target);
    await recordFile(target,label);return {path:target,suggestedFilename:received.suggestedFilename(),...published};
  };
  const snapshot=async label=>{
    const file=await download(()=>page.locator('#export-draft').click(),label);
    need(file.bytes<=MAX,'The original draft exceeds its bounded receiving allowance.');
    const text=await fs.readFile(file.path,'utf8'),draft=await openDraftEnvelope(text,{planningOptions});
    await waitEditor();return {file,text,draft};
  };
  const field=label=>page.getByRole('textbox',{name:label,exact:true});
  const select=label=>page.getByRole('combobox',{name:label,exact:true});
  const view=async name=>{await page.locator('#view').selectOption(name);await waitEditor();};
  const retained=async filename=>{
    const path=join(out,filename);if(!await exists(path))return null;
    const stat=await fs.lstat(path);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=MAX,'Retain a complete bounded original draft.');
    const text=await fs.readFile(path,'utf8');return {path,text,draft:await openDraftEnvelope(text,{planningOptions})};
  };
  need(!active.has(page),'This same Page already has an active handover continuation.');active.add(page);
  try{
    await waitEditor();
    // Bind actual served module/source bytes, rather than infer them from a checkout.
    for(const file of [...sourceFiles.map(file=>({...file,file:'dist/grant-data/'+file.file})),...moduleFiles.filter(file=>file.file.startsWith('dist/'))]){
      const path=file.file.startsWith('dist/')?file.file.slice(5):'grant-data/'+file.file;
      const response=await page.request.get(new URL('/'+path,expectedOrigin).href);
      need(response.ok(),'The original reader could not return '+path+'.');
      const bytes=await response.body();
      need(bytes.length===file.bytes&&hash(bytes)===file.sha256,'The served original bytes differ from the selected source: '+path);
    }
    let current=await snapshot('entry-draft');
    if(expectedDraftId)need(current.draft.id===expectedDraftId,'The open Page is a different original draft.');
    const entry=await retained('original-entry-draft.json');
    if(entry)need(current.draft.id===entry.draft.id,'Reopen the retained original draft before continuing this same receiving operation.');
    else await createOnly(join(out,'original-entry-draft.json'),Buffer.from(current.text,'utf8'));
    await progress('entered',{draftId:current.draft.id});
    let baseline=await retained('prepared-input-draft.json');
    if(!baseline){
      // Original source receiving preserves prior versions and edited answers.
      await view('source');
      const receive=page.getByRole('button',{name:'Receive source and keep edited answers',exact:true});
      if(await receive.count()){await receive.click();await waitEditor();}
      const companions=page.getByRole('button',{name:'Retain these four original reviewer files',exact:true});
      if(await companions.count()){await companions.click();await waitEditor();}
      current=await snapshot('received-reader-draft');
      const index=JSON.parse(await fs.readFile(join(root,'dist','grant-data','source-index.json'),'utf8'));
      need(current.draft.currentSource===index.application.sha256,'Select the actual current source through the original editor.');
      need(current.draft.handover?.bundles.some(bundle=>bundle.body.applicationSha256===current.draft.currentSource&&
        sourceFiles.every(file=>bundle.body.files.some(item=>item.originalName===file.file&&item.sha256===file.sha256&&item.bytes===file.bytes))),
        'Receive all four exact reviewer files through the original source view.');
      if(outputKind==='fields')need(current.draft.fields.length>0,'Select actual retained issuer fields; this receiving callback does not invent them.');
      await page.locator('#save').click();await waitEditor();current=await snapshot('saved-reader-draft');
      await createOnly(join(out,'prepared-input-draft.json'),Buffer.from(current.text,'utf8'));
      baseline={text:current.text,draft:current.draft,path:join(out,'prepared-input-draft.json')};
    }
    need(current.draft.id===baseline.draft.id,'Keep the same original receiving draft identity.');
    const inputHash=hash(Buffer.from(baseline.text,'utf8'));
    const marker=COMPONENT+' / '+operationId+' / input '+inputHash;
    const title='Prepared receiving edition · '+COMPONENT;
    const evidenceTitle='Original reviewer budget · '+marker;
    const note='Actual original editor handover continuation. '+marker;
    const returnReference='Original local receiving · '+inputHash;
    const returnNote='Operator observation: this same draft retained the four original reviewer files, prepared exact output and downloaded the complete handover. This is a local receiving observation, not an issuer acknowledgement. '+marker;
    const budget=sourceFiles.find(file=>file.file==='budget.csv');
    await view('handover');
    let evidence=current.draft.handover?.evidence.filter(item=>item.body.title===evidenceTitle&&item.body.file.sha256===budget.sha256)||[];
    need(evidence.length<=1,'Reconcile the multiple retained evidence entries instead of creating another one.');
    if(!evidence.length){
      await field('Operator').fill(actor);
      await field('Evidence title').fill(evidenceTitle);
      await select('Evidence category').selectOption('source');
      await field('Original source URL').fill(new URL('/grant-data/budget.csv',expectedOrigin).href);
      await field('Source observation date or timestamp').fill(now());
      await field('What this original file supports').fill('Exact original '+budget.bytes+'-byte budget from the selected reviewer source.');
      await page.locator('[data-handover-file="evidence"]').setInputFiles(join(root,'dist','grant-data','budget.csv'));await waitEditor();
      await page.getByRole('button',{name:'Record this evidence file',exact:true}).click();await waitEditor();
      current=await snapshot('evidence-draft');
      evidence=current.draft.handover.evidence.filter(item=>item.body.title===evidenceTitle&&item.body.file.sha256===budget.sha256);
      need(evidence.length===1,'The original evidence record was not retained exactly once.');
    }
    let editions=current.draft.handover?.editions.filter(item=>item.body.title===title&&item.body.note===note)||[];
    need(editions.length<=1,'Reconcile the retained preparation records without preparing another output.');
    if(!editions.length){
      await view('handover');await field('Operator').fill(actor);
      await field('Prepared edition title').fill(title);await field('Preparation note').fill(note);
      await select('Output to prepare').selectOption(outputKind);await select('Exact output format').selectOption(format);
      await page.getByRole('button',{name:'Prepare this exact edition',exact:true}).click();await waitEditor();
      current=await snapshot('prepared-draft');
      editions=current.draft.handover.editions.filter(item=>item.body.title===title&&item.body.note===note);
    }
    need(editions.length===1,'The exact prepared edition did not return.');
    const edition=editions[0];
    need(edition.body.output.text===applicationOutput(baseline.draft,{format,useFields:outputKind==='fields'}),
      'The prepared output differs from the original captured receiving input. Preserve the independent work.');
    need(edition.body.output.kind===outputKind&&edition.body.output.format===format&&edition.body.evidenceIds.includes(evidence[0].id),
      'The retained prepared output differs from the original selected mode/evidence.');
    let observations=current.draft.handover.returns.filter(row=>row.body.editionId===edition.id&&row.body.reference===returnReference&&row.body.note===returnNote);
    need(observations.length<=1,'Reconcile the recorded operator observations without adding another one.');
    if(!observations.length){
      await view('handover');await select('Prepared edition').selectOption(edition.id);await waitEditor();
      const clear=page.getByRole('button',{name:'Clear working returned file',exact:true});
      if(await clear.count()){await clear.click();await waitEditor();}
      await select('Observation category').selectOption('operator-note');
      await field('Original observation date or timestamp').fill(now());
      await field('Original issuer or submission URL').fill('');
      await field('Original issuer reference').fill(returnReference);
      await field('Actual observation or correction').fill(returnNote);
      await page.getByRole('button',{name:'Record this observation',exact:true}).click();await waitEditor();
      current=await snapshot('recorded-observation-draft');
      observations=current.draft.handover.returns.filter(row=>row.body.editionId===edition.id&&row.body.reference===returnReference&&row.body.note===returnNote);
    }
    need(observations.length===1&&observations[0].body.kind==='operator-note','The original operator observation differs.');
    await page.locator('#save').click();await waitEditor();
    current=await snapshot('complete-prepared-draft');
    await progress('prepared',{draftId:current.draft.id,editionId:edition.id,observationId:observations[0].id,outputSha256:edition.body.output.sha256});
    await view('handover');
    // The direct summary belongs to this exact titled edition.
    const summaries=page.locator('#editor details > summary').filter({hasText:title});
    need(await summaries.count()===1,'Locate the one retained receiving edition in the original editor.');
    const summary=summaries.first();
    if(!await summary.evaluate(element=>element.parentElement.open))await summary.click();
    const selected=summary.locator('xpath=..');
    const frozen=await download(()=>selected.getByRole('button',{name:'Download frozen output',exact:true}).click(),'frozen-output',format==='markdown'?'.md':'.txt');
    need(frozen.sha256===edition.body.output.sha256&&frozen.bytes===edition.body.output.bytes,'The browser output differs from the frozen complete text.');
    const report=await download(()=>selected.getByRole('button',{name:'Download prepared report and later comparison',exact:true}).click(),'prepared-report','.html');
    await waitEditor();
    const before=outputKind==='fields'?edition.body.snapshot.fields[0]:edition.body.snapshot.answers[0];
    const annotation='\n\nLocal receiving continuation: this later working edit is compared with prepared edition '+edition.id+'.';
    const rows=outputKind==='fields'?current.draft.fields:current.draft.answers;
    const target=rows.find(row=>row.id===before.id);
    need(target&&(target.text===before.text||target.text===before.text+annotation),
      'The selected working text has an independent edit; preserve it and reconcile this original continuation.');
    if(target.text===before.text){
      await view(outputKind==='fields'?'fields':'answers');
      const attribute=outputKind==='fields'?'data-grant-field-id':'data-grant-answer-id';
      const buttons=page.locator('#answer-nav button['+attribute+']');
      const selectedIndex=await buttons.evaluateAll((elements,selection)=>elements.findIndex(element=>element.getAttribute(selection.attribute)===selection.id),{attribute,id:before.id});
      need(selectedIndex>=0,'Select the original answer or field by its retained native identity.');
      await buttons.nth(selectedIndex).click();
      await page.locator('#editor textarea.answer-input').fill(before.text+annotation);
    }
    await page.locator('#save').click();await waitEditor();
    const final=await snapshot('editable-later-draft');
    const comparison=comparePrepared(final.draft,edition.id);
    need(comparison.outputChanged&&comparison.outputItems.some(row=>row.id===before.id&&row.status==='changed'),
      'The later edit was not compared against the original frozen output.');
    await createOnly(join(directory,'later-comparison.json'),json(comparison));await recordFile(join(directory,'later-comparison.json'),'later-comparison');
    // Reopen the original complete file through the existing file input, not a new store.
    await page.locator('#import-draft').click();await page.locator('#file-input').setInputFiles(final.file.path);await waitEditor();
    await page.locator('#save').click();await waitEditor();
    const reopened=await snapshot('reopened-editable-draft');
    need(reopened.draft.id===baseline.draft.id&&reopened.draft.handover.editions.some(row=>row.id===edition.id&&row.body.output.sha256===edition.body.output.sha256)&&
      reopened.draft.handover.returns.some(row=>row.id===observations[0].id)&&comparePrepared(reopened.draft,edition.id).outputChanged,
      'Complete editable receiving did not preserve the original identities and later edit.');
    await view('handover');
    const image=join(directory,'reopened-handover.png');await page.screenshot({path:image,fullPage:true});await recordFile(image,'reopened-handover');
    await progress('reopened',{draftId:reopened.draft.id,editionId:edition.id});
    await recordFile(selectionPath,'original-selection');
    await recordFile(join(out,'original-entry-draft.json'),'original-entry-draft');
    await recordFile(join(out,'prepared-input-draft.json'),'original-prepared-input');
    const result={schema:SCHEMA,configuration,attempt,completedAt:now(),draftId:reopened.draft.id,
      preparedEditionId:edition.id,observationId:observations[0].id,observationKind:'operator-note',
      preparedOutput:{bytes:edition.body.output.bytes,sha256:edition.body.output.sha256,kind:outputKind,format},
      originalInput:{path:'prepared-input-draft.json',...await identity(join(out,'prepared-input-draft.json'))},
      sourceBundles:reopened.draft.handover.bundles.map(row=>row.id),evidenceId:evidence[0].id,
      laterChangedItems:comparison.outputItems.filter(row=>row.status!=='unchanged').map(row=>({id:row.id,status:row.status})),
      files,meaning:'Actual UI source/evidence/preparation/operator-note/download/save/reopen and later-edit continuation in the original draft. No issuer submit action or issuer response is represented.'};
    await createOnly(resultPath,json(result));return result;
  }catch(error){
    const failure={schema:SCHEMA,configuration,attempt,failedAt:now(),error:{name:error.name,message:error.message},files,
      meaning:'The failed attempt and its completed files remain. Reopen the same draft and inspect its retained records before continuing; this callback does not resend or submit.'};
    try{await createOnly(join(directory,'ERROR.json'),json(failure));}catch{}
    throw error;
  }finally{active.delete(page);}
}
