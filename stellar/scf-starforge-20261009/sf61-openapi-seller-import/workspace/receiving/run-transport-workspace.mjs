#!/usr/bin/env node
// MIT. Retained receiving journey through the original SF61 workspace and SF82 store.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const flags=new Map();
for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i]?.startsWith('--')||!process.argv[i+1]||flags.has(process.argv[i]))throw Error('Use --source ROOT --out DIRECTORY');flags.set(process.argv[i],process.argv[i+1]);}
const source=resolve(flags.get('--source')??''),out=resolve(flags.get('--out')??'');
if(!flags.has('--source')||!flags.has('--out'))throw Error('Use --source ROOT --out DIRECTORY');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const same=(a,b)=>assert.deepEqual(a,b);
const moduleAt=path=>import(pathToFileURL(join(source,path)).href);
const apiDir='sf61-openapi-seller-import/workspace';
const {startWorkspace}=await moduleAt(apiDir+'/server.mjs');
const releases=await moduleAt('sf82-seller-pilot/releases.mjs');
const {readPackage,readMerchantTransportConfiguration,prepareMerchant}=await moduleAt(apiDir+'/model.mjs');
const {inspectUpstreamConfiguration}=await moduleAt('sf82-seller-pilot/release-upstreams.mjs');
await mkdir(out,{recursive:true,mode:0o700});
const parent=join(out,'merchant-projects');await mkdir(parent,{recursive:true,mode:0o700});
const report={schema:'stellar-forge.merchant-transport-receiving.v1',startedAt:new Date().toISOString(),source,
  runtime:{node:process.versions.node},steps:[],files:[]};
