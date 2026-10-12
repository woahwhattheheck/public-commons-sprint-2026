// MIT. Private operator boundary for the complete settlement audit workspace.
import { promises as fs } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { openSettlementWorkspace, inspectSettlementWorkspace } from './workspace.mjs';
import { exportSettlementWorkspace, exportSettlementReport, inspectSettlementDelivery, readSettlementDeliveryManifest, receiveSettlementDelivery } from './receiving.mjs';
import { PATHPULSE_REFERENCE_POLICY } from './reconciliation.mjs';
import { need, plain, clone, integer, identifier, inside, files, readState, publicError, selected, originalHistoryEntries } from './common.mjs';

const entries = [
  ['workspace.describe',false,[],'Read the settlement programme, saved editions and current source captures.'],
  ['workspace.profile',true,['profile'],'Save the programme name and institutional contact details.'],
  ['workspace.history',false,[],'Read complete retained workspace transitions in revision order.'],
  ['request.status',false,['requestId'],'Recover the recorded result of an original operator request.'],
  ['policy.reference',false,[],'Read the named PathPulse 50/30/20 reference policy and tier weights.'],
  ['policy.save',true,['definition'],'Save a complete immutable version of a settlement policy.'],
  ['policy.read',false,['policyId'],'Read a selected original policy version.'],
  ['batch.save',true,['definition'],'Save treasury revenue, recipients and approved contribution inputs.'],
  ['batch.read',false,['batchId'],'Read a selected original settlement batch version.'],
  ['source.catalog',false,[],'Read the configured SDP and Horizon native route catalogue.'],
  ['source.import',true,['provider','kind','bodyBase64'],'Retain a complete original response or source document and its projection.'],
  ['source.project',true,['sourceId','recordsPath'],'Create a new interpretation of an already retained original source.'],
  ['source.read',false,['sourceId'],'Read a retained source and its complete normalized records.'],
  ['source.file',false,['sourceId'],'Read an exact range of a retained original source file.'],
  ['capture.start',true,['connectionAlias','read'],'Create a capture with the original source route and ledger selection.'],
  ['capture.next',true,['captureId'],'Read and retain the next original provider page.'],
  ['capture.run',true,['captureId'],'Continue all native pages through the selected original horizon.'],
  ['capture.pause',true,['captureId'],'Pause the selected native source capture.'],
  ['capture.resume',true,['captureId'],'Resume the selected retained capture on its original source.'],
  ['plan.create',true,['batchId'],'Freeze a complete exact allocation plan from a selected batch version.'],
  ['correction.add',true,['planId','correction'],'Append an explained assignment, exclusion or correction note.'],
  ['reconciliation.create',true,['planId'],'Reconcile the frozen plan against selected native source observations.'],
  ['edition.read',false,['kind','id'],'Read a complete retained plan, reconciliation or report edition.'],
  ['reconciliation.compare',false,['leftId','rightId'],'Compare baseline and following reconciliation editions by participant and stage.'],
  ['report.create',true,['reconciliationId'],'Produce complete scoped partner reports in HTML, JSON and CSV.'],
  ['report.file',false,['reportId','filename'],'Read one complete retained report file.'],
  ['workspace.export',true,['destination'],'Export the complete source application and current workspace.'],
  ['report.export',true,['reportId','destination'],'Export a selected partner report package.'],
  ['delivery.inspect',false,['sourceDirectory'],'Inspect a complete received delivery and original manifest.'],
  ['delivery.receive',true,['sourceDirectory','destination'],'Receive a delivery into an independent continuing workspace.'],
];
export const SETTLEMENT_AUDIT_METHODS = Object.freeze(entries.map(([method,mutates,required,description])=>Object.freeze({
  method,mutates,required:Object.freeze(required),description,
  ...(mutates?{requestId:'UUID',...(method!=='delivery.receive'?{expectedRevision:'nonnegative integer'}:{})}:{})
})));

