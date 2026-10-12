// MIT. Complete Timescale project receiving through original SQLite and dataset files.
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, mkdir, mkdtemp, readdir, lstat, rename, rm, rmdir, chmod } from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { absolute, privateDirectory, readPrivate, readJson, createFile, atomicJson, syncDirectory, hashPrivate, bytes, digest, fault, stamp } from '../publisher/files.mjs';
import { uuid, hash, only } from './contracts.mjs';
const SAFE=/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const LIMIT=1099511627776;
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function filename(path){if(typeof path!=='string'||!SAFE.test(path)||path.split('/').some(x=>x==='.'||x==='..'))throw fault('TIMESCALE_PACKAGE_PATH_INVALID');return path;}
async function copyOriginal(source,destination,{signal,sqlite=false}={}){
  signal?.throwIfAborted();
  await privateDirectory(dirname(destination),true);
  const before=await lstat(source);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.mode&0o077)throw fault('TIMESCALE_PACKAGE_PRIVATE_FILE_REQUIRED');
  if(sqlite){
    const db=new DatabaseSync(source,{readOnly:true});
    try{db.exec("VACUUM INTO '"+destination.replaceAll("'","''")+"'");}finally{db.close();}
    await chmod(destination,0o600);
    const file=await open(destination,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{await file.sync();}finally{await file.close();}
    const result=await hashPrivate(destination,LIMIT);
    return {sha256:result.hash,bytes:result.bytes,capture:'sqlite-vacuum-into'};
  }
  const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
  let output;
  try{
    const initial=await input.stat({bigint:true});
    if(!initial.isFile()||initial.nlink!==1n||initial.mode&0o077n)throw fault('TIMESCALE_PACKAGE_PRIVATE_FILE_REQUIRED');
    output=await open(destination,'wx',0o600);
    const hash=createHash('sha256');let total=0;
    for await(const chunk of input.createReadStream({autoClose:false})){
      signal?.throwIfAborted();total+=chunk.length;
      if(total>LIMIT)throw fault('TIMESCALE_PACKAGE_FILE_TOO_LARGE');
      await output.writeFile(chunk);hash.update(chunk);
    }
    const after=await input.stat({bigint:true});
    if(BigInt(total)!==initial.size||after.size!==initial.size||after.mtimeNs!==initial.mtimeNs||after.ctimeNs!==initial.ctimeNs)
      throw fault('TIMESCALE_PACKAGE_SOURCE_CHANGED');
    await output.sync();
    return {sha256:hash.digest('hex'),bytes:total,capture:'original-file'};
  }finally{await output?.close();await input.close();}
}
async function reserveFinal(stage,destination){
  await mkdir(destination,{mode:0o700});
  try{await rename(stage,destination);await syncDirectory(dirname(destination));}
  catch(error){await rmdir(destination).catch(()=>{});throw error;}
}
function exportTimescaleWorkspace(workspace,input){
  only(input,['requestId','expectedVersion','outputDirectory']);
  uuid(input.requestId);absolute(input.outputDirectory,'new package directory');
  const output=resolve(input.outputDirectory),root=resolve(workspace.directory);
  if(output===root||output.startsWith(root+'/'))throw fault('TIMESCALE_PACKAGE_SEPARATE_DIRECTORY_REQUIRED');
  return workspace.exclusive('export',input,async({signal,progress})=>{
    if(await exists(output)){
      const original=await readJson(join(output,'manifest.json'),67108864);
      if(original.requestId!==input.requestId||original.workspaceId!==workspace.settings.id)throw fault('TIMESCALE_PACKAGE_EXISTS');
      return inspectTimescalePackage(output);
    }
    await privateDirectory(dirname(output));
    const stage=await mkdtemp(join(dirname(output),'.timescale-export-'));
    const files=[],directories=[];let retained=false;
    try{
      async function add(source,path,sqlite=false){
        filename(path);const saved=await copyOriginal(source,join(stage,path),{signal,sqlite});
        files.push({path,...saved});progress({files:files.length,bytes:files.reduce((n,x)=>n+x.bytes,0)});
      }
      const skip=new Set(['publisher.lock','writer.lock','writer.lease','control.json','control.sock']);
      async function walk(directory,prefix){
        await privateDirectory(directory);directories.push(prefix);
        for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
          const source=join(directory,item.name),path=prefix+'/'+item.name;
          if(source===workspace.settings.targetDirectory||skip.has(item.name)||item.name.startsWith('.pending-')||
              /\.(?:sqlite-journal|sqlite-wal|sqlite-shm)$/.test(item.name))continue;
          filename(path);
          if(item.isDirectory())await walk(source,path);
          else if(item.isFile())await add(source,path,item.name.endsWith('.sqlite'));
          else throw fault('TIMESCALE_PACKAGE_SPECIAL_FILE');
        }
      }
      await walk(root,'workspace');
      let target=null;
      const statePath=join(workspace.settings.targetDirectory,'state.json');
      if(await exists(workspace.settings.targetDirectory)){
        const original=await readPrivate(statePath,262144),state=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));
        if(!['stellar-forge.dataset-versions.v1','stellar-forge.dataset-versions.v2'].includes(state.schema)||!Array.isArray(state.versions))
          throw fault('TIMESCALE_DATASET_STATE_INVALID');
        target={stateDigest:digest(original),current:state.current,revision:state.revision,versions:state.versions.length};
        await privateDirectory(join(stage,'dataset'),true);
        await createFile(join(stage,'dataset','state.json'),original);
        files.push({path:'dataset/state.json',bytes:original.length,sha256:digest(original),capture:'original-file'});
        // state.json selects one original immutable generation set. The source
        // seller may keep serving; each referenced file is opened and copied
        // completely, and a concurrent retirement fails this export explicitly.
        for(const version of state.versions){
          hash(version.snapshot);
          for(const name of ['data.csv','dataset.json','manifest.json'])
            await add(join(workspace.settings.targetDirectory,'generations',version.snapshot,name),'dataset/generations/'+version.snapshot+'/'+name);
        }
      }
      const manifest={schema:'stellar-forge.timescale-package.v1',requestId:input.requestId,workspaceId:workspace.settings.id,
        createdAt:stamp(),complete:true,originalDirectory:root,originalTargetDirectory:workspace.settings.targetDirectory,
        originalSourceFile:workspace.sourceFile,target,directories:directories.sort(),files:files.sort((a,b)=>a.path.localeCompare(b.path)),
        credentialHandling:'Original environment references and public CA files only; supply those environment values on the receiving host.'};
      await createFile(join(stage,'manifest.json'),bytes(manifest));
      await syncDirectory(stage);await reserveFinal(stage,output);retained=true;
      return {directory:output,manifestDigest:digest(bytes(manifest)),workspaceId:manifest.workspaceId,files:files.length,
        bytes:files.reduce((n,x)=>n+x.bytes,0),target};
    }finally{if(!retained)await rm(stage,{recursive:true,force:true});}
  });
}
async function inspectTimescalePackage(directory,expectedDigest){
  absolute(directory);await privateDirectory(directory);
  const original=await readPrivate(join(directory,'manifest.json'),67108864),sha=digest(original);
  if(expectedDigest!==undefined&&hash(expectedDigest)!==sha)throw fault('TIMESCALE_PACKAGE_DIGEST_CHANGED');
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));
  if(manifest.schema!=='stellar-forge.timescale-package.v1'||manifest.complete!==true||!Array.isArray(manifest.files)||!Array.isArray(manifest.directories))
    throw fault('TIMESCALE_PACKAGE_INVALID');
  uuid(manifest.requestId);uuid(manifest.workspaceId);
  const names=new Set();let total=0;
  for(const name of manifest.directories){filename(name);if(!/^workspace(?:\/|$)/.test(name))throw fault('TIMESCALE_PACKAGE_DIRECTORY_INVALID');await privateDirectory(join(directory,name));}
  for(const file of manifest.files){
    filename(file.path);hash(file.sha256);
    if(!/^(workspace|dataset)\//.test(file.path)||names.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0)
      throw fault('TIMESCALE_PACKAGE_FILE_INVALID');
    names.add(file.path);
    await privateDirectory(dirname(join(directory,file.path)));
    const measured=await hashPrivate(join(directory,file.path),LIMIT);
    if(measured.hash!==file.sha256||measured.bytes!==file.bytes)throw fault('TIMESCALE_PACKAGE_FILE_CHANGED');
    total+=file.bytes;
  }
  for(const path of ['workspace/workspace.json','workspace/timescale.sqlite','workspace/publisher/workspace.json','workspace/publisher/publisher.sqlite',
    'workspace/connection/source.json','workspace/connection/source-original.json'])
    if(!names.has(path))throw fault('TIMESCALE_PACKAGE_INCOMPLETE');
  if(manifest.target&&!names.has('dataset/state.json'))throw fault('TIMESCALE_PACKAGE_INCOMPLETE');
  return {directory,manifestDigest:sha,workspaceId:manifest.workspaceId,files:manifest.files.length,bytes:total,target:manifest.target,manifest};
}
async function receiveTimescaleWorkspace(input){
  only(input,['requestId','packageDirectory','expectedDigest','directory']);
  uuid(input.requestId);hash(input.expectedDigest);absolute(input.directory,'new receiving directory');absolute(input.packageDirectory,'package directory');
  const destination=input.directory;
  if(destination===input.packageDirectory||destination.startsWith(input.packageDirectory+'/'))throw fault('TIMESCALE_RECEIVE_SEPARATE_DIRECTORY_REQUIRED');
  if(await exists(destination)){
    const receipt=await readJson(join(destination,'receive.json'),32768);
    if(receipt.requestId!==input.requestId||receipt.manifestDigest!==input.expectedDigest)throw fault('TIMESCALE_RECEIVE_EXISTS');
    return {...receipt,reused:true};
  }
  const selected=await inspectTimescalePackage(input.packageDirectory,input.expectedDigest);
  await privateDirectory(dirname(destination));
  const stage=await mkdtemp(join(dirname(destination),'.timescale-receive-'));
  let retained=false;
  try{
    for(const name of selected.manifest.directories)await privateDirectory(join(stage,name),true);
    for(const file of selected.manifest.files){
      const copied=await copyOriginal(join(input.packageDirectory,file.path),join(stage,file.path));
      if(copied.sha256!==file.sha256||copied.bytes!==file.bytes)throw fault('TIMESCALE_RECEIVE_FILE_CHANGED');
    }
    const directory=join(destination,'workspace'),targetDirectory=join(destination,'dataset');
    const sourceFile=join(directory,'connection','source.json');
    const workspace=await readJson(join(stage,'workspace','workspace.json'),16384);
    const publisher=await readJson(join(stage,'workspace','publisher','workspace.json'),4096);
    // Preserve original declarations and every history/plan/result byte in the
    // package. Only these two current runtime-binding files are relocated.
    await createFile(join(stage,'original-workspace.json'),bytes(workspace));
    await createFile(join(stage,'original-publisher-workspace.json'),bytes(publisher));
    await atomicJson(join(stage,'workspace'),'workspace.json',{...workspace,targetDirectory});
    await atomicJson(join(stage,'workspace','publisher'),'workspace.json',{...publisher,sourceFile,targetDirectory});
    const receipt={schema:'stellar-forge.timescale-receiving.v1',requestId:input.requestId,
      receivedAt:stamp(),manifestDigest:selected.manifestDigest,workspaceId:selected.workspaceId,
      directory,targetDirectory,files:selected.files,bytes:selected.bytes,complete:true};
    await createFile(join(stage,'receive.json'),bytes(receipt));await syncDirectory(stage);
    await reserveFinal(stage,destination);retained=true;
    return {...receipt,reused:false};
  }finally{if(!retained)await rm(stage,{recursive:true,force:true});}
}

export { exportTimescaleWorkspace, inspectTimescalePackage, receiveTimescaleWorkspace };
