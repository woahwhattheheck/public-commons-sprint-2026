#!/usr/bin/env node
// MIT. Execute the original World Bank receiving workflow through HTTP and stdio.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { initializeWorldBankWorkspaceMerchant } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { startMerchantMcpStdio } from '../stdio.mjs';
import { MCP_VERSION } from '../../mcp-paid-agent/http-tools.mjs';
import { openMerchantFileClient } from '../retained-download.mjs';
import { inspectWorldBankDownload, downloadWorldBankWorkspace } from '../worldbank-workspace-download.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
const args = new Map();
for(let i=2;i<process.argv.length;i+=2){
  if(!['--workdir','--reference','--python'].includes(process.argv[i]) || !process.argv[i+1])
    throw Error('Use --workdir ABSOLUTE_DIRECTORY [--reference ORIGINAL_CAPTURE.json] [--python EXECUTABLE].');
  if(args.has(process.argv[i]))throw Error('Repeated option.');
  args.set(process.argv[i],process.argv[i+1]);
}
if(!args.has('--workdir'))throw Error('Supply --workdir.');
const root=resolve(args.get('--workdir'));
const referenceFile=args.has('--reference')?resolve(args.get('--reference')):fileURLToPath(new URL('./worldbank-reference-capture.json',import.meta.url));
const reference=JSON.parse(await readFile(referenceFile,'utf8'));
const archive=Buffer.from(reference.handoverBase64,'base64');
assert.equal(archive.toString('base64'),reference.handoverBase64);
assert.equal(archive.length,reference.bytes);
assert.equal(sha(archive),reference.sha256);
const originalService=JSON.parse(await readFile(new URL('../../../stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json',import.meta.url),'utf8'));
const payment=originalService.routes[0].definition.payment;
assert.equal(payment.network,'stellar:testnet');
assert.equal(payment.asset,'UNVERIFIED_DEMO_ASSET');
assert.equal(payment.payTo,'UNVERIFIED_DEMO_RECIPIENT');
const reportFile=join(root,'journey.json');
await mkdir(root,{recursive:true,mode:0o700});
let report;
try{report=JSON.parse(await readFile(reportFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(report && report.sourceSha256!==reference.sha256)throw Error('This original operation belongs to different source bytes.');
report??={schema:'stellar-forge.worldbank-mcp-native-journey.v1',operationId:'SCF-WORLDBANK-MCP-FE85-20261012',
  sourceSha256:reference.sha256,sourceBytes:reference.bytes,expectedObservations:reference.observations,
  startedAt:new Date().toISOString(),buyerIntentId:randomUUID(),steps:{}};
report.status='RUNNING';
async function checkpoint(name,value){
  if(name)report.steps[name]=value;
  await writeFile(reportFile+'.next',json(report),{mode:0o600});
  await rename(reportFile+'.next',reportFile);
  if(name)process.stderr.write('World Bank MCP: '+name+'\n');
  return value;
}
async function retainedFile(path,bytes){
  try{assert.deepEqual(await readFile(path),Buffer.from(bytes));}
  catch(error){if(error.code!=='ENOENT')throw error;await writeFile(path,bytes,{flag:'wx',mode:0o600});}
}
async function exists(path){try{await readFile(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const source=join(root,'source'),receiver=join(root,'receiver'),inputFile=join(root,'original-handover.zip');
for(const directory of[source,receiver])await mkdir(directory,{recursive:true,mode:0o700});
await retainedFile(inputFile,archive);
const sourceConnection=join(root,'source-connection.json');
await retainedFile(sourceConnection,json({schema:'stellar-forge.worldbank-workspace-connection.v1',workspaces:{
  research:{directory:source,...(args.has('--python')?{python:args.get('--python')}:{ }),
    imports:{original:{kind:'package',file:inputFile,sha256:reference.sha256}},
    merchants:{demo:{origin:'https://worldbank.example',path:'/worldbank',payment}},runtime:{port:0}}
}}));
const sourceHost=join(root,'source-host'),sourceConfig=join(sourceHost,'merchant-mcp.json');
if(!await exists(sourceConfig))await initializeWorldBankWorkspaceMerchant({directory:sourceHost,connection:sourceConnection});
const environment={...process.env,MCP_ACCESS_TOKEN:randomBytes(32).toString('base64url')};
let host,receiverHost,stdio;
const captureId='worldbank-mcp-source',selectionId='worldbank-mcp-selection',reviewId='worldbank-mcp-review',exportId='worldbank-mcp-edition';
try{
  host=await startMerchantMcp({configPath:sourceConfig,port:0,environment});
  const client=await openMerchantFileClient({url:host.url,environment});
  const call=(name,args={})=>client.call('merchant_worldbank_'+name,{workspace:'research',...args});
  const tools=host.operator.tools.filter(tool=>tool.name.startsWith('merchant_worldbank_'));
  assert.equal(tools.length,22);
  assert.equal(new Set(tools.map(tool=>tool.name)).size,22);
  const opened=await call('open');
  const same=await call('open');
  assert.equal(opened.instanceId,same.instanceId);
  const inputs=await call('inputs',{sourceImport:'original'});
  assert.equal(inputs.inputs[0].sha256,reference.sha256);
  let current=await call('status');
  if(!current.native.captures.some(capture=>capture.id===captureId))
    await call('import',{sourceImport:'original',expectedSha256:reference.sha256,id:captureId,selectionId,reviewId});
  const observations=(await call('observations',{captureId,limit:100})).result;
  assert.equal(observations.total,reference.observations);
  assert.equal(observations.rows.length,reference.observations);
  const gdp=observations.rows.find(row=>row.country_iso3==='CAN'&&row.indicator_id==='NY.GDP.MKTP.CD'&&row.period==='2024');
  assert.equal(gdp.value,'2270076189683.46');
  const comparison=(await call('compare',{captureId,baselineId:captureId,limit:10})).result;
  assert.equal(comparison.counts.unchanged,reference.observations);
  const reviewed=(await call('review_read',{id:reviewId})).result;
  assert.equal(reviewed.includedObservations,reference.observations);
  const exported=(await call('export',{id:exportId,reviewId,expectedRevision:reviewed.revision})).result;
  await checkpoint('source',{captureId,captureSha256:observations.captureSha256??reviewed.captureSha256,
    observations:observations.total,exactCanadaGdp:gdp.value,reviewId,reviewRevision:reviewed.revision,
    exportId,exportManifestSha256:exported.manifestSha256,comparison:comparison.counts,typedTools:tools.length});

  const borrowed=await call('browser',{action:'open'});
  const browserUrl=new URL(borrowed.url);
  const browserResponse=await fetch(browserUrl.origin+'/api/state',{headers:{authorization:'Bearer '+browserUrl.hash.slice(1)}});
  assert.equal(browserResponse.status,200);
  const browserState=await browserResponse.json();
  assert.ok(browserState.exports.some(item=>item.id===exportId));
  const html=await fetch(browserUrl.origin+'/');
  assert.equal(html.status,200);assert.match(await html.text(),/World Bank/);
  await call('browser',{action:'close'});
  assert.equal((await call('status')).instanceId,opened.instanceId);
  await checkpoint('shared-browser',{sameInstance:true,retainedExportVisible:true,modelOpenAfterBrowserClose:true});

  const prepared=(await call('merchant',{exportId,profile:'demo'})).result;
  const repeated=(await call('merchant',{exportId,profile:'demo'})).result;
  assert.equal(prepared.draft.id,repeated.draft.id);
  const draftId=prepared.draft.id,snapshot=prepared.draft.dataset.snapshot,releaseId='worldbank-mcp-release';
  const publisher=(action,payload={})=>call('publisher',{action,payload});
  const staged=(await publisher('publisher.release.stage',{draftId,id:releaseId})).result;
  const inspected=(await publisher('publisher.release.inspect',{id:releaseId})).result;
  assert.equal(staged.digest,inspected.digest);
  current=await call('status');
  if(current.native.publisher.releases.state.active!==releaseId)
    await publisher('publisher.release.activate',{id:releaseId,expectedGeneration:current.native.publisher.releases.state.generation});
  current=await call('status');
  const running=(await publisher('publisher.release.start',{expectedGeneration:current.native.publisher.releases.state.generation})).result;
  const listener=running.status.runtime.observed.listener;
  const challenge=await fetch(new URL('/worldbank',listener));
  assert.equal(challenge.status,402);await challenge.body.cancel();
  const query='where_country_iso3=CAN&where_indicator_id=NY.GDP.MKTP.CD&sort=-period&limit=10';
  const preview=(await publisher('publisher.preview',{target:snapshot,query})).result;
  assert.equal(preview.status,200);
  assert.ok(JSON.stringify(preview.body).includes('"2270076189683.46"'));
  const offer=(await publisher('publisher.buyer.review',{snapshot,query})).result;
  const buyer=(await publisher('publisher.buyer.prepare',{review:offer,intentId:report.buyerIntentId,acceptIndex:0,offerSha256:offer.offerSha256})).result;
  const buyerId=buyer.buyer.id??buyer.buyer.record?.id;
  assert.ok(buyerId);
  const buyerFile=await call('file',{kind:'buyer-config',id:buyerId,limit:196608});
  assert.equal(buyerFile.nextOffset,null);
  const buyerBytes=Buffer.from(buyerFile.data,'base64');
  assert.equal(sha(buyerBytes),buyerFile.file.sha256);
  JSON.parse(buyerBytes);
  await publisher('publisher.release.stop');
  await checkpoint('merchant',{draftId,snapshot,releaseId,releaseDigest:staged.digest,sourceClosure:staged.dataset.sourceClosure,
    mode:'CHALLENGE_ONLY',network:payment.network,httpChallenge:402,nativeQuery:200,
    buyerId,buyerConfigSha256:buyerFile.file.sha256,stopped:true});

  const inspectedDownload=await inspectWorldBankDownload({url:host.url,workspace:'research',exportId,environment});
  const destination=join(root,'download');
  if(!report.steps.download){
    const controller=new AbortController();
    let interrupted=false;
    try{
      await downloadWorldBankWorkspace({url:host.url,workspace:'research',exportId,directory:destination,
        environment,chunkSize:1024,signal:controller.signal,expectedManifestSha256:inspectedDownload.manifestSha256,
        onProgress:()=>controller.abort(Object.assign(new Error('Continue this original download from its checkpoint.'),{code:'NATIVE_RECEIVING_INTERRUPTED'}))});
    }catch(error){if(error.code!=='NATIVE_RECEIVING_INTERRUPTED'&&error.name!=='AbortError')throw error;interrupted=true;}
    assert.equal(interrupted,true);
  }
  const received=await downloadWorldBankWorkspace({url:host.url,workspace:'research',exportId,directory:destination,
    environment,chunkSize:4096,expectedManifestSha256:inspectedDownload.manifestSha256});
  assert.equal(received.state,'COMPLETE');assert.equal(received.files,6);
  assert.equal(received.resumed,true);
  const downloadedArchive=await readFile(join(destination,'handover.zip'));
  const declaredArchive=inspectedDownload.manifest.files.find(file=>file.name==='handover.zip');
  assert.equal(sha(downloadedArchive),declaredArchive.sha256);
  const closed=await call('close',{instanceId:opened.instanceId});assert.equal(closed.state,'CLOSED');
  const reopened=await call('open');assert.notEqual(reopened.instanceId,opened.instanceId);
  assert.equal(reopened.native.captures.find(item=>item.id===captureId).captureSha256,reviewed.captureSha256);
  await checkpoint('download',{...received,directory:undefined,archiveSha256:declaredArchive.sha256,archiveBytes:downloadedArchive.length,
    reopenedSameCapture:true,newOwnedInstance:true});
  await call('close',{instanceId:reopened.instanceId});
  await host.close();host=null;

  const receiverConnection=join(root,'receiver-connection.json');
  await retainedFile(receiverConnection,json({schema:'stellar-forge.worldbank-workspace-connection.v1',workspaces:{
    customer:{directory:receiver,...(args.has('--python')?{python:args.get('--python')}:{ }),
      imports:{edition:{kind:'package',file:join(destination,'handover.zip'),sha256:declaredArchive.sha256}}}
  }}));
  const receiverHostDirectory=join(root,'receiver-host'),receiverConfig=join(receiverHostDirectory,'merchant-mcp.json');
  if(!await exists(receiverConfig))await initializeWorldBankWorkspaceMerchant({directory:receiverHostDirectory,connection:receiverConnection});
  receiverHost=await startMerchantMcp({configPath:receiverConfig,port:0,environment});
  const customer=await openMerchantFileClient({url:receiverHost.url,environment});
  const customerCall=(name,args={})=>customer.call('merchant_worldbank_'+name,{workspace:'customer',...args});
  let customerOpened=await customerCall('open');
  if(!customerOpened.native.captures.some(item=>item.id==='worldbank-mcp-received'))
    await customerCall('import',{sourceImport:'edition',expectedSha256:declaredArchive.sha256,id:'worldbank-mcp-received'});
  const originalRows=(await customerCall('observations',{captureId:'worldbank-mcp-received',limit:100})).result;
  assert.deepEqual(originalRows.rows,observations.rows);
  await customerCall('close',{instanceId:customerOpened.instanceId});
  customerOpened=await customerCall('open');
  assert.equal(customerOpened.native.captures.find(item=>item.id==='worldbank-mcp-received').summary.observations,reference.observations);
  await customerCall('close',{instanceId:customerOpened.instanceId});
  await receiverHost.close();receiverHost=null;
  await checkpoint('receiving',{originalObservationsEqual:true,observations:originalRows.total,reopened:true});

  const input=new PassThrough(),output=new PassThrough();
  let sequence=0,tail='';
  const pending=new Map();
  output.on('data',chunk=>{
    tail+=chunk.toString('utf8');
    while(tail.includes('\n')){
      const index=tail.indexOf('\n'),line=tail.slice(0,index);tail=tail.slice(index+1);
      if(!line.trim())continue;
      const message=JSON.parse(line),waiter=pending.get(message.id);
      if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);
        if(message.error)waiter.reject(Object.assign(new Error(message.error.message),{code:message.error.code}));
        else waiter.resolve(message.result);
      }
    }
  });
  const request=(method,params)=>new Promise((accept,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Original stdio reply timed out.'));},120000);
    pending.set(id,{resolve:accept,reject,timer});
    input.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  stdio=await startMerchantMcpStdio({configPath:sourceConfig,environment,input,output});
  const initialized=await request('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'worldbank-native-receiving',version:'1.0.0'}});
  assert.equal(initialized.protocolVersion,MCP_VERSION);
  input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
  const listed=await request('tools/list',{});
  assert.equal(listed.tools.filter(tool=>tool.name.startsWith('merchant_worldbank_')).length,22);
  const stdioCall=async(name,args={})=>{
    const result=await request('tools/call',{name:'merchant_worldbank_'+name,arguments:{workspace:'research',...args}});
    if(result.isError)throw Error(JSON.stringify(result.structuredContent));
    return result.structuredContent;
  };
  const stdioOpened=await stdioCall('open');
  const stdioRows=(await stdioCall('observations',{captureId,limit:100})).result;
  assert.deepEqual(stdioRows.rows,observations.rows);
  await stdioCall('close',{instanceId:stdioOpened.instanceId});
  await stdio.close('NATIVE_RECEIVING_COMPLETE');await stdio.closed;stdio=null;
  input.end();output.end();
  await checkpoint('stdio',{tools:22,originalObservationsEqual:true,ownedModelClosed:true});
  report.status='COMPLETE';report.completedAt=new Date().toISOString();
  await checkpoint();
  process.stdout.write(json({status:report.status,operationId:report.operationId,report:reportFile,
    sourceSha256:report.sourceSha256,observations:reference.observations,sections:Object.keys(report.steps)}));
}catch(error){
  report.status='FAILED';report.error={code:error.code??error.name,message:error.message};
  await checkpoint().catch(()=>{});
  throw error;
}finally{
  await stdio?.close('NATIVE_RECEIVING_SHUTDOWN').catch(()=>{});
  await receiverHost?.close().catch(()=>{});
  await host?.close().catch(()=>{});
}
