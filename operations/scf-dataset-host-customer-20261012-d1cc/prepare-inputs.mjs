// Prepare this original customer from retained native inputs and the original SF30 generator.
// The generated seller offer is a NEW preparation input, not a historical merchant response.
import {constants} from 'node:fs';
import {readFile,open,mkdir,link,unlink,lstat,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const check=(ok,message)=>{if(!ok)throw Error(message)};
const closureFile=resolve(process.argv[2]);
const root=resolve(process.argv[3]??join(dirname(closureFile),'customer'));
const nativeRoot='/dev/shm/d1cc-scf-native-mcp-operation';
const originalResultPath=join(nativeRoot,'results.json');
const ORIGINAL_RESULT='9a6366454b7863ba6d231912d73046de4f4a2a86f36dc41a4784ec89ce658942';
const SOURCE_COMMIT='b1aff2c1228adf3f80222e3d6769d3ea89390f0d';
const WORKSPACE_SHA='8d92dd20251e67a277a2e6b69f0e2ee47e22fb9fd618367a1c9855af17ec6492';
const OPERATOR_SHA='f0ddfb160ae187455c9e889bf50619f815df3902cb6ddca97b34c8fd34228f69';
const POLICY_SHA='44a8f979fd96578a285a78f739e82be02f009b1de53e2fc0444f12d6a14f1ae6';
const DATASET_CONFIG_SHA='5bd350bf39c7d2198a1d905020a6824fc73a19b3cde9c19a5816eba400961e83';
const ENVIRONMENT_SHA='2944020f432767388c0cae11e7bc90a7e69d8ab46fa1088e2c16443a90316e8f';
const sameStamp=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
async function bytes(path,{limit=1048576,privateFile=false}={}){
 check(resolve(path)===path&&await realpath(path)===path,'An original input path changed');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await fd.stat({bigint:true});
  check(before.isFile()&&before.size<=BigInt(limit),'An original input is not a bounded regular file');
  if(privateFile)check((before.mode&0o077n)===0n&&
   (typeof process.getuid!=='function'||before.uid===BigInt(process.getuid())),'Private input ownership changed');
  const raw=await fd.readFile(),after=await fd.stat({bigint:true}),current=await lstat(path,{bigint:true});
  check(raw.length<=limit&&sameStamp(before,after)&&current.isFile()&&sameStamp(after,current),
   'An original input changed during reading');
  return raw;
 }finally{await fd.close()}
}
async function pinned(path,sha,options){
 const raw=await bytes(path,options);check(hash(raw)===sha,'An original input identity changed: '+path);return raw;
}
async function privateDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
 check(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&(info.mode&0o077)===0&&
  (typeof process.getuid!=='function'||info.uid===process.getuid()),'Customer input directory must remain private');
}
async function immutable(path,raw){
 try{check((await bytes(path,{limit:Math.max(raw.length,1),privateFile:true})).equals(raw),
  'A retained customer input differs: '+path);return;}
 catch(error){if(error.code!=='ENOENT')throw error}
 const temp=path+'.'+randomUUID()+'.tmp';let fd;
 try{
  fd=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await fd.writeFile(raw);await fd.sync();await fd.close();fd=null;
  try{await link(temp,path)}catch(error){if(error.code!=='EEXIST')throw error;
   check((await bytes(path,{limit:Math.max(raw.length,1),privateFile:true})).equals(raw),'Concurrent customer input differs');}
  const directory=await open(dirname(path),'r');try{await directory.sync()}finally{await directory.close()}
 }finally{await fd?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error})}
}

const closureRaw=await bytes(closureFile,{limit:4*1024*1024}),closure=JSON.parse(closureRaw);
check(closure.schema==='stellar-forge.dataset-host-source-closure.v1'&&closure.sourceCommit===SOURCE_COMMIT&&
 Array.isArray(closure.files),'The complete original selected source is required');
