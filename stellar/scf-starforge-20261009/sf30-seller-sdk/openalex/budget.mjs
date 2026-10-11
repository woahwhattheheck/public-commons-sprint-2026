// MIT. Account-wide, per-transaction budget reservations using the maintained SF30 file primitives.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory,atomicJson,readPrivateJson,withPrivateLock} from '../routescan/quota.mjs';
import {sha256,fail} from './config.mjs';

const dayAt=t=>new Date(t).toISOString().slice(0,10);
const resetAt=t=>Date.parse(dayAt(t)+'T00:00:00Z')+86400000;
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
async function optional(path,fallback){try{return await readPrivateJson(path,8388608);}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function openOpenAlexBudget({directory,account,policy}){
  const root=await privateDirectory(join(await privateDirectory(directory),sha256('openalex:'+account)));
  let closed=false,pending=Promise.resolve();
  function transact(work){const task=pending.then(()=>{if(closed)fail('The research budget is closed.',503);return withPrivateLock(root,'budget.lock',work);});pending=task.catch(()=>{});return task;}
  async function state(now=Date.now()){
    const day=dayAt(now),name='day-'+day+'.json';
    const ledger=await optional(join(root,name),{schema:'stellar-forge.openalex-budget.v1',day,settledCredits:0,reservations:{},calls:0,settledCalls:0,recent:[]});
    if(ledger.schema!=='stellar-forge.openalex-budget.v1'||ledger.day!==day||!finite(ledger.settledCredits)||!ledger.reservations||!Array.isArray(ledger.recent))fail('The research budget ledger is invalid.',503,'OPENALEX_BUDGET_INVALID');
    const provider=await optional(join(root,'provider.json'),{blockedUntil:0,observedAt:null,remaining:null,limit:null,resetAt:null});
    const held=Object.values(ledger.reservations).reduce((sum,r)=>sum+r.credits,0);
    if(!finite(held))fail('The research budget reservations are invalid.',503,'OPENALEX_BUDGET_INVALID');
    ledger.recent=ledger.recent.filter(t=>Number.isSafeInteger(t)&&t>now-1000);
    return {day,name,ledger,provider,held,remaining:Math.max(0,policy.creditsPerDay-ledger.settledCredits-held),now};
  }
  function providerBasis(s){
    const p=s.provider,observed=Date.parse(p.observedAt??'');
    if(!Number.isFinite(observed)||observed>s.now||dayAt(observed)!==s.day||!finite(p.remaining))return null;
    const until=finite(p.resetAt)?Math.min(resetAt(s.now),p.resetAt):resetAt(s.now);
    if(until<=s.now)return null;
    const hasWatermark=p.settledCreditsDay===s.day&&finite(p.settledCreditsAtObservation)&&p.settledCreditsAtObservation<=s.ledger.settledCredits;
    // Older observations have no settlement watermark. Charge all retained
    // settlements until a genuine response establishes the new observation.
    const watermark=hasWatermark?p.settledCreditsAtObservation:0;
    const observedCeiling=hasWatermark&&finite(p.admissionRemaining)?Math.min(p.remaining,p.admissionRemaining):p.remaining;
    const settledSince=Math.max(0,s.ledger.settledCredits-watermark);
    const beforeReservations=Math.max(0,observedCeiling-settledSince);
    return {reported:p.remaining,beforeReservations,remaining:Math.max(0,beforeReservations-s.held),settledSince,hasWatermark,resetAt:until};
  }
  function view(s,credits=1){
    const observed=providerBasis(s),remaining=observed?Math.min(s.remaining,observed.remaining):s.remaining;
    const localRetry=s.remaining<credits?Math.ceil((resetAt(s.now)-s.now)/1000):0;
    const observedRetry=observed&&observed.remaining<credits?Math.ceil((observed.resetAt-s.now)/1000):0;
    const rateRetry=s.ledger.recent.length>=policy.requestsPerSecond?1:0;
    const providerRetry=s.provider.blockedUntil>s.now?Math.ceil((s.provider.blockedUntil-s.now)/1000):0;
    const retryAfterSeconds=Math.max(localRetry,observedRetry,rateRetry,providerRetry);
    return {account,day:s.day,creditsPerDay:policy.creditsPerDay,remainingCredits:remaining,
      localRemainingCredits:s.remaining,providerRemainingCredits:observed?.remaining??null,
      observedProviderRemainingCredits:observed?.reported??null,reservedCredits:s.held,
      settledCredits:s.ledger.settledCredits,calls:s.ledger.calls,settledCalls:s.ledger.settledCalls,
      provider:s.provider,allowed:retryAfterSeconds===0,retryAfterSeconds};
  }
  async function snapshot(credits=1){
    if(closed||!finite(credits))fail('The research budget snapshot is invalid.',503);
    return transact(async()=>view(await state(),credits));
  }
  async function reserve(credits){
    if(closed||!finite(credits))fail('The research budget reservation is invalid.',503);
    return transact(async()=>{
      const s=await state(),current=view(s,credits);
      if(!current.allowed)throw Object.assign(new Error('OpenAlex budget or request capacity is unavailable.'),{status:429,code:'OPENALEX_BUDGET_EXHAUSTED',retryAfter:current.retryAfterSeconds});
      const id=randomUUID(),reservation={id,day:s.day,credits,at:s.now};
      s.ledger.reservations[id]=reservation;s.ledger.calls++;s.ledger.recent.push(s.now);
      await atomicJson(root,s.name,s.ledger);
      return reservation;
    });
  }
  async function observe(reservation,response,{dispatched=true}={}){
    return transact(async()=>{
      const file='day-'+reservation.day+'.json';
      const ledger=await readPrivateJson(join(root,file),8388608);
      const original=ledger.reservations[reservation.id];
      if(!original)return {alreadyObserved:true};
      if(original.credits!==reservation.credits)fail('The retained research reservation changed.',503,'OPENALEX_BUDGET_INVALID');
      const headers=response.headers??{},numberHeader=name=>{
        const value=headers[name];return typeof value==='string'&&value.trim()!==''&&finite(Number(value))?Number(value):null;
      };
      let meta=null;
      if(Buffer.isBuffer(response.body))try{meta=JSON.parse(response.body.toString('utf8')).meta;}catch{}
      let charged=numberHeader('x-ratelimit-credits-used'),basis='provider-header';
      if(charged===null&&finite(meta?.cost_usd)){charged=meta.cost_usd*10000;basis='provider-meta-cost-usd';}
      if(charged===null&&finite(meta?.cost)){charged=meta.cost;basis='provider-meta-cost';}
      if(charged===null){charged=dispatched?reservation.credits:0;basis=dispatched?'reservation-estimate':'not-dispatched';}
      ledger.settledCredits+=charged;ledger.settledCalls++;delete ledger.reservations[reservation.id];
      await atomicJson(root,file,ledger);
      const now=Date.now(),current=await state(now),provider=current.provider,previous=providerBasis(current);
      const remaining=numberHeader('x-ratelimit-remaining'),limit=numberHeader('x-ratelimit-limit'),reset=numberHeader('x-ratelimit-reset');
      provider.lastResponseAt=new Date(now).toISOString();
      provider.rawHeaders=Object.fromEntries(['x-ratelimit-remaining','x-ratelimit-limit','x-ratelimit-reset','x-ratelimit-credits-used','retry-after']
        .filter(name=>Object.hasOwn(headers,name)).map(name=>[name,headers[name]]));
      if(limit!==null)provider.limit=limit;
      if(remaining!==null){
        // A late response can report an older, higher balance. Retain that raw
        // value while the admission ceiling also accounts for later settlements.
        const ceiling=previous?.hasWatermark?Math.min(remaining,previous.beforeReservations):remaining;
        Object.assign(provider,{observedAt:new Date(now).toISOString(),remaining,
          resetAt:reset===null?resetAt(now):now+reset*1000,admissionRemaining:ceiling,
          settledCreditsDay:current.day,settledCreditsAtObservation:current.ledger.settledCredits});
      }
      if(response.status===429){
        const value=headers['retry-after'],seconds=/^\d+$/.test(value??'')?Number(value):Number.isFinite(Date.parse(value??''))?Math.max(0,(Date.parse(value)-now)/1000):null;
        provider.blockedUntil=Math.max(provider.blockedUntil??0,now+(seconds??(remaining===0?Math.ceil(((provider.resetAt??resetAt(now))-now)/1000):1))*1000);
      }else if(remaining===0)provider.blockedUntil=Math.max(provider.blockedUntil??0,provider.resetAt??resetAt(now));
      await atomicJson(root,'provider.json',provider);
      return {id:reservation.id,day:reservation.day,chargedCredits:charged,basis,provider};
    });
  }
  return {root,reserve,observe,snapshot,async close(){await pending;closed=true;}};
}
