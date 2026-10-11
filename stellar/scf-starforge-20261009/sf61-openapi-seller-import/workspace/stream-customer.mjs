// MIT. Saved OpenAPI merchant inputs into the ORIGINAL SF66 customer workflow.
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { prepareMerchant, packageName } from './model.mjs';
import { readPrivateFile, absolute } from '../../sf103-native-buyer-signer/operator.mjs';
import { OPERATION_HANDOFF_MAX_BYTES } from '../../sf88-operator-buyer-cli/operation-handoff.mjs';
import { MAX_REQUEST_BODY_BYTES } from '../../sf88-operator-buyer-cli/request-body.mjs';
import { reviewCommerceSetup, prepareCommerceSetup, inspectCommerceSetup } from '../../sf66-demo-launcher/commerce-setup.mjs';

const SCHEMA='stellar-forge.api-merchant-customer.v1';
const own=(value,key)=>Object.hasOwn(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const setupCli=fileURLToPath(new URL('../../sf66-demo-launcher/commerce-setup.mjs',import.meta.url));
const consoleCli=fileURLToPath(new URL('../../sf66-demo-launcher/commerce-console.mjs',import.meta.url));
function fields(value,allowed,label) {
  if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key))) fail('Invalid '+label+' fields');
  return value;
}
async function privateDirectory(path,create=false) {
  absolute(path);
  if(create) await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path||
    process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid()))
    fail('Customer files require a canonical private directory');
  return info;
}
async function writeNew(path,bytes) {
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(bytes);await file.sync();} finally {await file.close();}
}
const customerRoot=project=>join(project.folder,'stream-customers');
function paths(project,name) {
  const folder=join(customerRoot(project),packageName(name)),directory=join(folder,'commerce');
  return {folder,directory,configFile:join(folder,'setup.json'),recordFile:join(folder,'customer.json'),
    sessionDirectory:join(directory,'session')};
}
function commands(value) {
  return {review:[process.execPath,setupCli,'review','--config',value.configFile,'--directory',value.directory],
    prepare:[process.execPath,setupCli,'resume','--config',value.configFile,'--directory',value.directory],
    console:[process.execPath,consoleCli,'start','--directory',value.sessionDirectory,'--port','0']};
}
function defaults(prepared,route) {
  const offer=prepared.service.routes.find(item=>item.id===route.id).offer;
  const sample=offer.extensions.bazaar.info.input;
  const strings=value=>Object.fromEntries(Object.entries(value??{}).map(([key,item])=>
    [key,Array.isArray(item)?item.map(String):String(item)]));
  const timeout=Math.min(300000,route.stream.maxDurationMs+15000);
  return {routeId:route.id,method:route.method,url:route.publicUrl,format:route.responseMode,
    mimeType:route.responseMimeType,paymentFlow:route.paymentFlow,terms:offer.accepts[0],
    maxRequestBytes:route.maxRequestBytes,bodyType:sample.bodyType??null,bodyRequired:route.requestBody?.required??false,
    request:{path:strings(sample.pathParams),query:strings(sample.queryParams),
      ...(own(sample,'body')?{body:structuredClone(sample.body)}:{})},
    response:{maxBytes:route.stream.maxBytes,timeoutMs:timeout,requestTimeoutMs:timeout,
      maxRecordBytes:1048576,maxRecords:100000},stream:route.stream};
}

/** Public sample values and current retained customers; reads no signing key. */
export async function describeMerchantStreamCustomers(project) {
  const prepared=prepareMerchant(project.specText,project.plan);
  const routes=prepared.preview.routes.filter(route=>route.stream).map(route=>defaults(prepared,route));
  const customers=[];
  let entries=[];
  try {await privateDirectory(customerRoot(project));entries=await readdir(customerRoot(project),{withFileTypes:true});}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  for(const entry of entries.filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,100)) {
    try {const value=await readMerchantStreamCustomer(project,entry.name);
      customers.push({name:value.name,state:value.state,configSha256:value.configSha256,
        intentId:value.review.selections[0].intentId,url:value.review.selections[0].url});}
    catch(error) {customers.push({name:entry.name,state:'UNAVAILABLE',error:String(error.message)});}
  }
  return {packageName:project.name,packageId:project.manifest.id,routes,customers};
}