const sourceRoot=closure.sourceRoot,byPath=new Map(closure.files.map(row=>[row.path,row]));
async function moduleAt(relative){
 const path='stellar/scf-starforge-20261009/'+relative,entry=byPath.get(path);
 check(entry&&entry.bytes<=1048576,'Original module missing from the complete selection: '+path);
 const raw=await bytes(join(sourceRoot,path));check(raw.length===entry.bytes&&hash(raw)===entry.sha256,
  'Selected original module changed: '+path);
 return import(pathToFileURL(join(sourceRoot,path)).href);
}
const resultRaw=await pinned(originalResultPath,ORIGINAL_RESULT);
const completed=JSON.parse(resultRaw),original=completed.completedDataset;
check(completed.status==='COMPLETED'&&completed.complete.rows===6&&completed.payments===0,
 'The retained native customer is not the completed six-row free-response example');
const workspace=join(nativeRoot,'buyer');
await pinned(join(workspace,'workspace.json'),WORKSPACE_SHA,{privateFile:true});
await pinned(join(workspace,'operator.json'),OPERATOR_SHA,{privateFile:true});
const policy=JSON.parse(await pinned(join(workspace,'policy.json'),POLICY_SHA,{privateFile:true}));
const {openWorkspace}=await moduleAt('sf88-operator-buyer-cli/workspace.mjs');
const {config,manifest}=await openWorkspace(['--dir',workspace]); // Original read-only mode; no signer or journal keys.
const policyRows=policy.assets.filter(row=>row.network===manifest.network&&row.asset===manifest.signer.asset);
check(policyRows.length===1,'The original operator policy does not identify one asset');
const caps=policyRows[0],preset={
 schema:'stellar-forge.buyer-runbook-operator.v1',actor:config.operator.actor,service:config.operator.service,
 payer:manifest.payer,python:config.operator.python,
 maxTotalAtomic:caps.max_total,maxDailyAtomic:caps.max_per_utc_day,
 ...(manifest.signer.signerProvider?{signerProvider:manifest.signer.signerProvider}:
  {secretEnv:manifest.signer.secretEnv??manifest.walletKeyEnvironment}),
 rpc:manifest.signer.rpcUrl,
 ...(config.buyerTransport?{httpsProxyEnv:'SCF_DATASET_HOST_CUSTOMER_HTTPS_PROXY'}:{})
};
const {validateBuyerOperatorPreset}=await moduleAt('buyer-runbook/handoff-intake.mjs');
validateBuyerOperatorPreset(preset,{directory:join(root,'state/received')});
check(BigInt(preset.maxDailyAtomic)<=BigInt(preset.maxTotalAtomic),'The original daily policy exceeds its total policy');
const privateEnvironment=join(nativeRoot,'private-environment.json');
await pinned(privateEnvironment,ENVIRONMENT_SHA,{limit:16384,privateFile:true});

const datasetConfig=completed.source.configuration;
await pinned(datasetConfig,DATASET_CONFIG_SHA);
const {loadDatasetConfig}=await moduleAt('sf30-seller-sdk/dataset-handler.mjs');
const {buildDatasetSellerConfig}=await moduleAt('sf30-seller-sdk/dataset-cli.mjs');
const {compileHttpSellerOffer}=await moduleAt('sf30-seller-sdk/seller.mjs');
const dataset=await loadDatasetConfig(datasetConfig),description=dataset.describe();
check(description.snapshot===original.snapshot&&description.rowCount===6,
 'The original inventory source no longer matches its completed acquisition');
const definitionRaw=await bytes(join(original.session,'session.json'),{privateFile:true});
const definition=JSON.parse(definitionRaw),terms=definition.config.operation.expect;
check(definition.configurationSha256===original.configurationSha256&&
 definition.config.operation.intentId===original.sessionId,'The original acquisition definition changed');
check(['network','asset','payTo'].every(key=>terms[key]===manifest.signer[key]),
 'The original session and operator use different payment pins');
const resource=new URL(definition.config.operation.url);
// This is an explicit NEW configured seller price for future preparation, never a claim of a prior charge.
const configuredPrice={scheme:'exact',network:terms.network,asset:terms.asset,payTo:terms.payTo,
 amount:'1000',maxTimeoutSeconds:60};
check(BigInt(configuredPrice.amount)<=BigInt(caps.max_single)&&
 BigInt(configuredPrice.amount)<=BigInt(terms.maxAtomic),'The new configured example price exceeds the original caps');
const merchantConfig=await buildDatasetSellerConfig(dataset,{
 payment:configuredPrice,origin:resource.origin,path:resource.pathname});
