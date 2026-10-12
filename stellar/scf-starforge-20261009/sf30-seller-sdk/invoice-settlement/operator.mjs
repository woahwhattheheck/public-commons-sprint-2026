// MIT. Private operator boundary for the complete invoice and settlement workspace.
import {promises as fs} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {openInvoiceWorkspace,inspectInvoiceWorkspace} from './workspace.mjs';
import {exportInvoiceWorkspace,exportInvoiceReport,inspectInvoiceDelivery,readInvoiceDeliveryManifest,receiveInvoiceDelivery} from './receiving.mjs';
import {need,plain,clone,integer,identifier,inside,readState,publicError,selected,originalHistoryEntries,readDescriptor} from './common.mjs';

const entries=[
  ['workspace.describe',false,[],'Read current invoice programmes, native source captures, delivery queues and reconciliations.'],
  ['workspace.profile',true,['profile'],'Save the organization and operator profile.'],
  ['workspace.history',false,[],'Read retained original transitions in complete revision order.'],
  ['request.status',false,['requestId'],'Recover the recorded result of an original operator request.'],
  ['programme.save',true,['definition'],'Save an immutable programme version with exact assets, invoices and settlement rules.'],
  ['programme.read',false,['programmeId'],'Read a selected original programme version.'],
  ['source.catalog',false,[],'Read actual configured ElementPay, EVM, Horizon and SDP routes and their filter schemas.'],
  ['source.import',true,['provider','kind','bodyBase64'],'Retain complete original response bytes or a document and its exact projection.'],
  ['source.project',true,['sourceId','recordsPath'],'Append a new interpretation of an already retained original source.'],
  ['source.read',false,['sourceId'],'Read an original source and all normalized records.'],
  ['source.file',false,['sourceId'],'Read an exact byte range of an original source or projection.'],
  ['capture.start',true,['programmeId','connectionAlias','read'],'Freeze a programme, original connection, native route and read selection.'],
  ['capture.next',true,['captureId'],'Read and retain the next original native response.'],
  ['capture.run',true,['captureId'],'Continue the complete original capture through all selected native pages.'],
  ['capture.pause',true,['captureId'],'Pause a native capture while preserving its original pending request.'],
  ['capture.resume',true,['captureId'],'Resume the retained source selection on the same private connection.'],
  ['receipt.read',false,['receiptId'],'Read every authenticated customer webhook attempt and its retained original source.'],
  ['delivery.prepare',true,['programmeId','connectionAlias'],'Prepare original listener event bodies from retained EVM events.'],
  ['delivery.read',false,['deliveryId'],'Read an original outbound intent and complete backend response attempts.'],
  ['delivery.file',false,['deliveryId'],'Read exact original listener request, response or attempt bytes.'],
  ['delivery.next',true,['deliveryId'],'Dispatch one ready original listener body or recover its existing pending attempt.'],
  ['delivery.pause',true,['deliveryId'],'Pause an outbound job without changing its original delivery outcome.'],
  ['delivery.resume',true,['deliveryId'],'Resume an outbound job on the same original backend.'],
  ['delivery.resolve',true,['deliveryId','outcome','actor','reason'],'Resolve a retained outcome from matching original order records, or explicitly retry/cancel it.'],
  ['delivery.run',true,[],'Process a frozen complete selection of ready listener jobs, retaining each response independently.'],
  ['delivery.run.pause',true,['runId'],'Pause the selected original outbound run.'],
  ['delivery.run.resume',true,['runId'],'Resume the same retained outbound run and pending job selection.'],
  ['decision.save',true,['programmeId','recordId','action','actor','reason'],'Append an explained original-record link, exclusion or corrective decision.'],
  ['decision.read',false,['decisionId'],'Read an immutable original reconciliation decision.'],
  ['reconciliation.create',true,['programmeId'],'Reconcile selected original orders, chain events, payouts and decisions against invoices.'],
  ['edition.read',false,['reconciliationId'],'Read a complete retained reconciliation edition.'],
  ['reconciliation.compare',false,['leftId','rightId'],'Compare baseline and following invoice/order balances and original references.'],
  ['report.create',true,['reconciliationId'],'Render complete scoped invoice/settlement reports in HTML, JSON and CSV.'],
  ['report.read',false,['reportId'],'Read the original report manifest and all complete member descriptors.'],
  ['report.file',false,['reportId'],'Read an exact original report byte range.'],
  ['workspace.export',true,['destination'],'Export the complete application, original workspace and every selected native runtime.'],
  ['report.export',true,['reportId','destination'],'Export complete selected partner report artifacts.'],
  ['package.inspect',false,['sourceDirectory'],'Inspect an original complete workspace or report package.'],
  ['package.receive',true,['sourceDirectory','destination'],'Receive a complete package into an independent continuing workspace.'],
];
export const INVOICE_SETTLEMENT_METHODS=Object.freeze(entries.map(([method,mutates,required,description])=>Object.freeze({
  method,mutates,required:Object.freeze(required),description,
  ...(mutates?{requestId:'UUID',...(method!=='package.receive'?{expectedRevision:'nonnegative integer'}:{})}:{})
})));
export async function readInvoicePrivateJSON(path,{maximumBytes=64*1024*1024}={}){
  need(typeof path==='string'&&isAbsolute(path),'INVALID_CONFIGURATION','Select an absolute private configuration file path.');
  const actual=await fs.realpath(path),stat=await fs.stat(actual);
  need(stat.isFile()&&stat.size<=maximumBytes,'INVALID_CONFIGURATION','Select a complete JSON configuration file within the supported size.');
  const bytes=await fs.readFile(actual);
  need(bytes.length===stat.size,'CONFIGURATION_CHANGED','The original configuration changed while it was read.');
  const value=JSON.parse(bytes.toString('utf8'));need(plain(value),'INVALID_CONFIGURATION','The configuration must contain a JSON object.');return value;
}
export async function loadInvoiceSettlementConfiguration({workspaceDirectory,connectionsFile,profileFile}={}){
  need(typeof workspaceDirectory==='string','INVALID_DIRECTORY','Select the invoice workspace directory.');
  const directory=resolve(workspaceDirectory);let connections={},profile={};
  if(connectionsFile){
    const path=await fs.realpath(resolve(connectionsFile));
    let workspace=directory;try{workspace=await fs.realpath(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    need(!inside(workspace,path),'PRIVATE_CONFIGURATION_LOCATION','Keep service credentials in private operator configuration outside the workspace.');
    connections=await readInvoicePrivateJSON(path);
  }
  if(profileFile)profile=await readInvoicePrivateJSON(resolve(profileFile));
  return {connections,profile};
}
function secretValues(value,result=[]){
  if(!plain(value))return result;
  for(const [key,item] of Object.entries(value)){
    if(/authorization|cookie|api.?key|token|password|secret/i.test(key)&&typeof item==='string'&&item)result.push(item);
    else if(plain(item))secretValues(item,result);
  }
  return result;
}
export async function openInvoiceSettlementOperator({workspaceDirectory,connections={},profile={},expectedWorkspaceId,signal,applicationDirectory}={}){
  need(typeof workspaceDirectory==='string'&&isAbsolute(workspaceDirectory),'INVALID_DIRECTORY','Select an absolute invoice workspace directory.');
  const directory=resolve(workspaceDirectory);
  if(expectedWorkspaceId){
    identifier(expectedWorkspaceId,'expected workspace ID');
    const existing=await inspectInvoiceWorkspace({directory,allowMissing:true});
    need(existing&&existing.workspaceId===expectedWorkspaceId,'WORKSPACE_IDENTITY_MISMATCH','This directory has a different original workspace identity.',
      {expectedWorkspaceId,actualWorkspaceId:existing?.workspaceId??null});
  }
  const controller=new AbortController(),forward=()=>controller.abort(signal?.reason);
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
  const workspace=await openInvoiceWorkspace({directory,connections,profile,signal:controller.signal,applicationDirectory});
  const secrets=secretValues(connections),active=new Set();let closing=false,closePromise;
  const methods=()=>INVOICE_SETTLEMENT_METHODS.map(clone),describe=()=>workspace.describe();
  async function history({offset=0,limit=100}={}){
    integer(offset,'offset');integer(limit,'limit',1,1000);
    const state=await readState(directory),records=await originalHistoryEntries(directory,state);
    return {workspaceId:state.workspaceId,revision:state.revision,offset,total:records.length,
      records:records.slice(offset,offset+limit),nextOffset:offset+limit<records.length?offset+limit:null};
  }
  const dispatch={
    'workspace.describe':describe,'workspace.profile':workspace.profileSave,'workspace.history':history,
    'request.status':async({requestId})=>{identifier(requestId);const state=await readState(directory);
      return {workspaceId:state.workspaceId,revision:state.revision,requestId,record:clone(state.requests[requestId]??null)};},
    'programme.save':workspace.programmeSave,'programme.read':workspace.programmeRead,
    'source.catalog':workspace.sourceCatalog,'source.import':workspace.sourceImport,'source.project':workspace.sourceProject,
    'source.read':workspace.sourceRead,'source.file':workspace.sourceFile,
    'capture.start':workspace.captureStart,'capture.next':workspace.captureNext,'capture.run':workspace.captureRun,
    'capture.pause':workspace.capturePause,'capture.resume':workspace.captureResume,
    'receipt.read':workspace.receiptRead,'delivery.prepare':workspace.prepareDeliveries,'delivery.read':workspace.deliveryRead,
    'delivery.file':workspace.deliveryFile,'delivery.next':workspace.deliveryNext,'delivery.pause':workspace.deliveryPause,'delivery.resume':workspace.deliveryResume,
    'delivery.resolve':workspace.deliveryResolve,'delivery.run':workspace.deliveryRun,'delivery.run.pause':workspace.deliveryRunPause,
    'delivery.run.resume':workspace.deliveryRunResume,'decision.save':workspace.decisionSave,'decision.read':workspace.decisionRead,
    'reconciliation.create':workspace.reconcileCreate,'edition.read':workspace.editionRead,'reconciliation.compare':workspace.compare,
    'report.create':workspace.reportCreate,'report.read':workspace.reportRead,'report.file':workspace.reportFile,
    'workspace.export':async args=>exportInvoiceWorkspace({...args,directory,runtimes:await workspace.runtimeSelections()}),
    'report.export':args=>exportInvoiceReport({...args,directory}),
    'package.inspect':inspectInvoiceDelivery,'package.receive':receiveInvoiceDelivery,
  };
  async function tracked(work){
    need(!closing,'OPERATOR_DRAINING','The operator is finishing its active work.');
    const promise=(async()=>work())();active.add(promise);
    try{return await promise;}finally{active.delete(promise);}
  }
  async function invoke({method,args={}}={}){
    need(typeof method==='string'&&Object.hasOwn(dispatch,method),'UNKNOWN_METHOD','Select an available invoice operator method.',{methods:methods().map(row=>row.method)});
    need(plain(args),'INVALID_ARGUMENT','Supply the complete operation arguments.');
    const entry=INVOICE_SETTLEMENT_METHODS.find(row=>row.method===method);
    for(const name of entry.required)need(Object.hasOwn(args,name),'MISSING_ARGUMENT','Supply '+name+'.',{field:name});
    if(entry.mutates){identifier(args.requestId,'requestId');if(method!=='package.receive')integer(args.expectedRevision,'expectedRevision');}
    return tracked(()=>dispatch[method](args));
  }
  const receiveWebhook=args=>tracked(()=>workspace.receiveWebhook(args));
  async function exported({exportId}){
    const state=await readState(directory),record=selected(state.exports,exportId,'Export');
    return {record,inspection:await readInvoiceDeliveryManifest({sourceDirectory:record.directory,expectedManifestSha256:record.manifestSha256})};
  }
  async function reportBody({reportId,format='html'}){
    const report=await workspace.reportRead({reportId}),member=report.files.find(row=>row.format===format);
    need(member,'REPORT_FORMAT_NOT_FOUND','Select a retained report format.',{formats:report.formats});
    return {report,member,body:await readDescriptor(directory,member.file)};
  }
  async function close(){
    if(closePromise)return closePromise;
    closing=true;controller.abort(new Error('Operator draining'));
    closePromise=(async()=>{while(active.size)await Promise.allSettled([...active]);await workspace.close();signal?.removeEventListener('abort',forward);})();
    return closePromise;
  }
  return {directory,workspace,describe,methods,invoke,receiveWebhook,exported,reportBody,
    publicError:error=>publicError(error,secrets),close};
}
