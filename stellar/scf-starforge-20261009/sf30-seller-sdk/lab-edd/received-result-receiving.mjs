#!/usr/bin/env node
// MIT. One complete customer receiving journey over an already completed Laboratory result.
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256, safeSourceName } from './model.mjs';
import { openReceivedLabResult } from './received-result.mjs';
import { absolute, privateDirectory, exists, writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { readSnapshot } from '../../sf88-operator-buyer-cli/resource-library/files.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),MAX_RESULT_BYTES=67108864;
const JSON_BYTES=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const fail=(message,code='LAB_RESULT_RECEIVING')=>{throw Object.assign(new Error(message),{code});};
const need=(condition,message)=>{if(!condition)fail(message);};
const SOURCE_FILES=[
  "../../sf88-operator-buyer-cli/node/store.mjs",
  "../../sf88-operator-buyer-cli/resource-library/files.mjs",
  "../wqx-water-quality/jobs/archive.mjs",
  "application.mjs",
  "cli.mjs",
  "decisions.mjs",
  "local.mjs",
  "model.mjs",
  "profiles.mjs",
  "profiles/dts8.mjs",
  "profiles/equis.mjs",
  "received-result-page.mjs",
  "received-result-receiving.mjs",
  "received-result.mjs",
  "reconciliation-application.mjs",
  "reconciliation-editor.mjs",
  "reconciliation-profile.mjs",
  "reconciliation-report.mjs",
  "reconciliation-table.mjs",
  "reconciliation.mjs",
  "report-client.mjs",
  "report.mjs",
  "result.mjs",
  "table.mjs",
  "workbook.mjs",
  "zip.mjs"
];
async function directory(path,{create=true}={}){
  path=await privateDirectory(absolute(path),{create});
  need(await realpath(path)===path,'Use a private owned directory without symbolic-link ancestors.');
  return path;
}
async function immutable(path,bytes,{signal}={}){
  signal?.throwIfAborted();
  await directory(dirname(path));
  if(!await exists(path)){
    try{await writeBytes(path,bytes,{exclusive:true,signal});}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const actual=await readSnapshot(path,bytes.length);
  need(actual.length===bytes.length&&sha256(actual)===sha256(bytes),'An existing receiving file differs: '+path);
  return {bytes:actual.length,sha256:sha256(actual)};
}
async function parse(path){return JSON.parse((await readSnapshot(path,4194304)).toString('utf8'));}
async function sourceIdentity(){
  const result=[];
  for(const path of SOURCE_FILES){
    const bytes=await readSnapshot(resolve(HERE,path),2097152);
    result.push({path,bytes:bytes.length,sha256:sha256(bytes)});
  }
  return result;
}
async function runCli({node,root,name,argv,signal}){
  const output=join(root,'commands',name+'.json'),receipt=join(root,'commands',name+'.command.json');
  const command=[node,'--max-old-space-size=192',join(HERE,'cli.mjs'),...argv,'--out',output];
  await directory(dirname(output));
  if(await exists(output)){
    const value=await parse(output);
    need(value.status==='COMPLETE','A retained CLI output is incomplete: '+name);
    if(await exists(receipt)){
      const prior=await parse(receipt);
      need(same(prior.command,command)&&prior.output.sha256===sha256(await readSnapshot(output,4194304)),
        'A retained CLI command differs: '+name);
      return {value,receipt:prior};
    }
    // The original CLI publishes this file only after receiving has completed.
    const recovered={name,command,exitCode:null,retainedCompletedOutput:true,
      output:{path:'commands/'+name+'.json',bytes:(await readSnapshot(output,4194304)).length,
        sha256:sha256(await readSnapshot(output,4194304))}};
    await immutable(receipt,JSON_BYTES(recovered),{signal});
    return {value,receipt:recovered};
  }
  signal?.throwIfAborted();
  const child=spawn(node,command.slice(1),{cwd:root,stdio:['ignore','pipe','pipe'],env:process.env});
  let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),failure=null,killTimer;
  const stop=()=>{
    if(child.exitCode===null&&child.signalCode===null){
      child.kill('SIGTERM');
      killTimer??=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},5000);
    }
  };
  const collect=which=>chunk=>{
    const previous=which==='stdout'?stdout:stderr;
    if(previous.length+chunk.length>1048576){failure??=new Error('The original CLI diagnostic exceeds its retained bound.');stop();return;}
    if(which==='stdout')stdout=Buffer.concat([stdout,chunk]);else stderr=Buffer.concat([stderr,chunk]);
  };
  const done=new Promise(resolve=>{
    child.once('error',error=>{failure??=error;});
    child.once('close',(code,terminationSignal)=>resolve({code,terminationSignal}));
  });
  child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
  let completed;
  try{completed=await done;}
  finally{
    signal?.removeEventListener('abort',stop);if(killTimer)clearTimeout(killTimer);
  }
  signal?.throwIfAborted();
  if(failure)throw failure;
  if(completed.code!==0)fail('The original CLI '+name+' ended '+completed.code+': '+stderr.toString('utf8'));
  const value=await parse(output);
  need(value.status==='COMPLETE','The original CLI did not produce a complete result: '+name);
  const outputBytes=await readSnapshot(output,4194304);
  const recorded={name,command,exitCode:completed.code,signal:completed.terminationSignal,pid:child.pid,
    stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),
    output:{path:'commands/'+name+'.json',bytes:outputBytes.length,sha256:sha256(outputBytes)}};
  await immutable(receipt,JSON_BYTES(recorded),{signal});
  return {value,receipt:recorded};
}
async function transferredFiles(root,received,signal){
  const rows=[...received.receipt.files,{path:'receipt.json',
    bytes:(await readSnapshot(received.receiptPath,4194304)).length,
    sha256:sha256(await readSnapshot(received.receiptPath,4194304))}];
  await directory(root);
  for(const row of rows){
    signal?.throwIfAborted();safeSourceName(row.path);
    const bytes=await readSnapshot(join(received.directory,row.path),row.bytes);
    need(bytes.length===row.bytes&&sha256(bytes)===row.sha256,'An original received file changed before transfer: '+row.path);
    const parentParts=row.path.split('/').slice(0,-1);let parent=root;
    for(const part of parentParts){parent=join(parent,part);await directory(parent);}
    await immutable(join(root,row.path),bytes,{signal});
  }
  return rows;
}
async function inventory(root,paths,signal){
  const output=[];
  for(const path of [...new Set(paths)].sort()){
    signal?.throwIfAborted();safeSourceName(path);
    const bytes=await readSnapshot(join(root,path),536870912);
    output.push({path,bytes:bytes.length,sha256:sha256(bytes)});
  }
  return output;
}
/**
 * Receives a retained complete result without invoking its original worker.
 * sourceKind describes the actual supplied result; it is recorded, not inferred.
 */