const offers=merchantConfig.routes.map(route=>compileHttpSellerOffer({
 ...route.definition,url:merchantConfig.publicOrigin+route.path}));
const offersRaw=encode(offers),merchantRaw=encode(merchantConfig),presetRaw=encode(preset);
const {catalogChoices}=await moduleAt('sf88-operator-buyer-cli/dataset-workspace/receiving.mjs');
check(catalogChoices(offersRaw).some(row=>row.resource===resource.origin+resource.pathname&&
 ['network','asset','payTo','maxAtomic'].every(key=>row.terms[key]===terms[key])),
 'The generated original seller configuration does not prepare the intended example');
const deliveryFiles={};
for(const[name,file]of Object.entries(original.files)){
 check(join(original.room,name)===file.path,'The original delivered file path changed');
 await pinned(file.path,file.sha256,{limit:Math.max(file.bytes,1)});
 deliveryFiles[name]={bytes:file.bytes,sha256:file.sha256};
}
const generation={
 schema:'stellar-forge.dataset-host-seller-generation.v1',
 kind:'NEW_ORIGINAL_SF30_CONFIGURATION',sourceCommit:SOURCE_COMMIT,sourceClosureSha256:hash(closureRaw),
 originalDataset:{configuration:datasetConfig,configurationSha256:DATASET_CONFIG_SHA,
  csv:completed.source.csv,csvSha256:hash(await bytes(completed.source.csv)),snapshot:description.snapshot,rows:6},
 configuredPayment:configuredPrice,merchantConfigurationSha256:hash(merchantRaw),offersSha256:hash(offersRaw),
 originalAcquisition:{sessionId:original.sessionId,configurationSha256:original.configurationSha256,
  completedResultSha256:ORIGINAL_RESULT,payments:0},
 scope:'New seller offer generated for future host preparation from the retained original inventory source. The prior acquisition used free responses; this generation does not describe a captured offer, prior charge, new purchase, or provider observation.'
};
const input={
 schema:'stellar-forge.dataset-host-customer.v1',sourceClosure:closureFile,sourceClosureSha256:hash(closureRaw),
 sourceCommit:SOURCE_COMMIT,session:original.session,definitionSha256:hash(definitionRaw),
 nativeSessionId:original.sessionId,configurationSha256:original.configurationSha256,
 room:original.room,deliveryFiles,operatorSettings:join(root,'operator-settings.json'),
 operatorSettingsSha256:hash(presetRaw),offersFile:join(root,'offers.json'),offersSha256:hash(offersRaw),
 sellerGeneration:join(root,'merchant-generation.json'),sellerGenerationSha256:hash(encode(generation)),
 originalHostEnvironment:{path:privateEnvironment,sha256:ENVIRONMENT_SHA,payer:manifest.payer,
  secretEnv:manifest.signer.secretEnv??manifest.walletKeyEnvironment,
  operator:join(workspace,'operator.json'),operatorSha256:OPERATOR_SHA},
 stateDirectory:join(root,'state'),python:config.operator.python,
 analysisDirectory:'/workspace/scratch/d1ccf784531e/native-placement-7e820afe69a90b99fecabd71/run/database',
 analysisWorkspaceId:'5e7e814ca0a4464680168c079b0430bb',
 reportId:'b0b6a101c3a04d9a7bfb98e7c252ef5f',
 reportResultSha256:'a371fd49f307349ea952b3eb63647de9ff9eb39744eaa0f6f75dedab9e30bf75',
 chromium:'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',
 playwright:'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
};
await privateDirectory(root);
for(const[name,raw]of [['operator-settings.json',presetRaw],['merchant-config.json',merchantRaw],
 ['offers.json',offersRaw],['merchant-generation.json',encode(generation)],['inputs.json',encode(input)]]){
 await immutable(join(root,name),raw);
}
console.log(JSON.stringify({status:'ORIGINAL_CUSTOMER_INPUTS_PREPARED',inputs:join(root,'inputs.json'),
 inputSha256:hash(encode(input)),sourceCommit:SOURCE_COMMIT,sessionId:original.sessionId,
 snapshot:description.snapshot,rows:6,generatedOfferSha256:hash(offersRaw),generation:generation.kind,
 originalPayments:0,newAcquisitions:0,newProviderRequests:0}));
