#!/usr/bin/env node
// MIT. One complete managed pricing receiving operation using the original builder,
// installer, Applications controller and SF97 pricing/planning/cost interfaces.
import {mkdir,readFile,writeFile,realpath,rename} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createConnection} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';

const BASE='stellar/scf-starforge-20261009';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blobHash=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const need=(value,message)=>{if(!value)throw new Error(message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function receiveManagedPricing({runtimeDirectory,output,expectedSourceCommit,operationId}){
runtimeDirectory=await realpath(resolve(runtimeDirectory));
await mkdir(output,{mode:0o700});
output=await realpath(output);
const sourceRoot=join(runtimeDirectory,'package/source'),moduleRoot=join(sourceRoot,BASE);
const {inspectMerchantRuntime}=await import(pathToFileURL(join(moduleRoot,'sf46-release/runtime-package.mjs')).href);
const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
need(runtime.sourceCommit===expectedSourceCommit,'Selected runtime is not the requested product commit.');
const inputDirectory=join(moduleRoot,'sf97-merchant-revenue-ops');
const originalInputs=[];
const readOriginal=async(name)=>{
  const bytes=await readFile(join(inputDirectory,name));
  originalInputs.push({path:BASE+'/sf97-merchant-revenue-ops/'+name,bytes:bytes.length,
    sha256:hash(bytes),gitBlob:blobHash(bytes)});
  return JSON.parse(bytes);
};
const seller=await readOriginal('illustrative-service.json');
const snapshot=await readOriginal('illustrative-native-shape-snapshot.json');
need(seller.routes.length===1&&seller.routes[0].id==='dataset','The original reference seller no longer has the selected dataset route.');
need(snapshot.routes.find(row=>row.id==='@unmatched')?.completed===0,'The original empty traffic row changed.');
seller.routes.push({...structuredClone(seller.routes[0]),id:'report',path:'/report'});
snapshot.routes.splice(1,0,{...structuredClone(snapshot.routes.find(row=>row.id==='@unmatched')),id:'report',method:'GET',path:'/report'});
const configFile=join(output,'seller.json'),snapshotFile=join(output,'snapshot.json'),workspaceDirectory=join(output,'pricing');
const sellerBytes=Buffer.from(json(seller)),snapshotBytes=Buffer.from(json(snapshot));
await writeFile(configFile,sellerBytes,{flag:'wx',mode:0o600});
await writeFile(snapshotFile,snapshotBytes,{flag:'wx',mode:0o600});
const {createRuntimeWorkspace,openRuntimeWorkspace}=await import(pathToFileURL(join(moduleRoot,'distribution/runtime-workspace/model.mjs')).href);
const controller=join(output,'applications');
await createRuntimeWorkspace({directory:controller});
let model=await openRuntimeWorkspace({directory:controller}), applicationId, activeOperation=null, pricingState=null;
const receipt={schema:'stellar-forge.merchant-pricing-managed-receiving.v1',operationId,phase:'STARTED',
  startedAt:new Date().toISOString(),runtime:{directory:runtime.directory,sourceCommit:runtime.sourceCommit,
    sourceManifestSha256:runtime.sourceManifestSha256,installationId:runtime.installationId,profileId:runtime.profileId},
  originalInput:{kind:'published-reference-case',sourceCommit:runtime.sourceCommit,files:originalInputs,
    selection:'Original dataset route plus a second pricing route with zero observed attempts'},controller,
  source:{configFile,configSha256:hash(sellerBytes),snapshotFile,snapshotSha256:hash(snapshotBytes),workspaceDirectory},runs:[],exports:[]};
const retain=()=>writeFile(join(output,'result.json'),json(receipt),{mode:0o600});
const progress=(phase,details={})=>{receipt.phase=phase;process.stdout.write(json({phase,...details}));};
async function waitFor(read,done,description){
  const deadline=Date.now()+120000;
  let value;
  while(Date.now()<deadline){
    value=await read();if(done(value))return value;
    if(['FAILED','UNAVAILABLE','INTERRUPTED'].includes(value?.phase))
      throw new Error(description+': '+JSON.stringify(value.error??value.current?.result??value));
    await pause(500);
  }
  throw new Error(description+' did not complete: '+JSON.stringify(value));
}
const current=async()=>(await model.applicationsState()).applications.find(value=>value.id===applicationId);
async function request(url,path,body){
  const response=await fetch(url+path,{redirect:'error',signal:AbortSignal.timeout(30000),
    ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),
    headers:body===undefined?{accept:'application/json'}:{accept:'application/json','content-type':'application/json','x-sf97-workspace':pricingState.token}});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(value.message),{code:value.code,status:response.status});
  return value;
}
async function portClosed(value){
  const url=new URL(value);
  return new Promise(done=>{
    const socket=createConnection({host:'127.0.0.1',port:Number(url.port||80)});
    const finish=value=>{socket.destroy();done(value);};
    socket.once('connect',()=>finish(false));socket.once('error',()=>finish(true));socket.setTimeout(1000,()=>finish(false));
  });
}
async function start(){
  const reviewed=await model.applicationsStartReview({applicationId}),requestId=randomUUID();
  activeOperation=requestId;
  await model.applicationsStart({applicationId,requestId,reviewId:reviewed.id});
  const running=await waitFor(current,value=>value?.phase==='RUNNING'&&Boolean(value.current?.privateUrl),'Original managed pricing startup');
  need(running.current.id===requestId,'The application selected a different managed operation.');
  const original=running.current.url?.original;
  need(original?.schema==='stellar-forge.merchant-pricing-workspace-launch.v1'&&
    original.state===workspaceDirectory&&
    original.configPath===configFile&&original.configSha256===receipt.source.configSha256&&
    Number.isSafeInteger(original.pid)&&original.pid>0,'Original startup did not match reviewed merchant bytes, state or PID.');
  const url=new URL(running.current.privateUrl).origin;
  const planningLink=running.current.privateLinks?.find(link=>link.label==='Scenario planning');
  need(planningLink&&new URL(planningLink.url).origin===url&&new URL(planningLink.url).pathname==='/planning',
    'Original planning URL did not match its live pricing listener.');
  const costLink=running.current.privateLinks?.find(link=>link.label==='Supplier costs');
  need(costLink&&new URL(costLink.url).origin===url&&new URL(costLink.url).pathname==='/economics',
    'Original supplier costs URL did not match its live pricing listener.');
  const run={operationId:requestId,url,links:running.current.privateLinks,original};
  receipt.runs.push(run);await retain();
  pricingState=await request(url,'/api/state');
  need(pricingState.seller.sha256===receipt.source.configSha256,'Original HTTP pricing source changed.');
  return run;
}
async function stop(run){
  await model.applicationsStop({applicationId,operationId:run.operationId});
  await waitFor(current,value=>value?.phase==='STOPPED'&&value.current?.active===false,'Original managed pricing stop');
  await waitFor(async()=>({closed:await portClosed(run.url)}),value=>value.closed,'Original pricing/planning listener drain');
  activeOperation=null;run.stoppedAt=new Date().toISOString();await retain();
}
const terms={merchantName:'Scenario workflow exercise',sharedMonthlyFixedUsd:'12',routes:{
  dataset:{unitPriceUsd:'0.01',priceBasis:'Explicit USD exercise input',perFulfilledUsd:'0.002',perChallengeUsd:'0',monthlyPaidTarget:3000},
  report:{unitPriceUsd:'0.02',priceBasis:'Explicit USD exercise input',perFulfilledUsd:'0.005',perChallengeUsd:'0',monthlyPaidTarget:1000}
}};
try{
  const catalog=(await model.applicationsState()).catalog.filter(value=>value.command==='revenue-workspace');
  need(catalog.length===1,'Select a runtime with the complete original managed pricing application.');
  const attached=await model.attach({directory:runtimeDirectory,label:'Original SF97 pricing runtime'});
  const reviewed=await model.applicationsReview({runtimeId:attached.runtimeId,kind:catalog[0].id,
    settings:{configFile,workspaceDirectory,snapshotFile,port:0},label:'Merchant pricing and scenario planning'});
  const saved=await model.applicationsSave({requestId:randomUUID(),reviewId:reviewed.id});
  need(!saved.connectionError,'Original runtime adoption failed: '+JSON.stringify(saved.connectionError));
  applicationId=saved.applicationId;receipt.applicationId=applicationId;receipt.applicationKind=catalog[0].id;await retain();
  await waitFor(current,value=>value?.phase==='READY','Original retained runtime adoption');
  progress('APPLICATION_READY',{applicationId,sourceCommit:runtime.sourceCommit});
  const first=await start();
  need(pricingState.sourceError===null,'Original snapshot source did not open.');
  for(const path of ['/','/planning','/planning/browser.mjs','/planning/style.css','/economics']){
    const response=await fetch(first.url+path,{signal:AbortSignal.timeout(10000)});
    need(response.ok&&(await response.text()).length>100,'Original pricing asset did not serve: '+path);
  }
  const baseline=await request(first.url,'/api/save',{requestId:randomUUID(),expectedRevision:pricingState.revision,label:'Baseline two-route review',
    sellerSha256:pricingState.seller.sha256,snapshotSha256:pricingState.snapshot.sha256,commercial:terms});
  receipt.baseline=baseline;
  const source=await request(first.url,'/api/planning/source',{version:baseline.version});
  need(source.routes.length===2,'Original scenario source lost a route.');
  const scenarios=[
    {id:'target',label:'Target at current mix',routes:{},goal:{monthlyContributionUsd:'100',marginPct:'70'}},
    {id:'unknown-cost',label:'=Unknown fulfillment cost',routes:{report:{perFulfilledUsd:null}}}
  ];
  let comparison=await request(first.url,'/api/planning/preview',{version:baseline.version,scenarios});
  const base=comparison.review.baseline.metrics,target=comparison.review.scenarios[0],unknown=comparison.review.scenarios[1];
  need(same([base.grossUsd,base.variableCostsUsd,base.contributionAfterFixedUsd,base.marginAfterFixedPct],['50','11','27','54']),
    'Original baseline arithmetic changed.');
  need(unknown.metrics.contributionAfterFixedUsd===null&&unknown.metrics.unknownInputs.includes('routes.report.perFulfilledUsd'),
    'Unknown native cost became a number.');
  const price=target.goals.suggestions.find(row=>row.kind==='TARGET_PRICE');
  const volume=target.goals.suggestions.find(row=>row.kind==='TARGET_VOLUME');
  const breakEven=target.goals.suggestions.find(row=>row.kind==='BREAK_EVEN_VOLUME');
  need(same([price.status,price.priceUpliftUsd,price.metrics.grossUsd,price.metrics.contributionAfterFixedUsd],['READY','0.01825','123','100']),
    'Original target price arithmetic changed.');
  need(same([volume.status,volume.requiredBaskets,volume.metrics.grossUsd,volume.metrics.contributionAfterFixedUsd,volume.metrics.marginAfterFixedPct],
    ['READY','3000','150','105','70'])&&same(volume.volumes.map(row=>row.monthlyPaidTarget),['9000','3000']),'Original target volume changed.');
  need(same([breakEven.requiredBaskets,breakEven.metrics.contributionAfterFixedUsd],['308','0.012']),'Original break-even changed.');
  scenarios.push({id:'selected-price',label:'Selected target pricing',sharedMonthlyFixedUsd:price.commercial.sharedMonthlyFixedUsd,routes:price.commercial.routes});
  comparison=await request(first.url,'/api/planning/preview',{version:baseline.version,scenarios});
  const planInput={requestId:randomUUID(),label:'Two-route operator comparison',version:baseline.version,scenarios,
    selectedScenarioId:'selected-price',reviewSha256:comparison.review.reviewSha256};
  const plan=await request(first.url,'/api/planning/save',planInput),recovered=await request(first.url,'/api/planning/save',planInput);
  need(!plan.recovered&&recovered.recovered&&same(plan.record,recovered.record),'Original same-request plan recovery changed.');
  receipt.plan={id:plan.planId,reviewSha256:comparison.review.reviewSha256,record:plan.record};
  need(plan.record.source.snapshot===receipt.source.snapshotSha256,'Original plan observation bytes changed.');
  const exportDirectory=join(output,'exports');await mkdir(exportDirectory,{mode:0o700});
  for(const name of ['plan.json','comparison.csv','terms-selected-price.json']){
    const response=await fetch(first.url+'/planning-files/'+plan.planId+'/'+name,{signal:AbortSignal.timeout(10000)});
    need(response.ok,'Original plan export failed: '+name);
    const bytes=Buffer.from(await response.arrayBuffer());await writeFile(join(exportDirectory,name),bytes,{flag:'wx',mode:0o600});
    receipt.exports.push({file:name,bytes:bytes.length,sha256:hash(bytes)});
    if(name==='plan.json')need(same(JSON.parse(bytes),plan.record),'Saved plan export changed.');
    if(name==='terms-selected-price.json')need(JSON.parse(bytes).routes.dataset.unitPriceUsd==='0.02825','Selected exported price changed.');
    if(name==='comparison.csv')need(bytes.toString().includes("\"'=Unknown fulfillment cost\""),'CSV text handling changed.');
  }
  pricingState=await request(first.url,'/api/state');
  const selected=await request(first.url,'/api/planning/apply',{planId:plan.planId,scenarioId:'selected-price'});
  need(selected.commercial.routes.report.unitPriceUsd==='0.03825','Original selection lost route terms.');
  const applied=await request(first.url,'/api/save',{requestId:randomUUID(),expectedRevision:pricingState.revision,label:'Applied selected scenario',
    sellerSha256:pricingState.seller.sha256,snapshotSha256:pricingState.snapshot.sha256,commercial:selected.commercial});
  const loaded=await request(first.url,'/api/load-version',{version:applied.version});
  need(same(loaded.commercial,selected.commercial)&&applied.version!==baseline.version,'Original pricing application did not save selected terms.');
  receipt.applied=applied;receipt.metrics={baseline:base,targetPrice:price.metrics,targetVolume:volume.metrics,breakEven:breakEven.metrics};
  progress('SCENARIO_WORKFLOW_SAVED',{sourceVersion:baseline.version,planId:plan.planId,appliedVersion:applied.version});
  await stop(first);await model.close();
  // The original model can reopen saved reviews while its chosen observation export is unavailable.
  const heldSnapshot=join(output,'retained-original-snapshot.json');
  await rename(snapshotFile,heldSnapshot);
  model=await openRuntimeWorkspace({directory:controller});
  const second=await start();
  need(pricingState.sourceError!==null&&pricingState.snapshot===null,'Unavailable original source did not remain visible.');
  const reopened=await request(second.url,'/api/planning/load',{planId:plan.planId});
  need(same(reopened,plan.record),'Managed reopen changed the saved comparison.');
  const reopenedTerms=await request(second.url,'/api/load-version',{version:applied.version});
  need(same(reopenedTerms.commercial,selected.commercial),'Managed reopen lost applied pricing terms.');
  need(pricingState.history.some(row=>row.version===baseline.version)&&pricingState.history.some(row=>row.version===applied.version),
    'Managed reopen lost original pricing history.');
  await rename(heldSnapshot,snapshotFile);
  pricingState=await request(second.url,'/api/state');
  need(pricingState.sourceError===null&&pricingState.snapshot.sha256===receipt.source.snapshotSha256,'Restored original source did not refresh.');
  const afterRestore=await request(second.url,'/api/planning/load',{planId:plan.planId});
  need(same(afterRestore,plan.record),'Refreshing source changed saved plan identity.');
  await stop(second);
  receipt.phase='COMPLETED';receipt.completedAt=new Date().toISOString();
  receipt.sameStateReopened=true;receipt.unavailableObservationReopened=true;receipt.originalSourceRestored=true;
  await retain();
  process.stdout.write(json({state:'PASS',sourceCommit:runtime.sourceCommit,sourceManifestSha256:runtime.sourceManifestSha256,
    applicationId,sourceVersion:baseline.version,planId:plan.planId,appliedVersion:applied.version,
    runCount:receipt.runs.length,exports:receipt.exports,unavailableObservationReopened:true,result:join(output,'result.json')}));
  return receipt;
}catch(error){
  receipt.phase='FAILED';receipt.error={code:error.code??'MANAGED_PRICING_FAILED',message:error.message,stack:error.stack};
  await retain().catch(()=>{});throw error;
}finally{
  if(activeOperation)await model.applicationsStop({applicationId,operationId:activeOperation}).catch(()=>{});
  await model.close();
}

}


