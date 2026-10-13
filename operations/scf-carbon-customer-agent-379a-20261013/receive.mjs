// MIT. Receive and operate the complete original Carbon/GiveCredit application.
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';

const SOURCE_BYTES=3061175,SOURCE_SHA='8928b344805fa0fb74b54f0fb5c48fe9105efd4534c0945187ad9a4e98484a9b';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out'||!isAbsolute(args[1])){
  throw new Error('Use node receive.mjs --out ABSOLUTE_NEW_PRIVATE_OUTPUT; its parent must exist.');
}
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Use an existing Node22 or later runtime.');
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(args[1]);
const envelope=JSON.parse(await readFile(join(here,'complete-source.json'),'utf8'));
if(envelope.bytes!==SOURCE_BYTES||envelope.sha256!==SOURCE_SHA||envelope.encoding!=='gzip+base64')throw new Error('Complete original source identity differs.');
const raw=gunzipSync(Buffer.from(envelope.content_base64,'base64'),{maxOutputLength:SOURCE_BYTES});
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
if(raw.length!==SOURCE_BYTES||digest(raw)!==SOURCE_SHA)throw new Error('Complete original source bytes differ.');
const packet=JSON.parse(raw.toString('utf8'));
const expected=new Map(packet.manifest.filesByPath.map(row=>[row.path,row]));
const selected=new Map();
let bytes=0;
for(const file of packet.files){
  if(typeof file.path!=='string'||file.path.startsWith('/')||file.path.includes('\\')||file.path.includes('\0')||file.path.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':'))||selected.has(file.path))throw new Error('Original source paths must be distinct relative paths.');
  const original=expected.get(file.path),body=Buffer.from(file.content,'utf8');
  const blob=digest(Buffer.concat([Buffer.from('blob '+body.length+'\0'),body]),'sha1');
  if(!original||body.length!==file.bytes||digest(body)!==file.sha256||blob!==file.gitBlobSha1||original.bytes!==file.bytes||original.sha256!==file.sha256||original.gitBlobSha1!==file.gitBlobSha1)throw new Error('Original source member differs: '+file.path);
  selected.set(file.path,body);bytes+=body.length;
}
if(selected.size!==181||selected.size!==packet.manifest.files||expected.size!==selected.size||bytes!==2906769||bytes!==packet.manifest.bytes)throw new Error('Complete181-file original selection differs.');
await mkdir(root,{mode:0o700});
const source=join(root,'source'),statusFile=join(root,'operation.json');
const state={schema:'commons.carbon-customer-agent-operation.v1',operation:packet.operation,status:'receiving',startedAt:new Date().toISOString(),node:process.version,sourceCommit:packet.sourceCommit,sourceBank:{bytes:SOURCE_BYTES,sha256:SOURCE_SHA},sourceFiles:selected.size,sourceBytes:bytes,original166:packet.original166};
const save=()=>writeFile(statusFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const report=value=>process.stdout.write(JSON.stringify(value)+'\n');
let child=null,completion=null,childSettled=false,log=null,timeout=null,killTimer=null,interruption=null;
function stop(reason){
  if(!interruption)interruption=reason;
  if(child&&child.exitCode===null&&child.signalCode===null){
    child.kill('SIGTERM');
    if(!killTimer)killTimer=setTimeout(()=>{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},15000);
  }
}
const interrupt=signal=>stop(signal);
const onInt=()=>interrupt('SIGINT'),onTerm=()=>interrupt('SIGTERM');
process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
try{
  // Retain the whole source carrier first, including any interrupted materialization.
  await writeFile(join(root,'complete-source.json'),JSON.stringify(envelope)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(root,'source-manifest.json'),JSON.stringify(packet.manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(root,'ORIGINAL_RECEIVING.md'),packet.guide,{flag:'wx',mode:0o600});
  await writeFile(join(root,'README.md'),await readFile(join(here,'README.md')),{flag:'wx',mode:0o600});
  await writeFile(join(root,'run-original-customer-agent.mjs'),packet.nodeLauncher,{flag:'wx',mode:0o600});
  await save();await mkdir(source,{mode:0o700});
  for(const [path,body] of selected){
    const target=join(source,...path.split('/'));await mkdir(dirname(target),{recursive:true,mode:0o700});
    await writeFile(target,body,{flag:'wx',mode:0o600});
  }
  if(interruption)throw new Error('Interrupted before original programme: '+interruption);
  state.status='operating';await save();
  log=await open(join(root,'original-operation.log'),'wx',0o600);
  child=spawn(process.execPath,[join(root,'run-original-customer-agent.mjs'),source,join(root,'operated')],{stdio:['ignore',log.fd,log.fd],windowsHide:true});
  // Install listeners before any await: even an immediate spawn failure is retained.
  completion=new Promise(resolveRun=>{
    child.once('error',error=>{childSettled=true;resolveRun({spawnError:{name:error.name,message:error.message}});});
    child.once('exit',(code,signal)=>{childSettled=true;resolveRun({code,signal});});
  });
  state.pid=child.pid??null;await save();
  report({stage:'original_customer_agent_started',operation:packet.operation,pid:state.pid,root,node:process.version});
  timeout=setTimeout(()=>stop('Original operation exceeded900seconds'),900000);
  const result=await completion;
  clearTimeout(timeout);clearTimeout(killTimer);state.child=result;
  if(interruption||result.spawnError||result.code!==0)throw new Error(interruption||result.spawnError?.message||'Original programme exited '+String(result.code)+' '+String(result.signal||''));
  state.result=JSON.parse(await readFile(join(root,'operated','completed-operation.json'),'utf8'));
  if(state.result.result?.phase!=='complete')throw new Error('Original completed-operation result is not complete.');
  state.status='complete';
}catch(error){
  state.status='interrupted';state.error={name:error.name,message:error.message,stack:error.stack};
  process.exitCode=1;
}finally{
  clearTimeout(timeout);clearTimeout(killTimer);
  process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);
  if(child&&completion&&!childSettled){
    child.kill('SIGTERM');
    const forced=setTimeout(()=>{if(!childSettled)child.kill('SIGKILL');},15000);
    await completion;
    clearTimeout(forced);
  }
  await log?.close();
  state.closedAt=new Date().toISOString();
  await save();
  report({stage:'original_customer_agent_closed',operation:packet.operation,status:state.status,root,result:state.result?.result,error:state.error});
}
