// MIT. Private operator boundary for the complete Stellar ratings wallet and activity workspace.
import {promises as fs} from 'node:fs';
import {resolve,isAbsolute,dirname,basename,join} from 'node:path';
import {openStellarRatingsWorkspace,inspectStellarRatingsWorkspace} from './workspace.mjs';
import {exportRatingsWorkspace,exportRatingsReport,inspectRatingsDelivery,readRatingsDeliveryManifest,receiveRatingsDelivery} from './receiving.mjs';
import {need,plain,clone,integer,identifier,inside,readState,publicError,selected,originalHistoryEntries,readDescriptor} from './common.mjs';

const entries=[
 [
  "workspace.describe",
  false,
  [],
  "Read current registry, wallet and daily collection work."
 ],
 [
  "workspace.list",
  false,
  [
   "table"
  ],
  "Page complete original work tables."
 ],
 [
  "workspace.profile",
  true,
  [
   "profile"
  ],
  "Save the organization and operating profile."
 ],
 [
  "workspace.history",
  false,
  [],
  "Read original workspace transitions."
 ],
 [
  "request.status",
  false,
  [
   "requestId"
  ],
  "Recover the retained result of an original request."
 ],
 [
  "registry.save",
  true,
  [
   "definition"
  ],
  "Save an immutable network and asset registry version."
 ],
 [
  "registry.read",
  false,
  [
   "registryId"
  ],
  "Read the complete original registry version."
 ],
 [
  "policy.save",
  true,
  [
   "definition"
  ],
  "Save an original rating, freshness and coverage policy version."
 ],
 [
  "policy.read",
  false,
  [
   "policyId"
  ],
  "Read the complete retained wallet policy."
 ],
 [
  "source.catalog",
  false,
  [],
  "Read configured original service routes and their schemas."
 ],
 [
  "source.import",
  true,
  [
   "provider",
   "kind",
   "bodyBase64"
  ],
  "Retain complete original source bytes and projections."
 ],
 [
  "source.project",
  true,
  [
   "sourceId"
  ],
  "Append a new original source projection."
 ],
 [
  "source.read",
  false,
  [
   "sourceId"
  ],
  "Read the original source manifest and page its records."
 ],
 [
  "source.file",
  false,
  [
   "sourceId"
  ],
  "Read complete source body, metadata or projection file ranges."
 ],
 [
  "capture.start",
  true,
  [
   "registryId",
   "connectionAlias",
   "read"
  ],
  "Freeze a registry version and complete original native read."
 ],
 [
  "capture.read",
  false,
  [
   "captureId"
  ],
  "Read capture progress and original attempts."
 ],
 [
  "capture.next",
  true,
  [
   "captureId"
  ],
  "Continue or recover one original native page."
 ],
 [
  "capture.run",
  true,
  [
   "captureId"
  ],
  "Complete the selected native source capture."
 ],
 [
  "capture.pause",
  true,
  [
   "captureId"
  ],
  "Pause the original capture with its cursor intact."
 ],
 [
  "capture.resume",
  true,
  [
   "captureId"
  ],
  "Resume the retained original source selection."
 ],
 [
  "wallet.review",
  true,
  [
   "registryId",
   "policyId",
   "addresses"
  ],
  "Capture and review complete original Stellar wallets."
 ],
 [
  "activity.collect",
  true,
  [
   "registryId",
   "policyId",
   "period"
  ],
  "Collect a complete UTC daily activity edition."
 ],
 [
  "run.start",
  true,
  [
   "registryId",
   "policyId",
   "kind"
  ],
  "Freeze a complete wallet review or daily activity programme."
 ],
 [
  "run.read",
  false,
  [
   "runId"
  ],
  "Read source tasks, retained progress and original continuation."
 ],
 [
  "run.next",
  true,
  [
   "runId"
  ],
  "Advance one original planning, capture or publication step."
 ],
 [
  "run.continue",
  true,
  [
   "runId"
  ],
  "Complete every source task and publish the immutable result."
 ],
 [
  "run.pause",
  true,
  [
   "runId"
  ],
  "Pause a full review while preserving its exact continuation."
 ],
 [
  "run.resume",
  true,
  [
   "runId"
  ],
  "Resume the original review or repair its failed sources."
 ],
 [
  "collection.save",
  true,
  [
   "definition"
  ],
  "Save a versioned daily collection from its accepted launch date."
 ],
 [
  "collection.read",
  false,
  [
   "collectionId"
  ],
  "Read the original collection and its full dated editions."
 ],
 [
  "collection.run",
  true,
  [
   "collectionId"
  ],
  "Collect every selected UTC day through the original exclusive boundary."
 ],
 [
  "collection.pause",
  true,
  [
   "collectionId"
  ],
  "Pause the collection and its active daily run."
 ],
 [
  "collection.resume",
  true,
  [
   "collectionId"
  ],
  "Resume the same original dates, sources and pending run."
 ],
 [
  "decision.save",
  true,
  [
   "registryId",
   "sourceId",
   "recordId",
   "action",
   "actor",
   "reason"
  ],
  "Append an attributed inclusion, exclusion or asset mapping."
 ],
 [
  "decision.read",
  false,
  [
   "decisionId"
  ],
  "Read the original attribution decision."
 ],
 [
  "edition.read",
  false,
  [
   "editionId"
  ],
  "Read an immutable wallet or daily result and its complete tables."
 ],
 [
  "edition.file",
  false,
  [
   "editionId"
  ],
  "Read the complete original edition file."
 ],
 [
  "edition.compare",
  false,
  [
   "leftEditionId",
   "rightEditionId"
  ],
  "Compare two original wallet or activity editions."
 ],
 [
  "report.create",
  true,
  [
   "editionId"
  ],
  "Create complete scoped HTML, CSV and JSON reports."
 ],
 [
  "report.read",
  false,
  [
   "reportId"
  ],
  "Read the complete report manifest."
 ],
 [
  "report.file",
  false,
  [
   "reportId"
  ],
  "Read complete report file ranges."
 ],
 [
  "lookup.read",
  false,
  [],
  "Read private successful-wallet lookup counts and their history."
 ],
 [
  "wallet.popular",
  false,
  [],
  "Read popular-wallet rank tiers and original public labels."
 ],
 [
  "workspace.export",
  true,
  [
   "destination"
  ],
  "Export the full application, workspace and original licensed runtimes."
 ],
 [
  "report.export",
  true,
  [
   "reportId",
   "destination"
  ],
  "Export complete original report artifacts."
 ],
 [
  "package.inspect",
  false,
  [
   "sourceDirectory"
  ],
  "Inspect the complete source, runtime and workspace delivery."
 ],
 [
  "package.receive",
  true,
  [
   "sourceDirectory",
   "destination"
  ],
  "Receive an independent complete continuing installation."
 ]
];

