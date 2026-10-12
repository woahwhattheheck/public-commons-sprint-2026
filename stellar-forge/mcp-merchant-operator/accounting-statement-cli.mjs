#!/usr/bin/env node
// MIT. Review, retain, recover and export original customer statements through MCP.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { writePrivate, privateSupportDirectory } from './config.mjs';
import { accountingStatementArguments, accountingStatementRetentionArguments, accountingStatementPreview, connectAccountingStatementClient } from './accounting-statement-client.mjs';
import { downloadAccountingMaintenanceFile } from './accounting-maintenance-cli.mjs';

const REQUEST = 'stellar-forge.accounting-statement-client-request.v1';
const STATE = 'stellar-forge.accounting-statement-client-state.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_STATEMENT_CLIENT_' + code });
const problem = error => ({ code: error.code ?? 'ERROR', message: String(error.message).slice(0, 1000) });
function need(ok, message, code = 'ARGUMENTS') { if (!ok) throw fail(code, message); }
function exact(value, fields) { need(plain(value) && Object.keys(value).every(key => fields.includes(key)), 'The saved operation contains undeclared fields.', 'REQUEST'); }
function endpoint(url) {
  let value; try { value = new URL(url); } catch { throw fail('CONFIGURATION', 'Supply the existing HTTPS or loopback HTTP merchant endpoint.'); }
  need(!value.username && !value.password && !value.search && !value.hash &&
    (value.protocol === 'https:' || value.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(value.hostname)),
    'Use the original HTTPS or loopback HTTP endpoint without credentials, query or fragment.', 'CONFIGURATION');
  return value.href;
}
async function privateDirectory(path) {
  path = resolve(path); await privateSupportDirectory(path);
  const info = await lstat(path);
  need(await realpath(path) === path && (!process.getuid || info.uid === process.getuid()),
    'Use an owner-controlled private directory without symlink ancestors.', 'PRIVATE_DIRECTORY');
  return path;
}
async function readJson(path, maximum = 2 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= maximum && !(info.mode & 0o077) &&
      (!process.getuid || info.uid === process.getuid()), 'Use the original private regular JSON file.', 'PRIVATE_FILE');
    const bytes = await file.readFile();
    need(bytes.length <= maximum, 'The original operation file grew beyond its size limit.', 'PRIVATE_FILE');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
