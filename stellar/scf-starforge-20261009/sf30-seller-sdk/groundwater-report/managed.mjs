// SPDX-License-Identifier: MIT
// The original Report Desk inside the maintained Applications process lifecycle.
import {DatabaseSync} from 'node:sqlite';
import {constants} from 'node:fs';
import {access,lstat,realpath,readdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {SCHEMA,need,absolute,sha,canonical,read,readJSON,directory,exists,child} from './common.mjs';

export const REPORT_SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/groundwater-report';
export const CORE_SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/groundwater';
export const MANAGED_SCHEMA='stellar-forge.groundwater-report-managed.v1';
export const STARTUP_SCHEMA='stellar-forge.groundwater-report-startup.v1';
export const EXECUTED_SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const inode=s=>({dev:String(s.dev),ino:String(s.ino)});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const hash=value=>sha(canonical(value));
const expected=(actual,value,label)=>need(value===undefined||HASH.test(value)&&value===actual,
  'REPORT_APPLICATION_SELECTION_CHANGED','Review the current original '+label+' before starting it.');
const atimeIgnored=(s,t)=>same(s,t)&&s.size===t.size&&s.mtimeNs===t.mtimeNs&&s.ctimeNs===t.ctimeNs;
async function privateFile(path,limit=65536){
  const before=await lstat(path,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&!(before.mode&0o077n)&&
    before.uid===BigInt(process.getuid()),'REPORT_PRIVATE_FILE','Choose a private original file owned by this operator.');
  const raw=await read(path,limit),after=await lstat(path,{bigint:true});
  need(atimeIgnored(before,after),'REPORT_APPLICATION_SELECTION_CHANGED','The selected private file changed during review.');
  return {path,bytes:raw.length,sha256:sha(raw),...inode(after),raw};
}

/** Mutable request/result files are work. Only the original marker and directory bind a saved launch. */
export async function inspectReportDesk(path,{expectedIdentity}={}){
  absolute(path);await directory(path);
  const before=await lstat(path,{bigint:true}),marker=await privateFile(join(path,'desk.json'));
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(marker.raw));}
  catch{need(false,'REPORT_DESK_IDENTITY','The original Report Desk marker is unreadable.');}
  need(value?.schema===SCHEMA&&UUID.test(value.id??'')&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt)),
    'REPORT_DESK_IDENTITY','Choose the directory created or received by the original Report Desk.');
  await directory(join(path,'operations'));
  const after=await lstat(path,{bigint:true});
  need(same(before,after),'REPORT_APPLICATION_SELECTION_CHANGED','The original Report Desk directory changed.');
  const {raw,...markerIdentity}=marker;
  const identity={schema:MANAGED_SCHEMA+'.desk',directory:path,directoryIdentity:inode(after),
    marker:markerIdentity,desk:{schema:value.schema,id:value.id,createdAt:value.createdAt}};
  const sha256=hash(identity);expected(sha256,expectedIdentity,'Report Desk');
  return {...identity,sha256};
}

/** Read the native metadata table without invoking a Workbench constructor or changing scientific state. */
export async function inspectScientificWorkspace(path,{expectedIdentity}={}){
  absolute(path);await directory(path);
  const before=await lstat(path,{bigint:true}),dbPath=join(path,'groundwater.sqlite');
  const dbBefore=await lstat(dbPath,{bigint:true});
  need(dbBefore.isFile()&&!dbBefore.isSymbolicLink()&&dbBefore.size>0n&&
    !(dbBefore.mode&0o077n)&&dbBefore.uid===BigInt(process.getuid())&&await realpath(dbPath)===dbPath,
    'REPORT_SCIENTIFIC_IDENTITY','Select the existing private groundwater.sqlite through its original workspace.');
  let db,values;
  try{
    db=new DatabaseSync(dbPath,{readOnly:true});
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN');
    const rows=db.prepare("SELECT key,substr(value,1,4097) AS value,length(CAST(value AS BLOB)) AS bytes FROM meta WHERE key IN ('id','created','version')").all();
    need(rows.length===3&&rows.every(row=>typeof row.value==='string'&&row.bytes<=4096&&Buffer.byteLength(row.value)===row.bytes),
      'REPORT_SCIENTIFIC_IDENTITY','The original groundwater metadata is incomplete.');
    values=Object.fromEntries(rows.map(row=>[row.key,row.value]));
    need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(values.id)&&Number.isFinite(Date.parse(values.created))&&/^\d+$/.test(values.version),
      'REPORT_SCIENTIFIC_IDENTITY','The original groundwater identity is invalid.');
    for(const query of [
      'SELECT id,request_sha256,request,action,result,created FROM operations LIMIT 0',
      'SELECT id,version,body,created,updated FROM projects LIMIT 0',
      'SELECT id,project_id,kind,body,created,updated FROM records LIMIT 0',
      'SELECT seq,operation_id,project_id,action,actor,body,created FROM history LIMIT 0'])db.prepare(query);
    db.exec('COMMIT');
  }finally{db?.close();}
  const dbAfter=await lstat(dbPath,{bigint:true}),after=await lstat(path,{bigint:true});
  need(same(before,after)&&same(dbBefore,dbAfter)&&!dbAfter.isSymbolicLink()&&await realpath(dbPath)===dbPath,
    'REPORT_APPLICATION_SELECTION_CHANGED','The original scientific database was replaced during review.');
  const identity={schema:MANAGED_SCHEMA+'.scientific',directory:path,directoryIdentity:inode(after),
    database:{path:dbPath,...inode(dbAfter)},workspace:{id:values.id,created:values.created}};
  const sha256=hash(identity);expected(sha256,expectedIdentity,'scientific workspace');
  return {...identity,sha256};
}

