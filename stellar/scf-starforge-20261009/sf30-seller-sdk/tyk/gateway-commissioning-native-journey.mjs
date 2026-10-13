// MIT. The original two-Gateway commissioning operation; no independent native controller.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectTykDefinition } from './native.mjs';
import { probeHeaders, receiveProbe, originalAgentResult } from './commissioning-native-journey.mjs';
import { MerchantTykWorkspaces } from '../../../../stellar-forge/mcp-merchant-operator/tyk-workspace.mjs';
import { TYK_AGENT_METHODS, tykWorkspaceTools } from '../../../../stellar-forge/mcp-merchant-operator/catalog/tyk-workspace.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const need=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'TYK_GATEWAY_COMMISSIONING_NATIVE_MISMATCH'});};
const ref=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
const CHECKS=['Complete active source identity','Route returns original upstream'];
export async function runTykGatewayCommissioningJourney(context){
  const {config,initial,targets,root,call,current,rollout,capture,definition,retainReview,freeze,step,
    requestId,apiId,prefix,cloneClassic,preciseJson,sender,fetch=globalThis.fetch}=context;
  const selected=config.gatewayProduction,count=config.gatewayCommissioningApiCount??12;
  need(selected&&Number.isInteger(count)&&count>=2&&count<=20,'Select the actual production Gateway and two to twenty APIs.');
  need(targets.gatewayProduction&&targets.gatewayProduction.id!==targets.gateway.id&&selected.connection.baseUrl!==config.gateway.connection.baseUrl,
    'Keep two distinct original Gateway targets.');
  const originalSeed=preciseJson(initial.seeds.gateway.definitionText),seed=originalSeed.api_definition??originalSeed;
  const coursePrefix=prefix+'gateway-course/',firstId=apiId('gateway-classic');
  const intake=await step('gateway-course-complete-original-intake',async()=>{
    const portfolio=await capture('gateway-course-before-update',targets.gateway.id),existing=await definition(portfolio.record,firstId);
    need(existing.kind==='classic'&&existing.found,'Retain the original active API for the update arm.');
    const update=preciseJson(existing.definitionText);update.name=config.operation+' course existing API';
    const entries=[{key:'existing-api',label:'Original existing API',productionOperation:'update',
      selection:{operation:'update',kind:'classic',apiId:firstId,definitionText:json(update)}}];
    for(let index=1;index<count-1;index++){
      const key='source-'+String(index+1).padStart(2,'0'),body=preciseJson(cloneClassic(initial.seeds.gateway,{
        apiId:apiId('gateway-course:'+key),name:config.operation+' '+key,listenPath:coursePrefix+key+'/',upstreamUrl:config.gateway.upstreamUrl}));
      const document=body.api_definition??body;
      if(Object.hasOwn(seed,'use_keyless'))document.use_keyless=seed.use_keyless;else delete document.use_keyless;
      entries.push({key,label:'Original API '+(index+1),productionOperation:'create',selection:{operation:'create',kind:'classic',
        apiId:apiId('gateway-course:'+key),definitionText:json(body)}});
    }
    const plain={openapi:'3.0.3',info:{title:config.operation+' plain native OpenAPI',version:'1.0.0'},
      servers:[{url:config.gateway.upstreamUrl}],paths:{'/':{get:{operationId:'originalGatewayCourseProbe',
        responses:{'200':{description:'Original upstream response'}}}}}};
    entries.push({key:'native-import',label:'Original plain OpenAPI import',productionOperation:'create',
      selection:{operation:'import',kind:'oas',definitionText:json(plain),
        query:{upstreamURL:config.gateway.upstreamUrl,listenPath:coursePrefix+'native-import/',authentication:false}}});
    return {entries,sourceCapture:portfolio.record,sourceHashes:entries.map(e=>({key:e.key,sha256:sha(e.selection.definitionText)}))};
  });
  await step('gateway-course-original-production-preimage',async()=>{
    // This creates the real existing production API once so the course also operates the native update path.
    const body=cloneClassic(initial.seeds.gateway,{apiId:firstId,name:config.operation+' existing production API',
      listenPath:prefix+'classic/',upstreamUrl:selected.upstreamUrl});
    const saved=await rollout('gateway-course-production-original-create',targets.gatewayProduction.id,
      {operation:'create',kind:'classic',apiId:firstId,definitionText:body});
    const original=await current(saved.record);need(original.response?.ok,'The original production preimage create was not acknowledged.');
    await rollout('gateway-course-production-original-reload',targets.gatewayProduction.id,{operation:'hotReload',scope:'node',block:true});
    const active=await capture('gateway-course-production-before-update',targets.gatewayProduction.id);
    need((await definition(active.record,firstId)).found,'The original production update preimage must actually exist.');
    return {record:ref(original),capture:active.record};
  });
  const exportDir=join(root,'gateway-commissioning-agent-exports');await mkdir(exportDir,{recursive:true,mode:0o700});
  const agent=new MerchantTykWorkspaces({exportsDirectory:exportDir,tykWorkspaces:{workspaces:{native:{
    label:'Original two-Gateway operation',workspaceId:sender.host.workspaceId,consoleUrlEnv:'TYK_NATIVE_ORIGINAL_WORKSPACE_URL',files:{}}}}},
    {environment:{...process.env,TYK_NATIVE_ORIGINAL_WORKSPACE_URL:sender.host.url}});
  try{
    const tools=tykWorkspaceTools((name,description,properties,required,options)=>({name,description,properties,required,options}));
    for(const method of ['createGatewayCommissioning','readGatewayCommissioning','prepareGatewayCommissioningStep','refreshGatewayCommissioning','recordGatewayCommissioningReview'])
      need(Object.values(TYK_AGENT_METHODS).includes(method),'The original MCP catalogue must publish '+method+'.');
    const created=await step('gateway-course-original-saved-plan',async()=>originalAgentResult(agent,
      await agent.call('merchant_tyk_create_gateway_commissioning',{workspace:'native',...await freeze('gateway-course:create',{
        requestId:requestId('gateway-course:create'),stagingConnectionId:targets.gateway.id,productionConnectionId:targets.gatewayProduction.id,
        label:config.operation+' complete Gateway course',operator:'Original native receiving operator',
        entries:intake.entries,checkNames:CHECKS,reload:{scope:'node',block:true}})})));
    const id=created.id,read=()=>call('readGatewayCommissioning',{id});
    async function execute(stepId){
      return step('gateway-course-native:'+stepId,async()=>{
        let view=await read(),native=view.rollouts[stepId];
        if(!native){
          const saved=await call('prepareGatewayCommissioningStep',await freeze('gateway-course:'+stepId+':prepare',{
            requestId:requestId('gateway-course:'+stepId+':prepare'),id,expectedRevision:view.record.revision,stepId}));
          native=await call('getRecord',{kind:'rollout',id:saved.value.bindings[stepId].id});
        }
        if(native.value.phase==='PREPARING'||native.value.phase==='PREPARE_FAILED'){
          await call('prepareGatewayCommissioningStep',await freeze('gateway-course:'+stepId+':prepare',{
            requestId:requestId('gateway-course:'+stepId+':prepare'),id,expectedRevision:view.record.revision,stepId}));
          native=await current(native);
        }
        const prepared=await freeze('gateway-course:'+stepId+':original-prepared',ref(native));
        await retainReview(await call('getRecord',{kind:'rollout',id:prepared.id,revision:prepared.revision}));
        if(!native.value.dispatchedAt){
          need(native.value.phase==='PREPARED','Preserve the original incomplete preparation: '+stepId+' / '+native.value.phase);
          native=await call('dispatchRollout',await freeze('gateway-course:'+stepId+':dispatch',{
            requestId:requestId('gateway-course:'+stepId+':dispatch'),id:native.id,expectedRevision:native.revision,planSha256:native.value.planSha256}));
        }
        if(['UNKNOWN','DISPATCHED','READBACK'].includes(native.value.state)||['DISPATCHED','READBACK'].includes(native.value.phase))
          native=await call('reconcileRollout',await freeze('gateway-course:'+stepId+':reconcile',{
            requestId:requestId('gateway-course:'+stepId+':reconcile'),id:native.id}));
        native=await current(native);await retainReview(native);view=await read();
        need(view.progress.steps.find(row=>row.id===stepId)?.complete,
          'The original Gateway request is not complete; retain and reconcile it without replay: '+stepId+' / '+native.value.state);
        return {record:ref(native),state:native.value.state,response:native.value.response,reconciliation:native.value.reconciliation};
      });
    }
    const probes=[];
    for(const phase of ['staging','production']){
      const prefix=phase==='staging'?'stage':'production';
      for(const entry of intake.entries)await execute(prefix+':'+entry.key);
      await execute(prefix+'-reload');
      await step('gateway-course-active-capture:'+phase,async()=>{
        const view=await read(),record=await call('refreshGatewayCommissioning',await freeze('gateway-course:'+phase+':capture',{
          requestId:requestId('gateway-course:'+phase+':capture'),id,expectedRevision:view.record.revision,phase}));
        const result=await read();need(result.observations[phase]?.apis.length===count,'Capture all actual active '+phase+' sources.');
        return {record:ref(record),observation:result.observations[phase]};
      });
      const checked=await step('gateway-course-actual-checks:'+phase,async()=>{
        const view=await read(),context=view.reviewContexts[phase],target=phase==='staging'?config.gateway:selected;
        need(context,'Retain the source-bound operational review context.');
        const baseline=await receiveProbe(fetch,new URL(target.upstreamUrl),{timeoutMs:config.nativeTimeoutMs}),
          headers=probeHeaders(target),checks=[],results=[],transformations=[];
        need(baseline.ok,'The original upstream must return its real response.');
        for(const row of view.observations[phase].apis){
          const original=await definition(view.observations[phase].capture,row.apiId),inspected=inspectTykDefinition(original.definitionText,{kind:row.kind,apiId:row.apiId});
          need(inspected.sha256===row.sha256,'Retain complete exact active native definition bytes.');
          const path=inspected.summary.listenPath;need(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&!/[?#]/.test(path),'Use the original active native listen path.');
          const url=new URL(target.publicBaseUrl);url.pathname=path;url.search='';
          const response=await receiveProbe(fetch,url,{headers,timeoutMs:config.nativeTimeoutMs}),matched=response.ok&&response.status===baseline.status&&response.bytes===baseline.bytes&&response.sha256===baseline.sha256;
          results.push({target:phase,apiId:row.apiId,definitionSha256:row.sha256,...response,matched});
          checks.push({apiId:row.apiId,name:CHECKS[0],outcome:'passed',note:'Complete '+row.kind+' definition retained at SHA-256 '+row.sha256+'.'},
            {apiId:row.apiId,name:CHECKS[1],outcome:matched?'passed':'failed',note:'Actual HTTP '+response.status+' / '+response.bytes+' bytes / '+response.sha256+
              '; original upstream '+baseline.status+' / '+baseline.bytes+' bytes / '+baseline.sha256+'.'});
          if(row.transformationRequired){
            const source=intake.entries.find(entry=>entry.key===row.key);
            need(sha(source.selection.definitionText)===row.submittedSha256&&row.confirmation==='NATIVE_IMPORT_RECEIPT_AND_ACTIVE_SOURCE',
              'Native import acceptance must retain both full documents and actual provider identity.');
            const active=preciseJson(original.definitionText),submitted=preciseJson(source.selection.definitionText);
            need(active.openapi===submitted.openapi&&active.info.title===submitted.info.title&&
              JSON.stringify(active.paths)===JSON.stringify(submitted.paths),'The native imported source changed an original route or title; preserve it for explicit human review.');
            transformations.push({key:row.key,apiId:row.apiId,submittedSha256:row.submittedSha256,observedSha256:row.sha256,
              decision:'accepted',note:'The actual provider-assigned ID and native extension are retained. Original OpenAPI title/version routes remain present, full source and routing probe are attached. This is native transformation acceptance, not an exact-original-body confirmation.'});
          }
        }
        const evidence={schema:'stellar-forge.tyk-gateway-course-probes.v1',id,phase,contextSha256:context.sha256,baseline,results,checks,transformations};
        const full=json(evidence),path=join(root,'downloads','gateway-course-'+phase+'-probes.json');need(Buffer.byteLength(full)<=24*1024*1024,'Retain the complete bounded native probe evidence.');
        await writeFile(path,full,{mode:0o600});
        const record=await call('recordGatewayCommissioningReview',await freeze('gateway-course:'+phase+':review:'+sha(full),{
          requestId:requestId('gateway-course:'+phase+':review:'+sha(full)),id,expectedRevision:view.record.revision,phase,
          contextSha256:context.sha256,reviewer:'Original native receiving operator',
          note:'Every full active source was inspected and every route probed against the original upstream. Complete responses and source identities are retained.',
          checks,transformations,files:[{name:'gateway-'+phase+'-complete-evidence.json',mediaType:'application/json',contentBase64:Buffer.from(full).toString('base64')}]}));
        need(checks.every(row=>row.outcome==='passed'),'Actual '+phase+' route failed; failed review is saved and production has not advanced.');
        return {record:ref(record),path,bytes:Buffer.byteLength(full),sha256:sha(full),results};
      });
      probes.push(...checked.results.map(({target,url,bytes,sha256})=>({target,url,bytes,sha256})));
    }
    const completed=await originalAgentResult(agent,await agent.call('merchant_tyk_gateway_commissioning',{workspace:'native',id}));
    need(completed.progress.state==='COMPLETE'&&completed.progress.steps.every(row=>row.complete)&&completed.progress.summary.steps===count*2+6,
      'Complete every actual Gateway course step.');
    return {state:'COMPLETE',id,record:ref(completed.record),manuscript:completed.record.value.manuscript,
      staging:{baseUrl:config.gateway.connection.baseUrl,capture:completed.observations.staging.capture},
      production:{baseUrl:selected.connection.baseUrl,capture:completed.observations.production.capture},
      apiIds:completed.observations.production.apis.map(api=>api.apiId),progress:completed.progress,probes,agent:{tools:tools.length},
      nativeOutcomeNote:'Imported source was accepted explicitly against both exact documents; original native reconciliation remains unchanged.'};
  }finally{await agent.close();}
}
export async function inspectTykGatewayCommissioningBrowser({config,root,sender,call,course,hashFile}){
  need(config.chromiumExecutablePath,'Supply the actual existing Chromium executable for the complete outgoing product.');
  const {chromium}=await import(config.playwrightModulePath?pathToFileURL(config.playwrightModulePath).href:'playwright');
  const browser=await chromium.launch({headless:true,executablePath:config.chromiumExecutablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true}),errors=[],screenshots=[],downloads=[];
    page.on('pageerror',error=>errors.push(error.message));const idle=()=>page.locator('main[aria-busy="false"]').waitFor();
    async function screen(name){const path=join(root,'downloads',name+'.png');await page.screenshot({path,fullPage:true});screenshots.push(await hashFile(path));}
    async function receive(name,file){const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();
      const result=await pending,path=join(root,'downloads',file);await result.saveAs(path);const retained=await hashFile(path);downloads.push(retained);return {retained,bytes:await readFile(path)};}
    await page.goto(sender.host.url,{waitUntil:'networkidle'});await idle();await page.locator('[data-tab="gateway-commissioning"]').click();
    await screen('gateway-intake-empty-wide');
    await page.locator('#gateway-entry-form [name="key"]').fill('retained-native-source');
    const view=await call('readGatewayCommissioning',{id:course.id}),entry=view.source.entries[0];
    await page.locator('#gateway-entry-form [name="definitionText"]').fill(entry.selection.definitionText);
    await page.locator('#gateway-entry-form [name="label"]').fill('Complete source draft reopening');
    await page.locator('#gateway-entry-form button[type="submit"]').click();
    await page.getByRole('button',{name:'Save local intake',exact:true}).click();await idle();
    need((await page.locator('#gateway-draft-status').innerText()).includes('Complete draft saved locally'),'Retain the complete intake before reload.');
    await page.reload({waitUntil:'networkidle'});await idle();await page.locator('[data-tab="gateway-commissioning"]').click();
    need((await page.locator('#gateway-entry-list').innerText()).includes('Complete source draft reopening'),'Reopen the original complete intake source.');
    const draft=await receive('Download working intake','gateway-browser-intake.json'),parsed=JSON.parse(draft.bytes);
    need(parsed.entries.some(row=>row.selection.definitionText===entry.selection.definitionText),'The complete intake download changed native source.');
    for(;;){const row=page.locator('#gatewayCommissioning-list tbody tr').filter({hasText:view.record.value.label});
      if(await row.count()){await row.first().getByRole('button',{name:'Open',exact:true}).click();break;}
      const next=page.locator('#gatewayCommissioning-pages').getByRole('button',{name:'Next',exact:true});
      need(await next.count()&&await next.isEnabled(),'Find the original complete Gateway course.');await next.click();await idle();}
    await idle();const panel=page.locator('#gateway-course-current');
    need((await panel.innerText()).includes(course.id)&&(await panel.innerText()).includes('COMPLETE'),'Render the actual complete Gateway source course.');
    await panel.getByRole('button',{name:'Refresh Gateway progress',exact:true}).click();await idle();
    const plan=await receive('Download complete Gateway operating plan','gateway-browser-plan.json');
    need(JSON.stringify(JSON.parse(plan.bytes))===JSON.stringify(view.plan),'Download every complete original operating-plan edition.');
    await page.locator('#gateway-production-definitions tbody tr').first().getByRole('button',{name:'Open submitted and active source',exact:true}).click();await idle();
    const active=await receive('Download Active native source','gateway-browser-active.json');
    need(active.retained.sha256===view.observations.production.apis[0].sha256,'Download exact active native source bytes.');
    await page.getByRole('button',{name:'Close source',exact:true}).click();await screen('gateway-course-complete-wide');
    await page.setViewportSize({width:390,height:844});await screen('gateway-course-complete-narrow');
    await page.setViewportSize({width:1440,height:1080});
    await page.locator('#gateway-course-steps tbody tr').first().getByRole('button',{name:'Open Gateway native review',exact:true}).click();await idle();
    await page.getByRole('button',{name:'Return to Gateway commissioning',exact:true}).click();await idle();
    await page.getByRole('button',{name:'Open complete Gateway handover',exact:true}).click();
    need(await page.locator('#handover').isVisible()&&!errors.length,'Operate original source, native-review and complete receiving controls without browser errors.');
    return {screenshots,downloads,errors,rendered:true,visualReview:{state:'REQUIRES_PRODUCING_OWNER_INSPECTION',
      instruction:'Open and LOOK at the exact wide/narrow screens and all final attachments, operate important controls, inspect loading/error/empty states, and repair defects before calling the outgoing product ready.'}};
  }finally{await browser.close();}
}
