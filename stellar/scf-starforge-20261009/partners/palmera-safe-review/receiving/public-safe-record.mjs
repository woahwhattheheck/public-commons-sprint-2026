// MIT. Durable public input receiving around the original Safe SDK and selection.
import {readdir,realpath} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {absolute,need,object,digest,jsonBytes,parseJson,readBytes,readJson,
  privateDirectory,writeBytes,syncDirectory,matchingWriteTemporaries}
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {captureSafeTransaction,prepareSafeSelection,openSelection,describeSelection,
  exactWrite,MAX_SELECTION_BYTES} from '../transaction.mjs';
import {readPublicSafe,reopenPublicSafe} from './read-public-safe.mjs';

export const PUBLIC_SAFE_RECORD_SCHEMA='stellar-forge.public-safe-receiving.v1';
export const PUBLIC_SAFE_INPUT_SCHEMA='stellar-forge.public-safe-receiving-input.v1';
export const PUBLIC_SAFE_OBSERVATION_SCHEMA='stellar-forge.public-safe-rpc-observation.v1';
export const DEFAULT_RPC_ENVIRONMENT='PALMERA_SAFE_RPC_URL';
export const DEFAULT_PUBLIC_SAFE_SOURCE=fileURLToPath(new URL('./public-safe-source.json',import.meta.url));
const HASH=/^[0-9a-f]{64}$/;
const ENV=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SAME=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const ROOT_FILES=['receiving-input.json','source.json','observation.json','selected-context.json'];
const SELECTION_FILES=['safe-transaction.json','simulation.json','selection.json'];
const MEMBERS=[...ROOT_FILES,...SELECTION_FILES.map(name=>'selection/'+name)];
const LIMITS={'receiving-input.json':16384,'source.json':1048576,'observation.json':16*1024*1024,
  'selected-context.json':16384,'selection/safe-transaction.json':MAX_SELECTION_BYTES,
  'selection/simulation.json':MAX_SELECTION_BYTES,'selection/selection.json':16384};

