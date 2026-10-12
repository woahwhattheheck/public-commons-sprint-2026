// SPDX-License-Identifier: MIT
// Original migration engine attachment. The native workspace owns every mutation.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, mkdir, readFile, readdir, realpath, lstat, link, unlink, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, resolve, join, isAbsolute, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExactNumber, parseExactJSON, stringifyExactJSON } from '../../vector/json.mjs';
import { MIGRATION_CONNECTION_SCHEMA, MIGRATION_REQUEST_SCHEMA, MAX_MIGRATION_REQUEST_BYTES,
  MAX_MIGRATION_FILE_BYTES, MIGRATION_EXPORT_SCHEMA, MIGRATION_EXPORT_MANIFEST,
  MIGRATION_TOOL_PREFIX, migrationToolDefinitions } from './tools.mjs';

export { ExactNumber, parseExactJSON, stringifyExactJSON };
const ENGINE = fileURLToPath(new URL('../engine.py', import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const NATIVE_COMMANDS = new Set(['state','records','document','draft','source-rows','issues',
  'comparison-rows','history','operation','files','native-info','qgis-info','verify','native-reopen',
  'capture','receive-capture','save-plan','review-plan','compare-captures','build-edition','build-projects',
  'export','receive','cartography.inventory','cartography.preview','cartography.operation',
  'cartography.publication','cartography.download','cartography.save-plan','cartography.publish',
  'cartography.reopen']);
const READ_COMMANDS = new Set(['state','records','document','draft','source-rows','issues',
  'comparison-rows','history','operation','files','native-info','qgis-info','verify','native-reopen',
  'cartography.inventory','cartography.preview','cartography.operation','cartography.publication',
  'cartography.download','cartography.reopen']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const migrationFailure = (code, message, details) =>
  Object.assign(new Error(message), {code:'MIGRATION_' + code, ...(details === undefined ? {} : {details})});
const need = (condition, code, message) => { if (!condition) throw migrationFailure(code, message); };
export const migrationSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function migrationIdentifier(value, label='request ID') {
  need(typeof value === 'string' && ID.test(value),'IDENTITY_INVALID','Use the original ' + label + '.'); return value;
}
export function migrationRelativeFile(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    !/[\\\x00-\x1f\x7f]/.test(value) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'),
  'RELATIVE_FILE_REQUIRED','Select an original declared relative file.'); return value;
}
const inside = (root,path) => { const rel=relative(root,path); return rel === '' || rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
const decode = body => new TextDecoder('utf-8',{fatal:true}).decode(body);
const stamp = () => new Date().toISOString();
const statIdentity = s => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
const delay = (ms,signal) => new Promise((yes,no) => {
  if(signal?.aborted) { no(signal.reason ?? migrationFailure('CANCELLED','The original task was cancelled.')); return; }
  const timer=setTimeout(done,ms);
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);no(signal.reason ?? migrationFailure('CANCELLED','The original task was cancelled.'));};
  function done(){signal?.removeEventListener('abort',abort);yes();}
  signal?.addEventListener('abort',abort,{once:true});
});
async function maybeJSON(path) {
  try { const body=await readFile(path); need(body.length<=MAX_MIGRATION_REQUEST_BYTES,'RECORD_TOO_LARGE','Retain a bounded native request record.');return parseExactJSON(decode(body)); }
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function syncDirectory(directory) { const fd=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY);try{await fd.sync();}finally{await fd.close();} }
export async function migrationPrivateDirectory(directory,{create=false}={}) {
  const selected=resolve(directory); if(create)await mkdir(selected,{recursive:true,mode:0o700});
  const s=await lstat(selected);need(s.isDirectory()&&!s.isSymbolicLink(),'DIRECTORY_REQUIRED','Select an ordinary original directory.');
  const actual=await realpath(selected);return actual;
}
export async function retainMigrationBytes(path,body,{replace=false}={}) {
  body=Buffer.isBuffer(body)?body:Buffer.from(body);
  const directory=await migrationPrivateDirectory(dirname(path),{create:true});
  need(resolve(path)===join(directory,basename(path)),'PATH_CHANGED','The selected output directory changed.');
  const stage=join(directory,'.migration-'+randomUUID());let fd;
  try {
    fd=await open(stage,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    await fd.writeFile(body);await fd.sync();await fd.close();fd=null;
    if(replace)await rename(stage,path);
    else try{await link(stage,path);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const current=await openMigrationFile(path,{bytes:body.length,sha256:migrationSha256(body)});
      await current.readonlyFileHandle.close();
    }
    await syncDirectory(directory);
  } finally {await fd?.close();await unlink(stage).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
const retainJSON=(path,value,options)=>retainMigrationBytes(path,Buffer.from(stringifyExactJSON(value,2)+'\n'),options);

/** Return one owned read-only descriptor; caller must close it or transfer it. */
export async function openMigrationFile(path,expected={},name=basename(path)) {
  need(expected.sha256===undefined||SHA.test(expected.sha256),'HASH_REQUIRED','Keep the exact original SHA-256.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await fd.stat({bigint:true});
    need(before.isFile()&&before.size>=0n&&before.size<=BigInt(MAX_MIGRATION_FILE_BYTES),
      'FILE_REQUIRED','Select an original regular file within the declared byte limit.');
    const size=Number(before.size);
    need(expected.bytes===undefined||size===expected.bytes,'FILE_CHANGED','The original file size changed.');
    const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<size){const r=await fd.read(buffer,0,Math.min(buffer.length,size-offset),offset);need(r.bytesRead>0,'FILE_CHANGED','The original file ended during verification.');h.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
    const actual=h.digest('hex'),after=await fd.stat({bigint:true}),named=await lstat(path,{bigint:true});
    need(named.isFile()&&!named.isSymbolicLink()&&statIdentity(before)===statIdentity(after)&&statIdentity(before)===statIdentity(named),
      'FILE_CHANGED','The original file descriptor or path changed.');
    need(expected.sha256===undefined||actual===expected.sha256,'FILE_CHANGED','The original file digest changed.');
    return {readonlyFileHandle:fd,bytes:size,sha256:actual,name,type:'application/octet-stream'};
  }catch(error){await fd.close();throw error;}
}
export function migrationValue(value) {
  if(value instanceof ExactNumber)return {$number:value.lexeme};
  if(Array.isArray(value))return value.map(migrationValue);
  if(plain(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,migrationValue(item)]));
  return value;
}
function hostPath(value,base,label) {
  need(typeof value==='string'&&value.trim()&&!/[\0\r\n]/.test(value),'CONNECTION_INVALID','Declare the original '+label+'.');
  return resolve(base,value);
}
function normalizeInput(value,base) {
  need(plain(value)&&['selection','capture','handover'].includes(value.kind),'CONNECTION_INVALID','Declare an original selection, capture or handover input.');
  need(SHA.test(value.sha256),'CONNECTION_INVALID','Bind each original input to its exact SHA-256.');
  if(value.kind==='capture')return {...value,directory:hostPath(value.directory,base,'capture directory')};
  need(Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=MAX_MIGRATION_FILE_BYTES,'CONNECTION_INVALID','Bind the exact input byte count.');
  return {...value,file:hostPath(value.file,base,'input file'),
    ...(value.kind==='selection'?{sourceRoot:hostPath(value.sourceRoot,base,'source root')}:{workspaceId:migrationIdentifier(value.workspaceId,'incoming workspace ID')})};
}
export function validateMigrationWorkspaceConfiguration(value,{baseDirectory=process.cwd()}={}) {
  need(plain(value)&&value.schema===MIGRATION_CONNECTION_SCHEMA&&plain(value.workspaces),
    'CONNECTION_INVALID','Use the complete original migration merchant connection.');
  const workspaces={},directories=new Set(),runtimeRoots=new Set();
  for(const [alias,row]of Object.entries(value.workspaces)){
    need(ALIAS.test(alias)&&plain(row),'CONNECTION_INVALID','Use unique original workspace aliases.');
    const workspaceId=migrationIdentifier(row.workspaceId,'workspace ID');
    const directory=hostPath(row.directory,baseDirectory,'workspace directory');
    const runtimeDirectory=hostPath(row.runtimeDirectory,baseDirectory,'native request/export directory');
    need(!inside(directory,runtimeDirectory)&&!inside(runtimeDirectory,directory)&&!directories.has(directory)&&!runtimeRoots.has(runtimeDirectory),
      'CONNECTION_INVALID','Give each original workspace its own external request/export directory.');
    directories.add(directory);runtimeRoots.add(runtimeDirectory);
    const python=hostPath(row.python,baseDirectory,'selected Python executable');
    need(Array.isArray(row.pythonPath??[])&&plain(row.environment??{}),'CONNECTION_INVALID','Declare native runtime paths and environment values.');
    const pythonPath=(row.pythonPath??[]).map(path=>hostPath(path,baseDirectory,'native Python package path'));
    need(plain(row.inputs??{})&&plain(row.destinations??{}),'CONNECTION_INVALID','Declare named original input and destination objects.');
    for(const [key,item]of Object.entries(row.environment??{}))need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)&&typeof item==='string'&&!item.includes('\0'),'CONNECTION_INVALID','Declare ordinary native environment entries.');
    const inputs={};for(const [input,item]of Object.entries(row.inputs??{})){need(ALIAS.test(input),'CONNECTION_INVALID','Use original input aliases.');inputs[input]=normalizeInput(item,baseDirectory);}
    const destinations={};for(const [name,item]of Object.entries(row.destinations??{})){need(ALIAS.test(name)&&plain(item),'CONNECTION_INVALID','Declare original independent receiving destinations.');destinations[name]={directory:hostPath(item.directory,baseDirectory,'receiving destination'),workspaceId:migrationIdentifier(item.workspaceId,'receiving workspace ID')};}
    const inlineResultBytes=row.inlineResultBytes??256*1024;
    need(Number.isSafeInteger(inlineResultBytes)&&inlineResultBytes>=1024&&inlineResultBytes<=4*1024*1024,'CONNECTION_INVALID','Choose an inline native JSON limit from 1 KiB to 4 MiB.');
    workspaces[alias]={...row,alias,workspaceId,directory,runtimeDirectory,python,pythonPath,
      environment:{...(row.environment??{})},inputs,destinations,inlineResultBytes};
  }
  need(Object.keys(workspaces).length>0,'CONNECTION_INVALID','Declare at least one original workspace.');
  for(const row of Object.values(workspaces))for(const other of Object.values(workspaces))if(row!==other)
    need(!inside(row.directory,other.runtimeDirectory)&&!inside(other.runtimeDirectory,row.directory),
      'CONNECTION_INVALID','Keep all request/export directories outside every active workspace.');
  return {schema:MIGRATION_CONNECTION_SCHEMA,name:typeof value.name==='string'?value.name:'GIS migration workspaces',workspaces};
}
export async function readMigrationWorkspaceConfiguration(file) {
  const path=resolve(file),fd=await openMigrationFile(path);
  try {
    need(fd.bytes<=4*1024*1024,'CONNECTION_INVALID','The complete host connection exceeds 4 MiB.');
    const raw=await fd.readonlyFileHandle.readFile();
    return validateMigrationWorkspaceConfiguration(parseExactJSON(decode(raw)),{baseDirectory:dirname(path)});
  }finally{await fd.readonlyFileHandle.close();}
}
async function processIdentity(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)return null;
  try{
    const [stat,boot,argv]=await Promise.all([readFile('/proc/'+pid+'/stat','utf8'),readFile('/proc/sys/kernel/random/boot_id','utf8'),readFile('/proc/'+pid+'/cmdline')]);
    const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
    if(fields[0]==='Z')return null;
    return {pid,host:hostname(),bootId:boot.trim(),startTicks:fields[19],argvSha256:migrationSha256(argv)};
  }catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
}
const sameProcess=(a,b)=>a&&b&&['pid','host','bootId','startTicks','argvSha256'].every(key=>a[key]===b[key]);
async function terminateOriginal(identity,signal='SIGTERM') {
  const actual=await processIdentity(identity?.pid);if(!sameProcess(identity,actual))return false;
  try{process.kill(-identity.pid,signal);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
}

/** One declared original workspace; no replacement engine or provider session. */
export class MigrationWorkspaceClient {
  #configuration; #environment; #root; #lease; #opening; #tail=Promise.resolve();
  #jobs=new Map(); #children=new Set(); #closing=false; #closed=false;
  constructor(configuration,{environment=process.env}={}) {
    need(plain(configuration)&&typeof configuration.directory==='string'&&typeof configuration.workspaceId==='string',
      'CONNECTION_INVALID','Use one validated original workspace configuration.');
    this.#configuration=configuration;this.#environment={...environment,...configuration.environment};
    if(configuration.pythonPath.length)this.#environment.PYTHONPATH=[...configuration.pythonPath,...(this.#environment.PYTHONPATH?[this.#environment.PYTHONPATH]:[])].join(':');
    this.#environment.PYTHONDONTWRITEBYTECODE='1';
    this.#environment.QT_QPA_PLATFORM??='offscreen';
  }
  get configuration(){return this.#configuration;}
  get workspaceId(){return this.#configuration.workspaceId;}
  get directory(){return this.#configuration.directory;}
  get closed(){return this.#closed;}
  async #initialize(){
    if(this.#opening)return this.#opening;
    this.#opening=(async()=>{
      need(!this.#closing,'CLOSED','The original workspace attachment is closing.');
      this.#root=await migrationPrivateDirectory(this.#configuration.runtimeDirectory,{create:true});
      await migrationPrivateDirectory(this.directory);
      const {acquireStateLease}=await import('../../../../merchant-fleet-gateway/state-lease.mjs');
      this.#lease=await acquireStateLease(this.#root);
      try{
        const binding={schema:'starforge.migration-native-attachment.v1',workspaceId:this.workspaceId};
        await retainJSON(join(this.#root,'attachment.json'),binding);
        for(const name of ['tasks','archives','exports','readers'])await migrationPrivateDirectory(join(this.#root,name),{create:true});
      }catch(error){await this.#lease.close();this.#lease=null;throw error;}
      return this;
    })();
    try{return await this.#opening;}catch(error){this.#opening=null;throw error;}
  }
  async prepare(){await this.#initialize();return this;}
  async open(){return this.execute('state',{});}
  #taskDirectory(id){return join(this.#root,'tasks',migrationSha256(Buffer.from(id)));}
  async #request(command,payload,id){
    await this.#initialize();this.#lease.assertHeld();
    need(NATIVE_COMMANDS.has(command)&&plain(payload),'COMMAND_INVALID','Select an original native command and complete payload.');
    migrationIdentifier(id);
    if(!READ_COMMANDS.has(command)&&command!=='receive')need(payload.requestId===id,'REQUEST_CHANGED','Keep the original journal request ID.');
    const body=Buffer.from(stringifyExactJSON({schema:MIGRATION_REQUEST_SCHEMA,workspaceId:this.workspaceId,requestId:id,command,payload})+'\n');
    need(body.length<=MAX_MIGRATION_REQUEST_BYTES,'REQUEST_TOO_LARGE','The complete native request exceeds 40 MiB.');
    const directory=await migrationPrivateDirectory(this.#taskDirectory(id),{create:true});
    await retainMigrationBytes(join(directory,'request.json'),body);
    return {id,command,payload,directory,requestSha256:migrationSha256(body)};
  }
  async #result(request,attempt){
    const path=join(request.directory,attempt.directory,'result.json');
    let selected;try{selected=await openMigrationFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const resultFile={name:'result.json',bytes:selected.bytes,sha256:selected.sha256};
    try{
      if(selected.bytes>this.#configuration.inlineResultBytes)
        return {state:attempt.exitCode===0?'COMPLETE':attempt.exitCode===2?'FAILED':'RESULT_RETAINED',resultFile};
      const raw=Buffer.alloc(selected.bytes);let offset=0;while(offset<raw.length){const part=await selected.readonlyFileHandle.read(raw,offset,raw.length-offset,offset);need(part.bytesRead>0,'RESULT_INVALID','The original result ended during reading.');offset+=part.bytesRead;}
      need(migrationSha256(raw)===selected.sha256,'RESULT_INVALID','The original native result changed while reading.');
      const envelope=parseExactJSON(decode(raw));
      need(plain(envelope)&&typeof envelope.ok==='boolean','RESULT_INVALID','Keep the complete original native result envelope.');
      return {state:envelope.ok?'COMPLETE':'FAILED',resultFile,resultJson:decode(raw),
        ...(envelope.ok?{value:migrationValue(envelope.result)}:{error:migrationValue(envelope.error)})};
    }finally{await selected.readonlyFileHandle.close();}
  }
  async #logFile(request,attempt){
    const directory=join(request.directory,attempt.directory),saved=await maybeJSON(join(directory,'log-descriptor.json'));
    if(saved){
      need(saved.name==='native.log'&&Number.isSafeInteger(saved.bytes)&&saved.bytes>=0&&SHA.test(saved.sha256),
        'RESULT_INVALID','Keep the original completed native log descriptor.');
      return saved;
    }
    let file;try{file=await openMigrationFile(join(directory,'native.log'),{},'native.log');}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
    const descriptor={name:file.name,bytes:file.bytes,sha256:file.sha256};
    await file.readonlyFileHandle.close();
    await retainJSON(join(directory,'log-descriptor.json'),descriptor);
    return descriptor;
  }
  async #inspect(request){
    const attempt=await maybeJSON(join(request.directory,'attempt.json'));
    if(!attempt)return {workspaceId:this.workspaceId,requestId:request.id,command:request.command,state:'PREPARED'};
    need(attempt.requestSha256===request.requestSha256&&/^attempt-[0-9]{6,}$/.test(attempt.directory),
      'REQUEST_CHANGED','The retained native task belongs to another input.');
    const result=await this.#result(request,attempt);
    const actual=await processIdentity(attempt.process?.pid),active=sameProcess(attempt.process,actual);
    const logFile=active?null:await this.#logFile(request,attempt);
    const common={workspaceId:this.workspaceId,requestId:request.id,command:request.command,attempt:attempt.number,
      startedAt:attempt.startedAt??null,...(logFile?{logFile}:{})};
    if(result)return {...common,...result,...(active?{state:'FINISHING',resultState:result.state}:{})};
    return {...common,state:active?'RUNNING':attempt.state==='CANCELLED'?'CANCELLED':attempt.state==='FAILED'?'FAILED':'INTERRUPTED',
      ...(attempt.error?{error:attempt.error}:{})};
  }
  async inspect(requestId){
    await this.#initialize();migrationIdentifier(requestId);
    const directory=this.#taskDirectory(requestId),record=await maybeJSON(join(directory,'request.json'));
    need(record&&record.requestId===requestId&&record.workspaceId===this.workspaceId,'TASK_NOT_FOUND','Select an original retained native task.');
    const raw=await readFile(join(directory,'request.json'));
    return this.#inspect({id:requestId,command:record.command,payload:record.payload,directory,requestSha256:migrationSha256(raw)});
  }
  async #run(request,controller){
    this.#lease.assertHeld();
    const prior=await this.#inspect(request);
    let previous=await maybeJSON(join(request.directory,'attempt.json'));
    if(previous?.process){
      while(sameProcess(previous.process,await processIdentity(previous.process.pid))){
        if(controller.signal.aborted){
          await terminateOriginal(previous.process);
          const deadline=Date.now()+5000;
          while(Date.now()<deadline&&sameProcess(previous.process,await processIdentity(previous.process.pid)))await delay(100);
          await terminateOriginal(previous.process,'SIGKILL');
          break;
        }
        await delay(250,controller.signal).catch(error=>{if(!controller.signal.aborted)throw error;});
      }
      const result=await this.#result(request,previous);
      if(result)return this.#inspect(request);
    }
    if(['COMPLETE','RESULT_RETAINED'].includes(prior.state))return prior;
    controller.signal.throwIfAborted();
    const number=(previous?.number??0)+1,attemptName='attempt-'+String(number).padStart(6,'0');
    const attemptDirectory=await migrationPrivateDirectory(join(request.directory,attemptName),{create:true});
    const resultPath=join(attemptDirectory,'result.json'),logPath=join(attemptDirectory,'native.log');
    const args=[ENGINE,'--workspace',this.directory,'--expected-workspace-id',this.workspaceId,
      '--exports-root',join(this.#root,'archives'),'--output',resultPath,'--progress'];
    const wire=Buffer.from(stringifyExactJSON({command:request.command,payload:request.payload})+'\n');
    let log;
    let child,identity,killer,launched=false,spawnError=null,exitCode=null,exitSignal=null,abortError=null;
    const attempt={schema:'starforge.migration-native-attempt.v1',number,directory:attemptName,
      requestSha256:request.requestSha256,startedAt:stamp(),state:'STARTING'};
    await retainJSON(join(request.directory,'attempt.json'),attempt,{replace:true});
    log=await open(logPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try{
      child=spawn(this.#configuration.python,args,{cwd:dirname(ENGINE),env:this.#environment,
        detached:true,shell:false,stdio:['pipe','ignore',log.fd]});
      this.#children.add(child);
      const completion=new Promise(resolveDone=>{
        child.once('error',error=>{spawnError=error;});
        child.once('close',(code,signal)=>{exitCode=code;exitSignal=signal;resolveDone();});
      });
      child.stdin.on('error',error=>{if(error.code!=='EPIPE')spawnError??=error;});
      const abort=()=>{
        abortError??=controller.signal.reason??migrationFailure('CANCELLED','The original native task was cancelled.');
        if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')spawnError??=error;}
          killer=setTimeout(()=>{if(exitCode===null&&exitSignal===null)try{process.kill(-child.pid,'SIGKILL');}catch{}},5000);}
      };
      controller.signal.addEventListener('abort',abort,{once:true});
      try{
        if(child.pid)identity=await processIdentity(child.pid);
        need(identity,'NATIVE_PROCESS_UNAVAILABLE','The selected native Python did not start.');
        attempt.process=identity;attempt.state='RUNNING';
        await retainJSON(join(request.directory,'attempt.json'),attempt,{replace:true});
        this.#lease.assertHeld();
        if(controller.signal.aborted)abort();else{launched=true;child.stdin.end(wire);}
        await completion;
      }catch(error){
        abortError??=error;abort();child.stdin.destroy();await completion;
      }finally{controller.signal.removeEventListener('abort',abort);if(killer)clearTimeout(killer);}
    }finally{
      this.#children.delete(child);await log.close();
    }
    const finished={...attempt,state:controller.signal.aborted?'CANCELLED':exitCode===0?'COMPLETE':'FAILED',
      exitCode,exitSignal,finishedAt:stamp(),requestDispatched:launched,
      ...(spawnError||abortError?{error:{code:(spawnError??abortError).code??'NATIVE_EXIT',
        message:(spawnError??abortError).message??String(spawnError??abortError)}}:{})};
    await retainJSON(join(request.directory,'attempt.json'),finished,{replace:true});
    const result=await this.#inspect(request);
    if(result.state==='INTERRUPTED')result.state=finished.state;
    return result;
  }
  async execute(command,payload={}, {requestId=payload.requestId??('read-'+randomUUID()),wait=true,signal}={}){
    need(!this.#closing,'CLOSED','The original workspace attachment is closing.');
    const request=await this.#request(command,payload,requestId);
    let job=this.#jobs.get(requestId);
    if(!job){
      const controller=new AbortController();
      job={controller,request,promise:null};this.#jobs.set(requestId,job);
      const operation=this.#tail.catch(()=>{}).then(()=>{
        need(!this.#closing,'CLOSED','The original workspace attachment is closing.');
        return this.#run(request,controller);
      });
      job.promise=operation.finally(()=>{if(this.#jobs.get(requestId)===job)this.#jobs.delete(requestId);});
      job.promise.catch(()=>{});this.#tail=job.promise.catch(()=>{});
    }
    const abort=()=>job.controller.abort(signal.reason??migrationFailure('CANCELLED','The original caller cancelled this task.'));
    if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
    try{return wait?await job.promise:await this.#inspect(request);}
    finally{signal?.removeEventListener('abort',abort);}
  }
  async cancel(requestId){
    const job=this.#jobs.get(migrationIdentifier(requestId));
    if(job){job.controller.abort(migrationFailure('CANCELLED','The selected original task was cancelled.'));await job.promise.catch(()=>{});return this.inspect(requestId);}
    await this.#initialize();
    const directory=this.#taskDirectory(requestId),attempt=await maybeJSON(join(directory,'attempt.json'));
    need(attempt,'TASK_NOT_FOUND','Select an original retained native task.');
    if(attempt.process){await terminateOriginal(attempt.process);const deadline=Date.now()+5000;
      while(Date.now()<deadline&&sameProcess(attempt.process,await processIdentity(attempt.process.pid)))await delay(100);
      await terminateOriginal(attempt.process,'SIGKILL');}
    await retainJSON(join(directory,'attempt.json'),{...attempt,state:'CANCELLED',cancelledAt:stamp()},{replace:true});
    return this.inspect(requestId);
  }
  requestClose(){
    this.#closing=true;for(const job of this.#jobs.values())job.controller.abort(migrationFailure('CLOSED','The original workspace attachment is closing.'));
  }
  async close(){
    if(this.#closed)return;
    this.requestClose();
    await Promise.allSettled([...this.#jobs.values()].map(job=>job.promise));
    await this.#opening?.catch(()=>{});
    await this.#lease?.close();this.#lease=null;this.#closed=true;
  }
  async nativeFile(path,expectedSha256){
    const result=await this.execute('files',{path:migrationRelativeFile(path)});
    need(result.state==='COMPLETE'&&result.value&&result.value.sha256===expectedSha256,'FILE_NOT_DECLARED','Select the exact original declared workspace file.');
    const record=result.value,target=resolve(this.directory,record.path);
    need(inside(this.directory,target),'FILE_NOT_DECLARED','The native file must remain inside its workspace.');
    return openMigrationFile(target,record,record.path);
  }
  async taskFile(requestId,kind='result'){
    await this.#initialize();migrationIdentifier(requestId);
    need(['result','log'].includes(kind),'FILE_NOT_DECLARED','Choose the original result or native log.');
    const directory=this.#taskDirectory(requestId),record=await maybeJSON(join(directory,'request.json'));
    need(record?.requestId===requestId&&record.workspaceId===this.workspaceId,'TASK_NOT_FOUND','Select an original retained native task.');
    const attempt=await maybeJSON(join(directory,'attempt.json'));
    need(attempt&&/^attempt-[0-9]{6,}$/.test(attempt.directory),'TASK_NOT_FOUND','The original task has not started.');
    if(kind==='log')need(!sameProcess(attempt.process,await processIdentity(attempt.process?.pid)),
      'FILE_STILL_WRITING','Read the native log after its original task has finished.');
    return openMigrationFile(join(directory,attempt.directory,kind==='result'?'result.json':'native.log'),{},kind==='result'?'result.json':'native.log');
  }
}
export async function openMigrationWorkspace(configuration,options){
  const client=new MigrationWorkspaceClient(configuration,options);
  try{const result=await client.open();need(result.state==='COMPLETE'&&result.value?.id===configuration.workspaceId,
    'WORKSPACE_CHANGED','The original workspace identity differs from the host connection.');return client;}
  catch(error){await client.close();throw error;}
}

async function readSelectedBytes(path,expected,maximum=MAX_MIGRATION_REQUEST_BYTES){
  const selected=await openMigrationFile(path,expected);
  try{need(selected.bytes<=maximum,'INPUT_TOO_LARGE','The complete selected metadata exceeds its declared transport limit.');
    const raw=Buffer.alloc(selected.bytes);let position=0;
    while(position<raw.length){const part=await selected.readonlyFileHandle.read(raw,position,raw.length-position,position);
      need(part.bytesRead>0,'FILE_CHANGED','The selected original file ended during reading.');position+=part.bytesRead;}
    need(migrationSha256(raw)===selected.sha256,'FILE_CHANGED','The selected original file changed during reading.');
    return raw;
  }finally{await selected.readonlyFileHandle.close();}
}
function validateToolArguments(definition,args){
  need(plain(args),'ARGUMENTS_INVALID','Supply the original tool argument object.');
  need(Object.keys(args).every(name=>Object.hasOwn(definition.properties,name))&&definition.required.every(name=>Object.hasOwn(args,name)),
    'ARGUMENTS_INVALID','Use exactly the original declared tool fields.');
  for(const [name,value]of Object.entries(args)){
    const rule=definition.properties[name];
    if(rule.type==='string')need(typeof value==='string'&&(!rule.pattern||new RegExp(rule.pattern).test(value)),
      'ARGUMENTS_INVALID','Use the declared original '+name+'.');
    if(rule.type==='integer')need(Number.isSafeInteger(value)&&value>=rule.minimum&&value<=rule.maximum,
      'ARGUMENTS_INVALID','Use the declared original integer '+name+'.');
    if(rule.type==='boolean')need(typeof value==='boolean','ARGUMENTS_INVALID','Use a boolean '+name+'.');
    if(rule.enum)need(rule.enum.includes(value),'ARGUMENTS_INVALID','Use a declared original '+name+'.');
  }
}
export function parseMigrationExportManifest(bytes,exportId){
  const value=parseExactJSON(typeof bytes==='string'?bytes:decode(bytes));
  need(plain(value)&&value.schema===MIGRATION_EXPORT_SCHEMA&&value.exportId===exportId,
    'EXPORT_CHANGED','Keep the original complete migration export identity.');
  migrationIdentifier(value.workspaceId,'workspace ID');migrationIdentifier(value.requestId);
  need(Number.isSafeInteger(value.revision)&&value.revision>=0&&SHA.test(value.native?.packageManifestSha256),
    'EXPORT_CHANGED','Keep the original reviewed revision and native package manifest.');
  need(Array.isArray(value.files)&&value.files.length===1&&value.files[0].name==='handover.zip'&&
    Number.isSafeInteger(value.files[0].bytes)&&value.files[0].bytes>0&&value.files[0].bytes<=MAX_MIGRATION_FILE_BYTES&&
    SHA.test(value.files[0].sha256),'EXPORT_CHANGED','Keep the complete original handover ZIP descriptor.');
  return value;
}

/** Lazy original merchant owner; dependencies attach only when this family loads. */
export class MerchantMigrationWorkspaces {
  #config;#environment;#clients=new Map();#pending=new Map();#closures=new Map();
  #closing=false;#closePromise;#readers;#readerOpening;#scopes=new Map();
  constructor(config,{environment=process.env}={}){this.#config=config;this.#environment=environment;}
  get summary(){return {configured:Boolean(this.#config.migrationWorkspaces),
    connected:[...this.#clients.keys()],pending:this.#pending.size,closing:this.#closing,
    ...(this.#readers?.summary??{})};}
  #entry(alias){
    need(typeof alias==='string'&&ALIAS.test(alias),'WORKSPACE_ALIAS','Select an original host workspace alias.');
    const row=this.#config.migrationWorkspaces?.workspaces?.[alias];
    need(row,'NOT_CONFIGURED','Select a configured migration workspace.');return row;
  }
  #client(alias){
    const entry=this.#entry(alias);
    if(!this.#clients.has(alias))this.#clients.set(alias,new MigrationWorkspaceClient(entry,{environment:this.#environment}));
    return this.#clients.get(alias);
  }
  async #reader(){
    if(!this.#readerOpening)this.#readerOpening=(async()=>{
      const {RetainedFileReads}=await import('../../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs');
      this.#readers=new RetainedFileReads({errorPrefix:'MIGRATION'});return this.#readers;
    })();
    return this.#readerOpening;
  }
  #scope(alias,kind,key=''){
    const value=alias+':'+kind+':'+key;
    if(!this.#scopes.has(alias))this.#scopes.set(alias,new Set());
    this.#scopes.get(alias).add(value);return value;
  }
  #input(alias,name,kinds){
    need(typeof name==='string'&&ALIAS.test(name),'INPUT_REQUIRED','Select an original host input alias.');
    const value=this.#entry(alias).inputs[name];
    need(value&&kinds.includes(value.kind),'INPUT_REQUIRED','Select the original input kind for this operation.');return value;
  }
  async #cache(alias,exportId){
    migrationIdentifier(exportId,'export ID');await this.#client(alias).prepare();
    return migrationPrivateDirectory(join(this.#entry(alias).runtimeDirectory,'exports',
      migrationSha256(Buffer.from(exportId))),{create:true});
  }
  async #manifest(alias,exportId){
    const directory=await this.#cache(alias,exportId),path=join(directory,MIGRATION_EXPORT_MANIFEST);
    let raw;
    try{raw=await readSelectedBytes(path,{},1024*1024);}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const selection=await maybeJSON(join(directory,'selection.json'));
      need(selection?.exportId===exportId&&selection.workspaceId===this.#entry(alias).workspaceId,
        'EXPORT_NOT_FOUND','Select an original prepared complete handover.');
      const result=await this.#client(alias).inspect(selection.requestId);
      need(result.state==='COMPLETE','EXPORT_NOT_READY','The original complete handover has not finished.');
      await this.#finishExport(alias,selection,result,directory);
      raw=await readSelectedBytes(path,{},1024*1024);
    }
    const manifest=parseMigrationExportManifest(raw,exportId);
    need(manifest.workspaceId===this.#entry(alias).workspaceId,'EXPORT_CHANGED','The saved export belongs to another original workspace.');
    const native=await maybeJSON(join(directory,'native-file.json'));
    need(native&&native.file?.sha256===manifest.files[0].sha256&&native.file?.bytes===manifest.files[0].bytes&&
      typeof native.basename==='string'&&/^migration-[a-f0-9]{64}\.zip$/.test(native.basename),
      'EXPORT_CHANGED','The complete original native archive mapping changed.');
    return {directory,path,raw,manifest,native,sha256:migrationSha256(raw)};
  }
  async #finishExport(alias,selection,result,directory){
    need(result.state==='COMPLETE'&&plain(result.value),'EXPORT_RESULT_REQUIRED','Retain the complete original native export result.');
    const original=result.value,entry=this.#entry(alias);
    need(original.workspaceId===entry.workspaceId&&original.revision===selection.revision&&
      SHA.test(original.sha256)&&Number.isSafeInteger(original.bytes)&&original.bytes>0&&
      original.bytes<=MAX_MIGRATION_FILE_BYTES&&SHA.test(original.manifestSha256)&&
      /^migration-[a-f0-9]{64}\.zip$/.test(original.download?.path??''),
      'EXPORT_CHANGED','The native export differs from its reviewed workspace, revision or complete file.');
    const file={name:'handover.zip',bytes:original.bytes,sha256:original.sha256};
    const manifest={schema:MIGRATION_EXPORT_SCHEMA,exportId:selection.exportId,workspaceId:entry.workspaceId,
      revision:selection.revision,requestId:selection.requestId,actor:selection.actor,
      native:{packageManifestSha256:original.manifestSha256,fileCount:original.fileCount,totalDecodedBytes:original.totalDecodedBytes},
      files:[file]};
    parseMigrationExportManifest(Buffer.from(stringifyExactJSON(manifest)),selection.exportId);
    await retainJSON(join(directory,'native-file.json'),{basename:original.download.path,file});
    await retainJSON(join(directory,MIGRATION_EXPORT_MANIFEST),manifest);
    return manifest;
  }
  async #read(alias,args,{scope,key,kind,load}){
    const reader=await this.#reader();await this.#client(alias).prepare();
    return reader.read({scope,key,kind,directory:join(this.#entry(alias).runtimeDirectory,'readers'),
      expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset??0,
      limit:args.limit??196608,load});
  }
  async #closeAlias(alias){
    this.#entry(alias);
    const prior=this.#closures.get(alias);if(prior)return prior;
    const client=this.#clients.get(alias);client?.requestClose();
    const closing=(async()=>{
      const errors=[];
      try{await client?.close();}catch(error){errors.push(error);}
      await Promise.allSettled([...this.#pending].filter(([,owner])=>owner===alias).map(([task])=>task));
      if(this.#readerOpening)await this.#readerOpening;
      for(const scope of this.#scopes.get(alias)??[])try{await this.#readers.closeScope(scope);}catch(error){errors.push(error);}
      if(errors.length)throw new AggregateError(errors,'The original migration attachment has unfinished close work.');
      this.#clients.delete(alias);this.#scopes.delete(alias);
      return {workspace:alias,workspaceId:this.#entry(alias).workspaceId,state:'CLOSED'};
    })();
    this.#closures.set(alias,closing);
    const forget=()=>{if(this.#closures.get(alias)===closing)this.#closures.delete(alias);};
    closing.then(forget,forget);
    return closing;
  }
  async #dispatch(name,args){
    const action=name.slice(MIGRATION_TOOL_PREFIX.length),alias=args.workspace;
    if(action==='status'){
      const entries=args.workspace?[[args.workspace,this.#entry(args.workspace)]]:
        Object.entries(this.#config.migrationWorkspaces?.workspaces??{});
      return {schema:'starforge.migration-workspaces-status.v1',...this.summary,
        workspaces:entries.map(([workspace,row])=>({workspace,workspaceId:row.workspaceId,
          connected:this.#clients.has(workspace),inputs:Object.entries(row.inputs).map(([input,value])=>
            ({input,kind:value.kind,sha256:value.sha256,...(value.bytes===undefined?{}:{bytes:value.bytes}),
              ...(value.workspaceId?{workspaceId:value.workspaceId}:{})})),
          destinations:Object.entries(row.destinations).map(([destination,value])=>({destination,workspaceId:value.workspaceId}))}))};
    }
    const entry=this.#entry(alias),client=this.#client(alias);
    if(action==='inputs'){
      const entries=args.input?[[args.input,this.#input(alias,args.input,['selection','capture','handover'])]]:Object.entries(entry.inputs);
      return {workspace:alias,workspaceId:entry.workspaceId,inputs:entries.map(([input,value])=>
        ({input,kind:value.kind,sha256:value.sha256,...(value.bytes===undefined?{}:{bytes:value.bytes}),
          ...(value.workspaceId?{workspaceId:value.workspaceId}:{})}))};
    }
    if(action==='open')return {workspace:alias,...await client.open()};
    if(action==='task')return {workspace:alias,...await client.inspect(args.requestId)};
    if(action==='cancel')return {workspace:alias,...await client.cancel(args.requestId)};
    if(action==='file_release'){
      const reader=await this.#reader();await reader.release(this.#scope(alias,'file',args.path),args.readId);
      return {state:'RELEASED',workspace:alias,path:args.path,readId:args.readId};
    }
    if(action==='task_file_release'){
      const reader=await this.#reader();await reader.release(this.#scope(alias,'task',args.requestId+':'+(args.kind??'result')),args.readId);
      return {state:'RELEASED',workspace:alias,requestId:args.requestId,kind:args.kind??'result',readId:args.readId};
    }
    if(action==='export_file_release'){
      const reader=await this.#reader();await reader.release(this.#scope(alias,'export',args.exportId),args.readId);
      return {state:'RELEASED',workspace:alias,exportId:args.exportId,readId:args.readId};
    }
    if(action==='file')return this.#read(alias,args,{scope:this.#scope(alias,'file',args.path),key:args.path,
      kind:'migration-file',load:async()=>client.nativeFile(args.path,args.expectedSha256)});
    if(action==='task_file')return this.#read(alias,args,{scope:this.#scope(alias,'task',args.requestId+':'+(args.kind??'result')),
      key:args.requestId+':'+(args.kind??'result'),kind:'migration-native-result',load:async()=>{
        const value=await client.taskFile(args.requestId,args.kind??'result');
        if(value.sha256!==args.expectedSha256){await value.readonlyFileHandle.close();throw migrationFailure('FILE_CHANGED','The native result or log changed.');}
        return value;
      }});
    if(action==='export_manifest'){
      const saved=await this.#manifest(alias,args.exportId);
      return {state:'MANIFEST_RETAINED',workspace:alias,workspaceId:entry.workspaceId,exportId:args.exportId,
        manifestFile:{name:MIGRATION_EXPORT_MANIFEST,bytes:saved.raw.length,sha256:saved.sha256}};
    }
    if(action==='export_file'){
      const saved=await this.#manifest(alias,args.exportId);
      need(saved.sha256===args.expectedManifestSha256,'EXPORT_CHANGED','Select the reviewed original export manifest.');
      const file=args.file===MIGRATION_EXPORT_MANIFEST?
        {name:MIGRATION_EXPORT_MANIFEST,bytes:saved.raw.length,sha256:saved.sha256}:saved.manifest.files.find(file=>file.name===args.file);
      need(file&&file.sha256===args.expectedSha256,'FILE_NOT_DECLARED','Select an exact original complete-handover member.');
      const path=args.file===MIGRATION_EXPORT_MANIFEST?saved.path:join(entry.runtimeDirectory,'archives',saved.native.basename);
      const chunk=await this.#read(alias,args,{scope:this.#scope(alias,'export',args.exportId),key:args.file,
        kind:'migration-export',load:()=>openMigrationFile(path,file,file.name)});
      return {...chunk,exportId:args.exportId,manifestSha256:saved.sha256};
    }
    if(action==='export'){
      const directory=await this.#cache(alias,args.exportId);
      const selection={schema:'starforge.migration-export-request.v1',exportId:args.exportId,
        workspaceId:entry.workspaceId,revision:args.revision,requestId:args.requestId,actor:args.actor};
      await retainJSON(join(directory,'selection.json'),selection);
      const result=await client.execute('export',{revision:args.revision,requestId:args.requestId,actor:args.actor},
        {requestId:args.requestId,wait:args.wait??true});
      if(result.state==='COMPLETE')await this.#finishExport(alias,selection,result,directory);
      return {workspace:alias,exportId:args.exportId,...result};
    }
    let command=action.startsWith('cartography_')?'cartography.'+action.slice('cartography_'.length).replaceAll('_','-'):action.replaceAll('_','-');
    const {workspace,wait,input,expectedSha256,destination,planJson,specJson,...payload}=args;
    if(action==='capture'){
      const original=this.#input(alias,input,['selection']);
      need(original.sha256===expectedSha256,'INPUT_CHANGED','Use the original selected-source SHA-256.');
      const raw=await readSelectedBytes(original.file,original,MAX_MIGRATION_REQUEST_BYTES);
      payload.selection=parseExactJSON(decode(raw));payload.originalBase64=raw.toString('base64');payload.sourceRoot=original.sourceRoot;
    }
    if(action==='receive_capture'){
      const original=this.#input(alias,input,['capture']);
      need(original.sha256===expectedSha256,'INPUT_CHANGED','Use the original complete capture manifest SHA-256.');
      payload.directory=original.directory;payload.expectedManifestSha256=original.sha256;
    }
    if(action==='save_plan'){
      need(Buffer.byteLength(planJson)<=MAX_MIGRATION_REQUEST_BYTES,'REQUEST_TOO_LARGE','Keep the complete reviewed mapping within the native request limit.');
      payload.plan=parseExactJSON(planJson);payload.originalBase64=Buffer.from(planJson).toString('base64');
    }
    if(action==='cartography_preview'||action==='cartography_save_plan')payload.spec=parseExactJSON(specJson);
    if(action==='receive'){
      const original=this.#input(alias,input,['handover']),target=entry.destinations[destination];
      need(target&&target.workspaceId===original.workspaceId,'DESTINATION_REQUIRED','Choose the declared receiver for this original workspace.');
      need(original.sha256===expectedSha256,'INPUT_CHANGED','Use the original complete handover SHA-256.');
      const retained=await openMigrationFile(original.file,original);await retained.readonlyFileHandle.close();
      payload.archive=original.file;payload.destination=target.directory;payload.expectedSha256=original.sha256;
      payload.nativeReopen=args.nativeReopen??'required';delete payload.requestId;
      const result=await client.execute(command,payload,{requestId:args.requestId,wait:wait??true});
      if(result.value)need(result.value.workspaceId===original.workspaceId,'WORKSPACE_CHANGED','The received original workspace differs from its declared identity.');
      return {workspace:alias,input,destination,expectedWorkspaceId:original.workspaceId,...result};
    }
    const result=await client.execute(command,payload,{requestId:args.requestId,wait:wait??true});
    if(action==='cartography_download'&&result.value){
      const value=result.value;
      return {workspace:alias,...result,value:{descriptor:value.descriptor,mimeType:value.mimeType,filename:value.filename},
        resultJson:undefined};
    }
    return {workspace:alias,...result};
  }
  async call(name,args={}){
    need(!this.#closing,'CLOSED','The original migration merchant is closing.');
    const definition=migrationToolDefinitions.find(value=>value.name===name);
    need(definition,'TOOL_NOT_FOUND','Select a declared migration workspace operation.');
    validateToolArguments(definition,args);
    if(name===MIGRATION_TOOL_PREFIX+'close')return this.#closeAlias(args.workspace);
    need(!args.workspace||!this.#closures.has(args.workspace),'CLOSED','This original workspace attachment is closing.');
    const pending=this.#dispatch(name,args);this.#pending.set(pending,args.workspace);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  requestClose(){
    this.#closing=true;for(const client of this.#clients.values())client.requestClose();
  }
  close(){
    if(!this.#closePromise){
      this.requestClose();
      const pending=(async()=>{
        const closingClients=[...this.#clients.values()].map(client=>client.close());
        await Promise.allSettled([...this.#pending.keys()]);
        const results=await Promise.allSettled(closingClients);
        if(this.#readerOpening)try{await this.#readerOpening;await this.#readers.close();}catch(error){results.push({status:'rejected',reason:error});}
        const failures=results.filter(value=>value.status==='rejected').map(value=>value.reason);
        if(failures.length)throw new AggregateError(failures,'The original migration merchant has retained incomplete shutdown work.');
        this.#clients.clear();this.#scopes.clear();
      })();
      this.#closePromise=pending;pending.catch(()=>{if(this.#closePromise===pending)this.#closePromise=null;});
    }
    return this.#closePromise;
  }
}
