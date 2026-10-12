// MIT. Reviewed Xero tenants over the original managed OAuth connection and accounting client.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readJson, atomicJson, syncDirectory, digest, identity, fault } from '../postgres/publisher/files.mjs';
import { withOAuthConnectionLock } from './store.mjs';
import { createOAuthConnectionProvider } from './provider.mjs';
import { readOAuthHostConnections, openOAuthConnectionRegistry } from './host.mjs';
import { PROFILE_SCHEMA, XERO_OAUTH_PROVIDER, XERO_ACCOUNTING_SCOPES, XERO_OAUTH_SCOPES, XERO_OAUTH_ENDPOINTS,
  normalizeOAuthProfile, xeroOAuthProfile, compileOAuthConnection, plain, hex, text } from './profile.mjs';
import { XeroHttpClient } from '../../merchant-settlement-accounting/accountant/xero-http.mjs';
import { createXeroContext, validateXeroContext, xeroId } from '../../merchant-settlement-accounting/accountant/xero.mjs';

export const XERO_SELECTION_SCHEMA = 'stellar-forge.xero-oauth-tenant-selection.v1';
export const XERO_TENANTS_SCHEMA = 'stellar-forge.xero-oauth-connected-tenants.v1';
export const XERO_SELECTION_BYTES = 128 * 1024 * 1024;
const SCHEME='xeroAccounting',FILE='selection.json',ORIGIN=XERO_OAUTH_ENDPOINTS.resource;
const need=(yes,code,message,status=409)=>{if(!yes)throw fault(code,message,status);};
const fields=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const aliasName=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value);
const clone=value=>structuredClone(value);
const HEADER_NAMES=['xero-correlation-id','x-daylimit-remaining','x-minlimit-remaining','x-appminlimit-remaining','retry-after'];
let sourcePromise;

export async function xeroSource() {
  if(!sourcePromise)sourcePromise=(async()=>{
    const bytes=await readFile(new URL('./xero.openapi.json',import.meta.url));
    need(bytes.length>0&&bytes.length<=65536,'XERO_OAUTH_SOURCE','The shipped native Xero operation descriptor is unavailable.');
    const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const flow=source.components?.securitySchemes?.[SCHEME]?.flows?.authorizationCode;
    need(flow?.authorizationUrl===XERO_OAUTH_ENDPOINTS.authorization&&flow?.tokenUrl===XERO_OAUTH_ENDPOINTS.token&&
      XERO_OAUTH_SCOPES.every(scope=>Object.hasOwn(flow.scopes??{},scope)),
    'XERO_OAUTH_SOURCE','The native Xero source differs from its registered authorization profile.');
    return Object.freeze({sha256:digest(bytes),scheme:SCHEME});
  })().catch(error=>{sourcePromise=null;throw error;});
  return {...await sourcePromise};
}

/** Register public app/source references; the original core owns all private token state. */
export async function createXeroProfile({clientId,clientSecretEnv,callbackOrigin,label='Xero accounting'}={}) {
  return normalizeOAuthProfile({
    schema:PROFILE_SCHEMA,label,source:await xeroSource(),
    authorizationEndpoint:XERO_OAUTH_ENDPOINTS.authorization,tokenEndpoint:XERO_OAUTH_ENDPOINTS.token,
    revocationEndpoint:XERO_OAUTH_ENDPOINTS.revoke,clientId,clientSecretEnv,authMethod:'client_secret_basic',
    scopes:[...XERO_OAUTH_SCOPES],resourceOrigins:[ORIGIN],pkceMethod:'S256',
    provider:{kind:XERO_OAUTH_PROVIDER},callbackOrigin,
  });
}

