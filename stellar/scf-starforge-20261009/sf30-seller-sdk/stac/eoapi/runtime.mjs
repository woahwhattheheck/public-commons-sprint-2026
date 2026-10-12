// MIT. Original source custody and operator owners, composed for eoAPI onboarding.
import {join,resolve} from 'node:path';
import {lookup as systemLookup} from 'node:dns/promises';
import {need,privateDirectory,readJson,jsonBytes} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {createSourceBearerAuth} from '../../../sf31-buyer-client/source-auth.mjs';
import {createOAuthConnectionProvider} from '../../oauth-connections/provider.mjs';
import {openStacWorkspace} from '../workspace.mjs';
import {openDeploymentPolicyWorkspace} from './policy-workspace.mjs';
import {openEoapiOnboarding} from './onboarding.mjs';
import {stacRetain} from '../merchant.mjs';
import {sha256} from '../provider.mjs';
import {openCommissioningWorkspace,inspectCommissioningPackage} from './commissioning/workspace.mjs';
import {createCommissioningController} from './commissioning/controller.mjs';

export const SOURCE_RUNTIME_SCHEMA='starforge.stac-eoapi-source-runtime.v1';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const name=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

/** This configuration is private host configuration. It contains references only;
 * the original OAuth connection owns authorization, refresh and revocation. */
export function createEoapiSourceRuntime({configuration={},transport,environment=process.env,
  lookup=systemLookup,resolveCredential}={}) {
  need(plain(configuration)&&[undefined,SOURCE_RUNTIME_SCHEMA].includes(configuration.schema),'EOAPI_SOURCE_CONFIGURATION_INVALID');
  need(plain(environment)&&typeof lookup==='function'&&(resolveCredential===undefined||typeof resolveCredential==='function'),
    'EOAPI_SOURCE_RUNTIME_INVALID');
  const managed=configuration.oauthConnections??{},configured=configuration.principals??{};
  need(plain(managed)&&plain(configured),'EOAPI_SOURCE_CONNECTIONS_INVALID');
  const bindings=configuration.bindings??[];
  need(Array.isArray(bindings),'EOAPI_SOURCE_BINDINGS_INVALID');
  const profiles=new Map([['public',{name:'Public source',bindings:[]}],['operator',{name:'Operator source',bindings}]]);
  for(const [id,value]of Object.entries(configured)) {
    need(name(id)&&id!=='public'&&id!=='operator'&&plain(value)&&Array.isArray(value.bindings)&&
      typeof value.name==='string'&&value.name.length>0&&value.name.length<=160,'EOAPI_SOURCE_PRINCIPAL_INVALID');
    profiles.set(id,{name:value.name,bindings:value.bindings});
  }
  need(profiles.size<=66,'EOAPI_SOURCE_PRINCIPAL_LIMIT');
  const runtimes=new Map(),providers=new Map();let closed=false,closing=null;
  function providerFor(reference,origin) {
    const key=JSON.stringify([reference,origin]);let provider=providers.get(key);
    if(!provider){provider=createOAuthConnectionProvider(managed[reference],{resourceOrigin:origin,env:environment,lookup});providers.set(key,provider);}
    return provider;
  }
  function runtimeFor(id) {
    need(!closed,'EOAPI_SOURCE_RUNTIME_CLOSED');
    need(profiles.has(id),'EOAPI_SOURCE_PRINCIPAL_NOT_CONFIGURED');
    if(runtimes.has(id))return runtimes.get(id);
    const profile=profiles.get(id);
    const auth=profile.bindings.length?createSourceBearerAuth({bindings:profile.bindings,environment,
      resolveCredential:async(reference,context)=>{
        if(Object.hasOwn(managed,reference)) {
          const headers=await providerFor(reference,context.origin).headers({signal:context.signal});
          return headers.authorization.slice(7);
        }
        need(resolveCredential,'EOAPI_SOURCE_CREDENTIAL_OWNER_REQUIRED');
        return resolveCredential(reference,context);
      }}):null;
    const sourceAuth=auth?Object.freeze({
      origins:auth.origins,
      requestHeaders:request=>auth.requestHeaders(request),
      authorizationForOrigin:origin=>auth.authorizationForOrigin(origin),
      observeResponse({url,status,authorization}) {
        if(status!==401||typeof authorization!=='string')return;
        const origin=new URL(url).origin,binding=profile.bindings.find(item=>item.origin===origin);
        if(binding?.credentialRef&&Object.hasOwn(managed,binding.credentialRef))
          providers.get(JSON.stringify([binding.credentialRef,origin]))?.invalidate(authorization);
      },
      close:()=>auth.close()
    }):undefined;
    const value=Object.freeze({transport,sourceAuth});runtimes.set(id,value);return value;
  }
  // Construct the actual per-origin helper now so malformed configuration cannot
  // hide until the first source dispatch. Token resolution remains lazy.
  runtimeFor('operator');
  return Object.freeze({
    ...runtimeFor('operator'),
    sourceRuntimeFor({principal='operator',endpoint,signal}={}) {
      need(!signal?.aborted,'EOAPI_SOURCE_REQUEST_CANCELLED');
      const runtime=runtimeFor(principal==='anonymous'?'public':principal);
      if(endpoint!==undefined){const url=new URL(endpoint);need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'EOAPI_SOURCE_ENDPOINT_INVALID');}
      return runtime;
    },
    snapshot() {
      return {principals:[...profiles].map(([id,profile])=>({id,name:profile.name,
        origins:profile.bindings.map(item=>item.origin),authenticated:profile.bindings.length>0})),
        connections:[...providers].map(([key,provider])=>({origin:JSON.parse(key)[1],
          state:provider.snapshot().state,expiresInMs:provider.snapshot().expiresInMs})),closed};
    },
    close() {
      if(closing)return closing;
      closed=true;
      for(const runtime of runtimes.values())runtime.sourceAuth?.close();
      closing=(async()=>{
        const results=await Promise.allSettled([...providers.values()].map(provider=>provider.close()));
        providers.clear();runtimes.clear();
        const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
      })();return closing;
    }
  });
}

