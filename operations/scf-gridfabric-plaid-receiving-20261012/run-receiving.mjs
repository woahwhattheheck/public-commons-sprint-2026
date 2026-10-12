#!/usr/bin/env node
// MIT. Complete original GridFabric SQLite/HTTP/customer receiving, with one native owner.
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,
  renameSync,unlinkSync,existsSync,mkdirSync,lstatSync,realpathSync,readdirSync,constants} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {isDeepStrictEqual,TextDecoder} from 'node:util';

const OP='GRIDFABRIC-PLAID-OPERATIONS-20261012-1FB3';
const PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid';
const OPERATIONS='operations/scf-gridfabric-plaid-receiving-20261012';
const UTF8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const FORBIDDEN=new Set(['begin_management','finish_management','begin_device_action','finish_device_action']);
const hash=body=>createHash('sha256').update(body).digest('hex');
const errorView=e=>({code:e.code||'GRIDFABRIC_RECEIVING_ERROR',message:e.message,...(e.original?{original:e.original}:{})});
const fail=(code,message)=>Object.assign(new Error(message),{code});
const requireValue=(ok,message)=>{if(!ok)throw fail('GRIDFABRIC_RECEIVING_MISMATCH',message);};
const json=path=>JSON.parse(UTF8.decode(readFileSync(path)));
const now=()=>new Date().toISOString();
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function privateDir(path){
  const absolute=resolve(path);mkdirSync(absolute,{recursive:true,mode:0o700});
  const stat=lstatSync(absolute);
  requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&
    (typeof process.getuid!=='function'||stat.uid===process.getuid())&&realpathSync(absolute)===absolute,
    'Keep a real owner-private receiving directory: '+absolute);
  return absolute;
}
function syncDirectory(path){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}}
function atomic(path,body){
  privateDir(dirname(path));const temp=join(dirname(path),'.receiving-'+randomUUID());
  const fd=openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}
  try{renameSync(temp,path);syncDirectory(dirname(path));}catch(error){try{unlinkSync(temp);}catch{}throw error;}
}
const saveJson=(path,value)=>atomic(path,JSON.stringify(value,null,2)+'\n');
async function identity(path){
  const absolute=resolve(path),before=lstatSync(absolute);
  requireValue(before.isFile()&&!before.isSymbolicLink(),'Use a complete original regular file: '+absolute);
  const h=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(absolute)){h.update(chunk);bytes+=chunk.length;}
  const after=lstatSync(absolute);
  requireValue(before.dev===after.dev&&before.ino===after.ino&&before.size===bytes&&before.size===after.size&&
    before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'A retained file changed while receiving.');
  return {path:absolute,bytes,sha256:h.digest('hex')};
}
async function exactCopy(source,destination,expected){
  const original=await identity(source);if(expected)requireValue(original.sha256===expected.sha256&&original.bytes===expected.bytes,'The original copied file differs.');
  if(existsSync(destination)){
    const saved=await identity(destination);requireValue(saved.sha256===original.sha256&&saved.bytes===original.bytes,'An existing receiving output differs.');
    return saved;
  }
  privateDir(dirname(destination));const temporary=destination+'.'+randomUUID()+'.part';
  try{
    await pipeline(createReadStream(source),createWriteStream(temporary,{flags:'wx',mode:0o600}));
    const actual=await identity(temporary);requireValue(actual.sha256===original.sha256&&actual.bytes===original.bytes,'The full copy differs.');
    const fd=openSync(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
    requireValue(!existsSync(destination),'The receiving destination was created concurrently.');
    renameSync(temporary,destination);syncDirectory(dirname(destination));return {...actual,path:destination};
  }catch(error){try{unlinkSync(temporary);}catch{}throw error;}
}
function resolveInside(root,path){
  requireValue(typeof path==='string'&&path.length>0&&!path.includes('\0'),'Use a declared nonempty relative path.');
  const absolute=resolve(root,path),part=relative(root,absolute);
  requireValue(part&&!isAbsolute(part),'A declared path leaves its original source.');
  // Explicit parent-segment check is independent of platform-specific separators.
  requireValue(!part.split(/[\\/]/).includes('..'),'A declared path leaves its original source.');
  return absolute;
}
function runProcess(executable,args,{cwd,maximumBytes=32*1024*1024,onStderr,environment=process.env}={}){
  return new Promise((resolveResult,reject)=>{
    const child=spawn(executable,args,{cwd,env:environment,stdio:['ignore','pipe','pipe']});
    const stdout=[],stderr=[];let outputBytes=0,errorBytes=0,failure;
    child.stdout.on('data',chunk=>{outputBytes+=chunk.length;if(outputBytes>maximumBytes){failure=fail('GRIDFABRIC_CHILD_OUTPUT_LIMIT','The original child output exceeds its complete receiving allowance.');child.kill('SIGTERM');}else stdout.push(chunk);});
    child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=1024*1024)stderr.push(chunk);onStderr?.(chunk);});
    child.once('error',reject);
    child.once('close',(code,signal)=>{
      const result={code,signal,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)};
      if(failure)return reject(failure);
      if(code!==0)return reject(Object.assign(fail('GRIDFABRIC_NATIVE_CHILD_FAILED','Original native command failed: '+args[0]),
        {original:{code,signal,stderr:UTF8.decode(result.stderr),stdout:UTF8.decode(result.stdout)}}));
      resolveResult(result);
    });
  });
}
async function request(connection,path,{method='GET',jsonBody,bodyFile,body,callback=false,output,expected,maximumBytes=256*1024*1024,timeout=660000}={}){
  requireValue(/^http:\/\/127\.0\.0\.1:\d+$/.test(connection.origin),'Use the original loopback listener.');
  const target=new URL(path,connection.origin);requireValue(target.origin===connection.origin,'Keep the original listener origin.');
  const content=jsonBody===undefined?body:Buffer.from(JSON.stringify(jsonBody));
  const length=bodyFile?(await identity(bodyFile)).bytes:content?.length||0;
  const headers={'Connection':'close'};
  if(!callback){headers.Authorization='Bearer '+connection.token;headers.Origin=connection.origin;}
  if(method!=='GET'){
    headers['Content-Length']=String(length);
    headers['Content-Type']=jsonBody===undefined?'application/octet-stream':'application/json';
  }
  if(expected){headers['X-GridFabric-Sha256']=expected.sha256;if(expected.name)headers['X-GridFabric-Name']=encodeURIComponent(expected.name);if(expected.mime_type)headers['Content-Type']=expected.mime_type;}
  return new Promise((resolveResult,reject)=>{
    let timer,finished=false;const terminal=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolveResult(value);};
    const req=httpRequest(target,{method,headers,agent:false},response=>{
      (async()=>{
        const chunks=[],h=createHash('sha256');let count=0,temp;
        const saveToFile=output&&(callback||response.statusCode<400);
        if(saveToFile){privateDir(dirname(output));temp=output+'.'+randomUUID()+'.part';}
        let fd=temp?openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600):null;
        try{
          for await(const chunk of response){
            count+=chunk.length;requireValue(count<=maximumBytes,'The full original response exceeds the selected receiving allowance.');h.update(chunk);
            if(fd!==null)writeFileSync(fd,chunk);else chunks.push(Buffer.from(chunk));
          }
          const declared=response.headers['content-length'];if(declared!==undefined)requireValue(/^\d+$/.test(declared)&&Number(declared)===count,'The original response length differs.');
          const actualHash=h.digest('hex');
          if(expected?.sha256&&method==='GET')requireValue(actualHash===expected.sha256&&count===expected.bytes,'The original downloaded bytes differ.');
          if(response.headers['x-content-sha256'])requireValue(actualHash===response.headers['x-content-sha256'],'The native response checksum differs.');
          if(fd!==null){
            fsyncSync(fd);closeSync(fd);fd=null;
            if(existsSync(output)){const old=await identity(output);requireValue(old.sha256===actualHash&&old.bytes===count,'An existing complete response differs.');unlinkSync(temp);}
            else renameSync(temp,output);
            syncDirectory(dirname(output));
          }
          const data=Buffer.concat(chunks),result={http_status:response.statusCode,headers:response.headers,bytes:count,sha256:actualHash,
            ...(output?{file:output}:{}),body:data};
          if(!callback&&response.statusCode>=400){
            let original;try{original=JSON.parse(UTF8.decode(data));}catch{original={body_utf8:UTF8.decode(data)};}
            throw Object.assign(fail(original.error?.code||'GRIDFABRIC_HTTP_ERROR',original.error?.message||'Original HTTP '+response.statusCode),
              {http_status:response.statusCode,original});
          }
          terminal(null,result);
        }catch(error){if(fd!==null)try{closeSync(fd);}catch{}if(temp)try{unlinkSync(temp);}catch{}terminal(error);}
      })().catch(terminal);
    });
    timer=setTimeout(()=>req.destroy(fail('GRIDFABRIC_HTTP_TIMEOUT','The original response is still unconfirmed. Reconcile its saved UUID or callback.')),timeout);
    req.once('error',error=>terminal(error));
    if(bodyFile){const source=createReadStream(bodyFile);source.once('error',error=>req.destroy(error));source.pipe(req);}
    else req.end(content);
  });
}
async function read(connection,path){const response=await request(connection,path);return JSON.parse(UTF8.decode(response.body));}
function substitute(value,context){
  if(Array.isArray(value))return value.map(x=>substitute(x,context));
  if(value&&typeof value==='object'){
    if(Object.keys(value).length===1&&typeof value.$ref==='string'){
      let found=context;for(const key of value.$ref.split('.')){requireValue(found!==null&&typeof found==='object'&&Object.hasOwn(found,key),'A retained original reference is absent: '+value.$ref);found=found[key];}
      return structuredClone(found);
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,substitute(item,context)]));
  }
  return value;
}
async function verifySource(root,declaration){
  const manifest=json(declaration),entries=manifest.files||manifest.source_files;
  requireValue(Array.isArray(entries)&&entries.length>0,'The complete source declaration is missing.');
  for(const item of entries){
    const path=resolveInside(root,item.path),actual=await identity(path);
    requireValue(actual.bytes===item.bytes&&actual.sha256===item.sha256,'The exact source member differs: '+item.path);
    if(item.git_blob){
      const b=readFileSync(path),git=createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
      requireValue(git===item.git_blob,'The native Git blob differs: '+item.path);
    }
  }
  return {schema:manifest.schema,files:entries.length,declaration:await identity(declaration)};
}
async function finalizeProduct(journal,output,save){
  const result=journal.product_result;
  requireValue(journal.product_passed&&result?.status==='COMPLETE','The original complete native result must be frozen before packaging.');
    const reportPath=join(output,'GridFabric_Native_Receiving.json'),reportBytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
    if(existsSync(reportPath)){const original=readFileSync(reportPath);requireValue(original.equals(reportBytes),'The frozen original report differs.');}
    else atomic(reportPath,reportBytes);
    const customer=join(output,'customer'),handover=join(customer,'handover');privateDir(handover);
    const selected=['GridFabric_Native_Receiving.json','input-custody','outcomes','callback-responses','comparisons','snapshots',...(journal.browser?.status==='COMPLETE'?['browser']:[]),...(journal.cold_browser?.status==='COMPLETE'?['browser-cold']:[])];
    const files=[];
    async function copyTree(path,destination){
      const stat=lstatSync(path);requireValue(!stat.isSymbolicLink(),'The customer receiving contains no symbolic links.');
      if(stat.isDirectory()){privateDir(destination);for(const name of readdirSync(path).sort())await copyTree(join(path,name),join(destination,name));}
      else if(stat.isFile()){const item=await exactCopy(path,destination);files.push({path:relative(handover,destination).split('\\').join('/'),bytes:item.bytes,sha256:item.sha256});}
      else throw fail('GRIDFABRIC_CUSTOMER_MEMBER','Retain original regular customer members only.');
    }
    for(const path of selected)await copyTree(join(output,path),join(handover,path));
    for(const name of ['GridFabric_Original_Workspace.jsonl.gz','GridFabric_Cold_Reexport.jsonl.gz'])await copyTree(join(customer,name),join(handover,name));
    const manifest={schema:'stellar-forge.gridfabric-customer-manifest.v1',operation:OP,workspace_id:journal.workspace_id,revision:journal.cold_snapshot.revision,
      classification:result.classification,provider_requests:0,files:files.sort((a,b)=>a.path.localeCompare(b.path))};
    const manifestPath=join(handover,'Customer_Manifest.json'),manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    if(existsSync(manifestPath))requireValue(readFileSync(manifestPath).equals(manifestBytes),'The frozen customer member manifest differs.');else atomic(manifestPath,manifestBytes);
    const archive=join(customer,'GridFabric_Complete_Native_Receiving.tar.gz');
    if(!journal.bundle){
      if(!journal.packaging){
        requireValue(!existsSync(archive),'An unrelated customer archive occupies the original output path.');
        journal.packaging={status:'BUILDING',temporary:relative(output,archive+'.'+randomUUID()+'.part'),
          manifest_sha256:hash(manifestBytes),created_at:now()};save();
      }
      const prepared=journal.packaging,temp=resolveInside(output,prepared.temporary);
      requireValue(prepared.manifest_sha256===hash(manifestBytes),'The frozen customer source member manifest changed.');
      if(prepared.status==='BUILDING'){
        if(existsSync(temp))unlinkSync(temp);
        await runProcess('tar',['--format=posix','--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner',
          '--pax-option=delete=atime,delete=ctime,exthdr.name=%d/PaxHeaders/%f','-czf',temp,'-C',handover,'.'],{cwd:output});
        const actual=await identity(temp),fd=openSync(temp,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
        const listed=await runProcess('tar',['-tzf',temp],{cwd:output});
        const members=UTF8.decode(listed.stdout).trim().split('\n').filter(name=>!name.endsWith('/')).map(name=>name.replace(/^\.\//,''));
        requireValue(isDeepStrictEqual([...members].sort(),[...manifest.files.map(row=>row.path),'Customer_Manifest.json'].sort()),
          'The complete native customer archive member set differs.');
        journal.packaging={...prepared,status:'ARCHIVE_PREPARED',bytes:actual.bytes,sha256:actual.sha256};save();
      }
      const bound=journal.packaging;
      if(existsSync(archive)){
        const actual=await identity(archive);requireValue(actual.bytes===bound.bytes&&actual.sha256===bound.sha256,'The existing complete customer archive differs.');
      }else{
        const actual=await identity(temp);requireValue(actual.bytes===bound.bytes&&actual.sha256===bound.sha256,'The original prepared customer archive differs.');
        const moved=spawnSync('mv',['--no-clobber','--no-target-directory','--',temp,archive],{encoding:'utf8'});
        requireValue(!moved.error&&moved.status===0&&!existsSync(temp)&&existsSync(archive),'The complete original archive has not been published to its exact new destination.');
        syncDirectory(customer);
      }
      journal.bundle={path:relative(output,archive),bytes:bound.bytes,sha256:bound.sha256};save();
    }
    const reportIdentity=await identity(join(output,'GridFabric_Native_Receiving.json')),bundleIdentity=await identity(archive);
    journal.completed={summary:{workspace_id:journal.workspace_id,revision:journal.cold_snapshot.revision,steps:Object.keys(journal.steps).length,
      checks:journal.checks.length,complete_output_comparisons:journal.file_comparisons.length,source_rows:journal.cold_snapshot.state.collections.source_rows,
      report_rows:journal.cold_snapshot.state.collections.report_rows,provider_requests:0,bundle:archive},
      files:[{path:relative(output,reportIdentity.path),bytes:reportIdentity.bytes,sha256:reportIdentity.sha256},
        {path:relative(output,bundleIdentity.path),bytes:bundleIdentity.bytes,sha256:bundleIdentity.sha256}]};
    journal.status='COMPLETE';journal.phase='COMPLETE';journal.completed_at=now();save();
    process.stdout.write(JSON.stringify({operation:OP,status:'COMPLETE',...journal.completed.summary,files:journal.completed.files})+'\n');
    return journal.completed;
}

export async function receive(configuration){
  const configFile=typeof configuration==='string'?resolve(configuration):null;
  const config=configFile?json(configFile):configuration;
  requireValue(config&&typeof config==='object'&&config.sourceRoot&&config.outputDirectory,'Supply the complete original sourceRoot and private outputDirectory.');
  const root=resolve(config.sourceRoot),output=privateDir(config.outputDirectory),journalPath=join(output,'journey.json');
  let journal=existsSync(journalPath)?json(journalPath):null;
  if(journal?.status==='COMPLETE'){
    requireValue(journal.operation===OP&&journal.outputDirectory===output,'The completed receiving directory belongs to another original operation.');
    for(const file of journal.completed.files){const actual=await identity(resolveInside(output,file.path));requireValue(actual.sha256===file.sha256&&actual.bytes===file.bytes,'A frozen completed receiving artifact differs.');}
    process.stdout.write(JSON.stringify({operation:OP,status:'COMPLETE',replayed:true,report:join(output,'GridFabric_Native_Receiving.json'),...journal.completed.summary})+'\n');
    return journal.completed;
  }
  const version=process.versions.node.split('.').map(Number);
  requireValue(version[0]>22||(version[0]===22&&version[1]>=13),'Use Node 22.13 or newer with its original built-in SQLite module.');
  const sourceDeclaration=resolve(config.sourceManifest||join(root,OPERATIONS,'source-manifest.json'));
  const source=await verifySource(root,sourceDeclaration);
  const node=resolve(config.nodeExecutable||process.execPath),cli=join(root,PREFIX,'cli.mjs');
  for(const [command,args]of [['flock',['--version']],['mv',['--help']],['tar',['--version']]]){
    const observed=spawnSync(command,args,{encoding:'utf8',timeout:10000});
    requireValue(!observed.error&&observed.status===0,'The native receiver requires '+command+'.');
    if(command==='mv')requireValue(observed.stdout.includes('--no-clobber')&&observed.stdout.includes('--no-target-directory'),'Use native GNU mv with no-clobber exact-target publication.');
  }
  const {acquireStateLease}=await import(pathToFileURL(join(root,'stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs')));
  const lease=await acquireStateLease(output);
  const save=()=>{lease.assertHeld();journal.updated_at=now();saveJson(journalPath,journal);};
  let owner=null,context,input,inputFile;
  const command=async(workspace,args)=>{
    const result=await runProcess(node,[cli,...(workspace?['--workspace',workspace]:[]),...args],{cwd:output,environment:{...process.env,TMPDIR:output}});
    return JSON.parse(UTF8.decode(result.stdout));
  };
  const checkpoint=(phase,detail={})=>{journal.phase=phase;save();process.stdout.write(JSON.stringify({operation:OP,phase,...detail})+'\n');};
  const savedOutcome=(key,value)=>{
    const body=Buffer.from(JSON.stringify(value,null,2)+'\n'),sha256=hash(body);let path=join(output,'outcomes',key+'.json');
    if(existsSync(path)&&hash(readFileSync(path))!==sha256)path=join(output,'outcomes',key+'-'+sha256.slice(0,16)+'.json');
    if(existsSync(path))requireValue(readFileSync(path).equals(body),'A retained complete outcome differs.');else atomic(path,body);
    return {path:relative(output,path),bytes:body.length,sha256};
  };
  const loadOutcome=entry=>{
    const path=resolveInside(output,entry.path),body=readFileSync(path);
    requireValue(body.length===entry.bytes&&hash(body)===entry.sha256,'The saved native outcome changed.');
    return JSON.parse(UTF8.decode(body));
  };
  const closureProof=state=>{
    for(const item of journal.owners||[]){
      if(item.workspace_id===state.workspace_id&&item.workspace===state.workspace&&item.closed!==true&&!item.closure_reconciled)
        item.closure_reconciled={observed_at:now(),proof:'Original CLI acquired and released the same workspace lease',workspace_id:state.workspace_id,revision:state.revision};
    }
  };
  async function startOwner(workspace,label){
    requireValue(!owner,'Only one original product owner may run.');
    const state=await command(workspace,['status']);
    closureProof({...state,workspace});save();
    const launchId=randomUUID(),connectionFile=join(output,'connections',label+'-'+launchId+'.url');
    privateDir(dirname(connectionFile));
    const record={owner_id:launchId,label,workspace,workspace_id:state.workspace_id,started_at:now(),closed:false,connection_file:relative(output,connectionFile)};
    journal.owners.push(record);save();
    const child=spawn(node,[cli,'--workspace',workspace,'serve','--port','0','--connection-file',connectionFile,
      '--maximum-request-bytes',String(256*1024*1024),'--maximum-portable-bytes',String(4*1024*1024*1024)],
      {cwd:output,env:{...process.env,TMPDIR:output},stdio:['ignore','pipe','pipe']});
    record.pid=child.pid||null;save();
    const out=[],err=[];let logBytes=0;
    child.stdout.on('data',chunk=>{logBytes+=chunk.length;if(logBytes<1024*1024)out.push(chunk);});
    child.stderr.on('data',chunk=>{if(err.reduce((n,b)=>n+b.length,0)<1024*1024)err.push(chunk);});
    const exit=new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolveExit({code,signal}));});exit.catch(()=>{});
    owner={child,exit,record,connectionFile,stdout:out,stderr:err,connection:null};
    const deadline=Date.now()+120000;
    while(!existsSync(connectionFile)){
      if(child.exitCode!==null||child.signalCode)throw Object.assign(fail('GRIDFABRIC_OWNER_START','The original CLI owner stopped before readiness.'),{original:{stderr:Buffer.concat(err).toString('utf8')}});
      requireValue(Date.now()<deadline,'The original owner has not published readiness.');await pause(100);
    }
    const raw=readFileSync(connectionFile),url=new URL(UTF8.decode(raw).trim());
    requireValue(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.hash.length>1,'The original private connection file is invalid.');
    const connection={origin:url.origin,token:url.hash.slice(1)};
    owner.connection=connection;record.connection_sha256=hash(raw);
    const launch=await read(connection,'/api/launch'),current=await read(connection,'/api/state');
    requireValue(launch.workspace_id===state.workspace_id&&current.workspace_id===state.workspace_id&&current.revision===state.revision,'The original owner reopened a different workspace.');
    record.ready_at=now();record.launch=launch;save();return connection;
  }
  async function stopOwner(){
    if(!owner)return;
    const current=owner;current.child.kill('SIGTERM');
    let drainTimer;const drainDeadline=new Promise((_,reject)=>{drainTimer=setTimeout(()=>reject(fail('GRIDFABRIC_OWNER_DRAIN','The original owner has not drained. Preserve its lease and exact state.')),180000);});
    let closed;try{closed=await Promise.race([current.exit,drainDeadline]);}finally{clearTimeout(drainTimer);}
    requireValue(closed.code===0&&!existsSync(current.connectionFile),'The original CLI did not close and remove its own connection.');
    const log={stdout:UTF8.decode(Buffer.concat(current.stdout)),stderr:UTF8.decode(Buffer.concat(current.stderr)),...closed};
    current.record.closed=true;current.record.closed_at=now();current.record.close_log=savedOutcome('owner-'+current.record.owner_id,log);save();owner=null;
    const state=await command(current.record.workspace,['status']);requireValue(state.workspace_id===current.record.workspace_id,'The closed original workspace identity changed.');
    current.record.lease_released={observed_at:now(),workspace_id:state.workspace_id,revision:state.revision};save();
  }

  async function allRows(connection,collection,scope){
    const rows=[];let offset=0,total=null;
    for(;;){
      const query=new URLSearchParams({collection,offset:String(offset),limit:'1000',order:'asc'});
      if(scope!==undefined)query.set('scope',scope);
      const page=await read(connection,(collection.startsWith('host_')?'/api/host/page?':'/api/page?')+query);
      requireValue(page.collection===collection&&page.offset===offset&&Array.isArray(page.rows),'The original page envelope differs.');
      if(total===null)total=page.total;else requireValue(page.total===total,'The original collection changed during paging.');
      rows.push(...page.rows);
      if(page.next_offset===null){requireValue(rows.length===total,'The complete original collection count differs.');return rows;}
      requireValue(page.rows.length>0&&page.next_offset===offset+page.rows.length,'The original page cursor did not advance exactly.');
      offset=page.next_offset;
    }
  }
  async function actionStep(connection,step,resolvedInput){
    let entry=journal.steps[step.key];
    const fingerprint=hash(Buffer.from(JSON.stringify({kind:step.kind,action:step.action,input:resolvedInput})));
    if(entry){
      requireValue(entry.fingerprint===fingerprint&&entry.kind===step.kind,'A retained original step input changed: '+step.key);
      if(entry.status==='COMPLETE')return loadOutcome(entry.outcome);
      try{
        const observed=await read(connection,'/api/operation?'+new URLSearchParams({request_id:entry.request_id}));
        requireValue(observed.operation?.action===step.action&&isDeepStrictEqual(observed.operation.input,resolvedInput)&&
          observed.workspace_id===journal.workspace_id,'The original saved action binding differs.');
        if(observed.operation.result){
          entry.status='COMPLETE';entry.received_at=now();entry.outcome=savedOutcome(step.key,observed.operation.result);save();
          return observed.operation.result;
        }
        throw fail('GRIDFABRIC_ORIGINAL_ACTION_PENDING','The original action remains retained without a complete result.');
      }catch(error){
        if(error.http_status!==404||error.code!=='GRIDFABRIC_OPERATION_NOT_FOUND')throw error;
        const state=await read(connection,'/api/state');
        requireValue(state.workspace_id===journal.workspace_id&&state.revision===entry.body.expected_revision,
          'The unaccepted saved action must be reviewed against its exact original workspace and revision.');
      }
    }else{
      const state=await read(connection,'/api/state'),request_id=randomUUID();
      requireValue(state.workspace_id===journal.workspace_id,'The original source workspace changed.');
      entry={kind:step.kind,fingerprint,request_id,created_at:now(),status:'PREPARED',
        body:{action:step.action,input:resolvedInput,request_id,expected_revision:state.revision}};
      journal.steps[step.key]=entry;save();
    }
    const response=await request(connection,'/api/action',{method:'POST',jsonBody:entry.body});
    const value=JSON.parse(UTF8.decode(response.body));
    requireValue(value.request_id===entry.request_id&&value.workspace_id===journal.workspace_id&&value.action===step.action,
      'The original action response binding differs.');
    entry.status='COMPLETE';entry.received_at=now();entry.outcome=savedOutcome(step.key,value);save();return value;
  }
  async function callbackStep(connection,step,file,contracts,canonical){
    const route=contracts.public.callbacks.find(item=>item.endpoint===step.endpoint);
    requireValue(route,'Use the original documented callback endpoint.');
    const callbackId=hash(Buffer.from(canonical(['callback',step.instance_id,route.messageType,file.sha256])));
    const fingerprint=hash(Buffer.from(JSON.stringify({instance_id:step.instance_id,endpoint:step.endpoint,file_sha256:file.sha256})));
    let entry=journal.steps[step.key];
    if(entry){requireValue(entry.fingerprint===fingerprint&&entry.kind==='callback','The original callback input changed.');
      if(entry.status==='COMPLETE')return loadOutcome(entry.outcome);
    }else{
      const state=await read(connection,'/api/state'),prior=await allRows(connection,'callback_deliveries',callbackId);
      entry={kind:'callback',fingerprint,callback_id:callbackId,created_at:now(),status:'PREPARED',expected_revision:state.revision,
        original_delivery_ids:prior.map(row=>row.delivery_id),instance_id:step.instance_id,endpoint:step.endpoint,
        request_file:{sha256:file.sha256,bytes:file.bytes,path:file.path}};
      journal.steps[step.key]=entry;save();
    }
    const before=new Set(entry.original_delivery_ids),deliveries=await allRows(connection,'callback_deliveries',callbackId);
    let received=deliveries.filter(row=>!before.has(row.delivery_id)),wire=null;
    requireValue(received.length<=1,'More than one new original delivery requires explicit receiving reconciliation.');
    if(received.length===0){
      const state=await read(connection,'/api/state');
      requireValue(state.workspace_id===journal.workspace_id&&state.revision===entry.expected_revision,
        'The callback has no new retained delivery and its original revision changed; do not resend blindly.');
      const path='/callbacks/'+encodeURIComponent(step.instance_id)+'/'+encodeURIComponent(step.endpoint);
      wire=await request(connection,path,{method:'POST',callback:true,bodyFile:file.absolute,
        output:join(output,'callback-responses',step.key+'.utf8')});
      requireValue(wire.headers['x-gridfabric-callback-id']===callbackId&&typeof wire.headers['x-gridfabric-delivery-id']==='string',
        'The original callback response has no matching saved identity.');
      const item=(await read(connection,'/api/detail?'+new URLSearchParams({collection:'callback_deliveries',id:wire.headers['x-gridfabric-delivery-id']}))).record;
      requireValue(!before.has(item.delivery_id),'This receiving step unexpectedly reused an earlier delivery.');
      received=[item];
    }
    const delivery=received[0],record=(await read(connection,'/api/detail?'+new URLSearchParams({collection:'callbacks',id:callbackId}))).record;
    requireValue(delivery.callback_id===callbackId&&delivery.instance_id===step.instance_id&&delivery.kind===route.messageType&&
      delivery.request_file.sha256===file.sha256,'The received callback does not bind the original request bytes.');
    const actual=await request(connection,'/api/file?id='+delivery.response_file.sha256,{output:join(output,'callback-responses',step.key+'.utf8'),expected:delivery.response_file});
    if(wire)requireValue(wire.http_status===delivery.http_status&&wire.bytes===actual.bytes&&wire.sha256===actual.sha256,
      'The callback HTTP response differs from its complete retained original response.');
    const state=await read(connection,'/api/state');
    requireValue(state.workspace_id===journal.workspace_id&&state.revision===entry.expected_revision+1,
      'The original callback revision differs; preserve its delivery and reconcile subsequent actions.');
    const value={http_status:delivery.http_status,body_utf8:UTF8.decode(readFileSync(actual.file)),callback_id:callbackId,
      delivery_id:delivery.delivery_id,replayed:delivery.replayed,processing_status:delivery.processing_status,
      report_id:record.report_id||null,projection:record.projection||null,revision:state.revision};
    entry.status='COMPLETE';entry.received_at=now();entry.http_response={http_status:delivery.http_status,bytes:actual.bytes,sha256:actual.sha256,
      path:relative(output,actual.file)};entry.outcome=savedOutcome(step.key,value);save();return value;
  }
  async function snapshot(connection,label){
    const start=await read(connection,'/api/state'),launch=await read(connection,'/api/launch');
    requireValue(start.workspace_id===journal.workspace_id,'The complete source snapshot belongs to another workspace.');
    const saved={workspace_id:start.workspace_id,revision:start.revision,state:start,collections:[],files:[],launch};
    for(const collection of [...launch.tables,'host_dispatches','host_files']){
      const final=join(output,'snapshots',label,collection+'.jsonl');privateDir(dirname(final));
      const temporary=final+'.'+randomUUID()+'.part',fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      const h=createHash('sha256');let total=null,offset=0,count=0,bytes=0;
      const ids=new Set();
      try{
        for(;;){
          const page=await read(connection,(collection.startsWith('host_')?'/api/host/page?':'/api/page?')+
            new URLSearchParams({collection,offset:String(offset),limit:'1000',order:'asc'}));
          requireValue(page.offset===offset&&page.collection===collection,'The native full-page envelope differs.');
          if(total===null)total=page.total;else requireValue(page.total===total,'The original collection changed during full receiving.');
          for(const row of page.rows){
            requireValue(typeof row.id==='string'&&!ids.has(row.id),'The complete native collection repeated an identity.');ids.add(row.id);
            const line=Buffer.from(JSON.stringify(row)+'\n');h.update(line);bytes+=line.length;count++;writeFileSync(fd,line);
            if(collection==='host_files')saved.files.push({sha256:row.sha256,bytes:row.bytes,name:row.name,mime_type:row.mime_type});
          }
          if(page.next_offset===null)break;
          requireValue(page.next_offset===offset+page.rows.length&&page.rows.length>0,'The native full-page cursor did not advance.');offset=page.next_offset;
        }
        requireValue(count===total,'The complete original collection count differs.');
        fsyncSync(fd);
      }finally{closeSync(fd);}
      const item={collection,rows:count,bytes,sha256:h.digest('hex'),path:relative(output,final)};
      if(existsSync(final)){const prior=await identity(final);requireValue(prior.sha256===item.sha256&&prior.bytes===item.bytes,'A saved native snapshot differs.');unlinkSync(temporary);}
      else renameSync(temporary,final);
      syncDirectory(dirname(final));saved.collections.push(item);
    }
    requireValue(saved.collections.find(row=>row.collection==='host_dispatches').rows===0,'The functional receiving must have no external dispatch journal.');
    for(const file of saved.files){
      const path=join(output,'snapshots',label,'files',file.sha256+'.utf8');
      await request(connection,'/api/file?id='+file.sha256,{expected:file,output:path});
      file.path=relative(output,path);
    }
    const end=await read(connection,'/api/state');
    requireValue(end.workspace_id===start.workspace_id&&end.revision===start.revision,'The original workspace advanced during full snapshot receiving.');
    saved.source_files=saved.files.length;saved.source_bytes=saved.files.reduce((n,x)=>n+x.bytes,0);
    const manifest=join(output,'snapshots',label,'manifest.json');saveJson(manifest,saved);saved.manifest=await identity(manifest);
    return saved;
  }
  async function portableExport(connection){
    if(!journal.portable_request){
      const state=await read(connection,'/api/state');journal.portable_request={request_id:randomUUID(),expected_revision:state.revision};save();
    }
    const envelope=journal.portable_request,catalog=await read(connection,'/api/exports');
    let exported=catalog.items.find(row=>row.export_id===envelope.request_id);
    if(exported?.status!=='READY'){
      exported=JSON.parse(UTF8.decode((await request(connection,'/api/export',{method:'POST',jsonBody:envelope})).body));
    }
    requireValue(exported.status==='READY'&&exported.export_id===envelope.request_id,'The original portable export is not complete.');
    const destination=join(output,'customer','GridFabric_Original_Workspace.jsonl.gz');
    await request(connection,'/api/export?id='+exported.export_id,{expected:exported,output:destination,maximumBytes:4*1024*1024*1024});
    journal.portable={...exported,path:relative(output,destination)};save();return destination;
  }
  try{
    if(!journal){
      journal={schema:'stellar-forge.gridfabric-native-receiving.v1',operation:OP,status:'RUNNING',phase:'SOURCE_READY',created_at:now(),
        outputDirectory:output,sourceRoot:root,sourceCommit:config.sourceCommit||null,source,owners:[],steps:{},provider_requests:0,
        workspace:join(output,'workspace'),restored_workspace:join(output,'restored-workspace'),input: null};
      save();
    }else{
      requireValue(journal.operation===OP&&journal.outputDirectory===output&&journal.source.declaration.sha256===source.declaration.sha256,
        'The retained receiving operation uses another source declaration or directory.');
      journal.status='RUNNING';journal.last_error=null;save();
    }
    if(journal.product_passed&&journal.product_result)return await finalizeProduct(journal,output,save);
    inputFile=config.inputFile?resolve(configFile?dirname(configFile):process.cwd(),config.inputFile):join(output,'input','gridfabric-functional-input.json');
    if(!config.inputFile){
      const generated=await runProcess(node,[join(root,OPERATIONS,'generate-functional-input.mjs'),dirname(inputFile)],{cwd:output});
      journal.generator=JSON.parse(UTF8.decode(generated.stdout));save();
    }
    input=json(inputFile);
    requireValue(input.schema==='stellar-forge.gridfabric-functional-receiving.v1'&&Array.isArray(input.files)&&Array.isArray(input.steps)&&
      input.classification==='TOKENJUNKIELABS_AUTHORED_FUNCTIONAL_DATA_NOT_VENDOR_CAPTURE','Use the original explicitly labeled complete functional receiving input.');
    const inputIdentity=await identity(inputFile);
    const originalDeclaration=json(join(root,OPERATIONS,'functional-input-manifest.json'));
    const declaredInput=originalDeclaration.files.find(row=>row.key==='receiving_input');
    requireValue(declaredInput&&inputIdentity.sha256===declaredInput.sha256&&inputIdentity.bytes===declaredInput.bytes,
      'Use the exact published complete receiving input, retaining all original steps and comparisons.');
    requireValue(input.files.length+1===originalDeclaration.files.length,'The complete published input file set differs.');
    for(const entry of input.files){const expected=originalDeclaration.files.find(row=>row.key===entry.key);
      requireValue(expected&&expected.path===entry.path&&expected.bytes===entry.bytes&&expected.sha256===entry.sha256,
        'A complete source member differs from the published original input manifest.');
    }
    if(journal.input)requireValue(journal.input.sha256===inputIdentity.sha256&&journal.input.bytes===inputIdentity.bytes,'The original full receiving input changed.');
    else{journal.input={...inputIdentity,classification:input.classification};save();}
    context={files:{},steps:{}};
    for(const entry of input.files){
      const absolute=resolveInside(dirname(inputFile),entry.path),actual=await identity(absolute);
      requireValue(actual.sha256===entry.sha256&&actual.bytes===entry.bytes,'A complete retained functional source differs: '+entry.key);
      requireValue(!context.files[entry.key],'The receiving file key is duplicated.');
      context.files[entry.key]={...entry,absolute};
      await exactCopy(absolute,join(output,'input-custody',entry.path),entry);
    }
    await exactCopy(inputFile,join(output,'input-custody','gridfabric-functional-input.json'),inputIdentity);
    const originalState=await command(journal.workspace,['init','--label','GridFabric original 31-day receiving']);
    if(journal.workspace_id)requireValue(originalState.workspace_id===journal.workspace_id,'The same original source workspace is required.');
    else{journal.workspace_id=originalState.workspace_id;save();}
    closureProof({...originalState,workspace:journal.workspace});save();
    const connection=await startOwner(journal.workspace,'original');
    const contracts=await read(connection,'/api/contracts');
    const {createRequire}=await import('node:module'),canonical=createRequire(import.meta.url)(join(root,PREFIX,'model.cjs')).canonical;
    const stepKeys=new Set();
    for(const step of input.steps){
      requireValue(typeof step.key==='string'&&/^[a-z0-9_-]+$/i.test(step.key)&&!stepKeys.has(step.key),'Use unique original receiving step keys.');stepKeys.add(step.key);
      checkpoint('ORIGINAL_'+step.key.toUpperCase(),{step:step.key,completed:Object.values(journal.steps).filter(row=>row.status==='COMPLETE').length});
      let result;
      if(step.kind==='import'){
        const file=context.files[step.file_key];requireValue(file,'The original import file is absent.');
        if(journal.steps[step.key]?.status!=='COMPLETE'){
          const uploaded=JSON.parse(UTF8.decode((await request(connection,'/api/upload',{method:'POST',bodyFile:file.absolute,expected:file})).body));
          requireValue(uploaded.sha256===file.sha256&&uploaded.bytes===file.bytes,'The native original source upload differs.');
        }
        result=await actionStep(connection,{...step,action:'import_source'},{...substitute(step.input,context),file_sha256:file.sha256});
      }else if(step.kind==='action'){
        requireValue(!FORBIDDEN.has(step.action),'Functional receiving cannot begin or fabricate an external dispatch receipt.');
        result=await actionStep(connection,step,substitute(step.input,context));
      }else if(step.kind==='callback'){
        const file=context.files[step.file_key];requireValue(file,'The original callback file is absent.');
        result=await callbackStep(connection,step,file,contracts,canonical);
      }else throw fail('GRIDFABRIC_RECEIVING_STEP','The original receiving step kind is unknown.');
      context.steps[step.key]=result;
    }
    const checks=[];
    for(let i=0;i<input.checks.length;i++){
      const check=input.checks[i],actual=substitute(check.target,context),expected=substitute(check.equals,context);
      requireValue(isDeepStrictEqual(actual,expected),'Original functional assertion '+i+' differs: '+JSON.stringify(check.target));
      checks.push({index:i,target:check.target,passed:true});
    }
    const comparisons=[];
    for(const item of input.file_comparisons){
      const id=substitute(item.actual_sha256,context),expected=context.files[item.expected_file_key];
      requireValue(/^[0-9a-f]{64}$/.test(id)&&expected,'The complete expected output reference is absent.');
      const actualPath=join(output,'comparisons',item.expected_file_key+'.original');
      const actual=await request(connection,'/api/file?id='+id,{output:actualPath});
      requireValue(actual.sha256===id,'The complete comparison response differs from its original identity.');
      const raw=readFileSync(actualPath),expectedRaw=readFileSync(expected.absolute);
      if(item.representation==='json')requireValue(isDeepStrictEqual(JSON.parse(UTF8.decode(raw)),JSON.parse(UTF8.decode(expectedRaw))),'The complete structured original output differs.');
      else requireValue(raw.equals(expectedRaw),'The complete original UTF-8 output differs.');
      comparisons.push({representation:item.representation,expected_file_key:item.expected_file_key,
        original:{path:relative(output,actualPath),bytes:actual.bytes,sha256:actual.sha256},expected:{bytes:expected.bytes,sha256:expected.sha256},passed:true});
    }
    journal.checks=checks;journal.file_comparisons=comparisons;save();
    checkpoint('COMPLETE_NATIVE_COLLECTIONS');
    journal.original_snapshot=await snapshot(connection,'original');save();
    const portable=await portableExport(connection);
    if(config.browser){
      checkpoint('READ_ONLY_BROWSER');
      const {runBrowser}=await import(pathToFileURL(join(root,OPERATIONS,'run-browser.mjs')));
      journal.browser=await runBrowser({connection,outputDirectory:join(output,'browser'),workspaceId:journal.workspace_id,
        revision:journal.original_snapshot.revision,playwrightPackage:config.browser.playwrightPackage,
        executablePath:config.browser.executablePath,expectedFiles:journal.original_snapshot.files});
      save();
    }else{journal.browser={status:'NOT_REQUESTED',reason:'Complete native SQLite/HTTP/CLI receiving remains the recorded operation.'};save();}
    await stopOwner();checkpoint('ORIGINAL_OWNER_CLOSED');
    const inspected=await command(null,['inspect-portable','--file',portable,'--expected-sha',journal.portable.sha256]);
    journal.portable_inspection=savedOutcome('portable-inspection',inspected);save();
    const restored=await command(journal.restored_workspace,['restore','--file',portable,'--expected-sha',journal.portable.sha256]);
    requireValue(restored.workspace_id===journal.workspace_id&&restored.revision===journal.original_snapshot.revision,
      'The original cold restoration identity differs.');
    journal.restore=savedOutcome('original-restoration',restored);save();
    const coldConnection=await startOwner(journal.restored_workspace,'cold');
    checkpoint('COLD_ORIGINAL_COLLECTIONS');
    const cold=await snapshot(coldConnection,'cold');journal.cold_snapshot=cold;
    requireValue(cold.workspace_id===journal.original_snapshot.workspace_id&&cold.revision===journal.original_snapshot.revision&&
      isDeepStrictEqual(cold.state,journal.original_snapshot.state),'The cold native workspace state differs.');
    requireValue(cold.collections.length===journal.original_snapshot.collections.length,'The complete cold collection set differs.');
    for(const item of journal.original_snapshot.collections){
      const received=cold.collections.find(row=>row.collection===item.collection);
      requireValue(received&&received.rows===item.rows&&received.bytes===item.bytes&&received.sha256===item.sha256,
        'The complete cold native collection differs: '+item.collection);
    }
    requireValue(cold.files.length===journal.original_snapshot.files.length,'The cold original file count differs.');
    for(const original of journal.original_snapshot.files){const actual=cold.files.find(row=>row.sha256===original.sha256);
      requireValue(actual&&actual.bytes===original.bytes&&actual.name===original.name&&actual.mime_type===original.mime_type,'An original cold source identity differs.');
    }
    save();
    if(config.browser){
      const {runBrowser}=await import(pathToFileURL(join(root,OPERATIONS,'run-browser.mjs')));
      journal.cold_browser=await runBrowser({connection:coldConnection,outputDirectory:join(output,'browser-cold'),workspaceId:journal.workspace_id,
        revision:cold.revision,playwrightPackage:config.browser.playwrightPackage,executablePath:config.browser.executablePath,expectedFiles:cold.files});save();
    }
    await stopOwner();checkpoint('COLD_OWNER_CLOSED');
    if(!journal.cold_export_request){journal.cold_export_request={request_id:randomUUID(),expected_revision:cold.revision};save();}
    const coldFile=join(output,'customer','GridFabric_Cold_Reexport.jsonl.gz');
    const coldExport=await command(journal.restored_workspace,['export','--out',coldFile,'--request-id',journal.cold_export_request.request_id,
      '--expected-revision',String(journal.cold_export_request.expected_revision)]);
    const coldInspection=await command(null,['inspect-portable','--file',coldFile,'--expected-sha',coldExport.file.sha256]);
    requireValue(coldInspection.header.workspace_id===inspected.header.workspace_id&&coldInspection.header.revision===inspected.header.revision&&
      coldInspection.header.records_sha256===inspected.header.records_sha256&&isDeepStrictEqual(coldInspection.header.files,inspected.header.files),
      'The complete cold CLI re-export differs in original logical records or files.');
    journal.cold_export=savedOutcome('cold-reexport',{export:coldExport,inspection:coldInspection});save();
    const finalState=await command(journal.restored_workspace,['status']);
    closureProof({...finalState,workspace:journal.restored_workspace});
    requireValue(finalState.revision===cold.revision&&journal.owners.every(item=>item.closed||item.closure_reconciled),
      'Every original owner must be closed or reconciled by the same native lease.');
    const result={schema:'stellar-forge.gridfabric-complete-native-receiving.v1',operation:OP,status:'COMPLETE',completed_at:now(),
      sourceCommit:journal.sourceCommit,source:journal.source,input:journal.input,classification:input.classification,
      provider_requests:0,execution:'Original Node SQLite domain, authenticated HTTP listener, native CLI and complete portable cold receiving',
      steps:Object.keys(journal.steps).length,checks:journal.checks,file_comparisons:journal.file_comparisons,
      workspace_id:journal.workspace_id,revision:cold.revision,original_snapshot:journal.original_snapshot,cold_snapshot:journal.cold_snapshot,
      portable:journal.portable,cold_export:journal.cold_export,browser:journal.browser,cold_browser:journal.cold_browser||{status:'NOT_REQUESTED'},owners:journal.owners,original_steps:journal.steps};
    journal.product_result=result;journal.product_passed=true;journal.status='PRODUCT_COMPLETE';journal.phase='PACKAGING';save();
    return await finalizeProduct(journal,output,save);
  }catch(error){
    if(journal){journal.status=journal.product_passed?'DELIVERY_INCOMPLETE':'RECEIVING_INCOMPLETE';journal.last_error=errorView(error);save();}
    throw error;
  }finally{
    try{if(owner)await stopOwner();}catch(error){if(journal){journal.owner_close_error=errorView(error);save();}}
    await lease.close();
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  receive(process.argv[2]).catch(error=>{process.stderr.write(JSON.stringify({operation:OP,status:'INCOMPLETE',error:errorView(error)})+'\n');process.exitCode=1;});
}
