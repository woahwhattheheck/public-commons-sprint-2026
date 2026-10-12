// MIT. One original Research publication -> Analysis browser receiving operation.
// The caller owns the already-running native Analysis host and its workspace.
import {readFile,writeFile,mkdir,open,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const SCHEMA='commons.synthesis-browser-receiving/v1';
const ID=/^[a-f0-9]{32}$/, SHA=/^[a-f0-9]{64}$/;
const REFERENCE_SHA='6a2ef0cbaf5ddd6032e78fa6a460a4f6daa91da96ff9ae747bdc4a84dfef1cf4';
const NEED=(value,message)=>{if(!value)throw new Error(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const digest=value=>hash(Buffer.from(canonical(value)));
const copy=value=>structuredClone(value);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function privateDirectory(value){
 NEED(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'),'An absolute owned receiving directory is required.');
 const selected=resolve(value);await mkdir(selected,{recursive:true,mode:0o700});
 const item=await lstat(selected);NEED(item.isDirectory()&&!item.isSymbolicLink(),'The receiving directory must be a real owned directory.');
 return realpath(selected);
}
async function atomic(file,bytes){
 const part=file+'.'+randomUUID()+'.partial';let fd;
 try{fd=await open(part,'wx',0o600);await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;
  await rename(part,file);const directory=await open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
 }catch(e){if(fd)await fd.close().catch(()=>{});await unlink(part).catch(()=>{});throw e;}
 NEED((await readFile(file)).equals(bytes),'The retained original request did not read back exactly.');
}
async function retain(file,bytes){
 try{const fd=await open(file,'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}}
 catch(e){if(e.code!=='EEXIST')throw e;NEED((await readFile(file)).equals(bytes),'An existing original receiving file changed: '+file);}
 const received=await readFile(file);NEED(received.equals(bytes),'The original received bytes changed: '+file);
 return {path:file,bytes:received.length,sha256:hash(received)};
}
function selectedUrl(value){
 const url=new URL(value);NEED(['http:','https:'].includes(url.protocol)&&
  ['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.hash.length>1&&!url.username&&!url.password,
  'Use the original private loopback Analysis launch URL.');
 NEED(!url.search,'The original Analysis launch must not carry credentials in a query string.');
 return url;
}
function descriptorBinding(item){
 const d=item.descriptor;NEED(d&&d.resultId&&d.editionId&&d.studyId&&d.status==='RESOLVED'&&
  d.record?.status==='RESOLVED'&&d.record?.row?.id&&d.record.values&&
  Array.isArray(d.sourceBindings)&&d.sourceBindings.length&&SHA.test(item.descriptor_sha256),
  'Every selected BCG result must be the complete original resolved descriptor.');
 return d;
}
function tagged(d,id){
 const field=d.record.values[id];
 NEED(field?.status==='reported'&&Array.isArray(field.value)&&field.value.length===2&&
  field.value[0]==='str'&&typeof field.value[1]==='string','The BCG original reported field changed: '+id);
 return field.value[1];
}
function translateProtocol(reference,sourcePage,names){
 NEED(reference.schema==='commons-research-reference-protocol/v1'&&reference.dataset==='metadat-bcg-13'&&
  reference.primary?.model==='random effects'&&reference.primary.method_re==='pm'&&
  reference.primary.inference?.scale==='estimated/HKSJ'&&reference.primary.inference.distribution==='t'&&
  reference.primary.inference.confidenceLevel==='0.95'&&reference.transformations?.zeroCorrection===null,
  'The selected original BCG reference protocol changed.');
 const wanted=reference.selection?.referenceStudyIds;
 NEED(Array.isArray(wanted)&&wanted.length===13&&new Set(wanted).size===13&&sourcePage.total===13&&
  sourcePage.results.length===13&&sourcePage.next_offset===null,'The complete original thirteen-study source is required.');
 const rows=new Map(),studyIds=new Set();
 for(const item of sourcePage.results){const d=descriptorBinding(item),key=d.record.row.id;
  NEED(wanted.includes(key)&&!rows.has(key)&&!studyIds.has(d.studyId),'The original Study/cohort selection changed.');
  for(const field of ['trial','author','year','tpos','tneg','cpos','cneg','ablat','alloc'])tagged(d,field);
  for(const field of ['tpos','tneg','cpos','cneg'])NEED(/^(0|[1-9][0-9]*)$/.test(tagged(d,field)),'An original BCG count changed.');
  rows.set(key,item);studyIds.add(d.studyId);
 }
 const originalRandom=reference.comparisons.find(v=>v.name==='random-allocation subgroup')?.referenceStudyIds;
 NEED(Array.isArray(originalRandom)&&canonical(originalRandom)===canonical(
  wanted.filter(key=>tagged(rows.get(key).descriptor,'alloc')==='random')),'The original random-allocation subset changed.');
 const question=reference.analysisQuestion;
 NEED(question?.timepoint?.selection==='SOURCE_TRIAL_DEFINED_FOLLOWUP'&&question.timepoint.duration===null,
  'The original unreported follow-up selection changed.');
 const cohort={population:question.population,outcome:question.outcome,intervention:question.intervention,
  comparator:question.comparator,timepoint:'Original source trial-defined follow-up; individual duration is unreported.',
  estimand:'Risk ratio of reported TB events, vaccinated versus control.',
  unit:'One independent comparison per distinct original BCG trial.'};
 const reason='Selected one complete resolved estimate from this original published BCG trial; reviewed its retained counts, source bindings and trial-defined observation.';
 const definition={schema:'stellar-forge.evidence-synthesis-plan.v1',title:reference.title,
  question:'Vaccinated versus control TB events in the thirteen original published BCG reference studies.',
  rationale:'Original published methods reference. '+reference.selection.aliasDeduplication+
   '. Preserve the original event/non-event counts, unreported individual follow-up and reported allocation labels.',
  reviewer:{id:'d7ca-bcg-reference-operator',name:'Commons BCG source reference operator'},cohort,measure:'RR',
  mapping:{kind:'binary',fields:{events_t:'tpos',total_t:{sum:['tpos','tneg']},
   events_c:'cpos',total_c:{sum:['cpos','cneg']}}},
  analysis:{model:'random',tau_method:'pm',interval:'hksj',alpha:0.05,continuity:'none',
   allow_derived:false,leave_one_out:true,pm_tolerance:1e-8,pm_max_iterations:500},
  selections:wanted.map(key=>{const item=rows.get(key),d=item.descriptor;return {
   result_id:d.resultId,edition_id:d.editionId,descriptor_sha256:item.descriptor_sha256,include:true,reason,
   cohort:copy(cohort),independence:'independent-groups',orientation:'as-selected',
   subgroups:{allocation:tagged(d,'alloc')}};}),
  subgroups:[{id:'allocation',label:'Original reported allocation',
   rationale:'Preserve the original dataset allocation labels; these labels do not replace independent design-specific appraisal.'}],
  sensitivity_sets:[{id:'random-allocation',label:'Original random-allocation studies',
   reason:'The original reference protocol selects trials 1, 2, 3, 4, 7, 8 and 9 by their reported random allocation.',
   omit_result_ids:wanted.filter(key=>!originalRandom.includes(key)).map(key=>rows.get(key).descriptor.resultId)}]};
 return {name:names.protocol,expected_revision:0,publication:{name:sourcePage.publication.name,
  revision:sourcePage.publication.revision,sha256:sourcePage.publication.sha256},definition};
}
async function chromiumSelection(playwrightModule,chromiumExecutable){
 let provider;
 if(playwrightModule){
  NEED(typeof playwrightModule==='string'&&isAbsolute(playwrightModule),'The selected installed Playwright module must be an absolute path.');
  provider=await import(pathToFileURL(playwrightModule).href);
 }else{
  try{provider=await import('playwright');}
  catch(original){
   const root=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
   if(!root)throw original;
   provider=createRequire(import.meta.url)(join(root,'playwright'));
  }
 }
 const chromium=provider.chromium??provider.default?.chromium;
 NEED(chromium?.launchPersistentContext,'The original installed Playwright Chromium is required.');
 const executable=chromiumExecutable??process.env.CHROME_BIN??process.env.CHROMIUM_EXECUTABLE_PATH;
 if(executable)NEED(isAbsolute(executable)&&!executable.includes('\0'),'Use the actual installed Chromium executable.');
 return {chromium,executable};
}
async function browserRecovery(page,workspaceId){
 return page.evaluate(async workspace=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('stellar-forge-synthesis',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{
   const values=await new Promise((resolve,reject)=>{const t=db.transaction('entries','readonly'),
    r=t.objectStore('entries').getAll(IDBKeyRange.bound(workspace+':',workspace+':\uffff'));
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const byKey=new Map(values.map(v=>[v.key,v.value])),requests=[];
   for(const [key,meta]of byKey)if(key.startsWith(workspace+':meta:')){
    const request=byKey.get(workspace+':request:'+meta.id);if(request)requests.push({meta,request});
   }
   return {schema:'stellar-forge.synthesis-browser-recovery.v1',workspace_id:workspace,requests,
    draft:byKey.get(workspace+':draft:protocol')??null};
  }finally{db.close();}
 },workspaceId);
}

/**
 * Owns only one persistent browser/profile; the caller owns the actual Analysis
 * host and the original Research/Analysis workspace. All mutations go through
 * the displayed original controls, including the complete JSON protocol editor.
 * Reinvoke with these exact inputs to continue the same original requests.
 */
export async function receiveSynthesisOperator({url,publicationFile,publicationSha256,protocolFile,
 outputDirectory,browserProfileDirectory,operationId,signal,playwrightModule,chromiumExecutable,
 timeoutMs=180000}={}){
 NEED(typeof operationId==='string'&&/^[A-Za-z0-9_-]{8,160}$/.test(operationId),'An original receiving operation ID is required.');
 NEED(Number.isSafeInteger(timeoutMs)&&timeoutMs>=10000&&timeoutMs<=1800000,'Choose a finite receiving timeout.');
 for(const file of [publicationFile,protocolFile])NEED(typeof file==='string'&&isAbsolute(file),'Use the complete original source files.');
 NEED(SHA.test(publicationSha256),'The original publication SHA-256 is required.');
 const launch=selectedUrl(url),raw=await readFile(publicationFile),referenceBytes=await readFile(protocolFile);
 NEED(hash(raw)===publicationSha256,'The selected frozen native publication bytes changed.');
 NEED(hash(referenceBytes)===REFERENCE_SHA,'The selected original BCG reference protocol bytes changed.');
 const document=JSON.parse(raw.toString('utf8')),reference=JSON.parse(referenceBytes.toString('utf8'));
 NEED(document.schema==='sf88-research-extraction-publication-report/v1'&&document.publications?.length===1&&
  document.publications[0].rows?.length===13&&document.publicationId,'Use the original frozen thirteen-result Research publication.');
 outputDirectory=await privateDirectory(outputDirectory);browserProfileDirectory=await privateDirectory(browserProfileDirectory);
 NEED(browserProfileDirectory!==outputDirectory,'Keep the owned browser profile in its own subdirectory.');
 const names={publication:'bcg_reference_'+hash(operationId).slice(0,12),protocol:'bcg_primary_'+hash(operationId).slice(0,12)};
 const binding={operationId,origin:launch.origin,outputDirectory,browserProfileDirectory,names,
  publication:{path:resolve(publicationFile),bytes:raw.length,sha256:publicationSha256,publicationId:document.publicationId},
  reference:{path:resolve(protocolFile),bytes:referenceBytes.length,sha256:hash(referenceBytes)}};
 const journalPath=join(outputDirectory,'synthesis-browser-operation.json');
 let journal=await optional(journalPath);
 if(journal)NEED(journal.schema===SCHEMA&&digest(journal.binding)===digest(binding),'The original browser receiving selection changed.');
 else journal={schema:SCHEMA,binding,workspace_id:null,requests:{},publication:null,protocol:null,
  plan:null,run:null,downloads:{},screenshots:[],observations:[],startedAt:new Date().toISOString(),completedAt:null};
 let tail=Promise.resolve(),fatal=null,context=null,closing=null;
 const save=()=>{const bytes=json(journal);const step=tail.then(()=>atomic(journalPath,bytes));tail=step.catch(()=>{});return step;};
 await save();
 const abort=()=>{if(signal?.aborted)throw signal.reason??new Error('Original synthesis browser receiving interrupted.');if(fatal)throw fatal;};
 const close=()=>{if(closing)return closing;if(!context)return Promise.resolve();closing=context.close().catch(e=>{closing=null;throw e;});return closing;};
 const onAbort=()=>{close().catch(e=>{fatal??=e;});};
 signal?.addEventListener('abort',onAbort,{once:true});
 let page,routeHandler;
 try{
  abort();const selected=await chromiumSelection(playwrightModule,chromiumExecutable);
  context=await selected.chromium.launchPersistentContext(browserProfileDirectory,{headless:true,
   ...(selected.executable?{executablePath:selected.executable}:{}),viewport:{width:1440,height:1000},
   acceptDownloads:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  abort();page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(timeoutMs);
  page.on('dialog',dialog=>dialog.accept().catch(e=>{fatal??=e;}));
  page.on('pageerror',error=>{fatal??=new Error('Original synthesis page error: '+error.message);});
  const endpoints={'/api/synthesis-publications':'publication','/api/synthesis-protocols':'protocol','/api/synthesis-runs':'run'};
  routeHandler=async route=>{
   const request=route.request(),path=new URL(request.url()).pathname,kind=endpoints[path];
   if(request.method()!=='POST'||!kind)return route.continue();
   try{
    abort();NEED(journal.workspace_id,'The original workspace must be read before its first mutation.');
    const bodyText=request.postData(),body=JSON.parse(bodyText);
    NEED(ID.test(body.id),'The browser must retain its original 32-character request ID.');
    if(kind==='publication'){
     NEED(body.name===names.publication&&body.expected_revision===0&&body.expected_sha256===publicationSha256&&
      body.raw_text===raw.toString('utf8')&&body.results_pointer==='/publications/0/rows'&&body.descriptor_pointer==='/result',
      'The original browser publication request changed.');
    }else if(kind==='protocol'){
     NEED(journal.plan&&canonical({...body,id:undefined})===canonical({...journal.plan,id:undefined}),
      'The reviewed native browser protocol changed before dispatch.');
    }else{
     NEED(journal.protocol&&body.protocol_name===journal.protocol.name&&body.protocol_revision===journal.protocol.revision&&
      body.protocol_sha256===journal.protocol.sha256,'The original reviewed run binding changed before dispatch.');
    }
    const prior=journal.requests[kind],entry={id:body.id,path,body_text:bodyText,body_sha256:hash(bodyText)};
    if(prior)NEED(canonical(prior)===canonical(entry),'A new browser request would replace the original retained operation.');
    else journal.requests[kind]=entry;
    const recovery=await browserRecovery(page,journal.workspace_id);
    const retained=recovery.requests.find(v=>v.request.id===body.id);
    NEED(retained?.request.body_text===bodyText&&retained.request.body_sha256===entry.body_sha256&&
     retained.meta.id===body.id,'The original UI did not durably retain the exact request before sending.');
    await atomic(join(outputDirectory,'synthesis-browser-recovery.json'),json(recovery));await save();
    await route.continue();
   }catch(e){fatal=e;await route.abort('failed').catch(()=>{});}
  };
  await page.route('**/api/**',routeHandler);
  const apiResponse=(path,method='GET')=>{const pending=page.waitForResponse(response=>{
   const u=new URL(response.url());return u.origin===launch.origin&&u.pathname===path&&response.request().method()===method;
  },{timeout:timeoutMs});pending.catch(()=>{});return pending;};
  const decode=async response=>{
   const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw new Error('The original browser response was incomplete: '+response.url());}
   NEED(response.ok()&&value&&!Array.isArray(value)&&typeof value==='object'&&!value.error,
    'Original browser API failed: '+(value?.error??response.status()));return value;
  };
  const idle=async()=>{
   await page.waitForFunction(()=>document.querySelector('#refresh')&&!document.querySelector('#refresh').disabled,null,{timeout:timeoutMs});
   abort();const error=page.locator('#message.error');if(await error.count())throw new Error(await error.innerText());
  };
  const escapeLabel=value=>value.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
  const control=(label,scope=page)=>scope.getByLabel(new RegExp('^'+escapeLabel(label)+'(?:\\s|$)'));
  const click=async(name,scope=page)=>{abort();await scope.getByRole('button',{name,exact:true}).click();await idle();};
  const post=async(action,path)=>{
   const waiting=apiResponse(path,'POST');await action();await idle();return decode(await waiting);
  };
  const originalState=apiResponse('/api/state');
  await page.goto(launch.href,{waitUntil:'domcontentloaded'});const state=await decode(await originalState);
  NEED(state.schema==='stellar-forge.customer-analysis.v1'&&ID.test(state.workspace_id),'The original Analysis workspace identity changed.');
  if(journal.workspace_id)NEED(journal.workspace_id===state.workspace_id,'The original browser workspace changed on reopen.');
  else{journal.workspace_id=state.workspace_id;await save();}
  const synthesisState=apiResponse('/api/state');
  await page.locator('#synthesis-link').click();await decode(await synthesisState);await idle();
  NEED(new URL(page.url()).pathname==='/synthesis','The actual Analysis navigation did not open synthesis.');
  NEED(await page.getByRole('heading',{name:'Evidence synthesis',exact:true}).count()===1,'The complete original synthesis page is required.');
  const recoveryPath=join(outputDirectory,'synthesis-browser-recovery.json');
  if(Object.keys(journal.requests).length){
   NEED(await optional(recoveryPath),'The original portable browser recovery record is required.');
   await click('Recovery');
   await control('Import a recovery file for this original workspace').setInputFiles(recoveryPath);
   await idle();
  }
  const recover=async kind=>{
   await click('Recovery');
   const retained=journal.requests[kind];NEED(retained,'Original request identity is missing.');
   const row=page.locator('tr').filter({hasText:retained.id});NEED(await row.count()===1,'Select the single original retained request.');
   return post(()=>row.getByRole('button',{name:/^(Retry original request|Reopen original result)$/}).click(),retained.path);
  };
  const publicationRead=()=>apiResponse('/api/synthesis-publications/'+names.publication);
  let sourcePage;
  if(journal.requests.publication){
   const waiting=publicationRead();const saved=await recover('publication');sourcePage=await decode(await waiting);
   NEED(saved.name===names.publication&&saved.revision===1&&saved.sha256===publicationSha256,'The original imported publication changed.');
  }else{
   await click('1 · Source');
   await control('Original source JSON').setInputFiles(publicationFile);await idle();
   await control('Publication name').fill(names.publication);
   await control('Expected current revision').fill('0');
   await control('Results array pointer').fill('/publications/0/rows');
   await control('Descriptor pointer within each result').fill('/result');
   await control('Original source context').fill(JSON.stringify({
    kind:'Original frozen Research extraction publication',operationId,publicationId:document.publicationId,
    referenceProtocol:{schema:reference.schema,operationId:reference.operationId,sha256:hash(referenceBytes)},
    sourceFile:{bytes:raw.length,sha256:publicationSha256},limitations:reference.limitations}));
   const waiting=publicationRead();
   const saved=await post(()=>page.getByRole('button',{name:'Import original publication',exact:true}).click(),'/api/synthesis-publications');
   sourcePage=await decode(await waiting);NEED(saved.name===names.publication&&saved.revision===1&&saved.sha256===publicationSha256,
    'The original imported publication identity changed.');
  }
  NEED(sourcePage.publication?.name===names.publication&&sourcePage.publication.revision===1&&
   sourcePage.publication.sha256===publicationSha256&&sourcePage.publication.bytes===raw.length,
   'The actual source browser edition differs from its frozen Research publication.');
  for(let i=0;i<sourcePage.results.length;i++)NEED(canonical(sourcePage.results[i].descriptor)===
   canonical(document.publications[0].rows[i].result),'The browser source altered an original native descriptor.');
  journal.publication=copy(sourcePage.publication);await save();
  await retain(join(outputDirectory,'synthesis-publication-browser-page.json'),json(sourcePage));
  const download=async(name,action,expected)=>{
   abort();const waiting=page.waitForEvent('download',{timeout:timeoutMs});waiting.catch(()=>{});await action();await idle();const actual=await waiting;
   const part=join(outputDirectory,'.download-'+randomUUID()+'.partial');
   try{await actual.saveAs(part);const bytes=await readFile(part);
    if(expected)NEED(bytes.length===expected.bytes&&hash(bytes)===expected.sha256,'The original browser download changed: '+name);
    const result=await retain(join(outputDirectory,name),bytes);journal.downloads[name]=result;await save();return result;
   }finally{await unlink(part).catch(()=>{});}
  };
  await download('bcg-original-publication.json',()=>page.getByRole('button',{name:'Download original source',exact:true}).click(),
   {bytes:raw.length,sha256:publicationSha256});
  await idle();
  const first=sourcePage.results.find(v=>v.descriptor.record.row.id===reference.selection.referenceStudyIds[0]);
  const firstIndex=sourcePage.results.indexOf(first);NEED(firstIndex>=0,'The first original reference study is missing.');
  await page.getByRole('button',{name:'Review result',exact:true}).nth(firstIndex).click();await idle();
  const sourcePanel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Review result · '+(first.descriptor.label||first.descriptor.resultId),exact:true})});
  await sourcePanel.locator('summary').filter({hasText:'Complete original descriptor and source bindings'}).click();
  const sourceText=await sourcePanel.innerText();
  NEED(sourceText.includes(first.descriptor.resultId)&&sourceText.includes(first.descriptor.editionId)&&
   sourceText.includes(first.descriptor_sha256)&&sourceText.includes('bcg-source-rows.json'),
   'The visible source review did not retain its actual descriptor and source pointers.');
  for(const field of ['tpos','tneg','cpos','cneg']){
   const row=sourcePanel.locator('tbody tr').filter({has:page.locator('td').filter({hasText:new RegExp('^'+field+'$')})});
   NEED(await row.count()===1,'The original source field was not uniquely displayed: '+field);
   const shown=await row.locator('td').nth(2).innerText();
   NEED(canonical(JSON.parse(shown))===canonical(first.descriptor.record.values[field].value),'An original numeric source token changed in the visible review.');
  }
  journal.observations.push({kind:'original-source-review',resultId:first.descriptor.resultId,
   editionId:first.descriptor.editionId,descriptorSha256:first.descriptor_sha256,fields:['tpos','tneg','cpos','cneg']});await save();
  if(await sourcePanel.getByRole('button',{name:'Close result detail',exact:true}).count())
   await click('Close result detail',sourcePanel);
  const plan=translateProtocol(reference,sourcePage,names);
  if(journal.plan)NEED(canonical(journal.plan)===canonical(plan),'The exact retained BCG protocol changed.');
  else{journal.plan=plan;await save();}
  await retain(join(outputDirectory,'synthesis-browser-protocol.json'),json(plan));
  if(journal.requests.protocol){
   journal.protocol=await recover('protocol');await save();
  }else{
   await click('Use this publication for a new protocol');
   const advanced=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Complete protocol source and portable editing'})});
   await advanced.locator('summary').first().click();
   await control('Load a complete protocol request or definition',advanced).fill(JSON.stringify(plan));
   await click('Load JSON into this editor',advanced);
   NEED(await control('Protocol name').inputValue()===names.protocol,'The actual protocol editor selected a different name.');
   NEED(await control('Intervention total').inputValue()==='tpos + tneg'&&
    await control('Comparator total').inputValue()==='cpos + cneg','The original explicit count sums changed.');
   // Review and keep one already-authored selection through the ordinary field controls.
   await click('Open selected source results');
   const decisionItem=sourcePage.results.find(v=>v.descriptor.record.row.id===reference.selection.referenceStudyIds.at(-1));
   const decisionIndex=sourcePage.results.indexOf(decisionItem);NEED(decisionIndex>=0,'The final original reference study is missing.');
   await page.getByRole('button',{name:'Review result',exact:true}).nth(decisionIndex).click();await idle();
   const reviewPanel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Review result · '+(decisionItem.descriptor.label||decisionItem.descriptor.resultId),exact:true})});
   NEED(await control('Decision',reviewPanel).inputValue()==='include'&&
    await control('I reviewed this result against all seven selected cohort and contrast fields.',reviewPanel).isChecked(),
    'The authored original result comparison was not retained in its ordinary controls.');
   await click('Keep reviewed decision',reviewPanel);
   await click('Close result detail',reviewPanel);
   await click('2 · Protocol');
   journal.protocol=await post(()=>page.getByRole('button',{name:'Save protocol edition',exact:true}).click(),'/api/synthesis-protocols');await save();
  }
  NEED(journal.protocol.name===names.protocol&&journal.protocol.revision===1&&
   canonical(journal.protocol.publication)===canonical(plan.publication)&&
   canonical(journal.protocol.definition)===canonical(plan.definition),'The immutable saved protocol changed.');
  // Cold page reopening uses original browser storage and the native saved edition.
  await page.reload({waitUntil:'domcontentloaded'});await idle();
  await control('History').selectOption('protocols');await idle();
  await click(names.protocol+' · revision 1',page.locator('#history'));
  NEED(await control('Expected current revision').inputValue()==='1','The saved protocol did not reopen at its original revision.');
  const review=await post(()=>page.getByRole('button',{name:'Review current saved protocol',exact:true}).click(),'/api/synthesis-review');
  NEED(review.saved_protocol?.sha256===journal.protocol.sha256&&review.can_run===true&&review.engine?.ready===true&&
   review.counts?.published_results===13&&review.counts.included_studies===13&&review.counts.estimable_results===13&&
   review.conflicts?.length===0,'The original thirteen-study native review is not ready.');
  NEED(review.rows.every(row=>row.source_bindings?.length&&row.effect),'The native effect review lost original source bindings.');
  await retain(join(outputDirectory,'synthesis-browser-native-review.json'),json(review));
  const studyTable=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Study selection and numeric review',exact:true})});
  NEED(await studyTable.locator('tbody tr').count()>=13,'The complete original study review is missing from the browser.');
  await studyTable.getByText('Values and transformations',{exact:true}).first().click();
  const reviewVisible=await studyTable.innerText();NEED(reviewVisible.includes('tpos')&&reviewVisible.includes('tneg')&&
   reviewVisible.includes('cpos')&&reviewVisible.includes('cneg'),'The visible exact numeric mappings are incomplete.');
  journal.review={protocolSha256:journal.protocol.sha256,counts:copy(review.counts),engine:copy(review.engine)};await save();
  if(journal.requests.run)journal.run=await recover('run');
  else journal.run=await post(()=>page.getByRole('button',{name:'Run reviewed synthesis',exact:true}).click(),'/api/synthesis-runs');
  NEED(journal.run.id===journal.requests.run.id&&journal.run.request?.protocol_sha256===journal.protocol.sha256,
   'The first original native job identity changed.');await save();
  const runId=journal.run.id;
  // Observe the actual UI's existing original polling; no second job is created.
  await page.waitForFunction(()=>{const panels=[...document.querySelectorAll('section.panel')];
   const panel=panels.find(p=>p.querySelector('h2')?.textContent==='Selected run');
   return panel&&[...panel.querySelectorAll('.facts>div')].some(d=>d.querySelector('b')?.textContent==='Status'&&
    ['COMPLETE','FAILED','INTERRUPTED','CANCELLED'].includes(d.querySelector('span')?.textContent));
  },null,{timeout:timeoutMs});abort();
  const selectedPanel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Selected run',exact:true})});
  const status=await selectedPanel.locator('.facts>div').filter({has:page.locator('b').filter({hasText:/^Status$/})}).locator('span').innerText();
  NEED(status==='COMPLETE','The original native synthesis ended '+status+': '+await selectedPanel.innerText());
  const originalRun=apiResponse('/api/jobs/'+runId);
  await page.getByRole('button',{name:'Refresh original run',exact:true}).click();journal.run=await decode(await originalRun);await idle();await save();
  NEED(journal.run.status==='COMPLETE'&&journal.run.id===runId&&journal.run.request.protocol_sha256===journal.protocol.sha256,
   'The completed original job selection changed.');
  const resultRead=apiResponse('/api/synthesis-runs/'+runId);
  await page.getByRole('button',{name:/^(Read complete result|Reload complete result|Load completed original result)$/}).click();
  const resultSummary=await decode(await resultRead);await idle();
  NEED(resultSummary.id===runId&&resultSummary.protocol.sha256===journal.protocol.sha256&&Array.isArray(resultSummary.files),
   'The completed browser result manifest changed.');
  await retain(join(outputDirectory,'synthesis-browser-result-manifest.json'),json(resultSummary));
  const filesPanel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Complete analysis files',exact:true})});
  const runFileRow=name=>filesPanel.locator('tbody tr').filter({has:page.locator('td').filter({hasText:new RegExp('^'+name.replace(/[.*+?^$()|[\]\\]/g,'\\$&')+'$')})});
  for(const name of ['report.html','synthesis.zip','result.json']){
   const record=resultSummary.files.find(f=>f.name===name);NEED(record,'The original analysis file is missing: '+name);
   await download(name,()=>runFileRow(name).getByRole('button',{name:'Download',exact:true}).click(),record);await idle();
  }
  const forest=resultSummary.files.find(f=>f.name.startsWith('forest')&&f.name.endsWith('.svg'));
  NEED(forest,'The original native forest figure is missing.');
  await click('View figure',runFileRow(forest.name));
  const img=page.getByRole('img',{name:'Original synthesis figure '+forest.name,exact:true});
  await img.waitFor({state:'visible'});await img.evaluate(async n=>{if(!n.complete)await new Promise((resolve,reject)=>{n.onload=resolve;n.onerror=reject;});if(!n.naturalWidth)throw Error('The original SVG figure did not render.');});
  const capture=async(name,viewport,locator)=>{
   await page.setViewportSize(viewport);await locator.scrollIntoViewIfNeeded();
   const bytes=await page.screenshot({fullPage:false,animations:'disabled'});
   const record=await retain(join(outputDirectory,name),bytes);
   const existing=journal.screenshots.find(v=>v.name===name);
   if(existing)NEED(existing.sha256===record.sha256,'The retained original screenshot changed on resume.');
   else journal.screenshots.push({name,viewport,...record});
   await save();
  };
  if(!journal.screenshots.some(v=>v.name==='synthesis-results-desktop.png'))
   await capture('synthesis-results-desktop.png',{width:1440,height:1000},img);
  const primary=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Primary result',exact:true})});
  NEED((await primary.innerText()).includes('13'),'The actual primary result does not show the original thirteen studies.');
  if(!journal.screenshots.some(v=>v.name==='synthesis-results-narrow.png'))
   await capture('synthesis-results-narrow.png',{width:390,height:844},primary);
  await page.setViewportSize({width:1440,height:1000});
  // Reopen the same job after a page reload, then receive its same final report.
  await page.reload({waitUntil:'domcontentloaded'});await idle();await click('4 · Results');
  await control('Open by original run ID').fill(runId);
  const reopenedWait=apiResponse('/api/jobs/'+runId);await page.getByRole('button',{name:'Open original run',exact:true}).click();
  const reopened=await decode(await reopenedWait);await idle();
  NEED(reopened.id===runId&&reopened.status==='COMPLETE'&&reopened.request.protocol_sha256===journal.protocol.sha256,
   'The same completed native run did not reopen.');
  const reopenedPanel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Complete analysis files',exact:true})});
  const reportRecord=resultSummary.files.find(f=>f.name==='report.html');
  const reportRow=reopenedPanel.locator('tbody tr').filter({has:page.locator('td').filter({hasText:/^report\.html$/})});
  await download('report.html',()=>reportRow.getByRole('button',{name:'Download',exact:true}).click(),reportRecord);await idle();
  await click('Recovery');
  // This actual operator export is kept apart from the before-dispatch snapshot.
  if(!journal.downloads['synthesis-browser-recovery-export.json'])
   await download('synthesis-browser-recovery-export.json',()=>page.getByRole('button',{name:'Export recovery file',exact:true}).click());
  for(const record of [...Object.values(journal.downloads),...journal.screenshots]){
   const bytes=await readFile(record.path);NEED(bytes.length===record.bytes&&hash(bytes)===record.sha256,'An original browser delivery file changed.');
  }
  journal.completedAt??=new Date().toISOString();
  journal.result={schema:SCHEMA,state:'COMPLETE',operationId,workspaceId:journal.workspace_id,
   publication:copy(journal.publication),protocol:{name:journal.protocol.name,revision:journal.protocol.revision,
    sha256:journal.protocol.sha256},jobId:runId,jobStatus:reopened.status,review:copy(journal.review),
   originalPublicationId:document.publicationId,originalRequests:Object.fromEntries(
    Object.entries(journal.requests).map(([kind,r])=>[kind,{id:r.id,path:r.path,body_sha256:r.body_sha256}])),
   downloads:copy(journal.downloads),screenshots:copy(journal.screenshots),journal:journalPath,
   browserProfileDirectory,completedAt:journal.completedAt};
  await save();await retain(join(outputDirectory,'synthesis-browser-result.json'),json(journal.result));
  await close();return copy(journal.result);
 }catch(error){journal.lastError={message:String(error.message??error),at:new Date().toISOString()};
  await save().catch(()=>{});throw error;
 }finally{
  signal?.removeEventListener('abort',onAbort);
  if(page&&routeHandler)await page.unroute('**/api/**',routeHandler).catch(()=>{});
  await close();await tail;
 }
}
