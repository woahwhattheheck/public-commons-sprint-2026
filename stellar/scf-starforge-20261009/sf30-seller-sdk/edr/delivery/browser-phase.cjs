/* MIT. Original Environmental Data Retrieval operator → exact customer receiving browser journey. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const readyPath=process.argv[2];
if(!readyPath)throw new Error('Pass the original private ready JSON.');
const ready=JSON.parse(fs.readFileSync(readyPath,'utf8'));
if(ready.schema!=='stellar-forge.edr-browser-ready.v1'||!Array.isArray(ready.inputs)||!ready.inputs.length)
  throw new Error('Use the maintained owner and its actual original native workspace.');
if(!['require-exhausted','allow-partial'].includes(ready.coveragePolicy))
  throw new Error('Select the original explicit acquisition coverage policy.');
const out=ready.outputDirectory;
const resultPath=path.join(out,'browser-result.json');
const privatePath=path.join(out,'browser-private.json');
const canonical=value=>JSON.stringify((function order(v){return Array.isArray(v)?v.map(order):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,order(v[k])])):v;})(value));
const same=(a,b)=>canonical(a)===canonical(b);
const ensure=(value,message)=>{if(!value)throw new Error(message);};
const read=(p,fallback)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;
function write(p,value){
  const temporary=p+'.'+crypto.randomUUID()+'.pending';
  let fd;
  try{
    fd=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');
    fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temporary,p);
  }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
async function fileFact(p){
  const info=fs.lstatSync(p);ensure(info.isFile()&&!info.isSymbolicLink(),'Expected one retained regular file: '+path.basename(p));
  const hash=crypto.createHash('sha256');
  for await(const block of fs.createReadStream(p))hash.update(block);
  return {bytes:info.size,sha256:hash.digest('hex')};
}
const result=read(resultPath,{schema:'stellar-forge.edr-browser-result.v1',
  completed:[],sources:[],builds:[],exports:[],originalFiles:[],receiving:[],errors:[],runs:[],phaseSources:{}});
const saved=read(privatePath,{schema:'stellar-forge.edr-browser-private.v1',
  inputManifestSha256:ready.inputManifestSha256,workspace:ready.workspace,receiver:ready.receiverWorkspace,
  coveragePolicy:ready.coveragePolicy,mappingRecovery:{},sourceRevisions:[]});
ensure(saved.schema==='stellar-forge.edr-browser-private.v1'&&
  result.schema==='stellar-forge.edr-browser-result.v1','Unsupported original browser checkpoint.');
ensure(saved.inputManifestSha256===ready.inputManifestSha256&&saved.workspace===ready.workspace&&
  saved.receiver===ready.receiverWorkspace&&saved.coveragePolicy===ready.coveragePolicy,
  'The saved browser belongs to different original inputs, workspace or coverage policy.');
ensure(result.coveragePolicy===undefined||result.coveragePolicy===ready.coveragePolicy,
  'Preserve the original browser coverage choice.');
result.coveragePolicy=ready.coveragePolicy;
result.inputManifestSha256=ready.inputManifestSha256;
const sourceRevision=crypto.createHash('sha256').update(canonical(ready.sourceFiles)).digest('hex');
if(!saved.sourceRevisions.some(x=>x.id===sourceRevision))
  saved.sourceRevisions.push({id:sourceRevision,at:new Date().toISOString(),files:ready.sourceFiles});
result.currentSourceRevision=sourceRevision;
const runId=crypto.randomUUID();
let context,page,currentPhase='startup';
const run={id:runId,startedAt:new Date().toISOString(),sourceRevision,status:'starting'};
result.runs.push(run);
const requestFailures=[];
function safe(value){
  let text=String(value);
  for(const host of [ready.original,ready.receiver]){
    const token=new URL(host.url).hash.slice(1);
    if(token)text=text.split(token).join('[private capability]');
  }
  return text.slice(0,5000);
}
function checkpoint(){write(privatePath,saved);write(resultPath,result);}
const attachedPages=new WeakSet();
function attach(p){
  if(attachedPages.has(p))return;
  attachedPages.add(p);
  p.on('pageerror',error=>{result.errors.push({run:runId,phase:currentPhase,type:'page',message:safe(error.message)});
    result.completed=result.completed.filter(name=>name!==currentPhase);});
  p.on('requestfailed',request=>{
    let name;try{name=new URL(request.url()).pathname;}catch{name='unknown';}
    requestFailures.push({path:name,message:safe(request.failure()?.errorText||'request failed')});
    if(requestFailures.length>20)requestFailures.shift();
  });
}
async function idle(){
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&
    document.body.getAttribute('aria-busy')!=='true'&&document.documentElement.dataset.drafts!=='pending',null,{timeout:180000});
}
async function drafts(){
  await page.waitForFunction(()=>document.documentElement.dataset.drafts!=='pending',null,{timeout:30000});
}
async function click(selector){
  await idle();
  const target=page.locator(selector).first();
  await target.waitFor({state:'visible',timeout:30000});
  await target.click({timeout:180000});
}
async function nav(view){await click('[data-view="'+view+'"]');await idle();}
async function open(host,workspaceId){
  await page.goto(host.url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'||document.querySelector('#instance-status')?.textContent==='Workspace not ready',null,{timeout:180000});
  if(await page.evaluate(()=>document.documentElement.dataset.ready!=='true'))
    throw new Error('The original workspace UI did not open: '+await page.locator('#notice').innerText());
  await idle();
  const state=await get(host,'/api/state');
  ensure(state.workspace.id===workspaceId,'The private server belongs to a different original workspace.');
  return state;
}
async function get(host,route){
  const u=new URL(host.url),token=u.hash.slice(1);
  const response=await context.request.get(new URL(route,u.origin).href,{headers:{Authorization:'Bearer '+token},timeout:180000});
  const body=await response.json();
  ensure(response.ok(),route+' returned '+response.status()+': '+safe(body.error||'local read failed'));
  return body;
}
async function response(route,method,action){
  // Capture the one original request before its response reaches the page.
  // route.fetch retains its body independently of Chromium's inspector cache.
  const origin=new URL(page.url()).origin;
  const matches=url=>url.origin===origin&&url.pathname===route;
  let deliver,fail,timer,inFlight,claimed=false;
  const pending=new Promise((resolve,reject)=>{
    deliver=resolve;fail=reject;
    timer=setTimeout(()=>reject(new Error('The original '+method+' '+route+' response did not complete.')),180000);
  });
  pending.catch(()=>{});
  const intercept=routed=>{
    if(claimed||routed.request().method()!==method)return routed.continue();
    claimed=true;
    inFlight=(async()=>{
      let original,fulfilled=false;
      try{
        original=await routed.fetch({timeout:180000,maxRedirects:0,maxRetries:0});
        const bytes=await original.body();
        // Deliver the unchanged status, headers and complete original bytes.
        await routed.fulfill({response:original,body:bytes});fulfilled=true;
        const body=JSON.parse(bytes.toString('utf8'));
        ensure(original.ok(),route+' returned '+original.status()+': '+safe(body.error||'local operation failed'));
        deliver(body);
      }catch(error){
        if(!fulfilled)try{await routed.abort('failed');}catch{}
        fail(error);
      }finally{if(original)await original.dispose().catch(()=>{});}
    })();
    return inFlight;
  };
  await page.route(matches,intercept);
  try{
    const [body]=await Promise.all([pending,Promise.resolve().then(action)]);
    await idle();return body;
  }finally{
    clearTimeout(timer);
    await page.unroute(matches,intercept);
    if(inFlight)await inFlight;
  }
}
async function phase(name,action){
  if(result.completed.includes(name))return;
  currentPhase=name;run.status='running';result.status='RUNNING';result.currentPhase=name;delete result.failure;checkpoint();
  await action();await idle();
  ensure(!result.errors.some(x=>x.run===runId&&x.phase===name&&x.type==='page'),'The current browser phase emitted a page error.');
  result.completed.push(name);result.phaseSources[name]=sourceRevision;
  delete result.currentPhase;checkpoint();
  process.stdout.write(JSON.stringify({phase:name,complete:true})+'\n');
}
async function journalRequests(){
  const workspace=new URL(page.url()).origin===new URL(ready.original.url).origin?ready.workspaceId:ready.receiverWorkspaceId;
  return page.evaluate(workspace=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('stellar-forge-edr',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('requests','readonly');
      const read=tx.objectStore('requests').getAll();
      read.onerror=()=>reject(read.error);
      read.onsuccess=()=>{const rows=read.result.filter(x=>x.workspace===workspace).map(({file,...r})=>r);db.close();resolve(rows);};
    };
  }),workspace);
}
async function selectedSource(id){
  await nav('sources');
  const item=page.locator('[data-action="select-source"][data-id="'+id+'"]');
  ensure(await item.count()===1,'Original source is absent from its existing workspace list.');
  await item.click();await idle();
  ensure((await page.locator('#source-id').innerText()).includes(id),'The UI selected a different source.');
}
async function selectedBuild(id){
  await nav('editions');
  const item=page.locator('[data-action="select-build"][data-id="'+id+'"]');
  ensure(await item.count()===1,'Original build is absent from its existing workspace list.');
  await item.click();await idle();
  ensure((await page.locator('#build-id').innerText()).includes(id),'The UI selected a different native edition.');
}
async function loadOriginalMapping(input){
  await nav('mapping');
  await page.locator('#mapping-source').selectOption(input.sha256);
  await page.locator('#mapping-select').selectOption(input.expectedBuild.plan);
  const mapping=await response('/api/plans/'+input.expectedBuild.plan,'GET',()=>click('#mapping-load'));
  ensure(same(mapping,input.expectedPlan),'Original saved mapping changed.');
  await page.locator('#mapping-coverage').selectOption(ready.coveragePolicy);await drafts();
  ensure(same(JSON.parse(await page.locator('#mapping-json').innerText()),input.expectedPlan),
    'The visible mapping differs from its original native reviewed selection.');
}
async function download(action,name,metadata,collection='exports'){
  const destination=path.join(out,name);
  const prior=result[collection].find(x=>x.file===name);
  if(prior&&fs.existsSync(destination)){
    ensure(same(await fileFact(destination),{bytes:prior.bytes,sha256:prior.sha256}),'A retained completed export changed.');
    return prior;
  }
  const pending=page.waitForEvent('download',{timeout:180000});
  await action();
  const original=await pending;
  const temporary=path.join(out,'.download-'+crypto.randomUUID());
  await original.saveAs(temporary);
  ensure(!(await original.failure()),'The original browser download did not complete.');
  const fact=await fileFact(temporary);
  try{
    if(fs.existsSync(destination))ensure(same(await fileFact(destination),fact),'Existing original output has different bytes: '+name);
    else{
      try{fs.linkSync(temporary,destination);}catch(error){if(error.code!=='EEXIST')throw error;ensure(same(await fileFact(destination),fact),'Concurrent original output has different bytes.');}
      fs.chmodSync(destination,0o600);
    }
    const item={file:name,...fact,...metadata};
    if(prior)ensure(same(prior,item),'A resumed exact export differs from its saved receipt.');
    else result[collection].push(item);
    checkpoint();await idle();return item;
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
async function mappingRecovery(input,index){
  let recovery=saved.mappingRecovery[index];
  if(!recovery){
    const requests=await journalRequests();
    recovery={source:input.sha256,plan:input.expectedBuild.plan,body:input.expectedPlan,
      beforeRequestIds:requests.map(x=>x.id),newerName:input.expectedPlan.name.slice(0,115)+' · newer unsaved browser review',
      stage:'prepared'};
    saved.mappingRecovery[index]=recovery;checkpoint();
  }
  ensure(recovery.source===input.sha256&&recovery.plan===input.expectedBuild.plan&&same(recovery.body,input.expectedPlan),
    'The pending mapping recovery belongs to different exact source inputs.');
  if(recovery.stage==='complete'){
    const retained=(await journalRequests()).find(x=>x.id===recovery.requestId);
    ensure(retained?.status==='complete'&&retained.result.id===input.expectedBuild.plan&&same(retained.body,input.expectedPlan),
      'The completed original mapping request changed.');
    ensure(recovery.evidence,'The original complete mapping recovery evidence is missing.');
    result.mappingRecovery=recovery.evidence;
    await loadOriginalMapping(input);return;
  }
  if(!recovery.requestId){
    const existing=(await journalRequests()).filter(r=>r.kind==='mapping'&&
      !recovery.beforeRequestIds.includes(r.id)&&same(r.body,input.expectedPlan)).sort((a,b)=>a.created.localeCompare(b.created));
    ensure(existing.length<=1,'More than one original mapping request matches this retained interruption.');
    if(existing.length){recovery.requestId=existing[0].id;checkpoint();}
  }
  if(!recovery.requestId){
    await loadOriginalMapping(input);
    let release,deliver,fail,timer;
    const released=new Promise(resolve=>{release=resolve;});
    const observed=new Promise((resolve,reject)=>{deliver=resolve;fail=reject;timer=setTimeout(()=>reject(new Error('Original mapping save did not reach its retained response boundary.')),180000);});
    let intercepted=false;
    const intercept=async route=>{
      if(intercepted||route.request().method()!=='POST'){await route.continue();return;}
      intercepted=true;
      let original;
      try{
        const body=route.request().postDataJSON();ensure(same(body,input.expectedPlan),'The submitted UI mapping changed before save.');
        original=await route.fetch({timeout:180000,maxRedirects:0,maxRetries:0});
        const value=await original.json();
        ensure(original.ok()&&value.id===input.expectedBuild.plan,'The original writer returned another saved mapping.');
        recovery.backendSaved={id:value.id,at:new Date().toISOString()};
        recovery.stage='response-held';checkpoint();deliver(value);
        await released;
        await route.abort('failed');
      }catch(error){fail(error);try{await route.abort('failed');}catch{}}
      finally{if(original)await original.dispose().catch(()=>{});}
    };
    await page.route('**/api/plans',intercept);
    try{
      await click('#mapping-save');await observed;
      const requests=(await journalRequests()).filter(r=>r.kind==='mapping'&&
        !recovery.beforeRequestIds.includes(r.id)&&same(r.body,input.expectedPlan));
      ensure(requests.length===1,'The saved browser request identity was not retained before the original POST.');
      recovery.requestId=requests[0].id;checkpoint();
      await page.locator('#mapping-name').fill(recovery.newerName);await drafts();
      recovery.newerDraftPersisted=true;recovery.stage='drop-requested';checkpoint();
      release();await idle();
      const retained=(await journalRequests()).find(x=>x.id===recovery.requestId);
      ensure(retained&&retained.status==='uncertain','The original dropped response was not retained as an uncertain request.');
      recovery.droppedReply={requestId:retained.id,status:retained.status,error:retained.error,at:new Date().toISOString()};
      recovery.stage='dropped';checkpoint();
    }finally{clearTimeout(timer);release();await page.unroute('**/api/plans',intercept);}
  }
  // Reopen the same persistent browser profile before retrying the exact saved input.
  await page.reload({waitUntil:'domcontentloaded'});await idle();
  await nav('mapping');await page.locator('#mapping-source').selectOption(input.sha256);
  await click('#mapping-new');await idle();
  const draftBefore=await page.locator('#mapping-name').inputValue();
  if(recovery.newerDraftPersisted)ensure(draftBefore===recovery.newerName,
    'The newer unsaved review did not survive the original page reload.');
  await nav('activity');
  const selector='[data-request-id="'+recovery.requestId+'"]';
  const card=page.locator(selector);
  ensure(await card.count()===1,'The original request is absent from this persistent browser journal.');
  await card.getByRole('button',{name:'Reopen exact request',exact:true}).click();await idle();
  let request=(await journalRequests()).find(x=>x.id===recovery.requestId);
  ensure(request&&same(request.body,input.expectedPlan),'Recovery changed the original mapping request body.');
  if(request.status!=='complete'){
    const value=await response('/api/plans','POST',()=>page.locator(selector).getByRole('button',{name:'Retry exact saved input',exact:true}).click());
    ensure(value.id===input.expectedBuild.plan,'Exact mapping replay returned another native mapping.');
  }else{
    await page.locator(selector).getByRole('button',{name:'Open retained result',exact:true}).click();await idle();
  }
  request=(await journalRequests()).find(x=>x.id===recovery.requestId);
  ensure(request.status==='complete'&&request.result.id===input.expectedBuild.plan,'The original saved mapping request did not complete.');
  await nav('mapping');
  ensure(await page.locator('#mapping-name').inputValue()===draftBefore,'Earlier save recovery replaced the newer local draft.');
  recovery.stage='complete';recovery.completedAt=new Date().toISOString();
  result.mappingRecovery={requestId:recovery.requestId,source:input.sha256,plan:input.expectedBuild.plan,
    originalBodySha256:crypto.createHash('sha256').update(canonical(request.body)).digest('hex'),
    backendSaved:recovery.backendSaved||null,droppedReply:recovery.droppedReply||null,
    newerDraftPreserved:true,afterReload:true,replayedOriginalRequest:true};
  recovery.evidence=result.mappingRecovery;checkpoint();
  await loadOriginalMapping(input);
}
function checkBuild(value,input){
  ensure(value.id===input.expectedBuild.id&&value.source===input.sha256&&value.plan===input.expectedBuild.plan,
    'Native source, mapping or build identity changed.');
  ensure(value.rowCount===input.expectedBuild.rowCount&&value.native.snapshot===input.expectedBuild.native.snapshot&&
    same(value.files,input.expectedBuild.files),'Original native snapshot, cells or file identities changed.');
}
function checkQuery(value,build){
  ensure(value.response.status===200,'Original native query did not return HTTP 200.');
  ensure(value.dataset.snapshot===build.native.snapshot,'Native query returned another snapshot.');
  ensure(Array.isArray(value.response.body.rows)&&Array.isArray(value.response.body.fields),'Native query omitted its original rows or fields.');
  return value.response.body;
}
async function queryNative(input,limit){
  await page.locator('#native-params').fill(JSON.stringify({limit:String(limit)}));await drafts();
  const value=await response('/api/builds/'+input.expectedBuild.id+'/query','GET',()=>click('#native-query'));
  checkQuery(value,input.expectedBuild);return value;
}
async function inspectSource(input,index){
  await nav('sources');
  await page.locator('#source-file').setInputFiles(input.path);
  await page.locator('#source-label').fill(input.label||input.name);
  const imported=await response('/api/sources','POST',()=>click('#source-upload button[type="submit"]'));
  ensure(imported.id===input.sha256&&imported.bytes===input.bytes,'Source upload did not retain the complete original packet.');
  await selectedSource(input.sha256);
  const original=await get(ready.original,'/api/sources/'+input.sha256);
  ensure(same(original.inventory,input.inventory),'The source inventory differs from the original native intake.');
  const visible=JSON.parse(await page.locator('#source-inventory').innerText());
  ensure(same(visible,input.inventory),'The visible source evidence differs from the retained original.');
  ensure(same(JSON.parse(await page.locator('#source-selection').innerText()),input.inventory.selection),
    'The visible request changed its exact query URL, ordered parameters or bounds.');
  const domains=await page.locator('#source-domains .domain-card').count();
  ensure(domains===input.inventory.coverages.length,'The visible domain review omitted a returned coverage.');
  const displayedAxes=await page.locator('#source-domains').innerText();
  for(const domain of input.inventory.coverages)for(const axis of domain.axes){
    ensure(displayedAxes.includes(String(axis.id)),'An original returned axis is absent from the visible review.');
    for(const coordinate of [axis.first,axis.last]){
      if(coordinate!==null&&typeof coordinate!=='object')
        ensure(displayedAxes.includes(String(coordinate)),'The visible axes changed an original coordinate or raw time string.');
    }
  }
  if(input.inventory.sourceIssues?.length)
    ensure((await page.locator('#source-issues').innerText()).includes(input.inventory.sourceIssues[0].code),
      'The provider source issue is absent from visible review.');
  let pageValue=await get(ready.original,'/api/sources/'+input.sha256+'/rows?offset=0&limit=100');
  let cells=0,pages=0;
  for(;;){
    ensure(pageValue.rowCount===input.inventory.rowCount,'The original cell preview changed its complete row count.');
    const shown=await page.locator('#source-rows tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelectorAll('td'),cell=>cell.innerText)));
    ensure(shown.length===pageValue.rows.length,'The visible preview omitted original parameter cells.');
    for(let i=0;i<pageValue.rows.length;i++){
      const record=pageValue.rows[i],row=shown[i];
      ensure(row.length===5&&row[0]===String(record.ordinal)&&row[1]===String(record.page)&&
        row[2]===String(record.coverage)&&row[3]===String(record.index)&&same(JSON.parse(row[4]),record.cell),
        'The visible parameter cell differs from its original coordinates, indices, value or metadata.');
    }
    cells+=pageValue.rows.length;pages++;
    ensure(cells<=input.inventory.rowCount&&pages<=input.inventory.rowCount+1,'Original cell preview repeated a page.');
    if(pageValue.nextOffset==null)break;
    pageValue=await response('/api/sources/'+input.sha256+'/rows','GET',()=>click('#source-next'));
  }
  ensure(cells===input.inventory.rowCount,'The visible preview did not traverse every original parameter cell.');
  const files=await get(ready.original,'/api/sources/'+input.sha256+'/files');
  ensure(files.files.length===Object.keys(input.inventory.files).length,'The complete raw-response inventory differs.');
  const receipts=[];
  for(let fileIndex=0;fileIndex<files.files.length;fileIndex++){
    const file=files.files[fileIndex],expected=input.inventory.files[file.name];
    ensure(expected&&file.bytes===expected.bytes&&file.sha256===expected.sha256,'The original response identity differs.');
    const selected=page.locator('[data-member="'+file.name.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"]');
    ensure(await selected.count()===1,'The visible original response download is absent.');
    const receipt=await download(()=>selected.getByRole('button',{name:'Download',exact:true}).click(),
      'source-'+index+'-original-response-'+String(fileIndex).padStart(4,'0')+'.json',
      {sourceIndex:index,source:input.sha256,member:file.name},'originalFiles');
    ensure(receipt.bytes===file.bytes&&receipt.sha256===file.sha256,'A downloaded original response changed.');
    receipts.push(receipt);
  }
  result.sources[index]={id:original.id,bytes:original.bytes,rowCount:original.inventory.rowCount,
    schemaSha256:original.inventory.schemaSha256,coverage:original.inventory.coverage,
    selection:original.inventory.selection,coverages:original.inventory.coverages,sourceIssues:original.inventory.sourceIssues,
    rights:original.inventory.rights,originalResponses:receipts,cellPreview:{pages,cells}};
}
async function buildAndQuery(input,index){
  if(index===0)await mappingRecovery(input,index);
  else{
    await loadOriginalMapping(input);
    const savedMapping=await response('/api/plans','POST',()=>click('#mapping-save'));
    ensure(savedMapping.id===input.expectedBuild.plan,'Visible mapping save returned another mapping.');
  }
  await nav('editions');
  await page.locator('#build-source').selectOption(input.sha256);
  await page.locator('#build-plan').selectOption(input.expectedBuild.plan);
  const build=await response('/api/builds','POST',()=>click('#build-create'));
  checkBuild(build,input);await selectedBuild(build.id);
  const first=await queryNative(input,1),firstBody=checkQuery(first,build);
  ensure(same(firstBody.fields,input.expectedFirstQuery.fields)&&same(firstBody.rows,input.expectedFirstQuery.rows),
    'The visible native query changed exact original cells.');
  const limit=Math.min(5,input.expectedPlan.maxLimit);
  let value=await queryNative(input,limit),count=0,pages=0;
  const cursors=new Set();
  for(;;){
    const body=checkQuery(value,build);count+=body.rows.length;pages++;
    ensure(count<=build.rowCount&&pages<=build.rowCount+1,'Native cursor repeated or exceeded its original row count.');
    const cursor=body.page?.nextCursor;
    if(!cursor)break;
    ensure(!cursors.has(cursor),'The original native cursor repeated.');cursors.add(cursor);
    value=await response('/api/builds/'+build.id+'/query','GET',()=>click('#native-next'));
  }
  ensure(count===build.rowCount,'The visible native cursor traversal did not receive every original row.');
  result.builds[index]={id:build.id,source:build.source,plan:build.plan,rowCount:build.rowCount,
    keys:build.keys,snapshot:build.native.snapshot,files:build.files,
    nativeQuery:{fields:firstBody.fields,rows:firstBody.rows},cursorTraversal:{pages,rows:count,limit}};
  await download(()=>click('#export-packet'),'source-'+index+'-customer-project.zip',{kind:'project',sourceIndex:index});
  await download(()=>click('#export-dataset'),'source-'+index+'-seller-dataset.zip',{kind:'dataset',sourceIndex:index});
}
async function compareEditions(){
  const state=await get(ready.original,'/api/state');
  let before=null,after=null;
  for(const input of ready.inputs){
    const samePlan=state.builds.filter(b=>b.plan===input.expectedBuild.plan&&b.keys?.length);
    if(samePlan.length){before=samePlan.find(b=>b.id===input.expectedBuild.id)||samePlan[0];after=samePlan.find(b=>b.id!==before.id)||before;break;}
  }
  if(!before){result.comparison={status:'not-applicable',reason:'The original reviewed mappings contain no explicit unique edition keys.'};return;}
  await nav('editions');
  await page.locator('#compare-before').selectOption(before.id);
  await page.locator('#compare-after').selectOption(after.id);
  const comparison=await response('/api/comparisons','POST',()=>click('#compare-create'));
  ensure(comparison.before===before.id&&comparison.after===after.id&&comparison.plan===before.plan,
    'The comparison used different original editions or mapping.');
  const counts=comparison.counts;
  if(before.id===after.id)ensure(counts.added===0&&counts.removed===0&&counts.changed===0&&counts.unchanged===before.rowCount,
    'The same original native edition did not compare identically.');
  let pageValue=await get(ready.original,'/api/comparisons/'+comparison.id+'/changes?offset=0&limit=100');
  let seen=pageValue.rows.length,pages=1;
  while(pageValue.nextOffset!=null){
    pageValue=await response('/api/comparisons/'+comparison.id+'/changes','GET',()=>click('#changes-next'));
    seen+=pageValue.rows.length;pages++;
    ensure(seen<=counts.added+counts.removed+counts.changed,'Change pages exceed their original comparison.');
  }
  ensure(seen===counts.added+counts.removed+counts.changed,'The original change list is incomplete.');
  const downloadReceipt=await download(()=>click('#changes-download'),'original-edition-changes.jsonl',
    {comparison:comparison.id},'originalFiles');
  ensure(downloadReceipt.sha256===comparison.changesSha256,'The downloaded original change rows differ.');
  result.comparison={...comparison,sameOriginalEdition:before.id===after.id,pages,changesRead:seen,download:downloadReceipt};
}
async function recordsJourney(){
  await nav('activity');
  const state=await get(ready.original,'/api/state');
  await page.locator('#records-collection').selectOption('builds');
  await page.locator('#records-limit').fill('1');
  let pageValue=await response('/api/records/builds','GET',()=>click('#records-open'));
  const view=pageValue.viewSha256,total=pageValue.total,ids=[];
  let pages=0;
  for(;;){
    ensure(pageValue.viewSha256===view&&pageValue.total===total,'The retained record view changed between pages.');
    ids.push(...pageValue.items.map(x=>x.id));pages++;
    ensure(ids.length<=total&&new Set(ids).size===ids.length,'Retained collection repeated an original record.');
    if(pageValue.nextOffset==null)break;
    pageValue=await response('/api/records/builds','GET',()=>click('#records-next'));
  }
  ensure(ids.length===total&&same([...ids].sort(),state.builds.map(x=>x.id).sort()),'The visible retained collection omitted an original edition.');
  result.records={collection:'builds',viewSha256:view,total,pages,ids};
}
async function viewportJourney(host,workspaceId,label){
  await open(host,workspaceId);await nav('overview');
  const fits=[];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:960});await idle();
    const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,
      body:document.body.scrollWidth}));
    ensure(sizes.document<=width+1&&sizes.body<=width+1,'The '+width+'-pixel operator view overflows its page.');
    const item={width,...sizes};
    if(ready.screenshots){
      const name=label+'-'+width+'.png';
      await page.screenshot({path:path.join(out,name),fullPage:true});
      item.internalScreenshot={file:name,...await fileFact(path.join(out,name))};
    }
    fits.push(item);
  }
  result.viewports=result.viewports||{};result.viewports[label]=fits;
  await page.setViewportSize({width:1440,height:960});
}
async function receiveProject(input,index){
  await open(ready.receiver,ready.receiverWorkspaceId);await nav('receive');
  const packet=result.exports.find(x=>x.kind==='project'&&x.sourceIndex===index);
  ensure(packet,'The original completed customer project is absent.');
  await page.locator('#packet-file').setInputFiles(path.join(out,packet.file));
  const received=await response('/api/packets','POST',()=>click('#packet-upload button[type="submit"]'));
  ensure(received.reconstructed===true&&received.source===input.sha256&&received.plan===input.expectedBuild.plan,
    'Customer receiving did not reconstruct the original source and mapping.');
  checkBuild(received.build,input);
  await click('#receive-open');await idle();
  const first=await queryNative(input,1),body=checkQuery(first,received.build);
  ensure(same(body.fields,input.expectedFirstQuery.fields)&&same(body.rows,input.expectedFirstQuery.rows),
    'Independent customer query changed the exact native cells.');
  const receipt=await download(()=>click('#export-packet'),'source-'+index+'-received-project.zip',
    {kind:'project',sourceIndex:index,receiving:true});
  ensure(receipt.bytes===packet.bytes&&receipt.sha256===packet.sha256,'The independently received project did not re-export byte-identically.');
  result.receiving[index]={build:received.build.id,source:received.source,plan:received.plan,
    rowCount:received.build.rowCount,snapshot:received.build.native.snapshot,
    firstQuery:{fields:body.fields,rows:body.rows},exactProject:receipt};
  await page.reload({waitUntil:'domcontentloaded'});await idle();
  const state=await get(ready.receiver,'/api/state');
  const reopened=state.builds.find(x=>x.id===received.build.id);
  ensure(reopened&&reopened.native.snapshot===received.build.native.snapshot,'Reloading customer UI lost its original received native edition.');
  const requests=await journalRequests();
  ensure(requests.some(x=>x.kind==='packet'&&x.status==='complete'&&x.result.build.id===received.build.id),
    'The original customer receive request is not retained in its browser journal.');
}
async function verifyRetainedFiles(){
  for(const item of [...result.exports,...result.originalFiles]){
    ensure(typeof item.file==='string'&&path.basename(item.file)===item.file,'Unexpected original output path.');
    ensure(same(await fileFact(path.join(out,item.file)),{bytes:item.bytes,sha256:item.sha256}),
      'Retained browser output differs from its original receipt: '+item.file);
  }
}
(async()=>{
  try{
    await verifyRetainedFiles();
    for(const input of ready.inputs){
      ensure(same(await fileFact(input.path),{bytes:input.bytes,sha256:input.sha256}),'Original source packet changed before browser entry.');
      ensure(input.expectedPlan.coveragePolicy===ready.coveragePolicy,'Original mapping uses another coverage choice.');
    }
    if(result.status==='EDR_BROWSER_COMPLETE'){
      ensure(result.receiving.length===ready.inputs.length&&result.builds.length===ready.inputs.length,
        'The completed original browser result is incomplete.');
      run.status='verified-complete';run.endedAt=new Date().toISOString();checkpoint();
      process.stdout.write(JSON.stringify({status:result.status,resumedCompleted:true})+'\n');return;
    }
    const requireRuntime=createRequire(__filename);
    const modulePath=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright';
    const {chromium}=requireRuntime(modulePath);
    const executablePath=process.env.EDR_CHROMIUM_EXECUTABLE||process.env.ERDDAP_CHROMIUM_EXECUTABLE||
      process.env.SDMX_CHROMIUM_EXECUTABLE||undefined;
    const args=['--disable-dev-shm-usage','--disk-cache-size=1','--disable-application-cache'];
    if(typeof process.getuid==='function'&&process.getuid()===0)args.push('--no-sandbox');
    const downloadsPath=path.join(ready.temporaryDirectory,'browser-downloads');
    fs.mkdirSync(downloadsPath,{recursive:true,mode:0o700});
    context=await chromium.launchPersistentContext(ready.profileDirectory,{headless:true,executablePath,
      acceptDownloads:true,downloadsPath,viewport:{width:1440,height:960},args,
      env:{...process.env,TMPDIR:ready.temporaryDirectory,TEMP:ready.temporaryDirectory,TMP:ready.temporaryDirectory}});
    context.setDefaultTimeout(30000);
    context.on('page',attach);
    page=context.pages()[0]||await context.newPage();attach(page);
    for(const other of context.pages())if(other!==page)await other.close();
    await open(ready.original,ready.workspaceId);
    await phase('original-workspace',async()=>{
      const launch=await get(ready.original,'/api/launch');
      ensure(launch.workspace===ready.workspace&&!('url' in launch),'Public startup exposed a capability or another workspace.');
      result.original={workspaceId:ready.workspaceId,instanceId:launch.instanceId,sourceCount:ready.inputs.length};
    });
    for(let index=0;index<ready.inputs.length;index++){
      const input=ready.inputs[index];
      await phase('source-'+index,async()=>{await open(ready.original,ready.workspaceId);await inspectSource(input,index);});
      await phase('native-'+index,async()=>{await open(ready.original,ready.workspaceId);await buildAndQuery(input,index);});
    }
    await phase('edition-comparison',async()=>{await open(ready.original,ready.workspaceId);await compareEditions();});
    await phase('complete-records',async()=>{await open(ready.original,ready.workspaceId);await recordsJourney();});
    await phase('original-layout',()=>viewportJourney(ready.original,ready.workspaceId,'original'));
    for(let index=0;index<ready.inputs.length;index++)
      await phase('customer-'+index,()=>receiveProject(ready.inputs[index],index));
    await phase('customer-layout',()=>viewportJourney(ready.receiver,ready.receiverWorkspaceId,'customer'));
    await verifyRetainedFiles();
    ensure(result.errors.filter(x=>x.run===runId&&x.type==='page').length===0,'The original browser emitted page errors.');
    ensure(result.sources.length===ready.inputs.length&&result.builds.length===ready.inputs.length&&
      result.receiving.length===ready.inputs.length,'The whole original browser/receiving result is incomplete.');
    result.status='EDR_BROWSER_COMPLETE';result.completedAt=new Date().toISOString();
    run.status='complete';run.endedAt=result.completedAt;delete result.failure;checkpoint();
    process.stdout.write(JSON.stringify({status:result.status,sources:result.sources.length,builds:result.builds.length,
      receiving:result.receiving.length,coveragePolicy:ready.coveragePolicy})+'\n');
  }catch(error){
    result.status='RETAINED_FOR_CONTINUATION';run.status='failed';run.endedAt=new Date().toISOString();
    result.failure={run:runId,phase:currentPhase,name:error.name,message:safe(error.message),
      stack:safe(error.stack),requests:requestFailures};
    checkpoint();process.stderr.write(JSON.stringify(result.failure)+'\n');process.exitCode=1;
  }finally{
    if(context){
      try{await context.close();run.browserClosedAt=new Date().toISOString();}
      catch(error){run.closeError=safe(error.message);result.status='RETAINED_FOR_CONTINUATION';process.exitCode=1;}
      checkpoint();
    }
  }
})();
