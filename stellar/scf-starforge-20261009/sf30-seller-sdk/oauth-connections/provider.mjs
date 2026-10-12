// MIT. Reviewed authorization-code grants for the original SF30 credential seam.
// The original seller still owns payment admission, backend calls and caching.
import { isAbsolute, resolve } from 'node:path';
import { lookup as systemLookup } from 'node:dns/promises';
import { compileOAuthConnection } from './profile.mjs';
import { getOAuthAccessToken } from './connection.mjs';

const issue = code => Object.assign(new Error(code), { name:'OAuthConnectionError', code });
const safeCode = error => /^OAUTH_[A-Z0-9_]{1,100}$/.test(error?.code ?? '')
  ? error.code : 'OAUTH_CONNECTION_UNAVAILABLE';

/** Construction reads only the named directory setting. No private file or
 * network is opened until the original paid handler asks for credentials. */
export function createOAuthConnectionProvider(raw, {
  resourceOrigin, allowLoopback=false, env=process.env, lookup=systemLookup, agent,
}={}) {
  if (env === null || typeof env !== 'object' || Array.isArray(env) || typeof lookup !== 'function')
    throw new TypeError('Invalid OAuth connection runtime');
  const binding = compileOAuthConnection(raw,{resourceOrigin,allowLoopback});
  function configuredDirectory() {
    const value = Object.hasOwn(env,binding.directoryEnv) ? env[binding.directoryEnv] : undefined;
    if (typeof value !== 'string' || value.length > 4096 || !isAbsolute(value) ||
        resolve(value) !== value || /[\x00-\x1f\x7f]/.test(value))
      throw issue('OAUTH_CONNECTION_DIRECTORY_UNAVAILABLE');
    return value;
  }
  const directory = configuredDirectory(), lifetime = new AbortController();
  const totals = {tokenRequests:0,cacheHits:0,renewals:0,failures:0,cancellations:0,invalidations:0};
  let closed=false, closing=null, pending=null, version=0, invalidationVersion=0;
  let authorization=null, rejectedAccessToken=null, expiresAt=null, grantGeneration=null, lastError=null, reconnectRequired=false;

  function acquire() {
    const startedInvalidation = invalidationVersion;
    const record = {waiters:0,settled:false,promise:null};
    totals.tokenRequests++;
    record.promise = (async () => {
      if (configuredDirectory() !== directory) throw issue('OAUTH_CONNECTION_DIRECTORY_CHANGED');
      const token = await getOAuthAccessToken(directory,{
        expectedProfileSha256:binding.profileSha256,expectedGrantId:binding.grantId,
        requiredScopes:binding.requiredScopes,resourceOrigin,clientSecretEnv:binding.clientSecretEnv,
        env,allowLoopback,lookup,agent,signal:lifetime.signal,
        force:rejectedAccessToken !== null,rejectedAccessToken,
      });
      if (closed) throw issue('OAUTH_CONNECTION_CLOSED');
      if (configuredDirectory() !== directory) throw issue('OAUTH_CONNECTION_DIRECTORY_CHANGED');
      // A late rejection of the prior bearer cannot hand an already rejected
      // generation to another backend call. The completed renewal remains saved.
      if (startedInvalidation !== invalidationVersion) throw issue('OAUTH_CONNECTION_STATE_CHANGED');
      const next = `Bearer ${token.token}`;
      if (authorization !== next || grantGeneration !== token.generation) version++;
      authorization=next; grantGeneration=token.generation; expiresAt=token.expiresAt;
      rejectedAccessToken=null; lastError=null; reconnectRequired=false;
      if (token.refreshed) totals.renewals++; else totals.cacheHits++;
      return Object.freeze({authorization:next});
    })().catch(error => {
      const code=safeCode(error); lastError=code;
      reconnectRequired=error?.connectionState==='reconnect_required'||/(?:RECONNECT|DISCONNECTED|GRANT_CHANGED|BINDING|PROFILE_CHANGED)/.test(code);
      if (!closed) totals.failures++;
      // Never retain an apparently usable bearer after a local binding failure.
      authorization=null; expiresAt=null;
      throw issue(code);
    }).finally(() => {record.settled=true;if(pending===record)pending=null;});
    record.promise.catch(()=>{}); pending=record; return record;
  }
  function wait(record,signal) {
    if (record.waiters >= 256) return Promise.reject(issue('OAUTH_CONNECTION_WAITER_CAPACITY'));
    record.waiters++;
    return new Promise((resolve,reject) => {
      let done=false;
      const finish=(error,value)=>{
        if(done)return;done=true;record.waiters--;signal?.removeEventListener('abort',abort);
        if(error)reject(error);else resolve(value);
      };
      const abort=()=>{totals.cancellations++;finish(issue('OAUTH_CONNECTION_ABORTED'));};
      if(signal?.aborted)return abort();
      signal?.addEventListener('abort',abort,{once:true});
      record.promise.then(value=>finish(null,value),error=>finish(error));
      // A caller leaving does not interrupt another caller or abandon a rotating
      // refresh token. The bounded original acquisition finishes and persists;
      // owner close aborts it and waits for its recovery state to be recorded.
    });
  }
  const snapshot=()=>{
    const remaining=expiresAt===null?null:Math.max(0,Date.parse(expiresAt)-Date.now());
    const valid=authorization!==null&&(remaining===null||remaining>0)&&rejectedAccessToken===null;
    return Object.freeze({state:closed?'closed':pending?'loading':valid?'ready':
      reconnectRequired?'reconnect_required':'empty',
      hasToken:valid,expiresInMs:remaining===null?null:Math.floor(remaining),
      profileSha256:binding.profileSha256,grantId:binding.grantId,generation:version,...totals,lastError});
  };
  return Object.freeze({
    headers({signal}={}) {
      if(signal!==undefined&&!(signal instanceof AbortSignal))return Promise.reject(issue('OAUTH_CONNECTION_SIGNAL_INVALID'));
      if(closed)return Promise.reject(issue('OAUTH_CONNECTION_CLOSED'));
      if(signal?.aborted){totals.cancellations++;return Promise.reject(issue('OAUTH_CONNECTION_ABORTED'));}
      return wait(pending??acquire(),signal);
    },
    snapshot,generation:()=>version,
    invalidate(expectedAuthorization) {
      if(closed)return snapshot();
      if(expectedAuthorization!==undefined&&expectedAuthorization!==authorization)return snapshot();
      if(authorization!==null){rejectedAccessToken=authorization.slice(7);invalidationVersion++;version++;totals.invalidations++;}
      return snapshot();
    },
    close() {
      if(closing)return closing;
      closed=true;version++;lifetime.abort();
      const owned=pending?.promise;
      closing=(async()=>{if(owned)await owned.catch(()=>{});authorization=null;rejectedAccessToken=null;expiresAt=null;return snapshot();})();
      return closing;
    },
  });
}
