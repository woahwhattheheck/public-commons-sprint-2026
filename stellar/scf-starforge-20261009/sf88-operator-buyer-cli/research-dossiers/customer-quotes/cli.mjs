#!/usr/bin/env node
// MIT. Complete quotation commands keep one native request and one retained terminal result.
import {parseArgs} from 'node:util';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {customerDirectory,retainCustomerBytes,copyCustomerFile} from '../customer-updates/files.mjs';
import {QUOTE_FILE_LIMIT,need} from './contracts.mjs';
import {submitResearchQuote,replayResearchQuote,readResearchQuoteRun,retainResearchQuoteOperation,
 retainResearchQuoteCaseFile,copyResearchQuoteResult,copyResearchQuoteExport} from './operator.mjs';

const writes=Object.freeze({
 'quotes-create-case':'create-case','quotes-native-case':'native-case','quotes-pricing':'pricing',
 'quotes-prepare':'prepare','quotes-apply':'apply','quotes-prepare-response':'prepare-response',
 'quotes-prepare-publication':'prepare-publication','quotes-enroll-publication':'enroll-publication',
 'quotes-prepare-report':'prepare-report',
});
export const RESEARCH_QUOTES_COMMANDS=Object.freeze([
 'quotes-help','quotes-configuration','quotes-cases','quotes-case',...Object.keys(writes),
 'quotes-history','quotes-operation','quotes-files','quotes-export-operation','quotes-download-case',
 'quotes-download-tariff','quotes-run','quotes-replay',
]);
export const RESEARCH_QUOTES_USAGE="Research customer quotations\n\nUse the original private Research connection:\n  research-client COMMAND --connection-file /private/research-connection.json\n      [--directory /original/research]\n  research-dossiers remote COMMAND ...\n\nThe connection opens only when a command needs its native host. Completed retained\ncommands and exports reopen locally after that host stops. This command never\nstops the original Research listener or operates a second merchant.\n\nInspect the actual case, pricing and customer selections:\n  quotes-configuration\n  quotes-cases [--q TEXT --status STATUS --due-on YYYY-MM-DD --offset N --limit N]\n  quotes-case --case-id UUID [--revision CASE_SHA256]\n  quotes-history [--offset N --limit N --snapshot SHA256 --dossier-id DOSSIER_ID\n      --kind CASE|BRIEF|RESPONSE|PUBLICATION|REALIZED]\n  quotes-operation --id OPERATION_UUID\n  quotes-files --id OPERATION_UUID\nRead commands accept --out FILE to retain their full response before printing it.\nquotes-cases preserves the original result.cases collection.\n\nCreate, prepare, review and apply through the original saved history:\n  quotes-create-case --input CASE_SELECTION.json --run-directory /private/case-create\n  quotes-prepare --input BRIEF_SELECTION.json --run-directory /private/brief-review\n  quotes-apply --input REVIEW_SELECTION.json --run-directory /private/brief-apply\n  quotes-prepare-response --input RESPONSE_SELECTION.json --run-directory /private/response-review\n  quotes-apply --input REVIEW_SELECTION.json --run-directory /private/response-apply\n  quotes-prepare-publication --input PUBLICATION_SELECTION.json --run-directory /private/publication-review\n  quotes-enroll-publication --input REVIEW_SELECTION.json --run-directory /private/publication-enroll\n  quotes-prepare-report --input REPORT_SELECTION.json --run-directory /private/realized-report\n\nAll selection files contain complete native JSON. A case selection contains\nrequestId, caseId, dossierId, revision, projectId, briefId and actor.\nA brief selection also pins caseRevision, quoteId, quoteSha256, merchant,\nscope {component,unit,note}, and reason. Its component is IMPLEMENTATION,\nRECURRING, ROUTE_USAGE or KEEP. Preserve the full original actor object.\nA response selection contains requestId, bindingId, caseRevision, responseId,\nrevision, actor and by. Use the actual Research revision displayed.\nAn apply/enroll selection is exactly {id,reviewSha256} from the reviewed operation.\nA publication selection contains requestId, bindingId, dossierId, revision,\ndeliveryId, title, summary and usage. Optional sourceWorkspace is null or the\noriginal {library,actor,requestId}; that source actor is a string.\nA report selection contains requestId, bindingId, publicationId, purchaseIds,\nrevision, actor and pricing:null or {profile,version,costEdition?}.\nAmounts, revisions, request IDs and original source documents are never invented\nby this command. Review the saved operation and its complete exported files before\napplying or enrolling it. Publication uses the configured original merchant.\n\nOperate every existing SF74 and SF97 action with its unchanged JSON:\n  quotes-native-case --case-id UUID --action ACTION --input NATIVE_REQUEST.json\n      --run-directory /private/case-action\n  quotes-pricing --profile ALIAS --action ACTION --input NATIVE_REQUEST.json\n      --run-directory /private/pricing-action\n\nCase ACTION:\n  preview, save-draft, publish, receive, receive-pricing, compare,\n  preview-implementation, adopt-implementation,\n  receiving-status, receiving-capture, receiving-inspect, receiving-attach,\n  receiving-case, receiving-restore,\n  tariff-status, tariff-catalog, tariff-selection, tariff-capture, tariff-inspect,\n  tariff-attach, tariff-case, tariff-restore.\nPricing ACTION:\n  state, preview, save, version, compare,\n  planning-state, planning-preview, planning-save, planning-read,\n  economics-state, economics-preview, economics-save, economics-edition,\n  economics-proposal, economics-apply, repricing-source, repricing-preview,\n  repricing-save, repricing-stage.\nFor a native action with no arguments, select a file containing {}.\nThese commands retain their first response even when the action is a preview or\nread. Use a different run directory for a fresh native observation.\n\nReopen or explicitly replay a retained command:\n  quotes-prepare --run-directory /private/brief-review\n  quotes-native-case --run-directory /private/case-action\n  quotes-pricing --run-directory /private/pricing-action\n  quotes-run --run-directory /private/original-command\n  quotes-replay --source-operation /private/original-command\n      --run-directory /private/distinct-replay\n  quotes-replay --run-directory /private/distinct-replay\n\nEvery write owns a distinct private run directory. The full original input,\nworkspace identity, exact native IDs, dispatch attempt and first complete response\nare retained before stdout. A still-present --input file must retain its original\nbytes. Reopen requires neither that donor file nor a live host once complete.\nAn interrupted attempt keeps the same request; repeating the command continues it\nthrough its original writer. quotes-replay deliberately resubmits those same IDs\nin a separate terminal attempt and preserves both results.\nWrites and replay accept --out FILE to copy the first retained result byte for byte.\n\nExport the entire frozen operation and all original source/report files:\n  quotes-export-operation --id UUID --run-directory /private/operation-export\n      [--operation-sha256 SHA256 --out-directory /private/customer-copy]\n  quotes-export-operation --run-directory /private/operation-export\n\nThe selected operation and complete original file roster are retained before\ndownload. Every file is checked by size and SHA-256 and written without replacing\nexisting data. Interrupted export continues only its original roster.\n--operation-sha256 optionally pins the native canonical operation fingerprint.\nThe files/ directory contains complete originals; export.json retains their\noperation context and result.json is the completed export receipt.\n--out-directory receives every original file plus quote-export.json.\n\nExport one selected native case or tariff file:\n  quotes-download-case --case-id UUID --input NATIVE_DOWNLOAD.json\n      --run-directory /private/case-export [--sha256 SHA256 --bytes N --out FILE]\n  quotes-download-tariff --case-id UUID --input NATIVE_DOWNLOAD.json\n      --run-directory /private/tariff-export [--sha256 SHA256 --bytes N --out FILE]\n  quotes-download-case --run-directory /private/case-export\n  quotes-download-tariff --run-directory /private/tariff-export\n\nOriginal metadata determines the file and case revision. If the input omits\nrevision, the stream request is pinned to that reviewed revision. Metadata and\nthe complete stream share one accepted client operation. Later case changes never\nsilently select another export. Completed files verify locally before connection.\n\nNative JSON requests support 96 MiB plus 65,536 bytes, native JSON responses\n64 MiB, and original streamed files 256 MiB. Signals cancel through the existing\nclient; an uncertain request remains in its original run directory. A result or\nfile already retained remains available if terminal output fails.\n";
const permissions={
 'quotes-configuration':['out'],
 'quotes-cases':['q','status','due-on','offset','limit','out'],
 'quotes-case':['case-id','revision','out'],
 'quotes-history':['offset','limit','snapshot','dossier-id','kind','out'],
 'quotes-operation':['id','out'],'quotes-files':['id','out'],
 'quotes-export-operation':['id','run-directory','operation-sha256','out-directory'],
 'quotes-download-case':['case-id','input','run-directory','sha256','bytes','out'],
 'quotes-download-tariff':['case-id','input','run-directory','sha256','bytes','out'],
 'quotes-run':['run-directory','out'],
 'quotes-replay':['source-operation','run-directory','out'],
};
for(const command of Object.keys(writes))permissions[command]=['input','run-directory','out',
 ...(command==='quotes-native-case'?['case-id','action']:command==='quotes-pricing'?['profile','action']:[])];