function currentTarget(status,target,source,{requireConnected=true}={}) {
  need(status&&xeroOAuthProfile(status.profile)&&status.profile.source.sha256===source.sha256&&
    status.profile.source.scheme===source.scheme,'XERO_OAUTH_SOURCE_CHANGED',
    'Choose a Xero connection registered for this exact native accounting source.');
  need(aliasName(target.alias)&&status.alias===target.alias&&status.profileSha256===target.profileSha256&&
    status.grant.id===target.grantId&&status.profile.resourceOrigins.length===1&&status.profile.resourceOrigins[0]===ORIGIN,
  'XERO_OAUTH_GRANT_CHANGED','The selected alias, profile or reviewed grant changed. Select its current Xero tenant.');
  need(status.grant.review&&XERO_ACCOUNTING_SCOPES.every(scope=>status.grant.scopes.includes(scope))&&
    (requireConnected?status.grant.state==='connected':['connected','refreshing'].includes(status.grant.state)),
  'XERO_OAUTH_GRANT_REQUIRED','Connect and review this authorization in the original OAuth connection workspace.');
  return status;
}

async function bindTarget(registry,target,options={}) {
  const source=await xeroSource(),status=currentTarget(await registry.status(target.alias),target,source,options);
  const binding=await registry.binding(target.alias,{sourceSha256:source.sha256,scheme:source.scheme,
    resourceOrigin:ORIGIN,requiredScopes:[...XERO_ACCOUNTING_SCOPES]});
  need(binding.profileSha256===target.profileSha256&&binding.grantId===target.grantId,
    'XERO_OAUTH_GRANT_CHANGED','The reviewed authorization changed during tenant selection.');
  return {source,status,binding};
}

export async function listXeroConnections(registry) {
  const source=await xeroSource();
  return (await registry.list()).filter(value=>xeroOAuthProfile(value.profile)).map(value=>{
    const sourceMatches=value.profile.source.sha256===source.sha256&&value.profile.source.scheme===source.scheme;
    return {alias:value.alias,label:value.profile.label,directoryEnv:value.directoryEnv,
      profileSha256:value.profileSha256,grantId:value.grant.id,state:value.grant.state,review:clone(value.grant.review),
      refreshExpiresAt:value.grant.refreshExpiresAt,sourceMatches,
      ready:sourceMatches&&value.grant.state==='connected'&&Boolean(value.grant.review)&&
        XERO_ACCOUNTING_SCOPES.every(scope=>value.grant.scopes.includes(scope))};
  });
}

function connectionsFrom(json) {
  let rows;
  try{rows=JSON.parse(json);}catch{need(false,'XERO_OAUTH_CONNECTIONS_INVALID','The native connected-tenant response is not JSON.');}
  need(Array.isArray(rows)&&rows.length<=10000,'XERO_OAUTH_CONNECTIONS_INVALID','Read the original complete connected-tenant array.');
  const seen=new Set();
  return rows.map(raw=>{
    need(plain(raw),'XERO_OAUTH_CONNECTIONS_INVALID','A native connected-tenant row is invalid.');
    const id=xeroId(typeof raw.id==='string'?raw.id.toLowerCase():raw.id);
    const tenantId=xeroId(typeof raw.tenantId==='string'?raw.tenantId.toLowerCase():raw.tenantId);
    need(!seen.has(id),'XERO_OAUTH_CONNECTIONS_DUPLICATE','The native source repeats a connection ID.');
    seen.add(id);
    text(raw.tenantName,'native tenant name',255);
    need(['ORGANISATION','PRACTICE'].includes(raw.tenantType),'XERO_OAUTH_TENANT_TYPE','The native source has an unsupported tenant type.');
    const authEventId=raw.authEventId==null?null:xeroId(typeof raw.authEventId==='string'?raw.authEventId.toLowerCase():raw.authEventId);
    for(const key of ['createdDateUtc','updatedDateUtc'])if(raw[key]!=null)
      need(typeof raw[key]==='string'&&raw[key].length<=80&&Number.isFinite(Date.parse(raw[key])),
        'XERO_OAUTH_CONNECTIONS_INVALID','The native tenant timestamp is invalid.');
    return {id,tenantId,authEventId,tenantType:raw.tenantType,tenantName:raw.tenantName,
      createdDateUtc:raw.createdDateUtc??null,updatedDateUtc:raw.updatedDateUtc??null,
      selectable:raw.tenantType==='ORGANISATION'};
  });
}

