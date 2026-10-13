// MIT. Complete Pollar partner operator on its original source workspace.
import {promises as fs} from 'node:fs';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {plain,clone,need,text,hash,identifier,integer,inside,publicError,publicRuntimePin} from './common.mjs';
import {openPollarPartnerWorkspace,inspectPollarPartnerWorkspace} from './workspace.mjs';
import {POLLAR_BROWSER_ACTIONS,POLLAR_NATIVE_ACTIONS,POLLAR_PUBLIC_CONFIGURATION_SCHEMA} from './catalogue.mjs';
import {buildPollarRuntime,retainPollarRuntime,resolvePollarRuntime,restorePollarRuntime,bindPollarRuntime,publicPollarRuntime} from './runtime.mjs';
import {exportPollarWorkspace,exportPollarReport,inspectPollarDelivery,receivePollarDelivery,pollarRuntimeReferences} from './receiving.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const mutation=(name,title,required,properties={})=>({name,title,mutates:true,required:['requestId','expectedRevision',...required],properties});
const query=(name,title,required=[])=>({name,title,mutates:false,required});
export const POLLAR_PARTNER_METHODS=Object.freeze([
 query('workspace.describe','Read the original partner workspace'),
 query('catalogue','Read original SDK and connected operator action catalogues'),
 query('records.page','Page complete original applications, participants, operations, sources, snapshots and reports',['table']),
 mutation('profile.save','Save the complete workspace profile',['profile']),
 mutation('application.save','Save a version of the original public partner configuration',['name','configuration']),
 query('application.read','Read a saved original application version',['applicationId']),
 mutation('participant.verify','Bind an actual original SDK session to its provider user, application and network',['applicationId','connection']),
 mutation('operation.prepare','Prepare an original SDK or operator action with its complete original input',['applicationId','mode','action','args']),
 query('operation.read','Read the original operation and all retained provider outcomes',['operationId']),
 mutation('operation.run','Dispatch the original prepared operator request once',['operationId']),
 mutation('operation.reconcile','Read the provider outcome of an original pending or uncertain request',['operationId']),
 mutation('operation.collect','Retain every original operator read page and its continuation',['operationId']),
 mutation('operation.pause','Pause the selected original operation',['operationId']),
 mutation('operation.resume','Resume the selected original operation without changing its native request',['operationId']),
 mutation('operation.cancel','Cancel an original request that has never been dispatched',['operationId']),
 mutation('browser.start','Retain the original browser SDK dispatch boundary',['operationId']),
 mutation('browser.outcome','Retain the original public browser outcome and provider identities',['operationId','attemptId','outcome']),
 mutation('browser.observed','Receive the original onboarding observation after session verification',['applicationId','participantId','operationId','action','args','outcome']),
 query('source.read','Read the complete retained source metadata',['sourceId']),
 query('source.file','Read original source or response bytes in complete bounded ranges',['sourceId']),
 mutation('snapshot.create','Freeze complete original wallet, application, treasury or operation observations',['applicationId','name']),
 query('snapshot.read','Read an original complete snapshot',['snapshotId']),
 mutation('decision.save','Record a source-bound operating decision',['applicationId','decision']),
 mutation('report.create','Create complete JSON, CSV and HTML reports from an original snapshot',['snapshotId']),
 query('report.read','Read original report metadata and members',['reportId']),
 query('report.file','Read complete original report bytes',['reportId']),
 mutation('workspace.export','Export complete original workspace, source application, runtime and history',['destination']),
 mutation('report.export','Export selected original report files',['reportId','destination']),
 query('package.inspect','Inspect the complete original delivery and every member',['sourceDirectory']),
 {name:'package.receive',title:'Receive a complete original delivery into an independent runnable installation',mutates:true,required:['requestId','sourceDirectory','destination']},
 query('runtime.inspect','Verify the complete selected Pollar runtime',['runtimeDirectory'])
]);
function knownMethod(name){const entry=POLLAR_PARTNER_METHODS.find(row=>row.name===name);need(entry,'METHOD_NOT_FOUND','Select an original partner operator method.');return entry;}
export async function readPollarPrivateJSON(filename,{workspaceDirectory}={}){
 need(typeof filename==='string'&&isAbsolute(filename),'PRIVATE_CONFIG_REQUIRED','Select an absolute private configuration file.');
 const actual=await fs.realpath(filename),stat=await fs.lstat(filename);
 need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'PRIVATE_CONFIG_REQUIRED','Use an owner-readable private regular configuration file.');
 if(workspaceDirectory)need(!inside(resolve(workspaceDirectory),actual),'PRIVATE_CONFIG_IN_WORKSPACE','Keep private connection configuration outside exported workspace source.');
 const value=JSON.parse(await fs.readFile(actual,'utf8'));need(plain(value),'PRIVATE_CONFIG_REQUIRED','The original private configuration must be an object.');return value;
}
function connectionFiles(connection){
 const result=[];for(const field of ['serverSecretKey','personalAccessToken']){
  const selected=connection[field];if(plain(selected)&&selected.file)result.push(selected.file);
 }return result;
}
export async function loadPollarPartnerConfiguration({workspaceDirectory,connectionsFile,profileFile,connections={},profile={},runtimeDirectory,
 expectedManifestSha256,installationDirectory,runtimes=[],portalConnections={}}={}){
 const directory=resolve(workspaceDirectory);
 if(connectionsFile){
  const body=await readPollarPrivateJSON(resolve(connectionsFile),{workspaceDirectory:directory});
  connections=body.connections??body;portalConnections=body.portalConnections??portalConnections;
  runtimes=body.runtimes??runtimes;runtimeDirectory=body.runtimeDirectory??runtimeDirectory;
  expectedManifestSha256=body.expectedManifestSha256??expectedManifestSha256;installationDirectory=body.installationDirectory??installationDirectory;
 }
 if(profileFile)profile=await readPollarPrivateJSON(resolve(profileFile),{workspaceDirectory:directory});
 need(plain(connections)&&plain(profile)&&plain(portalConnections)&&Array.isArray(runtimes),'INVALID_CONFIGURATION','Supply original named connections, runtimes and profile.');
 for(const [alias,connection]of Object.entries(connections)){
  text(alias,'connection alias',160);need(plain(connection),'INVALID_CONNECTION','Select an original private connection.');
  for(const file of connectionFiles(connection)){
   need(typeof file==='string'&&isAbsolute(file)&&!inside(directory,resolve(file)),'PRIVATE_CONFIG_IN_WORKSPACE','Keep original credential files outside exported workspace source.');
   const actual=await fs.realpath(file);need(!inside(directory,actual),'PRIVATE_CONFIG_IN_WORKSPACE','A credential file resolves inside the workspace.');
  }
 }
 if(runtimeDirectory)runtimes=[...runtimes,{directory:resolve(runtimeDirectory),...(expectedManifestSha256?{expectedManifestSha256}:{}),...(installationDirectory?{installationDirectory:resolve(installationDirectory)}:{})}];
 for(const item of runtimes){
  need(plain(item)&&typeof item.directory==='string'&&isAbsolute(item.directory),'INVALID_RUNTIME_SOURCE','Select original retained runtime directories.');
  need(!inside(directory,resolve(item.directory)),'RUNTIME_IN_WORKSPACE','Keep retained runtime graphs outside original operating records.');
  if(item.expectedManifestSha256)hash(item.expectedManifestSha256);
 }
 return {connections,profile,runtimes,portalConnections};
}
function publicFile(value){
 const result={...value};delete result.content;return {...result,contentBase64:Buffer.from(value.content??[]).toString('base64')};
}
export async function openPollarPartnerOperator({workspaceDirectory,connections={},profile={},runtimes=[],portalConnections={},
 expectedWorkspaceId,signal,applicationDirectory,configuration}={}){
 const directory=resolve(workspaceDirectory),privateConfig=configuration??await loadPollarPartnerConfiguration({workspaceDirectory:directory,connections,profile,runtimes,portalConnections});
 const previous=await inspectPollarPartnerWorkspace({directory,allowMissing:true});
 if(expectedWorkspaceId)need(previous?.workspaceId===identifier(expectedWorkspaceId),'WORKSPACE_IDENTITY_MISMATCH','The selected installation has a different original workspace identity.');
 const retained=new Map();
 async function resolveRuntimes(){
  for(const selected of privateConfig.runtimes){
   const runtime=await resolvePollarRuntime({runtimeDirectory:selected.directory,expectedManifestSha256:selected.expectedManifestSha256,
    installationDirectory:selected.installationDirectory??applicationDirectory??HERE});
   const prior=retained.get(runtime.id);need(!prior||prior.manifestSha256===runtime.manifestSha256,'RUNTIME_SOURCE_CHANGED','One runtime ID names different files.');
   retained.set(runtime.id,runtime);
  }
  return [...retained.values()];
 }
 const workspace=await openPollarPartnerWorkspace({directory,connections:privateConfig.connections,profile:privateConfig.profile,
  browserCatalogue:POLLAR_BROWSER_ACTIONS,runtimeSelections:async()=>(await resolveRuntimes()).map(runtime=>({directory:runtime.directory,expectedManifestSha256:runtime.manifestSha256}))});
 const identity=(await workspace.describe()).workspaceId;
 async function ensureIdentity(){need((await workspace.readState()).workspaceId===identity,'WORKSPACE_IDENTITY_MISMATCH','The original host workspace identity changed.');}
 async function describe(){
  const state=await workspace.describe();return {...state,operator:{sourceDirectory:HERE,
   browserOrigin:privateConfig.profile.portalOrigin??null},runtimes:(await resolveRuntimes()).map(publicPollarRuntime)};
 }
 async function methods(){return {methods:clone(POLLAR_PARTNER_METHODS),native:clone(POLLAR_NATIVE_ACTIONS),
  browser:clone(POLLAR_BROWSER_ACTIONS),publicConfiguration:clone(POLLAR_PUBLIC_CONFIGURATION_SCHEMA)};}
 async function invoke({method,args={},ephemeral={}}={}){
  await ensureIdentity();const entry=knownMethod(method);need(plain(args),'INVALID_ARGUMENT','Supply original JSON arguments.');
  for(const field of entry.required)need(Object.hasOwn(args,field),'INVALID_ARGUMENT','Supply '+field+'.');
  switch(method){
   case 'workspace.describe':return describe();
   case 'catalogue':return workspace.catalog(args);
   case 'records.page':return workspace.page(args);
   case 'profile.save':return workspace.profileSave(args);
   case 'application.save':{
    if(args.runtimeId){await resolveRuntimes();const selected=retained.get(hash(args.runtimeId));need(selected,'RUNTIME_SOURCE_REQUIRED','Attach the complete original runtime before selecting it.');
     args={...args,runtime:publicPollarRuntime(selected),configuration:{...args.configuration,runtimeId:selected.id,
      runtimeManifestSha256:selected.manifestSha256,runtimeModuleUrl:'/api/runtimes/'+selected.id+'/pollar-runtime.mjs'}};}
    return workspace.applicationSave(args);
   }
   case 'application.read':return workspace.applicationRead(args);
   case 'participant.verify':return workspace.participantVerify(args,{accessToken:ephemeral.accessToken});
   case 'operation.prepare':return workspace.operationPrepare(args);
   case 'operation.read':return workspace.operationRead(args);
   case 'operation.run':return workspace.operationRun(args,{signal});
   case 'operation.reconcile':return workspace.operationReconcile(args,{signal});
   case 'operation.collect':return workspace.operationCollect(args,{signal});
   case 'operation.pause':return workspace.operationPause(args);
   case 'operation.resume':return workspace.operationResume(args);
   case 'operation.cancel':return workspace.operationCancel(args);
   case 'browser.start':return workspace.browserStart(args);
   case 'browser.outcome':return workspace.browserOutcome(args);
   case 'browser.observed':return workspace.browserObserved(args);
   case 'source.read':return workspace.sourceRead(args);
   case 'source.file':return publicFile(await workspace.sourceFile(args));
   case 'snapshot.create':return workspace.snapshotCreate(args);
   case 'snapshot.read':return workspace.snapshotRead(args);
   case 'decision.save':return workspace.decisionSave(args);
   case 'report.create':return workspace.reportCreate(args);
   case 'report.read':return workspace.reportRead(args);
   case 'report.file':return publicFile(await workspace.reportFile(args));
   case 'workspace.export':return exportPollarWorkspace({directory,runtimes:await workspace.runtimeSelections(),...args});
   case 'report.export':return exportPollarReport({directory,...args});
   case 'package.inspect':return inspectPollarDelivery(args);
   case 'package.receive':return receivePollarDelivery(args);
   case 'runtime.inspect':{
    const runtime=await resolvePollarRuntime(args);return {...publicPollarRuntime(runtime),directory:runtime.directory,
     browser:runtime.browser,fileCount:runtime.manifest.fileCount,bytes:runtime.manifest.bytes};
   }
   default:need(false,'METHOD_NOT_FOUND','The selected operator method is unavailable.');
  }
 }
 async function runtime(id){
  await resolveRuntimes();const selected=retained.get(hash(id));need(selected,'RUNTIME_SOURCE_REQUIRED','Attach this original application runtime generation.');return selected;
 }
 async function portalApplication(applicationId,version){
  const current=await workspace.readState();
  const selectedId=applicationId??current.profile.portalApplicationId??Object.keys(current.applications)[0];
  need(selectedId,'APPLICATION_REQUIRED','Configure a partner application before opening the customer portal.');
  const selected=await workspace.applicationRead({applicationId:selectedId,version});
  const configuration=clone(selected.version.configuration),runtimePin=selected.version.runtime;
  need(runtimePin,'RUNTIME_SOURCE_REQUIRED','Attach the complete original browser runtime to this application version.');
  const original=await runtime(runtimePin.id);
  need(original.manifestSha256===runtimePin.manifestSha256,'RUNTIME_SOURCE_CHANGED','The original application runtime differs.');
  configuration.runtimeModuleUrl='/api/runtimes/'+original.id+'/pollar-runtime.mjs';
  return {workspaceId:identity,revision:current.revision,applicationId:selected.application.id,applicationVersion:selected.version.version,
   name:selected.version.name,configuration,runtime:publicPollarRuntime(original)};
 }
 async function verifyPortal({applicationId,applicationVersion,accessToken,requestId}){
  const chosen=await portalApplication(applicationId,applicationVersion),configuration=chosen.configuration;
  const alias=privateConfig.portalConnections[applicationId]??Object.keys(privateConfig.connections).find(name=>{
   const connection=privateConfig.connections[name];return connection.applicationId===configuration.applicationId&&connection.network===configuration.stellarNetwork;
  });
  need(alias,'PORTAL_VERIFICATION_CONNECTION_REQUIRED','Attach the original matching private server connection for session verification.');
  const connection=privateConfig.connections[alias];
  need(connection.applicationId===configuration.applicationId&&connection.network===configuration.stellarNetwork,'SESSION_APPLICATION_MISMATCH','The private verification connection differs from the selected application.');
  const current=await workspace.readState();
  const result=await workspace.participantVerify({requestId,expectedRevision:current.revision,applicationId:chosen.applicationId,
   applicationVersion:chosen.applicationVersion,connection:alias},{accessToken});
  return {...result,application:chosen};
 }
 async function portalInvoke({method,args={},session}){
  await ensureIdentity();need(session?.workspaceId===identity,'PORTAL_SESSION_REQUIRED','Verify the original SDK session for this host.');
  const current=await workspace.readState(),participant=current.participants[session.participantId];
  need(participant?.applicationId===session.applicationId,'PORTAL_SESSION_REQUIRED','The verified original participant is absent.');
  const allowed=new Set(['operation.prepare','operation.read','operation.pause','operation.resume','browser.start','browser.outcome','browser.observed',
   'records.page','source.read','source.file','snapshot.create','snapshot.read','report.create','report.read','report.file']);
  need(allowed.has(method),'PORTAL_METHOD_UNAVAILABLE','Use an original customer wallet or reporting operation.');
  if(args.operationId){const operation=current.operations[args.operationId];
   if(method!=='browser.observed')need(operation?.participantId===session.participantId&&operation.applicationId===session.applicationId,
    'PARTICIPANT_SCOPE_MISMATCH','Select your own original customer operation.');}
  for(const [key,table]of [['sourceId','sources'],['snapshotId','snapshots'],['reportId','reports']])if(args[key]){
   const row=current[table][identifier(args[key])];need(row?.participantId===session.participantId&&row.applicationId===session.applicationId,
    'PARTICIPANT_SCOPE_MISMATCH','Select your own original customer record.');
  }
  let scoped={...args};
  if(['operation.prepare','browser.observed','snapshot.create'].includes(method)){
   scoped={...scoped,applicationId:session.applicationId,applicationVersion:session.applicationVersion,participantId:session.participantId};
   if(method==='operation.prepare'){need(args.mode===undefined||args.mode==='browser','PORTAL_METHOD_UNAVAILABLE','Customer actions use the original browser SDK.');
    scoped.mode='browser';delete scoped.connection;delete scoped.runtime;}
  }
  if(method==='records.page'){
   need(['operations','sources','snapshots','reports'].includes(args.table),'PORTAL_METHOD_UNAVAILABLE','Select your original customer activity.');
   scoped={...scoped,applicationId:session.applicationId,participantId:session.participantId};
  }
  return invoke({method,args:scoped});
 }
 async function exported(exportId){
  const current=await workspace.readState(),row=current.exports[identifier(exportId)];need(row,'NOT_FOUND','The original complete export is absent.');return clone(row);
 }
 async function close(){await workspace.close();}
 return Object.freeze({directory,workspace,describe,methods,invoke,portalApplication,verifyPortal,portalInvoke,runtime,exported,close,
  publicError:(error)=>publicError(error)});
}
