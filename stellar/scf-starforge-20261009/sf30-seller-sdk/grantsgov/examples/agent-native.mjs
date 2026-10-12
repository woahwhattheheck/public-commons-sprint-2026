#!/usr/bin/env node
// MIT. One original-source MCP research, full receiving and managed CLI journey.
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { openGrantsWorkspace } from '../workspace.mjs';
import { readCaptureExport } from '../capture.mjs';
import { inspectGrantsWorkspace, inspectGrantsLaunchSource, GRANTS_STARTUP_SCHEMA } from '../launch.mjs';
import { startMerchantMcp } from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import { initializeGrantsWorkspaceMerchant } from '../../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { openMerchantFileClient } from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { downloadGrantsExport, receiveGrantsExport } from '../../../../../stellar-forge/mcp-merchant-operator/grantsgov-download.mjs';

const need=(value,message)=>{if(!value)throw Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const time=()=>new Date().toISOString();
const sourceDirectory=dirname(dirname(fileURLToPath(import.meta.url)));
async function exists(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function save(path,value){
  const temporary=path+'.next';await writeFile(temporary,json(value),{mode:0o600});await rename(temporary,path);
}
async function immutable(path,value){
  const content=json(value);
  if(await exists(path)){need(await readFile(path,'utf8')===content,'The original operation input file differs.');return;}
  await writeFile(path,content,{flag:'wx',mode:0o600});
}
function options(argv){
  const result={};
  for(let index=0;index<argv.length;index+=2){
    const name=argv[index],value=argv[index+1];
    need(['--capture','--directory','--operation'].includes(name)&&value&&!Object.hasOwn(result,name),
      'Use --capture ORIGINAL_CAPTURE_JSON --directory PRIVATE_OPERATION --operation ORIGINAL_ID.');
    result[name]=value;
  }
  return result;
}
async function launchManaged(directory){
  const workspace=await inspectGrantsWorkspace(directory),source=await inspectGrantsLaunchSource(sourceDirectory);
  const argv=['serve','--workspace',directory,'--port','0','--startup-format','managed',
    '--workspace-identity',workspace.sha256,'--source-directory',sourceDirectory,'--source-sha256',source.sha256];
  const child=spawn(process.execPath,[join(sourceDirectory,'cli.mjs'),...argv],{stdio:['ignore','pipe','pipe']});
  let output='',diagnostics='',timer;const decoder=new StringDecoder('utf8');
  const exited=new Promise((accept,reject)=>{child.once('exit',(code,signal)=>accept({code,signal}));child.once('error',reject);});
  const ready=new Promise((accept,reject)=>{
    timer=setTimeout(()=>reject(Error('The original managed CLI did not announce readiness.')),20000);
    child.once('error',reject);child.once('exit',()=>reject(Error('The original managed CLI exited before readiness.')));
    child.stdout.on('data',bytes=>{
      output+=decoder.write(bytes);
      if(output.length>65536){reject(Error('The original managed startup output exceeds its expected size.'));return;}
      const line=output.split('\n').find(line=>line.startsWith('{"schema":"'+GRANTS_STARTUP_SCHEMA+'",'));
      if(line){try{accept(JSON.parse(line));}catch(error){reject(error);}}
    });
    child.stderr.on('data',bytes=>{diagnostics=(diagnostics+bytes.toString('utf8')).slice(-4000);});
  });
  const close=async()=>{
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
    const ended=await exited;need(ended.code===0,'The original managed CLI did not close: '+diagnostics);return ended;
  };
  try{
    const announcement=await ready;clearTimeout(timer);
    need(announcement.workspaceId===workspace.workspaceId&&announcement.workspaceIdentity===workspace.sha256&&
      announcement.sourceSha256===source.sha256&&announcement.pid===child.pid,'The original managed launch identity differs.');
    const url=new URL(announcement.grantsWorkspace);
    const response=await fetch(url.origin+'/api/identity',{redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{authorization:'Bearer '+url.hash.slice('#session='.length)}});
    const live=await response.json();
    need(response.ok&&live.ok&&live.result.instanceId===announcement.instanceId&&
      live.result.workspaceId===workspace.workspaceId&&live.result.pid===child.pid,
      'The authenticated live managed workspace differs.');
    return {close,identity:{workspaceId:workspace.workspaceId,workspaceIdentity:workspace.sha256,
      sourceSha256:source.sha256,instanceId:announcement.instanceId,pid:child.pid}};
  }catch(error){clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exited.catch(()=>{});throw error;}
}
/** Continue the same operation directory, original packet and request IDs.
 * Customer payment remains in the companion publisher-native original journey. */
export async function runAgentNative({captureFile,directory,operationId='grants-agent-native'}={}){
  captureFile=resolve(captureFile);directory=resolve(directory);
  need(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(operationId),'Choose a stable original operation ID.');
  await mkdir(directory,{recursive:true,mode:0o700});
  const sourceBytes=await readFile(captureFile),packet=JSON.parse(sourceBytes),capture=readCaptureExport(packet);
  need(capture.coverage.searchComplete&&capture.coverage.detailsComplete,'Use a complete original source capture and all notice details.');
  const input={operationId,captureFile,captureSha256:sha(sourceBytes)},inputSha256=sha(json(input));
  const journalFile=join(directory,'agent-operation.json');
  let journal=await exists(journalFile)?JSON.parse(await readFile(journalFile,'utf8')):null;
  if(journal)need(journal.inputSha256===inputSha256,'Continue the same source and original operation.');
  journal??={schema:'stellar-forge.grantsgov-agent-native.v1',input,inputSha256,startedAt:time(),phase:'source',steps:{},exports:{}};
  const checkpoint=async(phase,value)=>{
    journal.phase=phase;journal.steps[phase]=value;journal.updatedAt=time();await save(journalFile,journal);
    process.stdout.write(json({operationId,phase,at:journal.updatedAt}));
  };
  const workspaceDirectory=join(directory,'workspace'),connectionFile=join(directory,'grants-connection.json');
  const merchantRoot=join(directory,'merchant-host'),configPath=join(merchantRoot,'merchant-mcp.json');
  if(journal.workspaceId)need(await exists(join(workspaceDirectory,'workspace.json')),'Restore the original retained workspace before continuing this operation.');
  const initial=await openGrantsWorkspace({directory:workspaceDirectory});
  try{
    const state=await initial.snapshot();
    if(journal.workspaceId)need(state.id===journal.workspaceId,'The original producer workspace identity differs.');
    journal.workspaceId=state.id;
  }finally{await initial.close();}
  await immutable(connectionFile,{schema:'stellar-forge.grantsgov-workspace-connection.v1',
    workspaces:{grants:{label:'Original grant opportunity research',directory:workspaceDirectory,
      sources:{original:{kind:'capture',file:captureFile,sha256:input.captureSha256,label:'Complete original Grants.gov source'}}}}});
  if(!await exists(configPath))await initializeGrantsWorkspaceMerchant({directory:merchantRoot,connection:connectionFile,
    name:'Grants.gov original agent receiving'});
  await checkpoint('source',{captureId:capture.captureId,sourceSignature:capture.sourceSignature,
    packetSha256:packet.sha256,rows:capture.opportunities.length,pages:capture.pages.length,details:capture.details.length});
  const token=randomBytes(32).toString('base64url'),environment={...process.env,GRANTS_NATIVE_MCP_TOKEN:token};
  let host,client,managed;
  const openHost=async()=>{
    host=await startMerchantMcp({configPath,port:journal.port??0,tokenEnv:'GRANTS_NATIVE_MCP_TOKEN',environment});
    const port=host.server.address().port;
    if(journal.port)need(port===journal.port,'Resume the original receiving endpoint.');
    journal.port=port;await save(journalFile,journal);
    client=await openMerchantFileClient({url:host.url,tokenEnv:'GRANTS_NATIVE_MCP_TOKEN',environment,
      errorPrefix:'GRANTS',clientName:'starforge-grantsgov-native'});
    return client.call('merchant_grants_open',{workspace:'grants'});
  };
  const call=(name,args={})=>client.call('merchant_grants_'+name,{workspace:'grants',...args});
  const request=suffix=>operationId+':'+suffix;
  try{
    const opened=await openHost();need(opened.workspaceId===journal.workspaceId,'The original MCP workspace identity differs.');
    const query=await call('query_save',{requestId:request('query'),expectedRevision:0,
      name:'Original AI opportunity acquisition',definition:capture.query});
    const imported=await call('source_import',{requestId:request('capture'),source:'original'});
    const edition=await call('edition_create',{requestId:request('full-edition'),captureId:imported.id,
      name:'Complete original grant opportunities'});
    const all=[];let offset=0,snapshot;
    while(true){
      const page=await call('opportunities',{editionId:edition.id,offset,limit:37,...(snapshot?{expectedSnapshot:snapshot}:{})});
      all.push(...page.items);snapshot=page.snapshot;if(page.nextOffset===null)break;offset=page.nextOffset;
    }
    need(all.length===capture.opportunities.length&&new Set(all.map(row=>row.opportunity_id)).size===all.length,
      'Every original opportunity must be received exactly once.');
    const opportunityId=(all.find(row=>row.opportunity_id==='363268')??all[0]).opportunity_id;
    const opportunity=await call('opportunity',{editionId:edition.id,opportunityId});
    const original=capture.opportunities.find(row=>row.opportunity_id===opportunityId);
    need(JSON.stringify(opportunity.opportunity)===JSON.stringify(original),'The complete selected notice differs from its retained source.');
    const review={status:'preparing',owner:'Commons grant research',
      fit:'Use the original funding notice to assemble a source-backed data engineering workshare and eligible applicant team.',
      eligibilityAssessment:'Retain the current notice eligibility narrative, original applicant types and program instructions for applicant selection.',
      partner:'Eligible applicant and implementation partner selected against the retained current program requirements.',
      workshare:'Deliver the original source acquisition, qualification workflow, immutable opportunity editions and reusable dataset merchant.',
      deliverables:'Complete source intake; grant opportunity inventory; full qualification; selected edition; native queryable dataset; source-backed workshare and complete portable receiving.',
      acceptance:'Every received opportunity and dataset field matches its original source. Qualification history, selections, exports and original workspace identity survive close and reopen.',
      schedule:'Use the original program deadline and the selected applicant delivery calendar.',
      fee:'Internal workshare qualification; partner terms are retained with the actual commercial case.',
      nextAction:'Join the original eligibility decision and application team to this complete engineering workshare.',
      notes:'Captured source signature '+capture.sourceSignature};
    const first=await call('review_save',{requestId:request('qualification'),editionId:edition.id,opportunityId,
      expectedRevision:0,review});
    const revised={...review,acceptance:review.acceptance+'\nThe receiver downloads every byte through the original MCP export manifest and verifies the final digest.'};
    const second=await call('review_save',{requestId:request('qualification-refine'),editionId:edition.id,
      opportunityId,expectedRevision:first.revision,review:revised});
    const selectedIds=[opportunityId,...all.filter(row=>row.opportunity_id!==opportunityId&&row.document_type==='forecast')
      .slice(0,2).map(row=>row.opportunity_id)];
    const selected=await call('edition_create',{requestId:request('selected-edition'),sourceEditionId:edition.id,
      parentId:edition.id,name:'Original application and forecast review',opportunityIds:selectedIds});
    const comparison=await call('compare',{before:edition.id,after:selected.id,limit:250});
    need(comparison.counts.changed===0&&comparison.counts.added===0&&comparison.counts.absent===all.length-selectedIds.length,
      'The original edition comparison differs.');
    const merchant=await call('merchant',{requestId:request('merchant'),editionId:edition.id});
    const rows=[];let cursor;
    do{
      const result=await call('preview',{merchantId:merchant.id,query:{limit:25,...(cursor?{cursor}:{})}});
      const page=result.body;
      need(result.status===200&&page.schema==='stellar-forge.dataset-page.v1','Read the original SF30 native dataset page.');
      rows.push(...page.rows);cursor=page.page.nextCursor;
    }while(cursor);
    need(rows.length===all.length&&new Set(rows.map(row=>row.opportunity_id)).size===all.length,'The original dataset cursor chain differs.');
    for(const row of rows){
      const original=capture.opportunities.find(value=>value.opportunity_id===row.opportunity_id);
      need(row.award_ceiling_raw===(original.award_ceiling_raw??null)&&row.closing_date_raw===(original.closing_date_raw??null),
        'A retained raw amount or closing date changed.');
    }
    await checkpoint('mcp-research',{workspaceId:opened.workspaceId,queryId:query.id,captureId:imported.id,
      editionId:edition.id,selectedEditionId:selected.id,opportunityId,reviewRevision:second.revision,
      merchantId:merchant.id,datasetSnapshot:merchant.dataset.snapshot,rows:rows.length,comparison:comparison.counts});
    const specs=[
      ['edition',{editionId:selected.id,includeReviews:true}],
      ['workshare-md',{editionId:edition.id,opportunityId}],
      ['workspace',{}],
    ];
    const prior=(await call('inventory',{kind:'exports',limit:250})).items;
    for(const [kind,selection]of specs){
      journal.exports[kind]??=prior.find(file=>file.kind===kind)??await call('export',{kind,...selection});
      await save(journalFile,journal);
    }
    const full=journal.exports.workspace,downloadDirectory=join(directory,'workspace-download');
    if(!journal.steps['resumable-receiving']){
      const controller=new AbortController();let interrupted=false;
      try{
        await downloadGrantsExport({url:host.url,workspace:'grants',exportId:full.id,directory:downloadDirectory,
          tokenEnv:'GRANTS_NATIVE_MCP_TOKEN',environment,chunkSize:65536,signal:controller.signal,
          onProgress:value=>{if(value.bytes>=65536&&value.bytes<value.total)controller.abort(Error('Original receiving checkpoint'));}});
      }catch(error){if(controller.signal.aborted)interrupted=true;else throw error;}
      need(interrupted,'The original full workspace should retain a partial download checkpoint.');
      await host.close();host=null;
      const reopened=await openHost();need(reopened.workspaceId===opened.workspaceId,'The original MCP workspace changed after reopen.');
      const received=await downloadGrantsExport({url:host.url,workspace:'grants',exportId:full.id,directory:downloadDirectory,
        tokenEnv:'GRANTS_NATIVE_MCP_TOKEN',environment,chunkSize:196608});
      need(received.state==='COMPLETE'&&received.resumed&&received.resumedBytes>=65536&&received.bytes===full.bytes,
        'The original complete download did not continue its retained prefix.');
      await checkpoint('resumable-receiving',received);
    }
    for(const kind of ['edition','workshare-md']){
      const file=journal.exports[kind];
      await downloadGrantsExport({url:host.url,workspace:'grants',exportId:file.id,directory:join(directory,kind+'-download'),
        tokenEnv:'GRANTS_NATIVE_MCP_TOKEN',environment});
    }
    const restored=await receiveGrantsExport({directory:downloadDirectory,workspaceDirectory:join(directory,'received-workspace'),
      requestId:request('receive-workspace')});
    need(restored.workspaceId===opened.workspaceId,'Whole receiving must preserve the original workspace ID.');
    const selectedReceived=await receiveGrantsExport({directory:join(directory,'edition-download'),
      workspaceDirectory:join(directory,'received-edition'),requestId:request('receive-edition')});
    const receiver=await openGrantsWorkspace({directory:join(directory,'received-workspace')});
    try{
      const read=await receiver.opportunity(edition.id,opportunityId);
      need(read.review.revision===second.revision&&read.review.data.acceptance===revised.acceptance,
        'The original qualification and its complete history did not survive receiving.');
      const page=await receiver.rows(edition.id,{limit:250});
      need(page.total===all.length,'The complete receiver opportunity count differs.');
    }finally{await receiver.close();}
    await checkpoint('source-receiving',{workspace:restored,edition:selectedReceived});
    await host.close();host=null;
    managed=await launchManaged(workspaceDirectory);const firstLaunch=managed.identity;await managed.close();managed=null;
    managed=await launchManaged(workspaceDirectory);const secondLaunch=managed.identity;
    need(firstLaunch.workspaceId===secondLaunch.workspaceId&&firstLaunch.workspaceIdentity===secondLaunch.workspaceIdentity&&
      firstLaunch.instanceId!==secondLaunch.instanceId,'Managed CLI reopen must retain its workspace and create its own new process instance.');
    await managed.close();managed=null;
    await checkpoint('managed-cli',{first:firstLaunch,reopened:secondLaunch});
    journal.status='COMPLETED';journal.completedAt=time();await save(journalFile,journal);
    return journal;
  }catch(error){
    journal.status='CONTINUATION_REQUIRED';journal.error={code:error.code??'GRANTS_AGENT_NATIVE_ERROR',message:error.message,at:time()};
    await save(journalFile,journal);throw error;
  }finally{
    await managed?.close().catch(()=>{});
    await host?.close();
  }
}
export async function main(argv=process.argv.slice(2)){
  const args=options(argv);
  const result=await runAgentNative({captureFile:args['--capture'],directory:args['--directory'],operationId:args['--operation']});
  process.stdout.write(json(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(json({error:{code:error.code??'GRANTS_AGENT_NATIVE_ERROR',message:error.message}}));process.exitCode=1;});
