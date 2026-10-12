// MIT. Receive one already-authored appraisal through the installed original transports.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readdir} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {readResearchHostFile,openResearchSource} from '../workspace-files.mjs';
import {writePortableFile} from '../portable.mjs';
import {privateDirectory,writeBytes,writeJson,jsonBytes,parseJson,exists,need,safeCode} from '../../node/store.mjs';
import {createRiskOfBiasClient} from './client.mjs';
import {unwrapRiskOfBiasRequest} from './cli.mjs';
import {riskOfBiasDigest,RISK_OF_BIAS_SCHEMA,RISK_OF_BIAS_OPERATION_SCHEMA,
  RISK_OF_BIAS_REPORT_SCHEMA,identifier} from './contracts.mjs';

export const RISK_OF_BIAS_TRANSPORT_RECEIVING_SCHEMA='sf88-research-risk-of-bias-transport-receiving/v1';
const HERE=dirname(fileURLToPath(import.meta.url));
const SELF=fileURLToPath(import.meta.url);
const CLI=resolve(HERE,'../workspace-cli.mjs');
const OWNED_CHILD=resolve(HERE,'../study-extraction-owned-child.py');
const MERCHANT_MODULE=new URL('../../../../../stellar-forge/mcp-merchant-operator/research-workspace.mjs',import.meta.url);
const FILE_LIMIT=256*1024*1024;
const REQUEST_LIMIT=16*1024*1024;
const FORMATS=Object.freeze([
  {format:'json',kind:'risk-json',extension:'json',contentType:'application/json'},
  {format:'csv',kind:'risk-csv',extension:'csv',contentType:'text/csv'},
  {format:'md',kind:'risk-markdown',extension:'md',contentType:'text/markdown'},
  {format:'html',kind:'risk-html',extension:'html',contentType:'text/html'},
]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>riskOfBiasDigest(a)===riskOfBiasDigest(b);
const clean=value=>JSON.parse(JSON.stringify(value));
const inside=(root,file)=>{
  const part=relative(root,file);
  return part!==''&&!part.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&
    part!=='..'&&!isAbsolute(part);
};
function check(signal){if(signal?.aborted)throw signal.reason??new Error('Receiving cancelled.');}
function absolute(value){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&!value.includes('\0'),
    'RISK_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  return value;
}
async function identity(file,kind){
  const source=await openResearchSource(absolute(file),FILE_LIMIT);
  try{return {file,bytes:source.bytes,sha256:source.sha256,...(kind?{kind}:{})};}
  finally{await source.close();}
}
async function verifyFile(value,root){
  need(value&&typeof value.file==='string'&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&
    /^[a-f0-9]{64}$/.test(value.sha256??'')&&(!root||inside(root,value.file)),
    'RISK_RECEIVING_ARTIFACT_INVALID');
  const actual=await identity(value.file);
  need(actual.bytes===value.bytes&&actual.sha256===value.sha256,'RISK_RECEIVING_ARTIFACT_CHANGED');
  return value;
}
async function keepBytes(file,bytes){
  if(await exists(file)){
    const original=await readResearchHostFile(file,bytes.length);
    need(original.equals(bytes),'RISK_RECEIVING_RETAINED_INPUT_CHANGED');
  }else await writeBytes(file,bytes,{exclusive:true});
  return {file,bytes:bytes.length,sha256:hash(bytes)};
}
async function keepJson(file,value){return keepBytes(file,jsonBytes(clean(value)));}
async function jsonAt(file,maximum=FILE_LIMIT){
  return parseJson(await readResearchHostFile(file,maximum));
}
async function maybeJson(file){return await exists(file)?jsonAt(file):null;}
async function memo(directory,name,work){
  const file=join(directory,name+'.json'),original=await maybeJson(file);
  if(original!==null)return {value:original,artifact:await identity(file,name)};
  const value=clean(await work()),artifact=await keepJson(file,value);
  return {value,artifact:{...artifact,kind:name}};
}
function selected(selection,section='overview'){
  return {reviewId:selection.reviewId,assessmentId:selection.assessmentId,
    assessmentEditionId:selection.assessmentEditionId,revision:selection.revision,section,offset:0,limit:100};
}
function exportSelection(selection,format){
  return {reviewId:selection.reviewId,assessmentId:selection.assessmentId,
    assessmentEditionId:selection.assessmentEditionId,revision:selection.revision,section:'overview',format};
}
function checkView(value,selection,section='overview',offset=0){
  need(value?.schema===RISK_OF_BIAS_SCHEMA&&value.dossierId===selection.dossierId&&
    value.revision===selection.revision&&value.section===section&&value.reviewId===selection.reviewId&&
    value.assessmentId===selection.assessmentId&&value.assessment?.editionId===selection.assessmentEditionId&&
    value.offset===offset&&value.limit===100&&Array.isArray(value.items)&&
    Number.isSafeInteger(value.total)&&value.total>=offset&&value.items.length<=100&&
    value.offset+value.items.length<=value.total&&
    (value.nextOffset===null?offset+value.items.length===value.total:
      value.nextOffset===offset+value.items.length&&value.nextOffset>offset&&value.nextOffset<value.total),
    'RISK_RECEIVING_VIEW_CHANGED');
  return value;
}
function checkOperation(operation,selection,request){
  const requestSha256=riskOfBiasDigest(request);
  need(operation?.schema===RISK_OF_BIAS_OPERATION_SCHEMA&&operation.dossierId===selection.dossierId&&
    operation.reviewId===selection.reviewId&&operation.requestId===request.requestId&&
    operation.requestSha256===requestSha256&&equal(operation.request,request)&&
    operation.originalRevision===request.expectedRevision&&operation.revision===request.expectedRevision+1&&
    operation.revision<=selection.revision&&operation.action===request.action,
    'RISK_RECEIVING_ORIGINAL_OPERATION_REQUIRED');
  const {sha256,...body}=operation;
  need(sha256===riskOfBiasDigest(body),'RISK_RECEIVING_OPERATION_CHANGED');
  return operation;
}
function checkReplay(value,operation,request,selection){
  checkOperation(operation,selection,request);
  need(value?.duplicate===true&&value.dossier?.id===selection.dossierId&&
    Number.isSafeInteger(value.dossier.revision)&&value.dossier.revision>=operation.revision&&
    equal(value.operation,operation),'RISK_RECEIVING_REPLAY_CHANGED');
  return value;
}
function checkReport(value,selection){
  need(value?.schema===RISK_OF_BIAS_REPORT_SCHEMA&&value.dossierId===selection.dossierId&&
    value.revision===selection.revision&&value.selection?.reviewId===selection.reviewId&&
    value.selection?.assessmentId===selection.assessmentId&&
    value.selection?.assessmentEditionId===selection.assessmentEditionId&&value.selection?.actorId===null,
    'RISK_RECEIVING_REPORT_CHANGED');
  const {sha256,...body}=value;
  need(sha256===riskOfBiasDigest(body),'RISK_RECEIVING_REPORT_DIGEST_CHANGED');
}
async function restoreArtifacts(result,root){
  need(result?.state==='COMPLETE'&&Array.isArray(result.artifacts),'RISK_RECEIVING_RESULT_INVALID');
  for(const item of result.artifacts)await verifyFile(item,root);
  return result;
}
function withSignal(fetch,signal){
  return (url,options={})=>{
    check(signal);
    return fetch(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),
      ...(signal?[signal]:[])])});
  };
}
/** Preserve the exact stdout/stderr of a real, joined original child. */
async function originalChild({directory,args,node,python,signal}){
  check(signal);await privateDirectory(directory);
  const intent={schema:'sf88-research-owned-child-receiving/v1',node,python,args,wrapper:OWNED_CHILD};
  await keepJson(join(directory,'intent.json'),intent);
  const accepted=await maybeJson(join(directory,'accepted.json'));
  if(accepted){
    need(equal(accepted.intent,intent)&&accepted.exitCode===0,'RISK_RECEIVING_CHILD_CHANGED');
    await verifyFile(accepted.stdout,directory);await verifyFile(accepted.stderr,directory);
    return {value:await jsonAt(accepted.stdout.file),receipt:accepted};
  }
  // A completed original child is recoverable even if publishing accepted.json was interrupted.
  const names=(await readdir(directory)).filter(name=>/^attempt-[0-9]{4}$/.test(name)).sort();
  for(const name of names){
    const result=await maybeJson(join(directory,name,'result.json'));
    if(result?.exitCode===0){
      need(equal(result.intent,intent),'RISK_RECEIVING_CHILD_CHANGED');
      await verifyFile(result.stdout,directory);await verifyFile(result.stderr,directory);
      await keepJson(join(directory,'accepted.json'),result);
      return {value:await jsonAt(result.stdout.file),receipt:result};
    }
  }
  const attempt=await privateDirectory(join(directory,'attempt-'+String(names.length+1).padStart(4,'0')));
  await keepJson(join(attempt,'request.json'),intent);
  const child=spawn(python,[OWNED_CHILD,node,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let timer=null,spawnError=null,wasAborted=false;
  const stop=()=>{
    wasAborted=true;
    if(child.exitCode===null&&child.signalCode===null){
      child.kill('SIGTERM');
      timer??=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},5000);
      timer.unref?.();
    }
  };
  signal?.addEventListener('abort',stop,{once:true});
  const closed=new Promise(resolve=>{
    child.once('error',error=>{spawnError=error;});
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
  if(signal?.aborted)stop();
  const bounded=stream=>Readable.from((async function*(){
    let bytes=0;
    for await(const chunk of stream){
      bytes+=chunk.length;need(bytes<=FILE_LIMIT,'RISK_RECEIVING_CHILD_OUTPUT_LIMIT');yield chunk;
    }
  })());
  const out=writePortableFile(join(attempt,'stdout.json'),{
    body:bounded(child.stdout),filename:'stdout.json',contentType:'application/json',
  }).catch(error=>{stop();throw error;});
  const err=writePortableFile(join(attempt,'stderr.txt'),{
    body:bounded(child.stderr),filename:'stderr.txt',contentType:'text/plain',
  }).catch(error=>{stop();throw error;});
  const settled=await Promise.allSettled([closed,out,err]);
  signal?.removeEventListener('abort',stop);if(timer)clearTimeout(timer);
  const failure=settled.find(item=>item.status==='rejected');
  if(failure)throw failure.reason;
  const outcome=settled[0].value;
  const receipt={intent,exitCode:outcome.code,exitSignal:outcome.signal,
    stdout:settled[1].value,stderr:settled[2].value,
    ...(spawnError?{spawnError:{code:safeCode(spawnError.code,'CHILD_START_FAILED')}}:{}),
    cancelled:wasAborted,completedAt:new Date().toISOString()};
  await keepJson(join(attempt,'result.json'),receipt);
  check(signal);
  need(!spawnError&&outcome.code===0,'RISK_RECEIVING_ORIGINAL_CHILD_FAILED');
  await keepJson(join(directory,'accepted.json'),receipt);
  return {value:await jsonAt(receipt.stdout.file),receipt};
}
function childArtifacts(child,label){
  return [{...child.receipt.stdout,kind:label+'-stdout'},{...child.receipt.stderr,kind:label+'-stderr'}];
}
function commandOptions(selection,connectionFile,workspaceDirectory){
  return ['--connection-file',connectionFile,'--directory',workspaceDirectory,'--id',selection.dossierId];
}
function viewOptions(selection){
  return ['--review',selection.reviewId,'--assessment',selection.assessmentId,
    '--assessment-edition',selection.assessmentEditionId,'--revision',String(selection.revision),
    '--section','overview','--offset','0','--limit','100'];
}

/**
 * Complete the receiving of a saved appraisal; every mutation below replays an
 * operation already present in the selected original native dossier revision.
 * The caller retains ownership of the original listener and programme.
 */
export async function receiveRiskOfBiasTransports({
  connectionFile,workspaceDirectory,expectedWorkspaceId,dossierId,reviewId,
  assessmentId,assessmentEditionId,revision,replayRequestFile,runDirectory,signal,
  node=process.execPath,python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3',
}={}){
  check(signal);
  [connectionFile,workspaceDirectory,replayRequestFile,runDirectory].forEach(absolute);
  need(/^research_[a-f0-9]{64}$/.test(expectedWorkspaceId??''),'RISK_RECEIVING_WORKSPACE_REQUIRED');
  [dossierId,reviewId,assessmentId,assessmentEditionId].forEach(value=>identifier(value));
  need(Number.isSafeInteger(revision)&&revision>=1&&typeof node==='string'&&node.length>0&&
    typeof python==='string'&&python.length>0,'RISK_RECEIVING_REVISION_REQUIRED');
  await privateDirectory(runDirectory);
  const selection={workspaceId:expectedWorkspaceId,dossierId,reviewId,assessmentId,assessmentEditionId,revision};
  const raw=await readResearchHostFile(replayRequestFile,REQUEST_LIMIT);
  const request=unwrapRiskOfBiasRequest(parseJson(raw),{workspaceId:expectedWorkspaceId,dossierId});
  need(request.expectedRevision<revision,'RISK_RECEIVING_COMMITTED_REQUEST_REQUIRED');
  const binding={schema:RISK_OF_BIAS_TRANSPORT_RECEIVING_SCHEMA,selection,connectionFile,workspaceDirectory,
    requestFileSha256:hash(raw),requestSha256:riskOfBiasDigest(request),requestId:request.requestId,node,python};
  const bindingArtifact=await keepJson(join(runDirectory,'input.json'),binding);
  const requestArtifact=await keepBytes(join(runDirectory,'original-request.json'),raw);
  const completed=await maybeJson(join(runDirectory,'result.json'));
  if(completed){
    need(equal(completed.binding,binding),'RISK_RECEIVING_TARGET_CHANGED');
    return restoreArtifacts(completed,runDirectory);
  }
  const artifacts=[{...bindingArtifact,kind:'transport-selection'},
    {...requestArtifact,kind:'original-replay-request'}],readbacks=[],replays=[];
  const sdkDirectory=await privateDirectory(join(runDirectory,'sdk'));
  const client=new ResearchWorkspaceClient({connectionFile,directory:workspaceDirectory,expectedWorkspaceId},
    {fetch:withSignal(globalThis.fetch.bind(globalThis),signal)});
  const risk=createRiskOfBiasClient(client);
  let operation,view,sdkExports=[];
  try{
    const status=await client.status();
    need(status.workspaceId===expectedWorkspaceId&&status.api?.riskOfBiasReview===true,
      'RISK_RECEIVING_ORIGINAL_LISTENER_REQUIRED');
    const metadata=await client.metadata(dossierId,{revision});
    need(metadata.id===dossierId&&metadata.revision===revision,'RISK_RECEIVING_DOSSIER_CHANGED');
    const firstStatus=await memo(sdkDirectory,'original-listener-status',async()=>status);
    need(firstStatus.value.workspaceId===expectedWorkspaceId&&firstStatus.value.api?.riskOfBiasReview===true,
      'RISK_RECEIVING_ORIGINAL_LISTENER_REQUIRED');
    artifacts.push(firstStatus.artifact,
      {...await keepJson(join(sdkDirectory,'selected-metadata.json'),metadata),kind:'typed-selected-metadata'});
    const originalView=await memo(sdkDirectory,'overview',()=>risk.view(dossierId,selected(selection)));
    view=checkView(originalView.value,selection);artifacts.push(originalView.artifact);
    readbacks.push({transport:'ResearchWorkspaceClient/risk-of-bias facade',kind:'overview',
      revision,sha256:riskOfBiasDigest(view),file:originalView.artifact.file});
    const matches=[];
    let offset=0,total=null,priorRevision=0;
    do{
      check(signal);
      const page=await memo(sdkDirectory,'operations-'+String(offset).padStart(6,'0'),
        ()=>risk.view(dossierId,{...selected(selection,'operations'),offset}));
      const value=checkView(page.value,selection,'operations',offset);artifacts.push(page.artifact);
      if(total===null)total=value.total;else need(total===value.total,'RISK_RECEIVING_PAGE_CHANGED');
      for(const item of value.items){
        need(Number.isSafeInteger(item.revision)&&item.revision>priorRevision&&item.revision<=revision,
          'RISK_RECEIVING_OPERATION_ORDER_CHANGED');
        priorRevision=item.revision;
        if(item.requestId===request.requestId)matches.push(item);
      }
      offset=value.nextOffset;
    }while(offset!==null);
    need(matches.length===1,'RISK_RECEIVING_COMMITTED_REQUEST_REQUIRED');
    operation=checkOperation(matches[0],selection,request);
    artifacts.push({...await keepJson(join(runDirectory,'original-operation.json'),operation),
      kind:'original-committed-operation'});
    const replay=await memo(sdkDirectory,'same-request-replay',()=>risk.review(dossierId,request));
    checkReplay(replay.value,operation,request,selection);artifacts.push(replay.artifact);
    replays.push({transport:'typed-client',requestId:request.requestId,operationId:operation.id,
      operationSha256:operation.sha256,originalRevision:operation.originalRevision,
      revision:operation.revision,duplicate:true,receiptFile:replay.artifact.file});
    for(const spec of FORMATS){
      check(signal);
      const target=join(sdkDirectory,'appraisal-r'+revision+'.'+spec.extension);
      const received=await memo(sdkDirectory,'export-'+spec.format,async()=>{
        let destination=target,original=null;
        if(await exists(target)){
          original=await identity(target);
          destination=join(sdkDirectory,'appraisal-r'+revision+'-recovery-'+randomUUID()+'.'+spec.extension);
        }
        const native=await risk.export(dossierId,{
          ...exportSelection(selection,spec.format),file:destination,signal,
        });
        await verifyFile(native,runDirectory);
        if(original)need(native.bytes===original.bytes&&native.sha256===original.sha256,
          'RISK_RECEIVING_INTERRUPTED_EXPORT_CHANGED');
        return {native,artifact:{...native,kind:'typed-appraisal-'+spec.format},
          ...(original?{recoveredOriginal:original}:{})};
      });
      const item=received.value;
      need(item.native?.revision===revision&&item.artifact?.file===item.native?.file&&
        item.artifact?.sha256===item.native?.sha256&&item.artifact?.bytes===item.native?.bytes,
        'RISK_RECEIVING_EXPORT_CHANGED');
      await verifyFile(item.artifact,runDirectory);
      if(item.recoveredOriginal)await verifyFile(item.recoveredOriginal,runDirectory);
      if(spec.format==='json')checkReport(await jsonAt(item.artifact.file),selection);
      artifacts.push(received.artifact,item.artifact);
      if(item.recoveredOriginal)artifacts.push({...item.recoveredOriginal,kind:'recovered-original-sdk-export'});
      sdkExports.push({...item.artifact,format:spec.format,kind:spec.kind});
      readbacks.push({transport:'typed-client',kind:spec.kind,revision,bytes:item.artifact.bytes,
        sha256:item.artifact.sha256,file:item.artifact.file});
    }
  }finally{await client.close();}
  check(signal);
  const common=commandOptions(selection,connectionFile,workspaceDirectory);
  const cliView=await originalChild({
    directory:join(runDirectory,'cli-view'),node,python,signal,
    args:[CLI,'risk-view',...common,...viewOptions(selection)],
  });
  checkView(cliView.value,selection);
  need(equal(cliView.value,view),'RISK_RECEIVING_CLI_VIEW_CHANGED');
  artifacts.push(...childArtifacts(cliView,'cli-view'));
  readbacks.push({transport:'workspace-cli risk-view',revision,sha256:riskOfBiasDigest(cliView.value),
    file:cliView.receipt.stdout.file});
  const cliReplay=await originalChild({
    directory:join(runDirectory,'cli-replay'),node,python,signal,
    args:[CLI,'risk-review',...common,'--input',requestArtifact.file,'--sha256',requestArtifact.sha256],
  });
  checkReplay(cliReplay.value,operation,request,selection);
  artifacts.push(...childArtifacts(cliReplay,'cli-replay'));
  replays.push({transport:'workspace-cli risk-review',requestId:request.requestId,operationId:operation.id,
    operationSha256:operation.sha256,originalRevision:operation.originalRevision,
    revision:operation.revision,duplicate:true,receiptFile:cliReplay.receipt.stdout.file});
  const merchantDirectory=await privateDirectory(join(runDirectory,'merchant'));
  const merchantInput={schema:RISK_OF_BIAS_TRANSPORT_RECEIVING_SCHEMA,selection,connectionFile,workspaceDirectory,
    requestFile:requestArtifact.file,requestFileSha256:requestArtifact.sha256,
    requestSha256:binding.requestSha256,operation,viewSha256:riskOfBiasDigest(view),
    exports:sdkExports,runDirectory:merchantDirectory};
  const merchantInputFile=join(runDirectory,'merchant-input.json');
  artifacts.push({...await keepJson(merchantInputFile,merchantInput),kind:'merchant-original-input'});
  const merchant=await originalChild({
    directory:join(runDirectory,'merchant-child'),node,python,signal,
    args:[SELF,'--merchant-receive',merchantInputFile],
  });
  need(merchant.value?.state==='COMPLETE'&&equal(merchant.value.selection,selection)&&
    merchant.value.requestId===request.requestId&&merchant.value.operationId===operation.id,
    'RISK_RECEIVING_MERCHANT_CHANGED');
  await restoreArtifacts(merchant.value,runDirectory);
  artifacts.push(...childArtifacts(merchant,'merchant-child'),...merchant.value.artifacts);
  replays.push(merchant.value.replay);readbacks.push(...merchant.value.readbacks);
  const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
  const lines=[
    '# Appraisal transport receiving','',
    'This directory contains the complete native appraisal received from the original Research listener.',
    'The SDK, installed command, and Merchant attachment used the same frozen dossier selection.','',
    '## Original selection','',
    '- Workspace: '+expectedWorkspaceId,
    '- Dossier: '+dossierId+' at revision '+revision,
    '- Review: '+reviewId,
    '- Assessment: '+assessmentId,
    '- Assessment edition: '+assessmentEditionId,
    '- Original saved request: '+request.requestId,
    '- Original operation: '+operation.id+' at revision '+operation.revision,
    '- Original operation SHA-256: '+operation.sha256,'',
    'All three mutation calls returned the same already-committed operation with duplicate=true.',
    'Their complete replies remain beside the original request file.','',
    '## Open the received appraisal','',
    'The sdk directory holds JSON, CSV, Markdown and HTML exported by the original typed client.',
    'The merchant directory holds each complete file read through the original retained-file reader.',
    'Each Merchant export has the same byte count and SHA-256 as its SDK counterpart.','',
    '| Format | Bytes | SHA-256 |','| --- | ---: | --- |',
    ...sdkExports.map(item=>'| '+item.format+' | '+item.bytes+' | '+item.sha256+' |'),'',
    'Open the HTML file in a browser, use CSV for the complete selected tables, or inspect JSON for',
    'source passages, independent submissions, judgments, disagreements, adjudication and retained operations.','',
    '## Read the same saved selection through the installed command','',
    'Run the command against the retained private connection file and the same original workspace directory.','',
    '~~~sh',
    [node,CLI,'risk-view',...common,...viewOptions(selection)].map(quote).join(' '),
    '~~~','',
    '## Recover the original request','',
    'The retained original-request.json is the unchanged input. Its complete source digest is',
    requestArtifact.sha256+'. The command below recovers that operation before checking a later live revision.','',
    '~~~sh',
    [node,CLI,'risk-review',...common,'--input',requestArtifact.file,'--sha256',requestArtifact.sha256].map(quote).join(' '),
    '~~~','',
    'Keep the original private connection file private. All receiving paths retain workspace and dossier identities.',
    'The consumer closes its own clients, attachment, file readers and child processes; the original listener',
    'continues under its programme owner. The parent programme also receives the complete editable dossier',
    'through its original portable JSON and gzip workspace paths.','',
  ];
  const guide={...await keepBytes(join(runDirectory,'RECEIVING.md'),Buffer.from(lines.join('\n'))),
    kind:'appraisal-transport-receiving-guide'};
  artifacts.push(guide);
  const unique=[...new Map(artifacts.map(item=>[item.file,clean(item)])).values()];
  for(const artifact of unique)await verifyFile(artifact,runDirectory);
  const result={schema:RISK_OF_BIAS_TRANSPORT_RECEIVING_SCHEMA,state:'COMPLETE',binding,selection,
    requestId:request.requestId,operationId:operation.id,operationSha256:operation.sha256,
    artifacts:unique,replays,readbacks,receivingGuide:guide,completedAt:new Date().toISOString()};
  await keepJson(join(runDirectory,'result.json'),result);
  return result;
}

function merchantSelection(selection,format){
  return {dossierId:selection.dossierId,...exportSelection(selection,format)};
}
function checkExportReceipt(value,selection,spec,expected,{inventory=false}={}){
  const wanted=merchantSelection(selection,spec.format);
  need(value?.schema==='stellar-forge.research-export-receipt.v1'&&
    (inventory?value.workspace===undefined&&value.state===undefined&&!value.verification:
      value.workspace==='appraisal'&&value.state==='RETAINED')&&
    value.workspaceId===selection.workspaceId&&value.kind===spec.kind&&
    value.exportId===expected.sha256&&value.bytes===expected.bytes&&typeof value.receiptId==='string'&&
    typeof value.sourceFilename==='string'&&typeof value.contentType==='string'&&
    Object.entries(wanted).every(([key,item])=>value.selection?.[key]===item)&&
    value.selection?.actorId===undefined,'RISK_RECEIVING_MERCHANT_EXPORT_CHANGED');
  return value;
}
async function retainedInventory(merchant,selection,signal){
  const rows=[];let offset=0,snapshot=null,total=null;
  do{
    check(signal);
    const value=await merchant.call('merchant_research_exports',{
      workspace:'appraisal',dossierId:selection.dossierId,offset,limit:100,
      ...(snapshot?{snapshot}:{}),
    });
    need(value.workspace==='appraisal'&&value.offset===offset&&value.limit===100&&
      typeof value.snapshot==='string'&&Array.isArray(value.items)&&Number.isSafeInteger(value.total)&&
      value.items.length<=100&&offset+value.items.length<=value.total&&
      (snapshot===null||snapshot===value.snapshot)&&(total===null||total===value.total),
      'RISK_RECEIVING_MERCHANT_INVENTORY_CHANGED');
    snapshot=value.snapshot;total=value.total;rows.push(...value.items);
    if(value.next===null){
      need(rows.length===total,'RISK_RECEIVING_MERCHANT_INVENTORY_CHANGED');break;
    }
    need(value.next?.offset===offset+value.items.length&&value.next.offset>offset&&
      value.next.offset<total&&value.next.limit===100&&value.next.snapshot===snapshot,
      'RISK_RECEIVING_MERCHANT_INVENTORY_CHANGED');
    offset=value.next.offset;
  }while(true);
  return {rows,snapshot};
}
async function receiveMerchantFile(merchant,selection,spec,receipt,expected,directory,signal){
  await privateDirectory(directory);
  const intent={schema:'sf88-research-appraisal-retained-file-receiving/v1',selection,
    receiptId:receipt.receiptId,exportId:receipt.exportId,kind:spec.kind,
    filename:receipt.sourceFilename,contentType:receipt.contentType,
    expected:{bytes:expected.bytes,sha256:expected.sha256}};
  const intentFile=join(directory,'intent.json');await keepJson(intentFile,intent);
  const accepted=await maybeJson(join(directory,'result.json'));
  if(accepted){
    need(equal(accepted.intent,intent)&&accepted.state==='COMPLETE','RISK_RECEIVING_FILE_RECEIPT_CHANGED');
    await verifyFile(accepted.artifact,directory);
    need(accepted.artifact.bytes===expected.bytes&&accepted.artifact.sha256===expected.sha256,
      'RISK_RECEIVING_MERCHANT_FILE_CHANGED');
    return accepted;
  }
  const canonical=join(directory,'appraisal-r'+selection.revision+'.'+spec.extension);
  const earlier=await exists(canonical)?await identity(canonical):null;
  const destination=earlier?join(directory,'appraisal-r'+selection.revision+'-recovery-'+randomUUID()+'.'+spec.extension):canonical;
  if(earlier)need(earlier.bytes===expected.bytes&&earlier.sha256===expected.sha256,
    'RISK_RECEIVING_INTERRUPTED_FILE_CHANGED');
  let readId=null,offset=0,lastReadId=null;
  const ranges=[];
  const body=Readable.from((async function*(){
    while(true){
      check(signal);
      const value=await merchant.call('merchant_research_file_read',{
        workspace:'appraisal',kind:spec.kind,exportId:receipt.exportId,
        ...(readId?{readId}:{}),offset,limit:65536,
      });
      need(typeof value.readId==='string'&&value.readId.length>0&&
        (readId===null||readId===value.readId)&&value.file?.sha256===expected.sha256&&
        value.file?.bytes===expected.bytes&&value.file?.name===receipt.sourceFilename&&
        value.file?.contentType===receipt.contentType&&value.offset===offset&&
        value.encoding==='base64'&&typeof value.data==='string'&&
        Number.isSafeInteger(value.bytesRead)&&value.bytesRead>=0,
        'RISK_RECEIVING_MERCHANT_RANGE_CHANGED');
      const bytes=Buffer.from(value.data,'base64');
      need(bytes.toString('base64')===value.data&&bytes.length===value.bytesRead&&
        bytes.length<=65536&&offset+bytes.length<=expected.bytes&&
        (value.nextOffset===null?offset+bytes.length===expected.bytes:
          value.nextOffset===offset+bytes.length&&value.nextOffset>offset&&value.nextOffset<expected.bytes),
        'RISK_RECEIVING_MERCHANT_RANGE_CHANGED');
      readId=value.readId;lastReadId=readId;
      ranges.push({readId,offset,bytes:bytes.length,sha256:hash(bytes),nextOffset:value.nextOffset});
      const finished=value.nextOffset===null;
      if(finished)readId=null;
      offset+=bytes.length;yield bytes;
      if(finished)break;
    }
  })());
  let native;
  try{
    native=await writePortableFile(destination,{
      body,filename:receipt.sourceFilename,contentType:receipt.contentType,
    });
  }finally{
    body.destroy();
    if(readId!==null)await merchant.call('merchant_research_file_release',{workspace:'appraisal',readId});
  }
  need(native.bytes===expected.bytes&&native.sha256===expected.sha256&&offset===expected.bytes,
    'RISK_RECEIVING_MERCHANT_FILE_CHANGED');
  const artifact={...native,kind:'merchant-received-'+spec.format};
  if(spec.format==='json')checkReport(await jsonAt(artifact.file),selection);
  const result={schema:intent.schema,state:'COMPLETE',intent,artifact,ranges,readId:lastReadId,
    ...(earlier?{recoveredOriginal:earlier}:{}),completedAt:new Date().toISOString()};
  await keepJson(join(directory,'result.json'),result);return result;
}
/** Child-only use: actual MerchantResearchWorkspaces with an owned attachment. */
async function receiveMerchant(input,{signal}={}){
  need(input?.schema===RISK_OF_BIAS_TRANSPORT_RECEIVING_SCHEMA,'RISK_RECEIVING_MERCHANT_INPUT_INVALID');
  const {selection,connectionFile,workspaceDirectory,runDirectory}=input;
  [connectionFile,workspaceDirectory,runDirectory,input.requestFile].forEach(absolute);
  await privateDirectory(runDirectory);
  need(/^research_[a-f0-9]{64}$/.test(selection?.workspaceId??'')&&
    Array.isArray(input.exports)&&input.exports.length===FORMATS.length,
    'RISK_RECEIVING_MERCHANT_INPUT_INVALID');
  const original=await readResearchHostFile(input.requestFile,REQUEST_LIMIT,{sha256:input.requestFileSha256});
  const request=unwrapRiskOfBiasRequest(parseJson(original),{workspaceId:selection.workspaceId,dossierId:selection.dossierId});
  need(riskOfBiasDigest(request)===input.requestSha256,'RISK_RECEIVING_REQUEST_CHANGED');
  const operation=checkOperation(input.operation,selection,request);
  const bindingSha256=riskOfBiasDigest(input);
  await keepJson(join(runDirectory,'input.json'),input);
  const completed=await maybeJson(join(runDirectory,'result.json'));
  if(completed){
    need(completed.bindingSha256===bindingSha256,'RISK_RECEIVING_MERCHANT_INPUT_CHANGED');
    return restoreArtifacts(completed,runDirectory);
  }
  const {MerchantResearchWorkspaces}=await import(MERCHANT_MODULE.href);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=withSignal(originalFetch.bind(globalThis),signal);
  const merchant=new MerchantResearchWorkspaces({
    researchWorkspaces:{workspaces:{appraisal:{label:'Original appraisal receiving',
      consoleUrlFile:connectionFile,directory:workspaceDirectory,sources:{}}}},
    exportsDirectory:await privateDirectory(join(runDirectory,'retained')),
  });
  let attachment=null,primaryError=null,result=null;
  const artifacts=[],readbacks=[];
  try{
    check(signal);
    attachment=await merchant.call('merchant_research_attach',{workspace:'appraisal'});
    need(attachment.state==='ATTACHED'&&attachment.listenerOwnership==='ORIGINAL_APPLICATIONS_WORKSPACE'&&
      attachment.status?.workspaceId===selection.workspaceId&&attachment.status?.api?.riskOfBiasReview===true,
      'RISK_RECEIVING_MERCHANT_WORKSPACE_CHANGED');
    const attachments=await privateDirectory(join(runDirectory,'attachments'));
    artifacts.push({...await keepJson(join(attachments,attachment.attachmentId+'.json'),attachment),
      kind:'merchant-original-attachment'});
    const view=await memo(runDirectory,'overview',()=>merchant.call('merchant_research_risk_view',{
      workspace:'appraisal',dossierId:selection.dossierId,...selected(selection),
    }));
    checkView(view.value,selection);
    need(riskOfBiasDigest(view.value)===input.viewSha256,'RISK_RECEIVING_MERCHANT_VIEW_CHANGED');
    artifacts.push(view.artifact);
    readbacks.push({transport:'MerchantResearchWorkspaces/risk-view',kind:'overview',
      revision:selection.revision,sha256:input.viewSha256,file:view.artifact.file});
    const replayArgs={workspace:'appraisal',dossierId:selection.dossierId,
      requestId:request.requestId,expectedRevision:request.expectedRevision,actor:request.actor,
      action:request.action,...(request.reviewId===undefined?{}:{reviewId:request.reviewId}),
      dataJson:JSON.stringify(request.data)};
    artifacts.push({...await keepJson(join(runDirectory,'same-request.json'),replayArgs),
      kind:'merchant-original-replay-request'});
    const replay=await memo(runDirectory,'same-request-replay',
      ()=>merchant.call('merchant_research_risk_review',replayArgs));
    checkReplay(replay.value,operation,request,selection);artifacts.push(replay.artifact);
    const replayReceipt={transport:'MerchantResearchWorkspaces/risk-review',
      requestId:request.requestId,operationId:operation.id,operationSha256:operation.sha256,
      originalRevision:operation.originalRevision,revision:operation.revision,duplicate:true,
      receiptFile:replay.artifact.file};
    const inventory=await retainedInventory(merchant,selection,signal);
    for(const spec of FORMATS){
      check(signal);
      const expected=input.exports.find(value=>value.format===spec.format&&value.kind===spec.kind);
      need(expected&&expected.revision===selection.revision,'RISK_RECEIVING_EXPORT_SELECTION_CHANGED');
      await verifyFile(expected,dirname(runDirectory));
      const exportArgs={workspace:'appraisal',dossierId:selection.dossierId,kind:spec.kind,
        reviewId:selection.reviewId,assessmentId:selection.assessmentId,
        assessmentEditionId:selection.assessmentEditionId,revision:selection.revision,
        riskSection:'overview',expectedSha256:expected.sha256};
      const exportDirectory=await privateDirectory(join(runDirectory,'export-'+spec.format));
      artifacts.push({...await keepJson(join(exportDirectory,'intent.json'),exportArgs),
        kind:'merchant-export-'+spec.format+'-intent'});
      let savedReceipt=await maybeJson(join(exportDirectory,'receipt.json'));
      if(!savedReceipt){
        const existing=inventory.rows.find(value=>{
          try{checkExportReceipt(value,selection,spec,expected,{inventory:true});return true;}catch{return false;}
        });
        savedReceipt=existing?{source:'merchant_research_exports',snapshot:inventory.snapshot,receipt:existing}:
          {source:'merchant_research_export',receipt:await merchant.call('merchant_research_export',exportArgs)};
        checkExportReceipt(savedReceipt.receipt,selection,spec,expected,
          {inventory:savedReceipt.source==='merchant_research_exports'});
        await keepJson(join(exportDirectory,'receipt.json'),savedReceipt);
      }
      need(['merchant_research_exports','merchant_research_export'].includes(savedReceipt.source),
        'RISK_RECEIVING_MERCHANT_RECEIPT_SOURCE_CHANGED');
      const receipt=checkExportReceipt(savedReceipt.receipt,selection,spec,expected,
        {inventory:savedReceipt.source==='merchant_research_exports'});
      artifacts.push({...await identity(join(exportDirectory,'receipt.json')),
        kind:'merchant-export-'+spec.format+'-receipt'});
      const readDirectory=await privateDirectory(join(runDirectory,'received-'+spec.format));
      const received=await receiveMerchantFile(merchant,selection,spec,receipt,expected,readDirectory,signal);
      artifacts.push(received.artifact,
        {...await identity(join(readDirectory,'intent.json')),kind:'merchant-read-'+spec.format+'-intent'},
        {...await identity(join(readDirectory,'result.json')),kind:'merchant-read-'+spec.format+'-receipt'});
      if(received.recoveredOriginal)artifacts.push({...received.recoveredOriginal,kind:'recovered-original-merchant-export'});
      readbacks.push({transport:'MerchantResearchWorkspaces/retained-file-reader',kind:spec.kind,
        revision:selection.revision,receiptId:receipt.receiptId,exportId:receipt.exportId,
        receiptSource:savedReceipt.source,readId:received.readId,ranges:received.ranges.length,bytes:received.artifact.bytes,
        sha256:received.artifact.sha256,file:received.artifact.file,
        equalsTypedExport:{file:expected.file,bytes:expected.bytes,sha256:expected.sha256}});
    }
    result={schema:RISK_OF_BIAS_TRANSPORT_RECEIVING_SCHEMA,state:'COMPLETE',bindingSha256,selection,
      requestId:request.requestId,operationId:operation.id,operationSha256:operation.sha256,
      artifacts,replay:replayReceipt,readbacks,completedAt:new Date().toISOString()};
  }catch(error){primaryError=error;throw error;}
  finally{
    const failures=[];
    if(attachment){
      try{
        const detached=await merchant.call('merchant_research_detach',{
          workspace:'appraisal',attachmentId:attachment.attachmentId,
        });
        need(detached.state==='DETACHED','RISK_RECEIVING_MERCHANT_DETACH_CHANGED');
      }catch(error){failures.push(error);}
    }
    try{await merchant.close();}catch(error){failures.push(error);}
    globalThis.fetch=originalFetch;
    if(failures.length&&!primaryError)throw failures[0];
  }
  check(signal);
  for(const artifact of artifacts)await verifyFile(artifact,runDirectory);
  await keepJson(join(runDirectory,'result.json'),result);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===SELF){
  const controller=new AbortController();
  const interrupted=()=>controller.abort(new Error('Owned receiving child cancelled.'));
  process.once('SIGTERM',interrupted);process.once('SIGINT',interrupted);
  (async()=>{
    need(process.argv.length===4&&process.argv[2]==='--merchant-receive',
      'RISK_RECEIVING_CHILD_ARGUMENTS_INVALID');
    const input=await jsonAt(absolute(process.argv[3]));
    const result=await receiveMerchant(input,{signal:controller.signal});
    process.stdout.write(JSON.stringify(result)+'\n');
  })().catch(error=>{
    process.stderr.write(JSON.stringify({
      error:safeCode(error.code,'RISK_RECEIVING_MERCHANT_FAILED'),
      ...(error.outcomeUnknown?{outcomeUnknown:true,requestId:error.requestId??null}:{}),
    })+'\n');process.exitCode=1;
  }).finally(()=>{
    process.removeListener('SIGTERM',interrupted);process.removeListener('SIGINT',interrupted);
  });
}