/** Store the exact request and the original setup review before initialization. */
export async function createMerchantStreamCustomer(project,value) {
  fields(value,['name','routeId','operator','facilitatorConfig','request','response','sellerPort'],'customer');
  const prepared=prepareMerchant(project.specText,project.plan);
  const route=prepared.preview.routes.find(route=>route.id===value.routeId&&route.stream);
  if(!route) fail('Select a declared stream route from this saved merchant package');
  const request=fields(value.request,['intentId','path','query','body','bodyFile','headers','requestFile'],'request');
  const response=fields(value.response??{},['maxBytes','timeoutMs','requestTimeoutMs','maxRecordBytes','maxRecords'],'response');
  const customer=paths(project,value.name);
  await privateDirectory(project.folder);
  await privateDirectory(customerRoot(project),true);
  const compiled=await readPrivateFile(join(project.folder,'compiled','seller-service.json'),1048576);
  if(!same(JSON.parse(compiled),prepared.service)) fail('The compiled service changed; save a new merchant package');
  absolute(value.facilitatorConfig);
  await mkdir(customer.folder,{mode:0o700});
  const created=await privateDirectory(customer.folder);
  try {
    let selected={routeId:route.id,acceptIndex:0,paymentFlow:route.paymentFlow};
    if(own(request,'requestFile')) {
      if(Object.keys(request).length!==1) fail('A private request packet supplies its own intent, URL, headers and body');
      const bytes=await readPrivateFile(request.requestFile,OPERATION_HANDOFF_MAX_BYTES);
      selected.requestFile=join(customer.folder,'request.handoff.json');
      await writeNew(selected.requestFile,bytes);
    } else {
      selected={...selected,intentId:request.intentId,method:route.method,
        path:request.path??{},query:request.query??{},...(request.headers===undefined?{}:{headers:request.headers})};
      if(own(request,'body')&&own(request,'bodyFile')) fail('Select one request body source');
      const bytes=own(request,'bodyFile')?await readPrivateFile(request.bodyFile,MAX_REQUEST_BODY_BYTES):
        own(request,'body')?json(request.body):null;
      if(bytes!==null) {
        if(bytes.length>Math.min(route.maxRequestBytes,MAX_REQUEST_BODY_BYTES)) fail('Request body exceeds the selected merchant limit');
        selected.bodyFile=join(customer.folder,'request.body');
        await writeNew(selected.bodyFile,bytes);
      }
    }
    const preferred={...defaults(prepared,route).response,...response};
    Object.assign(selected,{saveResponse:true,responseMaxBytes:preferred.maxBytes,
      responseTimeoutMs:preferred.timeoutMs,requestTimeoutMs:preferred.requestTimeoutMs,
      responseStream:{format:route.responseMode,maxRecordBytes:preferred.maxRecordBytes,maxRecords:preferred.maxRecords}});
    const setup={schema:'stellar-forge.commerce-setup.v1',
      seller:{config:join(project.folder,'compiled','seller-service.json'),
        upstreams:join(project.folder,'upstreams.json'),allowLoopbackUpstream:project.plan.allowLoopbackUpstream===true,
        facilitatorConfig:value.facilitatorConfig,port:value.sellerPort??0},
      operator:structuredClone(value.operator),purchases:[selected],operationsPort:0};
    const bytes=json(setup);
    if(bytes.length>65536) fail('Customer setup exceeds 64 KiB');
    await writeNew(customer.configFile,bytes);
    const reviewed=await reviewCommerceSetup(customer);
    const record={schema:SCHEMA,name:value.name,packageName:project.name,packageId:project.manifest.id,
      packageSourceSha256:project.manifest.preview.sourceSha256,configSha256:sha(bytes),
      reviewedSource:reviewed.source,review:reviewed.summary};
    const recordBytes=json(record);
    if(recordBytes.length>1048576) fail('Customer review exceeds 1 MiB');
    await writeNew(customer.recordFile,recordBytes);
    const handle=await open(customer.folder,'r');try {await handle.sync();}finally {await handle.close();}
    return readMerchantStreamCustomer(project,value.name);
  } catch(error) {
    const current=await lstat(customer.folder).catch(()=>null);
    if(current?.dev===created.dev&&current?.ino===created.ino) await rm(customer.folder,{recursive:true,force:true});
    throw error;
  }
}

/** Read the original saved setup and its same-purchase session, if prepared. */
export async function readMerchantStreamCustomer(project,name) {
  const customer=paths(project,name);
  await privateDirectory(customerRoot(project));await privateDirectory(customer.folder);
  const record=JSON.parse(await readPrivateFile(customer.recordFile,1048576));
  if(record.schema!==SCHEMA||record.name!==name||record.packageName!==project.name||
    record.packageId!==project.manifest.id||record.packageSourceSha256!==project.manifest.preview.sourceSha256)
    fail('Customer review belongs to another saved merchant package');
  const bytes=await readPrivateFile(customer.configFile,65536);
  if(sha(bytes)!==record.configSha256) fail('Reviewed customer configuration changed');
  let state='REVIEWED',prepared=null;
  try {
    await lstat(customer.directory);
    try {
      await lstat(join(customer.directory,'prepared.json'));
      prepared=await inspectCommerceSetup(customer.directory);
      const retained=JSON.parse(await readPrivateFile(join(customer.directory,'prepared.json'),1048576));
      if(!same(retained.source,record.reviewedSource)) fail('Prepared session belongs to another customer review');
      state='PREPARED';
    } catch(error) {if(error.code==='ENOENT')state='INITIALIZATION_PENDING';else throw error;}
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  return {...customer,name,configSha256:record.configSha256,review:record.review,
    reviewedSource:record.reviewedSource,state,prepared,commands:commands(customer)};
}

/** The source/terms shown in review must still be exact at native preparation. */
export async function prepareMerchantStreamCustomer(project,name,expectedSha256,{environment=process.env}={}) {
  const customer=await readMerchantStreamCustomer(project,name);
  if(customer.configSha256!==expectedSha256) fail('Select the exact reviewed customer configuration');
  if(customer.state==='PREPARED') return customer;
  const fresh=await reviewCommerceSetup(customer);
  if(!same(fresh.source,customer.reviewedSource)||!same(fresh.summary,customer.review))
    fail('Customer inputs changed after review; save and review a new customer configuration');
  await prepareCommerceSetup(customer,{environment,resume:true});
  return readMerchantStreamCustomer(project,name);
}