function ordered(value){
  if(Array.isArray(value))return value.map(ordered);
  if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])]));
  return value;
}
function rpcOrigin(rpc){
  need(typeof rpc==='string'&&rpc.length>0,'PUBLIC_SAFE_RPC_REQUIRED');
  let url;try{url=new URL(rpc);}catch{need(false,'PUBLIC_SAFE_RPC_URL_INVALID');}
  need(url.protocol==='https:','PUBLIC_SAFE_HTTPS_RPC_REQUIRED');
  return url.origin;
}
export function publicSafeRPC({rpc,rpcEnvironment=DEFAULT_RPC_ENVIRONMENT,environment=process.env}={}){
  need(ENV.test(rpcEnvironment),'PUBLIC_SAFE_RPC_ENVIRONMENT_INVALID');
  const selected=rpc??environment[rpcEnvironment];rpcOrigin(selected);
  return selected;
}
function contextMatches(actual,expected){
  const fields=['networkId','blockNumber','transactionIndex','from','gas','value'];
  need(object(actual)&&Object.keys(actual).length===fields.length&&
    fields.every(key=>Object.hasOwn(actual,key)),'PUBLIC_SAFE_CONTEXT_REQUIRED');
  need(fields.every(key=>key==='from'?SAME(actual[key],expected[key]):actual[key]===expected[key]),
    'PUBLIC_SAFE_RETAINED_CONTEXT_MISMATCH');
}
function inputIdentity({sourceSha256,callerRoot,label,rpcOrigin}){
  const value={schema:PUBLIC_SAFE_INPUT_SCHEMA,sourceSha256,callerRoot,label,rpcOrigin};
  return {...value,id:digest(jsonBytes(value))};
}
function validateInput(input){
  need(object(input)&&input.schema===PUBLIC_SAFE_INPUT_SCHEMA&&HASH.test(input.id)&&
    HASH.test(input.sourceSha256)&&typeof input.callerRoot==='string'&&isAbsolute(input.callerRoot)&&
    typeof input.label==='string'&&input.label.length<=160&&typeof input.rpcOrigin==='string',
    'PUBLIC_SAFE_RECEIVING_INPUT_INVALID');
  need(isDeepStrictEqual(input,inputIdentity(input)),'PUBLIC_SAFE_RECEIVING_INPUT_CHANGED');
  need(rpcOrigin(input.rpcOrigin)===input.rpcOrigin,'PUBLIC_SAFE_RPC_ORIGIN_INVALID');
}
function validateObservation(value,input,source){
  need(object(value)&&value.schema===PUBLIC_SAFE_OBSERVATION_SCHEMA&&
    value.inputId===input.id&&value.sourceSha256===input.sourceSha256&&
    value.representation==='canonical JSON of Protocol Kit external-provider JSON-RPC result objects'&&
    object(value.outer)&&object(value.receipt)&&object(value.context)&&object(value.runtime),
    'PUBLIC_SAFE_OBSERVATION_INVALID');
  const {outer,receipt,context,runtime}=value;
  need(runtime.palmeraVersion==='1.0.0-beta.1'&&runtime.protocolVersion==='4.1.0'&&
    runtime.callerRoot===input.callerRoot&&HASH.test(runtime.palmeraMetadataSha256)&&
    HASH.test(runtime.protocolMetadataSha256)&&typeof runtime.palmeraPackage==='string'&&
    typeof runtime.protocolPackage==='string','PUBLIC_SAFE_OBSERVED_RUNTIME_INVALID');
  need(SAME(outer.hash,source.outerTransactionHash)&&SAME(receipt.transactionHash,outer.hash)&&
    SAME(outer.to,source.safe)&&SAME(outer.from,source.executor)&&
    SAME(receipt.blockHash,outer.blockHash)&&receipt.blockNumber===outer.blockNumber&&
    receipt.transactionIndex===outer.transactionIndex,'PUBLIC_SAFE_OBSERVATION_SOURCE_MISMATCH');
  const integer=(hex,code)=>{
    need(typeof hex==='string'&&/^0x[0-9a-f]+$/i.test(hex),code);
    const n=BigInt(hex),v=Number(n);need(Number.isSafeInteger(v)&&BigInt(v)===n,code);return v;
  };
  need(context.networkId===source.networkId&&
    integer(outer.blockNumber,'PUBLIC_SAFE_OBSERVED_BLOCK_INVALID')===source.blockNumber&&
    integer(receipt.status,'PUBLIC_SAFE_OBSERVED_RECEIPT_STATUS_INVALID')===1&&
    integer(receipt.gasUsed,'PUBLIC_SAFE_OBSERVED_GAS_USED_INVALID')===source.reportedOutcome.gasUsed,
    'PUBLIC_SAFE_OBSERVED_EXECUTION_MISMATCH');
  need(typeof outer.value==='string'&&/^0x[0-9a-f]+$/i.test(outer.value),'PUBLIC_SAFE_OUTER_VALUE_INVALID');
  contextMatches(context,{networkId:source.networkId,blockNumber:source.blockNumber,
    transactionIndex:integer(outer.transactionIndex,'PUBLIC_SAFE_OBSERVED_INDEX_INVALID'),from:outer.from,
    gas:integer(outer.gas,'PUBLIC_SAFE_OBSERVED_GAS_LIMIT_INVALID'),value:BigInt(outer.value).toString()});
}
async function directoryAt(directory,create=false){
  directory=await privateDirectory(absolute(directory),{create});
  need(await realpath(directory)===directory,'PUBLIC_SAFE_DIRECTORY_SYMLINK');
  return directory;
}
async function optionalBytes(path,limit){
  try{return await readBytes(path,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function allowOnly(directory,names,bytes){
  const temporaries=await matchingWriteTemporaries(directory,bytes);
  need((await readdir(directory)).every(name=>names.includes(name)||temporaries.has(name)),
    'PUBLIC_SAFE_DESTINATION_CONFLICT');
}
async function originalSourceBytes(bytes){
  const published=await readBytes(DEFAULT_PUBLIC_SAFE_SOURCE,LIMITS['source.json']);
  need(bytes.equals(published),'PUBLIC_SAFE_ORIGINAL_PUBLISHED_SOURCE_REQUIRED');
  return bytes;
}
async function sourceBytesAt(sourceFile){
  return originalSourceBytes(await readBytes(absolute(sourceFile),LIMITS['source.json']));
}
function bindSelection(selection,source,observation,input){
  const record=selection.record;
  need(record.identity.networkId===source.networkId&&SAME(record.identity.address,source.safe)&&
    SAME(record.transactionHash,source.safeTxHash)&&SAME(record.encodedTransaction,observation.outer.input)&&
    SAME(record.encodedSignatures,source.expectedEncodedSignatures)&&
    isDeepStrictEqual(record.data,source.transaction.data)&&record.label===input.label,
    'PUBLIC_SAFE_ORIGINAL_SELECTION_MISMATCH');
  contextMatches(record.simulationContext,observation.context);
  need(record.origin.reference===source.source.url,'PUBLIC_SAFE_SOURCE_REFERENCE_MISMATCH');
}
async function memberBytes(directory){
  return Object.fromEntries(await Promise.all(MEMBERS.map(async name=>[name,await readBytes(join(directory,name),LIMITS[name])])));
}
function descriptor(bytes){return {bytes:bytes.length,sha256:digest(bytes)};}
function recordManifest(files,selection){
  const value={schema:PUBLIC_SAFE_RECORD_SCHEMA,selectionId:selection.id,
    bodySha256:selection.manifest.files['simulation.json'].sha256,files};
  return {...value,id:digest(jsonBytes(value))};
}

/** Read-only offline validation. This never creates a provider or buyer. */
export async function openPublicSafeRecord(directory){
  directory=await directoryAt(directory);
  const manifestBytes=await readBytes(join(directory,'receiving.json'),65536),manifest=parseJson(manifestBytes);
  need(object(manifest)&&manifest.schema===PUBLIC_SAFE_RECORD_SCHEMA&&HASH.test(manifest.id)&&
    object(manifest.files)&&Object.keys(manifest.files).length===MEMBERS.length&&
    MEMBERS.every(name=>Object.hasOwn(manifest.files,name)),'PUBLIC_SAFE_RECORD_MANIFEST_INVALID');
  const bytes=await memberBytes(directory);
  for(const name of MEMBERS){
    const f=manifest.files[name];need(object(f)&&isDeepStrictEqual(f,descriptor(bytes[name])),
      'PUBLIC_SAFE_RECORD_FILE_CHANGED');
  }
  const input=parseJson(bytes['receiving-input.json']),source=parseJson(bytes['source.json']),
    observation=parseJson(bytes['observation.json']),context=parseJson(bytes['selected-context.json']);
  validateInput(input);need(digest(bytes['source.json'])===input.sourceSha256,'PUBLIC_SAFE_SOURCE_BYTES_CHANGED');
  await originalSourceBytes(bytes['source.json']);
  need(source.schema==='stellar-forge.public-safe-receiving-source.v1','PUBLIC_SAFE_SOURCE_SCHEMA_INVALID');
  validateObservation(observation,input,source);contextMatches(context,observation.context);
  const selection=await openSelection(join(directory,'selection'));
  bindSelection(selection,source,observation,input);
  need(isDeepStrictEqual(manifest,recordManifest(manifest.files,selection)),'PUBLIC_SAFE_RECORD_ID_CHANGED');
  await allowOnly(directory,[...ROOT_FILES,'selection','receiving.json'],
    [...ROOT_FILES.map(name=>bytes[name]),manifestBytes]);
  await allowOnly(join(directory,'selection'),SELECTION_FILES,SELECTION_FILES.map(name=>bytes['selection/'+name]));
  return {id:manifest.id,directory,manifest,input,source,observation,context,selection,bytes,
    contextFile:join(directory,'selected-context.json'),sourceFile:join(directory,'source.json')};
}
export function describePublicSafeRecord(record){
  return {schema:PUBLIC_SAFE_RECORD_SCHEMA,id:record.id,directory:record.directory,
    source:record.source.source,sourceExecutionDate:record.source.executionDate,
    networkId:record.context.networkId,outerTransactionHash:record.observation.outer.hash,
    outerBlockHash:record.observation.outer.blockHash,context:record.context,contextFile:record.contextFile,
    runtime:record.observation.runtime,rpcOrigin:record.input.rpcOrigin,
    representation:record.observation.representation,
    selection:describeSelection(record.selection),files:record.manifest.files};
}

/** One retained source receive. Repeating a completed directory only reopens it. */
export async function receivePublicSafe({directory,callerRoot,rpc,sourceFile=DEFAULT_PUBLIC_SAFE_SOURCE,
  label='Original Gnosis Safe owner replacement, nonce 5'}){
  need(typeof label==='string'&&label.length<=160,'PUBLIC_SAFE_LABEL_INVALID');
  callerRoot=await realpath(absolute(callerRoot));
  const sourceBytes=await sourceBytesAt(sourceFile),source=parseJson(sourceBytes),
    input=inputIdentity({sourceSha256:digest(sourceBytes),callerRoot,label,rpcOrigin:rpcOrigin(rpc)}),
    inputBytes=jsonBytes(input);
  directory=await directoryAt(directory,true);
  const oldInput=await optionalBytes(join(directory,'receiving-input.json'),16384);
  if(oldInput)need(oldInput.equals(inputBytes),'PUBLIC_SAFE_RECEIVING_INPUT_CHANGED');
  else await allowOnly(directory,[],[inputBytes]);
  await exactWrite(join(directory,'receiving-input.json'),inputBytes);
  if(await optionalBytes(join(directory,'receiving.json'),65536)){
    const record=await openPublicSafeRecord(directory);
    need(record.input.id===input.id,'PUBLIC_SAFE_RECEIVING_INPUT_CHANGED');return record;
  }
  await exactWrite(join(directory,'source.json'),sourceBytes);
  let observedBytes=await optionalBytes(join(directory,'observation.json'),LIMITS['observation.json']);
  let observation,selected;
  try{
    if(observedBytes){
      observation=parseJson(observedBytes);validateObservation(observation,input,source);
      selected=await reopenPublicSafe({callerRoot,rpc,sourceFile:join(directory,'source.json'),
        outer:observation.outer,receipt:observation.receipt,context:observation.context});
    }else{
      selected=await readPublicSafe({callerRoot,rpc,sourceFile:join(directory,'source.json')});
      observation={schema:PUBLIC_SAFE_OBSERVATION_SCHEMA,inputId:input.id,sourceSha256:input.sourceSha256,
        representation:'canonical JSON of Protocol Kit external-provider JSON-RPC result objects',
        outer:ordered(selected.outer),receipt:ordered(selected.receipt),context:selected.context,runtime:ordered(selected.runtime)};
      validateObservation(observation,input,source);observedBytes=jsonBytes(observation);
      need(observedBytes.length<=LIMITS['observation.json'],'PUBLIC_SAFE_OBSERVATION_TOO_LARGE');
      try{await writeBytes(join(directory,'observation.json'),observedBytes,{exclusive:true});}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        const winner=await readBytes(join(directory,'observation.json'),LIMITS['observation.json']);
        if(!winner.equals(observedBytes)){
          observation=parseJson(winner);validateObservation(observation,input,source);
          await selected.close();selected=null;
          selected=await reopenPublicSafe({callerRoot,rpc,sourceFile:join(directory,'source.json'),
            outer:observation.outer,receipt:observation.receipt,context:observation.context});
        }
        observedBytes=winner;
      }
    }
    // Always capture the original saved context, even when reopening with a live SDK.
    const selection=await prepareSafeSelection({directory:join(directory,'selection'),safe:selected.safe,
      transaction:selected.transaction,context:observation.context,label:input.label,origin:selected.origin});
    bindSelection(selection,source,observation,input);
    await exactWrite(join(directory,'selected-context.json'),jsonBytes(observation.context));
    const bytes=await memberBytes(directory);
    const manifest=recordManifest(Object.fromEntries(MEMBERS.map(name=>[name,descriptor(bytes[name])])),selection);
    const manifestBytes=jsonBytes(manifest);
    await allowOnly(directory,[...ROOT_FILES,'selection','receiving.json'],
      [...ROOT_FILES.map(name=>bytes[name]),manifestBytes]);
    await exactWrite(join(directory,'receiving.json'),manifestBytes);
    await syncDirectory(directory);
    return openPublicSafeRecord(directory);
  }finally{if(selected)await selected.close();}
}

/** Hydrate the existing caller SDK against the saved original observation. */
export async function loadRetainedPublicSafe({directory,expectedRecordId,callerRoot,rpc,context}){
  const record=await openPublicSafeRecord(directory);
  need(HASH.test(expectedRecordId)&&record.id===expectedRecordId,'PUBLIC_SAFE_CALLER_RECORD_CHANGED');
  contextMatches(context,record.context);
  const selected=await reopenPublicSafe({callerRoot:absolute(callerRoot),rpc,sourceFile:record.sourceFile,
    outer:record.observation.outer,receipt:record.observation.receipt,context:record.context});
  try{
    const captured=await captureSafeTransaction({safe:selected.safe,transaction:selected.transaction,
      context:record.context,label:record.input.label,origin:selected.origin});
    need(jsonBytes(captured.record).equals(record.selection.bytes['safe-transaction.json'])&&
      jsonBytes(captured.body).equals(record.selection.bytes['simulation.json']),
      'PUBLIC_SAFE_REOPENED_SDK_SELECTION_CHANGED');
    return {safe:selected.safe,transaction:selected.transaction,label:record.input.label,
      origin:selected.origin,close:selected.close};
  }catch(error){await selected.close();throw error;}
}

/** A small native caller module; credentials remain in the caller's environment. */
export async function writePublicSafeCaller({directory,out,callerRoot,rpcEnvironment=DEFAULT_RPC_ENVIRONMENT}){
  const record=await openPublicSafeRecord(directory);
  callerRoot=await realpath(absolute(callerRoot??record.input.callerRoot));
  out=absolute(out);need(ENV.test(rpcEnvironment),'PUBLIC_SAFE_RPC_ENVIRONMENT_INVALID');
  const inside=relative(record.directory,out);
  need(inside==='..'||inside.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(inside),
    'PUBLIC_SAFE_CALLER_MUST_BE_OUTSIDE_RECORD');
  await privateDirectory(dirname(out));
  need(await realpath(dirname(out))===dirname(out),'PUBLIC_SAFE_CALLER_DIRECTORY_SYMLINK');
  const moduleURL=pathToFileURL(fileURLToPath(import.meta.url)).href;
  const code='// Original public Safe receiving caller. Regenerate with public-caller after moving the installation.\n'+
    'import {loadRetainedPublicSafe,publicSafeRPC} from '+JSON.stringify(moduleURL)+';\n'+
    'export async function loadTransaction({context}) {\n'+
    '  return loadRetainedPublicSafe({directory:'+JSON.stringify(record.directory)+',expectedRecordId:'+JSON.stringify(record.id)+
    ',callerRoot:'+JSON.stringify(callerRoot)+',context,rpc:publicSafeRPC({rpcEnvironment:'+
    JSON.stringify(rpcEnvironment)+'})});\n}\n';
  await exactWrite(out,Buffer.from(code));await syncDirectory(dirname(out));
  return {moduleFile:out,moduleSha256:digest(Buffer.from(code)),contextFile:record.contextFile,
    recordId:record.id,selectionId:record.selection.id,callerRoot,rpcEnvironment,
    context:record.context,captureInterface:'loadTransaction({context})'};
}