function selectedConnection(rows,{connectionId,tenantId},expected) {
  xeroId(connectionId);xeroId(tenantId);
  const found=rows.find(row=>row.id===connectionId&&row.tenantId===tenantId);
  need(found&&found.selectable,'XERO_OAUTH_TENANT_REQUIRED',
    'Select one explicit organization connection ID and tenant ID from this grant.');
  if(expected)need(found.authEventId===expected.authEventId,'XERO_OAUTH_TENANT_CHANGED',
    'The selected tenant now belongs to a different authorization event. Review its current connection.');
  return found;
}

function retainSource(name,response) {
  need(response?.ok&&response.status===200&&Buffer.isBuffer(response.bytes),
    'XERO_OAUTH_SOURCE_FAILED','The native '+name+' source request did not complete successfully.');
  let json;
  try{json=new TextDecoder('utf-8',{fatal:true}).decode(response.bytes);}
  catch{need(false,'XERO_OAUTH_SOURCE_INVALID','The original '+name+' response is not UTF-8 JSON.');}
  return {name,status:response.status,receivedAt:response.receivedAt,request:clone(response.request),
    headers:clone(response.headers),bytes:response.bytes.length,sha256:digest(response.bytes),json};
}

function validateSource(source,name,tenantId) {
  need(fields(source,['name','status','receivedAt','request','headers','bytes','sha256','json'])&&source.name===name&&
    source.status===200&&timestamp(source.receivedAt)&&Number.isSafeInteger(source.bytes)&&source.bytes>0&&
    source.bytes<=64_000_000&&typeof source.json==='string'&&hex(source.sha256)&&
    Buffer.byteLength(source.json)===source.bytes&&digest(Buffer.from(source.json))===source.sha256,
  'XERO_OAUTH_SOURCE_CHANGED','The retained '+name+' bytes or response identity changed.');
  need(plain(source.headers)&&Object.keys(source.headers).every(key=>HEADER_NAMES.includes(key))&&
    Object.values(source.headers).every(value=>typeof value==='string'&&value.length<=4096),
  'XERO_OAUTH_SOURCE_INVALID','Keep only the original public Xero response headers.');
  const path=name==='connections.json'?'/connections':name==='organization.json'?'/api.xro/2.0/Organisation':'/api.xro/2.0/Accounts';
  need(fields(source.request,['method','url','tenantId','idempotencyKey'])&&source.request.method==='GET'&&
    source.request.url===ORIGIN+path&&source.request.tenantId===(name==='connections.json'?null:tenantId)&&
    source.request.idempotencyKey===null,'XERO_OAUTH_SOURCE_CHANGED','The retained source request belongs to a different native endpoint or tenant.');
  return Buffer.from(source.json);
}

function selectionIdentity(selection) {
  return {alias:selection.alias,profileSha256:selection.profileSha256,grantId:selection.grantId,
    connectionId:selection.connectionId,tenantId:selection.tenantId};
}

