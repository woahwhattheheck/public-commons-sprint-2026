#!/usr/bin/env node
// MIT. Remote commands over the original Matomo MCP owner and customer receiver.
import {constants} from 'node:fs';
import {open,mkdir,realpath,link,unlink,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {connectMatomoClient,MATOMO_CLIENT_TOOLS} from './client.mjs';
import {inspectMatomoArtifact,downloadMatomoArtifact,reopenMatomoArtifact} from './remote-download.mjs';
import {run as runOriginalCustomer} from './customer-cli.mjs';
import {numericIdentity} from './values.mjs';
import {privateSupportDirectory} from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';

const REQUEST='stellar-forge.matomo-remote-command.v1';
const MUTATIONS=new Set(MATOMO_CLIENT_TOOLS.filter(value=>value.inputSchema.required.includes('operationId')&&
  value.inputSchema.required.includes('expectedRevision')).map(value=>value.name));
const TOOLS=new Map(MATOMO_CLIENT_TOOLS.map(value=>[value.name,value]));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const MAX_JSON=3*1024*1024;
const options={
  url:{type:'string'},'token-env':{type:'string'},arguments:{type:'string'},output:{type:'string'},
  'operation-dir':{type:'string'},'timeout-ms':{type:'string'},workspace:{type:'string'},artifact:{type:'string'},
  id:{type:'string'},kind:{type:'string'},sha256:{type:'string'},selection:{type:'string'},out:{type:'string'},
  directory:{type:'string'},'chunk-size':{type:'string'},python:{type:'string'},node:{type:'string'},
  help:{type:'boolean',short:'h'}
};
const help=String.raw`Matomo remote customer

  starforge matomo-remote tools [EXACT_TOOL]
  starforge matomo-remote call EXACT_TOOL --url MCP_URL --arguments REQUEST.json
      [--operation-dir PRIVATE_COMMAND_DIRECTORY] [--output RESULT.json]
  starforge matomo-remote reconcile --url MCP_URL --operation-dir PRIVATE_COMMAND_DIRECTORY
  starforge matomo-remote inspect-artifact --url MCP_URL --workspace ALIAS
      --artifact handover --id HANDOVER_ID --kind archive --out SELECTION.json
  starforge matomo-remote download --url MCP_URL --selection SELECTION.json --out PRIVATE_TRANSFER_DIRECTORY
  starforge matomo-remote reopen --directory PRIVATE_TRANSFER_DIRECTORY
  starforge matomo-remote receive --directory PRIVATE_TRANSFER_DIRECTORY --out PRIVATE_RECEIVING_DIRECTORY
  starforge matomo-remote rows --out PRIVATE_RECEIVING_DIRECTORY
  starforge matomo-remote reopen-customer --out PRIVATE_RECEIVING_DIRECTORY

Connection: --token-env NAME selects an existing token environment variable
(default MCP_ACCESS_TOKEN); --timeout-ms is 1..3600000 (default 120000).
No token is accepted as a command-line value or retained in a command record.
Only the operator-selected HTTPS MCP endpoint or original loopback HTTP listener
is used. Open the configured Matomo alias explicitly with merchant_matomo_open.

All 29 revision-bound mutations require --operation-dir. The exact argument bytes,
original workspace UUID/source identity, operation ID and request are retained
before dispatch. A repeated completed command reads its saved response locally.
A dispatch marker without a saved response triggers original operation inspection,
never a repeated mutation. reconcile can use a new listener URL after restart;
it requires the same original workspace UUID/source identity. Review the native
action before preparing an explicit native resume command with its own arguments.

inspect-artifact creates a client selection for one existing original artifact.
download resumes the same verified bytes with the maintained native file writer.
reopen verifies locally. receive accepts only a completed handover archive and
delegates full SF100/source/evidence verification to original matomo-customer.
Use --python/--node with receive, rows or reopen-customer to select existing
interpreters. No dependency installation, source capture, package export or
payment is implicit in artifact transfer or receiving.

--arguments must name a retained UTF-8 JSON file; exact original bytes are bound.
Output file parents must already be private directories (0700). Files are
create-only; identical retained output is reused, never replaced.
--chunk-size for download is 1..196608. --sha256 optionally pins an inspected
artifact's expected native SHA-256. Signal cancellation closes this client and
its known retained reads; inspect the original operation after an interrupted call.
`;

function fail(code,message,details){throw Object.assign(new Error(message),{code,...details});}
function requireOption(values,key){
  const value=values[key];
  if(typeof value!=='string'||!value.length||/[\x00-\x1f\x7f]/.test(value))
    fail('MATOMO_REMOTE_OPTION_REQUIRED','Supply --'+key+'.');
  return value;
}
function integer(value,fallback,maximum,name){
  if(value===undefined)return fallback;
  if(!/^[1-9][0-9]*$/.test(value))fail('MATOMO_REMOTE_INTEGER','Use a positive integer for --'+name+'.');
  const result=Number(value);
  if(!Number.isSafeInteger(result)||result>maximum)fail('MATOMO_REMOTE_INTEGER','--'+name+' exceeds its native limit.');
  return result;
}
async function readBytes(filename,maximum=MAX_JSON,{missing=false}={}){
  let handle;
  try{handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.size>maximum)fail('MATOMO_REMOTE_FILE_INVALID','Use a regular bounded original JSON file.');
    const chunks=[];let count=0;
    for(;;){
      const block=Buffer.alloc(Math.min(65536,maximum-count+1));
      const {bytesRead}=await handle.read(block,0,block.length,null);
      if(!bytesRead)break;
      count+=bytesRead;if(count>maximum)fail('MATOMO_REMOTE_FILE_TOO_LARGE','The selected JSON exceeds its native bound.');
      chunks.push(block.subarray(0,bytesRead));
    }
    const after=await handle.stat();
    if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)
      fail('MATOMO_REMOTE_FILE_CHANGED','The selected input changed while being read.');
    return Buffer.concat(chunks,count);
  }finally{await handle.close();}
}
function json(raw){
  try{
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw),(_key,value,context)=>{
      if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)||
        typeof context?.source!=='string'||numericIdentity(context.source)!==numericIdentity(String(value))))
        fail('MATOMO_REMOTE_NUMBER_INVALID','Use exact decimal strings in declared native fields and safe integer revisions/counts.');
      return value;
    });
  }catch(error){if(error.code)throw error;fail('MATOMO_REMOTE_JSON_INVALID','Use complete UTF-8 JSON with its original native field values.');}
}
async function closeClient(client,primary){
  try{await client.close();}
  catch(error){if(primary)primary.cleanup={code:error.code??'MATOMO_CLIENT_CLOSE_INCOMPLETE'};else throw error;}
}
async function privateParent(filename){
  const parent=dirname(filename);
  await privateSupportDirectory(parent);
  if(await realpath(parent)!==parent)fail('MATOMO_REMOTE_PRIVATE_PATH','Choose a canonical private output directory without symlink components.');
}
async function retain(filename,raw){
  filename=resolve(filename);await privateParent(filename);
  const temporary=join(dirname(filename),'.matomo-'+randomUUID()+'.tmp');
  let handle,owned=false;
  try{
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=true;
    await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;
    try{await link(temporary,filename);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const existing=await readBytes(filename,Math.max(raw.length,1));
      if(!existing.equals(raw))fail('MATOMO_REMOTE_OUTPUT_CONFLICT','The retained output has different original bytes; select a new output path.');
    }
    const parent=await open(dirname(filename),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await parent.sync();}finally{await parent.close();}
  }finally{if(handle)await handle.close();if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function emit(value,filename){
  const raw=encode(value);
  if(filename){await retain(filename,raw);process.stdout.write(JSON.stringify({output:resolve(filename),bytes:raw.length,sha256:sha(raw)})+'\n');}
  else process.stdout.write(raw);
}
async function commandDirectory(directory,operation){
  const root=resolve(directory);
  try{await mkdir(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateSupportDirectory(root);
  if(await realpath(root)!==root)fail('MATOMO_REMOTE_PRIVATE_PATH','Choose the real private command directory without symlink components.');
  const permitted=new Set(['lease.lock','arguments.json','request.json','dispatch.json','result.json']);
  const names=await readdir(root);
  if(names.some(name=>!permitted.has(name)&&!/^inspection-[0-9]+-[a-f0-9-]{36}\.json$/.test(name)&&
    !/^\.matomo-[a-f0-9-]{36}\.tmp$/.test(name)))
    fail('MATOMO_REMOTE_DIRECTORY_IN_USE','Choose an empty private directory or this original command directory.');
  const lease=await acquireStateLease(root);
  try{lease.assertHeld();const result=await operation(root,lease);lease.assertHeld();return result;}finally{await lease.close();}
}
function validateRecord(record){
  if(record?.schema!==REQUEST||!TOOLS.has(record.tool)||!MUTATIONS.has(record.tool)||!record.arguments||
    typeof record.arguments.operationId!=='string'||typeof record.arguments.workspace!=='string'||
    typeof record.workspaceId!=='string'||typeof record.workspaceIdentity!=='string')
    fail('MATOMO_REMOTE_RECORD_INVALID','Use this command’s complete original mutation record.');
  const {requestSha256,...payload}=record;
  if(!/^[a-f0-9]{64}$/.test(requestSha256??'')||sha(encode(payload))!==requestSha256)
    fail('MATOMO_REMOTE_RECORD_INVALID','The retained original request digest differs.');
  return record;
}
async function sameWorkspace(client,record,signal){
  const state=await client.status(record.arguments.workspace,{signal});
  if(state.native?.workspaceId!==record.workspaceId||state.workspaceIdentity!==record.workspaceIdentity)
    fail('MATOMO_REMOTE_WORKSPACE_CHANGED','The selected alias is not this command’s original UUID/source identity.');
  return state;
}
async function inspectCommand(client,root,record,signal){
  await sameWorkspace(client,record,signal);
  let action=null,error=null;
  try{action=await client.operation(record.arguments.workspace,record.arguments.operationId,{signal});}
  catch(issue){error={code:issue.code??'MATOMO_REMOTE_INSPECTION_FAILED',message:issue.message};}
  const inspection={schema:'stellar-forge.matomo-remote-command-inspection.v1',requestSha256:record.requestSha256,
    operationId:record.arguments.operationId,workspace:record.arguments.workspace,inspectedAt:new Date().toISOString(),
    state:'RECONCILIATION_REQUIRED',action,error,
    next:'Review the original native action. Choose an explicit native recovery command; this inspection sends no mutation.'};
  await retain(join(root,'inspection-'+Date.now()+'-'+randomUUID()+'.json'),encode(inspection));
  process.exitCode=3;return inspection;
}
async function mutate(name,args,argumentBytes,values,connect,signal){
  return commandDirectory(requireOption(values,'operation-dir'),async (root,lease)=>{
    let recordRaw=await readBytes(join(root,'request.json'),MAX_JSON,{missing:true}),record;
    if(recordRaw){
      record=validateRecord(json(recordRaw));
      const retainedArguments=await readBytes(join(root,'arguments.json'),131072);
      if(!retainedArguments.equals(argumentBytes)||record.argumentsSha256!==sha(argumentBytes)||
        record.tool!==name||JSON.stringify(record.arguments)!==JSON.stringify(args))
        fail('MATOMO_REMOTE_REQUEST_CONFLICT','This directory belongs to different immutable arguments or a different original operation.');
      const saved=await readBytes(join(root,'result.json'),MAX_JSON,{missing:true});
      if(saved){const value=json(saved);if(value.requestSha256!==record.requestSha256)
        fail('MATOMO_REMOTE_RECORD_INVALID','The completed response belongs to another request.');return {...value,reopened:true};}
    }
    const client=await connect();let primary;
    try{
      if(record){await sameWorkspace(client,record,signal);}
      else{
        const state=await client.status(args.workspace,{signal});
        if(state.instanceId!==args.workspaceInstanceId||typeof state.native?.workspaceId!=='string'||
          typeof state.workspaceIdentity!=='string')
          fail('MATOMO_REMOTE_INSTANCE_CONFLICT','Use the current original workspace instance and inspect its source identity.');
        const payload={schema:REQUEST,tool:name,arguments:args,argumentsSha256:sha(argumentBytes),
          endpoint:client.endpoint,workspaceId:state.native.workspaceId,workspaceIdentity:state.workspaceIdentity};
        record={...payload,requestSha256:sha(encode(payload))};
        await retain(join(root,'arguments.json'),argumentBytes);
        await retain(join(root,'request.json'),encode(record));
      }
      const dispatch=await readBytes(join(root,'dispatch.json'),MAX_JSON,{missing:true});
      if(dispatch)return await inspectCommand(client,root,record,signal);
      signal.throwIfAborted();lease.assertHeld();
      await retain(join(root,'dispatch.json'),encode({schema:'stellar-forge.matomo-remote-dispatch.v1',
        requestSha256:record.requestSha256,preparedAt:new Date().toISOString(),
        meaning:'CLIENT_DISPATCH_MARKER; original host action remains authoritative'}));
      try{
        lease.assertHeld();
        const result=await client.call(name,args,{signal});
        const saved={schema:'stellar-forge.matomo-remote-command-result.v1',state:'NATIVE_RESPONSE_RETAINED',
          requestSha256:record.requestSha256,operationId:args.operationId,result};
        lease.assertHeld();await retain(join(root,'result.json'),encode(saved));return saved;
      }catch(error){
        // A timeout, crash or failed result write never authorizes another mutation.
        error.matomoOperation??={tool:name,workspace:args.workspace,operationId:args.operationId,
          expectedRevision:args.expectedRevision,workspaceInstanceId:args.workspaceInstanceId};
        error.reconcile={command:'matomo-remote reconcile',operationDirectory:root};
        throw error;
      }
    }catch(error){primary=error;throw error;}finally{await closeClient(client,primary);}
  });
}

export async function run(argv=process.argv.slice(2)){
  const parsed=parseArgs({args:argv,options,allowPositionals:true,strict:true,tokens:true});
  const {values,positionals,tokens}=parsed,seen=new Set();
  for(const item of tokens)if(item.kind==='option'){
    if(seen.has(item.name))fail('MATOMO_REMOTE_REPEATED_OPTION','Supply an option only once: --'+item.name);
    seen.add(item.name);
  }
  if(values.help||!positionals.length){process.stdout.write(help);return {exitCode:0};}
  const [command,name]=positionals;
  const connection=['url','token-env','timeout-ms'],definitions={
    tools:['output'],call:[...connection,'arguments','operation-dir','output'],
    reconcile:[...connection,'operation-dir','output'],
    'inspect-artifact':[...connection,'workspace','artifact','id','kind','sha256','out'],
    download:[...connection,'selection','out','chunk-size','output'],
    reopen:['directory','output'],receive:['directory','out','python','node'],
    rows:['out','python','node'],'reopen-customer':['out','python','node']
  };
  if(!Object.hasOwn(definitions,command)||positionals.length>(['tools','call'].includes(command)?2:1))
    fail('MATOMO_REMOTE_COMMAND_REQUIRED','Choose a documented original remote customer command.');
  for(const key of Object.keys(values))if(!definitions[command].includes(key)&&key!=='help')
    fail('MATOMO_REMOTE_UNEXPECTED_OPTION','--'+key+' is not used by '+command+'.');
  if(command==='tools'){
    if(name&&!TOOLS.has(name))fail('MATOMO_REMOTE_TOOL_REQUIRED','Choose an exact original Matomo tool name.');
    const result=name?TOOLS.get(name):{tools:MATOMO_CLIENT_TOOLS};await emit(result,values.output);return result;
  }
  const controller=new AbortController(),abort=()=>controller.abort();
  process.on('SIGINT',abort);process.on('SIGTERM',abort);
  const signal=controller.signal,timeoutMs=integer(values['timeout-ms'],120000,3600000,'timeout-ms');
  const connect=()=>connectMatomoClient({url:requireOption(values,'url'),tokenEnv:values['token-env']??'MCP_ACCESS_TOKEN',signal,timeoutMs});
  const interpreterArgs=()=>['python','node'].flatMap(key=>values[key]?['--'+key,values[key]]:[]);
  try{
    if(command==='rows'||command==='reopen-customer')
      return await runOriginalCustomer([command==='rows'?'rows':'reopen','--out',requireOption(values,'out'),...interpreterArgs()]);
    if(command==='reopen'||command==='receive'){
      const result=await reopenMatomoArtifact({directory:requireOption(values,'directory'),signal});
      if(command==='reopen'){await emit(result,values.output);return result;}
      if(result.source.artifact!=='handover'||result.source.kind!=='archive')
        fail('MATOMO_REMOTE_HANDOVER_REQUIRED','The original Python receiver requires the selected native handover archive.');
      return await runOriginalCustomer(['receive','--archive',join(result.directory,result.payload),
        '--out',requireOption(values,'out'),...interpreterArgs()]);
    }
    if(command==='call'){
      if(!TOOLS.has(name))fail('MATOMO_REMOTE_TOOL_REQUIRED','Choose an exact tool from matomo-remote tools.');
      const argumentBytes=await readBytes(resolve(requireOption(values,'arguments')),131072),args=json(argumentBytes);
      if(!args||typeof args!=='object'||Array.isArray(args))
        fail('MATOMO_REMOTE_ARGUMENTS','Use one original native JSON argument object.');
      let result;
      if(MUTATIONS.has(name))result=await mutate(name,args,argumentBytes,values,connect,signal);
      else{
        if(values['operation-dir'])fail('MATOMO_REMOTE_UNEXPECTED_OPTION','Revision-bound mutations use --operation-dir; ordinary reads and controls use their original arguments.');
        const client=await connect();try{result=await client.call(name,args,{signal});}finally{await client.close();}
      }
      await emit(result,values.output);return result;
    }
    if(command==='reconcile'){
      const result=await commandDirectory(requireOption(values,'operation-dir'),async root=>{
        const record=validateRecord(json(await readBytes(join(root,'request.json'))));
        const raw=await readBytes(join(root,'arguments.json'),131072);
        if(sha(raw)!==record.argumentsSha256||JSON.stringify(json(raw))!==JSON.stringify(record.arguments))
          fail('MATOMO_REMOTE_RECORD_INVALID','The original arguments differ from their retained command.');
        const saved=await readBytes(join(root,'result.json'),MAX_JSON,{missing:true});
        if(saved){const result=json(saved);if(result.requestSha256!==record.requestSha256)
          fail('MATOMO_REMOTE_RECORD_INVALID','The saved response is bound to another command.');return {...result,reopened:true};}
        const client=await connect();try{return await inspectCommand(client,root,record,signal);}finally{await client.close();}
      });
      await emit(result,values.output);return result;
    }
    const client=await connect();
    try{
      if(command==='inspect-artifact'){
        const selection={workspace:requireOption(values,'workspace'),artifact:requireOption(values,'artifact'),id:requireOption(values,'id'),
          ...(values.kind?{kind:values.kind}:{}),...(values.sha256?{expectedSha256:values.sha256}:{})};
        const result=await inspectMatomoArtifact({client,selection,signal});
        await emit(result,requireOption(values,'out'));return result;
      }
      const inspected=json(await readBytes(resolve(requireOption(values,'selection'))));
      const selection=inspected.selection??inspected;
      const result=await downloadMatomoArtifact({client,selection,directory:requireOption(values,'out'),signal,
        chunkSize:integer(values['chunk-size'],196608,196608,'chunk-size')});
      await emit(result,values.output);return result;
    }finally{await client.close();}
  }finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);if(signal.aborted&&!(process.exitCode>0))process.exitCode=130;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)run().catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'MATOMO_REMOTE_COMMAND_FAILED',message:error.message,
    ...(error.matomoOperation?{operation:error.matomoOperation}:{}),...(error.reconcile?{reconcile:error.reconcile}:{}),
    ...(error.cleanup?{cleanup:error.cleanup}:{})})+'\n');
  process.exitCode=error.code==='MATOMO_PYTHON_UNAVAILABLE'?127:2;
});
