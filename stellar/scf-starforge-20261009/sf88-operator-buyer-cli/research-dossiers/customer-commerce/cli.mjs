#!/usr/bin/env node
// MIT. The terminal operates the same Research host and original Buyer application.
import {parseArgs} from 'node:util';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {copyCustomerFile,describeCustomerFile} from '../customer-updates/files.mjs';
import {customerDirectory,retainCustomerBytes,jsonBytes} from './files.mjs';
import {CONTROL_LIMIT,PUBLICATION_LIMIT,need,identifier} from './contracts.mjs';
import {RESEARCH_COMMERCE_WRITES,submitResearchCommerce,replayResearchCommerce,readResearchCommerceOperation,
 retainResearchCommerceFile,copyResearchCommerceExport} from './operator.mjs';
import {inspectResearchPaidArchive,receiveResearchPaidArchive} from './archive.mjs';

const writes={
 'commerce-publication-prepare':'publication-prepare','commerce-publication-enroll':'publication-enroll',
 'commerce-purchase-receive':'purchase-receive','commerce-purchase-prepare':'purchase-prepare',
 'commerce-execute':'purchase-execute','commerce-retrieve':'purchase-retrieve','commerce-recover':'purchase-recover',
 'commerce-finalize':'purchase-finalize','commerce-cancel':'purchase-cancel','commerce-reconcile':'purchase-reconcile',
 'commerce-receive-dossier':'purchase-receive-dossier',
};
export const RESEARCH_COMMERCE_COMMANDS=Object.freeze(['commerce-help','commerce-configuration','commerce-list',
 'commerce-publication','commerce-purchase',...Object.keys(writes),'commerce-export','commerce-operation',
 'commerce-replay','commerce-archive-inspect','commerce-archive-receive']);
export const RESEARCH_COMMERCE_USAGE=String.raw`Research paid customer delivery

Use the existing private Research listener:
  research-client COMMAND --connection-file /private/research-url.json [--directory /original/research]
  research-dossiers remote COMMAND ...

Inspect the configured original merchant and Buyer applications:
  commerce-configuration
  commerce-list --kind publications|purchases [--offset N --limit N --snapshot SHA256]
  commerce-publication --id PUBLICATION_UUID
  commerce-purchase --id PURCHASE_UUID [--refresh]

Every write retains its complete input and first native result:
  commerce-publication-prepare --input REQUEST.json --run-directory /private/publication-review
  commerce-publication-enroll --input ENROLL.json --run-directory /private/publication-enroll
  commerce-purchase-receive --publication-file PUBLICATION.json --buyer ALIAS --request-id UUID
      --run-directory /private/offer-receiving
  commerce-purchase-prepare --input PREPARATION.json --run-directory /private/acquisition
  commerce-execute|commerce-retrieve|commerce-recover|commerce-finalize|commerce-cancel
      --input ORIGINAL_ACTION.json --run-directory /private/that-action
  commerce-reconcile --input ORIGINAL_NATIVE_REQUEST.json --run-directory /private/reconciliation
  commerce-receive-dossier --input RECEIVING.json --run-directory /private/research-receiving

Any write can use --input; offer-receiving additionally accepts the exact public
publication file as shown. Repeat the same command with only --run-directory
to reopen its first complete result or continue the retained original request.
A still-present input file must retain its exact original bytes. Optional --out
copies the first retained result without changing it.

Review request:
  {requestId,merchant,dossierId,deliveryId,revision,title,summary,usage,
   sourceWorkspace?:{library,actor,requestId}}
Use the frozen delivery's own revision, not a later dossier revision.
Enrollment:
  {id,reviewSha256}
Buyer preparation:
  {id,requestId,expectedRevision,totalAtomic,dailyAtomic,claimEnv}
Read paidFile.revision from commerce-purchase --refresh. Budgets are positive
decimal atomic-unit strings. claimEnv names the existing buyer variable.
Native action:
  {id,requestId,preparedSha256}
Cancel adds executionId from the actual native running execution.
Receiving optionally adds sourceActor when the complete Europe PMC workspace travels.
Reconciliation:
  {id,requestId,nativeRequestId,nativeId?}

Review/approve in the original Buyer application shown by commerce-purchase
--refresh. commerce-execute sends the selected original operation through that
application's existing authorization and payment flow. After the native payment
and seller entitlement complete, commerce-retrieve obtains the exact archive.
commerce-receive-dossier retains the full archive and reopens its editable Research
dossier/source through the original receivers.

Download complete original output:
  commerce-export --kind publications|purchases --id UUID
      --part publication|handoff|archive|received --run-directory /private/original-export
      [--sha256 SHA256 --out /private/complete-original-file]
  commerce-operation --run-directory /private/original-command
  commerce-replay --source-operation /private/original-command
      --run-directory /private/distinct-replay
  commerce-replay --run-directory /private/distinct-replay

A replay is a separate retained terminal attempt that submits the exact original
native request. It keeps the original request ID, buyer intent and first result.
Completed ordinary commands and downloads reopen before accessing the host.
Each command/selection owns a separate private run-directory.

Inspect or unpack a received archive with the original full handover validator:
  commerce-archive-inspect --file ARCHIVE --sha256 SHA256 --bytes N
  commerce-archive-receive --file ARCHIVE --sha256 SHA256 --bytes N
      --manifest-sha256 SHA256 --run-directory /private/archive
  commerce-archive-receive --sha256 SHA256 --bytes N --manifest-sha256 SHA256
      --run-directory /private/archive

Local archive receiving preserves all original files. Use commerce-receive-dossier
for the same paid purchase, or the existing customer-updates-receive command to
receive an explicitly selected complete handover into the original Research host.
OPERATING.md contains the full merchant/Buyer setup and complete operating journey.
`;

