// MIT. The original Superset operator's private connection and managed launch binding.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const SUPERSET_OPERATOR_LAUNCH_SCHEMA = 'stellar-forge.superset-operator-launch.v1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const OWNED_SOURCE = ['launch.mjs','server.mjs','source.mjs','workspace.mjs','client.mjs','files.mjs','exact-json.mjs','merchant.mjs','customer.mjs','cli.mjs',
  'ui/index.html','ui/app.mjs','ui/style.css','../dataset-handler.mjs','../dataset-refresh/writer-lease.mjs'];
const fail = (code,message,status=409) => Object.assign(new Error(message),{code,status});
const need = (ok,code,message) => {if(!ok)throw fail(code,message);};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (left,right) => JSON.stringify(left) === JSON.stringify(right);
const owned = stat => process.getuid === undefined || stat.uid === process.getuid();

async function directory(value,{allowMissing=false,privateDirectory=true}={}) {
  need(typeof value==='string' && value.length>0 && !value.includes('\0'),
    'SUPERSET_LAUNCH_DIRECTORY','Select an original directory.');
  const named=path.resolve(value);
  let stat;
  try {stat=await fsp.lstat(named);}
  catch(error) {
    if(error.code!=='ENOENT'||!allowMissing)throw error;
    const parent=await directory(path.dirname(named),{privateDirectory});
    return {path:path.join(parent.path,path.basename(named)),exists:false};
  }
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&(!privateDirectory||(owned(stat)&&!(stat.mode&0o077))),
    'SUPERSET_LAUNCH_PRIVATE_DIRECTORY','Use an owned private directory with no group or other access.');
  return {path:await fsp.realpath(named),exists:true};
}

async function sourceIdentity(sourceDirectory) {
  const root=(await directory(sourceDirectory,{privateDirectory:false})).path;
  const entries=[];
  for(const relative of OWNED_SOURCE) {
    const file=path.resolve(root,relative),before=await fsp.lstat(file);
    need(before.isFile()&&!before.isSymbolicLink(),'SUPERSET_LAUNCH_SOURCE','The original operator source must be regular files.');
    const bytes=await fsp.readFile(file),after=await fsp.lstat(file);
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&bytes.length===before.size,
      'SUPERSET_LAUNCH_SOURCE_CHANGED','An original operator source file changed while being read.');
    entries.push({relative,file,sha256:digest(bytes)});
  }
  return {directory:root,files:entries.map(entry=>entry.file),
    sha256:digest(JSON.stringify(entries.map(({relative,sha256})=>({relative,sha256})))),
    serverSha256:entries.find(entry=>entry.relative==='server.mjs').sha256};
}

export async function inspectSupersetOperatorSelection({directory:operatorDirectory,workspaceDirectory,
  sourceDirectory=HERE}={}) {
  const selected=await directory(operatorDirectory,{allowMissing:true});
  const workspace=workspaceDirectory==null?null:await directory(workspaceDirectory,{allowMissing:true});
  const source=await sourceIdentity(sourceDirectory);
  const selection={schema:'stellar-forge.superset-operator-selection.v1',directory:selected.path,
    workspaceDirectory:workspace?.path??null,sourceDirectory:source.directory,sourceSha256:source.sha256};
  return {selection,selectionSha256:digest(JSON.stringify(selection)),sourceFiles:source.files,
    serverSha256:source.serverSha256,directoryExists:selected.exists,workspaceExists:workspace?.exists??null};
}

export async function verifySupersetOperatorSourceSelection(options={}) {
  const selected=await inspectSupersetOperatorSelection(options);
  if(options.expectedSelectionSha256!==undefined)
    need(HASH.test(options.expectedSelectionSha256)&&options.expectedSelectionSha256===selected.selectionSha256,
      'SUPERSET_LAUNCH_SELECTION_CHANGED','Review the current original operator source and workspace before starting.');
  const executed=await sourceIdentity(HERE);
  need(executed.sha256===selected.selection.sourceSha256,
    'SUPERSET_LAUNCH_EXECUTION_CHANGED','The executed operator source differs from the reviewed source.');
  return {...selected,executionSourceDirectory:executed.directory,serverSha256:executed.serverSha256};
}

async function readPrivateRecord(file) {
  const handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let bytes,first;
  try {
    first=await handle.stat();
    need(first.isFile()&&first.nlink===1&&owned(first)&&!(first.mode&0o077)&&first.size>0&&first.size<=32768,
      'SUPERSET_LAUNCH_PRIVATE_FILE','Use the original owned 0600 operator launch file.');
    bytes=await handle.readFile();
    const after=await handle.stat(),named=await fsp.lstat(file);
    need(first.dev===named.dev&&first.ino===named.ino&&!named.isSymbolicLink()&&
      first.size===after.size&&first.mtimeMs===after.mtimeMs&&first.ctimeMs===after.ctimeMs&&bytes.length===first.size,
      'SUPERSET_LAUNCH_RECORD_CHANGED','The operator launch record changed while being read.');
  } finally {await handle.close();}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw fail('SUPERSET_LAUNCH_JSON','The original operator launch file must contain complete JSON.');}
}

