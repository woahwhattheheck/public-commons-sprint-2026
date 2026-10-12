// MIT. Original Applications ownership and installed-runtime boundary for OAuth setup.
import { lstat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { privateDirectory, readJSON } from './storage.mjs';
import { applicationEnvironment } from './application-command.mjs';
import { oauthSetupAction, resolveOAuthSetupEdition } from '../../sf30-seller-sdk/oauth-connections/setup/workspace.mjs';
import { loadOAuthSetupProviders } from '../../sf30-seller-sdk/oauth-connections/setup/providers.mjs';
import { MAX_SOURCE_BYTES, limits, fields, need, plain, identity, setupError } from '../../sf30-seller-sdk/oauth-connections/setup/model.mjs';

const PREFIX='stellar/scf-starforge-20261009/';
const CATALOG='stellar-forge.oauth-setup-catalog.v1';
export const OPENAPI_SETUP_ROUTES=Object.freeze({
  catalog:'catalog','import-source':'source.import','import-provider':'source.provider','inspect-source':'source.inspect',
  review:'review',commit:'commit',status:'status',activate:'activate',download:'download',recover:'recover',
});
export function openApiSetupBodyLimit(action) {
  need(Object.hasOwn(OPENAPI_SETUP_ROUTES,action),'INPUT_INVALID','Select an original connection setup action.');
  if(action==='import-source')return 6*MAX_SOURCE_BYTES+65536;
  if(action==='review')return 32*1024*1024;
  return 32768;
}
const same=(a,b)=>identity(a)===identity(b);
const within=(root,value)=>{
  const part=relative(root,value);
  return part==='' || part!=='..' && !part.startsWith('..'+sep) && !isAbsolute(part);
};
function configuredPath(value,label) {
  need(typeof value==='string' && value.isWellFormed() && Buffer.byteLength(value)<=4096 &&
    isAbsolute(value) && value!=='/' && !/[\x00-\x1f\x7f\\]/.test(value),
    'INPUT_INVALID','Use the original host-configured '+label+'.');
  return value;
}
function policyValues(policy) {
  fields(policy,['directory','grantRoot','selectionRoot','allowLoopbackOAuth'],'host connection setup policy');
  need(policy.allowLoopbackOAuth===undefined || typeof policy.allowLoopbackOAuth==='boolean',
    'INPUT_INVALID','Use an explicit receiving-host local-provider policy.');
  return {
    ...(policy.directory===undefined?{}:{directory:configuredPath(policy.directory,'setup directory')}),
    ...(policy.grantRoot===undefined?{}:{grantRoot:configuredPath(policy.grantRoot,'grant directory')}),
    ...(policy.selectionRoot===undefined?{}:{selectionRoot:configuredPath(policy.selectionRoot,'accounting selection directory')}),
    allowLoopbackOAuth:policy.allowLoopbackOAuth===true,
  };
}
function runtimeIdentity(runtime,runtimeId) {
  return {runtimeId,directory:runtime.directory,installationId:runtime.installationId,
    profileId:runtime.profileId,profileSha256:runtime.profileSha256,lockSha256:runtime.lockSha256,
    sourceCommit:runtime.sourceCommit,sourceManifestSha256:runtime.sourceManifestSha256,
    sourceRoot:runtime.sourceRoot};
}
async function originalSelection(root,input) {
  await privateDirectory(configuredPath(root,'runtime workspace'));
  const workspace=await readJSON(join(root,'workspace.json'));
  need(workspace.schema==='stellar-forge.runtime-workspace.v1' && workspace.directory===root &&
    typeof workspace.workspaceId==='string' && workspace.workspaceId.length>0 &&
    typeof workspace.runtimeHome==='string','DIRECTORY_CHANGED',
    'Open the original runtime workspace before preparing its connection setup.',409);
  await privateDirectory(workspace.runtimeHome);
  await privateDirectory(join(root,'entries'));
  need(typeof input.runtimeId==='string' && /^[a-f0-9]{24}$/.test(input.runtimeId),
    'INPUT_INVALID','Choose an existing runtime from this Applications workspace.');
  const entry=await readJSON(join(root,'entries',input.runtimeId+'.json'));
  need(entry.id===input.runtimeId && typeof entry.directory==='string' &&
    (input.runtimeDirectory===undefined || entry.directory===input.runtimeDirectory),
    'DIRECTORY_CHANGED','The selected runtime no longer matches this original workspace entry.',409);
  await privateDirectory(entry.directory);
  return {workspace,entry};
}
async function capability(directory,runtimeId) {
  let runtime;
  try { runtime=await inspectMerchantRuntime(directory,{load:false}); }
  catch { return {enabled:false,reason:'Select an original READY runtime with its verified source and dependency profile.'}; }
  const binding=runtimeIdentity(runtime,runtimeId);
  const paths={
    profile:'sf30-seller-sdk/oauth-connections/profile.mjs',
    store:'sf30-seller-sdk/oauth-connections/store.mjs',
    managed:'sf61-openapi-seller-import/workspace/managed-launch.mjs',
  };
  try {
    for(const name of Object.keys(paths)) {
      const path=join(runtime.sourceRoot,PREFIX,paths[name]),info=await lstat(path);
      need(info.isFile() && !info.isSymbolicLink() && await realpath(path)===path,
        'RUNTIME_UNAVAILABLE','The selected runtime needs its original managed OpenAPI and OAuth source.',409);
      paths[name]=path;
    }
    const [profile,store,managed]=await Promise.all([
      import(pathToFileURL(paths.profile).href),
      import(pathToFileURL(paths.store).href),
      import(pathToFileURL(paths.managed).href),
    ]);
    need(['normalizeOAuthProfile','oauthProfileIdentity','oauthCallbackPath','oauthRedirectOrigin']
      .every(name=>typeof profile[name]==='function') &&
      ['initializeOAuthConnection','oauthConnectionStatus'].every(name=>typeof store[name]==='function') &&
      typeof managed.inspectOpenApiLaunch==='function','RUNTIME_UNAVAILABLE',
      'The selected runtime needs its original managed OpenAPI and OAuth interfaces.',409);
    const providers=await loadOAuthSetupProviders({sourceRoot:runtime.sourceRoot,profileAuthority:profile});
    return {enabled:true,binding,profile,managed,providers};
  } catch {
    return {enabled:false,runtimeBinding:binding,
      reason:'This READY runtime does not expose the original managed OpenAPI/OAuth setup contract. Select a compatible installed edition; existing plain OpenAPI applications retain their original launch path.'};
  }
}

async function selectedSetup(root,{runtimeId,runtimeDirectory},policy) {
  const selected=await originalSelection(root,{runtimeId,runtimeDirectory}),hostPolicy=policyValues(policy);
  const installed=await capability(selected.entry.directory,runtimeId);
  if(!installed.enabled)return {enabled:false,installed,hostPolicy};
    const directory=hostPolicy.directory??join(root,'oauth-setup');
    const grantRoot=hostPolicy.grantRoot??join(root,'oauth-grants');
    const selectionRoot=hostPolicy.selectionRoot??join(root,'oauth-accounting');
    for(const path of [directory,grantRoot,selectionRoot])need(!within(installed.binding.directory,path) &&
      !within(path,installed.binding.directory),'DIRECTORY_CHANGED',
      'Keep setup and grant data separate from the selected installed runtime.',409);
    const validateReview=async({entries,context:reviewed})=>{
      try {
        for(const entry of entries) {
          const profile=installed.profile.normalizeOAuthProfile(entry.profile,{allowLoopback:reviewed.allowLoopbackOAuth});
          need(same(profile,entry.profile) && installed.profile.oauthProfileIdentity(profile)===entry.profileSha256 &&
            installed.profile.oauthRedirectOrigin(profile,'http://127.0.0.1:'+reviewed.port)+
            installed.profile.oauthCallbackPath(entry.profileSha256)===entry.callbackUri,
            'RUNTIME_UNAVAILABLE','A reviewed profile or callback is not supported by this selected runtime.',409);
        }
      } catch(error) {
        if(error.code?.startsWith('OAUTH_SETUP_'))throw error;
        need(false,'RUNTIME_UNAVAILABLE','A reviewed profile is not supported by the selected original OAuth runtime.',409);
      }
    };
    const validatePrepared=async({prepared,entries,context:reviewed})=>{
      await validateReview({entries,context:reviewed});
      try {
        const environment=await applicationEnvironment(prepared.settings.environmentFile);
        need(environment.sha256===prepared.environmentSha256,'EDITION_CHANGED',
          'The prepared private environment no longer matches its immutable edition.',409);
        const checked=await installed.managed.inspectOpenApiLaunch({
          outputParent:directory,port:prepared.settings.port,
          oauthConnectionsFile:prepared.settings.oauthConnectionsFile,
          allowLoopbackOAuth:prepared.settings.allowLoopbackOAuth,
        },{env:environment.environment});
        need(checked.review.connectionsFile===prepared.settings.oauthConnectionsFile &&
          checked.review.connectionsSha256===prepared.registrySha256 &&
          checked.review.port===prepared.settings.port &&
          checked.review.allowLoopbackOAuth===prepared.settings.allowLoopbackOAuth &&
          checked.review.profiles.length===entries.length &&
          same(checked.connections,entries.map(({alias,directoryEnv})=>({alias,directoryEnv}))),
          'EDITION_CHANGED','The selected runtime did not inspect the exact prepared registry.',409);
        for(const entry of entries) {
          const actual=checked.review.profiles.find(value=>value.alias===entry.alias);
          need(actual && actual.directoryEnv===entry.directoryEnv &&
            actual.directory===entry.directory && actual.profileSha256===entry.profileSha256 &&
            same(actual.source,entry.profile.source) && actual.callbackUri===entry.callbackUri,
            'EDITION_CHANGED','The selected runtime opened a different prepared source registration.',409);
        }
      } catch(error) {
        if(error.code?.startsWith('OAUTH_SETUP_'))throw error;
        need(false,'RUNTIME_UNAVAILABLE','The selected runtime could not inspect this prepared registry and private environment. Restore its original runtime/profile inputs before recovery.',409);
      }
    };
    need(!within(installed.binding.sourceRoot,selectionRoot) &&
      !within(selectionRoot,installed.binding.sourceRoot),'DIRECTORY_CHANGED',
      'Keep native accounting selections separate from installed source.',409);
    return {enabled:true,installed,hostPolicy,options:{
      directory,grantRoot,selectionRoot,ownerDirectory:root,ownerWorkspaceId:selected.workspace.workspaceId,
      runtimeBinding:installed.binding,policy:{allowLoopbackOAuth:hostPolicy.allowLoopbackOAuth},
      providers:installed.providers,validateReview,validatePrepared,
    }};
}

/**
 * runtimeDirectory is supplied only by the original model's entry lookup, then
 * independently cross-checked here. policy is receiving-host configuration and
 * must never be read from an HTTP request.
 */
export async function openApiConnectionSetupAction(root,{
  action,runtimeId,runtimeDirectory,context={},input={},
}={}, {policy={}}={}) {
  try {
    need(Object.hasOwn(OPENAPI_SETUP_ROUTES,action),'INPUT_INVALID','Choose a supported connection setup action.');
    need(plain(input),'INPUT_INVALID','Use an object for this setup action.');
    const selected=await selectedSetup(root,{runtimeId,runtimeDirectory},policy);
    if(!selected.enabled) {
      if(action==='catalog')return {schema:CATALOG,enabled:false,reason:selected.installed.reason,
        runtimeBinding:selected.installed.runtimeBinding??null,limits,providers:[],
        policy:{allowLoopbackOAuth:selected.hostPolicy.allowLoopbackOAuth}};
      need(false,'RUNTIME_UNAVAILABLE',selected.installed.reason,409);
    }
    return await oauthSetupAction(selected.options,{action:OPENAPI_SETUP_ROUTES[action],context,input});
  } catch(error) { throw setupError(error); }
}

/**
 * Trusted native company/tenant facade only. This result includes the effective
 * PRIVATE environment. Never expose it as an HTTP action or serialize it to a
 * normal download/log. The original provider helpers still check the current
 * reviewed grant and native company/tenant on every acquisition and save.
 */
export async function resolveOpenApiSetupEdition(root,{
  runtimeId,runtimeDirectory,editionId,alias,expectedProfileSha256,
}={}, {policy={}}={}) {
  try {
    const selected=await selectedSetup(root,{runtimeId,runtimeDirectory},policy);
    need(selected.enabled,'RUNTIME_UNAVAILABLE',selected.installed.reason??
      'Select a compatible original READY runtime.',409);
    return await resolveOAuthSetupEdition(selected.options,{editionId,alias,expectedProfileSha256});
  } catch(error) { throw setupError(error); }
}

/** Explicit safe projection for command output and authenticated operator views. */
export function openApiSetupEditionSummary(binding) {
  need(plain(binding) && binding.schema==='stellar-forge.oauth-setup-host-edition.v1' &&
    plain(binding.entry) && plain(binding.selection) && plain(binding.status),
    'INPUT_INVALID','Use the original resolved host edition.');
  return {
    schema:'stellar-forge.oauth-setup-accounting-binding.v1',edition:binding.edition,
    provider:binding.provider,prepared:binding.prepared,alias:binding.entry.alias,
    directoryEnv:binding.entry.directoryEnv,profileSha256:binding.entry.profileSha256,
    source:binding.entry.profile.source,callbackUri:binding.entry.callbackUri,
    grant:{id:binding.status.grant.id,state:binding.status.grant.state,
      scopes:[...binding.status.grant.scopes]},
    selection:{directory:binding.selection.directory,key:binding.selection.key,
      owner:{...binding.selection.owner}},
  };
}
