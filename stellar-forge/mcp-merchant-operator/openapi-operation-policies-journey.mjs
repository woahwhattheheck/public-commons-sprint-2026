#!/usr/bin/env node
// MIT. One original worksheet, policy, browser and seller receiving operation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runRouteWorksheetJourney} from './openapi-route-worksheet-journey.mjs';
import {downloadOpenApiOperationPolicy,readOpenApiOperationPolicy} from './openapi-operation-policies-client.mjs';
import {main as policyCli} from './openapi-operation-policies-cli.mjs';
import {downloadOpenApiPackage,reopenOpenApiPackageDownload} from './openapi-workspace-client.mjs';
import {readPackage} from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/model.mjs';
import {operationPolicyText} from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-model.mjs';
import {composeDistribution} from '../../stellar/scf-starforge-20261009/distribution/specification.mjs';
import {validateSourceSelection} from '../../stellar/scf-starforge-20261009/distribution/source-selection.mjs';

const OPERATION='ASTRA-D76C-SCF-OPENAPI-POLICY-AUTHORING-20261012';
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const file=(path,value)=>writeFile(path,value,{mode:0o600});
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const policy={schema:'stellar-forge.api-operation-policy.v1',id:'ForecastRead',title:'Forecast read operating settings',
 description:'Explicit original merchant policy for the source-native receiving journey.',methods:['GET'],
 settings:{timeoutMs:8000,maxResponseBytes:262144,maxInFlight:4,
  availability:{failureThreshold:2,resetAfterMs:1500,maxResetAfterMs:3000}}};

async function installationSelection(context) {
 const directory=new URL('../../stellar/scf-starforge-20261009/distribution/',import.meta.url);
 const path='stellar/scf-starforge-20261009/distribution/selections/openapi-merchant.json';
 const recipe=validateSourceSelection(JSON.parse(await readFile(new URL('selections/openapi-merchant.json',directory),'utf8')),path);
 const base=JSON.parse(await readFile(new URL('distribution.json',directory),'utf8'));
 const contributions=await Promise.all(recipe.contributions.map(async id=>({
  path:'stellar/scf-starforge-20261009/distribution/contributions/'+id+'.json',
  data:JSON.parse(await readFile(new URL('contributions/'+id+'.json',directory),'utf8'))
 })));
 const selected=composeDistribution({base,contributions,selection:recipe});
 const names=field=>Object.keys(selected.spec[field]??{}).sort();
 const commands=names('commands'),exports=names('exports'),applicationProviders=names('applicationProviders'),
  merchantProviders=names('merchantProviders'),features=names('featurePeers');
 assert.deepEqual(applicationProviders,['buyer-runbook','merchant-console','openapi']);
 assert.deepEqual(merchantProviders,['buyer-runbook-workspaces','cache','discovery','facilitators','har-workspaces','openapi-workspaces','publishers','receiving']);
 assert.deepEqual(features,['mcp','openapi','schema']);
 for(const name of ['merchant-operation-policies','merchant-route-worksheet','openapi-workspace','releases','merchant-providers'])
  assert.ok(commands.includes(name),'Original selected command: '+name);
 for(const name of ['./merchant/openapi-operation-policies','./merchant/openapi-route-worksheet'])
  assert.ok(exports.includes(name),'Original selected client export: '+name);
 const retained={schema:'stellar-forge.openapi-merchant-selection-native.v1',state:'PASSED',selection:recipe.id,
  commands,exports,applicationProviders,merchantProviders,features,contributions:selected.contributions.map(row=>row.id),
  components:selected.spec.components.length,supportFiles:selected.spec.supportFiles.length};
 const output=join(context.root,'openapi-merchant-selection.json');
 await file(output,json(retained));
 context.report.installation={...retained,path:output,sha256:hash(json(retained))};
 context.step('original-openapi-merchant-selection',{selection:recipe.id,commands:commands.length,exports:exports.length,
  applications:applicationProviders.length,providers:merchantProviders.length,features,contributions:selected.contributions.length});
}

