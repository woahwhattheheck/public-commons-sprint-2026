// MIT. Exact redacted observation contract shared by the native resource and Support.
export const OAUTH_OBSERVATION_SCHEMA='stellar-forge.mcp-oauth-observation.v1';
export const OAUTH_STAGES=Object.freeze(['authentication','authorization','hostAuthority','jwks']);
export const OAUTH_OUTCOMES=Object.freeze({
  authentication:['ALLOWED','AUTHORIZATION_REQUIRED','INVALID_REQUEST','INVALID_TOKEN','ACCESS_DENIED','TEMPORARILY_UNAVAILABLE','INTERNAL_ERROR'],
  authorization:['ALLOWED','INVALID_TOKEN','ACCESS_DENIED','INSUFFICIENT_SCOPE','TEMPORARILY_UNAVAILABLE','INTERNAL_ERROR'],
  hostAuthority:['ALLOWED','ACCESS_DENIED','HOST_ERROR'],
  jwks:['HTTP_200','HTTP_429','HTTP_5XX','HTTP_OTHER','TRANSPORT_ERROR']
});
for(const values of Object.values(OAUTH_OUTCOMES))Object.freeze(values);
export const OAUTH_COUNTER_FIELDS=Object.freeze(['started','completed','allowed','denied','unavailable','failed']);
export const oauthOutcomeCategory=(stage,outcome)=>outcome==='ALLOWED'||outcome==='HTTP_200'?'allowed':
  outcome==='TEMPORARILY_UNAVAILABLE'||outcome==='HTTP_429'||outcome==='HTTP_5XX'||outcome==='TRANSPORT_ERROR'?'unavailable':
  outcome==='INTERNAL_ERROR'||outcome==='HOST_ERROR'||outcome==='HTTP_OTHER'?'failed':'denied';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,label)=>{if(!ok)throw Object.assign(new Error('OAUTH_OBSERVATION_INVALID: '+label),{code:'OAUTH_OBSERVATION_INVALID'});};
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function exact(value,names,label){need(plain(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)),label);return value;}
function text(value,max,label){need(typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value),label);return value;}
function https(value,label){
  text(value,2048,label);need(!/[\x00-\x20\x7f]/.test(value),label);
  let url;try {url=new URL(value);}catch{need(false,label);}
  // The original verifier keeps the configured issuer/audience spelling exact.
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,label);return url;
}
function sum(rows,key){const n=rows.reduce((n,row)=>n+row[key],0);need(natural(n),'counter sum');return n;}
export function validateOAuthCounters(value,{cumulative=true}={}) {
  exact(value,OAUTH_STAGES,'stages');
  for(const stage of OAUTH_STAGES){
    const row=exact(value[stage],[...OAUTH_COUNTER_FIELDS,'outcomes'],stage);
    need(OAUTH_COUNTER_FIELDS.every(key=>natural(row[key])),stage+' counters');
    if(cumulative)need(row.started>=row.completed,stage+' pending');
    exact(row.outcomes,OAUTH_OUTCOMES[stage],stage+' outcomes');
    need(Object.values(row.outcomes).every(natural),stage+' outcome counts');
    need(sum(['allowed','denied','unavailable','failed'].map(key=>({n:row[key]})),'n')===row.completed,stage+' completion total');
    need(sum(Object.values(row.outcomes).map(n=>({n})),'n')===row.completed,stage+' outcome total');
    for(const category of ['allowed','denied','unavailable','failed']){
      const total=Object.entries(row.outcomes).filter(([outcome])=>oauthOutcomeCategory(stage,outcome)===category).reduce((n,[,count])=>n+count,0);
      need(total===row[category],stage+' outcome category');
    }
  }
  return value;
}
/** No token, subject, client identity, request arguments or raw error body fits
 * this exact schema. Unknown fields are rejected before a capture is accepted. */
