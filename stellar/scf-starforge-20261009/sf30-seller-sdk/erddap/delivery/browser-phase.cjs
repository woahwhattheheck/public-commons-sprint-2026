/* MIT. One real browser continuation over the original ERDDAP workspace and receiver. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const readyPath=process.argv[2];
if(!readyPath)throw new Error('Pass the original private ready JSON.');
const ready=JSON.parse(fs.readFileSync(readyPath,'utf8'));
const requireRuntime=createRequire(__filename);
const {chromium}=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?
  requireRuntime(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')) : requireRuntime('playwright');
const out=ready.outputDirectory;
const resultPath=path.join(out,'browser-result.json'),privatePath=path.join(out,'browser-private.json');
function read(p,fallback){return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;}
function write(p,value){const temp=p+'.pending';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,p);}
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result=read(resultPath,{schema:'stellar-forge.erddap-browser-result.v1',completed:[],sources:[],builds:[],exports:[],receiving:[],errors:[],ssoStarts:undefined});
delete result.ssoStarts;
const saved=read(privatePath,{schema:'stellar-forge.erddap-browser-private.v1',inputManifestSha256:ready.inputManifestSha256,workspace:ready.workspace,receiver:ready.receiverWorkspace});
if(saved.inputManifestSha256!==ready.inputManifestSha256 || saved.workspace!==ready.workspace || saved.receiver!==ready.receiverWorkspace)
  throw new Error('The retained browser continuation belongs to another original workspace/input selection.');
let browser,context,page,currentPhase='open',requestErrors=[];
function safeUrl(url){try{return new URL(url).pathname;}catch{return '<unparsed>';}}
function checkpoint(){write(resultPath,result);write(privatePath,saved);}
async function preserveContext(){if(context){saved.storageState=await context.storageState();write(privatePath,saved);}}
function attach(p){
  p.on('pageerror',error=>{result.errors.push({phase:currentPhase,type:'page',message:String(error.message).slice(0,1000)});});
  p.on('requestfailed',request=>{requestErrors.push({path:safeUrl(request.url()),error:request.failure()&&request.failure().errorText});requestErrors=requestErrors.slice(-20);});
}
async function phase(name,action){
  if(result.completed.includes(name))return;
  currentPhase=name;result.status='RUNNING';result.currentPhase=name;delete result.failure;checkpoint();
  await action();await preserveContext();result.completed.push(name);result.phaseSources[name]=result.currentSourceRevision;delete result.currentPhase;checkpoint();
  process.stdout.write(JSON.stringify({phase:name,complete:true})+'\n');
}
async function readyButton(selector){
  const loc=page.locator(selector);await loc.waitFor({state:'visible',timeout:120000});
  await page.waitForFunction(s=>{const e=document.querySelector(s);return e&&!e.disabled;},selector,{timeout:120000});
  return loc;
}
async function click(selector){await(await readyButton(selector)).click();}
async function nav(view){await click('[data-view="'+view+'"]');}
async function selectedSource(id){
  await page.waitForFunction(value=>{
    const row=document.querySelector('[data-action="select-source"][data-id="'+value+'"]');
    const action=document.querySelector('[data-action="default-mapping"]');
    return row&&row.getAttribute('aria-current')==='true'&&action&&!action.disabled;
  },id,{timeout:120000});
}
async function selectedBuild(id){
  await page.waitForFunction(value=>{
    const row=document.querySelector('[data-action="select-build"][data-id="'+value+'"]');
    const action=document.querySelector('[data-action="native-query"]');
    return row&&row.getAttribute('aria-current')==='true'&&action&&!action.disabled&&document.querySelector('#native-result');
  },id,{timeout:120000});
}
async function proposeMapping(id){
  await response('/api/sources/'+id+'/mapping','POST',()=>click('[data-action="default-mapping"]'));
  await page.waitForFunction(()=>{
    const dialog=document.querySelector('#review-dialog'),button=document.querySelector('[data-action="default-mapping"]');
    return dialog.open||(document.querySelector('#mapping-name')&&button&&!button.disabled);
  },null,{timeout:120000});
  if(await page.locator('#review-dialog').isVisible())await click('[data-action="confirm-review"]');
  await readyButton('[data-action="review-mapping"]');
}
async function response(route,method,action){
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()===method,{timeout:180000});
  await action();const r=await pending;const body=await r.json();
  if(!r.ok())throw new Error(route+' returned '+r.status()+': '+String(body.error||JSON.stringify(body)).slice(0,1500));
  return body;
}
async function open(url){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#workspace-name').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Saved workspace opened.'||
    !document.querySelector('#error').hidden,{timeout:120000});
  const error=page.locator('#error');
  if(await error.isVisible())throw new Error(await error.innerText());
}
async function currentState(url){
  const u=new URL(url),token=u.hash.slice(1);u.hash='';
  const response=await context.request.get(new URL('/api/state',u).href,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok())throw new Error('Original state read returned '+response.status());
  return response.json();
}
async function queryFirst(limit=1){
  await page.locator('#native-query').fill('limit='+limit);
  return response('/api/builds/'+result.currentBuild+'/query','GET',()=>click('[data-action="native-query"]'));
}
async function receiveDownload(action,name){
  const dest=path.join(out,name);
  const old=result.exports.find(x=>x.file===name);
  if(fs.existsSync(dest)&&old){
    if(old.sha256!==digest(dest)||old.bytes!==fs.statSync(dest).size)throw new Error('A completed original export changed: '+name);
    return old;
  }
  const pending=page.waitForEvent('download',{timeout:180000});
  await click('[data-action="'+action+'"]');
  const d=await pending,temporary=dest+'.download-'+crypto.randomUUID();await d.saveAs(temporary);
  const item={file:name,bytes:fs.statSync(temporary).size,sha256:digest(temporary)};
  if(fs.existsSync(dest)){
    if(digest(dest)!==item.sha256||fs.statSync(dest).size!==item.bytes)throw new Error('Unrecorded export conflicts with the same original response; both files remain retained: '+name);
    fs.unlinkSync(temporary);
  }else fs.renameSync(temporary,dest);
  if(old&&(old.sha256!==item.sha256||old.bytes!==item.bytes))throw new Error('Reopened export differs from its retained identity: '+name);
  if(!old)result.exports.push(item);checkpoint();return item;
}
(async()=>{
  try{
    fs.mkdirSync(out,{recursive:true,mode:0o700});
    const options={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disk-cache-size=1048576','--media-cache-size=1048576','--disable-gpu-shader-disk-cache']};
    const executable=process.env.ERDDAP_CHROMIUM_EXECUTABLE||process.env.SDMX_CHROMIUM_EXECUTABLE||process.env.DICOM_CHROMIUM_EXECUTABLE;
    if(executable)options.executablePath=executable;
    browser=await chromium.launch(options);
    context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,...(saved.storageState?{storageState:saved.storageState}:{})});
    page=await context.newPage();attach(page);await open(ready.original.url);
    const initial=await currentState(ready.original.url);
    if(initial.workspace.id!==ready.workspaceId)throw new Error('Original browser opened another workspace.');
    result.inputManifestSha256=ready.inputManifestSha256;
    result.currentSourceRevision=crypto.createHash('sha256').update(JSON.stringify(ready.sourceFiles)).digest('hex');
    result.sourceRevisions=result.sourceRevisions||{};result.sourceRevisions[result.currentSourceRevision]=ready.sourceFiles;
    result.phaseSources=result.phaseSources||{};
    await phase('original_workspace',async()=>{
      result.initial={sources:initial.sources.length,builds:initial.builds.length,comparisons:initial.comparisons.length};
      result.datasetRoutes=ready.inputs.map(x=>({file:x.name,sha256:x.sha256}));
    });
    for(let i=0;i<ready.inputs.length;i++){
      const input=ready.inputs[i];
      if(digest(input.path)!==input.sha256)throw new Error('The actual source ZIP changed: '+input.name);
      await phase('source_'+i,async()=>{
        await nav('sources');await page.locator('#source-file').setInputFiles(input.path);await page.locator('#source-label').fill(input.label);
        const value=await response('/api/sources','POST',()=>click('[data-action="import-source"]'));
        if(value.id!==input.sha256)throw new Error('Imported source identity differs from the complete original ZIP.');
        await selectedSource(value.id);
        const rows=await context.request.get(new URL('/api/sources/'+value.id+'/rows?limit=1',ready.original.url).href,
          {headers:{Authorization:'Bearer '+new URL(ready.original.url).hash.slice(1)}});
        if(!rows.ok())throw new Error('Original source row inspection failed.');
        const first=await rows.json();
        result.sources[i]={id:value.id,label:value.label,datasetId:value.inventory.datasetId,protocol:value.inventory.protocol,
          rowCount:value.inventory.rowCount,columns:first.columns,firstRow:first.rows[0]||null,csvComparison:value.inventory.csvComparison};
      });
      await phase('mapping_build_'+i,async()=>{
        await nav('sources');await click('[data-action="select-source"][data-id="'+result.sources[i].id+'"]');
        await selectedSource(result.sources[i].id);await proposeMapping(result.sources[i].id);
        const name=result.sources[i].datasetId+' — retained original selection';
        await page.locator('#mapping-name').fill(name);
        await click('[data-action="review-mapping"]');
        const build=await response('/api/builds','POST',()=>click('[data-action="confirm-review"]'));
        if(build.source!==result.sources[i].id||build.rowCount!==result.sources[i].rowCount)throw new Error('Native build did not retain the complete selected source.');
        result.builds[i]={id:build.id,source:build.source,plan:build.plan,rowCount:build.rowCount,snapshot:build.native.snapshot,
          keys:build.keys,files:build.files,name:build.native.name};
        result.currentBuild=build.id;checkpoint();
        await page.locator('#native-result').waitFor({state:'visible',timeout:120000});
      });
      await phase('native_query_'+i,async()=>{
        await nav('editions');await click('[data-action="select-build"][data-id="'+result.builds[i].id+'"]');
        await selectedBuild(result.builds[i].id);
        result.currentBuild=result.builds[i].id;
        const first=await queryFirst(1);
        if(first.response.status!==200)throw new Error('Original native query returned '+first.response.status);
        const body=first.response.body;
        result.builds[i].firstQuery={fields:body.fields,rows:body.rows,page:body.page};
        if(body.page&&body.page.nextCursor){
          const next=await response('/api/builds/'+result.currentBuild+'/query','GET',()=>click('[data-action="native-next"]'));
          if(next.response.status!==200)throw new Error('Original cursor query failed.');
          result.builds[i].secondPage={fields:next.response.body.fields,rows:next.response.body.rows,page:next.response.body.page};
          await click('[data-action="native-previous"]');
        }
      });
      await phase('exports_'+i,async()=>{
        await nav('editions');await click('[data-action="select-build"][data-id="'+result.builds[i].id+'"]');
        await selectedBuild(result.builds[i].id);
        result.builds[i].projectExport=await receiveDownload('export-packet','project-'+i+'.erddap.zip');
        result.builds[i].datasetExport=await receiveDownload('export-dataset','dataset-'+i+'.zip');
      });
    }
    await phase('retained_mapping_draft',async()=>{
      await nav('sources');await click('[data-action="select-source"][data-id="'+result.sources[0].id+'"]');
      await selectedSource(result.sources[0].id);
      if(!await page.locator('#mapping-name').count())await proposeMapping(result.sources[0].id);
      await page.locator('#mapping-name').waitFor({state:'visible'});
      const name=await page.locator('#mapping-name').inputValue(),draft=name+' · unsaved operator draft';
      await page.locator('#mapping-name').fill(draft);await click('[data-action="refresh"]');
      await page.waitForFunction(expected=>document.querySelector('#mapping-name')&&document.querySelector('#mapping-name').value===expected,draft,{timeout:120000});
      result.mappingDraftPreserved=true;
    });
    await phase('edition_comparison',async()=>{
      const first=result.builds[0],other=result.builds.find((b,i)=>i>0&&b.plan===first.plan)||first;
      await nav('compare');await page.locator('#compare-before').selectOption(first.id);await page.locator('#compare-after').selectOption(other.id);
      const value=await response('/api/comparisons','POST',()=>click('[data-action="compare"]'));
      if(value.before!==first.id||value.after!==other.id)throw new Error('Compared another edition selection.');
      if(first.id===other.id&&(value.counts.unchanged!==first.rowCount||value.counts.added||value.counts.removed||value.counts.changed))
        throw new Error('The exact original edition differs from itself.');
      result.comparison={...value,sameOriginalEdition:first.id===other.id};
    });
    await phase('desktop_and_phone',async()=>{
      await nav('editions');await click('[data-action="select-build"][data-id="'+result.builds[0].id+'"]');
      await selectedBuild(result.builds[0].id);
      if(ready.screenshots)await page.screenshot({path:path.join(out,'operator-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      const overflow=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
      if(overflow.width>overflow.viewport+1)throw new Error('The operator layout overflows the phone viewport.');
      if(ready.screenshots)await page.screenshot({path:path.join(out,'operator-phone.png'),fullPage:true});
      result.viewports={desktop:1440,phone:390,horizontalOverflow:false};await page.setViewportSize({width:1440,height:960});
    });
    await preserveContext();await open(ready.receiver.url);
    const receiver=await currentState(ready.receiver.url);
    if(receiver.workspace.id!==ready.receiverWorkspaceId)throw new Error('Customer browser opened another workspace.');
    for(let i=0;i<result.builds.length;i++){
      await phase('customer_receive_'+i,async()=>{
        await nav('receive');const packet=path.join(out,result.builds[i].projectExport.file);
        if(digest(packet)!==result.builds[i].projectExport.sha256)throw new Error('Original project export changed before receiving.');
        await page.locator('#packet-file').setInputFiles(packet);
        const value=await response('/api/packets','POST',()=>click('[data-action="import-packet"]'));
        if(!value.reconstructed||value.build.native.snapshot!==result.builds[i].snapshot||
          value.build.source!==result.builds[i].source||value.build.plan!==result.builds[i].plan||
          value.build.rowCount!==result.builds[i].rowCount)throw new Error('Customer reconstruction differs from the original source/edition.');
        await page.locator('#receiving-result').waitFor({state:'visible',timeout:120000});
        await click('[data-action="received-edition"]');await selectedBuild(value.build.id);
        result.currentBuild=value.build.id;const q=await queryFirst(1);
        if(q.response.status!==200||JSON.stringify(q.response.body.rows)!==JSON.stringify(result.builds[i].firstQuery.rows))
          throw new Error('Customer native query differs from the original retained exact values.');
        result.receiving[i]={build:value.build.id,source:value.source,plan:value.plan,rowCount:value.build.rowCount,
          snapshot:value.build.native.snapshot,firstQuery:{fields:q.response.body.fields,rows:q.response.body.rows}};
      });
    }
    await phase('browser_reopen',async()=>{
      await open(ready.receiver.url);
      const state=await currentState(ready.receiver.url);
      if(result.receiving.some(x=>!state.builds.some(b=>b.id===x.build&&b.native.snapshot===x.snapshot)))throw new Error('Customer editions did not reopen.');
      result.receiverState={sources:state.sources.length,plans:state.plans.length,builds:state.builds.length};
    });
    if(result.errors.length)throw new Error('The original browser recorded '+result.errors.length+' page errors.');
    delete result.currentBuild;delete result.currentPhase;result.status='ERDDAP_BROWSER_COMPLETE';result.completedAt=new Date().toISOString();
    await preserveContext();checkpoint();process.stdout.write(JSON.stringify({status:result.status,result:resultPath})+'\n');
  }catch(error){
    result.status='FAILED';result.currentPhase=currentPhase;result.failure={phase:currentPhase,message:String(error.message).slice(0,3000),requestErrors};
    if(page){try{saved.failure={url:page.url(),title:await page.title(),body:(await page.locator('body').innerText()).slice(0,12000)};await preserveContext();}catch(_){}}
    checkpoint();process.stderr.write(JSON.stringify({phase:currentPhase,error:result.failure.message,result:resultPath})+'\n');process.exitCode=1;
  }finally{
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
  }
})();
