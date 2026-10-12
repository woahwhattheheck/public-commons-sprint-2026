#!/usr/bin/env node
// MIT. Staff source-change commands against the same accounting workspace or listener.
import {constants} from 'node:fs';
import {lstat,open,link,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openAccountingWorkspace} from './store.mjs';
import {AccountantWorkspace} from './accountant-workspace.mjs';
import {QboWorkspace} from './qbo-workspace.mjs';
import {XeroWorkspace} from './xero-workspace.mjs';
import {accountingSourceMode} from './buyer-startup.mjs';
import {SourceChangeWorkspace,handleSourceChangeRequest,SOURCE_CHANGE_REQUEST_BYTES} from './source-changes.mjs';
import {SOURCE_CHANGE_SCHEMA,changeCheck as need,changeHash as hash,changeCanonical as canonical} from '../accountant/source-change.mjs';

export const SOURCE_CHANGES_HELP=[
  'Merchant/buyer accounting: retained company chart changes',
  '',
  'starforge accounting-source-changes ACTION',
  'Also: starforge merchant-accounting-workspace source-changes ACTION',
  '  status --url http://127.0.0.1:8446',
  '  sources --url http://127.0.0.1:8446 [--offset 0 --limit 50]',
  '  inspect --url URL --input /private/inspection.json --out /private/inspection-result.json',
  '  prepare --url URL --input /private/review-request.json --out /private/review-result.json',
  '  detail --url URL --change REVIEW_UUID',
  '  apply --url URL --change REVIEW_UUID --input /private/approval.json --out /private/approval-result.json',
  '  resume --url URL --change REVIEW_UUID --input /private/original-request.json',
  '  download --url URL --change REVIEW_UUID --out /private/source-change.json',
  '',
  'Use --workspace /private/original-accounting instead of --url for a stopped',
  'workspace. This opens its original lease and no listener or provider session.',
  'Connections review selection is available through its already configured server;',
  'the stopped-workspace CLI can use original QBO snapshots and retained Xero contexts.',
  'Input is exact UTF-8 JSON up to 32 MiB. Keep its UUID, timestamp, binding and body.',
  'Outputs are private create-only files. A lost response or output-write failure',
  'does not authorize another UUID: inspect/resume the original retained request.',
  'See workspace/SOURCE_CHANGES.md for schemas, native gates and complete backup.',
  ''
].join('\n');
const JSON_BYTES=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const actions={status:[],sources:['--offset','--limit'],inspect:['--input'],prepare:['--input'],
  detail:['--change'],apply:['--change','--input'],resume:['--change','--input'],download:['--change']};
