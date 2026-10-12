// MIT. Reviewed company selection over the original OAuth owner and native QBO client.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readJson, atomicJson, syncDirectory, digest, identity, fault } from '../postgres/publisher/files.mjs';
import { withOAuthConnectionLock } from './store.mjs';
import { createOAuthConnectionProvider } from './provider.mjs';
import { readOAuthHostConnections, openOAuthConnectionRegistry } from './host.mjs';
import { PROFILE_SCHEMA, INTUIT_QBO_PROVIDER, INTUIT_QBO_SCOPE, INTUIT_QBO_ENDPOINTS, normalizeOAuthProfile,
  intuitQboProfile, compileOAuthConnection, plain, hex, qboRealm, text } from './profile.mjs';
import { QboHttpClient } from '../../merchant-settlement-accounting/accountant/qbo-http.mjs';
import { validateQboCompany } from '../../merchant-settlement-accounting/accountant/qbo-company.mjs';

export const QUICKBOOKS_SELECTION_SCHEMA = 'stellar-forge.quickbooks-oauth-company-selection.v1';
export const QUICKBOOKS_SELECTION_BYTES = 32 * 1024 * 1024;
const SCHEME = 'quickbooksAccounting', FILE = 'selection.json';
const need = (yes, code, message, status=409) => { if (!yes) throw fault(code, message, status); };
const fields = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const aliasName = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const safe = value => structuredClone(value);
let sourcePromise;

/** Exact shipped operation bytes also import into the existing API merchant workspace. */
export async function quickbooksSource() {
  if (!sourcePromise) sourcePromise = (async () => {
    const bytes = await readFile(new URL('./quickbooks.openapi.json', import.meta.url));
    need(bytes.length > 0 && bytes.length <= 65536, 'QBO_OAUTH_SOURCE', 'The native QuickBooks operation descriptor is unavailable.');
    const source = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    const flow = source.components?.securitySchemes?.[SCHEME]?.flows?.authorizationCode;
    need(flow?.authorizationUrl === INTUIT_QBO_ENDPOINTS.authorization && flow?.tokenUrl === INTUIT_QBO_ENDPOINTS.token &&
      Object.hasOwn(flow.scopes ?? {}, INTUIT_QBO_SCOPE), 'QBO_OAUTH_SOURCE', 'The native operation descriptor differs from its OAuth dialect.');
    return Object.freeze({sha256:digest(bytes),scheme:SCHEME});
  })().catch(error => { sourcePromise = null; throw error; });
  return {...await sourcePromise};
}

/** Public registration only. The original core still initializes and owns its private grant. */
export async function createQuickBooksProfile({clientId,clientSecretEnv,callbackOrigin,environment='sandbox',label='QuickBooks Online'}={}) {
  return normalizeOAuthProfile({
    schema:PROFILE_SCHEMA,label,source:await quickbooksSource(),
    authorizationEndpoint:INTUIT_QBO_ENDPOINTS.authorization,tokenEndpoint:INTUIT_QBO_ENDPOINTS.token,
    revocationEndpoint:INTUIT_QBO_ENDPOINTS.revoke,clientId,clientSecretEnv,authMethod:'client_secret_basic',
    scopes:[INTUIT_QBO_SCOPE],resourceOrigins:[INTUIT_QBO_ENDPOINTS[environment]],
    pkceMethod:'none',provider:{kind:INTUIT_QBO_PROVIDER,environment},callbackOrigin,
  });
}

function currentTarget(status, expected, source, {requireConnected=true}={}) {
  need(status && intuitQboProfile(status.profile) && status.profile.source.sha256 === source.sha256 &&
    status.profile.source.scheme === source.scheme, 'QBO_OAUTH_SOURCE_CHANGED',
    'Choose an Intuit connection registered for this native QuickBooks operation source.');
  need(aliasName(expected.alias) && status.alias === expected.alias &&
    status.profileSha256 === expected.profileSha256 && status.grant.id === expected.grantId &&
    status.grant.realmId === expected.realmId && qboRealm(expected.realmId) &&
    status.profile.provider.environment === expected.environment &&
    status.profile.resourceOrigins.length === 1 && status.profile.resourceOrigins[0] === INTUIT_QBO_ENDPOINTS[expected.environment],
  'QBO_OAUTH_COMPANY_CHANGED', 'The selected alias, reviewed grant, company or environment changed. Select its current reviewed company.');
  need(status.grant.review && status.grant.scopes.includes(INTUIT_QBO_SCOPE) &&
    (requireConnected ? status.grant.state === 'connected' : ['connected','refreshing'].includes(status.grant.state)),
  'QBO_OAUTH_GRANT_REQUIRED', 'Connect and review the selected QuickBooks authorization in the original connection workspace.');
  return status;
}