export async function receiveCompletedLabCustomerResult({
  file,directory:target,node=process.execPath,expectedResultSha256,
  operationId='LAB-RESULT-CUSTOMER-RECEIVING-9F77-20261012',
  sourceKind,signal,
}={}){
  need(typeof expectedResultSha256==='string'&&/^[0-9a-f]{64}$/.test(expectedResultSha256),'Select the retained complete result SHA256.');
  need(typeof sourceKind==='string'&&sourceKind.trim()===sourceKind&&sourceKind.length>0&&sourceKind.length<=200,
    'Declare the actual retained result source kind.');
  need(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(operationId),'Keep a stable receiving operation ID.');
  const input=absolute(file),root=await directory(absolute(target)),executable=await realpath(absolute(node));
  signal?.throwIfAborted();
  const sourceBytes=await readSnapshot(input,MAX_RESULT_BYTES);
  need(sha256(sourceBytes)===expectedResultSha256,'The selected retained result bytes changed.');
  const binding={schema:'starforge.lab-edd-customer-receiving-binding.v1',operationId,sourceKind,
    input:{bytes:sourceBytes.length,sha256:expectedResultSha256},sources:await sourceIdentity(),node:executable};
  const bindingBytes=JSON_BYTES(binding),expected={archiveSha256:expectedResultSha256};
  await immutable(join(root,'operation-binding.json'),bindingBytes,{signal});
  const inputFile=join(root,'input','complete-result.zip');
  await immutable(inputFile,sourceBytes,{signal});
  const customer=join(root,'customer'),cold=join(root,'independent-customer');
  if(await exists(join(root,'native-receiving.json'))){
    const completed=await parse(join(root,'native-receiving.json'));
    need(completed.status==='COMPLETE'&&completed.bindingSha256===sha256(bindingBytes),
      'The completed customer receiving belongs to another original input or selected source.');
    const current=await openReceivedLabResult({directory:customer,expected,signal});
    const reopened=await openReceivedLabResult({directory:cold,expected,signal});
    need(same(current.receipt,reopened.receipt)&&same(current.receipt.identity,completed.identity),
      'The completed original and independent received results disagree.');
    const actual=await inventory(root,completed.files.map(file=>file.path),signal);
    need(same(actual,completed.files),'A completed customer receiving artifact changed.');
    return {...completed,reused:true,directory:root};
  }
  const initial=await runCli({node:executable,root,name:'01-open',signal,
    argv:['open-result','--file',inputFile,'--directory',customer,'--expected-result-sha256',expectedResultSha256]});
  const received=await openReceivedLabResult({directory:customer,expected,signal});
  need(same(initial.value.identity,received.receipt.identity),'The CLI and SDK did not receive the same original result.');
  const repeated=await runCli({node:executable,root,name:'02-resume',signal,
    argv:['open-result','--file',inputFile,'--directory',customer,'--expected-result-sha256',expectedResultSha256]});
  need(repeated.value.reused===true&&repeated.value.writtenFiles===0&&same(repeated.value.identity,received.receipt.identity),
    'The same-folder continuation did not preserve the complete result.');
  const copied=await transferredFiles(cold,received,signal);
  const reopened=await runCli({node:executable,root,name:'03-cold-reopen',signal,
    argv:['reopen-result','--directory',cold,'--expected-result-sha256',expectedResultSha256]});
  const coldReceipt=await parse(join(cold,'receipt.json'));
  need(reopened.value.readOnly===true&&same(reopened.value.identity,received.receipt.identity)&&same(coldReceipt,received.receipt),
    'The fresh-process independent reopen changed the original delivery.');
  const commands=[initial.receipt,repeated.receipt,reopened.receipt];
  const paths=['operation-binding.json','input/complete-result.zip',
    ...copied.flatMap(row=>['customer/'+row.path,'independent-customer/'+row.path]),
    ...commands.flatMap(row=>['commands/'+row.name+'.json','commands/'+row.name+'.command.json'])];
  const files=await inventory(root,paths,signal);
  const result={
    schema:'starforge.lab-edd-customer-receiving.v1',status:'COMPLETE',operationId,sourceKind,
    bindingSha256:sha256(bindingBytes),identity:received.receipt.identity,
    originalResultMembers:received.receipt.originalResultMembers,
    customerManagedFiles:received.receipt.files.length,customerManagedBytes:received.receipt.managedFileBytes,
    originalInputFiles:received.receipt.originalInputFiles,nativeFamilies:received.receipt.nativeFamilies,
    customerEntry:'customer/index.html',independentEntry:'independent-customer/index.html',
    sameFolderReuse:true,independentFullCopy:true,readOnlyColdReopen:true,commands,files,
    retainedFileBytes:files.reduce((sum,row)=>sum+row.bytes,0),
  };
  await immutable(join(root,'native-receiving.json'),JSON_BYTES(result),{signal});
  return {...result,directory:root};
}
function args(argv){
  const result={};const allowed=new Set(['file','directory','node','expected-result-sha256','source-kind','operation-id']);
  if(argv.includes('--help'))return {help:true};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i]?.replace(/^--/,'');
    if(!argv[i]?.startsWith('--')||!allowed.has(key)||result[key]!==undefined||argv[i+1]===undefined||argv[i+1].startsWith('--'))
      fail('Use each receiving option once with an explicit value.');
    result[key]=argv[i+1];
  }
  return result;
}
export async function main(argv=process.argv.slice(2)){
  const options=args(argv);
  if(options.help){process.stdout.write('node received-result-receiving.mjs --file COMPLETE_ZIP --directory PRIVATE_RECEIVING --expected-result-sha256 SHA --source-kind DESCRIPTION [--operation-id ID] [--node NODE]\n');return;}
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Customer receiving cancelled.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await receiveCompletedLabCustomerResult({file:options.file,directory:options.directory,
      expectedResultSha256:options['expected-result-sha256'],sourceKind:options['source-kind'],
      ...(options.node?{node:options.node}:{}),...(options['operation-id']?{operationId:options['operation-id']}:{}),
      signal:controller.signal});
    process.stdout.write(JSON.stringify({status:result.status,operationId:result.operationId,directory:result.directory,
      receipt:join(result.directory,'native-receiving.json'),identity:result.identity,
      files:result.files.length,retainedFileBytes:result.retainedFileBytes,reused:result.reused??false},null,2)+'\n');
    return result;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'LAB_RESULT_RECEIVING',message:error.message})+'\n');process.exitCode=1;
});