export const RATINGS_METHODS=Object.freeze(entries.map(([method,mutates,required,description])=>Object.freeze({
  method,mutates,required:Object.freeze(required),description,
  ...(mutates?{requestId:'UUID',...(method!=='package.receive'?{expectedRevision:'nonnegative integer'}:{})}:{})
})));
export async function readRatingsPrivateJSON(path,{maximumBytes=64*1024*1024}={}){
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
async function validatePrivateRatingsConnections(directory,connections){
 need(plain(connections),'INVALID_CONFIGURATION','Supply the original connection aliases as an object.');
 const workspace=await canonicalPrivateLocation(directory);
 for(const [alias,connection] of Object.entries(connections)){
  need(plain(connection),'INVALID_CONFIGURATION','Each selected connection must contain its original configuration.',{alias});
  if(connection.tokenFile===undefined||connection.tokenFile===null)continue;
  need(typeof connection.tokenFile==='string'&&connection.tokenFile.length>0&&!connection.tokenFile.includes('\0'),
   'INVALID_CONFIGURATION','Select the original private private token file.',{alias});
  // Match the original adapter's path resolution, including a not-yet-created
  // token file under an existing real parent. The complete workspace may later
  // export any of its retained source directories.
  const tokenFile=await canonicalPrivateLocation(connection.tokenFile);
  need(!inside(workspace,tokenFile),'PRIVATE_CONFIGURATION_LOCATION',
   'Keep the private token file in private operator configuration outside the exported workspace.',{alias});
 }
}
export async function loadStellarRatingsConfiguration({workspaceDirectory,connectionsFile,profileFile}={}){
  need(typeof workspaceDirectory==='string','INVALID_DIRECTORY','Select the Stellar ratings workspace directory.');
  const directory=resolve(workspaceDirectory);let connections={},profile={};
  if(connectionsFile){
    const path=await fs.realpath(resolve(connectionsFile));
    const workspace=await canonicalPrivateLocation(directory);
    need(!inside(workspace,path),'PRIVATE_CONFIGURATION_LOCATION','Keep service credentials in private operator configuration outside the workspace.');
    connections=await readRatingsPrivateJSON(path);
  }
  if(profileFile)profile=await readRatingsPrivateJSON(resolve(profileFile));
  await validatePrivateRatingsConnections(directory,connections);
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
export async function openStellarRatingsOperator({workspaceDirectory,connections={},profile={},expectedWorkspaceId,signal,applicationDirectory,installationDirectory,runtime={}}={}){
  need(typeof workspaceDirectory==='string'&&isAbsolute(workspaceDirectory),'INVALID_DIRECTORY','Select an absolute Stellar ratings workspace directory.');
  const directory=resolve(workspaceDirectory);
  await validatePrivateRatingsConnections(directory,connections);
  if(expectedWorkspaceId){
    identifier(expectedWorkspaceId,'expected workspace ID');
    const existing=await inspectStellarRatingsWorkspace({directory,allowMissing:true});
    need(existing&&existing.workspaceId===expectedWorkspaceId,'WORKSPACE_IDENTITY_MISMATCH','This directory has a different original workspace identity.',
      {expectedWorkspaceId,actualWorkspaceId:existing?.workspaceId??null});
  }
  const controller=new AbortController(),forward=()=>controller.abort(signal?.reason);
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
  const workspace=await openStellarRatingsWorkspace({directory,connections,profile,signal:controller.signal,applicationDirectory,installationDirectory,runtime});
  const secrets=secretValues(connections),active=new Set();let closing=false,closePromise;
  const methods=()=>RATINGS_METHODS.map(clone),describe=()=>workspace.describe();
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
"registry.save":workspace.registrySave,
"registry.read":workspace.registryRead,
"policy.save":workspace.policySave,
"policy.read":workspace.policyRead,
"source.catalog":workspace.sourceCatalog,
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
"wallet.review":workspace.walletReview,
"activity.collect":workspace.activityCollect,
"run.start":workspace.runStart,
"run.read":workspace.runRead,
"run.next":workspace.runNext,
"run.continue":workspace.runContinue,
"run.pause":workspace.runPause,
"run.resume":workspace.runResume,
"collection.save":workspace.collectionSave,
"collection.read":workspace.collectionRead,
"collection.run":workspace.collectionRun,
"collection.pause":workspace.collectionPause,
"collection.resume":workspace.collectionResume,
"decision.save":workspace.decisionSave,
"decision.read":workspace.decisionRead,
"edition.read":workspace.editionRead,
"edition.file":workspace.editionFile,
"edition.compare":workspace.editionCompare,
"report.create":workspace.reportCreate,
"report.read":workspace.reportRead,
"report.file":workspace.reportFile,
"lookup.read":workspace.lookupRead,
"wallet.popular":workspace.popularRead,
"workspace.history":history,
"request.status":async({requestId})=>{identifier(requestId);const state=await readState(directory);return {workspaceId:state.workspaceId,revision:state.revision,requestId,record:clone(state.requests[requestId]??null)};},
"workspace.export":async args=>exportRatingsWorkspace({...args,directory,runtimes:await workspace.runtimeSelections()}),
"report.export":args=>exportRatingsReport({...args,directory}),
"package.inspect":inspectRatingsDelivery,
"package.receive":receiveRatingsDelivery
  };

  async function tracked(work){
    need(!closing,'OPERATOR_DRAINING','The operator is finishing its active work.');
    const promise=(async()=>work())();active.add(promise);
    try{return await promise;}finally{active.delete(promise);}
  }
  async function invoke({method,args={}}={}){
    need(typeof method==='string'&&Object.hasOwn(dispatch,method),'UNKNOWN_METHOD','Select an available Stellar ratings operator method.',{methods:methods().map(row=>row.method)});
    need(plain(args),'INVALID_ARGUMENT','Supply the complete operation arguments.');
    const entry=RATINGS_METHODS.find(row=>row.method===method);
    for(const name of entry.required)need(Object.hasOwn(args,name),'MISSING_ARGUMENT','Supply '+name+'.',{field:name});
    if(entry.mutates){identifier(args.requestId,'requestId');if(method!=='package.receive')integer(args.expectedRevision,'expectedRevision');}
    return tracked(()=>dispatch[method](args));
  }
  async function exported({exportId}){
    const state=await readState(directory),record=selected(state.exports,exportId,'Export');
    return {record,inspection:await readRatingsDeliveryManifest({sourceDirectory:record.directory,expectedManifestSha256:record.manifestSha256})};
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