const number=value=>{if(value===undefined)return undefined;
 need(/^(0|[1-9][0-9]{0,15})$/.test(value)&&Number.isSafeInteger(Number(value)),'RESEARCH_COMMERCE_NUMBER_INVALID');return Number(value);};
const permitted={
 'commerce-configuration':[],'commerce-list':['kind','offset','limit','snapshot'],
 'commerce-publication':['id'],'commerce-purchase':['id','refresh'],
 'commerce-export':['kind','id','part','run-directory','sha256','out'],
 'commerce-operation':['run-directory'],
 'commerce-replay':['source-operation','run-directory','out'],
 'commerce-archive-inspect':['file','sha256','bytes'],
 'commerce-archive-receive':['file','sha256','bytes','manifest-sha256','run-directory'],
};
for(const command of Object.keys(writes))permitted[command]=['input','run-directory','out',
 ...(command==='commerce-purchase-receive'?['publication-file','buyer','request-id']:[])];
async function writeReadOutput(path,value){
 const selected=resolve(path),root=await customerDirectory(dirname(selected));
 return retainCustomerBytes(root,basename(selected),jsonBytes(value));
}
async function copySavedResult(root,out){
 if(!out)return;
 const file=await describeCustomerFile(join(resolve(root),'result.json'));
 await copyCustomerFile(file.path,resolve(out),{sha256:file.sha256,bytes:file.bytes});
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr}={}){
 const command=argv[0]??'commerce-help';
 if(command==='commerce-help'||argv.includes('--help')){stdout.write(RESEARCH_COMMERCE_USAGE+'\n');return 0;}
 need(RESEARCH_COMMERCE_COMMANDS.includes(command),'RESEARCH_COMMERCE_COMMAND_INVALID');
 const allowed=new Set(['connection-file','directory',...(permitted[command]??[])]);
 const definitions=Object.fromEntries([...allowed].map(key=>[key,{type:key==='refresh'?'boolean':'string'}]));
 const {values,positionals}=parseArgs({args:argv.slice(1),options:definitions,allowPositionals:false,strict:true});
 need(positionals.length===0,'RESEARCH_COMMERCE_ARGUMENT_INVALID');
 const lifetime=new AbortController();
 const stop=()=>lifetime.abort(Object.assign(new Error('RESEARCH_COMMERCE_COMMAND_INTERRUPTED'),{code:'RESEARCH_COMMERCE_COMMAND_INTERRUPTED'}));
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 let original,failure;
 const client=async()=>{
  if(original)return original;
  need(values['connection-file'],'RESEARCH_CONNECTION_REQUIRED');
  original=new ResearchWorkspaceClient({connectionFile:resolve(values['connection-file']),
   ...(values.directory?{directory:resolve(values.directory)}:{})},
   {fetch:(url,options)=>globalThis.fetch(url,{...options,signal:AbortSignal.any([
    lifetime.signal,...(options?.signal?[options.signal]:[])])})});
  return original;
 };
 // Pass cancellation through the existing client's transport; no second buyer executor.
 const connected=async()=>{
  const selected=await client();return selected;
 };
 try{
  let result;
  if(writes[command]){
   need(values['run-directory'],'RESEARCH_COMMERCE_RUN_DIRECTORY_REQUIRED');
   let input;
   if(values['publication-file']){
    need(!values.input&&values.buyer&&values['request-id'],'RESEARCH_COMMERCE_SELECT_ONE_INPUT');
    identifier(values['request-id']);
    const bytes=await readResearchHostFile(resolve(values['publication-file']),PUBLICATION_LIMIT);
    input={requestId:values['request-id'],buyer:values.buyer,filename:basename(values['publication-file']),base64:bytes.toString('base64')};
   }
   result=await submitResearchCommerce({client:connected,directory:resolve(values['run-directory']),
    command:writes[command],...(values.input?{inputFile:resolve(values.input)}:{}),...(input?{input}:{})});
   await copySavedResult(values['run-directory'],values.out);
  }else if(command==='commerce-operation'){
   need(values['run-directory'],'RESEARCH_COMMERCE_RUN_DIRECTORY_REQUIRED');
   result=await readResearchCommerceOperation(values['run-directory']);
  }else if(command==='commerce-replay'){
   need(values['run-directory'],'RESEARCH_COMMERCE_RUN_DIRECTORY_REQUIRED');
   result=values['source-operation']?await replayResearchCommerce({client:connected,directory:values['run-directory'],
    sourceDirectory:values['source-operation']}):await submitResearchCommerce({client:connected,directory:values['run-directory']});
   await copySavedResult(values['run-directory'],values.out);
  }else if(command==='commerce-export'){
   need(values['run-directory'],'RESEARCH_COMMERCE_RUN_DIRECTORY_REQUIRED');
   result=await retainResearchCommerceFile({client:connected,directory:values['run-directory'],kind:values.kind,id:values.id,
    part:values.part,expectedSha256:values.sha256});
   if(values.out)result={...result,copied:await copyResearchCommerceExport(result,values.out)};
  }else if(command==='commerce-archive-inspect'){
   need(values.file,'RESEARCH_COMMERCE_ARCHIVE_REQUIRED');
   result=await inspectResearchPaidArchive({path:resolve(values.file),expectedSha256:values.sha256,
    expectedBytes:number(values.bytes),signal:lifetime.signal});
  }else if(command==='commerce-archive-receive'){
   need(values['run-directory'],'RESEARCH_COMMERCE_RUN_DIRECTORY_REQUIRED');
   result=await receiveResearchPaidArchive({directory:values['run-directory'],...(values.file?{path:resolve(values.file)}:{}),
    expectedSha256:values.sha256,expectedBytes:number(values.bytes),manifestSha256:values['manifest-sha256'],signal:lifetime.signal});
  }else{
   const selected=await connected();await selected.status({signal:lifetime.signal});const commerce=selected.customerCommerce();
   if(command==='commerce-configuration')result=await commerce.configuration({signal:lifetime.signal});
   if(command==='commerce-list')result=await commerce.list(values.kind,{offset:number(values.offset),limit:number(values.limit),
    snapshot:values.snapshot},{signal:lifetime.signal});
   if(command==='commerce-publication')result=await commerce.publication(values.id,{signal:lifetime.signal});
   if(command==='commerce-purchase')result=await commerce.purchase(values.id,{refresh:values.refresh??false},{signal:lifetime.signal});
  }
  stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
 }catch(error){
  failure=error;let cleanupFailed=false;
  if(typeof error?.close==='function')try{await error.close();}
  catch(cleanup){cleanupFailed=true;error.researchCommerceClose=cleanup.code??'RESEARCH_COMMERCE_CLOSE_INCOMPLETE';}
  stderr.write(JSON.stringify({error:error.code??'RESEARCH_COMMERCE_COMMAND_FAILED',
   ...(typeof error.outcomeUnknown==='boolean'?{outcomeUnknown:error.outcomeUnknown}:{}),
   ...(error.researchCommerce?{researchCommerce:error.researchCommerce}:{}),
   ...(error.researchCommerceClose?{closeError:error.researchCommerceClose}:{}),
   ...(values['run-directory']?{runDirectory:resolve(values['run-directory'])}:{})})+'\n');
  // A library caller retains the original failed owner instead of receiving a bare exit code.
  if(cleanupFailed)throw error;
  return lifetime.signal.aborted?130:1;
 }finally{
  try{if(original)await original.close();}
  catch(cleanup){
   const primary=failure??cleanup,previous=typeof primary.close==='function'?primary.close.bind(primary):null;
   primary.researchCommerceClose=cleanup.code??'RESEARCH_COMMERCE_CLOSE_INCOMPLETE';
   Object.defineProperty(primary,'close',{configurable:true,value:async()=>{
    let caught;try{await previous?.();}catch(error){caught=error;}
    try{await original.close();}catch(error){caught??=error;}
    if(caught)throw caught;
   }});
   throw primary;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 process.exitCode=await main();
