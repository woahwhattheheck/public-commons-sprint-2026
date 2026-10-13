// SPDX-License-Identifier: MIT
// Installed receiving for the original Dagster/dbt client-delivery operation.
import {readFile,mkdir,open,rename,unlink,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {inspectPipelineDeliveryPreparation,inspectPipelineDeliveryRuntime} from './prepare.mjs';
import {acquireLease} from './managed.mjs';
import {PIPELINE_DELIVERY_HOST_SCHEMA} from './mcp.mjs';
import merchantProvider from './merchant-provider.mjs';
import {initializePipelineDeliveryMerchant} from './setup.mjs';
import {openPipelineReceivingBrowser} from './receiving-browser.mjs';
import {readMerchantConfig} from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(HERE,'../..');
const SCHEMA='stellar-forge.pipeline-delivery-workbench-receiving.v1';
const AUTHORITY_SHA='fec97f70237e18e5332fda2eb957dd91c96be9f7561be928e3cc724031047573';
const ORIGINAL_OPERATION='snowpack3459-original-dagster-dbt-delivery-20261012';
const now=()=>new Date().toISOString();
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(yes,code,message,details={})=>{if(!yes)throw Object.assign(new Error(message),{code,details});};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const err=e=>({code:e.code??'MERCHANT_RECEIVING_FAILED',message:e.message,details:e.details??{}});
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function child(root,path){const r=relative(root,path);need(r!==''&&r!=='..'&&!r.startsWith('../')&&!isAbsolute(r),'RECEIVING_PATH','Keep complete artifacts under the original operation.');return r.split('\\').join('/');}
async function identity(path){
  const fd=await open(path,'r');try{
    const before=await fd.stat();need(before.isFile(),'RECEIVING_FILE','Use the original regular artifact.');
    const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'RECEIVING_FILE','The original artifact ended early.');h.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
    const after=await fd.stat();need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'RECEIVING_FILE_CHANGED','The complete original artifact changed.');
    return{bytes:offset,sha256:h.digest('hex')};
  }finally{await fd.close();}
}
async function verify(path,d){const a=await identity(path);need(a.bytes===d.bytes&&a.sha256===d.sha256,'RECEIVING_FILE_CHANGED','The complete original file differs.',{path,expected:d,actual:a});return a;}
async function save(path,value,{immutable=false}={}){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(immutable&&await exists(path)){need(same(await json(path),value),'RECEIVING_RECORD_CHANGED','Preserve the exact original saved record.',{path});return identity(path);}
  const temporary=path+'.writing-'+randomUUID(),fd=await open(temporary,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  return{bytes:bytes.length,sha256:hash(bytes)};
}

async function copySelected(source,target,expected){
  if(await exists(target)){await verify(target,expected);return;}
  await verify(source,expected);await mkdir(dirname(target),{recursive:true,mode:0o700});
  const temporary=target+'.copy-'+randomUUID();let input,output;
  try{
    input=await open(source,'r');output=await open(temporary,'wx',0o600);
    const before=await input.stat(),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<before.size){const r=await input.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'MERCHANT_PACKAGE_COPY','The selected complete package ended early.');await output.writeFile(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
    const after=await input.stat();need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'MERCHANT_PACKAGE_COPY','The selected package changed while retaining it.');
    await output.sync();
  }finally{try{await input?.close();}finally{await output?.close();}}
  await verify(temporary,expected);await rename(temporary,target);const directory=await open(dirname(target),'r');try{await directory.sync();}finally{await directory.close();}
}


