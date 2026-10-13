// MIT. Prepare and launch the original Task Desk with its retained installation roots.
import {constants} from 'node:fs';
import {lstat,realpath,open,link,unlink,mkdir} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {inspectMerchantRuntime} from '../../../../sf46-release/runtime-package.mjs';
import {readDistributionSpecification} from '../../../../distribution/specification.mjs';
import {operationLease,privateDirectory,makePrivate,saveJSON} from '../../../../distribution/runtime-workspace/storage.mjs';
import {connectTaskDesk,privateJson} from '../../../../../../stellar-forge/mcp-merchant-operator/task-desk-connection.mjs';

export const TASK_DESK_INSTALLATION_SCHEMA='stellar-forge.task-desk-installation.v1';
const PREPARED='stellar-forge.task-desk-installation-preparation.v1';
const PREFIX='stellar/scf-starforge-20261009/';
const DESK=PREFIX+'sf88-operator-buyer-cli/node/agents/task-desk/';
const PROVIDER=PREFIX+'distribution/runtime-workspace/providers/buyer-task-desk.mjs';
const SETTINGS=['nativeRuntimeDirectory','stateDirectory','inboxDirectory','tasksDirectory','outputsDirectory',
 'existingTaskDirectory','existingOutputDirectory','commerceDirectory','customerDeliveryDirectory','workspaceDirectory','port'];
const REQUIRED=['nativeRuntimeDirectory','stateDirectory','inboxDirectory','tasksDirectory','outputsDirectory','customerDeliveryDirectory'];
const BINDING=['directory','installationId','profileId','profileSha256','lockSha256','sourceCommit','sourceManifestSha256'];
const ROOTS={inbox:'inboxDirectory',tasks:'tasksDirectory',outputs:'outputsDirectory',
 existingTask:'existingTaskDirectory',existingOutput:'existingOutputDirectory',commerce:'commerceDirectory',customerDelivery:'customerDeliveryDirectory'};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(v).digest('hex');
const encoded=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code});};
const exact=(v,keys)=>need(plain(v)&&Object.keys(v).every(k=>keys.includes(k)),'DESK_INSTALLATION_FIELDS','Use the complete declared installation fields.');
const absolute=v=>{need(typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&!/[\0\r\n]/.test(v),'DESK_INSTALLATION_PATH','Use an unchanged absolute original path.');return v;};
const within=(a,b)=>{const r=relative(a,b);return r===''||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
const equal=(a,b)=>canonical(a)===canonical(b);
function normalize(input){
 exact(input,['schema','id','label','runtimeDirectory','runtimeId','settings','expectedTaskSha256','maxFileBytes']);
 need(input.schema===TASK_DESK_INSTALLATION_SCHEMA,'DESK_INSTALLATION_SCHEMA','Use the original Task Desk installation selection.');
 need(typeof input.id==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(input.id),'DESK_INSTALLATION_ID','Choose one stable lowercase desk alias.');
 need(typeof input.label==='string'&&input.label.trim()===input.label&&input.label.length>0&&input.label.length<=120,
  'DESK_INSTALLATION_LABEL','Use a short operator-facing installation label.');
 exact(input.settings,SETTINGS);
 const settings={};
 for(const key of SETTINGS.filter(k=>k!=='port'))if(input.settings[key]!==undefined)settings[key]=absolute(input.settings[key]);
 for(const key of REQUIRED)need(settings[key]!==undefined,'DESK_INSTALLATION_SETTING','Select '+key+'.');
 settings.port=input.settings.port??0;
 need(Number.isInteger(settings.port)&&settings.port>=0&&settings.port<=65535,'DESK_INSTALLATION_PORT','Choose port 0 through 65535.');
 const retained=settings.existingTaskDirectory!==undefined||settings.existingOutputDirectory!==undefined;
 need(!retained||settings.existingTaskDirectory&&settings.existingOutputDirectory,'DESK_INSTALLATION_RETAINED_PAIR','Keep the existing task and output together.');
 need(retained?/^[a-f0-9]{64}$/.test(input.expectedTaskSha256??''):input.expectedTaskSha256===undefined,
  'DESK_INSTALLATION_TASK_SHA','An existing task selection must retain its exact native task SHA256.');
 if(input.runtimeId!==undefined)need(/^[a-f0-9]{24}$/.test(input.runtimeId),'DESK_INSTALLATION_RUNTIME_ID','Use the selected runtime ID returned by the original Applications workspace.');
 const maxFileBytes=input.maxFileBytes??256*1024*1024;
 need(Number.isSafeInteger(maxFileBytes)&&maxFileBytes>=1&&maxFileBytes<=8*1024*1024*1024,
  'DESK_INSTALLATION_FILE_LIMIT','Select a complete-file receiving limit from 1 byte through 8 GiB.');
 return {schema:TASK_DESK_INSTALLATION_SCHEMA,id:input.id,label:input.label,runtimeDirectory:absolute(input.runtimeDirectory),
  ...(input.runtimeId===undefined?{}:{runtimeId:input.runtimeId}),settings,
  ...(retained?{expectedTaskSha256:input.expectedTaskSha256}:{}),maxFileBytes};
}
/** The same input callback contract used by the original Applications core.
 * Preparation only observes inputs; directory creation belongs to explicit launch/save. */
async function inputPath(value,kind='directory',missing=false,privateOnly=false){
 const path=absolute(value);need(await realpath(dirname(path))===dirname(path),'APPLICATION_REAL_PARENT_REQUIRED','Retain the original real parent.');
 let info;
 try{info=await lstat(path);}catch(error){
  if(error.code!=='ENOENT'||!missing)throw error;
  if(privateOnly)await privateDirectory(dirname(path));
  return {path,kind,exists:false,parent:await realpath(dirname(path))};
 }
 need(!info.isSymbolicLink()&&await realpath(path)===path&&(kind==='file'?info.isFile():info.isDirectory()),
  'APPLICATION_INPUT_PATH_INVALID','Select a complete original regular input.');
 if(privateOnly&&kind==='directory')await privateDirectory(path);
 const result={path,kind,exists:true,dev:info.dev,ino:info.ino};
 if(kind==='file'){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const first=await file.stat({bigint:true});
   need(first.isFile(),'APPLICATION_INPUT_PATH_INVALID','The original input is not a regular file.');
   result.bytes=Number(first.size);result.mtimeMs=Number(first.mtimeNs)/1e6;result.ctimeMs=Number(first.ctimeNs)/1e6;
   if(first.size<=4n*1024n*1024n){
    const bytes=await file.readFile(),last=await file.stat({bigint:true});
    need(bytes.length===Number(first.size)&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>first[k]===last[k]),
     'APPLICATION_INPUT_CHANGED','The original input changed while it was read.');
    result.sha256=hash(bytes);
   }
  }finally{await file.close();}
 }
 return result;
}
const runtimeBinding=runtime=>Object.fromEntries(BINDING.map(k=>[k,runtime[k]]));
const rootsOf=settings=>Object.fromEntries(Object.entries(ROOTS).filter(([,k])=>settings[k]!==undefined).map(([k,v])=>[k,settings[v]]));
const originalModule=(root,path)=>import(pathToFileURL(join(root,path)).href);