async function retain(name,value){
  const bytes=typeof value==='string'?Buffer.from(value):Buffer.isBuffer(value)?value:Buffer.from(json(value));
  const path=join(out,name);await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
  const temporary=path+'.tmp-'+process.pid;await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,path);
  const item={name,bytes:bytes.length,sha256:sha(bytes)};
  if(name!=='journey.json'){const existing=report.files.findIndex(row=>row.name===name);if(existing<0)report.files.push(item);else report.files[existing]=item;}
  return item;
}
async function checkpoint(stage,value){report.steps.push({stage,at:new Date().toISOString(),...value});await retain('journey.json',report);console.log(JSON.stringify({stage,...value}));}
let workspace;
try{
  const original=await readFile(join(source,'sf82-seller-pilot/examples/upstream-openapi.json'),'utf8');
  const spec=JSON.parse(original);spec.info={...spec.info,title:'Retained transport workspace receiving example'};
  spec.paths['/status']={get:{operationId:'status',summary:'Read the example status',responses:{'200':{description:'Status',
    content:{'application/json':{schema:{type:'object',properties:{status:{type:'string'}},required:['status'],additionalProperties:false}}}}}}};
  const specText=json(spec),plan={schema:'stellar-forge.api-merchant-plan.v1',sellerServer:'https://merchant.example/api',
    serviceName:'Transport example',payment:{network:'stellar:testnet',asset:'DEMO_NONPAYABLE_ASSET',payTo:'DEMO_NONPAYABLE_RECIPIENT',maxTimeoutSeconds:60},
    transports:{provider_proxy:{mode:'environment-proxy',proxyEnv:'MERCHANT_HTTPS_PROXY'},direct_status:{mode:'direct'}},
    operations:[{method:'GET',path:'/dataset',amountAtomic:'20000',responseValidation:'none',transport:'provider_proxy'},
      {method:'GET',path:'/status',amountAtomic:'1000',responseValidation:'declared',transport:'direct_status'}],
    allowLoopbackUpstream:false};
  await retain('source/original-example.json',original);await retain('source/receiving-openapi.json',specText);await retain('source/merchant-plan.json',plan);
  // An empty host environment makes the compiler's reference-only review explicit.
  workspace=await startWorkspace({parent,port:0,noSignals:true,env:{}});
  async function api(path,body){
    const response=await fetch(workspace.origin+'/api/'+path,{method:body===undefined?'GET':'POST',
      headers:{'x-workspace-token':workspace.token,origin:workspace.origin,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();
    if(!response.ok)throw Object.assign(Error(value.error??'Workspace API failed'),{status:response.status,path});
    return value;
  }
  async function savedPackage(name,sourceText,configuration,save){
    const names=(await api('packages')).packages.map(row=>row.name);
    if(!names.includes(name))await save();
    const value=await api('load?name='+encodeURIComponent(name));
    assert.equal(value.specText,sourceText);same(value.plan,configuration);return value;
  }
  const preview=await api('preview',{specText,plan});
  same(preview.environment,['MERCHANT_HTTPS_PROXY']);assert.equal(preview.credentialValuesChecked,false);
  same(preview.routes.map(row=>row.transport.profile),['provider_proxy','direct_status']);
  const first=await savedPackage('transport-v1',specText,plan,()=>api('save',{specText,plan,name:'transport-v1'}));
  const exported=await api('transports/export?name=transport-v1');
  same(Buffer.byteLength(exported.text),exported.bytes);assert.equal(sha(exported.text),exported.sha256);
  same(JSON.parse(exported.text).transports,plan.transports);
  same(exported.bindings.map(row=>row.profile),['provider_proxy','direct_status']);
  await retain('downloads/transport-v1-upstreams.json',exported.text);
  const firstProject=await readPackage(parent,'transport-v1');
  assert.equal(firstProject.manifest.files['upstreams.json'],exported.sha256);
  await checkpoint('saved-and-reopened',{sourceSha256:sha(specText),upstreamsSha256:exported.sha256,profiles:preview.transports});
  // The source comparison retains one remapped route and explicitly drops the other profile's only consumer.
  const replacement=structuredClone(spec);replacement.info.version='2.0.0';
  replacement.paths['/dataset/v2']=replacement.paths['/dataset'];delete replacement.paths['/dataset'];
  const replacementText=json(replacement);await retain('source/replacement-openapi.json',replacementText);
  const pending=await api('revisions/review',{baseName:'transport-v1',specText:replacementText,decisions:[],additions:[]});
  same(Object.keys(pending.transportProfiles),Object.keys(plan.transports));
  const decisions=first.preview.routes.map(row=>row.path==='/dataset'
    ?{routeId:row.id,action:'remap',method:'GET',path:'/dataset/v2',
      settings:{amountAtomic:'20000',responseValidation:'none',transport:'provider_proxy'}}
    :{routeId:row.id,action:'drop'});
  const input={baseName:'transport-v1',specText:replacementText,decisions,additions:[]};
  const review=await api('revisions/review',input);assert.equal(review.ready,true);
  same(review.plan.transports,{provider_proxy:plan.transports.provider_proxy});
  same(review.plan.operations.map(row=>row.transport),['provider_proxy']);
  assert.equal(review.transportChanges.count,1);
  const draftNames=(await api('revisions/drafts')).drafts;
  if(!draftNames.includes('transport-review'))await api('revisions/draft',{...input,name:'transport-review'});
  const reopened=await api('revisions/load?name=transport-review');
  same(reopened.decisions,decisions);assert.equal(reopened.review.reviewSha256,review.reviewSha256);
  const candidate=await savedPackage('transport-v2',replacementText,review.plan,
    ()=>api('revisions/save',{...input,name:'transport-v2',expectedReviewSha256:review.reviewSha256,expectedRefreshReviewId:review.refreshReviewId}));
  const downloaded=await api('transports/export?name=transport-v2');
  assert.equal(sha(downloaded.text),downloaded.sha256);same(JSON.parse(downloaded.text).transports,review.plan.transports);
  await retain('downloads/transport-v2-upstreams.json',downloaded.text);await retain('downloads/source-revision-review.json',review);
  await checkpoint('reviewed-source-revision',{reviewSha256:review.reviewSha256,refreshReviewId:review.refreshReviewId,
    candidateSourceSha256:sha(replacementText),upstreamsSha256:downloaded.sha256,removedProfile:'direct_status'});
  const store=join(out,'merchant-releases');
  try{await lstat(join(store,'state.json'));}catch(error){if(error.code!=='ENOENT')throw error;await releases.initReleaseStore(store);}
  async function stageOnce(id,action){
    const existing=await releases.listReleases(store);
    assert.equal(existing.errors.length,0,'Retained release records must be readable');
    if(!existing.releases.some(row=>row.id===id))await action();
    return releases.inspectRelease(store,id);
  }
  const stage1=await stageOnce('transport-v1',()=>releases.stageRelease(store,{id:'transport-v1',workspace:firstProject.folder,runtime:{port:0}}));
  const stage2=await stageOnce('transport-v2',()=>api('revisions/stage',{name:'transport-v2',id:'transport-v2',store}));
  assert.equal(stage1.runtime.upstreams.sha256,exported.sha256);assert.equal(stage2.runtime.upstreams.sha256,downloaded.sha256);
  const firstDifference=await releases.compareReleases(store,'transport-v1','transport-v2');
  assert.equal(firstDifference.summary.removed,2);assert.equal(firstDifference.summary.added,1);
  // A new saved host reference must alter SF82's per-binding configuration identity.
  const nextPlan=structuredClone(review.plan);nextPlan.transports.provider_proxy.proxyEnv='ALTERNATE_MERCHANT_PROXY';
  const hostChanged=await savedPackage('transport-host-v3',replacementText,nextPlan,
    ()=>api('save',{specText:replacementText,plan:nextPlan,name:'transport-host-v3'}));
  const hostProject=await readPackage(parent,'transport-host-v3');
  const stage3=await stageOnce('transport-host-v3',()=>releases.stageRelease(store,{id:'transport-host-v3',workspace:hostProject.folder,runtime:{port:0}}));
  const sourcePrepared=prepareMerchant(replacementText,review.plan),nextPrepared=prepareMerchant(replacementText,nextPlan);
  const retainedConfiguration=inspectUpstreamConfiguration(Buffer.from(downloaded.text),sourcePrepared.service,false);
  const nextConfiguration=inspectUpstreamConfiguration(Buffer.from(json(nextPrepared.upstreams)),nextPrepared.service,false);
  const binding=review.plan.operations[0].id;
  assert.notEqual(retainedConfiguration.bindings[binding].configurationSha256,nextConfiguration.bindings[binding].configurationSha256);
  same(nextConfiguration.environment,['ALTERNATE_MERCHANT_PROXY']);
  const hostDifference=await releases.compareReleases(store,'transport-v2','transport-host-v3');
  assert.equal(hostDifference.summary.changed,1);
  assert(hostDifference.changes[0].fields.some(field=>field.field==='upstream'));
  await retain('downloads/release-review.json',{stage1,stage2,stage3,sourceDifference:firstDifference,hostDifference,
    retainedConfiguration,nextConfiguration});
  const pureRead=await readMerchantTransportConfiguration(parent,'transport-host-v3');
  assert.equal(sha(pureRead.text),pureRead.sha256);
  await checkpoint('staged-and-reopened',{releaseIds:[stage1.id,stage2.id,stage3.id],
    originalConfigurationSha256:retainedConfiguration.bindings[binding].configurationSha256,
    receivingConfigurationSha256:nextConfiguration.bindings[binding].configurationSha256,
    hostEnvironmentReferences:nextConfiguration.environment});
  // HTTP delivery checks use the same source that owns the workspace entrypoint.
  for(const name of ['browser.mjs','transport-browser.mjs','revision-browser.mjs','index.html']){
    const response=await fetch(workspace.origin+(name==='index.html'?'/':'/'+name),{headers:{'x-workspace-token':workspace.token}});
    assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(sha(bytes),sha(await readFile(join(source,apiDir,name))));
  }
  await workspace.close();workspace=null;
  const reopenedProject=await readPackage(parent,'transport-v2');
  same(reopenedProject.plan,review.plan);assert.equal(reopenedProject.sourceRevision.refreshReviewId,review.refreshReviewId);
  same(await releases.inspectRelease(store,'transport-v2'),stage2);
  report.state='COMPLETE';report.completedAt=new Date().toISOString();
  await retain('journey.json',report);console.log(JSON.stringify({state:report.state,output:out,steps:report.steps.length}));
}catch(error){
  report.state='FAILED';report.failure={name:error.name,message:error.message,stack:error.stack};report.completedAt=new Date().toISOString();
  try{await retain('journey.json',report);}catch{}
  throw error;
}finally{await workspace?.close();}
