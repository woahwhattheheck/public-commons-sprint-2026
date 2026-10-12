// MIT. Saved configuration contains environment references, never credentials.
import { readBytes, fail, exact, object, bound, digest, identity } from './common.mjs';
import { compileRisingWaveQueries } from './declaration.mjs';
const ENV=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export function validateRisingWaveSource(raw){
  exact(raw,['schema','connectionStringEnv','tls','caFileEnv','allowLocal','maxInFlight','queryTimeoutMs','queries'],'RISINGWAVE_SOURCE_FIELDS_INVALID');
  if(raw.schema!=='stellar-forge.risingwave-source.v1'||!ENV.test(raw.connectionStringEnv??''))throw fail('RISINGWAVE_SOURCE_SCHEMA_INVALID');
  if(raw.caFileEnv!==undefined&&!ENV.test(raw.caFileEnv))throw fail('RISINGWAVE_CA_ENV_INVALID');
  if(raw.tls!==undefined&&!['require','disable'].includes(raw.tls)||raw.allowLocal!==undefined&&typeof raw.allowLocal!=='boolean')
    throw fail('RISINGWAVE_CONNECTION_OPTIONS_INVALID');
  if(raw.tls==='disable'&&raw.caFileEnv)throw fail('RISINGWAVE_CA_REQUIRES_TLS');
  compileRisingWaveQueries(raw.queries);
  return {...structuredClone(raw),tls:raw.tls??'require',allowLocal:raw.allowLocal??false,
    maxInFlight:bound(raw.maxInFlight??1,1,8,'RISINGWAVE_CONCURRENCY_INVALID'),
    queryTimeoutMs:bound(raw.queryTimeoutMs??30000,1000,900000,'RISINGWAVE_QUERY_TIMEOUT_INVALID')};
}
export async function readRisingWaveSourceFile(filename){
  const original=await readBytes(filename,1048576,true);let config;
  try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));}catch{throw fail('RISINGWAVE_SOURCE_JSON_INVALID');}
  validateRisingWaveSource(config);
  return {config,sourceHash:digest(original),sourceConfigHash:identity(config),sourceFile:filename};
}
export async function openRisingWaveSourceFile(filename,options={}){
  const saved=await readRisingWaveSourceFile(filename);
  const {createRisingWaveQuerySource}=await import('./source.mjs');
  const source=createRisingWaveQuerySource(saved.config,{...options,sourceHash:saved.sourceHash,sourceFile:filename});
  return {config:saved.config,source};
}