function argumentsFor(argv){
  const [action,...args]=argv;need(Object.hasOwn(actions,action),'SOURCE_CHANGE_ARGUMENTS',SOURCE_CHANGES_HELP);
  const keys=new Set(['--workspace','--url','--out',...actions[action]]),options={};
  for(let i=0;i<args.length;i++){const key=args[i];need(keys.has(key)&&!Object.hasOwn(options,key)&&args[i+1]&&!args[i+1].startsWith('--'),
    'SOURCE_CHANGE_ARGUMENTS',SOURCE_CHANGES_HELP);options[key]=args[++i];}
  need(Boolean(options['--workspace'])!==Boolean(options['--url']),'SOURCE_CHANGE_TARGET',
    'Choose the stopped original workspace or its running loopback URL.');
  return {action,options};
}
const required=(options,key)=>{need(typeof options[key]==='string'&&options[key].trim(),'SOURCE_CHANGE_ARGUMENTS','Provide '+key+'.');return options[key];};
function endpoint(value){
  let url;try{url=new URL(value);}catch{}
  need(url&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password&&
    url.pathname==='/'&&!url.search&&!url.hash,'SOURCE_CHANGE_LOOPBACK','Use the exact original loopback accounting workspace URL.');
  return url;
}
async function input(path){
  const handle=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat();need(before.isFile()&&before.size>0&&before.size<=SOURCE_CHANGE_REQUEST_BYTES,
      'SOURCE_CHANGE_INPUT','Use a regular original JSON request up to 32 MiB.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,
      'SOURCE_CHANGE_INPUT_CHANGED','The original request file changed while being read.',409);
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    need(value&&typeof value==='object'&&!Array.isArray(value),'SOURCE_CHANGE_INPUT','Use an original JSON object.');canonical(value);return value;
  }finally{await handle.close();}
}
async function output(filename,bytes){
  const path=resolve(filename),parent=dirname(path),info=await lstat(parent);
  need(info.isDirectory()&&!info.isSymbolicLink(),'SOURCE_CHANGE_OUTPUT_DIRECTORY','Select an existing private output directory.');
  const stage=resolve(parent,'.source-change-'+randomUUID()),handle=await open(stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    try{await link(stage,path);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const saved=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      try{const stat=await saved.stat();need(stat.isFile()&&stat.size===bytes.length&&hash(await saved.readFile())===hash(bytes),
        'SOURCE_CHANGE_OUTPUT_EXISTS','The output already retains different bytes. Keep it and choose a new result filename.',409);}finally{await saved.close();}
    }
    const directory=await open(parent,'r');try{await directory.sync();}finally{await directory.close();}
    return {path,bytes:bytes.length,sha256:hash(bytes)};
  }finally{await rm(stage,{force:true});}
}
export async function sourceChangesMain(argv,{signal}={}){
  if(!argv.length||argv.includes('--help')||argv[0]==='help'){process.stdout.write(SOURCE_CHANGES_HELP);return;}
  const {action,options}=argumentsFor(argv),controller=signal?null:new AbortController();signal??=controller.signal;
  const stop=()=>controller?.abort();if(controller){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  let workspace,changes,qbo,xero;
  try{
    const url=options['--url']?endpoint(options['--url']):null;
    if(!url){
      const directory=resolve(options['--workspace']),state=await lstat(resolve(directory,'workspace.json'));
      need(state.isFile()&&!state.isSymbolicLink(),'SOURCE_CHANGE_EXISTING_WORKSPACE','Select the existing original accounting workspace.');
      signal.throwIfAborted();workspace=await openAccountingWorkspace({directory});
      const accountant=new AccountantWorkspace(workspace);
      xero=new XeroWorkspace(workspace,accountant);
      if(accountingSourceMode(workspace.state)!=='buyer')qbo=new QboWorkspace(workspace,accountant);
      // Read/replacement operations need no provider startup or interrupted-operation replay.
      changes=new SourceChangeWorkspace(workspace,{qbo,xero});
    }
    const request=async(path,value,{file=false}={})=>{
      signal.throwIfAborted();let result;
      if(changes){
        const parsed=new URL(path,'http://workspace'),answer=await handleSourceChangeRequest(changes,
          {method:value===undefined?'GET':'POST',path:parsed.pathname,query:Object.fromEntries(parsed.searchParams),value});
        if(file&&answer.file)return answer.file;
        result=answer.value;
        if((answer.status??200)>=400)throw Object.assign(new Error(result.message),{code:result.error,status:answer.status,outcome:result});
      }else{
        let response;
        try{response=await fetch(new URL(path,url),{method:value===undefined?'GET':'POST',signal,redirect:'error',cache:'no-store',
          ...(value===undefined?{}:{headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(value)})});}
        catch(error){throw Object.assign(new Error('The original request outcome is unknown. Keep its exact input and inspect the retained review after reconnecting.'),
          {code:'SOURCE_CHANGE_TRANSPORT_UNKNOWN',cause:error});}
        if(file&&response.ok)return {bytes:Buffer.from(await response.arrayBuffer()),type:response.headers.get('content-type')};
        try{result=await response.json();}catch{throw Object.assign(new Error('The original response was not readable JSON. Preserve the request UUID and body.'),
          {code:'SOURCE_CHANGE_RESPONSE_UNKNOWN',status:response.status});}
        need(result?.schema===SOURCE_CHANGE_SCHEMA&&result.binding,'SOURCE_CHANGE_RESPONSE_UNKNOWN','The response is not the original source-change envelope.',409);
        if(value?.binding)need(canonical(result.binding)===canonical(value.binding),'SOURCE_CHANGE_WORKSPACE_CHANGED',
          'The receiving workspace differs from the original input; preserve that request.',409);
        if(!response.ok)throw Object.assign(new Error(result.message??'The original request did not complete.'),
          {code:result.error??'SOURCE_CHANGE_FAILED',status:response.status,outcome:result});
      }
      return result;
    };
    const base='/api/source-changes',change=()=>base+'/'+encodeURIComponent(required(options,'--change'));
    let result,file;
    if(action==='status')result=await request(base);
    else if(action==='sources')result=await request(base+'/sources?'+new URLSearchParams({offset:options['--offset']??'0',limit:options['--limit']??'50'}));
    else if(action==='inspect'||action==='prepare')result=await request(base+'/'+action,await input(required(options,'--input')));
    else if(action==='detail')result=await request(change());
    else if(action==='apply'||action==='resume')result=await request(change()+'/'+action,await input(required(options,'--input')));
    else if(action==='download'){required(options,'--out');file=await request(change()+'/download',undefined,{file:true});}
    const resultBytes=file?.bytes??JSON_BYTES(result),saved=options['--out']?await output(options['--out'],resultBytes):null;
    const reported=saved?{file:saved,...(file?{type:file.type}:{})}:result;
    process.stdout.write(JSON_BYTES(reported));return reported;
  }catch(error){
    if(error.outcome)process.stderr.write(JSON.stringify(error.outcome)+'\n');
    throw error;
  }finally{
    const errors=[];for(const owned of [changes,qbo,xero,workspace])try{await owned?.close();}catch(error){errors.push(error);}
    if(controller){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
    if(errors.length)throw new AggregateError(errors,'The original source-change workspace did not close cleanly.');
  }
}

export const main=sourceChangesMain;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
