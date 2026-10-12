// MIT. Managed opening of the original retained USAspending workspace.
import { DatabaseSync } from 'node:sqlite';
import { lstat, realpath, readFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERSION, canonical, sha, plain, string, integer, requireThat } from './core.mjs';
import { AwardWorkspace } from './workspace.mjs';
import { serveWorkspace } from './server.mjs';

export const USASPENDING_APPLICATION_SCHEMA='stellar-forge.usaspending-application-selection.v1';
export const USASPENDING_STARTUP_SCHEMA='stellar-forge.usaspending-application-startup.v1';
export const USASPENDING_SOURCE_PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending';
const SELF_SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const DIGEST=/^[a-f0-9]{64}$/;
const WORKSPACE_ID=/^WR-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const INSTANCE_ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const USASPENDING_APPLICATION_FILES=Object.freeze([
  'application.mjs','application-provider.mjs','brief.mjs','cli.mjs','core.mjs',
  'dossier-cli.mjs','dossier.mjs','merchant.mjs','server.mjs','source-import.mjs',
  'transport.mjs','workspace.mjs','transactions/core.mjs','transactions/operator.mjs',
  'transactions/store.mjs','web/app.js','web/index.html','web/style.css',
  'web/transactions.css','web/transactions.html','web/transactions.js',
].map(name=>USASPENDING_SOURCE_PREFIX+'/'+name).concat([
  'stellar/scf-starforge-20261009/distribution/runtime-workspace/application-usaspending.mjs',
  'stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs',
]));
function absolute(value,name='Path') {
  string(value,name,4096);requireThat(isAbsolute(value)&&resolve(value)===value,'USASPENDING_APPLICATION_ABSOLUTE_PATH_REQUIRED',name+' must be a complete normalized path.');return value;
}
async function folder(value,{allowMissing=false,privateOnly=false}={}) {
  const path=absolute(value);
  requireThat(await realpath(dirname(path))===dirname(path),'USASPENDING_APPLICATION_REAL_PARENT_REQUIRED');
  let info;try{info=await lstat(path);}catch(error){
    if(error.code!=='ENOENT'||!allowMissing)throw error;
    if(privateOnly)await folder(dirname(path),{privateOnly:true});
    return {path,exists:false,parent:dirname(path)};
  }
  requireThat(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path,'USASPENDING_APPLICATION_DIRECTORY_REQUIRED');
  if(privateOnly)requireThat((info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid()),'USASPENDING_APPLICATION_PRIVATE_DIRECTORY_REQUIRED','Choose a private folder owned by the current operator.');
  return {path,exists:true,dev:String(info.dev),ino:String(info.ino)};
}
export async function inspectUSASpendingWorkspace(directory,{allowUninitialized=true}={}) {
  const selected=await folder(directory,{allowMissing:allowUninitialized,privateOnly:true});
  let workspaceId=null;
  if(selected.exists) {
    const file=join(selected.path,'awards.sqlite3');let info;
    try{info=await lstat(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(info) {
      requireThat(info.isFile()&&!info.isSymbolicLink()&&await realpath(file)===file&&(info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid()),'USASPENDING_APPLICATION_DATABASE_REQUIRED');
      const db=new DatabaseSync(file,{readOnly:true});
      try {
        db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');
        const values=new Map(db.prepare("SELECT key,value FROM workspace_meta WHERE key IN ('id','schema')").all().map(row=>[row.key,row.value]));
        requireThat(values.get('schema')===VERSION&&WORKSPACE_ID.test(values.get('id')??''),'USASPENDING_APPLICATION_WORKSPACE_IDENTITY_INVALID');
        workspaceId=values.get('id');db.exec('COMMIT');
      }finally{db.close();}
    }
  }
  requireThat(allowUninitialized||workspaceId,'USASPENDING_APPLICATION_WORKSPACE_REQUIRED','Select the original initialized USAspending workspace.');
  const value={schema:'stellar-forge.usaspending-application-workspace.v1',directory:selected,workspaceId,workspaceSchema:VERSION};
  return {...value,sha256:sha(value)};
}
export async function inspectUSASpendingApplicationSource(sourceRoot,{expectedSha256}={}) {
  const selected=await folder(sourceRoot),files=[];
  for(const path of USASPENDING_APPLICATION_FILES) {
    const full=join(selected.path,path),info=await lstat(full);
    requireThat(info.isFile()&&!info.isSymbolicLink()&&await realpath(full)===full&&info.size<=4*1024*1024,'USASPENDING_APPLICATION_SOURCE_INVALID',path);
    const bytes=await readFile(full);
    requireThat(bytes.length===info.size,'USASPENDING_APPLICATION_SOURCE_CHANGED',path);
    files.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }
  const value={schema:'stellar-forge.usaspending-application-source.v1',files},digest=sha(value);
  requireThat(expectedSha256===undefined||DIGEST.test(expectedSha256)&&expectedSha256===digest,'USASPENDING_APPLICATION_SOURCE_CHANGED');
  return {...value,root:selected.path,sha256:digest};
}
export async function prepareUSASpendingSelection({workspaceDirectory,receivingRoot,operator='Local operator',sourceRoot=SELF_SOURCE_ROOT}={}) {
  const workspace=await inspectUSASpendingWorkspace(absolute(workspaceDirectory,'Workspace directory'));
  const receiving=receivingRoot?await folder(absolute(receivingRoot,'Receiving root'),{allowMissing:true,privateOnly:true}):null;
  const source=await inspectUSASpendingApplicationSource(absolute(sourceRoot,'Source root'));
  const value={schema:USASPENDING_APPLICATION_SCHEMA,workspace,receiving,operator:string(operator,'Operator',200),source};
  return {...value,sha256:sha(value)};
}
function validSelection(selection) {
  requireThat(plain(selection)&&selection.schema===USASPENDING_APPLICATION_SCHEMA,'USASPENDING_APPLICATION_SELECTION_REQUIRED');
  const {sha256:expected,...value}=selection;
  requireThat(DIGEST.test(expected??'')&&sha(value)===expected&&plain(selection.workspace)&&plain(selection.workspace.directory)&&plain(selection.source),'USASPENDING_APPLICATION_SELECTION_CHANGED');
  return selection;
}
async function currentSelection(selection) {
  validSelection(selection);
  const current=await prepareUSASpendingSelection({
    workspaceDirectory:selection.workspace.directory.path,
    receivingRoot:selection.receiving?.path,
    operator:selection.operator,sourceRoot:selection.source.root,
  });
  requireThat(canonical(current)===canonical(selection),'USASPENDING_APPLICATION_SELECTION_CHANGED','Review the current workspace and original source before opening.');
  return current;
}
function startupUrl(value,port) {
  let url;try{url=new URL(value);}catch{requireThat(false,'USASPENDING_APPLICATION_STARTUP_URL_INVALID');}
  const actual=Number(url.port||80);
  requireThat(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&url.pathname==='/'&&/^#[A-Za-z0-9_-]{43}$/.test(url.hash)&&Number.isInteger(actual)&&actual>=1&&actual<=65535&&(port===0||actual===port),'USASPENDING_APPLICATION_STARTUP_URL_INVALID');
  return url;
}
async function liveIdentity(url) {
  const response=await fetch(url.origin+'/api/identity',{headers:{'x-research-token':url.hash.slice(1),accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  requireThat(response.ok&&response.body,'USASPENDING_APPLICATION_LIVE_IDENTITY_UNAVAILABLE');
  const parts=[];let total=0;const reader=response.body.getReader();
  try{
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>65536){await reader.cancel();requireThat(false,'USASPENDING_APPLICATION_LIVE_IDENTITY_TOO_LARGE');}parts.push(Buffer.from(value));}
  }finally{reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,total)));
}
export async function verifyUSASpendingStartup(value,{selection,launchSourceRoot=SELF_SOURCE_ROOT,port=0,pid}={}) {
  validSelection(selection);integer(port,'Port',0,65535);
  requireThat(plain(value)&&value.schema===USASPENDING_STARTUP_SCHEMA&&value.status==='USASPENDING_WORKSPACE_READY'&&value.selectionSha256===selection.sha256&&value.sourceSha256===selection.source.sha256&&value.sourceRoot===selection.source.root&&value.launchSourceRoot===absolute(launchSourceRoot),'USASPENDING_APPLICATION_STARTUP_CHANGED');
  const identity=value.identity;
  requireThat(plain(identity)&&identity.schema===VERSION+'.session'&&identity.directory===selection.workspace.directory.path&&WORKSPACE_ID.test(identity.workspaceId??'')&&INSTANCE_ID.test(identity.instanceId??'')&&Number.isSafeInteger(identity.pid)&&identity.pid>0&&(pid===undefined||identity.pid===pid)&&typeof identity.startedAt==='string'&&Number.isFinite(Date.parse(identity.startedAt)),'USASPENDING_APPLICATION_SESSION_CHANGED');
  requireThat(!selection.workspace.workspaceId||identity.workspaceId===selection.workspace.workspaceId,'USASPENDING_APPLICATION_WORKSPACE_CHANGED');
  requireThat(value.receivingRoot===(selection.receiving?.path??null)&&value.operator===selection.operator,'USASPENDING_APPLICATION_STARTUP_CHANGED');
  await inspectUSASpendingApplicationSource(selection.source.root,{expectedSha256:selection.source.sha256});
  if(launchSourceRoot!==selection.source.root)await inspectUSASpendingApplicationSource(launchSourceRoot,{expectedSha256:selection.source.sha256});
  const workspace=await inspectUSASpendingWorkspace(identity.directory,{allowUninitialized:false});
  requireThat(workspace.workspaceId===identity.workspaceId,'USASPENDING_APPLICATION_WORKSPACE_CHANGED');
  if(selection.workspace.directory.exists)requireThat(workspace.directory.dev===selection.workspace.directory.dev&&workspace.directory.ino===selection.workspace.directory.ino,'USASPENDING_APPLICATION_DIRECTORY_CHANGED');
  if(selection.receiving){
    const receiving=await folder(selection.receiving.path,{privateOnly:true});
    if(selection.receiving.exists)requireThat(receiving.dev===selection.receiving.dev&&receiving.ino===selection.receiving.ino,'USASPENDING_APPLICATION_RECEIVING_CHANGED');
  }
  const url=startupUrl(value.url,port),live=await liveIdentity(url);
  requireThat(canonical(live)===canonical(identity),'USASPENDING_APPLICATION_LIVE_IDENTITY_CHANGED');
  return {url:url.href,workspaceId:identity.workspaceId,original:{
    schema:USASPENDING_STARTUP_SCHEMA,selectionSha256:selection.sha256,
    workspace:identity.directory,workspaceId:identity.workspaceId,
    sourceRoot:selection.source.root,launchSourceRoot,sourceSha256:selection.source.sha256,
    sourceFiles:selection.source.files,receivingRoot:value.receivingRoot,operator:value.operator,
    instanceId:identity.instanceId,pid:identity.pid,startedAt:identity.startedAt,
  }};
}
export async function startUSASpendingApplication(selection,{port=0,signals=true,onStartup}={}) {
  await currentSelection(selection);integer(port,'Port',0,65535);
  await inspectUSASpendingApplicationSource(SELF_SOURCE_ROOT,{expectedSha256:selection.source.sha256});
  if(selection.receiving&&!selection.receiving.exists)await mkdir(selection.receiving.path,{mode:0o700});
  const workspace=new AwardWorkspace(selection.workspace.directory.path,{operator:selection.operator});
  let session;
  try {
    session=await serveWorkspace(workspace,{port,receivingRoot:selection.receiving?.path});
    requireThat(session.identity,'USASPENDING_APPLICATION_SESSION_READER_REQUIRED');
    const startup={schema:USASPENDING_STARTUP_SCHEMA,status:'USASPENDING_WORKSPACE_READY',
      selectionSha256:selection.sha256,sourceRoot:selection.source.root,launchSourceRoot:SELF_SOURCE_ROOT,
      sourceSha256:selection.source.sha256,receivingRoot:selection.receiving?.path??null,
      operator:selection.operator,identity:session.identity,url:session.url};
    await verifyUSASpendingStartup(startup,{selection,launchSourceRoot:SELF_SOURCE_ROOT,port,pid:process.pid});
    let closing;
    const stop=()=>{close().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'USASPENDING_APPLICATION_CLOSE_FAILED',message:error.message})+'\n');process.exitCode=1;});};
    const close=()=>closing??=(async()=>{for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,stop);return session.close();})();
    if(signals)for(const signal of ['SIGINT','SIGTERM'])process.once(signal,stop);
    try{if(onStartup)await onStartup(startup);}catch(error){await close();throw error;}
    return {...session,startup,workspace,close};
  }catch(error){if(session)await session.close().catch(()=>{});else workspace.close();throw error;}
}
function argumentsFor(args) {
  const options={command:args[0]??'help'};
  if(options.command==='help'||options.command==='--help')return options;
  requireThat(options.command==='serve','USASPENDING_APPLICATION_COMMAND_UNKNOWN');
  const supported=new Set(['workspace','receiving-root','operator','port','managed-selection']);
  for(let i=1;i<args.length;i+=2){
    requireThat(args[i].startsWith('--')&&supported.has(args[i].slice(2))&&typeof args[i+1]==='string'&&!Object.hasOwn(options,args[i].slice(2)),'USASPENDING_APPLICATION_ARGUMENT_INVALID');
    options[args[i].slice(2)]=args[i+1];
  }
  requireThat(options.workspace,'USASPENDING_APPLICATION_WORKSPACE_REQUIRED');
  return options;
}
export async function main(args=process.argv.slice(2)) {
  const options=argumentsFor(args);
  if(options.command==='help'||options.command==='--help'){
    process.stdout.write('Open the saved USAspending award and transaction workspace.\n\nusaspending-application serve --workspace PRIVATE_DIRECTORY [--receiving-root PRIVATE_DIRECTORY] [--operator NAME] [--port 0]\n\nThe original workspace keeps source captures, reviews and receiving history between launches. Use the private browser link printed at startup.\n');return;
  }
  const rawPort=options.port??'0';requireThat(/^(0|[1-9]\d*)$/.test(rawPort),'USASPENDING_APPLICATION_PORT_INVALID');
  const port=Number(rawPort);integer(port,'Port',0,65535);
  let selection;
  if(options['managed-selection']){
    selection=validSelection(JSON.parse(options['managed-selection']));
    requireThat(selection.workspace.directory.path===absolute(options.workspace)&&selection.receiving?.path===(options['receiving-root']??undefined)&&selection.operator===(options.operator??'Local operator'),'USASPENDING_APPLICATION_ARGUMENTS_CHANGED');
  }else selection=await prepareUSASpendingSelection({workspaceDirectory:options.workspace,receivingRoot:options['receiving-root'],operator:options.operator??'Local operator'});
  return startUSASpendingApplication(selection,{port,onStartup:value=>process.stdout.write(JSON.stringify(value)+'\n')});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'USASPENDING_APPLICATION_FAILED',message:error.message})+'\n');process.exitCode=1;});
}