async function responseJSON(response) {
  need(response.ok,'SUPERSET_LAUNCH_HTTP','The original operator did not accept its private launch credential.');
  const stated=response.headers.get('content-length');
  need(stated===null||/^\d+$/.test(stated)&&Number(stated)<=32768,
    'SUPERSET_LAUNCH_RESPONSE','The operator launch response exceeds its supported size.');
  need(response.body,'SUPERSET_LAUNCH_RESPONSE','The original operator launch response is empty.');
  const chunks=[];let size=0;
  try {
    for await(const chunk of response.body) {
      size+=chunk.length;
      need(size<=32768,'SUPERSET_LAUNCH_RESPONSE','The operator launch response exceeds its supported size.');
      chunks.push(chunk);
    }
  } catch(error) {await response.body.cancel().catch(()=>{});throw error;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch {throw fail('SUPERSET_LAUNCH_RESPONSE','The original operator launch response must contain complete JSON.');}
}

export async function readSupersetOperatorLaunch({directory:operatorDirectory,launchFile,operatorId,instanceId,
  executionSourceDirectory,selectionSha256,announcement,timeoutMs=10000}={}) {
  need(operatorDirectory!==undefined||launchFile!==undefined,
    'SUPERSET_LAUNCH_DIRECTORY','Select the host-declared operator directory or launch file.');
  const root=(await directory(operatorDirectory??path.dirname(launchFile))).path;
  const file=path.join(root,'operator-launch.json');
  need(launchFile===undefined||path.resolve(launchFile)===file,
    'SUPERSET_LAUNCH_FILE_CHANGED','Use operator-launch.json inside the selected private operator directory.');
  const record=await readPrivateRecord(file);
  need(record&&typeof record==='object'&&!Array.isArray(record)&&record.schema===SUPERSET_OPERATOR_LAUNCH_SCHEMA&&
    record.state==='running'&&record.directory===root&&ID.test(record.operatorId??'')&&ID.test(record.instanceId??'')&&
    Number.isSafeInteger(record.pid)&&record.pid>0&&typeof record.token==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(record.token)&&
    HASH.test(record.serverSha256??'')&&HASH.test(record.sourceSha256??'')&&HASH.test(record.selectionSha256??''),
    'SUPERSET_LAUNCH_RECORD','The selected operator does not have a valid running launch record.');
  need(operatorId===undefined||record.operatorId===operatorId,'SUPERSET_LAUNCH_OPERATOR_CHANGED','The selected original operator changed.');
  need(instanceId===undefined||record.instanceId===instanceId,'SUPERSET_LAUNCH_INSTANCE_CHANGED','The original operator process restarted.');
  need(selectionSha256===undefined||record.selectionSha256===selectionSha256,
    'SUPERSET_LAUNCH_SELECTION_CHANGED','The original operator launch selection changed.');
  try {process.kill(record.pid,0);}
  catch {throw fail('SUPERSET_LAUNCH_PROCESS','The original operator process is no longer running.');}
  let url;
  try {url=new URL(record.url);} catch {throw fail('SUPERSET_LAUNCH_URL','The original operator URL is invalid.');}
  need(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&
    !url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&
    url.origin===record.url&&Number(url.port||80)>0&&Number(url.port||80)<=65535,
    'SUPERSET_LAUNCH_URL','Use the original numeric loopback operator origin.');
  const executed=await sourceIdentity(executionSourceDirectory??record.executionSourceDirectory);
  need(executed.directory===record.executionSourceDirectory&&record.serverFile===path.join(executed.directory,'server.mjs')&&
    executed.serverSha256===record.serverSha256&&executed.sha256===record.sourceSha256,
    'SUPERSET_LAUNCH_EXECUTION_CHANGED','The running original operator source changed.');
  const selected=await inspectSupersetOperatorSelection({directory:root,workspaceDirectory:record.workspaceDirectory,
    sourceDirectory:record.sourceDirectory});
  need(selected.selectionSha256===record.selectionSha256&&selected.selection.sourceSha256===record.sourceSha256,
    'SUPERSET_LAUNCH_SELECTION_CHANGED','The reviewed original operator source changed.');
  const publicKeys=['schema','state','operatorId','instanceId','pid','directory','workspaceDirectory','url',
    'serverFile','serverSha256','sourceDirectory','executionSourceDirectory','sourceSha256','selectionSha256','startedAt'];
  if(announcement!==undefined)
    need(publicKeys.every(key=>same(announcement?.[key],record[key]))&&!Object.hasOwn(announcement,'token'),
      'SUPERSET_LAUNCH_ANNOUNCEMENT_CHANGED','The original startup announcement changed.');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=60000,
    'SUPERSET_LAUNCH_TIMEOUT','Choose a launch timeout between 100 and 60000 milliseconds.');
  const response=await fetch(new URL('/api/launch',url),{headers:{authorization:'Bearer '+record.token},
    redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  const active=await responseJSON(response);
  need(active&&publicKeys.every(key=>same(active[key],record[key]))&&!Object.hasOwn(active,'token')&&
    typeof active.projectKey==='string'&&active.projectKey.length>0&&typeof active.workspaceId==='string'&&ID.test(active.workspaceId),
    'SUPERSET_LAUNCH_INSTANCE_CHANGED','The authenticated original operator no longer matches this launch record.');
  const after=await readPrivateRecord(file);
  need(after.instanceId===record.instanceId&&after.state==='running'&&after.token===record.token,
    'SUPERSET_LAUNCH_INSTANCE_CHANGED','The original operator restarted during connection.');
  return {url:record.url,token:record.token,launch:active,
    scope:{operatorId:active.operatorId,instanceId:active.instanceId,projectKey:active.projectKey,workspaceId:active.workspaceId}};
}
