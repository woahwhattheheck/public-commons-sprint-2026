// SPDX-License-Identifier: MIT
// Continue the original complete native course through the maintained Merchant surfaces.
import {readFile,writeFile,mkdir,open,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {acquireWorkspaceLease,privateDirectory} from './workbench/vendor/stellar-expert/store.mjs';
import {inspectOriginalSource,WORKBENCH_ROOT,ORIGINAL_MANIFEST_SHA256} from './managed.mjs';
import {COLLABORATIVE_HOST_SCHEMA} from './mcp.mjs';
import merchantProvider from './merchant-provider.mjs';
import {initializeCollaborativeDocumentsMerchant} from './setup.mjs';
import {readMerchantConfig} from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import {LAUNCH_SCHEMA} from './connection.mjs';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';

import {receivingLifetime} from './workbench/receiving/browser.mjs';
import {prepareCollaborativeDocuments} from './prepare.mjs';
import {openReceivingEdit} from './receiving-edit.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(HERE,'../..');
const SCHEMA='stellar-forge.collaborative-documents-receiving.v1';
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
  const merchant={},original=[],option={};
  for(let i=0;i<argv.length;i++){
    const k=argv[i];
    if(k.startsWith('--merchant-')){
      need(['--merchant-workspace','--merchant-runtime','--merchant-preparation'].includes(k),'MERCHANT_RECEIVING_OPTION','Use the declared Merchant installation selections.');
      need(argv[i+1]&&!argv[i+1].startsWith('--')&&!Object.hasOwn(merchant,k.slice(11)),'MERCHANT_RECEIVING_OPTION','Select each original path once.');
      merchant[k.slice(11)]=resolve(argv[++i]);
    }else original.push(k);
  }
  for(let i=0;i<original.length;i++){const k=original[i];if(['--resume','--recover-completed'].includes(k))option[k.slice(2)]=true;else if(k.startsWith('--'))option[k.slice(2)]=original[++i];}
  for(const k of ['workspace','runtime','preparation'])need(merchant[k],'MERCHANT_RECEIVING_OPTION','Select --merchant-'+k+' from the same complete preparation.');
  for(const k of ['directory','source','source-manifest','runtime-ready','receiving-source','receiving-runtime-ready','playwright','chromium'])need(option[k],'MERCHANT_RECEIVING_OPTION','Retain the original --'+k+' selection.');
  return{merchant,original,option};
}
class Course{
  constructor(root,options,selection,original,lease){this.root=root;this.options=options;this.selection=selection;this.original=original;this.lease=lease;this.directory=join(root,'merchant-receiving');this.path=join(this.directory,'operation.json');this.manager=null;this.apps=null;this.closing=false;this.owners=new Map();this.lifetime=options.lifetime;}
  async open(){
    await mkdir(this.directory,{mode:0o700,recursive:true});
    if(await exists(this.path)){this.state=await json(this.path);need(this.state.schema===SCHEMA&&same(this.state.selection,this.selection),'MERCHANT_RECEIVING_SELECTION','Preserve the original integration source, operation and installation.');need(this.options.option.resume||this.state.status==='complete','RESUME_REQUIRED','Continue this original operation with --resume.');}
    else{this.state={schema:SCHEMA,id:'merchant_receiving_'+randomUUID(),originalOperationId:this.original.operationId,selection:this.selection,status:'prepared',createdAt:now(),phases:{},hosts:{},files:{},errors:[],attempts:[]};await this.save();}
    this.apps=await openRuntimeWorkspace({directory:this.options.merchant.workspace});
    return this;
  }
  async save(){this.lease.assert();await save(this.path,this.state);}
  async retain(path){const full=resolve(this.root,path),name=child(this.root,full),d={path:name,...await identity(full)};this.state.files[name]=d;await this.save();return d;}
  async record(name,value){const path=join(this.directory,'records',name+'-'+hash(canonical(value))+'.json');await save(path,value,{immutable:true});await this.retain(path);return value;}
  async phase(name,work){
    this.lifetime.check();const old=this.state.phases[name];if(old?.status==='complete')return old.result;
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
  alias(name,actor='operator'){return actor==='operator'?name:name+'-'+actor;}
  async prepare(){
    const attached=await this.phase('01-attach-original-installation',()=>this.apps.attach({directory:this.options.merchant.runtime,label:'Collaborative Document original complete installation'}));
    need(typeof attached.runtimeId==='string'&&attached.status==='READY','MERCHANT_RUNTIME','Select the original inspected READY installation.');this.runtimeId=attached.runtimeId;
    this.authFile=join(this.root,'private-auth.json');this.auth=await json(this.authFile);
    this.actors=Object.fromEntries(this.auth.actors.map(a=>[a.id,a]));
    need(['operator','editor-a','editor-b','viewer','outsider'].every(k=>this.actors[k]),'MERCHANT_ACTORS','Retain the five original tenant-bound actors.');
    this.ledger=await json(join(this.root,'receiving.json'));
    const input=join(resolve(this.options.option.source),'reference','documents.json'),inputId=await identity(input),workspaces={};
    for(const name of ['primary','receiving']){
      const old=this.ledger.servers[name==='primary'?'source':'receiving'];
      need(old?.closedAt&&old.port>0&&old.origin&&old.instanceId,'MERCHANT_ORIGINAL_OWNER','Close and retain the original server before Applications adoption.');
      const prepared=this.options.prepared[name],directory=resolve(old.directory);await privateDirectory(directory);
      const connectionFile=join(this.directory,name+'-connection.json'),configurationFile=join(this.directory,name+'-launch.json');
      const value={schema:LAUNCH_SCHEMA,applicationDirectory:prepared.applicationDirectory,directory,authFile:this.authFile,actorId:'operator',runtimeReadyFile:prepared.runtimeReadyFile,connectionFile};
      await save(configurationFile,value,{immutable:true});await this.retain(configurationFile);
      for(const actor of Object.keys(this.actors)){
        const alias=this.alias(name,actor);workspaces[alias]={label:'Original '+name+' / '+actor,directory,connectionFile,actorId:actor,
          inputs:{reference:{file:input,sha256:inputId.sha256,bytes:inputId.bytes,filename:'documents.json',mediaType:'application/json',label:'Original complete authored three-document reference'}}};
      }
      this.state.hosts[name]??={name,directory,applicationDirectory:prepared.applicationDirectory,runtimeReadyFile:prepared.runtimeReadyFile,configurationFile,connectionFile,port:old.port,origin:old.origin,instanceId:old.instanceId,starts:[]};await this.save();
    }
    this.hostConfig=join(this.directory,'merchant-host.json');await save(this.hostConfig,{schema:COLLABORATIVE_HOST_SCHEMA,workspaces},{immutable:true});await this.retain(this.hostConfig);
    await this.useHostConfiguration(this.hostConfig,'initial');
    const tools=merchantProvider.tools((name,description,properties,required)=>({name,properties,required}));
    need(tools.length===23&&new Set(tools.map(t=>t.name)).size===23,'MERCHANT_TOOL_CATALOG','Use the complete actual provider catalog.');
    await this.record('merchant-tool-catalog',tools);
    return{runtimeId:this.runtimeId,operatorId:'operator',input:{path:input,...inputId}};
  }
  async preparationCustody(){
    return this.phase('02-complete-original-prepared-runtime',async()=>{
      const checked=await prepareCollaborativeDocuments({mode:'inspect',directory:this.options.prepared.request.directory});
      need(checked.status==='READY'&&same(checked.result,this.options.prepared),'MERCHANT_PREPARATION','Retain the exact complete original preparation result.');
      const archive=join(this.directory,'distribution','collaborative-documents-runtime.tar.gz');
      await copySelected(this.options.prepared.archive.path,archive,this.options.prepared.archive);
      const receipt=join(this.directory,'distribution','PREPARED.json');
      await copySelected(this.options.merchant.preparation,receipt,this.selection.preparation);
      const files=[await this.retain(archive),await this.retain(receipt)];
      for(const name of ['primary','receiving']){
        const selected=this.options.prepared[name],ready=join(this.directory,'distribution',name+'-runtime-ready.json');
        await copySelected(selected.runtimeReadyFile,ready,selected.ready);files.push(await this.retain(ready));
      }
      return{archive:files[0],receipt:files[1],files,primary:this.options.prepared.primary,receiving:this.options.prepared.receiving,
        note:'The complete original prepared-runtime archive is received through the original runtime controller; private host paths and tokens are selected locally.'};
    });
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
  async useHostConfiguration(path,edition){
    if(this.manager){await this.manager.close();this.manager=null;}
    const setup=await initializeCollaborativeDocumentsMerchant({directory:join(this.directory,'agent-host-'+edition),connection:path,name:'Original Collaborative Document '+edition});
    await this.record('merchant-host-'+edition+'-'+hash(canonical(setup)),setup);
    const configuration=await readMerchantConfig(setup.configuration);this.exports=configuration.exportsDirectory;
    this.manager=await merchantProvider.create(await merchantProvider.load(),configuration);
  }
  async app(name){return(await this.apps.applicationsState({historyLimit:100})).applications.find(x=>x.id===this.state.hosts[name].applicationId);}
  async configure(name){
    const host=this.state.hosts[name];
    return this.phase('application-'+name+'-save',async()=>{
      const reviewed=await this.intent('application-'+name+'-review',()=>this.apps.applicationsReview({
        runtimeId:this.runtimeId,kind:'collaborative-documents-workbench',providerId:'collaborative-documents',
        settings:{configurationFile:host.configurationFile,port:host.port},label:'Collaborative Document '+name+' existing native course'}));
      const request=await this.intent('application-'+name+'-save',async()=>({requestId:randomUUID(),reviewId:reviewed.id}));
      const response=await this.apps.applicationsSave(request);host.applicationId=response.applicationId;await this.save();
      await this.record('application-'+name+'-save-'+hash(canonical(response)),response);
      return{applicationId:response.applicationId,reviewId:reviewed.id,requestId:request.requestId};
    }).then(async saved=>{host.applicationId=saved.applicationId;await this.save();return saved;});
  }
  async connected(name){
    for(let i=0;i<600;i++){
      const a=await this.app(name);need(a,'MERCHANT_APPLICATION','The original saved application is absent.');
      if(a.release&&a.connectionReady===true)return a;
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
        need(connection.instanceId&&connection.actor.id==='operator','MERCHANT_IDENTITY','The managed application selected another actor.');
        const old=host.instanceId;need(!old||old===connection.instanceId,'MERCHANT_IDENTITY','The original workspace identity changed.');
        host.instanceId=connection.instanceId;current.launchId=connection.launchId;current.running=true;await this.save();
        await this.record(name+'-'+current.requestId+'-connected-'+hash(canonical(connection)),connection);
        need(connection.origin===host.origin,'MERCHANT_ORIGIN','Retain the original listener origin selected by the document edition.');
        for(const actor of Object.keys(this.actors).filter(x=>x!=='operator')){
          const alias=this.alias(name,actor),status=await this.call('status',{workspace:alias});
          if(status.state==='CONNECTED')await this.call('disconnect',{workspace:alias,launchId:status.launchId});
          const joined=await this.call('connect',{workspace:alias});
          need(joined.instanceId===connection.instanceId&&joined.actor.id===actor,'MERCHANT_ACTOR','The alias selected another original actor.');
        }
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
  call(name,args={}){return this.manager.call('merchant_collaboration_'+name,args);}
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
    const path=join(this.exports,'collaborative-documents',alias,descriptor.sha256+'.content');
    await verify(path,descriptor);const file=await this.retain(path);
    await this.record('full-'+hash(key+'\0'+descriptor.sha256),{key,workspace:alias,fileId:descriptor.fileId,sha256:descriptor.sha256,bytes:offset,chunks,file});
    return parse?json(path):file;
  }
  async response(name,args,key){const r=await this.call(name,args);return{retained:r,value:await this.full(args.workspace,r,key,{parse:true})};}
  async view(alias,projectId,key,revision){return(await this.response('project',{workspace:alias,projectId,...(revision===undefined?{}:{revision})},key )).value;}
  async mutation(alias,key,projectId,action,payload){
    const input=await this.intent(alias+'-'+key,async()=>({workspace:alias,projectId,requestId:'merchant_'+hash(this.state.id+'/'+alias+'/'+key).slice(0,48),
      expectedRevision:(await this.view(alias,projectId,key+'-before')).revision,action,payload}));
    need(input.workspace===alias&&input.projectId===projectId&&input.action===action&&same(input.payload,payload),'MERCHANT_MUTATION_SELECTION','Retain the exact original mutation intent.');
    return this.observed(key,()=>this.response('action',input,key));
  }
  async artifact(alias,projectId,kind,id,d,key,fileId,revision){
    const selection={projectId,kind,id,...(fileId===undefined?{}:{fileId}),...(revision===undefined?{}:{revision})};
    const response=await this.call('artifact',{workspace:alias,selection,expectedSha256:d.sha256,expectedBytes:d.bytes,
      ...(d.filename?{filename:d.filename}:{}),...(d.mediaType?{mediaType:d.mediaType}:{})});
    const file=await this.full(alias,response,key);return{selection,original:{bytes:d.bytes,sha256:d.sha256},file,fileId:response.fileId};
  }
  async audit(alias,projectId,key,{historyRevision}={}){
    const view=await this.view(alias,projectId,key+'-view'),files=[];
    for(const row of view.sources)files.push(await this.artifact(alias,projectId,'source',row.id,row,key+'-source-'+row.id));
    for(const job of view.jobs)for(const file of job.files??[])files.push(await this.artifact(alias,projectId,'job',job.id,file,key+'-'+job.id+'-'+file.id,file.id));
    for(const row of view.handoffs)files.push(await this.artifact(alias,projectId,'handoff',row.id,row,key+'-handoff-'+row.id));
    need(view.documents.length===3&&new Set(view.documents.map(x=>x.tenantId)).size===2&&view.handoffs.length>=2,'MERCHANT_ORIGINAL_POPULATION','Retain all three original documents, both tenants and both original named handoffs.');
    const persistence=[];
    for(const doc of view.documents){
      const value=(await this.response('persistence',{workspace:alias,projectId,documentId:doc.id},key+'-persisted-'+doc.id)).value;
      need(value.documentId===doc.id&&value.epochId===doc.epochId&&value.documentName===doc.documentName&&same(value.persisted,doc.persisted),'MERCHANT_NATIVE_STATE','The complete durable native update and state vector must match the same original document.');
      persistence.push(value);
    }
    const historical=historyRevision===undefined?null:await this.view(alias,projectId,key+'-historical',historyRevision);
    if(historical)need(historical.revision===historyRevision,'MERCHANT_HISTORY','Keep the selected original historical revision.');
    const page=await this.call('projects',{workspace:alias});await this.full(alias,page,key+'-projects',{parse:true});
    await this.record(key+'-project-index',await this.call('inspect',{workspace:alias,fileId:page.fileId,expectedSha256:page.sha256,pointer:'',offset:0,limit:25}));
    return{projectId,revision:view.revision,documents:view.documents.map(d=>({id:d.id,tenantId:d.tenantId,documentName:d.documentName,epochId:d.epochId,persisted:d.persisted})),files,persistence,
      sourceIds:view.sources.map(x=>x.id),handoffIds:view.handoffs.map(x=>x.id),historical:historical?{revision:historical.revision,historical:historical.historical}:null};
  }


  async privateResponse(name,actor,path,{method='GET',body,expect=[200]}={}){
    this.lifetime.check();const host=this.state.hosts[name],token=this.actors[actor].token;
    const response=await fetch(new URL(path,host.origin),{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:this.lifetime.signal,redirect:'error'});
    if(!expect.includes(response.status)){await response.body?.cancel();need(false,'MERCHANT_ORIGINAL_HTTP','The original authenticated application returned an unexpected result.',{status:response.status,path});}
    return response;
  }
  async settle(alias,projectId,jobId){
    for(let i=0;i<600;i++){
      this.lifetime.check();const view=await this.view(alias,projectId,alias+'-settle-'+(jobId??'all')+'-'+i);
      const jobs=jobId?view.jobs.filter(x=>x.id===jobId):view.jobs;
      if(jobId)need(jobs.length===1,'MERCHANT_JOB','Keep the exact original native job.');
      const failed=jobs.filter(x=>['failed','interrupted','cancelled'].includes(x.status));
      need(!failed.length,'MERCHANT_JOB_REVIEW','Retain the exact failed or interrupted native jobs for explicit same-job continuation.',{jobs:failed});
      if(jobs.every(x=>x.status==='complete'))return view;
      await delay(1000);
    }throw Object.assign(new Error('The original native job is still pending; resume its saved operation.'),{code:'MERCHANT_JOB_PENDING'});
  }
  async uploadAndReplay(alias,projectId){
    const sourcePath=join(this.options.prepared.primary.applicationDirectory,'reference','documents.json'),source=await identity(sourcePath),bytes=await readFile(sourcePath);
    const uploadId='merchant_'+hash(this.state.id+'/'+alias+'/reference-upload').slice(0,48);
    let current=(await this.response('upload_begin',{workspace:alias,uploadId,filename:'documents.json',mediaType:'application/json',bytes:source.bytes,sha256:source.sha256},alias+'-upload-begin')).value;
    while(!current.complete&&current.offset<source.bytes){
      const chunk=bytes.subarray(current.offset,Math.min(source.bytes,current.offset+196608)),start=current.offset;
      current=(await this.response('upload_chunk',{workspace:alias,uploadId,start,total:source.bytes,sha256:hash(chunk),base64:chunk.toString('base64')},alias+'-upload-'+start)).value;
      need(current.offset===start+chunk.length,'MERCHANT_UPLOAD_RANGE','Continue the same original upload range.');
    }
    await this.response('upload_status',{workspace:alias,uploadId},alias+'-upload-status');
    const finished=await this.response('upload_finish',{workspace:alias,uploadId},alias+'-upload-finish');
    const reopened=await this.response('upload_input',{workspace:alias,uploadId,sourceInput:'reference',expectedSourceSha256:source.sha256},alias+'-upload-input-reopen');
    need(finished.value.complete&&reopened.value.sha256===source.sha256&&reopened.value.bytes===source.bytes,'MERCHANT_UPLOAD_COMPLETE','Retain every original source byte.');
    const payload={uploadId,title:'Original complete Merchant receiving reference',role:'other',metadata:{originalOperationId:this.state.originalOperationId,sha256:source.sha256}};
    const first=await this.phase(alias+'-retained-source-action',async()=>{
      const r=await this.mutation(alias,'source-retain',projectId,'source.retain',payload);
      return{viewRevision:r.value.view.revision,result:r.value.result,requestId:r.retained.requestId,originalRequest:r.retained.originalRequest};
    });
    const selected=await this.intent(alias+'-review-selection',async()=>{const view=await this.view(alias,projectId,'review-subject');need(view.checkpoints.length,'MERCHANT_CHECKPOINT','The original complete course has no checkpoint.');return{checkpointId:view.checkpoints.at(-1).id};});
    const review=await this.phase(alias+'-later-review-action',async()=>{
      const r=await this.mutation(alias,'review',projectId,'review.save',{subjectType:'checkpoint',subjectId:selected.checkpointId,decision:'accepted',
        note:'Reviewed original source, native document state and complete checkpoint through Merchant. The complete original collaboration programme remains retained.',evidenceSourceIds:[first.result.sourceId]});
      return{revision:r.value.view.revision,result:r.value.result,requestId:r.retained.requestId};
    });
    const replay=await this.mutation(alias,'source-retain',projectId,'source.retain',payload);
    need(same(replay.value.result,first.result)&&replay.value.view.revision===first.viewRevision&&replay.value.view.historical===true&&replay.value.currentRevision>first.viewRevision,
      'MERCHANT_REQUEST_REPLAY','Replay must retain the original accepted result and historical revision after a later action.');
    const native=(await this.response('request',{workspace:alias,requestId:first.requestId},alias+'-native-request')).value;
    need(same(native.response.result,first.result)&&native.response.view.revision===first.viewRevision,'MERCHANT_REQUEST_REPLAY','The actor-scoped native receipt must retain the same original result.');
    const requests=[];for(let offset=0;;){const page=await this.call('requests',{workspace:alias,offset,limit:100});requests.push(...page.requests);if(page.nextOffset===null)break;offset=page.nextOffset;}
    const retained=requests.find(x=>x.requestId===first.requestId);
    need(retained?.state==='CONFIRMED'&&retained.originalRequest.sha256===first.originalRequest.sha256,'MERCHANT_REQUEST_RETAINED','Retain the exact original request and confirmation.');
    await this.full(alias,retained.originalRequest,alias+'-original-mutation-request',{parse:true});
    await this.record(alias+'-original-requests-'+hash(canonical(requests)),requests);
    return{uploadId,source,sourceId:first.result.sourceId,requestId:first.requestId,originalRevision:first.viewRevision,currentRevision:replay.value.currentRevision,review,result:first.result};
  }
  async denied(key,work){
    let failure=null;
    try{await work();}catch(error){need([403,404].includes(error.status??error.details?.status),'MERCHANT_ACCESS_ERROR','Retain the actual access denial, not an unrelated transport error.',{error:err(error),status:error.status});failure={code:error.code,status:error.status??error.details?.status};}
    need(failure,'MERCHANT_ACCESS_BROKEN','The original tenant or revoked grant unexpectedly allowed access.');
    await this.record(key,failure);return failure;
  }
  async actorAudit(name,projectId,key){
    const original=await this.view(name,projectId,key+'-operator'),results={};
    for(const actor of ['editor-a','editor-b','viewer','outsider']){
      const alias=this.alias(name,actor),view=await this.view(alias,projectId,key+'-'+actor);
      const wanted=original.documents.filter(d=>this.actors[actor].tenantIds.includes(d.tenantId)).map(d=>d.id).sort();
      need(same(view.documents.map(d=>d.id).sort(),wanted)&&!view.permissions.operate&&view.sources.length===0&&view.jobs.length===0&&view.handoffs.length===0,'MERCHANT_TENANT_SCOPE','The current actor must see only its explicitly granted original documents.');
      need(view.documents.every(d=>d.access===(actor==='viewer'?'read':'write')),'MERCHANT_DOCUMENT_ACCESS','Retain the original read/write distinction.');
      const documents=(await this.response('documents',{workspace:alias,projectId},key+'-'+actor+'-documents')).value;
      need(same(documents.documents.map(d=>d.id).sort(),wanted),'MERCHANT_DOCUMENT_SCOPE','The documents endpoint must use the same current grants.');
      const wrong=original.documents.find(d=>!wanted.includes(d.id));
      const denied=await this.denied(key+'-'+actor+'-wrong-tenant',()=>this.call('persistence',{workspace:alias,projectId,documentId:wrong.id}));
      results[actor]={documents:wanted,access:actor==='viewer'?'read':'write',denied};
    }
    return results;
  }
  async grantRevocation(name,projectId){
    const viewer=this.alias(name,'viewer');
    const selected=await this.phase(name+'-grant-original-selection',async()=>{
      const view=await this.view(name,projectId,'original-viewer-grant'),grants=view.grants.filter(g=>g.actorId==='viewer'&&g.enabled);
      need(grants.length===1,'MERCHANT_GRANT_SELECTION','Select the one original viewer grant.');
      const response=await this.call('project',{workspace:viewer,projectId});await this.full(viewer,response,'viewer-before-revocation',{parse:true});
      return{grant:grants[0],response};
    });
    const payload=enabled=>({grantId:selected.grant.id,actorId:selected.grant.actorId,tenantId:selected.grant.tenantId,documentIds:selected.grant.documentIds,access:selected.grant.access,enabled,
      reason:enabled?'Restore the exact original viewer grant after retained-file authorization receiving.':'Temporarily revoke this exact original viewer grant to verify current authority on retained-file reads.'});
    await this.phase(name+'-grant-revoke',async()=>{const r=await this.mutation(name,'viewer-grant-revoke',projectId,'grant.save',payload(false));return r.value.result;});
    const blocked=await this.phase(name+'-grant-current-file-denial',()=>this.denied(name+'-revoked-retained-file',()=>this.call('file',{workspace:viewer,fileId:selected.response.fileId,expectedSha256:selected.response.sha256,offset:0,limit:196608})));
    const restored=await this.phase(name+'-grant-restore',async()=>{const r=await this.mutation(name,'viewer-grant-restore',projectId,'grant.save',payload(true));return r.value.result;});
    await this.full(viewer,selected.response,'viewer-original-file-after-restoration',{parse:true});
    return{grantId:selected.grant.id,blocked,restored};
  }
  async ensureDeployment(name,projectId,deploymentId){
    let view=await this.settle(name,projectId);
    if(view.runtime?.state==='running'){
      need(view.runtime.deploymentId===deploymentId,'MERCHANT_NATIVE_OWNER','Another original deployment owns the document.');return view;
    }
    const previous=this.state.nativeStarts??=[];this.state.nativeStarts=previous;
    let attempt=previous.find(x=>x.name===name&&x.deploymentId===deploymentId&&!x.closed);
    if(attempt){
      const job=view.jobs.find(x=>x.id===attempt.jobId);
      if(job?.status==='complete'){
        need(this.options.option.resume,'RESUME_REQUIRED','Explicitly resume the same ended native deployment.');
        attempt.closed=true;attempt.closedAt=now();await this.save();attempt=null;
      }
    }
    if(!attempt){attempt={name,deploymentId,key:name+'-native-start-'+previous.length,createdAt:now()};previous.push(attempt);await this.save();}
    const launched=await this.mutation(name,attempt.key,projectId,'deployment.start',{deploymentId});
    attempt.jobId=launched.value.result.jobId;await this.save();
    view=await this.settle(name,projectId,attempt.jobId);
    need(view.runtime?.state==='running'&&view.runtime.deploymentId===deploymentId,'MERCHANT_NATIVE_START','The exact original native deployment did not start.');return view;
  }
  async nativeEdit(name,projectId){
    const selected=await this.intent('native-edit-selection',async()=>{
      const view=await this.view(name,projectId,'native-edit-before'),doc=view.documents.find(d=>d.tenantId==='tenant-a'),deployment=view.deployments.at(-1);
      need(doc&&deployment,'MERCHANT_NATIVE_SELECTION','Select the original document and reviewed deployment.');
      return{projectId,documentId:doc.id,tenantId:doc.tenantId,epochId:doc.epochId,documentName:doc.documentName,deploymentId:deployment.id};
    });
    await this.ensureDeployment(name,projectId,selected.deploymentId);
    const directory=join(this.directory,'native-edit');await mkdir(directory,{recursive:true,mode:0o700});
    // This helper uses the actual selected original Yjs/Hocuspocus packages and
    // retains its own same-epoch edit intent. It does not rerun the native course.
    const intent=await this.intent('native-provider-edit',async()=>({...selected,requestId:'merchant_edit_'+hash(this.state.id).slice(0,40),text:'Merchant received edit '+this.state.id}));
    const owner=openReceivingEdit({directory,sourceRoot:this.state.hosts[name].applicationDirectory,origin:this.state.hosts[name].origin,runtimeReadyFile:this.state.hosts[name].runtimeReadyFile,
      actor:this.actors['editor-a'],...intent,signal:this.lifetime.signal,resume:Boolean(this.options.option.resume)});
    this.owners.set('native-edit',owner);
    const result=await owner.run();await owner.close();this.owners.delete('native-edit');
    need(result.schema==='stellar-forge.collaborative-documents-receiving-edit.v1'&&result.state==='PERSISTED','MERCHANT_NATIVE_EDIT','Complete the original provider edit and durable update receipt.');
    for(const file of result.files??[]){await verify(join(directory,file.path),file);await this.retain(join(directory,file.path));}
    await this.record('original-provider-edit',result);
    const persisted=(await this.response('persistence',{workspace:name,projectId,documentId:selected.documentId},'provider-edit-persistence')).value;
    need(persisted.epochId===selected.epochId&&persisted.documentName===selected.documentName&&['sha256','bytes','stateVectorBase64','stateVectorSha256'].every(k=>result.persisted[k]===persisted.persisted?.[k]),'MERCHANT_EDIT_EPOCH','The edit must remain in the original physical document epoch.');
    return{selected,result,persisted};
  }
  async checkpoint(name,projectId,edit){
    const created=await this.mutation(name,'merchant-drain-checkpoint',projectId,'checkpoint.create',{title:'Merchant complete native edit checkpoint',deploymentId:edit.selected.deploymentId,mode:'drain'});
    const view=await this.settle(name,projectId,created.value.result.jobId),checkpoint=view.checkpoints.find(x=>x.id===created.value.result.checkpointId);
    need(checkpoint&&checkpoint.files?.length,'MERCHANT_CHECKPOINT','Retain the complete original binary checkpoint.');
    const file=await this.downloadCheckpoint(name,projectId,checkpoint.id);
    const artifact=await this.artifact(name,projectId,'checkpoint',checkpoint.id,file,'complete-checkpoint-'+checkpoint.id);
    need(artifact.file.sha256===file.sha256&&artifact.file.bytes===file.bytes,'MERCHANT_CHECKPOINT','MCP must retain the complete original archive, not its JSON descriptor.');
    const reviewed=await this.mutation(name,'merchant-checkpoint-review',projectId,'review.save',{subjectType:'checkpoint',subjectId:checkpoint.id,decision:'accepted',
      note:'The same original document edit is durably represented by the full Yjs update, vector and complete checkpoint archive.',evidenceSourceIds:[]});
    return{checkpointId:checkpoint.id,descriptor:checkpoint.descriptor,archive:artifact,review:reviewed.value.result};
  }
  async downloadCheckpoint(name,projectId,id){
    const target=join(this.directory,'native-downloads',id+'.ndjson.gz'),receipt=target+'.json';
    if(await exists(receipt)){const d=await json(receipt);await verify(target,d);await this.retain(target);await this.retain(receipt);return d;}
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    const response=await this.privateResponse(name,'operator','/api/projects/'+projectId+'/checkpoints/'+id+'/download');
    const temporary=target+'.download-'+randomUUID();let fd=null,bytes=0;
    try{fd=await open(temporary,'wx',0o600);for await(const chunk of response.body){this.lifetime.check();bytes+=chunk.byteLength;need(bytes<=512*1024*1024,'MERCHANT_CHECKPOINT_LIMIT','Keep the original bounded complete checkpoint.');await fd.writeFile(chunk);}await fd.sync();}finally{try{await fd?.close();}finally{await response.body?.cancel();}}
    const actual=await identity(temporary),etag=response.headers.get('etag')?.replaceAll('"','');
    need(actual.bytes===bytes&&(!etag||etag===actual.sha256),'MERCHANT_CHECKPOINT_BYTES','The complete original download identity differs.');
    if(await exists(target)){await verify(target,actual);await unlink(temporary);}else{await rename(temporary,target);const d=await open(dirname(target),'r');try{await d.sync();}finally{await d.close();}}
    const descriptor={...actual,filename:id+'.ndjson.gz',mediaType:response.headers.get('content-type')??'application/gzip',projectId,checkpointId:id};
    await save(receipt,descriptor,{immutable:true});await this.retain(target);await this.retain(receipt);return descriptor;
  }
  async render(name,projectId,key){
    const host=this.state.hosts[name],view=await this.view(name,projectId,key+'-view'),directory=join(this.directory,'browser-'+key);
    const module=await import(pathToFileURL(join(host.applicationDirectory,'receiving/browser.mjs')).href);
    let result;
    try{result=await module.runBrowserJourney({directory,sourceRoot:host.applicationDirectory,origin:host.origin,actors:this.actors,projectId,
      documentIds:view.documents.map(d=>d.id),playwright:this.options.option.playwright,chromium:this.options.option.chromium,phase:'receiving',
      runtimeReadySha256:(await identity(host.runtimeReadyFile)).sha256,sourceManifestSha256:(await identity(this.options.option['source-manifest'])).sha256,
      expectedHandoffs:view.handoffs.map(h=>({id:h.id,bytes:h.bytes,sha256:h.sha256})),historicalRevision:this.original.sourceRevision,signal:this.lifetime.signal});}
    catch(error){const owner=error.browserJourney??(error.closeFailedBrowserJourney?{close:error.closeFailedBrowserJourney}:null);if(owner)this.owners.set('browser-'+key,owner);throw error;}
    need(result.state==='complete','MERCHANT_BROWSER','Complete the actual original browser receiving journey.');
    for(const f of result.files){await verify(join(directory,f.path),f);await this.retain(join(directory,f.path));}
    const resultPath=join(directory,'result.json');
    // The native journal selects this exact result filename; preserve its full
    // result and every declared output rather than infer success from screenshots.
    if(await exists(resultPath)){need(same(await json(resultPath),result),'MERCHANT_BROWSER_RESULT','The original browser result differs.');await this.retain(resultPath);}
    await this.record(key+'-browser-result',result);return result;
  }
  async forwardEdition(projectId,mutation){
    const h4=await this.phase('primary-latest-merchant-handoff',async()=>{
      await this.start('primary','latest-handoff');
      const prepared=await this.mutation('primary','merchant-handoff',projectId,'handoff.prepare',{title:'Merchant complete collaborative edition',notes:'Complete original collaboration plus Merchant source, grants, durable edit, checkpoint and actor-scoped request history.'});
      const id=prepared.value.result.handoffId,view=await this.view('primary',projectId,'merchant-handoff-current'),row=view.handoffs.find(h=>h.id===id);
      need(row,'MERCHANT_HANDOFF','Retain the complete named original handoff.');
      return{handoffId:id,revision:row.revision,actionRevision:view.revision,descriptor:row,archive:await this.artifact('primary',projectId,'handoff',id,row,'merchant-latest-handoff'),documents:(await this.audit('primary',projectId,'merchant-latest-audit')).documents};
    });
    await this.stop('primary');
    const configuration=await this.phase('merchant-handoff-host-edition',async()=>{
      const value=await json(this.hostConfig),d=h4.archive.file;
      value.workspaces.receiving.inputs.merchantHandoff={file:join(this.root,d.path),sha256:d.sha256,bytes:d.bytes,filename:'merchant-collaboration.ndjson.gz',mediaType:'application/gzip',label:'Complete original Merchant-operated edition'};
      // Host input identifiers use the maintained lower-case alias grammar.
      value.workspaces.receiving.inputs.merchant_handoff=value.workspaces.receiving.inputs.merchantHandoff;delete value.workspaces.receiving.inputs.merchantHandoff;
      const path=join(this.directory,'merchant-host-forward.json');await save(path,value,{immutable:true});await this.retain(path);return{path};
    });
    await this.useHostConfiguration(configuration.path,'forward');
    const received=await this.phase('receiving-merchant-forward',async()=>{
      await this.start('receiving','merchant-forward');
      const uploadId='merchant_'+hash(this.state.id+'/complete-forward').slice(0,48),d=h4.archive.file;
      const upload=(await this.response('upload_input',{workspace:'receiving',uploadId,sourceInput:'merchant_handoff',expectedSourceSha256:d.sha256},'receiving-complete-handoff')).value;
      need(upload.complete&&upload.sha256===d.sha256&&upload.bytes===d.bytes,'MERCHANT_HANDOFF_UPLOAD','Receive all original handoff bytes.');
      const response=await this.mutation('receiving','merchant-forward',projectId,'handoff.receive',{uploadId});
      const view=await this.view('receiving',projectId,'received-merchant-edition');
      need(view.id===projectId&&view.sources.some(s=>s.id===mutation.sourceId)&&view.reviews.some(r=>r.id===mutation.review.result.reviewId)&&
        response.value.result.packageSha256===d.sha256&&response.value.result.receivedRevision===h4.revision,
        'MERCHANT_FORWARD','Retain the exact received package, selected immutable prefix and latest source/review in the same original project.');
      // The original gzip-v1 package freezes its selected prefix before its own
      // outer handoff row is committed. Its complete descriptor stays in this
      // delivery custody; the receiving project is not expected to contain itself.
      const audit=await this.audit('receiving',projectId,'received-merchant-audit',{historyRevision:this.original.sourceRevision});
      need(same(audit.documents,h4.documents),'MERCHANT_FORWARD_DOCUMENTS','All original binary documents and epochs must survive forward receiving.');
      const actors=await this.actorAudit('receiving',projectId,'received-actors'),browser=await this.render('receiving',projectId,'receiving-forward');
      await this.stop('receiving');return{response:response.value.result,audit,actors,browser};
    });
    const cold={};for(const name of ['primary','receiving'])cold[name]=await this.phase(name+'-merchant-cold-reopen',async()=>{
      const opened=await this.start(name,'merchant-cold'),audit=await this.audit(name,projectId,name+'-merchant-cold',{historyRevision:this.original.sourceRevision});
      need(same(audit.documents,h4.documents),'MERCHANT_COLD_DOCUMENTS','Cold reopen must retain every complete native update, vector, document and epoch.');
      const actors=await this.actorAudit(name,projectId,name+'-cold-actors');await this.stop(name);return{opened,audit,actors};
    });
    return{h4,configuration,received,cold};
  }

  async stop(name){
    const host=this.state.hosts[name];if(!host?.applicationId)return;
    for(const run of host.starts.filter(x=>!x.closed)){
      await this.observed(name+'-stop',()=>this.apps.applicationsStop({applicationId:host.applicationId,operationId:run.requestId}));
      for(;;){
        const output=await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});
        if(output.active===false&&output.phase!=='OBSERVATION_UNAVAILABLE'){
          if(this.manager)for(const actor of Object.keys(this.actors??{operator:{}})){
            const alias=this.alias(name,actor),status=await this.call('status',{workspace:alias});
            if(status.state==='CONNECTED')await this.call('disconnect',{workspace:alias,launchId:status.launchId});
          }
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
      for(const [key,owner] of this.owners){for(;;){try{await owner.close();this.owners.delete(key);break;}catch(error){process.stderr.write(JSON.stringify({error:err(error),state:'NATIVE_OWNER_CLOSE_PENDING',key})+'\n');await delay(1000);}}}
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
      await this.close();
      const path=await exists(savedCandidate)?savedCandidate:savedResult,result=await json(path);
      need(result.schema==='stellar-forge.collaborative-documents-customer-result.v1'&&result.status==='complete'&&
        result.operationId===this.state.originalOperationId&&result.merchantOperationId===this.state.id&&
        result.completedAt===this.state.completedAt&&same(result.selection,this.selection),'MERCHANT_FINAL_CANDIDATE','Preserve the exact completed original integration candidate.');
      await verify(join(this.root,'result.json'),this.selection.originalResult);
      for(const f of result.artifacts)await verify(join(this.root,f.path),f);
      if(await exists(savedResult))need(same(await json(savedResult),result),'MERCHANT_FINAL_CANDIDATE','The published result differs from its frozen candidate.');
      if(this.state.status==='complete')await verify(savedResult,this.state.resultIdentity);
      else{await save(savedResult,result,{immutable:true});this.state.resultIdentity=await identity(savedResult);this.state.status='complete';await this.save();}
      return result;
    }
    this.state.attempts.push({id:randomUUID(),startedAt:now()});this.state.status='running';await this.save();
    try{
      const preparation=await this.prepare();preparation.originalRuntime=await this.preparationCustody();preparation.distribution=await this.distribution();
      const projectId=this.original.projectId;
      const primary=await this.phase('primary-complete-merchant-course',async()=>{
        const opening=await this.start('primary','primary-course');
        const original=await this.phase('primary-original-full-custody',()=>this.audit('primary',projectId,'primary-original',{historyRevision:this.original.sourceRevision}));
        const actors=await this.phase('primary-original-tenant-access',()=>this.actorAudit('primary',projectId,'primary-actors'));
        const mutation=await this.phase('primary-original-request-and-upload',()=>this.uploadAndReplay('primary',projectId));
        const grants=await this.phase('primary-retained-file-current-grant',()=>this.grantRevocation('primary',projectId));
        const edit=await this.phase('primary-original-native-edit',()=>this.nativeEdit('primary',projectId));
        const checkpoint=await this.phase('primary-original-complete-checkpoint',()=>this.checkpoint('primary',projectId,edit));
        const rendered=await this.phase('primary-original-browser-receiving',()=>this.render('primary',projectId,'primary'));
        await this.stop('primary');return{opening,original,actors,mutation,grants,edit,checkpoint,rendered};
      });
      const forward=await this.forwardEdition(projectId,primary.mutation);
      await this.close();
      await verify(join(this.root,'result.json'),this.selection.originalResult);
      for(const f of this.original.files)await verify(join(this.root,f.path),f);
      for(const f of Object.values(this.state.files))await verify(join(this.root,f.path),f);
      this.state.completedAt??=now();await this.save();
      const candidate={schema:'stellar-forge.collaborative-documents-customer-result.v1',operationId:this.state.originalOperationId,merchantOperationId:this.state.id,
        status:'complete',completedAt:this.state.completedAt,selection:this.selection,originalResult:{path:'result.json',...this.selection.originalResult},
        preparation,primary,forward,
        native:'The original three-document, two-tenant collaboration/migration/restore/rollback/receiving course remains immutable. One retained same-epoch edit and complete forward handoff extend it through Merchant.',
        presentation:{state:'RENDERED_OUTPUT_REQUIRES_OWNER_INSPECTION',instruction:'The producing peer must open and look at the exact rendered screenshots, operate relevant controls, inspect attachments and reopened exports before customer-facing readiness. See RECEIVING.md.'},
        artifacts:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path))};
      await save(savedCandidate,candidate,{immutable:true});await save(savedResult,candidate,{immutable:true});
      this.state.resultIdentity=await identity(savedResult);this.state.status='complete';await this.save();return candidate;
    }catch(error){this.state.status='interrupted';this.state.errors.push({at:now(),error:err(error)});await this.save();throw error;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2),{signal=null}={}){
  if(!argv.length||argv.includes('--help')){
    process.stdout.write('collaborative-documents-receive ORIGINAL_RECEIVING_FLAGS --merchant-workspace PRIVATE_RUNTIME_WORKSPACE --merchant-runtime READY_MERCHANT_INSTALLATION --merchant-preparation COMPLETE_PREPARED_JSON [--resume]\nContinues the same original native course through Applications, tenant-scoped MCP, native edit and complete receiving.\n');return{help:true};
  }
  const options=parse(argv),root=resolve(options.option.directory),lifetime=receivingLifetime(signal);options.lifetime=lifetime;
  let lease=null,course=null,originalOwner=null;
  try{
    const inspected=await inspectMerchantRuntime(options.merchant.runtime,{load:false});
    need(inspected.sourceRoot&&await realpath(inspected.sourceRoot)===SOURCE_ROOT,'MERCHANT_SOURCE_BINDING','Invoke from the exact selected installed Merchant source.');
    await inspectOriginalSource();
    const originalManifest=await json(join(HERE,'original-source.json')),receivingManifest=await json(resolve(options.option['source-manifest']));
    const rows=value=>value.files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
    need(receivingManifest.schema&&receivingManifest.sourceRef&&Array.isArray(receivingManifest.files)&&receivingManifest.files.length===50&&same(rows(receivingManifest),rows(originalManifest)),
      'MERCHANT_RECEIVING_SOURCE','The original receiving manifest must select all fifty exact original source files.');
    const prepared=await json(options.merchant.preparation);options.prepared=prepared;
    need(prepared.status==='READY'&&prepared.primary&&prepared.receiving&&prepared.source.manifestSha256===ORIGINAL_MANIFEST_SHA256,'MERCHANT_PREPARATION','Select the complete original preparation with both actual returned applications.');
    for(const [name,sourceKey,readyKey] of [['primary','source','runtime-ready'],['receiving','receiving-source','receiving-runtime-ready']]){
      const p=prepared[name];
      need(resolve(options.option[sourceKey])===p.applicationDirectory&&resolve(options.option[readyKey])===p.runtimeReadyFile,'MERCHANT_PREPARED_PATH','Preserve the actual prepared/received application and ready paths.');
      await inspectOriginalSource({directory:p.applicationDirectory});await verify(p.runtimeReadyFile,p.ready);
    }
    await verify(prepared.archive.path,prepared.archive);
    const module=await import(pathToFileURL(join(prepared.primary.applicationDirectory,'receiving/receive.mjs')).href);
    let original;
    try{original=await module.main(options.original,{signal:lifetime.signal});}
    catch(error){originalOwner=error.receivingOwner??(error.closeFailedReceiving?{close:error.closeFailedReceiving}:null);throw error;}
    need(original.state==='complete'&&original.referenceDocuments===3&&original.tenants===2,'MERCHANT_NATIVE_REQUIRED','Complete or reopen the same original native programme first.');
    const originalResult=await identity(join(root,'result.json'));
    const selection={sourceRoot:SOURCE_ROOT,merchantRuntime:options.merchant.runtime,merchantWorkspace:options.merchant.workspace,preparation:await identity(options.merchant.preparation),
      sourceManifestSha256:inspected.sourceManifestSha256,workbenchManifestSha256:ORIGINAL_MANIFEST_SHA256,originalOperationId:original.operationId,originalResult,
      primaryApplication:prepared.primary.applicationDirectory,receivingApplication:prepared.receiving.applicationDirectory,
      node:{executable:process.execPath,version:process.version},actorId:'operator'};
    // The unchanged receiver locks this exact original operation directory.
    // Acquire it only after that original owner has returned closed.
    lease=await acquireWorkspaceLease(root);course=new Course(root,options,selection,original,lease);await course.open();
    if(course.state.status!=='complete')await course.phase('00-selected-original-source',async()=>{
      await course.record('selected-merchant-runtime-'+hash(canonical(inspected)),inspected);await course.retain(join(root,'result.json'));
      for(const f of original.files){await verify(join(root,f.path),f);await course.retain(join(root,f.path));}
      return{originalResult};
    });
    return await course.run();
  }finally{
    if(originalOwner)for(;;){try{await originalOwner.close();break;}catch(error){process.stderr.write(JSON.stringify({error:err(error),state:'ORIGINAL_OWNER_CLOSE_PENDING'})+'\n');await delay(1000);}}
    if(course)await course.close();
    if(lease)await lease.close();await lifetime.finish();
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({error:err(error)})+'\n');process.exitCode=1;});
