// MIT. Declarative QuestDB connections retain environment references, never credentials.
import { resolve, dirname, join } from 'node:path';
import { fail, exact, object, bounded, readBytes, digest, absolute } from './common.mjs';
import { compileQuestDbQueries, describeQuestDbQueries } from './declaration.mjs';
const ENV=/^[A-Z_][A-Z0-9_]{0,127}$/;
export function validateQuestDbSource(value) {
  exact(value,['schema','endpointEnv','userEnv','passwordEnv','tokenEnv','allowLocal','maxInFlight','startupTimeoutMs','queries'],'QUESTDB_SOURCE_FIELDS_INVALID');
  if(value.schema!=='stellar-forge.questdb-source.v1' || !ENV.test(value.endpointEnv??'') ||
      value.allowLocal!==undefined && typeof value.allowLocal!=='boolean')throw fail('QUESTDB_SOURCE_CONFIG_INVALID');
  const basic=value.userEnv!==undefined || value.passwordEnv!==undefined;
  if(basic && (!ENV.test(value.userEnv??'') || !ENV.test(value.passwordEnv??'') || value.tokenEnv!==undefined) ||
      value.tokenEnv!==undefined && !ENV.test(value.tokenEnv))throw fail('QUESTDB_AUTH_REFERENCES_INVALID');
  bounded(value.maxInFlight??4,1,32,'QUESTDB_CAPACITY_INVALID');
  bounded(value.startupTimeoutMs??10000,100,120000,'QUESTDB_STARTUP_TIMEOUT_INVALID');
  compileQuestDbQueries(value.queries);
  return structuredClone(value);
}
export async function readQuestDbSourceFile(filename) {
  const path=resolve(filename),original=await readBytes(path,1048576);
  let config;
  try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));}
  catch{throw fail('QUESTDB_SOURCE_JSON_INVALID');}
  validateQuestDbSource(config);
  return {path,config,hash:digest(original),bytes:original.length,description:describeQuestDbQueries(compileQuestDbQueries(config.queries))};
}
export function questDbConnection(config,env=process.env) {
  validateQuestDbSource(config);
  const endpoint=env[config.endpointEnv];
  if(typeof endpoint!=='string'||endpoint.length>4096||endpoint.trim()!==endpoint)throw fail('QUESTDB_ENDPOINT_ENV_UNAVAILABLE');
  let url;try{url=new URL(endpoint);}catch{throw fail('QUESTDB_ENDPOINT_INVALID');}
  const local=config.allowLocal===true && url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash||
      !/^\/(?:[A-Za-z0-9_.~-]+\/)*$/.test(url.pathname))throw fail('QUESTDB_ENDPOINT_INVALID','Use an HTTPS base URL, or explicitly allow a loopback HTTP instance.');
  const headers={'accept':'application/json','accept-encoding':'identity','user-agent':'stellar-forge-questdb/1'};
  if(config.userEnv!==undefined) {
    const user=env[config.userEnv],password=env[config.passwordEnv];
    if(typeof user!=='string'||!user||user.includes(':')||user.length>1024||typeof password!=='string'||password.length>8192||
        /[\x00-\x1f\x7f]/.test(user+password))throw fail('QUESTDB_BASIC_AUTH_ENV_UNAVAILABLE');
    headers.authorization='Basic '+Buffer.from(user+':'+password).toString('base64');
  }
  if(config.tokenEnv!==undefined) {
    const token=env[config.tokenEnv];
    if(typeof token!=='string'||!token||token.length>8192||/[\x00-\x20\x7f]/.test(token))throw fail('QUESTDB_TOKEN_ENV_UNAVAILABLE');
    headers.authorization='Bearer '+token;
  }
  return {baseUrl:url.href,headers,authentication:config.tokenEnv?'bearer':config.userEnv?'basic':'none'};
}
export async function openQuestDbSourceFile(filename,options={}) {
  const declaration=await readQuestDbSourceFile(filename);
  const {createQuestDbQuerySource}=await import('./source.mjs');
  const captureDirectory=options.captureDirectory??join(dirname(declaration.path),'questdb-captures');
  absolute(captureDirectory);
  const source=await createQuestDbQuerySource(declaration.config,{...options,captureDirectory,sourceHash:declaration.hash});
  return {...declaration,source};
}
