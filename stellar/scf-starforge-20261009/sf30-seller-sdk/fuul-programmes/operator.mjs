// MIT. Private operator boundary for the complete Fuul programme workspace.
import {promises as fs} from 'node:fs';
import {resolve,isAbsolute,dirname,basename,join} from 'node:path';
import {openFuulWorkspace,inspectFuulWorkspace} from './workspace.mjs';
import {exportFuulWorkspace,exportFuulReport,inspectFuulDelivery,readFuulDeliveryManifest,receiveFuulDelivery} from './receiving.mjs';
import {need,plain,clone,integer,identifier,inside,readState,publicError,selected,originalHistoryEntries,readDescriptor} from './common.mjs';

const entries=[
  [
    "workspace.describe",
    false,
    [],
    "Read programme status and paged original work."
  ],
  [
    "workspace.list",
    false,
    [
      "table"
    ],
    "Page complete work tables with original programme, status and text filters."
  ],
  [
    "workspace.profile",
    true,
    [
      "profile"
    ],
    "Save the organization and operator profile."
  ],
  [
    "workspace.history",
    false,
    [],
    "Read original workspace transitions in revision order."
  ],
  [
    "request.status",
    false,
    [
      "requestId"
    ],
    "Recover a retained original operator result."
  ],
  [
    "programme.save",
    true,
    [
      "definition"
    ],
    "Save an immutable accepted programme and its original configuration sources."
  ],
  [
    "programme.read",
    false,
    [
      "programmeId"
    ],
    "Read a complete original programme version."
  ],
  [
    "source.catalog",
    false,
    [],
    "Read configured original API and Stellar source routes and input schemas."
  ],
  [
    "action.catalog",
    false,
    [],
    "Read original event, claim, payout and draft write operations."
  ],
  [
    "source.import",
    true,
    [
      "provider",
      "kind",
      "bodyBase64"
    ],
    "Retain complete original source bytes and their selected record projection."
  ],
  [
    "source.project",
    true,
    [
      "sourceId"
    ],
    "Append a new projection of an original source."
  ],
  [
    "source.read",
    false,
    [
      "sourceId"
    ],
    "Page records from one retained original source."
  ],
  [
    "source.file",
    false,
    [
      "sourceId"
    ],
    "Read complete original body, request, response or projection file ranges."
  ],
  [
    "capture.start",
    true,
    [
      "programmeId",
      "connectionAlias",
      "read"
    ],
    "Freeze the programme, native source and complete original page selection."
  ],
  [
    "capture.read",
    false,
    [
      "captureId"
    ],
    "Read capture progress and page its original attempts and sources."
  ],
  [
    "capture.next",
    true,
    [
      "captureId"
    ],
    "Retain the next original native page or recover its existing request."
  ],
  [
    "capture.run",
    true,
    [
      "captureId"
    ],
    "Continue the complete original capture through its selected native pages."
  ],
  [
    "capture.pause",
    true,
    [
      "captureId"
    ],
    "Pause a capture with its exact pending request intact."
  ],
  [
    "capture.resume",
    true,
    [
      "captureId"
    ],
    "Resume the original source selection."
  ],
  [
    "event.prepare",
    true,
    [
      "programmeId",
      "connectionAlias",
      "mappingId"
    ],
    "Map original activity to stable, complete Fuul event intents and retain changed-body conflicts."
  ],
  [
    "event.observe",
    true,
    [
      "eventId"
    ],
    "Read the exact event pipeline by its original dedup identity and name."
  ],
  [
    "batch.prepare",
    true,
    [
      "eventIds"
    ],
    "Freeze one to 100 original event bodies in their project-scoped batch."
  ],
  [
    "queue.read",
    false,
    [
      "table",
      "id"
    ],
    "Read an original event, batch or action and page its attempts and conflicts."
  ],
  [
    "queue.file",
    false,
    [
      "table",
      "id"
    ],
    "Read the original operation request, response, attempt or manifest file."
  ],
  [
    "queue.next",
    true,
    [
      "table",
      "id"
    ],
    "Dispatch the exact retained request and ordered original prerequisites."
  ],
  [
    "queue.pause",
    true,
    [
      "table",
      "id"
    ],
    "Pause an original operation while retaining its in-flight attempt."
  ],
  [
    "queue.resume",
    true,
    [
      "table",
      "id"
    ],
    "Resume an operation using the original private project connection."
  ],
  [
    "queue.resolve",
    true,
    [
      "table",
      "id",
      "outcome",
      "actor",
      "reason"
    ],
    "Record an attributable original outcome, retry, cancellation or batch release."
  ],
  [
    "action.prepare",
    true,
    [
      "programmeId",
      "connectionAlias",
      "operation",
      "input"
    ],
    "Prepare the original draft, payout or claim request and retain source-resolved prerequisite actions."
  ],
  [
    "run.start",
    true,
    [
      "programmeId",
      "kind"
    ],
    "Freeze a whole event delivery, pipeline observation or action dispatch programme."
  ],
  [
    "run.read",
    false,
    [
      "runId"
    ],
    "Page the complete original run tasks and saved results."
  ],
  [
    "run.execute",
    true,
    [
      "runId"
    ],
    "Continue every selected task in the original run."
  ],
  [
    "run.pause",
    true,
    [
      "runId"
    ],
    "Pause a complete run while preserving its task position and pending request."
  ],
  [
    "run.resume",
    true,
    [
      "runId"
    ],
    "Resume the same original task selection."
  ],
  [
    "decision.save",
    true,
    [
      "programmeId",
      "sourceId",
      "recordId",
      "action",
      "actor",
      "reason"
    ],
    "Append an explained original-record exclusion, inclusion or reference link."
  ],
  [
    "decision.read",
    false,
    [
      "decisionId"
    ],
    "Read an immutable reconciliation decision."
  ],
  [
    "reconciliation.create",
    true,
    [
      "programmeId"
    ],
    "Reconcile complete original events, pipelines, allocations, movements and claims."
  ],
  [
    "edition.read",
    false,
    [
      "reconciliationId"
    ],
    "Read an original edition and page each operating section."
  ],
  [
    "edition.file",
    false,
    [
      "reconciliationId"
    ],
    "Read the complete original edition file."
  ],
  [
    "reconciliation.compare",
    false,
    [
      "leftId",
      "rightId"
    ],
    "Compare original baseline and following programme editions."
  ],
  [
    "report.create",
    true,
    [
      "reconciliationId"
    ],
    "Render scoped programme reports in HTML, JSON and CSV."
  ],
  [
    "report.read",
    false,
    [
      "reportId"
    ],
    "Read a complete report manifest and file descriptors."
  ],
  [
    "report.file",
    false,
    [
      "reportId"
    ],
    "Read complete original report file ranges."
  ],
  [
    "workspace.export",
    true,
    [
      "destination"
    ],
    "Export the application, complete workspace and every original SDK runtime."
  ],
  [
    "report.export",
    true,
    [
      "reportId",
      "destination"
    ],
    "Export all selected original report artifacts."
  ],
  [
    "package.inspect",
    false,
    [
      "sourceDirectory"
    ],
    "Inspect a complete original workspace or report package."
  ],
  [
    "package.receive",
    true,
    [
      "sourceDirectory",
      "destination"
    ],
    "Receive a complete independent installation and continuing workspace."
  ]
];

