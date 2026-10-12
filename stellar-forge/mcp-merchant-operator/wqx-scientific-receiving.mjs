// MIT. Paired scientific editions through the existing WQX merchant, client, CLI and retained files.
import assert from 'node:assert/strict';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { privateDirectory } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/routescan/quota.mjs';
import { reviewWaterQualityManaged, startManagedWaterQuality } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/managed.mjs';
import { verifyStandardizedReview } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/standardized-analysis/workflow.mjs';
import { scientificFile, scientificJson, scientificRetain, scientificReceipt, completeScientificPhase,
  scientificChild, checkScientificCohort, SCIENTIFIC_FORMATS } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/standardized-analysis/receiving.mjs';
import { initializeMerchantProvider } from './providers.mjs';
import { startMerchantMcp } from './serve.mjs';
import { openWqxWorkspaceClient, downloadWqxFile, reopenWqxDownload } from './wqx-workspace-client.mjs';

const gc=()=>globalThis.gc?.();
export async function receiveScientificMcp(value) {
  const prior=await scientificReceipt(value,'mcp');if(prior)return prior;
  const native=await scientificReceipt(value,'native');assert(native);
  const root=await privateDirectory(join(value.root,'mcp')),receiverDirectory=await privateDirectory(join(root,'received-project'));
  await privateDirectory(join(root,'downloads'));
  const environment={...process.env,WQX_SCIENTIFIC_RECEIVING_TOKEN:randomBytes(32).toString('hex'),MCP_OAUTH_CONFIG:undefined,MCP_CLIENT_ORIGINS:''};
  const files=[],sourceFiles={},receiverFiles={},restarts=[],stages=[];
  let sourceHost,receiverHost,server,source,receiver,configuration,port=0,requests=0;
  const progress=async(phase,details={})=>{stages.push({phase,...details});process.stderr.write(JSON.stringify({phase,...details})+'\n');gc();};
  async function openServer() {
    server=await startMerchantMcp({configPath:configuration,port,tokenEnv:'WQX_SCIENTIFIC_RECEIVING_TOKEN',environment});
    port=Number(new URL(server.url).port);server.server.on('request',()=>{requests++;});
    source=await openWqxWorkspaceClient({url:server.url,workspace:'source',tokenEnv:'WQX_SCIENTIFIC_RECEIVING_TOKEN',environment});
    receiver=await openWqxWorkspaceClient({url:server.url,workspace:'receiver',tokenEnv:'WQX_SCIENTIFIC_RECEIVING_TOKEN',environment});
  }
  async function download(client,file,label,options={}) {
    const result=await downloadWqxFile(client,{file,directory:join(root,'downloads',label)},options);
    assert.equal(result.sha256,file.sha256);assert.equal(result.bytes,file.bytes);
    const cold=await reopenWqxDownload({directory:result.directory,expectedSha256:file.sha256});assert.equal(cold.sha256,file.sha256);
    files.push({file:result.filename,bytes:result.bytes,sha256:result.sha256});
    return result;
  }
  async function full(client,response,label) {
    assert(!response.error,'The original native scientific operation returned an error.');
    assert(response.file,'Retain the entire original scientific result through the maintained file transport.');
    const result=await download(client,response.file,label);
    return JSON.parse(await readFile(result.filename,'utf8'));
  }
  async function restart(alias) {
    const old=alias==='source'?sourceHost:receiverHost,directory=alias==='source'?value.author:receiverDirectory;
    const oldLaunch=old.launch;await old.close();
    if(alias==='source')sourceHost=null;else receiverHost=null;
    const next=await startManagedWaterQuality(await reviewWaterQualityManaged({directory,expectedSourceSha256:oldLaunch.sourceSha256}));
    assert.equal(next.launch.projectBindingId,oldLaunch.projectBindingId);assert.notEqual(next.launch.launchId,oldLaunch.launchId);
    if(alias==='source')sourceHost=next;else receiverHost=next;
    restarts.push({workspace:alias,projectBindingId:oldLaunch.projectBindingId,previousLaunchId:oldLaunch.launchId,launchId:next.launch.launchId});
  }
  try {
    sourceHost=await startManagedWaterQuality(await reviewWaterQualityManaged({directory:value.author}));
    receiverHost=await startManagedWaterQuality(await reviewWaterQualityManaged({directory:receiverDirectory,
      expectedSourceSha256:sourceHost.launch.sourceSha256}));
    const connection={schema:'stellar-forge.wqx-workspace-connection.v1',workspaces:{}};
    for(const [alias,host]of [['source',sourceHost],['receiver',receiverHost]])
      connection.workspaces[alias]={label:alias==='source'?'Original paired scientific review':'Independent scientific receiver',
        directory:host.launch.directory,projectBindingId:host.launch.projectBindingId,expectedSourceSha256:host.launch.sourceSha256};
    const connectionPath=join(root,'connection.json');await scientificRetain(connectionPath,connection);
    const setup=await initializeMerchantProvider('wqx-water-quality',{directory:join(root,'merchant'),connection:connectionPath,name:'Water-quality scientific editions'});
    configuration=setup.configuration;await openServer();
    assert.equal((await source.status()).workspaces[0].status,'OPEN');
    const inventory=await source.inventory({kind:'scientific',limit:100});
    assert(inventory.items.some(row=>row.reviewId===value.ids.current));assert(inventory.items.some(row=>row.reviewId===value.ids.baseline));
    const current=await scientificJson(join(value.author,'standardized-analysis',value.ids.current+'.json'));
    verifyStandardizedReview(current);assert.equal(current.reviewSha256,native.quarter.reviewSha256);
    const request={...current.request,reviewId:value.ids.mcp,title:'Potomac paired scientific review — merchant operator'};
    let preview=await full(source,await source.scientificPreview({request}),'scientific-preview');
    assert.equal(preview.analysis.analysisSha256,current.analysis.analysisSha256);assert.equal(preview.previous.reviewSha256,current.previous.reviewSha256);
    const saveRequest={...request,expectedPreviewSha256:preview.previewSha256};preview=null;gc();
    let saved=await full(source,await source.scientificSave({request:saveRequest}),'scientific-save');
    const identity=checkScientificCohort(saved);assert.equal(saved.analysis.analysisSha256,native.quarter.analysisSha256);
    saved=null;gc();
    let replay=await full(source,await source.scientificSave({request:saveRequest}),'scientific-replay');
    assert.equal(replay.reviewSha256,identity.reviewSha256);replay=null;gc();
    await progress('typed-client-preview-save-reopen',{reviewId:identity.reviewId,reviewSha256:identity.reviewSha256,results:1035,limits:1112});
    // Both new CLI operations use the exact same retained request; Save is a same-ID replay.
    const cliResults=[];
    for(const [command,body,label]of [['scientific-preview',request,'preview'],['scientific-save',saveRequest,'save']]) {
      const requestFile=join(root,'cli-'+label+'-request.json'),output=join(root,'cli-'+label+'-result.json');
      await scientificRetain(requestFile,body);
      let response=await scientificJson(output);
      if(!response) {
        // The original CLI reads its existing token variable and retains its own exclusive output.
        const priorToken=process.env.WQX_SCIENTIFIC_RECEIVING_TOKEN;
        process.env.WQX_SCIENTIFIC_RECEIVING_TOKEN=environment.WQX_SCIENTIFIC_RECEIVING_TOKEN;
        try {await scientificChild(fileURLToPath(new URL('./wqx-workspace-cli.mjs',import.meta.url)),
          [command,'--url',server.url,'--workspace','source','--token-env','WQX_SCIENTIFIC_RECEIVING_TOKEN',
            '--timeout-ms','600000','--request-file',requestFile,'--save-json',output],192);}
        finally {if(priorToken===undefined)delete process.env.WQX_SCIENTIFIC_RECEIVING_TOKEN;else process.env.WQX_SCIENTIFIC_RECEIVING_TOKEN=priorToken;}
        response=await scientificJson(output);
      }
      let result=await full(source,response,'cli-scientific-'+label);
      assert.equal(label==='save'?result.reviewSha256:result.previewSha256,label==='save'?identity.reviewSha256:saveRequest.expectedPreviewSha256);
      cliResults.push({command,file:response.file});files.push(await scientificFile(output));result=null;gc();
    }
    for(const format of SCIENTIFIC_FORMATS) {
      const file=await source.file({family:'scientific',id:value.ids.mcp,format});sourceFiles[format]=file;
      if(format!=='bundle'){await download(source,file,'source-'+format);continue;}
      assert(file.bytes<=128*1024*1024,'The complete paired bundle remains within the original file transport.');
      const abort=new AbortController();let interrupted=false;
      try {await download(source,file,'source-bundle',{signal:abort.signal,onProgress:state=>{
        if(state.bytes>=65536&&state.bytes<state.total)abort.abort(new Error('Retain the original complete scientific download across this host restart.'));
      }});}catch(error){if(!abort.signal.aborted)throw error;interrupted=true;}
      const originalUrl=server.url;source.close();receiver.close();await server.close();server=null;await openServer();
      assert.equal(server.url,originalUrl);
      const resumed=await download(source,file,'source-bundle');
      assert(resumed.resumedBytes>=65536);restarts.push({workspace:'merchant',interrupted,resumedBytes:resumed.resumedBytes,bytes:file.bytes,sha256:file.sha256});
    }
    await restart('source');
    let reopened=await full(source,await source.record({family:'scientific',id:value.ids.mcp}),'source-cold-record');
    assert.equal(reopened.reviewSha256,identity.reviewSha256);reopened=null;gc();
    let received=await full(receiver,await receiver.receive({kind:'scientific',inputRef:'file:'+sourceFiles.bundle.fileId}),'received-scientific');
    assert.equal(received.reviewSha256,identity.reviewSha256);checkScientificCohort(received);received=null;gc();
    for(const format of SCIENTIFIC_FORMATS) {
      const file=await receiver.file({family:'scientific',id:value.ids.mcp,format});
      assert.equal(file.sha256,sourceFiles[format].sha256,'Complete independent scientific export changed: '+format);
      assert.equal(file.bytes,sourceFiles[format].bytes);receiverFiles[format]=file;await download(receiver,file,'receiver-'+format);
    }
    await restart('receiver');
    let cold=await full(receiver,await receiver.record({family:'scientific',id:value.ids.mcp}),'receiver-cold-record');
    assert.equal(cold.reviewSha256,identity.reviewSha256);checkScientificCohort(cold);cold=null;gc();
    await progress('complete-two-edition-scientific-receiving',{formats:SCIENTIFIC_FORMATS.length,bundleBytes:sourceFiles.bundle.bytes,mcpRequests:requests});
    source.close();receiver.close();await server.close();server=null;
    await sourceHost.close();sourceHost=null;await receiverHost.close();receiverHost=null;
    return completeScientificPhase(value,'mcp',{review:identity,sourceFiles,receiverFiles,cliResults,restarts,stages,
      mcpRequests:requests,retainedBytes:files.reduce((sum,row)=>sum+row.bytes,0)},files);
  } finally {
    source?.close();receiver?.close();
    const stopped=await Promise.allSettled([server?.close(),sourceHost?.close(),receiverHost?.close()]);
    const failed=stopped.filter(row=>row.status==='rejected');
    if(failed.length)throw new AggregateError(failed.map(row=>row.reason),'The original scientific receiving hosts did not close.');
  }
}
