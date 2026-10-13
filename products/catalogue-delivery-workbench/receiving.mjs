// SPDX-License-Identifier: MIT
// Complete installed receiving. Original private source and donor output are explicit inputs.
import {readFile,open,mkdir,lstat,realpath,rename,link,unlink,readdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {inspectCatalogueDeliveryPreparation,exportCatalogueDeliveryRuntime} from './prepare.mjs';
import {acquireLease,inspectOriginalSource} from './managed.mjs';
import {createCatalogueDeliveryReceivingBrowser} from './receiving-browser.mjs';
import merchantProvider from './merchant-provider.mjs';
import {initializeCatalogueDeliveryMerchant} from './setup.mjs';
import {readMerchantConfig} from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(HERE,'../..');
const SCHEMA='stellar-forge.catalogue-delivery-installed-receiving.v1',HELPER=join(HERE,'receiving-original.py');
const hash=b=>createHash('sha256').update(b).digest('hex'),now=()=>new Date().toISOString();
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b),delay=ms=>new Promise(r=>setTimeout(r,ms));
const need=(yes,message)=>{if(!yes)throw Object.assign(new Error(message),{code:'CATALOGUE_DELIVERY_RECEIVING'});};
const errorValue=e=>({code:e.code??'CATALOGUE_DELIVERY_RECEIVING',message:e.message});
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid()),'Use a canonical owned private directory.');}
function child(root,path){const p=relative(root,path);need(p&&!p.startsWith('..')&&!isAbsolute(p),'Retain artifacts within this private receiving operation.');return p.split('\\').join('/');}
async function identity(path){
  const s=await lstat(path);need(s.isFile()&&!s.isSymbolicLink()&&await realpath(path)===path,'Select a canonical ordinary file.');
  const f=await open(path,'r'),h=createHash('sha256');let bytes=0;
  try{for await(const b of f.createReadStream({autoClose:false})){h.update(b);bytes+=b.length;}
    const t=await f.stat();need(s.dev===t.dev&&s.ino===t.ino&&s.size===t.size&&s.mtimeMs===t.mtimeMs&&bytes===t.size,'The selected file changed while reading.');}
  finally{await f.close();}
  return{path,bytes,sha256:h.digest('hex')};
}
async function verify(row){const v=await identity(row.path);need(v.bytes===row.bytes&&v.sha256===row.sha256,'The original retained file changed: '+row.path);return v;}
async function syncDirectory(path){const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
async function bytes(path,raw,immutable=true){
  await privateDirectory(dirname(path));
  if(immutable&&await exists(path)){need((await readFile(path)).equals(raw),'Immutable receiving bytes differ.');return identity(path);}
  const temp=path+'.writing-'+randomUUID(),f=await open(temp,'wx',0o600);
  try{await f.writeFile(raw);await f.sync();}finally{await f.close();}
  try{if(immutable){try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await readFile(path)).equals(raw),'The retained artifact differs.');}}
    else await rename(temp,path);await syncDirectory(dirname(path));}
  finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return identity(path);
}
const save=(path,value,immutable=true)=>bytes(path,Buffer.from(JSON.stringify(value,null,2)+'\n'),immutable);
async function copy(source,target,expected){
  const selected=expected??await identity(source);await verify({...selected,path:source});await privateDirectory(dirname(target));
  if(await exists(target)){const value=await verify({...selected,path:target});return value;}
  const temp=target+'.copy-'+randomUUID();let input=null,output=null;
  try{input=await open(source,'r');output=await open(temp,'wx',0o600);
    for await(const b of input.createReadStream({autoClose:false}))await output.writeFile(b);await output.sync();}
  finally{try{if(input)await input.close();}finally{if(output)await output.close();}}
  await verify({...selected,path:temp});
  try{try{await link(temp,target);}catch(e){if(e.code!=='EEXIST')throw e;await verify({...selected,path:target});}await syncDirectory(dirname(target));}
  finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return identity(target);
}
async function selectedPort(){
  const server=createServer();let active=false;
  try{await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{active=true;ok();});});return server.address().port;}
  finally{if(active)await new Promise((ok,no)=>server.close(e=>e?no(e):ok()));}
}
async function command(python,argv,directory){
  await privateDirectory(directory);const attempt=randomUUID(),outPath=join(directory,attempt+'.stdout'),errPath=join(directory,attempt+'.stderr');
  let out=null,err=null,processChild,closed,ended=false,childError,exitCode,signal;
  const selected={python,argv,cwd:directory,attempt,startedAt:now()};
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};for(const k of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP'])delete env[k];
  const stop=()=>{if(processChild&&!ended)processChild.kill('SIGTERM');};
  try{
    out=await open(outPath,'wx',0o600);err=await open(errPath,'wx',0o600);
    await save(join(directory,attempt+'.request.json'),selected);
    processChild=spawn(python,argv,{cwd:directory,env,stdio:['ignore',out.fd,err.fd],windowsHide:true});
    closed=new Promise(ok=>{processChild.once('error',e=>{childError=e;});processChild.once('close',(code,sig)=>{ended=true;exitCode=code;signal=sig;ok();});});
    process.on('SIGTERM',stop);process.on('SIGINT',stop);await closed;await out.sync();await err.sync();
    const completion={...selected,closedAt:now(),exitCode,signal,error:childError?errorValue(childError):null};
    await save(join(directory,attempt+'.closed.json'),completion);
    if(childError)throw childError;
    need(exitCode===0,'The selected original helper closed unsuccessfully; retain and resume its exact request. '+(await readFile(errPath,'utf8')).slice(-3000));
    const value=JSON.parse(await readFile(outPath,'utf8'));
    return{value,files:[outPath,errPath,join(directory,attempt+'.request.json'),join(directory,attempt+'.closed.json')]};
  }finally{
    try{if(closed){if(!ended)stop();await closed;}}
    finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);
      try{if(out)await out.close();}finally{if(err)await err.close();}}
  }
}
function parse(argv){
  const out={},allowed=new Set(['directory','merchant-workspace','merchant-runtime','preparation-result','original-request','playwright','chromium','actor','resume']);
  for(let i=0;i<argv.length;i++){const k=argv[i].startsWith('--')?argv[i].slice(2):'';need(allowed.has(k)&&!Object.hasOwn(out,k),'Use each declared receiving option once.');
    if(k==='resume')out[k]=true;else{need(i+1<argv.length&&!argv[i+1].startsWith('--'),'Missing receiving option value.');out[k]=argv[++i];}}
  for(const k of ['directory','merchant-workspace','merchant-runtime','preparation-result','original-request','playwright','chromium'])need(typeof out[k]==='string'&&isAbsolute(out[k])&&resolve(out[k])===out[k],'Select absolute canonical '+k+'.');
  out.actor??='Installed catalogue delivery operator';need(out.actor.trim()===out.actor&&out.actor.length>0&&out.actor.length<=120&&!/[\x00-\x1f\x7f]/.test(out.actor),'Select a readable original operator identity.');
  return out;
}
class Course{
  constructor(options,prepared,donor,selection){this.o=options;this.prepared=prepared;this.donor=donor;this.selection=selection;this.root=options.directory;
    this.path=join(this.root,'operation.json');this.bound=false;this.apps=null;this.manager=null;this.browserOwner=null;this.closing=null;this.tail=Promise.resolve();}
  async open(){
    this.state=await exists(this.path)?await json(this.path):{schema:SCHEMA,id:randomUUID(),selection:this.selection,startedAt:now(),status:'prepared',phases:{},hosts:{},files:{},errors:[]};
    need(this.state.schema===SCHEMA&&same(this.state.selection,this.selection),'Resume the exact original installed receiving selection.');
    if(await exists(this.path))need(this.o.resume||this.state.status==='complete','Use --resume for this existing receiving operation.');
    this.bound=true;await this.save();this.apps=await openRuntimeWorkspace({directory:this.o['merchant-workspace']});
  }
  save(){const value=JSON.parse(JSON.stringify(this.state));const p=this.tail.then(()=>save(this.path,value,false));this.tail=p.catch(()=>{});return p;}
  async retain(path){const v=await identity(path);child(this.root,path);this.state.files[path]=v;await this.save();return v;}
  async record(name,value){const path=join(this.root,'records',name+'.json');await save(path,value);await this.retain(path);return value;}
  async intent(name,produce){
    const path=join(this.root,'intents',name+'.json');
    if(await exists(path)){const value=await json(path);await this.retain(path);return value;}
    const value=await produce();await save(path,value);await this.retain(path);return value;
  }
  async phase(name,fn){
    if(this.state.phases[name]?.complete)return this.state.phases[name].value;
    this.state.activePhase=name;this.state.phases[name]??={startedAt:now()};await this.save();
    process.stdout.write(JSON.stringify({receivingId:this.state.id,phase:name})+'\n');
    const value=await fn();this.state.phases[name]={...this.state.phases[name],complete:true,completedAt:now(),value};await this.save();return value;
  }
  async copy(source,target,expected){const value=await copy(source,join(this.root,target),expected);return this.retain(value.path);}
  async helper(name,action,extra={},source='primary'){
    const selected=this.prepared[source],selectionPath=join(this.root,'private','helper-'+source+'.json');
    await save(selectionPath,{schema:'stellar-forge.catalogue-delivery-original-receiving.v1',
      applicationDirectory:selected.applicationDirectory,sourceManifestFile:selected.sourceManifestFile,sourceManifestSha256:selected.sourceManifestSha256});
    const request=await this.intent('helper-'+name,async()=>({id:name,action,...extra}));
    const {id:originalId,...body}=request;need(originalId===name&&same(body,{action,...extra}),'Keep the original complete helper request.');
    const requestPath=join(this.root,'intents','helper-'+name+'.json');
    const result=await command(selected.python,['-I','-B',HELPER,'--selection',selectionPath,'--request',requestPath,'--directory',join(this.root,'original-helper-'+source)],join(this.root,'commands'));
    for(const path of result.files)await this.retain(path);
    const value=result.value;need(value.schema==='stellar-forge.catalogue-delivery-original-result.v1'&&value.id===name&&value.action===action,'Original helper result selected another request.');
    for(const row of [...value.artifacts,value.resultFile]){await verify(row);if(relative(this.root,row.path)&&!relative(this.root,row.path).startsWith('..'))await this.retain(row.path);}
    await this.retain(selectionPath);await this.record('helper-result-'+name,value);return value;
  }