async function createClientOwner({registry,target,binding,source,selection=null,
  env=process.env,allowLoopback=false,lookup,agent,fetchImpl=globalThis.fetch,timeoutMs=30000}={}) {
  need(typeof fetchImpl==='function','XERO_OAUTH_TRANSPORT','Use the native HTTP transport.',400);
  const pin=Object.freeze({alias:target.alias,profileSha256:target.profileSha256,grantId:target.grantId,
    ...(target.tenantId?{connectionId:target.connectionId,tenantId:target.tenantId}:{})});
  const provider=createOAuthConnectionProvider(binding,{resourceOrigin:ORIGIN,env:{...env},allowLoopback,
    ...(lookup?{lookup}:{}),...(agent?{agent}:{})});
  const lifetime=new AbortController(),flights=new Set();
  let closed=false,closing,lastTenantReadAt=null,bindingError=null;
  const combined=signal=>signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
  const live=()=>need(!closed,'XERO_OAUTH_CLOSED','The managed Xero accounting owner is closed.');
  const acquire=async signal=>{
    live();signal?.throwIfAborted();
    try{currentTarget(await registry.status(pin.alias),pin,source,{requireConnected:false});bindingError=null;}
    catch(error){bindingError=/^XERO_OAUTH_[A-Z_]+$/.test(error?.code??'')?error.code:'XERO_OAUTH_GRANT_REQUIRED';throw error;}
    return provider.headers({signal:combined(signal)});
  };
  const track=async fn=>{
    live();
    const task=Promise.resolve().then(fn);flights.add(task);
    try{return await task;}finally{flights.delete(task);}
  };
  const send=async(url,init)=>{
    live();const requested=new URL(url);
    need(requested.origin===ORIGIN&&(requested.pathname==='/connections'&&init.method==='GET'||
      requested.pathname.startsWith('/api.xro/2.0/')),
    'XERO_OAUTH_RESOURCE_CHANGED','Send this reviewed grant only to native Xero accounting or tenant discovery.');
    if(requested.pathname!=='/connections'){
      const tenantId=new Headers(init.headers).get('xero-tenant-id');
      need(pin.tenantId&&tenantId===pin.tenantId,'XERO_OAUTH_TENANT_CHANGED','Use the exact reviewed Xero tenant for this accounting owner.');
    }
    const response=await fetchImpl(url,{...init,signal:combined(init.signal)});
    if(response.status===401)provider.invalidate(new Headers(init.headers).get('authorization')??undefined);
    return response;
  };
  async function fetchTenants({signal}={}) {
    return track(async()=>{
      const requestSignal=AbortSignal.any([combined(signal),AbortSignal.timeout(timeoutMs)]);
      for(let attempt=0;attempt<2;attempt++){
        const authorization=await acquire(requestSignal);
        const response=await send(ORIGIN+'/connections',{method:'GET',headers:{...authorization,Accept:'application/json'},
          cache:'no-store',redirect:'error',signal:requestSignal});
        const chunks=[];let bytes=0;
        if(response.body)for await(const chunk of response.body){bytes+=chunk.length;
          need(bytes<=8*1024*1024,'XERO_OAUTH_CONNECTIONS_SIZE','The native tenant response exceeded 8 MiB.',413);chunks.push(Buffer.from(chunk));}
        const headers={};for(const name of HEADER_NAMES){const value=response.headers.get(name);if(value!==null)headers[name]=value;}
        const retained={status:response.status,ok:response.ok,bytes:Buffer.concat(chunks),headers,
          receivedAt:new Date().toISOString(),request:{method:'GET',url:ORIGIN+'/connections',tenantId:null,idempotencyKey:null}};
        if(response.status===401&&attempt===0)continue;
        if(!response.ok){
          const error=fault(response.status===429?'XERO_OAUTH_RATE_LIMITED':'XERO_OAUTH_CONNECTIONS_FAILED',
            'The selected grant returned HTTP '+response.status+' while reading its connected tenants.',response.status===429?429:502);
          Object.assign(error,{nativeStatus:response.status,response:retainFailure(retained),
            retryAfter:headers['retry-after']??null});throw error;
        }
        const captured=retainSource('connections.json',retained),connections=connectionsFrom(captured.json);
        lastTenantReadAt=captured.receivedAt;
        return {connections,source:captured};
      }
    });
  }
  const client=new XeroHttpClient({fetchImpl:send,timeoutMs,tokenProvider:async({tenantId,signal})=>{
    need(pin.tenantId&&tenantId===pin.tenantId,'XERO_OAUTH_TENANT_CHANGED','Use the explicitly selected tenant for native accounting.');
    return (await acquire(signal)).authorization.slice(7);
  }});
  const context=client.context.bind(client),request=client.request.bind(client),createDraft=client.createDraft.bind(client),readJournal=client.readJournal.bind(client);
  client.request=(...args)=>track(()=>request(...args));
  client.context=(tenantId,options={})=>track(async()=>{
    let result=await context(tenantId,options);
    if(result.organization.status===401||result.accounts?.status===401){
      await acquire(options.signal);
      result=await context(tenantId,options);
    }
    return result;
  });
  client.createDraft=(...args)=>track(()=>createDraft(...args));
  client.readJournal=(...args)=>track(()=>readJournal(...args));
  const authorization=()=>{
    const snapshot=provider.snapshot();
    return {kind:'oauth-connection',...pin,tenantName:selection?.connection.tenantName??null,
      organizationName:selection?.context.organization.name??null,baseCurrency:selection?.context.organization.baseCurrency??null,
      isDemoCompany:selection?.context.organization.isDemoCompany??null,selectionSha256:selection?.integrity.sha256??null,
      state:bindingError?'reconnect_required':snapshot.state,lastError:bindingError??snapshot.lastError,lastTenantReadAt};
  };
  client.info=()=>({available:!closed&&!bindingError&&provider.snapshot().state!=='reconnect_required',tokenEnv:null,authorization:authorization()});
  client.available=()=>client.info().available;
  Object.freeze(client);
  return Object.freeze({
    client,fetchTenants,snapshot:()=>({authorization:authorization(),provider:provider.snapshot()}),
    close(){
      if(!closing){closed=true;lifetime.abort();closing=(async()=>{
        await Promise.allSettled([...flights]);await provider.close();
      })();}
      return closing;
    },
  });
}
function retainFailure(response) {
  return {status:response.status,receivedAt:response.receivedAt,headers:clone(response.headers),
    request:clone(response.request),bytes:response.bytes.length,sha256:digest(response.bytes)};
}

