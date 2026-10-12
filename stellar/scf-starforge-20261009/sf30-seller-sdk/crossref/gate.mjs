// MIT. Shared Crossref pool timing and concurrency using the original private Linux locks.
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {privateDirectory,withPrivateLock,atomicJson,readPrivateJson} from '../routescan/quota.mjs';
import {need,object,sha256,retainedHeaders} from './metadata.mjs';

const SCHEMA='stellar-forge.crossref-gate.v1';
const uint=v=>Number.isSafeInteger(v)&&v>=0;
export const CROSSREF_PUBLIC_LIMITS=Object.freeze({single:{limit:5,intervalMs:1000,concurrency:1},list:{limit:1,intervalMs:1000,concurrency:1}});
export const CROSSREF_POLITE_LIMITS=Object.freeze({single:{limit:10,intervalMs:1000,concurrency:3},list:{limit:3,intervalMs:1000,concurrency:3}});
async function pause(ms,signal){signal?.throwIfAborted();await delay(Math.max(1,Math.min(ms,60000)),undefined,{signal});}
function responseLimits(headers,previous,ceiling){
  const count=Number(headers['x-rate-limit-limit']),match=String(headers['x-rate-limit-interval']??'').match(/^(\d+(?:\.\d+)?)s$/);
  const interval=match?Number(match[1])*1000:NaN,connections=Number(headers['x-concurrency-limit']);
  return {limit:Number.isSafeInteger(count)&&count>0&&count<=100000?Math.min(count,ceiling.limit):previous.limit,
    intervalMs:Number.isFinite(interval)&&interval>=1&&interval<=86400000?Math.ceil(Math.max(interval,ceiling.intervalMs)):previous.intervalMs,
    concurrency:Number.isSafeInteger(connections)&&connections>0?Math.min(connections,ceiling.concurrency):previous.concurrency};
}
export async function openCrossrefGate({directory,account,mailto=null}){
  need(typeof account==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(account),'CROSSREF_ACCOUNT_REQUIRED');
  await privateDirectory(directory);
  const ceilings=mailto?CROSSREF_POLITE_LIMITS:CROSSREF_PUBLIC_LIMITS;
  const identity={account,contactHash:mailto?sha256(mailto.toLowerCase()):null};
  let serial=Promise.resolve(),closed=false,observationFailure=null;
  async function read(){
    let value;
    try{value=await readPrivateJson(join(directory,'crossref-gate.json'));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      return {schema:SCHEMA,...identity,revision:0,pools:Object.fromEntries(Object.entries(ceilings).map(([name,limits])=>
        [name,{...limits,lastDispatchAt:0,nextAt:0,cooldownUntil:0,dispatched:0,lastResponse:null}]))};
    }
    need(object(value)&&value.schema===SCHEMA&&value.account===identity.account&&value.contactHash===identity.contactHash&&
      uint(value.revision)&&object(value.pools),'CROSSREF_GATE_IDENTITY_CHANGED',503);
    for(const name of ['single','list']){
      const p=value.pools[name],ceiling=ceilings[name];
      need(object(p)&&uint(p.lastDispatchAt)&&uint(p.nextAt)&&uint(p.cooldownUntil)&&uint(p.dispatched)&&
        Number.isSafeInteger(p.limit)&&p.limit>0&&p.limit<=ceiling.limit&&
        Number.isSafeInteger(p.intervalMs)&&p.intervalMs>=ceiling.intervalMs&&
        Number.isSafeInteger(p.concurrency)&&p.concurrency>=1&&p.concurrency<=ceiling.concurrency,
        'CROSSREF_GATE_STATE_INVALID',503);
    }
    return value;
  }
  async function locked(work,signal){
    while(true){
      signal?.throwIfAborted();
      try{return await withPrivateLock(directory,'crossref-gate.lock',async()=>work(await read()));}
      catch(error){if(error.code!=='ROUTESCAN_RECORD_BUSY')throw error;await pause(25,signal);}
    }
  }
  function transact(work,signal=AbortSignal.timeout(5000)){
    const result=serial.then(()=>locked(work,signal));serial=result.catch(()=>{});return result;
  }
  async function snapshot(){
    return transact(state=>({schema:SCHEMA,account,mode:mailto?'polite':'public',revision:state.revision,
      capturedAt:new Date().toISOString(),pools:state.pools,error:observationFailure}));
  }
  async function reserve(pool,signal){
    while(true){
      signal?.throwIfAborted();
      need(!closed&&!observationFailure,'CROSSREF_GATE_UNAVAILABLE',503);
      const wait=await transact(async state=>{
        const value=state.pools[pool],now=Date.now(),retryAt=Math.max(value.nextAt,value.cooldownUntil);
        if(retryAt>now)return retryAt-now;
        const next={...state,revision:state.revision+1,pools:{...state.pools,[pool]:{...value,
          lastDispatchAt:now,nextAt:now+Math.ceil(value.intervalMs/value.limit),dispatched:value.dispatched+1}}};
        await atomicJson(directory,'crossref-gate.json',next);return 0;
      },signal);
      if(!wait)return;await pause(wait,signal);
    }
  }
  async function observe(pool,response){
    const headers=retainedHeaders(response.headers),status=response.status;
    try{
      await transact(async state=>{
        const old=state.pools[pool],limits=responseLimits(headers,old,ceilings[pool]),now=Date.now();
        let cooldownUntil=old.cooldownUntil;
        if(status===429){
          const raw=headers['retry-after'];
          const parsed=/^\d+(?:\.\d+)?$/.test(raw??'')?now+Number(raw)*1000:Date.parse(raw);
          cooldownUntil=Math.max(cooldownUntil,Number.isFinite(parsed)&&parsed>now&&parsed<=8640000000000000?Math.ceil(parsed):now+60000);
        }
        await atomicJson(directory,'crossref-gate.json',{...state,revision:state.revision+1,pools:{...state.pools,
          [pool]:{...old,...limits,nextAt:Math.max(old.nextAt,old.lastDispatchAt+Math.ceil(limits.intervalMs/limits.limit)),
            cooldownUntil,lastResponse:{status,headers,observedAt:new Date(now).toISOString()}}}});
      });
    }catch(error){observationFailure=error.code??'CROSSREF_GATE_WRITE_FAILED';throw error;}
  }
  async function run(pool,work,{signal}={}){
    need(['single','list'].includes(pool)&&typeof work==='function','CROSSREF_POOL_INVALID');
    need(signal instanceof AbortSignal,'CROSSREF_REQUEST_LIFETIME_REQUIRED');
    while(true){
      signal.throwIfAborted();need(!closed&&!observationFailure,'CROSSREF_GATE_UNAVAILABLE',503);
      const state=await transact(value=>value,signal),slots=state.pools[pool].concurrency;
      for(let slot=0;slot<slots;slot++){
        let entered=false;
        try{
          return await withPrivateLock(directory,'crossref-'+pool+'-'+slot+'.lock',async()=>{
            entered=true;await reserve(pool,signal);
            const response=await work();await observe(pool,response);return response;
          });
        }catch(error){if(entered||error.code!=='ROUTESCAN_RECORD_BUSY')throw error;}
      }
      await pause(40,signal);
    }
  }
  return {run,snapshot,async close(){closed=true;await serial;}};
}
