// MIT. Public source/profile planning on the original OpenAPI and OAuth authorities.
import { inspectOpenApi, merchantOAuthSelection } from '../../../sf61-openapi-seller-import/workspace/model.mjs';
import { parseOpenApiSource } from '../../../sf61-openapi-seller-import/source-document.mjs';
import { createOpenApiResolver } from '../../../sf61-openapi-seller-import/importer.mjs';
import { authorizationCodeSelection } from '../../../sf61-openapi-seller-import/workspace/authentication.mjs';
import { PROFILE_SCHEMA, normalizeOAuthProfile, oauthProfileIdentity, oauthCallbackPath,
  oauthRedirectOrigin, plain, hex, envName, identifier, scopes as originalScopes } from '../profile.mjs';
import { normalizeOAuthHostConnections } from '../host.mjs';
import { identity, digest, fault } from '../../postgres/publisher/files.mjs';

export const SETUP_SCHEMA = 'stellar-forge.oauth-setup-workspace.v1';
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_ENTRIES = 64;
export const MAX_SELECTIONS = 64;
export const MAX_CHOICES = 8192;
export const MAX_REVIEW_BYTES = 16 * 1024 * 1024;
export const MAX_INSPECTION_BYTES = 32 * 1024 * 1024;
export const limits = Object.freeze({maxSourceBytes:MAX_SOURCE_BYTES,maxEntries:MAX_ENTRIES,
  maxSelectionsPerEntry:MAX_SELECTIONS,maxChoices:MAX_CHOICES,maxReviewBytes:MAX_REVIEW_BYTES,
  maxInspectionBytes:MAX_INSPECTION_BYTES});
