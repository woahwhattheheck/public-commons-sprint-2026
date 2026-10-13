// SPDX-License-Identifier: MIT
// Complete installed receiving. Original private source and donor output are explicit inputs.
import {readFile,open,mkdir,lstat,realpath,rename,link,unlink,readdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {inspectGrantAnalystPreparation,exportGrantAnalystRuntime} from './prepare.mjs';
import {acquireLease,inspectOriginalSource} from './managed.mjs';
import {createGrantAnalystReceivingBrowser} from './receiving-browser.mjs';
import merchantProvider from './merchant-provider.mjs';
import {receiveLearningExchange} from './learning-exchange-receiving.mjs';
import {initializeGrantAnalystMerchant} from './setup.mjs';
import {readMerchantConfig} from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(HERE,'../..');
const SCHEMA='stellar-forge.grant-analyst-installed-receiving.v1',HELPER=join(HERE,'receiving-original.py');
const hash=b=>createHash('sha256').update(b).digest('hex'),now=()=>new Date().toISOString();
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b),delay=ms=>new Promise(r=>setTimeout(r,ms));
const need=(yes,message)=>{if(!yes)throw Object.assign(new Error(message),{code:'GRANT_ANALYST_RECEIVING'});};
const errorValue=e=>({code:e.code??'GRANT_ANALYST_RECEIVING',message:e.message});
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid()),'Use a canonical owned private directory.');}
function child(root,path){const p=relative(root,path);need(p&&!p.startsWith('..')&&!isAbsolute(p),'Retain artifacts within this private receiving operation.');return p.split('\\').join('/');}
async function finishReceivingCleanup(primary,actions){
  const failures=[];
  for(const action of actions)try{await action();}catch(error){failures.push(error);}
  if(primary){if(failures.length)try{Object.defineProperty(primary,'cleanupErrors',{value:[...(primary.cleanupErrors??[]),...failures],configurable:true});}catch{}throw primary;}
  if(failures.length===1)throw failures[0];
  if(failures.length)throw new AggregateError(failures,'Original receiving cleanup failed.');
}
async function identity(path){
  const s=await lstat(path);need(s.isFile()&&!s.isSymbolicLink()&&await realpath(path)===path,'Select a canonical ordinary file.');
  const f=await open(path,'r'),h=createHash('sha256');let bytes=0,primary;
  try{for await(const b of f.createReadStream({autoClose:false})){h.update(b);bytes+=b.length;}
    const t=await f.stat();need(s.dev===t.dev&&s.ino===t.ino&&s.size===t.size&&s.mtimeMs===t.mtimeMs&&bytes===t.size,'The selected file changed while reading.');}
  catch(error){primary=error;}
  finally{await finishReceivingCleanup(primary,[()=>f.close()]);}
  return{path,bytes,sha256:h.digest('hex')};
}
async function verify(row){const v=await identity(row.path);need(v.bytes===row.bytes&&v.sha256===row.sha256,'The original retained file changed: '+row.path);return v;}
async function syncDirectory(path){const f=await open(path,'r');let primary;try{await f.sync();}catch(error){primary=error;}finally{await finishReceivingCleanup(primary,[()=>f.close()]);}}
async function bytes(path,raw,immutable=true){
  await privateDirectory(dirname(path));
  if(immutable&&await exists(path)){need((await readFile(path)).equals(raw),'Immutable receiving bytes differ.');return identity(path);}
  const temp=path+'.writing-'+randomUUID();let f,owned=false,primary;
  try{
    f=await open(temp,'wx',0o600);owned=true;await f.writeFile(raw);await f.sync();
    if(immutable){try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await readFile(path)).equals(raw),'The retained artifact differs.');}}
    else{await rename(temp,path);owned=false;}
    await syncDirectory(dirname(path));
  }catch(error){primary=error;}
  finally{await finishReceivingCleanup(primary,[
    async()=>{if(f)await f.close();},
    async()=>{if(owned)await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  ]);}
  return identity(path);
}
const save=(path,value,immutable=true)=>bytes(path,Buffer.from(JSON.stringify(value,null,2)+'\n'),immutable);
async function copy(source,target,expected){
  const selected=expected??await identity(source);await verify({...selected,path:source});await privateDirectory(dirname(target));
  if(await exists(target))return verify({...selected,path:target});
  const temp=target+'.copy-'+randomUUID();let input,output,owned=false,primary;
  try{
    input=await open(source,'r');output=await open(temp,'wx',0o600);owned=true;
    for await(const b of input.createReadStream({autoClose:false}))await output.writeFile(b);
    await output.sync();await verify({...selected,path:temp});
    try{await link(temp,target);}catch(e){if(e.code!=='EEXIST')throw e;await verify({...selected,path:target});}
    await syncDirectory(dirname(target));
  }catch(error){primary=error;}
  finally{await finishReceivingCleanup(primary,[
    async()=>{if(input)await input.close();},async()=>{if(output)await output.close();},
    async()=>{if(owned)await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  ]);}
  return identity(target);
}
async function selectedPort(){
  const server=createServer();let active=false;
  try{await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{active=true;ok();});});return server.address().port;}
  finally{if(active)await new Promise((ok,no)=>server.close(e=>e?no(e):ok()));}
}
async function command(python,argv,directory,{shouldStop=()=>false}={}){
  await privateDirectory(directory);const attempt=randomUUID(),outPath=join(directory,attempt+'.stdout'),errPath=join(directory,attempt+'.stderr');
  let out,err,processChild,closed,ended=false,childError,exitCode,signal,primary;
  const selected={python,argv,cwd:directory,attempt,startedAt:now()};
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};for(const k of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP'])delete env[k];
  const stop=()=>{if(processChild&&!ended)processChild.kill('SIGTERM');};
  try{
    out=await open(outPath,'wx',0o600);err=await open(errPath,'wx',0o600);
    await save(join(directory,attempt+'.request.json'),selected);
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
    need(!shouldStop(),'The selected helper stopped before child dispatch.');
    processChild=spawn(python,argv,{cwd:directory,env,stdio:['ignore',out.fd,err.fd],windowsHide:true});
    closed=new Promise(ok=>{processChild.once('error',e=>{childError=e;});processChild.once('close',(code,sig)=>{ended=true;exitCode=code;signal=sig;ok();});});
    await closed;await finishReceivingCleanup(null,[()=>out.sync(),()=>err.sync()]);
    const completion={...selected,closedAt:now(),exitCode,signal,error:childError?errorValue(childError):null};
    await save(join(directory,attempt+'.closed.json'),completion);
    if(childError)throw childError;
    need(exitCode===0,'The selected original helper closed unsuccessfully; retain and resume its exact request. '+(await readFile(errPath,'utf8')).slice(-3000));
    return{value:JSON.parse(await readFile(outPath,'utf8')),
      files:[outPath,errPath,join(directory,attempt+'.request.json'),join(directory,attempt+'.closed.json')]};
  }catch(error){primary=error;}
  finally{await finishReceivingCleanup(primary,[
    async()=>{if(closed){let stoppingError;try{if(!ended)stop();}catch(error){stoppingError=error;}await closed;if(stoppingError)throw stoppingError;}},
    async()=>{process.off('SIGTERM',stop);process.off('SIGINT',stop);},
    async()=>{if(out)await out.close();},async()=>{if(err)await err.close();}
  ]);}
}
function parse(argv){
  const out={},allowed=new Set(['directory','merchant-workspace','merchant-runtime','preparation-result','original-request','playwright','chromium','actor','resume']);
  for(let i=0;i<argv.length;i++){const k=argv[i].startsWith('--')?argv[i].slice(2):'';need(allowed.has(k)&&!Object.hasOwn(out,k),'Use each declared receiving option once.');
    if(k==='resume')out[k]=true;else{need(i+1<argv.length&&!argv[i+1].startsWith('--'),'Missing receiving option value.');out[k]=argv[++i];}}
  for(const k of ['directory','merchant-workspace','merchant-runtime','preparation-result','original-request','playwright','chromium'])need(typeof out[k]==='string'&&isAbsolute(out[k])&&resolve(out[k])===out[k],'Select absolute canonical '+k+'.');
  out.actor??='Installed grant analyst operator';need(out.actor.trim()===out.actor&&out.actor.length>0&&out.actor.length<=120&&!/[\x00-\x1f\x7f]/.test(out.actor),'Select a readable original operator identity.');
  return out;
}
class Course{
  constructor(options,prepared,donor,selection){this.o=options;this.prepared=prepared;this.donor=donor;this.selection=selection;this.root=options.directory;
    this.path=join(this.root,'operation.json');this.bound=false;this.apps=null;this.manager=null;this.browserOwner=null;this.closing=null;this.tail=Promise.resolve();this.stopping=false;this.stopSignal=null;this.selectedHere=new Set();}
  requestStop(signal){
    this.stopping=true;this.stopSignal??=signal;
    this.browserOwner?.requestStop(signal);
  }
  checkStopping(){need(!this.stopping,'The original receiving course is stopping; retain its request and resume after all owners close.');}
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
    this.checkStopping();if(this.state.phases[name]?.complete)return this.state.phases[name].value;
    this.state.activePhase=name;this.state.phases[name]??={startedAt:now()};await this.save();
    process.stdout.write(JSON.stringify({receivingId:this.state.id,phase:name})+'\n');
    const value=await fn();this.state.phases[name]={...this.state.phases[name],complete:true,completedAt:now(),value};await this.save();this.checkStopping();return value;
  }
  async copy(source,target,expected){const value=await copy(source,join(this.root,target),expected);return this.retain(value.path);}
  async helper(name,action,extra={},source='primary'){
    this.checkStopping();const selected=this.prepared[source],selectionPath=join(this.root,'private','helper-'+source+'.json');
    await save(selectionPath,{schema:'stellar-forge.grant-analyst-original-receiving.v1',
      applicationDirectory:selected.applicationDirectory,sourceManifestFile:selected.sourceManifestFile,sourceManifestSha256:selected.sourceManifestSha256});
    const request=await this.intent('helper-'+name,async()=>({id:name,action,...extra}));
    const {id:originalId,...body}=request;need(originalId===name&&same(body,{action,...extra}),'Keep the original complete helper request.');
    const requestPath=join(this.root,'intents','helper-'+name+'.json');
    const result=await command(selected.python,['-I','-B',HELPER,'--selection',selectionPath,'--request',requestPath,'--directory',join(this.root,'original-helper-'+source)],join(this.root,'commands'),{shouldStop:()=>this.stopping});
    for(const path of result.files)await this.retain(path);
    const value=result.value;need(value.schema==='stellar-forge.grant-analyst-original-result.v1'&&value.id===name&&value.action===action,'Original helper result selected another request.');
    for(const row of [...value.artifacts,value.resultFile]){await verify(row);if(relative(this.root,row.path)&&!relative(this.root,row.path).startsWith('..'))await this.retain(row.path);}
    await this.retain(selectionPath);await this.record('helper-result-'+name,value);return value;
  }



  async prepare(){
    const attached=await this.phase('01-installed-runtime',()=>this.apps.attach({directory:this.o['merchant-runtime'],label:'Grant Analyst Workbench installed receiving'}));
    need(attached.status==='READY'&&attached.runtimeId,'Select the complete installed Merchant runtime.');this.runtimeId=attached.runtimeId;
    const cases={};
    for(const[kind,donor]of Object.entries({learning:this.donor.learning,...(this.donor.commissionedStudy?{study:this.donor.commissionedStudy}:{})})){
      const inspected=await this.phase(kind+'-02-completed-original-donor',()=>this.helper(kind+'-original-donor','inspect-original',donor));
      const primary=await this.phase(kind+'-03-primary-original-receive',()=>this.helper(kind+'-primary-receive','receive',{
        archive:inspected.value.successorHandover,directory:join(this.root,kind+'-primary-receiving'),expectedSnapshot:inspected.value.snapshot}));
      const baseline=await this.phase(kind+'-04-current-source-baseline',()=>this.helper(kind+'-baseline-export','export',{
        workspace:primary.value.workspace,expectedSnapshot:primary.value.snapshot}));
      for(const role of (kind==='learning'?['primary','receiving','exchange']:['primary','receiving'])){
        const name=kind+'-'+role,container=join(this.root,kind+'-'+role+'-receiving'),directory=join(container,'workspace');
        const port=await this.intent(name+'-loopback-port',selectedPort);
        this.state.hosts[name]??={name,kind,source:role==='exchange'?'receiving':role,container,directory,workspaceId:primary.value.workspaceId,
          baselineArchive:baseline.value.archive,port,connectionFile:join(this.root,'private',name+'-connection.json'),
          configurationFile:join(this.root,'private',name+'-launch.json'),starts:[]};
        need(this.state.hosts[name].directory===directory&&this.state.hosts[name].port===port&&this.state.hosts[name].workspaceId===primary.value.workspaceId,'Keep the original host and native identity.');
      }
      need(primary.value.workspace===this.state.hosts[kind+'-primary'].directory,'Use the actual native received workspace.');
      cases[kind]={inspected,primary,baseline};
    }
    await this.save();await this.setup();
    const tools=merchantProvider.tools((name,description,properties,required)=>({name,description,properties,required}));
    need(tools.length===22&&new Set(tools.map(x=>x.name)).size===22,'Retain the complete original analyst tool family.');
    await this.record('complete-tool-catalog',tools);return{runtimeId:this.runtimeId,cases,tools:tools.map(x=>x.name)};
  }
  async setup(){
    if(this.manager){await this.manager.close();this.manager=null;}
    const workspaces={};await privateDirectory(join(this.root,'agent-receiving'));
    for(const[name,h]of Object.entries(this.state.hosts)){
      workspaces[name]={label:name+' analyst',directory:h.directory,connectionFile:h.connectionFile,
        inputs:{baseline:{file:h.baselineArchive.path,sha256:h.baselineArchive.sha256,bytes:h.baselineArchive.bytes,
          filename:'complete-analyst-baseline.zip',mediaType:'application/zip'}},
        destinations:{independent:{directory:join(this.root,'agent-receiving',name)}}};
    }
    const path=join(this.root,'private','agent-host.json');
    await save(path,{schema:'stellar-forge.grant-analyst-host.v1',workspaces});await this.retain(path);
    const setup=await initializeGrantAnalystMerchant({directory:join(this.root,'agent'),connection:path,name:'Installed grant analyst receiving'});
    await this.record('setup-'+hash(canonical(setup)),setup);
    const config=await readMerchantConfig(setup.configuration);this.manager=await merchantProvider.create(await merchantProvider.load(),config);
    this.agentConfiguration=setup.configuration;await this.retain(setup.configuration);return setup;
  }
  call(name,args={}){return this.manager.call('merchant_grant_analyst_'+name,args);}
  async response(name,args,key){
    const selected=await this.call(name,args);
    need(selected.fileId,'The operation has no retained HTTP response; reconcile its exact saved request before continuing.');
    const value=await this.full(args.workspace,selected,key,{parse:true});
    need(selected.ok!==false&&!value?.error,'The complete original response reports an error: '+(value?.error?.message??name));
    return{retained:selected,value};
  }
  async reads(alias,key,snapshotDescriptor){
    const expected=await json(snapshotDescriptor.path),state=(await this.response('state',{workspace:alias},key+'-state')).value;
    need(same(state,expected.state),'The complete saved native state differs from the selected edition.');
    const info=(await this.response('info',{workspace:alias},key+'-info')).value;
    need(info.workspaceId===expected.state.id,'The original workspace identity differs.');
    const learning=(await this.response('learning',{workspace:alias},key+'-learning')).value;
    const studies=(await this.response('studies',{workspace:alias},key+'-studies')).value;
    need(same(learning,expected.learning)&&same(studies,expected.studies),'The full original learning or study history differs.');
    const artifacts=[],reports=[];
    const artifact=async(kind,query={},expectedFile={})=>{
      const retained=await this.call('artifact',{workspace:alias,kind,query,...expectedFile});
      const file=await this.full(alias,retained,key+'-'+kind+'-'+hash(canonical(query)));artifacts.push({retained,file});return file;
    };
    for(const entry of expected.state.editions){
      const report=(await this.response('report',{workspace:alias,edition:entry.id},key+'-report-'+entry.id)).value;
      const normalized={...report};delete normalized.createdAt;
      need(same(normalized,expected.reports.find(x=>x.edition.id===entry.id)),'The full exact-decimal report differs.');
      let offset=0;const rows=[];let first;
      for(;;){
        const page=(await this.response('report',{workspace:alias,edition:entry.id,paged:true,offset,limit:2},key+'-report-'+entry.id+'-'+offset)).value;
        need(page.offset===offset&&page.workspace===expected.state.id&&page.edition.sha256===entry.sha256,'The selected report page changed.');
        first??=page;rows.push(...page.rows);if(page.nextOffset===null)break;
        need(page.nextOffset>offset&&page.rows.length>0,'The report cursor stalled.');offset=page.nextOffset;
      }
      const complete={...first,rows};for(const field of ['createdAt','matched','offset','nextOffset'])delete complete[field];
      need(rows.length===entry.grants&&same(complete,normalized),'The full original paged grant population differs.');
      await artifact('source',{edition:entry.id},{expectedSha256:entry.sha256,expectedBytes:entry.bytes});
      await artifact('report-csv',{edition:entry.id});await artifact('report-json',{edition:entry.id});
      const compared=(await this.response('compare',{workspace:alias,baseline:entry.id,candidate:entry.id},key+'-compare-'+entry.id)).value;
      need(compared.counts.unchanged===entry.grants&&compared.counts.changed===0&&compared.counts.added===0&&compared.counts.removed===0,'Original comparison lost grants.');
      reports.push({edition:entry.id,rows:rows.length,comparison:compared});
    }
    for(const kind of ['learning-json','learning-csv','learning-markdown','study-json'])await artifact(kind);
    for(const study of expected.state.studies??[]){
      for(const evidence of study.evidence)if(evidence.document)await artifact('study-document',
        {study:study.id,evidence:evidence.id,number:evidence.number},
        {expectedSha256:evidence.document.sha256,expectedBytes:evidence.document.bytes});
      for(const release of study.releases)for(const kind of ['study-release-json','study-release-markdown','study-release-csv'])
        await artifact(kind,{study:study.id,release:release.id});
    }
    return{state,learning,studies,reports,artifacts,info};
  }
  async browser(alias,key,baseline,operation=null){
    return this.phase(key,async()=>{
      const h=this.state.hosts[alias],selected=this.prepared[h.source];
      this.browserOwner=createGrantAnalystReceivingBrowser({directory:join(this.root,'browser',key),connectionFile:h.connectionFile,
        workspaceDirectory:h.directory,workspaceId:h.workspaceId,applicationDirectory:selected.applicationDirectory,
        sourceManifestSha256:selected.sourceManifestSha256,baseline,operation,actor:this.o.actor,
        playwright:this.o.playwright,chromium:this.o.chromium,source:this.selection.source});
      let result;try{result=await this.browserOwner.run();}finally{await this.browserOwner.close();this.browserOwner=null;}
      need(result.schema==='stellar-forge.grant-analyst-browser-result.v1'&&result.state==='COMPLETE','The original browser course is incomplete.');
      for(const row of [...result.files,result.resultFile]){await verify(row);await this.retain(row.path);}return result;
    });
  }
  async technicalBody(key,baseline,independent=false){
    return this.intent(key,async()=>{
      const snapshot=await json(baseline.path),cycle=snapshot.state.learningCycles.find(x=>x.actions.length>0);
      need(cycle,'Select an existing original learning action for the technical receiving note.');
      const action=cycle.actions[0],last=action.revisions.at(-1);
      return{cycle:cycle.id,action:action.id,expectedRevision:last.revision,
        title:last.title,owner:last.owner,dueOn:last.dueOn,successCriteria:last.successCriteria,status:last.status,
        reviewer:this.o.actor,note:independent?
          'Independent installed receiving retained the complete earlier learning history and this later technical note.':
          'Installed browser receiving retained the complete original learning history and recovered this exact saved request.',
        evidence:'Complete selected receiving snapshot SHA-256: '+baseline.sha256};
    });
  }
  async handover(alias,key){
    return this.phase(key,async()=>{
      const retained=await this.call('artifact',{workspace:alias,kind:'handover',filename:'complete-analyst-handover.zip'});
      return{retained,archive:await this.full(alias,retained,key)};
    });
  }
  async agentBaselineReceive(alias,key,expected){
    return this.phase(key,async()=>{
      const h=this.state.hosts[alias],args=await this.intent(key+'-request',async()=>({
        workspace:alias,requestId:randomUUID(),sourceInput:'baseline',expectedSourceSha256:h.baselineArchive.sha256,destination:'independent'}));
      const received=await this.response('receive',args,key+'-response');
      const replay=await this.response('receive',args,key+'-replay');
      need(same(received.value,replay.value),'The retained agent receive result changed.');
      const checked=await this.helper(key+'-native-reopen','receive',{
        archive:h.baselineArchive,directory:join(this.root,'agent-receiving',alias),expectedSnapshot:expected,currentSource:true},h.source);
      return{request:args,received,replay,checked};
    });
  }

  async full(alias,retained,key,{parse=false}={}){
    need(retained.fileId&&/^[0-9a-f]{64}$/.test(retained.sha256)&&Number.isSafeInteger(retained.bytes),'Use the complete retained original response descriptor.');
    const path=join(this.root,'retained',alias,retained.sha256+'.content');await privateDirectory(dirname(path));
    let readId=null,offset=0,total=0,file=null,ownsTemp=false,primary;
    const digest=createHash('sha256'),temp=path+'.reading-'+randomUUID();
    try{
      file=await open(temp,'wx',0o600);ownsTemp=true;
      let readError;
      try{
        for(;;){
          const part=await this.call('file',{workspace:alias,fileId:retained.fileId,expectedSha256:retained.sha256,offset,limit:196608,...(readId?{readId}:{})});
          // Retain the actual provider handle before validation or local I/O can fail.
          if(typeof part.readId==='string'&&part.readId)readId=part.readId;
          need(part.encoding==='base64'&&part.offset===offset&&part.file.sha256===retained.sha256&&part.file.bytes===retained.bytes,'Full retained file selection changed.');
          const raw=Buffer.from(part.data,'base64');need(raw.toString('base64')===part.data&&raw.length===part.bytesRead&&(raw.length>0||retained.bytes===0),'The original retained byte range differs.');
          await file.writeFile(raw);digest.update(raw);offset+=raw.length;total++;
          if(part.nextOffset===null){readId=null;need(offset===retained.bytes,'The complete original file ended early.');break;}
          need(part.nextOffset===offset&&offset<retained.bytes,'Follow the complete original file cursor.');
        }
        need(digest.digest('hex')===retained.sha256,'The complete original response digest differs.');await file.sync();
      }catch(error){readError=error;}
      finally{
        await finishReceivingCleanup(readError,[
          ()=>file.close(),
          async()=>{if(readId)await this.call('file_release',{workspace:alias,readId});}
        ]);
      }
      try{await link(temp,path);}catch(error){if(error.code!=='EEXIST')throw error;await verify({...retained,path});}
      await syncDirectory(dirname(path));
      const actual=await this.retain(path);await this.record('file-'+hash(key+'\0'+retained.sha256),{key,workspace:alias,fileId:retained.fileId,file:actual,ranges:total});
      return parse?json(path):actual;
    }catch(error){primary=error;throw error;}
    finally{
      await finishReceivingCleanup(primary,[async()=>{if(ownsTemp)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}]);
    }
  }
  async app(name){const s=await this.apps.applicationsState({historyLimit:100});return s.applications.find(x=>x.id===this.state.hosts[name].applicationId);}
  async configure(name){
    const host=this.state.hosts[name],selected=this.prepared[host.source];
    const config={schema:'stellar-forge.grant-analyst-workbench-launch.v1',directory:host.directory,applicationDirectory:selected.applicationDirectory,
      sourceManifestFile:selected.sourceManifestFile,sourceManifestSha256:selected.sourceManifestSha256,python:selected.python,connectionFile:host.connectionFile,
      actor:this.o.actor,port:host.port};
    await save(host.configurationFile,config);await this.retain(host.configurationFile);
    const value=await this.phase('application-'+name+'-save',async()=>{
      const review=await this.intent('application-'+name+'-review',()=>this.apps.applicationsReview({runtimeId:this.runtimeId,kind:'grant-analyst-workbench',providerId:'grant-analyst-workbench',
        settings:{configurationFile:host.configurationFile,port:host.port},label:'Installed grant analyst '+name}));
      const request=await this.intent('application-'+name+'-save',async()=>({requestId:randomUUID(),reviewId:review.id}));
      const answer=await this.apps.applicationsSave(request);await this.record('application-'+name+'-saved',answer);return{applicationId:answer.applicationId};
    });
    host.applicationId=value.applicationId;await this.save();
  }
  async start(name,stage){
    this.checkStopping();await this.configure(name);const h=this.state.hosts[name];
    for(let i=0;;i++){this.checkStopping();const a=await this.app(name);need(a,'The original saved application is absent.');if(a.release&&a.connectionReady===true)break;
      if(i===0||a.adoption?.active===false)await this.apps.applicationsConnect({applicationId:a.id});
      need(i<600,'Original Applications connection remains pending; resume its saved selection.');await delay(1000);}
    let run=h.starts.find(x=>x.stage===stage&&!x.closed);
    if(!run){this.checkStopping();const a=await this.app(name);need(!a.current||a.current.active===false&&!['PENDING','QUEUED','INTERRUPTED','OBSERVATION_UNAVAILABLE'].includes(a.current.phase),'Reconcile the original managed owner first.');
      const review=await this.apps.applicationsStartReview({applicationId:h.applicationId});run={stage,requestId:randomUUID(),reviewId:review.id,createdAt:now(),dispatch:'selected'};h.starts.push(run);this.selectedHere.add(run.requestId);await this.save();await this.record(name+'-'+run.requestId+'-review',review);}
    // Once selected, settle this exact original dispatch even if Stop arrived.
    // A pre-dispatch write failure is distinguished from an uncertain native call.
    run.dispatch='dispatching';await this.save();this.selectedHere.delete(run.requestId);
    await this.apps.applicationsStart({applicationId:h.applicationId,requestId:run.requestId,reviewId:run.reviewId});
    run.dispatch='entered';await this.save();
    let recovered=false;
    for(let i=0;i<600;i++){
      this.checkStopping();const a=await this.app(name),actual=a?.runs.find(x=>x.id===run.requestId);
      if(actual?.active===true&&actual.privateUrl){
        const status=await this.call('connections',{workspace:name});if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});
        const connection=await this.call('connect',{workspace:name});
        need(connection.directory===h.directory&&connection.applicationDirectory===this.prepared[h.source].applicationDirectory&&
          connection.sourceManifestSha256===this.prepared.source.manifestSha256&&connection.actor===this.o.actor&&Number(new URL(connection.origin).port)===h.port&&connection.workspaceId===h.workspaceId,'Managed source, actor or origin selection changed.');
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
      const portable=await exportGrantAnalystRuntime({directory:this.prepared.directory,python:this.prepared.primary.python,output});
      need(portable.state==='EXPORTED'&&portable.source.manifestSha256===this.prepared.source.manifestSha256,'Retain the complete prepared private source export.');
      files.push(await this.retain(portable.portable.path));await this.record('private-source-export',portable);
      return{files,handoff:chosen.handoff,portable};
    });
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
      let absent=false;
      try{await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});}
      catch(error){if(error.code!=='ENOENT')throw error;absent=true;}
      if(absent&&(run.dispatch==='selected'||this.selectedHere.has(run.requestId))){
        const local={schema:'stellar-forge.grant-analyst-unentered-launch.v1',applicationId:host.applicationId,
          operationId:run.requestId,state:'CANCELLED_BEFORE_DISPATCH',nativeRunObserved:false};
        await this.record(name+'-'+run.requestId+'-not-entered',local);
        run.closed=true;run.cancelledBeforeDispatch=true;run.closedAt??=now();await this.save();continue;
      }
      if(absent){
        // An earlier lifetime may have entered Start. Reconcile that same saved
        // request before asking the original owner to Stop; never invent closure.
        await this.apps.applicationsStart({applicationId:host.applicationId,requestId:run.requestId,reviewId:run.reviewId});
      }
      const proof=await this.intent(name+'-'+run.requestId+'-closed',async()=>{
        const cancellation=await this.apps.applicationsStop({applicationId:host.applicationId,operationId:run.requestId});
        if(cancelled(cancellation)&&cancellation.operationId===run.requestId)return{applicationId:host.applicationId,operationId:run.requestId,cancellation,output:null,closedAt:now()};
        for(;;){const output=await this.apps.applicationsOutput({applicationId:host.applicationId,operationId:run.requestId});if(output.operationId===run.requestId&&closed(output))return{applicationId:host.applicationId,operationId:run.requestId,cancellation:null,output,closedAt:now()};await delay(1000);}
      });
      need(proof.applicationId===host.applicationId&&proof.operationId===run.requestId&&
        (cancelled(proof.cancellation)&&proof.cancellation.operationId===run.requestId||proof.output?.operationId===run.requestId&&closed(proof.output)),'Retain the actual original command closure proof.');
      if(this.manager&&!this.closing){const status=await this.call('connections',{workspace:name});if(status.state==='CONNECTED')await this.call('disconnect',{workspace:name,launchId:status.launchId});}
      run.closed=true;run.closedAt=proof.closedAt;await this.save();
    }
  }
  close(){
    if(this.closing)return this.closing;
    const report=value=>{try{process.stderr.write(JSON.stringify(value)+'\n');}catch{}};
    const retry=async(label,action)=>{
      for(;;)try{return await action();}catch(error){report({state:label,error:errorValue(error)});await delay(1000);}
    };
    this.closing=(async()=>{
      if(!this.bound)return;
      // Independent close failures must not prevent the original Applications Stop.
      // Manager close owns its connections here; ordinary stop still disconnects explicitly.
      await Promise.all([
        retry('BROWSER_CLOSING',async()=>{if(this.browserOwner){await this.browserOwner.close();this.browserOwner=null;}}),
        retry('AGENT_CLOSING',async()=>{if(this.manager){await this.manager.close();this.manager=null;}}),
        (async()=>{
          if(!this.apps&&Object.values(this.state?.hosts??{}).some(h=>h.starts.some(x=>!x.closed)))
            await retry('ORIGINAL_APPLICATION_OBSERVER_PENDING',async()=>{this.apps=await openRuntimeWorkspace({directory:this.o['merchant-workspace']});});
          await Promise.all(Object.keys(this.state?.hosts??{}).map(name=>retry('APPLICATION_CLOSING',async()=>{
            while(this.state.hosts[name].starts.some(x=>!x.closed))await this.stop(name);
          })));
          await retry('APPLICATION_OBSERVER_CLOSING',async()=>{if(this.apps){await this.apps.close();this.apps=null;}});
        })()
      ]);
      await this.tail;
    })().finally(()=>{this.closing=null;});return this.closing;
  }
  async finalize(candidate){
    need(candidate.schema==='stellar-forge.grant-analyst-installed-result.v1'&&candidate.state==='COMPLETE'&&candidate.receivingId===this.state.id&&same(candidate.selection,this.selection),'Adopt only the original complete candidate.');
    for(const row of candidate.files)await verify(row);
    const path=join(this.root,'INSTALLED_RESULT.json');await save(path,candidate);this.state.result=await identity(path);
    const rows=[...candidate.files,this.state.result].map(row=>({...row,name:child(this.root,row.path)})).sort((a,b)=>a.name.localeCompare(b.name));
    const handover=await this.helper('complete-installed-handover','bundle',{files:rows});
    this.state.handover=handover.value.archive;this.state.status='complete';await this.save();
    return{...candidate,resultFile:this.state.result,handover:handover.value};
  }



  async caseCourse(kind,installation){
    const first=kind+'-primary',second=kind+'-receiving',baseline=installation.baseline.value.snapshot;
    const primary=await this.phase(kind+'-05-primary-installed-course',async()=>{
      const opening=await this.start(first,kind+'-primary-main');
      const before=await this.phase(kind+'-05a-original-agent-reads',()=>this.reads(first,kind+'-original',baseline));
      const agentReceive=await this.agentBaselineReceive(first,kind+'-05b-agent-original-receive',baseline);
      const body=kind==='learning'?await this.technicalBody(kind+'-browser-technical-body',baseline):null;
      const browser=await this.browser(first,kind+'-05c-primary-browser',baseline,body?{body}:null);
      const operation=browser.edit?.operation??null;
      const replay=operation?await this.phase(kind+'-05d-agent-original-request-replay',async()=>{
        const args={workspace:first,action:operation.action,requestId:operation.requestId,payload:operation.body};
        const value=await this.response('action',args,kind+'-browser-agent-replay');
        need(value.value.reused===true,'The browser request must replay its original native receipt.');
        return value;
      }):null;
      const archive=await this.handover(first,kind+'-05e-primary-agent-handover');
      const files=await this.phase(kind+'-05f-primary-retained-file-population',()=>this.catalogue(first,kind+'-primary-files'));
      await this.stop(first);
      const audit=await this.phase(kind+'-05g-primary-native-audit',()=>this.helper(kind+'-primary-audit','audit',{
        workspace:this.state.hosts[first].directory,expectedSnapshot:baseline,...(operation?{operation}:{})}));
      const browserArchive=await this.phase(kind+'-05h-browser-archive-reopened',()=>this.helper(kind+'-browser-archive','inspect-archive',{
        archive:browser.handover,expectedSnapshot:audit.value.snapshot,currentSource:true}));
      const agentArchive=await this.phase(kind+'-05i-agent-archive-reopened',()=>this.helper(kind+'-agent-archive','inspect-archive',{
        archive:archive.archive,expectedSnapshot:audit.value.snapshot,currentSource:true}));
      const nativeReplay=operation?await this.phase(kind+'-05j-native-request-replay',()=>this.helper(kind+'-browser-native-replay','replay-action',{
        workspace:this.state.hosts[first].directory,operation,expectedSnapshot:audit.value.snapshot})):null;
      return{opening,before,agentReceive,browser,operation,replay,archive,files,audit,browserArchive,agentArchive,nativeReplay};
    });
    const receiving=await this.phase(kind+'-06-independent-installed-course',async()=>{
      const received=await this.phase(kind+'-06a-independent-full-receive',()=>this.helper(kind+'-independent-receive','receive',{
        archive:primary.archive.archive,directory:this.state.hosts[second].container,
        expectedSnapshot:primary.audit.value.snapshot,currentSource:true},'receiving'));
      need(received.value.workspace===this.state.hosts[second].directory&&received.value.workspaceId===this.state.hosts[second].workspaceId,'Independent receiving changed native identity.');
      const opening=await this.start(second,kind+'-receiving-main');
      const reads=await this.phase(kind+'-06b-full-received-agent-reads',()=>this.reads(second,kind+'-received',received.value.snapshot));
      const browser=await this.browser(second,kind+'-06c-independent-browser',received.value.snapshot);
      const browserArchive=await this.phase(kind+'-06d-full-browser-descriptor',async()=>({archive:browser.handover}));
      const edit=kind==='learning'?await this.phase(kind+'-06e-later-agent-action',async()=>{
        const body=await this.technicalBody(kind+'-agent-technical-body',received.value.snapshot,true);
        const args=await this.intent(kind+'-agent-technical-request',async()=>({workspace:second,action:'cycle-action',requestId:randomUUID(),payload:body}));
        need(same(args.payload,body),'Keep the original agent action body.');
        const original=await this.response('action',args,kind+'-agent-action');
        const replay=await this.response('action',args,kind+'-agent-action-replay');
        const strip=value=>{const copy={...value};delete copy.reused;return copy;};
        need(same(strip(original.value),strip(replay.value)),'The original agent request result changed.');
        return{operation:{action:args.action,body:args.payload,requestId:args.requestId},original,replay};
      }):null;
      const archive=await this.handover(second,kind+'-06f-onward-agent-handover');
      const files=await this.phase(kind+'-06g-received-retained-file-population',()=>this.catalogue(second,kind+'-receiving-files'));
      await this.stop(second);
      const audit=await this.phase(kind+'-06h-later-native-audit',()=>this.helper(kind+'-received-audit','audit',{
        workspace:this.state.hosts[second].directory,expectedSnapshot:received.value.snapshot,...(edit?{operation:edit.operation}:{})},'receiving'));
      const originalBrowser=await this.phase(kind+'-06i-received-browser-archive-reopened',()=>this.helper(kind+'-received-browser-archive','inspect-archive',{
        archive:browserArchive.archive,expectedSnapshot:received.value.snapshot,currentSource:true},'receiving'));
      const agentArchive=await this.phase(kind+'-06j-onward-agent-archive-reopened',()=>this.helper(kind+'-onward-agent-archive','inspect-archive',{
        archive:archive.archive,expectedSnapshot:audit.value.snapshot,currentSource:true},'receiving'));
      const repeated=await this.phase(kind+'-06k-receive-replay-preserves-later-work',()=>this.helper(kind+'-same-receive-later-reopen','replay-receive',{
        workspace:this.state.hosts[second].directory,receipt:received.resultFile,expectedSnapshot:audit.value.snapshot},'receiving'));
      const nativeReplay=edit?await this.phase(kind+'-06l-agent-native-request-replay',()=>this.helper(kind+'-agent-native-replay','replay-action',{
        workspace:this.state.hosts[second].directory,operation:edit.operation,expectedSnapshot:audit.value.snapshot},'receiving')):null;
      const onward=await this.phase(kind+'-06m-fresh-onward-native-receive',()=>this.helper(kind+'-onward-native-receive','receive',{
        archive:archive.archive,directory:join(this.root,kind+'-onward-receiving'),expectedSnapshot:audit.value.snapshot,currentSource:true},'receiving'));
      return{received,opening,reads,browser,edit,archive,files,audit,originalBrowser,agentArchive,repeated,nativeReplay,onward};
    });
    const cold={};
    for(const[alias,expected]of [[first,primary],[second,receiving]])cold[alias]=await this.phase(alias+'-07-managed-and-agent-cold-reopen',async()=>{
      await this.setup();const opening=await this.start(alias,alias+'-cold');
      need(opening.launchId!==expected.opening.launchId,'Cold reopen requires a new actual managed listener.');
      const reads=await this.phase(alias+'-07a-cold-complete-reads',()=>this.reads(alias,alias+'-cold',expected.audit.value.snapshot));
      for(const row of expected.files.files)await this.full(alias,row,alias+'-cold-file-'+row.fileId);
      const files=await this.phase(alias+'-07b-cold-retained-population',()=>this.catalogue(alias,alias+'-cold-files'));await this.stop(alias);
      const audit=await this.helper(alias+'-cold-audit','audit',{
        workspace:this.state.hosts[alias].directory,expectedSnapshot:expected.audit.value.snapshot},this.state.hosts[alias].source);
      return{opening,reads,files,audit};
    });
    const exchange=kind==='learning'?await receiveLearningExchange(this,{primary,receiving,cold}):null;
    return{kind,primary,receiving,cold,...(exchange?{exchange}:{})};
  }
  async run(){
    const candidatePath=join(this.root,'candidate.json'),resultPath=join(this.root,'INSTALLED_RESULT.json');
    if(await exists(candidatePath)||await exists(resultPath)){await this.close();return this.finalize(await json(await exists(candidatePath)?candidatePath:resultPath));}
    this.state.status='running';await this.save();
    try{
      const installation=await this.prepare(),distribution=await this.distribution();
      const originalInputs=await this.phase('04a-complete-original-input-custody',async()=>{
        const files=[await this.copy(this.o['original-request'],'original/SELECTION.json',this.selection.originalRequest)];
        for(const[kind,record]of Object.entries(installation.cases)){
          files.push(await this.copy(record.inspected.value.outer.path,'original/'+kind+'-complete-delivery.zip',record.inspected.value.outer));
          files.push(await this.copy(record.inspected.value.inventory.path,'original/'+kind+'-complete-inventory.json',record.inspected.value.inventory));
          files.push(await this.copy(record.inspected.value.outcome.path,'original/'+kind+'-native-outcome.json',record.inspected.value.outcome));
        }return files;
      });
      const cases={};for(const[kind,record]of Object.entries(installation.cases))cases[kind]=await this.caseCourse(kind,record);
      await this.close();for(const row of Object.values(this.state.files))await verify(row);
      this.state.completedAt??=now();await this.save();
      const candidate={schema:'stellar-forge.grant-analyst-installed-result.v1',state:'COMPLETE',receivingId:this.state.id,
        completedAt:this.state.completedAt,selection:this.selection,installation,distribution,originalInputs,cases,
        originalNativeProgrammes:'ADOPTED_COMPLETED_OUTPUTS',originalProgrammesRerun:0,
        technicalActionNotes:cases.learning?2:0,commissionedStudy:cases.study?'COMPLETED_DONOR_ADOPTED':'NOT_SELECTED',
        files:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path)),
        presentation:'Open and visually inspect the exact desktop/mobile screens, every outgoing archive and reopened complete export before calling this customer-ready.'};
      await save(candidatePath,candidate);return this.finalize(candidate);
    }catch(e){this.state.status='interrupted';this.state.errors.push({at:now(),phase:this.state.activePhase,error:errorValue(e)});
      try{await this.save();}catch(saveError){try{e.cleanupErrors=[...(e.cleanupErrors??[]),saveError];}catch{}}throw e;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){
    const value={command:'grant-analyst-workbench-receive',
      usage:'--directory PRIVATE_COURSE --merchant-workspace PRIVATE_RUNTIME_WORKSPACE --merchant-runtime INSTALLED_RUNTIME --preparation-result ABS_PREPARED --original-request ABS_PRIVATE_SELECTION --playwright ABS_MODULE --chromium ABS_BROWSER [--actor NAME] [--resume]',
      operation:'Adopt completed Learning output and an optional completed study successor; operate original Applications, full agent files, browser controls and independent receiving.'};
    process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;
  }
  const o=parse(argv);await privateDirectory(o.directory);await privateDirectory(join(o.directory,'private'));
  const lease=await acquireLease(join(o.directory,'receiving'));let course,requestedSignal=null;
  const abort=new AbortController(),onTerm=()=>stop('SIGTERM'),onInt=()=>stop('SIGINT');
  function stop(signal){requestedSignal??=signal;abort.abort();course?.requestStop(signal);}
  process.on('SIGTERM',onTerm);process.on('SIGINT',onInt);
  try{
    const installed=await inspectMerchantRuntime(o['merchant-runtime'],{load:false});
    need(await realpath(installed.sourceRoot)===SOURCE_ROOT,'Invoke the exact selected installed Merchant distribution.');
    const prepared=await json(o['preparation-result']);
    need(prepared.schema==='stellar-forge.grant-analyst-preparation.v1'&&prepared.state==='READY'&&prepared.resultPath===o['preparation-result'],'Select the full prepared private source result.');
    const inspected=await inspectGrantAnalystPreparation({directory:prepared.directory,python:prepared.primary.python,signal:abort.signal});
    need(inspected.state==='READY'&&same(inspected.result,prepared),'Reopen the complete source and actual selected interpreter.');
    need(prepared.primary.applicationDirectory!==prepared.receiving.applicationDirectory,'Use the independent prepared source installations.');
    for(const name of ['primary','receiving'])await inspectOriginalSource({directory:prepared[name].applicationDirectory,
      sourceManifestFile:prepared[name].sourceManifestFile,sourceManifestSha256:prepared[name].sourceManifestSha256});
    const donor=await json(o['original-request']);
    need(donor.schema==='stellar-forge.grant-analyst-original-delivery-input.v1'&&donor.sourceManifestSha256===prepared.source.manifestSha256&&donor.learning,
      'Select the completed private Learning donor and current full source authority.');
    need(Object.keys(donor).every(x=>['schema','sourceManifestSha256','learning','commissionedStudy'].includes(x)),'Unsupported private donor selection field.');
    for(const[kind,d]of Object.entries({learning:donor.learning,...(donor.commissionedStudy?{study:donor.commissionedStudy}:{})})){
      need(d.kind===kind&&typeof d.operationId==='string'&&d.operationId.length>0&&d.operationId.length<=240,'Select the original completed operation identity.');
      need(Object.keys(d).every(x=>['kind','archive','operationId','operationPrefix','outcomeMember','sourceHandoverMember','successorMember','filesMember'].includes(x)),'Unsupported donor field.');
      for(const key of ['outcomeMember','sourceHandoverMember','successorMember',...(kind==='study'?['filesMember']:[])]){
        const value=d[key];need(typeof value==='string'&&value.length>0&&!isAbsolute(value)&&!value.includes('\\')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'),
          'Select the actual relative original archive member: '+key);
      }
      need(d.sourceHandoverMember!==d.successorMember,'Retain distinct original source and successor members.');
      need(d.operationPrefix===undefined||d.operationPrefix===''||typeof d.operationPrefix==='string'&&!isAbsolute(d.operationPrefix)&&
        !d.operationPrefix.includes('\\')&&d.operationPrefix.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Invalid original operation prefix.');
      await verify(d.archive);
    }
    const selection={directory:o.directory,merchantWorkspace:o['merchant-workspace'],merchantRuntime:o['merchant-runtime'],
      merchantSourceManifestSha256:installed.sourceManifestSha256,preparationResult:await identity(o['preparation-result']),preparation:prepared,
      originalRequest:await identity(o['original-request']),donor,
      source:{originalManifestSha256:prepared.source.manifestSha256,merchantManifestSha256:installed.sourceManifestSha256,
        helper:await identity(HELPER),browser:await identity(join(HERE,'receiving-browser.mjs')),
        learningExchange:await identity(join(HERE,'learning-exchange-receiving.mjs')),
        learningExchangeBrowser:await identity(join(HERE,'learning-exchange-browser.mjs'))},
      actor:o.actor,node:{path:process.execPath,version:process.version},playwright:await identity(o.playwright),chromium:await identity(o.chromium)};
    need(!requestedSignal,'Receiving stopped before application ownership; retain the same selected inputs.');
    course=new Course(o,prepared,donor,selection);await course.open();course.checkStopping();return await course.run();
  }finally{
    try{if(course)await course.close();await lease.close();}
    finally{process.off('SIGTERM',onTerm);process.off('SIGINT',onInt);}
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({error:errorValue(e)})+'\n');process.exitCode=1;});