/** Native GET /connections returns every tenant; callers explicitly choose both IDs. */
export async function listXeroTenants({registry,alias,profileSha256,grantId,signal,...runtime}={}) {
  const target={alias,profileSha256,grantId},bound=await bindTarget(registry,target);
  const owner=await createClientOwner({registry,target,...bound,...runtime});
  try{
    const captured=await owner.fetchTenants({signal}),latest=await bindTarget(registry,target);
    need(identity(latest.binding)===identity(bound.binding),'XERO_OAUTH_GRANT_CHANGED','The authorization binding changed while discovering its tenants.');
    const body={schema:XERO_TENANTS_SCHEMA,...target,source:bound.source,binding:bound.binding,
      capturedAt:captured.source.receivedAt,connections:captured.connections,response:captured.source};
    return {...body,integrity:{sha256:identity(body)}};
  }finally{await owner.close();}
}

/** Capture actual selected tenant, native organization and original accounts before review. */
export async function previewXeroSelection({registry,alias,profileSha256,grantId,connectionId,tenantId,actor,reference='',
  id=randomUUID(),createdAt=new Date().toISOString(),signal,...runtime}={}) {
  need(uuid(id)&&timestamp(createdAt),'XERO_OAUTH_SELECTION_ID','Retain one UUID and creation time for this tenant selection.');
  text(actor,'tenant reviewer',160);text(reference,'tenant review reference',2000,true);
  xeroId(connectionId);xeroId(tenantId);
  const target={alias,profileSha256,grantId,connectionId,tenantId},bound=await bindTarget(registry,target);
  const owner=await createClientOwner({registry,target,...bound,...runtime});
  try{
    const captured=await owner.fetchTenants({signal}),connection=selectedConnection(captured.connections,target);
    const native=await owner.client.context(tenantId,{signal});
    const organization=retainSource('organization.json',native.organization),accounts=retainSource('accounts.json',native.accounts);
    const context=createXeroContext({id,name:connection.tenantName.slice(0,160),actor,createdAt,tenantId,
      organizationBytes:Buffer.from(organization.json),accountsBytes:Buffer.from(accounts.json)});
    const latest=await bindTarget(registry,target);
    need(identity(latest.binding)===identity(bound.binding),'XERO_OAUTH_GRANT_CHANGED','The reviewed grant changed during native tenant capture.');
    const body={schema:XERO_SELECTION_SCHEMA,id,createdAt,...target,source:bound.source,binding:bound.binding,
      capturedAt:accounts.receivedAt,connection,context,
      responses:{connections:captured.source,organization,accounts},review:{actor,reference}};
    return validateXeroSelection({...body,integrity:{sha256:identity(body)}});
  }finally{await owner.close();}
}

