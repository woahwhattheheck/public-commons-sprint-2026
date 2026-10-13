// SPDX-License-Identifier: MIT
// Continue the original complete native course through the maintained Merchant surfaces.
import {readFile,writeFile,mkdir,open,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {prepareReplicationWorkbench} from './prepare.mjs';
import {acquireWorkspaceLease,privateDirectory} from './workbench/vendor/stellar-expert/store.mjs';
import {inspectOriginalSource,WORKBENCH_ROOT,ORIGINAL_MANIFEST_SHA256} from './managed.mjs';
import {REPLICATION_HOST_SCHEMA} from './mcp.mjs';
import merchantProvider from './merchant-provider.mjs';
import {initializeReplicationWorkbenchMerchant} from './setup.mjs';
import {readMerchantConfig} from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import {LAUNCH_SCHEMA,writeJson as publishJson,readJson as privateJson} from './connection.mjs';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(HERE,'../..');
const SCHEMA='stellar-forge.replication-workbench-receiving.v1';
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
  const merchant={},original=[];for(let i=0;i<argv.length;i++){
    const k=argv[i];if(k.startsWith('--merchant-')){
      need(['--merchant-workspace','--merchant-runtime'].includes(k),'MERCHANT_RECEIVING_OPTION','Use the declared Merchant installation selections.');
      need(argv[i+1]&&!argv[i+1].startsWith('--'),'MERCHANT_RECEIVING_OPTION','Supply the complete original path.');
      merchant[k.slice(11)]=resolve(argv[++i]);
    }else if(k==='--preparation-result'){
      need(!merchant.preparationResult&&argv[i+1]&&isAbsolute(argv[i+1]),'MERCHANT_PREPARATION','Select one absolute completed --preparation-result.');
      merchant.preparationResult=resolve(argv[++i]);
    }else original.push(k);
  }
  const option={};for(let i=0;i<original.length;i++){const k=original[i];if(k==='--resume')option.resume=true;else if(k.startsWith('--'))option[k.slice(2)]=original[++i];}
  for(const k of ['workspace','runtime'])need(merchant[k],'MERCHANT_RECEIVING_OPTION','Select --merchant-'+k+' from the original ready Installation.');
  for(const k of ['directory','source','source-manifest','runtime-ready','python','playwright','chromium'])need(option[k],'MERCHANT_RECEIVING_OPTION','Retain the original --'+k+' selection.');
  need(merchant.preparationResult,'MERCHANT_PREPARATION','Select the completed original --preparation-result.');
  need(isAbsolute(option.python),'MERCHANT_PREPARATION','Retain the exact absolute Python selected by the original preparation.');
  return{merchant,original,option};
}
class Course{
  constructor(root,options,selection,original,lease){this.root=root;this.options=options;this.selection=selection;this.original=original;this.lease=lease;this.directory=join(root,'merchant-receiving');this.path=join(this.directory,'operation.json');this.manager=null;this.apps=null;this.closing=false;}
  async open(){
    await mkdir(this.directory,{mode:0o700,recursive:true});
    if(await exists(this.path)){this.state=await json(this.path);need(this.state.schema===SCHEMA&&same(this.state.selection,this.selection),'MERCHANT_RECEIVING_SELECTION','Preserve the original integration source, operation and installation.');need(this.options.option.resume||this.state.status==='complete','RESUME_REQUIRED','Continue this original operation with --resume.');}
    else{this.state={schema:SCHEMA,id:'merchant_receiving_'+randomUUID(),originalOperationId:this.original.operationId,selection:this.selection,status:'prepared',createdAt:now(),phases:{},hosts:{},files:{},errors:[],attempts:[]};await this.save();}
    this.apps=await openRuntimeWorkspace({directory:this.options.merchant.workspace});
    return this;
  }
  async save(){this.lease.assert();await save(this.path,this.state);}
  async retain(path){const full=resolve(this.root,path),name=child(this.root,full),d={path:name,...await identity(full)};this.state.files[name]=d;await this.save();return d;}
  async record(name,value){const path=join(this.directory,'records',name+'.json');await save(path,value,{immutable:true});await this.retain(path);return value;}
  async phase(name,work){
    const old=this.state.phases[name];if(old?.status==='complete')return old.result;
    if(!old)this.state.phases[name]={status:'running',startedAt:now()};else old.status='running';
    this.state.currentPhase=name;await this.save();
    process.stdout.write(JSON.stringify({operationId:this.state.originalOperationId,merchantOperationId:this.state.id,phase:name,status:'running'})+'\n');
    const result=await work();this.state.phases[name]={...this.state.phases[name],status:'complete',completedAt:now(),result};await this.save();return result;
  }
  async intent(name,make){
    const path=join(this.directory,'intents',name+'.json');
    if(await exists(path)){const value=await json(path);await this.retain(path);return value;}
    const value=await make();await save(path,value,{immutable:true});await this.retain(path);return value;
  }
  async observed(name,work){
    try{return await work();}catch(error){this.state.errors.push({at:now(),phase:this.state.currentPhase,name,error:err(error)});await this.save();throw error;}
  }
  async prepare(){
    const attached=await this.phase('01-attach-original-installation',()=>this.apps.attach({directory:this.options.merchant.runtime,label:'Replication Workbench original complete installation'}));
    need(typeof attached.runtimeId==='string'&&attached.status==='READY','MERCHANT_RUNTIME','Select the original inspected READY installation.');
    this.runtimeId=attached.runtimeId;
    const originalState=await json(join(this.root,'operation.json'));
    const input=join(this.root,'intake','reference','DERIVATION.json'),inputId=await identity(input);
    const auth=await json(join(this.root,'installation-auth.json')),operator=auth.actors.find(x=>x.roles.includes('operator'));
    need(operator,'MERCHANT_ACTOR','Use the original native receiving actor.');
    const workspaces={};
    for(const name of ['primary','receiving']){
      const directory=join(this.root,'workspaces',name);await privateDirectory(directory);
      const connectionFile=join(this.directory,name+'-connection.json'),configurationFile=join(this.directory,name+'-launch.json');
      const prepared=this.options.preparation[name];
      const value={schema:LAUNCH_SCHEMA,directory,applicationDirectory:prepared.applicationDirectory,authFile:join(this.root,'installation-auth.json'),actorId:operator.id,
        runtimeReadyFile:prepared.runtimeReadyFile,connectionFile,python:resolve(this.options.option.python),consumerRoot:null};
      await save(configurationFile,value,{immutable:true});await this.retain(configurationFile);
      workspaces[name]={label:'Original '+name+' acceptance workspace',directory,connectionFile,actorId:operator.id,
        inputs:{reference:{file:input,sha256:inputId.sha256,bytes:inputId.bytes,filename:'DERIVATION.json',mediaType:'application/json',label:'Original complete Sling reference derivation'}}};
      need(Number.isSafeInteger(originalState.ports[name])&&originalState.ports[name]>0,'MERCHANT_ORIGIN','Retain the original listener port and browser origin.');
      this.state.hosts[name]??={name,directory,configurationFile,connectionFile,port:originalState.ports[name],starts:[]};await this.save();
    }
    this.hostConfig=join(this.directory,'merchant-host.json');await save(this.hostConfig,{schema:REPLICATION_HOST_SCHEMA,workspaces},{immutable:true});await this.retain(this.hostConfig);
    const setup=await initializeReplicationWorkbenchMerchant({directory:join(this.directory,'agent-host'),connection:this.hostConfig,name:'Original Replication Workbench receiving'});
    await this.record('merchant-host-setup-'+hash(canonical(setup)),setup);
    const merchantConfig=await readMerchantConfig(setup.configuration);
    this.exports=merchantConfig.exportsDirectory;
    this.manager=await merchantProvider.create(await merchantProvider.load(),merchantConfig);
    const tools=merchantProvider.tools((name,description,properties,required)=>({name,properties,required}));
    need(tools.length===22&&new Set(tools.map(t=>t.name)).size===22,'MERCHANT_TOOL_CATALOG','Use the complete actual provider catalog.');
    await this.record('merchant-tool-catalog',tools);
    return{runtimeId:this.runtimeId,operatorId:operator.id,input:{path:child(this.root,input),...inputId}};
  }