/** Bind the complete selected adapter and the original report reader package.
 * Application examples, portal provisioning and solvers are not loaded by this command. */
export async function inspectReportLaunchSource(root,{expectedSha256}={}){
  absolute(root);await directory(root,{privateOnly:false});
  const roots=[REPORT_SOURCE,CORE_SOURCE+'/groundwater_workspace'];
  const files=[];let bytes=0;
  async function walk(prefix){
    const path=join(root,prefix);const before=await lstat(path,{bigint:true});
    need(before.isDirectory()&&!before.isSymbolicLink()&&await realpath(path)===path,'REPORT_SOURCE_IDENTITY','Select original installed source directories.');
    for(const name of (await readdir(path)).sort()){
      if(name==='__pycache__')continue;
      need(!name.startsWith('.')&&name!=='node_modules','REPORT_SOURCE_IDENTITY','Unexpected private or installed files occupy the selected source.');
      const relative=prefix+'/'+name,full=join(root,relative),info=await lstat(full,{bigint:true});
      if(info.isDirectory()){await walk(relative);continue;}
      need(info.isFile()&&!info.isSymbolicLink(),'REPORT_SOURCE_IDENTITY','A selected source member is not an original regular file.');
      const raw=await read(full,8*1024*1024);bytes+=raw.length;
      need(files.length<512&&bytes<=32*1024*1024,'REPORT_SOURCE_BOUND','The selected direct report source exceeds its declared bound.');
      files.push({path:relative,bytes:raw.length,sha256:sha(raw)});
    }
    const after=await lstat(path,{bigint:true});
    need(same(before,after)&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,
      'REPORT_SOURCE_CHANGED','The selected source file set changed during inspection.');
  }
  for(const prefix of roots)await walk(prefix);
  for(const required of ['managed.mjs','managed-cli.mjs','application-provider.mjs','desk.mjs','server.mjs','bridge.py','ui/index.html','ui/app.js','ui/style.css'])
    need(files.some(row=>row.path===REPORT_SOURCE+'/'+required),'REPORT_SOURCE_INCOMPLETE','The selected runtime is missing '+required+'.');
  for(const required of ['__init__.py','store.py','common.py','delivery.py','sources.py'])
    need(files.some(row=>row.path===CORE_SOURCE+'/groundwater_workspace/'+required),'REPORT_SOURCE_INCOMPLETE','The original report reader is missing '+required+'.');
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const identity={schema:MANAGED_SCHEMA+'.source',files},sha256=hash(identity);
  expected(sha256,expectedSha256,'installed report source');
  return {...identity,sourceRoot:root,sha256};
}