export async function validateXeroSelection(selection) {
  need(fields(selection,['schema','id','createdAt','alias','profileSha256','grantId','connectionId','tenantId',
    'source','binding','capturedAt','connection','context','responses','review','integrity'])&&
    selection.schema===XERO_SELECTION_SCHEMA&&uuid(selection.id)&&timestamp(selection.createdAt)&&timestamp(selection.capturedAt)&&
    aliasName(selection.alias)&&hex(selection.profileSha256)&&fields(selection.integrity,['sha256'])&&hex(selection.integrity.sha256),
  'XERO_OAUTH_SELECTION_INVALID','Use the complete retained native tenant selection.',400);
  xeroId(selection.connectionId);xeroId(selection.tenantId);
  const {integrity,...body}=selection;
  need(identity(body)===integrity.sha256,'XERO_OAUTH_SELECTION_CHANGED','The retained tenant review changed.');
  need(fields(selection.source,['sha256','scheme'])&&identity(selection.source)===identity(await xeroSource()),
    'XERO_OAUTH_SOURCE_CHANGED','The tenant selection belongs to another native operation source.');
  const binding=compileOAuthConnection(selection.binding,{resourceOrigin:ORIGIN});
  need(binding.profileSha256===selection.profileSha256&&binding.grantId===selection.grantId&&
    identity([...binding.requiredScopes])===identity([...XERO_ACCOUNTING_SCOPES]),
  'XERO_OAUTH_SELECTION_INVALID','The tenant selection must retain its exact accounting grant binding.');
  need(fields(selection.review,['actor','reference']),'XERO_OAUTH_REVIEW_REQUIRED','Keep the tenant reviewer and reference.');
  text(selection.review.actor,'tenant reviewer',160);text(selection.review.reference,'tenant review reference',2000,true);
  need(fields(selection.responses,['connections','organization','accounts']),'XERO_OAUTH_SOURCE_REQUIRED','Keep the three complete original native source responses.');
  validateSource(selection.responses.connections,'connections.json',selection.tenantId);
  const organizationBytes=validateSource(selection.responses.organization,'organization.json',selection.tenantId);
  const accountsBytes=validateSource(selection.responses.accounts,'accounts.json',selection.tenantId);
  const connection=selectedConnection(connectionsFrom(selection.responses.connections.json),selection);
  need(identity(connection)===identity(selection.connection),'XERO_OAUTH_TENANT_CHANGED','The reviewed tenant differs from the retained native connection list.');
  validateXeroContext(selection.context);
  const context=createXeroContext({id:selection.id,name:connection.tenantName.slice(0,160),actor:selection.review.actor,
    createdAt:selection.createdAt,tenantId:selection.tenantId,organizationBytes,accountsBytes});
  need(identity(context)===identity(selection.context)&&selection.capturedAt===selection.responses.accounts.receivedAt,
    'XERO_OAUTH_CONTEXT_CHANGED','The selected organization or accounts differ from their original native responses.');
  need(Buffer.byteLength(JSON.stringify(selection))<=XERO_SELECTION_BYTES-1024,
    'XERO_OAUTH_SELECTION_SIZE','The complete retained tenant selection exceeds 128 MiB.',413);
  return selection;
}

export function xeroSelectionSummary(selection) {
  return {schema:selection.schema,id:selection.id,alias:selection.alias,profileSha256:selection.profileSha256,
    grantId:selection.grantId,connectionId:selection.connectionId,tenantId:selection.tenantId,
    authEventId:selection.connection.authEventId,tenantName:selection.connection.tenantName,
    tenantType:selection.connection.tenantType,organizationName:selection.context.organization.name,
    baseCurrency:selection.context.organization.baseCurrency,isDemoCompany:selection.context.organization.isDemoCompany,
    accountCount:selection.context.accounts.length,eligibleAccountCount:selection.context.accounts.filter(row=>row.eligible).length,
    contextSha256:selection.context.sha256,capturedAt:selection.capturedAt,review:clone(selection.review),integrity:clone(selection.integrity)};
}

export async function readXeroSelection(directory) {
  absolute(directory);await privateDirectory(directory);
  return validateXeroSelection(await readJson(join(directory,FILE),XERO_SELECTION_BYTES));
}

