import {spawn} from 'node:child_process';
import {promises as fs,constants as FS,openSync,closeSync,readSync,writeFileSync,readFileSync,lstatSync,fstatSync,fsyncSync,mkdirSync,linkSync,unlinkSync,readdirSync,realpathSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inheritReceiving} from './native/lease.mjs';
import {problem,SCHEMA as WORKSPACE_SCHEMA} from './workspace.mjs';

const active=new Map(),SCHEMA='lightdash.commissioning-handover-request.v1',INTENT_SCHEMA='lightdash.commissioning-handover-intent.v1';
function handoverDirectory(workspace,id){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw problem('Use the original handover UUID.');
  return path.join(workspace.root,'handover',id);
}
function statIfPresent(filename){
  try{return lstatSync(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function regularFile(filename){
  const info=statIfPresent(filename);
  if(!info)return null;
  if(!info.isFile()||info.isSymbolicLink())throw problem('The retained handover requires its original regular file: '+filename,409,'HANDOVER_FILE_CHANGED');
  return info;
}
function ensureDirectory(directory){
  try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const info=lstatSync(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(directory)!==directory)throw problem('Use the original owned handover directory.',409,'HANDOVER_DIRECTORY_CHANGED');
}
function syncFile(filename){
  const fd=openSync(filename,FS.O_RDONLY|FS.O_NOFOLLOW);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function syncDirectory(directory){
  const fd=openSync(directory,FS.O_RDONLY|FS.O_DIRECTORY|FS.O_NOFOLLOW);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function readJsonIfPresent(filename){
  if(!regularFile(filename))return null;
  return JSON.parse(readFileSync(filename,'utf8'));
}
function retainJson(directory,name,value){
  const filename=path.join(directory,name),temporary=path.join(directory,name+'.'+crypto.randomUUID()+'.pending');
  let fd;
  try{
    fd=openSync(temporary,FS.O_WRONLY|FS.O_CREAT|FS.O_EXCL|FS.O_NOFOLLOW,0o600);
    writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;
    try{linkSync(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;}
    syncDirectory(directory);
    return readJsonIfPresent(filename);
  }finally{
    if(fd!==undefined)closeSync(fd);
    try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
function validateSelection(workspace,id,value,schema){
  if(value?.schema!==schema||value.workspaceId!==workspace.metadata().id||value.id!==id)throw problem('This handover belongs to another workspace or selection.',409,'HANDOVER_SELECTION_CHANGED');
  if(typeof value.includeOperatorPrivate!=='boolean'||!/^[a-f0-9]{64}$/.test(value.applicationSourceSha256??''))throw problem('Recover the complete original handover selection.',409,'HANDOVER_SELECTION_INCOMPLETE');
  if(schema===SCHEMA&&(!Number.isSafeInteger(value.workspaceRevision)||value.workspaceRevision<0))throw problem('Recover the selected original handover revision.',409,'HANDOVER_SELECTION_INCOMPLETE');
  if(value.originalDatabase&&(!Number.isSafeInteger(value.originalDatabase.bytes)||value.originalDatabase.bytes<=0||!/^[a-f0-9]{64}$/.test(value.originalDatabase.sha256??'')))throw problem('Recover the original handover database identity.',409,'HANDOVER_SELECTION_INCOMPLETE');
  if(value.expectedWorkspaceRevision!==undefined&&(!Number.isSafeInteger(value.expectedWorkspaceRevision)||value.expectedWorkspaceRevision<0))throw problem('Recover the original selection precondition.',409,'HANDOVER_SELECTION_INCOMPLETE');
  return value;
}
async function originalRequest(workspace,id){
  const request=readJsonIfPresent(path.join(handoverDirectory(workspace,id),'request.json'));
  if(!request)throw problem('This handover still has a pending selection. Resume its original ID to finish selecting it.',409,'HANDOVER_SELECTION_PENDING');
  return validateSelection(workspace,id,request,SCHEMA);
}
function snapshotMetadata(filename){
  const info=regularFile(filename);
  if(!info||info.size===0)throw problem('The prepublication SQLite snapshot is incomplete.',409,'HANDOVER_SNAPSHOT_INCOMPLETE');
  let database;
  try{
    database=new DatabaseSync(filename,{readOnly:true});
    database.exec('PRAGMA busy_timeout=5000;');
    const integrity=database.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw problem('The prepublication SQLite snapshot did not reopen completely.',409,'HANDOVER_SNAPSHOT_INCOMPLETE');
    const tables=new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    if(['meta','editions','drafts','draft_files','reviews','operations'].some(name=>!tables.has(name)))throw problem('The prepublication SQLite snapshot has incomplete workspace tables.',409,'HANDOVER_SNAPSHOT_INCOMPLETE');
    const row=database.prepare('SELECT revision,body FROM meta WHERE id=1').get();
    if(!row)throw problem('The prepublication SQLite snapshot has no workspace metadata.',409,'HANDOVER_SNAPSHOT_INCOMPLETE');
    const metadata={...JSON.parse(row.body),revision:Number(row.revision)};
    if(metadata.schema!==WORKSPACE_SCHEMA||!Number.isSafeInteger(metadata.revision)||metadata.revision<0)throw problem('The original SQLite snapshot has a different workspace schema.',409,'HANDOVER_SELECTION_CHANGED');
    return metadata;
  }catch(error){
    if(error.code==='ERR_SQLITE_ERROR'&&[1,11,26].includes(Number(error.errcode)))throw problem('The prepublication SQLite snapshot is incomplete: '+error.message,409,'HANDOVER_SNAPSHOT_INCOMPLETE');
    throw error;
  }finally{if(database)database.close();}
}
function databaseIdentity(filename){
  regularFile(filename);
  const fd=openSync(filename,FS.O_RDONLY|FS.O_NOFOLLOW),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(256*1024);
  try{
    const before=fstatSync(fd);let bytes=0,count;
    while((count=readSync(fd,buffer,0,buffer.length,null))>0){hash.update(buffer.subarray(0,count));bytes+=count;}
    const after=fstatSync(fd);
    if(bytes!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw problem('The retained original SQLite snapshot changed.',409,'HANDOVER_SNAPSHOT_CHANGED');
    return {bytes,sha256:hash.digest('hex')};
  }finally{closeSync(fd);}
}
function checkSnapshot(workspace,filename,selection,{selected=false}={}){
  const metadata=snapshotMetadata(filename);
  if(metadata.id!==selection.workspaceId||metadata.id!==workspace.metadata().id)throw problem('This original snapshot belongs to another workspace.',409,'HANDOVER_SELECTION_CHANGED');
  const expected=selected?selection.workspaceRevision:selection.expectedWorkspaceRevision;
  if(expected!==undefined&&metadata.revision!==expected)throw problem('The workspace changed before this handover selection completed. Use a new handover ID for the current workspace.',409,'REVISION_CONFLICT');
  if(selection.originalDatabase){
    const actual=databaseIdentity(filename);
    if(actual.bytes!==selection.originalDatabase.bytes||actual.sha256!==selection.originalDatabase.sha256)throw problem('The selected original SQLite snapshot changed.',409,'HANDOVER_SNAPSHOT_CHANGED');
  }
  return metadata;
}
function selectOriginalDatabase(workspace,directory,intent){
  const basis=path.join(directory,'basis'),destination=path.join(basis,'origin.sqlite');
  ensureDirectory(basis);syncDirectory(directory);
  let candidate=null;
  if(!regularFile(destination)){
    for(const name of readdirSync(basis).sort()){
      if(!/^\.snapshot-[a-f0-9-]{36}\.sqlite\.pending$/.test(name))continue;
      const filename=path.join(basis,name);
      try{checkSnapshot(workspace,filename,intent);candidate=filename;break;}
      catch(error){if(!['HANDOVER_SNAPSHOT_INCOMPLETE','REVISION_CONFLICT'].includes(error.code))throw error;}
    }
    if(!candidate){
      const current=workspace.metadata();
      if(intent.expectedWorkspaceRevision!==undefined&&current.revision!==intent.expectedWorkspaceRevision)throw problem('The workspace changed before this handover selection completed. Use a new handover ID for the current workspace.',409,'REVISION_CONFLICT');
      candidate=path.join(basis,'.snapshot-'+crypto.randomUUID()+'.sqlite.pending');
      const fd=openSync(candidate,FS.O_WRONLY|FS.O_CREAT|FS.O_EXCL|FS.O_NOFOLLOW,0o600);closeSync(fd);
      // SQLite includes committed WAL state. The original live database is not
      // rewritten; no revision is promised until this complete snapshot exists.
      workspace.db.prepare('VACUUM INTO ?').run(candidate);
      checkSnapshot(workspace,candidate,intent);
    }
    // Keep the complete candidate after any persistence failure so recovery can
    // adopt its original bytes. Only the first no-overwrite link selects a basis.
    syncFile(candidate);
    try{linkSync(candidate,destination);}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const metadata=checkSnapshot(workspace,destination,intent);
  syncFile(destination);syncDirectory(basis);syncDirectory(directory);
  return {metadata,originalDatabase:databaseIdentity(destination)};
}
export async function prepareHandover({workspace,appRoot=path.dirname(fileURLToPath(import.meta.url)),id=crypto.randomUUID(),includeOperatorPrivate=false,expectedRevision,resume=false}={}){
  const directory=handoverDirectory(workspace,id);
  ensureDirectory(path.join(workspace.root,'handover'));
  if(resume&&!statIfPresent(directory))throw problem('The original handover selection is absent.',404,'HANDOVER_NOT_FOUND');
  ensureDirectory(directory);syncDirectory(path.dirname(directory));
  let request=readJsonIfPresent(path.join(directory,'request.json')),intent=readJsonIfPresent(path.join(directory,'intent.json'));
  let proposed=null;
  if(!resume){
    if(typeof includeOperatorPrivate!=='boolean')throw problem('Choose whether to include operator diagnostics.');
    const source=readFileSync(path.join(appRoot,'source-manifest.json'));
    proposed={schema:INTENT_SCHEMA,id,workspaceId:workspace.metadata().id,includeOperatorPrivate,applicationSourceSha256:crypto.createHash('sha256').update(source).digest('hex'),createdAt:new Date().toISOString()};
    if(expectedRevision!==undefined){
      if(!Number.isSafeInteger(Number(expectedRevision))||Number(expectedRevision)<0)throw problem('Use the observed workspace revision.');
      proposed.expectedWorkspaceRevision=Number(expectedRevision);
    }
    for(const retained of [request,intent].filter(Boolean))for(const key of ['id','workspaceId','includeOperatorPrivate','applicationSourceSha256'])if(retained[key]!==proposed[key])throw problem('The original handover ID names a different complete selection.',409,'HANDOVER_SELECTION_CHANGED');
  }
  if(request){
    validateSelection(workspace,id,request,SCHEMA);
    const origin=path.join(directory,'basis','origin.sqlite');
    if(!regularFile(origin))throw problem('Recover this accepted handover’s original SQLite basis. Its selected revision cannot be replaced with the live workspace.',409,'HANDOVER_SNAPSHOT_MISSING');
    checkSnapshot(workspace,origin,request,{selected:true});
    syncFile(origin);syncDirectory(path.dirname(origin));syncFile(path.join(directory,'request.json'));syncDirectory(directory);
    return request;
  }
  if(!intent){
    if(resume)throw problem('Recover the original handover intent before continuing.',409,'HANDOVER_SELECTION_INCOMPLETE');
    for(const name of ['basis','result.json','status.json','Lightdash_Commissioning_Handover.zip'])if(statIfPresent(path.join(directory,name)))throw problem('Recover this existing handover’s original request before continuing.',409,'HANDOVER_SELECTION_INCOMPLETE');
    intent=retainJson(directory,'intent.json',proposed);
    for(const key of ['id','workspaceId','includeOperatorPrivate','applicationSourceSha256'])if(intent[key]!==proposed[key])throw problem('The original handover ID was concurrently selected with different inputs.',409,'HANDOVER_SELECTION_CHANGED');
  }
  validateSelection(workspace,id,intent,INTENT_SCHEMA);
  syncFile(path.join(directory,'intent.json'));syncDirectory(directory);
  const selected=selectOriginalDatabase(workspace,directory,intent);
  const complete={schema:SCHEMA,id,workspaceId:intent.workspaceId,workspaceRevision:selected.metadata.revision,includeOperatorPrivate:intent.includeOperatorPrivate,applicationSourceSha256:intent.applicationSourceSha256,createdAt:intent.createdAt,selectedAt:new Date().toISOString(),originalDatabase:selected.originalDatabase};
  request=retainJson(directory,'request.json',complete);
  validateSelection(workspace,id,request,SCHEMA);
  for(const key of ['id','workspaceId','workspaceRevision','includeOperatorPrivate','applicationSourceSha256'])if(request[key]!==complete[key])throw problem('The retained handover request names another original snapshot.',409,'HANDOVER_SELECTION_CHANGED');
  checkSnapshot(workspace,path.join(directory,'basis','origin.sqlite'),request,{selected:true});
  return request;
}
export async function readHandover({workspace,id}={}){
  const directory=handoverDirectory(workspace,id),request=readJsonIfPresent(path.join(directory,'request.json'));
  if(!request){
    const intent=validateSelection(workspace,id,readJsonIfPresent(path.join(directory,'intent.json')),INTENT_SCHEMA);
    return {id,intent,request:null,state:'PENDING',selectionPending:true,result:null,status:null,localPending:false,continuation:'Resume this original handover ID to finish its pending selection.'};
  }
  validateSelection(workspace,id,request,SCHEMA);
  const result=readJsonIfPresent(path.join(directory,'result.json')),status=readJsonIfPresent(path.join(directory,'status.json'));
  return {id,request,state:result?.state??status?.state??'PENDING',result,status,error:status?.error??null,localPending:active.has(directory)};
}
async function callPackager({workspace,appRoot,id,python,inspect=false}){
  const destination=handoverDirectory(workspace,id);
  if(active.has(destination))return active.get(destination);
  const promise=(async()=>{
    await originalRequest(workspace,id);
    const runtime=python??workspace.metadata().connection?.runtime?.python??'/usr/bin/python3',attemptId=crypto.randomUUID();
    const args=[path.join(appRoot,'package.py'),'--workspace',workspace.root,'--app',appRoot,'--output',path.join(destination,'Lightdash_Commissioning_Handover.zip')];
    if(inspect)args.push('--inspect-existing');
    const prefix=(inspect?'inspect-':'package-')+attemptId,stdoutPath=path.join(destination,prefix+'.stdout.log'),stderrPath=path.join(destination,prefix+'.stderr.log');
    let stdout,stderr,code;
    try{
      stdout=await fs.open(stdoutPath,'wx',0o600);stderr=await fs.open(stderrPath,'wx',0o600);
      const inherited=await inheritReceiving(['ignore',stdout.fd,stderr.fd],process.env);
      code=await new Promise((resolve,reject)=>{
        const child=spawn(runtime,args,{...inherited,shell:false,windowsHide:true});
        child.once('error',reject);
        child.once('close',(status,signal)=>status===null?reject(new Error('The original packaging process ended with signal '+signal)):resolve(status));
      });
    }finally{if(stdout)await stdout.close();if(stderr)await stderr.close();}
    if(code!==0){
      const diagnostic=await fs.readFile(stderrPath,'utf8').catch(()=>'');
      let detail;try{detail=JSON.parse(diagnostic.trim()).error;}catch{}
      throw new Error((inspect?'Original handover inspection':'Handover packaging')+' exited '+code+(detail?': '+detail:'.')+' Original request, basis and complete logs remain in '+destination+'.');
    }
    const result=JSON.parse((await fs.readFile(stdoutPath,'utf8')).trim());
    if(!['SUCCEEDED','RUNNING','PENDING','INTERRUPTED'].includes(result.state))throw new Error('The original packager returned an unknown handover state.');
    return {id,...result};
  })();
  active.set(destination,promise);
  try{return await promise;}finally{if(active.get(destination)===promise)active.delete(destination);}
}
export async function inspectHandover({workspace,appRoot=path.dirname(fileURLToPath(import.meta.url)),id,python}={}){
  const retained=await readHandover({workspace,id});
  if(retained.selectionPending)return retained;
  return await callPackager({workspace,appRoot,id,python,inspect:true});
}
export async function resumeHandover({workspace,appRoot=path.dirname(fileURLToPath(import.meta.url)),id,python}={}){
  await prepareHandover({workspace,appRoot,id,resume:true});
  return await callPackager({workspace,appRoot,id,python});
}
export async function createHandover({workspace,appRoot=path.dirname(fileURLToPath(import.meta.url)),id=crypto.randomUUID(),includeOperatorPrivate=false,expectedRevision,python}={}){
  await prepareHandover({workspace,appRoot,id,includeOperatorPrivate,expectedRevision});
  return await callPackager({workspace,appRoot,id,python});
}
