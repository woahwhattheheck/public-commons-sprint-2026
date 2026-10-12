#!/usr/bin/env node
// Complete original ElementPay runtime/source/reconciliation/receiving operation.
// Uses original public deployment records; each native response is retained before interpretation.
import {promises as fs,createReadStream,createWriteStream} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const [packetArgument,directoryArgument,expectedPacketSha256,privateConfigurationArgument]=process.argv.slice(2);
if(!packetArgument||!directoryArgument||!/^[a-f0-9]{64}$/.test(expectedPacketSha256??''))
  throw new Error('Supply the complete source packet, private operation directory and exact packet SHA256.');
const directory=resolve(directoryArgument),sourceRoot=join(directory,'source'),workspaceDirectory=join(directory,'workspace');
const steps=join(directory,'steps'),P='stellar/scf-starforge-20261009/sf30-seller-sdk/invoice-settlement';
const sourceDirectory=join(sourceRoot,P),cli=join(sourceDirectory,'cli.mjs');
const digest=body=>createHash('sha256').update(body).digest('hex'),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const uuid=key=>{const h=digest('ELEMENTPAY-NATIVE-6BBB-20261012:'+directory+':'+key);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
const need=(value,message)=>{if(!value)throw new Error(message);};
const say=value=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
const err=value=>({name:value?.name??'Error',code:value?.code??null,message:String(value?.message??value),details:value?.details??null});
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function exists(path){try{return await fs.lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function retain(path,body,mode=0o600){
  const value=Buffer.isBuffer(body)?body:Buffer.from(body);await fs.mkdir(dirname(path),{recursive:true,mode:0o700});
  if(await exists(path)){need((await fs.readFile(path)).equals(value),'The original operation file differs: '+path);return;}
  const h=await fs.open(path,'wx',mode);try{await h.writeFile(value);await h.sync();}finally{await h.close();}
  const parent=await fs.open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
}
const save=(path,value)=>retain(path,json(value));
async function step(key,value){await save(join(steps,key+'.json'),value);return value;}
async function oldStep(key){const path=join(steps,key+'.json');return await exists(path)?JSON.parse(await fs.readFile(path,'utf8')):null;}
async function completeFile(source,destination,mode=0o600){
  await fs.mkdir(dirname(destination),{recursive:true,mode:0o700});
  if(await exists(destination)){const [a,b]=await Promise.all([fileDigest(source),fileDigest(destination)]);need(a.sha256===b.sha256&&a.bytes===b.bytes,'A completed transfer differs.');return;}
  await fs.copyFile(source,destination,1);await fs.chmod(destination,mode);
}
async function fileDigest(path){let bytes=0;const hash=createHash('sha256');for await(const chunk of createReadStream(path)){hash.update(chunk);bytes+=chunk.length;}return {bytes,sha256:hash.digest('hex')};}
await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.mkdir(steps,{recursive:true,mode:0o700});
const packetBody=await fs.readFile(resolve(packetArgument));need(digest(packetBody)===expectedPacketSha256,'The complete selected source packet differs.');
const packet=JSON.parse(packetBody);need(packet.schema==='stellar-forge.complete-source.v1'&&Array.isArray(packet.files)&&packet.files.length>=50,'Select the complete native application source cohort.');
let sourceBytes=0;
for(const file of packet.files){
  need(typeof file.path==='string'&&!isAbsolute(file.path)&&!file.path.split('/').some(part=>!part||part==='.'||part==='..'),'Invalid original source member path.');
  const body=Buffer.from(file.content,'utf8');need(body.length===file.bytes&&digest(body)===file.sha256,'The original source member differs: '+file.path);
  const mode=typeof file.mode==='number'?file.mode:(file.mode==='100755'?0o755:0o644);
  await retain(join(sourceRoot,file.path),body,mode);await fs.chmod(join(sourceRoot,file.path),mode);sourceBytes+=body.length;
}
await step('00-source',{schema:'stellar-forge.invoice-native-source.v1',packetSha256:expectedPacketSha256,files:packet.files.length,bytes:sourceBytes,node:process.version,sourceDirectory});
say({phase:'source',status:'COMPLETE',files:packet.files.length,bytes:sourceBytes,node:process.version});
const failures=[],servers=[],adapters=new Map();let host=null,browserDriver=null,fatalHandling=false,currentPhase='initializing';
const heartbeat=setInterval(()=>say({phase:currentPhase,status:'RUNNING'}),20000);heartbeat.unref();
process.once('uncaughtException',async error=>{
  if(fatalHandling)return;fatalHandling=true;clearInterval(heartbeat);
  const failure={schema:'stellar-forge.invoice-native-failure.v1',at:new Date().toISOString(),phase:currentPhase,error:err(error),packetSha256:expectedPacketSha256};
  try{await step('99-fatal',failure);}catch{}
  for(const server of servers)try{await closeServer(server);}catch{}
  try{await host?.close();}catch{}
  try{await browserDriver?.browser.close();}catch{}
  for(const adapter of adapters.values())try{await adapter.close?.();}catch{}
  say({phase:'fatal',status:'FAILED',failure});process.exitCode=1;
});
async function processCommand(key,executable,argv,{cwd=sourceRoot,environment={},maximumMs=600000,allowFailure=false}={}){
  const resultPath=join(steps,key,'result.json');
  if(await exists(resultPath)){const previous=JSON.parse(await fs.readFile(resultPath,'utf8'));if(!allowFailure)need(previous.code===0,'The retained native child failed: '+key);return previous;}
  const folder=join(steps,key);await fs.mkdir(folder,{recursive:true,mode:0o700});
  await save(join(folder,'command.json'),{executable,argv,cwd,environmentKeys:Object.keys(environment),node:process.version,sourcePacketSha256:expectedPacketSha256});
  const outFile=await fs.open(join(folder,'stdout.txt'),'wx',0o600),errFile=await fs.open(join(folder,'stderr.txt'),'wx',0o600);
  const child=spawn(executable,argv,{cwd,env:{...process.env,...environment},stdio:['ignore',outFile.fd,errFile.fd]});
  let ticker=setInterval(()=>say({phase:key,status:'RUNNING',pid:child.pid}),15000);ticker.unref();
  let timeout=setTimeout(()=>child.kill('SIGTERM'),maximumMs);timeout.unref();
  let outcome;
  try{outcome=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}));});}
  finally{clearInterval(ticker);clearTimeout(timeout);await outFile.sync();await errFile.sync();await outFile.close();await errFile.close();}
  const stdout=await fs.readFile(join(folder,'stdout.txt')),stderr=await fs.readFile(join(folder,'stderr.txt'));
  let value;try{value=JSON.parse(stdout);}catch{value={text:stdout.toString('utf8')};}
  const result={...outcome,value,stdout:{bytes:stdout.length,sha256:digest(stdout)},stderr:{bytes:stderr.length,sha256:digest(stderr)}};
  await save(resultPath,result);say({phase:key,status:outcome.code===0?'COMPLETE':'FAILED',exitCode:outcome.code,stdoutBytes:stdout.length,stderrBytes:stderr.length});
  if(!allowFailure)need(outcome.code===0,'The original native child '+key+' failed: '+stderr.toString('utf8').slice(-2500));
  return result;
}
async function cliCommand(key,command,args={},options={}){
  const argv=[options.cli??cli,command];
  if(!['help','methods','package-inspect','package-receive'].includes(command)&&!command.startsWith('runtime-'))
    argv.push('--workspace',options.workspace??workspaceDirectory,'--connections-file',options.connectionsFile??connectionsFile);
  if(Object.keys(args).length){const path=join(steps,key,'input.json');await save(path,args);argv.push('--input',path);}
  for(const [key,value] of Object.entries(options.flags??{}))argv.push('--'+key,String(value));
  return processCommand(key,process.execPath,argv,{cwd:options.cwd??sourceRoot,maximumMs:options.maximumMs});
}
async function mutate(key,method,args={}){
  currentPhase=key;
  const previous=await oldStep(key);if(previous)return previous;
  const intentPath=join(steps,key+'.intent.json');let selectedArgs;
  if(await exists(intentPath))selectedArgs=JSON.parse(await fs.readFile(intentPath,'utf8'));
  else{selectedArgs={...args,requestId:uuid(key),expectedRevision:(await host.describe()).revision};await save(intentPath,selectedArgs);}
  const result=await host.invoke({method,args:selectedArgs});await step(key,result);
  say({phase:key,status:'COMPLETE',revision:result.revision??null});return result;
}
async function attempt(key,work){
  try{return await work();}catch(error){const errorValue=err(error);failures.push({phase:key,error:errorValue});await step(key+'-failure',errorValue);say({phase:key,status:'FAILED',error:errorValue});return null;}
}
const listener=JSON.parse(await fs.readFile(join(sourceDirectory,'source','elementpay-listener.json'),'utf8'));
const flow=JSON.parse(await fs.readFile(join(sourceDirectory,'source','elementflow-contracts.json'),'utf8'));
const original=(capsule,path)=>{const file=capsule.files.find(item=>item.path===path);need(file,'The original publisher member is missing: '+path);need(digest(Buffer.from(file.content))===file.sha256,'The original publisher source hash differs.');return file.content;};
const dependencies=join(directory,'dependencies'),runtimeDirectory=join(directory,'runtime'),restoredRuntimeDirectory=join(directory,'restored-runtime');
await retain(join(dependencies,'package.json'),original(listener,'package.json'));
await retain(join(dependencies,'package-lock.json'),original(listener,'package-lock.json'));
const npm=process.platform==='win32'?'npm.cmd':'npm';
await processCommand('01-original-npm-ci',npm,['ci','--ignore-scripts','--no-audit','--no-fund'],{
  cwd:dependencies,environment:{npm_config_cache:join(directory,'npm-cache'),npm_config_update_notifier:'false'},maximumMs:600000});