export async function saveXeroSelection(directory,{registry,selection,previewSha256,expectedSelectionSha256=null}={}) {
  const incoming=clone(await validateXeroSelection(selection));
  need(previewSha256===incoming.integrity.sha256&&(expectedSelectionSha256===null||hex(expectedSelectionSha256)),
    'XERO_OAUTH_SELECTION_REVIEW','Select the exact preview SHA and current saved selection identity.');
  absolute(directory);await privateDirectory(directory,true);
  return withOAuthConnectionLock(directory,async()=>{
    const current=await bindTarget(registry,incoming);
    need(identity(current.binding)===identity(incoming.binding),'XERO_OAUTH_GRANT_CHANGED','The reviewed tenant grant changed before saving.');
    let prior=null;
    try{prior=await readXeroSelection(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(prior?.integrity.sha256===incoming.integrity.sha256){await syncDirectory(directory);return {selection:prior,duplicate:true};}
    need(prior?.id!==incoming.id,'XERO_OAUTH_SELECTION_REQUEST_CHANGED','This selection UUID belongs to different reviewed input.');
    need((prior?.integrity.sha256??null)===expectedSelectionSha256,'XERO_OAUTH_SELECTION_STALE','Read the current tenant selection before replacing it.');
    try{await atomicJson(directory,FILE,incoming);}
    catch{throw Object.assign(fault('XERO_OAUTH_SELECTION_SAVE_UNKNOWN','Read and retry this same tenant preview and prior identity.',503),{outcomeUnknown:true});}
    return {selection:incoming,duplicate:false};
  });
}

/** Borrow a registry; this owner closes only its native flights and token provider. */
export async function openXeroOAuthClient({registry,selection,signal,...runtime}={}) {
  const retained=clone(await validateXeroSelection(selection)),bound=await bindTarget(registry,retained);
  need(identity(bound.binding)===identity(retained.binding),'XERO_OAUTH_GRANT_CHANGED','Select the current reviewed grant for this tenant.');
  const owner=await createClientOwner({registry,target:selectionIdentity(retained),selection:retained,...bound,...runtime});
  try{
    const current=await owner.fetchTenants({signal});
    selectedConnection(current.connections,retained,retained.connection);
    return owner;
  }catch(error){await owner.close();throw error;}
}

/** Run the original Xero workspace, source capture, draft/read operations and return recovery. */
export async function startXeroAccountingWorkspace({
  connectionsFile,selectionDirectory,env=process.env,allowLoopback=false,lookup,agent,fetchImpl,timeoutMs,signal,...accountingOptions
}={}) {
  need(accountingOptions.xeroClient===undefined,'XERO_OAUTH_CLIENT_OVERRIDE','The reviewed tenant supplies this native accounting client.',400);
  const environment={...env};
  const registry=await openOAuthConnectionRegistry({connections:await readOAuthHostConnections(connectionsFile),
    env:environment,allowLoopback,...(lookup?{lookup}:{}),...(agent?{agent}:{})});
  let owner,accounting,closing;
  const close=()=>{
    if(!closing)closing=(async()=>{
      const errors=[];
      try{await accounting?.close();}catch(error){errors.push(error);}
      try{await owner?.close();}catch(error){errors.push(error);}
      try{await registry.close();}catch(error){errors.push(error);}
      if(errors.length)throw Object.assign(new AggregateError(errors,'The managed Xero accounting owner did not close cleanly.'),{code:'XERO_OAUTH_CLOSE_FAILED'});
    })();
    return closing;
  };
  try{
    const selection=await readXeroSelection(selectionDirectory);
    owner=await openXeroOAuthClient({registry,selection,env:environment,allowLoopback,signal,
      ...(lookup?{lookup}:{}),...(agent?{agent}:{}),...(fetchImpl?{fetchImpl}:{}),...(timeoutMs===undefined?{}:{timeoutMs})});
    const {startAccountingWorkspace}=await import('../../merchant-settlement-accounting/workspace/server.mjs');
    accounting=await startAccountingWorkspace({...accountingOptions,xeroClient:owner.client});
    return Object.freeze({accounting,selection:xeroSelectionSummary(selection),
      connectionStatus:()=>registry.status(selection.alias),providerStatus:owner.snapshot,close});
  }catch(error){await close().catch(()=>{});throw error;}
}