  async prepare(){
    const attached=await this.phase('01-installed-runtime',()=>this.apps.attach({directory:this.o['merchant-runtime'],label:'Catalogue Delivery Workbench installed receiving'}));
    need(attached.status==='READY'&&attached.runtimeId,'Select the complete installed Merchant runtime.');this.runtimeId=attached.runtimeId;
    const inspected=await this.phase('02-original-complete-native-editions',()=>this.helper('original-donor','inspect-original',this.donor.donor));
    const primary=await this.phase('03-primary-original-receive',()=>this.helper('primary-original-receive','receive',{
      ...this.donor.donor,directory:join(this.root,'primary-receiving')}));
    for(const name of ['primary','receiving']){
      const container=join(this.root,name+'-receiving'),directory=join(container,'original-implementation','workspace');
      await privateDirectory(directory);
      const leaseRoot=join(directory,'package-request-journal');await privateDirectory(leaseRoot);
      const port=await this.intent(name+'-loopback-port',selectedPort);
      this.state.hosts[name]??={name,container,directory,leaseRoot,port,connectionFile:join(this.root,'private',name+'-connection.json'),
        configurationFile:join(this.root,'private',name+'-launch.json'),starts:[]};
      need(this.state.hosts[name].directory===directory&&this.state.hosts[name].leaseRoot===leaseRoot&&this.state.hosts[name].port===port,'Keep the original host, request journal and loopback port.');
    }
    need(primary.value.workspace===this.state.hosts.primary.directory&&primary.value.leaseRoot===this.state.hosts.primary.leaseRoot,'Use the original receiver returned Store and request journal.');
    await this.save();await this.setup();
    const tools=merchantProvider.tools((name,description,properties,required)=>({name,description,properties,required}));
    need(tools.length===49&&new Set(tools.map(x=>x.name)).size===49,'Retain the original34 native operations and15 installed operations.');
    await this.record('complete-tool-catalog',tools);
    return{runtimeId:this.runtimeId,original:inspected,primary,tools:tools.map(x=>x.name)};
  }
  async setup(){
    if(this.manager){await this.manager.close();this.manager=null;}
    const workspaces={};for(const[name,h]of Object.entries(this.state.hosts))
      workspaces[name]={label:name+' catalogue delivery',directory:h.directory,connectionFile:h.connectionFile,
        inputs:{},producers:{},targets:{},credentials:{},destinations:{}};
    const path=join(this.root,'private','agent-host.json');
    await save(path,{schema:'stellar-forge.catalogue-delivery-host.v1',workspaces});await this.retain(path);
    const setup=await initializeCatalogueDeliveryMerchant({directory:join(this.root,'agent'),connection:path,name:'Installed catalogue delivery receiving'});
    await this.record('setup-'+hash(canonical(setup)),setup);
    const config=await readMerchantConfig(setup.configuration);this.manager=await merchantProvider.create(await merchantProvider.load(),config);
    this.agentConfiguration=setup.configuration;await this.retain(setup.configuration);return setup;
  }
  call(name,args={}){return this.manager.call('merchant_catalogue_'+name,args);}
  async response(name,args,key){
    const selected=await this.call(name,args);
    need(selected.fileId,'The original operation has no retained response; inspect its saved dispatch before continuing.');
    const value=await this.full(args.workspace,selected,key,{parse:true});
    need(selected.ok!==false&&!value?.error,'The complete original response reports an error: '+(value?.error?.message??name));
    return{retained:selected,value};
  }
  async approval(alias,id,key){
    return(await this.response('approval_inspect',{workspace:alias,collection:'records',id},key)).value;
  }
  async full(alias,retained,key,{parse=false}={}){
    need(retained.fileId&&/^[0-9a-f]{64}$/.test(retained.sha256)&&Number.isSafeInteger(retained.bytes),'Use the complete retained original response descriptor.');
    const path=join(this.root,'retained',alias,retained.sha256+'.content');await privateDirectory(dirname(path));
    let readId=null,offset=0,total=0;const digest=createHash('sha256'),temp=path+'.reading-'+randomUUID(),file=await open(temp,'wx',0o600);
    try{
      for(;;){
        const part=await this.call('file',{workspace:alias,fileId:retained.fileId,expectedSha256:retained.sha256,offset,limit:196608,...(readId?{readId}:{})});
        need(part.encoding==='base64'&&part.offset===offset&&part.file.sha256===retained.sha256&&part.file.bytes===retained.bytes,'Full retained file selection changed.');
        const raw=Buffer.from(part.data,'base64');need(raw.toString('base64')===part.data&&raw.length===part.bytesRead&&(raw.length>0||retained.bytes===0),'The original retained byte range differs.');
        await file.writeFile(raw);digest.update(raw);offset+=raw.length;total++;readId=part.readId;
        if(part.nextOffset===null){readId=null;need(offset===retained.bytes,'The complete original file ended early.');break;}
        need(part.nextOffset===offset&&offset<retained.bytes,'Follow the complete original file cursor.');
      }
      need(digest.digest('hex')===retained.sha256,'The complete original response digest differs.');await file.sync();
    }finally{try{await file.close();}finally{if(readId)await this.call('file_release',{workspace:alias,readId});}}
    try{try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;await verify({...retained,path});}await syncDirectory(dirname(path));}
    finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    const actual=await this.retain(path);await this.record('file-'+hash(key+'\0'+retained.sha256),{key,workspace:alias,fileId:retained.fileId,file:actual,ranges:total});
    return parse?json(path):actual;
  }
  async app(name){const s=await this.apps.applicationsState({historyLimit:100});return s.applications.find(x=>x.id===this.state.hosts[name].applicationId);}
  async configure(name){
    const host=this.state.hosts[name],selected=this.prepared[name];need(host.leaseRoot,'Select the original received request journal before managed launch.');
    const config={schema:'stellar-forge.catalogue-delivery-workbench-launch.v1',directory:host.directory,applicationDirectory:selected.applicationDirectory,
      sourceManifestFile:selected.sourceManifestFile,sourceManifestSha256:selected.sourceManifestSha256,python:selected.python,connectionFile:host.connectionFile,
      actor:this.o.actor,worker:false,environment:{},leaseRoot:host.leaseRoot,port:host.port};
    await save(host.configurationFile,config);await this.retain(host.configurationFile);
    const value=await this.phase('application-'+name+'-save',async()=>{
      const review=await this.intent('application-'+name+'-review',()=>this.apps.applicationsReview({runtimeId:this.runtimeId,kind:'catalogue-delivery-workbench',providerId:'catalogue-delivery-workbench',
        settings:{configurationFile:host.configurationFile,port:host.port},label:'Installed catalogue delivery '+name}));
      const request=await this.intent('application-'+name+'-save',async()=>({requestId:randomUUID(),reviewId:review.id}));
      const answer=await this.apps.applicationsSave(request);await this.record('application-'+name+'-saved',answer);return{applicationId:answer.applicationId};
    });
    host.applicationId=value.applicationId;await this.save();
  }
  async start(name,stage){
    await this.configure(name);const h=this.state.hosts[name];
    for(let i=0;;i++){const a=await this.app(name);need(a,'The original saved application is absent.');if(a.release&&a.connectionReady===true)break;
      if(i===0||a.adoption?.active===false)await this.apps.applicationsConnect({applicationId:a.id});
      need(i<600,'Original Applications connection remains pending; resume its saved selection.');await delay(1000);}
    let run=h.starts.find(x=>x.stage===stage&&!x.closed);
    if(!run){const a=await this.app(name);need(!a.current||a.current.active===false&&!['PENDING','QUEUED','INTERRUPTED','OBSERVATION_UNAVAILABLE'].includes(a.current.phase),'Reconcile the original managed owner first.');
      const review=await this.apps.applicationsStartReview({applicationId:h.applicationId});run={stage,requestId:randomUUID(),reviewId:review.id,createdAt:now()};h.starts.push(run);await this.save();await this.record(name+'-'+run.requestId+'-review',review);}
    await this.apps.applicationsStart({applicationId:h.applicationId,requestId:run.requestId,reviewId:run.reviewId});
    let recovered=false;
    for(let i=0;i<600;i++){
      const a=await this.app(name),actual=a?.runs.find(x=>x.id===run.requestId);
      if(actual?.active===true&&actual.privateUrl){
        const status=await this.call('connections',{workspace:name});if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});
        const connection=await this.call('connect',{workspace:name});
        need(connection.directory===h.directory&&connection.applicationDirectory===this.prepared[name].applicationDirectory&&
          connection.sourceManifestSha256===this.prepared.source.manifestSha256&&connection.actor===this.o.actor&&Number(new URL(connection.origin).port)===h.port&&connection.worker===false&&connection.leaseRoot===h.leaseRoot,'Managed source, actor or origin selection changed.');
        h.origin=connection.origin;run.launchId=connection.launchId;await this.save();
        await this.record(name+'-'+run.requestId+'-connection-'+hash(canonical(connection)),connection);
        return{launchId:connection.launchId,origin:connection.origin,operationId:run.requestId,applicationId:h.applicationId};
      }
      if(actual?.active===false&&!recovered&&this.o.resume&&['INTERRUPTED','FAILED','QUEUED'].includes(actual.phase)){await this.apps.applicationsRecover({applicationId:h.applicationId,operationId:run.requestId});recovered=true;}
      else need(!actual||actual.active!==false||!['FAILED','CANCELLED','SUCCEEDED'].includes(actual.phase),'The saved managed launch ended before readiness.');
      await delay(1000);
    }
    throw Error('The original managed launch remains pending; resume its same request.');
  }
  async catalogue(alias,key){
    const files=[];let offset=0;
    for(;;){const page=await this.call('files',{workspace:alias,offset,limit:100});need(page.offset===offset&&Array.isArray(page.files),'Retain the complete agent file catalogue.');
      files.push(...page.files);if(page.nextOffset===null){need(files.length===page.total,'The original file population changed during listing.');break;}
      need(page.nextOffset>offset,'The file cursor stalled.');offset=page.nextOffset;}
    const rows=[];for(const row of files)rows.push(await this.full(alias,row,key+'-'+row.fileId));
    await this.record(key,{files,complete:rows});return{files,complete:rows};
  }

  async reads(alias,key){
    const status=(await this.response('status',{workspace:alias},key+'-status')).value;
    need(status.workspace===this.state.hosts[alias].directory&&status.approval.enabled===true,'Select the original complete joined workspace.');
    const catalog=(await this.response('catalogue',{workspace:alias},key+'-catalogue')).value;
    need(Array.isArray(catalog.tools)&&catalog.tools.length===34&&new Set(catalog.tools.map(x=>x.name)).size===34,'The original34-tool source catalog differs.');
    const state={records:{},approval:{},implementation:null},files=[],sources=[];
    for(const [kind,collections]of [['records',['sources','targets','plans','jobs','feeds']],['approval_records',['profiles','records','operations','observations']]]){
      for(const collection of collections){
        const rows=[];let cursor=null,total=null;
        for(let page=0;;page++){
          const args={workspace:alias,collection,limit:100,...(cursor?{cursor}:{})};
          const selected=await this.response(kind,args,key+'-'+kind+'-'+collection+'-'+page),value=selected.value;
          need(value.collection===collection&&Array.isArray(value.records),'Retain complete original record pages.');
          if(total===null)total=value.total;need(total===value.total,'The original collection changed during receiving.');
          rows.push(...value.records);
          if(value.nextCursor===null){need(rows.length===total,'The complete original record population differs.');break;}
          need(typeof value.nextCursor==='string'&&value.nextCursor!==cursor&&value.records.length,'The original cursor stalled.');cursor=value.nextCursor;
        }
        need(new Set(rows.map(x=>x.id)).size===rows.length,'The original collection repeated a record.');
        const exact={};
        for(const row of rows){
          const observed=await this.response(kind==='records'?'inspect':'approval_inspect',{workspace:alias,collection,id:row.id},key+'-'+kind+'-'+collection+'-'+row.id);
          need(observed.value.record.id===row.id,'Original inspection returned another record.');
          exact[row.id]=observed.value.record;
        }
        state[kind==='records'?'records':'approval'][collection]=exact;
      }
    }
    state.implementation=(await this.response('implementation_read',{workspace:alias,kind:'get',implementationId:this.donor.donor.implementationId},key+'-implementation')).value;
    need(state.implementation.id===this.donor.donor.implementationId&&state.implementation.revision===this.donor.donor.revision,'The selected complete implementation changed.');
    for(const item of this.donor.donor.approvals){
      const source=state.records.sources[item.sourceId],job=state.records.jobs[item.jobId],review=state.approval.records[item.recordId];
      need(source&&source.sha256===item.sha256&&source.bytes===item.bytes&&source.row_count===item.rows&&
        job?.state==='DONE'&&job.source_id===item.sourceId&&review?.delivery_job_id===item.jobId,
        'The original completed source, delivery and review selection differs.');
      const retained=await this.call('artifact',{workspace:alias,uri:'catalogue://sources/'+item.sourceId+'/csv',expectedSha256:item.sha256,expectedBytes:item.bytes});
      const file=await this.full(alias,retained,key+'-source-'+item.sourceId);files.push({retained,file});
      let offset=0;const pages=[];
      for(;;){
        const page=await this.response('read_rows',{workspace:alias,source_id:item.sourceId,offset,limit:500},key+'-rows-'+item.sourceId+'-'+offset),v=page.value;
        need(v.source_id===item.sourceId&&v.sha256===item.sha256&&v.offset===offset&&v.total_rows===item.rows&&
          Array.isArray(v.rows)&&v.returned_rows===v.rows.length&&same(v.columns,source.columns),'The original complete row page differs.');
        pages.push({offset,rows:v.returned_rows,fileId:page.retained.fileId,sha256:page.retained.sha256,bytes:page.retained.bytes});
        offset+=v.rows.length;
        if(v.next_offset===null){need(v.complete===true&&offset===item.rows,'The original row course ended early.');break;}
        need(v.next_offset===offset&&v.rows.length>0,'The original row cursor stalled.');
      }
      sources.push({sourceId:item.sourceId,rows:offset,pages,file});
    }
    await this.record(key+'-complete',{state,sources,files,catalog});return{state,sources,files,catalog};
  }
  async browser(alias,key){
    return this.phase(key,async()=>{
      const h=this.state.hosts[alias],selected=this.prepared[alias],recordId=this.donor.donor.approvals[1].recordId;
      const note=await this.intent(key+'-note',async()=>{
        const before=(await this.approval(alias,recordId,key+'-before')).record;
        return{recordId,before,text:before.notes+'\n'+(alias==='primary'?
          'Installed receiving retained the complete original catalogue and both native review editions.':
          'Independent receiving preserved the complete earlier history and this later local review note.')};
      });
      this.browserOwner=createCatalogueDeliveryReceivingBrowser({directory:join(this.root,'browser',key),connectionFile:h.connectionFile,
        workspaceDirectory:h.directory,applicationDirectory:selected.applicationDirectory,sourceManifestSha256:selected.sourceManifestSha256,
        implementationId:this.donor.donor.implementationId,approvals:this.donor.donor.approvals.map(({recordId,sourceId,jobId,rows,bytes,sha256})=>({recordId,sourceId,jobId,rows,bytes,sha256})),
        note,actor:this.o.actor,playwright:this.o.playwright,chromium:this.o.chromium,source:this.selection.source});
      let result;try{result=await this.browserOwner.run();}finally{await this.browserOwner.close();this.browserOwner=null;}
      need(result.schema==='stellar-forge.catalogue-delivery-browser-result.v1'&&result.state==='COMPLETE','The original browser course is incomplete.');
      for(const row of [...result.files,result.resultFile]){await verify(row);await this.retain(row.path);}return result;
    });
  }
  async agentArchives(alias,key){
    return this.phase(key,async()=>{
      const implementationArgs=await this.intent(key+'-implementation-request',async()=>({workspace:alias,requestId:randomUUID(),
        action:'export',implementationId:this.donor.donor.implementationId,payload:{revision:this.donor.donor.revision}}));
      const implementation=await this.response('implementation_action',implementationArgs,key+'-implementation-response');
      const again=await this.response('implementation_action',implementationArgs,key+'-implementation-replay');
      need(same(again.value,implementation.value),'The same installed implementation export request changed.');
      const iv=implementation.value;need(typeof iv.download_url==='string'&&/^[0-9a-f]{64}$/.test(iv.sha256)&&Number.isSafeInteger(iv.bytes),'Keep the original full implementation export descriptor.');
      const retained=await this.call('artifact',{workspace:alias,route:iv.download_url,expectedSha256:iv.sha256,expectedBytes:iv.bytes});
      const implementationArchive=await this.full(alias,retained,key+'-implementation-archive'),approvals=[];
      for(const [index,item]of this.donor.donor.approvals.entries()){
        const args=await this.intent(key+'-approval-'+index+'-request',async()=>({workspace:alias,requestId:randomUUID(),record_id:item.recordId}));
        const response=await this.response('approval_export',args,key+'-approval-'+index+'-response');
        const replay=await this.response('approval_export',args,key+'-approval-'+index+'-replay');
        need(same(response.value,replay.value),'The same retained original approval export response changed.');
        const d=response.value.artifact;need(d&&d.uri&&/^[0-9a-f]{64}$/.test(d.sha256),'Select the original complete approval artifact.');
        const file=await this.call('artifact',{workspace:alias,uri:d.uri,expectedSha256:d.sha256,expectedBytes:d.bytes});
        approvals.push({...item,archive:await this.full(alias,file,key+'-approval-'+index+'-archive'),
          phaseArchive:item.phaseArchive??item.archive,agentResponse:response.retained});
      }
      return{implementationArchive,approvals,implementationId:this.donor.donor.implementationId,
        revision:this.donor.donor.revision,nativeOperationId:this.donor.donor.nativeOperationId};
    });
  }
  browserSelection(browser){
    return{nativeOperationId:this.donor.donor.nativeOperationId,implementationId:this.donor.donor.implementationId,
      revision:this.donor.donor.revision,implementationArchive:browser.implementation.archive,
      approvals:this.donor.donor.approvals.map((item,index)=>({...item,archive:browser.approval[index].archive,phaseArchive:item.phaseArchive??item.archive}))};
  }
  async distribution(){
    return this.phase('04-complete-private-and-public-handovers',async()=>{
      const chosen=await this.intent('distribution',async()=>{
        const planPath=join(this.o['merchant-runtime'],'runtime-install.json'),plan=await json(planPath),manifestPath=join(this.o['merchant-runtime'],'package','manifest.json'),manifest=await identity(manifestPath),archive=await identity(plan.archivePath);
        need(plan.source.manifestSha256===manifest.sha256&&manifest.sha256===this.selection.merchantSourceManifestSha256&&archive.sha256===plan.archiveSha256,'The installed distribution selection changed.');
        return{plan:await identity(planPath),manifest,archive,handoff:await this.apps.handoff(this.runtimeId)};
      });
      const files=[];for(const [name,row]of Object.entries({installation:chosen.plan,manifest:chosen.manifest,archive:chosen.archive}))files.push(await this.copy(row.path,'distribution/'+name+(name==='archive'?'.tar.gz':'.json'),row));
      await this.record('runtime-workspace-handoff',chosen.handoff);
      files.push(await this.copy(this.o['preparation-result'],'private-source/PREPARED.json',this.selection.preparationResult));
      files.push(await this.copy(this.prepared.request.path,'private-source/REQUEST.json',this.prepared.request));
      files.push(await this.copy(this.prepared.primary.sourceManifestFile,'private-source/SOURCE.json'));
      const output=join(this.root,'private-source','complete-private-source.zip');await privateDirectory(dirname(output));
      const portable=await exportCatalogueDeliveryRuntime({directory:this.prepared.directory,python:this.prepared.primary.python,output});
      need(portable.state==='EXPORTED'&&portable.source.manifestSha256===this.prepared.source.manifestSha256,'Retain the complete prepared private source export.');
      files.push(await this.retain(portable.portable.path));await this.record('private-source-export',portable);
      return{files,handoff:chosen.handoff,portable};
    });
  }
  async stop(name){
    const host=this.state.hosts[name];if(!host?.applicationId)return;
    const cancelled=v=>v?.schema==='stellar-forge.application-run-cancellation.v1'&&v.applicationId===host.applicationId&&v.state==='CANCELLED'&&v.launched===false;
    const closed=v=>{const r=v?.commandResult;return v?.active===false&&v.phase==='SUCCEEDED'&&r?.operation==='original-command'&&typeof r.completedAt==='string'&&Number.isFinite(Date.parse(r.completedAt))&&
      (r.state==='STOPPED'&&r.stopped===true&&r.launched===false||r.launched===true&&['STOPPED','COMPLETED','EXITED'].includes(r.state)&&(Number.isInteger(r.exitCode)||typeof r.signal==='string'&&r.signal.length>0));};
    for(const run of host.starts.filter(x=>!x.closed)){
      const proof=await this.intent(name+'-'+run.requestId+'-closed',async()=>{
        const cancellation=await this.apps.applicationsStop({applicationId:host.applicationId,operationId:run.requestId});
        if(cancelled(cancellation)&&cancellation.operationId===run.requestId)return{applicationId:host.applicationId,operationId:run.requestId,cancellation,output:null,closedAt:now()};
        for(;;){const output=await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});if(output.operationId===run.requestId&&closed(output))return{applicationId:host.applicationId,operationId:run.requestId,cancellation:null,output,closedAt:now()};await delay(1000);}
      });
      need(proof.applicationId===host.applicationId&&proof.operationId===run.requestId&&
        (cancelled(proof.cancellation)&&proof.cancellation.operationId===run.requestId||proof.output?.operationId===run.requestId&&closed(proof.output)),'Retain the actual original command closure proof.');
      if(this.manager){const status=await this.call('connections',{workspace:name});if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});}
      run.closed=true;run.closedAt=proof.closedAt;await this.save();
    }
  }
  close(){
    if(this.closing)return this.closing;
    // Diagnostics must not abandon the original child, client or file owners.
    const report=value=>{try{process.stderr.write(JSON.stringify(value)+'\n');}catch{}};
    this.closing=(async()=>{
      if(!this.bound)return;
      if(!this.apps&&Object.values(this.state?.hosts??{}).some(h=>h.starts.some(x=>!x.closed)))
        for(;;){try{this.apps=await openRuntimeWorkspace({directory:this.o['merchant-workspace']});break;}
          catch(e){report({state:'ORIGINAL_APPLICATION_OBSERVER_PENDING',error:errorValue(e)});await delay(1000);}}
      if(this.browserOwner)for(;;){try{await this.browserOwner.close();this.browserOwner=null;break;}
        catch(e){report({state:'BROWSER_CLOSING',error:errorValue(e)});await delay(1000);}}
      for(const name of Object.keys(this.state?.hosts??{}))while(this.state.hosts[name].starts.some(x=>!x.closed)){
        try{await this.stop(name);}
        catch(e){report({state:'APPLICATION_CLOSING',workspace:name,error:errorValue(e)});await delay(1000);}}
      if(this.manager)for(;;){try{await this.manager.close();this.manager=null;break;}
        catch(e){report({state:'AGENT_CLOSING',error:errorValue(e)});await delay(1000);}}
      if(this.apps)for(;;){try{await this.apps.close();this.apps=null;break;}
        catch(e){report({state:'APPLICATION_WORKSPACE_CLOSING',error:errorValue(e)});await delay(1000);}}
      await this.tail;
    })().finally(()=>{this.closing=null;});return this.closing;
  }
  async finalize(candidate){
    need(candidate.schema==='stellar-forge.catalogue-delivery-installed-result.v1'&&candidate.state==='COMPLETE'&&candidate.receivingId===this.state.id&&same(candidate.selection,this.selection),'Adopt only the original complete candidate.');
    for(const row of candidate.files)await verify(row);
    const path=join(this.root,'INSTALLED_RESULT.json');await save(path,candidate);this.state.result=await identity(path);
    const rows=[...candidate.files,this.state.result].map(row=>({...row,name:child(this.root,row.path)})).sort((a,b)=>a.name.localeCompare(b.name));
    const handover=await this.helper('complete-installed-handover','bundle',{files:rows});
    this.state.handover=handover.value.archive;this.state.status='complete';await this.save();
    return{...candidate,resultFile:this.state.result,handover:handover.value};
  }

  async run(){
    const candidatePath=join(this.root,'candidate.json'),resultPath=join(this.root,'INSTALLED_RESULT.json');
    if(await exists(candidatePath)||await exists(resultPath)){await this.close();return this.finalize(await json(await exists(candidatePath)?candidatePath:resultPath));}
    this.state.status='running';await this.save();
    try{
      const installation=await this.prepare(),distribution=await this.distribution();
      const originalInputs=await this.phase('04a-complete-original-input-custody',async()=>{
        const rows=[['implementation.zip',this.donor.donor.implementationArchive]];
        for(const [i,item]of this.donor.donor.approvals.entries()){
          rows.push(['approval-'+(i+1)+'.zip',item.archive],['native-phase-'+(i+1)+'.json',item.phase]);
          if(item.phaseArchive)rows.push(['original-native-approval-'+(i+1)+'.zip',item.phaseArchive]);
        }
        const files=[];for(const[name,row]of rows)files.push(await this.copy(row.path,'original/'+name,row));
        files.push(await this.copy(this.o['original-request'],'original/SELECTION.json',this.selection.originalRequest));
        return files;
      });
      const primary=await this.phase('05-primary-installed-course',async()=>{
        const opening=await this.start('primary','primary-main');
        const before=await this.phase('05a-complete-original-agent-reads',()=>this.reads('primary','primary-original'));
        const browser=await this.browser('primary','05b-primary-browser');
        const reads=await this.phase('05c-complete-current-agent-reads',()=>this.reads('primary','primary-current'));
        const agentArchives=await this.agentArchives('primary','05d-complete-agent-archives');
        const files=await this.phase('05e-primary-retained-files',()=>this.catalogue('primary','primary-files'));
        await this.stop('primary');
        const note={recordId:browser.selection.note.recordId,text:browser.selection.note.text,revision:browser.edit.record.revision};
        const audit=await this.phase('05f-primary-original-audit',()=>this.helper('primary-current-audit','audit',{
          directory:this.state.hosts.primary.container,expectedSnapshot:installation.primary.value.snapshot,notes:note}));
        const browserPackage=await this.phase('05g-full-browser-archives-opened',()=>this.helper('primary-browser-archives','inspect-original',this.browserSelection(browser)));
        const browserEquality=await this.phase('05h-browser-full-snapshot-equality',()=>this.helper('primary-browser-equality','compare',{before:audit.value.snapshot,after:browserPackage.value.snapshot}));
        const agentPackage=await this.phase('05i-full-agent-archives-opened',()=>this.helper('primary-agent-archives','inspect-original',agentArchives));
        const agentEquality=await this.phase('05j-agent-full-snapshot-equality',()=>this.helper('primary-agent-equality','compare',{before:audit.value.snapshot,after:agentPackage.value.snapshot}));
        return{opening,before,browser,reads,agentArchives,files,note,audit,browserPackage,browserEquality,agentPackage,agentEquality};
      });
      const receiving=await this.phase('06-independent-receiving-course',async()=>{
        const request=await this.intent('independent-original-receiving-selection',async()=>({
          ...this.browserSelection(primary.browser),directory:this.state.hosts.receiving.container}));
        const received=await this.phase('06a-receive-all-three-original-archives',()=>this.helper('independent-full-receive','receive',request,'receiving'));
        need(received.value.workspace===this.state.hosts.receiving.directory&&received.value.leaseRoot===this.state.hosts.receiving.leaseRoot,'Independent receiving returned another original Store or request journal.');
        const initialEquality=await this.phase('06b-complete-received-snapshot',()=>this.helper('receiving-initial-equality','compare',{
          before:primary.audit.value.snapshot,after:received.value.snapshot},'receiving'));
        const opening=await this.start('receiving','receiving-main');
        const before=await this.phase('06c-complete-received-agent-reads',()=>this.reads('receiving','receiving-original'));
        need(same(before.state,primary.reads.state),'Independent receiving lost original record or review history.');
        const browser=await this.browser('receiving','06d-independent-browser');
        const reads=await this.phase('06e-complete-later-received-reads',()=>this.reads('receiving','receiving-current'));
        const agentArchives=await this.agentArchives('receiving','06f-complete-received-agent-archives');
        const files=await this.phase('06g-received-retained-files',()=>this.catalogue('receiving','receiving-files'));
        await this.stop('receiving');
        const note={recordId:browser.selection.note.recordId,text:browser.selection.note.text,revision:browser.edit.record.revision};
        const audit=await this.phase('06h-independent-original-audit',()=>this.helper('receiving-current-audit','audit',{
          directory:this.state.hosts.receiving.container,expectedSnapshot:received.value.snapshot,notes:note},'receiving'));
        const repeated=await this.phase('06i-original-receive-replay-after-later-edit',()=>this.helper('receiving-exact-replay','replay-receive',{
          directory:this.state.hosts.receiving.container,receipt:received.resultFile,implementationArchive:request.implementationArchive},'receiving'));
        const replayEquality=await this.phase('06j-full-later-history-preserved',()=>this.helper('receiving-replay-equality','compare',{
          before:audit.value.snapshot,after:repeated.value.snapshot},'receiving'));
        const browserPackage=await this.phase('06k-onward-browser-full-archives',()=>this.helper('receiving-browser-archives','inspect-original',this.browserSelection(browser),'receiving'));
        const browserEquality=await this.phase('06l-onward-browser-full-equality',()=>this.helper('receiving-browser-equality','compare',{before:audit.value.snapshot,after:browserPackage.value.snapshot},'receiving'));
        const agentPackage=await this.phase('06m-onward-agent-full-archives',()=>this.helper('receiving-agent-archives','inspect-original',agentArchives,'receiving'));
        const agentEquality=await this.phase('06n-onward-agent-full-equality',()=>this.helper('receiving-agent-equality','compare',{before:audit.value.snapshot,after:agentPackage.value.snapshot},'receiving'));
        return{request,received,initialEquality,opening,before,browser,reads,agentArchives,files,note,audit,repeated,replayEquality,browserPackage,browserEquality,agentPackage,agentEquality};
      });
      const cold={};
      for(const name of ['primary','receiving'])cold[name]=await this.phase('07-'+name+'-managed-and-agent-cold-reopen',async()=>{
        // Reopen the agent's retained-file store from disk as well as the native listener.
        await this.setup();const expected=name==='primary'?primary:receiving,opening=await this.start(name,name+'-cold');
        need(opening.launchId!==expected.opening.launchId,'Cold reopen must use a new actual managed listener.');
        const reads=await this.reads(name,name+'-cold');
        need(same(reads.state,expected.reads.state),'The complete original records changed across Stop/reopen.');
        for(const row of expected.files.files)await this.full(name,row,name+'-cold-file-'+row.fileId);
        const files=await this.catalogue(name,name+'-cold-files');await this.stop(name);
        const audit=await this.helper(name+'-cold-audit','audit',{directory:this.state.hosts[name].container},name);
        const comparison=await this.helper(name+'-cold-equality','compare',{before:expected.audit.value.snapshot,after:audit.value.snapshot},name);
        return{opening,reads,files,audit,comparison};
      });
      await this.close();
      for(const row of Object.values(this.state.files))await verify(row);
      this.state.completedAt??=now();await this.save();
      const candidate={schema:'stellar-forge.catalogue-delivery-installed-result.v1',state:'COMPLETE',receivingId:this.state.id,completedAt:this.state.completedAt,
        selection:this.selection,installation,distribution,originalInputs,primary,receiving,cold,
        originalProviderProgramme:'ADOPTED_COMPLETE_NATIVE_PHASES',nativeOperationId:this.donor.donor.nativeOperationId,
        providerDispatches:0,nativeDecisionsRepeated:0,workerEnabled:false,
        files:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path)),
        presentation:'Open and visually inspect the exact desktop/mobile screens, every outgoing archive and reopened complete export before calling this customer-ready.'};
      await save(candidatePath,candidate);return this.finalize(candidate);
    }catch(e){this.state.status='interrupted';this.state.errors.push({at:now(),phase:this.state.activePhase,error:errorValue(e)});await this.save();throw e;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){
    const value={command:'catalogue-delivery-workbench-receive',usage:'--directory PRIVATE_COURSE --merchant-workspace PRIVATE_RUNTIME_WORKSPACE --merchant-runtime INSTALLED_RUNTIME --preparation-result ABS_PREPARED --original-request ABS_PRIVATE_NATIVE_SELECTION --playwright ABS_MODULE --chromium ABS_BROWSER [--actor NAME] [--resume]',
      operation:'Adopt the existing complete implementation, both original native review phases and approval archives; operate independent local Applications, full agent files and three original browser views.'};
    process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;
  }
  const o=parse(argv);await privateDirectory(o.directory);await privateDirectory(join(o.directory,'private'));
  const lease=await acquireLease(join(o.directory,'receiving'));let course;
  try{
    const installed=await inspectMerchantRuntime(o['merchant-runtime'],{load:false});
    need(await realpath(installed.sourceRoot)===SOURCE_ROOT,'Invoke the exact selected installed Merchant distribution.');
    const prepared=await json(o['preparation-result']);
    need(prepared.schema==='stellar-forge.catalogue-delivery-preparation.v1'&&prepared.state==='READY'&&prepared.resultPath===o['preparation-result'],'Select the complete private source preparation result.');
    const inspected=await inspectCatalogueDeliveryPreparation({directory:prepared.directory,python:prepared.primary.python});
    need(inspected.state==='READY'&&same(inspected.result,prepared),'Reopen the full prepared source and actual interpreter selection.');
    need(prepared.primary.applicationDirectory!==prepared.receiving.applicationDirectory,'Use separate original source installations.');
    for(const name of ['primary','receiving'])await inspectOriginalSource({directory:prepared[name].applicationDirectory,
      sourceManifestFile:prepared[name].sourceManifestFile,sourceManifestSha256:prepared[name].sourceManifestSha256});
    const donor=await json(o['original-request']);
    need(donor.schema==='stellar-forge.catalogue-delivery-original-delivery-input.v1'&&donor.sourceManifestSha256===prepared.source.manifestSha256&&donor.donor,
      'Select the exact privately retained original native phases and complete source authority.');
    const d=donor.donor;
    need(typeof d.nativeOperationId==='string'&&d.nativeOperationId.length>0&&Array.isArray(d.approvals)&&d.approvals.length===2&&
      d.approvals[0].decision==='reject'&&d.approvals[1].decision==='approve','Select both original native decisions in their retained edition order.');
    await verify(d.implementationArchive);for(const item of d.approvals){await verify(item.archive);await verify(item.phase);if(item.phaseArchive)await verify(item.phaseArchive);}
    const selection={directory:o.directory,merchantWorkspace:o['merchant-workspace'],merchantRuntime:o['merchant-runtime'],merchantSourceManifestSha256:installed.sourceManifestSha256,
      preparationResult:await identity(o['preparation-result']),preparation:prepared,originalRequest:await identity(o['original-request']),donor,
      source:{originalManifestSha256:prepared.source.manifestSha256,merchantManifestSha256:installed.sourceManifestSha256,
        helper:await identity(HELPER),browser:await identity(join(HERE,'receiving-browser.mjs'))},
      actor:o.actor,node:{path:process.execPath,version:process.version},playwright:await identity(o.playwright),chromium:await identity(o.chromium)};
    course=new Course(o,prepared,donor,selection);await course.open();return await course.run();
  }finally{if(course)await course.close();await lease.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({error:errorValue(e)})+'\n');process.exitCode=1;});
