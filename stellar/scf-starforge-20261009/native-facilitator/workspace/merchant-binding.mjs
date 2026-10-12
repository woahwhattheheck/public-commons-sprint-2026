// MIT. Reviewed private configuration binds the original native agent host.
import {dirname,resolve} from 'node:path';
import {readMerchantConfig} from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import {readNativePrivateFile,nativeOperatorConnectionRecord,normalizeNativeOperatorConfiguration} from './merchant-connection.mjs';
import {createNativeOperatorClient} from './client.mjs';
import {privateDirectory} from './store.mjs';
import {nativeAlias,nativeDigest,nativeCanonicalJSON,nativeOperatorIdentity,requireNative,plain} from './merchant-export-contract.mjs';

export const NATIVE_AGENT_BINDING_SCHEMA='stellar-forge.native-agent-binding.v1';
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const descriptor=(path,bytes)=>({path,bytes:bytes.length,sha256:nativeDigest(bytes)});
/** Inspect original private host files without attaching a listener or starting a process. */
export async function inspectNativeAgentBinding({configPath,operator}={}) {
  requireNative(typeof configPath==='string'&&configPath.length>0,'NATIVE_AGENT_CONFIGURATION_REQUIRED');
  nativeAlias(operator);configPath=resolve(configPath);
  const configBytes=await readNativePrivateFile(configPath);
  const configuration=await readMerchantConfig(configPath);
  const native=configuration.nativeFacilitatorOperators,entry=native?.operators?.[operator];
  requireNative(entry,'NATIVE_AGENT_OPERATOR_NOT_CONFIGURED','Select an original native operator alias in this merchant configuration.');
  const connectionBytes=await readNativePrivateFile(native.path);
  // The original reader and retained raw files must describe the same selection.
  const raw=JSON.parse(decode(configBytes)),rawConnection=JSON.parse(decode(connectionBytes));
  requireNative(typeof raw.nativeFacilitatorOperatorConnection==='string'&&
    resolve(dirname(configPath),raw.nativeFacilitatorOperatorConnection)===native.path&&
    typeof raw.releaseStore==='string'&&resolve(dirname(configPath),raw.releaseStore)===configuration.releaseStore&&
    typeof raw.exportsDirectory==='string'&&resolve(dirname(configPath),raw.exportsDirectory)===configuration.exportsDirectory&&
    plain(rawConnection.operators?.[operator]),
  'NATIVE_AGENT_CONFIGURATION_CHANGED');
  const files=[descriptor(configPath,configBytes),descriptor(native.path,connectionBytes)];
  let receipt=null,operatorOrigin=null;
  if(entry.operatorUrlFile){
    const bytes=await readNativePrivateFile(entry.operatorUrlFile,16384);
    const selected=nativeOperatorConnectionRecord(decode(bytes));
    operatorOrigin=createNativeOperatorClient({operatorUrl:selected.operatorUrl}).origin;
    receipt=selected.identity??null;
    files.push(descriptor(entry.operatorUrlFile,bytes));
  }
  await privateDirectory(configuration.exportsDirectory);
  await privateDirectory(configuration.releaseStore);
  requireNative((await readNativePrivateFile(configPath)).equals(configBytes)&&
    (await readNativePrivateFile(native.path)).equals(connectionBytes),
  'NATIVE_AGENT_CONFIGURATION_CHANGED','Review the same current merchant and native connection files.');
  // Compare the loaded host alias with the original normalizer applied to
  // these exact retained bytes. Other configured providers are read only once.
  const same=normalizeNativeOperatorConfiguration(rawConnection,native.path);
  requireNative(nativeCanonicalJSON(same.operators[operator])===nativeCanonicalJSON(entry),
    'NATIVE_AGENT_CONFIGURATION_CHANGED');
  const body={schema:NATIVE_AGENT_BINDING_SCHEMA,configFile:configPath,operator,
    connectionFile:native.path,connection:{...entry},configurationFiles:files,
    releaseStore:configuration.releaseStore,exportsDirectory:configuration.exportsDirectory,
    operatorOrigin,receipt};
  return Object.freeze({...body,bindingSha256:nativeDigest(nativeCanonicalJSON(body))});
}
/** Return the original private browser URL only to the host launcher. */
export async function nativeAgentAttachment(binding,{environment=process.env}={}) {
  requireNative(binding?.schema===NATIVE_AGENT_BINDING_SCHEMA,'NATIVE_AGENT_BINDING_INVALID');
  const {bindingSha256,...body}=binding;
  requireNative(nativeDigest(nativeCanonicalJSON(body))===bindingSha256,'NATIVE_AGENT_BINDING_CHANGED');
  const entry=binding.connection;let text,sourceSha256;
  if(entry.operatorUrlFile){
    const bytes=await readNativePrivateFile(entry.operatorUrlFile,16384);
    sourceSha256=nativeDigest(bytes);
    requireNative(binding.configurationFiles.some(file=>file.path===entry.operatorUrlFile&&
      file.bytes===bytes.length&&file.sha256===sourceSha256),'NATIVE_AGENT_CONNECTION_CHANGED');
    text=decode(bytes);
  }else text=environment[entry.operatorUrlEnv];
  const selected=nativeOperatorConnectionRecord(text);
  const client=createNativeOperatorClient({operatorUrl:selected.operatorUrl});
  requireNative(!binding.operatorOrigin||binding.operatorOrigin===client.origin,'NATIVE_AGENT_CONNECTION_CHANGED');
  if(binding.receipt)requireNative(selected.identity&&
    nativeCanonicalJSON(nativeOperatorIdentity(selected.identity))===nativeCanonicalJSON(binding.receipt),
  'NATIVE_AGENT_CONNECTION_CHANGED');
  return {operatorUrl:new URL(selected.operatorUrl).href,origin:client.origin,
    sourceSha256,identity:selected.identity??null,expectedInstanceId:entry.instanceId??null};
}
