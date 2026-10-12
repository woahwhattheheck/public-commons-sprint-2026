// MIT. Private project files and the maintained SF101 encryption transport.
import { constants, createWriteStream } from 'node:fs';
import { open, lstat, realpath, mkdir, readdir, link, unlink, chmod, rm } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, relative, sep, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'stellar-forge.application-project.v1';
export const RECEIVED = 'stellar-forge.application-project-received.v1';
export const PROFILE = 'stellar-forge.application-project-profile.v1';
export const APPLICATION_PATH = 'stellar/scf-starforge-20261009/partners/cheesecake-stellar-agent';
export const APPLICATION_SOURCE_FILES = Object.freeze(['application.mjs','configuration.mjs','remote-mcp.mjs',
  'server.mjs','cli.mjs','installed.mjs','project-files.mjs','project.mjs','project-receive.mjs',
  'project-cli.mjs','ui/app.js','ui/index.html','ui/style.css']);
export const fail = code => Object.assign(new Error(code),{code});
export const need = (ok,code) => {if(!ok)throw fail(code);};
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const sha = raw => createHash('sha256').update(raw).digest('hex');
export const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
export const inside = (root,path) => path === root || path.startsWith(root+sep);
export const checkSignal = signal => need(!signal?.aborted,'APPLICATION_PROJECT_INTERRUPTED');
export function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== sep &&
    !/[\\\x00-\x1f\x7f]/.test(value),'APPLICATION_PROJECT_ABSOLUTE_PATH_REQUIRED');
  return value;
}
export function member(value) {
  need(typeof value === 'string' && value.length <= 2048 && !/[\\\x00-\x1f\x7f]/.test(value) &&
    value.split('/').every(part=>part && part!=='.' && part!=='..'),'APPLICATION_PROJECT_MEMBER_INVALID');
  return value;
}
export async function exists(path) {
  try {await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}
export async function privateDirectory(path,{create=false}={}) {
  absolute(path);
  if(create)await mkdir(path,{mode:0o700});
  const st=await lstat(path);
  need(st.isDirectory() && !st.isSymbolicLink() && !(st.mode & 0o077) &&
    (typeof process.getuid!=='function'||st.uid===process.getuid()) && await realpath(path)===path,
    'APPLICATION_PROJECT_PRIVATE_DIRECTORY_REQUIRED');
  return st;
}
export async function sourceFile(path,{maximum=2*1024**3,privateOnly=false}={}) {
  absolute(path);
  need(await realpath(path)===path,'APPLICATION_PROJECT_SOURCE_PATH_CHANGED');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const st=await handle.stat({bigint:true});
    need(st.isFile() && st.nlink===1n && st.size<=BigInt(maximum) &&
      (!privateOnly || !(Number(st.mode)&0o077) &&
        (typeof process.getuid!=='function'||Number(st.uid)===process.getuid())),
      'APPLICATION_PROJECT_FILE_INVALID');
    return {handle,st};
  }catch(error){await handle.close();throw error;}
}
const unchanged=(before,after)=>before.dev===after.dev&&before.ino===after.ino&&
  before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs;
