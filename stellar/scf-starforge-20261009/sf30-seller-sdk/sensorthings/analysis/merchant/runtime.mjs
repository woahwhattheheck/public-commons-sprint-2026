// SPDX-License-Identifier: MIT
// Host-only configuration for the existing SensorThings listener.
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../../../stellar-expert/store.mjs';
import {parseExactJSON} from '../../../stellar-expert/exact-json.mjs';
import {sha,fields,plain,fault} from '../../contract.mjs';
import {merchantRuntime} from './core.mjs';
const SCHEMA='stellar-forge.sensorthings-analysis-merchant-runtime.v1';
function absolute(value,label){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value.includes('\0'))
    throw fault('ANALYSIS_MERCHANT_RUNTIME','Use the exact absolute host '+label+'.',422);
  return value;
}
/** The host selects this configuration; browser actions cannot choose files or code. */
export async function readMerchantRuntime(filename,{environment=process.env,signal}={}){
  absolute(filename,'runtime configuration file');
  const raw=await readOwned(filename,65536),text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  parseExactJSON(text);const input=JSON.parse(text);
  fields(input,['schema','port','maxInFlight','drainGraceMs','operationsAccessFile','nativeFactoryModule'],['schema']);
  if(input.schema!==SCHEMA)throw fault('ANALYSIS_MERCHANT_RUNTIME','Use the original merchant runtime schema.',422);
  const runtime={...Object.fromEntries(['port','maxInFlight','drainGraceMs','operationsAccessFile'].filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]])),signal};
  let nativeFactorySource=null;
  if(input.operationsAccessFile)absolute(input.operationsAccessFile,'original Operations access file');
  if(input.nativeFactoryModule!==undefined&&input.nativeFactoryModule!==null){
    const selected=input.nativeFactoryModule;
    fields(selected,['path','sha256','bytes','exportName'],['path','sha256','bytes','exportName']);
    absolute(selected.path,'reviewed native factory module');
    if(!/^[a-f0-9]{64}$/.test(selected.sha256??'')||!Number.isSafeInteger(selected.bytes)||selected.bytes<1||selected.bytes>2*1024*1024||
        !/^[A-Za-z_$][A-Za-z0-9_$]{0,99}$/.test(selected.exportName??''))
      throw fault('ANALYSIS_MERCHANT_RUNTIME','Select the exact reviewed native factory module and export.',422);
    const source=await readOwned(selected.path,2*1024*1024);
    if(source.length!==selected.bytes||sha(source)!==selected.sha256)
      throw fault('ANALYSIS_MERCHANT_RUNTIME_CHANGED','The selected host native factory source changed.',409);
    const moduleUrl=pathToFileURL(selected.path);moduleUrl.searchParams.set('sourceSha256',selected.sha256);
    const module=await import(moduleUrl.href);
    const after=await readOwned(selected.path,2*1024*1024);
    if(!after.equals(source)||typeof module[selected.exportName]!=='function')
      throw fault('ANALYSIS_MERCHANT_RUNTIME_CHANGED','The selected host factory export changed.',409);
    // This is explicitly selected, reviewed host application code. Its own
    // dependency and credential provisioning remain the original native host's.
    runtime.nativeFactory=await module[selected.exportName]({environment,signal});
    if(typeof runtime.nativeFactory!=='function')
      throw fault('ANALYSIS_MERCHANT_RUNTIME','The reviewed module must return the original native seller factory.',422);
    nativeFactorySource={path:selected.path,sha256:selected.sha256,bytes:selected.bytes,exportName:selected.exportName,
      meaning:'Selected host module; this is not a claim about all transitive dependencies or payment readiness.'};
  }
  merchantRuntime(runtime);
  return {runtime,identity:{schema:SCHEMA,configurationSha256:sha(raw),configurationBytes:raw.length,
    nativeFactorySource,operationsConfigured:Boolean(input.operationsAccessFile)}};
}
