#!/usr/bin/env node
// Complete original SAM notice operating and receiving journey. Inputs remain in the selected private workspace.
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(process.env.SAM_NATIVE_ROOT);
const sourceRoot=resolve(process.env.SAM_SOURCE_ROOT);
const input=JSON.parse(await readFile(process.env.SAM_NATIVE_INPUT,'utf8'));
const moduleRoot=join(sourceRoot,'stellar/scf-starforge-20261009/sf30-seller-sdk/samgov');
const {openSamWorkspace}=await import(pathToFileURL(join(moduleRoot,'workspace.mjs')));
const {startSamWorkspace}=await import(pathToFileURL(join(moduleRoot,'server.mjs')));
const {exportSamWorkspace}=await import(pathToFileURL(join(moduleRoot,'reports.mjs')));
const {previewSamMerchant,serveSamMerchant}=await import(pathToFileURL(join(moduleRoot,'merchant.mjs')));
const {runSamCli}=await import(pathToFileURL(join(moduleRoot,'cli.mjs')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const now=()=>new Date().toISOString();
const operator=input.operator;
const workspace=join(root,'workspace'),opportunity=join(root,'opportunity-workspace');
const journalPath=join(root,'operation.json');
const formats=['portable','html','markdown','notices','reviews','changes','sources'];
const sourceCommit=process.env.SAM_SOURCE_COMMIT||input.sourceCommit;
const latestReviewNotes='The issued RFI overview and survey are received. Prepare organization-specific survey answers and review them against the source deadline.';
await mkdir(root,{recursive:true,mode:0o700});
let journal;
try{journal=JSON.parse(await readFile(journalPath,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;journal={schema:'stellar-forge.samgov-native-journey.v1',
  operationId:input.operationId,createdAt:now(),stages:{},actions:{},exports:{},sources:{}};}
assert.equal(journal.operationId,input.operationId);
async function save(){const p=journalPath+'.tmp';await writeFile(p,JSON.stringify(journal,null,2)+'\n',{mode:0o600});await rename(p,journalPath);}
async function putJson(name,value){const p=join(root,name);await mkdir(resolve(p,'..'),{recursive:true,mode:0o700});
  await writeFile(p,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
async function stage(name,work){
  if(journal.stages[name]?.state==='complete')return journal.stages[name].result;
  journal.currentStage=name;journal.stages[name]={state:'running',startedAt:now()};await save();
  const result=await work();journal.stages[name]={...journal.stages[name],state:'complete',completedAt:now(),result};
  await save();process.stdout.write(JSON.stringify({stage:name,state:'complete',result})+'\n');return result;
}
function safeError(error){return {code:String(error?.code||error?.name||'NATIVE_OPERATION_FAILED').slice(0,100),
  message:String(error?.message||'Original native operation failed')
    .replace(/([?&](?:api_key|access_token|token|secret|password)=)[^&#\s]+/gi,'$1[redacted]')
    .replace(/#token=[^&#\s]+/g,'#token=[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,2000)};}
let store=null,server=null,merchant=null,browser=null;
const open=async()=>store??(store=await openSamWorkspace({directory:workspace,operator,opportunityDirectory:opportunity}));
async function action(name,key,data){
  await open();
  if(!journal.actions[key]){
    journal.actions[key]={action:name,payload:{...data,requestId:input.operationId+':'+key,
      expectedRevision:(await store.list()).revision},preparedAt:now()};await save();
  }
  const item=journal.actions[key];assert.equal(item.action,name);
  if(item.result)return item.result;
  const response=await store.dispatch(name,item.payload);
  item.result=response.result;item.revision=response.workspace.revision;item.completedAt=now();await save();
  return item.result;
}
async function cli(args){
  let out='',err='';
  const result=await runSamCli([...args,'--workspace',workspace,'--operator',operator,
    '--opportunity-workspace',opportunity],{stdout:{write:x=>{out+=String(x);}},stderr:{write:x=>{err+=String(x);}}});
  return {result,output:out,diagnostics:err};
}
async function exportsFor(name,handoffId){
  await open();const values={};await mkdir(join(root,'exports',name),{recursive:true,mode:0o700});
  for(const format of formats){
    const item=await exportSamWorkspace(store,{format,handoffId});
    const file=join(root,'exports',name,format+(format==='portable'?'.json':format==='html'?'.html':format==='markdown'?'.md':'.csv'));
    const expected=journal.exports[name]?.[format];
    if(expected){assert.equal(item.sha256,expected.sha256);assert.equal(item.bytes.length,expected.bytes);}
    else await writeFile(file,item.bytes,{mode:0o600});
    values[format]={filename:item.filename,sha256:item.sha256,bytes:item.bytes.length,revision:item.revision,file};
  }
  if(!journal.exports[name]){journal.exports[name]=values;await save();}
  return values;
}
async function assertSources(target,sourceIds){
  const result=[];
  for(const id of sourceIds){const original=await target.readSource(id),body=Buffer.from(original.contentBase64,'base64');
    assert.equal(sha(body),original.sha256);assert.equal(body.length,original.bytes);
    result.push({id,sha256:original.sha256,bytes:body.length,kind:original.kind,status:original.status});}
  return result;
}
const originalFiles={};
for(const [name,file] of Object.entries(input.files)){
  const bytes=await readFile(file.path);assert.equal(sha(bytes),file.sha256,name+' source changed');
  originalFiles[name]={...file,bytes};
}
const deadline=input.deadline;
const reviewedNotes='The complete issued notice, attachment index and publication history are retained. Review the RFI overview and survey and prepare the organization-specific responses before the issued deadline.';
async function api(target,path,{method='GET',body}={}){
  const token=new URLSearchParams(new URL(target.url).hash.slice(1)).get('token');
  const response=await fetch(target.origin+path,{method,headers:{authorization:'Bearer '+token,
    ...(body===undefined?{}:{'content-type':'application/json',origin:target.origin})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const bytes=Buffer.from(await response.arrayBuffer());
  if(response.status!==200){let detail;try{detail=JSON.parse(bytes.toString());}catch{}
    throw Object.assign(new Error(detail?.error?.message||'Original HTTP operation failed'),{code:detail?.error?.code||'HTTP_'+response.status});}
  return {bytes,json:()=>JSON.parse(bytes.toString('utf8')),headers:response.headers};
}
try{
  await stage('01_original_notice_cli',async()=>{
    const capturedAt=journal.noticeReceivedAt??now();journal.noticeReceivedAt=capturedAt;await save();
    const got=await cli(['notice','--notice-file',originalFiles.notice.path,
      '--resource-index-file',originalFiles.resources.path,'--history-file',originalFiles.history.path,
      '--captured-at',capturedAt,'--name','Issued notice and source index',
      '--request-id',input.operationId+':issued-notice','--expected-revision','0']);
    const result=got.result.result;assert.equal(result.noticeId,input.noticeId);
    assert.equal(result.sourceBasis,'retained_notice_document');assert.equal(result.sourceIds.length,3);
    journal.intake=result;await save();await open();
    const selected=(await store.get(result.editionId)).items;
    assert.equal(selected.length,1);const notice=selected[0];
    assert.equal(notice.source.format,'samgov_notice_document.v1');
    assert.equal(notice.noticeHistory.length,input.historyEntries);
    assert.equal(notice.attachmentIndex.filter(x=>x.type==='file').length,input.attachmentCount);
    assert.equal(notice.responseDeadLine,deadline.at);assert.equal(notice.issuedTimeZone,deadline.timeZone);
    assert.deepEqual(notice.raw,JSON.parse(originalFiles.notice.bytes.toString('utf8')));
    const sourceRows=await assertSources(store,result.sourceIds);
    for(const [name,kind] of [['notice','notice_record'],['resources','notice_resources'],['history','notice_history']])
      assert.equal(sourceRows.find(x=>x.kind===kind).sha256,originalFiles[name].sha256);
    journal.noticeTitle=notice.title;await save();
    return {editionId:result.editionId,noticeId:result.noticeId,title:notice.title,deadline:notice.responseDeadLine,
      issuedTimeZone:notice.issuedTimeZone,historyEntries:notice.noticeHistory.length,sources:sourceRows};
  });
  await stage('02_review_selection_frozen_handoff',async()=>{
    await action('review_notice','initial-review',{editionId:journal.intake.editionId,noticeId:input.noticeId,
      status:'watching',owner:operator,notes:reviewedNotes,deadline});
    const selection=await action('save_selection','initial-selection',{editionId:journal.intake.editionId,
      name:'Issued source review',noticeIds:[input.noticeId],notes:'Original notice, publication history and issued attachment index.'});
    journal.selectionId=selection.selectionId;await save();
    const handoff=await action('create_handoff','first-handoff',{selectionId:selection.selectionId,
      name:'Issued notice review',note:'The original notice and its index/history, before the issued binaries were received.'});
    journal.firstHandoffId=handoff.handoffId;await save();const exports=await exportsFor('first',handoff.handoffId);
    return {selectionId:selection.selectionId,handoffId:handoff.handoffId,exports};
  });
  await stage('03_original_attachment_receiving',async()=>{
    let editionId=journal.intake.editionId;const retained=[];
    for(const name of input.attachmentFiles){
      const file=originalFiles[name],notice=(await (await open()).get(editionId)).items[0];
      const attachment=notice.attachmentIndex.find(item=>item.resourceId===file.resourceId);
      assert.ok(attachment?.url);assert.ok(notice.resourceLinks.includes(attachment.url));
      const result=await action('retain_resource','receive-'+name,{editionId,noticeId:input.noticeId,
        kind:'attachment',url:attachment.url,filename:attachment.name,
        mediaType:file.mediaType,capturedAt:file.capturedAt,contentBase64:file.bytes.toString('base64')});
      editionId=result.editionId;
      const source=await store.readSource(result.sourceId);
      assert.equal(source.sha256,file.sha256);assert.equal(source.status,'received_file');
      assert.ok(Buffer.from(source.contentBase64,'base64').equals(file.bytes));retained.push(result);
    }
    journal.finalEditionId=editionId;journal.retainedAttachments=retained;await save();
    const row=(await store.get(editionId)).items[0];
    assert.deepEqual(row.raw,JSON.parse(originalFiles.notice.bytes.toString('utf8')));
    assert.equal(row.resources.length,input.attachmentFiles.length);
    assert.equal(row.source.companions.length,2);assert.equal(row.noticeHistory.length,input.historyEntries);
    return {editionId,retained,sourceCount:(await store.get(editionId)).record.sourceCount};
  });
  await stage('04_source_change_and_current_selection',async()=>{
    const compared=await (await open()).dispatch('compare',{beforeEditionId:journal.intake.editionId,afterEditionId:journal.finalEditionId});
    assert.equal(compared.counts.changed,1);
    assert.ok(compared.items[0].changedFields.includes('resources'));
    await action('review_change','source-file-review',{beforeEditionId:journal.intake.editionId,
      afterEditionId:journal.finalEditionId,noticeId:input.noticeId,decision:'reviewed',owner:operator,
      note:'Received the two files listed in the original issued attachment index. The notice and published history are unchanged.'});
    await action('review_notice','complete-source-review',{editionId:journal.finalEditionId,noticeId:input.noticeId,
      status:'watching',owner:operator,notes:reviewedNotes,deadline});
    const selection=await action('save_selection','current-selection',{selectionId:journal.selectionId,
      editionId:journal.finalEditionId,name:'Complete issued source packet',noticeIds:[input.noticeId],
      notes:'Original notice, four-entry publication history, attachment index, issued RFI overview and survey.'});
    await exportsFor('first',journal.firstHandoffId);
    return {change:compared.counts,selectionRevision:selection.selectionRevision,priorNamedFormatsUnchanged:formats.length};
  });
  await stage('05_original_merchant_and_buyer_preparation',async()=>{
    const publication=await action('prepare_merchant','merchant-publication',{selectionId:journal.selectionId,
      payment:input.payment,origin:input.origin,path:'/procurement-notices',defaultLimit:10,maxLimit:50});
    journal.merchantPublicationId=publication.publicationId;await save();
    const saved=(await store.get(publication.publicationId)).record;
    const merchantDirectory=join(workspace,saved.directory);
    const preview=await previewSamMerchant(merchantDirectory,{limit:'10'});
    assert.equal(preview.mode,'LOCAL_ORIGINAL_DATASET');
    const content=Buffer.isBuffer(preview.response.body)?preview.response.body.toString('utf8'):
      typeof preview.response.body==='string'?preview.response.body:JSON.stringify(preview.response.body??preview.response);
    assert.ok(content.includes(input.noticeId));await putJson('merchant-preview.json',preview);
    merchant=await serveSamMerchant(merchantDirectory,{port:journal.merchantPort??0,nativeFactory:null,control:true,controlTransport:'loopback'});
    journal.merchantPort=merchant.server.address().port;await save();
    const seller='http://127.0.0.1:'+journal.merchantPort;
    const challenge=await fetch(seller+'/procurement-notices?limit=10');
    assert.equal(challenge.status,402);await challenge.arrayBuffer();
    const reviewed=await action('buyer_review','buyer-review',{publicationId:publication.publicationId,seller,query:{limit:'10'}});
    assert.equal(reviewed.review.mode,'CHALLENGE_ONLY');
    assert.equal(reviewed.review.snapshot,publication.snapshot);
    const prepared=await action('prepare_buyer','buyer-preparation',{publicationId:publication.publicationId,
      reviewId:reviewed.reviewId,intentId:input.intentId,acceptIndex:0,offerSha256:reviewed.review.offerSha256});
    assert.equal(prepared.mode,'ORIGINAL_SF88_CONFIG_PREPARED');
    assert.equal(prepared.snapshot,publication.snapshot);
    await putJson('buyer-preparation.json',prepared);await merchant.close();merchant=null;
    return {publicationId:publication.publicationId,snapshot:publication.snapshot,mode:reviewed.review.mode,
      originalChallengeStatus:402,offerSha256:reviewed.review.offerSha256,buyerConfigSha256:prepared.configSha256};
  });
  await stage('06_original_opportunity_handoff',async()=>{
    const result=await action('prepare_opportunity','opportunity-bridge',{selectionId:journal.selectionId,
      noticeId:input.noticeId,title:journal.noticeTitle,documentKind:'rfi',deadline});
    journal.opportunityProjectId=result.projectId;await save();
    assert.equal(result.sourceBindings.length,3+input.attachmentFiles.length);
    const {openOpportunityStore}=await import(pathToFileURL(join(sourceRoot,
      'stellar/scf-starforge-20261009/partners/lgndx-opportunity-operations/model.mjs')));
    const target=await openOpportunityStore({directory:opportunity,operator});
    try{
      const value=await target.get(result.projectId);assert.equal(value.sources.length,4+input.attachmentFiles.length);
      assert.equal(Date.parse(value.opportunity.dueAt),Date.parse(deadline.at));
      assert.equal(value.opportunity.timeZone,deadline.timeZone);
      for(const binding of result.sourceBindings)assert.ok(value.sources.some(s=>s.id===binding.opportunitySourceId&&s.sha256===binding.sha256));
      await putJson('opportunity-handoff.json',{projectId:value.id,revision:value.revision,opportunity:value.opportunity,sources:value.sources});
      return {projectId:value.id,revision:value.revision,sources:value.sources.length,bridgeId:result.bridgeId};
    }finally{await target.close();}
  });
  await stage('07_browser_operation',async()=>{
    await open();server=await startSamWorkspace({directory:workspace,operator,store,opportunityDirectory:opportunity});
    const {chromium}=await import(pathToFileURL(process.env.SAM_PLAYWRIGHT_MODULE));
    browser=await chromium.launch({executablePath:process.env.SAM_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--disable-background-networking','--renderer-process-limit=1']});
    const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
    const errors=[];page.on('pageerror',error=>errors.push(safeError(error)));
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#panel[aria-busy="false"]').waitFor({timeout:45000});
    const views=[];
    await mkdir(join(root,'browser'),{recursive:true,mode:0o700});
    for(const tab of ['searches','notices','changes','selections','handoffs']){
      await page.locator('#tabs button[data-tab="'+tab+'"]').click();
      await page.locator('#panel[aria-busy="false"]').waitFor();
      assert.equal(await page.locator('#panel h2').count()>0,true);
      await page.screenshot({path:join(root,'browser',tab+'-desktop.png'),fullPage:false,animations:'disabled',scale:'css'});
      views.push({tab,heading:await page.locator('#panel h2').first().innerText()});
    }
    await page.locator('#tabs button[data-tab="notices"]').click();
    await page.locator('#panel[aria-busy="false"]').waitFor();
    await page.locator('[data-action="notice-detail"][data-id="'+input.noticeId+'"]').first().click();
    await page.locator('.notice-detail').waitFor();
    assert.ok((await page.locator('.notice-detail').innerText()).includes('Published notice history'));
    const sourceId=journal.intake.sourceIds[0];
    await page.locator('[data-action="view-source"][data-id="'+sourceId+'"]').click();
    await page.locator('#source-viewer[open]').waitFor();
    assert.ok((await page.locator('#source-text').innerText()).includes(input.noticeId));
    await page.locator('#source-viewer [data-close-source]').first().click();
    const marker=latestReviewNotes;
    if(!(await store.list()).reviews.some(r=>r.editionId===journal.finalEditionId&&r.notes===marker)){
      await page.locator('.notice-detail [data-action="review-notice"]').click();
      await page.locator('#editor[open]').waitFor();
      await page.locator('#editor [name="notes"]').fill(marker);
      await page.locator('#editor-save').click();
      await page.locator('#editor').waitFor({state:'hidden'});
    }
    assert.ok((await page.locator('.notice-detail').innerText()).includes(marker));
    const desktop=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(desktop.document<=desktop.viewport+1);
    await page.setViewportSize({width:390,height:844});
    await page.locator('#tabs button[data-tab="notices"]').click();
    await page.locator('#panel[aria-busy="false"]').waitFor();
    await page.screenshot({path:join(root,'browser','notices-mobile.png'),fullPage:false,animations:'disabled',scale:'css'});
    const mobile=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(mobile.document<=mobile.viewport+1);
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#tabs button[data-tab="handoffs"]').click();
    await page.locator('#panel[aria-busy="false"]').waitFor();
    const downloadPromise=page.waitForEvent('download');
    await page.locator('[data-action="export"][data-kind="handoff"][data-format="html"][data-id="'+journal.firstHandoffId+'"]').click();
    const download=await downloadPromise,downloadPath=join(root,'browser','first-named-handoff.html');
    await download.saveAs(downloadPath);
    assert.equal(sha(await readFile(downloadPath)),journal.exports.first.html.sha256);
    assert.deepEqual(errors,[]);
    await browser.close();browser=null;await server.close();server=null;
    return {views,desktop,mobile,pageErrors:errors.length,originalNamedDownloadSha256:journal.exports.first.html.sha256};
  });
  await stage('08_final_handoff_and_fresh_receiving',async()=>{
    await open();
    const final=await action('create_handoff','final-handoff',{selectionId:journal.selectionId,
      name:'Complete issued source and operating handoff',note:'Original notice/history/index and both issued files, current source review, original merchant and buyer preparation, and opportunity handoff.'});
    journal.finalHandoffId=final.handoffId;await save();
    await exportsFor('first',journal.firstHandoffId);const all=await exportsFor('final',final.handoffId);
    assert.ok((await readFile(all.html.file,'utf8')).includes(latestReviewNotes));
    const finalBytes=await readFile(all.portable.file),packet=JSON.parse(finalBytes.toString('utf8'));
    const expectedView=await store.list(),expectedSources=await assertSources(store,expectedView.sources.map(s=>s.id));
    await store.close();store=null;
    const originalCli=await cli(['list']);assert.equal(originalCli.result.revision,expectedView.revision);
    const receivingDirectory=join(root,'receiving');
    const receiver=await startSamWorkspace({directory:receivingDirectory,operator});
    try{
      const first=(await api(receiver,'/api/receive',{method:'POST',body:{packet}})).json();
      assert.equal(first.workspace.revision,expectedView.revision);
      const again=(await api(receiver,'/api/receive',{method:'POST',body:{packet}})).json();
      assert.equal(again.workspace.revision,expectedView.revision);
      const earlier=JSON.parse(await readFile(journal.exports.first.portable.file,'utf8'));
      const older=(await api(receiver,'/api/receive',{method:'POST',body:{packet:earlier}})).json();
      assert.equal(older.workspace.revision,expectedView.revision);
      assert.deepEqual(await assertSources(receiver.store,expectedView.sources.map(s=>s.id)),expectedSources);
      for(const [name,id] of [['first',journal.firstHandoffId],['final',journal.finalHandoffId]])
        for(const format of formats){
          const got=await api(receiver,'/api/export?'+new URLSearchParams({format,handoffId:id}));
          assert.equal(sha(got.bytes),journal.exports[name][format].sha256,name+' '+format+' changed on receiving');
        }
    }finally{await receiver.close();}
    let output='';const receivedCli=await runSamCli(['list','--workspace',receivingDirectory,'--operator',operator],
      {stdout:{write:x=>{output+=String(x);}},stderr:{write:()=>{}}});
    assert.equal(receivedCli.revision,expectedView.revision);assert.equal(receivedCli.handoffs.length,2);
    return {workspaceId:expectedView.id,revision:expectedView.revision,notices:1,sources:expectedSources,
      handoffs:2,namedExportsCompared:formats.length*2,originalCliReopened:true,receivingCliReopened:true,
      repeatImportPreserved:true,olderImportPreserved:true,finalPortable:{bytes:finalBytes.length,sha256:sha(finalBytes)}};
  });
  journal.completedAt=now();journal.currentStage=null;await save();
  const summary={schema:journal.schema,operationId:journal.operationId,sourceCommit,
    state:'complete',completedAt:journal.completedAt,stages:Object.keys(journal.stages).length,
    result:journal.stages['08_final_handoff_and_fresh_receiving'].result,
    browser:journal.stages['07_browser_operation'].result,
    merchant:journal.stages['05_original_merchant_and_buyer_preparation'].result,
    opportunity:journal.stages['06_original_opportunity_handoff'].result};
  await putJson('CUSTOMER_RESULT.json',summary);process.stdout.write(JSON.stringify(summary)+'\n');
}catch(error){
  journal.lastError={...safeError(error),at:now(),stage:journal.currentStage};await save().catch(()=>{});
  process.stderr.write(JSON.stringify(journal.lastError)+'\n');process.exitCode=1;
}finally{
  for(const value of [browser,merchant,server,store])if(value)try{await value.close();}catch(error){process.stderr.write(JSON.stringify(safeError(error))+'\n');process.exitCode=1;}
}