  async distribution(){
    return this.phase('02-complete-merchant-distribution',async()=>{
      const selected=await this.intent('merchant-distribution-selection',async()=>{
        const planPath=join(this.options.merchant.runtime,'runtime-install.json'),plan=await json(planPath);
        const manifestPath=join(this.options.merchant.runtime,'package','manifest.json'),manifest=await identity(manifestPath);
        need(manifest.sha256===this.selection.sourceManifestSha256&&plan.source?.manifestSha256===manifest.sha256,'MERCHANT_PACKAGE_SELECTION','Retain the exact selected installed source manifest.');
        need(typeof plan.archivePath==='string'&&isAbsolute(plan.archivePath)&&/^[a-f0-9]{64}$/.test(plan.archiveSha256),'MERCHANT_PACKAGE_SELECTION','Retain the original complete selected distribution archive.');
        const archive=await identity(plan.archivePath);need(archive.sha256===plan.archiveSha256,'MERCHANT_PACKAGE_SELECTION','The installed distribution archive identity differs.');
        return{manifestPath,manifest,archivePath:plan.archivePath,archive,planPath,planIdentity:await identity(planPath),handoff:await this.apps.handoff(this.runtimeId)};
      });
      const archivePath=join(this.directory,'distribution','merchant-distribution.tar.gz'),manifestPath=join(this.directory,'distribution','source-manifest.json'),planPath=join(this.directory,'distribution','runtime-install.json');
      await copySelected(selected.archivePath,archivePath,selected.archive);
      await copySelected(selected.manifestPath,manifestPath,selected.manifest);
      await copySelected(selected.planPath,planPath,selected.planIdentity);
      const handoff=await this.record('original-merchant-installation-handoff',selected.handoff);
      return{archive:await this.retain(archivePath),sourceManifest:await this.retain(manifestPath),installation:await this.retain(planPath),handoff,
        distinction:'The complete Merchant distribution retains Applications/MCP/receiving adapters. Project NDJSON retains the unchanged standalone workbench, its complete state and native runtime handoff.'};
    });
  }
  async runtimeCustody(){
    return this.phase('03-complete-original-native-runtime',async()=>{
      const prepared=this.options.preparation,request=await json(prepared.request.path);
      need(request.python===resolve(this.options.option.python),'MERCHANT_NATIVE_RUNTIME','Keep the original explicitly selected Python executable.');
      const directory=join(this.directory,'preparation'),portable=join(directory,'replication-workbench-complete.tar.gz');
      await copySelected(prepared.portable.path,portable,prepared.portable);
      const preparedPath=join(directory,'PREPARED.json'),requestPath=join(directory,'REQUEST.json');
      await copySelected(this.options.merchant.preparationResult,preparedPath,this.selection.preparationResult);
      await copySelected(prepared.request.path,requestPath,prepared.request);
      const installations={};
      for(const name of ['primary','receiving']){
        const bound=prepared[name],ready=bound.runtime;
        need(ready.schema==='tjlabs.sling-runtime-ready.v1'&&ready.state==='ready'&&ready.version==='1.6.5'&&ready.sourceCommit==='7641892e24a7023c8012069596698970c7b3e041',
          'MERCHANT_NATIVE_RUNTIME','Retain the actual complete original Sling runtime selection.');
        need(ready.archive.bytes===121317497&&ready.archive.sha256==='e4e386c7d4429b33a213c146594be0bf6efa38f4732035dd67e307616fcb9c66',
          'MERCHANT_NATIVE_RUNTIME','Preserve the exact original release archive.');
        await verify(bound.runtimeReadyFile,bound.ready);await verify(ready.executable.path,ready.executable);
        const snapshot=join(directory,name+'-runtime-ready.json');await copySelected(bound.runtimeReadyFile,snapshot,bound.ready);
        installations[name]={applicationDirectory:bound.applicationDirectory,runtimeDirectory:bound.runtimeDirectory,
          ready:await this.retain(snapshot),version:ready.version,sourceCommit:ready.sourceCommit,
          archive:{bytes:ready.archive.bytes,sha256:ready.archive.sha256},executable:{bytes:ready.executable.bytes,sha256:ready.executable.sha256}};
      }
      return{portable:await this.retain(portable),preparation:await this.retain(preparedPath),request:await this.retain(requestPath),installations,
        receiving:'The complete preparation transfer rebuilds two independent exact original applications/runtimes. Managed receiving remains on the original imported workspace; native jobs remain suspended until an explicit original resume decision.'};
    });
  }
  async browser(alias,projectId,key){
    return this.phase(key,async()=>{
      const view=await this.view(alias,projectId,key+'-view'),route=await this.call('browser',{workspace:alias});
      const auth=await json(join(this.root,'installation-auth.json'));
      const operator=auth.actors.find(a=>a.id===this.selection.actorId),viewer=auth.actors.find(a=>a.roles.includes('viewer'));
      need(operator&&viewer&&viewer.id!==operator.id,'MERCHANT_BROWSER_ACTORS','Retain the original private operator and read-only reviewer.');
      const browserRoot=join(this.directory,'rendered-'+alias),directory=join(browserRoot,'browser','receiving');
      const {runBrowserJourney}=await import(pathToFileURL(join(this.options.preparation[alias].applicationDirectory,'receiving/browser.mjs')).href);
      const result=await runBrowserJourney({directory,origin:new URL(route.url).origin,operator,viewer,projectId,phase:'receiving',
        sourceIds:view.sources.map(x=>x.id),planIds:view.plans.map(x=>x.id),jobIds:view.jobs.map(x=>x.id),
        comparisonIds:view.comparisons.map(x=>x.id),handoffIds:this.original.namedPackages.map(x=>x.id),
        expectedRows:1002,sourceManifestSha256:this.selection.originalSourceManifestSha256,
        playwright:resolve(this.options.option.playwright),chromium:resolve(this.options.option.chromium),resume:this.options.option.resume===true});
      need(result.status==='complete'&&result.phase==='receiving'&&result.projectId===projectId&&Array.isArray(result.files),
        'MERCHANT_BROWSER_RESULT','Retain the complete original read-only browser course.');
      const resultPath=resolve(browserRoot,result.resultPath);
      child(directory,resultPath);need(same(await json(resultPath),result),'MERCHANT_BROWSER_RESULT','The complete published browser result differs.');
      const files=[];for(const item of result.files){
        const path=resolve(browserRoot,item.path);child(directory,path);await verify(path,item);files.push(await this.retain(path));
      }
      const resultFile=await this.retain(resultPath);
      return{result,resultFile,files,renderedInspection:'Producing peer must open and view these actual screenshots and retained downloads before customer-facing readiness; automated capture alone does not establish visual acceptance.'};
    });
  }
  async useHostConfiguration(path,edition){
    if(this.manager){await this.manager.close();this.manager=null;}
    const setup=await initializeReplicationWorkbenchMerchant({directory:join(this.directory,'agent-host-'+edition),connection:path,name:'Original Replication Workbench '+edition});
    await this.record('merchant-host-'+edition+'-'+hash(canonical(setup)),setup);
    const configuration=await readMerchantConfig(setup.configuration);this.exports=configuration.exportsDirectory;
    this.manager=await merchantProvider.create(await merchantProvider.load(),configuration);
  }
  async forwardEdition(projects,results){
    const project=projects[0];
    const h4=await this.phase('primary-h4-latest-edition',async()=>{
      await this.start('primary','latest-h4');
      const prepared=await this.mutation('primary','latest-h4',project.id,'handoff.prepare',{title:'H4 — complete Merchant-operated edition',notes:'Includes the original complete native programme and the source/review accepted through Merchant. Original H1–H3 remain retained.'});
      const id=prepared.value.result.handoffId,view=await this.view('primary',project.id,'primary-h4-current');
      const descriptor=view.handoffCustody?.[id];
      need(descriptor&&descriptor.sha256&&descriptor.bytes,'MERCHANT_H4_CUSTODY','Retain the complete sealed H4 from the actual native action.');
      const archive=await this.artifact('primary',project.id,'handoff',id,descriptor,'primary-H4-'+id);
      const native=await this.consumers('primary',project.id,'primary-h4-consumer',project.tables,project.rows);
      need(same(native.selection,results.primary.projects.replication.consumer.selection),'MERCHANT_H4_CONSUMER','H4 must preserve the original accepted typed consumer.');
      await this.stop('primary');
      return{handoffId:id,revision:view.revision,archive,consumer:native};
    });
    const configuration=await this.phase('h4-private-input-configuration',async()=>{
      const original=await json(this.hostConfig),value=JSON.parse(JSON.stringify(original)),descriptor=h4.archive.file;
      value.workspaces.receiving.inputs.h4={file:join(this.root,descriptor.path),sha256:descriptor.sha256,bytes:descriptor.bytes,
        filename:'H4-Merchant-Application.ndjson',mediaType:'application/x-ndjson',label:'Complete original H4 Merchant-operated edition'};
      const path=join(this.directory,'merchant-host-h4.json');await save(path,value,{immutable:true});await this.retain(path);
      return{path};
    });
    // Recreate the normal provider against a distinct immutable input edition.
    // No existing host configuration or connection file is replaced.
    await this.useHostConfiguration(configuration.path,'h4');
    const receiving=await this.phase('receiving-h4-forward-edition',async()=>{
      await this.start('receiving','h4-forward');
      const descriptor=h4.archive.file,uploadId='merchant_'+hash(this.state.id+'/receiving/H4').slice(0,48);
      const upload=await this.response('upload_input',{workspace:'receiving',uploadId,sourceInput:'h4',expectedSourceSha256:descriptor.sha256},'receiving-H4-upload');
      need(upload.value.complete&&upload.value.sha256===descriptor.sha256&&upload.value.bytes===descriptor.bytes,'MERCHANT_H4_UPLOAD','Receive the complete exact named H4.');
      const imported=await this.mutation('receiving','h4-forward',project.id,'handoff.receive',{uploadId});
      const view=await this.view('receiving',project.id,'receiving-H4-current');
      need(view.id===project.id&&view.handoffCustody?.[h4.handoffId]?.sha256===descriptor.sha256,'MERCHANT_H4_RECEIVE','Forward receiving must retain H4 in the same original project.');
      const expected=results.primary.mutation;
      need(view.sources.some(x=>x.id===expected.sourceId)&&view.reviews.some(x=>x.subjectId===expected.sourceId&&x.decision==='received'),'MERCHANT_H4_EDITION','The actual Merchant source and review must reach the receiving workspace.');
      const audit=await this.audit('receiving',project.id,'receiving-h4-audit',{historyRevision:project.revision});
      const consumer=await this.consumers('receiving',project.id,'receiving-h4-consumer',project.tables,project.rows);
      need(same(consumer.selection,h4.consumer.selection),'MERCHANT_H4_CONSUMER','Forward receiving must preserve the original selected complete typed result.');
      await this.stop('receiving');return{result:imported.value.result,audit,consumer};
    });
    const cold={};
    for(const name of ['primary','receiving'])cold[name]=await this.phase(name+'-h4-cold-edition',async()=>{
      const opening=await this.start(name,'h4-cold'),rows=[];
      for(const selected of projects){
        const audit=await this.audit(name,selected.id,name+'-h4-cold-'+selected.key,{historyRevision:selected.revision});
        const native=await this.consumers(name,selected.id,name+'-h4-cold-'+selected.key+'-consumer',selected.tables,selected.rows);
        need(same(native.selection,results[name].projects[selected.key].consumer.selection),'MERCHANT_H4_COLD_CONSUMER','The retained complete native selection changed across H4 cold reopen.');
        rows.push({audit,consumer:native});
      }
      const view=await this.view(name,project.id,name+'-h4-cold-current'),expected=results.primary.mutation;
      need(view.handoffCustody?.[h4.handoffId]?.sha256===h4.archive.file.sha256&&view.sources.some(x=>x.id===expected.sourceId)&&view.reviews.some(x=>x.subjectId===expected.sourceId&&x.decision==='received'),'MERCHANT_H4_COLD_EDITION','Cold reopen must retain the actual H4, source and review.');
      const rendered=await this.browser(name,project.id,name+'-latest-rendered-receiving');
      await this.stop(name);return{opening,projects:rows,rendered};
    });
    return{h4,configuration,receiving,cold};
  }

