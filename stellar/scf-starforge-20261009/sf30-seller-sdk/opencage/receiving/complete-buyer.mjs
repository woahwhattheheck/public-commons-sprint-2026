// MIT. Resume the original SF88 Buyer from the retained OpenCage resource selection.
import { readFile, mkdir, open, link, unlink, rename, lstat, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const {values:args}=parseArgs({options:{source:{type:'string'},'input-root':{type:'string'},
  work:{type:'string'},python:{type:'string'}}});
for(const key of ['source','input-root','work','python'])if(!args[key])throw Error('Missing --'+key);
const root=resolve(args.work),inputRoot=resolve(args['input-root']);
const prefix=join(resolve(args.source),'stellar/scf-starforge-20261009');
const imp=path=>import(pathToFileURL(path).href),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const need=(value,message)=>{if(!value)throw Error(message);};
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
async function atomic(path,bytes,{replace=false}={}){
  bytes=Buffer.isBuffer(bytes)?bytes:json(bytes);
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(!replace&&await exists(path)){need((await readFile(path)).equals(bytes),'Retained input changed: '+path);return;}
  const temporary=path+'.next-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();await handle.close();
    if(replace)await rename(temporary,path);else{await link(temporary,path);await unlink(temporary);}
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
await mkdir(root,{recursive:true,mode:0o700});
need(await realpath(root)===root&&await realpath(inputRoot)===inputRoot,'Use original canonical private directories');
const inputs={};
for(const name of ['customer-resource.json','native-terms.json','native-payer.json','buyer-review-input.json']){
  const bytes=await readFile(join(inputRoot,name));
  await atomic(join(root,'inputs',name),bytes);inputs[name]={bytes:bytes.length,sha256:sha(bytes)};
}
const resource=await readJson(join(root,'inputs/customer-resource.json'));
const terms=await readJson(join(root,'inputs/native-terms.json'));
const payer=(await readJson(join(root,'inputs/native-payer.json'))).payer;
const review=await readJson(join(root,'inputs/buyer-review-input.json'));
const expectedResource='https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/f2d1e326f2c7f60db77e5ea264c235590af84daf/stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/fixtures/native-reverse.json';
const expectedResponse='94831ba4c34acf608585d242baa998c4ee58a190bf1e4ed3040897800f5797dd';
const url=new URL(resource.url);
for(const [key,value]of Object.entries(resource.query))url.searchParams.set(key,value);
need(resource.url===expectedResource&&resource.responseSha256===expectedResponse&&resource.responseBytes===2785,
  'Use the retained commit-pinned original provider resource');
need(review.operation.intentId==='scf-opencage-native-customer-a39c-20261011'&&
  review.operation.url===url.href&&review.operation.method==='GET'&&review.operation.expect.maxAtomic==='0'&&
  review.operation.expect.scheme==='exact'&&review.operation.expect.network==='stellar:testnet'&&
  review.operation.expect.asset===terms.paymentOptions[0].asset&&review.operation.expect.payTo===terms.paymentOptions[0].payTo&&
  review.responseFile.expectedSha256===resource.responseSha256&&review.responseFile.expectedBytes===resource.responseBytes&&
  review.responseFile.maxBytes===resource.responseBytes&&review.responseFile.expectedContentType==='text/plain'&&
  payer==='GBC5J6QTAU2OTX4FW4CBNK3QMKZUWKD45ZN2FB3XGAEZUG4H5IHVINKM',
  'The retained free-resource review changed');
const sf88=join(prefix,'sf88-operator-buyer-cli'),component=join(prefix,'sf30-seller-sdk/opencage');
const [{initializeWorkspace,openWorkspace},{Buyer},{examplePlan},{GeocodeDelivery},{GeocodeWorkspace}]=await Promise.all([
  imp(join(sf88,'workspace.mjs')),imp(join(sf88,'node/client.mjs')),imp(join(component,'config.mjs')),
  imp(join(component,'customer.mjs')),imp(join(component,'workspace.mjs'))]);
const directory=join(root,'buyer-operator'),setupPath=join(root,'operator-setup-input.json');
// The maintained initializer provisions a positive Governor policy. This setup
// operation is never executed. The actual application request retains maxAtomic 0.
const setup=structuredClone(review);
setup.operation.intentId=review.operation.intentId+'.operator-policy';
setup.operation.expect.maxAtomic='1';
setup.responseFile.destination=join(root,'operator-setup-response.json');
await atomic(setupPath,setup);
let original;
if(await exists(join(directory,'workspace.json')))original=await openWorkspace(['--dir',directory],{accounting:true});
else{
  const init=await initializeWorkspace(['--config',setupPath,'--dir',directory,
    '--actor','scf-opencage-a39c','--service','public-geocoding-result','--payer',payer,'--python',args.python,
    '--https-proxy-env','HTTPS_PROXY','--total-atomic','1','--daily-atomic','1'],
    {resume:await exists(directory)});
  await atomic(join(root,'buyer-initialization.json'),init);
  original=await openWorkspace(['--dir',directory],{accounting:true});
}
need(original.config.operation.intentId===setup.operation.intentId&&original.config.operation.expect.maxAtomic==='1'&&
  original.config.operation.url===review.operation.url&&original.manifest.signer.maxAtomic==='1',
  'The original retained operator policy changed');
const configuration={...original.config,operation:structuredClone(review.operation),
  captureBody:false,responseFile:structuredClone(review.responseFile)};
await atomic(join(root,'buyer-request-input.json'),configuration);
const buyer=new Buyer({runtimeDirectory:sf88,stateDirectory:join(root,'buyer-state'),
  environment:{...process.env,...original.operatorEnvironment}});
let operation=buyer.operation(review.operation.intentId);
if(!await exists(operation.directory))operation=await buyer.fromConfig(configuration);
const retainedConfiguration=await readJson(operation.configPath);
need(JSON.stringify(retainedConfiguration.operation)===JSON.stringify(review.operation)&&
  JSON.stringify(retainedConfiguration.operator)===JSON.stringify(original.config.operator)&&
  retainedConfiguration.signerModule===original.config.signerModule&&
  JSON.stringify(retainedConfiguration.buyerTransport)===JSON.stringify(original.config.buyerTransport),
  'The retained Buyer operation no longer uses the same operator and zero-limit request');
let result=await operation.recover();
if(result===null){
  const inspected=await operation.inspect();
  need(inspected.state==='PREPARED','Recover the original recorded Buyer attempt before continuing');
  const approved=await operation.review();
  await atomic(join(root,'buyer-review.json'),approved,{replace:true});
  result=await operation.execute({review:approved});
}
result.raiseForStatus();
const bytes=await result.bytes();
need(result.native.httpStatus===200&&sha(bytes)===resource.responseSha256&&bytes.length===resource.responseBytes,
  'The original Buyer returned different provider bytes');
const data=await result.json();need(data.total_results===1,'Original Buyer JSON changed');
const restarted=new Buyer({runtimeDirectory:sf88,stateDirectory:join(root,'buyer-state')});
const retained=restarted.operation(review.operation.intentId),recovered=await retained.recover();
need(recovered!==null,'Original Buyer result did not reopen');recovered.raiseForStatus();
const plan=examplePlan();plan.id='public-geocoding-result';
plan.products=[{...plan.products.find(product=>product.id==='reverse'),path:new URL(resource.url).pathname}];
const origin=new URL(resource.url).origin;
const delivery=await GeocodeDelivery.fromOperation(retained,{plan,productId:'reverse',publicOrigin:origin});
need(delivery.request.id===review.operation.intentId,'Original Buyer intent identity changed');
const deliveryDirectory=join(root,'buyer-delivery');
if(!await exists(join(deliveryDirectory,'manifest.json')))await delivery.export(deliveryDirectory);
const opened=await GeocodeDelivery.open(deliveryDirectory);
need(opened.bytes().equals(bytes)&&opened.identity===delivery.identity,'Original Buyer delivery did not reopen');
let workspace=await GeocodeWorkspace.open(join(root,'buyer-merchant-workspace'),{plan,terms});
let selectedMerchant,adoptedOutput;
try{
  const revisedTerms=structuredClone(terms);revisedTerms.publicOrigin=origin;revisedTerms.paymentOptions[0].amount='30000';
  const prepared=await workspace.package({terms:revisedTerms});
  const adopted=await workspace.adoptBuyer({id:'recovered-native-result',productId:'reverse',operation:retained,packageId:prepared.packageId});
  need(adopted.merchantSelection?.packageIdentity===prepared.manifest.identity&&
    adopted.merchantSelection.publicOrigin===origin&&adopted.merchantSelection.termsSha256===prepared.manifest.termsSha256&&
    adopted.merchantSelection.workspaceTermsSha256===workspace.configuration.termsSha256,
    'The original Buyer merchant selection changed');
  selectedMerchant=adopted.merchantSelection;
  adoptedOutput=await workspace.export({id:adopted.request.id,responseSha256:adopted.responseSha256,expectedRevision:0});
}finally{await workspace.close();}
workspace=await GeocodeWorkspace.open(join(root,'buyer-merchant-workspace'),{readOnly:true,env:{}});
try{
  const reopened=await workspace.get('recovered-native-result'),exported=await workspace.openExport(adoptedOutput.exportId);
  need(JSON.stringify(reopened.merchantSelection)===JSON.stringify(selectedMerchant)&&
    JSON.stringify(exported.delivery.provenance.merchantSelection)===JSON.stringify(selectedMerchant)&&
    exported.delivery.bytes().equals(bytes),'The reopened Buyer package or response changed');
}finally{await workspace.close();}
const complete={intentId:review.operation.intentId,httpStatus:result.native.httpStatus,responseSha256:sha(bytes),
  responseBytes:bytes.length,contentType:review.responseFile.expectedContentType,deliveryIdentity:delivery.identity,
  deliveryDirectory,recoveredIntentId:recovered.record.intentId,configSha256:recovered.record.configSha256,
  originalNativeResult:recovered.native.status,selectedMerchant,adoptedDelivery:adoptedOutput.directory,
  operationMaxAtomic:'0',operatorPolicyMaxAtomic:'1',
  originalOperatorConfigSha256:sha(await readFile(join(directory,'operator.json'))),inputs};
await atomic(join(root,'buyer-complete.json'),complete);
console.log(JSON.stringify({stage:'original-buyer-complete',intentId:complete.intentId,
  responseSha256:complete.responseSha256,httpStatus:complete.httpStatus,operationMaxAtomic:'0'}));