export async function openEoapiRuntime({directory,policyDirectory,onboardingDirectory,outputDirectory,
  title='Customer satellite imagery',endpoint,transport,sourceConfiguration,environment=process.env,
  lookup=systemLookup,resolveCredential,create=true}={}) {
  need(typeof directory==='string'&&directory.length,'EOAPI_WORKSPACE_DIRECTORY_REQUIRED');
  directory=resolve(directory);
  const source=createEoapiSourceRuntime({configuration:sourceConfiguration??{},transport,environment,lookup,resolveCredential});
  let workspace,policies,onboarding,commissioning,closing=null;
  try {
    workspace=await openStacWorkspace({directory,title,endpoint,transport,sourceAuth:source.sourceAuth,create});
    policies=await openDeploymentPolicyWorkspace({directory:policyDirectory??join(directory,'eoapi','policy'),create,title});
    onboarding=await openEoapiOnboarding({workspace,policies,directory:onboardingDirectory,outputDirectory,create});
    commissioning=await openCommissioningWorkspace({directory:join(directory,'eoapi','commissioning'),policyWorkspace:policies,
      sourceRuntimeFor:input=>source.sourceRuntimeFor(input),stacWorkspace:workspace,create,title});
  }catch(error){await commissioning?.close();await source.close();await workspace?.close();await onboarding?.close();await policies?.close();throw error;}
  const packages=await privateDirectory(join(directory,'eoapi','packages'),{create});
  const savePackage=async bundle=>{
    const inspection=inspectCommissioningPackage(bundle),raw=jsonBytes(bundle),digest=sha256(raw),id='commissioning-'+digest;
    await stacRetain(join(packages,id+'.json'),raw);
    return {fileId:id,packageDigest:bundle.digest,sha256:digest,bytes:raw.length,inspection};
  };
  const readPackage=async fileId=>{
    need(typeof fileId==='string'&&/^commissioning-[a-f0-9]{64}$/.test(fileId),'EOAPI_COMMISSIONING_SAVED_FILE_INVALID');
    const bundle=await readJson(join(packages,fileId+'.json'),384*1024*1024);
    need('commissioning-'+sha256(jsonBytes(bundle))===fileId,'EOAPI_COMMISSIONING_SAVED_FILE_CHANGED');
    inspectCommissioningPackage(bundle);return bundle;
  };
  const commissioningController=createCommissioningController({workspace:commissioning,readPackage,savePackage});
  return Object.freeze({workspace,policies,onboarding,source,commissioning,commissioningController,savePackage,readPackage,
    sourceRuntimeFor:input=>source.sourceRuntimeFor(input),
    async getState(){return {workspace:await workspace.getState(),policies:await policies.getState(),
      onboarding:await onboarding.getState(),commissioning:await commissioning.getState(),source:source.snapshot()};},
    close() {
      if(!closing)closing=(async()=>{
        await commissioning.close();
        const results=await Promise.allSettled([workspace.close(),source.close()]);
        await onboarding.close();await policies.close();
        const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
      })();return closing;
    }
  });
}