  async app(name){return(await this.apps.applicationsState({historyLimit:100})).applications.find(x=>x.id===this.state.hosts[name].applicationId);}
  async configure(name){
    const host=this.state.hosts[name];
    return this.phase('application-'+name+'-save',async()=>{
      const reviewed=await this.intent('application-'+name+'-review',()=>this.apps.applicationsReview({
        runtimeId:this.runtimeId,kind:'replication-workbench',providerId:'replication-workbench',
        settings:{configurationFile:host.configurationFile,port:host.port},label:'Replication Workbench '+name+' existing native course'}));
      const request=await this.intent('application-'+name+'-save',async()=>({requestId:randomUUID(),reviewId:reviewed.id}));
      const response=await this.apps.applicationsSave(request);host.applicationId=response.applicationId;await this.save();
      await this.record('application-'+name+'-save-'+hash(canonical(response)),response);
      return{applicationId:response.applicationId,reviewId:reviewed.id,requestId:request.requestId};
    }).then(async saved=>{host.applicationId=saved.applicationId;await this.save();return saved;});
  }
  async connected(name){
    for(let i=0;i<600;i++){
      const a=await this.app(name);need(a,'MERCHANT_APPLICATION','The original saved application is absent.');
      if(a.release)return a;
      if(i===0||a.adoption?.active===false)await this.observed(name+'-connect',()=>this.apps.applicationsConnect({applicationId:a.id}));
      await delay(1000);
    }throw Object.assign(new Error('The original Applications connection is still pending; resume it.'),{code:'MERCHANT_CONNECTION_PENDING'});
  }
  async start(name,stage){
    const host=this.state.hosts[name];await this.configure(name);await this.connected(name);
    let current=host.starts.find(x=>x.stage===stage&&!x.closed);
    if(!current){
      const prior=await this.app(name);
      need(!prior.current||prior.current.active===false&&!['PENDING','QUEUED','INTERRUPTED','OBSERVATION_UNAVAILABLE'].includes(prior.current.phase),'MERCHANT_APPLICATION_OWNED','Reconcile the original Applications owner before another launch.',{applicationId:host.applicationId,current:prior.current});
      const review=await this.apps.applicationsStartReview({applicationId:host.applicationId});
      current={stage,requestId:randomUUID(),reviewId:review.id,applicationId:host.applicationId,createdAt:now()};host.starts.push(current);await this.save();
      await this.record(name+'-'+current.requestId+'-start-review',review);
    }
    // The exact Start request is durable before the maintained dispatcher.
    await this.observed(name+'-start',()=>this.apps.applicationsStart({applicationId:host.applicationId,requestId:current.requestId,reviewId:current.reviewId}));
    let recovered=false;
    for(let i=0;i<600;i++){
      const a=await this.app(name),run=a?.runs.find(x=>x.id===current.requestId);
      if(run?.active===true&&run.privateUrl){
        const status=await this.call('status',{workspace:name});
        if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});
        const connection=await this.call('connect',{workspace:name});
        need(connection.instanceId&&connection.actor.id===this.selection.actorId,'MERCHANT_IDENTITY','The managed application selected another actor.');
        const old=host.instanceId;need(!old||old===connection.instanceId,'MERCHANT_IDENTITY','The original workspace identity changed.');
        host.instanceId=connection.instanceId;current.launchId=connection.launchId;current.running=true;await this.save();
        await this.record(name+'-'+current.requestId+'-connected-'+hash(canonical(connection)),connection);
        const browser=await this.call('browser',{workspace:name});need(browser.launchId===connection.launchId,'MERCHANT_BROWSER','The private browser route selected another launch.');
        return{name,stage,connection,applicationId:host.applicationId,operationId:current.requestId};
      }
      if(run&&run.active===false&&!recovered&&this.options.option.resume&&['INTERRUPTED','FAILED','QUEUED'].includes(run.phase)){
        await this.observed(name+'-recover',()=>this.apps.applicationsRecover({applicationId:host.applicationId,operationId:current.requestId}));recovered=true;
      }else if(run?.active===false&&['FAILED','CANCELLED','SUCCEEDED'].includes(run.phase)){
        throw Object.assign(new Error('The original managed launch ended before its ready connection; reconcile this saved run.'),{code:'MERCHANT_APPLICATION_ENDED',details:{run}});
      }
      await delay(1000);
    }throw Object.assign(new Error('The original managed launch is still pending; resume this same run.'),{code:'MERCHANT_APPLICATION_PENDING'});
  }
  call(name,args={}){return this.manager.call('merchant_replication_'+name,args);}
  async full(alias,descriptor,key,{parse=false}={}){
    need(descriptor.fileId&&/^[a-f0-9]{64}$/.test(descriptor.sha256)&&Number.isSafeInteger(descriptor.bytes),'MERCHANT_COMPLETE_RESPONSE','Read the complete retained response; an unretained acknowledgement must be replayed.');
    const h=createHash('sha256');let offset=0,readId=null,chunks=0;
    try{do{
      const result=await this.call('file',{workspace:alias,fileId:descriptor.fileId,expectedSha256:descriptor.sha256,...(readId?{readId}:{}),offset,limit:196608});
      need(result.encoding==='base64'&&result.offset===offset&&result.file.sha256===descriptor.sha256&&result.file.bytes===descriptor.bytes,'MERCHANT_FILE_SELECTION','Read the exact complete immutable file.');
      const bytes=Buffer.from(result.data,'base64');need(bytes.toString('base64')===result.data&&bytes.length===result.bytesRead,'MERCHANT_FILE_BYTES','The original file chunk differs.');
      need(bytes.length>0||descriptor.bytes===0,'MERCHANT_FILE_PROGRESS','The original complete file stopped before EOF.');
      h.update(bytes);offset+=bytes.length;chunks++;readId=result.readId;
      need(result.nextOffset===null?offset===descriptor.bytes:result.nextOffset===offset&&offset<descriptor.bytes,'MERCHANT_FILE_OFFSET','Follow the original complete file offsets.');
      if(result.nextOffset===null){readId=null;break;}
    }while(true);}finally{if(readId)await this.call('file_release',{workspace:alias,readId});}
    need(offset===descriptor.bytes&&h.digest('hex')===descriptor.sha256,'MERCHANT_FILE_IDENTITY','The complete customer-agent file differs from its declared identity.');
    const path=join(this.exports,'replication-workbench',alias,descriptor.sha256+'.content');
    await verify(path,descriptor);const file=await this.retain(path);
    await this.record('full-'+hash(key+'\0'+descriptor.sha256),{key,workspace:alias,fileId:descriptor.fileId,sha256:descriptor.sha256,bytes:offset,chunks,file});
    return parse?json(path):file;
  }
  async response(name,args,key){const r=await this.call(name,args);return{retained:r,value:await this.full(args.workspace,r,key,{parse:true})};}
  async view(alias,projectId,key,revision){return(await this.response('project',{workspace:alias,projectId,...(revision===undefined?{}:{revision})},key)).value.view;}
  async mutation(alias,key,projectId,action,payload){
    const input=await this.intent(alias+'-'+key,async()=>({workspace:alias,projectId,requestId:'merchant_'+hash(this.state.id+'/'+alias+'/'+key).slice(0,48),
      expectedRevision:(await this.view(alias,projectId,key+'-before')).revision,action,payload}));
    need(input.workspace===alias&&input.projectId===projectId&&input.action===action&&same(input.payload,payload),'MERCHANT_MUTATION_SELECTION','Retain the exact original mutation intent.');
    return this.observed(key,()=>this.response('action',input,key));
  }
  async artifact(alias,projectId,kind,id,d,key,path,revision){
    const selection={projectId,kind,id,...(path===undefined?{}:{path}),...(revision===undefined?{}:{revision})};
    const response=await this.call('artifact',{workspace:alias,selection,expectedSha256:d.sha256,expectedBytes:d.bytes,
      ...(d.filename?{filename:d.filename}:{}),...(d.mediaType?{mediaType:d.mediaType}:{})});
    const file=await this.full(alias,response,key);return{selection,original:{bytes:d.bytes,sha256:d.sha256},file,fileId:response.fileId};
  }
  async audit(alias,projectId,key,{historyRevision}={}){
    const view=await this.view(alias,projectId,key+'-view'),files=[];
    for(const s of view.sources)files.push(await this.artifact(alias,projectId,'source',s.id,s,key+'-source-'+s.id));
    for(const p of view.plans){
      files.push(await this.artifact(alias,projectId,'plan',p.id,p.compiled,key+'-plan-'+p.id));
      if(p.replication)files.push(await this.artifact(alias,projectId,'replication',p.id,p.replication,key+'-replication-'+p.id));
    }
    for(const c of view.comparisons){
      files.push(await this.artifact(alias,projectId,'comparison',c.id,c.report,key+'-comparison-'+c.id));
      files.push(await this.artifact(alias,projectId,'observations',c.id,c.observations,key+'-observations-'+c.id));
    }
    for(const j of view.jobs)for(const f of j.files??[])files.push(await this.artifact(alias,projectId,'native',j.id,f,key+'-'+j.id+'-'+f.path,f.path));
    for(const p of view.downstreamPlans??[])files.push(await this.artifact(alias,projectId,'downstream_plan',p.id,p.plan,key+'-downstream-plan-'+p.id));
    for(const operation of view.downstreamOperations??[]){
      need(operation.status==='complete','MERCHANT_DOWNSTREAM_RESULT','The original completed downstream apply/restore remains part of this whole reference.');
      for(const f of operation.files??[])files.push(await this.artifact(alias,projectId,'downstream',operation.id,f,key+'-downstream-'+operation.id+'-'+hash(f.path),f.path));
      await this.record(key+'-downstream-operation-'+operation.id+'-'+hash(canonical(operation)),operation);
    }
    for(const s of view.sources.filter(x=>x.role==='airbyte-config'))
      await this.response('source_connections',{workspace:alias,projectId,sourceId:s.id},key+'-source-connections-'+s.id);
    for(const h of Object.values(view.handoffCustody??{}))files.push(await this.artifact(alias,projectId,'handoff',h.id,h,key+'-handoff-'+h.id));
    need(Object.keys(view.handoffCustody??{}).length>=3,'MERCHANT_HISTORY','Preserve all three complete original named handoffs.');
    const historical=historyRevision===undefined?null:await this.view(alias,projectId,key+'-historical',historyRevision);
    if(historical)need(historical.revision===historyRevision&&historical.historical===(view.revision!==historyRevision),'MERCHANT_HISTORY','Keep historical and current metadata distinct.');
    const page=await this.call('projects',{workspace:alias});await this.full(alias,page,key+'-projects',{parse:true});
    const inspected=await this.call('inspect',{workspace:alias,fileId:page.fileId,expectedSha256:page.sha256,pointer:'',offset:0,limit:25});
    await this.record(key+'-project-index',inspected);
    return{projectId,instanceId:view.instanceId,revision:view.revision,sourceIds:view.sources.map(x=>x.id),planIds:view.plans.map(x=>x.id),jobIds:view.jobs.map(x=>x.id),files,historical:historical?{revision:historical.revision,historical:historical.historical}:null};
  }
  async consumers(alias,projectId,key,expectedTables,expectedRows){
    const first=(await this.response('consumer',{workspace:alias,projectId,offset:0,limit:1},key+'-binding')).value;
    const view=await this.view(alias,projectId,key+'-project'),selection=first.selection,job=view.jobs.find(x=>x.id===selection?.jobId);
    need(job&&job.status==='complete'&&['source','target'].includes(selection.kind),'MERCHANT_CONSUMER_JOB','Read the retained original complete job and actual selected SQLite binding.');
    const descriptor=job.files.find(f=>f.path==='artifacts/observations.json');
    need(descriptor,'MERCHANT_CONSUMER_SOURCE','The complete original native observations are absent.');
    const output=await this.artifact(alias,projectId,'native',job.id,descriptor,key+'-original-observations',descriptor.path);
    const observed=await json(join(this.root,output.file.path));
    need(observed.streams.length===expectedTables&&selection.tables.length===expectedTables,'MERCHANT_CONSUMER_TABLES','Keep every original selected stream.');
    const tables=[];let count=0;
    for(const stream of observed.streams){
      const side=selection.kind==='source'?stream.left:stream.right;
      const snapshotPath=selection.kind==='source'?'artifacts/source.sqlite':'artifacts/target.sqlite',snapshotFile=job.files.find(f=>f.path===snapshotPath);
      need(snapshotFile&&side.source.kind==='sqlite_snapshot'&&side.source.path===snapshotPath&&
        side.source.sha256===selection.snapshot.sha256&&snapshotFile.sha256===selection.snapshot.sha256&&snapshotFile.bytes===selection.snapshot.bytes&&Array.isArray(side.rows),
        'MERCHANT_CONSUMER_SNAPSHOT','The complete typed export must bind the original retained source/target SQLite file and actual selected consumer snapshot.');
      need(selection.tables.some(t=>t.streamId===stream.streamId),'MERCHANT_CONSUMER_TABLES','The observed stream is absent from the actual consumer selection.');
      const columns=side.columns.map(x=>x.name);let rows=[],offset=0;
      do{
        const page=(await this.response('consumer',{workspace:alias,projectId,streamId:stream.streamId,offset,limit:1000},key+'-'+hash(stream.streamId)+'-'+offset)).value;
        need(same(page.selection,selection)&&same(page.snapshot,selection.snapshot)&&same(page.columns,columns)&&page.rowCount===side.rows.length&&page.streamId===stream.streamId&&page.offset===offset,
          'MERCHANT_CONSUMER_BINDING','The actual selected typed consumer changed while paging.');
        rows.push(...page.rows);offset+=page.rows.length;
        need(offset<=side.rows.length&&(page.nextOffset===null?offset===side.rows.length:page.nextOffset===offset&&offset<side.rows.length&&page.rows.length>0),
          'MERCHANT_CONSUMER_POPULATION','Follow the actual consumer cursor through every row and multiplicity.');
      }while(offset<side.rows.length);
      need(same(rows,side.rows),'MERCHANT_CONSUMER_CELLS','Every typed cell, null, exact integer, float64 byte string and duplicate multiplicity must match the complete original native export.');
      count+=rows.length;tables.push({streamId:stream.streamId,rows:rows.length,columns});
    }
    need(count===expectedRows,'MERCHANT_CONSUMER_POPULATION','The complete original reference population differs.');
    return{projectId,selection,snapshot:selection.snapshot,tables,rows:count};
  }
  async uploadAndReplay(alias,projectId){
    const source=await identity(join(this.root,'intake','reference','DERIVATION.json')),bytes=await readFile(join(this.root,'intake','reference','DERIVATION.json'));
    const uploadId='merchant_'+hash(this.state.id+'/'+alias+'/reference-upload').slice(0,48);
    const started=await this.response('upload_begin',{workspace:alias,uploadId,filename:'DERIVATION.json',mediaType:'application/json',bytes:source.bytes,sha256:source.sha256},alias+'-upload-begin');
    let current=started.value;
    while(!current.complete&&current.offset<source.bytes){
      const chunk=bytes.subarray(current.offset,Math.min(source.bytes,current.offset+196608)),start=current.offset;
      current=(await this.response('upload_chunk',{workspace:alias,uploadId,start,total:source.bytes,sha256:hash(chunk),base64:chunk.toString('base64')},alias+'-upload-'+start)).value;
      need(current.offset===start+chunk.length,'MERCHANT_UPLOAD_RANGE','Continue the same original upload range.');
    }
    await this.response('upload_status',{workspace:alias,uploadId},alias+'-upload-status');
    const finished=await this.response('upload_finish',{workspace:alias,uploadId},alias+'-upload-finish');
    const repeated=await this.response('upload_input',{workspace:alias,uploadId,sourceInput:'reference',expectedSourceSha256:source.sha256},alias+'-upload-input-reopen');
    need(finished.value.complete&&repeated.value.sha256===source.sha256&&repeated.value.bytes===source.bytes,'MERCHANT_UPLOAD_COMPLETE','The original source upload must retain all bytes.');
    const payload={uploadId,title:'Original complete Sling reference derivation',role:'merchant-receiving-reference',url:'',notes:'The original immutable source/reference derivation received through Merchant; native data and pipeline remain unchanged.'};
    const first=await this.phase(alias+'-retained-source-action',async()=>{
      const r=await this.mutation(alias,'source-retain',projectId,'source.retain',payload);
      return{viewRevision:r.value.view.revision,result:r.value.result,requestId:r.retained.requestId,originalRequest:r.retained.originalRequest};
    });
    await this.phase(alias+'-later-review-action',async()=>{
      const r=await this.mutation(alias,'review',projectId,'review.record',{subjectId:first.result.sourceId,decision:'received',
        notes:'Reviewed the complete original Merchant source, typed consumer, native result and editable history.'});
      return{revision:r.value.view.revision,result:r.value.result,requestId:r.retained.requestId};
    });
    const replay=await this.mutation(alias,'source-retain',projectId,'source.retain',payload);
    need(same(replay.value.result,first.result)&&replay.value.view.revision===first.viewRevision&&replay.value.view.historical===true&&replay.value.currentRevision>first.viewRevision,
      'MERCHANT_REQUEST_REPLAY','Replay must retain the original accepted result and its historical revision.');
    const requests=[];for(let offset=0;;){const page=await this.call('requests',{workspace:alias,offset,limit:100});requests.push(...page.requests);if(page.nextOffset===null)break;offset=page.nextOffset;}
    const retained=requests.find(x=>x.requestId===first.requestId);need(retained?.state==='CONFIRMED'&&retained.originalRequest.sha256===first.originalRequest.sha256,'MERCHANT_REQUEST_RETAINED','The original complete request and confirmation must remain readable.');
    await this.full(alias,retained.originalRequest,alias+'-original-mutation-request',{parse:true});
    await this.record(alias+'-original-requests-'+hash(canonical(requests)),requests);
    return{uploadId,source,sourceId:first.result.sourceId,requestId:first.requestId,originalRevision:first.viewRevision,currentRevision:replay.value.currentRevision,result:first.result};
  }
  async stop(name){
    const host=this.state.hosts[name];if(!host?.applicationId)return;
    for(const run of host.starts.filter(x=>!x.closed)){
      await this.observed(name+'-stop',()=>this.apps.applicationsStop({applicationId:host.applicationId,operationId:run.requestId}));
      for(;;){
        const output=await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});
        if(output.active===false&&output.phase!=='OBSERVATION_UNAVAILABLE'){
          if(this.manager){const status=await this.call('status',{workspace:name});
            if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});}
          run.closed=true;run.closedAt=now();await this.save();
          await this.record(name+'-'+run.requestId+'-stopped',output);break;
        }
        // Unavailable observations do not establish closure or release the operation.
        await delay(1000);
      }
    }
  }
  async close(){
    if(this.closing)return;this.closing=true;
    try{
      for(const name of Object.keys(this.state?.hosts??{})){
        while(this.state.hosts[name].starts.some(x=>!x.closed)){
          try{await this.stop(name);}catch(error){this.state.errors.push({at:now(),name:'close-'+name,error:err(error)});await this.save();process.stderr.write(JSON.stringify({operationId:this.state.id,error:err(error),state:'OWNER_CLOSE_PENDING'})+'\n');await delay(1000);}
        }
      }
      if(this.manager)for(;;){try{await this.manager.close();this.manager=null;break;}catch(error){process.stderr.write(JSON.stringify({error:err(error),state:'MCP_CLOSE_PENDING'})+'\n');await delay(1000);}}
      await this.apps?.close();
    }finally{this.closing=false;}
  }
  async run(){
    const savedCandidate=join(this.directory,'candidate.json'),savedResult=join(this.directory,'MERCHANT_RESULT.json');
    if(this.state.status==='complete'||await exists(savedCandidate)||await exists(savedResult)){
      // A published candidate predates the final journal acknowledgement. Reopen
      // its exact complete bytes before setup can create any new observation.
      await this.close();
      const path=await exists(savedCandidate)?savedCandidate:savedResult,result=await json(path);
      need(result.schema==='stellar-forge.replication-workbench-customer-result.v1'&&result.status==='complete'&&
        result.operationId===this.state.originalOperationId&&result.merchantOperationId===this.state.id&&
        result.completedAt===this.state.completedAt&&same(result.selection,this.selection),
        'MERCHANT_FINAL_CANDIDATE','The retained candidate must belong to this exact original programme and source.');
      await verify(join(this.root,'CUSTOMER_RESULT.json'),this.selection.originalResult);
      need(Array.isArray(result.artifacts),'MERCHANT_FINAL_CANDIDATE','Retain the complete final artifact selection.');
      for(const file of result.artifacts)await verify(join(this.root,file.path),file);
      if(await exists(savedResult))need(same(await json(savedResult),result),'MERCHANT_FINAL_CANDIDATE','The published result differs from its original candidate.');
      if(this.state.status==='complete')await verify(savedResult,this.state.resultIdentity);
      else{await save(savedResult,result,{immutable:true});this.state.resultIdentity=await identity(savedResult);this.state.status='complete';await this.save();}
      return result;
    }
    this.state.attempts.push({id:randomUUID(),startedAt:now()});this.state.status='running';await this.save();
    try{
      const preparation=await this.prepare();
      preparation.distribution=await this.distribution();
      preparation.nativeRuntime=await this.runtimeCustody();
      const projects=[{key:'replication',id:this.original.project.projectId,revision:this.original.project.revision,tables:1,rows:1002}];
      const results={};
      for(const name of ['primary','receiving']){
        const initial=await this.phase(name+'-complete-original-session',async()=>{
          const opening=await this.start(name,'original-open'),result={opening,projects:{}};
          for(const project of projects){
            const audit=await this.phase(name+'-'+project.key+'-complete-files',()=>this.audit(name,project.id,name+'-'+project.key,{historyRevision:project.revision}));
            const consumer=await this.phase(name+'-'+project.key+'-complete-consumer',()=>this.consumers(name,project.id,name+'-'+project.key+'-consumer',project.tables,project.rows));
            result.projects[project.key]={audit,consumer};
          }
          if(name==='primary')result.mutation=await this.phase('primary-exact-upload-and-request-replay',()=>this.uploadAndReplay(name,projects[0].id));
          const files=[];for(let offset=0;;){const page=await this.call('files',{workspace:name,offset,limit:100});files.push(...page.files);if(page.nextOffset===null)break;offset=page.nextOffset;}
          await this.record(name+'-complete-retained-files-'+hash(canonical(files)),files);
          await this.stop(name);return result;
        });
        const cold=await this.phase(name+'-complete-cold-session',async()=>{
          const reopened=await this.start(name,'cold-reopen');
          need(reopened.connection.instanceId===initial.opening.connection.instanceId&&reopened.connection.launchId!==initial.opening.connection.launchId,'MERCHANT_REOPEN','Restart must retain workspace identity and establish its new managed launch.');
          const projectsAfter=[];
          for(const project of projects){
            const view=await this.view(name,project.id,name+'-'+project.key+'-cold');
            need(view.id===project.id&&view.revision>=project.revision,'MERCHANT_COLD_HISTORY','Cold reopen must retain the same complete original project.');
            const native=await this.consumers(name,project.id,name+'-'+project.key+'-cold-consumer',project.tables,project.rows);
            need(same(native.selection,initial.projects[project.key].consumer.selection),'MERCHANT_COLD_CONSUMER','The same selected native result must survive managed Stop and reopen.');
            for(const h of this.original.namedPackages)
              await this.artifact(name,project.id,'handoff',h.id,h,name+'-'+project.key+'-cold-'+h.id);
            projectsAfter.push({projectId:project.id,revision:view.revision,selection:native.selection});
          }
          await this.stop(name);
          return{launchId:reopened.connection.launchId,instanceId:reopened.connection.instanceId,projects:projectsAfter};
        });
        results[name]={...initial,cold};
      }
      const forward=await this.forwardEdition(projects,results);
      await this.close();
      await verify(join(this.root,'CUSTOMER_RESULT.json'),this.selection.originalResult);
      for(const file of Object.values(this.state.files))await verify(join(this.root,file.path),file);
      this.state.completedAt??=now();await this.save();
      const candidate={schema:'stellar-forge.replication-workbench-customer-result.v1',operationId:this.state.originalOperationId,
        merchantOperationId:this.state.id,status:'complete',completedAt:this.state.completedAt,selection:this.selection,
        originalResult:{path:'CUSTOMER_RESULT.json',...this.selection.originalResult},preparation,applications:results,forward,
        native:'Original completed Sling baseline and incremental programme retained; no additional source load or replication job was dispatched.',
        artifacts:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path))};
      const candidatePath=join(this.directory,'candidate.json'),resultPath=join(this.directory,'MERCHANT_RESULT.json');
      if(await exists(candidatePath))need(same(await json(candidatePath),candidate),'MERCHANT_FINAL_CANDIDATE','Retain the original exact final candidate.');
      else await save(candidatePath,candidate,{immutable:true});
      await save(resultPath,candidate,{immutable:true});
      this.state.resultIdentity=await identity(resultPath);this.state.status='complete';await this.save();return candidate;
    }catch(error){this.state.status='interrupted';this.state.errors.push({at:now(),error:err(error)});await this.save();throw error;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){
    process.stdout.write('replication-workbench-receive ORIGINAL_RECEIVING_FLAGS --preparation-result ABS_PREPARED_JSON --merchant-workspace PRIVATE_RUNTIME_WORKSPACE --merchant-runtime READY_MERCHANT_INSTALLATION [--resume]\nContinues the same complete Sling baseline/incremental operation through Applications, downstream history and customer-agent full-file access.\n');return{help:true};
  }
  const options=parse(argv),root=resolve(options.option.directory);
  const inspected=await inspectMerchantRuntime(options.merchant.runtime,{load:false});
  need(inspected.sourceRoot&&await realpath(inspected.sourceRoot)===SOURCE_ROOT,'MERCHANT_SOURCE_BINDING','Invoke this continuation from the selected installed Merchant source.');
  await inspectOriginalSource();
  const supplied=await json(options.merchant.preparationResult);
  need(supplied.schema==='stellar-forge.replication-workbench-preparation.v1'&&supplied.state==='READY'&&
    resolve(options.merchant.preparationResult)===join(supplied.directory,'.runtime','PREPARED.json'),
    'MERCHANT_PREPARATION','Select the original complete published preparation result.');
  const prepared=await prepareReplicationWorkbench({mode:'inspect',directory:supplied.directory});
  need(prepared.state==='READY'&&same(prepared.result,supplied),'MERCHANT_PREPARATION','Retain the same complete prepared applications, source, request and archive.');
  options.preparation=supplied;
  need(resolve(options.option.source)===supplied.primary.applicationDirectory&&
    resolve(options.option['runtime-ready'])===supplied.primary.runtimeReadyFile&&
    supplied.source.manifestSha256===ORIGINAL_MANIFEST_SHA256,
    'MERCHANT_PREPARATION','The original programme must use the actual returned primary application and runtime.');
  const prepareRequest=await json(supplied.request.path);
  need(prepareRequest.python===resolve(options.option.python),'MERCHANT_PREPARATION','Use the original preparation Python without changing its path.');
  for(const name of ['primary','receiving'])await inspectOriginalSource({directory:supplied[name].applicationDirectory});
  // The original programme holds its own operation lease. Do not recursively acquire it.
  const {main:receiveOriginal}=await import(pathToFileURL(join(supplied.primary.applicationDirectory,'receiving/receive.mjs')).href);
  const original=await receiveOriginal(options.original);
  need(original.schema==='tjlabs.sling-customer-result.v1'&&original.status==='complete'&&original.comparison?.baseline?.rows===1000&&original.comparison?.evolved?.rows===1002&&original.consumer?.finalRows===1002,'MERCHANT_NATIVE_REQUIRED','Complete the same original full Sling baseline, incremental, comparison, consumer and receiving programme first.');
  const originalResult=await identity(join(root,'CUSTOMER_RESULT.json')),auth=await json(join(root,'installation-auth.json'));
  const selection={sourceRoot:SOURCE_ROOT,merchantRuntime:options.merchant.runtime,merchantWorkspace:options.merchant.workspace,
    sourceManifestSha256:inspected.sourceManifestSha256,workbenchManifestSha256:ORIGINAL_MANIFEST_SHA256,
    originalSourceManifestSha256:(await identity(resolve(options.option['source-manifest']))).sha256,
    originalRuntimeReady:await identity(resolve(options.option['runtime-ready'])),
    preparationResult:{path:options.merchant.preparationResult,...await identity(options.merchant.preparationResult)},
    preparation:{directory:supplied.directory,source:supplied.source,portable:supplied.portable,request:supplied.request,primary:supplied.primary,receiving:supplied.receiving},
    originalOperationId:original.operationId,originalResult,node:{executable:process.execPath,version:process.version},
    actorId:auth.actors.find(x=>x.roles.includes('operator')).id};
  const lease=await acquireWorkspaceLease(join(root,'receiving.lock'));let course;
  try{
    course=new Course(root,options,selection,original,lease);await course.open();
    if(course.state.status!=='complete'){
      await course.phase('00-selected-original-source',async()=>{await course.record('selected-merchant-runtime-'+hash(canonical(inspected)),inspected);return course.retain(join(root,'CUSTOMER_RESULT.json'));});
    }
    return await course.run();
  }finally{
    if(course)await course.close();
    // close only returns after all retained original owners have ended.
    await lease.close();
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({error:err(error)})+'\n');process.exitCode=1;});