function number(value){
 if(value===undefined)return undefined;
 need(/^(0|[1-9][0-9]{0,15})$/.test(value)&&Number.isSafeInteger(Number(value)),'RESEARCH_QUOTE_NUMBER_INVALID');
 return Number(value);
}
async function output(stream,body){
 return new Promise((accept,reject)=>{
  let finished=false;
  const done=error=>{
   if(finished)return;finished=true;
   // A failed write callback can still be followed by its original error event.
   setImmediate(()=>stream.removeListener('error',failed));error?reject(error):accept();
  },failed=error=>done(error);
  stream.once('error',failed);try{stream.write(body,done);}catch(error){done(error);}
 });
}
async function retainRead(file,value){
 const path=resolve(file),body=Buffer.from(JSON.stringify(value));
 need(body.length<=QUOTE_FILE_LIMIT,'RESEARCH_QUOTE_OPERATOR_RECORD_TOO_LARGE');
 return retainCustomerBytes(await customerDirectory(dirname(path)),basename(path),body);
}
function errorView(error,values,result){
 return {error:error?.code??'RESEARCH_QUOTE_COMMAND_FAILED',
  ...(typeof error?.outcomeUnknown==='boolean'?{outcomeUnknown:error.outcomeUnknown}:{}),
  ...(error?.researchQuoteRun?{operation:error.researchQuoteRun}:{}),
  ...(error?.researchQuoteRetentionError?{retentionError:error.researchQuoteRetentionError}:{}),
  ...(error?.researchQuoteClose?{closeError:error.researchQuoteClose}:{}),
  ...(error?.destinationPublished?{destinationPublished:true,file:error.file}:{}),
  ...(values['run-directory']?{runDirectory:resolve(values['run-directory'])}:{}),
  ...(result?{retainedResult:result.schema,completed:!!(result.completedAt||result.result?.completedAt)}:{})};
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr}={}){
 const args=[...argv],command=args[0]??'quotes-help';
 if(command==='quotes-help'||args.includes('--help')){await output(stdout,RESEARCH_QUOTES_USAGE+'\n');return 0;}
 need(RESEARCH_QUOTES_COMMANDS.includes(command),'RESEARCH_QUOTE_COMMAND_INVALID');
 const allowed=new Set(['connection-file','directory',...(permissions[command]??[])]),
  definitions=Object.fromEntries([...allowed].map(key=>[key,{type:'string'}])),
  {values}=parseArgs({args:args.slice(1),options:definitions,allowPositionals:false,strict:true});
 const lifetime=new AbortController(),failedOwners=new Map();
 let original,primary,result,working=true,settled=false,closing,retention;
 const hasOwners=()=>original!==undefined||failedOwners.size>0;
 const release=()=>{
  if(retention){clearInterval(retention);retention=undefined;}
  if(settled){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 };
 const close=()=>{
  if(closing)return closing;
  return closing=(async()=>{
   const failures=[];
   for(const [owner,fn]of [...failedOwners])try{await fn();failedOwners.delete(owner);}catch(error){failures.push(error);}
   if(original)try{await original.close();original=undefined;}catch(error){failures.push(error);}
   if(failures.length)throw failures[0];
   release();
  })().finally(()=>{closing=undefined;});
 };
 const report=async error=>{
  try{await output(stderr,JSON.stringify(errorView(error,values,result))+'\n');}catch{}
 };
 const stop=()=>{
  if(!lifetime.signal.aborted)lifetime.abort(Object.assign(new Error('RESEARCH_QUOTE_COMMAND_INTERRUPTED'),
   {code:'RESEARCH_QUOTE_COMMAND_INTERRUPTED'}));
  if(!working)void close().catch(error=>{
   retention??=setInterval(()=>{},1000);process.exitCode=1;void report(error);
  });
 };
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 const client=async()=>{
  lifetime.signal.throwIfAborted();
  if(!original){
   need(values['connection-file'],'RESEARCH_CONNECTION_REQUIRED');
   original=new ResearchWorkspaceClient({connectionFile:resolve(values['connection-file']),
    ...(values.directory?{directory:resolve(values.directory)}:{})},{
     fetch:(url,options)=>globalThis.fetch(url,{...options,signal:AbortSignal.any([
      lifetime.signal,...(options?.signal?[options.signal]:[])])}),
    });
  }
  return original;
 };
 try{
  const root=values['run-directory']?resolve(values['run-directory']):undefined,signal=lifetime.signal;
  if(writes[command]){
   need(root,'RESEARCH_QUOTE_RUN_DIRECTORY_REQUIRED');
   result=await submitResearchQuote({client,directory:root,command:writes[command],
    ...(values.input?{inputFile:resolve(values.input)}:{}),caseId:values['case-id'],
    action:values.action,profile:values.profile,signal});
   if(values.out)await copyResearchQuoteResult(root,resolve(values.out));
  }else if(command==='quotes-replay'){
   need(root,'RESEARCH_QUOTE_RUN_DIRECTORY_REQUIRED');
   result=values['source-operation']?await replayResearchQuote({client,directory:root,
    sourceDirectory:resolve(values['source-operation']),signal}):await submitResearchQuote({client,directory:root,signal});
   if(values.out)await copyResearchQuoteResult(root,resolve(values.out));
  }else if(command==='quotes-run'){
   need(root,'RESEARCH_QUOTE_RUN_DIRECTORY_REQUIRED');result=await readResearchQuoteRun(root);
   if(values.out)await retainRead(values.out,result);
  }else if(command==='quotes-export-operation'){
   need(root,'RESEARCH_QUOTE_RUN_DIRECTORY_REQUIRED');
   result=await retainResearchQuoteOperation({client,directory:root,id:values.id,
    expectedOperationSha256:values['operation-sha256'],signal});
   if(values['out-directory'])result={...result,copied:await copyResearchQuoteExport(result,resolve(values['out-directory']))};
  }else if(command==='quotes-download-case'||command==='quotes-download-tariff'){
   need(root,'RESEARCH_QUOTE_RUN_DIRECTORY_REQUIRED');
   result=await retainResearchQuoteCaseFile({client,directory:root,caseId:values['case-id'],
    ...(values.input?{inputFile:resolve(values.input)}:{}),tariff:command==='quotes-download-tariff',
    expectedSha256:values.sha256,expectedBytes:number(values.bytes),signal});
   if(values.out){
    const file=result.files[0];
    result={...result,copied:await copyCustomerFile(file.path,resolve(values.out),{
     sha256:file.sha256,bytes:file.bytes,maximum:QUOTE_FILE_LIMIT})};
   }
  }else{
   const connected=await client();await connected.status({signal});const quotes=connected.customerQuotes();
   if(command==='quotes-configuration')result=await quotes.configuration({signal});
   if(command==='quotes-cases')result=await quotes.listCases({q:values.q,status:values.status,dueOn:values['due-on'],
    offset:number(values.offset),limit:number(values.limit)},{signal});
   if(command==='quotes-case')result=await quotes.readCase(values['case-id'],{revision:values.revision},{signal});
   if(command==='quotes-history')result=await quotes.list({offset:number(values.offset),limit:number(values.limit),
    snapshot:values.snapshot,dossierId:values['dossier-id'],kind:values.kind},{signal});
   if(command==='quotes-operation')result=await quotes.operation(values.id,{signal});
   if(command==='quotes-files')result=await quotes.files(values.id,{signal});
   if(values.out)await retainRead(values.out,result);
  }
 }catch(error){primary=error;}
 working=false;
 if(typeof primary?.close==='function')failedOwners.set(primary,primary.close.bind(primary));
 try{await close();}
 catch(error){
  primary??=error;primary.researchQuoteClose=error.code??'RESEARCH_QUOTE_CLOSE_INCOMPLETE';
  retention??=setInterval(()=>{},1000);
  Object.defineProperty(primary,'close',{configurable:true,value:close});
 }
 if(!primary&&lifetime.signal.aborted)primary=lifetime.signal.reason;
 if(!primary)try{await output(stdout,JSON.stringify(result)+'\n');}catch(error){primary=error;}
 // A signal during final output is still part of this command's lifetime.
 if(!primary&&lifetime.signal.aborted)primary=lifetime.signal.reason;
 if(primary)await report(primary);
 settled=true;
 if(!hasOwners())release();
 else{
  Object.defineProperty(primary,'close',{configurable:true,value:close});
  throw primary;
 }
 return primary?(lifetime.signal.aborted?130:1):0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().then(code=>{process.exitCode=code;}).catch(error=>{
  process.exitCode=1;
  void output(process.stderr,JSON.stringify({error:error.code??'RESEARCH_QUOTE_COMMAND_FAILED',
   ...(error.researchQuoteClose?{closeError:error.researchQuoteClose}:{})})+'\n').catch(()=>{});
 });
