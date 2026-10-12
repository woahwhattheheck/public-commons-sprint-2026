/** MIT. Read the original governed MCP owner beside its original quote snapshot. */
import {constants} from 'node:fs';
import {open, lstat, readdir, realpath, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as same} from 'node:util';
import {captureMcpExpenseSource, inspectSavedMcpPayment} from './expense-statement.mjs';
import {mcpSpendingBinding} from './native-spend-binding.mjs';
import {readMcpSpendingHost} from './native-spend-configuration.mjs';
import {mcpJson} from './remote-mcp.mjs';

export const GOVERNED_MCP_EXPENSE_DESCRIPTOR = 'stellar-forge.governed-mcp-expense-input.v1';
export const GOVERNED_MCP_EXPENSE_SOURCE = 'stellar-forge.governed-mcp-expense-source.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 96 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), {code}); };
const pathIdentity = info => ({device:String(info.dev),inode:String(info.ino)});
async function canonicalPath(value, directory=false, optional=false) {
  need(typeof value==='string' && isAbsolute(value) && resolve(value)===value,
    'GOVERNED_EXPENSE_CANONICAL_PATH');
  let info;
  try { info=await lstat(value); }
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  need(!info.isSymbolicLink() && (directory?info.isDirectory():info.isFile()) &&
    await realpath(value)===value, 'GOVERNED_EXPENSE_ORIGINAL_PATH');
  return info;
}
async function privateJson(path, maximum=4*1024*1024, optional=false) {
  let file;
  try {file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try {
    const before=await file.stat({bigint:true});
    need(before.isFile() && before.size<=BigInt(maximum) && (before.mode&0o077n)===0n &&
      (typeof process.getuid!=='function'||before.uid===BigInt(process.getuid())),
    'GOVERNED_EXPENSE_PRIVATE_RECORD');
    const bytes=await file.readFile(),after=await file.stat({bigint:true});
    need(bytes.length<=maximum && before.dev===after.dev && before.ino===after.ino &&
      before.size===after.size && before.mtimeNs===after.mtimeNs && before.ctimeNs===after.ctimeNs,
    'GOVERNED_EXPENSE_RECORD_CHANGED');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    need(plain(value),'GOVERNED_EXPENSE_OBJECT_REQUIRED');
    return {value,sha256:digest(bytes),bytes:bytes.length,identity:pathIdentity(before)};
  } finally {await file.close();}
}
function bindingQuote(binding) {
  need(plain(binding) && typeof binding.invocationJson==='string' &&
    typeof binding.acceptedJson==='string', 'GOVERNED_EXPENSE_RETAINED_BINDING');
  const invocation=JSON.parse(binding.invocationJson), accepted=JSON.parse(binding.acceptedJson);
  need(plain(invocation),'GOVERNED_EXPENSE_LOGICAL_INVOCATION');
  const args=mcpJson(invocation.arguments);
  return {quoteId:binding.quoteId,method:'tools/call',requestUrl:invocation.endpoint,
    accepted,invocation:{...invocation,argumentsBytes:Buffer.byteLength(args),argumentsSha256:digest(args)}};
}

/** Called while the Python source adapter holds the original native state lock. */
export async function captureGovernedMcpExpenseRecords({descriptor,configurationSha256}={}) {
  await canonicalPath(descriptor);
  const selected=await privateJson(descriptor,32768), input=selected.value;
  need(input.schema===GOVERNED_MCP_EXPENSE_DESCRIPTOR &&
    Object.keys(input).sort().join(',')==='quoteDirectory,schema,spendingConfigurationFile',
  'GOVERNED_EXPENSE_DESCRIPTOR');
  await canonicalPath(input.quoteDirectory,true);
  await canonicalPath(input.spendingConfigurationFile);
  const hostFile=await privateJson(input.spendingConfigurationFile,32768);
  need(HASH.test(configurationSha256??'') && hostFile.sha256===configurationSha256,
    'GOVERNED_EXPENSE_LOCKED_OWNER_CHANGED');
  const host=await readMcpSpendingHost(input.spendingConfigurationFile);
  need(same(host,hostFile.value),'GOVERNED_EXPENSE_HOST_CHANGED');
  const spending=host.spending;
  await canonicalPath(spending.policy);
  await canonicalPath(spending.stateDirectory,true,true);
  await canonicalPath(spending.ledger,false,true);
  const owner={configurationFile:input.spendingConfigurationFile,
    configurationSha256:hostFile.sha256,actor:spending.actor,service:spending.service,payer:host.payer,
    policy:spending.policy,ledger:spending.ledger,stateDirectory:spending.stateDirectory};
  const quotes=captureMcpExpenseSource({directory:input.quoteDirectory});
  const byId=new Map(quotes.records.map(record=>[record.quote.quoteId,record]));
  const quoteBindings=quotes.records.map(({quote})=>{
    try{const bound=mcpSpendingBinding({...quote,requestUrl:quote.url},owner);
      return {quoteId:quote.quoteId,requestSha256:digest(mcpJson(bound.request)),problem:null};}
    catch(error){return {quoteId:quote.quoteId,requestSha256:null,problem:error.code??'GOVERNED_EXPENSE_QUOTE_UNSUPPORTED'};}
  });
  let entries=[];
  try {entries=await readdir(spending.stateDirectory,{withFileTypes:true});}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const names=entries.filter(entry=>entry.name.endsWith('.json') &&
    UUID.test(entry.name.slice(0,-5))).map(entry=>entry.name).sort();
  need(names.length<=10000,'GOVERNED_EXPENSE_BINDING_CAPACITY');
  let retainedBytes=0;
  const bindings=[];
  for(const name of names){
    const quoteId=name.slice(0,-5), file=await privateJson(join(spending.stateDirectory,name));
    retainedBytes+=file.bytes;
    need(retainedBytes<=48*1024*1024,'GOVERNED_EXPENSE_BINDING_CAPACITY');
    const record=file.value, original=byId.get(quoteId);
    const item={quoteId,record,recordSha256:file.sha256,quotePresent:Boolean(original),
      expectedBinding:null,requestSha256:null,problems:[],finality:null,finalitySha256:null,finalityPayment:null};
    try{
      need(record.schema==='stellar-forge.mcp-spending-binding.v1' &&
        record.binding?.quoteId===quoteId,'GOVERNED_EXPENSE_RECORD_IDENTITY');
      // The same function that approved native spending derives this exact request again.
      const expected=mcpSpendingBinding(bindingQuote(record.binding),owner);
      need(same(expected,record.binding),'GOVERNED_EXPENSE_RETAINED_INVOCATION_CHANGED');
      const requestSha256=digest(mcpJson(expected.request));
      need(record.request_sha256===requestSha256,'GOVERNED_EXPENSE_REQUEST_DIGEST_CHANGED');
      item.expectedBinding=expected;item.requestSha256=requestSha256;
      if(original){
        const quote=original.quote;
        const approved=mcpSpendingBinding({...quote,requestUrl:quote.url},owner);
        need(same(expected,approved),'GOVERNED_EXPENSE_QUOTE_BINDING_CHANGED');
      }
    }catch(error){item.problems.push(error.code??'GOVERNED_EXPENSE_BINDING_INVALID');}
    const finality=await privateJson(join(spending.stateDirectory,quoteId+'.finality.json'),4*1024*1024,true);
    if(finality){
      retainedBytes+=finality.bytes;
      need(retainedBytes<=48*1024*1024,'GOVERNED_EXPENSE_BINDING_CAPACITY');
      item.finality=finality.value;item.finalitySha256=finality.sha256;
      if(item.expectedBinding){
        const q=original?.quote??{...bindingQuote(item.expectedBinding),signedRequestDispatched:true};
        item.finalityPayment=inspectSavedMcpPayment({...q,signedRequestDispatched:true,
          result:{...(q.result??{}),reconciliation:finality.value.proof}});
      }
    }
    bindings.push(item);
  }
  const known=new Set(names.map(name=>name.slice(0,-5)));
  const orphanFinality=entries.filter(entry=>entry.name.endsWith('.finality.json') &&
    UUID.test(entry.name.slice(0,-14)) && !known.has(entry.name.slice(0,-14))).map(entry=>entry.name).sort();
  need(orphanFinality.length===0,'GOVERNED_EXPENSE_FINALITY_WITHOUT_BINDING');
  const configuration=await privateJson(join(spending.stateDirectory,'configuration.json'),32768,true);
  if(configuration)need(same(configuration.value,{schema:'stellar-forge.mcp-spending.v1',
    actor:spending.actor,service:spending.service,policy:spending.policy,ledger:spending.ledger}),
    'GOVERNED_EXPENSE_NATIVE_OWNER_CHANGED');
  const finalHost=await privateJson(input.spendingConfigurationFile,32768);
  const finalDescriptor=await privateJson(descriptor,32768);
  need(finalHost.sha256===hostFile.sha256 && finalDescriptor.sha256===selected.sha256,
    'GOVERNED_EXPENSE_SELECTION_CHANGED');
  const result={schema:GOVERNED_MCP_EXPENSE_SOURCE,descriptor,input,
    descriptorSha256:selected.sha256,descriptorIdentity:selected.identity,owner,quotes,quoteBindings,bindings,
    nativeInitialized:configuration!==null,nativeConfiguration:configuration?.value??null,
    observedAt:new Date().toISOString()};
  need(Buffer.byteLength(JSON.stringify(result))<=MAX_BYTES,'GOVERNED_EXPENSE_CAPTURE_CAPACITY');
  return result;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [flag,descriptor,hashFlag,configurationSha256,...rest]=process.argv.slice(2);
    need(flag==='--descriptor' && hashFlag==='--configuration-sha256' && !rest.length,
      'GOVERNED_EXPENSE_ARGUMENTS');
    const result=await captureGovernedMcpExpenseRecords({descriptor,configurationSha256});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){
    process.stderr.write(JSON.stringify({error:{code:error.code??'GOVERNED_EXPENSE_CAPTURE_FAILED',
      message:error.message??'The original governed MCP source could not be captured.'}})+'\n');
    process.exitCode=1;
  }
}