export const FUUL_PROGRAMMES_METHODS=Object.freeze(entries.map(([method,mutates,required,description])=>Object.freeze({
  method,mutates,required:Object.freeze(required),description,
  ...(mutates?{requestId:'UUID',...(method!=='package.receive'?{expectedRevision:'nonnegative integer'}:{})}:{})
})));
export async function readFuulPrivateJSON(path,{maximumBytes=64*1024*1024}={}){
  need(typeof path==='string'&&isAbsolute(path),'INVALID_CONFIGURATION','Select an absolute private configuration file path.');
  const actual=await fs.realpath(path),stat=await fs.stat(actual);
  need(stat.isFile()&&stat.size<=maximumBytes,'INVALID_CONFIGURATION','Select a complete JSON configuration file within the supported size.');
  const bytes=await fs.readFile(actual);
  need(bytes.length===stat.size,'CONFIGURATION_CHANGED','The original configuration changed while it was read.');
  const value=JSON.parse(bytes.toString('utf8'));need(plain(value),'INVALID_CONFIGURATION','The configuration must contain a JSON object.');return value;
}
async function canonicalPrivateLocation(value){
 let current=resolve(value);const missing=[];
 for(;;){
  try{return join(await fs.realpath(current),...missing);}
  catch(error){
   if(error.code!=='ENOENT')throw error;
   const parent=dirname(current);if(parent===current)throw error;
   missing.unshift(basename(current));current=parent;
  }
 }
}
async function validatePrivateFuulConnections(directory,connections){
 need(plain(connections),'INVALID_CONFIGURATION','Supply the original connection aliases as an object.');
 const workspace=await canonicalPrivateLocation(directory);
 for(const [alias,connection] of Object.entries(connections)){
  need(plain(connection),'INVALID_CONFIGURATION','Each selected connection must contain its original configuration.',{alias});
  if(connection.tokenFile===undefined||connection.tokenFile===null)continue;
  need(typeof connection.tokenFile==='string'&&connection.tokenFile.length>0&&!connection.tokenFile.includes('\0'),
   'INVALID_CONFIGURATION','Select the original private OAuth token file.',{alias});
  // Match the original adapter's path resolution, including a not-yet-created
  // token file under an existing real parent. The complete workspace may later
  // export any of its retained source directories.
  const tokenFile=await canonicalPrivateLocation(connection.tokenFile);
  need(!inside(workspace,tokenFile),'PRIVATE_CONFIGURATION_LOCATION',
   'Keep the OAuth token file in private operator configuration outside the exported workspace.',{alias});
 }
}
export async function loadFuulProgrammesConfiguration({workspaceDirectory,connectionsFile,profileFile}={}){
  need(typeof workspaceDirectory==='string','INVALID_DIRECTORY','Select the Fuul workspace directory.');
  const directory=resolve(workspaceDirectory);let connections={},profile={};
  if(connectionsFile){
    const path=await fs.realpath(resolve(connectionsFile));
    const workspace=await canonicalPrivateLocation(directory);
    need(!inside(workspace,path),'PRIVATE_CONFIGURATION_LOCATION','Keep service credentials in private operator configuration outside the workspace.');
    connections=await readFuulPrivateJSON(path);
  }
  if(profileFile)profile=await readFuulPrivateJSON(resolve(profileFile));
  await validatePrivateFuulConnections(directory,connections);
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
export async function openFuulProgrammesOperator({workspaceDirectory,connections={},profile={},expectedWorkspaceId,signal,applicationDirectory}={}){
  need(typeof workspaceDirectory==='string'&&isAbsolute(workspaceDirectory),'INVALID_DIRECTORY','Select an absolute Fuul workspace directory.');
  const directory=resolve(workspaceDirectory);
  await validatePrivateFuulConnections(directory,connections);
  if(expectedWorkspaceId){
    identifier(expectedWorkspaceId,'expected workspace ID');
    const existing=await inspectFuulWorkspace({directory,allowMissing:true});
    need(existing&&existing.workspaceId===expectedWorkspaceId,'WORKSPACE_IDENTITY_MISMATCH','This directory has a different original workspace identity.',
      {expectedWorkspaceId,actualWorkspaceId:existing?.workspaceId??null});
  }
  const controller=new AbortController(),forward=()=>controller.abort(signal?.reason);
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
  const workspace=await openFuulWorkspace({directory,connections,profile,signal:controller.signal,applicationDirectory});
  const secrets=secretValues(connections),active=new Set();let closing=false,closePromise;
  const methods=()=>FUUL_PROGRAMMES_METHODS.map(clone),describe=()=>workspace.describe();
  async function history({offset=0,limit=100}={}){
    integer(offset,'offset');integer(limit,'limit',1,1000);
    const state=await readState(directory),records=await originalHistoryEntries(directory,state);
    return {workspaceId:state.workspaceId,revision:state.revision,offset,total:records.length,
      records:records.slice(offset,offset+limit),nextOffset:offset+limit<records.length?offset+limit:null};
  }
  const dispatch={
    "workspace.describe":describe,
    "workspace.list":workspace.list,
    "workspace.profile":workspace.profileSave,
    "workspace.history":history,
    "request.status":async({requestId})=>{identifier(requestId);const state=await readState(directory);return {workspaceId:state.workspaceId,revision:state.revision,requestId,record:clone(state.requests[requestId]??null)};},
    "programme.save":workspace.programmeSave,
    "programme.read":workspace.programmeRead,
    "source.catalog":workspace.sourceCatalog,
    "action.catalog":workspace.actionCatalog,
    "source.import":workspace.sourceImport,
    "source.project":workspace.sourceProject,
    "source.read":workspace.sourceRead,
    "source.file":workspace.sourceFile,
    "capture.start":workspace.captureStart,
    "capture.read":workspace.captureRead,
    "capture.next":workspace.captureNext,
    "capture.run":workspace.captureRun,
    "capture.pause":workspace.capturePause,
    "capture.resume":workspace.captureResume,
    "event.prepare":workspace.eventPrepare,
    "event.observe":workspace.eventObserve,
    "batch.prepare":workspace.batchPrepare,
    "queue.read":workspace.queueRead,
    "queue.file":workspace.queueFile,
    "queue.next":workspace.dispatch,
    "queue.pause":workspace.queuePause,
    "queue.resume":workspace.queueResume,
    "queue.resolve":workspace.queueResolve,
    "action.prepare":workspace.actionPrepare,
    "run.start":workspace.runStart,
    "run.read":workspace.runRead,
    "run.execute":workspace.runExecute,
    "run.pause":workspace.runPause,
    "run.resume":workspace.runResume,
    "decision.save":workspace.decisionSave,
    "decision.read":workspace.decisionRead,
    "reconciliation.create":workspace.reconcileCreate,
    "edition.read":workspace.editionRead,
    "edition.file":workspace.editionFile,
    "reconciliation.compare":workspace.compare,
    "report.create":workspace.reportCreate,
    "report.read":workspace.reportRead,
    "report.file":workspace.reportFile,
    "workspace.export":async args=>exportFuulWorkspace({...args,directory,runtimes:await workspace.runtimeSelections()}),
    "report.export":args=>exportFuulReport({...args,directory}),
    "package.inspect":inspectFuulDelivery,
    "package.receive":receiveFuulDelivery
  };

  async function tracked(work){
    need(!closing,'OPERATOR_DRAINING','The operator is finishing its active work.');
    const promise=(async()=>work())();active.add(promise);
    try{return await promise;}finally{active.delete(promise);}
  }
  async function invoke({method,args={}}={}){
    need(typeof method==='string'&&Object.hasOwn(dispatch,method),'UNKNOWN_METHOD','Select an available Fuul operator method.',{methods:methods().map(row=>row.method)});
    need(plain(args),'INVALID_ARGUMENT','Supply the complete operation arguments.');
    const entry=FUUL_PROGRAMMES_METHODS.find(row=>row.method===method);
    for(const name of entry.required)need(Object.hasOwn(args,name),'MISSING_ARGUMENT','Supply '+name+'.',{field:name});
    if(entry.mutates){identifier(args.requestId,'requestId');if(method!=='package.receive')integer(args.expectedRevision,'expectedRevision');}
    return tracked(()=>dispatch[method](args));
  }
  async function exported({exportId}){
    const state=await readState(directory),record=selected(state.exports,exportId,'Export');
    return {record,inspection:await readFuulDeliveryManifest({sourceDirectory:record.directory,expectedManifestSha256:record.manifestSha256})};
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
  return {directory,workspace,describe,methods,invoke,exported,reportBody,
    publicError:error=>publicError(error,secrets),close};
}
