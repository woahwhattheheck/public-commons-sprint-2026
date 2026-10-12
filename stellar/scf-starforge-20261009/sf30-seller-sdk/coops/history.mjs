// MIT. Five-year studies reuse bounded original capture editions.
import {makeQuery,requestPlan,text,fault,hashBytes} from './provider.mjs';
import {stable} from '../stellar-expert/store.mjs';
const day=86400000;
function instant(value){const n=Date.parse(value+'T00:00:00Z');if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)throw fault('COOPS_DATE','Use a real YYYY-MM-DD date.');return n;}
export function makeBackfillPlan(profile,input){
 const start=instant(input.beginDate),end=instant(input.endDate),last=new Date(start);last.setUTCFullYear(last.getUTCFullYear()+5);
 if(end<start||end>=last.valueOf())throw fault('COOPS_BACKFILL_WINDOW','Select an inclusive study window of at most five calendar years.');
 const parts=[];for(let a=start,index=0;a<=end;index++){
  const stop=Math.min(end,a+365*day),query=makeQuery(profile,{...input,beginDate:new Date(a).toISOString().slice(0,10),endDate:new Date(stop).toISOString().slice(0,10)}),
   plan=requestPlan(profile,query);parts.push({index,query,planSha256:plan.planSha256,dataRequests:plan.tasks.filter(t=>t.kind==='data').length});a=stop+day;
 }
 const value={schema:'stellar-forge.coops-backfill-plan.v1',profile:structuredClone(profile),label:text(input.label??profile.label,'a study label',200),beginDate:input.beginDate,endDate:input.endDate,
  products:[...input.products],units:input.units,timeZone:input.timeZone,datum:input.datum,predictionInterval:input.predictionInterval??'6',parts,
  partitionBasis:'Consecutive nonoverlapping source editions of at most 366 calendar days. Each edition retains its original request and response history.'};
 return{...value,planSha256:hashBytes(Buffer.from(stable(value)))};
}
