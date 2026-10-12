// MIT. Commission and receive source-bound extraction through the original Research UI.
import {mkdir,readFile,open,rename,unlink,link,lstat} from 'node:fs/promises';
import {resolve,join,isAbsolute,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {extractionDigest} from './study-extraction.mjs';
import {STUDY_CASE_SCHEMA,studyCaseAnswers} from './study-extraction-case.mjs';

const SCHEMA='sf88-study-extraction-browser-run/v1';
const clone=value=>structuredClone(value);
const same=(a,b)=>extractionDigest(a)===extractionDigest(b);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const fail=(code,details={})=>Object.assign(new Error(code),{code,...details});
function need(value,code,details){if(!value)throw fail(code,details);}
function safeName(value){need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,190}$/.test(value),'STUDY_BROWSER_FILENAME_INVALID');return value;}
async function maybe(file){try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function completeFile(file,bytes){
  const old=await maybe(file);
  if(old){
    need((await lstat(file)).isFile()&&old.equals(bytes),'STUDY_BROWSER_RETAINED_FILE_CHANGED',{file});
    return {path:file,bytes:old.length,sha256:sha(old)};
  }
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.pending-'+randomUUID(),handle=await open(temp,'wx',0o600);
  try{
    await handle.writeFile(bytes);await handle.sync();await handle.close();
    try{await link(temp,file);}catch(error){
      if(error.code!=='EEXIST')throw error;
      need((await lstat(file)).isFile()&&(await readFile(file)).equals(bytes),'STUDY_BROWSER_RETAINED_FILE_CHANGED',{file});
    }
    await unlink(temp);
    const directory=await open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
    return {path:file,bytes:bytes.length,sha256:sha(bytes)};
  }catch(error){await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});throw error;}
}
async function replaceJson(file,value){
  const temp=file+'.pending-'+randomUUID(),handle=await open(temp,'wx',0o600);
  try{
    await handle.writeFile(json(value));await handle.sync();await handle.close();
    await rename(temp,file);
    const directory=await open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
  }catch(error){await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});throw error;}
}
function caseIdentity(sourceCase,{dossierId,questionId,studyId,studyVersion}){
  need(sourceCase?.schema===STUDY_CASE_SCHEMA,'STUDY_BROWSER_SOURCE_CASE_REQUIRED');
  const {sha256,...body}=sourceCase;
  need(/^[a-f0-9]{64}$/.test(sha256)&&extractionDigest(body)===sha256,'STUDY_BROWSER_SOURCE_CASE_CHANGED');
  need(sourceCase.dossierId===dossierId&&sourceCase.questionId===questionId,'STUDY_BROWSER_SOURCE_SCOPE_CHANGED');
  need(typeof studyId==='string'&&studyId&&Number.isSafeInteger(studyVersion)&&studyVersion>=1,'STUDY_BROWSER_STUDY_SELECTION_REQUIRED');
  need(sourceCase.rows?.length===14&&sourceCase.answers?.length===182&&sourceCase.definition?.fields?.length===13,
    'STUDY_BROWSER_COMPLETE_POPULATION_REQUIRED');
  need(new Set(sourceCase.rows.map(r=>r.id)).size===14&&
    new Set(sourceCase.answers.map(a=>a.rowId+'\n'+a.fieldId)).size===182,'STUDY_BROWSER_DUPLICATE_SOURCE_CELL');
  const choice=sourceCase.disagreement;
  need(same(choice?.originalValue,['str','79.7'])&&same(choice?.enteredValue,['str','79.0']),'STUDY_BROWSER_ORIGINAL_DISAGREEMENT_CHANGED');
  return {sourceCaseSha256:sha256,dossierId,questionId,studyId,studyVersion};
}
function connectionUrl(value,dossierId){
  const url=new URL(value);
  need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'STUDY_BROWSER_ORIGINAL_URL_REQUIRED');
  const p=new URLSearchParams(url.hash.slice(1)),token=p.get('token');
  need(/^[a-f0-9]{64}$/.test(token??''),'STUDY_BROWSER_ORIGINAL_TOKEN_REQUIRED');
  p.set('dossier',dossierId);p.set('view','study-extraction');url.hash=p.toString();
  return {url,token};
}
function operationFrom(value,request,dossierId){
  need(value?.dossier?.id===dossierId&&value.operation?.requestId===request.requestId&&
    same(value.operation.request,request)&&value.operation.originalRevision===request.expectedRevision&&
    value.operation.revision===request.expectedRevision+1&&value.dossier.revision>=value.operation.revision,
    'STUDY_BROWSER_OPERATION_IDENTITY_CHANGED');
  return value.operation;
}
function sourcePointers(sourceCase){
  const selected=[];
  const add=answer=>{const b=answer?.bases?.find(b=>b.kind==='json-pointer');if(b&&!selected.includes(b.pointer))selected.push(b.pointer);};
  add(sourceCase.answers.find(a=>a.rowId===sourceCase.disagreement.rowId&&a.fieldId==='value'));
  for(const fieldId of ['outcome_denominator','class_denominator','category_denominator'])
    add(sourceCase.answers.find(a=>a.fieldId===fieldId));
  add(sourceCase.answers.find(a=>a.status==='not-estimable'));
  add(sourceCase.answers.find(a=>a.status==='not-reported'));
  return selected;
}
function reasonFor(row,discrepant){
  const p=row.context?.measurement?.pointer??row.id;
  const group=row.context?.group?.metadata?.title??row.label;
  return discrepant?
    'Adjudication of the commissioning entry for '+group+'. The original registry at '+p+
    '/value reports the exact string 79.7. Extractor B deliberately entered 79.0 for this commissioning review. '+
    'Choose extractor A’s source-bound entries for all thirteen fields, retaining B’s original submission and the observed difference. '+
    'Keep the separate outcome, class and category denominators, reported NA explanations, original population and time frame.':
    'Both independent submissions were compared with the original registry for '+group+' at '+p+
    '. Retain their matching source-bound entries for all thirteen fields. Keep the point estimate, confidence limits, '+
    'original comments and missing/NA states, and keep outcome, class and category denominators separate with their original units and containers. '+
    'The original population and full time frame remain part of this result; this review does not infer an unreported value.';
}