export async function listQuickBooksConnections(registry) {
  const source = await quickbooksSource();
  return (await registry.list()).filter(value => intuitQboProfile(value.profile)).map(value => ({
    alias:value.alias,label:value.profile.label,directoryEnv:value.directoryEnv,profileSha256:value.profileSha256,
    grantId:value.grant.id,realmId:value.grant.realmId ?? null,environment:value.profile.provider.environment,
    state:value.grant.state,review:value.grant.review,refreshExpiresAt:value.grant.refreshExpiresAt,
    refreshHardExpiresAt:value.grant.refreshHardExpiresAt ?? null,
    sourceMatches:value.profile.source.sha256 === source.sha256 && value.profile.source.scheme === source.scheme,
    ready:value.profile.source.sha256 === source.sha256 && value.profile.source.scheme === source.scheme &&
      value.grant.state === 'connected' && Boolean(value.grant.review) && qboRealm(value.grant.realmId),
  }));
}

async function bindTarget(registry, expected, options={}) {
  const source = await quickbooksSource(), status = currentTarget(await registry.status(expected.alias), expected, source, options);
  const binding = await registry.binding(expected.alias, {sourceSha256:source.sha256,scheme:source.scheme,
    resourceOrigin:INTUIT_QBO_ENDPOINTS[expected.environment],requiredScopes:[INTUIT_QBO_SCOPE]});
  need(binding.profileSha256 === expected.profileSha256 && binding.grantId === expected.grantId,
    'QBO_OAUTH_COMPANY_CHANGED', 'The reviewed company changed while selecting its application binding.');
  return {source,status,binding};
}

async function createClientOwner({registry,target,binding,source,companyName=null,env=process.env,allowLoopback=false,lookup,
  fetchImpl=globalThis.fetch,minorVersion=null}) {
  const pin=Object.freeze({alias:target.alias,profileSha256:target.profileSha256,grantId:target.grantId,
    realmId:target.realmId,environment:target.environment});
  const origin=INTUIT_QBO_ENDPOINTS[pin.environment], environment={...env};
  need(typeof fetchImpl==='function','QBO_OAUTH_TRANSPORT','Use the native HTTP transport.',400);
  const provider=createOAuthConnectionProvider(binding,{resourceOrigin:origin,env:environment,allowLoopback,...(lookup?{lookup}:{})});
  let closed=false;
  const client=new QboHttpClient({
    realmId:pin.realmId,environment:pin.environment,minorVersion,
    tokenProvider:async({realmId,environment,signal})=>{
      need(!closed,'QBO_OAUTH_CLOSED','The OAuth-connected accounting workspace is closed.');
      need(realmId===pin.realmId&&environment===pin.environment,'QBO_OAUTH_COMPANY_CHANGED','Use the exact selected QuickBooks company.');
      signal?.throwIfAborted();
      currentTarget(await registry.status(pin.alias),pin,source,{requireConnected:false});
      const headers=await provider.headers({signal});
      return headers.authorization.slice(7);
    },
    fetchImpl:async(url,init)=>{
      need(new URL(url).origin===origin&&new URL(url).pathname.startsWith('/v3/company/'+pin.realmId+'/'),
        'QBO_OAUTH_RESOURCE_CHANGED','Send this grant only to its reviewed native company.');
      const response=await fetchImpl(url,init);
      if(response.status===401) {
        // Keep the actual original response. A later explicit native resume
        // acquires the renewed grant; no accounting request is replayed here.
        const authorization=new Headers(init.headers).get('authorization');
        provider.invalidate(authorization ?? undefined);
      }
      return response;
    },
  });
  const company=client.company.bind(client),info=client.info.bind(client);
  client.company=async(value,options={})=>{
    try{return await company(value,options);}
    catch(error){
      if(error.code!=='QBO_COMPANY_FETCH_FAILED'||error.nativeStatus!==401)throw error;
      // Company setup is a read. Renew the rejected bearer in the original
      // owner, then restart this complete source capture once. Journal writes
      // retain their original HTTP result and require the native resume path.
      await provider.headers({signal:options.signal});
      return company(value,options);
    }
  };
  client.info=()=>{
    const status=provider.snapshot();
    return {...info(),authorization:{kind:'oauth-connection',...pin,companyName,
      state:status.state,lastError:status.lastError}};
  };
  Object.freeze(client);
  let closing;
  return Object.freeze({
    client,
    snapshot:()=>({authorization:{kind:'oauth-connection',...pin,companyName},provider:provider.snapshot()}),
    close(){if(!closing){closed=true;closing=provider.close();}return closing;},
  });
}