export async function inspectReportPython(path,{expectedIdentity}={}){
  absolute(path);await access(path,constants.X_OK);
  const selected=await lstat(path,{bigint:true}),target=await realpath(path);
  const raw=await read(target,128*1024*1024);
  const identity={schema:MANAGED_SCHEMA+'.python',executable:path,target,
    executableIdentity:inode(selected),bytes:raw.length,sha256:sha(raw),venv:null};
  const cfg=join(dirname(dirname(path)),'pyvenv.cfg');
  if(await exists(cfg)){
    const original=await read(cfg,65536);
    identity.venv={path:cfg,bytes:original.length,sha256:sha(original)};
  }
  const current=await lstat(path,{bigint:true});
  need(atimeIgnored(selected,current)&&await realpath(path)===target,'REPORT_PYTHON_CHANGED','The selected Python interpreter changed.');
  const identitySha256=hash(identity);expected(identitySha256,expectedIdentity,'Python interpreter');
  return {...identity,identitySha256};
}

export async function inspectReportAccessFile(path,{expectedSha256}={}){
  const row=await privateFile(absolute(path),16384);
  const {privateAccess}=await import('./cli.mjs');await privateAccess(path);
  expected(row.sha256,expectedSha256,'Operations access file');
  const {raw,...result}=row;return result;
}

export function validateFacilitator(url,allowLocal=false){
  if(!url){need(!allowLocal,'REPORT_FACILITATOR_REQUIRED','Select an explicit local facilitator URL for that option.',422);return null;}
  let parsed;try{parsed=new URL(url);}catch{need(false,'REPORT_FACILITATOR_URL','Use the actual facilitator URL.',422);}
  need(!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&
    (parsed.protocol==='https:'||allowLocal&&parsed.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)),
    'REPORT_FACILITATOR_URL','Use the reviewed HTTPS facilitator, or explicitly allow its local HTTP service.',422);
  return parsed.href;
}

const VALUE_OPTIONS=new Set(['--desk','--source-root','--python','--expected-desk','--expected-source','--expected-python',
  '--scientific-workspace','--expected-scientific','--operations-url-file','--expected-operations','--facilitator',
  '--allow-local-facilitator','--port','--managed-operation']);
export function managedSelection(args,{requireOperation=true}={}){
  need(Array.isArray(args)&&args[0]==='serve'&&(args.length-1)%2===0,'REPORT_MANAGED_ARGUMENTS','Use the retained original managed command.');
  const values={};
  for(let i=1;i<args.length;i+=2){need(VALUE_OPTIONS.has(args[i])&&!Object.hasOwn(values,args[i]),'REPORT_MANAGED_ARGUMENTS','The original managed arguments differ.');values[args[i]]=args[i+1];}
  for(const name of ['--desk','--source-root','--python'])absolute(values[name],name);
  for(const name of ['--expected-desk','--expected-source','--expected-python'])need(HASH.test(values[name]??''),'REPORT_MANAGED_REVIEW_REQUIRED','Retain the original reviewed '+name+'.');
  need(/^(0|[1-9]\d*)$/.test(values['--port']??'0')&&Number(values['--port']??0)<=65535,'REPORT_PORT','Use the actual reviewed local port.',422);
  for(const pair of [['--scientific-workspace','--expected-scientific'],['--operations-url-file','--expected-operations']]){
    need(Boolean(values[pair[0]])===Boolean(values[pair[1]]),'REPORT_MANAGED_ARGUMENTS','Retain the complete optional original binding.');
    if(values[pair[0]]){absolute(values[pair[0]]);need(HASH.test(values[pair[1]]),'REPORT_MANAGED_ARGUMENTS','Retain the exact optional digest.');}
  }
  need(values['--allow-local-facilitator']===undefined||['true','false'].includes(values['--allow-local-facilitator']),'REPORT_MANAGED_ARGUMENTS','Use the saved explicit local-facilitator choice.');
  if(requireOperation)need(UUID.test(values['--managed-operation']??''),'REPORT_MANAGED_OPERATION','Use the original managed run UUID.');
  else need(values['--managed-operation']===undefined||UUID.test(values['--managed-operation']),'REPORT_MANAGED_OPERATION','Use the original managed run UUID.');
  const allowLocalFacilitator=values['--allow-local-facilitator']==='true';
  return {directory:values['--desk'],sourceRoot:values['--source-root'],python:values['--python'],
    expectedDesk:values['--expected-desk'],expectedSource:values['--expected-source'],expectedPython:values['--expected-python'],
    scientificWorkspace:values['--scientific-workspace']??null,expectedScientific:values['--expected-scientific']??null,
    operationsUrlFile:values['--operations-url-file']??null,expectedOperations:values['--expected-operations']??null,
    facilitator:validateFacilitator(values['--facilitator'],allowLocalFacilitator),allowLocalFacilitator,
    port:Number(values['--port']??0),operationId:values['--managed-operation']??null};
}

