// MIT. Bind a reviewed OpenCage package to the original SF99 Linux host bundle.
import {resolve,join,relative,isAbsolute} from 'node:path';
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ROOT,SCHEMA as HOST_SCHEMA,prepare,generate,checkBundle} from '../../sf99-merchant-deploy/host.mjs';
import {inspectGeocodePackage,prepareGeocodeHandlerEntry} from './merchant.mjs';
import {fields,fail} from './config.mjs';
import {readBytes,readJson,jsonBytes,digest,privateDirectory,putOnce,exists} from '../twelvedata/files.mjs';

export const HOST_SELECTION='stellar-forge.opencage-host-selection.v1';
export const HOST_REVIEW='stellar-forge.opencage-host-review.v1';
const HOST_KEYS=['schema','merchant','serviceUser','serviceGroup','kind','mode','privateRoot',
  'environmentFile','facilitator','ports','runtime','delivery','maxInFlight','drainGraceMs','historyDays'];
const SHA=/^[a-f0-9]{64}$/;
const inside=(root,value)=>{const r=relative(root,value);return r===''||!r.startsWith('../')&&r!=='..'&&!isAbsolute(r);};
const same=(a,b,code)=>{if(digest(jsonBytes(a))!==digest(jsonBytes(b)))fail(code);};
const fileRecord=(path,bytes)=>({path,bytes:bytes.length,sha256:digest(bytes)});
function hostSettings(bytes){
  let raw;
  try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('GEOCODE_HOST_SETTINGS_JSON_INVALID');}
  fields(raw,HOST_KEYS,'OpenCage host settings');
  if(raw.schema!==HOST_SCHEMA||raw.kind!==undefined&&raw.kind!=='api'||!['native','challenge'].includes(raw.mode))
    fail('GEOCODE_HOST_SETTINGS_INVALID','Select the original merchant-host schema, api kind and explicit native or challenge mode.');
  return raw;
}
function separate(directory,sourceRoot,packageRoot,settings){
  for(const root of [sourceRoot,packageRoot,settings.privateRoot].filter(value=>typeof value==='string')){
    const selected=resolve(root);
    if(inside(selected,directory)||inside(directory,selected))
      fail('GEOCODE_HOST_DIRECTORY_CONFLICT','Keep deployment preparation separate from installed source, package and merchant state.');
  }
  if(settings.environmentFile&&inside(directory,resolve(settings.environmentFile)))
    fail('GEOCODE_HOST_DIRECTORY_CONFLICT','Keep the private environment file outside deployment preparation.');
}
async function generatorBinding(){
  const files=[];
  for(const value of ['./deployment.mjs','./merchant.mjs','../../sf99-merchant-deploy/host.mjs',
      '../../sf99-merchant-deploy/runbook.mjs','../../sf99-merchant-deploy/cli.mjs']){
    const path=await realpath(fileURLToPath(new URL(value,import.meta.url))),bytes=await readBytes(path,1048576);
    files.push(fileRecord(path,bytes));
  }
  return files;
}
function selectedPackage(bundle){
  return {directory:bundle.directory,identity:bundle.manifest.identity,manifestSha256:bundle.manifestSha256,
    planId:bundle.built.plan.id,planSha256:bundle.built.planSha256,termsSha256:bundle.built.termsSha256};
}
function composedPlan(settings,bundle,entryPath){
  if(settings.mode==='native'&&bundle.built.terms.paymentOptions.some(value=>
      /DEMO_NONPAYABLE_/.test(String(value.asset)+' '+String(value.payTo))))
    fail('GEOCODE_HOST_PAYMENT_TERMS_REQUIRED','Prepare the package with the merchant’s actual asset and recipient.');
  return {...settings,kind:'api',config:join(bundle.directory,'seller-service.json'),handlers:entryPath};
}
async function reviewValue(directory,request,settings,bundle,entryPath,handlerSha256){
  const planFile=join(directory,'host-plan.json'),planBytes=await readBytes(planFile,1048576);
  same(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(planBytes)),composedPlan(settings,bundle,entryPath),
    'GEOCODE_HOST_PLAN_CHANGED');
  const host=await prepare(planFile,{sourceRoot:request.sourceRoot});
  const plan=bundle.built.plan;
  return {schema:HOST_REVIEW,requestSha256:digest(jsonBytes(request)),package:selectedPackage(bundle),
    handler:fileRecord(entryPath,await readBytes(entryPath,1048576)),
    hostPlan:fileRecord(planFile,planBytes),host,generator:await generatorBinding(),
    commercial:{publicOrigin:bundle.built.terms.publicOrigin,paymentOptions:bundle.built.terms.paymentOptions,
      products:plan.products.map(value=>({id:value.id,name:value.name,method:'GET',path:value.path,mode:value.mode}))},
    environment:{file:host.environmentFile,apiKeyEnv:plan.apiKeyEnv,
      transport:plan.transport??{mode:'direct'},proxyEnv:plan.transport?.proxyEnv??null},
    sourceLimits:{minIntervalMs:plan.minIntervalMs,timeoutMs:plan.timeoutMs,maxResponseBytes:plan.maxResponseBytes},
    handlerSha256};
}
function reviewSummary(directory,review,reused){
  return {schema:HOST_REVIEW,state:'REVIEWED',directory,reviewSha256:digest(jsonBytes(review)),
    packageIdentity:review.package.identity,termsSha256:review.package.termsSha256,
    hostPlan:review.hostPlan.path,bundle:join(directory,'host'),publicOrigin:review.host.publicOrigin,
    mode:review.host.mode,services:review.host.services,commercial:review.commercial,
    environment:review.environment,sourceLimits:review.sourceLimits,reused};
}
/** Save one immutable source/settings selection and its original host preparation. */
export async function prepareGeocodeDeployment({packageDirectory,hostPlanFile,directory}){
  const sourceRoot=await realpath(ROOT),selectedRoot=await realpath(resolve(packageDirectory));
  const bundle=await inspectGeocodePackage(selectedRoot);
  const sourceFile=await realpath(resolve(hostPlanFile)),settingsBytes=await readBytes(sourceFile,1048576);
  const settings=hostSettings(settingsBytes);
  directory=resolve(directory);
  separate(directory,sourceRoot,bundle.directory,settings);
  directory=await realpath(await privateDirectory(directory));
  separate(directory,sourceRoot,bundle.directory,settings);
  const request={schema:HOST_SELECTION,directory,sourceRoot,package:selectedPackage(bundle),
    settings:fileRecord(sourceFile,settingsBytes)};
  const requestPath=join(directory,'selection.json'),reused=await exists(requestPath);
  // Publish the request before its dependent files. Each original putOnce is
  // atomic/exclusive, so interrupted preparation rejoins these same exact bytes.
  await putOnce(requestPath,jsonBytes(request));
  await putOnce(join(directory,'host-settings.json'),settingsBytes);
  const handler=await prepareGeocodeHandlerEntry(join(directory,'applications'),bundle.directory);
  same(selectedPackage(handler.bundle),request.package,'GEOCODE_HOST_PACKAGE_CHANGED');
  await putOnce(join(directory,'host-plan.json'),jsonBytes(composedPlan(settings,bundle,handler.entryPath)));
  const review=await reviewValue(directory,request,settings,bundle,handler.entryPath,handler.handlerSha256);
  await putOnce(join(directory,'review.json'),jsonBytes(review));
  return reviewSummary(directory,review,reused);
}
/** Read/rejoin every original selection; this path never repairs or creates files. */
export async function inspectGeocodeDeployment(directory){
  directory=await realpath(await privateDirectory(resolve(directory),{create:false}));
  const request=await readJson(join(directory,'selection.json'),1048576);
  fields(request,['schema','directory','sourceRoot','package','settings'],'host selection');
  if(request.schema!==HOST_SELECTION||request.directory!==directory||request.sourceRoot!==await realpath(ROOT))
    fail('GEOCODE_HOST_SELECTION_CHANGED');
  fields(request.package,['directory','identity','manifestSha256','planId','planSha256','termsSha256'],'package selection');
  fields(request.settings,['path','bytes','sha256'],'host settings source');
  const settingsBytes=await readBytes(join(directory,'host-settings.json'),1048576);
  if(settingsBytes.length!==request.settings.bytes||digest(settingsBytes)!==request.settings.sha256)
    fail('GEOCODE_HOST_SETTINGS_CHANGED');
  const settings=hostSettings(settingsBytes);
  const handler=await prepareGeocodeHandlerEntry(join(directory,'applications'),request.package.directory,{readOnly:true});
  same(selectedPackage(handler.bundle),request.package,'GEOCODE_HOST_PACKAGE_CHANGED');
  separate(directory,request.sourceRoot,handler.bundle.directory,settings);
  const review=await readJson(join(directory,'review.json'),4194304);
  const current=await reviewValue(directory,request,settings,handler.bundle,handler.entryPath,handler.handlerSha256);
  same(review,current,'GEOCODE_HOST_REVIEW_CHANGED');
  return {directory,request,review,reviewSha256:digest(jsonBytes(review))};
}
async function checkedHost(saved){
  const bundle=join(saved.directory,'host'),manifest=await checkBundle(bundle);
  const {artifacts,bundle:generatedDirectory,...prepared}=manifest;
  same(prepared,saved.review.host,'GEOCODE_HOST_BUNDLE_PLAN_CHANGED');
  return {bundle,manifest,manifestSha256:digest(await readBytes(join(bundle,'deployment.json'),4194304))};
}
async function incompleteGeneration(saved){
  const bundle=join(saved.directory,'host');
  if(!await exists(bundle))return {schema:HOST_REVIEW,state:'HOST_BUNDLE_NOT_GENERATED',
    directory:saved.directory,reviewSha256:saved.reviewSha256,bundle,
    generation:{command:'host-bundle',directory:saved.directory,expectedReviewSha256:saved.reviewSha256}};
  let manifest;
  try{manifest=await readJson(join(bundle,'deployment.json'),4194304);}
  catch(error){
    if(!['ENOENT','JSON_INVALID','JSON_OBJECT_REQUIRED'].includes(error.code))throw error;
    return {schema:HOST_REVIEW,state:'HOST_BUNDLE_INCOMPLETE',directory:saved.directory,
      reviewSha256:saved.reviewSha256,bundle,packageIdentity:saved.review.package.identity,
      reason:error.code==='ENOENT'?'ORIGINAL_MANIFEST_MISSING':'ORIGINAL_MANIFEST_INCOMPLETE',
      recovery:{command:'host-review',packageDirectory:saved.request.package.directory,
        hostPlanFile:join(saved.directory,'host-settings.json'),
        directory:saved.directory+'-recovery-'+saved.reviewSha256.slice(0,12),
        previousDirectory:saved.directory,previousReviewSha256:saved.reviewSha256}};
  }
  return null;
}
/** Generate the existing SF99 bundle only for the exact review selected by the operator. */
export async function generateGeocodeDeployment({directory,expectedReviewSha256}){
  if(!SHA.test(expectedReviewSha256??''))fail('GEOCODE_HOST_REVIEW_REQUIRED');
  const saved=await inspectGeocodeDeployment(directory);
  if(saved.reviewSha256!==expectedReviewSha256)fail('GEOCODE_HOST_REVIEW_CHANGED');
  const bundle=join(saved.directory,'host'),reused=await exists(bundle);
  if(!reused)await generate(saved.review.hostPlan.path,bundle,{sourceRoot:saved.request.sourceRoot});
  const incomplete=await incompleteGeneration(saved);if(incomplete)return incomplete;
  const checked=await checkedHost(saved);
  return hostSummary(saved,checked,reused);
}
function hostSummary(saved,checked,reused){
  return {schema:HOST_REVIEW,state:'BUNDLE_CHECKED',directory:saved.directory,
    reviewSha256:saved.reviewSha256,packageIdentity:saved.review.package.identity,
    termsSha256:saved.review.package.termsSha256,bundle:checked.bundle,
    deploymentSha256:checked.manifestSha256,publicOrigin:checked.manifest.publicOrigin,
    mode:checked.manifest.mode,target:checked.manifest.target,services:checked.manifest.services.map(value=>value.unit),
    files:Object.keys(checked.manifest.artifacts).concat('deployment.json'),
    commercial:saved.review.commercial,environment:saved.review.environment,reused};
}
/** Reopen the prepared operation and the original generated host bundle. */
export async function checkGeocodeDeployment(directory){
  const saved=await inspectGeocodeDeployment(directory);
  const incomplete=await incompleteGeneration(saved);if(incomplete)return incomplete;
  return hostSummary(saved,await checkedHost(saved),true);
}