/**
 * Attach to DBC61's original listener. Own only this browser, client and run journal.
 * Ordinary writes originate in the real UI. Recovery sends only its exact retained
 * five-field request through the existing idempotent Research client method.
 */
export async function runStudyExtractionBrowser({
  url,dossierId,questionId,studyId,studyVersion,sourceCase,runDirectory,
  playwrightModule,chromiumExecutable,mode='author',selection,signal
}){
  need(signal===undefined||(typeof signal.aborted==='boolean'&&typeof signal.addEventListener==='function'&&
    typeof signal.removeEventListener==='function'),'STUDY_BROWSER_ABORT_SIGNAL_INVALID');
  const abortError=()=>Object.assign(fail('STUDY_BROWSER_CANCELLED'),{name:'AbortError'});
  const checkAbort=()=>{if(signal?.aborted)throw abortError();};
  checkAbort();
  need(['author','inspect'].includes(mode),'STUDY_BROWSER_MODE_INVALID');
  need(isAbsolute(runDirectory)&&isAbsolute(playwrightModule)&&isAbsolute(chromiumExecutable),
    'STUDY_BROWSER_EXISTING_ABSOLUTE_PATHS_REQUIRED');
  const identity=caseIdentity(sourceCase,{dossierId,questionId,studyId,studyVersion});
  const connection=connectionUrl(url,dossierId),directory=resolve(runDirectory);
  await mkdir(directory,{recursive:true,mode:0o700});
  const files=join(directory,'study-extraction-browser-'+mode);
  await mkdir(files,{recursive:true,mode:0o700});
  const journalFile=join(directory,'study-extraction-browser.'+mode+'.json');
  const saved=await maybe(journalFile);
  let journal=saved?JSON.parse(saved.toString('utf8')):{
    schema:SCHEMA,mode,identity,createdAt:new Date().toISOString(),phases:{},artifacts:[],screenshots:[],
    browserErrors:[],selection:mode==='inspect'?Object.fromEntries([
      'formId','formEditionId','resultSetId','tableId','publicationId','reviewedRevision','reviewRequestFile',
      'extractionAId','extractionBId','submissionAId','submissionBId'
    ].filter(key=>selection?.[key]!==undefined).map(key=>[key,clone(selection[key])])):{},status:'prepared'
  };
  need(journal.schema===SCHEMA&&journal.mode===mode&&same(journal.identity,identity),'STUDY_BROWSER_RUN_IDENTITY_CHANGED');
  if(mode==='inspect')need(journal.selection.formId&&journal.selection.formEditionId&&journal.selection.resultSetId,
    'STUDY_BROWSER_RECEIVED_SELECTION_REQUIRED');
  if(selection&&saved)for(const key of ['formId','formEditionId','resultSetId','tableId','publicationId'])
    if(selection[key])need(journal.selection[key]===selection[key],'STUDY_BROWSER_SELECTION_CHANGED');
  if(journal.status==='complete')return clone(journal.result);
  const remember=record=>{
    const old=journal.artifacts.find(r=>r.path===record.path);
    if(old)need(old.bytes===record.bytes&&old.sha256===record.sha256,'STUDY_BROWSER_ARTIFACT_CHANGED');
    else journal.artifacts.push(record);return record;
  };
  const checkpoint=async()=>{
    journal.updatedAt=new Date().toISOString();await replaceJson(journalFile,journal);
  };
  const retain=async(name,value)=>{
    const bytes=Buffer.isBuffer(value)?value:json(value);
    return remember(await completeFile(join(files,safeName(name)),bytes));
  };
  const sourceFile=await retain('source-case.json',sourceCase);
  const redact=value=>String(value??'').split(connection.token).join('[operator-token]');
  const progress=phase=>process.stdout.write(JSON.stringify({
    schema:SCHEMA,mode,phase,dossierId,at:new Date().toISOString()
  })+'\n');
  let browser,context,page,active=null,routeFailure=null,cancelledAt=null;
  let cancellationClose=Promise.resolve();
  const onAbort=()=>{
    cancelledAt??=new Date().toISOString();
    cancellationClose=(async()=>{
      if(context)await context.close().catch(()=>{});
      if(browser)await browser.close().catch(()=>{});
    })();
  };
  // The original client's supported fetch injection keeps its transport/auth/CAS
  // intact while applying the caller's lifetime to every native read or recovery.
  const client=new ResearchWorkspaceClient({url},signal?{fetch:(target,options={})=>
    globalThis.fetch(target,{...options,signal:AbortSignal.any([signal,...(options.signal?[options.signal]:[])])})}:{});
  const retainedResult=await maybe(join(files,'result.json'));
  if(retainedResult){
    const result=JSON.parse(retainedResult.toString('utf8'));
    need(result.schema===SCHEMA&&result.mode===mode&&result.dossierId===dossierId&&
      result.questionId===questionId&&result.studyId===studyId&&result.studyVersion===studyVersion&&
      result.formId===journal.selection.formId&&result.formEditionId===journal.selection.formEditionId&&
      result.resultSetId===journal.selection.resultSetId&&result.nativeOutputs?.sourceCaseFile===sourceFile.path,
      'STUDY_BROWSER_RETAINED_RESULT_CHANGED');
    journal.result=result;journal.status='complete';await checkpoint();
    await client.close();return clone(result);
  }
  const apiPath='/api/dossiers/'+encodeURIComponent(dossierId)+'/extraction';
  const reviewPath=apiPath+'/reviews';
  let requestWrite=Promise.resolve();
  const all=async(section,options={})=>{
    const items=[];let offset=0,revision=options.revision;
    for(;;){
      checkAbort();
      const value=await client.extraction(dossierId,{...options,section,offset,limit:100,revision});
      need(value.dossierId===dossierId&&Number.isSafeInteger(value.revision)&&
        (revision===undefined||revision===value.revision)&&Array.isArray(value.items),
        'STUDY_BROWSER_SECTION_SCOPE_CHANGED',{section});
      revision=value.revision;items.push(...value.items);
      if(value.nextOffset===null)return {revision,items};
      need(Number.isSafeInteger(value.nextOffset)&&value.nextOffset>offset,'STUDY_BROWSER_PAGE_DID_NOT_ADVANCE',{section});
      offset=value.nextOffset;
    }
  };
  const sel=name=>page.locator('.study-extraction [data-se="'+name+'"]');
  const root=()=>page.locator('.study-extraction');
  async function ready(section){
    checkAbort();
    await page.waitForFunction(({dossierId,section})=>{
      const n=document.querySelector('.study-extraction');
      return !!n&&n.getBoundingClientRect().height>0&&n.dataset.dossierId===dossierId&&
        Number(n.dataset.revision)>=1&&n.dataset.seBusy==='false'&&(!section||n.dataset.seSection===section);
    },{dossierId,section},{timeout:180000});
    if(routeFailure)throw routeFailure;
  }
  async function navigate(section){
    await ready();await sel('nav-'+section).click();await ready(section);
  }
  async function selectValue(name,value){
    const node=sel(name);
    await node.waitFor({state:'visible',timeout:180000});
    if(await node.inputValue()!==value){await node.selectOption(value);await ready();}
    await node.waitFor({state:'visible'});need(await node.inputValue()===value,'STUDY_BROWSER_SELECTED_CONTROL_CHANGED',{name});
  }
  async function selectOriginals(){
    const s=journal.selection;
    if(s.formEditionId)await selectValue('form-select',s.formEditionId);
    if(s.resultSetId)await selectValue('result-set-select',s.resultSetId);
  }
  async function chooseActor(actor){
    if(await sel('actor-select').count()){
      await selectValue('actor-select',actor.id);
      await page.waitForFunction(({id,name})=>{
        const r=document.querySelector('.study-extraction');
        return r?.querySelector('[data-se="actor-id"]')?.value===id&&
          r?.querySelector('[data-se="actor-name"]')?.value===name&&r.dataset.seBusy==='false';
      },actor,{timeout:180000});
    }else{
      await sel('actor-id').fill(actor.id);await sel('actor-name').fill(actor.name);
    }
  }
  async function upload(name,payload,phase){
    const artifact=await retain('input-'+phase+'.json',payload);
    await sel(name).setInputFiles(artifact.path);await ready();
    await page.waitForFunction(name=>{
      const n=document.querySelector('.study-extraction [data-se="'+name+'"]');
      return n&&n.files?.length===0;
    },name,{timeout:180000});
  }
  async function capture(name){
    const file=join(files,safeName(name)+'.png');
    if(journal.screenshots.some(x=>x.path===file))return;
    const previous=await maybe(file),bytes=previous??await page.screenshot({fullPage:false});
    need(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'STUDY_BROWSER_SCREENSHOT_INCOMPLETE');
    const record=remember(await completeFile(file,bytes));
    journal.screenshots.push(record);await checkpoint();
  }
  async function refresh(){
    await sel('refresh').click();await ready();await selectOriginals();
  }
  async function retainCommitted(phase,request,value,{recovered=false}={}){
    const operation=operationFrom(value,request,dossierId);
    const p=journal.phases[phase];
    const body=await retain(phase+(recovered?'.recovered-response.json':'.response.json'),value);
    p.response=body;p.operationId=operation.id;p.originalRevision=operation.originalRevision;
    p.revision=operation.revision;p.completedAt=new Date().toISOString();p.state='committed';
    p.recovered=!!recovered;
    await checkpoint();return operation;
  }
  async function committed(phase,action,actor,data,configure,button){
    checkAbort();
    let p=journal.phases[phase];
    // A full request can reach disk just before the journal update fails. Recover
    // that exact identity before the UI is allowed to create another request.
    if(p&&!p.request){
      const path=join(files,safeName(phase+'.request.json')),bytes=await maybe(path);
      if(bytes){
        const request=JSON.parse(bytes.toString('utf8'));
        need(request.action===action&&same(request.actor,actor)&&same(request.data,data),
          'STUDY_BROWSER_ORPHAN_REQUEST_CHANGED',{phase});
        p.request=remember({path,bytes:bytes.length,sha256:sha(bytes)});
        p.requestId=request.requestId;p.expectedRevision=request.expectedRevision;p.state='prepared';await checkpoint();
      }
    }
    if(p?.state==='committed'){
      const bytes=await readFile(p.request.path);
      need(bytes.length===p.request.bytes&&sha(bytes)===p.request.sha256,'STUDY_BROWSER_REQUEST_FILE_CHANGED',{phase});
      const request=JSON.parse(bytes.toString('utf8'));
      need(request.action===action&&same(request.actor,actor)&&same(request.data,data),'STUDY_BROWSER_PLANNED_OPERATION_CHANGED',{phase});
      const responseBytes=await readFile(p.response.path);
      need(sha(responseBytes)===p.response.sha256,'STUDY_BROWSER_RESPONSE_FILE_CHANGED',{phase});
      return operationFrom(JSON.parse(responseBytes.toString('utf8')),request,dossierId);
    }
    if(p?.request){
      const bytes=await readFile(p.request.path);
      need(bytes.length===p.request.bytes&&sha(bytes)===p.request.sha256,'STUDY_BROWSER_REQUEST_FILE_CHANGED',{phase});
      const request=JSON.parse(bytes.toString('utf8'));
      need(request.action===action&&same(request.actor,actor)&&same(request.data,data),'STUDY_BROWSER_PLANNED_OPERATION_CHANGED',{phase});
      progress('recover-'+phase);
      // This is the actual already-authored request, including its unchanged
      // expected revision. The original API owns exact replay and CAS semantics.
      const value=await client.reviewExtraction(dossierId,request);
      const operation=await retainCommitted(phase,request,value,{recovered:true});
      await refresh();return operation;
    }
    progress(phase);
    await configure();
    p={action,actor:clone(actor),expectedDataSha256:extractionDigest(data),state:'ready',startedAt:new Date().toISOString()};
    journal.phases[phase]=p;await checkpoint();
    active={phase,action,actor,data};routeFailure=null;
    const responsePromise=page.waitForResponse(response=>{
      const u=new URL(response.url()),request=response.request();
      return request.method()==='POST'&&u.origin===connection.url.origin&&u.pathname===reviewPath;
    },{timeout:180000});
    responsePromise.catch(()=>{});
    try{
      checkAbort();await sel(button).click();
      const response=await responsePromise;await requestWrite;
      if(routeFailure)throw routeFailure;
      need(p.request,'STUDY_BROWSER_REQUEST_NOT_RETAINED',{phase});
      const request=JSON.parse((await readFile(p.request.path)).toString('utf8'));
      const raw=await response.body();const value=JSON.parse(raw.toString('utf8'));
      if(!response.ok()){
        const errorFile=await retain(phase+'.rejected-response.json',raw);
        p.rejection={status:response.status(),file:errorFile,code:value.error??value.code??null};
        p.state='rejected';await checkpoint();
        throw fail(value.error??'STUDY_BROWSER_NATIVE_REQUEST_REJECTED',{status:response.status(),phase,journalFile});
      }
      const operation=await retainCommitted(phase,request,value);
      await page.waitForFunction(({id,revision})=>{
        const n=document.querySelector('.study-extraction');
        return n?.dataset.lastRequestId===id&&Number(n.dataset.lastCommittedRevision)>=revision&&n.dataset.seBusy==='false';
      },{id:request.requestId,revision:operation.revision},{timeout:180000});
      return operation;
    }finally{active=null;}
  }
  async function inspectEntryRows(answers,phase){
    const examined=[];
    for(const row of sourceCase.rows){
      checkAbort();
      await selectValue('row-select',row.id);
      await page.waitForFunction(rowId=>{
        const n=document.querySelector('.study-extraction .se-value-editor[data-row-id]');
        return n?.dataset.rowId===rowId;
      },row.id,{timeout:180000});
      const values=await root().evaluate((n,ids)=>ids.map(id=>{
        const find=s=>n.querySelector('[data-se="'+s+'"]');
        return {fieldId:id,kind:find('answer-'+id+'-kind')?.value,
          value:find('answer-'+id+'-value')?.value,status:find('status-'+id)?.value};
      }),sourceCase.definition.fields.map(f=>f.id));
      for(const value of values){
        const expected=answers.find(a=>a.rowId===row.id&&a.fieldId===value.fieldId);
        const payload=expected.value[0]==='NoneType'?'null':['array','object'].includes(expected.value[0])?
          JSON.stringify(expected.value[1],null,2):String(expected.value[1]);
        need(value.kind===expected.value[0]&&value.value===payload&&value.status===expected.status,
          'STUDY_BROWSER_VISIBLE_SOURCE_ENTRY_CHANGED',{rowId:row.id,fieldId:value.fieldId});
      }
      examined.push({rowId:row.id,fields:values.length});
    }
    await retain(phase+'.visible-rows.json',{rows:examined,answers:examined.reduce((n,x)=>n+x.fields,0)});
    await checkpoint();
  }
  async function sourceView(phase){
    const key=phase+'-source-view';
    if(journal.phases[key]?.state==='inspected')return;
    const original=await maybe(join(files,safeName(phase+'.source-values.json')));
    if(original){
      const value=JSON.parse(original.toString('utf8'));
      need(value.dossierId===dossierId&&value.values?.every(v=>v.contentSha256===sourceCase.source.sha256),
        'STUDY_BROWSER_RETAINED_SOURCE_VIEW_CHANGED');
      const file=await retain(phase+'.source-values.json',original);
      journal.phases[key]={state:'inspected',file,recovered:true};await checkpoint();return;
    }
    await navigate('sources');
    await selectValue('source-occurrence',sourceCase.occurrenceId);
    await sel('source-file-name').fill(sourceCase.source.fileName);
    const pointers=sourcePointers(sourceCase);await sel('source-pointers').fill(pointers.join('\n'));
    const waiting=page.waitForResponse(r=>{
      const u=new URL(r.url());return r.request().method()==='POST'&&u.origin===connection.url.origin&&u.pathname===apiPath+'/source-values';
    },{timeout:180000});
    waiting.catch(()=>{});await sel('source-read').click();const response=await waiting;
    need(response.ok(),'STUDY_BROWSER_SOURCE_READ_REJECTED');
    const value=await response.json();
    need(value.dossierId===dossierId&&value.values?.length===pointers.length,'STUDY_BROWSER_SOURCE_VIEW_SCOPE_CHANGED');
    for(const item of value.values){
      const answer=sourceCase.answers.find(a=>a.bases.some(b=>b.pointer===item.pointer));
      need(answer&&item.contentSha256===sourceCase.source.sha256&&
        (answer.status==='not-reported'?!item.found:item.found&&same(item.typedValue,answer.value)),
        'STUDY_BROWSER_ORIGINAL_SOURCE_VALUE_CHANGED',{pointer:item.pointer});
    }
    const file=await retain(phase+'.source-values.json',value);await ready('sources');await capture(phase+'-source-values');
    journal.phases[key]={state:'inspected',file};await checkpoint();
  }
  async function download(name,phase){
    const existing=journal.phases[phase];
    if(existing?.state==='downloaded')return existing.file;
    const waiting=page.waitForEvent('download',{timeout:180000});waiting.catch(()=>{});
    await sel(name).click();const download=await waiting;
    const failure=await download.failure();need(!failure,'STUDY_BROWSER_DOWNLOAD_FAILED',{failure});
    const temporary=await download.path();need(temporary,'STUDY_BROWSER_COMPLETE_DOWNLOAD_REQUIRED');
    const bytes=await readFile(temporary);
    const originalFilename=download.suggestedFilename();
    const extension=extname(originalFilename);
    const suffix=/^\.[A-Za-z0-9]{1,12}$/.test(extension)?extension:'.bin';
    const filename=safeName(phase+'-'+sha(Buffer.from(originalFilename)).slice(0,12)+suffix);
    const file=await retain(filename,bytes);
    journal.phases[phase]={state:'downloaded',file,originalFilename,completedAt:new Date().toISOString()};
    await checkpoint();return file;
  }
  async function readSelected(phase,{verifyResolved=false}={}){
    const retained=await maybe(join(files,safeName(phase+'.selected-records.json')));
    let revision,results={};
    if(retained){
      const saved=JSON.parse(retained.toString('utf8'));
      need(saved.dossierId===dossierId&&same(saved.selection,journal.selection),'STUDY_BROWSER_RETAINED_SELECTION_CHANGED');
      ({revision}=saved);
      for(const key of ['forms','formEditions','resultSets','extractions','submissions','results','resolutions','impact','operations'])results[key]=saved[key];
    }else{
      const metadata=await client.metadata(dossierId);revision=metadata.revision;
      const options={revision,formId:journal.selection.formId,resultSetId:journal.selection.resultSetId};
      for(const section of ['forms','formEditions','resultSets','extractions','submissions','results','resolutions','impact','operations']){
        const value=await all(section,options);results[section]=value.items;
      }
    }
    const selected=results.resultSets.find(s=>s.id===journal.selection.resultSetId);
    need(selected&&selected.formEditionId===journal.selection.formEditionId&&
      selected.study.id===studyId&&selected.study.version===studyVersion&&selected.rows.length===14,
      'STUDY_BROWSER_SELECTED_RESULT_SCOPE_CHANGED');
    const current=results.results.filter(r=>r.current);
    need(current.length===14&&sourceCase.rows.every(r=>current.some(x=>x.record.row.id===r.id)),
      'STUDY_BROWSER_COMPLETE_RESULT_ROWS_REQUIRED');
    if(verifyResolved){
      need(results.extractions.length===2&&results.submissions.length===2&&results.resolutions.length===14&&
        current.every(r=>r.status==='RESOLVED'),'STUDY_BROWSER_COMPLETE_REVIEW_REQUIRED');
      for(const expected of sourceCase.answers){
        const result=current.find(r=>r.record.row.id===expected.rowId),actual=result.record.values?.[expected.fieldId];
        need(actual&&same(actual.value,expected.value)&&actual.status===expected.status,
          'STUDY_BROWSER_RESOLVED_SOURCE_VALUE_CHANGED',{rowId:expected.rowId,fieldId:expected.fieldId});
      }
      const target=current.find(r=>r.record.row.id===sourceCase.disagreement.rowId);
      const b=target.record.submissions.find(s=>s.actor.id===sourceCase.disagreement.actorId);
      need(same(b?.values?.value?.value,sourceCase.disagreement.enteredValue)&&
        target.record.resolution.mode==='adjudication','STUDY_BROWSER_INDEPENDENT_ENTRY_NOT_RETAINED');
    }
    const file=await retain(phase+'.selected-records.json',{dossierId,revision,selection:journal.selection,...results});
    journal.currentRevision=revision;await checkpoint();return {revision,current,results,file};
  }
  signal?.addEventListener('abort',onAbort,{once:true});
  try{
    checkAbort();
    const status=await client.status();
    need(!journal.workspaceId||journal.workspaceId===status.workspaceId,'STUDY_BROWSER_WORKSPACE_CHANGED');
    journal.workspaceId=status.workspaceId;
    const metadata=await client.metadata(dossierId);
    need(metadata.id===dossierId&&Number.isSafeInteger(metadata.revision),'STUDY_BROWSER_ORIGINAL_DOSSIER_REQUIRED');
    journal.originalRevision??=metadata.revision;journal.status='operating';await checkpoint();
    const playwright=await import(pathToFileURL(resolve(playwrightModule)).href);
    const chromium=playwright.chromium??playwright.default?.chromium;
    need(chromium,'STUDY_BROWSER_PLAYWRIGHT_REQUIRED');
    browser=await chromium.launch({executablePath:resolve(chromiumExecutable),headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    checkAbort();
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    checkAbort();page=await context.newPage();
    page.setDefaultTimeout(180000);
    page.on('pageerror',error=>{journal.browserErrors.push({kind:'page',message:redact(error.message),at:new Date().toISOString()});});
    page.on('console',message=>{if(message.type()==='error')journal.browserErrors.push({kind:'console',message:redact(message.text()),at:new Date().toISOString()});});
    await page.route('**/api/dossiers/**/extraction/**',async route=>{
      const request=route.request(),target=new URL(request.url());
      if(request.method()!=='POST'||![reviewPath,apiPath+'/publications/reviews'].includes(target.pathname)){await route.continue();return;}
      try{
        need(mode==='author'&&active&&target.origin===connection.url.origin&&target.pathname===reviewPath,'STUDY_BROWSER_UNEXPECTED_WRITE');
        const requestBody=request.postDataJSON();
        need(Object.keys(requestBody).sort().join(',')==='action,actor,data,expectedRevision,requestId'&&
          requestBody.action===active.action&&same(requestBody.actor,active.actor)&&same(requestBody.data,active.data),
          'STUDY_BROWSER_AUTHORED_REQUEST_CHANGED',{phase:active.phase});
        const phase=active.phase;
        requestWrite=(async()=>{
          const record=await retain(phase+'.request.json',requestBody);
          const p=journal.phases[phase];
          need(!p.request||p.request.sha256===record.sha256,'STUDY_BROWSER_SECOND_REQUEST_REJECTED',{phase});
          p.request=record;p.requestId=requestBody.requestId;p.expectedRevision=requestBody.expectedRevision;
          p.state='prepared';await checkpoint();
        })();
        await requestWrite;checkAbort();await route.continue();
      }catch(error){routeFailure=error;await route.abort('failed').catch(()=>{});}
    });
    progress('browser-open');
    await page.goto(connection.url.href,{waitUntil:'domcontentloaded',timeout:180000});
    await ready();await selectOriginals();
    if(mode==='author'){
      const [extractorA,extractorB,resolver]=sourceCase.reviewers;
      need(extractorA.id!==extractorB.id&&resolver.id===sourceCase.definition.resolverIds[0],
        'STUDY_BROWSER_INDEPENDENT_REVIEWERS_REQUIRED');
      const formData={questionId,name:'NCT03529110 complete registry extraction',description:
        'All fourteen original measurement rows and thirteen exact source-bound fields per row, including original denominator scopes and unreported values.',
        definition:clone(sourceCase.definition),reason:'Create the first complete source-bound form for the original registry commissioning review.'};
      const form=await committed('form-v1','create-form',resolver,formData,async()=>{
        await navigate('forms');await sel('new-form').click();await ready('forms');
        await chooseActor(resolver);await upload('form-import',formData,'form-v1');
        await sel('form-name').waitFor({state:'visible'});
        need(await sel('form-name').inputValue()===formData.name,'STUDY_BROWSER_FORM_IMPORT_INCOMPLETE');
      },'form-save');
      journal.selection.formId=form.result.formEdition.formId;
      journal.selection.formEditionId=form.result.formEdition.id;await checkpoint();await selectOriginals();
      const setData={formEditionId:journal.selection.formEditionId,studyId,studyVersion,
        name:'NCT03529110 fourteen reported measurement rows',description:
        'Complete original outcomes, classes, categories and group measurements, with separate denominator containers.',
        rows:clone(sourceCase.rows),reason:'Bind every original measurement to the existing question-specific study and the first form edition.'};
      const set=await committed('result-set-v1','create-result-set',resolver,setData,async()=>{
        await navigate('resultSets');await chooseActor(resolver);await upload('set-import',setData,'result-set-v1');
        await selectValue('study-select',studyId+'|'+studyVersion);
        need(await sel('set-name').inputValue()===setData.name,'STUDY_BROWSER_RESULT_IMPORT_INCOMPLETE');
      },'set-save');
      journal.selection.resultSetId=set.result.resultSet.id;await checkpoint();await selectOriginals();
      const submissions={};
      for(const [index,actor]of [extractorA,extractorB].entries()){
        const suffix=index===0?'a':'b',expected=studyCaseAnswers(sourceCase,{discrepant:index===1});
        const reason=index===0?
          'Extractor A retained all 182 original typed values and statuses, complete source locators, separate denominator scopes and missing/NA explanations.':
          'Extractor B completed the independent 182-answer entry. The commissioning deliberately changes only the selected 79.7 registry value to 79.0; preserve that entry for source-based resolution.';
        const data={resultSetId:journal.selection.resultSetId,answers:expected,reason};
        const draft=await committed('extractor-'+suffix+'-draft','save-extraction',actor,data,async()=>{
          await navigate('extract');await chooseActor(actor);
          const authored=clone(expected);
          if(index===1)authored.find(a=>a.rowId===sourceCase.disagreement.rowId&&a.fieldId==='value').value=clone(sourceCase.disagreement.originalValue);
          await upload('answers-import',{answers:authored,reason},'extractor-'+suffix);
          await inspectEntryRows(authored,'extractor-'+suffix);
          if(index===1){
            await selectValue('row-select',sourceCase.disagreement.rowId);
            await sel('answer-value-value').fill('79.0');
            need(await sel('answer-value-kind').inputValue()==='str'&&await sel('answer-value-value').inputValue()==='79.0',
              'STUDY_BROWSER_DISAGREEMENT_ENTRY_FAILED');
            await sel('answer-value-value').scrollIntoViewIfNeeded();await capture('extractor-b-disagreement');
          }
        },'extraction-save');
        journal.selection['extraction'+suffix.toUpperCase()+'Id']=draft.result.extraction.id;await checkpoint();
        const submissionData={extractionId:draft.result.extraction.id,reason};
        const submitted=await committed('extractor-'+suffix+'-submission','submit-extraction',actor,submissionData,async()=>{
          await navigate('extract');await chooseActor(actor);
          await sel('continue-'+draft.result.extraction.id).click();await ready('extract');
          need(await sel('extraction-reason').inputValue()===reason,'STUDY_BROWSER_SAVED_DRAFT_REASON_CHANGED');
          await sel('extraction-submit').waitFor({state:'visible'});
        },'extraction-submit');
        submissions[actor.id]=submitted.result.submission.id;
        journal.selection['submission'+suffix.toUpperCase()+'Id']=submitted.result.submission.id;await checkpoint();
      }
      await sourceView('author');
      for(const row of sourceCase.rows){
        const discrepant=row.id===sourceCase.disagreement.rowId;
        const data={resultSetId:journal.selection.resultSetId,rowId:row.id,
          submissionIds:[submissions[extractorA.id],submissions[extractorB.id]],mode:discrepant?'adjudication':'consensus',
          reason:reasonFor(row,discrepant),...(discrepant?{answers:sourceCase.definition.fields.map(f=>({
            fieldId:f.id,submissionId:submissions[extractorA.id]
          }))}:{})};
        const phase='resolve-'+row.id;
        const resolution=await committed(phase,'resolve-result',resolver,data,async()=>{
          await navigate('review');await chooseActor(resolver);await selectValue('review-row',row.id);
          await selectValue('resolution-mode',data.mode);
          if(discrepant)for(const f of sourceCase.definition.fields)
            await selectValue('resolve-choice-'+f.id,submissions[extractorA.id]);
          await sel('resolution-reason').fill(data.reason);
          if(discrepant){await sel('resolution-reason').scrollIntoViewIfNeeded();await capture('source-based-adjudication');}
        },'resolution-save');
        journal.reviewedRevision=resolution.revision;
        if(discrepant)journal.reviewRequestFile=journal.phases[phase].request.path;
        await checkpoint();
      }
      await readSelected('author-completed',{verifyResolved:true});
    }else{
      progress('inspect-received-selection');
      await readSelected('received-selection');
      await sourceView('received');
      await navigate('forms');await capture('received-form-edition');
      await navigate('resultSets');await capture('received-result-set');
      await navigate('review');await selectValue('review-row',sourceCase.disagreement.rowId);
      await capture('received-independent-submissions-and-resolution');
    }
    await navigate('overview');await capture(mode+'-overview');
    await download('export-json',mode+'-complete-extraction-json');
    await download('export-md',mode+'-complete-extraction-md');
    await download('export-html',mode+'-complete-extraction-html');
    await navigate('history');await capture(mode+'-history');
    if(mode==='author'&&journal.reviewRequestFile){
      const request=JSON.parse((await readFile(journal.reviewRequestFile)).toString('utf8'));
      if(await sel('request-download-'+request.requestId).count()){
        const downloaded=await download('request-download-'+request.requestId,'author-original-review-request');
        need(same(JSON.parse((await readFile(downloaded.path)).toString('utf8')),request),
          'STUDY_BROWSER_DOWNLOADED_REQUEST_CHANGED');
      }
    }
    await navigate('tables');
    if(journal.selection.tableId)await selectValue('table-select',journal.selection.tableId);
    if(journal.selection.publicationId)await selectValue('publication-select',journal.selection.publicationId);
    const publications=await sel('publication-select').count()?await sel('publication-select').locator('option').evaluateAll(nodes=>
      nodes.map(n=>({id:n.value,label:n.textContent}))):[];
    const selectedPublication=await sel('publication-select').count()?await sel('publication-select').inputValue():null;
    if(journal.selection.publicationId)need(selectedPublication===journal.selection.publicationId,
      'STUDY_BROWSER_PUBLICATION_SELECTION_CHANGED');
    await retain(mode+'.publication-selection.json',{selected:selectedPublication??null,publications});
    await capture(mode+'-publications');
    if(mode==='inspect'&&selectedPublication&&publications.some(p=>p.id===selectedPublication)){
      for(const format of ['json','csv','md','html'])
        await download('export-publication-'+format,'received-publication-'+format);
    }
    await page.setViewportSize({width:390,height:844});await navigate('review');
    await selectValue('review-row',sourceCase.disagreement.rowId);await capture(mode+'-mobile-review');
    await page.setViewportSize({width:1440,height:1000});
    // Same browser entry and original source selection after an ordinary page reload.
    await page.reload({waitUntil:'domcontentloaded',timeout:180000});await ready();await selectOriginals();
    await navigate('overview');await capture(mode+'-reopened-selection');
    const latest=await client.metadata(dossierId);journal.currentRevision=latest.revision;
    await context.close();context=null;await browser.close();browser=null;
    await client.close();checkAbort();
    const result={schema:SCHEMA,mode,dossierId,questionId,studyId,studyVersion,
      ...journal.selection,formId:journal.selection.formId,formEditionId:journal.selection.formEditionId,
      resultSetId:journal.selection.resultSetId,originalRevision:journal.originalRevision,
      reviewedRevision:journal.reviewedRevision??selection?.reviewedRevision??null,currentRevision:journal.currentRevision,
      reviewRequestFile:journal.reviewRequestFile??selection?.reviewRequestFile??null,
      nativeOutputs:{journalFile,resultFile:join(files,'result.json'),sourceCaseFile:sourceFile.path,artifacts:clone(journal.artifacts),
        requestFiles:Object.fromEntries(Object.entries(journal.phases).filter(([,p])=>p.request).map(([k,p])=>[k,p.request.path])),
        screenshots:clone(journal.screenshots),browserErrors:clone(journal.browserErrors)},
      completedAt:new Date().toISOString()};
    await retain('result.json',result);journal.result=result;journal.status='complete';await checkpoint();
    progress('complete');return clone(result);
  }catch(error){
    await requestWrite.catch(()=>{});
    if(signal?.aborted){
      error=Object.assign(abortError(),{cause:error});
      journal.cancelledAt=cancelledAt??new Date().toISOString();journal.status='cancelled';
    }else journal.status='interrupted';
    journal.error={code:error.code??error.name,message:redact(error.message),at:new Date().toISOString()};
    await checkpoint().catch(()=>{});
    Object.assign(error,{journalFile,runDirectory:directory});throw error;
  }finally{
    signal?.removeEventListener('abort',onAbort);
    await requestWrite.catch(()=>{});
    await cancellationClose;
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    await client.close().catch(()=>{});
  }
}
