#!/usr/bin/env node
// MIT. Typed Buyer agent CLI over the original application and retained files.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BuyerRunbookAgent} from './agent-client.mjs';
import {BUYER_AGENT_ACTIONS,BUYER_AGENT_PREFIX,buyerRunbookWorkspaceTools,need,fail,plain} from './agent-contract.mjs';
import {readPrivate,parse} from './agent-connection.mjs';
const HELP='Buyer runbook agent\n\n'+
 'node buyer-runbook/agent-cli.mjs --config PRIVATE_CONNECTIONS.json workspaces\n'+
 'node buyer-runbook/agent-cli.mjs --config PRIVATE_CONNECTIONS.json call ACTION --input PRIVATE_REQUEST.json\n'+
 'node buyer-runbook/agent-cli.mjs --config PRIVATE_CONNECTIONS.json call ACTION --input -\n'+
 'node buyer-runbook/agent-cli.mjs --config PRIVATE_CONNECTIONS.json download --workspace ALIAS --export ID --directory ABS [--expected-manifest SHA256]\n'+
 'node buyer-runbook/agent-cli.mjs tools\n\n'+
 'Requests use the original declared workspace alias and saved requestId. Reuse that UUID after interruption.\n'+
 'The existing browser panel records each original operator decision. The agent reads its selected review.\n'+
 'Downloads retain complete original bytes and resume in the same output directory.\n';
function argumentsFor(argv){
 const options={},positionals=[];
 for(let i=0;i<argv.length;i++){
  const token=argv[i];
  if(token==='--help'||token==='-h')return {help:true};
  if(token.startsWith('--')){
   need(['--config','--input','--workspace','--export','--directory','--expected-manifest'].includes(token)&&!Object.hasOwn(options,token),
    'INVALID_PARAMS','Use one documented Buyer agent option.');
   need(i+1<argv.length&&!argv[i+1].startsWith('--'),'INVALID_PARAMS','Supply a value for '+token+'.');
   options[token]=argv[++i];
  }else positionals.push(token);
 }
 return {options,positionals};
}
async function requestInput(filename){
 need(typeof filename==='string','INVALID_PARAMS','Select a complete original JSON request file or standard input.');
 if(filename!=='-')return parse(await readPrivate(resolve(filename),24*1024*1024),'INVALID_PARAMS');
 const chunks=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;need(size<=24*1024*1024,'INVALID_PARAMS','The complete request exceeds the native limit.');chunks.push(chunk);}
 return parse(Buffer.concat(chunks,size),'INVALID_PARAMS');
}
function catalog(){
 const tool=(name,description,properties,required,annotations)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations});
 return {schema:'stellar-forge.buyer-runbook.agent-tools.v1',tools:buyerRunbookWorkspaceTools(tool)};
}
export async function buyerAgentCLI(argv=process.argv.slice(2),{write=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')}={}){
 const parsed=argumentsFor(argv);if(parsed.help){process.stdout.write(HELP);return;}
 const {options,positionals}=parsed,[command,name]=positionals;
 if(command==='tools'){need(positionals.length===1&&Object.keys(options).length===0,'INVALID_PARAMS','The tool catalog takes no connection options.');const value=catalog();write(value);return value;}
 need(options['--config']&&['workspaces','call','download'].includes(command),'INVALID_PARAMS',HELP);
 const agent=await BuyerRunbookAgent.fromFile(resolve(options['--config']));
 const controller=new AbortController(),stop=()=>controller.abort();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  let result;
  if(command==='workspaces'){
   need(positionals.length===1&&Object.keys(options).every(k=>k==='--config'),'INVALID_PARAMS','The workspace listing takes only --config.');
   result=await agent.call('workspaces',{},{signal:controller.signal});
  }else if(command==='call'){
   need(positionals.length===2&&Object.keys(options).every(k=>['--config','--input'].includes(k)),'INVALID_PARAMS','Call one original action with one complete input.');
   const action=name.startsWith(BUYER_AGENT_PREFIX)?name.slice(BUYER_AGENT_PREFIX.length):name;
   need(Object.hasOwn(BUYER_AGENT_ACTIONS,action),'TOOL_NOT_FOUND','Select an action from the original tool catalog.');
   result=await agent.call(action,await requestInput(options['--input']),{signal:controller.signal});
  }else{
   need(positionals.length===1&&options['--workspace']&&options['--export']&&options['--directory']&&
    Object.keys(options).every(k=>['--config','--workspace','--export','--directory','--expected-manifest'].includes(k)),
    'INVALID_PARAMS','Select the original workspace, export and complete output directory.');
   result=await agent.download({workspace:options['--workspace'],exportId:options['--export'],directory:resolve(options['--directory']),
    expectedManifestSha256:options['--expected-manifest'],signal:controller.signal});
  }
  write(result);return result;
 }finally{
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await agent.close();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 buyerAgentCLI().catch(error=>{
  const code=/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'BUYER_AGENT_OPERATION_FAILED';
  process.stderr.write(JSON.stringify({code,message:error?.buyerAgentPublic?error.message:'Read the original retained operation and current connection.',
   ...(typeof error.outcomeUnknown==='boolean'?{outcomeUnknown:error.outcomeUnknown}:{}),...(error.requestId?{requestId:error.requestId}:{})})+'\n');
  process.exitCode=code==='INVALID_PARAMS'||code==='TOOL_NOT_FOUND'?2:3;
 });
}
