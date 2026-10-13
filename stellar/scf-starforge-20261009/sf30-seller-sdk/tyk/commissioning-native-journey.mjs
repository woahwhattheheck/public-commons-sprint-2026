// MIT. Original Dashboard cohort commissioning in the existing Tyk native operation.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectTykDefinition } from './native.mjs';
import { MerchantTykWorkspaces } from '../../../../stellar-forge/mcp-merchant-operator/tyk-workspace.mjs';
import { tykWorkspaceTools, TYK_AGENT_METHODS } from '../../../../stellar-forge/mcp-merchant-operator/catalog/tyk-workspace.mjs';
import { TYK_WORKSPACE_ACTIONS } from './workspace/actions.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'TYK_COMMISSIONING_NATIVE_MISMATCH'});};
const json=value=>JSON.stringify(value,null,2)+'\n';
const ref=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
const CHECKS=Object.freeze(['Complete staged source matches captured identity','Staged route returns the selected upstream response']);
function targetUrl(value){
  const url=new URL(value);
  need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash,
    'Declare the actual connected Gateway public URL without embedded credentials.');
  return url;
}
export function probeHeaders(configuration){
  const output={};const selected=configuration.probeHeaderEnv??{};
  need(selected&&typeof selected==='object'&&!Array.isArray(selected),'Declare native probe header environment references.');
  for(const [name,environmentName]of Object.entries(selected)){
    need(/^[A-Za-z][A-Za-z0-9-]*$/.test(name)&&!/^(host|content-length|connection)$/i.test(name)&&
      typeof environmentName==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(environmentName),
      'Use declared HTTP header names and credential environment references.');
    need(typeof process.env[environmentName]==='string'&&process.env[environmentName],
      'The selected native probe credential environment reference is unavailable.');
    output[name]=process.env[environmentName];
  }
  return output;
}
export async function receiveProbe(fetch,url,{headers={},maximum=8*1024*1024,timeoutMs=120000}={}){
  const response=await fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  const parts=[];let bytes=0;
  need(response.body,'The original upstream probe returned no response stream.');
  for await(const chunk of response.body){
    bytes+=chunk.length;need(bytes<=maximum,'The complete probe reply exceeded its explicit retained-response limit.');
    parts.push(chunk);
  }
  const body=Buffer.concat(parts);
  return {url:String(url),method:'GET',status:response.status,ok:response.ok,
    contentType:response.headers.get('content-type'),bytes:body.length,sha256:hash(body),bodyBase64:body.toString('base64')};
}
export async function originalAgentResult(agent,value){
  if(value?.state!=='COMPLETE_RESULT_RETAINED')return value;
  const manifest=await agent.call('merchant_tyk_export_manifest',{exportId:value.exportId});
  need(manifest.manifestSha256===value.manifestSha256&&manifest.files.length===1,'Read the exact full original MCP result manifest.');
  const file=manifest.files[0],parts=[];let offset=0,readId,ended=false;
  try{
    for(;;){
      const page=await agent.call('merchant_tyk_export_file',{exportId:value.exportId,file:'original',
        expectedManifestSha256:value.manifestSha256,expectedSha256:file.sha256,offset,limit:65536,...(readId?{readId}:{})});
      const bytes=Buffer.from(page.data,'base64');
      need(page.exportId===value.exportId&&page.manifestSha256===value.manifestSha256&&
        page.file.sha256===file.sha256&&page.file.bytes===file.bytes&&page.offset===offset&&
        page.bytesRead===bytes.length&&page.encoding==='base64'&&page.data===bytes.toString('base64'),
        'Retain the exact original MCP range identity and bytes.');
      need(page.nextOffset===null?offset+bytes.length===file.bytes:page.nextOffset===offset+bytes.length,
        'Receive all original MCP result bytes without a gap or overlap.');
      parts.push(bytes);readId=page.readId;
      if(page.nextOffset===null){ended=true;break;}
      need(bytes.length>0,'An unfinished original MCP range made no progress.');offset=page.nextOffset;
    }
  }finally{if(readId&&!ended)await agent.call('merchant_tyk_export_file_release',{exportId:value.exportId,readId});}
  const bytes=Buffer.concat(parts);need(bytes.length===file.bytes&&hash(bytes)===file.sha256,'The complete MCP result bytes changed.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function runTykCommissioningJourney(context){
  const {config,initial,targets,root,call,current,rollout,capture,cohort,definition,retainReview,
    freeze,step,requestId,apiId,prefix,cloneClassic,preciseJson,sender,fetch=globalThis.fetch}=context;
  const selected=config.dashboard,publicBase=targetUrl(selected.publicBaseUrl);
  const count=selected.commissioningApiCount??12;
  need(Number.isInteger(count)&&count>=2&&count<=20,'Select two to twenty actual native cohort APIs.');
  const seed=JSON.parse(initial.seeds.dashboard.definitionText),seedDefinition=seed.api_definition??seed;
  const headers=probeHeaders(selected),probeMaximum=selected.probeMaximumBytes??8*1024*1024;
  need(Number.isSafeInteger(probeMaximum)&&probeMaximum>0&&probeMaximum<=24*1024*1024,'Use a complete native probe limit of at most 24 MiB.');
  const labels=Array.from({length:count},(_,index)=>'commissioning-'+String(index+1).padStart(2,'0'));
  const ids=labels.map(apiId);
  await step('commissioning-original-classic-sources',async()=>{
    const records=[];
    for(const label of labels){
      const body=preciseJson(cloneClassic(initial.seeds.dashboard,{apiId:apiId(label),name:config.operation+' '+label,
        listenPath:prefix+label+'/',upstreamUrl:selected.upstreamUrl}));
      const original=body.api_definition??body;
      // Preserve the selected native seed's authentication; never silently make a protected seed keyless.
      if(Object.hasOwn(seedDefinition,'use_keyless'))original.use_keyless=seedDefinition.use_keyless;
      else delete original.use_keyless;
      const saved=await rollout(label+'-create',targets.dashboard.id,
        {operation:'create',kind:'classic',apiId:apiId(label),definitionText:json(body)});
      need((await current(saved.record)).response?.ok,'The native Dashboard rejected a selected commissioning seed copy.');
      records.push(saved);
    }
    return records;
  });
  const saved=await step('commissioning-saved-complete-cohort',async()=>{
    const portfolio=await capture('commissioning-classic-portfolio',targets.dashboard.id);
    for(const id of ids)need((await definition(portfolio.record,id)).kind==='classic','Capture every complete selected Classic source.');
    return {portfolio,cohort:await cohort('native-complete-commissioning-cohort',portfolio,ids)};
  });
  const exportsDirectory=join(root,'commissioning-agent-exports');await mkdir(exportsDirectory,{recursive:true,mode:0o700});
  const environment={...process.env,TYK_NATIVE_ORIGINAL_WORKSPACE_URL:sender.host.url};
  const agent=new MerchantTykWorkspaces({exportsDirectory,tykWorkspaces:{workspaces:{native:{label:'Original native receiving workspace',
    workspaceId:sender.host.workspaceId,consoleUrlEnv:'TYK_NATIVE_ORIGINAL_WORKSPACE_URL',files:{}}}}},{environment});
  try {
  const declared=tykWorkspaceTools((name,description,properties,required,options)=>({name,description,properties,required,options}));
  for(const method of ['createCommissioning','readCommissioning','prepareCommissioningStep','recordCommissioningReview','refreshCommissioning']){
    const entry=Object.entries(TYK_AGENT_METHODS).find(([,value])=>value===method);
    need(entry&&declared.some(tool=>tool.name===entry[0])&&TYK_WORKSPACE_ACTIONS[method],'Publish every original commissioning action through the maintained MCP catalogue.');
  }
  const created=await step('commissioning-original-plan',async()=>originalAgentResult(agent,await agent.call('merchant_tyk_create_commissioning',{workspace:'native',...
    await freeze('commissioning:create',{requestId:requestId('commissioning:create'),cohortId:saved.cohort.id,
      cohortRevision:saved.cohort.revision,label:config.operation+' complete cohort commissioning',
      operator:'Original native receiving operator',checkNames:CHECKS,abortOnFailure:true,overrideStaged:false})})));
  const id=created.id,read=()=>call('readCommissioning',{id});
  async function execute(stepId){
    return step('commissioning-native-'+stepId,async()=>{
      let view=await read();
      const prepared=await call('prepareCommissioningStep',await freeze('commissioning:'+stepId+':prepare',{
        requestId:requestId('commissioning:'+stepId+':prepare'),id,expectedRevision:view.record.revision,stepId}));
      const binding=prepared.value.bindings[stepId];
      need(binding,'The saved commissioning step must retain its original rollout identity.');
      let native=await call('getRecord',{kind:'rollout',id:binding.id});
      const original=await freeze('commissioning:'+stepId+':prepared',ref(native));
      await retainReview(await call('getRecord',{kind:'rollout',id:original.id,revision:original.revision}));
      if(!native.value.dispatchedAt){
        need(native.value.phase==='PREPARED','Open the original incomplete or stale native preparation before dispatch.');
        native=await call('dispatchRollout',await freeze('commissioning:'+stepId+':dispatch',{
          requestId:requestId('commissioning:'+stepId+':dispatch'),id:native.id,
          expectedRevision:original.revision,planSha256:native.value.planSha256}));
      }
      if(['UNKNOWN','DISPATCHED','READBACK'].includes(native.value.state)||['DISPATCHED','READBACK'].includes(native.value.phase)){
        native=await call('reconcileRollout',await freeze('commissioning:'+stepId+':reconcile',{
          requestId:requestId('commissioning:'+stepId+':reconcile'),id:native.id}));
      }
      native=await current(native);await retainReview(native);view=await read();
      need(view.progress.steps.find(row=>row.id===stepId)?.complete,
        'The original '+stepId+' outcome is not complete; preserve its response and reconcile without another mutation: '+native.value.state);
      return {record:ref(native),state:native.value.state,requestId:native.value.dispatchRequestId,
        response:native.value.response,reconciliation:native.value.reconciliation};
    });
  }
  const conversion=await execute('conversion');
  await step('commissioning-complete-conversion-acceptance',async()=>{
    const view=await read(),context=view.reviewContexts['conversion-review'];
    need(context,'The native conversion must retain complete original and converted definitions for every API.');
    const record=await call('recordCommissioningReview',await freeze('commissioning:conversion-review',{
      requestId:requestId('commissioning:conversion-review'),id,expectedRevision:view.record.revision,
      stepId:'conversion-review',contextSha256:context.sha256,reviewer:'Original native receiving operator',
      note:'Reviewed the complete native field report, every original Classic definition and every native converted OAS definition for the selected cohort.',
      files:[{name:'native-conversion-review.json',mediaType:'application/json',
        contentBase64:Buffer.from(json({cohort:saved.cohort,apiIds:ids,conversion,context})).toString('base64')}]}));
    return ref(record);
  });
  const staging=await execute('staging');
  await step('commissioning-complete-staged-capture',async()=>{
    const view=await read();
    const record=await call('refreshCommissioning',await freeze('commissioning:staged-capture',{
      requestId:requestId('commissioning:staged-capture'),id,expectedRevision:view.record.revision,phase:'staged'}));
    const retained=await read();
    need(retained.observation?.apis.length===count,'Retain every actual staged native definition.');
    return {record:ref(record),capture:retained.observation.capture};
  });
  const probes=await step('commissioning-actual-staged-operational-checks',async()=>{
    const view=await read(),context=view.reviewContexts['production-review'];
    need(context&&view.observation?.apis.length===count,'Use the complete captured staged cohort.');
    const baseline=await receiveProbe(fetch,targetUrl(selected.upstreamUrl),{maximum:probeMaximum,timeoutMs:config.nativeTimeoutMs});
    const checks=[],observations=[];
    need(baseline.ok,'The selected original upstream is not ready for the native commissioning probe.');
    for(const row of view.observation.apis){
      const source=await definition(view.observation.capture,row.stagedApiId);
      const inspected=inspectTykDefinition(source.definitionText,{kind:'oas',apiId:row.stagedApiId});
      need(inspected.sha256===row.sha256&&source.sha256===row.sha256,'A staged source changed from its captured complete bytes.');
      const listenPath=inspected.summary.listenPath;
      need(typeof listenPath==='string'&&listenPath.startsWith('/')&&!listenPath.startsWith('//')&&
        !listenPath.includes('?')&&!listenPath.includes('#'),'Use the exact captured native staged listen path.');
      const url=new URL(publicBase);url.pathname=listenPath;url.search='';
      const observed=await receiveProbe(fetch,url,{headers,maximum:probeMaximum,timeoutMs:config.nativeTimeoutMs});
      const matched=observed.ok&&observed.status===baseline.status&&observed.bytes===baseline.bytes&&observed.sha256===baseline.sha256;
      observations.push({apiId:row.apiId,stagedApiId:row.stagedApiId,definitionSha256:row.sha256,
        headerEnvironmentReferences:selected.probeHeaderEnv??{},observed,matched});
      checks.push({apiId:row.apiId,name:CHECKS[0],outcome:'passed',
        note:'Retained complete native OAS '+row.stagedApiId+' at SHA-256 '+row.sha256+'.'});
      checks.push({apiId:row.apiId,name:CHECKS[1],outcome:matched?'passed':'failed',
        note:'Original HTTP '+observed.status+', '+observed.bytes+' bytes, SHA-256 '+observed.sha256+
          '; selected upstream HTTP '+baseline.status+', '+baseline.bytes+' bytes, SHA-256 '+baseline.sha256+'.'});
    }
    const value={schema:'stellar-forge.tyk-commissioning-native-probes.v1',commissioning:id,
      contextSha256:context.sha256,baseline,observations,checks};
    const path=join(root,'downloads','commissioning-native-operational-probes.json');
    const full=json(value);
    need(Buffer.byteLength(full)<=24*1024*1024,'The complete combined probe evidence exceeds the declared supporting-file limit.');
    await writeFile(path,full,{mode:0o600});
    if(checks.some(row=>row.outcome==='failed')){
      const failureKey='commissioning:failed-probes:'+hash(full);
      await call('recordCommissioningReview',await freeze(failureKey,{
        requestId:requestId(failureKey),id,expectedRevision:view.record.revision,stepId:'production-review',
        contextSha256:context.sha256,reviewer:'Original native receiving operator',
        note:'Actual staged upstream checks failed. Complete original responses are retained; no promotion has been requested.',
        checks,files:[{name:'native-failed-operational-probes.json',mediaType:'application/json',
          contentBase64:Buffer.from(full).toString('base64')}]}));
      need(false,'An actual staged route check failed. Correct that original target and continue this same operation; the failed review is retained.');
    }
    return {path,sha256:hash(json(value)),bytes:Buffer.byteLength(json(value)),...value};
  });
  await step('commissioning-complete-production-acceptance',async()=>{
    const view=await read(),context=view.reviewContexts['production-review'];
    need(context?.sha256===probes.contextSha256,'Review the same exact staged source identities as the actual operational probes.');
    const bytes=await readFile(probes.path);need(hash(bytes)===probes.sha256,'Retain complete original probe evidence.');
    const record=await call('recordCommissioningReview',await freeze('commissioning:production-review',{
      requestId:requestId('commissioning:production-review'),id,expectedRevision:view.record.revision,
      stepId:'production-review',contextSha256:context.sha256,reviewer:'Original native receiving operator',
      note:'Each selected staged API was read from its complete captured native source and probed through the declared connected Gateway. The retained complete response is compared with the selected original upstream.',
      checks:probes.checks,files:[{name:'native-operational-probes.json',mediaType:'application/json',contentBase64:bytes.toString('base64')}]}));
    need(probes.checks.every(row=>row.outcome==='passed'),
      'An actual staged route check failed. The saved failed review and complete response remain available; promotion has not been dispatched.');
    return ref(record);
  });
  const promotion=await execute('promotion');
  await step('commissioning-complete-final-capture',async()=>{
    const view=await read(),record=await call('refreshCommissioning',await freeze('commissioning:final-capture',{
      requestId:requestId('commissioning:final-capture'),id,expectedRevision:view.record.revision,phase:'final'}));
    return ref(record);
  });
  const completed=await originalAgentResult(agent,await agent.call('merchant_tyk_commissioning',{workspace:'native',id}));
  need(completed.progress.state==='COMPLETE'&&completed.progress.steps.every(row=>row.complete)&&
    completed.finalObservation?.apis.length===count,'Complete all seven original commissioning steps and native final source matches.');
  const manuscript=await call('readSource',{reference:completed.record.value.manuscript});
  need(JSON.stringify(manuscript.value)===JSON.stringify(completed.plan),'Return the complete maintained OperatingPlan history.');
  return {id,record:ref(completed.record),apiIds:ids,cohort:saved.cohort,conversion,staging,promotion,
    observation:completed.observation,finalObservation:completed.finalObservation,
    manuscript:completed.record.value.manuscript,checks:probes.checks,probes:{path:probes.path,bytes:probes.bytes,sha256:probes.sha256},
    progress:completed.progress,agent:{family:'tykWorkspaces',tools:declared.length,createMethod:'merchant_tyk_create_commissioning',
      readMethod:'merchant_tyk_commissioning',workspaceId:sender.host.workspaceId}};
  } finally { await agent.close(); }
}
