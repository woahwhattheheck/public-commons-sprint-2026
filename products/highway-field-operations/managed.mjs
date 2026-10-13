// MIT. Original application command and managed Python lifetime.
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {access,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {inspectBinding,inspectSource,defaultSourceDirectory,verifyAnnouncement} from './binding.mjs';
import {absolute,need,canonical,UUID,realDirectory} from './contract.mjs';
const here=dirname(fileURLToPath(import.meta.url));
function options(argv){
 const values={};for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];need(/^--[a-z][a-z-]*$/.test(key??'')&&typeof value==='string'&&!Object.hasOwn(values,key),'ARGUMENTS');values[key]=value;}return values;
}
async function child(python,args,{input,environment={},onStartup}={}){
 await access(python,constants.X_OK);
 const p=spawn(python,['-B','-u',...args],{cwd:here,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',...environment},stdio:[input===undefined?'inherit':'pipe',onStartup?'pipe':'inherit','inherit']});
 const signal=s=>{if(p.exitCode===null&&!p.killed)p.kill(s);},interrupt=()=>signal('SIGINT'),terminate=()=>signal('SIGTERM');
 process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
 try{
  const exit=new Promise((res,rej)=>{p.once('error',rej);p.once('exit',(code,sig)=>res({code,sig}));});
  let startupError,seen=false;
  const lines=onStartup?(async()=>{try{
   for await(const line of createInterface({input:p.stdout,crlfDelay:Infinity})){
    need(Buffer.byteLength(line)<=65536,'STARTUP_SIZE');
    if(!line.trim())continue;need(!seen,'STARTUP_DUPLICATE');const value=JSON.parse(line);
    need(value.pid===p.pid&&value.process?.namespacePid===p.pid,'CHILD_CHANGED');
    await onStartup(value);seen=true;console.log(canonical(value));
   }
  }catch(error){startupError=error;signal('SIGTERM');}})():Promise.resolve();
  if(input!==undefined){p.stdin.on('error',()=>{});p.stdin.end(input);}
  const r=await exit;await lines;if(startupError)throw startupError;if(onStartup)need(seen,'STARTUP_MISSING');need(r.code===0,'NATIVE_INTERRUPTED','Original Python returned '+String(r.code??r.sig));
 }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
export async function main(argv=process.argv.slice(2)){
 const action=argv.shift();
 if(action==='--help'||!action){console.log('highway-field-operations create|binding|serve|state|history|command|import-capture|export|inspect|receive. Keep original UUIDs, revisions and complete source files. See products/highway-field-operations/OPERATING.md.');return;}
 const value=options(argv),allowedNative=['create','state','history','command','import-capture','export','inspect','receive'];
 if(action==='binding'||action==='serve'){
  const allowed=new Set(['--workspace','--python','--node','--paired-workspace','--paired-workspace-id','--source-directory','--connection-file','--receiving-directory','--port','--expected-binding-sha256','--application-request-id']);
  need(Object.keys(value).every(k=>allowed.has(k)),'ARGUMENTS');
  const selected=await inspectBinding({workspaceDirectory:absolute(value['--workspace']),sourceDirectory:value['--source-directory']??defaultSourceDirectory,pythonExecutable:value['--python']??'/usr/bin/python3',nodeExecutable:value['--node']??process.execPath,pairedWorkspaceDirectory:value['--paired-workspace'],pairedWorkspaceId:value['--paired-workspace-id'],connectionFile:value['--connection-file'],receivingDirectory:value['--receiving-directory']});
  if(action==='binding'){console.log(canonical(selected));return selected;}
  need(value['--expected-binding-sha256']===selected.bindingSha256,'BINDING_CHANGED','Review the complete actual binding before Start.');
  const requestId=value['--application-request-id'];need(UUID.test(requestId??''),'REQUEST','Supply the retained original managed request UUID.');
  const port=Number(value['--port']??0);need(/^(0|[1-9][0-9]*)$/.test(value['--port']??'0')&&Number.isSafeInteger(port)&&port<=65535,'PORT');
  await child(selected.binding.python.executable,[join(here,'managed-host.py')],{input:canonical({...selected,applicationRequestId:requestId,port}),onStartup:value=>verifyAnnouncement(selected.binding.connectionFile,value,{applicationRequestId:requestId,bindingSha256:selected.bindingSha256,workspaceId:selected.binding.workspaceId,workspaceDirectory:selected.binding.workspaceDirectory})});return;
 }
 need(allowedNative.includes(action),'COMMAND');
 const source=value['--source-directory']??defaultSourceDirectory;await inspectSource(source);
 const python=absolute(value['--python']??'/usr/bin/python3');delete value['--python'];delete value['--source-directory'];
 if(action==='create'){
  need(value['--workspace']&&value['--id']&&value['--title']&&value['--at'],'CREATE','Retain workspace UUID, title and explicit original creation time.');
  await realDirectory(dirname(absolute(value['--workspace'])),{privateOnly:true});
 }
 const args=['--source-root',source,action==='create'?'init':action,...Object.entries(value).flatMap(([k,v])=>[k,v])];
 await child(python,['-c',"import sys; assert sys.version_info >= (3,11), 'Python 3.11 or later is required'; sys.path.insert(0,sys.argv[1]); from highway.cli import main; from highway.common import canonical; print(canonical(main(sys.argv[2:])).decode())",source,...args]);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===await realpath(process.argv[1]).catch(()=>process.argv[1]))main().catch(error=>{console.error(JSON.stringify({error:{code:error.code??'HIGHWAY_FIELD',message:error.message}}));process.exitCode=1;});