export async function readBytes(path,maximum=16*1024**2,privateOnly=false) {
  const {handle,st}=await sourceFile(path,{maximum,privateOnly});
  try {
    const raw=await handle.readFile();
    need(raw.length<=maximum&&BigInt(raw.length)===st.size&&unchanged(st,await handle.stat({bigint:true})),
      'APPLICATION_PROJECT_SOURCE_CHANGED');
    return raw;
  }finally{await handle.close();}
}
export async function readJSON(path,maximum=16*1024**2,privateOnly=false) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path,maximum,privateOnly)));
}
export async function digest(path,{privateOnly=false,signal}={}) {
  const {handle,st}=await sourceFile(path,{privateOnly}),hash=createHash('sha256');let bytes=0;
  try {
    for await(const chunk of handle.createReadStream({autoClose:false})){checkSignal(signal);bytes+=chunk.length;hash.update(chunk);}
    need(BigInt(bytes)===st.size&&unchanged(st,await handle.stat({bigint:true})),'APPLICATION_PROJECT_SOURCE_CHANGED');
    return {bytes,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
export async function syncDirectory(path) {
  const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}
}
export async function publishBytes(path,raw,{allowExact=false}={}) {
  absolute(path);await privateDirectory(dirname(path));
  const temporary=join(dirname(path),'.'+randomUUID()+'.pending');let handle;
  try {
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
    await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;
    try {await link(temporary,path);}
    catch(error){
      if(error.code!=='EEXIST'||!allowExact)throw error;
      const current=await digest(path,{privateOnly:true});
      need(current.bytes===raw.length&&current.sha256===sha(raw),'APPLICATION_PROJECT_PATH_COLLISION');
    }
    await syncDirectory(dirname(path));
  }finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function copyFile(path,destination,{privateOnly=true,signal}={}) {
  const {handle,st}=await sourceFile(path,{privateOnly}),hash=createHash('sha256');let bytes=0,created=false;
  try {
    const sink=createWriteStream(destination,{flags:'wx',mode:0o600});
    sink.once('open',()=>{created=true;});
    const tap=new Transform({transform(chunk,_encoding,callback){
      try{checkSignal(signal);bytes+=chunk.length;hash.update(chunk);callback(null,chunk);}catch(error){callback(error);}
    }});
    await pipeline(handle.createReadStream({autoClose:false}),tap,sink);
    need(BigInt(bytes)===st.size&&unchanged(st,await handle.stat({bigint:true})),'APPLICATION_PROJECT_SOURCE_CHANGED');
    const saved=await open(destination,'r');try{await saved.sync();}finally{await saved.close();}
    return {bytes,sha256:hash.digest('hex')};
  }catch(error){if(created)await rm(destination,{force:true});throw error;}
  finally{await handle.close();}
}
export async function ensureParents(path,created=[]) {
  if(await exists(path)){await privateDirectory(path);return;}
  await ensureParents(dirname(path),created);await privateDirectory(path,{create:true});created.push(path);
}
export async function originalModule(sourceRoot,path) {
  const file=join(absolute(sourceRoot),member(path));await sourceFile(file).then(({handle})=>handle.close());
  return import(pathToFileURL(file).href);
}
export async function applicationSources(sourceRoot) {
  return Promise.all(APPLICATION_SOURCE_FILES.map(async name=>{
    const path=join(absolute(sourceRoot),APPLICATION_PATH,name);
    return {path,...await digest(path)};
  }));
}
export function passphrase(environment,name) {
  need(typeof name==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(name),
    'APPLICATION_PROJECT_PASSPHRASE_ENV_REQUIRED');
  need(typeof environment?.[name]==='string'&&Buffer.byteLength(environment[name])>=16,
    'APPLICATION_PROJECT_PASSPHRASE_REQUIRED');
  return {[name]:environment[name]};
}
/** The unchanged SF101 implementation owns encryption, authentication and archive decoding. */
export async function encrypted(sourceRoot,action,options,{environment=process.env,signal}={}) {
  const file=join(absolute(sourceRoot),'stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs');
  await sourceFile(file).then(({handle})=>handle.close());checkSignal(signal);
  const env={LANG:'C.UTF-8',LC_ALL:'C.UTF-8',...passphrase(environment,options.passphraseEnv)};
  const args=[file,action,'--pass-env',options.passphraseEnv];
  if(action==='snapshot')args.push('--plan',absolute(options.plan),'--out',absolute(options.output),'--quiesced');
  else args.push('--bundle',absolute(options.bundle),...(action==='restore'?['--out',absolute(options.output)]:[]));
  const child=spawn(process.execPath,args,{shell:false,env,stdio:['ignore','pipe','ignore']});
  let text='',problem,timer,aborted=false;
  const abort=()=>{aborted=true;child.kill('SIGTERM');timer=setTimeout(()=>child.kill('SIGKILL'),5000);};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timeout=setTimeout(abort,300000);
  child.stdout.on('data',chunk=>{text+=chunk;if(text.length>65536){problem=fail('APPLICATION_PROJECT_NATIVE_OUTPUT_INVALID');child.kill('SIGKILL');}});
  try {
    const code=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',accept);});
    if(problem)throw problem;
    need(!aborted,'APPLICATION_PROJECT_INTERRUPTED');need(code===0,'APPLICATION_PROJECT_ENCRYPTION_FAILED');
    const result=JSON.parse(text.trim());
    need(result.status===({snapshot:'SNAPSHOT_CREATED',verify:'SNAPSHOT_VERIFIED',restore:'RESTORED_TO_NEW_DIR'})[action],
      'APPLICATION_PROJECT_NATIVE_OUTPUT_INVALID');
    return result;
  }finally{clearTimeout(timeout);clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
/** Drain the application before capturing. This backups the original SQLite tables, including transitions. */
async function quoteBackup(source,destination) {
  const {DatabaseSync,backup}=await import('node:sqlite');
  need(typeof backup==='function','APPLICATION_PROJECT_SQLITE_BACKUP_REQUIRED');
  const db=new DatabaseSync(source,{readOnly:true});
  try{await backup(db,destination);}finally{db.close();}
  await chmod(destination,0o600);
  const saved=await open(destination,'r');try{await saved.sync();}finally{await saved.close();}
}
export async function capturePaths({roots,destination,quoteDatabase,signal}) {
  await privateDirectory(destination,{create:true});
  const selected=roots.filter((root,index)=>roots.findIndex(x=>x.path===root.path)===index)
    .filter(root=>!roots.some(other=>other.path!==root.path&&inside(other.path,root.path)));
  const files=[],directories=[];let bytes=0;
  async function walk(path,role,depth=0) {
    checkSignal(signal);need(depth<=15&&files.length+directories.length<8000,'APPLICATION_PROJECT_SIZE_LIMIT');
    const st=await lstat(path);
    need(!st.isSymbolicLink(),'APPLICATION_PROJECT_SOURCE_PATH_CHANGED');
    if(st.isDirectory()){
      await privateDirectory(path);directories.push(path);
      for(const name of(await readdir(path)).sort()){
        const child=join(path,name);
        if(name==='.application-owner.lock')continue;
        if(quoteDatabase&&[quoteDatabase+'-wal',quoteDatabase+'-shm',join(dirname(quoteDatabase),'writer.sqlite'),
          join(dirname(quoteDatabase),'writer.sqlite-wal'),join(dirname(quoteDatabase),'writer.sqlite-shm')].includes(child))continue;
        need(name!=='operator-keys.json'&&!name.endsWith('.env'),'APPLICATION_PROJECT_PRIVATE_KEY_IN_APPLICATION_STATE');
        await walk(child,role,depth+1);
      }
      return;
    }
    need(st.isFile()&&basename(path)!=='reservations.sqlite','APPLICATION_PROJECT_FINANCIAL_COMPONENT_REQUIRED');
    const name=String(files.length+1).padStart(6,'0'),target=join(destination,name);
    let identity;
    if(path===quoteDatabase){await quoteBackup(path,target);identity=await digest(target,{privateOnly:true,signal});}
    else identity=await copyFile(path,target,{signal});
    bytes+=identity.bytes;need(bytes<=1024**3,'APPLICATION_PROJECT_SIZE_LIMIT');
    files.push({path,member:'files/'+name,role,...identity});
  }
  for(const root of selected)await walk(absolute(root.path),root.role);
  await syncDirectory(destination);
  return {files,directories:[...new Set(directories)].sort(),bytes};
}
export async function validateCapturedFiles(payload,record,{signal}={}) {
  need(Array.isArray(record.files)&&record.files.length<=8000&&Array.isArray(record.directories)&&
    record.directories.length<=8000,'APPLICATION_PROJECT_RECORD_INVALID');
  const paths=new Set(),members=new Set();let total=0;
  for(const item of record.files){
    absolute(item.path);member(item.member);
    need(/^files\/[0-9]{6}$/.test(item.member)&&!paths.has(item.path)&&!members.has(item.member)&&
      Number.isSafeInteger(item.bytes)&&item.bytes>=0&&/^[a-f0-9]{64}$/.test(item.sha256),
      'APPLICATION_PROJECT_RECORD_INVALID');
    paths.add(item.path);members.add(item.member);
    const actual=await digest(join(payload,item.member),{privateOnly:true,signal});
    need(actual.bytes===item.bytes&&actual.sha256===item.sha256,'APPLICATION_PROJECT_CAPTURE_CHANGED');total+=actual.bytes;
    need(total<=1024**3,'APPLICATION_PROJECT_SIZE_LIMIT');
  }
  const names=await readdir(join(payload,'files'));
  need(names.length===members.size&&names.every(name=>members.has('files/'+name)),
    'APPLICATION_PROJECT_CAPTURE_CHANGED');
  const dirs=new Set();
  for(const path of record.directories){absolute(path);need(!dirs.has(path),'APPLICATION_PROJECT_RECORD_INVALID');dirs.add(path);}
  return {files:paths.size,bytes:total};
}
