// MIT. One owned read of original retained JSON through the existing Decimal parser.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {need,object} from '../node/store.mjs';

export const RESEARCH_SOURCE_VALUES='sf88-research-source-values/v1';
export const RESEARCH_SOURCE_VALUES_REQUEST='sf88-research-source-values-request/v1';
export const MAX_RESEARCH_SOURCE_BYTES=16*1024*1024;
const MAX_RESPONSE=64*1024*1024,MAX_REQUEST=6*MAX_RESEARCH_SOURCE_BYTES+1024*1024;
const SCRIPT=fileURLToPath(new URL('./research-source-values.py',import.meta.url));
const HASH=/^[a-f0-9]{64}$/,CODE=/^[A-Z][A-Z0-9_]{0,119}$/;
const NUMBER=/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,cause)=>Object.assign(new Error(code,cause?{cause}:undefined),{code});
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

function checkTyped(root){
  const stack=[root];let count=0;
  while(stack.length){
    const value=stack.pop();
    need(++count<=2000000&&Array.isArray(value)&&value.length===2,'RESEARCH_SOURCE_TYPED_VALUE_INVALID');
    const [type,body]=value;
    if(type==='number')need(typeof body==='string'&&NUMBER.test(body),'RESEARCH_SOURCE_TYPED_VALUE_INVALID');
    else if(type==='str')need(typeof body==='string','RESEARCH_SOURCE_TYPED_VALUE_INVALID');
    else if(type==='bool')need(typeof body==='boolean','RESEARCH_SOURCE_TYPED_VALUE_INVALID');
    else if(type==='NoneType')need(body===null,'RESEARCH_SOURCE_TYPED_VALUE_INVALID');
    else if(type==='array'){
      need(Array.isArray(body),'RESEARCH_SOURCE_TYPED_VALUE_INVALID');
      for(const item of body)stack.push(item);
    }else if(type==='object'){
      need(Array.isArray(body),'RESEARCH_SOURCE_TYPED_VALUE_INVALID');
      const keys=new Set();
      for(const item of body){
        need(Array.isArray(item)&&item.length===2&&typeof item[0]==='string'&&!keys.has(item[0]),'RESEARCH_SOURCE_TYPED_VALUE_INVALID');
        keys.add(item[0]);stack.push(item[1]);
      }
    }else throw fail('RESEARCH_SOURCE_TYPED_VALUE_INVALID');
  }
}

export async function resolveResearchSourcePointers(input,{python='python3',signal,timeoutMs=120000}={}){
  need(exact(input,['rawText','expectedSha256','expectedBytes','pointers']),'RESEARCH_SOURCE_VALUES_REQUEST_INVALID');
  const {rawText,expectedSha256,expectedBytes,pointers}=input;
  need(typeof rawText==='string'&&HASH.test(expectedSha256??'')&&Number.isSafeInteger(expectedBytes)&&
    expectedBytes>0&&expectedBytes<=MAX_RESEARCH_SOURCE_BYTES,'RESEARCH_SOURCE_TEXT_REQUIRED');
  const raw=Buffer.from(rawText,'utf8');
  need(raw.length===expectedBytes&&digest(raw)===expectedSha256,'RESEARCH_SOURCE_BYTES_CHANGED');
  need(Array.isArray(pointers)&&pointers.length>0&&pointers.length<=512&&pointers.every(pointer=>
    typeof pointer==='string'&&pointer.length<=4096&&(pointer===''||pointer.startsWith('/'))&&
    !/~(?![01])/.test(pointer))&&pointers.reduce((sum,pointer)=>sum+pointer.length,0)<=262144,
    'RESEARCH_SOURCE_POINTERS_REQUIRED');
  need(typeof python==='string'&&python.length>0&&!/[\u0000-\u001f\u007f]/.test(python),
    'RESEARCH_SOURCE_PYTHON_INVALID');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=900000,'RESEARCH_SOURCE_TIMEOUT_INVALID');
  need(signal===undefined||signal&&typeof signal.addEventListener==='function'&&typeof signal.throwIfAborted==='function',
    'RESEARCH_SOURCE_SIGNAL_INVALID');
  signal?.throwIfAborted();
  const request=Buffer.from(JSON.stringify({schema:RESEARCH_SOURCE_VALUES_REQUEST,...input})+'\n');
  need(request.length<=MAX_REQUEST,'RESEARCH_SOURCE_VALUES_REQUEST_TOO_LARGE');

  const child=spawn(python,[SCRIPT,'--stdio'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const chunks=[];let outputBytes=0,errorBytes=0,spawnError,writeError,stopCode,killTimer;
  const end=()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
  const stop=code=>{
    stopCode??=code;end();
    if(!killTimer){killTimer=setTimeout(()=>{
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    },5000);killTimer.unref();}
  };
  const onAbort=()=>stop('OPERATION_ABORTED');
  const deadline=setTimeout(()=>stop('RESEARCH_SOURCE_VALUES_TIMEOUT'),timeoutMs);deadline.unref();
  const completion=new Promise(done=>{
    child.once('error',error=>{spawnError=error;});
    child.once('close',(exitCode,exitSignal)=>done({exitCode,exitSignal}));
  });
  child.stdout.on('data',data=>{
    if(outputBytes+data.length>MAX_RESPONSE){stop('RESEARCH_SOURCE_VALUES_RESPONSE_TOO_LARGE');return;}
    outputBytes+=data.length;chunks.push(data);
  });
  child.stderr.on('data',data=>{
    errorBytes+=data.length;if(errorBytes>65536)stop('RESEARCH_SOURCE_VALUES_DIAGNOSTIC_TOO_LARGE');
  });
  child.stdin.on('error',error=>{writeError=error;});
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)onAbort();
  child.stdin.end(request);
  let result;
  try{result=await completion;}
  finally{
    clearTimeout(deadline);if(killTimer)clearTimeout(killTimer);
    signal?.removeEventListener('abort',onAbort);
  }
  if(signal?.aborted)throw fail('OPERATION_ABORTED',signal.reason);
  if(stopCode)throw fail(stopCode);
  if(spawnError)throw fail('RESEARCH_SOURCE_PYTHON_UNAVAILABLE',spawnError);
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,outputBytes)));}
  catch(error){throw fail('RESEARCH_SOURCE_VALUES_RESPONSE_INVALID',error);}
  if(result.exitCode!==0){
    throw fail(value?.schema===RESEARCH_SOURCE_VALUES&&CODE.test(value.error??'')?value.error:'RESEARCH_SOURCE_VALUES_FAILED');
  }
  if(writeError)throw fail('RESEARCH_SOURCE_VALUES_REQUEST_INTERRUPTED',writeError);
  need(exact(value,['schema','sourceSha256','sourceBytes','parser','values'])&&value.schema===RESEARCH_SOURCE_VALUES&&
    value.sourceSha256===expectedSha256&&value.sourceBytes===expectedBytes&&
    exact(value.parser,['module','sha256'])&&value.parser.module==='clinical-trials-packet.py'&&HASH.test(value.parser.sha256??'')&&
    Array.isArray(value.values)&&value.values.length===pointers.length,'RESEARCH_SOURCE_VALUES_RESPONSE_CHANGED');
  for(let index=0;index<value.values.length;index++){
    const row=value.values[index];
    need(object(row)&&typeof row.found==='boolean'&&row.pointer===pointers[index]&&
      exact(row,row.found?['pointer','found','typedValue']:['pointer','found']),'RESEARCH_SOURCE_VALUES_RESPONSE_CHANGED');
    if(row.found)checkTyped(row.typedValue);
  }
  return value;
}