export function validateOAuthObservation(value) {
  exact(value,['schema','sessionId','startedAt','capturedAt','sequence','configurationSha256',
    'resource','metadataUrl','authority','state','counters','minutes','issuers','last'],'observation');
  need(value.schema===OAUTH_OBSERVATION_SCHEMA,'schema');
  need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.sessionId??''),'session');
  need(instant(value.startedAt)&&instant(value.capturedAt)&&value.startedAt<=value.capturedAt,'capture times');
  need(Number.isSafeInteger(value.sequence)&&value.sequence>0,'sequence');
  need(/^[a-f0-9]{64}$/.test(value.configurationSha256??''),'configuration');
  const resource=https(value.resource,'resource');
  need(!resource.search,'resource query');
  need(value.metadataUrl===resource.origin+'/.well-known/oauth-protected-resource'+(resource.pathname==='/'?'':resource.pathname),'metadata URL');
  const authority=exact(value.authority,['hostCallback','servers','toolScopeCount'],'authority');
  need(typeof authority.hostCallback==='boolean'&&natural(authority.toolScopeCount)&&authority.toolScopeCount<=2048,'authority state');
  need(Array.isArray(authority.servers)&&authority.servers.length>=1&&authority.servers.length<=8,'authorization servers');
  const issuers=new Set();
  for(const server of authority.servers){
    exact(server,['issuer','jwksUri','algorithms','tokenTypes','subjectAllowlistCount','requiredScopes','keys'],'authorization server');
    need(!https(server.issuer,'issuer').search,'issuer query');https(server.jwksUri,'JWKS URI');
    need(!issuers.has(server.issuer),'duplicate issuer');issuers.add(server.issuer);
    need(Array.isArray(server.algorithms)&&server.algorithms.length>=1&&server.algorithms.length<=10&&
      new Set(server.algorithms).size===server.algorithms.length&&server.algorithms.every(a=>['RS256','RS384','RS512','PS256','PS384','PS512','ES256','ES384','ES512','EdDSA'].includes(a)),'algorithms');
    need(Array.isArray(server.tokenTypes)&&server.tokenTypes.length>=1&&server.tokenTypes.length<=8&&
      new Set(server.tokenTypes).size===server.tokenTypes.length&&
      server.tokenTypes.every(t=>typeof t==='string'&&t.length>0&&t.length<=128&&/^(?:application\/)?[-a-z0-9!#$&^_.+]+$/i.test(t)),'token types');
    need(natural(server.subjectAllowlistCount)&&server.subjectAllowlistCount<=1024,'subject count');
    need(authority.hostCallback||server.subjectAllowlistCount>0,'original authority required');
    need(Array.isArray(server.requiredScopes)&&server.requiredScopes.length<=128&&new Set(server.requiredScopes).size===server.requiredScopes.length&&
      server.requiredScopes.every(s=>typeof s==='string'&&s.length>0&&s.length<=256&&
        /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(s)&&s!=='offline_access'),'required scopes');
    exact(server.keys,['fresh','reloading','coolingDown'],'JWKS cache');
    need(Object.values(server.keys).every(v=>typeof v==='boolean'),'JWKS cache state');
  }
  const state=exact(value.state,['closed','activeRequests','observerErrors','clockError'],'state');
  need(typeof state.closed==='boolean'&&typeof state.clockError==='boolean'&&natural(state.activeRequests)&&natural(state.observerErrors),'state values');
  validateOAuthCounters(value.counters);
  need(Array.isArray(value.minutes)&&value.minutes.length>=1&&value.minutes.length<=60,'minute records');
  const lastMinute=Math.floor(Date.parse(value.capturedAt)/60000)*60000;
  const firstMinute=Math.max(Math.floor(Date.parse(value.startedAt)/60000)*60000,lastMinute-59*60000);
  need(value.minutes.length===(lastMinute-firstMinute)/60000+1,'complete retained minute range');
  for(let i=0;i<value.minutes.length;i++){
    const minute=exact(value.minutes[i],['minute','counters'],'minute');
    need(minute.minute===new Date(firstMinute+i*60000).toISOString(),'minute sequence');
    validateOAuthCounters(minute.counters,{cumulative:false});
  }
  for(const stage of OAUTH_STAGES)for(const field of OAUTH_COUNTER_FIELDS)
    need(sum(value.minutes.map(row=>row.counters[stage]),field)<=value.counters[stage][field],'minute/cumulative '+stage+'.'+field);
  need(Array.isArray(value.issuers)&&value.issuers.length===issuers.size+1,'issuer counters');
  const seen=new Set();
  for(const row of value.issuers){
    exact(row,['issuer','counters'],'issuer row');
    need((row.issuer===null||issuers.has(row.issuer))&&!seen.has(row.issuer),'issuer attribution');
    seen.add(row.issuer);validateOAuthCounters(row.counters);
  }
  need(seen.has(null),'unattributed checks');
  for(const stage of OAUTH_STAGES){
    for(const field of OAUTH_COUNTER_FIELDS)need(sum(value.issuers.map(row=>row.counters[stage]),field)===value.counters[stage][field],'issuer/cumulative '+stage+'.'+field);
    for(const outcome of OAUTH_OUTCOMES[stage])
      need(value.issuers.reduce((n,row)=>n+row.counters[stage].outcomes[outcome],0)===value.counters[stage].outcomes[outcome],'issuer outcomes');
  }
  exact(value.last,OAUTH_STAGES,'last outcomes');
  for(const stage of OAUTH_STAGES){
    const last=value.last[stage];
    if(last===null){need(value.counters[stage].completed===0||state.observerErrors>0,'missing last outcome');continue;}
    exact(last,['at','outcome','issuer','tool','durationMs'],'last outcome');
    need((last.at===null&&state.observerErrors>0)||(instant(last.at)&&last.at>=value.startedAt&&last.at<=value.capturedAt),'outcome time');
    need(OAUTH_OUTCOMES[stage].includes(last.outcome),'outcome code');
    need(last.issuer===null||issuers.has(last.issuer),'verified issuer');
    need(last.tool===null||typeof last.tool==='string'&&/^[-A-Za-z0-9_.]{1,128}$/.test(last.tool),'tool name');
    need(last.durationMs===null||natural(last.durationMs),'duration');
  }
  return value;
}
export function oauthWindow(value,windowMinutes) {
  validateOAuthObservation(value);
  need(Number.isSafeInteger(windowMinutes)&&windowMinutes>=1&&windowMinutes<=60,'window minutes');
  const current=Math.floor(Date.parse(value.capturedAt)/60000)*60000;
  const from=current-(windowMinutes-1)*60000;
  const selected=value.minutes.filter(row=>Date.parse(row.minute)>=from);
  const counters=Object.fromEntries(OAUTH_STAGES.map(stage=>[stage,{
    ...Object.fromEntries(OAUTH_COUNTER_FIELDS.map(key=>[key,0])),
    outcomes:Object.fromEntries(OAUTH_OUTCOMES[stage].map(code=>[code,0]))
  }]));
  for(const row of selected)for(const stage of OAUTH_STAGES){
    for(const field of OAUTH_COUNTER_FIELDS)counters[stage][field]+=row.counters[stage][field];
    for(const outcome of OAUTH_OUTCOMES[stage])counters[stage].outcomes[outcome]+=row.counters[stage].outcomes[outcome];
  }
  return {from:new Date(from).toISOString(),through:value.capturedAt,
    complete:Date.parse(value.startedAt)<=from&&selected.length===windowMinutes&&
      value.state.observerErrors===0&&!value.state.clockError,
    minutes:windowMinutes,counters};
}
