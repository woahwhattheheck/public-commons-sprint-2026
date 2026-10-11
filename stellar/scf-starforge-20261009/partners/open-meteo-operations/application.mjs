// MIT. Native merchant launch and original buyer initialization for weather operators.
import {join} from 'node:path';
import {lstat,realpath,readFile,mkdir} from 'node:fs/promises';
import {native} from './runtime.mjs';
import {compileProduct,createWeatherMerchant} from './merchant.mjs';
import {initializeWeather} from './workspace.mjs';
import {need,keys,encoded,sha} from './contract.mjs';
import {absolute,privateDirectory,publish,publishJson,readPrivate} from './files.mjs';

export async function readProductInput(path){
 absolute(path);const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink()&&info.size<=65536&&await realpath(path)===path,'PRODUCT_INPUT_INVALID');
 const raw=await readFile(path);need(raw.length<=65536,'PRODUCT_INPUT_INVALID');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
}
export async function compileWeatherDistribution(input,{output,environment=process.env}){
 absolute(output);need(input.publicOrigin,'MERCHANT_PUBLIC_ORIGIN_REQUIRED');
 const product=createWeatherMerchant(input,{env:environment});
 try{
  const [{compileSellerRoutes},{compileSellerOpenApi},{exportSellerClient}]=await Promise.all([
   native('sf30-seller-sdk/resource-server.mjs'),
   native('sf30-seller-sdk/developer-portal.mjs'),native('sf30-seller-sdk/developer/client-export.mjs')]);
  const compiled=compileSellerRoutes(product.config.routes.map(route=>({id:route.id,
   definition:{...route.definition,url:input.publicOrigin+route.path},
   handler:product.handlers[route.handler],admit:product.handlers[route.admit]})));
  const openapi=compileSellerOpenApi(compiled,{mode:'CHALLENGE_ONLY'});
  await mkdir(output,{mode:0o700});await privateDirectory(output);
  const files=[];
  for(const [name,value]of Object.entries({'product.json':input,'seller-service.json':product.config,
   'seller-upstreams.json':product.compiled.upstreams,'seller-openapi.json':openapi}))files.push(await publishJson(join(output,name),value));
  const client=await exportSellerClient({openapi:join(output,'seller-openapi.json'),out:join(output,'client')});
  return {schema:'stellar-forge.weather-distribution.v1',directory:output,providerMode:product.compiled.provider.mode,
   files,client,operations:product.config.routes.map(route=>route.id),mode:'CHALLENGE_ONLY_METADATA',
   launch:'node cli.mjs merchant serve --config '+join(output,'product.json')+' --facilitator YOUR_HTTPS_FACILITATOR'};
 }finally{await product.close();}
}
export async function launchWeatherMerchant(input,{port=0,facilitator,allowLocalFacilitator=false,
 environment=process.env,sourceOrigins,allowLoopbackSource=false,nativeFactory:providedFactory}={}){
 const product=createWeatherMerchant(input,{env:environment,sourceOrigins,allowLoopbackSource});
 try{
  let nativeFactory=providedFactory??null;
  need(!(providedFactory&&facilitator),'ONE_NATIVE_FACILITATOR_REQUIRED');
  if(facilitator){
   const u=new URL(facilitator),local=allowLocalFacilitator&&u.protocol==='http:'&&u.hostname==='127.0.0.1';
   need((local||u.protocol==='https:')&&!u.username&&!u.password&&!u.search&&!u.hash,'FACILITATOR_URL_INVALID');
   const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),native('sf30-seller-sdk/native-factory.mjs')]);
   const facilitatorClient=new HTTPFacilitatorClient({url:u.href.replace(/\/$/,'')});
   nativeFactory=compiled=>createNativeSellerServer(compiled,{facilitatorClient});
  }
  const {startSellerService}=await native('sf30-seller-sdk/serve.mjs');
  const server=await startSellerService({config:product.config,handlers:product.handlers,port,nativeFactory});
  return {...server,product,close:async()=>{try{return await server.close();}finally{await product.close();}}};
 }catch(error){await product.close();throw error;}
}
/** The existing native initializer supplies the only operator ledger and keys. */
export async function initializeWeatherWithOperator({stateRoot,review,operatorPreset,totalAtomic,dailyAtomic,sellerClient,provider,environment=process.env}){
 absolute(stateRoot);absolute(review);absolute(operatorPreset);await privateDirectory(stateRoot,{create:true});
 need(typeof totalAtomic==='string'&&/^[1-9]\d{0,18}$/.test(totalAtomic)&&typeof dailyAtomic==='string'&&/^[1-9]\d{0,18}$/.test(dailyAtomic),'EXPLICIT_OPERATOR_BUDGET_REQUIRED');
 const directory=join(stateRoot,'operator'),setupDirectory=join(stateRoot,'setup');
 await privateDirectory(setupDirectory,{create:true});
 for(const [name,source]of [['review.json',review],['operator-preset.json',operatorPreset]]){
  const bytes=await readPrivate(source,65536),target=join(setupDirectory,name);
  try{await publish(target,bytes);}catch(error){if(error.code!=='EEXIST')throw error;need((await readPrivate(target,65536)).equals(bytes),'ORIGINAL_SETUP_INPUT_CHANGED');}
 }
 const retainedReview=join(setupDirectory,'review.json'),retainedPreset=join(setupDirectory,'operator-preset.json');
 const {readBuyerOperatorPreset}=await native('buyer-runbook/handoff-intake.mjs');
 const preset=await readBuyerOperatorPreset(retainedPreset,{directory}),p=preset.value;
 need(BigInt(totalAtomic)<=BigInt(p.maxTotalAtomic)&&BigInt(dailyAtomic)<=BigInt(p.maxDailyAtomic)&&BigInt(dailyAtomic)<=BigInt(totalAtomic),'OPERATOR_PRESET_BUDGET_EXCEEDED');
 const args=['--config',retainedReview,'--dir',directory,'--actor',p.actor,'--service',p.service,'--payer',p.payer,'--python',p.python,
  '--total-atomic',totalAtomic,'--daily-atomic',dailyAtomic];
 for(const [name,flag]of [['secretEnv','--secret-env'],['signerProvider','--signer-provider'],['rpc','--rpc'],['httpsProxyEnv','--https-proxy-env']])if(p[name]!==undefined)args.push(flag,p[name]);
 const {initializeWorkspace}=await native('sf88-operator-buyer-cli/workspace.mjs');
 const original=await initializeWorkspace(args,{environment,resume:true});
 const settings=await initializeWeather({stateRoot,originalOperatorDirectory:directory,sellerClient,setupDirectory,provider});
 return {...settings,original,operatorPresetSha256:preset.sha256};
}