async function chromiumExecutable() {
 const candidates=[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,process.env.CHROMIUM_PATH,
  '/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell',
  '/workspace/scratch/883218df7be2/browser-runtime/chrome-headless-shell'];
 for(const path of candidates.filter(Boolean)) {
  try{const info=await lstat(path);if(info.isFile()){await access(path,constants.X_OK);return path;}}catch{}
 }
 return undefined;
}
async function browserContinuation(context,selected) {
 const {chromium}=await import('playwright');
 const executablePath=await chromiumExecutable();
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),
  args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const browserBase='policy-browser-base',browserName='policy-browser-reviewed';
 try {
  await context.native('save',{workspace:'sender',name:browserBase,specText:context.originalText,plan:context.plan});
  const url=new URL(context.sender.url);url.searchParams.set('package',browserBase);
  await page.goto(url.href,{waitUntil:'networkidle'});
  await page.locator('#operation-policy-desk').evaluate(node=>{node.open=true;});
  await page.waitForFunction(id=>Array.from(document.querySelectorAll('#operation-policy-choice option')).some(row=>row.value===id),selected.policy.id);
  await page.locator('#operation-policy-choice').selectOption(selected.policy.id);
  await page.locator('#operation-policy-edition').fill(selected.sha256);
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operation-policies/load'&&response.ok());
  await page.getByRole('button',{name:'Open policy',exact:true}).click();await loaded;
  await page.waitForFunction(sha=>document.querySelector('#operation-policy-status').textContent.includes(sha),selected.sha256);
  assert.equal(await page.locator('[data-policy-field="oauthProfile"]').evaluate(node=>node.tagName),'TEXTAREA');
  await page.getByRole('button',{name:'Target included matching routes',exact:true}).click();
  const reviewedResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operation-policies/review'&&response.ok());
  await page.locator('#operation-policy-review').click();
  const response=await reviewedResponse,reviewed=await response.json();
  assert.equal(reviewed.review.policySha256,selected.sha256);
  assert.equal(reviewed.review.sourceSha256,hash(context.originalText));
  await page.locator('#operation-policy-package-name').fill(browserName);
  let committed;
  await page.route('**/api/operation-policies/package',async route=>{
   const original=await route.fetch();assert(original.ok());committed=await original.json();
   await route.abort('failed');
  });
  await page.locator('#operation-policy-save-package').click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('save response is unavailable'));
  assert.equal(committed.name,browserName);assert.equal(committed.review.sha256,reviewed.review.sha256);
  await page.unroute('**/api/operation-policies/package');
  await page.locator('#operation-policy-title').fill('A later unsaved editor choice');
  const recover=page.getByRole('button',{name:'Reopen submitted '+browserName,exact:true});
  await recover.waitFor({state:'visible'});assert.equal(await recover.isEnabled(),true);
  const recovered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/load'&&new URL(response.url()).searchParams.get('name')===browserName&&response.ok());
  await recover.click();await recovered;
  await page.waitForFunction(name=>document.querySelector('#operation-policy-application').textContent.includes(name),browserName);
  const saved=await readPackage(context.senderRoot,browserName);
  assert.equal(saved.operationPolicy.review.sha256,reviewed.review.sha256);
  assert.equal(saved.plan.operations.find(row=>row.id==='forecast').amountAtomic,context.plan.operations.find(row=>row.id==='forecast').amountAtomic);
  assert.deepEqual(saved.operationPolicy,committed.operationPolicy);assert.deepEqual(errors,[]);
  const screenshot=join(context.root,'operation-policy-browser.png');
  await page.screenshot({path:screenshot,fullPage:false});
  return {state:'PASSED',packageName:browserName,packageId:saved.manifest.id,reviewSha256:reviewed.review.sha256,
   exactPrice:saved.plan.operations.find(row=>row.id==='forecast').amountAtomic,
   editedAfterSubmission:true,recoveredOriginalSubmission:true,oauthProfileControl:'TEXTAREA',
   screenshot,chromium:executablePath??'original-playwright-installed-browser',reviewBytes:(await response.body()).length};
 } finally {await browser.close();}
}

