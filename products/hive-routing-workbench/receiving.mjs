// SPDX-License-Identifier: MIT
// One continuation of the original full Hive reference, installed Applications and agent receiving.
import {readFile,writeFile,mkdir,open,rename,unlink,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {inspectHivePreparation} from './preparation.mjs';
import {acquireLease,inspectOriginalSource,WORKBENCH_ROOT,ORIGINAL_MANIFEST_SHA256} from './managed.mjs';
import {LAUNCH_SCHEMA,privateDirectory} from './connection.mjs';
import {HIVE_HOST_SCHEMA} from './mcp.mjs';
import merchantProvider from './merchant-provider.mjs';
import {initializeHiveRoutingMerchant} from './setup.mjs';
import {openHiveReceivingBrowser} from './receiving-browser.mjs';
import {readMerchantConfig} from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(HERE,'../..');
const SCHEMA='stellar-forge.hive-routing-receiving.v1',RESULT_SCHEMA='stellar-forge.hive-routing-customer-result.v1';
const REFERENCE_OPERATION='HIVE-APPLICATION-MIGRATION-0C7A-20261012';
const UPSTREAM='28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6';
const now=()=>new Date().toISOString();
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(yes,code,message,details={})=>{if(!yes)throw Object.assign(new Error(message),{code,details});};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const err=e=>({code:e.code??'MERCHANT_RECEIVING_FAILED',message:e.message,details:e.details??{}});
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function child(root,path){const r=relative(root,path);need(r!==''&&!r.startsWith('../')&&!isAbsolute(r),'RECEIVING_PATH','Keep complete artifacts under the original operation.');return r.split('\\').join('/');}
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
  const temporary=target+'.copy-'+randomUUID(),input=await open(source,'r'),output=await open(temporary,'wx',0o600);
  try{
    const before=await input.stat(),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<before.size){const r=await input.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'MERCHANT_PACKAGE_COPY','The selected complete package ended early.');await output.writeFile(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
    const after=await input.stat();need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'MERCHANT_PACKAGE_COPY','The selected package changed while retaining it.');
    await output.sync();
  }finally{await input.close();await output.close();}
  await verify(temporary,expected);await rename(temporary,target);const directory=await open(dirname(target),'r');try{await directory.sync();}finally{await directory.close();}
}