/** Read native company/settings/all account pages through the approved private grant. */
export async function previewQuickBooksSelection({
  registry,alias,profileSha256,grantId,realmId,environment,actor,reference='',
  id=randomUUID(),createdAt=new Date().toISOString(),minorVersion=null,signal,...runtime
}={}) {
  need(uuid(id)&&timestamp(createdAt),'QBO_OAUTH_SELECTION_ID','Retain one UUID and creation time for the company review.');
  text(actor,'company reviewer',160);text(reference,'company review reference',2000,true);
  const target={alias,profileSha256,grantId,realmId,environment};
  const selected=await bindTarget(registry,target);
  const owner=await createClientOwner({registry,target,...selected,...runtime,minorVersion});
  try {
    const captured=await owner.client.company({realmId,environment},{signal});
    // Refresh can advance the grant generation; replacing the approved grant cannot.
    const latest=await bindTarget(registry,target);
    need(identity(latest.binding)===identity(selected.binding),'QBO_OAUTH_COMPANY_CHANGED','The selected grant binding changed while reading its company.');
    const body={schema:QUICKBOOKS_SELECTION_SCHEMA,id,createdAt,alias,profileSha256,grantId,realmId,environment,
      source:selected.source,binding:selected.binding,minorVersion:owner.client.minorVersion,
      capturedAt:captured.capturedAt,company:captured.company,review:{actor,reference}};
    return {...body,integrity:{sha256:identity(body)}};
  } finally {await owner.close();}
}

export async function validateQuickBooksSelection(selection) {
  need(fields(selection,['schema','id','createdAt','alias','profileSha256','grantId','realmId','environment','source',
    'binding','minorVersion','capturedAt','company','review','integrity']) &&
    selection.schema===QUICKBOOKS_SELECTION_SCHEMA&&uuid(selection.id)&&timestamp(selection.createdAt)&&
    timestamp(selection.capturedAt)&&aliasName(selection.alias)&&hex(selection.profileSha256)&&qboRealm(selection.realmId)&&
    ['sandbox','production'].includes(selection.environment)&&
    (selection.minorVersion===null||typeof selection.minorVersion==='string'&&/^[1-9][0-9]{0,3}$/.test(selection.minorVersion))&&
    fields(selection.integrity,['sha256'])&&hex(selection.integrity.sha256),
  'QBO_OAUTH_SELECTION_INVALID','Use the complete retained QuickBooks company selection.',400);
  const {integrity,...body}=selection;
  need(identity(body)===integrity.sha256,'QBO_OAUTH_SELECTION_CHANGED','The retained company selection changed.');
  need(fields(selection.source,['sha256','scheme'])&&identity(selection.source)===identity(await quickbooksSource()),
    'QBO_OAUTH_SOURCE_CHANGED','The selection belongs to a different native QuickBooks operation source.');
  const binding=compileOAuthConnection(selection.binding,{resourceOrigin:INTUIT_QBO_ENDPOINTS[selection.environment]});
  need(binding.profileSha256===selection.profileSha256&&binding.grantId===selection.grantId&&
    binding.requiredScopes.length===1&&binding.requiredScopes[0]===INTUIT_QBO_SCOPE,
  'QBO_OAUTH_SELECTION_INVALID','The selection must retain its exact reviewed grant binding.');
  need(fields(selection.review,['actor','reference']),'QBO_OAUTH_REVIEW_REQUIRED','Keep the company reviewer and reference.');
  text(selection.review.actor,'company reviewer',160);text(selection.review.reference,'company review reference',2000,true);
  validateQboCompany(selection.company);
  need(selection.company.realmId===selection.realmId,'QBO_OAUTH_COMPANY_CHANGED','The native company source belongs to a different realm.');
  need(Buffer.byteLength(JSON.stringify(selection))<=QUICKBOOKS_SELECTION_BYTES-1024,
    'QBO_OAUTH_SELECTION_SIZE','The retained company selection exceeds its supported source size.',413);
  return selection;
}

export function quickBooksSelectionSummary(selection) {
  return {schema:selection.schema,id:selection.id,alias:selection.alias,realmId:selection.realmId,
    environment:selection.environment,profileSha256:selection.profileSha256,grantId:selection.grantId,
    minorVersion:selection.minorVersion,companyName:selection.company.companyName,baseCurrency:selection.company.baseCurrency,
    accountCount:selection.company.summary.accountCount,selectableAccountCount:selection.company.summary.selectableAccountCount,
    companySha256:selection.company.integrity.sha256,capturedAt:selection.capturedAt,
    review:safe(selection.review),integrity:safe(selection.integrity)};
}