export async function runOperationPolicyJourney({parent}={}) {
 const paths={};
 const outcome=await runRouteWorksheetJourney({parent,extension:{
  async prepare(context) {
   await installationSelection(context);
   Object.assign(paths,{policy:join(context.hostFiles,'operation-policy.json'),
    incoming:join(context.downloads,'received-policy.json'),application:join(context.downloads,'received-application.json'),
    cli:join(context.downloads,'cli-policy.json'),package:join(context.downloads,'policy-package')});
   await file(paths.policy,operationPolicyText(policy));
   context.declared.policy={kind:'packet',path:paths.policy};
   context.declared.incomingPolicy={kind:'packet',path:paths.incoming};
   context.declared.incomingApplication={kind:'packet',path:paths.application};
   context.deliveries.policy={directory:paths.package};
   context.report.policy={schema:'stellar-forge.api-operation-policy-native-journey.v1',operation:OPERATION,steps:[]};
   for(const path of ['openapi-workspace-client.mjs',
    '../../stellar/scf-starforge-20261009/distribution/specification.mjs',
    '../../stellar/scf-starforge-20261009/distribution/source-selection.mjs',
    '../../stellar/scf-starforge-20261009/distribution/product-package.mjs',
    '../../stellar/scf-starforge-20261009/distribution/selections/openapi-merchant.json',
    'openapi-operation-policies.mjs','openapi-operation-policies-client.mjs','openapi-operation-policy-file-format.mjs',
    'openapi-operation-policies-cli.mjs','catalog/openapi-operation-policies.mjs','openapi-operation-policies-journey.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-model.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-record.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-store.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-http.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-browser.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/package-export-format.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/package-transfer.mjs'])
    context.report.source[path]=hash(await readFile(new URL(path,import.meta.url)));
  },
  async run(context) {
   let current={...context},dropPackage=null,dropResult=null,unavailableReview=false,forbiddenReviews=0;
   const policyReport=context.report.policy;
   const step=(name,details={})=>{
    const value={name,completedAt:new Date().toISOString(),...details};policyReport.steps.push(value);
    context.step('policy-'+name,details);
   };
   const call=(name,args)=>current.client.call('merchant_openapi_'+name,args);
   const native=async(name,args)=>(await call(name,args)).native;
   const sizes={};
   const measure=()=>{globalThis.fetch=async(target,options)=>{
    const url=new URL(typeof target==='string'?target:target.url??target.href);
    let request;try{request=typeof options?.body==='string'?JSON.parse(options.body):null;}catch{}
    if(unavailableReview&&url.origin===current.sender.origin&&url.pathname==='/api/operation-policies/review'){
     forbiddenReviews++;throw Object.assign(new Error('The current live policy review is unavailable during original package recovery'),{code:'NATIVE_REVIEW_UNAVAILABLE'});
    }
    const response=await context.originalFetch(target,options);
    if(dropPackage&&url.origin===current.sender.origin&&url.pathname==='/api/operation-policies/package'&&request?.name===dropPackage&&response.ok()){
     dropResult=await response.clone().json();dropPackage=null;await response.body?.cancel();
     throw Object.assign(new Error('The native package response was discarded after its completed publication'),{code:'NATIVE_RESPONSE_DISCARDED'});
    }
    if(url.href===current.mcp.url&&request?.params?.name?.startsWith('merchant_openapi_operation_')&&response.ok())
     sizes[request.params.name]=Math.max(sizes[request.params.name]??0,(await response.clone().arrayBuffer()).byteLength);
    return response;
   };};
   measure();
   try {
    const first=await native('operation_policy_save',{workspace:'sender',policyFile:'policy',expectedHeadSha256:null});
    assert.equal(first.state,'SAVED');assert.equal(first.sha256,hash(operationPolicyText(policy)));
    const exactReplay=await native('operation_policy_save',{workspace:'sender',policyFile:'policy',expectedHeadSha256:null});
    assert.equal(exactReplay.state,'REOPENED');assert.equal(exactReplay.sha256,first.sha256);
    const secondPolicy={...clone(policy),id:'ForecastWrite',title:'Forecast write operating settings',methods:['POST'],
     settings:{maxRequestBytes:16384,timeoutMs:7000,maxInFlight:4}};
    await native('operation_policy_save',{workspace:'sender',policyDocument:secondPolicy,expectedHeadSha256:null});
    const listA=await native('operation_policies',{workspace:'sender',offset:0,limit:1});
    const listB=await native('operation_policies',{workspace:'sender',offset:listA.nextOffset,limit:1});
    assert.equal(listA.total,2);assert.equal(listB.nextOffset,null);assert.notEqual(listA.policies[0].id,listB.policies[0].id);
    let advanced,chunks=0;
    const updated={...clone(policy),title:'Forecast read next edition',settings:{...clone(policy.settings),timeoutMs:9000}};
    const downloaded=await downloadOpenApiOperationPolicy({client:current.client,workspace:'sender',
     request:{kind:'policy',policyId:policy.id},path:paths.incoming,chunkBytes:128,
     onProgress:async()=>{
      chunks++;if(!advanced)advanced=await native('operation_policy_save',{workspace:'sender',policyDocument:updated,expectedHeadSha256:first.sha256});
     }});
    const receivedPolicy=await readOpenApiOperationPolicy({path:paths.incoming,expectedSha256:first.sha256});
    assert.equal(downloaded.sha256,first.sha256);assert.ok(chunks>1);assert.deepEqual(receivedPolicy.policy,first.policy);
    const older=await native('operation_policy_load',{workspace:'sender',policyId:policy.id,policySha256:first.sha256,historyLimit:1});
    assert.equal(older.sha256,first.sha256);assert.equal(older.headSha256,advanced.sha256);assert.equal(older.history.total,2);
    const history=await native('operation_policy_load',{workspace:'sender',policyId:policy.id,policySha256:first.sha256,
     historyOffset:older.history.nextOffset,historyLimit:1});
    assert.equal(history.history.nextOffset,null);assert.equal(history.history.total,2);
    await assert.rejects(native('operation_policy_save',{workspace:'sender',policyDocument:{...updated,title:'A stale edit'},expectedHeadSha256:first.sha256}),
     error=>error.code==='OPENAPI_OPERATION_POLICY_HEAD_CHANGED');
    const imported=await native('operation_policy_save',{workspace:'receiver',policyFile:'incomingPolicy',expectedHeadSha256:null});
    assert.equal(imported.sha256,first.sha256);
    step('library-editions-history-and-portable-import',{policyId:policy.id,selectedEdition:first.sha256,currentHead:advanced.sha256,
     history:2,libraryPages:2,downloadChunks:chunks,receiverEdition:imported.sha256,staleHeadRejected:true});
    const selectedPath='/receiving-station-0002/forecast/{city}',name='policy-reviewed';
    const request={workspace:'sender',baseName:context.finalName,policy:{id:policy.id,sha256:first.sha256},
     actions:[{filter:{method:'GET',search:selectedPath},selected:true,price:{kind:'fixed',value:'0009007199254740997'}}],
     targets:[{method:'GET',path:context.forecast.path},{method:'GET',path:selectedPath}],
     overrides:[{method:'GET',path:context.forecast.path,set:{timeoutMs:6000},unset:['cache','availability']}]};
    const reviewed=await call('operation_policy_review',request);
    assert.equal(reviewed.review.policySha256,first.sha256);assert.ok(reviewed.application.bytes>131072);
    assert.equal(reviewed.review.worksheetSha256,reviewed.worksheet.sha256);
    const originalByPath=new Map(context.finalProject.plan.operations.map(row=>[row.path,row]));
    const configured=reviewed.plan.operations.find(row=>row.path===context.forecast.path);
    assert.equal(configured.timeoutMs,6000);assert.equal(configured.amountAtomic,originalByPath.get(configured.path).amountAtomic);
    assert.equal(Object.hasOwn(configured,'cache'),false);assert.equal(Object.hasOwn(configured,'availability'),false);
    for(const row of reviewed.plan.operations.filter(row=>row.path!==context.forecast.path&&row.path!==selectedPath))
     assert.deepEqual(row,originalByPath.get(row.path));
    const added=reviewed.plan.operations.find(row=>row.path===selectedPath);
    assert.equal(added.amountAtomic,'0009007199254740997');assert.equal(Object.hasOwn(added,'id'),false);
    assert.equal(reviewed.changes.total,2);
    const {workspace:ignored,...selectedRequest}=request;
    const abort=new AbortController();
    await assert.rejects(downloadOpenApiOperationPolicy({client:current.client,workspace:'sender',
     request:{kind:'application',...selectedRequest,expectedReviewSha256:reviewed.review.sha256},
     path:paths.application,expectedFileSha256:reviewed.application.sha256,chunkBytes:65536,signal:abort.signal,
     onProgress:()=>abort.abort(new Error('Resume the same complete application receiving'))}));
    assert.equal(await exists(paths.application),false);
    let applicationChunks=0;
    const application=await downloadOpenApiOperationPolicy({client:current.client,workspace:'sender',
     request:{kind:'application',...selectedRequest,expectedReviewSha256:reviewed.review.sha256},
     path:paths.application,expectedFileSha256:reviewed.application.sha256,chunkBytes:65536,onProgress:()=>{applicationChunks++;}});
    const parsed=await readOpenApiOperationPolicy({path:paths.application,kind:'application',expectedSha256:application.sha256});
    assert.equal(parsed.record.review.sha256,reviewed.review.sha256);assert.ok(applicationChunks>1);
    dropPackage=name;
    await assert.rejects(call('operation_policy_package',{...request,name,expectedReviewSha256:reviewed.review.sha256}));
    assert.equal(dropPackage,null);assert.equal(dropResult.name,name);
    const published=await readPackage(context.senderRoot,name);
    assert.equal(published.manifest.files['operation-policy.json'],application.sha256);
    assert.deepEqual(published.operationPolicy,parsed.record);
    current={...current,...await context.reopen()};measure();
    const reopenedHistory=await native('operation_policy_load',{workspace:'sender',policyId:policy.id,policySha256:first.sha256,historyLimit:1});
    assert.equal(reopenedHistory.headSha256,advanced.sha256);assert.equal(reopenedHistory.history.total,2);
    unavailableReview=true;
    const recovered=await call('operation_policy_package',{workspace:'sender',specFile:'source',applicationFile:'incomingApplication',
     name,expectedReviewSha256:reviewed.review.sha256});
    unavailableReview=false;
    assert.equal(recovered.native.state,'REOPENED');assert.equal(forbiddenReviews,0);
    const exact=await readPackage(context.senderRoot,name);assert.equal(exact.manifest.id,published.manifest.id);
    step('native-policy-review-large-record-and-package-recovery',{reviewSha256:reviewed.review.sha256,applicationSha256:application.sha256,
     applicationBytes:application.bytes,applicationChunks,selected:reviewed.plan.operations.length,
     originalPrice:configured.amountAtomic,newPrice:added.amountAtomic,retainedUntouchedRoutes:3,
     packageId:exact.manifest.id,recoveredAfterRestart:true,recoveryCalledLiveReview:false});
    const cliRequest=join(context.hostFiles,'operation-policy-cli-request.json');
    await file(cliRequest,json({workspace:'sender',kind:'policy',policyId:policy.id,policySha256:first.sha256}));
    const previous=process.env.WORKSHEET_NATIVE_TOKEN;process.env.WORKSHEET_NATIVE_TOKEN=context.environment.WORKSHEET_NATIVE_TOKEN;
    try {
     const cli=await policyCli(['export','--url',current.mcp.url,'--token-env','WORKSHEET_NATIVE_TOKEN',
      '--request-file',cliRequest,'--out',paths.cli,'--sha256',first.sha256,'--chunk-bytes','128']);
     assert.equal(cli.sha256,first.sha256);
    } finally {if(previous===undefined)delete process.env.WORKSHEET_NATIVE_TOKEN;else process.env.WORKSHEET_NATIVE_TOKEN=previous;}
    const receiverReview=await call('operation_policy_review',{workspace:'receiver',specFile:'source',applicationFile:'incomingApplication'});
    assert.equal(receiverReview.review.sha256,reviewed.review.sha256);
    const receiverSaved=await call('operation_policy_package',{workspace:'receiver',specFile:'source',applicationFile:'incomingApplication',
     name:'policy-recreated',expectedReviewSha256:receiverReview.review.sha256});
    assert.equal(receiverSaved.native.state,'SAVED');
    const recreated=await readPackage(context.receiverRoot,'policy-recreated');
    assert.deepEqual(recreated.plan,exact.plan);assert.deepEqual(recreated.operationPolicy,exact.operationPolicy);
    assert.notEqual(recreated.manifest.id,exact.manifest.id);
    step('original-cli-and-portable-application-receiving',{policySha256:first.sha256,reviewSha256:receiverReview.review.sha256,
     recreatedPackageId:recreated.manifest.id,planPreserved:true,completeRecordPreserved:true});
    const inspected=await native('package_inspect',{workspace:'sender',name});
    const exported=await call('export',{workspace:'sender',name,expectedPackageManifestSha256:inspected.manifestSha256});
    assert.equal(exported.manifest.package.operationPolicySha256,application.sha256);
    const full=await downloadOpenApiPackage({client:current.client,workspace:'sender',exportId:exported.exportId,
     directory:paths.package,expectedManifestSha256:exported.manifestFile.sha256,chunkSize:65536});
    const reopened=await reopenOpenApiPackageDownload({directory:paths.package,expectedManifestSha256:exported.manifestFile.sha256});
    assert.equal(full.state,'COMPLETE');assert.equal(reopened.package.id,exact.manifest.id);
    const received=await native('receive',{workspace:'receiver',delivery:'policy',name,expectedManifestSha256:exported.manifestFile.sha256});
    const receivedRetry=await native('receive',{workspace:'receiver',delivery:'policy',name,expectedManifestSha256:exported.manifestFile.sha256});
    assert.equal(receivedRetry.recovered,true);
    const restored=await readPackage(context.receiverRoot,name);assert.deepEqual(restored.operationPolicy,exact.operationPolicy);
    assert.equal(restored.manifest.id,exact.manifest.id);
    const staged=await native('stage',{workspace:'receiver',name,id:'policy-received',
     expectedPackageManifestSha256:received.package.manifestSha256});
    assert.equal(staged.state,'STAGED');
    const release=await current.client.call('merchant_inspect',{id:'policy-received'});
    const comparison=await current.client.call('merchant_compare',{from:'worksheet-received',to:'policy-received'});
    await current.client.call('merchant_activate',{id:'policy-received',expectedDigest:release.digest,
     expectedGeneration:comparison.generation,reason:'Operate the complete original policy receiving package'});
    const selected=await current.client.call('merchant_status',{});
    const started=await current.client.call('merchant_start',{expectedDigest:release.digest,expectedGeneration:selected.state.generation});
    assert.equal(started.runtime.state,'RUNNING');
    const offer=restored.manifest.preview.routes.find(row=>row.id==='forecast');
    const target=new URL(new URL(offer.publicUrl).pathname.replace(/\{city\}|%7Bcity%7D/gi,'Louisville'),started.runtime.observed.listener);
    target.searchParams.set('days','1');
    const challenge=await context.originalFetch(target,{signal:AbortSignal.timeout(15000)});
    assert.equal(challenge.status,402);await challenge.body?.cancel();
    const stopped=await current.client.call('merchant_stop',{instanceId:started.operator.instanceId});
    assert.equal(stopped.status.runtime.state,'STOPPED');
    step('complete-package-receiving-and-original-seller',{exportId:exported.exportId,manifestSha256:exported.manifestFile.sha256,
     operationPolicySha256:application.sha256,files:exported.manifest.files.length,bytes:exported.manifest.totalBytes,
     packageId:restored.manifest.id,releaseDigest:release.digest,challengeStatus:challenge.status,shutdown:'STOPPED'});
    const browser=await browserContinuation({...context,...current,native},first);
    step('original-browser-review-discarded-save-and-reopen',browser);
    policyReport.responseBytes=sizes;policyReport.largestMerchantReplyBytes=Math.max(...Object.values(sizes));
    policyReport.defaultMerchantReplyLimit=2*1024*1024;
    policyReport.state='PASSED';policyReport.completedAt=new Date().toISOString();
   } catch(error) {
    policyReport.state='FAILED';policyReport.failure={code:error.code??null,message:error.message};throw error;
   } finally {globalThis.fetch=context.originalFetch;}
  }
 }});
 console.log(JSON.stringify({operation:OPERATION,state:outcome.report.policy.state,result:outcome.result,
  steps:outcome.report.policy.steps.length,largestMerchantReplyBytes:outcome.report.policy.largestMerchantReplyBytes}));
 return outcome;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const [parent,...extra]=process.argv.slice(2);
 if(!parent||extra.length){console.error('Usage: node openapi-operation-policies-journey.mjs EXISTING_PRIVATE_PARENT');process.exitCode=1;}
 else runOperationPolicyJourney({parent}).catch(error=>{console.error(error.stack??error.message);process.exitCode=1;});
}
