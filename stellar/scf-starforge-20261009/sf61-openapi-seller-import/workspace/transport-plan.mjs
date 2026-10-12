// MIT. Merchant plan selections for the original host transport compiler.
import {compileUpstreamTransports,upstreamTransportReferences} from '../../sf30-seller-sdk/upstream-transports.mjs';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);

/** Pure references: the original compiler validates all named profiles and uses. */
export function merchantTransportPlan(plan) {
  if(!plain(plan)||!Array.isArray(plan.operations))throw new TypeError('Select the original merchant operations');
  const bindings=Object.fromEntries(plan.operations.map((row,index)=>{
    if(!plain(row))throw new TypeError('Select an original operation for each transport');
    return ['operation_'+index,own(row,'transport')?{transport:row.transport}:{}];
  }));
  const profiles=compileUpstreamTransports(plan.transports,bindings);
  const transports=Object.fromEntries(Object.entries(profiles).map(([alias,profile])=>[alias,
    profile.mode==='direct'?{mode:'direct'}:{mode:'environment-proxy',proxyEnv:profile.proxyEnv}]));
  return {profiles,transports,environment:upstreamTransportReferences({transports,bindings})};
}

/**
 * A reviewed subset inherits only profiles used by its retained operations.
 * Call after the original complete baseline has passed prepareMerchant.
 * This also keeps the source-refresh engine's one-operation comparisons valid.
 */
export function merchantPlanForOperations(plan,operations) {
  const next={...structuredClone(plan),operations:structuredClone(operations)};
  if(plan.transports!==undefined) {
    const used=new Set(operations.map(row=>row.transport).filter(value=>value!==undefined));
    const entries=Object.entries(plan.transports).filter(([alias])=>used.has(alias));
    if(entries.length)next.transports=Object.fromEntries(entries.map(([alias,value])=>[alias,structuredClone(value)]));
    else delete next.transports;
  }
  return next;
}

/** Current configured bindings from the original saved upstream input. */
export function merchantTransportSummary(upstreams) {
  const profiles=compileUpstreamTransports(upstreams.transports,upstreams.bindings);
  return Object.entries(upstreams.bindings).map(([binding,value])=>{
    const profile=value.transport===undefined?null:profiles[value.transport];
    return {binding,method:value.method??'GET',path:value.path,
      profile:profile?.profile??null,mode:profile?.mode??'direct',
      ...(profile?.proxyEnv?{proxyEnv:profile.proxyEnv}:{})};
  });
}