const runtime=await import(pathToFileURL(join(sourceDirectory,'runtime.mjs')).href);
const retained=await runtime.retainInvoiceRuntime({directory:runtimeDirectory,installationDirectory:dependencies});
await step('02-runtime-retained',{id:retained.id,manifestSha256:retained.manifestSha256,directory:retained.directory,entrypoint:retained.entrypoint});
const verified=await runtime.verifyInvoiceRuntime({directory:runtimeDirectory,expectedManifestSha256:retained.manifestSha256});
need(verified.id===retained.id,'The original runtime changed after capture.');
const runtimeManifest=JSON.parse(await fs.readFile(join(runtimeDirectory,'manifest.json'),'utf8')),runtimeTransport=join(directory,'runtime-file-transport');
await completeFile(join(runtimeDirectory,'manifest.json'),join(runtimeTransport,'manifest.json'));
for(const file of runtimeManifest.files)await completeFile(join(runtimeDirectory,file.path),join(runtimeTransport,file.path),file.mode);
const restored=await runtime.restoreInvoiceRuntime({sourceDirectory:runtimeTransport,destination:restoredRuntimeDirectory,expectedManifestSha256:retained.manifestSha256});
need(restored.id===retained.id&&restored.manifestSha256===retained.manifestSha256,'Independent runtime source reconstruction changed identity.');
const loaded=await runtime.loadInvoiceEthers({runtimeDirectory:restored.directory,expectedManifestSha256:restored.manifestSha256});
need(loaded.ethers.version==='6.13.5','The original ethers runtime version differs.');
await step('03-runtime-restored',{id:restored.id,manifestSha256:restored.manifestSha256,directory:restored.directory,version:loaded.ethers.version,files:runtimeManifest.files.length,links:runtimeManifest.links?.length??0,packages:runtimeManifest.packages?.length??null});
say({phase:'runtime',status:'COMPLETE',id:restored.id,files:runtimeManifest.files.length,version:loaded.ethers.version});
const native=await import(pathToFileURL(join(sourceDirectory,'native.mjs')).href);
const events=await import(pathToFileURL(join(sourceDirectory,'events.mjs')).href);
const operator=await import(pathToFileURL(join(sourceDirectory,'operator.mjs')).href);
const receiver=await import(pathToFileURL(join(sourceDirectory,'receiving.mjs')).href);
const archive=await import(pathToFileURL(join(sourceDirectory,'archive.mjs')).href);
const boundRuntime={runtimeDirectory:runtimeDirectory,expectedManifestSha256:retained.manifestSha256};
const profile={name:'ElementPay original source operation',organization:'Native product operation',purpose:'Retained public contract source, exact original payment observations and independent receiving'};
const connections={
  'base-sepolia':{provider:'evm',baseUrl:'https://sepolia.base.org',chainId:'84532',contract:'0x5cB2B2b5f8E373bb9c44Cbc190FF103d2bd11716',eventProfile:'all',runtime:boundRuntime,timeoutMs:20000},
  'base-mainnet':{provider:'evm',baseUrl:'https://mainnet.base.org',chainId:'8453',contract:'0x55f2761afdD2bfBeDeE19D0439d686302CD2b150',eventProfile:'all',runtime:boundRuntime,timeoutMs:20000},
  'listener-base-sepolia':{provider:'listener-backend',baseUrl:'http://localhost:8000',allowHttp:true,network:'eip155:84532',accountScope:'native-source-operation'},
  'listener-base-mainnet':{provider:'listener-backend',baseUrl:'http://localhost:8000',allowHttp:true,network:'eip155:8453',accountScope:'native-source-operation'}
};
const privateInput=privateConfigurationArgument?JSON.parse(await fs.readFile(resolve(privateConfigurationArgument),'utf8')):{};
if(privateInput.connections)for(const [alias,value] of Object.entries(privateInput.connections)){
  need(!Object.hasOwn(connections,alias),'A private connection must have its own explicit alias.');
  connections[alias]=value;
}
const connectionsFile=join(directory,'private-connections.json');
await save(connectionsFile,connections);await save(join(directory,'profile.json'),profile);
const topicSelection=await events.invoiceEventTopics({runtime:boundRuntime,eventProfile:'all'});
need(topicSelection.topics.length===5,'The two original event versions should retain five unique lifecycle topics.');
await step('04-original-event-topics',topicSelection);
await cliCommand('05-cli-help','help');
await cliCommand('06-cli-methods','methods');
host=await operator.openInvoiceSettlementOperator({workspaceDirectory,connections,profile,applicationDirectory:sourceDirectory});
await step('07-initial-state',await host.describe());
await step('08-source-catalog',await host.invoke({method:'source.catalog',args:{}}));
const initialDefinition=privateInput.programme??{name:'Original ElementPay contract observations',merchantId:'native-source-operation',
  networks:['eip155:84532','eip155:8453'],assets:[],invoices:[],
  rules:{allowSettledUnverified:false,requireSuccessfulChainTransaction:true,minimumConfirmations:1}};