export async function verifyManagedSelection(selected,{executedRoot=EXECUTED_SOURCE_ROOT}={}){
  const desk=await inspectReportDesk(selected.directory,{expectedIdentity:selected.expectedDesk});
  const source=await inspectReportLaunchSource(selected.sourceRoot,{expectedSha256:selected.expectedSource});
  const executed=await inspectReportLaunchSource(executedRoot,{expectedSha256:selected.expectedSource});
  const python=await inspectReportPython(selected.python,{expectedIdentity:selected.expectedPython});
  const scientific=selected.scientificWorkspace?await inspectScientificWorkspace(selected.scientificWorkspace,{expectedIdentity:selected.expectedScientific}):null;
  const operations=selected.operationsUrlFile?await inspectReportAccessFile(selected.operationsUrlFile,{expectedSha256:selected.expectedOperations}):null;
  return {desk,source,executed,python,scientific,operations};
}

export async function authenticatedReportState(url,deskId,{signal}={}){
  const u=new URL(url);
  need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&!u.search&&u.pathname==='/'&&/^#access=[a-f0-9]{64}$/.test(u.hash),
    'REPORT_STARTUP_URL','Use the actual private native Report Desk URL.');
  const response=await fetch(new URL('/api/'+encodeURIComponent(deskId)+'/state',u),{
    redirect:'error',headers:{Authorization:'Bearer '+u.hash.slice('#access='.length)},signal:signal??AbortSignal.timeout(5000)});
  need(response.status===200&&/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''),
    'REPORT_STARTUP_UNAVAILABLE','The actual listener did not return authenticated original Report Desk state.');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;need(bytes<=16*1024*1024,'REPORT_STATE_BOUND','The current Report Desk state exceeds the native bound.');chunks.push(chunk);}
  let state;try{state=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{need(false,'REPORT_STARTUP_UNAVAILABLE','The original listener returned unreadable state.');}
  return state;
}

