#!/usr/bin/env node
// MIT. Installed operator entry for the original accounting customer statement workflow.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {CustomerStatementWorkspace,MAX_USAGE_BYTES,STATEMENT_REQUEST_BYTES} from './store.mjs';
import {startCustomerStatementWorkspace} from './server.mjs';
import {json,sha,need} from './core.mjs';

export const CUSTOMER_STATEMENTS_HELP=[
  'Customer purchase statements over the original merchant accounting workspace.',
  '',
  'node customer-statements/cli.mjs <command> --workspace /absolute/workspace [options]',
  '',
  'serve              Local operator desk; optional --port 8447.',
  'state              Current revision, customers, completed runs and document register.',
  'customer-save      --input customer.json (revision, actor, reference, name; id/expectedVersion for edits).',
  'orders-assign      --input assignments.json (revision, actor, customerId, orders:[{orderRef,label}]).',
  'bindings           Optional --customer UUID --offset 0 --limit 100.',
  'usage-import       --file original-usage.json --revision N --actor NAME [--name LABEL].',
  'preview            --input selection.json (customerId, runId; optional usageId, from/until, replacesId).',
  'retain             --input retention.json (selection + revision, actor, requestId, previewSha256).',
  'statements         Optional --customer UUID --status RETAINED --offset 0 --limit 100.',
  'show               --id UUID.',
  'export             --id UUID --file statement.json|statement.csv|usage.csv|statement.html|manifest.json|status.json',
  '                   --output /absolute/new-file (or - for stdout).',
  'withdraw           --id UUID --input withdrawal.json (revision, actor, reason).',
  '',
  'Creation of a new original accounting workspace additionally needs:',
  '  --outbox-dir /absolute/sf98-outbox --proof-dir /absolute/sf86-proofs --terms-file /absolute/terms.json',
  'Existing workspaces reopen from their saved original source paths.',
  '--input - reads one JSON object from stdin. Every write uses the original workspace revision and lease.',
  'The operator desk is local. Retained downloads are prepared for the merchant to deliver.'
].join('\n')+'\n';
function argumentsOf(argv){
  const [command='help',...rest]=argv,values={};
  const allowed=new Set(['workspace','port','host','outbox-dir','proof-dir','terms-file','input','file','output','id','customer','status','offset','limit','revision','actor','name']);
  for(let i=0;i<rest.length;i+=2){
    need(rest[i].startsWith('--')&&allowed.has(rest[i].slice(2))&&rest[i+1]!==undefined&&!rest[i+1].startsWith('--'),
      'INVALID_ARGUMENT','Use declared --name value options; run help for the operation shape.');
    const key=rest[i].slice(2);need(!Object.hasOwn(values,key),'DUPLICATE_ARGUMENT','Each option may be supplied once.');values[key]=rest[i+1];
  }
  return {command,values};
}
async function readInputFile(path,max){
  const handle=await open(resolve(path),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const info=await handle.stat();need(info.isFile()&&info.size>0&&info.size<=max,'INPUT_SIZE','Choose a nonempty input within the supported file size.');return await handle.readFile();}
  finally{await handle.close();}
}
async function input(value){
  need(typeof value==='string'&&value.length>0,'INPUT_REQUIRED','Supply --input with one JSON request file.');
  let bytes;
  if(value==='-'){
    const chunks=[];let count=0;
    for await(const chunk of process.stdin){count+=chunk.length;need(count<=STATEMENT_REQUEST_BYTES,'INPUT_SIZE','The JSON request exceeds the supported size.');chunks.push(chunk);}
    bytes=Buffer.concat(chunks);
  }else bytes=await readInputFile(value,STATEMENT_REQUEST_BYTES);
  let result;try{result=JSON.parse(bytes.toString('utf8'));}catch{need(false,'INVALID_JSON','The request file is not valid JSON.');}
  need(result&&typeof result==='object'&&!Array.isArray(result),'INVALID_REQUEST','Use one JSON request object.');return result;
}
async function saveExport(path,bytes){
  const output=resolve(path);let handle;
  try{handle=await open(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const existing=await readInputFile(output,128_000_000);
    need(sha(existing)===sha(bytes),'OUTPUT_EXISTS','Choose a new output filename; this file already contains different bytes.',409);
    return {path:output,sha256:sha(bytes),bytes:bytes.length,reused:true};
  }
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  const directory=await open(dirname(output),constants.O_RDONLY|(constants.O_DIRECTORY??0));
  try{await directory.sync();}finally{await directory.close();}
  return {path:output,sha256:sha(bytes),bytes:bytes.length,reused:false};
}
export async function customerStatementsMain(argv=process.argv.slice(2)){
  const {command,values}=argumentsOf(argv);
  if(['help','--help','-h'].includes(command)){process.stdout.write(CUSTOMER_STATEMENTS_HELP);return;}
  need(typeof values.workspace==='string'&&values.workspace.length>0,'WORKSPACE_REQUIRED','Supply the original accounting --workspace directory.');
  const options={directory:resolve(values.workspace)};
  for(const [argument,key] of [['outbox-dir','outboxDir'],['proof-dir','proofDir'],['terms-file','termsFile']]){
    if(values[argument]!==undefined)options[key]=resolve(values[argument]);
  }
  if(command==='serve'){
    const running=await startCustomerStatementWorkspace({...options,host:values.host??'127.0.0.1',port:values.port===undefined?8447:Number(values.port)});
    process.stdout.write(json({url:running.url,revision:running.workspace.state.revision}));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{running.close().then(()=>{process.exitCode=0;}).catch(error=>{process.stderr.write(json({error:{code:error.code,message:error.message}}));process.exitCode=1;});});
    return running;
  }
  const workspace=await openAccountingWorkspace(options),statements=new CustomerStatementWorkspace(workspace);
  try{
    await statements.init();let result;
    if(command==='state')result=await statements.state();
    else if(command==='customer-save')result=await statements.saveCustomer(await input(values.input));
    else if(command==='orders-assign')result=await statements.assign(await input(values.input));
    else if(command==='bindings')result=await statements.listBindings({customerId:values.customer,offset:values.offset,limit:values.limit});
    else if(command==='usage-import'){
      need(values.file,'USAGE_FILE_REQUIRED','Supply the original usage JSON with --file.');
      const content=(await readInputFile(values.file,MAX_USAGE_BYTES)).toString('utf8');
      result=await statements.importUsage({revision:Number(values.revision),actor:values.actor,name:values.name??'Service usage',content});
    }else if(command==='preview')result=await statements.preview(await input(values.input));
    else if(command==='retain')result=await statements.retain(await input(values.input));
    else if(command==='statements')result=await statements.listStatements({customerId:values.customer,status:values.status,offset:values.offset,limit:values.limit});
    else if(command==='show')result=await statements.detail(values.id);
    else if(command==='withdraw')result=await statements.withdraw(values.id,await input(values.input));
    else if(command==='export'){
      need(values.output,'OUTPUT_REQUIRED','Supply --output for the prepared customer document.');
      const file=await statements.file(values.id,values.file);
      if(values.output==='-'){process.stdout.write(file.bytes);return;}
      result=await saveExport(values.output,file.bytes);
    }else need(false,'UNKNOWN_CUSTOMER_STATEMENT_COMMAND','Run help for the supported customer statement commands.');
    process.stdout.write(json(result));return result;
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  customerStatementsMain().catch(error=>{process.stderr.write(json({error:{code:error.code??'CUSTOMER_STATEMENT_ERROR',message:error.message}}));process.exitCode=1;});
}