const initialProgramme=await mutate('09-programme','programme.save',{definition:initialDefinition});
const programmeId=initialProgramme.programmeId;
for(const [key,path] of [['listener','source/elementpay-listener.json'],['contracts','source/elementpay-contracts.json'],['elementflow','source/elementflow-contracts.json']]){
  const body=await fs.readFile(join(sourceDirectory,path));
  await mutate('10-original-'+key,'source.import',{programmeId,provider:'document',kind:'publisher-source',label:path,
    filename:path.split('/').at(-1),bodyBase64:body.toString('base64'),contentType:'application/json'});
}
async function readOriginal(key,alias,read){
  currentPhase=key;
  const previous=await oldStep(key);if(previous)return previous;
  let adapter=adapters.get(alias);if(!adapter){adapter=native.openInvoiceSource(connections[alias]);adapters.set(alias,adapter);}
  const value=await adapter.read(read),folder=join(steps,key);
  need(Buffer.isBuffer(value.response?.body),'The native read did not preserve its original response body.');
  await retain(join(folder,'response.body'),value.response.body);
  await save(join(folder,'native.json'),{request:value.request,response:{...value.response,body:undefined},continuation:value.continuation,error:value.error??null,runtime:value.runtime??null});
  const imported=await mutate(key+'-import','source.import',{programmeId,connectionAlias:alias,provider:connections[alias].provider,kind:read.kind,
    network:adapter.describe().network,sourceScope:adapter.describe().id,request:value.request,recordsPath:value.recordsPath,
    bodyBase64:value.response.body.toString('base64'),filename:read.kind+'.json',status:value.response.status,contentType:'application/json',label:key});
  const originalSource=await host.invoke({method:'source.read',args:{sourceId:imported.sourceId}});
  const result={sourceId:imported.sourceId,request:value.request,status:value.response.status,error:value.error??null,
    bodySha256:digest(value.response.body),bytes:value.response.body.length,value:value.value,records:originalSource.records,source:originalSource.source};
  await step(key,result);say({phase:key,status:value.error?'NATIVE_ERROR':'COMPLETE',sourceId:imported.sourceId,records:result.records.length,bytes:result.bytes});
  if(value.error)throw Object.assign(new Error(value.error.message??'The original native read failed.'),value.error);
  return result;
}
async function capture(key,alias,read){
  const parts=[],records=[],originalRead=JSON.parse(JSON.stringify(read));let selected=read,part=0;
  for(;;){
    const suffix=part?'-provider-span-'+selected.pageSize:'',partKey=key+suffix;
    const begun=await mutate(partKey+'-start','capture.start',{programmeId,connectionAlias:alias,read:selected,name:key});
    let run=await mutate(partKey+'-run','capture.run',{captureId:begun.captureId});
    let current=(await host.describe()).captures[begun.captureId],retries=0;
    need(current,'The retained native capture disappeared.');
    while(current.status==='FAILED'){
      const last=current.attempts.at(-1),source=last?.sourceId?await host.invoke({method:'source.read',args:{sourceId:last.sourceId}}):null;
      const response=source?JSON.parse(await fs.readFile(join(workspaceDirectory,source.source.responseFile.path),'utf8')):null;
      const retry=response?.headers?.['retry-after'];let retryMs=null;
      if(typeof retry==='string')retryMs=/^\d+$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now());
      if(last?.responseStatus===429&&Number.isFinite(retryMs)&&retryMs>=0&&retries<3){
        await step(partKey+'-provider-wait-'+retries,{sourceId:last.sourceId,originalRetryAfter:retry,retryMs,originalRun:current.run.args});
        say({phase:partKey,status:'PROVIDER_RETRY_AFTER',retryMs});
        await delay(retryMs);await mutate(partKey+'-provider-resume-'+retries,'capture.resume',{captureId:current.id});
        run=await host.invoke({method:'capture.run',args:current.run.args});
        await save(join(steps,partKey+'-run-responses',digest(json(run))+'.json'),run);
        current=(await host.describe()).captures[current.id];retries++;continue;
      }
      break;
    }
    parts.push({captureId:current.id,sources:current.sources,read:selected,status:current.status});
    for(const sourceId of current.sources){const source=await host.invoke({method:'source.read',args:{sourceId}});records.push(...source.records);}
    if(current.status==='COMPLETE')return {captureId:current.id,capture:current,records,run,parts};
    const last=current.attempts.at(-1),native=last?.sourceId?await host.invoke({method:'source.read',args:{sourceId:last.sourceId}}):null;
    const originalBody=native?await fs.readFile(join(workspaceDirectory,native.source.bodyFile.path),'utf8'):'';
    const originalError=JSON.stringify(current.lastError??{})+'\n'+originalBody;
    const rangeLimited=/block.{0,70}(?:range|limit)|(?:range|limit).{0,70}block|query returned more than|response size exceeded|too many results/i.test(originalError);
    const priorSpan=selected.pageSize??10000;
    if(read.kind==='logs'&&rangeLimited&&priorSpan>1){
      const stated=[...originalError.matchAll(/(?:at most|max(?:imum)?(?: of)?|limit(?:ed)? to|up to)\s*([0-9,]+)\s*blocks?/ig)]
        .map(match=>Number(match[1].replaceAll(',',''))).filter(value=>Number.isSafeInteger(value)&&value>0&&value<priorSpan);
      const pageSize=stated.length?Math.min(...stated):Math.max(1,Math.floor(priorSpan/2));
      const next=current.nextRead??last?.read??selected;
      need(next.kind==='logs'&&JSON.stringify(next.filters)===JSON.stringify(originalRead.filters),'The provider-range recovery changed the original selected block interval.');
      await step(key+'-provider-range-'+part,{originalRead,sourceId:last?.sourceId??null,captureId:current.id,
        originalError:current.lastError,bodySha256:native?.source.bodyFile.sha256??null,originalPageSize:priorSpan,pageSize,cursor:next.cursor??null});
      selected={...next,pageSize};part++;continue;
    }
    throw Object.assign(new Error('The retained complete capture requires its original native continuation.'),{code:'NATIVE_CAPTURE_INCOMPLETE',details:{captureId:current.id,status:current.status,error:current.lastError,originalRead,parts}});
  }
}
const summaries=[],observedTokens=new Map(),allEvents=[],deploymentReceipts=[];
const readCallInterface=new loaded.ethers.Interface(['function getVersion() view returns (string)','function decimals() view returns (uint8)','function symbol() view returns (string)']);
const implementationSlot=loaded.ethers.toBeHex(BigInt(loaded.ethers.id('eip1967.proxy.implementation'))-1n,32);
for(const alias of ['base-sepolia','base-mainnet']){
  await attempt('chain-journey-'+alias,async()=>{
    const chain=await readOriginal(alias+'-chain',alias,{kind:'chain'});
    const head=await readOriginal(alias+'-head',alias,{kind:'head'});
    const headNumber=BigInt(head.value.result),network='eip155:'+BigInt(chain.value.result).toString();
    need(network==='eip155:'+connections[alias].chainId,'The original selected RPC network differs.');
    const selectedBlock=await readOriginal(alias+'-head-block',alias,{kind:'block',filters:{blockNumber:headNumber.toString(),fullTransactions:false}});
    const address=connections[alias].contract,code=await readOriginal(alias+'-proxy-code',alias,{kind:'code',filters:{address,blockNumber:headNumber.toString()}});
    const storage=await readOriginal(alias+'-proxy-storage',alias,{kind:'storage',filters:{address,position:implementationSlot,blockNumber:headNumber.toString()}});
    need(code.value.result!=='0x','The published proxy has no code at the selected original chain head.');
    const implementation='0x'+storage.value.result.slice(-40);
    const implementationCode=await readOriginal(alias+'-implementation-code',alias,{kind:'code',filters:{address:implementation,blockNumber:headNumber.toString()}});
    const versionRead=await attempt(alias+'-version-read',()=>readOriginal(alias+'-version',alias,{kind:'call',filters:{address,data:readCallInterface.encodeFunctionData('getVersion'),blockNumber:headNumber.toString()}}));
    let version=null;if(versionRead)version=readCallInterface.decodeFunctionResult('getVersion',versionRead.value.result)[0];
    const manifestPath=alias==='base-sepolia'?'.openzeppelin/base-sepolia.json':'.openzeppelin/base.json';
    const published=JSON.parse(original(flow,manifestPath)),proxy=published.proxies.find(item=>item.address.toLowerCase()===address.toLowerCase());
    need(proxy?.txHash,'The original proxy deployment transaction is absent.');
    const birth=await readOriginal(alias+'-proxy-deployment',alias,{kind:'receipt',filters:{transactionHash:proxy.txHash}});
    let fromBlock,throughBlock=headNumber,strategy;
    if(birth.value.result?.blockNumber){fromBlock=BigInt(birth.value.result.blockNumber);strategy='complete-original-proxy-deployment-to-frozen-head';deploymentReceipts.push(birth.sourceId);}
    else{
      const transaction=await readOriginal(alias+'-proxy-deployment-transaction',alias,{kind:'transaction',filters:{transactionHash:proxy.txHash}});
      fromBlock=transaction.value.result?.blockNumber?BigInt(transaction.value.result.blockNumber):0n;
      strategy=fromBlock>0n?'complete-original-deployment-transaction-to-frozen-head':'complete-chain-history-to-frozen-head';
    }
    need(fromBlock<=throughBlock,'The published deployment lies after the original frozen native head.');
    const selected=await capture(alias+'-complete-history',alias,{kind:'logs',filters:{fromBlock:fromBlock.toString(),throughBlock:throughBlock.toString()},pageSize:10000});
    const lifecycle=selected.records.filter(record=>['OrderCreated','OrderSettled','OrderRefunded'].includes(record.projection?.event));
    allEvents.push(...lifecycle);
    for(const record of lifecycle){const token=record.projection.token;if(token)observedTokens.set(network+':'+token.toLowerCase(),{alias,network,contract:token,blockNumber:record.projection.blockNumber});}
    summaries.push({alias,network,head:headNumber.toString(),headSourceId:head.sourceId,headBlockSourceId:selectedBlock.sourceId,
      contract:address,codeSourceId:code.sourceId,implementation,implementationCodeSourceId:implementationCode.sourceId,
      storageSourceId:storage.sourceId,version,versionSourceId:versionRead?.sourceId??null,
      deployment:{sourcePath:manifestPath,transactionHash:proxy.txHash,sourceId:birth.sourceId},
      selection:{fromBlock:fromBlock.toString(),throughBlock:throughBlock.toString(),strategy},
      captures:Object.values((await host.describe()).captures).filter(row=>row.connectionAlias===alias).map(row=>({id:row.id,status:row.status,sources:row.sources})),
      eventCount:lifecycle.length});
  });
}
await step('20-native-contract-observations',{sources:summaries});
const baseline=await mutate('21-before-receipt-reconciliation','reconciliation.create',{programmeId,name:'Original lifecycle source before transaction reconciliation'});
const uniqueTransactions=new Map(),uniqueBlocks=new Map();
for(const record of allEvents){
  const alias=record.network==='eip155:84532'?'base-sepolia':'base-mainnet';
  uniqueTransactions.set(record.network+':'+record.projection.transactionHash,{alias,hash:record.projection.transactionHash});
  uniqueBlocks.set(record.network+':'+record.projection.blockNumber,{alias,number:record.projection.blockNumber});
}
for(const {alias,hash} of uniqueTransactions.values())await attempt('receipt-'+alias+'-'+hash.slice(2),()=>readOriginal('receipt-'+alias+'-'+hash.slice(2),alias,{kind:'receipt',filters:{transactionHash:hash}}));
for(const {alias,number} of uniqueBlocks.values())await attempt('block-'+alias+'-'+number,()=>readOriginal('block-'+alias+'-'+number,alias,{kind:'block',filters:{blockNumber:number,fullTransactions:false}}));
const assets=[];
for(const token of observedTokens.values()){
  await attempt('token-'+token.alias+'-'+token.contract.toLowerCase(),async()=>{
    const key=token.alias+'-'+token.contract.toLowerCase();
    const decimal=await readOriginal('decimals-'+key,token.alias,{kind:'call',filters:{address:token.contract,blockNumber:token.blockNumber,data:readCallInterface.encodeFunctionData('decimals')}});
    const decimals=Number(readCallInterface.decodeFunctionResult('decimals',decimal.value.result)[0]);
    const symbol=await attempt('symbol-'+key,()=>readOriginal('symbol-'+key,token.alias,{kind:'call',filters:{address:token.contract,blockNumber:token.blockNumber,data:readCallInterface.encodeFunctionData('symbol')}}));
    let code=token.contract.toLowerCase();if(symbol)try{code=readCallInterface.decodeFunctionResult('symbol',symbol.value.result)[0];}catch{}
    const asset={id:'token-'+token.alias+'-'+token.contract.toLowerCase(),network:token.network,type:'evm',code,contract:token.contract,decimals};
    assets.push(asset);await step('asset-'+key,{asset,decimalsSourceId:decimal.sourceId,symbolSourceId:symbol?.sourceId??null});
  });
}
if(!privateInput.programme&&assets.length){
  const invoices=[],bindings=[],seen=new Set(),assetByNative=new Map(assets.map(asset=>[asset.network+':'+asset.contract.toLowerCase(),asset]));
  for(const record of allEvents.filter(row=>row.projection.event==='OrderCreated'&&!row.projection.removed)){
    const p=record.projection,scope=record.network+':'+p.contract.toLowerCase()+':'+p.orderId;
    if(seen.has(scope))continue;seen.add(scope);
    const asset=assetByNative.get(record.network+':'+p.token.toLowerCase());if(!asset)continue;
    const related=allEvents.filter(row=>row.network===record.network&&row.projection.contract.toLowerCase()===p.contract.toLowerCase()&&row.projection.orderId===p.orderId&&!row.projection.removed);
    const settled=related.filter(row=>row.projection.event==='OrderSettled'&&row.projection.netAmount!==undefined);
    const net=settled.length===1?settled[0].projection.netAmount:p.amount;
    const id='onchain-order-'+record.network.slice(7)+'-'+p.contract.slice(2).toLowerCase()+'-'+p.orderId.slice(2);
    const invoice={id,partnerId:'contract:'+record.network+':'+p.contract.toLowerCase(),customerId:p.requester.toLowerCase(),
      assetId:asset.id,amount:loaded.ethers.formatUnits(BigInt(p.amount),asset.decimals),orderIds:[p.orderId],
      references:[p.transactionHash,...(p.messageHash?[p.messageHash]:[])],
      settlementAssetId:asset.id,settlementAmount:loaded.ethers.formatUnits(BigInt(net),asset.decimals)};
    invoices.push(invoice);bindings.push({invoiceId:id,sourceRecordId:record.id,sourceId:record.sourceId,
      originalOrderId:p.orderId,originalGrossUnits:p.amount,originalNetUnits:net,
      settlementRecordId:settled.length===1?settled[0].id:null,assetId:asset.id,decimals:asset.decimals,
      purpose:'Internal original on-chain order obligation; amounts and counterparties derive from the retained native contract records.'});
  }
  await step('22-native-invoice-source-bindings',{invoices:bindings});
  await mutate('22-observed-assets-programme','programme.save',{programmeId,expectedVersion:1,
    definition:{...initialDefinition,name:'Original on-chain order obligations',assets,invoices}});
}
const following=await mutate('23-reconciled-native-transactions','reconciliation.create',{programmeId,name:'Original receipts, token precision and contract source reconciliation'});
await step('24-edition',await host.invoke({method:'edition.read',args:{reconciliationId:following.reconciliationId}}));
await step('25-reconciliation-change',await host.invoke({method:'reconciliation.compare',args:{leftId:baseline.reconciliationId,rightId:following.reconciliationId}}));
if(allEvents.length){
  const selected=allEvents[0];
  const excluded=await mutate('26-review-exclude','decision.save',{programmeId,recordId:selected.id,action:'exclude',actor:'Native source operator',reason:'Reviewing this retained original event against its transaction receipt.'});
  const excludedEdition=await mutate('27-review-reconciliation','reconciliation.create',{programmeId,name:'Retained original-event review selection'});
  await mutate('28-review-restore','decision.save',{programmeId,recordId:selected.id,action:'include',supersedes:excluded.decisionId,actor:'Native source operator',reason:'Completed review; include the same original event and preserve the earlier review decision.'});
  await step('29-review-change',await host.invoke({method:'reconciliation.compare',args:{leftId:following.reconciliationId,rightId:excludedEdition.reconciliationId}}));
}
const finalEdition=await mutate('30-final-reconciliation','reconciliation.create',{programmeId,name:'Complete original-source reconciliation'});
const report=await mutate('31-complete-report','report.create',{reconciliationId:finalEdition.reconciliationId,formats:['html','json','csv']});
const nativeReport=await host.invoke({method:'report.read',args:{reportId:report.reportId}});
await step('32-report-members',nativeReport);
for(const format of ['html','json','csv']){
  let offset=0;const member=nativeReport.files.find(item=>item.format===format),target=join(directory,'reports',member.filename);
  await fs.mkdir(dirname(target),{recursive:true,mode:0o700});
  if(!await exists(target)){
    const output=await fs.open(target,'wx',0o600);
    try{for(;;){const range=await host.invoke({method:'report.file',args:{reportId:report.reportId,format,offset,length:4*1024*1024}});
      const body=Buffer.from(range.base64,'base64');need(body.length===range.bytes&&range.offset===offset,'The original report range differs.');await output.writeFile(body);offset+=body.length;if(range.eof)break;need(body.length>0,'The original report range did not advance.');}
      await output.sync();}finally{await output.close();}
  }
  const file=await fileDigest(target);need(file.bytes===member.bytes&&file.sha256===member.sha256,'The complete original report differs.');
}
for(const [alias,connection] of Object.entries(connections).filter(([,row])=>row.provider==='listener-backend')){
  const backend=native.describeListenerBackend(connection);
  const sourceIds=[...new Set(allEvents.filter(record=>record.network===backend.network).map(record=>record.sourceId))];
  const prepared=await mutate('33-prepare-'+alias,'delivery.prepare',{programmeId,connectionAlias:alias,sourceIds});
  await step('33-preparation-scope-'+alias,{backend,sourceIds,result:prepared,
    publishedExample:alias.startsWith('listener-base-')?'Original listener FASTAPI_BASE_URL=http://localhost:8000':null});
}
// The original localhost example supplies a concrete forwarding target for preparation.
// A send uses the separately selected private connection and explicit operation below.
if(privateInput.dispatch===true){
  need(typeof privateInput.dispatchConnectionAlias==='string'&&connections[privateInput.dispatchConnectionAlias]?.provider==='listener-backend','Select the original configured backend for explicit delivery.');
  await mutate('34-selected-original-listener-run','delivery.run',{programmeId,connectionAlias:privateInput.dispatchConnectionAlias});
}
const browserBefore=await host.describe();
const originalBrowserServer=await startServer('browser-source-server',cli,workspaceDirectory,browserBefore.workspaceId,connectionsFile);
try{await attempt('browser-original-native',()=>browserJourney('browser-original-native',originalBrowserServer,{recoverOriginalRequests:true}));}
finally{await closeServer(originalBrowserServer);}
const fullExportDirectory=join(directory,'full-delivery');
const exported=await mutate('35-complete-workspace-export','workspace.export',{destination:fullExportDirectory,includeApplication:true});
const inspected=await receiver.inspectInvoiceDelivery({sourceDirectory:fullExportDirectory});
await step('36-original-package',{manifestSha256:inspected.manifestSha256,manifest:inspected.manifest});
const manifestSha256=inspected.manifestSha256;
const archivePath=join(directory,'invoice-complete.tar.gz');
if(!await exists(archivePath)){
  const stream=await archive.streamInvoiceDelivery({sourceDirectory:fullExportDirectory,expectedManifestSha256:manifestSha256});
  await pipeline(Readable.from(stream),createWriteStream(archivePath,{flags:'wx',mode:0o600}));
}
await step('37-complete-archive',await fileDigest(archivePath));
const unpackDirectory=join(directory,'unpacked-delivery');
await archive.unpackInvoiceDelivery({input:createReadStream(archivePath),destination:unpackDirectory,expectedManifestSha256:manifestSha256});
const inspectedUnpack=await receiver.inspectInvoiceDelivery({sourceDirectory:unpackDirectory,expectedManifestSha256:manifestSha256});
need(inspectedUnpack.manifestSha256===manifestSha256,'The original complete archive changed its manifest.');
const received=await receiver.receiveInvoiceDelivery({sourceDirectory:unpackDirectory,destination:join(directory,'received-client'),requestId:uuid('receive-client'),expectedManifestSha256:manifestSha256});
await step('38-independent-receiving',received);
const replay=await receiver.receiveInvoiceDelivery({sourceDirectory:unpackDirectory,destination:join(directory,'received-client'),requestId:uuid('receive-client'),expectedManifestSha256:manifestSha256});
need(replay.replayed===true,'The complete receiving replay did not recover its original result.');
const receivedConnections=JSON.parse(JSON.stringify(connections));
for(const configuration of Object.values(receivedConnections))if(configuration.provider==='evm'){
  const originalId=configuration.runtime?.expectedManifestSha256;
  const selected=received.runtimes.find(item=>item.manifestSha256===originalId);
  need(selected,'The original received EVM runtime is absent.');
  configuration.runtime={runtimeDirectory:selected.directory,expectedManifestSha256:selected.manifestSha256};
}
const receivedConnectionsFile=join(directory,'received-private-connections.json');await save(receivedConnectionsFile,receivedConnections);
const originalState=await host.describe();await host.close();host=null;
await cliCommand('39-original-cli-state','state');
await cliCommand('40-received-cli-help','help',{}, {cli:received.application.cli,cwd:received.application.directory});
await cliCommand('41-received-cli-state','state',{}, {cli:received.application.cli,cwd:received.application.directory,workspace:received.workspace.directory,connectionsFile:receivedConnectionsFile});
const receivedOperatorModule=await import(pathToFileURL(join(dirname(received.application.cli),'operator.mjs')).href);
const receivedHost=await receivedOperatorModule.openInvoiceSettlementOperator({workspaceDirectory:received.workspace.directory,connections:receivedConnections,expectedWorkspaceId:received.workspace.workspaceId});
try{
  const receivedState=await receivedHost.describe();need(Object.keys(receivedState.sources).length===Object.keys(originalState.sources).length,'Receiving lost retained original sources.');
  const sameEdition=await receivedHost.invoke({method:'edition.read',args:{reconciliationId:finalEdition.reconciliationId}});
  // The final edition includes the original completed review history; its received bytes are selected by ID.
  need(sameEdition.id===finalEdition.reconciliationId,'The received original reconciliation identity differs.');
  await step('42-received-edition',sameEdition);
  if(allEvents.length){
    const first=allEvents[0],entry=receivedState.sources[first.sourceId];
    const receivedSource=await receivedHost.invoke({method:'source.read',args:{sourceId:first.sourceId}});
    need(receivedSource.records.some(record=>record.id===first.id&&record.sha256===first.sha256),'The received original event differs.');
    const receivedEvents=await import(pathToFileURL(join(dirname(received.application.cli),'events.mjs')).href);
    const runtimeSelection=receivedConnections[first.network==='eip155:84532'?'base-sepolia':'base-mainnet'].runtime;
    const decoded=await receivedEvents.decodeInvoiceLog(first.original,{runtime:runtimeSelection,network:first.network,chainId:first.network.slice(7)});
    need(decoded.sourceOccurrenceKey===first.projection.sourceOccurrenceKey,'Independent original runtime event reconstruction differs.');
    await step('43-received-native-decode',{sourceId:first.sourceId,recordId:first.id,sourceBodySha256:entry.bodyFile.sha256,decoded});
  }
}finally{await receivedHost.close();}
async function startServer(key,entry,workspace,workspaceId,connectionPath){
  const argv=[entry,'serve','--workspace',workspace,'--connections-file',connectionPath,'--expected-workspace-id',workspaceId,'--port','0','--startup-format','json'];
  const child=spawn(process.execPath,argv,{cwd:dirname(entry),stdio:['ignore','pipe','pipe']});
  const out=[],error=[];let buffer='',startup;
  child.stderr.on('data',chunk=>error.push(Buffer.from(chunk)));
  const ready=new Promise((done,reject)=>{
    child.stdout.on('data',chunk=>{out.push(Buffer.from(chunk));buffer+=chunk.toString('utf8');for(;;){const nl=buffer.indexOf('\n');if(nl<0)break;const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);if(!line)continue;
      try{const value=JSON.parse(line);if(value.status==='INVOICE_SETTLEMENT_READY'){startup=value;done(value);}}catch{}}});
    child.once('error',reject);child.once('exit',(code,signal)=>{if(!startup)reject(new Error('The original operator exited before ready: '+JSON.stringify({code,signal})+' '+Buffer.concat(error).toString('utf8').slice(-2000)));});
  });
  const timer=setTimeout(()=>child.kill('SIGTERM'),45000);timer.unref();try{await ready;}finally{clearTimeout(timer);}
  need(startup.workspaceId===workspaceId&&startup.pid===child.pid,'The actual server process selected another workspace.');
  const url=new URL(startup.url),token=new URLSearchParams(url.hash.slice(1)).get('token');
  need(token&&/^[A-Za-z0-9_-]{43}$/.test(token),'The original server startup token differs.');
  const scope={child,startup,origin:url.origin,token,out,error,key};
  servers.push(scope);await step(key,{...startup,url:url.origin+'/#token=[private]'});return scope;
}