export async function readSettlementPrivateJSON(path,{maximumBytes=64*1024*1024}={}){
  need(typeof path==='string'&&isAbsolute(path),'INVALID_CONFIGURATION','Select an absolute configuration file path.');
  const actual=await fs.realpath(path),stat=await fs.stat(actual);
  need(stat.isFile()&&stat.size<=maximumBytes,'INVALID_CONFIGURATION','Select a complete JSON configuration file within the supported size.');
  const bytes=await fs.readFile(actual);need(bytes.length===stat.size,'CONFIGURATION_CHANGED','The configuration changed while it was read.');
  const value=JSON.parse(bytes.toString('utf8'));need(plain(value),'INVALID_CONFIGURATION','The configuration file must contain a JSON object.');
  return value;
}
export async function loadSettlementAuditConfiguration({workspaceDirectory,connectionsFile,profileFile}={}){
  const directory=resolve(workspaceDirectory);
  let connections={},profile={};
  if(connectionsFile){
    const path=await fs.realpath(resolve(connectionsFile));
    let workspace=directory;try{workspace=await fs.realpath(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    need(!inside(workspace,path),'PRIVATE_CONFIGURATION_LOCATION','Keep source credentials in the operator configuration directory outside the settlement workspace.');
    connections=await readSettlementPrivateJSON(path);
  }
  if(profileFile)profile=await readSettlementPrivateJSON(resolve(profileFile));
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
export async function openSettlementAuditOperator({workspaceDirectory,connections={},profile={},expectedWorkspaceId,signal}={}){
  need(typeof workspaceDirectory==='string'&&isAbsolute(workspaceDirectory),'INVALID_DIRECTORY','Select an absolute settlement workspace directory.');
  const directory=resolve(workspaceDirectory);
  if(expectedWorkspaceId){
    identifier(expectedWorkspaceId,'expected workspace id');
    const existing=await inspectSettlementWorkspace({directory,allowMissing:true});
    need(existing&&existing.workspaceId===expectedWorkspaceId,'WORKSPACE_IDENTITY_MISMATCH','The selected directory has a different original workspace identity.',
      {expectedWorkspaceId,actualWorkspaceId:existing?.workspaceId??null});
  }
  const controller=new AbortController(),forward=()=>controller.abort(signal?.reason);
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
  const workspace=await openSettlementWorkspace({directory,connections,profile,signal:controller.signal});
  const secrets=secretValues(connections),active=new Set();
  let closing=false,closePromise;
  const methods=()=>SETTLEMENT_AUDIT_METHODS.map(clone);
  const describe=()=>workspace.describe();
  async function history({offset=0,limit=100}={}){
    integer(offset,'offset');integer(limit,'limit',1,1000);
    const state=await readState(directory),rows=await originalHistoryEntries(directory,state);
    return {workspaceId:state.workspaceId,revision:state.revision,offset,total:rows.length,
      records:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null};
  }
  const dispatch={
    'workspace.describe':describe,'workspace.profile':workspace.profileSave,'workspace.history':history,
    'request.status':async({requestId})=>{identifier(requestId);const state=await readState(directory);
      return {workspaceId:state.workspaceId,revision:state.revision,requestId,record:clone(state.requests[requestId]??null)};},
    'policy.reference':async()=>clone(PATHPULSE_REFERENCE_POLICY),
    'policy.save':workspace.policySave,'policy.read':workspace.policyRead,
    'batch.save':workspace.batchSave,'batch.read':workspace.batchRead,
    'source.catalog':workspace.sourceCatalog,'source.import':workspace.sourceImport,
    'source.project':workspace.sourceProject,'source.read':workspace.sourceRead,'source.file':workspace.sourceFile,
    'capture.start':workspace.captureStart,'capture.next':workspace.captureNext,'capture.run':workspace.captureRun,
    'capture.pause':workspace.capturePause,'capture.resume':workspace.captureResume,
    'plan.create':workspace.planCreate,'correction.add':workspace.correctionAdd,
    'reconciliation.create':workspace.reconcileCreate,'edition.read':workspace.editionRead,
    'reconciliation.compare':workspace.compare,'report.create':workspace.reportCreate,
    'report.file':async args=>{const result=await workspace.reportFile(args);return {file:result.file,base64:result.body.toString('base64')};},
    'workspace.export':args=>exportSettlementWorkspace({...args,directory}),
    'report.export':args=>exportSettlementReport({...args,directory}),
    'delivery.inspect':inspectSettlementDelivery,
    'delivery.receive':receiveSettlementDelivery,
  };
  async function invoke({method,args={}}={}){
    need(!closing,'OPERATOR_DRAINING','The operator is finishing its active work.');
    need(typeof method==='string'&&Object.hasOwn(dispatch,method),'UNKNOWN_METHOD','Select an available settlement operator method.',{methods:methods().map(item=>item.method)});
    need(plain(args),'INVALID_ARGUMENT','Supply an argument object.');
    const entry=SETTLEMENT_AUDIT_METHODS.find(item=>item.method===method);
    for(const name of entry.required)need(Object.hasOwn(args,name),'MISSING_ARGUMENT','Supply '+name+'.',{field:name});
    if(entry.mutates){
      identifier(args.requestId,'requestId');
      if(method!=='delivery.receive')integer(args.expectedRevision,'expectedRevision');
    }
    let promise;promise=(async()=>dispatch[method](args))();active.add(promise);
    try{return await promise;}finally{active.delete(promise);}
  }
  async function delivery({deliveryId}){
    const state=await readState(directory),record=selected(state.deliveries,deliveryId,'Delivery');
    return {record,inspection:await readSettlementDeliveryManifest({sourceDirectory:record.directory,expectedManifestSha256:record.manifestSha256})};
  }
  async function close(){
    if(closePromise)return closePromise;
    closing=true;controller.abort(new Error('Operator draining'));
    closePromise=(async()=>{while(active.size)await Promise.allSettled([...active]);await workspace.close();signal?.removeEventListener('abort',forward);})();
    return closePromise;
  }
  return {directory,workspace,describe,methods,invoke,delivery,reportFile:workspace.reportFile,
    publicError:error=>publicError(error,secrets),close};
}
