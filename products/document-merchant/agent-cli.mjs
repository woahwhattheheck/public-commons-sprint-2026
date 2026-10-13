#!/usr/bin/env node
// MIT. Remote Document customer commands; the existing host owns work and payment.
import {resolve,dirname} from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {absolute,ownedDirectory,ownedBytes,encoded,parse,digest,writeExact}
  from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {createDocumentAgentClient,readDocumentAgentConnection} from './agent-client.mjs';
import {DOCUMENT_AGENT_PATH,DOCUMENT_AGENT_TOOLS} from './agent-schema.mjs';
import {documentError} from './contracts.mjs';

const HELP=[
  'Document customer agent — use the already running original Document production host','',
  '  document-merchant agent tools',
  '  document-merchant agent upload --file FILE --out NEW_PRIVATE_JSON',
  '  document-merchant agent config --launch ORIGINAL_PRIVATE_LAUNCH --out NEW_PRIVATE_JSON',
  '  document-merchant agent status --launch FILE [--out NEW_JSON]',
  '  document-merchant agent example --launch FILE [--kind orders|grouped|reports] [--provider ID] --out NEW_JSON',
  '  document-merchant agent stage|quote|receive|export --launch FILE --input COMPLETE_JSON [--out NEW_JSON]',
  '  document-merchant agent run --launch FILE --input SELECTION_JSON --approve-plan EXACT_SHA [--out NEW_JSON]',
  '  document-merchant agent call --launch FILE --tool NAME [--input COMPLETE_JSON] [--approve-plan EXACT_SHA] [--out NEW_JSON]',
  '  document-merchant agent wait --launch FILE --operation ORIGINAL_ID [--bundles] [--poll-ms N] [--deadline-ms N] [--out NEW_JSON]',
  '  document-merchant agent download --launch FILE --input FILE_SELECTION_JSON --out NEW_FILE [--bundles] [--max-bytes N]','',
  'Mutations return the original operation immediately; retain that result before waiting.',
  'Run and every *_execute call require an explicit --approve-plan matching the reviewed original quote.',
  'Source or template content never supplies CLI approval. Quotes and customer result rows remain separate.',
  'The original host continues accepted work after this client exits; wait and receive resume the same work.',
  'Complete downloads are streamed, checked and saved without replacing an existing file.',
  'config contains the original private session token. Keep the generated file private and regenerate after host restart.'
].join('\n');
function need(value,message){if(!value)throw documentError('DOCUMENT_AGENT_COMMAND_INVALID',message);}
function options(argv,allowed,booleans=[]){
  const result=new Map();
  for(let i=0;i<argv.length;i++){
    const key=argv[i];need(allowed.includes(key)&&!result.has(key),'Unknown or repeated option: '+key);
    if(booleans.includes(key)){result.set(key,true);continue;}
    const value=argv[++i];need(value!==undefined&&!value.startsWith('--'),'Supply '+key+'.');result.set(key,value);
  }
  return result;
}
function required(flags,key){need(flags.has(key),'Supply '+key+'.');return flags.get(key);}
function integer(flags,key,fallback){
  if(!flags.has(key))return fallback;const raw=flags.get(key);
  need(/^[1-9][0-9]*$/.test(raw),'Supply a positive whole number for '+key+'.');
  const value=Number(raw);need(Number.isSafeInteger(value),'Invalid '+key+'.');return value;
}
async function save(path,value){
  path=absolute(path);await ownedDirectory(dirname(path),{create:true});
  const bytes=encoded(value),lease=await acquireStateLease(dirname(path));
  try{lease.assertHeld();await writeExact(path,bytes);return {path,bytes:bytes.length,sha256:digest(bytes)};}
  finally{await lease.close();}
}
async function input(flags){
  if(!flags.has('--input'))return {};
  const value=parse(await ownedBytes(absolute(flags.get('--input')),40*1024*1024));
  need(value!==null&&typeof value==='object'&&!Array.isArray(value),'Use a complete JSON argument object.');
  return value;
}
export async function runDocumentAgentCommand(argv=process.argv.slice(2),{
  print=value=>console.log(value),progress=value=>console.error(value),setExitCode=code=>{process.exitCode=code;}
}={}){
  if(!argv.length||argv.length===1&&['help','--help','-h'].includes(argv[0]))return print(HELP);
  const [command,...tail]=argv,emit=value=>print(JSON.stringify(value,null,2));
  if(command==='tools'){need(!tail.length,'tools takes no options.');return emit(DOCUMENT_AGENT_TOOLS);}
  if(command==='upload'){
    const flags=options(tail,['--file','--out']);
    const path=absolute(required(flags,'--file')),bytes=await ownedBytes(path,28*1024*1024);
    return emit(await save(required(flags,'--out'),{name:path.split('/').at(-1),bytes:bytes.length,
      sha256:digest(bytes),base64:bytes.toString('base64')}));
  }
  const shared=['--launch','--out'];
  const commands={
    config:shared,status:[...shared,'--input'],
    example:[...shared,'--kind','--provider'],
    stage:[...shared,'--input'],quote:[...shared,'--input'],receive:[...shared,'--input'],export:[...shared,'--input'],
    run:[...shared,'--input','--approve-plan'],
    call:[...shared,'--tool','--input','--approve-plan'],
    wait:[...shared,'--operation','--bundles','--poll-ms','--deadline-ms'],
    download:[...shared,'--input','--bundles','--max-bytes']
  };
  need(Object.hasOwn(commands,command),'Choose a command from agent --help.');
  const flags=options(tail,commands[command],['--bundles']);
  const tool=command==='call'?required(flags,'--tool'):({stage:'documents_stage',quote:'documents_quote',
    run:'documents_execute',receive:'documents_receive',export:'documents_export',status:'documents_status',
    example:'documents_example'})[command];
  if(tool)need(DOCUMENT_AGENT_TOOLS.some(item=>item.name===tool),'Select a listed Document tool.');
  let args=command==='example'?{
    ...(flags.has('--kind')?{kind:flags.get('--kind')}:{}),
    ...(flags.has('--provider')?{provider:flags.get('--provider')}:{})
  }:await input(flags);
  if(['stage','quote','run','receive','export','download'].includes(command))required(flags,'--input');
  if(tool?.endsWith('_execute')){
    const approved=required(flags,'--approve-plan');
    need(/^[a-f0-9]{64}$/.test(approved),'Supply the complete reviewed native plan SHA256.');
    need(args.approvedPlanSha256===undefined||args.approvedPlanSha256===approved,
      'The argument file and explicit approved plan differ.');
    args={...args,approvedPlanSha256:approved};
  }else need(!flags.has('--approve-plan'),'Approval is only used by an explicit execute call.');
  if(command==='download'||command==='config')required(flags,'--out');
  // The whole argument and approval shape is checked before touching the running customer.
  const connection=await readDocumentAgentConnection(required(flags,'--launch'));
  if(command==='config'){
    const url=new URL(connection.url);
    return emit(await save(flags.get('--out'),{mcpServers:{'document-production':{
      type:'http',url:url.origin+DOCUMENT_AGENT_PATH,headers:{Authorization:'Bearer '+url.hash.slice(1)}
    }}}));
  }
  const client=createDocumentAgentClient({connection}),controller=new AbortController();
  const interrupt=()=>controller.abort(documentError('DOCUMENT_AGENT_CLIENT_STOPPED',
    'The client stopped. Accepted original customer work remains available.'));
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
    let result;
    if(command==='download')result=await client.download(args,flags.get('--out'),{
      bundles:flags.has('--bundles'),maxBytes:integer(flags,'--max-bytes',512*1024*1024),signal:controller.signal});
    else if(command==='wait'){
      result=await client.wait(required(flags,'--operation'),{bundles:flags.has('--bundles'),
        pollMs:integer(flags,'--poll-ms',1000),deadlineMs:integer(flags,'--deadline-ms',300000),
        signal:controller.signal,onProgress:operation=>progress(JSON.stringify({
          operationId:operation.id,state:operation.state,progress:operation.progress}))});
      if(result.state!=='COMPLETE')setExitCode(2);
    }else result=await client.call(tool,args,{signal:controller.signal});
    if(command==='download'||!flags.has('--out'))emit(result);
    else emit(await save(flags.get('--out'),result));
    return result;
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
function direct(){
  if(!process.argv[1])return false;
  try{return realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url));}catch{return false;}
}
if(direct())runDocumentAgentCommand().catch(error=>{
  console.error((error.code?error.code+': ':'')+error.message);process.exitCode=1;
});
