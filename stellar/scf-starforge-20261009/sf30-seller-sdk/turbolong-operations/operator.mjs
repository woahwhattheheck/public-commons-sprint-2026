// MIT. Turbolong operating application and complete installed-source receiving.
import {promises as fs} from 'node:fs';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {plain,clone,need,text,hash,identifier,integer,inside,publicError} from './common.mjs';
import {openTurbolongOperationsWorkspace,inspectTurbolongOperationsWorkspace} from './workspace.mjs';
import {TURBOLONG_ACTIONS,TURBOLONG_PUBLIC_CONFIGURATION_SCHEMA} from './catalogue.mjs';
import {resolveTurbolongRuntime,publicTurbolongRuntime} from './runtime.mjs';
import {exportTurbolongWorkspace,exportTurbolongReport,inspectTurbolongDelivery,receiveTurbolongDelivery,turbolongRuntimeReferences} from './receiving.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const query=(name,title,required=[])=>({name,title,mutates:false,required});
const mutation=(name,title,required=[])=>({name,title,mutates:true,required:['requestId','expectedRevision',...required]});
export const TURBOLONG_OPERATIONS_METHODS=Object.freeze([
 query('workspace.describe','Read the operating workspace and current selections'),
 query('catalogue','Read the original keeper and data action catalogue'),
 query('records.page','Page complete periods, vaults, sources, incidents and reports',['table']),
 mutation('profile.save','Save workspace settings',['profile']),
 mutation('period.save','Save an immutable operating-period version',['definition']),
 query('period.read','Read a selected period version',['periodId']),
 mutation('vault.save','Save a vault with its original contract identities',['definition']),
 query('vault.read','Read a selected vault version',['vaultId']),
 mutation('acquisition.save','Save a complete period acquisition and optional cadence',['definition']),
 query('acquisition.read','Read the full acquisition plan and history',['acquisitionId']),
 mutation('acquisition.start','Start or resume the saved read-only acquisition schedule',['acquisitionId']),
 mutation('acquisition.pause','Pause the saved acquisition without changing its cursor',['acquisitionId']),
 mutation('acquisition.run','Run or continue one complete frozen acquisition cycle',['acquisitionId']),
 mutation('operation.prepare','Prepare an original keeper or data request',['connection','action','args']),
 query('operation.read','Read the complete original request, attempts and outcomes',['operationId']),
 mutation('operation.run','Dispatch the selected original native request',['operationId']),
 mutation('operation.reconcile','Reconcile the original pending or uncertain native outcome',['operationId']),
 mutation('operation.collect','Collect every original provider page',['operationId']),
 mutation('operation.pause','Pause an original operation',['operationId']),
 mutation('operation.resume','Resume a retained operation without replacing its request',['operationId']),
 mutation('operation.cancel','Cancel an operation that has never been dispatched',['operationId']),
 mutation('source.import','Retain a complete original JSON, JSONL, log or other source file',['periodId','kind','name']),
 query('source.read','Read complete retained source metadata',['sourceId']),
 query('source.file','Read any declared source member in bounded ranges',['sourceId']),
 mutation('incident.save','Record an incident update and linked original sources',['incident']),
 query('incident.read','Read complete incident history',['incidentId']),
 mutation('correction.save','Record corrective work and its actual native outcomes',['correction']),
 query('correction.read','Read complete correction history',['correctionId']),
 mutation('analysis.create','Freeze and analyse a complete operating period',['periodId']),
 query('analysis.read','Read a complete period analysis edition',['analysisId']),
 query('analysis.file','Read the complete original analysis file',['analysisId']),
 mutation('report.create','Render full HTML, JSON and CSV report members',['analysisId']),
 query('report.read','Read report metadata and all members',['reportId']),
 query('report.file','Read a complete report member',['reportId']),
 mutation('workspace.export','Export the complete workspace, application and original runtimes',['destination']),
 mutation('report.export','Export selected report members',['reportId','destination']),
 query('package.inspect','Verify a complete delivery and all declared members',['sourceDirectory']),
 {name:'package.receive',title:'Receive a full delivery into an independent installation',mutates:true,required:['requestId','sourceDirectory','destination']},
 query('runtime.inspect','Verify an original installed runtime',['runtimeDirectory'])
]);
function method(name){const selected=TURBOLONG_OPERATIONS_METHODS.find(row=>row.name===name);need(selected,'METHOD_NOT_FOUND','Choose a Turbolong operator method.');return selected;}
export async function readTurbolongPrivateJSON(filename,{workspaceDirectory}={}){
 need(typeof filename==='string'&&isAbsolute(filename),'PRIVATE_CONFIG_REQUIRED','Select an absolute private configuration file.');
 const actual=await fs.realpath(filename),stat=await fs.lstat(filename);
 need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'PRIVATE_CONFIG_REQUIRED','Use an owner-readable private regular configuration file.');
 if(workspaceDirectory)need(!inside(resolve(workspaceDirectory),actual),'PRIVATE_CONFIG_IN_WORKSPACE','Keep private configuration outside exported workspace source.');
 const value=JSON.parse(await fs.readFile(actual,'utf8'));need(plain(value),'PRIVATE_CONFIG_REQUIRED','Use a complete private JSON configuration object.');return value;
}
async function outsideWorkspace(path,directory,label){
 need(typeof path==='string'&&isAbsolute(path)&&!inside(directory,resolve(path)),'PRIVATE_CONFIG_IN_WORKSPACE','Keep '+label+' outside the exported workspace.');
 let actual;try{actual=await fs.realpath(path);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(actual)need(!inside(directory,actual),'PRIVATE_CONFIG_IN_WORKSPACE',label+' resolves inside the exported workspace.');
}
function declaredFiles(value,key='',result=[]){
 if(key==='secretFiles'&&plain(value)){for(const child of Object.values(value))if(typeof child==='string')result.push(child);else declaredFiles(child,'credential',result);return result;}
 if(Array.isArray(value)){for(const child of value)declaredFiles(child,key,result);return result;}
 if(!plain(value))return result;
 for(const [name,child]of Object.entries(value)){
  if(typeof child==='string'&&(/(?:secret|key|token|password|credential).*file$/i.test(name)||name==='file'&&/(?:secret|key|token|password|credential)/i.test(key)))result.push(child);
  else if(plain(child)||Array.isArray(child))declaredFiles(child,name,result);
 }return result;
}
export async function loadTurbolongOperationsConfiguration({workspaceDirectory,connectionsFile,profileFile,connections={},profile={},runtimes=[],
 runtimeDirectory,expectedManifestSha256,installationDirectory}={}){
 need(typeof workspaceDirectory==='string','WORKSPACE_REQUIRED','Select the operating workspace directory.');
 const directory=resolve(workspaceDirectory);
 if(connectionsFile){
  const body=await readTurbolongPrivateJSON(resolve(connectionsFile),{workspaceDirectory:directory});
  connections=body.connections??body;runtimes=body.runtimes??runtimes;runtimeDirectory=body.runtimeDirectory??runtimeDirectory;
  expectedManifestSha256=body.expectedManifestSha256??expectedManifestSha256;installationDirectory=body.installationDirectory??installationDirectory;
 }
 if(profileFile)profile=await readTurbolongPrivateJSON(resolve(profileFile),{workspaceDirectory:directory});
 need(plain(connections)&&plain(profile)&&Array.isArray(runtimes),'INVALID_CONFIGURATION','Supply named connections, a workspace profile and runtime selections.');
 const chosen={};
 for(const [alias,original]of Object.entries(connections)){
  text(alias,'connection alias',160);need(plain(original),'INVALID_CONNECTION','Use a complete private named connection.');
  const connection=clone(original);
  const trusted={...connection,...(plain(connection.private)?connection.private:{})};
  if(runtimeDirectory&&!trusted.runtimeDirectory&&!trusted.runtime?.runtimeDirectory&&!trusted.runtime?.directory){
   connection.runtimeDirectory=resolve(runtimeDirectory);if(expectedManifestSha256)connection.expectedManifestSha256=expectedManifestSha256;
   if(installationDirectory)connection.installationDirectory=resolve(installationDirectory);
  }
  for(const path of declaredFiles(connection))await outsideWorkspace(path,directory,'credential files');
  const configured={...connection,...(plain(connection.private)?connection.private:{})};
  for(const path of [configured.runtimeDirectory,configured.runtime?.runtimeDirectory,configured.runtime?.directory,
   configured.installationDirectory,configured.executionDirectory,configured.historyRoot,configured.sourceDirectory,configured.sourceCapsuleFile].filter(Boolean))
   await outsideWorkspace(path,directory,'native installation, history and execution directories');
  chosen[alias]=connection;
 }
 if(runtimeDirectory)runtimes=[...runtimes,{directory:resolve(runtimeDirectory),...(expectedManifestSha256?{expectedManifestSha256}:{}),
  ...(installationDirectory?{installationDirectory:resolve(installationDirectory)}:{})}];
 for(const item of runtimes){need(plain(item)&&typeof item.directory==='string','INVALID_RUNTIME_SOURCE','Select original runtime directories.');
  await outsideWorkspace(item.directory,directory,'retained runtime directories');if(item.expectedManifestSha256)hash(item.expectedManifestSha256);}
 return {connections:chosen,profile:clone(profile),runtimes:clone(runtimes)};
}
function publicFile(value){const result={...value};delete result.content;return {...result,contentBase64:Buffer.from(value.content??[]).toString('base64')};}
export async function openTurbolongOperationsOperator({workspaceDirectory,connections={},profile={},runtimes=[],configuration,
 expectedWorkspaceId,signal,applicationDirectory}={}){
 need(typeof workspaceDirectory==='string','WORKSPACE_REQUIRED','Select the operating workspace directory.');
 const directory=resolve(workspaceDirectory),config=configuration??await loadTurbolongOperationsConfiguration({workspaceDirectory:directory,connections,profile,runtimes});
 const previous=await inspectTurbolongOperationsWorkspace({directory,allowMissing:true});
 if(expectedWorkspaceId)need(previous?.workspaceId===identifier(expectedWorkspaceId),'WORKSPACE_IDENTITY_MISMATCH','The installation has a different workspace identity.');
 const selectedRuntimes=new Map();let workspace;
 async function resolveRuntimes(){
  const selected=[...config.runtimes],required=workspace?turbolongRuntimeReferences(await workspace.readState()):[];
  for(const connection of Object.values(config.connections)){
   const configured={...connection,...(plain(connection.private)?connection.private:{})};
   const value=configured.runtime??configured,destination=value.runtimeDirectory??value.directory??configured.runtimeDirectory;
   if(!destination)continue;
   try{await fs.access(join(destination,'manifest.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
   selected.push({directory:destination,expectedManifestSha256:value.expectedManifestSha256??configured.expectedManifestSha256});
  }
  for(const item of selected){
   const runtime=await resolveTurbolongRuntime({runtimeDirectory:item.directory,...(item.expectedManifestSha256?{expectedManifestSha256:item.expectedManifestSha256}:{})});
   const old=selectedRuntimes.get(runtime.id);need(!old||old.manifestSha256===runtime.manifestSha256,'RUNTIME_SOURCE_CHANGED','One runtime ID names different retained source.');
   selectedRuntimes.set(runtime.id,runtime);
  }
  for(const pin of required)need(selectedRuntimes.get(pin.id)?.manifestSha256===pin.manifestSha256,'RUNTIME_SOURCE_REQUIRED',
   'Attach every original runtime used by this workspace before exporting.',{runtimeId:pin.id,manifestSha256:pin.manifestSha256});
  return [...selectedRuntimes.values()];
 }
 workspace=await openTurbolongOperationsWorkspace({directory,connections:config.connections,profile:config.profile,
  runtimeSelections:async()=>(await resolveRuntimes()).map(item=>({directory:item.directory,expectedManifestSha256:item.manifestSha256}))});
 const identity=(await workspace.readState()).workspaceId;
 async function checkIdentity(){need((await workspace.readState()).workspaceId===identity,'WORKSPACE_IDENTITY_MISMATCH','The workspace at this directory changed.');}
 async function describe(){await checkIdentity();return {...await workspace.describe(),operator:{applicationDirectory:applicationDirectory??HERE,
  methods:TURBOLONG_OPERATIONS_METHODS.length,sourceSelection:'source-files.json'}};}
 async function invoke({method:name,args={}}={}){
  const selected=method(name);need(plain(args),'INVALID_ARGUMENT','Supply a complete operator argument object.');
  for(const field of selected.required)need(Object.hasOwn(args,field),'INVALID_ARGUMENT','Supply '+field+'.');
  if(selected.mutates){identifier(args.requestId);if(selected.required.includes('expectedRevision'))integer(args.expectedRevision,'expectedRevision',0);}
  await checkIdentity();
  const methods={
   'workspace.describe':()=>describe(),'catalogue':()=>workspace.catalog(),'records.page':()=>workspace.page(args),
   'profile.save':()=>workspace.profileSave(args),'period.save':()=>workspace.periodSave(args),'period.read':()=>workspace.periodRead(args),
   'vault.save':()=>workspace.vaultSave(args),'vault.read':()=>workspace.vaultRead(args),
   'acquisition.save':()=>workspace.acquisitionSave(args),'acquisition.read':()=>workspace.acquisitionRead(args),
   'acquisition.start':()=>workspace.acquisitionStart(args),'acquisition.pause':()=>workspace.acquisitionPause(args),
   'acquisition.run':()=>workspace.acquisitionRun(args,{signal}),
   'operation.prepare':()=>workspace.operationPrepare(args),'operation.read':()=>workspace.operationRead(args),
   'operation.run':()=>workspace.operationRun(args,{signal}),'operation.reconcile':()=>workspace.operationReconcile(args,{signal}),
   'operation.collect':()=>workspace.operationCollect(args,{signal}),'operation.pause':()=>workspace.operationPause(args),
   'operation.resume':()=>workspace.operationResume(args),'operation.cancel':()=>workspace.operationCancel(args),
   'source.import':()=>workspace.sourceImport(args),'source.read':()=>workspace.sourceRead(args),'source.file':async()=>publicFile(await workspace.sourceFile(args)),
   'incident.save':()=>workspace.incidentSave(args),'incident.read':()=>workspace.incidentRead(args),
   'correction.save':()=>workspace.correctionSave(args),'correction.read':()=>workspace.correctionRead(args),
   'analysis.create':()=>workspace.analysisCreate(args),'analysis.read':()=>workspace.analysisRead(args),'analysis.file':async()=>publicFile(await workspace.analysisFile(args)),
   'report.create':()=>workspace.reportCreate(args),'report.read':()=>workspace.reportRead(args),'report.file':async()=>publicFile(await workspace.reportFile(args)),
   'workspace.export':async()=>exportTurbolongWorkspace({...args,directory,runtimes:await workspace.runtimeSelections()}),
   'report.export':()=>exportTurbolongReport({...args,directory}),
   'package.inspect':()=>inspectTurbolongDelivery(args),'package.receive':()=>receiveTurbolongDelivery(args),
   'runtime.inspect':async()=>publicTurbolongRuntime(await resolveTurbolongRuntime({runtimeDirectory:args.runtimeDirectory,expectedManifestSha256:args.expectedManifestSha256}))
  };
  return methods[name]();
 }
 async function importSource(args,{file}={}){await checkIdentity();identifier(args.requestId);integer(args.expectedRevision,'expectedRevision',0);return workspace.sourceImport(args,{file});}
 async function exported(exportId){const state=await workspace.readState(),row=state.exports[identifier(exportId)];
  need(row,'NOT_FOUND','The original export is absent.');return clone(row);}
 async function close(){await workspace.close();}
 return Object.freeze({directory,workspace,describe,methods:()=>clone(TURBOLONG_OPERATIONS_METHODS),invoke,exported,importSource,
  publicConfigurationSchema:()=>clone(TURBOLONG_PUBLIC_CONFIGURATION_SCHEMA),publicError,close});
}