function parse(argv){
  const out={};for(let i=0;i<argv.length;i++){const k=argv[i];if(k==='--resume'){need(!out.resume,'HIVE_ARGUMENT','Use resume once.');out.resume=true;continue;}
    need(['--directory','--merchant-workspace','--merchant-runtime','--preparation-result','--reference-result','--reference-request','--python','--playwright','--chromium'].includes(k)&&!Object.hasOwn(out,k.slice(2))&&typeof argv[i+1]==='string'&&isAbsolute(argv[i+1]),'HIVE_ARGUMENT','Use each documented absolute selection once.');
    out[k.slice(2)]=resolve(argv[++i]);}
  for(const k of ['directory','merchant-workspace','merchant-runtime','preparation-result','python','playwright','chromium'])need(out[k],'HIVE_ARGUMENT','Supply --'+k+' from the existing equipped receiving installation.');
  need(Boolean(out['reference-result'])!==Boolean(out['reference-request']),'HIVE_REFERENCE','Select exactly one original --reference-result or --reference-request.');
  return out;
}
async function reservePort(){return new Promise((accept,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):accept(p));});});}
function originalEntity(state,kind,id){return state.entities.find(x=>x.kind===kind&&x.id===id);}
function nativeEntity(value){return value?.recovered===true?value.entity:value;}
function relativeFile(path){need(typeof path==='string'&&!isAbsolute(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!path.includes('\\'),'HIVE_SOURCE_PATH','Keep the complete original source names.');return path;}
async function verifyReferenceResult(path){
  const result=await json(path),root=dirname(path);
  need(result.schema==='hive-desk-reference-result/v1'&&result.operation_id===REFERENCE_OPERATION&&result.complete===true&&result.source_commit===UPSTREAM&&result.selected_responses===60&&result.workspace?.verified===true,
    'HIVE_REFERENCE_INCOMPLETE','Adopt the exact completed original sixty-response Hive course.');
  need(result.input?.root===root&&result.input.operation_id===REFERENCE_OPERATION&&result.input.product_source?.files?.length===64,
    'HIVE_REFERENCE_SELECTION','Retain the original native input and complete source inventory.');
  for(const phase of ['initial','changed','rollback']){const p=result.phases?.[phase];
    need(p?.complete&&p.owners_closed&&p.validation?.responses?.length===20&&p.validation.phase===phase&&p.validation.programme_id===p.programme_id&&same(p.validation.populations,{products:9,inventory:9,accounts:6,reviews:11}),
      'HIVE_REFERENCE_PHASE','Retain every original phase and complete population.');}
  need(result.fixture_closed_at&&result.routers_closed_at&&result.workspace_closed_at&&result.receiving?.forward?.relation==='incoming-forward'&&result.receiving?.older?.relation==='current-forward'&&result.receiving?.same?.relation==='identical',
    'HIVE_REFERENCE_CLOSURE','Adopt the original closed native owners and full forward/older/same receiving result.');
  need(Array.isArray(result.artifacts)&&result.artifacts.length>0,'HIVE_REFERENCE_ARTIFACTS','Retain the complete original artifact selection.');
  for(const a of result.artifacts){const full=resolve(a.path);child(root,full);await verify(full,a);if(a.git_blob){const b=await readFile(full);need(createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex')===a.git_blob,'HIVE_REFERENCE_ARTIFACTS','An original Git object identity changed.');}}
  for(const d of [result.initial_archive,result.final_archive])await verify(d.path,d);
  return{path,identity:await identity(path),root,result};
}
async function loadReferenceRequest(path){
  const r=await json(path),keys=['source','upstream','fixtureReady','router','root','initialPort','changedPort','subgraphPort','python','resume'];
  need(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>keys.includes(k))&&keys.filter(k=>k!=='resume').every(k=>Object.hasOwn(r,k)),'HIVE_REFERENCE_REQUEST','Retain the exact original receiving CLI fields.');
  for(const k of ['source','upstream','fixtureReady','router','root','python'])need(typeof r[k]==='string'&&isAbsolute(r[k])&&resolve(r[k])===r[k],'HIVE_REFERENCE_REQUEST','Use the original canonical absolute '+k+'.');
  const ports=['initialPort','changedPort','subgraphPort'].map(k=>r[k]);need(ports.every(x=>Number.isInteger(x)&&x>=1024&&x<=65535)&&new Set(ports).size===3,'HIVE_REFERENCE_PORTS','Preserve the three distinct original native ports.');
  need(r.resume===undefined||r.resume===true,'HIVE_REFERENCE_REQUEST','Resume is an explicit same-operation continuation.');return r;
}

function referenceEnvironment(){const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1'};for(const name of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP'])delete env[name];return env;}
async function historicalReferenceSource(directory,authority){
  need(await realpath(directory)===directory,'HIVE_REFERENCE_SOURCE','Keep the original ordinary source directory.');
  const rows=[],names=[],allowed=new Map((authority.maintenance??[]).map(m=>[m.path,m]));
  async function walk(base=''){for(const entry of await readdir(join(directory,base),{withFileTypes:true})){
    const path=base?base+'/'+entry.name:entry.name;
    if(entry.name==='__pycache__'&&entry.isDirectory())continue;
    need(!entry.isSymbolicLink(),'HIVE_REFERENCE_SOURCE','The retained complete application must not acquire a linked source member.',{path});
    if(entry.isDirectory())await walk(path);else{need(entry.isFile(),'HIVE_REFERENCE_SOURCE','Retain only the original complete source files.',{path});names.push(path);}
  }}
  await walk();const selected=authority.files.map(f=>f.path).sort();
  need(same(names.sort(),selected)&&selected.length===64,'HIVE_REFERENCE_SOURCE','Retain the complete original64 source inventory.');
  const declared=await json(join(directory,'source-files.json'));
  need(Array.isArray(declared.files)&&same([...declared.files].sort(),selected),'HIVE_REFERENCE_SOURCE','The original source-files selection differs.');
  for(const path of selected){
    relativeFile(path);need(await realpath(join(directory,path))===join(directory,path),'HIVE_REFERENCE_SOURCE','Keep every original source member ordinary.');
    const actual=await identity(join(directory,path)),current=authority.files.find(f=>f.path===path),prior=allowed.get(path)?.original;
    need(actual.bytes===current.bytes&&actual.sha256===current.sha256||prior&&actual.bytes===prior.bytes&&actual.sha256===prior.sha256,
      'HIVE_REFERENCE_SOURCE','An original source member is neither its recorded prior body nor the reviewed maintained body.',{path,actual});
    const raw=await readFile(join(directory,path));rows.push({path,...actual,git_blob:createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex')});
  }
  const manifest=rows.find(f=>f.path==='source-files.json');return{manifest:{bytes:manifest.bytes,sha256:manifest.sha256,git_blob:manifest.git_blob},files:rows};
}
const REFERENCE_PYTHON_INSPECT=String.raw`
import hashlib, importlib.metadata, json, os, platform, sys
from pathlib import Path
import yaml
def file(path):
 p=Path(path).resolve(strict=True)
 with p.open("rb") as f:
  before=os.fstat(f.fileno());h=hashlib.sha256();size=0
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b);size+=len(b)
  after=os.fstat(f.fileno())
  assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
 return {"path":str(p),"bytes":size,"sha256":h.hexdigest()}
assert sys.version_info>=(3,11), "Retain a supported original Python"
dist=importlib.metadata.distribution("PyYAML")
assert dist.version=="6.0.3" and yaml.__version__=="6.0.3", "Select the original pinned PyYAML 6.0.3"
rows=[]
for member in sorted(dist.files or [],key=str):
 if "__pycache__" in member.parts or str(member).endswith((".pyc",".pyo")):continue
 rows.append({"member":str(member),**file(dist.locate_file(member))})
assert rows, "The original dependency metadata must retain every installed member"
paths={r["path"] for r in rows}
loaded=[]
for name,module in sorted(sys.modules.items()):
 if name=="yaml" or name.startswith("yaml.") or name=="_yaml" or name.startswith("_yaml."):
  path=getattr(module,"__file__",None)
  if path:
   item=file(path);assert item["path"] in paths, "A loaded original YAML module is outside its retained distribution"
   loaded.append({"module":name,**item})
print(json.dumps({"schema":"stellar-forge.hive-reference-python.v1","executable":sys.executable,"binary":file(sys.executable),"version":sys.version,"implementation":platform.python_implementation(),"platform":platform.platform(),"prefix":sys.prefix,"basePrefix":sys.base_prefix,"dependency":{"name":"PyYAML","version":dist.version,"files":rows,"loaded":loaded}},sort_keys=True))
`;
class Course{
  constructor(options,selection,preparation,lease){this.options=options;this.selection=selection;this.preparation=preparation;this.directory=options.directory;this.root=this.directory;this.lease=lease;this.path=join(this.directory,'operation.json');this.state=null;this.apps=null;this.manager=null;this.exports=null;this.browserOwners=new Set();this.referenceChild=null;this.referenceEnded=null;this.closingTask=null;this.reference=null;}
  async save(){need(this.lease,'HIVE_RECEIVING_OWNER','Keep the original integration lease.');await save(this.path,this.state);}
  async open(){if(await exists(this.path)){this.state=await json(this.path);need(this.state.schema===SCHEMA&&same(this.state.selection,this.selection),'HIVE_RECEIVING_SELECTION','Continue the original exact installed source and native request.');need(this.options.resume||this.state.status==='complete','HIVE_RECEIVING_RESUME','Continue this operation with --resume.');}
    else{this.state={schema:SCHEMA,id:'hive_merchant_'+randomUUID(),selection:this.selection,status:'prepared',createdAt:now(),phases:{},hosts:{},files:{},errors:[],attempts:[]};await this.save();}
    for(const d of Object.values(this.state.files))await verify(join(this.directory,d.path),d);
    this.apps=await openRuntimeWorkspace({directory:this.options['merchant-workspace']});return this;
  }
  async retain(path){const full=resolve(path),name=child(this.directory,full),d={path:name,...await identity(full)};this.state.files[name]=d;await this.save();return d;}
  async record(name,value){const p=join(this.directory,'records',name+'.json');await save(p,value,{immutable:true});await this.retain(p);return value;}
  async intent(name,make){const p=join(this.directory,'intents',name+'.json');if(await exists(p)){const v=await json(p);await this.retain(p);return v;}const value=await make();await save(p,value,{immutable:true});await this.retain(p);return value;}
  async phase(name,fn){const old=this.state.phases[name];if(old?.status==='complete')return old.result;this.state.currentPhase=name;this.state.phases[name]={...old,status:'running',startedAt:old?.startedAt??now()};await this.save();process.stdout.write(JSON.stringify({operationId:this.state.id,phase:name,status:'running'})+'\n');const result=await fn();this.state.phases[name]={...this.state.phases[name],status:'complete',completedAt:now(),result};await this.save();return result;}
  async observed(name,fn){try{return await fn();}catch(e){this.state.errors.push({at:now(),phase:this.state.currentPhase,name,error:err(e)});await this.save();throw e;}}
  async inspectReferencePython(request){
    const id=randomUUID(),directory=join(this.directory,'reference-python-observations',id);
    await mkdir(directory,{recursive:true,mode:0o700});
    const stdout=join(directory,'stdout.json'),stderr=join(directory,'stderr.log');
    const out=await open(stdout,'wx',0o600),error=await open(stderr,'wx',0o600);
    const argv=['-B','-I','-c',REFERENCE_PYTHON_INSPECT];
    const intent={python:request.python,argv,cwd:request.source,startedAt:now()};
    await save(join(directory,'command.json'),intent,{immutable:true});await this.retain(join(directory,'command.json'));
    let ended;
    try{
      this.referenceChild=spawn(request.python,argv,{cwd:request.source,env:referenceEnvironment(),stdio:['ignore',out.fd,error.fd,this.lease.fd]});
      this.referenceEnded=new Promise(accept=>{let failure=null;this.referenceChild.once('error',e=>failure=err(e));this.referenceChild.once('close',(code,signal)=>accept({code,signal,error:failure}));});
      ended=await this.referenceEnded;await out.sync();await error.sync();
      await save(join(directory,'closed.json'),{...intent,endedAt:now(),result:ended},{immutable:true});await this.retain(join(directory,'closed.json'));
    }finally{if(this.referenceEnded)await this.referenceEnded;this.referenceChild=null;this.referenceEnded=null;await out.close();await error.close();await this.retain(stdout);await this.retain(stderr);}
    need(ended.code===0&&!ended.error,'HIVE_REFERENCE_PYTHON','The selected original Python/dependency inspection did not complete; retain its exact logs.',ended);
    const observed=await json(stdout);need(observed.schema==='stellar-forge.hive-reference-python.v1'&&observed.binary.path===await realpath(request.python)&&observed.dependency.version==='6.0.3',
      'HIVE_REFERENCE_PYTHON','Retain the actual original interpreter invocation and complete loaded dependency bytes.');
    const original=await this.intent('original-reference-python',async()=>({invocation:request.python,observed}));
    need(original.invocation===request.python&&same(original.observed,observed),'HIVE_REFERENCE_PYTHON','The original interpreter or installed dependency selection changed.');
    return original;
  }
  async originalReference(){
    const adopted=await this.phase('00-original-sixty-response-reference',async()=>{
      const selected=this.options['reference-result']??join((await loadReferenceRequest(this.options['reference-request'])).root,'result.json');
      if(!(await exists(selected))){
        need(this.options['reference-request'],'HIVE_REFERENCE_INCOMPLETE','The selected original result has not been published. Supply its existing complete request to the same owner.');
        const request=await loadReferenceRequest(this.options['reference-request']);
        const journal=join(request.root,'reference-receiving.json'),prior=await exists(journal)?await json(journal):null;
        const authority=await json(join(HERE,'original-source.json'));
        const source=await historicalReferenceSource(request.source,authority);
        if(prior){
          need(this.options.resume||request.resume,'HIVE_REFERENCE_RESUME','Continue the same original reference journal explicitly.');
          need(prior.schema==='hive-desk-reference-receiving/v1'&&prior.operation_id===REFERENCE_OPERATION&&prior.input?.operation_id===REFERENCE_OPERATION&&
            prior.input.source_root===request.source&&prior.input.upstream_root===request.upstream&&prior.input.root===request.root&&
            prior.input.router.path===request.router&&same(prior.input.ports,{initial:request.initialPort,changed:request.changedPort,subgraphs:request.subgraphPort})&&same(prior.input.product_source,source),
            'HIVE_REFERENCE_RUNTIME','Resume the exact original partial journal, source bytes, router path and native ports.');
          await verify(request.router,prior.input.router);await verify(request.fixtureReady,prior.input.fixture_ready);
          const retained=join(this.directory,'reference','ORIGINAL_PARTIAL_INPUT.json');
          await save(retained,prior.input,{immutable:true});await this.retain(retained);
        }else{
          need(request.source===this.preparation.primary.applicationDirectory&&request.python===this.preparation.primary.python,'HIVE_REFERENCE_RUNTIME','An unstarted course must select the actual maintained primary application and prepared Python.');
          await inspectOriginalSource({directory:request.source});
        }
        const router=await identity(request.router),readyRouter=await identity(this.preparation.primary.router);
        need(router.bytes===readyRouter.bytes&&router.sha256===readyRouter.sha256,'HIVE_REFERENCE_ROUTER','Keep the selected original Hive release.');
        await this.inspectReferencePython(request);
        const argv=['-B','-m','reference.receive','--source',request.source,'--upstream',request.upstream,'--fixture-ready',request.fixtureReady,'--router',request.router,'--root',request.root,
          '--initial-port',String(request.initialPort),'--changed-port',String(request.changedPort),'--subgraph-port',String(request.subgraphPort)];
        const original=await this.intent('original-reference-command',async()=>({python:request.python,argv,cwd:request.source,request,requestIdentity:await identity(this.options['reference-request'])}));
        need(same(original.argv,argv)&&original.python===request.python,'HIVE_REFERENCE_COMMAND','Preserve the original complete command and resume selection.');
        const actualArgv=[...original.argv,...((this.options.resume||request.resume)?['--resume']:[])];
        const attempts=this.state.referenceAttempts??=[];const attempt={id:randomUUID(),startedAt:now(),state:'starting',command:original,actualArgv};attempts.push(attempt);await this.save();
        const dir=join(this.directory,'reference-attempts',attempt.id);await mkdir(dir,{mode:0o700,recursive:true});const out=await open(join(dir,'stdout.log'),'wx',0o600),error=await open(join(dir,'stderr.log'),'wx',0o600);
        try{
          const env=referenceEnvironment();
          this.referenceChild=spawn(original.python,actualArgv,{cwd:original.cwd,env,stdio:['ignore',out.fd,error.fd,this.lease.fd]});
          this.referenceEnded=new Promise(accept=>{let failed=null;this.referenceChild.once('error',e=>failed=err(e));this.referenceChild.once('close',(code,signal)=>accept({code,signal,error:failed}));});
          attempt.state='running';attempt.pid=this.referenceChild.pid??null;await this.save();
          const ended=await this.referenceEnded;attempt.state='closed';attempt.endedAt=now();attempt.result=ended;await out.sync();await error.sync();await this.save();
          need(ended.code===0&&!ended.error,'HIVE_REFERENCE_NATIVE','The same original native course has not completed; preserve its command, complete logs and reference journal.',ended);
        }finally{await out.close();await error.close();if(this.referenceEnded)await this.referenceEnded;this.referenceChild=null;this.referenceEnded=null;await this.retain(join(dir,'stdout.log'));await this.retain(join(dir,'stderr.log'));}
      }
      const original=await verifyReferenceResult(selected),copy=join(this.directory,'reference','ORIGINAL_RESULT.json');await copySelected(original.path,copy,original.identity);await this.retain(copy);
      const archiveFiles={};for(const[k,d]of Object.entries({initial:original.result.initial_archive,complete:original.result.final_archive})){const dest=join(this.directory,'reference',k+'.zip');await copySelected(d.path,dest,d);archiveFiles[k]={original:d,retained:await this.retain(dest)};}
      const source=await json(join(HERE,'original-source.json')),old=original.result.input.product_source.files;
      need(source.files.length===64&&old.length===64&&new Set(old.map(f=>f.path)).size===64,'HIVE_REFERENCE_SOURCE','Retain all64 exact original source members.');
      const allowed=Object.fromEntries((source.maintenance??[]).map(m=>[m.path,m])),changes=[];
      for(const before of old){relativeFile(before.path);const after=source.files.find(f=>f.path===before.path);need(after,'HIVE_REFERENCE_SOURCE','A selected original source member is absent.');
        if(before.bytes!==after.bytes||before.sha256!==after.sha256){need(allowed[before.path]&&before.bytes===allowed[before.path].original.bytes&&before.sha256===allowed[before.path].original.sha256&&after.bytes===allowed[before.path].selected.bytes&&after.sha256===allowed[before.path].selected.sha256,'HIVE_REFERENCE_SOURCE_UPGRADE','Only the retained reviewed server/UI maintenance may differ from the completed original course.');changes.push({path:before.path,before:{bytes:before.bytes,sha256:before.sha256},after:{bytes:after.bytes,sha256:after.sha256}});}}
      const upgrade=await this.record('original-reference-source-selection',{originalReference:original.identity,originalSource:original.result.input.product_source,observerSource:{manifestSha256:ORIGINAL_MANIFEST_SHA256,files:source.files},changes,
        policy:'The original completed native result remains unchanged. Only the maintained observer server and stopped-router UI are selected for Applications.'});
      const artifacts=[];for(let i=0;i<original.result.artifacts.length;i++){const a=original.result.artifacts[i],dest=join(this.directory,'reference','artifacts',String(i).padStart(4,'0')+'-'+a.sha256);await copySelected(a.path,dest,a);artifacts.push({original:a,retained:await this.retain(dest)});}
      return{root:original.root,path:original.path,identity:original.identity,result:original.result,archives:archiveFiles,artifacts,sourceSelection:upgrade};
    });
    this.reference=adopted;await verify(adopted.path,adopted.identity);return adopted;
  }
  async attach(){
    const a=await this.phase('01-original-merchant-installation',()=>this.apps.attach({directory:this.options['merchant-runtime'],label:'Hive Routing Workbench complete original installation'}));
    need(a.status==='READY'&&typeof a.runtimeId==='string','HIVE_MERCHANT_RUNTIME','Select the actual READY installed Merchant distribution.');this.runtimeId=a.runtimeId;
    return a;
  }
  async distribution(){
    return this.phase('02-complete-source-and-runtime-handoff',async()=>{
      const selected=await this.intent('distribution-selection',async()=>{
        const planPath=join(this.options['merchant-runtime'],'runtime-install.json'),manifestPath=join(this.options['merchant-runtime'],'package','manifest.json'),plan=await json(planPath),manifest=await identity(manifestPath);
        need(manifest.sha256===this.selection.merchantSourceManifestSha256&&plan.source?.manifestSha256===manifest.sha256&&isAbsolute(plan.archivePath),'HIVE_DISTRIBUTION','Retain the exact complete installed source package.');
        const archive=await identity(plan.archivePath);need(archive.sha256===plan.archiveSha256,'HIVE_DISTRIBUTION','The installed archive differs.');
        return{planPath,planIdentity:await identity(planPath),manifestPath,manifest,archivePath:plan.archivePath,archive,handoff:await this.apps.handoff(this.runtimeId)};
      });
      const retained={};for(const[k,p,d]of [['distribution',selected.archivePath,selected.archive],['manifest',selected.manifestPath,selected.manifest],['installation',selected.planPath,selected.planIdentity],['preparation',this.options['preparation-result'],this.selection.preparationResult],['portable',this.preparation.portable.path,this.preparation.portable],['preparationRequest',join(dirname(this.preparation.resultPath),'REQUEST.json'),await identity(join(dirname(this.preparation.resultPath),'REQUEST.json'))]]){
        const target=join(this.directory,'handoff',k+(k==='distribution'||k==='portable'?'.tar.gz':'.json'));await copySelected(p,target,d);retained[k]=await this.retain(target);
      }
      for(const name of ['primary','receiving']){const path=this.preparation[name].runtimeReadyFile,d=await identity(path),target=join(this.directory,'handoff',name+'-runtime-ready.json');await copySelected(path,target,d);retained[name+'Runtime']=await this.retain(target);}
      await this.record('original-installed-handoff',selected.handoff);
      return{files:retained,handoff:selected.handoff,scope:'Whole Merchant adapters/Applications source, both independent prepared applications/runtimes and original workspace ZIPs are retained as separate complete packages.'};
    });
  }
  async makeHost(name,directory,prepared,extraArchives={}){
    if(this.state.hosts[name]){need(this.state.hosts[name].directory===directory,'HIVE_HOST_SELECTION','Preserve the original host workspace.');return this.state.hosts[name];}
    await privateDirectory(dirname(directory));await privateDirectory(directory);
    const root=join(this.directory,'hosts',name);await mkdir(root,{recursive:true,mode:0o700});
    const selected=await this.intent(name+'-host-selection',async()=>({port:await reservePort(),configurationFile:join(root,'launch.json'),connectionFile:join(root,'connection.json'),outputDirectory:join(root,'outputs')}));
    await mkdir(selected.outputDirectory,{recursive:true,mode:0o700});
    const launch={schema:LAUNCH_SCHEMA,directory,applicationDirectory:prepared.applicationDirectory,python:prepared.python,runtimeReadyFile:prepared.runtimeReadyFile,connectionFile:selected.connectionFile};
    await save(selected.configurationFile,launch,{immutable:true});await this.retain(selected.configurationFile);
    const archives={initial:{file:join(this.directory,this.reference.archives.initial.retained.path),bytes:this.reference.archives.initial.retained.bytes,sha256:this.reference.archives.initial.retained.sha256},reference:{file:join(this.directory,this.reference.archives.complete.retained.path),bytes:this.reference.archives.complete.retained.bytes,sha256:this.reference.archives.complete.retained.sha256},...extraArchives};
    this.state.hosts[name]={name,directory,...selected,prepared,archives,starts:[]};await this.save();return this.state.hosts[name];
  }
  async setup(edition){
    const config=join(this.directory,'merchant-host-'+edition+'.json');
    if(await exists(config)){
      const selected=await json(config);need(selected.schema===HIVE_HOST_SCHEMA&&selected.workspaces&&Object.keys(selected.workspaces).length,'HIVE_HOST_CONFIGURATION','Keep the exact saved host-configuration edition.');
      for(const[name,row]of Object.entries(selected.workspaces)){
        const host=this.state.hosts[name];need(host&&row.directory===host.directory&&row.connectionFile===host.connectionFile&&row.outputDirectory===host.outputDirectory&&row.binaries?.original?.file===host.prepared.router,
          'HIVE_HOST_CONFIGURATION','The saved configuration must retain its original host and runtime paths.');
        await verify(row.binaries.original.file,row.binaries.original);
        for(const archive of Object.values(row.archives??{}))await verify(archive.file,archive);
      }
    }else{
      const workspaces={};for(const[name,h]of Object.entries(this.state.hosts))workspaces[name]={label:'Hive original '+name,directory:h.directory,connectionFile:h.connectionFile,outputDirectory:h.outputDirectory,editions:{},binaries:{original:{file:h.prepared.router,...await identity(h.prepared.router)}},archives:h.archives};
      await save(config,{schema:HIVE_HOST_SCHEMA,workspaces},{immutable:true});
    }
    await this.retain(config);
    if(this.manager){await this.manager.close();this.manager=null;}
    const result=await initializeHiveRoutingMerchant({directory:join(this.directory,'agent-host-'+edition),connection:config,name:'Hive original receiving '+edition});
    await this.record('setup-'+edition+'-'+hash(canonical(result)),result);const parsed=await readMerchantConfig(result.configuration);this.exports=parsed.exportsDirectory;
    this.manager=await merchantProvider.create(await merchantProvider.load(),parsed);
    const catalog=merchantProvider.tools((name,description,properties,required)=>({name,properties,required}));
    need(catalog.length===21&&new Set(catalog.map(x=>x.name)).size===21,'HIVE_TOOL_CATALOG','Select the complete actual21-tool provider.');
    await this.record('complete-tool-catalog',catalog);return{configuration:config,setup:result};
  }

  call(name,args={}){return this.manager.call('merchant_hive_'+name,args);}
  async full(alias,descriptor,key,{parse=false}={}){
    need(descriptor.fileId&&/^[0-9a-f]{64}$/.test(descriptor.sha256)&&Number.isSafeInteger(descriptor.bytes),'HIVE_COMPLETE_RESPONSE','Retain a complete actual provider file descriptor.');
    const h=createHash('sha256');let offset=0,readId=null,chunks=0;
    try{for(;;){const r=await this.call('file',{workspace:alias,fileId:descriptor.fileId,expectedSha256:descriptor.sha256,...(readId?{readId}:{}),offset,limit:196608});
      need(r.encoding==='base64'&&r.offset===offset&&r.file.sha256===descriptor.sha256&&r.file.bytes===descriptor.bytes,'HIVE_FILE_SELECTION','Read the exact complete retained original file.');
      const b=Buffer.from(r.data,'base64');need(b.toString('base64')===r.data&&b.length===r.bytesRead&&(b.length>0||descriptor.bytes===0),'HIVE_FILE_BYTES','The complete original byte stream differs.');
      h.update(b);offset+=b.length;chunks++;readId=r.readId;
      need(r.nextOffset===null?offset===descriptor.bytes:r.nextOffset===offset&&offset<descriptor.bytes,'HIVE_FILE_OFFSET','Follow the original complete byte offsets.');
      if(r.nextOffset===null){readId=null;break;}}
    }finally{if(readId)await this.call('file_release',{workspace:alias,readId});}
    need(offset===descriptor.bytes&&h.digest('hex')===descriptor.sha256,'HIVE_FILE_IDENTITY','The complete file differs from its original descriptor.');
    const retained=join(this.exports,'hive-routing-workbench',alias,descriptor.sha256+'.content');await verify(retained,descriptor);const file=await this.retain(retained);
    await this.record('file-'+hash(key+'\0'+descriptor.sha256),{key,workspace:alias,fileId:descriptor.fileId,bytes:offset,sha256:descriptor.sha256,chunks,file});
    return parse?json(retained):file;
  }
  async response(name,args,key){
    const retained=await this.call(name,args),value=await this.full(args.workspace,retained,key,{parse:true});
    if(retained.originalRequest)await this.full(args.workspace,retained.originalRequest,key+'-original-request',{parse:true});
    need(!retained.reconciliationRequired&&(!retained.originalStatus||retained.originalStatus>=200&&retained.originalStatus<300),
      'HIVE_ORIGINAL_RESPONSE','The original returned response is retained; resolve its exact effect before continuing.',{requestId:retained.requestId,outcome:retained.originalOutcome,value});
    return{retained,value};
  }
  async stateOf(alias,key){return(await this.response('state',{workspace:alias},key)).value;}
  async mutation(alias,key,operation,make){
    const input=await this.intent(alias+'-'+key,async()=>({workspace:alias,requestId:'merchant_'+hash(this.state.id+'/'+alias+'/'+key).slice(0,48),...await make()}));
    need(input.workspace===alias,'HIVE_REQUEST_SELECTION','Keep this exact original host request.');
    try{return await this.observed(key,()=>this.response(operation,input,key));}
    catch(error){if(error.details?.originalRequest){await this.full(alias,error.details.originalRequest,key+'-pending-original-request',{parse:true});await this.record('unknown-'+input.requestId+'-'+hash(canonical(err(error))),{input,error:err(error)});}throw error;}
  }
  async action(alias,key,action,data){return this.mutation(alias,key,'action',async()=>({action,data}));}
  async artifact(alias,selection,expected,key){
    const r=await this.call('artifact',{workspace:alias,selection,expectedSha256:expected.sha256,expectedBytes:expected.bytes});
    return{selection,descriptor:r,file:await this.full(alias,r,key)};
  }
  async app(name){return(await this.apps.applicationsState({historyLimit:100})).applications.find(x=>x.id===this.state.hosts[name].applicationId);}
  async configure(name){
    const host=this.state.hosts[name];
    const saved=await this.phase('application-'+name+'-save',async()=>{
      const review=await this.intent('application-'+name+'-review',()=>this.apps.applicationsReview({runtimeId:this.runtimeId,kind:'hive-routing-workbench',providerId:'hive-routing-workbench',
        settings:{configurationFile:host.configurationFile,port:host.port},label:'Hive original '+name+' receiving'}));
      const request=await this.intent('application-'+name+'-save',async()=>({requestId:randomUUID(),reviewId:review.id}));
      const result=await this.apps.applicationsSave(request);host.applicationId=result.applicationId;await this.save();await this.record('application-'+name+'-save',result);return{applicationId:result.applicationId,reviewId:review.id,requestId:request.requestId};
    });host.applicationId=saved.applicationId;await this.save();return saved;
  }
  async connected(name){for(let i=0;i<600;i++){const a=await this.app(name);need(a,'HIVE_APPLICATION','The saved original Applications entry is absent.');if(a.release&&a.connectionReady===true)return a;if(i===0||a.adoption?.active===false)await this.apps.applicationsConnect({applicationId:a.id});await delay(1000);}throw Object.assign(new Error('The original Applications connection remains pending; resume the same operation.'),{code:'HIVE_APPLICATION_PENDING'});}
  async start(name,stage){
    const host=this.state.hosts[name];await this.configure(name);await this.connected(name);let current=host.starts.find(r=>r.stage===stage&&!r.closed);
    if(!current){const a=await this.app(name);need(!a.current||a.current.active===false&&!['PENDING','QUEUED','INTERRUPTED','OBSERVATION_UNAVAILABLE'].includes(a.current.phase),'HIVE_APPLICATION_OWNED','Reconcile the original current Applications run before another start.',{current:a.current});
      const review=await this.apps.applicationsStartReview({applicationId:host.applicationId});current={stage,requestId:randomUUID(),reviewId:review.id,createdAt:now()};host.starts.push(current);await this.save();await this.record(name+'-'+current.requestId+'-start-review',review);}
    await this.observed(name+'-start',()=>this.apps.applicationsStart({applicationId:host.applicationId,requestId:current.requestId,reviewId:current.reviewId}));
    let recovered=false;
    for(let i=0;i<600;i++){const a=await this.app(name),run=a?.runs.find(r=>r.id===current.requestId);
      if(run?.active===true&&run.privateUrl){
        const status=await this.call('status',{workspace:name});if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.connection.launchId});
        const connected=await this.call('connect',{workspace:name}),c=connected.connection;
        need(c?.instanceId===this.reference.result.workspace.id&&c.directory===host.directory&&c.sourceManifestSha256===ORIGINAL_MANIFEST_SHA256,'HIVE_APPLICATION_IDENTITY','Applications must open the same original workspace with the maintained observer source.');
        need(!host.instanceId||host.instanceId===c.instanceId,'HIVE_APPLICATION_IDENTITY','The original workspace identity changed.');host.instanceId=c.instanceId;current.launchId=c.launchId;current.running=true;await this.save();
        if(connected.native)await this.full(name,connected.native,name+'-'+current.requestId+'-info',{parse:true});
        const browser=await this.call('browser',{workspace:name});need(browser.connection.launchId===c.launchId&&new URL(browser.url).origin===c.origin,'HIVE_APPLICATION_BROWSER','Open the exact current private listener.');
        await this.record(name+'-'+current.requestId+'-connected',connected);return{applicationId:host.applicationId,operationId:current.requestId,connection:c,url:browser.url};
      }
      if(run&&run.active===false&&!recovered&&this.options.resume&&['INTERRUPTED','FAILED','QUEUED'].includes(run.phase)){await this.apps.applicationsRecover({applicationId:host.applicationId,operationId:current.requestId});recovered=true;}
      else if(run?.active===false&&['FAILED','CANCELLED','SUCCEEDED'].includes(run.phase))throw Object.assign(new Error('The original Applications run ended before ready; retain and inspect this same run.'),{code:'HIVE_APPLICATION_ENDED',details:{run}});
      await delay(1000);
    }throw Object.assign(new Error('The same Applications start is still pending; resume it.'),{code:'HIVE_APPLICATION_PENDING'});
  }
  async stop(name){
    const host=this.state.hosts[name];if(!host?.applicationId)return;
    for(const run of host.starts.filter(x=>!x.closed)){
      await this.apps.applicationsStop({applicationId:host.applicationId,operationId:run.requestId});
      for(;;){const output=await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});
        if(output.active===false&&output.phase!=='OBSERVATION_UNAVAILABLE'){
          if(this.manager){const all=await this.call('status',{}),status=all.workspaces.find(row=>row.workspace===name);if(status?.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.connection.launchId});}
          run.closed=true;run.closedAt=now();await this.save();await this.record(name+'-'+run.requestId+'-stopped',output);break;}
        await delay(1000);}
    }
  }
  async originalArchive(alias,input,key){
    const d=this.state.hosts[alias].archives[input];
    const inspected=await this.response('archive_inspect',{workspace:alias,archiveInput:input,expectedSha256:d.sha256},key);
    need(inspected.value.verified===true&&inspected.value.sha256===d.sha256&&inspected.value.bytes===d.bytes&&inspected.value.manifest.workspaceId===this.reference.result.workspace.id,'HIVE_ARCHIVE_IDENTITY','Inspect the exact original complete ZIP.');
    const expected=this.reference.result.input.product_source.files,members=inspected.value.manifest.members.filter(x=>x.path.startsWith('source/'));
    need(members.length===64&&expected.every(f=>members.some(x=>x.path==='source/'+f.path&&x.bytes===f.bytes&&x.sha256===f.sha256)),'HIVE_ARCHIVE_SOURCE','The original reference ZIP must retain its own exact prior source, independently of the maintained observer.');
    return inspected;
  }
  async audit(alias,key){
    const state=await this.stateOf(alias,key+'-state');need(state.id===this.reference.result.workspace.id&&state.sourcePin===UPSTREAM,'HIVE_WORKSPACE_IDENTITY','The complete original workspace identity changed.');
    const verification=await this.action(alias,key+'-verify','workspace.verify',{});need(verification.value.verified===true&&verification.value.id===state.id,'HIVE_WORKSPACE_VERIFY','The complete original event chain and objects must verify.');
    const entities=[];for(const e of state.entities){const full=await this.response('entity',{workspace:alias,kind:e.kind,id:e.id},key+'-'+e.kind+'-'+e.id);need(same(full.value,e),'HIVE_ENTITY_IDENTITY','The retained exact original entity differs.');entities.push({kind:e.kind,id:e.id,revision:e.revision,fileId:full.retained.fileId,sha256:full.retained.sha256});}
    const files=[],programmes=[],editions=[];
    for(const e of state.entities.filter(x=>x.kind==='edition')){editions.push({id:e.id,files:e.data.files});for(const f of e.data.files)files.push(await this.artifact(alias,{kind:'edition',edition:e.id,path:f.path},f,key+'-edition-'+e.id+'-'+f.path));}
    for(const phase of ['initial','changed','rollback']){
      const selected=this.reference.result.phases[phase],p=originalEntity(state,'programme',selected.programme_id);
      need(p?.data.state==='complete'&&p.data.rows.length===20&&p.data.nativeAttempt===selected.native_attempt,'HIVE_NATIVE_PROGRAMME','Retain the same complete native attempt and twenty original operations.');
      const review=originalEntity(state,'programme-review',p.id);need(review?.data.accepted&&review.data.programmeRevision===p.revision&&review.data.nativeAttempt===p.data.nativeAttempt,'HIVE_NATIVE_REVIEW','The full actual native programme review is absent or stale.');
      const rows=[];for(const row of p.data.rows){const expected=selected.validation.responses.find(x=>x.id===row.id);need(expected&&row.response?.status===expected.status&&row.response.body.bytes===expected.body.bytes&&row.response.body.sha256===expected.body.sha256,'HIVE_NATIVE_RESPONSE','The complete original native response changed.');
        const artifact=await this.artifact(alias,{kind:'response',programme:p.id,operation:row.id},row.response.body,key+'-'+phase+'-'+row.id);files.push(artifact);
        const body=await json(join(this.directory,artifact.file.path));need(body&&typeof body==='object'&&!Array.isArray(body),'HIVE_GRAPHQL_BODY','Retain the full original GraphQL JSON response, including errors and extensions.');
        rows.push({id:row.id,body:row.response.body,status:row.response.status,graphqlKeys:Object.keys(body).sort(),file:artifact.file});}
      programmes.push({phase,id:p.id,nativeAttempt:p.data.nativeAttempt,revision:p.revision,rows});
    }
    const initial=programmes.find(x=>x.phase==='initial'),rollback=programmes.find(x=>x.phase==='rollback');
    for(const row of initial.rows){const after=rollback.rows.find(x=>x.id===row.id),left=await json(join(this.directory,row.file.path)),right=await json(join(this.directory,after.file.path));need(same(left.data,right.data)&&same(left.errors,right.errors),'HIVE_ROLLBACK_RESPONSE','Original full rollback data/errors must match the initial programme.');}
    for(const deployment of state.entities.filter(x=>x.kind==='deployment')){
      const observed=await this.action(alias,key+'-'+deployment.id+'-status','native.status',{deployment:deployment.id}),o=observed.value.observation;
      need(o&&!o.nativeAlive&&!o.supervisorAlive,'HIVE_NATIVE_OWNER','The completed original reference owns no live router. Join any surviving original owner before this receiving extension.');
      const logs=[...(deployment.data.attempts??[]),...(deployment.data.currentAttempt?[deployment.data.currentAttempt]:[])].filter(x=>x.log),seen=new Set();
      for(const attempt of logs){if(seen.has(attempt.log.sha256))continue;seen.add(attempt.log.sha256);files.push(await this.artifact(alias,{kind:'object',sha256:attempt.log.sha256,name:'native-'+attempt.id+'.log'},attempt.log,key+'-native-log-'+attempt.id));}
    }
    const active=originalEntity(state,'active-deployment','operator');need(active&&active.data.history?.length>=3&&active.data.programme===this.reference.result.phases.rollback.programme_id,'HIVE_ENDPOINT_HISTORY','Retain the original initial/change/rollback endpoint history; the selected router remains stopped.');
    const snapshot=await this.response('state',{workspace:alias},key+'-complete-state');const inspection=await this.call('inspect',{workspace:alias,fileId:snapshot.retained.fileId,expectedSha256:snapshot.retained.sha256,pointer:'/entities',offset:0,limit:25});await this.record(key+'-entity-browse',inspection);
    return{workspaceId:state.id,revision:state.revision,entities,editions,programmes,files,selectedEndpoint:active,retainedNativeResponses:programmes.reduce((n,p)=>n+p.rows.length,0)};
  }
  async reviewAndReplay(alias){
    const reviewed=await this.phase('primary-agent-review',async()=>{
      const state=await this.stateOf(alias,'agent-review-before'),p=originalEntity(state,'programme',this.reference.result.phases.rollback.programme_id),old=originalEntity(state,'programme-review',p.id);
      const response=await this.mutation(alias,'agent-programme-review','action',async()=>({action:'programme.review',data:{programme:p.id,decisions:old.data.decisions,note:old.data.note+'\nMerchant receiving: all60 complete original responses and current accepted rollback are retained; the original router remains stopped.',expected:old.revision}}));
      const entity=nativeEntity(response.value);need(entity?.kind==='programme-review'&&entity.id===p.id&&entity.data.accepted,'HIVE_AGENT_REVIEW','The actual saved agent review must retain acceptance of every original outcome.');
      return{requestId:response.retained.requestId,retained:response.retained,entity};
    });
    return reviewed;
  }
  async replayReview(alias,review,key){
    const request=await this.intent(alias+'-agent-programme-review',()=>{throw new Error('The original retained request is required.');});
    const before=await this.stateOf(alias,key+'-before'),response=await this.response('action',request,key+'-replay'),after=await this.stateOf(alias,key+'-after');
    need(response.retained.replayed===true&&response.retained.sha256===review.retained.sha256&&response.retained.bytes===review.retained.bytes&&same(nativeEntity(response.value),review.entity)&&after.revision===before.revision,
      'HIVE_REQUEST_REPLAY','Reopen the exact original response without repeating its saved effect or changing the current workspace.');
    const requests=[];for(let offset=0;;){const page=await this.call('requests',{workspace:alias,offset,limit:100});requests.push(...page.requests);if(page.nextOffset===null)break;offset=page.nextOffset;}
    need(requests.some(r=>r.requestId===review.requestId&&r.action==='programme.review'),'HIVE_REQUEST_CUSTODY','The original host review request is absent.');
    for(const r of requests)await this.full(alias,r.originalRequest,key+'-request-'+r.requestId,{parse:true});
    await this.record(key+'-requests',requests);return{requestId:review.requestId,originalResponseSha256:response.retained.sha256,currentRevision:after.revision,requests};
  }
  async browser(alias,key,{review=false}={}){
    return this.phase(key,async()=>{
      const audit=await this.phase(key+'-before-browser-audit',()=>this.audit(alias,key+'-audit')),route=await this.call('browser',{workspace:alias}),directory=join(this.directory,'browser',key);
      const archive=this.state.hosts[alias].archives.latest??this.state.hosts[alias].archives.reference;
      const selectedReview=review?{editionId:audit.editions[0].id,note:'Merchant browser receiving: complete original configuration opened, every existing feature decision preserved, all60 native responses and stopped-router state retained.'}:null;
      const owner=openHiveReceivingBrowser({directory,operationRoot:this.directory,origin:new URL(route.url).origin,workspaceId:audit.workspaceId,
        sourceManifestSha256:this.selection.merchantSourceManifestSha256,programmes:audit.programmes.map(p=>({phase:p.phase,id:p.id,rows:p.rows.map(r=>({id:r.id,body:r.body}))})),editions:audit.editions,
        archive:{path:archive.file,bytes:archive.bytes,sha256:archive.sha256},receivingDirectory:join(this.state.hosts[alias].outputDirectory,'browser-selected-receiving'),
        review:selectedReview,playwright:this.options.playwright,chromium:this.options.chromium,resume:this.options.resume===true});
      this.browserOwners.add(owner);let result;
      try{result=await owner.run();}finally{for(;;){try{await owner.close();this.browserOwners.delete(owner);break;}catch(e){process.stderr.write(JSON.stringify({operationId:this.state.id,state:'BROWSER_CLOSE_PENDING',error:err(e)})+'\n');await delay(1000);}}}
      need(result.schema==='stellar-forge.hive-routing-browser.v1'&&result.state==='complete'&&result.workspaceId===audit.workspaceId&&Array.isArray(result.files),'HIVE_BROWSER_RESULT','Retain the complete actual original browser result.');
      const resultPath=join(directory,'browser-result.json');need(same(await json(resultPath),result),'HIVE_BROWSER_RESULT','The complete browser result differs.');
      const files=[];for(const d of result.files){const path=resolve(directory,d.path);child(directory,path);await verify(path,d);files.push(await this.retain(path));}
      files.push(await this.retain(resultPath),await this.retain(join(directory,'browser-candidate.json')));
      return{result,files};
    });
  }
  async retainedFiles(alias,key){const files=[];for(let offset=0;;){const page=await this.call('files',{workspace:alias,offset,limit:100});files.push(...page.files);if(page.nextOffset===null)break;offset=page.nextOffset;}for(const f of files)await this.full(alias,f,key+'-'+f.fileId);await this.record(key+'-full-file-inventory',files);return files;}

  async latestArchive(){
    return this.phase('07-latest-reviewed-export',async()=>{
      await this.start('primary','latest-export');
      const before=await this.stateOf('primary','latest-export-state');
      const exported=await this.mutation('primary','latest-reviewed-export','archive_export',async()=>({})),value=exported.value;
      need(isAbsolute(value.path)&&value.workspace?.id===before.id&&value.workspace.revision===before.revision&&value.sourceFiles===64,'HIVE_LATEST_EXPORT','The complete latest ZIP must bind the actual current reviewed workspace.');
      const inspected=await this.response('archive_inspect',{workspace:'primary',exportRequestId:exported.retained.requestId,expectedSha256:value.sha256},'latest-export-inspection');
      need(inspected.value.verified&&inspected.value.bytes===value.bytes&&inspected.value.manifest.revision===before.revision,'HIVE_LATEST_EXPORT','The original complete archive inspection differs.');
      const selection=await json(join(HERE,'original-source.json')),members=inspected.value.manifest.members.filter(f=>f.path.startsWith('source/'));
      need(members.length===64&&selection.files.every(f=>members.some(m=>m.path==='source/'+f.path&&m.bytes===f.bytes&&m.sha256===f.sha256)),'HIVE_LATEST_SOURCE','The latest archive must contain the full maintained standalone application.');
      const archive=await this.artifact('primary',{kind:'archive',exportRequestId:exported.retained.requestId},value,'latest-export-archive'),copy=join(this.directory,'handoff','Hive_Latest_Reviewed_Workspace.zip');
      await copySelected(join(this.directory,archive.file.path),copy,archive.file);const file=await this.retain(copy);
      const after=await this.stateOf('primary','latest-export-after');need(after.revision===before.revision,'HIVE_EXPORT_STATE','Export must preserve current saved history.');
      await this.stop('primary');return{requestId:exported.retained.requestId,original:value,archive,file,inspection:inspected.value,revision:before.revision,state:before};
    });
  }
  async forward(latest){
    const configured=await this.phase('08-declared-latest-input',async()=>{
      this.state.hosts.receiving.archives.latest={file:join(this.directory,latest.file.path),bytes:latest.file.bytes,sha256:latest.file.sha256};
      await this.save();return{archive:this.state.hosts.receiving.archives.latest};
    });
    this.state.hosts.receiving.archives.latest=configured.archive;await this.setup('latest-input');
    const received=await this.phase('09-original-fresh-directory-receiving',async()=>{
      await this.start('receiving','forward-receive');
      const before=await this.stateOf('receiving','forward-before'),comparison=await this.response('archive_compare',{workspace:'receiving',archiveInput:'latest',expectedSha256:latest.file.sha256},'forward-history');
      need(comparison.value.relation==='incoming-forward'&&comparison.value.incoming===latest.revision,'HIVE_FORWARD_HISTORY','The latest reviewed archive must extend the original received history.');
      const result=await this.mutation('receiving','receive-latest-reviewed','archive_receive',async()=>({archiveInput:'latest',expectedSha256:latest.file.sha256})),v=result.value;
      need(isAbsolute(v.path)&&v.archive?.sha256===latest.file.sha256&&v.archive.bytes===latest.file.bytes&&v.workspace?.id===this.reference.result.workspace.id&&v.workspace.revision===latest.revision&&v.workspace.verified&&v.source===join(v.path,'source'),
        'HIVE_FORWARD_RECEIVE','The actual native receiver must publish the complete latest edition into its new named directory.');
      const manifest=await json(join(v.path,'manifest.json'));need(same(manifest,latest.inspection.manifest),'HIVE_FORWARD_MANIFEST','The complete extracted original manifest differs.');
      for(const f of manifest.members){relativeFile(f.path);await verify(join(v.path,f.path),f);}
      const source=await inspectOriginalSource({directory:v.source}),after=await this.stateOf('receiving','forward-original-after');
      need(after.revision===before.revision,'HIVE_FORWARD_ORIGINAL','The original receiver preserves its prior workspace while publishing a fresh installation.');
      await this.record('fresh-received-manifest',manifest);await this.stop('receiving');return{requestId:result.retained.requestId,result:v,source,comparison:comparison.value,priorWorkspaceRevision:after.revision};
    });
    const prepared={...this.preparation.receiving,applicationDirectory:received.result.source};
    await this.makeHost('latest',join(received.result.path,'workspace'),prepared,{latest:configured.archive});await this.setup('latest-received');
    return received;
  }
  async cold(alias,opening,latest,{review}={}){
    return this.phase(alias+'-cold-reopen',async()=>{
      const reopened=await this.start(alias,'cold-reopen');need(reopened.connection.instanceId===opening.connection.instanceId&&reopened.connection.launchId!==opening.connection.launchId,'HIVE_COLD_REOPEN','Cold reopening must retain the original workspace and establish a new actual listener.');
      const audit=await this.audit(alias,alias+'-cold');need(audit.revision===latest.revision,'HIVE_COLD_HISTORY','Cold reopening must retain the exact latest reviewed workspace.');
      if(review)await this.replayReview(alias,review,'cold-original-request-replay');
      if(alias==='latest'){const compared=await this.response('archive_compare',{workspace:alias,archiveInput:'latest',expectedSha256:latest.file.sha256},'latest-cold-identical');need(compared.value.relation==='identical','HIVE_COLD_ARCHIVE','The selected complete archive differs from the cold reopened workspace.');}
      await this.retainedFiles(alias,alias+'-cold-complete-files');await this.stop(alias);return{opening:reopened,audit};
    });
  }
  async close(){
    if(this.closingTask)return this.closingTask;
    this.closingTask=(async()=>{
      if(this.referenceEnded)await this.referenceEnded;
      for(const owner of [...this.browserOwners])for(;;){try{await owner.close();this.browserOwners.delete(owner);break;}catch(e){process.stderr.write(JSON.stringify({operationId:this.state?.id,state:'BROWSER_CLOSE_PENDING',error:err(e)})+'\n');await delay(1000);}}
      for(const name of Object.keys(this.state?.hosts??{}))while(this.state.hosts[name].starts.some(x=>!x.closed)){
        try{await this.stop(name);}catch(e){process.stderr.write(JSON.stringify({operationId:this.state.id,state:'APPLICATION_CLOSE_PENDING',name,error:err(e)})+'\n');this.state.errors.push({at:now(),name:'close-'+name,error:err(e)});try{await this.save();}catch{}await delay(1000);}
      }
      if(this.manager)for(;;){try{await this.manager.close();this.manager=null;break;}catch(e){process.stderr.write(JSON.stringify({operationId:this.state?.id,state:'MCP_CLOSE_PENDING',error:err(e)})+'\n');await delay(1000);}}
      await this.apps?.close();
    })();try{return await this.closingTask;}finally{this.closingTask=null;}
  }
  async completeExisting(){
    const candidate=join(this.directory,'candidate.json'),resultPath=join(this.directory,'MERCHANT_RESULT.json');
    if(!await exists(candidate)&&!await exists(resultPath)&&this.state.status!=='complete')return null;
    await this.close();const result=await json(await exists(candidate)?candidate:resultPath);
    need(result.schema===RESULT_SCHEMA&&result.status==='complete'&&result.merchantOperationId===this.state.id&&result.operationId===REFERENCE_OPERATION&&same(result.selection,this.selection)&&result.completedAt===this.state.completedAt,'HIVE_FINAL_CANDIDATE','Retain the exact original complete candidate before creating later setup observations.');
    for(const f of result.artifacts)await verify(join(this.directory,f.path),f);
    await verify(result.reference.path,result.reference.identity);
    if(await exists(resultPath))need(same(await json(resultPath),result),'HIVE_FINAL_CANDIDATE','The complete published result differs.');
    await save(candidate,result,{immutable:true});await save(resultPath,result,{immutable:true});this.state.status='complete';this.state.resultIdentity=await identity(resultPath);await this.save();return result;
  }
  async run(){
    const completed=await this.completeExisting();if(completed)return completed;
    this.state.status='running';this.state.attempts.push({id:randomUUID(),startedAt:now()});await this.save();
    const reference=await this.originalReference();await this.attach();const distribution=await this.distribution();
    await this.makeHost('primary',join(reference.root,'workspace'),this.preparation.primary);
    await this.makeHost('receiving',join(reference.result.receiving.complete.path,'workspace'),this.preparation.receiving);
    await this.setup('original');
    const primary=await this.phase('04-primary-installed-application',async()=>{
      const opening=await this.start('primary','original-open');
      const audit=await this.phase('primary-complete-original-custody',()=>this.audit('primary','primary-original'));
      await this.phase('primary-original-archive-source',()=>this.originalArchive('primary','reference','primary-reference-archive'));
      const review=await this.reviewAndReplay('primary');
      const browser=await this.browser('primary','05-primary-rendered-operator',{review:true});
      const replay=await this.phase('primary-historical-request-replay',()=>this.replayReview('primary',review,'primary-after-browser-review'));
      const retained=await this.retainedFiles('primary','primary-full-custody');await this.stop('primary');return{opening,audit,review,browser,replay,retained};
    });
    const previous=await this.phase('06-original-received-application',async()=>{
      const opening=await this.start('receiving','original-received');
      const audit=await this.audit('receiving','previous-received');need(audit.revision===reference.result.workspace.revision,'HIVE_PRIOR_RECEIVING','The original receiving edition must remain at its original selected revision.');
      const inspected=await this.originalArchive('receiving','reference','previous-reference-archive');
      const older=await this.response('archive_compare',{workspace:'receiving',archiveInput:'initial',expectedSha256:reference.archives.initial.retained.sha256},'previous-older-history');
      need(older.value.relation==='current-forward','HIVE_PRIOR_HISTORY','Retain the original complete earlier edition as older history.');
      await this.retainedFiles('receiving','previous-full-custody');await this.stop('receiving');return{opening,audit,inspected,older};
    });
    const latest=await this.latestArchive(),forward=await this.forward(latest);
    const receiving=await this.phase('10-latest-installed-receiving',async()=>{
      const opening=await this.start('latest','latest-open'),audit=await this.audit('latest','latest-received');
      need(audit.revision===latest.revision,'HIVE_LATEST_REVISION','The complete fresh installation differs from the exported reviewed edition.');
      const agentReview=originalEntity(latest.state,'programme-review',primary.review.entity.id),configuration=primary.browser.result.phases['01-review']?.entity;
      const current=await this.stateOf('latest','latest-reviews');
      need(same(originalEntity(current,'programme-review',agentReview.id),agentReview)&&(!configuration||same(originalEntity(current,'configuration-review',configuration.id),configuration)),
        'HIVE_LATEST_REVIEWS','Both actual Merchant and browser review decisions must reach the fresh receiving workspace.');
      const browser=await this.browser('latest','11-latest-rendered-operator');
      await this.retainedFiles('latest','latest-full-custody');await this.stop('latest');return{opening,audit,browser};
    });
    const coldPrimary=await this.cold('primary',primary.opening,latest,{review:primary.review}),coldReceiving=await this.cold('latest',receiving.opening,latest);
    await this.close();
    await verify(reference.path,reference.identity);
    for(const f of Object.values(this.state.files))await verify(join(this.directory,f.path),f);
    for(const h of Object.values(this.state.hosts))await inspectOriginalSource({directory:h.prepared.applicationDirectory});
    this.state.completedAt??=now();await this.save();
    const result={schema:RESULT_SCHEMA,status:'complete',operationId:REFERENCE_OPERATION,merchantOperationId:this.state.id,completedAt:this.state.completedAt,selection:this.selection,
      reference:{path:reference.path,identity:reference.identity,originalWorkspace:reference.result.workspace,selectedResponses:60,sourceSelection:reference.sourceSelection,archives:reference.archives},
      distribution,primary,previous,latest,forward,receiving,coldPrimary,coldReceiving,
      nativeState:'The completed original sixty-response router/fixture programme remains closed. Applications Stop closes only its owned observer. Explicit native.start remains available for a separately selected original next attempt.',
      artifacts:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path)),
      renderedInspection:'The producing peer must open and look at the actual screenshots, use the exact outgoing desktop/narrow controls, inspect all downloads/archives and reopened exports, and repair concrete defects before customer presentation.'};
    await save(join(this.directory,'candidate.json'),result,{immutable:true});await save(join(this.directory,'MERCHANT_RESULT.json'),result,{immutable:true});
    this.state.resultIdentity=await identity(join(this.directory,'MERCHANT_RESULT.json'));this.state.status='complete';await this.save();return result;
  }
}
const HELP='Hive Routing Workbench receiving\n\n'+
'Use one existing original reference operation and one installed Merchant runtime.\n'+
'starforge hive-routing-workbench-receive --directory /private/hive-merchant-receiving --merchant-workspace /private/runtime-workspace --merchant-runtime /private/installed-merchant --preparation-result /private/hive-preparation/PREPARED.json --python /absolute/selected/python --reference-result /private/original-hive/result.json --playwright /absolute/playwright/index.js --chromium /absolute/chromium [--resume]\n'+
'For the same original unstarted native request, replace --reference-result with --reference-request /private/original-reference-request.json. Its source/upstream/fixtureReady/router/root/initialPort/changedPort/subgraphPort/python fields retain the existing original build and reference.lock. This command never builds a replacement fixture.\n';
export async function main(argv=process.argv.slice(2),{stdout=process.stdout}={}){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){stdout.write(HELP);return{help:true};}
  const options=parse(argv);
  await mkdir(options.directory,{recursive:true,mode:0o700});await privateDirectory(options.directory);const lease=await acquireLease(join(options.directory,'receiving.lock'));let course;
  try{
    const installed=await inspectMerchantRuntime(options['merchant-runtime'],{load:false});
    need(resolve(installed.sourceRoot)===SOURCE_ROOT,'HIVE_INSTALLED_SOURCE','Run this receiving command from the actual selected complete installed Merchant source.');
    const prepared=await inspectHivePreparation({resultPath:options['preparation-result'],python:options.python});
    need(prepared.schema==='stellar-forge.hive-routing-preparation.v1'&&prepared.state==='READY'&&prepared.source?.manifestSha256===ORIGINAL_MANIFEST_SHA256&&prepared.source.files===64,
      'HIVE_PREPARATION','Use the complete inspected two-installation Hive preparation.');
    need(prepared.resultPath===options['preparation-result']&&same(await json(options['preparation-result']),prepared)&&await realpath(options.python)===prepared.request.inputs.python.path,'HIVE_PREPARATION_REQUEST','Keep the complete actual prepared record and original selected Python.');
    await inspectOriginalSource();for(const h of [prepared.primary,prepared.receiving]){need(isAbsolute(h.applicationDirectory)&&isAbsolute(h.python)&&isAbsolute(h.runtimeReadyFile),'HIVE_PREPARATION','Retain the actual returned installation paths.');await inspectOriginalSource({directory:h.applicationDirectory});}
    const selectedInput=options['reference-result']??options['reference-request'],selection={directory:options.directory,merchantWorkspace:options['merchant-workspace'],merchantRuntime:options['merchant-runtime'],
      merchantSourceManifestSha256:installed.sourceManifestSha256,originalSourceManifestSha256:ORIGINAL_MANIFEST_SHA256,preparationResult:await identity(options['preparation-result']),
      referenceMode:options['reference-result']?'result':'request',referencePath:selectedInput,referenceInput:await identity(selectedInput),python:options.python,node:process.execPath,nodeVersion:process.version,
      playwright:options.playwright,chromium:options.chromium,playwrightFile:await identity(options.playwright),chromiumFile:await identity(options.chromium)};
    course=new Course(options,selection,prepared,lease);await course.open();
    try{const result=await course.run();stdout.write(JSON.stringify({schema:RESULT_SCHEMA,status:result.status,operationId:result.operationId,merchantOperationId:result.merchantOperationId,result:join(options.directory,'MERCHANT_RESULT.json')})+'\n');return result;}
    catch(error){if(course.state){course.state.status='interrupted';course.state.errors.push({at:now(),phase:course.state.currentPhase,error:err(error)});try{await course.save();}catch{}}throw error;}
  }finally{if(course)await course.close();await lease.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(JSON.stringify({error:err(error)})+'\n');process.exitCode=1;});