/** Inspect the completed installed runtime and original native task without dispatching. */
export async function inspectTaskDeskInstallation(input){
 const selection=normalize(input);
 const runtime=await inspectMerchantRuntime(selection.runtimeDirectory,{load:false,source:true});
 const {spec}=await readDistributionSpecification({sourceRoot:runtime.sourceRoot});
 need(['buyer-task-desk','merchant-task-desk','buyer-customer-delivery'].every(k=>Object.hasOwn(spec.commands??{},k))&&
  Object.hasOwn(spec.applicationProviders??{},'buyer-task-desk')&&Object.hasOwn(spec.merchantProviders??{},'buyer-task-desk'),
  'DESK_INSTALLATION_PRODUCT_INCOMPLETE','Select a complete runtime with the Task Desk, customer delivery, Applications and Merchant provider.');
 const provider=await originalModule(runtime.sourceRoot,PROVIDER);
 const prepared=await provider.prepareTaskDeskApplication(selection.settings,{inputPath,runtimeDirectory:runtime.directory});
 let retainedTask=null;
 if(selection.settings.existingTaskDirectory){
  const {Buyer}=await originalModule(runtime.sourceRoot,PREFIX+'sf88-operator-buyer-cli/node/client.mjs');
  const {selectRetainedTask}=await originalModule(runtime.sourceRoot,DESK+'retained-task.mjs');
  const chosen=await selectRetainedTask({inbox:new Buyer({runtimeDirectory:selection.settings.nativeRuntimeDirectory,
    stateDirectory:selection.settings.stateDirectory}).inbox(selection.settings.inboxDirectory),
    taskDirectory:selection.settings.existingTaskDirectory,outputDirectory:selection.settings.existingOutputDirectory});
  need(chosen.taskSha256===selection.expectedTaskSha256,'DESK_INSTALLATION_TASK_CHANGED','The original task differs from the reviewed installation.');
  retainedTask={taskSha256:chosen.taskSha256,taskDirectory:chosen.taskDirectory,outputDirectory:chosen.outputDirectory,
   mode:chosen.mode,receiveAllowed:chosen.receiveAllowed};
 }
 const args=[...prepared.args,'--port',String(selection.settings.port)];
 return {schema:PREPARED,selection,selectionSha256:hash(canonical(selection)),
  runtime:runtimeBinding(runtime),sourceRoot:runtime.sourceRoot,roots:rootsOf(selection.settings),
  command:{name:'buyer-task-desk',entrypoint:join(runtime.sourceRoot,DESK+'cli.mjs'),args},
  inputs:prepared.inputs,createDirectories:prepared.createDirectories,resourceKeys:prepared.resourceKeys,
  retainedTask,application:{kind:'buyer-task-desk',providerId:'buyer-task-desk',label:selection.label,
   ...(selection.runtimeId?{runtimeId:selection.runtimeId}:{}),settings:selection.settings},
  actionsStarted:0};
}
async function ownedDirectory(path){
 path=absolute(path);try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 return privateDirectory(path);
}
async function publish(path,bytes){
 const temporary=path+'.pending-'+randomUUID();let file;
 try{
  file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
  try{await link(temporary,path);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const info=await existing.stat();need(info.isFile()&&info.size===bytes.length&&
    !(info.mode&0o077)&&(process.getuid===undefined||info.uid===process.getuid())&&bytes.equals(await existing.readFile()),
    'DESK_INSTALLATION_OUTPUT_CHANGED','The saved installation output differs: '+path);}finally{await existing.close();}
  }
 }finally{
  await file?.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
 }
 return {path,bytes:bytes.length,sha256:hash(bytes)};
}
function separateBundle(directory,selection){
 const roots=[selection.runtimeDirectory,...Object.entries(selection.settings).filter(([k])=>k!=='port').map(([,v])=>v)];
 for(const root of roots)need(!within(root,directory)&&!within(directory,root),'DESK_INSTALLATION_SEPARATE',
  'Keep installation connection files separate from the original runtime, state, task, Inbox and result roots.');
}
const merchantConfiguration=(prepared,connectionFile)=>({schema:'stellar-forge.task-desk-connections.v1',
 desks:{[prepared.selection.id]:{label:prepared.selection.label,connectionFile,
 roots:prepared.roots,maxFileBytes:prepared.selection.maxFileBytes}}});

