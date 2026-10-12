// MIT. Host-selected transport profiles for the original upstream exchange.
import {Agent as HttpsAgent} from 'node:https';
import {UPSTREAM_ATTEMPT} from './upstream-handler.mjs';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail=message=>{throw new TypeError(message);};
const name=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)&&
  !['constructor','prototype','__proto__'].includes(value);

/** Data-only review. Proxy values are resolved by the selected host at launch. */
export function compileUpstreamTransports(raw,bindings) {
  if (!plain(bindings)) fail('Transport profiles require original upstream bindings');
  if (raw===undefined) raw={};
  if (!plain(raw)||Object.keys(raw).length>16) fail('Use at most 16 named upstream transports');
  const profiles=Object.create(null),used=new Set();
  for (const [alias,value] of Object.entries(raw)) {
    if (!name(alias)||!plain(value)||Object.keys(value).some(key=>!['mode','proxyEnv'].includes(key))||
      !['direct','environment-proxy'].includes(value.mode)) fail('Invalid named upstream transport');
    if (value.mode==='direct') {
      if (own(value,'proxyEnv')) fail('A direct upstream transport has no proxy environment');
      profiles[alias]=Object.freeze({profile:alias,mode:'direct'});
    } else {
      if (typeof value.proxyEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.proxyEnv))
        fail('An upstream proxy profile requires an environment-variable name');
      profiles[alias]=Object.freeze({profile:alias,mode:'environment-proxy',proxyEnv:value.proxyEnv});
    }
  }
  for (const binding of Object.values(bindings)) {
    if (!plain(binding)) fail('Invalid upstream binding');
    if (binding.transport===undefined) continue;
    if (!name(binding.transport)||!own(profiles,binding.transport)) fail('Unknown upstream transport profile');
    used.add(binding.transport);
  }
  if (Object.keys(profiles).some(alias=>!used.has(alias))) fail('Unused upstream transport profile');
  return Object.freeze(profiles);
}

export function upstreamTransportReferences(config) {
  return Object.freeze([...new Set(Object.values(compileUpstreamTransports(config.transports,config.bindings))
    .filter(profile=>profile.mode==='environment-proxy').map(profile=>profile.proxyEnv))].sort());
}

function proxyValue(profile,env) {
  const value=own(env,profile.proxyEnv)?env[profile.proxyEnv]:undefined;
  let parsed;
  try {
    if (typeof value!=='string'||!value||value.length>8192||/[\r\n\0]/.test(value)) throw new Error();
    parsed=new URL(value);
    if (!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.pathname!=='/'||
      parsed.search||parsed.hash) throw new Error();
  } catch { fail('Missing or invalid proxy environment: '+profile.proxyEnv); }
  return value;
}
function supportsProxyEnv() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  return major>=25||major===24&&minor>=5||major===22&&minor>=21;
}
function stopped() {
  const response={status:503,headers:{'content-type':'application/json','cache-control':'no-store'},
    body:{error:'UPSTREAM_TRANSPORT_CLOSED'}};
  Object.defineProperty(response,UPSTREAM_ATTEMPT,{value:Object.freeze({dispatched:false})});
  return response;
}

/** One original Node Agent per declared profile. This is not an HTTP client. */
export function createUpstreamTransports(compiled,{env=process.env}={}) {
  const agents=new Map(),profiles=new Map(),pending=new Set();
  let closed=false,closing,destroyed=false;
  for (const binding of Object.values(compiled)) if (binding.transport)
    profiles.set(binding.transport.profile,binding.transport);
  try {
    for (const profile of profiles.values()) {
      if (profile.mode==='direct') continue;
      if (!supportsProxyEnv()) fail('Upstream environment proxies require Node 22.21+ or 24.5+');
      const value=proxyValue(profile,env);
      // The selected reference is the whole configuration. NO_PROXY or a
      // differently cased ambient variable cannot silently select direct egress.
      try { agents.set(profile.profile,new HttpsAgent({keepAlive:false,proxyEnv:{HTTPS_PROXY:value}})); }
      catch { fail('Cannot initialize proxy environment: '+profile.proxyEnv); }
    }
  } catch(error) { for (const agent of agents.values()) agent.destroy(); throw error; }
  const api={
    agentFor:profile=>profile===undefined?undefined:agents.get(profile),
    retain(handler,profile) {
      if (!profile) return handler;
      function retained(...args) {
        if (closed) return Promise.resolve(stopped());
        const operation=Promise.resolve().then(()=>handler(...args));
        pending.add(operation);
        operation.then(response=>{
          // Streaming headers return before the original source completes.
          // Keep its original completion promise in the same drain ownership.
          const completion=response?.[UPSTREAM_ATTEMPT]?.completion;
          if (completion&&typeof completion.then==='function') {
            pending.add(completion);
            completion.finally(()=>pending.delete(completion)).catch(()=>{});
          }
        }).finally(()=>pending.delete(operation)).catch(()=>{});
        return operation;
      }
      Object.assign(retained,handler);
      retained.snapshot=()=>Object.freeze({...handler.snapshot(),transport:profile});
      const admit=handler.admit;
      retained.admit=(...args)=>closed?stopped():typeof admit==='function'?admit(...args):true;
      return retained;
    },
    drain() {
      closed=true;
      return closing??=(async()=>{
        while (pending.size) await Promise.allSettled([...pending]);
      })();
    },
    destroy() {
      closed=true;
      if (!destroyed) {destroyed=true;for (const agent of agents.values()) agent.destroy();}
    },
  };
  return Object.freeze(api);
}
