import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const configFile=process.argv[2];
if(!configFile)throw new Error('Usage: node run-browser.mjs /absolute/native-browser-config.json');
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
if(!path.isAbsolute(config.output||'')||!Array.isArray(config.launch)||!config.launch.length||config.launch.some(x=>typeof x!=='string'||!x))throw new Error('Set an absolute output directory and the original native helper command array in the browser configuration.');
const playwrightEntry=config.playwrightModule||process.env.PLAYWRIGHT_MODULE||'playwright';
const playwright=await import(path.isAbsolute(playwrightEntry)?pathToFileURL(playwrightEntry).href:playwrightEntry);
const chromium=playwright.chromium||playwright.default?.chromium;
if(!chromium)throw new Error('The configured original Playwright module has no Chromium driver.');
const OUT=config.output;
fs.mkdirSync(OUT,{recursive:true,mode:0o700});
fs.mkdirSync(path.join(OUT,'downloads'),{recursive:true,mode:0o700});
const checkpoint=path.join(OUT,'BROWSER_CHECKPOINT.json');
const C=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint,'utf8')):{startedAt:new Date().toISOString(),stages:{},downloads:[],writes:[],errors:[],requestIds:{},captureIds:{},sampleIds:{}};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=()=>fs.writeFileSync(checkpoint,JSON.stringify(C,null,2)+'\n',{mode:0o600});
const insist=(value,message)=>{if(!value)throw new Error(message)};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
C.attempts||=[];C.attempts.push({startedAt:new Date().toISOString(),driverSha256:digest(fs.readFileSync(import.meta.filename)),previousFailure:C.failure??null,priorErrorCount:C.errors.length});
const errorStart=C.errors.length,attemptIndex=C.attempts.length-1;save();
let service,browser,context,page,otherContext,base;
const pendingRequests=new WeakMap();
async function startApp(){
  let output='',ended=false;
  const fd=fs.openSync(path.join(OUT,'workspace-runtime.log'),'a',0o600);
  service=spawn(config.launch[0],config.launch.slice(1),{cwd:config.cwd||OUT,env:{...process.env,TMPDIR:config.tmpdir||OUT,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
  service.once('exit',()=>ended=true);
  service.stdout.on('data',b=>{output+=b.toString();fs.writeSync(fd,b)});
  service.stderr.on('data',b=>fs.writeSync(fd,b));
  service.once('close',()=>fs.closeSync(fd));
  for(let n=0;n<900;n++){
    for(const line of output.split('\n')){
      let value;try{value=JSON.parse(line)}catch{continue}
      const url=value.workspaceUrl||value.url;
      if(typeof url==='string'&&/^http:\/\/127\.0\.0\.1:\d+/.test(url)){
        base=url.replace(/\/$/,'');
        C.runtime={...C.runtime,...Object.fromEntries(Object.entries(value).filter(([key])=>['workspaceUrl','url','projectId','continuationProjectId','buyerProfileId','providerPlan','merchantUrl','merchantOrigin','merchantPrefix','stateDirectory','sourceRoot'].includes(key)))};
        C.projectId||=value.continuationProjectId||value.projectId||config.projectId;
        save();return;
      }
    }
    if(ended)throw new Error('Native market helper exited before opening: '+output.slice(-1800));
    await pause(100);
  }
  throw new Error('Native market helper did not report its actual workspace URL');
}
async function stopApp(){
  if(service&&service.exitCode===null){service.kill('SIGTERM');for(let n=0;n<150&&service.exitCode===null;n++)await pause(100);if(service.exitCode===null){service.kill('SIGKILL');await new Promise(resolve=>service.once('close',resolve))}}
}
async function get(route){
  const r=await fetch(base+route,{headers:{'X-Workspace-Request':'1'}});
  insist(r.ok,'Read '+route+' returned '+r.status+' '+(!r.ok?await r.text():''));
  return r.json();
}
async function all(kind,project=C.projectId){
  const out=[];let offset=0;
  for(;;){const r=await get('/api/projects/'+project+'/'+kind+'?offset='+offset+'&limit=100');out.push(...r.items);offset+=r.items.length;if(offset>=r.total)return out;insist(r.items.length,'Incomplete '+kind+' page')}
}
function watch(p,actor){
  const pending=new Set();pendingRequests.set(p,pending);
  p.on('request',r=>{if(r.url().startsWith(base+'/api/'))pending.add(r)});
  const finished=r=>pending.delete(r);p.on('requestfinished',finished);p.on('requestfailed',finished);
  p.on('pageerror',e=>{C.errors.push({attemptIndex,actor,type:'pageerror',message:String(e)});save()});
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource.*status of 409/.test(m.text())){C.errors.push({attemptIndex,actor,type:'console',message:m.text()});save()}});
  p.on('response',r=>{if(r.request().method()==='POST'&&r.url().startsWith(base+'/api/')){let body;try{body=r.request().postDataJSON()}catch{}C.writes.push({actor,at:new Date().toISOString(),path:new URL(r.url()).pathname,status:r.status(),opId:body?.opId});save()}});
  p.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
}
async function openPage(actor,ctx){
  await ctx.addInitScript(({actor,id})=>{localStorage.setItem('cg-market-operator',actor);if(id)localStorage.setItem('cg-market-project',id)},{actor,id:C.projectId});
  const p=await ctx.newPage();watch(p,actor);p.setDefaultTimeout(30000);
  await p.goto(base,{waitUntil:'domcontentloaded'});await p.locator('#project-select').waitFor();
  if(C.projectId)await p.waitForFunction(id=>document.querySelector('#project-select')?.value===id,C.projectId);
  await p.locator('#main h1,#main .empty h3').first().waitFor();
  return p;
}
async function ready(p=page){
  for(let n=0;n<300;n++){await p.waitForFunction(()=>!document.querySelector('#dialog[aria-busy]'),null,{timeout:30000});if(!(pendingRequests.get(p)?.size)){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));if(!(pendingRequests.get(p)?.size))return}await pause(100)}
  throw new Error('The operator interface is still processing its original request');
}
async function action(name,id='',p=page,scope=''){
  const selector=(scope?scope+' ':'')+'[data-action="'+name+'"]'+(id?'[data-id="'+id+'"]':'');
  await p.locator(selector).first().click();await ready(p);
}
async function close(p=page){if(await p.locator('#dialog').evaluate(d=>d.open)){await action('close-dialog','',p,'#dialog > .dialog-head');await p.waitForFunction(()=>!document.querySelector('#dialog').open)}}
async function nav(tab,p=page){await close(p);await action('nav',tab,p,'#nav');await p.locator('#main h1').waitFor()}
async function title(name,p=page){await p.locator('#dialog-title').filter({hasText:name}).waitFor()}
async function formField(name,value,p=page){
  const el=p.locator('#editor [name="'+name+'"]');
  const tag=await el.evaluate(e=>({tag:e.tagName,type:e.type,multiple:e.multiple}));
  if(tag.type==='checkbox'){if(value)await el.check();else await el.uncheck()}
  else if(tag.tag==='SELECT')await el.selectOption(Array.isArray(value)?value.map(String):String(value));
  else await el.fill(typeof value==='object'?JSON.stringify(value,null,2):String(value??''));
}
async function submit(route,{status=200,p=page}={}){
  const pending=p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===route,{timeout:120000});
  await p.locator('#editor button[type=submit]').click();
  const r=await pending,body=await r.json();await ready(p);
  insist(r.status()===status,'Save '+route+' returned '+r.status()+': '+JSON.stringify(body));
  return body;
}
async function shot(name,p=page){const file=path.join(OUT,name+'.png');await p.screenshot({path:file,fullPage:false});return file}
async function download(selector,name,p=page){
  const waiting=p.waitForEvent('download');await p.locator(selector).first().click();const d=await waiting;
  insist(!await d.failure(),'Download failed: '+name);const file=path.join(OUT,'downloads',name);await d.saveAs(file);
  const bytes=fs.readFileSync(file),result={path:file,name,bytes:bytes.length,sha256:digest(bytes),downloadName:d.suggestedFilename()};C.downloads.push(result);save();return result;
}
async function stage(name,fn){
  if(C.stages[name]?.status==='PASS'){console.log(JSON.stringify({stage:name,reused:true}));return}
  C.activeStage=name;save();console.log(JSON.stringify({stage:name,startedAt:new Date().toISOString()}));
  try{const result=await fn();C.stages[name]={status:'PASS',completedAt:new Date().toISOString(),...result};save();console.log(JSON.stringify({stage:name,status:'PASS',...result}))}
  catch(error){C.stages[name]={status:'FAILED',at:new Date().toISOString(),error:String(error)};save();throw error}
}
const sourceRoot=config.sourceRoot;
if(!path.isAbsolute(sourceRoot||''))throw new Error('Set sourceRoot to the absolute directory containing the five original unpaid provider response metadata/body pairs prepared by the native helper.');
const sources=[
  {endpoint:'simple-price',prefix:'public-unpaid',name:'Coin prices · original vendor source'},
  {endpoint:'token-prices',prefix:'onchain-token-price',name:'Base token prices · original vendor source'},
  {endpoint:'search-pools',prefix:'search-pools',name:'USDC pools · original vendor source'},
  {endpoint:'trending-pools',prefix:'trending-pools',name:'Base trending pools · original vendor source'},
  {endpoint:'token-data',prefix:'token-data',name:'Ethereum USDT · original vendor source'}
].map(item=>({...item,metadata:path.join(sourceRoot,item.prefix+'-response.json'),body:path.join(sourceRoot,item.prefix+'-response.bin')}));
for(const source of sources){source.original=JSON.parse(fs.readFileSync(source.metadata,'utf8'));source.originalBody=fs.readFileSync(source.body);insist(digest(source.originalBody)===source.original.body_sha256&&source.originalBody.length===source.original.bytes,'Original vendor body does not match '+source.prefix)}
try{
  await startApp();
  const state=await get('/api/state');
  if(!C.projectId){const existing=state.projects.find(p=>p.name===config.projectName)||state.projects[0];C.projectId=existing?.id;save()}
  browser=await chromium.launch({executablePath:config.chromium||process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--renderer-process-limit=2','--disable-background-networking']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  page=await openPage('Market operator 5403 A',context);

  async function refresh(p=page){await close(p);await action('refresh','',p);await ready(p)}
  async function openRecord(tab,kind,id,p=page){
    await nav(tab,p);
    if(tab==='sources')await action('pane',kind==='job'?'jobs':kind==='capture'?'captures':'files',p);
    if(tab==='research')await action('pane',kind==='snapshot'?'snapshots':kind==='comparison'?'comparisons':'notes',p);
    let wanted=p.locator('[data-action="'+kind+'"][data-id="'+id+'"]').first();
    if(!await wanted.count()){
      const search=p.locator('#main [data-search]').first();
      if(await search.count()){await search.fill(id);await pause(400);await ready(p)}
      wanted=p.locator('[data-action="'+kind+'"][data-id="'+id+'"]').first();
    }
    await wanted.click();await ready(p);
  }
  const simpleCanonical=value=>JSON.stringify(Object.fromEntries(Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b))));
  const canonicalValue=value=>JSON.stringify((function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v})(value));
  function requestFromSource(source){
    const contract=state.contracts.find(c=>c.id===source.endpoint),url=new URL(source.original.url);
    insist(contract,'Missing native contract '+source.endpoint);
    const nativeSegments=url.pathname.replace(/^\/api\/v3\/x402/,'').split('/');
    const templateSegments=contract.pathTemplate.split('/'),pathValues={},query={};
    insist(nativeSegments.length===templateSegments.length,'Source endpoint path differs from contract');
    templateSegments.forEach((segment,index)=>{
      const field=/^\{(.+)\}$/.exec(segment);
      if(field)pathValues[field[1]]=decodeURIComponent(nativeSegments[index]);
      else insist(segment===nativeSegments[index],'Source endpoint path segment differs from contract');
    });
    for(const [key,value]of url.searchParams){
      const field=contract.queryFields.find(f=>f.name===key);
      insist(field,'Original source has unknown parameter '+key);
      query[key]=field.type==='boolean'?value==='true':field.type==='integer'?Number(value):value;
    }
    return {name:source.name,endpoint:source.endpoint,path:pathValues,query,notes:'Original vendor observation '+source.original.observed_at+'. Original response and Bazaar example stay attached to this request.',enabled:true};
  }
  async function everyRow(route){
    let result=[],offset=0;
    for(;;){const r=await get(route+'?offset='+offset+'&limit=100');result.push(...r.items);offset+=r.items.length;if(offset>=r.total)return result;insist(r.items.length,'Incomplete row traversal')}
  }
  async function waitJob(jobId,states,{milliseconds=3600000}={}){
    const started=Date.now();let last='';
    for(;;){
      const j=(await get('/api/jobs/'+jobId)).job;
      const current=JSON.stringify({status:j.status,completed:j.completed,phase:j.phase,items:j.items.map(i=>({id:i.id,status:i.status,queue:i.originalQueue?.state,attempt:i.originalQueue?.attempt?.kind}))});
      if(current!==last){C.currentNativeOperation={jobId,observedAt:new Date().toISOString(),...JSON.parse(current)};save();console.log(JSON.stringify({nativeOperation:C.currentNativeOperation}));last=current}
      if(states.includes(j.status))return j;
      if(['failed','partial','cancelled','interrupted','archived'].includes(j.status)){
        C.retainedNativeFailure=j;save();throw new Error('Original operation '+jobId+' ended '+j.status+': '+JSON.stringify(j.errors||[]));
      }
      insist(Date.now()-started<milliseconds,'Original operation is still pending: '+jobId);
      await pause(2500);
    }
  }
  await stage('complete_original_requests_and_ordered_collection',async()=>{
    if(!C.projectId){
      await action('new-project');await formField('name',config.projectName||'CoinGecko Stellar market operations');
      const r=await submit('/api/projects',{status:201});C.projectId=r.value.id;save();
    }
    for(const source of sources){
      const desired=requestFromSource(source),current=(await all('requests')).find(r=>r.endpoint===desired.endpoint&&simpleCanonical(r.path)===simpleCanonical(desired.path)&&simpleCanonical(r.query)===simpleCanonical(desired.query));
      if(current){C.requestIds[source.endpoint]=current.id;save();continue}
      await nav('overview');await action('new-request',source.endpoint);await title('Configure request');
      await formField('name',desired.name);await formField('notes',desired.notes);
      const contract=state.contracts.find(c=>c.id===source.endpoint);
      for(const field of contract.pathFields)await formField('path.'+field.name,desired.path[field.name]??'');
      for(const field of contract.queryFields)await formField('query.'+field.name,desired.query[field.name]??'');
      await formField('enabled',true);
      const r=await submit('/api/projects/'+C.projectId+'/requests');C.requestIds[source.endpoint]=r.value.id;save();await title(desired.name);await close();
    }
    const requests=await all('requests');
    for(const source of sources){
      const request=requests.find(r=>r.id===C.requestIds[source.endpoint]),expected=requestFromSource(source);
      insist(request&&simpleCanonical(request.path)===simpleCanonical(expected.path)&&simpleCanonical(request.query)===simpleCanonical(expected.query),'Original source request was not retained: '+source.endpoint);
    }
    const name='Five original CoinGecko families · operator collection';
    let collection=(await all('collections')).find(c=>c.name===name);
    if(!collection){
      await nav('collections');await action('new-collection');await title('Create collection');
      await formField('name',name);
      await formField('description','Complete original coin, token-price, pool search, trending pool and token-detail requests. Inspect source identities before choosing the provider-operated Stellar payment terms.');
      for(const source of sources){await page.locator('#request-order-add').selectOption(C.requestIds[source.endpoint]);await action('order-add')}
      const r=await submit('/api/projects/'+C.projectId+'/collections');collection=r.value;
    }
    C.collectionId=collection.id;save();
    insist(JSON.stringify(collection.requestIds)===JSON.stringify(sources.map(s=>C.requestIds[s.endpoint])),'Collection did not preserve all five source families in their saved order');
    await openRecord('collections','collection',collection.id);
    C.collectionDownload=await download('a[href="/api/collections/'+collection.id+'/download"]','five-original-request-families.json');
    await shot('01-ordered-collection');await close();
    return {projectId:C.projectId,requestIds:C.requestIds,collectionId:C.collectionId,requestCount:collection.requestIds.length};
  });
  await stage('original_response_imports_and_complete_entity_research',async()=>{
    const retained=[];
    for(const source of sources){
      const name=source.name+' · original HTTP capture';
      let capture=(await all('captures')).find(c=>c.name===name&&c.requestId===C.requestIds[source.endpoint]);
      if(!capture){
        await nav('sources');await action('pane','captures');await action('import-response');await title('Import an original response');
        await formField('name',name);await formField('requestId',C.requestIds[source.endpoint]);
        await page.locator('#editor [name=sourceFile]').setInputFiles(source.metadata);
        await page.locator('#editor [name=responseBodyFile]').setInputFiles(source.body);
        await page.waitForFunction(url=>document.querySelector('#editor [name=sourceUrl]').value===url,source.original.url);
        insist(await page.locator('#editor [name=httpStatus]').inputValue()==='402','Original HTTP status did not populate');
        const imported=await submit('/api/projects/'+C.projectId+'/imports');capture=imported.value;
      }
      capture=(await get('/api/captures/'+capture.id)).capture;
      C.captureIds[source.endpoint]=capture.id;save();
      insist(capture.httpStatus===402&&capture.kind==='challenge'&&capture.requestUrl===source.original.url,'Original response identity changed during import');
      insist(capture.observedAt===source.original.observed_at,'Original fractional observation timestamp changed during import');
      insist(capture.rawBodyReference?.sha256===source.original.body_sha256&&capture.rawBodyReference?.bytes===source.original.bytes&&capture.rawBodyReference?.available===true,'Original response body was not retained exactly');
      insist(capture.bodyFileId&&capture.headersFileId&&capture.challengeFileId&&capture.sourceFileId,'Full source files were not retained');
      await openRecord('sources','capture',capture.id);
      const body=await download('a[href="/api/files/'+capture.bodyFileId+'/download"]',source.prefix+'-original-body.bin');
      insist(body.sha256===source.original.body_sha256&&body.bytes===source.original.bytes,'Downloaded original body differs');
      const sampleName=source.name+' · original Bazaar example';
      let sample=(await all('captures')).find(c=>c.name===sampleName&&c.parentCaptureId===capture.id);
      if(!sample){
        await action('sample',capture.id);await title('Retain the provider');
        await formField('name',sampleName);sample=(await submit('/api/projects/'+C.projectId+'/samples')).value;
      }
      sample=(await get('/api/captures/'+sample.id)).capture;
      C.sampleIds[source.endpoint]=sample.id;save();
      insist(sample.kind==='response'&&sample.basis==='provider_bazaar_example'&&sample.parentCaptureId===capture.id,'The original vendor example lost its source basis');
      const rows=await everyRow('/api/captures/'+sample.id+'/rows');
      insist(rows.length===sample.analysis.rowCount&&rows.length>0,'Original example rows are incomplete for '+source.endpoint);
      insist(rows.every(row=>row.sourceCaptureId===sample.id&&typeof row.sourcePointer==='string'),'Entity rows lost their original source pointers');
      await openRecord('sources','capture',sample.id);
      const firstRow=rows[0];
      await action('row',firstRow.id);
      await page.locator('#dialog .exact').first().waitFor();
      if(['search-pools','trending-pools'].includes(source.endpoint))await shot('02-'+source.endpoint+'-native-identities');
      retained.push({endpoint:source.endpoint,captureId:capture.id,sampleId:sample.id,originalBody:body,rowCount:rows.length,kinds:[...new Set(rows.map(r=>r.kind))],paymentOptions:capture.challenge.accepts.length,sourcePointer:sample.sourcePointer});
      await close();
    }
    C.originalSources=retained;save();
    return {families:retained.length,totalRows:retained.reduce((n,s)=>n+s.rowCount,0),sources:retained.map(({originalBody,...s})=>s)};
  });
  await stage('two_operator_merge_preserves_current_source_binding',async()=>{
    const id=C.requestIds['simple-price'],before=(await get('/api/requests/'+id)).request;
    C.concurrentOriginal||={name:before.name,notes:before.notes,path:before.path,query:before.query};save();
    const desiredName='Coin prices · reviewed source and original purchase';
    const desiredNotes=C.concurrentOriginal.notes+'\nOperator B: retain exact request parameters, original source timestamp and both published vendor payment networks.';
    const already=before.name===desiredName&&before.notes===desiredNotes;
    if(!already){
      await openRecord('requests','edit-request',id);
      otherContext=await browser.newContext({viewport:{width:1320,height:900}});
      const other=await openPage('Market operator 5403 B',otherContext);
      await openRecord('requests','edit-request',id,other);
      await formField('name',desiredName);
      await formField('notes',desiredNotes,other);
      await submit('/api/requests/'+id,{p:other});
      const rejected=await submit('/api/requests/'+id,{status:409});
      insist(['STALE_REVISION','STALE_VERSION'].includes(rejected.error),'Expected the actual two-operator revision conflict');
      await page.locator('#conflict-panel:not([hidden])').waitFor();
      await shot('03-two-operator-review');
      await action('apply-merge');
      insist(await page.locator('#editor [name=name]').inputValue()===desiredName,'Operator A name was lost');
      insist(await page.locator('#editor [name=notes]').inputValue()===desiredNotes,'Operator B notes were lost');
      await submit('/api/requests/'+id);
      await otherContext.close();otherContext=null;
      C.concurrent409=true;save();
    }
    const after=(await get('/api/requests/'+id)).request;
    insist(after.name===desiredName&&after.notes===desiredNotes&&simpleCanonical(after.path)===simpleCanonical(C.concurrentOriginal.path)&&simpleCanonical(after.query)===simpleCanonical(C.concurrentOriginal.query),'Reviewed merge changed source bindings or lost one operator edit');
    await close();
    return {requestId:id,version:after.version,actualConflict:C.concurrent409===true,sourceParametersUnchanged:true};
  });
  await stage('freeze_original_five_family_baseline',async()=>{
    const name='Original vendor examples · five-family frozen baseline';
    let snapshot=(await all('snapshots')).find(s=>s.name===name);
    if(!snapshot){
      await nav('research');await action('pane','snapshots');await action('new-snapshot');
      await formField('name',name);await formField('collectionId',C.collectionId);
      await formField('captureIds',sources.map(s=>C.sampleIds[s.endpoint]));
      snapshot=(await submit('/api/projects/'+C.projectId+'/snapshots')).value;
    }
    C.baselineSnapshotId=snapshot.id;save();
    const full=await get('/api/snapshots/'+snapshot.id);
    insist(full.captures.length===5&&full.captures.every(c=>c.basis==='provider_bazaar_example'),'Frozen baseline lost a source family or basis');
    await openRecord('research','snapshot',snapshot.id);
    C.baselineDownload=await download('a[href="/api/snapshots/'+snapshot.id+'/download"]','original-five-family-baseline.json');
    await shot('04-frozen-five-family-research');await close();
    return {snapshotId:snapshot.id,sourceCount:5,rowCount:snapshot.summary.rowCount};
  });

  await stage('complete_provider_deployment_and_current_configuration',async()=>{
    const input=C.runtime.providerPlan||config.providerPlan;
    insist(input&&input.publicOrigin&&input.accepts?.length,'Native helper must return its original public provider plan');
    insist(input.endpointIds?.length===5,'The native provider must serve all five endpoint families');
    let provider=(await all('provider-plans')).find(p=>p.name===input.name&&p.publicOrigin===input.publicOrigin&&p.pathPrefix===input.pathPrefix);
    if(!provider){
      await nav('provider');await action('new-provider');await title('Create provider deployment');
      await formField('name',input.name);await formField('publicOrigin',input.publicOrigin);
      await formField('pathPrefix',input.pathPrefix);await formField('endpointIds',input.endpointIds);
      await formField('upstreamOrigin',input.upstream?.origin||'');
      await formField('upstreamBasePath',input.upstream?.basePath||'');
      await formField('apiKeyEnv',input.upstream?.apiKeyEnv||'');
      await formField('endpointAccepts',input.endpointAccepts||{});
      const named=['scheme','network','asset','amount','payTo','maxTimeoutSeconds'];
      for(let i=0;i<input.accepts.length;i++){
        const terms=input.accepts[i];await action('term-add');
        const card=page.locator('[data-term-index="'+i+'"]');
        for(const key of named)await card.locator('[data-term-field="'+key+'"]').fill(String(terms[key]??''));
        const extra=Object.fromEntries(Object.entries(terms).filter(([key])=>!named.includes(key)));
        await card.locator('[data-term-extra]').fill(JSON.stringify(extra,null,2));
      }
      provider=(await submit('/api/projects/'+C.projectId+'/provider-plans')).value;
    }
    C.providerPlanId=provider.id;save();
    const full=await get('/api/provider-plans/'+provider.id);
    insist(canonicalValue(full.plan.accepts)===canonicalValue(input.accepts),'The complete ordered native provider payment options changed');
    insist(full.plan.endpointIds.length===5&&Object.keys(full.compiled.spec.paths).length===5,'Provider deployment omitted an endpoint family');
    await openRecord('provider','provider-plan',provider.id);
    C.providerDownload=await download('a[href="/api/provider-plans/'+provider.id+'/download"]','provider-controlled-stellar-deployment.json');
    await shot('05-complete-provider-deployment');
    await action('use-provider',provider.id);await title('Project configuration');
    const buyerProfile=C.runtime.buyerProfileId||config.buyerProfileId;
    insist(state.buyerProfiles.some(p=>p.id===buyerProfile),'Original funded buyer profile is unavailable in this workspace');
    await formField('buyerProfileId',buyerProfile);
    await submit('/api/projects/'+C.projectId+'/config');
    const current=(await get('/api/projects/'+C.projectId)).project,requests=(await get('/api/collections/'+C.collectionId)).requests;
    insist(current.config.merchantOrigin===input.publicOrigin&&current.config.buyerProfileId===buyerProfile,'Selected provider and original buyer profile were not saved');
    for(const request of requests)insist(request.urls.merchant.startsWith(input.publicOrigin+input.pathPrefix+'/'),'Current request view did not derive the configured merchant URL');
    C.buyerProfileId=buyerProfile;save();
    return {providerPlanId:provider.id,families:full.plan.endpointIds,paymentOptions:full.plan.accepts.length,merchantOrigin:current.config.merchantOrigin,buyerProfileId:buyerProfile};
  });
  await stage('observe_all_five_original_merchant_challenges',async()=>{
    const name='Original five-family native Stellar merchant observations';
    let job=C.merchantProbeId?(await get('/api/jobs/'+C.merchantProbeId)).job:(await all('jobs')).find(j=>j.name===name&&j.kind==='probe');
    if(!job){
      await nav('sources');await action('pane','captures');await action('probe');await title('Observe original endpoint responses');
      await formField('name',name);await formField('target','merchant');
      await formField('requestIds',sources.map(s=>C.requestIds[s.endpoint]));
      job=(await submit('/api/projects/'+C.projectId+'/probes',{status:202})).value;
      C.merchantProbeId=job.id;save();
    }
    C.merchantProbeId=job.id;save();
    if(['interrupted','partial','failed','cancelled'].includes(job.status)&&job.canResume&&!job.items.some(i=>i.attempts?.length>1)){
      await openRecord('sources','job',job.id);
      const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/jobs/'+job.id+'/resume');
      await action('job-resume',job.id);const r=await response;insist(r.status()===202,'Original unsigned observation could not resume');await ready();
    }
    job=await waitJob(job.id,['completed']);
    insist(job.items.length===5&&job.items.every(i=>i.status==='completed'&&i.resultCaptureId),'One native merchant source was not observed');
    C.merchantCaptureIds={};const captures=[];
    for(const item of job.items){
      const capture=(await get('/api/captures/'+item.resultCaptureId)).capture;
      insist(capture.httpStatus===402&&capture.kind==='challenge'&&capture.basis==='native_unsigned','Native merchant response is not its actual unsigned payment challenge');
      insist(capture.challenge.accepts.some(t=>t.network==='stellar:testnet'),'Native merchant challenge did not retain actual testnet terms');
      insist(capture.advertisedResourceUrl===capture.requestUrl,'Native merchant resource does not bind the exact request');
      C.merchantCaptureIds[capture.endpoint]=capture.id;
      captures.push({endpoint:capture.endpoint,id:capture.id,requestUrl:capture.requestUrl,accepts:capture.challenge.accepts});
    }
    save();await openRecord('sources','job',job.id);await shot('06-five-family-native-observation');await close();
    return {jobId:job.id,completed:job.completed,captures};
  });
  await stage('one_explicit_original_stellar_purchase',async()=>{
    const name='One original testnet purchase · CoinGecko coin response';
    let job=C.purchaseJobId?(await get('/api/jobs/'+C.purchaseJobId)).job:(await all('jobs')).find(j=>j.kind==='checkout'&&j.name===name);
    if(!job){
      const capture=(await get('/api/captures/'+C.merchantCaptureIds['simple-price'])).capture;
      const index=capture.challenge.accepts.findIndex(t=>t.network==='stellar:testnet');
      insist(index>=0,'An actual native testnet payment option is required');
      C.selectedPurchase={requestId:C.requestIds['simple-price'],captureId:capture.id,acceptIndex:index,terms:capture.challenge.accepts[index],requestUrl:capture.requestUrl};save();
      await openRecord('collections','collection',C.collectionId);await action('checkout',C.collectionId);await title('Prepare collection checkout');
      await formField('name',name);await formField('buyerProfileId',C.buyerProfileId);
      await page.locator('[data-checkout="'+C.selectedPurchase.requestId+'"]').selectOption(capture.id+':'+index);
      await action('checkout-source',C.selectedPurchase.requestId);
      insist(await page.locator('[data-checkout]').evaluateAll(els=>els.filter(e=>e.value).length)===1,'Only the one explicit original purchase may be selected');
      await shot('07-selected-original-stellar-terms');
      job=(await submit('/api/collections/'+C.collectionId+'/checkout',{status:202})).value;
      C.purchaseJobId=job.id;save();
    }
    C.purchaseJobId=job.id;save();
    insist(job.items.length===1,'The native operation must contain exactly one intended purchase');
    if(!['completed','prepared'].includes(job.status)){
      if(['interrupted','failed','partial','cancelled'].includes(job.status)){
        if(job.canRecover){
          await openRecord('sources','job',job.id);
          const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/jobs/'+job.id+'/recover');
          await action('job-recover',job.id);const r=await response;insist(r.status()===202,'Original result recovery did not start');await ready();
        }else if(job.canResume&&!job.purchaseStarted&&!job.items.some(i=>i.originalQueue?.attempt)){
          await openRecord('sources','job',job.id);
          const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/jobs/'+job.id+'/resume');
          await action('job-resume',job.id);const r=await response;insist(r.status()===202,'Original purchase intake did not resume');await ready();
        }else{C.retainedPurchase=job;save();throw new Error('Inspect the retained original purchase '+job.id+'; no second paid attempt was created')}
      }
      job=await waitJob(job.id,['prepared','completed']);
    }
    if(job.status==='prepared'){
      insist(job.canExecute&&!job.purchaseStarted&&!job.items.some(i=>i.originalQueue?.attempt),'Original prepared operation is not available for its first execution');
      C.purchaseExecuteRequestedAt=new Date().toISOString();C.originalIntentId=job.items[0].intentId;save();
      await openRecord('sources','job',job.id);await shot('08-original-purchase-intake');
      const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/jobs/'+job.id+'/execute',{timeout:120000});
      await action('job-execute',job.id);const r=await response;
      insist(r.status()===202,'Native purchase execution was not accepted: '+r.status());await ready();
      job=await waitJob(job.id,['completed']);
    }
    const item=job.items[0],capture=(await get('/api/captures/'+item.resultCaptureId)).capture;
    insist(item.originalQueue?.attempt?.kind==='EXECUTE'&&capture.basis==='native_buyer'&&capture.httpStatus===200,'Original native purchase did not return its actual response');
    insist(item.originalQueue?.outcome?.responseFile?.status==='SAVED','Original SF88 response download was not saved');
    insist(!job.canExecute&&!job.canResume,'Completed native purchase must not offer another paid execution');
    C.paidCaptureId=capture.id;C.originalIntentId=item.intentId;C.retainedPurchase=job;save();
    await openRecord('sources','capture',capture.id);
    C.paidResponseDownload=await download('a[href="/api/files/'+capture.bodyFileId+'/download"]','native-stellar-paid-response.bin');
    const originalSample=(await get('/api/captures/'+C.sampleIds['simple-price'])).capture;
    const originalFile=(await get('/api/files/'+originalSample.bodyFileId)).file;
    insist(C.paidResponseDownload.sha256===originalFile.sha256&&C.paidResponseDownload.bytes===originalFile.bytes,'Provider callback did not deliver the original published example bytes');
    insist(C.paidResponseDownload.sha256===item.originalQueue.outcome.responseFile.sha256,'Original SF88 result and retained response hashes differ');
    const rows=await everyRow('/api/captures/'+capture.id+'/rows');
    insist(rows.length===originalSample.analysis.rowCount,'Native response entity rows are incomplete');
    await shot('09-original-native-purchase-outcome');await close();
    return {jobId:job.id,intentId:item.intentId,originalState:item.originalQueue.state,originalOutcome:item.originalQueue.outcome,paidCaptureId:capture.id,response:C.paidResponseDownload,rows:rows.length,dataBasis:'Original vendor Bazaar example bytes delivered through the actual provider callback and native Stellar testnet payment'};
  });
  await stage('complete_research_comparison_and_source_review',async()=>{
    const currentName='Actual native delivery and four original vendor sources';
    let snapshot=(await all('snapshots')).find(s=>s.name===currentName);
    if(!snapshot){
      await nav('research');await action('pane','snapshots');await action('new-snapshot');
      await formField('name',currentName);await formField('collectionId',C.collectionId);
      await formField('captureIds',sources.map(s=>s.endpoint==='simple-price'?C.paidCaptureId:C.sampleIds[s.endpoint]));
      snapshot=(await submit('/api/projects/'+C.projectId+'/snapshots')).value;
    }
    C.currentSnapshotId=snapshot.id;save();
    const comparisonName='Original provider bytes compared with actual native delivery';
    let comparison=(await all('comparisons')).find(c=>c.name===comparisonName);
    if(!comparison){
      await nav('research');await action('pane','comparisons');await action('new-comparison');
      await formField('name',comparisonName);await formField('baselineId',C.baselineSnapshotId);await formField('currentId',snapshot.id);
      comparison=(await submit('/api/projects/'+C.projectId+'/comparisons')).value;
    }
    C.comparisonId=comparison.id;save();
    const rows=await everyRow('/api/comparisons/'+comparison.id+'/rows');
    insist(rows.length>0&&rows.every(r=>r.status==='unchanged'),'Exact original bytes changed between native delivery and source comparison');
    insist(rows.every(r=>r.baselineRow&&r.currentRow),'Complete comparison omitted either source row');
    await openRecord('research','comparison',comparison.id);
    C.comparisonDownload=await download('a[href="/api/comparisons/'+comparison.id+'/download"]','original-vs-native-delivery-comparison.json');
    await shot('10-exact-source-comparison');await close();
    const name='Operating interpretation and provider deployment handover';
    let note=(await all('notes')).find(n=>n.title===name);
    const text=[
      'The five vendor observations retain the original 402 status, precise observation timestamps, complete payment-required headers and original bodies. Original body sizes and observation times: '+sources.map(source=>source.endpoint+' — '+source.originalBody.length+' bytes at '+source.original.observed_at).join('; ')+'.',
      'CoinGecko advertises its original Base/Solana options. The additional provider-controlled Stellar routes use the existing SF61/SF30 seller and one original SF88 testnet purchase.',
      'The original native merchant callback in this development journey serves the exact published Bazaar example bytes. The completed payment proves that provider callback delivery and native payment operation; these example values do not represent a fresh market quote.',
      'The current snapshot selects the actual native delivery for coin prices and the retained vendor examples for the other four families. The exact comparison correctly reports unchanged underlying data, with both source rows and their distinct capture bases still available.',
      'Token network, contract address, pool identity, included entities, market-cap availability, FDV fallback and source numeric representation remain separate in the operating record.',
      'The saved provider deployment covers all five families. A provider can connect its own data callback or its licensed upstream environment using the named key variable. Commercial data rights and the proposed workshare remain part of the existing provider conversation.',
      'The complete archive includes the original source files, project versions, native outcomes, researcher notes and runnable source. Restoring it creates separate project IDs while original payment attempts remain historical.'
    ].join('\n\n');
    if(!note){
      await nav('research');await action('pane','notes');await action('new-note');
      await formField('title',name);await formField('targetType','comparison');await formField('targetId',comparison.id);
      await formField('type','research');await formField('status','reviewed');await formField('assignee','Stellar market delivery team');
      await formField('text',text);
      const paid=(await get('/api/captures/'+C.paidCaptureId)).capture;
      await formField('sourceFileIds',[
        paid.bodyFileId,...(await Promise.all(sources.map(async s=>(await get('/api/captures/'+C.captureIds[s.endpoint])).capture.sourceFileId)))
      ]);
      note=(await submit('/api/projects/'+C.projectId+'/notes')).value;
    }
    C.reviewNoteId=note.id;save();
    insist(note.status==='reviewed'&&note.text===text,'Complete source interpretation was not retained');
    await openRecord('research','note',note.id);await shot('11-complete-operating-review');await close();
    return {snapshotId:snapshot.id,comparisonId:comparison.id,unchangedRows:rows.length,noteId:note.id};
  });

  await stage('complete_archive_actual_close_reopen_and_separate_restore',async()=>{
    const originalProjectId=C.projectId,name='CoinGecko Stellar market · complete operating handover';
    let archive=C.archiveId?(await all('exports')).find(e=>e.id===C.archiveId):(await all('exports')).find(e=>e.name===name);
    if(!archive){
      await nav('handover');await action('new-export');await title('Create complete project archive');
      await formField('name',name);await formField('snapshotId',C.currentSnapshotId);await formField('comparisonId',C.comparisonId);
      archive=(await submit('/api/projects/'+C.projectId+'/exports')).value;
    }
    C.archiveId=archive.id;save();
    await openRecord('handover','export',archive.id);
    if(!C.archiveDownload)C.archiveDownload=await download('a[href="/api/exports/'+archive.id+'/download"]','CoinGecko-Stellar-Market-Complete-Handover.json.gz');
    insist(C.archiveDownload.sha256===archive.sha256&&C.archiveDownload.bytes===archive.bytes,'Complete handover download differs from its retained archive');
    const {gunzipSync}=await import('node:zlib');
    const raw=gunzipSync(fs.readFileSync(C.archiveDownload.path)),payload=JSON.parse(raw.toString('utf8'));
    insist(payload.schema==='stellar-forge.coingecko-handover.v1','Unexpected complete handover schema');
    insist(payload.payload.project.id===originalProjectId&&payload.payload.records.length>0,'Complete handover omitted original project records');
    const runtimeFiles=payload.runtime.files;
    const prefix='stellar/scf-starforge-20261009/partners/coingecko-stellar-market/';
    insist(runtimeFiles.filter(f=>f.path.startsWith(prefix)).length===19,'Complete archive does not contain all 19 published product files');
    insist(runtimeFiles.some(f=>f.path.endsWith('/sf36-cloud-runtime/resource_governor.py')||f.path.includes('/sf36-')&&f.path.endsWith('.py')),'Complete runtime archive omitted the original Python governor');
    for(const source of runtimeFiles){
      const bytes=Buffer.from(source.contentBase64,'base64');
      insist(bytes.length===source.bytes&&digest(bytes)===source.sha256,'Retained runtime source bytes changed: '+source.path);
    }
    for(const file of payload.payload.files){
      const bytes=Buffer.from(payload.payload.blobs[file.sha256],'base64');
      insist(bytes.length===file.bytes&&digest(bytes)===file.sha256,'Complete project omitted original file bytes: '+file.name);
    }
    C.archiveSummary={runtimeFiles:runtimeFiles.length,productFiles:19,records:payload.payload.records.length,originalFiles:payload.payload.files.length,expandedBytes:raw.length,sha256:archive.sha256};save();
    await shot('12-complete-project-handover');await close();
    if(!C.actualReopen){
      const before=(await get('/api/jobs/'+C.purchaseJobId)).job;
      await page.close();await context.close();context=null;
      await stopApp();await startApp();
      const after=(await get('/api/jobs/'+C.purchaseJobId)).job;
      insist(after.status==='completed'&&after.items[0].intentId===before.items[0].intentId&&canonicalValue(after.items[0].originalQueue)===canonicalValue(before.items[0].originalQueue),'Actual close/reopen changed the original native purchase');
      insist(!(await all('jobs')).some(j=>j.kind==='checkout'&&j.id!==C.purchaseJobId),'Workspace restart created another checkout');
      context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      page=await openPage('Market operator 5403 A',context);
      C.actualReopen={completedAt:new Date().toISOString(),jobId:after.id,originalIntentId:after.items[0].intentId};save();
    }
    if(!C.restoredProjectId){
      await nav('handover');await action('restore');await title('Restore a complete project');
      await formField('name','Restored CoinGecko Stellar market · full source continuity');
      await page.locator('#editor [name=sourceFile]').setInputFiles(C.archiveDownload.path);
      const restored=(await submit('/api/restore',{status:201})).value;
      C.restoredProjectId=restored.project.id;C.restoreMapping=restored.mapping;save();
      await title('Project restored');await shot('13-complete-separate-project-restore');await close();
    }else{
      await page.locator('#project-select').selectOption(C.restoredProjectId);await ready();
    }
    const restored=(await get('/api/projects/'+C.restoredProjectId)).project,mapping=C.restoreMapping;
    insist(restored.id!==originalProjectId&&mapping.project[originalProjectId]===restored.id,'Restoration did not establish separate project identity');
    insist(restored.config.buyerProfileId==='','A restored archive must select its native buyer binding explicitly for new work');
    const restoredRequests=await all('requests',restored.id),restoredCaptures=await all('captures',restored.id),restoredJobs=await all('jobs',restored.id),restoredFiles=await all('files',restored.id);
    insist(restoredRequests.length===payload.payload.records.filter(r=>r.kind==='requests').length,'Restoration lost request definitions');
    insist(restoredCaptures.length===payload.payload.records.filter(r=>r.kind==='captures').length,'Restoration lost original captures');
    const originalCheckout=restoredJobs.find(j=>j.id===mapping.records[C.purchaseJobId]);
    insist(originalCheckout&&originalCheckout.status==='archived'&&originalCheckout.originalStatus==='completed','Restoration lost the native purchase status');
    insist(originalCheckout.items[0].intentId===C.originalIntentId&&!originalCheckout.canExecute&&!originalCheckout.canResume&&!originalCheckout.canRecover&&!originalCheckout.canCancel,'Historical native checkout acquired live controls or lost its original identity');
    let compared=0;
    for(const original of payload.payload.files){
      const file=restoredFiles.find(f=>f.id===mapping.files[original.id]);
      insist(file&&file.bytes===original.bytes&&file.sha256===original.sha256,'Original file mapping differs after restore');
      const r=await fetch(base+'/api/files/'+file.id+'/download');insist(r.ok,'Restored source download failed');
      const bytes=Buffer.from(await r.arrayBuffer());
      insist(bytes.length===original.bytes&&digest(bytes)===original.sha256,'Restored source bytes differ: '+original.name);compared++;
    }
    const historical=await all('exports',restored.id);
    insist(historical.every(e=>e.available===false),'A restored historical archive advertises a redundant unavailable payload');
    await nav('handover');
    insist(await page.locator('a[href^="/api/exports/"]').count()===0,'Historical archive metadata rendered an unavailable download');
    await nav('sources');await action('pane','jobs');
    await shot('14-restored-original-operation-history');
    C.restoreSummary={projectId:restored.id,requests:restoredRequests.length,captures:restoredCaptures.length,jobs:restoredJobs.length,originalFilesCompared:compared,historicalExports:historical.length,nativeIntentId:originalCheckout.items[0].intentId};save();
    await page.locator('#project-select').selectOption(originalProjectId);await ready();await nav('overview');
    return {archive:C.archiveDownload,source:C.archiveSummary,reopen:C.actualReopen,restore:C.restoreSummary};
  });
  await stage('all_operator_views_mobile_and_reopened_desktop',async()=>{
    await close();await page.locator('#project-select').selectOption(C.projectId);await ready();
    await page.setViewportSize({width:390,height:844});
    const widths=[];
    for(const tab of ['overview','requests','collections','sources','research','provider','handover','history']){
      await nav(tab);
      const width=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
      insist(width.document<=width.viewport+1&&width.body<=width.viewport+1,'Mobile layout overflow in '+tab+': '+JSON.stringify(width));
      widths.push({tab,...width});if(['overview','sources','research','provider','handover'].includes(tab))await shot('mobile-'+tab);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.reload({waitUntil:'domcontentloaded'});await ready();await nav('overview');
    await shot('15-reopened-desktop-overview');
    const retained=(await get('/api/jobs/'+C.purchaseJobId)).job;
    insist(retained.status==='completed'&&retained.items.length===1&&retained.items[0].intentId===C.originalIntentId,'Final interface reload changed the completed native operation');
    return {views:widths.length,widths,finalProjectId:C.projectId,originalPurchaseJobId:C.purchaseJobId};
  });

  insist(C.errors.length===errorStart,'The native browser reported an actual interface error: '+JSON.stringify(C.errors.slice(errorStart)));
  const report={status:'PASS',completedAt:new Date().toISOString(),projectId:C.projectId,restoredProjectId:C.restoredProjectId,
    requestIds:C.requestIds,collectionId:C.collectionId,providerPlanId:C.providerPlanId,originalSources:C.originalSources,
    originalNativePurchase:{jobId:C.purchaseJobId,intentId:C.originalIntentId,captureId:C.paidCaptureId,response:C.paidResponseDownload},
    baselineSnapshotId:C.baselineSnapshotId,currentSnapshotId:C.currentSnapshotId,comparisonId:C.comparisonId,
    archive:C.archiveDownload,archiveSummary:C.archiveSummary,reopen:C.actualReopen,restore:C.restoreSummary,
    stages:C.stages,downloads:C.downloads,actualWrites:C.writes,browserErrors:C.errors.slice(errorStart),historicalBrowserErrors:C.errors.slice(0,errorStart),attempts:C.attempts};
  C.completedAt=report.completedAt;C.activeStage=null;save();
  fs.writeFileSync(path.join(OUT,'UI_JOURNEY_RESULT.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({status:'PASS',result:path.join(OUT,'UI_JOURNEY_RESULT.json'),nativePurchaseJobId:C.purchaseJobId,stages:Object.keys(C.stages).length}));
}catch(error){
  C.failure={at:new Date().toISOString(),stage:C.activeStage,error:String(error),stack:error.stack};save();
  if(page&&!page.isClosed()){try{await shot('actual-interruption')}catch{}}
  fs.writeFileSync(path.join(OUT,'UI_JOURNEY_FAILURE.json'),JSON.stringify(C.failure,null,2)+'\n',{mode:0o600});
  console.error(JSON.stringify(C.failure));process.exitCode=1;
}finally{
  try{await otherContext?.close()}catch{}
  try{await browser?.close()}catch{}
  await stopApp();
}
