import { readFile, open, lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
const root='/workspace/scratch/8f4370a17e6f/rail402-native-live';
const toolkit='/dev/shm/routescan-native-runtime-39da';
const source=join(toolkit,'stellar/scf-starforge-20261009');
const cli=join(source,'sf88-operator-buyer-cli/cli.mjs');
const python='/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const asset='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const payTo='GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP';
const routes={
  weather:{method:'GET',url:'https://demo.rail402.dev/weather?city=Ankara',amount:'10000',sourceSha256:'44de843d81cadec7dd57408397487f9ae69fb34f28aec89451257a37a75be645'},
  profile:{method:'GET',url:'https://demo.rail402.dev/users/42',amount:'10000',sourceSha256:'8d5a8453617ce1094e31691e48259bdfc2c87f32356886ce1af62a9f97ba5ac2'},
  translate:{method:'POST',url:'https://demo.rail402.dev/translate',amount:'20000',sourceSha256:'c5e86f7d72d455a522016c83e7fc3a40cd72109d61c50e314558a1b0b0e80f52'}
};
const pins={
  'sf88-operator-buyer-cli/cli.mjs':'50633fd39051da2e16caf3c1da42c5812434ea50',
  'sf88-operator-buyer-cli/workspace.mjs':'cae26863eb594f4c970d694d69de9de1a820f0ab',
  'sf88-operator-buyer-cli/native-signer.mjs':'d09e1262086efc9c017bc54f9392c954fb3ea230'
};
const need=(value,message)=>{if(!value)throw new Error(message);};
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function writeResult(path,record){
  const temporary=path+'.'+randomUUID()+'.tmp';let handle,owned=false;
  try{
    handle=await open(temporary,'wx',0o600);owned=true;
    await handle.writeFile(JSON.stringify(record,null,2)+'\n');await handle.sync();await handle.close();handle=undefined;
    await rename(temporary,path);
  }finally{
    if(handle)await handle.close().catch(()=>{});
    if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function original(args,environment){
  const child=spawn(process.execPath,args,{stdio:'inherit',shell:false,env:environment});
  let requested;
  const forward=signal=>{requested=signal;if(child.exitCode===null&&child.signalCode===null)child.kill(signal);};
  const interrupt=()=>forward('SIGINT'),terminate=()=>forward('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try{
    const outcome=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});
    const signal=outcome.signal||(outcome.code===0?requested:null);
    const code=signal?128+(osConstants.signals[signal]||0):outcome.code??1;
    if(code!==0){const error=new Error('The original command exited '+code+'; continue its same retained operation.');error.exitCode=code;throw error;}
    return code;
  }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
async function runtimePins(){
  for(const [path,sha]of Object.entries(pins)){
    const raw=await readFile(join(source,path));
    const actual=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
    need(actual===sha,'The original reviewed native source changed: '+path);
  }
}
async function context(routeName,privateAccount,funded){
  const spec=routes[routeName];need(spec,'Select an original Rail receiving route.');
  const packetDirectory=join(root,'packets','rail402-'+routeName+'-receiving');
  const directory=join(root,'operations',routeName);
  const packet=await readJSON(join(packetDirectory,'packet.json'));
  const raw=await readFile(join(packetDirectory,'source-http.json'));
  need(packet.privateDirectory===directory&&packet.actor==='rail402-receiver-8f43'&&
    packet.intentId==='rail402-'+routeName+'-receiving-20261012-8f43'&&packet.payer==='',
    'Preserve the original customer packet, actor and operation identity.');
  need(digest(raw)===spec.sourceSha256&&packet.sourceBundleSha256===spec.sourceSha256,'Preserve the actual original merchant HTTP source.');
  const originalSource=JSON.parse(raw);
  need(originalSource.seller===spec.url&&originalSource.method===spec.method,'Preserve the original request URL and method.');
  const reviewPath=join(directory,'request','review.json'),review=await readJSON(reviewPath),expect=review.operation.expect;
  need(review.operation.intentId===packet.intentId&&review.operation.url===spec.url&&review.operation.method===spec.method,
    'The original prepared native request differs.');
  need(expect.network==='stellar:testnet'&&expect.asset===asset&&expect.payTo===payTo&&expect.maxAtomic===spec.amount,
    'The original prepared payment terms differ.');
  need(funded.publicKey===privateAccount.publicKey&&funded.network==='stellar:testnet'&&funded.asset===asset&&funded.status==='RAIL402_TESTNET_BUYER_FUNDED',
    'Use the original funded testnet payer.');
  return {routeName,spec,packetDirectory,directory,packet,reviewPath,operator:join(directory,'operator'),runner:join(packetDirectory,'buyer.mjs'),
    result:join(directory,'paid-receiving-result.json')};
}
async function initialize(state,account,environment){
  const flags=['--config',state.reviewPath,'--dir',state.operator,'--actor',state.packet.actor,'--service','rail402-merchant','--payer',account.publicKey,'--python',python,'--secret-env','RAIL402_TESTNET_SECRET'];
  await original([state.runner,'inspect','--toolkit',toolkit,'--python',python],environment);
  if(!await exists(state.operator)) await original([cli,'--init-workspace',...flags],environment);
  else if(!await exists(join(state.operator,'workspace.json'))){
    const program="import{pathToFileURL}from'node:url';const{initializeWorkspace}=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify(await initializeWorkspace(process.argv.slice(2),{resume:true})));";
    await original(['--input-type=module','-e',program,join(source,'sf88-operator-buyer-cli/workspace.mjs'),...flags],environment);
  }
  const manifest=await readJSON(join(state.operator,'workspace.json'));
  need(manifest.payer===account.publicKey&&manifest.sourceConfig===state.reviewPath&&manifest.network==='stellar:testnet',
    'The original operator must retain the funded payer and customer request.');
  await original([cli,'--review-workspace','--dir',state.operator],environment);
  await original([cli,'--diagnose-workspace','--dir',state.operator],environment);
  console.log(JSON.stringify({status:'RAIL402_ORIGINAL_OPERATOR_READY',route:state.routeName,intentId:state.packet.intentId,publicKey:account.publicKey,operator:state.operator}));
}
async function result(state,account,environment){
  await original([state.runner,'result','--toolkit',toolkit,'--python',python],environment);
  await original([state.runner,'inspect','--toolkit',toolkit,'--python',python],environment);
  const received=await readJSON(join(state.directory,'request','merchant-view.json'));
  need(received.intentId===state.packet.intentId,'The received merchant response belongs to another operation.');
  const manifest=await readJSON(join(state.operator,'workspace.json'));
  const record={schema:'commons.rail402.original-paid-receiving.v1',status:'RAIL402_ORIGINAL_MERCHANT_RESULT_RECEIVED',completedAt:new Date().toISOString(),
    route:state.routeName,intentId:state.packet.intentId,publicKey:account.publicKey,network:'stellar:testnet',asset,payTo,maxAtomic:state.spec.amount,
    operator:state.operator,sourcePins:pins,operatorConfigSha256:digest(await readFile(join(state.operator,'operator.json'))),merchant:received};
  await writeResult(state.result,record);console.log(JSON.stringify(record));return record;
}
async function main(){
  const [action,routeName]=process.argv.slice(2);
  need(['prepare','execute','result'].includes(action)&&((action==='prepare'&&routeName==='all')||Object.hasOwn(routes,routeName)),
    'Use prepare all, execute weather|profile|translate, or result weather|profile|translate.');
  await runtimePins();
  const accountPath=join(root,'funding','testnet-account.json');
  const accountStat=await lstat(accountPath);need(accountStat.isFile()&&!(accountStat.mode&0o077),'Keep the original payer private.');
  const account=await readJSON(accountPath),funded=await readJSON(join(root,'funding','funding-result.json'));
  need(account.network==='stellar:testnet'&&/^G[A-Z2-7]{55}$/.test(account.publicKey),'Use the retained testnet payer.');
  const environment={...process.env,RAIL402_TESTNET_SECRET:account.secret,NODE_USE_ENV_PROXY:'1'};
  const selected=routeName==='all'?Object.keys(routes):[routeName];
  for(const name of selected){
    const state=await context(name,account,funded);
    if(action==='prepare'){await initialize(state,account,environment);continue;}
    if(action==='result'){await result(state,account,environment);continue;}
    if(!await exists(join(state.operator,'workspace.json')))await initialize(state,account,environment);
    else await original([state.runner,'inspect','--toolkit',toolkit,'--python',python],environment);
    if(await exists(join(state.directory,'request','merchant-result.json'))){await result(state,account,environment);continue;}
    need(process.stdin.isTTY,'Execute the original native buyer in its controlling terminal.');
    await original([cli,'--execute-workspace','--dir',state.operator],environment);
    await result(state,account,environment);
  }
}
main().catch(error=>{console.error(JSON.stringify({status:'RAIL402_ORIGINAL_RECEIVING_CONTINUES',message:error.message,exitCode:error.exitCode??1}));process.exitCode=error.exitCode??1;});