export async function runManagedPricing({repository,sourceCommit,output,operationId='SCF-MANAGED-PRICING-6200-20261012'}){
  need(typeof repository==='string'&&repository&&typeof output==='string'&&output,
    'Provide --repo ORIGINAL_GIT_REPOSITORY and --out NEW_PRIVATE_DIRECTORY.');
  need(/^[a-f0-9]{40}$/.test(sourceCommit??''),'Provide the full immutable product commit with --ref.');
  need(/^[A-Z0-9][A-Za-z0-9._-]{0,127}$/.test(operationId),'Invalid receiving operation ID.');
  repository=await realpath(resolve(repository));
  output=resolve(output);
  await mkdir(output,{mode:0o700});
  output=await realpath(output);
  const receipt={schema:'stellar-forge.managed-pricing-operation.v1',operationId,
    startedAt:new Date().toISOString(),phase:'SELECTING_SOURCE',repository,sourceCommit,output};
  const save=()=>writeFile(join(output,'operation.json'),json(receipt),{mode:0o600});
  const log=join(output,'native-progress.jsonl');
  const progress=event=>{
    const line=JSON.stringify({recordedAt:new Date().toISOString(),...event})+'\n';
    appendFileSync(log,line,{mode:0o600});process.stderr.write(line);
  };
  await save();
  try{
    const git=args=>execFileSync('git',['--no-replace-objects','-c','maintenance.auto=false',
      '-c','gc.auto=0','-C',repository,...args],{maxBuffer:2*1024*1024,timeout:180000});
    const commit=git(['rev-parse','--verify',sourceCommit+'^{commit}']).toString().trim();
    need(commit===sourceCommit,'The original repository resolved a different commit.');
    const bootstrap=join(output,'original-builder',BASE,'distribution');
    await mkdir(bootstrap,{recursive:true,mode:0o700});
    receipt.builderSource=[];
    for(const name of ['build.mjs','git-source.mjs','build-state.mjs','browser-assets.mjs']){
      const path=BASE+'/distribution/'+name,bytes=git(['cat-file','blob',sourceCommit+':'+path]);
      const expected=git(['rev-parse',sourceCommit+':'+path]).toString().trim();
      need(blobHash(bytes)===expected,'Original builder source changed: '+path);
      await writeFile(join(bootstrap,name),bytes,{flag:'wx',mode:0o600});
      receipt.builderSource.push({path,gitBlob:expected,bytes:bytes.length,sha256:hash(bytes)});
    }
    const {MAX_SOURCE_BYTES}=await import(pathToFileURL(join(bootstrap,'git-source.mjs')).href);
    need(MAX_SOURCE_BYTES===64*1024*1024,'Select the maintained 64 MiB source reader and builder.');
    const cache=join(output,'npm-cache'),temporary=join(output,'tmp');
    await mkdir(cache,{mode:0o700});await mkdir(temporary,{mode:0o700});
    process.env.npm_config_cache=cache;process.env.TMPDIR=temporary;
    receipt.phase='BUILDING';await save();
    const {buildDistribution}=await import(pathToFileURL(join(bootstrap,'build.mjs')).href);
    const release=join(output,'release');
    const built=await buildDistribution({repository,ref:sourceCommit,output:release,onProgress:progress});
    need(built.status==='PACKAGED'&&built.sourceCommit===sourceCommit,'The original builder did not package the selected commit.');
    receipt.build=built;receipt.phase='PREPARING_RUNTIME';await save();
    const {prepareRuntimeInstall,installRuntime,inspectRuntimeInstall}=
      await import(pathToFileURL(join(release,'package/source',BASE,'distribution/runtime-install.mjs')).href);
    const runtimeDirectory=join(output,'runtime');
    const prepared=await prepareRuntimeInstall({directory:runtimeDirectory,archive:built.archive,sha256:built.sha256,operator:true});
    receipt.preparation=prepared;receipt.phase='INSTALLING_RUNTIME';await save();
    await installRuntime({directory:runtimeDirectory,offline:true,cache});
    const installed=await inspectRuntimeInstall({directory:runtimeDirectory,load:true,source:true});
    need(installed.status==='READY'&&installed.ready===true&&installed.sourceVerified===true&&
      installed.lockMatches===true&&installed.sourceCommit===sourceCommit,'The original selected runtime is not READY.');
    await writeFile(join(output,'runtime.json'),json(installed),{flag:'wx',mode:0o600});
    receipt.runtime={directory:runtimeDirectory,sourceCommit:installed.sourceCommit,
      installationId:installed.installationId,profileId:installed.profileId,
      sourceVerified:installed.sourceVerified,lockMatches:installed.lockMatches};
    receipt.phase='RECEIVING';await save();progress({phase:'ORIGINAL_RUNTIME_READY',...receipt.runtime});
    const received=await receiveManagedPricing({runtimeDirectory,output:join(output,'receiving'),
      expectedSourceCommit:sourceCommit,operationId});
    receipt.phase='COMPLETED';receipt.completedAt=new Date().toISOString();
    receipt.receiving={result:join(output,'receiving/result.json'),applicationId:received.applicationId,
      planId:received.plan.id,sourceVersion:received.baseline.version,appliedVersion:received.applied.version,
      sameStateReopened:received.sameStateReopened,unavailableObservationReopened:received.unavailableObservationReopened,
      runs:received.runs.length,exports:received.exports};
    await save();
    process.stdout.write(json({state:'COMPLETED',operationId,sourceCommit,output,
      archive:built.archive,archiveSha256:built.sha256,...receipt.receiving}));
    return receipt;
  }catch(error){
    receipt.phase='FAILED';receipt.error={code:error.code??'MANAGED_PRICING_FAILED',message:error.message,stack:error.stack};
    await save().catch(()=>{});throw error;
  }
}

async function main(args){
  if(args.length===1&&['-h','--help'].includes(args[0])){
    process.stdout.write('node managed-pricing-receiving.mjs --repo ORIGINAL_GIT_REPOSITORY --ref FULL_COMMIT --out NEW_PRIVATE_DIRECTORY [--operation STABLE_ID]\n');return;
  }
  const flags={};
  for(let i=0;i<args.length;i+=2){
    need(['--repo','--ref','--out','--operation'].includes(args[i])&&!Object.hasOwn(flags,args[i])&&args[i+1],
      'Expected --repo ORIGINAL_GIT_REPOSITORY --ref FULL_COMMIT --out NEW_PRIVATE_DIRECTORY [--operation STABLE_ID].');
    flags[args[i]]=args[i+1];
  }
  return runManagedPricing({repository:flags['--repo'],sourceCommit:flags['--ref'],output:flags['--out'],operationId:flags['--operation']});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main(process.argv.slice(2)).catch(error=>{console.error(error.code?error.code+': '+error.message:error.stack);process.exitCode=1;});