/** Publish a complete private, replayable input packet. Does not start any application. */
export async function prepareTaskDeskInstallation({selection,directory}={}){
 directory=absolute(directory);selection=normalize(selection);separateBundle(directory,selection);
 const inspected=await inspectTaskDeskInstallation(selection);await ownedDirectory(directory);
 const lease=await operationLease(join(directory,'prepare.lock'));
 try{
  let previous=null;try{previous=await privateJson(join(directory,'installation.json'),4*1024*1024);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous){
   need(previous.schema===PREPARED&&equal(previous.selection,selection)&&previous.selectionSha256===inspected.selectionSha256&&
    equal(previous.runtime,inspected.runtime),'DESK_INSTALLATION_SELECTION_CHANGED','Use the saved installation or a new directory for changed runtime/roots.');
   // Mutable original task/job observations may advance; preserve the original prepared snapshot.
  }
  const prepared=previous??inspected;
  const artifacts=[
   ['selection.json',selection],
   ['applications-input.json',prepared.application],
   ['merchant-task-desks.json',merchantConfiguration(prepared,join(directory,'launch.json'))],
   ['launch-command.json',{executable:process.execPath,args:[prepared.command.entrypoint,...prepared.command.args],
    note:'The installation launch command additionally retains the original announcement and owns graceful closure.'}]
  ];
  const outputs=[];
  for(const [name,value]of artifacts)outputs.push(await publish(join(directory,name),encoded(value)));
  outputs.push(await publish(join(directory,'installation.json'),encoded(prepared)));
  return {directory,selectionSha256:prepared.selectionSha256,runtime:prepared.runtime,retainedTask:inspected.retainedTask,
   applicationRuntimeIdRequired:!selection.runtimeId,outputs,actionsStarted:0};
 }finally{await lease.close();}
}
async function retained(directory){
 directory=await privateDirectory(absolute(directory));
 const saved=await privateJson(join(directory,'installation.json'),4*1024*1024);
 need(saved.schema===PREPARED&&saved.selectionSha256===hash(canonical(saved.selection)),'DESK_INSTALLATION_CHANGED','The complete saved installation changed.');
 const fresh=await inspectTaskDeskInstallation(saved.selection);
 need(equal(saved.selection,fresh.selection)&&equal(saved.runtime,fresh.runtime)&&equal(saved.roots,fresh.roots)&&equal(saved.command,fresh.command),
  'DESK_INSTALLATION_CHANGED','Review a new installation edition for a different runtime or original root selection.');
 return {directory,saved,fresh};
}
export async function readTaskDeskInstallation(directory){
 const {saved,fresh}=await retained(directory);return {...fresh,preparedInputs:saved.inputs};
}
/** Connect an existing Applications URL record, preserving its original instance and roots. */
export async function connectTaskDeskInstallation({directory,connectionFile,output}={}){
 const {saved}=await retained(directory);connectionFile=absolute(connectionFile);output=absolute(output);
 await privateDirectory(dirname(output));
 const configuration=merchantConfiguration(saved,connectionFile);
 const connected=await connectTaskDesk(configuration.desks[saved.selection.id]);
 return {...await publish(output,encoded(configuration)),instanceId:connected.instanceId,
  bindingSha256:connected.bindingSha256,roots:connected.status.roots};
}
/** Launch the selected original CLI in this foreground process. No task action is dispatched. */
export async function launchTaskDeskInstallation({directory}={}){
 const selected=await retained(directory),{saved,fresh}=selected;
 const lease=await operationLease(join(selected.directory,'run.lock'));let desk=null,closed=false;
 try{
  const connectionFile=join(selected.directory,'launch.json');
  try{
   await privateJson(connectionFile,65536);
   try{await connectTaskDesk(merchantConfiguration(saved,connectionFile).desks[saved.selection.id]);
    throw Object.assign(new Error('This installation already has a live original desk. Reopen it.'),{code:'DESK_INSTALLATION_ALREADY_RUNNING'});
   }catch(error){
    // Only a definite refused local connection establishes that the previous foreground listener ended.
    if(error.cause?.code!=='ECONNREFUSED'&&error.code!=='ECONNREFUSED')throw error;
   }
  }catch(error){if(error.code!=='ENOENT')throw error;}
  for(const path of fresh.createDirectories){
   try{await makePrivate(path);}catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(path);}
  }
  const native=await import(pathToFileURL(fresh.command.entrypoint).href);
  desk=await native.main(fresh.command.args);
  need(desk&&typeof desk.close==='function','DESK_INSTALLATION_STARTUP','The original CLI did not return its live desk.');
  const announcement={schema:'stellar-forge.inbox-task-desk-launch.v1',url:desk.url,instanceId:desk.instanceId,...fresh.roots};
  const provider=await originalModule(fresh.sourceRoot,PROVIDER);
  await provider.taskDeskStartup({command:'buyer-task-desk',args:fresh.command.args},announcement);
  await saveJSON(connectionFile,announcement,true);
  const close=async()=>{if(closed)return;closed=true;try{await desk.close();}finally{await lease.close();}};
  return {directory:selected.directory,connectionFile,announcement,close};
 }catch(error){try{if(desk)await desk.close();}finally{await lease.close();}throw error;}
}
const HELP='Task Desk installation\n\n'+
 'starforge buyer-task-desk-installation prepare --selection PRIVATE_JSON --directory PRIVATE_OUTPUT\n'+
 'starforge buyer-task-desk-installation inspect --directory PRIVATE_OUTPUT\n'+
 'starforge buyer-task-desk-installation launch --directory PRIVATE_OUTPUT\n'+
 'starforge buyer-task-desk-installation connect --directory PRIVATE_OUTPUT --connection ORIGINAL_APPLICATION_URL_JSON --output PRIVATE_MERCHANT_CONFIG\n\n'+
 'Prepare only reads original roots and writes the private installation inputs. Launch stays in the foreground.\n'+
 'Use Applications for managed lifecycle; do not start both owners for the same operating roots.\n';