export async function reportStartup(request,text){
  if(request.command!=='groundwater-report-managed'||typeof text!=='string'||text.length>65536||
    !text.startsWith('{"schema":"'+STARTUP_SCHEMA+'",'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(value?.schema!==STARTUP_SCHEMA||value.state!=='REPORT_DESK_READY')return null;
  const selected=managedSelection(request.args),executedRoot=join(absolute(request.releaseDirectory),'source');
  const original=await verifyManagedSelection(selected,{executedRoot});
  need(value.operationId===selected.operationId&&value.directory===selected.directory&&value.deskId===original.desk.desk.id&&
    value.deskIdentity===selected.expectedDesk&&value.sourceRoot===selected.sourceRoot&&value.executedSourceRoot===executedRoot&&
    value.sourceSha256===selected.expectedSource&&value.pythonIdentity===selected.expectedPython&&
    value.scientificIdentity===(original.scientific?.sha256??null)&&value.operationsFileSha256===(original.operations?.sha256??null)&&
    value.facilitator===selected.facilitator&&value.allowLocalFacilitator===selected.allowLocalFacilitator&&
    UUID.test(value.instanceId??'')&&Number.isSafeInteger(value.pid)&&value.pid>0,
    'REPORT_STARTUP_IDENTITY','The actual managed Report Desk differs from its retained original request.');
  const url=new URL(value.url),port=Number(url.port||80);
  need(url.origin===value.origin&&port>=1&&port<=65535&&(!selected.port||port===selected.port)&&
    value.apiBase==='/api/'+original.desk.desk.id&&value.mode===(selected.facilitator?'CONFIGURED_NATIVE_FACILITATOR':'CHALLENGE_ONLY'),
    'REPORT_STARTUP_IDENTITY','The actual listener differs from the reviewed service mode or port.');
  const state=await authenticatedReportState(value.url,original.desk.desk.id);
  need(state?.schema===SCHEMA&&canonical(state.desk)===canonical(original.desk.desk)&&
    state.sourceConfigured===Boolean(selected.scientificWorkspace)&&state.operationsConfigured===Boolean(selected.operationsUrlFile),
    'REPORT_STARTUP_IDENTITY','The authenticated listener serves a different original Report Desk.');
  return {url:value.url,workspaceId:original.desk.desk.id,original:{schema:STARTUP_SCHEMA,operationId:selected.operationId,
    directory:selected.directory,deskId:original.desk.desk.id,deskIdentity:selected.expectedDesk,
    sourceRoot:selected.sourceRoot,executedSourceRoot:executedRoot,sourceSha256:selected.expectedSource,
    pythonIdentity:selected.expectedPython,scientificIdentity:original.scientific?.sha256??null,
    operationsFileSha256:original.operations?.sha256??null,mode:value.mode,instanceId:value.instanceId,pid:value.pid}};
}

/** Open the existing domain and listener only after the selected and executed source agree. */
export async function startManagedReportDesk(selected,{handleSignals=true,onStartup}={}){
  const abort=new AbortController();
  let service,closing=false,closePromise,resolveInitialized,opened,failure;
  const initialized=new Promise(resolve=>{resolveInitialized=resolve;});
  const close=()=>{closing=true;abort.abort();return closePromise??=(async()=>{
    await initialized;if(service)await service.close();
  })().finally(()=>{for(const name of ['SIGINT','SIGTERM'])process.off(name,stop);});};
  const stop=()=>{close().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'REPORT_CLOSE',message:error.message}})+'\n');process.exitCode=1;});};
  if(handleSignals)for(const name of ['SIGINT','SIGTERM'])process.on(name,stop);
  try{
    const original=await verifyManagedSelection(selected);
    const probe=JSON.parse(await child(selected.python,['-B','-c',
      'import json,sys,sqlite3; assert sys.version_info >= (3,11); print(json.dumps({"python":sys.version.split()[0],"sqlite":sqlite3.sqlite_version}))'],
      {signal:abort.signal,env:{PYTHONDONTWRITEBYTECODE:'1'}}));
    need(!closing,'REPORT_STOPPED','The original managed launch was stopped.');
    const [{GroundwaterReportDesk},{startReportDesk},{privateAccess,originalFactory}]=await Promise.all([
      import('./desk.mjs'),import('./server.mjs'),import('./cli.mjs')]);
    const desk=new GroundwaterReportDesk({directory:selected.directory,sourceWorkspace:selected.scientificWorkspace,
      application:join(EXECUTED_SOURCE_ROOT,CORE_SOURCE),python:selected.python,
      operationsAccess:selected.operationsUrlFile?await privateAccess(selected.operationsUrlFile):null,signal:abort.signal});
    await desk.open({create:false});
    const factory=selected.facilitator?await originalFactory(selected.facilitator,selected.allowLocalFacilitator):null;
    need(!closing,'REPORT_STOPPED','The original managed launch was stopped.');
    service=await startReportDesk({desk,port:selected.port,nativeFactory:factory,handleSignals:false});
    need(!closing,'REPORT_STOPPED','The original managed launch was stopped.');
    await verifyManagedSelection(selected);
    const current=await desk.state();
    need(canonical(current.desk)===canonical(original.desk.desk),'REPORT_STARTUP_IDENTITY','The opened Report Desk has another original identity.');
    const startup={...service.launch,schema:STARTUP_SCHEMA,state:'REPORT_DESK_READY',operationId:selected.operationId,
      directory:selected.directory,deskId:original.desk.desk.id,deskIdentity:selected.expectedDesk,
      sourceRoot:selected.sourceRoot,executedSourceRoot:EXECUTED_SOURCE_ROOT,sourceSha256:selected.expectedSource,
      pythonIdentity:selected.expectedPython,scientificIdentity:original.scientific?.sha256??null,
      operationsFileSha256:original.operations?.sha256??null,facilitator:selected.facilitator,
      allowLocalFacilitator:selected.allowLocalFacilitator,instanceId:randomUUID(),pid:process.pid,python:probe};
    // The original observer recognizes a schema-first one-line native announcement.
    const announcement={schema:STARTUP_SCHEMA,...startup};
    need(!closing,'REPORT_STOPPED','The original managed launch was stopped.');
    if(onStartup)await onStartup(announcement);
    opened={desk,service,startup:announcement,close};
  }catch(error){failure=error;}
  finally{resolveInitialized();}
  if(failure){try{await close();}catch(closeError){throw new AggregateError([failure,closeError],'The original Report Desk launch and drain both failed.');}throw failure;}
  if(closing){await close();need(false,'REPORT_STOPPED','The original managed launch was stopped.');}
  return opened;
}