export async function readQuickBooksSelection(directory) {
  absolute(directory);await privateDirectory(directory);
  return validateQuickBooksSelection(await readJson(join(directory,FILE),QUICKBOOKS_SELECTION_BYTES));
}

/** Save one explicit company choice with an expected prior identity and exact retry. */
export async function saveQuickBooksSelection(directory,{registry,selection,previewSha256,expectedSelectionSha256=null}={}) {
  const incoming=safe(await validateQuickBooksSelection(selection));
  need(previewSha256===incoming.integrity.sha256&&(expectedSelectionSha256===null||hex(expectedSelectionSha256)),
    'QBO_OAUTH_SELECTION_REVIEW','Select the exact preview and the current saved selection identity.');
  absolute(directory);await privateDirectory(directory,true);
  return withOAuthConnectionLock(directory,async()=>{
    const selected=await bindTarget(registry,incoming);
    need(identity(selected.binding)===identity(incoming.binding),'QBO_OAUTH_COMPANY_CHANGED','The current connection binding differs from the company review.');
    let prior=null;
    try{prior=await readQuickBooksSelection(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(prior?.integrity.sha256===incoming.integrity.sha256){await syncDirectory(directory);return {selection:prior,duplicate:true};}
    need(prior?.id!==incoming.id,'QBO_OAUTH_SELECTION_REQUEST_CHANGED','This selection ID already belongs to different reviewed input.');
    need((prior?.integrity.sha256??null)===expectedSelectionSha256,'QBO_OAUTH_SELECTION_STALE','The saved company selection changed. Read it before replacing it.');
    try{await atomicJson(directory,FILE,incoming);}
    catch {
      throw Object.assign(fault('QBO_OAUTH_SELECTION_SAVE_UNKNOWN','Read the saved selection and retry this same preview and prior identity.',503),{outcomeUnknown:true});
    }
    return {selection:incoming,duplicate:false};
  });
}

/** Provider ownership is separate from the existing registry's controller ownership. */
export async function openQuickBooksOAuthClient({registry,selection,...runtime}={}) {
  const retained=safe(await validateQuickBooksSelection(selection)), selected=await bindTarget(registry,retained);
  need(identity(selected.binding)===identity(retained.binding),'QBO_OAUTH_COMPANY_CHANGED','Select the current reviewed grant for this company.');
  return createClientOwner({registry,target:retained,...selected,...runtime,
    companyName:retained.company.companyName,minorVersion:retained.minorVersion});
}

/** Reuse the original accounting server and all its controllers, routes and recovery. */
export async function startQuickBooksAccountingWorkspace({
  connectionsFile,selectionDirectory,env=process.env,allowLoopback=false,lookup,fetchImpl,...accountingOptions
}={}) {
  need(accountingOptions.qboClient===undefined,'QBO_OAUTH_CLIENT_OVERRIDE','The selected OAuth company supplies this accounting client.',400);
  const environment={...env};
  const registry=await openOAuthConnectionRegistry({connections:await readOAuthHostConnections(connectionsFile),
    env:environment,allowLoopback,...(lookup?{lookup}:{})});
  let owner,accounting,closing;
  const close=()=>{
    if(!closing)closing=(async()=>{
      const errors=[];
      // Native accounting aborts and drains its operations before the private
      // provider and original OAuth controllers release their owned exchanges.
      try{await accounting?.close();}catch(error){errors.push(error);}
      try{await owner?.close();}catch(error){errors.push(error);}
      try{await registry.close();}catch(error){errors.push(error);}
      if(errors.length)throw Object.assign(new AggregateError(errors,'The connected accounting owner did not close cleanly.'),{code:'QBO_OAUTH_CLOSE_FAILED'});
    })();
    return closing;
  };
  try {
    const selection=await readQuickBooksSelection(selectionDirectory);
    owner=await openQuickBooksOAuthClient({registry,selection,env:environment,allowLoopback,
      ...(lookup?{lookup}:{}),...(fetchImpl?{fetchImpl}:{})});
    const {startAccountingWorkspace}=await import('../../merchant-settlement-accounting/workspace/server.mjs');
    accounting=await startAccountingWorkspace({...accountingOptions,qboClient:owner.client});
    return Object.freeze({accounting,selection:quickBooksSelectionSummary(selection),
      connectionStatus:()=>registry.status(selection.alias),providerStatus:owner.snapshot,close});
  } catch(error) {await close().catch(()=>{});throw error;}
}