export const fail = (suffix, message, status=400) => {
  throw fault('OAUTH_SETUP_' + suffix, message, status);
};
export function need(value, suffix, message, status=400) {
  if (!value) fail(suffix, message, status);
}
export function fields(value, keys, label='setup input') {
  need(plain(value) && Object.keys(value).every(key=>keys.includes(key)),
    'INPUT_INVALID','Use the declared fields for ' + label + '.');
}
export function text(value, label, maximum=160, empty=false) {
  need(typeof value==='string' && value.isWellFormed() && Buffer.byteLength(value)<=maximum &&
    (empty || value.trim().length>0) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),
    'INPUT_INVALID','Enter a valid ' + label + '.');
  return value;
}
export function revision(value) {
  need(Number.isSafeInteger(value) && value>=0,'INPUT_INVALID','Use the current setup revision.');
  return value;
}
export function requestId(value) {
  need(identifier(value),'INPUT_INVALID','Retain one valid original request ID.');
  return value;
}
export function sourceId(value) {
  need(hex(value),'SOURCE_INVALID','Choose an exact retained source identity.');
  return value;
}
export function selection(value) {
  fields(value,['method','path','serverIndex','securityAlternative'],'source operation selection');
  need(typeof value.method==='string' && /^[A-Z]+$/.test(value.method) &&
    typeof value.path==='string' && value.path.startsWith('/') && value.path.isWellFormed() && Buffer.byteLength(value.path)<=4096 &&
    Number.isSafeInteger(value.serverIndex) && value.serverIndex>=0 &&
    Number.isSafeInteger(value.securityAlternative) && value.securityAlternative>=0,
    'INPUT_INVALID','Select an actual operation, server and security alternative.');
  return {method:value.method,path:value.path,serverIndex:value.serverIndex,
    securityAlternative:value.securityAlternative};
}
export function normalizeContext(raw={}) {
  fields(raw,['environmentFile','connectionsFile','port','allowLoopbackOAuth'],'current application context');
  const path = (value, label) => {
    need(value===null || value===undefined || typeof value==='string' && value.isWellFormed() && value.startsWith('/') && Buffer.byteLength(value)<=4096 &&
      !/[\x00-\x1f\x7f\\]/.test(value),'INPUT_INVALID','Select the current ' + label + '.');
    return value || null;
  };
  const port=raw.port??0;
  need(Number.isSafeInteger(port) && port>=0 && port<=65535,'CALLBACK_INVALID','Choose a valid local listener port.');
  need(raw.allowLoopbackOAuth===undefined || typeof raw.allowLoopbackOAuth==='boolean',
    'INPUT_INVALID','Choose the explicit local-provider setting.');
  return {environmentFile:path(raw.environmentFile,'environment file'),
    connectionsFile:path(raw.connectionsFile,'connection registry'),port,
    allowLoopbackOAuth:raw.allowLoopbackOAuth??false};
}
export function callbackUri(profile, profileSha256, port) {
  need(Number.isSafeInteger(port) && port>=1024 && port<=65535,'CALLBACK_INVALID',
    'Choose the fixed registered listener port between 1024 and 65535.');
  try { return oauthRedirectOrigin(profile,'http://127.0.0.1:' + port) + oauthCallbackPath(profileSha256); }
  catch { fail('CALLBACK_INVALID','Use the exact listener port registered for every selected callback.'); }
}
export function inspectSetupSource(sourceText) {
  need(typeof sourceText==='string' && sourceText.isWellFormed() && Buffer.byteLength(sourceText)>0 &&
    Buffer.byteLength(sourceText)<=MAX_SOURCE_BYTES,'SOURCE_INVALID','Import an original UTF-8 OpenAPI source of at most 4 MiB.');
  let inspection,document,resolver;
  try {
    inspection=inspectOpenApi(sourceText);
    document=parseOpenApiSource(sourceText).document;
    resolver=createOpenApiResolver(document);
  } catch { fail('SOURCE_INVALID','The original OpenAPI inspector could not read this source. Retain the complete valid source document.'); }
  const sha256=digest(Buffer.from(sourceText));
  need(inspection.sourceSha256===sha256,'SOURCE_INVALID','The original source inspector returned a different source identity.');
  const choices=[];
  for(const operation of inspection.operations) {
    if(!operation.supported || !operation.method || operation.error) continue;
    let item,op;
    try { item=resolver.reference(document.paths[operation.path]); op=item[operation.method.toLowerCase()]; }
    catch { continue; }
    for(const server of operation.servers??[]) {
      let backend;
      try {
        backend=new URL(server.url);
        if(server.variables || backend.username || backend.password || backend.search || backend.hash ||
          /[{}]/.test(server.url) || server.url!==backend.href && server.url!==backend.origin) continue;
      } catch { continue; }
      for(let index=0;index<(operation.authentication??[]).length;index++) {
        if(!operation.authentication[index]?.supported) continue;
        const selected={method:operation.method,path:operation.path,serverIndex:server.index,securityAlternative:index};
        let original;
        try { original=authorizationCodeSelection(document,op,selected,backend,{sourceSha256:sha256}); }
        catch { continue; }
        need(choices.length<MAX_CHOICES,'SOURCE_INVALID',
          'This source has more than 8192 selectable authorization combinations; use a source containing the intended service family.');
        choices.push({id:identity({source:sha256,selection:selected}),label:operation.method+' '+operation.path+
          ' · server '+server.index+' · '+original.scheme,
          selection:selected,scheme:original.scheme,authorizationEndpoint:original.authorizationEndpoint,
          tokenEndpoint:original.tokenEndpoint,resourceOrigin:original.resourceOrigin,
          requiredScopes:original.requiredScopes,declaredScopes:original.declaredScopes});
      }
    }
  }
  const result={inspection,choices};
  need(Buffer.byteLength(JSON.stringify(result,null,2))<=MAX_INSPECTION_BYTES,'SOURCE_INVALID',
    'The source inspection exceeds the retained 32 MiB review limit. Select the intended service-family source.');
  return result;
}
export function normalizeNewDefinition(raw, sourceText, {allowLoopback=false}={}) {
  fields(raw,['alias','directoryEnv','sourceId','selections','label','clientId','authMethod','scopes',
    'clientSecretEnv','revocationEndpoint','issuer','authorizationParameters','resourceParameters',
    'replacesProfileSha256'],'connection definition');
  try { normalizeOAuthHostConnections([{alias:raw.alias,directoryEnv:raw.directoryEnv}]); }
  catch { fail('INPUT_INVALID','Choose a distinct lowercase alias and a valid directory environment name.'); }
  sourceId(raw.sourceId);
  need(digest(Buffer.from(sourceText))===raw.sourceId,'SOURCE_CHANGED','The retained original source changed.',409);
  need(Array.isArray(raw.selections) && raw.selections.length>=1 && raw.selections.length<=MAX_SELECTIONS,
    'INPUT_INVALID','Select between 1 and 64 source operations for this connection.');
  const selections=raw.selections.map(selection),selectionIds=selections.map(identity);
  need(new Set(selectionIds).size===selectionIds.length,'INPUT_INVALID','Select each original operation only once.');
  let originals;
  try { originals=selections.map(value=>merchantOAuthSelection(sourceText,value)); }
  catch { fail('SOURCE_INVALID','Each selection must have an original supported authorizationCode flow.'); }
  const first=originals[0];
  need(originals.every(value=>value.sourceSha256===raw.sourceId && value.scheme===first.scheme &&
    value.authorizationEndpoint===first.authorizationEndpoint && value.tokenEndpoint===first.tokenEndpoint),
    'PROFILE_INVALID','One connection must use one exact source security scheme and declared authorization/token endpoint pair.');
  let scopes;
  try { scopes=originalScopes(raw.scopes); }
  catch { fail('PROFILE_INVALID','Select distinct declared space-free OAuth scopes.'); }
  need(originals.every(value=>value.requiredScopes.every(scope=>scopes.includes(scope)) &&
    scopes.every(scope=>value.declaredScopes.includes(scope))),'PROFILE_INVALID',
    'Include every required scope and select only scopes declared for the source flow.');
  const resourceOrigins=[...new Set(originals.map(value=>value.resourceOrigin))].sort();
  need(raw.replacesProfileSha256===undefined || hex(raw.replacesProfileSha256),
    'INPUT_INVALID','Confirm the exact prior profile before replacing a registered alias.');
  let profile;
  try {
    profile=normalizeOAuthProfile({schema:PROFILE_SCHEMA,label:raw.label,
      source:{sha256:raw.sourceId,scheme:first.scheme},
      authorizationEndpoint:first.authorizationEndpoint,tokenEndpoint:first.tokenEndpoint,
      clientId:raw.clientId,authMethod:raw.authMethod,scopes,resourceOrigins,pkceMethod:'S256',
      ...(raw.clientSecretEnv===undefined?{}:{clientSecretEnv:raw.clientSecretEnv}),
      ...(raw.revocationEndpoint===undefined?{}:{revocationEndpoint:raw.revocationEndpoint}),
      ...(raw.issuer===undefined?{}:{issuer:raw.issuer}),
      ...(raw.authorizationParameters===undefined?{}:{authorizationParameters:raw.authorizationParameters}),
      ...(raw.resourceParameters===undefined?{}:{resourceParameters:raw.resourceParameters}),
    },{allowLoopback});
  } catch { fail('PROFILE_INVALID','Use the original registered client, public endpoints, declared scopes and named secret reference.'); }
  const definition={alias:raw.alias,directoryEnv:raw.directoryEnv,sourceId:raw.sourceId,selections,
    label:profile.label,clientId:profile.clientId,authMethod:profile.authMethod,scopes:profile.scopes,
    ...(profile.clientSecretEnv===undefined?{}:{clientSecretEnv:profile.clientSecretEnv}),
    ...(profile.revocationEndpoint===undefined?{}:{revocationEndpoint:profile.revocationEndpoint}),
    ...(profile.issuer===undefined?{}:{issuer:profile.issuer}),
    authorizationParameters:profile.authorizationParameters,resourceParameters:profile.resourceParameters,
    ...(raw.replacesProfileSha256===undefined?{}:{replacesProfileSha256:raw.replacesProfileSha256})};
  return {definition,profile,profileSha256:oauthProfileIdentity(profile),sourceId:raw.sourceId};
}
export function publicEntry(entry) {
  return {kind:entry.kind,alias:entry.alias,directoryEnv:entry.directoryEnv,sourceId:entry.sourceId,
    profileSha256:entry.profileSha256,profile:entry.profile,callbackUri:entry.callbackUri,
    ...(entry.definition?{definition:entry.definition}:{}),
    ...(entry.existingGrant?{existingGrant:entry.existingGrant}:{})};
}
export function normalizeDesiredEntries(entries) {
  need(Array.isArray(entries) && entries.length<=MAX_ENTRIES,
    'INPUT_INVALID','Review a complete registry containing between 0 and 64 connections.');
  for(const entry of entries) {
    need(plain(entry),'INPUT_INVALID','Each desired connection must be an object.');
    if(Object.hasOwn(entry,'retainAlias')) {
      fields(entry,['retainAlias','expectedProfileSha256'],'retained alias');
      need(typeof entry.retainAlias==='string' && hex(entry.expectedProfileSha256),
        'INPUT_INVALID','Select the exact current retained alias and profile.');
    }
  }
  return entries;
}
export function setupError(error) {
  if(/^OAUTH_SETUP_[A-Z_]+$/.test(error?.code??''))
    return error;
  return fault('OAUTH_SETUP_IO_FAILED','The private setup operation could not finish. Read its retained status before retrying.',500);
}
export {plain,hex,envName,identifier,identity,digest};