export async function main(argv=process.argv.slice(2)){
 const [command,...args]=argv;if(command==='--help'||command==='help'||!command){process.stdout.write(HELP);return null;}
 const {values}=parseArgs({args,strict:true,allowPositionals:false,options:{
  selection:{type:'string'},directory:{type:'string'},connection:{type:'string'},output:{type:'string'}}});
 const allowed={prepare:['selection','directory'],inspect:['directory'],launch:['directory'],connect:['directory','connection','output']}[command];
 need(allowed&&Object.keys(values).every(k=>allowed.includes(k))&&allowed.every(k=>values[k]),'DESK_INSTALLATION_ARGUMENTS',HELP);
 let result;
 if(command==='prepare')result=await prepareTaskDeskInstallation({selection:await privateJson(absolute(values.selection),4*1024*1024),directory:absolute(values.directory)});
 if(command==='inspect')result=await readTaskDeskInstallation(absolute(values.directory));
 if(command==='connect')result=await connectTaskDeskInstallation({directory:absolute(values.directory),connectionFile:absolute(values.connection),output:absolute(values.output)});
 if(command==='launch'){
  result=await launchTaskDeskInstallation({directory:absolute(values.directory)});
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;try{await result.close();}catch(error){process.stderr.write(JSON.stringify({error:{code:error.code,message:error.message}})+'\n');process.exitCode=1;}
   finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  process.stderr.write('Original launch retained at '+result.connectionFile+'\n');return result;
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'DESK_INSTALLATION_FAILED',message:error.message}})+'\n');process.exitCode=1;});
