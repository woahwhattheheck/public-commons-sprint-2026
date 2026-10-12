// MIT. Source-native openTRANS 1.0 adapter on the installed Python XML runtime.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { OpenTransError, projectOpenTransTree, editOpenTransTree, serializeOpenTransTree } from './opentrans-tree.mjs';

export { OpenTransError, openTransSerials, semanticXmlTree } from './opentrans-tree.mjs';
export const OPENTRANS_PROFILE_ID='unite-opentrans-1.0';
export const OPENTRANS_MAX_XML_BYTES=64*1024*1024;
const MAX_NATIVE_REPLY=256*1024*1024;
const MAX_NATIVE_ERROR=64*1024;
const SOURCE_MANIFEST=fileURLToPath(new URL('./source/opentrans-source.json',import.meta.url));
const NATIVE_SCRIPT=fileURLToPath(new URL('./xml-native.py',import.meta.url));
const PYTHON=process.env.STARFORGE_PYTHON||(process.platform==='win32'?'python':'python3');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function snapshot(value,label){
  const active=new Set();
  function inspect(current,depth=0){
    if(current===null||typeof current==='string'||typeof current==='boolean')return;
    if(typeof current==='number'){if(!Number.isFinite(current)||Object.is(current,-0))throw new Error('non-finite or negative-zero JSON number');return;}
    if(typeof current!=='object'||depth>512)throw new Error('non-JSON value or excessive nesting');
    if(active.has(current))throw new Error('cyclic JSON');
    const array=Array.isArray(current),proto=Object.getPrototypeOf(current);
    if(!array&&proto!==Object.prototype&&proto!==null)throw new Error('non-plain JSON object');
    if(Object.getOwnPropertySymbols(current).length)throw new Error('symbol JSON property');
    active.add(current);
    const descriptors=Object.getOwnPropertyDescriptors(current),keys=Object.keys(descriptors);
    if(array&&keys.length!==current.length+1)throw new Error('sparse or extended JSON array');
    for(const key of keys){
      if(array&&key==='length')continue;
      const descriptor=descriptors[key];
      if(!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw new Error('non-data JSON property');
      if(array&&(!/^(?:0|[1-9][0-9]*)$/.test(key)||Number(key)>=current.length))throw new Error('extended JSON array');
      inspect(descriptor.value,depth+1);
    }
    active.delete(current);
  }
  try{
    inspect(value);
    const encoded=JSON.stringify(value);
    if(encoded===undefined)throw new Error('missing JSON');
    if(Buffer.byteLength(encoded)>MAX_NATIVE_REPLY)throw new Error('too large');
    return JSON.parse(encoded);
  }catch(error){throw new OpenTransError('OPENTRANS_JSON',label+' must be complete finite JSON.',422,{cause:error.message});}
}
function sourceBytes(value){
  if(!Buffer.isBuffer(value)&&!(value instanceof Uint8Array))throw new OpenTransError('OPENTRANS_INPUT','Pass the complete original XML bytes as a Buffer or Uint8Array.');
  if(value.byteLength>OPENTRANS_MAX_XML_BYTES)throw new OpenTransError('OPENTRANS_XML_BYTES','Original XML intake supports at most 64 MiB per complete document.',413,{maximum:OPENTRANS_MAX_XML_BYTES});
  return Buffer.from(value); // The caller cannot mutate the selected bytes while Python reads.
}
function inputName(value){
  if(value===undefined)return'source.xml';
  if(typeof value!=='string'||!value||[...value].length>1024||value.includes('\0'))throw new OpenTransError('OPENTRANS_INPUT_NAME','Give the complete original source filename.');
  return value;
}
async function native(bytes,{signal,describe=false}={}){
  signal?.throwIfAborted();
  const child=spawn(PYTHON,[NATIVE_SCRIPT,'--manifest',SOURCE_MANIFEST,...(describe?['--describe',describe]:[])],{
    stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false
  });
  let fault=null,exitCode=null,exitSignal=null,stdoutBytes=0,stderrBytes=0,killTimer=null;
  const stdout=[],stderr=[];
  let resolveClose;
  const closed=new Promise(resolve=>{resolveClose=resolve;});
  const stop=error=>{
    if(!fault)fault=error;
    if(child.exitCode===null&&child.signalCode===null){
      child.kill('SIGTERM');
      if(!killTimer){killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);killTimer.unref?.();}
    }
  };
  child.on('error',error=>{if(!fault)fault=new OpenTransError('OPENTRANS_NATIVE_START','The installed Python XML runtime could not start.',503,{cause:error.message,executable:PYTHON});});
  child.on('close',(code,killed)=>{exitCode=code;exitSignal=killed;resolveClose();});
  child.stdout.on('data',chunk=>{
    stdoutBytes+=chunk.length;
    if(stdoutBytes>MAX_NATIVE_REPLY){stop(new OpenTransError('OPENTRANS_NATIVE_REPLY_LIMIT','The complete XML tree exceeds the native structured reply limit.',413));return;}
    stdout.push(chunk);
  });
  child.stderr.on('data',chunk=>{
    const remaining=MAX_NATIVE_ERROR-stderrBytes;
    if(remaining>0){const selected=chunk.subarray(0,remaining);stderr.push(selected);stderrBytes+=selected.length;}
  });
  const aborted=()=>stop(signal.reason??new OpenTransError('OPENTRANS_ABORTED','The original XML operation was cancelled.',499));
  signal?.addEventListener('abort',aborted,{once:true});
  const timeout=setTimeout(()=>stop(new OpenTransError('OPENTRANS_NATIVE_TIMEOUT','The original XML parser exceeded its 120-second processing lifetime.',504)),120000);timeout.unref?.();
  const feed=pipeline(Readable.from((function*(){
    if(!describe)for(let offset=0;offset<bytes.length;offset+=64*1024)yield bytes.subarray(offset,Math.min(bytes.length,offset+64*1024));
  })()),child.stdin).then(()=>null,error=>error);
  try{
    if(signal?.aborted)aborted();
    await closed;
    const feedError=await feed;
    if(fault)throw fault;
    let answer;
    try{answer=JSON.parse(Buffer.concat(stdout,stdoutBytes).toString('utf8'));}
    catch{throw new OpenTransError('OPENTRANS_NATIVE_RESULT','The original XML parser did not return its complete result.',503,{exitCode,exitSignal,stderr:Buffer.concat(stderr).toString('utf8')});}
    if(!answer?.ok){
      const error=answer?.error??{};
      throw new OpenTransError(error.code??'OPENTRANS_NATIVE_ERROR',error.message??'The original XML could not be parsed.',String(error.code??'').startsWith('OPENTRANS_SOURCE')?503:422,error.details);
    }
    if(exitCode!==0)throw new OpenTransError('OPENTRANS_NATIVE_EXIT','The original XML parser ended without completing its successful lifetime.',503,{exitCode,exitSignal});
    if(feedError)throw new OpenTransError('OPENTRANS_INPUT_STREAM','The complete original XML input did not reach the parser.',503,{cause:feedError.message});
    return answer.result;
  }finally{
    clearTimeout(timeout);
    if(killTimer)clearTimeout(killTimer);
    signal?.removeEventListener('abort',aborted);
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
    child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
    await feed;
  }
}
function keepLayout(value){
  const layout=value?.layout;
  if(!layout||layout.schema!=='stellar-forge.opentrans-dtd-layout.v1'||!/^[0-9a-f]{64}$/.test(layout.manifestSha256))
    throw new OpenTransError('OPENTRANS_DTD_LAYOUT','The installed original DTD did not return its complete layout.',503);
  return layout;
}
export async function parseOpenTransDocument(bytes,{name,provenance=null,signal}={}){
  const selected=sourceBytes(bytes),selectedName=inputName(name),origin=snapshot(provenance,'Original provenance');
  const parsed=await native(selected,{signal});
  if(parsed?.source?.bytes!==selected.length||parsed?.source?.sha256!==sha(selected))
    throw new OpenTransError('OPENTRANS_INPUT_IDENTITY','The native parser result does not match the complete selected source bytes.',503);
  keepLayout(parsed);
  return projectOpenTransTree(parsed,{name:selectedName,provenance:origin});
}
export async function renderOpenTransDocument(document,{name,provenance,signal}={}){
  const selected=snapshot(document,'The complete selected document');
  signal?.throwIfAborted();
  const described=await native(Buffer.alloc(0),{signal,describe:selected.kind}),layout=keepLayout(described);
  if(selected.raw&&selected.validation?.manifestSha256&&selected.validation.manifestSha256!==layout.manifestSha256)
    throw new OpenTransError('OPENTRANS_DTD_SOURCE_CHANGED','The installed original DTD source differs from this retained document. Reopen the selected profile before preparing another revision.',409);
  const edited=editOpenTransTree(selected,layout),text=serializeOpenTransTree(edited.raw),bytes=Buffer.from(text,'utf8');
  if(bytes.length>OPENTRANS_MAX_XML_BYTES)throw new OpenTransError('OPENTRANS_XML_BYTES','The complete prepared document exceeds 64 MiB.',413);
  const emitted=await parseOpenTransDocument(bytes,{
    name:name??selected.source?.name??selected.kind+'.xml',
    provenance:provenance??{kind:'derived-original-document',profileId:OPENTRANS_PROFILE_ID,source:selected.source??null},
    signal
  });
  return{bytes,document:emitted,findings:[...edited.findings,...emitted.findings]};
}