async function openOriginalBrowser(){
  if(browserDriver)return browserDriver;
  const require=createRequire(import.meta.url),names=['playwright','@playwright/test','playwright-core'],candidates=[...names];
  for(const root of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,...String(process.env.NODE_PATH??'').split(':')].filter(Boolean))
    for(const name of names)candidates.push(join(root,name));
  const resolutions=[];let module,selected;
  // The original Python Playwright distribution includes its maintained Node driver.
  // Read that installed location when the host exposes Python rather than Node aliases.
  for(const executable of [...new Set([process.env.CODEX_PRIMARY_RUNTIME_PYTHON,'python3'].filter(Boolean))]){
    const found=spawnSync(executable,['-c','import pathlib,playwright; print(pathlib.Path(playwright.__file__).parent / "driver" / "package")'],
      {encoding:'utf8',timeout:10000,maxBuffer:65536});
    if(found.status===0&&String(found.stdout).trim())candidates.push(String(found.stdout).trim());
    else resolutions.push({candidate:executable+':playwright.driver',code:found.error?.code??found.status??null});
  }
  for(const name of candidates){try{const path=require.resolve(name),value=await import(pathToFileURL(path).href);if(value.chromium??value.default?.chromium){module=value.chromium?value:value.default;selected=path;break;}}
    catch(error){resolutions.push({candidate:name,code:error.code??null});}}
  need(module?.chromium,'An installed original Playwright Chromium runtime is required. '+JSON.stringify(resolutions));
  const browserDirectory=join(directory,'browser-runtime');await fs.mkdir(browserDirectory,{recursive:true,mode:0o700});
  const configuration=privateInput.browser??{};
  let browser;
  if(configuration.cdpURL)browser=await module.chromium.connectOverCDP(configuration.cdpURL);
  else{
    const previous=process.env.TMPDIR;process.env.TMPDIR=browserDirectory;
    try{browser=await module.chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],
      downloadsPath:browserDirectory,...(configuration.executablePath?{executablePath:configuration.executablePath}:{})});}
    finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;}
  }
  browserDriver={browser,packageEntrypoint:selected,version:browser.version()};
  await step('browser-runtime',{packageEntrypoint:selected,version:browserDriver.version});return browserDriver;
}
async function browserJournal(page){
  return page.evaluate(async()=>{
    const db=await new Promise((done,reject)=>{const request=indexedDB.open('stellar-forge.invoice-settlement.requests.v1');request.onsuccess=()=>done(request.result);request.onerror=()=>reject(request.error);});
    try{
      const rows=await new Promise((done,reject)=>{const request=db.transaction('requests','readonly').objectStore('requests').getAll();request.onsuccess=()=>done(request.result);request.onerror=()=>reject(request.error);});
      return await Promise.all(rows.map(async row=>{
        let file=null;
        if(row.file){const body=await row.file.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',body);file={name:row.file.name,size:row.file.size,type:row.file.type,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};}
        return {...row,file};
      }));
    }finally{db.close();}
  });
}
async function waitBrowserReady(page,server){
  await page.waitForFunction(()=>document.querySelector('#workspace-revision')?.textContent?.includes('Revision'),null,{timeout:60000});
  const response=await httpRead(server,'/api/bootstrap');need(response.ok,'The browser bootstrap could not be read.');
  const value=await response.json();need(value.state.workspaceId===server.startup.workspaceId,'The browser selected another original workspace.');
  const version=value.state.programmes[programmeId]?.currentVersion;
  if(version)await page.locator('#active-programme').selectOption(programmeId+'@'+version);
  return value;
}
async function browserJourney(key,server,{recoverOriginalRequests=false}={}){
  currentPhase=key;const driver=await openOriginalBrowser(),context=await driver.browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
  const page=await context.newPage(),pageErrors=[],requests=[],screenshots=join(directory,'browser',key);
  await fs.mkdir(screenshots,{recursive:true,mode:0o700});
  page.on('pageerror',error=>pageErrors.push(err(error)));page.on('dialog',dialog=>dialog.accept().catch(()=>{}));
  try{
    await page.goto(server.startup.url,{waitUntil:'domcontentloaded',timeout:60000});
    const initial=await waitBrowserReady(page,server);
    await page.locator('#load-active-programme').click();
    await page.locator('#programme-editor-title').waitFor({state:'visible'});
    const registers={assetRows:await page.locator('#assets-table tbody tr').count(),invoiceRows:await page.locator('#invoices-table tbody tr').count(),invoicePager:await page.locator('#invoice-pager').textContent()};
    await page.locator('nav [data-tab="sources"]').click();
    const captures=await page.locator('#capture-count').textContent();
    const captureSource=page.locator('#captures-list button[data-action="capture-sources"]').first();
    if(await captureSource.count())await captureSource.click();
    const sourceOpen=page.locator('#sources-list button[data-action="source-open"]').first();
    if(await sourceOpen.count()){await sourceOpen.click();await page.locator('#source-detail-panel').waitFor({state:'visible'});}
    await page.locator('nav [data-tab="reconciliation"]').click();
    await page.locator('#reconciliation-select').selectOption(finalEdition.reconciliationId);
    await page.locator('#reconciliation-open').click();
    await page.waitForFunction(()=>document.querySelector('#reconciliation-position')?.textContent?.includes('Complete original-source reconciliation'));
    const originalPosition=await page.locator('#reconciliation-position').textContent();
    await page.screenshot({path:join(screenshots,'reconciliation.png'),fullPage:true});
    await page.locator('nav [data-tab="reports"]').click();
    await page.locator('#reports-list button[data-action="report-preview"][data-id="'+report.reportId+'"]').click();
    await page.locator('#report-preview').waitFor({state:'visible'});
    await page.frameLocator('#report-preview').locator('body').waitFor({state:'visible'});
    const reportText=await page.frameLocator('#report-preview').locator('body').innerText();
    need(reportText.length>100,'The received report did not render its complete original content.');
    await page.screenshot({path:join(screenshots,'report.png'),fullPage:true});
    if(recoverOriginalRequests){
      let profileAcknowledgement,resolveProfile;const profileDone=new Promise(done=>resolveProfile=done);
      let lostProfile=false;
      const profileRoute=async route=>{
        const request=route.request(),body=request.postData(),parsed=body?JSON.parse(body):{};
        if(parsed.method!=='workspace.profile'){await route.continue();return;}
        requests.push({kind:'profile',wireBody:body,workspaceId:request.headers()['x-invoice-workspace-id']});
        if(lostProfile){await route.continue();return;}lostProfile=true;
        const response=await route.fetch(),value=await response.json();need(response.ok(),'The original browser profile mutation did not commit.');
        profileAcknowledgement={args:parsed.args,result:value,wireBody:body};
        await route.abort('failed');resolveProfile(profileAcknowledgement);
      };
      await page.route('**/api/invoke',profileRoute);
      await page.locator('nav [data-tab="overview"]').click();
      await page.locator('#profile-form [name="name"]').fill(initial.state.profile.name);
      await page.locator('#profile-form [name="contact"]').fill('Native browser source operator');
      await page.locator('#profile-form [type="submit"]').click();
      const profileAck=await Promise.race([profileDone,delay(60000).then(()=>{throw new Error('The original browser profile mutation did not return from the server.');})]);
      await page.locator('#retry-request').waitFor({state:'visible'});
      const profileBefore=await browserJournal(page);need(profileBefore.some(row=>row.requestId===profileAck.args.requestId),'IndexedDB did not retain the original profile request.');
      await page.reload({waitUntil:'domcontentloaded'});await waitBrowserReady(page,server);
      const profileAfter=await browserJournal(page);need(profileAfter.some(row=>row.requestId===profileAck.args.requestId&&row.wireBody===profileAck.wireBody),'Reload changed the original browser mutation request.');
      await page.locator('#retry-request').click();
      await page.locator('#retry-request').waitFor({state:'hidden'});
      const profileState=await (await httpRead(server,'/api/state')).json();
      need(profileState.revision===profileAck.result.revision,'Recovering the original profile request applied another mutation.');
      need((await browserJournal(page)).every(row=>row.requestId!==profileAck.args.requestId),'The recovered browser request remained pending.');
      need(requests.filter(row=>row.kind==='profile').length===2&&requests.filter(row=>row.kind==='profile').every(row=>row.wireBody===profileAck.wireBody),'The browser retry changed original request bytes.');
      await step(key+'-profile-recovery',{request:profileAck,beforeReload:profileBefore,afterReload:profileAfter,revision:profileState.revision});
      await page.unroute('**/api/invoke',profileRoute);
      let sourceAcknowledgement,resolveSource;const sourceDone=new Promise(done=>resolveSource=done);let lostSource=false;
      const selectedFile=join(sourceDirectory,'source','elementpay-listener.json'),fileIdentity=await fileDigest(selectedFile);
      const sourceRoute=async route=>{
        const request=route.request(),body=request.postDataBuffer(),metadata=request.headers()['x-invoice-source'];
        const parsed=JSON.parse(Buffer.from(metadata,'base64'));requests.push({kind:'source',metadata,bodySha256:digest(body),bytes:body.length,workspaceId:request.headers()['x-invoice-workspace-id']});
        need(digest(body)===fileIdentity.sha256&&body.length===fileIdentity.bytes,'The browser upload changed the original publisher source file.');
        if(lostSource){await route.continue();return;}lostSource=true;
        const response=await route.fetch(),value=await response.json();need(response.ok(),'The actual original browser source upload did not commit.');
        sourceAcknowledgement={args:parsed,result:value,metadata,bodySha256:digest(body),bytes:body.length};
        await route.abort('failed');resolveSource(sourceAcknowledgement);
      };
      await page.route('**/api/sources/import',sourceRoute);
      await page.locator('nav [data-tab="sources"]').click();
      await page.locator('#source-import-form [name="provider"]').selectOption('document');
      await page.locator('#source-import-form [name="kind"]').fill('publisher-source');
      await page.locator('#source-import-form [name="label"]').fill('Original listener source uploaded through the browser');
      await page.locator('#source-import-form [name="connectionAlias"]').selectOption('');
      await page.locator('#source-import-form [name="file"]').setInputFiles(selectedFile);
      await page.locator('#source-import-form [type="submit"]').click();
      const sourceAck=await Promise.race([sourceDone,delay(60000).then(()=>{throw new Error('The original browser upload did not return from the server.');})]);
      await page.locator('#retry-request').waitFor({state:'visible'});
      const fileBefore=await browserJournal(page),selectedPending=fileBefore.find(row=>row.requestId===sourceAck.args.requestId);
      need(selectedPending?.file?.sha256===fileIdentity.sha256&&selectedPending.file.size===fileIdentity.bytes,'The durable browser journal lost the complete File bytes.');
      await page.reload({waitUntil:'domcontentloaded'});await waitBrowserReady(page,server);
      const fileAfter=await browserJournal(page),resumed=fileAfter.find(row=>row.requestId===sourceAck.args.requestId);
      need(resumed?.file?.sha256===fileIdentity.sha256&&resumed.encodedMetadata===sourceAck.metadata,'Reload changed the original File or immutable upload selection.');
      await page.locator('#retry-request').click();await page.locator('#retry-request').waitFor({state:'hidden'});
      const sourceState=await (await httpRead(server,'/api/state')).json();
      need(sourceState.revision===sourceAck.result.revision,'Recovering the complete upload created another source mutation.');
      need(sourceState.sources[sourceAck.result.sourceId]?.bodyFile.sha256===fileIdentity.sha256,'The received browser file source differs.');
      const uploadRequests=requests.filter(row=>row.kind==='source');
      need(uploadRequests.length===2&&uploadRequests.every(row=>row.metadata===sourceAck.metadata&&row.bodySha256===fileIdentity.sha256),'The browser retry did not reuse the exact original upload.');
      await step(key+'-file-recovery',{request:sourceAck,beforeReload:fileBefore,afterReload:fileAfter,revision:sourceState.revision});
      await page.unroute('**/api/sources/import',sourceRoute);
      await page.screenshot({path:join(screenshots,'request-recovery.png'),fullPage:true});
    }
    for(const name of ['receiving','history']){await page.locator('nav [data-tab="'+name+'"]').click();await page.locator('#'+name).waitFor({state:'visible'});}
    need(pageErrors.length===0,'The original browser raised an uncaught source error: '+JSON.stringify(pageErrors));
    const result={browserVersion:driver.version,packageEntrypoint:driver.packageEntrypoint,workspaceId:server.startup.workspaceId,
      registers,captures,originalPosition,reportTextSha256:digest(reportText),reportTextBytes:Buffer.byteLength(reportText),
      recoveredOriginalRequests:recoverOriginalRequests,requests,pageErrors,screenshots};
    await step(key,result);say({phase:key,status:'COMPLETE',browser:driver.version,recovery:recoverOriginalRequests});return result;
  }finally{await context.close();}
}

async function httpRead(server,path,options={}){
  const result=await fetch(server.origin+path,{...options,headers:{Authorization:'Bearer '+server.token,'X-Invoice-Workspace-ID':server.startup.workspaceId,...options.headers},signal:AbortSignal.timeout(120000)});
  return result;
}
async function closeServer(server){
  if(server.closed)return;server.closed=true;server.child.kill('SIGTERM');
  await Promise.race([new Promise(done=>server.child.once('exit',done)),delay(10000).then(()=>{if(server.child.exitCode===null)server.child.kill('SIGKILL');})]);
  await retain(join(steps,server.key+'-stdout.txt'),Buffer.concat(server.out));
  await retain(join(steps,server.key+'-stderr.txt'),Buffer.concat(server.error));
}
const sourceServer=await startServer('44-original-http',cli,workspaceDirectory,originalState.workspaceId,connectionsFile);
try{
  const response=await httpRead(sourceServer,'/api/bootstrap');need(response.ok,'The original browser bootstrap failed.');
  const bootstrap=await response.json();await step('45-original-bootstrap',bootstrap);
  need(bootstrap.state.workspaceId===originalState.workspaceId,'The browser bootstrap selected another workspace.');
  const home=await fetch(sourceServer.origin+'/',{signal:AbortSignal.timeout(30000)});need(home.ok,'The original industrial workspace page failed.');
  await retain(join(steps,'45-original-index.html'),Buffer.from(await home.arrayBuffer()));
  const responseArchive=await httpRead(sourceServer,'/api/packages/'+exported.exportId+'/archive');
  need(responseArchive.ok,'The original complete HTTP archive download failed.');
  const httpArchive=join(directory,'invoice-http.tar.gz');await pipeline(Readable.fromWeb(responseArchive.body),createWriteStream(httpArchive,{flags:'wx',mode:0o600}));
  const originalFiles=await archive.unpackInvoiceDelivery({input:createReadStream(httpArchive),destination:join(directory,'http-delivery'),expectedManifestSha256:manifestSha256});
  await step('46-http-whole-download',{archive:await fileDigest(httpArchive),manifestSha256:originalFiles.manifestSha256??manifestSha256});
  const upload=await httpRead(sourceServer,'/api/packages/unpack?requestId='+uuid('http-unpack')+'&manifestSha256='+manifestSha256,{
    method:'POST',headers:{'Content-Type':'application/gzip'},body:Readable.toWeb(createReadStream(httpArchive)),duplex:'half'});
  const uploadBody=Buffer.from(await upload.arrayBuffer());await retain(join(steps,'47-http-unpack-response.json'),uploadBody);
  need(upload.ok,'The original complete HTTP receiving upload failed: '+uploadBody.toString('utf8').slice(0,1000));
}finally{await closeServer(sourceServer);}
const receivedServer=await startServer('48-received-http',received.application.cli,received.workspace.directory,received.workspace.workspaceId,receivedConnectionsFile);
try{const bootstrap=await httpRead(receivedServer,'/api/bootstrap');need(bootstrap.ok,'The independently received browser failed.');
  await attempt('browser-received-native',()=>browserJourney('browser-received-native',receivedServer));const body=await bootstrap.json();
  need(body.state.workspaceId===received.workspace.workspaceId,'The received browser workspace identity differs.');
  await step('49-received-bootstrap',body);
}finally{await closeServer(receivedServer);}
const reportExportDirectory=join(directory,'report-delivery');
host=await operator.openInvoiceSettlementOperator({workspaceDirectory,connections,profile,applicationDirectory:sourceDirectory});
await mutate('50-report-only-export','report.export',{reportId:report.reportId,destination:reportExportDirectory});
const reportInspection=await receiver.inspectInvoiceDelivery({sourceDirectory:reportExportDirectory});
need(reportInspection.manifest.kind==='report'&&(reportInspection.manifest.runtimes??[]).length===0,'The scoped report package included an unrelated runtime.');
await step('51-report-package',{manifestSha256:reportInspection.manifestSha256,manifest:reportInspection.manifest});
const reportReceive=await receiver.receiveInvoiceDelivery({sourceDirectory:reportExportDirectory,destination:join(directory,'received-report'),requestId:uuid('receive-report'),expectedManifestSha256:reportInspection.manifestSha256});
await step('52-received-report',reportReceive);
const finalState=await host.describe();await host.close();host=null;
for(const adapter of adapters.values())if(adapter.close)await adapter.close();
const outcome={schema:'stellar-forge.invoice-native-operation.v1',completedAt:new Date().toISOString(),node:process.version,
  packetSha256:expectedPacketSha256,sourceFiles:packet.files.length,sourceBytes,
  runtime:{id:retained.id,manifestSha256:retained.manifestSha256,version:loaded.ethers.version,files:runtimeManifest.files.length},
  contracts:summaries,events:allEvents.length,originalTransactions:uniqueTransactions.size,originalBlocks:uniqueBlocks.size,
  nativeAssets:assets,programmeId,reconciliationId:finalEdition.reconciliationId,reportId:report.reportId,
  originalWorkspace:{workspaceId:finalState.workspaceId,revision:finalState.revision,sources:Object.keys(finalState.sources).length},
  received:{workspaceId:received.workspace.workspaceId,directory:received.directory,manifestSha256:received.manifestSha256,runtimes:received.runtimes.map(item=>({id:item.id,manifestSha256:item.manifestSha256}))},
  archive:await fileDigest(archivePath),failures};
try{await browserDriver?.browser.close();}catch{}
clearInterval(heartbeat);await step('99-outcome',outcome);say({phase:'complete',status:failures.length?'COMPLETE_WITH_NATIVE_FINDINGS':'COMPLETE',outcome});
