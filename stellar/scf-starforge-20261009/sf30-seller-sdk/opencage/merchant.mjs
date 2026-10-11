// MIT. Geocoding products compiled and operated by the original SF61/SF30/SF82 engines.
import { resolve,join,dirname } from 'node:path';
import { rename,rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { importOpenApi } from '../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../sf61-openapi-seller-import/service-config.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { generateSellerClient } from '../developer/client-generator.mjs';
import { initReleaseStore,stageRelease,inspectRelease,compareReleases,listReleases,releaseStatus,
  activateRelease,rollbackRelease,runActiveRelease } from '../../sf82-seller-pilot/releases.mjs';
import { compileGeocodePlan,querySchema,handlerName,exampleQuery,fields,text,fail } from './config.mjs';
import { readBytes,readJson,jsonBytes,digest,privateDirectory,putOnce,readBundle,publishBundle,exists,syncDirectory } from '../twelvedata/files.mjs';
export const PACKAGE='stellar-forge.opencage-merchant-package.v1';
export const TERMS='stellar-forge.opencage-payment-terms.v1';
const unavailable=async()=>{throw new Error('Offline merchant compilation');};
export function compileGeocodeSeller(raw,rawTerms) {
  const plan=compileGeocodePlan(raw);
  fields(rawTerms,['schema','publicOrigin','paymentOptions'],'payment terms');
  if(rawTerms.schema !== TERMS) fail('GEOCODE_TERMS_SCHEMA');
  let origin;
  try {origin=new URL(rawTerms.publicOrigin);} catch {fail('GEOCODE_MERCHANT_ORIGIN_INVALID');}
  if(origin.protocol !== 'https:' || origin.origin !== rawTerms.publicOrigin || origin.username || origin.password)
    fail('GEOCODE_MERCHANT_ORIGIN_INVALID');
  if(!Array.isArray(rawTerms.paymentOptions) || !rawTerms.paymentOptions.length || rawTerms.paymentOptions.length>8)
    fail('GEOCODE_PAYMENTS_INVALID');
  const terms=JSON.parse(jsonBytes(rawTerms));
  const spec={openapi:'3.1.0',info:{title:plan.name,version:'1.0.0',
    description:'OpenCage native JSON geocoding. Results retain provider order, WGS84 geometry and data licenses.'},
    servers:[{url:origin.origin+'/'}],paths:{}};
  for(const product of plan.products) spec.paths[product.path]={get:{
    operationId:product.id,summary:product.name,description:product.description,tags:['Geocoding'],
    parameters:querySchema(product),responses:{'200':{description:'Native OpenCage response, including zero results.',
      content:{'application/json':{schema:{type:'object',required:['results','status','total_results'],
        properties:{results:{type:'array',items:{type:'object'}},status:{type:'object'},total_results:{type:'integer',minimum:0}},
        additionalProperties:true}}}}}}};
  const selections=plan.products.map(product=>({method:'GET',path:product.path,serviceName:product.name,
    accepts:structuredClone(terms.paymentOptions)}));
  const bindings=plan.products.map(product=>({method:'GET',path:product.path,id:product.id,
    handler:handlerName(product.id),admit:handlerName(product.id,true),validateInput:true}));
  const imported=importOpenApi(spec,selections),seller=createSellerServiceConfig(imported,bindings);
  const compiled=compileSellerRoutes(seller.routes.map(route=>({...route,handler:unavailable,admit:unavailable})));
  const openapi=compileSellerOpenApi(compiled,{mode:'CHALLENGE_ONLY'});
  const client=generateSellerClient(jsonBytes(openapi));
  return {plan,terms,spec,selections,bindings,imported,seller,openapi,client,
    planSha256:digest(jsonBytes(plan)),termsSha256:digest(jsonBytes(terms))};
}
export async function runtimeBinding() {
  const files=[];
  for(const name of ['config.mjs','source.mjs']) {
    const path=fileURLToPath(new URL('./'+name,import.meta.url)),bytes=await readBytes(path,1048576);
    files.push({name,bytes:bytes.length,sha256:digest(bytes)});
  }
  return {schema:'stellar-forge.opencage-runtime-binding.v1',files};
}
export async function packageGeocodeMerchant(directory,raw,terms) {
  const built=compileGeocodeSeller(raw,terms),runtime=await runtimeBinding();
  const entries=[
    ['plan.json',jsonBytes(built.plan)],['terms.json',jsonBytes(built.terms)],['spec.json',jsonBytes(built.spec)],
    ['selections.json',jsonBytes(built.selections)],['bindings.json',jsonBytes(built.bindings)],
    ['offers.json',jsonBytes(built.imported)],['seller-service.json',jsonBytes(built.seller)],
    ['openapi.json',jsonBytes(built.openapi)],['runtime-binding.json',jsonBytes(runtime)],
    ['sdk/client.mjs',built.client.javascript],['sdk/client.d.ts',built.client.declarations],
    ['sdk/package.json',built.client.packageJson],['sdk/README.md',built.client.readme],
    ['queries.json',jsonBytes(built.plan.products.map(product=>({productId:product.id,input:exampleQuery(product)})))],
    ['RUN.md',Buffer.from('# Geocoding merchant\n\nInstall the maintained Starforge source containing sf30-seller-sdk/opencage.\nUse its CLI: package-inspect --package THIS_DIRECTORY; stage --workspace PRIVATE_WORKSPACE --package THIS_DIRECTORY --release RELEASE_ID.\nThe package preserves every original payment option and the native source module hashes. Stage emits a private pinned handler entry for this installation and delegates to the original SF82 release store.\nThe named API key is read from the process environment at application dispatch.\n')],
  ];
  const identity=digest(jsonBytes(entries.map(([name,value])=>({name,sha256:digest(Buffer.from(value))}))));
  return publishBundle(resolve(directory),PACKAGE,identity,entries,{planId:built.plan.id,planSha256:built.planSha256,
    termsSha256:built.termsSha256,source:'https://opencagedata.com/api'});
}
export async function inspectGeocodePackage(directory) {
  const bundle=await readBundle(directory,{schema:PACKAGE});
  const required=['plan.json','terms.json','spec.json','selections.json','bindings.json','runtime-binding.json'];
  if(required.some(name=>!bundle.files.has(name))) fail('GEOCODE_PACKAGE_INCOMPLETE');
  const built=compileGeocodeSeller(JSON.parse(bundle.files.get('plan.json')),JSON.parse(bundle.files.get('terms.json')));
  for(const [name,value] of [['plan.json',built.plan],['terms.json',built.terms],['spec.json',built.spec],
      ['selections.json',built.selections],['bindings.json',built.bindings],['offers.json',built.imported],['seller-service.json',built.seller]]) {
    if(!bundle.files.has(name) || digest(bundle.files.get(name)) !== digest(jsonBytes(value))) fail('GEOCODE_PACKAGE_CONTRACT_CHANGED');
  }
  const identity=digest(jsonBytes(bundle.manifest.files.map(file=>({name:file.name,sha256:file.sha256}))));
  if(identity !== bundle.manifest.identity || built.planSha256 !== bundle.manifest.planSha256 ||
      built.termsSha256 !== bundle.manifest.termsSha256) fail('GEOCODE_PACKAGE_IDENTITY_CHANGED');
  return {...bundle,built};
}
async function ensureReleaseStore(root) {
  if(await exists(join(root,'state.json'))) {await releaseStatus(root);return;}
  if(await exists(root)) fail('GEOCODE_RELEASE_STORE_INCOMPLETE');
  await privateDirectory(dirname(root));
  const staging=join(dirname(root),'.geocode-release-'+randomUUID());
  try {await initReleaseStore(staging);await rename(staging,root);await syncDirectory(dirname(root));}
  finally {await rm(staging,{recursive:true,force:true});}
}
export async function stageGeocodePackage(releaseRoot,applicationRoot,directory,{id,label,facilitator,port=0}={}) {
  const bundle=await inspectGeocodePackage(directory);
  const current=await runtimeBinding();
  if(digest(jsonBytes(current)) !== digest(bundle.files.get('runtime-binding.json'))) fail('GEOCODE_INSTALLED_SOURCE_CHANGED',
    'The installed provider source differs from this prepared package. Prepare a new package for this installation.');
  const app=await privateDirectory(resolve(applicationRoot));
  const sourceUrl=new URL('./source.mjs',import.meta.url);
  const entry=[
    '// MIT. Immutable SF82 application entry generated from the reviewed geocoding package.',
    "import {readFile} from 'node:fs/promises';",
    "import {createHash} from 'node:crypto';",
    'const sourceUrl=new URL('+JSON.stringify(sourceUrl.href)+');',
    'const files='+JSON.stringify(current.files)+';',
    'for(const file of files){const bytes=await readFile(new URL(file.name,sourceUrl));',
    " if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('GEOCODE_PINNED_SOURCE_CHANGED');}",
    'const {createOpenCageSource}=await import(sourceUrl.href);',
    'const source=createOpenCageSource('+JSON.stringify(bundle.built.plan)+');',
    ...bundle.built.plan.products.flatMap(product=>[
      'export const '+handlerName(product.id)+'=source.handlers['+JSON.stringify(handlerName(product.id))+'];',
      'export const '+handlerName(product.id,true)+'=source.handlers['+JSON.stringify(handlerName(product.id,true))+'];',
    ]),'',
  ].join('\n');
  const entryPath=join(app,bundle.manifest.identity+'.mjs');await putOnce(entryPath,Buffer.from(entry));
  await ensureReleaseStore(resolve(releaseRoot));
  const result=await stageRelease(resolve(releaseRoot),{id,label,
    spec:join(bundle.directory,'spec.json'),config:join(bundle.directory,'selections.json'),
    bindings:join(bundle.directory,'bindings.json'),
    runtime:{handlers:entryPath,port,...(facilitator?{facilitator}: {})}});
  return {packageIdentity:bundle.manifest.identity,handlerSha256:digest(Buffer.from(entry)),result};
}
export { initReleaseStore,inspectRelease,compareReleases,listReleases,releaseStatus,activateRelease,rollbackRelease,runActiveRelease };
export const exampleTerms=()=>({schema:TERMS,publicOrigin:'https://locations.example',
  paymentOptions:[{scheme:'exact',network:'stellar:testnet',amount:'20000',
    asset:'DEMO_NONPAYABLE_ASSET',payTo:'DEMO_NONPAYABLE_RECIPIENT',maxTimeoutSeconds:60}]});