async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid()),'PIPELINE_PRIVATE_DIRECTORY','Select an owned private directory.');}
async function bytesFile(path,bytes){await mkdir(dirname(path),{recursive:true,mode:0o700});if(await exists(path)){need((await readFile(path)).equals(bytes),'PIPELINE_SAVED_BYTES','The retained exact file changed.');return identity(path);}const tmp=path+'.writing-'+randomUUID(),f=await open(tmp,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}await rename(tmp,path);const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}return identity(path);}
function parse(argv){
  const o={},allowed=new Set(['directory','merchant-workspace','merchant-runtime','preparation-result','reference-result','reference-request','native-host','playwright','chromium','resume']);
  for(let i=0;i<argv.length;i++){const k=argv[i].slice(2);need(argv[i].startsWith('--')&&allowed.has(k)&&!Object.hasOwn(o,k),'PIPELINE_RECEIVING_OPTION','Select each declared option once.');if(k==='resume'){o.resume=true;continue;}need(argv[i+1]&&isAbsolute(argv[i+1]),'PIPELINE_RECEIVING_OPTION','Use the exact absolute path for '+k+'.');o[k]=resolve(argv[++i]);}
  for(const k of ['directory','merchant-workspace','merchant-runtime','preparation-result','playwright','chromium'])need(o[k],'PIPELINE_RECEIVING_OPTION','Select --'+k+'.');
  need(!(o['reference-result']&&o['reference-request']),'PIPELINE_REFERENCE','Choose an existing result or its original request, not both.');
  if(!o['reference-result']&&!o['reference-request'])need(o['native-host'],'PIPELINE_REFERENCE','A new selected installation requires the existing maintained native host.');
  return o;
}
async function inspectSource(application,programme){
  const authorityPath=join(HERE,'original-source.json'),id=await identity(authorityPath);need(id.sha256===AUTHORITY_SHA,'PIPELINE_SOURCE','The original40 source authority differs.');
  const authority=await json(authorityPath),rows=authority.files;
  need(rows.length===40&&new Set(rows.map(x=>x.path)).size===40,'PIPELINE_SOURCE','Keep all40 original files.');
  const actual=[];
  for(const [prefix,root]of [['workbench/',application],['original-programme/',programme]]){
    need(await realpath(root)===root,'PIPELINE_SOURCE','Use the selected canonical original source directories.');
    if(prefix==='original-programme/'){for(const row of rows.filter(x=>x.path.startsWith(prefix))){const p=join(root,row.path.slice(prefix.length));need(await realpath(p)===p,'PIPELINE_SOURCE','Keep the original programme files at their canonical paths.');actual.push({path:row.path,...await identity(p)});}continue;}
    const visit=async directory=>{for(const item of await readdir(directory,{withFileTypes:true})){if(item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;need(!item.isSymbolicLink(),'PIPELINE_SOURCE','Original source contains a symbolic link.');const p=join(directory,item.name);if(item.isDirectory())await visit(p);else{need(item.isFile(),'PIPELINE_SOURCE','Original source must be regular.');actual.push({path:prefix+relative(root,p).split('\\').join('/'),...await identity(p)});}}};await visit(root);
  }
  const expected=rows.map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
  need(same(actual.sort((a,b)=>a.path.localeCompare(b.path)),expected),'PIPELINE_SOURCE','Retain the complete unchanged35 application and5 programme files.');
  return{authority:{path:authorityPath,...id},applicationDirectory:application,programmeDirectory:programme,files:actual};
}
async function closedCommand({directory,python,argv,cwd,leaseFd=null,parse=true}){
  await privateDirectory(directory);const id=randomUUID(),recordPath=join(directory,id+'.json'),outPath=join(directory,id+'.stdout'),errPath=join(directory,id+'.stderr');
  const selected={schema:'stellar-forge.pipeline-receiving-command.v1',id,python,argv,cwd,state:'prepared',startedAt:now()};
  await save(recordPath,selected);let childProcess,out,stderr,closedPromise,closed=false,spawnError=null,failure=null,result;
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};for(const k of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP','VIRTUAL_ENV'])delete env[k];
  try{
    out=await open(outPath,'wx',0o600);stderr=await open(errPath,'wx',0o600);
    childProcess=spawn(python,argv,{cwd,env,stdio:['ignore',out.fd,stderr.fd,...(leaseFd===null?[]:[leaseFd])]});
    closedPromise=new Promise(resolveClose=>{childProcess.on('error',e=>{spawnError=e;});childProcess.once('close',(code,signal)=>{closed=true;resolveClose({code,signal});});});
    try{await save(recordPath,{...selected,state:'running',pid:childProcess.pid??null});result=await closedPromise;}catch(e){failure=e;}
    finally{
      if(failure&&!closed&&childProcess.pid&&childProcess.exitCode===null&&childProcess.signalCode===null)childProcess.kill('SIGTERM');
      result=await closedPromise;await out.sync();await stderr.sync();
      await save(recordPath,{...selected,state:'closed',pid:childProcess.pid??null,exitCode:result.code,signal:result.signal,completedAt:now(),
        spawnError:spawnError?err(spawnError):null,observationError:failure?err(failure):null,stdout:{path:outPath,...await identity(outPath)},stderr:{path:errPath,...await identity(errPath)}});
    }
    if(failure)throw failure;if(spawnError)throw spawnError;
    need(result.code===0,'PIPELINE_COMMAND_CLOSED','The original command did not complete successfully.',{recordPath,exitCode:result.code});
    return{recordPath,outPath,errPath,value:parse?await json(outPath):null};
  }finally{
    try{if(closedPromise){if(!closed&&childProcess?.pid&&childProcess.exitCode===null&&childProcess.signalCode===null)childProcess.kill('SIGTERM');await closedPromise;}}
    finally{try{await out?.close();}finally{await stderr?.close();}}
  }
}

async function referenceResult(options,prepared){
  const requestPath=options['reference-request']??join(options.directory,'reference-request.json');
  let request=await exists(requestPath)?await json(requestPath):null;
  if(!options['reference-result']&&!request){
    need(options['native-host'],'PIPELINE_REFERENCE','Select the existing maintained native host for this installation.');
    const project=join(options.directory,'reference'),programme=prepared.primary.programmeDirectory,application=prepared.primary.applicationDirectory;
    await privateDirectory(project);await privateDirectory(join(project,'source'));
    const authority=await json(join(HERE,'original-source.json'));
    for(const row of authority.files){
      const source=row.path.startsWith('workbench/')?join(application,row.path.slice(10)):join(programme,row.path.slice(19));
      const target=row.path.startsWith('workbench/')?join(project,'source',row.path.slice(10)):join(project,row.path.slice(19));
      await copySelected(source,target,row);
    }
    await privateDirectory(join(project,'private'));
    request={schema:'stellar-forge.pipeline-delivery-reference-request.v1',operationId:'pipeline-delivery-'+hash(options.directory).slice(0,32),
      mode:'prepared-native',hostRoot:options['native-host'],project,privateRoot:join(project,'private'),python:prepared.primary.python,
      source:join(project,'source'),programmeDirectory:project,operationRoot:join(project,'operation'),workspace:join(project,'workspace'),
      node:process.execPath,playwright:options.playwright,chromium:options.chromium,runtimeReadyFile:prepared.primary.runtimeReadyFile};
    await save(requestPath,request,{immutable:true});
  }
  let resultPath=options['reference-result'];
  if(request){
    const required=['schema','operationId','mode','hostRoot','project','privateRoot','python','source','programmeDirectory','operationRoot','workspace','node','playwright','chromium'];
    need(request.schema==='stellar-forge.pipeline-delivery-reference-request.v1'&&required.every(k=>Object.hasOwn(request,k))&&
      ['original-launch','prepared-native'].includes(request.mode),'PIPELINE_REFERENCE','Use the complete original reference request.');
    for(const k of required.filter(k=>!['schema','operationId','mode'].includes(k)))need(typeof request[k]==='string'&&isAbsolute(request[k])&&resolve(request[k])===request[k],'PIPELINE_REFERENCE','Preserve canonical absolute original reference paths.');
    need(request.node===process.execPath&&request.playwright===options.playwright&&request.chromium===options.chromium,
      'PIPELINE_REFERENCE','Keep the original Node and browser selection.');
    await inspectSource(request.source,request.programmeDirectory);
    need(request.source===join(request.project,'source')&&request.programmeDirectory===request.project&&
      request.operationRoot===join(request.project,'operation')&&request.workspace===join(request.project,'workspace'),
      'PIPELINE_REFERENCE','Keep the original launch.py project layout.');
    resultPath=join(request.operationRoot,'complete.json');
    if(!await exists(resultPath))await continueReference(request,requestPath,options,prepared);
  }
  need(resultPath&&basename(resultPath)==='complete.json'&&await exists(resultPath),'PIPELINE_ORIGINAL_PENDING','The same original native operation has not published complete.json; continue its retained owner.',{requestPath,request});
  const root=dirname(resultPath),result=await json(resultPath),spec=await json(join(root,'operation.json')),native=await json(join(root,'native-outcome.json')),browser=await json(join(root,'browser-result.json'));
  need(spec.schema==='pipeline-delivery.original-example-operation/v1'&&result.stage==='complete'&&result.state==='completed'&&
    native.id===result.run_id&&native.project_id===result.project_id&&native.dagster_run_id===result.dagster_run_id&&native.state==='succeeded'&&
    native.outcome?.evaluation?.criteria_satisfied===true&&browser.state==='completed'&&browser.project_id===result.project_id&&browser.run_id===result.run_id&&
    same(result.browser,browser),'PIPELINE_ORIGINAL_RESULT','Adopt the complete original native and browser programme, never a partial result.');
  const input=await json(join(root,'browser-input.json'));
  need(input.source_root===spec.source_root&&input.project_id===result.project_id&&input.run_id===result.run_id&&input.dagster_run_id===result.dagster_run_id,
    'PIPELINE_ORIGINAL_RESULT','The original browser/source selection differs.');
  const programme=dirname(input.workflow);await inspectSource(spec.source_root,programme);
  await verify(result.archive.path,result.archive);await verify(browser.delivery.path,browser.delivery);
  need(!request||request.operationRoot===root&&request.workspace===spec.workspace,'PIPELINE_ORIGINAL_RESULT','The result belongs to another original request.');
  return{operationId:request?.operationId??ORIGINAL_OPERATION,resultPath,resultIdentity:await identity(resultPath),root,result,spec,native,browser,
    requestPath:request?requestPath:null,requestIdentity:request?await identity(requestPath):null,
    source:await inspectSource(spec.source_root,programme),controlDirectory:join(root,'staff'),directory:spec.workspace,origin:input.origin};
}
// Native admission is delegated to the retained original host. The inline bridge
// invokes the original operate.py under its existing Dagster/Workspace writer.
const FOREGROUND=String.raw`
import json,sys
from pathlib import Path
from types import SimpleNamespace
r=json.loads(Path(sys.argv[1]).read_text("utf-8"))
sys.path.insert(0,r["hostRoot"])
import native_foreground
native=native_foreground.load_native(r["hostRoot"])
launcher=native_foreground.ForegroundLaunch(native)
command=[r["python"],"-B",str(Path(r["programmeDirectory"])/"operate.py"),"--source-root",r["source"],
 "--workspace",r["workspace"],"--operation-root",r["operationRoot"],"--private-root",r["privateRoot"],
 "--browser-driver",str(Path(r["programmeDirectory"])/"browser-entry.mjs"),"--node",r["node"],
 "--playwright-module",r["playwright"],"--chromium",r["chromium"],"--installed"]
a=SimpleNamespace(peer="pipeline-delivery-installed",operation_id=r["operationId"],project=r["project"],command=command,
 java=None,node=None,artifact=[],artifact_on_success=["operation/complete.json"],artifact_on_failure=[],retain_artifacts=False,
 records_root=str(Path(r["project"])/"jobs"),runtime_path=[r["source"],r["programmeDirectory"],r["python"],r["node"],r["playwright"],str(Path(r["chromium"]).parent)],
 memory_mib=1536,memory_reserve_mib=256,memory_reclaim="clean-cache",memory_storage="included",
 disk_space=[r["workspace"]+"=64",r["operationRoot"]+"=16",str(Path(r["project"])/"jobs")+"=8",r["privateRoot"]+"=896"],
 disk_inodes=[],disk_reserve_mib=64,disk_reserve_inodes=128)
result=native.start(a,launcher=launcher)
from native_result_view import select
print(json.dumps(select(result,"summary")),flush=True)
code=launcher.handoff()
raise SystemExit(code if code is not None else 0)
`;
async function continueReference(request,requestPath,options,prepared){
  need(options.resume||!await exists(join(request.operationRoot,'operation.json')),'PIPELINE_REFERENCE_RESUME','Resume the same original native reference explicitly.');
  if(request.mode==='prepared-native'){
    need(request.python===prepared.primary.python&&request.runtimeReadyFile===prepared.primary.runtimeReadyFile,'PIPELINE_REFERENCE_RUNTIME','Keep the same prepared native runtime.');
    await inspectPipelineDeliveryRuntime({runtimeReadyFile:request.runtimeReadyFile,applicationDirectory:prepared.primary.applicationDirectory,python:request.python});
  }
  const root=join(options.directory,'native-continuation');await privateDirectory(root);
  const selected={requestPath,requestIdentity:await identity(requestPath),request,hostForeground:await identity(join(request.hostRoot,'native_foreground.py')),
    hostResultView:await identity(join(request.hostRoot,'native_result_view.py'))};
  await save(join(root,'selection.json'),selected,{immutable:true});
  const argv=request.mode==='original-launch'?[join(request.programmeDirectory,'launch.py'),'--host-root',request.hostRoot,'--project',request.project,
    '--node-executable',request.node,'--playwright-module',request.playwright,'--chromium',request.chromium,'--private-root',request.privateRoot,'--operation-id',request.operationId]:
    ['-B','-c',FOREGROUND,requestPath];
  // native.start owns idempotent admission; its retained operation owns children,
  // memory placement and later continuation. Never bypass it with a second run.
  const logs=join(root,'attempts');await privateDirectory(logs);
  try{await closedCommand({directory:logs,python:request.python,argv,cwd:request.project,parse:false});}
  catch(e){if(!await exists(join(request.operationRoot,'complete.json')))throw e;}
  need(await exists(join(request.operationRoot,'complete.json')),'PIPELINE_ORIGINAL_PENDING','The original native host remains authoritative; resume that saved operation until its complete result is available.',{operationId:request.operationId,project:request.project,recordsRoot:join(request.project,'jobs')});
}
const ZIP_INSPECT=String.raw`
import hashlib,json,os,sys,zipfile
from pathlib import Path
source,archive,output=sys.argv[1:]
sys.path.insert(0,source)
from receiving import inspect_archive
v=inspect_archive(archive)
target=Path(output)
if output:
 target.mkdir(mode=0o700,parents=True,exist_ok=True)
 with zipfile.ZipFile(archive) as z:
  for row in v["manifest"]["files"]:
   if not row["path"].startswith("handover/"):continue
   name=row["path"][9:];p=target/name
   if not name or any(x in ("","..",".") for x in Path(name).parts):raise ValueError("Unsafe handover path")
   b=z.read(row["path"])
   if len(b)!=row["bytes"] or hashlib.sha256(b).hexdigest()!=row["sha256"]:raise ValueError("Handover bytes differ")
   p.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   if p.exists():
    if p.read_bytes()!=b:raise ValueError("Original handover changed")
   else:
    t=p.with_name(p.name+".part")
    with t.open("wb") as f:f.write(b);f.flush();os.fsync(f.fileno())
    os.replace(t,p)
    fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
print(json.dumps(v))
`;

class Course{
  constructor(options,prepared,reference,selection,lease){
    this.o=options;this.prepared=prepared;this.reference=reference;this.selection=selection;this.lease=lease;this.root=options.directory;
    this.path=join(this.root,'operation.json');this.manager=null;this.apps=null;this.browserOwner=null;this.closingPromise=null;this.selectedHere=new Set();this.bound=false;
  }
  async open(){
    this.state=await exists(this.path)?await json(this.path):{schema:SCHEMA,id:randomUUID(),selection:this.selection,createdAt:now(),status:'prepared',phases:{},hosts:{},files:{},errors:[]};
    need(this.state.schema===SCHEMA&&same(this.state.selection,this.selection),'PIPELINE_RECEIVING_SELECTION','Keep this original installation, source, runtime and native operation.');
    if(await exists(this.path))need(this.o.resume||this.state.status==='complete','PIPELINE_RECEIVING_RESUME','Resume this original receiving course explicitly.');
    this.bound=true;await this.save();this.apps=await openRuntimeWorkspace({directory:this.o['merchant-workspace']});return this;
  }
  save(){return save(this.path,this.state);}
  async retain(path){path=resolve(path);const d={path:child(this.root,path),...await identity(path)};this.state.files[d.path]=d;await this.save();return d;}
  async record(name,value){const path=join(this.root,'records',name+'.json');await save(path,value,{immutable:true});await this.retain(path);return value;}
  async intent(name,fn){const p=join(this.root,'intents',name+'.json');if(await exists(p)){const v=await json(p);await this.retain(p);return v;}const v=await fn();await save(p,v,{immutable:true});await this.retain(p);return v;}
  async phase(name,fn){
    if(this.state.phases[name]?.complete)return this.state.phases[name].value;
    this.state.phases[name]??={startedAt:now()};this.state.currentPhase=name;await this.save();
    process.stdout.write(JSON.stringify({operationId:this.reference.operationId,receivingId:this.state.id,phase:name})+'\n');
    const value=await fn();this.state.phases[name]={...this.state.phases[name],complete:true,completedAt:now(),value};await this.save();return value;
  }
  async copy(source,target,expected){const p=join(this.root,target);await copySelected(source,p,expected??await identity(source));return this.retain(p);}
  async prepare(){
    const attached=await this.phase('01-attach-installed-product',()=>this.apps.attach({directory:this.o['merchant-runtime'],label:'Pipeline Delivery Workbench complete installation'}));
    need(attached.status==='READY'&&attached.runtimeId,'PIPELINE_INSTALLED_RUNTIME','Use the original complete installed Merchant runtime.');this.runtimeId=attached.runtimeId;
    const names=['primary','receiving'];
    for(const name of names){
      const primary=name==='primary',runtime=this.prepared[name],directory=primary?this.reference.directory:join(this.root,'received-workspace'),
        controlDirectory=primary?this.reference.controlDirectory:join(this.root,'received-control'),
        configurationFile=join(this.root,'private',name+'-launch.json'),connectionFile=join(this.root,'private',name+'-connection.json');
      await privateDirectory(dirname(configurationFile));
      // Existing original source/native directories retain their bytes. Managed
      // launch performs its declared owned-directory permission normalization.
      if(!await exists(directory))await privateDirectory(directory);
      if(!await exists(controlDirectory))await privateDirectory(controlDirectory);
      const configuration={schema:'stellar-forge.pipeline-delivery-workbench-launch.v1',directory,controlDirectory,
        applicationDirectory:runtime.applicationDirectory,programmeDirectory:runtime.programmeDirectory,runtimeReadyFile:runtime.runtimeReadyFile,connectionFile,python:runtime.python};
      await save(configurationFile,configuration,{immutable:true});await this.retain(configurationFile);
      const priorPort=primary?Number(new URL(this.reference.origin).port):0;
      this.state.hosts[name]??={name,directory,controlDirectory,configurationFile,connectionFile,port:priorPort,starts:[]};
      need(same(Object.fromEntries(Object.keys(configuration).filter(k=>k!=='schema').map(k=>[k,configuration[k]])),
        Object.fromEntries(Object.keys(configuration).filter(k=>k!=='schema').map(k=>[k,k in this.state.hosts[name]?this.state.hosts[name][k]:configuration[k]]))),
        'PIPELINE_HOST_CHANGED','The original managed host selection changed.');
    }
    await this.save();await this.setup('original');
    const tools=merchantProvider.tools((name,description,properties,required)=>({name,properties,required}));
    need(tools.length===21&&new Set(tools.map(x=>x.name)).size===21,'PIPELINE_TOOLS','Retain all21 actual original Staff tools.');
    await this.record('complete-tool-catalog',tools);
    return{runtimeId:this.runtimeId,tools:tools.map(x=>x.name)};
  }
  async setup(edition,inputs){
    if(this.manager){await this.manager.close();this.manager=null;}
    const p=join(this.root,'private','host-'+edition+'.json'),workspaces={};
    if(inputs===undefined&&await exists(p)){
      const previous=await json(p);need(previous.schema===PIPELINE_DELIVERY_HOST_SCHEMA,'PIPELINE_HOST_CONFIGURATION','Reopen the original saved agent configuration.');
      for(const [name,h]of Object.entries(this.state.hosts)){const v=previous.workspaces[name];need(v&&v.directory===h.directory&&v.connectionFile===h.connectionFile,'PIPELINE_HOST_CONFIGURATION','The retained host alias changed.');workspaces[name]=v;}
    }else for(const [name,h]of Object.entries(this.state.hosts))workspaces[name]={label:name+' original pipeline Staff',directory:h.directory,connectionFile:h.connectionFile,inputs:inputs??{}};
    await save(p,{schema:PIPELINE_DELIVERY_HOST_SCHEMA,workspaces},{immutable:true});await this.retain(p);
    this.state.configurations??={};this.state.configurations[edition]={path:p,...await identity(p)};await this.save();
    const setup=await initializePipelineDeliveryMerchant({directory:join(this.root,'agent-'+edition),connection:p,name:'Pipeline Delivery Workbench '+edition});
    await this.record('setup-'+edition+'-'+hash(canonical(setup)),setup);
    const config=await readMerchantConfig(setup.configuration);this.exports=config.exportsDirectory;
    this.manager=await merchantProvider.create(await merchantProvider.load(),config);
    this.currentConfig=edition;return setup;
  }
  async distribution(){
    return this.phase('02-complete-distribution-and-runtime',async()=>{
      const selected=await this.intent('distribution-selection',async()=>{
        const planPath=join(this.o['merchant-runtime'],'runtime-install.json'),plan=await json(planPath),manifestPath=join(this.o['merchant-runtime'],'package','manifest.json'),
          manifest=await identity(manifestPath),archive=await identity(plan.archivePath);
        need(plan.source.manifestSha256===manifest.sha256&&manifest.sha256===this.selection.merchantSourceManifestSha256&&archive.sha256===plan.archiveSha256,
          'PIPELINE_DISTRIBUTION','Retain the exact original installed distribution and complete source manifest.');
        return{planPath,plan:await identity(planPath),manifestPath,manifest,archivePath:plan.archivePath,archive,handoff:await this.apps.handoff(this.runtimeId)};
      });
      const files=[];
      files.push(await this.copy(selected.archivePath,'distribution/merchant-distribution.tar.gz',selected.archive));
      files.push(await this.copy(selected.manifestPath,'distribution/source-manifest.json',selected.manifest));
      files.push(await this.copy(selected.planPath,'distribution/runtime-install.json',selected.plan));
      await this.record('original-runtime-workspace-handoff',selected.handoff);
      files.push(await this.copy(this.o['preparation-result'],'runtime/PREPARED.json',this.selection.preparationResult));
      files.push(await this.copy(this.prepared.request.path,'runtime/REQUEST.json',this.prepared.request));
      files.push(await this.copy(this.prepared.portable.path,'runtime/pipeline-delivery-runtime.tar.gz',this.prepared.portable));
      for(const name of ['primary','receiving']){
        const bound=this.prepared[name],ready=bound.runtime;
        await verify(bound.runtimeReadyFile,bound.ready);
        files.push(await this.copy(bound.runtimeReadyFile,'runtime/'+name+'/runtime-ready.json',bound.ready));
        for(const [key,d]of Object.entries({identity:ready.identity,installed:ready.installed,source:ready.sourceAuthority,inspector:ready.inspectionSource}))
          files.push(await this.copy(d.path,'runtime/'+name+'/'+key+(key==='inspector'?'.py':'.json'),d));
      }
      for(const name of ['complete.json','operation.json','native-outcome.json','browser-result.json','browser-workflow.json','native-completion.json','staff-ready.json']){
        const path=join(this.reference.root,name);if(await exists(path))files.push(await this.copy(path,'original/'+name));
      }
      for(const sub of ['requests','responses','browser-requests']){
        const base=join(this.reference.root,sub);if(!await exists(base))continue;
        for(const entry of await readdir(base,{withFileTypes:true})){need(entry.isFile()&&!entry.isSymbolicLink(),'PIPELINE_ORIGINAL_ARTIFACT','Retain every complete original request/response as an ordinary file.');files.push(await this.copy(join(base,entry.name),'original/'+sub+'/'+entry.name));}
      }
      // The browser-input capability is private authority, never a customer artifact.
      const history=await this.record('original-source-and-operation', {operationId:this.reference.operationId,source:this.reference.source,
        request:this.reference.requestIdentity?{path:this.reference.requestPath,...this.reference.requestIdentity}:null,
        result:{path:this.reference.resultPath,...this.reference.resultIdentity}});
      files.push(await this.copy(this.reference.result.archive.path,'original/complete-workspace.zip',this.reference.result.archive));
      files.push(await this.copy(this.reference.browser.delivery.path,'original/client-release.zip',this.reference.browser.delivery));
      return{files,history,handoff:selected.handoff,distinction:'Merchant distribution contains installed adapters/Applications/MCP; runtime transfer contains all40 original sources and exact wheels; native ZIPs retain original project/workspace history and full native outcomes.'};
    });
  }
  async app(name){return(await this.apps.applicationsState({historyLimit:100})).applications.find(x=>x.id===this.state.hosts[name].applicationId);}
  async configure(name){
    const host=this.state.hosts[name];
    const value=await this.phase('application-'+name+'-save',async()=>{
      const review=await this.intent('application-'+name+'-review',()=>this.apps.applicationsReview({runtimeId:this.runtimeId,
        kind:'pipeline-delivery-workbench',providerId:'pipeline-delivery-workbench',settings:{configurationFile:host.configurationFile,port:host.port},label:'Original pipeline Staff '+name}));
      const request=await this.intent('application-'+name+'-save',async()=>({requestId:randomUUID(),reviewId:review.id}));
      const response=await this.apps.applicationsSave(request);await this.record('application-'+name+'-saved',response);return{applicationId:response.applicationId};
    });host.applicationId=value.applicationId;await this.save();
  }
  async start(name,stage){
    const host=this.state.hosts[name];await this.configure(name);
    for(let i=0;;i++){
      const a=await this.app(name);need(a,'PIPELINE_APPLICATION','The original saved application is missing.');
      if(a.release&&a.connectionReady===true)break;
      if(i===0||a.adoption?.active===false)await this.apps.applicationsConnect({applicationId:a.id});
      need(i<600,'PIPELINE_APPLICATION_PENDING','The original managed connection is pending; resume it.');await delay(1000);
    }
    let run=host.starts.find(x=>x.stage===stage&&!x.closed);
    if(!run){
      const current=await this.app(name);need(!current.current||current.current.active===false&&!['PENDING','QUEUED','INTERRUPTED','OBSERVATION_UNAVAILABLE'].includes(current.current.phase),
        'PIPELINE_APPLICATION_OWNED','Reconcile the original managed owner before a new Start.');
      const review=await this.apps.applicationsStartReview({applicationId:host.applicationId});
      run={stage,requestId:randomUUID(),reviewId:review.id,applicationId:host.applicationId,createdAt:now(),dispatch:'selected'};
      host.starts.push(run);this.selectedHere.add(run.requestId);await this.save();await this.record(name+'-'+run.requestId+'-review',review);
    }
    // Persist the exact original dispatch before entering the maintained Start.
    run.dispatch='dispatching';await this.save();this.selectedHere.delete(run.requestId);
    await this.apps.applicationsStart({applicationId:host.applicationId,requestId:run.requestId,reviewId:run.reviewId});
    run.dispatch='entered';await this.save();
    let recovered=false;
    for(let i=0;i<600;i++){
      const a=await this.app(name),actual=a?.runs.find(x=>x.id===run.requestId);
      if(actual?.active===true&&actual.privateUrl){
        const status=await this.call('status',{workspace:name});
        if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});
        const connected=await this.call('connect',{workspace:name});
        need(connected.directory===host.directory&&connected.controlDirectory===host.controlDirectory&&connected.sourceManifestSha256===AUTHORITY_SHA,
          'PIPELINE_APPLICATION_SELECTION','The current original Staff source or directory changed.');
        run.launchId=connected.launchId;host.origin=connected.origin;await this.save();
        await this.record(name+'-'+run.requestId+'-connection-'+hash(canonical(connected)),connected);
        const route=await this.call('browser',{workspace:name});need(route.launchId===connected.launchId,'PIPELINE_APPLICATION_SELECTION','Browser route selected another launch.');
        return{launchId:connected.launchId,origin:connected.origin,applicationId:host.applicationId,operationId:run.requestId};
      }
      if(actual?.active===false&&!recovered&&this.o.resume&&['INTERRUPTED','FAILED','QUEUED'].includes(actual.phase)){
        await this.apps.applicationsRecover({applicationId:host.applicationId,operationId:run.requestId});recovered=true;
      }else need(!actual||actual.active!==false||!['FAILED','CANCELLED','SUCCEEDED'].includes(actual.phase),'PIPELINE_APPLICATION_ENDED','The exact saved managed launch ended before readiness.');
      await delay(1000);
    }throw Object.assign(new Error('The original Applications launch remains pending; resume its same request.'),{code:'PIPELINE_APPLICATION_PENDING'});
  }
  call(name,args={}){return this.manager.call('merchant_pipeline_'+name,args);}
  async full(alias,d,key,{parse=false}={}){
    need(d.fileId&&/^[a-f0-9]{64}$/.test(d.sha256)&&Number.isSafeInteger(d.bytes),'PIPELINE_FULL_RESPONSE','Recover the exact native response if its retention acknowledgement is incomplete.');
    let at=0,readId=null,chunks=0;const h=createHash('sha256');
    try{for(;;){const r=await this.call('file',{workspace:alias,fileId:d.fileId,expectedSha256:d.sha256,offset:at,limit:196608,...(readId?{readId}:{})});
      need(r.encoding==='base64'&&r.offset===at&&r.file.sha256===d.sha256&&r.file.bytes===d.bytes,'PIPELINE_FULL_RESPONSE','The retained full response selection changed.');
      const b=Buffer.from(r.data,'base64');need(b.toString('base64')===r.data&&b.length===r.bytesRead&&(b.length>0||d.bytes===0),'PIPELINE_FULL_RESPONSE','The complete file chunk changed.');
      h.update(b);at+=b.length;chunks++;readId=r.readId;
      if(r.nextOffset===null){need(at===d.bytes,'PIPELINE_FULL_RESPONSE','The full file ended at another byte count.');readId=null;break;}
      need(r.nextOffset===at&&at<d.bytes,'PIPELINE_FULL_RESPONSE','Follow each complete retained byte page.');
    }}finally{if(readId)await this.call('file_release',{workspace:alias,readId});}
    need(h.digest('hex')===d.sha256,'PIPELINE_FULL_RESPONSE','The complete native file digest differs.');
    const source=join(this.exports,'pipeline-delivery-workbench',alias,d.sha256+'.content');
    const file=await this.copy(source,'retained/'+alias+'/'+d.sha256+'.content',d);
    await this.record('file-'+hash(key+'\0'+d.sha256),{key,workspace:alias,fileId:d.fileId,file,chunks,originalStatus:d.originalStatus??null});
    return parse?json(join(this.root,file.path)):file;
  }
  async response(name,args,key){const retained=await this.call(name,args),value=await this.full(args.workspace,retained,key,{parse:true});
    need(retained.ok!==false&&!value?.error,'PIPELINE_NATIVE_RESPONSE',value?.error?.message??'The original native HTTP response is not successful.',{requestId:retained.requestId,originalStatus:retained.originalStatus,retained});
    return{retained,value};
  }
  async stateView(alias,key){return(await this.response('state',{workspace:alias},key)).value;}
  async read(alias,action,payload,key){return(await this.response('read',{workspace:alias,action,payload},key)).value.result;}
  async mutation(alias,key,action,payload){
    const body=await this.intent(alias+'-'+key,async()=>{const state=await this.stateView(alias,key+'-before');return{action,payload,workspace_id:state.workspace_id,
      expected_revision:state.revision,request_id:randomUUID(),selection:state.selection};});
    need(body.action===action&&same(body.payload,payload),'PIPELINE_REQUEST','Preserve the complete original mutation body.');
    const result=await this.response('invoke',{workspace:alias,body},key);
    const repeated=await this.response('invoke',{workspace:alias,body},key+'-same-request');
    need(same(result.value,repeated.value),'PIPELINE_REQUEST','The original Staff response must replay unchanged.');
    const receipt=await this.read(alias,'request.get',{request_id:body.request_id},key+'-native-receipt');
    need(receipt?.request_id===body.request_id&&same(receipt.result,result.value.result),'PIPELINE_REQUEST','Retain the exact native accepted request result.');
    return{body,response:result.value};
  }
  async records(alias,kind,projectId,key){const rows=[];let offset=0;for(;;){const p=await this.read(alias,'records.list',{kind,project_id:projectId,offset,limit:200},key+'-'+offset);
      need(p.offset===offset&&Array.isArray(p.items),'PIPELINE_RECORDS','Read complete original record pages.');rows.push(...p.items);if(p.next_offset===null){need(rows.length===p.total,'PIPELINE_RECORDS','The complete record count differs.');break;}need(p.next_offset>offset,'PIPELINE_RECORDS','The original record cursor stalled.');offset=p.next_offset;}return rows;}
  async audit(alias,key){
    const state=await this.stateView(alias,key+'-state'),p=await this.read(alias,'project.get',{id:this.reference.result.project_id},key+'-project'),
      records={},files=[];
    for(const kind of ['edition','contract','binding','run','comparison','review','release'])records[kind]=await this.records(alias,kind,p.project.id,key+'-'+kind);
    for(const edition of records.edition)for(const row of edition.files){
      const value=await this.read(alias,'file.read',{edition_id:edition.id,path:row.path},key+'-source-'+edition.id+'-'+hash(row.path));
      const bytes=Buffer.from(value.content_base64,'base64');need(value.content_base64===bytes.toString('base64')&&bytes.length===row.bytes&&hash(bytes)===row.sha256,'PIPELINE_SOURCE_BYTES','Retain every complete original source file.');
      const path=join(this.root,'source-bytes',row.sha256);await bytesFile(path,bytes);files.push(await this.retain(path));
    }
    for(const item of records.run){
      const run=await this.read(alias,'run.get',{id:item.id},key+'-run-'+item.id);
      if(run.id===this.reference.result.run_id)need(run.dagster_run_id===this.reference.result.dagster_run_id&&run.state==='succeeded'&&
        run.outcome_sha256===this.reference.native.outcome_sha256&&same(run.outcome,this.reference.native.outcome),'PIPELINE_NATIVE_IDENTITY','Keep the complete original native outcome and persistent Dagster UUID.');
      for(const row of run.outcome?.evaluation?.artifact_files??[]){
        const value=await this.read(alias,'run.artifact',{id:run.id,path:row.path},key+'-artifact-'+run.id+'-'+hash(row.path));
        const b=Buffer.from(value.content_base64,'base64');need(b.toString('base64')===value.content_base64&&b.length===row.bytes&&hash(b)===row.sha256,'PIPELINE_NATIVE_BYTES','Retain every exact native artifact byte.');
        const path=join(this.root,'native-bytes',row.sha256);await bytesFile(path,b);files.push(await this.retain(path));
      }
      let offset=0,total=0;for(;;){const log=await this.read(alias,'run.log',{id:run.id,offset,limit:262144},key+'-log-'+run.id+'-'+offset);
        const b=Buffer.from(log.content_base64,'base64');need(b.length===log.bytes&&log.next_offset===offset+b.length,'PIPELINE_NATIVE_LOG','Read complete original log bytes.');total+=b.length;if(!log.has_more)break;need(log.next_offset>offset,'PIPELINE_NATIVE_LOG','The complete log cursor stalled.');offset=log.next_offset;}
    }
    need(records.run.some(x=>x.id===this.reference.result.run_id),'PIPELINE_NATIVE_IDENTITY','The original native run is absent.');
    let offset=0,audit=[];for(;;){const p=await this.read(alias,'audit.list',{offset,limit:200},key+'-audit-'+offset);audit.push(...p.items);if(p.next_offset===null)break;offset=p.next_offset;}
    await this.record(key+'-complete-history',{state,project:p,records,audit,files});
    return{workspaceId:state.workspace_id,revision:state.revision,selection:state.selection,project:p.project,
      editions:records.edition.map(x=>x.id),runs:records.run.map(x=>({id:x.id,dagsterRunId:x.dagster_run_id,outcomeSha256:x.outcome_sha256})),
      reviews:records.review.map(x=>x.id),releases:records.release.map(x=>x.id),files};
  }
  async archive(alias,key,kind,releaseId){
    const request=await this.intent(alias+'-'+key,async()=>({workspace:alias,kind,requestId:randomUUID(),...(releaseId?{releaseId}:{})}));
    const response=await this.call('archive',request),file=await this.full(alias,response,key),path=join(this.root,file.path);
    const inspection=await this.inspectArchive(path,key,kind==='release');
    need(inspection.archive_sha256===file.sha256&&inspection.manifest.workspace_id===this.reference.result.archive.workspace_id,
      'PIPELINE_ARCHIVE','The complete original archive belongs to another native workspace.');
    return{request,retained:response,file,inspection,storeEdition:this.currentConfig,reportDirectory:kind==='release'?join(this.root,'reports',key):null};
  }
  async inspectArchive(path,key,report=false){
    const result=await closedCommand({directory:join(this.root,'commands'),python:this.prepared.receiving.python,
      argv:['-B','-c',ZIP_INSPECT,this.prepared.receiving.applicationDirectory,path,report?join(this.root,'reports',key):''],cwd:this.root});
    for(const p of [result.recordPath,result.outPath,result.errPath])await this.retain(p);
    if(report){const directory=join(this.root,'reports',key);const visit=async p=>{for(const item of await readdir(p,{withFileTypes:true})){const full=join(p,item.name);need(!item.isSymbolicLink(),'PIPELINE_REPORT','Retain original ordinary report files.');if(item.isDirectory())await visit(full);else await this.retain(full);}};await visit(directory);}
    return result.value;
  }

  async sourceAndRequest(alias){
    return this.phase('primary-source-and-exact-request',async()=>{
      const selected=await this.intent('primary-source-edition-input',async()=>{
        const p=await this.read(alias,'project.get',{id:this.reference.result.project_id},'merchant-source-before');
        const file=await this.read(alias,'file.read',{edition_id:p.edition.id,path:'README.md'},'merchant-readme-before');
        need(typeof file.content==='string','PIPELINE_SOURCE','The complete original README must be UTF-8.');
        const state=await this.stateView(alias,'merchant-source-state');
        const body={action:'edition.save',payload:{project_id:p.project.id,base_edition_id:p.edition.id,label:'Installed client handover notes',
          source_notes:'Preserves the original native run and complete source history; documentation only, no additional execution.',
          files:[{path:'README.md',content_base64:Buffer.from(file.content+'\n\n## Installed receiving\n\nOriginal completed Dagster run: '+this.reference.result.dagster_run_id+'.\nThe selected native review remains bound to its actual executed edition.\n','utf8').toString('base64')}],delete_paths:[]},
          workspace_id:state.workspace_id,expected_revision:state.revision,request_id:randomUUID(),selection:state.selection};
        return{project:p.project,edition:p.edition,file,body};
      });
      const bodyPath=join(this.root,'inputs','original-edition-request.json');await save(bodyPath,selected.body,{immutable:true});await this.retain(bodyPath);
      const zipPath=join(this.root,'inputs','original-project-source.zip'),zipInput=join(this.root,'inputs','source-zip-selection.json');
      const files=selected.edition.files.map(r=>({...r,source:join(this.root,'source-bytes',r.sha256)}));
      await save(zipInput,files,{immutable:true});await this.retain(zipInput);
      if(!await exists(zipPath)){
        const script="import json,sys,zipfile,hashlib,os\nfrom pathlib import Path\nrows=json.loads(Path(sys.argv[1]).read_bytes());target=Path(sys.argv[2]);tmp=target.with_name(target.name+'.part')\nwith zipfile.ZipFile(tmp,'w',compression=zipfile.ZIP_DEFLATED) as z:\n for r in rows:\n  b=Path(r['source']).read_bytes()\n  if len(b)!=r['bytes'] or hashlib.sha256(b).hexdigest()!=r['sha256']:raise ValueError('Source bytes changed')\n  i=zipfile.ZipInfo(r['path'],(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100600<<16;z.writestr(i,b)\nwith tmp.open('rb') as f:os.fsync(f.fileno())\nos.replace(tmp,target)\nfd=os.open(target.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)\nprint(json.dumps({'path':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))\n";
        const result=await closedCommand({directory:join(this.root,'commands'),python:this.prepared.primary.python,argv:['-B','-c',script,zipInput,zipPath],cwd:this.root});
        for(const p of [result.recordPath,result.outPath,result.errPath])await this.retain(p);
      }
      const zip=await this.retain(zipPath),body=await identity(bodyPath);
      const inputs={project_source:{file:zipPath,bytes:zip.bytes,sha256:zip.sha256,filename:'original-project-source.zip',mediaType:'application/zip'},
        edition_request:{file:bodyPath,...body,filename:'original-edition-request.json',mediaType:'application/json'}};
      await this.setup('source-input',inputs);await this.call('connect',{workspace:alias});
      const exposed=await this.call('input',{workspace:alias,sourceInput:'project_source',expectedSourceSha256:zip.sha256});
      await this.full(alias,exposed,'declared-complete-source-zip');
      const imported=await this.response('source_import',{workspace:alias,sourceInput:'project_source',expectedSourceSha256:zip.sha256,root:'.'},'complete-source-import');
      need(imported.value.archive_sha256===zip.sha256&&same(imported.value.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),selected.edition.files),
        'PIPELINE_SOURCE_IMPORT','Inspect all original source ZIP files before source authoring.');
      const call={workspace:alias,sourceInput:'edition_request',expectedSourceSha256:body.sha256};
      const answer=await this.response('invoke_input',call,'declared-native-edition-request'),again=await this.response('invoke_input',call,'same-declared-native-edition-request');
      need(same(answer.value,again.value)&&answer.value.request_id===selected.body.request_id,'PIPELINE_REQUEST','Replay the same complete declared request and original response.');
      const diff=await this.read(alias,'edition.diff',{before_id:selected.edition.id,after_id:answer.value.result.id},'merchant-documentation-diff');
      need(diff.files.length===1&&diff.files[0].path==='README.md','PIPELINE_SOURCE_IMPORT','Only the selected documentation edit should differ.');
      return{sourceZip:zip,request:await this.retain(bodyPath),edition:answer.value.result,diff,originalEdition:selected.edition.id};
    });
  }
  async reviewRelease(alias){
    return this.phase('primary-reviewed-native-release',async()=>{
      const review=await this.mutation(alias,'review-original-native','review.save',{run_id:this.reference.result.run_id,decision:'approve',
        reviewer:'Installed pipeline receiving operator',comment:'Inspected the complete original native result, every retained artifact and the exact executed source. Documentation editions remain separately visible.'});
      const release=await this.mutation(alias,'release-original-native','release.create',{review_id:review.response.result.id,
        label:'Installed original pipeline delivery',operator_notes:'Retains the actual original Dagster/dbt result and exact reviewed edition, complete source history, current documentation and original requests. Configure local runtime paths explicitly before any new native work.'});
      need(release.response.result.outcome_sha256===this.reference.native.outcome_sha256,'PIPELINE_NATIVE_REVIEW','The release must select the original reviewed native outcome.');
      return{review:review.response.result,release:release.response.result};
    });
  }
  async browser(alias,key,{edit=false,reports=[]}={}){
    return this.phase(key,async()=>{
      const host=this.state.hosts[alias],route=await this.call('browser',{workspace:alias}),directory=join(this.root,'browser',key);
      const editDescription=edit?await this.intent(key+'-description',async()=>{
        const project=await this.read(alias,'project.get',{id:this.reference.result.project_id},key+'-project');
        return project.project.description+'\nInstalled receiving reviewed original Dagster run '+this.reference.result.dagster_run_id+'.';
      }):undefined;
      this.browserOwner=openPipelineReceivingBrowser({directory,origin:new URL(route.url).origin,capabilityFile:join(host.controlDirectory,'capability'),
        projectId:this.reference.result.project_id,runId:this.reference.result.run_id,dagsterRunId:this.reference.result.dagster_run_id,
        outcomeSha256:this.reference.native.outcome_sha256,playwright:this.o.playwright,chromium:this.o.chromium,
        ...(edit?{editDescription}:{}),reportDirectories:reports,resume:this.o.resume===true});
      let result;
      try{result=await this.browserOwner.run();}finally{for(;;){try{await this.browserOwner.close();this.browserOwner=null;break;}catch(e){this.state.errors.push({at:now(),phase:key,error:err(e)});await this.save();await delay(1000);}}}
      need(result.status==='complete'&&result.schema==='stellar-forge.pipeline-delivery-browser-result.v1','PIPELINE_BROWSER','Retain the full original browser result.');
      const resultPath=join(directory,'browser-result.json');need(same(await json(resultPath),result),'PIPELINE_BROWSER','Published browser result differs.');
      for(const row of result.files){const full=resolve(directory,row.path);child(directory,full);await verify(full,row);await this.retain(full);}
      await this.retain(resultPath);return result;
    });
  }
  async receive(alias,key,archive){
    const name='archive_'+hash(key).slice(0,16),path=join(this.root,archive.file.path);
    await this.setup(key,{[name]:{file:path,sha256:archive.file.sha256,bytes:archive.file.bytes,filename:'complete-original-delivery.zip',mediaType:'application/zip'}});
    await this.call('connect',{workspace:alias});
    const envelope=await this.intent(key+'-receive-envelope',async()=>{const s=await this.stateView(alias,key+'-before');return{workspace_id:s.workspace_id,expected_revision:s.revision,request_id:randomUUID(),selection:s.selection};});
    const args={workspace:alias,sourceInput:name,expectedSourceSha256:archive.file.sha256,envelope};
    const response=await this.response('receive',args,key+'-receive');
    need(response.value.result.inspection.archive_sha256===archive.file.sha256&&response.value.result.selection.receiving_id===archive.inspection.receiving_id,
      'PIPELINE_RECEIVING','The original receiving catalogue selected a different complete archive.');
    return{args,response:response.value};
  }
  async openWriter(alias,key,receivingId){
    const body=await this.intent(key+'-open',async()=>{const s=await this.stateView(alias,key+'-before');return{receiving_id:receivingId,workspace_id:s.workspace_id,
      expected_revision:s.revision,request_id:randomUUID(),selection:s.selection};});
    const response=await this.response('open',{workspace:alias,body},key);
    need(response.value.result.selection.receiving_id===receivingId,'PIPELINE_RECEIVING','The selected original receiving writer differs.');return response.value;
  }
  async retainedCatalogue(alias,key){
    const requests=[],files=[];
    for(let offset=0;;){const page=await this.call('requests',{workspace:alias,offset,limit:100});requests.push(...page.requests);if(page.nextOffset===null)break;offset=page.nextOffset;}
    for(let offset=0;;){const page=await this.call('files',{workspace:alias,offset,limit:100});files.push(...page.files);if(page.nextOffset===null)break;offset=page.nextOffset;}
    if(files.length)await this.record(key+'-pointer',await this.call('inspect',{workspace:alias,fileId:files.find(x=>x.mediaType==='application/json')?.fileId??files[0].fileId,
      expectedSha256:(files.find(x=>x.mediaType==='application/json')??files[0]).sha256,pointer:'',offset:0,limit:25}));
    await this.record(key+'-retained-catalogue',{requests,files});return{requests:requests.length,files:files.length};
  }
  async stop(name){
    const host=this.state.hosts[name];if(!host?.applicationId)return;
    const cancelled=v=>v?.schema==='stellar-forge.application-run-cancellation.v1'&&v.applicationId===host.applicationId&&v.state==='CANCELLED'&&v.launched===false;
    const closed=v=>{const r=v?.commandResult;return v?.active===false&&v.phase==='SUCCEEDED'&&r?.operation==='original-command'&&typeof r.completedAt==='string'&&Number.isFinite(Date.parse(r.completedAt))&&
      (r.state==='STOPPED'&&r.stopped===true&&r.launched===false||r.launched===true&&['STOPPED','COMPLETED','EXITED'].includes(r.state)&&(Number.isInteger(r.exitCode)||typeof r.signal==='string'&&r.signal.length>0)||
        r.state==='LAUNCH_FAILED'&&r.exitCode===null&&r.signal===null&&r.error&&
        r.closure?.schema==='stellar-forge.managed-command-closure.v1'&&
        typeof r.closure.childCreated==='boolean'&&r.closure.childClosed===true&&
        typeof r.closure.observerCreated==='boolean'&&r.closure.observerClosed===true);};
    for(const run of host.starts.filter(x=>!x.closed)){
      // Reopen this exact proof before observations or another Stop can change.
      const proof=await this.intent(name+'-'+run.requestId+'-closed',async()=>{
        let absent=false;
        try{await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});}
        catch(error){if(error.code!=='ENOENT')throw error;absent=true;}
        if(absent&&(run.dispatch==='selected'||this.selectedHere.has(run.requestId))){
          return{applicationId:host.applicationId,operationId:run.requestId,cancellation:null,output:null,
            unentered:{schema:'stellar-forge.receiving-unentered-launch.v1',state:'CANCELLED_BEFORE_DISPATCH',nativeRunObserved:false},closedAt:now()};
        }
        if(absent){
          // A prior caller may have entered Start: reconcile only its saved ID.
          await this.apps.applicationsStart({applicationId:host.applicationId,requestId:run.requestId,reviewId:run.reviewId});
        }
        const cancellation=await this.apps.applicationsStop({applicationId:host.applicationId,operationId:run.requestId});
        if(cancelled(cancellation)&&cancellation.operationId===run.requestId)
          return{applicationId:host.applicationId,operationId:run.requestId,cancellation,output:null,closedAt:now()};
        for(;;){
          const output=await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});
          if(output.operationId===run.requestId&&closed(output))
            return{applicationId:host.applicationId,operationId:run.requestId,cancellation:null,output,closedAt:now()};
          // Inactive pending/queued/interrupted/unknown observations retain ownership.
          await delay(1000);
        }
      });
      const unentered=proof.unentered?.schema==='stellar-forge.receiving-unentered-launch.v1'&&
        proof.unentered.state==='CANCELLED_BEFORE_DISPATCH'&&proof.unentered.nativeRunObserved===false;
      need(proof.applicationId===host.applicationId&&proof.operationId===run.requestId&&
        typeof proof.closedAt==='string'&&Number.isFinite(Date.parse(proof.closedAt))&&
        (unentered||cancelled(proof.cancellation)&&proof.cancellation.operationId===run.requestId||
          proof.output?.operationId===run.requestId&&closed(proof.output)),
        'PIPELINE_APPLICATION_CLOSE','Retain the positive closure proof for this exact original application and operation.');
      if(this.manager){
        const all=await this.call('status',{}),status=all.workspaces?.find(row=>row.workspace===name);
        if(status?.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});
      }
      run.closed=true;run.closedAt=proof.closedAt;
      if(unentered)run.cancelledBeforeDispatch=true;
      this.selectedHere.delete(run.requestId);await this.save();
    }
  }
  close(){
    if(this.closingPromise)return this.closingPromise;
    this.closingPromise=(async()=>{
      // Diagnostics must not abandon an owned browser, Staff child or manager.
      const report=(state,error)=>{try{process.stderr.write(JSON.stringify({state,error:err(error)})+'\n');}catch{}};
      if(!this.bound)return;
      if(!this.apps&&Object.values(this.state?.hosts??{}).some(host=>host.starts.some(run=>!run.closed)))
        for(;;){try{this.apps=await openRuntimeWorkspace({directory:this.o['merchant-workspace']});break;}
          catch(error){report('APPLICATION_OBSERVER_CLOSE_PENDING',error);await delay(1000);}}
      if(this.browserOwner)for(;;){try{await this.browserOwner.close();this.browserOwner=null;break;}catch(e){report('BROWSER_CLOSE_PENDING',e);await delay(1000);}}
      for(const name of Object.keys(this.state?.hosts??{}))while(this.state.hosts[name].starts.some(x=>!x.closed)){
        try{await this.stop(name);}catch(e){
          this.state.errors.push({at:now(),phase:'close-'+name,error:err(e)});
          try{await this.save();}catch(saveError){report('CLOSE_RECORD_PENDING',saveError);}
          report('APPLICATION_CLOSE_PENDING',e);await delay(1000);
        }
      }
      if(this.manager)for(;;){try{await this.manager.close();this.manager=null;break;}catch(e){report('MCP_CLOSE_PENDING',e);await delay(1000);}}
      if(this.apps)for(;;){try{await this.apps.close();this.apps=null;break;}catch(e){report('WORKSPACE_CLOSE_PENDING',e);await delay(1000);}}
    })().finally(()=>{this.closingPromise=null;});return this.closingPromise;
  }
  async finalize(candidate){
    for(const row of candidate.artifacts)await verify(join(this.root,row.path),row);
    await verify(this.reference.resultPath,this.reference.resultIdentity);
    const path=join(this.root,'MERCHANT_RESULT.json');await save(path,candidate,{immutable:true});
    this.state.result={path,...await identity(path)};this.state.status='complete';await this.save();return candidate;
  }
  async run(){
    const candidatePath=join(this.root,'candidate.json'),resultPath=join(this.root,'MERCHANT_RESULT.json');
    if(this.state.status==='complete'||await exists(candidatePath)||await exists(resultPath)){
      await this.close();const candidate=await json(await exists(candidatePath)?candidatePath:resultPath);
      need(candidate.schema==='stellar-forge.pipeline-delivery-workbench-result.v1'&&candidate.status==='complete'&&candidate.receivingId===this.state.id&&
        candidate.completedAt===this.state.completedAt&&same(candidate.selection,this.selection),'PIPELINE_FINAL_CANDIDATE','Adopt the same complete final candidate before mutable setup.');
      if(this.state.result)await verify(resultPath,this.state.result);
      return this.finalize(candidate);
    }
    this.state.status='running';await this.save();
    try{
      const installation=await this.prepare(),distribution=await this.distribution();
      const primary=await this.phase('03-primary-complete-installed-session',async()=>{
        const opening=await this.start('primary','primary-main');
        const before=await this.phase('03a-primary-original-history',()=>this.audit('primary','primary-original'));
        const source=await this.sourceAndRequest('primary'),review=await this.reviewRelease('primary');
        const release=await this.phase('03b-primary-client-release',()=>this.archive('primary','primary-client-release','release',review.release.id));
        const rendered=await this.browser('primary','03c-primary-browser',{edit:true,reports:[release.reportDirectory]});
        const after=await this.phase('03d-primary-current-history',()=>this.audit('primary','primary-current'));
        const forward=await this.phase('03e-primary-complete-forward-backup',()=>this.archive('primary','primary-forward','backup'));
        const retained=await this.phase('03f-primary-retained-catalogue',()=>this.retainedCatalogue('primary','primary-catalogue'));
        await this.stop('primary');return{opening,before,source,review,release,rendered,after,forward,retained};
      });
      const receiving=await this.phase('04-independent-receiving-session',async()=>{
        const opening=await this.start('receiving','receiving-main');
        await this.phase('04a-receive-full-current-backup',()=>this.receive('receiving','first-full-receive',primary.forward));
        const initial=await this.phase('04b-received-complete-history',()=>this.audit('receiving','receiving-original'));
        need(initial.project.description===primary.after.project.description&&same(initial.editions,primary.after.editions)&&same(initial.runs,primary.after.runs),
          'PIPELINE_FORWARD_HISTORY','The received full backup must retain current source, project edit and original native identities.');
        const edit=await this.phase('04c-local-received-edit',()=>this.mutation('receiving','independent-received-project-edit','project.update',
          {id:this.reference.result.project_id,description:primary.after.project.description+'\nIndependent receiving owner retained this later edit.'}));
        await this.phase('04d-open-independent-original',()=>this.openWriter('receiving','open-independent-original','original'));
        await this.phase('04e-reopen-exact-received-writer',()=>this.openWriter('receiving','reopen-exact-received',initial.selection.receiving_id));
        const repeat=await this.phase('04f-same-archive-preserves-later-edit',async()=>{
          const value=await this.receive('receiving','repeat-full-receive',primary.forward);
          const p=await this.read('receiving','project.get',{id:this.reference.result.project_id},'same-archive-later-edit');
          need(p.project.description===edit.response.result.description,'PIPELINE_RECEIVING','Reopening the same archive must preserve later received edits.');return value;
        });
        const release=await this.phase('04g-complete-received-client-release',()=>this.archive('receiving','received-client-release','release',primary.review.release.id));
        const rendered=await this.browser('receiving','04h-receiving-browser',{reports:[release.reportDirectory]});
        const final=await this.phase('04i-received-current-history',()=>this.audit('receiving','receiving-current'));
        const backup=await this.phase('04j-received-onward-backup',()=>this.archive('receiving','received-onward','backup'));
        await this.stop('receiving');return{opening,initial,edit,repeat,release,rendered,final,backup};
      });
      const cold={};
      for(const name of ['primary','receiving'])cold[name]=await this.phase('05-'+name+'-cold-reopen',async()=>{
        const retainedRelease=name==='primary'?primary.release:receiving.release;
        await this.setup(retainedRelease.storeEdition);
        const opening=await this.start(name,name+'-cold'),expected=name==='primary'?primary.after:receiving.final;
        const originalDownload=await this.full(name,retainedRelease.retained,name+'-cold-original-client-release');
        need(originalDownload.sha256===retainedRelease.file.sha256&&originalDownload.bytes===retainedRelease.file.bytes,'PIPELINE_COLD_FILE','Reopen the exact prior agent-store file ID after managed Stop/reopen.');
        need(opening.launchId!==(name==='primary'?primary.opening:receiving.opening).launchId,'PIPELINE_COLD_REOPEN','Cold reopen must establish a new actual managed launch.');
        const current=await this.audit(name,name+'-cold');
        need(same(current.selection,expected.selection)&&same(current.editions,expected.editions)&&same(current.runs,expected.runs)&&same(current.project,expected.project),
          'PIPELINE_COLD_REOPEN','The original writer selection, full source history and native identity must survive Stop/reopen.');
        const catalog=await this.response('received',{workspace:name},name+'-receiving-catalogue');
        const pending=await this.response('pending',{workspace:name},name+'-pending');
        need(pending.value===null,'PIPELINE_PENDING','The original request remains unresolved.');
        const retained=await this.retainedCatalogue(name,name+'-cold-files');await this.stop(name);
        return{opening,current,catalog:catalog.value,retained,originalDownload,storeEdition:retainedRelease.storeEdition};
      });
      await this.close();await verify(this.reference.resultPath,this.reference.resultIdentity);
      for(const file of Object.values(this.state.files))await verify(join(this.root,file.path),file);
      this.state.completedAt??=now();await this.save();
      const candidate={schema:'stellar-forge.pipeline-delivery-workbench-result.v1',status:'complete',operationId:this.reference.operationId,receivingId:this.state.id,
        completedAt:this.state.completedAt,selection:this.selection,installation,distribution,primary,receiving,cold,
        native:{runId:this.reference.result.run_id,dagsterRunId:this.reference.result.dagster_run_id,outcomeSha256:this.reference.native.outcome_sha256,
          additionalPipelineDispatched:false,originalResult:{path:this.reference.resultPath,...this.reference.resultIdentity}},
        artifacts:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path)),
        presentation:'Open every actual retained desktop/mobile screenshot and outgoing archive/report before customer presentation. The source/runtime/project transfers remain separate complete deliverables.'};
      await save(candidatePath,candidate,{immutable:true});return this.finalize(candidate);
    }catch(e){this.state.status='interrupted';this.state.errors.push({at:now(),phase:this.state.currentPhase,error:err(e)});await this.save();throw e;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){const value={command:'pipeline-delivery-workbench-receive',
    usage:'--directory PRIVATE_COURSE --merchant-workspace PRIVATE_RUNTIME_WORKSPACE --merchant-runtime INSTALLED_RUNTIME --preparation-result ABS_PREPARED --playwright ABS_MODULE --chromium ABS_BROWSER [--reference-result ABS_COMPLETE_JSON | --reference-request ABS_ORIGINAL_REQUEST | --native-host ABS_EXISTING_HOST] [--resume]',
    operation:'Adopt the completed original programme or run that unchanged original programme once through the maintained native owner for a new installation. Never replace a pending original native request.'};process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;}
  const o=parse(argv);await privateDirectory(o.directory);const lease=await acquireLease(join(o.directory,'receiving.lock'));let course;
  try{
    const installed=await inspectMerchantRuntime(o['merchant-runtime'],{load:false});
    need(await realpath(installed.sourceRoot)===SOURCE_ROOT,'PIPELINE_INSTALLED_SOURCE','Invoke the installed complete selected distribution.');
    const supplied=await json(o['preparation-result']),inspected=await inspectPipelineDeliveryPreparation({directory:supplied.directory});
    need(supplied.schema==='stellar-forge.pipeline-delivery-preparation.v1'&&supplied.state==='READY'&&supplied.resultPath===o['preparation-result']&&
      inspected.state==='READY'&&same(inspected.result,supplied)&&supplied.source.manifestSha256===AUTHORITY_SHA&&supplied.source.files===40,
      'PIPELINE_PREPARATION','Use the complete unchanged prepared source and independently reproduced native runtime.');
    const reference=await referenceResult(o,supplied),selection={directory:o.directory,merchantRuntime:o['merchant-runtime'],merchantWorkspace:o['merchant-workspace'],
      merchantSourceManifestSha256:installed.sourceManifestSha256,originalSourceManifestSha256:AUTHORITY_SHA,
      preparationResult:{path:o['preparation-result'],...await identity(o['preparation-result'])},preparation:supplied,
      reference:{operationId:reference.operationId,resultPath:reference.resultPath,result:reference.resultIdentity,source:reference.source,
        request:reference.requestIdentity?{path:reference.requestPath,...reference.requestIdentity}:null},
      node:{path:process.execPath,version:process.version},playwright:{path:o.playwright,...await identity(o.playwright)},chromium:{path:o.chromium,...await identity(o.chromium)}};
    course=new Course(o,supplied,reference,selection,lease);await course.open();return await course.run();
  }finally{if(course)await course.close();await lease.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({error:err(e)})+'\n');process.exitCode=1;});
