// MIT. Authenticated Apache Superset 6.1 saved-chart reads and native async events.
import {setTimeout as delay} from 'node:timers/promises';
import {object,identity,digest,fault,MiB} from './files.mjs';

const ENV=/^[A-Za-z_][A-Za-z0-9_]*$/;
const positive=(x,name,max)=>{if(!Number.isSafeInteger(x)||x<1||x>max)throw fault('SUPERSET_OPTION',name+' is outside its supported range.');return x;};
export function sourceOptions(value) {
  if(!object(value))throw fault('SUPERSET_SOURCE','Supply an original Superset source.');
  const base=new URL(value.baseUrl);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||
      !base.pathname.endsWith('/')||value.baseUrl!==base.href)
    throw fault('SUPERSET_SOURCE','Use a canonical Superset base URL ending in /, without credentials or query.');
  if(base.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname)&&value.allowHttp!==true)
    throw fault('SUPERSET_TRANSPORT','Remote HTTP requires the explicit allowHttp deployment setting.');
  const auth=value.auth;
  if(!object(auth)||!['bearer','login','session'].includes(auth.mode))
    throw fault('SUPERSET_AUTH','Choose native bearer, login or session authentication.');
  const keys=auth.mode==='bearer'?['tokenEnv']:auth.mode==='login'?['usernameEnv','passwordEnv']:['cookieEnv'];
  for(const key of keys)if(!ENV.test(auth[key]??''))throw fault('SUPERSET_AUTH','Credentials must name existing host environment variables.');
  if(auth.mode==='login'&&!['db','ldap'].includes(auth.provider??'db'))throw fault('SUPERSET_AUTH','Choose the native db or ldap login provider.');
  const result={baseUrl:base.href,allowHttp:value.allowHttp===true,auth:{mode:auth.mode}};
  for(const key of keys)result.auth[key]=auth[key];
  if(auth.mode==='login')result.auth.provider=auth.provider??'db';
  result.requestTimeoutMs=positive(value.requestTimeoutMs??60000,'requestTimeoutMs',300000);
  result.asyncTimeoutMs=positive(value.asyncTimeoutMs??180000,'asyncTimeoutMs',3600000);
  result.pollMs=positive(value.pollMs??1000,'pollMs',30000);
  result.maxResponseBytes=positive(value.maxResponseBytes??64*MiB,'maxResponseBytes',256*MiB);
  result.maxCaptureBytes=positive(value.maxCaptureBytes??256*MiB,'maxCaptureBytes',1024*MiB);
  return result;
}
class CookieJar {
  constructor(base,initial) {
    this.base=base;this.cookies=new Map();
    if(initial)for(const part of initial.split(';')){
      const p=part.indexOf('=');
      if(p>0)this.cookies.set(part.slice(0,p).trim()+'|/',{name:part.slice(0,p).trim(),value:part.slice(p+1).trim(),path:'/',secure:false,until:null});
    }
  }
  accept(response,url) {
    for(const raw of response.headers.getSetCookie()){
      const pieces=raw.split(';'),first=pieces.shift(),p=first.indexOf('=');
      if(p<=0)continue;
      const cookie={name:first.slice(0,p).trim(),value:first.slice(p+1).trim(),
        path:url.pathname.slice(0,url.pathname.lastIndexOf('/')+1)||'/',secure:false,until:null};
      let allowed=true,maxAge=null;
      for(const piece of pieces){
        const at=piece.indexOf('='),key=(at<0?piece:piece.slice(0,at)).trim().toLowerCase(),val=at<0?'':piece.slice(at+1).trim();
        if(key==='domain'){
          const domain=val.replace(/^\./,'').toLowerCase(),host=url.hostname.toLowerCase();
          if(!domain||(host!==domain&&!host.endsWith('.'+domain)))allowed=false;
        }
        if(key==='path'&&val.startsWith('/'))cookie.path=val;
        if(key==='secure')cookie.secure=true;
        if(key==='max-age'&&/^-?\d+$/.test(val))maxAge=Number(val);
        if(key==='expires'&&Number.isFinite(Date.parse(val)))cookie.until=Date.parse(val);
      }
      if(maxAge!==null)cookie.until=Date.now()+maxAge*1000;
      if(allowed)this.cookies.set(cookie.name+'|'+cookie.path,cookie);
    }
  }
  header(url){
    return [...this.cookies.values()].filter(c=>(!c.secure||url.protocol==='https:')&&
      (c.until===null||c.until>Date.now())&&(url.pathname===c.path||url.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/')))
      .sort((a,b)=>b.path.length-a.path.length).map(c=>c.name+'='+c.value).join('; ');
  }
}
function environmentValue(env,name) {
  const value=env[name];
  if(typeof value!=='string'||!value||/[\r\n\0]/.test(value))throw fault('SUPERSET_CREDENTIAL_UNAVAILABLE','The configured host credential is unavailable.');
  return value;
}
function plain(raw) {
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw fault('SUPERSET_RESPONSE_JSON','The native API returned invalid JSON.',502);}
}
export class SupersetClient {
  constructor(options,{env=process.env,fetchImpl=globalThis.fetch,signal,retain,onProgress}={}) {
    this.options=sourceOptions(options);this.base=new URL(this.options.baseUrl);
    this.env=env;this.fetch=fetchImpl;this.signal=signal;this.retain=retain??(async raw=>({sha256:digest(raw),bytes:raw.length}));
    this.onProgress=onProgress??(()=>{});this.entries=[];this.captureBytes=0;this.bearer=null;this.principal=null;
    const initial=this.options.auth.mode==='session'?environmentValue(env,this.options.auth.cookieEnv):null;
    this.jar=new CookieJar(this.base,initial);
  }
  url(path) {
    const url=new URL(path,this.base);
    if(url.origin!==this.base.origin||!url.pathname.startsWith(this.base.pathname)||url.username||url.password||url.hash)
      throw fault('SUPERSET_RESULT_ORIGIN','Native results must stay on the configured Superset origin and base path.');
    return url;
  }
  async request(path,{method='GET',body,retain=true,accepted=[200],label=path}={}) {
    let url=this.url(path);
    for(let redirects=0;redirects<=4;redirects++){
      const headers={accept:'application/json'};
      if(this.bearer)headers.authorization='Bearer '+this.bearer;
      const cookies=this.jar.header(url);if(cookies)headers.cookie=cookies;
      if(body!==undefined)headers['content-type']='application/json';
      const signal=AbortSignal.any([AbortSignal.timeout(this.options.requestTimeoutMs),...(this.signal?[this.signal]:[])]);
      let response;
      try{response=await this.fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal});}
      catch(error){
        if(this.signal?.aborted)throw fault('SUPERSET_CAPTURE_CANCELLED','The source capture was cancelled.',409);
        throw fault('SUPERSET_TRANSPORT_FAILED','The native Superset request did not complete.',502);
      }
      this.jar.accept(response,url);
      if([301,302,303,307,308].includes(response.status)){
        await response.body?.cancel();
        if(method!=='GET'||!response.headers.get('location'))throw fault('SUPERSET_REDIRECT','The native authentication endpoint redirected.',502);
        url=this.url(new URL(response.headers.get('location'),url).href);continue;
      }
      const chunks=[];let size=0;
      try{
        for await(const chunk of response.body??[]){
          size+=chunk.length;
          if(size>this.options.maxResponseBytes)throw fault('SUPERSET_RESPONSE_LIMIT','The native response exceeds the configured full-response limit; no edition was created.',413);
          chunks.push(chunk);
        }
      }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
      const raw=Buffer.concat(chunks,size);
      let entry=null;
      if(retain){
        this.captureBytes+=size;
        if(this.captureBytes>this.options.maxCaptureBytes)throw fault('SUPERSET_CAPTURE_LIMIT','The complete source capture exceeds the configured limit; no edition was created.',413);
        entry={sequence:this.entries.length,method,url:url.href,label,status:response.status,receivedAt:new Date().toISOString(),
          headers:Object.fromEntries(['content-type','date','etag','last-modified','cache-control'].flatMap(key=>response.headers.has(key)?[[key,response.headers.get(key)]]:[])),
          body:await this.retain(raw)};
        this.entries.push(entry);await this.onProgress({phase:label,entry});
      }
      if(!accepted.includes(response.status))throw Object.assign(fault('SUPERSET_HTTP_'+response.status,
        'The native Superset '+label+' request returned HTTP '+response.status+'.',response.status>=500?502:409),{nativeStatus:response.status,entry});
      return{status:response.status,raw,value:plain(raw),entry};
    }
    throw fault('SUPERSET_REDIRECT_LIMIT','The native endpoint redirected repeatedly.',502);
  }
  async connect(){
    if(this.principal)return this.principal;
    const auth=this.options.auth;
    if(auth.mode==='bearer')this.bearer=environmentValue(this.env,auth.tokenEnv);
    else if(auth.mode==='login'){
      const response=await this.request('api/v1/security/login',{method:'POST',retain:false,label:'login',
        body:{username:environmentValue(this.env,auth.usernameEnv),password:environmentValue(this.env,auth.passwordEnv),provider:auth.provider,refresh:false}});
      if(typeof response.value.access_token!=='string'||!response.value.access_token)
        throw fault('SUPERSET_LOGIN_RESPONSE','Native login did not return an access token.',502);
      this.bearer=response.value.access_token;
    }
    // This protected read also establishes/rotates the native async session cookies.
    const me=await this.request('api/v1/me/',{retain:false,label:'principal'});
    const principal=me.value.result;
    if(!object(principal)||!Number.isSafeInteger(principal.id)||principal.id<1)
      throw fault('SUPERSET_PRINCIPAL','The authenticated instance did not identify its native user.',502);
    this.principal={id:principal.id,username:typeof principal.username==='string'?principal.username:null};
    return this.principal;
  }
  async inventory({kind='chart',page=0,pageSize=50,dashboardId}={}){
    await this.connect();
    if(!['chart','dashboard'].includes(kind)||!Number.isSafeInteger(page)||page<0||
        !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw fault('SUPERSET_INVENTORY','Choose a native chart/dashboard page of at most 100 items.');
    let path;
    if(dashboardId!==undefined){
      positive(dashboardId,'dashboardId',Number.MAX_SAFE_INTEGER);
      path='api/v1/dashboard/'+dashboardId+'/charts';
    }else path='api/v1/'+kind+'/?q='+encodeURIComponent('(page:'+page+',page_size:'+pageSize+')');
    const response=await this.request(path,{retain:false,label:'inventory'});
    if(!Array.isArray(response.value.result))throw fault('SUPERSET_INVENTORY_RESPONSE','The native inventory has no result list.',502);
    return{kind,page,pageSize,count:response.value.count??response.value.result.length,
      items:response.value.result,principal:this.principal,baseUrl:this.base.href};
  }
  async capture({chartId,force=false}={}){
    positive(chartId,'chartId',Number.MAX_SAFE_INTEGER);
    if(typeof force!=='boolean')throw fault('SUPERSET_CAPTURE','force must be a boolean.');
    await this.connect();
    const before=await this.request('api/v1/chart/'+chartId,{label:'chart-before'});
    const chart=before.value.result;
    if(!object(chart)||chart.id!==chartId||typeof chart.query_context!=='string'||!chart.query_context)
      throw fault('SUPERSET_SAVED_CONTEXT','The selected native chart must retain its saved query context.',409);
    let context;
    try{context=JSON.parse(chart.query_context);}catch{throw fault('SUPERSET_SAVED_CONTEXT','The saved chart query context is invalid.',409);}
    if(!object(context)||!Array.isArray(context.queries))throw fault('SUPERSET_SAVED_CONTEXT','The saved chart has no original query list.',409);
    const definition=value=>identity({id:value.id,uuid:value.uuid,datasource_id:value.datasource_id,
      datasource_uuid:value.datasource_uuid,datasource_type:value.datasource_type,query_context:value.query_context,params:value.params});
    const definitionSha256=definition(chart);
    let response=await this.request('api/v1/chart/'+chartId+'/data/?format=json&type=full&force='+(force?'true':'false'),
      {accepted:[200,202],label:'chart-data'});
    let job=null,cursor=null;
    if(response.status===202){
      job=response.value;
      if(!object(job)||typeof job.job_id!=='string'||!job.job_id||typeof job.channel_id!=='string'||!job.channel_id||
          !['pending','running','done','error'].includes(job.status))
        throw fault('SUPERSET_ASYNC_JOB','The native async job response is incomplete.',502);
      if(job.user_id!==null&&job.user_id!==undefined&&String(job.user_id)!==String(this.principal.id))
        throw fault('SUPERSET_ASYNC_USER','The native job belongs to another authenticated user.',409);
      const started=Date.now();let completed=job.status==='done'?job:null;
      if(job.status==='error')throw fault('SUPERSET_ASYNC_FAILED','The native query job returned an error.',409);
      while(!completed){
        if(Date.now()-started>this.options.asyncTimeoutMs)throw Object.assign(fault('SUPERSET_ASYNC_TIMEOUT',
          'The retained native job has not completed within this capture deadline.',409),{job:{job_id:job.job_id,channel_id:job.channel_id,cursor}});
        await delay(this.options.pollMs,undefined,{signal:this.signal});
        const page=await this.request('api/v1/async_event/'+(cursor?'?last_id='+encodeURIComponent(cursor):''),{label:'async-events'});
        if(!Array.isArray(page.value.result))throw fault('SUPERSET_ASYNC_EVENTS','The native event page is invalid.',502);
        for(const event of page.value.result){
          if(typeof event.id!=='string'||!/^\d+-\d+$/.test(event.id))throw fault('SUPERSET_ASYNC_CURSOR','The native event cursor is invalid.',502);
          cursor=event.id;
          if(event.job_id!==job.job_id||event.channel_id!==job.channel_id)continue;
          if(event.user_id!==null&&event.user_id!==undefined&&String(event.user_id)!==String(this.principal.id))
            throw fault('SUPERSET_ASYNC_USER','The native completion belongs to another authenticated user.',409);
          if(event.status==='error')throw fault('SUPERSET_ASYNC_FAILED','The native query job returned an error; inspect its retained event.',409);
          if(event.status==='done')completed=event;
          else if(!['pending','running'].includes(event.status))throw fault('SUPERSET_ASYNC_STATUS','The native job returned an unknown status.',502);
        }
      }
      if(typeof completed.result_url!=='string'||!completed.result_url)throw fault('SUPERSET_ASYNC_RESULT','The completed job has no native result URL.',502);
      const resultUrl=this.url(completed.result_url);
      if(!resultUrl.pathname.startsWith(this.base.pathname+'api/v1/chart/data/'))
        throw fault('SUPERSET_ASYNC_RESULT','The native job result must use the original cached chart-data endpoint.',409);
      response=await this.request(resultUrl.href,{label:'async-result'});
      job={job_id:job.job_id,channel_id:job.channel_id,user_id:job.user_id??null,status:'done',last_event_id:cursor,result_url:resultUrl.href};
    }
    if(!Array.isArray(response.value.result)||!response.value.result.length)
      throw fault('SUPERSET_QUERY_RESULTS','The native chart returned no full query results.',409);
    const after=await this.request('api/v1/chart/'+chartId,{label:'chart-after'});
    if(!object(after.value.result)||definition(after.value.result)!==definitionSha256)
      throw fault('SUPERSET_CHART_CHANGED','The saved chart changed during capture; retain this attempt and capture the selected definition again.',409);
    return{schema:'stellar-forge.superset-capture.v1',apiContractVersion:'6.1',capturedAt:new Date().toISOString(),
      source:{baseUrl:this.base.href,chartId,chartUuid:chart.uuid??null,principal:this.principal},
      definitionSha256,force,metadataBefore:before.entry.body,metadataAfter:after.entry.body,
      result:response.entry.body,queryCount:response.value.result.length,job,entries:this.entries};
  }
}