async function syncDirectory(directory) {
  const file = await open(directory, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}

function validateRequest(request) {
  exact(request,['schema','preparedAt','url','workspace','tokenEnv','kind','arguments','preview','sha256']);
  const {sha256,...content}=request;
  need(request.schema===REQUEST&&Number.isFinite(Date.parse(request.preparedAt))&&sha(content)===sha256&&
    endpoint(request.url)===request.url&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.workspace??'')&&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(request.tokenEnv??''),'The retained operation identity changed.','REQUEST');
  const args=request.kind==='retain'?accountingStatementRetentionArguments(request.preview,request.arguments):
    accountingStatementArguments(request.kind,request.arguments);
  need(JSON.stringify(args)===JSON.stringify(request.arguments),'The reviewed original arguments changed.','REQUEST');
  if(request.kind!=='retain')need(request.preview===undefined,'Use a full native preview only for statement retention.','REQUEST');
  return request;
}
export async function prepareAccountingStatementOperation({directory,url,workspace,tokenEnv='MCP_ACCESS_TOKEN',
  kind,preview,arguments:value,actor,requestId}={}){
  const args=kind==='retain'?accountingStatementRetentionArguments(preview,{actor,requestId:requestId??randomUUID()}):
    accountingStatementArguments(kind,value);
  const content={schema:REQUEST,preparedAt:now(),url:endpoint(url),workspace,tokenEnv,kind,arguments:args,
    ...(kind==='retain'?{preview:structuredClone(preview)}:{})};
  const request=validateRequest({...content,sha256:sha(content)});
  const requestText=JSON.stringify(request)+'\n';
  need(Buffer.byteLength(requestText)<=130_000_000,'The complete retained request exceeds 130 MB.','SIZE');
  directory=resolve(directory);await privateDirectory(dirname(directory));await mkdir(directory,{mode:0o700});await privateDirectory(directory);
  await writePrivate(join(directory,'request.json'),requestText);
  await writePrivate(join(directory,'state.json'),{schema:STATE,requestSha256:request.sha256,phase:'PREPARED',preparedAt:request.preparedAt,
    updatedAt:now(),submissionAttempted:false,observation:null});
  await syncDirectory(directory);await syncDirectory(dirname(directory));
  return {directory,kind,requestSha256:request.sha256,arguments:args,phase:'PREPARED'};
}
async function operation(directory,work){
  directory=await privateDirectory(directory);const lease=await acquireStateLease(directory);
  try{
    const request=validateRequest(await readJson(join(directory,'request.json'),130_000_000)),state=await readJson(join(directory,'state.json'),4_000_000);
    need(state.schema===STATE&&state.requestSha256===request.sha256&&typeof state.submissionAttempted==='boolean',
      'The operation state belongs to a different request.','STATE');
    async function checkpoint(changes){
      lease.assertHeld();Object.assign(state,changes,{updatedAt:now()});
      const temporary=join(directory,'state-'+randomUUID()+'.next');
      try{await writePrivate(temporary,state);lease.assertHeld();await rename(temporary,join(directory,'state.json'));await syncDirectory(directory);}
      finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }
    return await work({directory,request,state,checkpoint});
  }finally{await lease.close();}
}
function lookup(client,request,options){
  const args=request.arguments;
  if(request.kind==='retain')return client.reconcileRetention(request.preview,args,options);
  if(request.kind==='save')return client.reconcileCustomer(args,options);
  if(request.kind==='assign')return client.reconcileAssignments(args,options);
  if(request.kind==='usage_import')return client.reconcileUsage(args,options);
  return client.reconcileWithdrawal(args,options);
}
function submit(client,request,options){
  const args=request.arguments;
  if(request.kind==='retain')return client.retain(request.preview,args,options);
  if(request.kind==='save')return client.saveCustomer(args,options);
  if(request.kind==='assign')return client.assign(args,options);
  if(request.kind==='usage_import')return client.importUsage(args,options);
  return client.withdraw(args,options);
}
/** Exact retries retain native request IDs, source SHA, and optimistic revision guards. */
export async function runAccountingStatementOperation({directory,execute=false,client:providedClient,environment=process.env,signal}={}){
  need(typeof execute==='boolean','Choose whether to execute the prepared original operation.');signal?.throwIfAborted();
  return operation(directory,async context=>{
    const {request,state,checkpoint}=context;
    const client=providedClient??await connectAccountingStatementClient({url:request.url,workspace:request.workspace,tokenEnv:request.tokenEnv,environment,signal});
    let failure;
    try{
      need(client.workspace===request.workspace&&(!client.endpoint||client.endpoint===request.url),'Use the recorded original endpoint and workspace.','CONNECTION_BINDING');
      await client.open({requestSignal:signal});
      let observed=await lookup(client,request,{requestSignal:signal}),submitted=false,acknowledged=false;
      if(!observed.found){
        if(!execute){
          await checkpoint({phase:'NOT_OBSERVED',observation:observed});
          return {directory:context.directory,kind:request.kind,found:false,previouslyAttempted:state.submissionAttempted,observation:observed};
        }
        await checkpoint({phase:'SENDING',submissionAttempted:true,sendingAt:now(),sendError:null,lookupError:null});
        try{submitted=true;observed={found:true,...await submit(client,request,{requestSignal:signal})};acknowledged=true;}
        catch(error){
          await checkpoint({phase:'UNOBSERVED_REPLY',sendError:problem(error)});
          try{observed=await lookup(client,request,{timeoutMs:10000});}
          catch(lookupError){await checkpoint({lookupError:problem(lookupError)});error.lookupError=problem(lookupError);throw error;}
          if(!observed.found)throw error;
        }
      }
      await checkpoint({phase:'OBSERVED',observation:observed,lookupError:null});
      return {directory:context.directory,kind:request.kind,submitted,acknowledged,...observed};
    }catch(error){failure=error;error.operationDirectory=context.directory;throw error;}
    finally{if(!providedClient)try{await client.disconnect();}catch(error){if(failure)failure.releaseError=problem(error);else throw error;}}
  });
}
export const downloadAccountingStatementFile=downloadAccountingMaintenanceFile;
async function exactExisting(path,metadata){
  let handle;
  try{
    handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));const info=await handle.stat();
    need(info.isFile()&&info.nlink===1&&info.size===metadata.bytes&&!(info.mode&0o077)&&
      (!process.getuid||info.uid===process.getuid()),'The existing delivery file differs from its retained metadata.','FILE_CHANGED');
    const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<info.size){const result=await handle.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);need(result.bytesRead>0,'The delivery file ended early.','FILE_CHANGED');digest.update(buffer.subarray(0,result.bytesRead));offset+=result.bytesRead;}
    need(digest.digest('hex')===metadata.sha256,'The existing delivery file differs from its original SHA256.','FILE_CHANGED');return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
  finally{await handle?.close();}
}
/** Deliver all five exact original statement artifacts; a retry reuses verified files. */
export async function exportAccountingStatement({client,statementId,directory,signal}={}){
  need(UUID.test(statementId??''),'Choose the original statement UUID.');directory=await privateDirectory(directory);
  const lease=await acquireStateLease(directory),files=[];
  try{
    const detail=await client.detail({statementId},{requestSignal:signal}),statement=detail.statement,identityPath=join(directory,'delivery.json');
    let existing;try{existing=await readJson(identityPath,65536);}catch(error){if(error.code!=='ENOENT')throw error;}
    need(!existing||existing.workspace===client.workspace&&existing.statementId===statementId,'This delivery directory belongs to another original statement.','DELIVERY_BINDING');
    for(const name of ['statement.json','statement.csv','usage.csv','statement.html','manifest.json']){
      const metadata=statement.files[name];need(metadata&&/^[a-f0-9]{64}$/.test(metadata.sha256)&&Number.isSafeInteger(metadata.bytes),
        'The original statement lacks its complete file manifest.','FILE_REPLY');
      const output=join(directory,name),reused=await exactExisting(output,metadata);
      if(!reused)await downloadAccountingStatementFile({client,selection:{kind:'customer-statement',statementId,file:name},expectedSha256:metadata.sha256,output,signal});
      files.push({name,...metadata,reused});
    }
    const result={schema:'stellar-forge.accounting-statement-delivery.v1',workspace:client.workspace,statementId,number:statement.number,
      observedStatus:statement.status,observedRevision:detail.revision,files:files.map(({reused,...file})=>file),complete:true};
    if(!existing){await writePrivate(identityPath,result);await syncDirectory(directory);}
    else need(existing.number===result.number&&JSON.stringify(existing.files)===JSON.stringify(result.files),'The original statement file identities changed.','DELIVERY_BINDING');
    return {directory,...result,files};
  }finally{await lease.close();}
}
/** status.json is generated once when the original retained reader opens its snapshot. */
export async function downloadAccountingStatementStatus({client,statementId,output,signal}={}){
  need(UUID.test(statementId??''),'Choose the original statement UUID.');
  output=resolve(output);const directory=await privateDirectory(dirname(output)),temporary=join(directory,'statement-status-'+randomUUID()+'.partial');
  const handle=await open(temporary,'wx',0o600);let metadata,bytes=0;
  try{
    for await(const chunk of client.fileChunks({kind:'customer-statement',statementId,file:'status.json'},{signal})){
      await handle.writeFile(chunk.bytes);metadata=chunk.file;bytes+=chunk.bytes.length;
    }
    need(metadata&&bytes===metadata.bytes,'The original status snapshot did not finish.','FILE_REPLY');
    await handle.sync();await handle.close();await link(temporary,output);await unlink(temporary);await syncDirectory(directory);
    return {output,workspace:client.workspace,statementId,file:metadata,complete:true};
  }catch(error){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}

const HELP="Starforge customer statement client\n\n  open|close|status --url MCP_URL --workspace ALIAS [--token-env NAME]\n  status|bindings|order|statements|detail|lookup|usage-source ...\n      [--request PRIVATE_ARGUMENTS_JSON]\n  preview ... --request PRIVATE_SELECTION_JSON --out NEW_PRIVATE_PREVIEW_JSON\n  prepare --dir NEW_PRIVATE_OPERATION --url MCP_URL --workspace ALIAS\n      --action retain --preview PRIVATE_PREVIEW_JSON --actor NAME [--request-id ID]\n  prepare --dir NEW_PRIVATE_OPERATION --url MCP_URL --workspace ALIAS\n      --action save|assign|usage_import|withdraw --request PRIVATE_NATIVE_ARGUMENTS_JSON\n  execute|reconcile --dir PRIVATE_OPERATION\n  download ... --selection PRIVATE_JSON --sha256 SHA256 --out NEW_PRIVATE_FILE\n  export ... --statement-id UUID --dir PRIVATE_DELIVERY_DIRECTORY\n  status-snapshot ... --statement-id UUID --out NEW_PRIVATE_STATUS_JSON\n\nConnection commands accept --token-env NAME. Tokens remain in that process variable.\nstatus request: {\"view\":\"customers|runs|usage|history\",\"offset\":0,\"limit\":200}.\nbindings: {\"customerId\":\"UUID\",\"offset\":0,\"limit\":200}. order: {\"orderRef\":\"original\"}.\ndetail: {\"statementId\":\"UUID\",\"view\":\"summary|items|excluded|assets|calls|adjustments|history\"}.\nCalls and adjustments select orderRef; page all native items with offset and limit.\nlookup: {\"requestId\":\"original-retention-id\"}. usage-source: {\"source\":\"host-alias\"}.\nPreview selects customerId/runId, optional usageId/replacesId, and optional from/until.\nThe complete native preview is read through the original SHA-pinned file consumer.\nUsage import requires the source SHA returned by usage-source. Retention uses its\ncomplete reviewed preview and one durable requestId; corrections set replacesId.\nprepare retains exact normalized arguments in request.json. execute reconciles\ncurrent original records before sending; reconcile reads them. Lost replies\nrecover through the native request ID, source SHA, profile, bindings or withdrawal\nhistory. Exact retries keep the original revision guard and operation identity.\nexport delivers statement.json, statement.csv, usage.csv, statement.html and\nmanifest.json, verifies existing files on restart, and retains their native hashes.\nstatus-snapshot reads the current status.json once through the original pinned\nreader and saves its exact bytes and SHA. All five original files remain available\nthrough correction and withdrawal. Ordinary commands release this caller's reads.\nclose explicitly closes the original accounting workspace.\nExit 0: complete, prepared or read. Exit 3: prepared effect not observed. Exit 2: error.\n";

function options(args,allowed){
  const values=new Map();
  for(let index=0;index<args.length;index+=2){
    need(allowed.includes(args[index])&&!values.has(args[index])&&args[index+1]!==undefined,'Use documented option/value pairs without duplicates.');
    values.set(args[index],args[index+1]);
  }
  return values;
}
function required(values,name){need(values.has(name)&&values.get(name),'Supply '+name+'.');return values.get(name);}
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.length===1&&['--help','help'].includes(args[0])){process.stdout.write(HELP);return;}
  const [command,...rest]=args,connectionFields=['--url','--workspace','--token-env'];let result;
  if(command==='prepare'){
    const values=options(rest,['--dir',...connectionFields,'--action','--preview','--request','--actor','--request-id']),kind=required(values,'--action');
    need(kind==='retain'?values.has('--preview')&&!values.has('--request'):values.has('--request')&&!values.has('--preview'),
      'Retain uses --preview; save, assign, usage_import and withdraw use --request.');
    result=await prepareAccountingStatementOperation({directory:required(values,'--dir'),url:required(values,'--url'),workspace:required(values,'--workspace'),
      tokenEnv:values.get('--token-env')??'MCP_ACCESS_TOKEN',kind,
      ...(kind==='retain'?{preview:await readJson(resolve(required(values,'--preview')),128_000_000),actor:required(values,'--actor'),requestId:values.get('--request-id')}:
        {arguments:await readJson(resolve(required(values,'--request')),2_000_000)})});
  }else if(command==='execute'||command==='reconcile'){
    const values=options(rest,['--dir']);result=await runAccountingStatementOperation({directory:required(values,'--dir'),execute:command==='execute'});
  }else{
    const extra={open:[],close:[],status:['--request'],bindings:['--request'],order:['--request'],statements:['--request'],detail:['--request'],
      lookup:['--request'],'usage-source':['--request'],preview:['--request','--out'],download:['--selection','--sha256','--out'],
      export:['--statement-id','--dir'],'status-snapshot':['--statement-id','--out']}[command];
    need(extra,'Choose a documented customer statement command.');
    const values=options(rest,[...connectionFields,...extra]),client=await connectAccountingStatementClient({url:required(values,'--url'),
      workspace:required(values,'--workspace'),tokenEnv:values.get('--token-env')??'MCP_ACCESS_TOKEN'});
    let failure;
    try{
      result=await client.open();
      const input=values.has('--request')?await readJson(resolve(values.get('--request')),2_000_000):{};
      if(command==='close')result=await client.closeWorkspace();
      else if(command==='status')result=await client.status(input);
      else if(command==='bindings')result=await client.bindings(input);
      else if(command==='order')result=await client.order(input);
      else if(command==='statements')result=await client.statements(input);
      else if(command==='detail')result=await client.detail(input);
      else if(command==='lookup')result=await client.lookup(input.requestId);
      else if(command==='usage-source')result=await client.usageSource(input.source);
      else if(command==='preview'){
        required(values,'--request');const output=resolve(required(values,'--out'));await privateDirectory(dirname(output));
        const preview=await client.preview(input);accountingStatementPreview(preview);await writePrivate(output,preview);await syncDirectory(dirname(output));
        result={output,intent:preview.intent,previewSha256:preview.previewSha256,revision:preview.revision,orders:preview.draft.items.length};
      }else if(command==='download')result=await downloadAccountingStatementFile({client,selection:await readJson(resolve(required(values,'--selection')),65536),
        expectedSha256:required(values,'--sha256'),output:required(values,'--out')});
      else if(command==='export')result=await exportAccountingStatement({client,statementId:required(values,'--statement-id'),directory:required(values,'--dir')});
      else if(command==='status-snapshot')result=await downloadAccountingStatementStatus({client,statementId:required(values,'--statement-id'),output:required(values,'--out')});
    }catch(error){failure=error;throw error;}
    finally{try{await client.disconnect();}catch(error){if(failure)failure.releaseError=problem(error);else throw error;}}
  }
  process.stdout.write(JSON.stringify(result)+'\n');if(result?.found===false)process.exitCode=3;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:problem(error),operationDirectory:error.operationDirectory})+'\n');process.exitCode=2;});
