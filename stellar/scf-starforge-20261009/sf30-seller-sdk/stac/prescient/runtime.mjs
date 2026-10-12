// MIT. One reviewed Prescient operator around the original STAC workspace and customer delivery.
import {randomUUID} from 'node:crypto';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {realpath} from 'node:fs/promises';
import {privateDirectory,readJson,need} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {normalizeSourceAuthorization} from '../../../sf31-buyer-client/public-transport.mjs';
import {withPrivateLock} from '../../routescan/quota.mjs';
import {openStacWorkspace} from '../workspace.mjs';
import {normalizeEndpoint,canonicalJson} from '../provider.mjs';
import {StacDelivery} from '../customer.mjs';
import {stacRetain} from '../merchant.mjs';
import {exportPortableStacDelivery,openPortableStacDelivery} from '../receiving/delivery.mjs';
import {createPrescientSdkRuntime} from './sdk-runtime.mjs';
import {createPrescientSourceAuth,inspectPrescientRuntime,publicPrescientError} from './source-auth.mjs';
import {createPrescientAssetAccess} from './asset-access.mjs';
import {openPrescientConfiguration,normalizePrescientDeployment,normalizePrescientProfile,
  configurationDigest,portablePrescientProfile,receivePrescientProfile,prescientCatalogEndpoint,PRESCIENT_SDK} from './configuration.mjs';

const time=()=>new Date().toISOString(),clone=value=>structuredClone(value);
const safeId=value=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value),'PRESCIENT_OPERATION_ID_REQUIRED');return value;};
const actor=value=>{need(typeof value==='string'&&value.trim()&&value.length<=240&&!/[\u0000-\u001f\u007f]/u.test(value),'PRESCIENT_REVIEWER_REQUIRED');return value.trim();};
const fail=code=>Object.assign(new Error(code),{code});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function expectBody(value,fields){
  need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'PRESCIENT_COMMAND_FIELDS_INVALID');return value;
}
function inside(root,path){const name=relative(root,path);return name!==''&&!name.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&name!=='..'&&!isAbsolute(name);}
async function existingSelectedPath(value,roots){
  need(typeof value==='string'&&isAbsolute(value),'PRESCIENT_DELIVERY_DIRECTORY_ABSOLUTE');
  const path=await realpath(value);
  const selected=await Promise.all(roots.map(root=>realpath(root)));
  need(selected.some(root=>path===root||inside(root,path)),'PRESCIENT_DELIVERY_ROOT_NOT_APPROVED');return path;
}
function sourceBinding(delivery){
  return {catalogEndpoint:normalizeEndpoint(delivery.edition.query.endpoint),
    querySha256:configurationDigest(delivery.edition.query),
    bundleSha256:delivery.manifest.bundleSha256,editionId:delivery.manifest.editionId,
    editionDigest:delivery.manifest.editionDigest,selectionSha256:delivery.manifest.selectionSha256,
    nativeBindingSha256:delivery.manifest.nativeBindingSha256,
    membersSha256:configurationDigest(delivery.members())};
}
async function checkDelivery(delivery,profile){
  let scenes=0;const collections=new Set();
  for await(const feature of delivery.features()){
    need(profile.collections.includes(feature.collection),'PRESCIENT_RECEIVING_COLLECTION_NOT_APPROVED');
    collections.add(feature.collection);scenes++;
  }
  const assets=delivery.members().filter(member=>member.asset);
  need(!assets.length||profile.rights.allowPortableAssets,'PRESCIENT_PORTABLE_ASSETS_NOT_APPROVED');
  need(assets.every(member=>member.bytes<=profile.maxAssetBytes),'PRESCIENT_RECEIVING_ASSET_BYTE_LIMIT_CHANGED');
  return {scenes,collections:[...collections].sort(),assets:assets.length,
    assetBytes:assets.reduce((total,member)=>total+member.bytes,0)};
}

/** Initialize only a nonsecret profile. Approval and native connection remain explicit operator actions. */
export async function initializePrescientOperator({directory,profile,actor:reviewer,operationId='initial-profile'}={}){
  directory=await privateDirectory(directory);
  const configuration=await openPrescientConfiguration({directory:join(directory,'operator')});
  const normalized=normalizePrescientProfile(profile);
  const source=await openStacWorkspace({directory:join(directory,'stac'),title:normalized.name,endpoint:prescientCatalogEndpoint(normalized.endpoint),create:true});
  await source.close();
  const saved=await configuration.saveProfile({profile:normalized,actor:reviewer},{operationId});
  return {directory,profile:saved,configuration:await configuration.getState()};
}

/**
 * A descriptor-held original lock owns this host lifetime. Closing aborts/drains
 * its admitted original provider/SDK work before releasing the installation.
 */
export async function openPrescientOperator({directory,deployment,profileSha256,create=false,env=process.env,
  sdkFactory=createPrescientSdkRuntime}={}){
  directory=await privateDirectory(directory,{create});deployment=normalizePrescientDeployment(deployment);
  const locks=await privateDirectory(join(directory,'host-locks'));
  let releaseLease,resolveReady,rejectReady,lease;
  const released=new Promise(resolveDone=>{releaseLease=resolveDone;});
  const ready=new Promise((yes,no)=>{resolveReady=yes;rejectReady=no;});
  lease=withPrivateLock(locks,'prescient-host.lock',async()=>{
    try{
      const opened=await openOwned({directory,deployment,profileSha256,create,env,sdkFactory,
        release:async()=>{releaseLease();}});
      resolveReady(opened);await released;
    }catch(error){rejectReady(error);throw error;}
  });
  lease.catch(error=>rejectReady(error));
  const opened=await ready;
  return Object.freeze({...opened,close:async()=>{await opened.close();await lease;}});
}

async function openOwned({directory,deployment,profileSha256,create,env,sdkFactory,release}){
  const configuration=await openPrescientConfiguration({directory:join(directory,'operator'),create});
  const initial=await configuration.getState();
  const selected=initial.profiles.find(row=>row.sha256===(profileSha256??initial.approvedProfileSha256))??initial.profiles.at(-1);
  need(selected,'PRESCIENT_INITIAL_PROFILE_REQUIRED');
  const profile=normalizePrescientProfile(selected.profile),selectedSha256=configurationDigest(profile);
  need(!profileSha256||selectedSha256===profileSha256,'PRESCIENT_SELECTED_PROFILE_NOT_FOUND');
  need(selected.sha256===selectedSha256,'PRESCIENT_PROFILE_CHANGED');
  need(Object.hasOwn(deployment.bindings,profile.bindingId),'PRESCIENT_LOCAL_BINDING_REQUIRED');
  const binding=deployment.bindings[profile.bindingId];
  const stacDirectory=join(directory,'stac');
  const receivingRoot=await privateDirectory(join(directory,'private-receiving'));
  const operationLocks=await privateDirectory(join(directory,'operation-locks'));
  const exportRoot=await privateDirectory(deployment.exportRoot??join(directory,'portable'));
  const deliveryRoots=deployment.deliveryRoots??[exportRoot];
  let native=null,nativeStarting=null,facade=null,closed=false,closing=null,original=null,lastSession=null;
  const pending=new Set(),lifetime=new AbortController(),progress=new Map();
  const combined=signal=>signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
  function owned(run){
    return (...args)=>{
      if(closed)return Promise.reject(fail('PRESCIENT_OPERATOR_CLOSED'));
      const result=Promise.resolve().then(()=>run(...args));pending.add(result);
      result.then(()=>pending.delete(result),()=>pending.delete(result));return result;
    };
  }
  async function requireApproved(){
    const current=await configuration.approved();
    need(current.sha256===selectedSha256,'PRESCIENT_APPROVED_PROFILE_RESTART_REQUIRED');return current;
  }
  async function ensureNative({signal}={}){
    const next=combined(signal);next.throwIfAborted();await requireApproved();
    if(!nativeStarting)nativeStarting=(async()=>{
      let acquired;
      try{
        acquired=await sdkFactory({pythonCommand:binding.pythonCommand??deployment.pythonCommand??['python3'],
          config:{envFile:binding.envFile,expectedEndpoint:profile.endpoint,authMode:profile.authMode,
            ...(profile.authMode==='oauth'?{expectedIdentityProvider:profile.identityProvider}:{}),
            allowedOrigins:profile.allowedOrigins,allowedS3:profile.allowedS3,
            receivingRoot,captureRoot:join(stacDirectory,'captures'),refreshSkewSeconds:profile.refreshSkewSeconds},
          env,signal:next,timeoutMs:deployment.timeoutMs});
        inspectPrescientRuntime(acquired,profile);
        if(closed){await acquired.close();throw fail('PRESCIENT_OPERATOR_CLOSED');}
        native=acquired;facade=createPrescientSourceAuth({runtime:native,profile});return native;
      }catch(error){await acquired?.close().catch(()=>{});nativeStarting=null;throw error;}
    })();
    const result=await nativeStarting;next.throwIfAborted();return result;
  }
  const capabilities=new Map(profile.allowedOrigins.map(origin=>[origin,normalizeSourceAuthorization({
    origin,scheme:profile.authMode==='api-key'?'ApiKey':'Bearer'
  })]));
  const sourceAuth={
    authorizationForOrigin(origin){return capabilities.get(origin)??null;},
    requestHeaders:owned(async options=>{await ensureNative(options);return facade.requestHeaders({...options,signal:combined(options.signal)});}),
    observeResponse:owned(async options=>{need(facade,'PRESCIENT_SOURCE_SESSION_REQUIRED');return facade.observeResponse({...options,signal:combined(options.signal)});})
  };
  const assetAccess=createPrescientAssetAccess({profile,getRuntime:ensureNative,
    onProgress:value=>{if(typeof value?.receivingId==='string')progress.set(value.receivingId,clone(value));}});
  async function collectionScope(query){
    await requireApproved();need(Array.isArray(query?.collections)&&query.collections.length&&
      query.collections.every(id=>profile.collections.includes(id)),'PRESCIENT_COLLECTION_NOT_APPROVED');
  }
  try{
    original=await openStacWorkspace({directory:stacDirectory,title:profile.name,
      endpoint:prescientCatalogEndpoint(profile.endpoint),transport:deployment.transport,sourceAuth,assetAccess,create});
    const state=await original.getState();
    need(normalizeEndpoint(prescientCatalogEndpoint(profile.endpoint))===state.endpoint,'PRESCIENT_WORKSPACE_ENDPOINT_CHANGED');
  }catch(error){await facade?.close().catch(()=>{});await native?.close().catch(()=>{});throw error;}
  const workspace=Object.freeze({...original,
    discover:owned(async value=>{await requireApproved();return original.discover(value);}),
    saveQuery:owned(async value=>{await collectionScope(value);return original.saveQuery(value);}),
    reviewSearch:owned(async value=>{const current=await original.getState();await collectionScope(current.queries.find(q=>q.id===value.queryId));return original.reviewSearch(value);}),
    acquire:owned(async value=>{const current=await original.getState();await collectionScope(current.reviews.find(q=>q.id===value.reviewId)?.query);return original.acquire(value);}),
    resume:owned(async value=>{const current=await original.getEdition(value.editionId);await collectionScope(current.edition.query);return original.resume(value);}),
    reviewAsset:owned(async value=>{await requireApproved();need((value.maxBytes??16*1024**2)<=profile.maxAssetBytes,'PRESCIENT_ASSET_BYTE_LIMIT_CHANGED');return original.reviewAsset(value);}),
    acquireAsset:owned(async value=>{await requireApproved();const current=await original.getState(),review=current.assetReviews.find(row=>row.id===value.reviewId);
      need(review&&profile.collections.includes(review.collection)&&review.maxBytes<=profile.maxAssetBytes,'PRESCIENT_ASSET_REVIEW_SCOPE_CHANGED');return original.acquireAsset(value);}),
    exportHandover:owned(async(value={})=>{await requireApproved();need(value.includeAssets===false||profile.rights.allowPortableAssets,'PRESCIENT_PORTABLE_ASSETS_NOT_APPROVED');return original.exportHandover(value);}),
    exportEdition:owned(async value=>{await requireApproved();need(profile.rights.allowPortableAssets,'PRESCIENT_PORTABLE_ASSETS_NOT_APPROVED');return original.exportEdition(value);}),
    importHandover:owned(async value=>{need(value?.endpoint===normalizeEndpoint(prescientCatalogEndpoint(profile.endpoint)),'PRESCIENT_HANDOVER_ENDPOINT_CHANGED');
      need(Array.isArray(value.editions)&&value.editions.every(edition=>edition.query?.collections?.every(id=>profile.collections.includes(id))),'PRESCIENT_HANDOVER_COLLECTION_CHANGED');
      return original.importHandover(value);})
  });
  async function recordOperation(kind,input,options,run){
    const operationId=safeId(options.operationId),fingerprint=configurationDigest(input);
    return withPrivateLock(operationLocks,configurationDigest(operationId)+'.lock',async()=>{
      const current=await configuration.getState(),prior=Object.hasOwn(current.operations,operationId)?current.operations[operationId]:null;
      if(prior){need(prior.kind===kind&&prior.inputSha256===fingerprint,'PRESCIENT_OPERATION_INPUT_CHANGED');
        if(prior.status==='COMPLETE')return clone(prior.result);}
      const startedAt=prior?.startedAt??time();
      await configuration.mutate(state=>{
        if(!prior&&options.expectedRevision!==undefined)need(state.revision===options.expectedRevision,'PRESCIENT_CONFIGURATION_REVISION_CHANGED');
        state.operations[operationId]={kind,inputSha256:fingerprint,input:clone(input),status:'RUNNING',
          startedAt,attempts:(prior?.attempts??0)+1};
      });
      try{
        const result=await run(operationId,startedAt);
        await configuration.mutate(state=>{
          const row=state.operations[operationId];
          need(row.kind===kind&&row.inputSha256===fingerprint,'PRESCIENT_OPERATION_INPUT_CHANGED');
          if(kind==='DELIVERY_REVIEW'){
            const reviews=state.deliveryReviews??=[];
            const existing=reviews.find(value=>value.id===result.id);
            need(!existing||configurationDigest(existing)===configurationDigest(result),'PRESCIENT_DELIVERY_REVIEW_CHANGED');
            if(!existing)reviews.push(clone(result));
          }
          if(['PORTABLE_EXPORT','PORTABLE_OPEN'].includes(kind)&&!state.deliveries.some(value=>value.id===result.id))
            state.deliveries.push(clone(result));
          Object.assign(row,{status:'COMPLETE',result:clone(result),completedAt:time()});
        });
        return result;
      }catch(error){
        const safe=/^(?:STAC|PRESCIENT|ROUTESCAN)_[A-Z0-9_]{1,120}$/u.test(error?.code??'')?
          {code:error.code}:publicPrescientError(error);
        await configuration.mutate(state=>{
          const row=state.operations[operationId];
          if(row?.inputSha256===fingerprint)Object.assign(row,{status:'INTERRUPTED',error:safe,updatedAt:time()});
        }).catch(()=>{});
        throw Object.assign(fail(safe.code),safe.details?{details:safe.details}:{});
      }
    });
  }
  async function state(){
    const current=await configuration.getState(),same=current.approvedProfileSha256===selectedSha256;
    return {schema:'starforge.prescient-operator-view/v1',configuration:current,
      selectedProfileSha256:selectedSha256,selectedProfile:profile,
      bindingChoices:Object.entries(deployment.bindings).map(([id,value])=>({id,label:value.label})),
      connection:{active:native!==null,approved:same,restartRequired:current.approvedProfileSha256!==null&&!same,
        metadata:native?inspectPrescientRuntime(native,profile):null,session:lastSession},
      receivingProgress:[...progress.values()],sdk:PRESCIENT_SDK,workspaceId:(await original.getState()).id};
  }
  async function reviewDelivery(body){
    expectBody(body,['directory','actor','operationId','expectedRevision']);const reviewer=actor(body.actor);
    await requireApproved();const source=await existingSelectedPath(body.directory,deliveryRoots);
    return recordOperation('DELIVERY_REVIEW',{directory:source,profileSha256:selectedSha256,actor:reviewer},body,async(operationId,startedAt)=>{
      const delivery=await StacDelivery.open(source,{signal:lifetime.signal}),summary=await checkDelivery(delivery,profile);
      const core={sourceDirectory:source,source:sourceBinding(delivery),profile:portablePrescientProfile(profile),
        profileSha256:selectedSha256,summary,actor:reviewer,createdAt:startedAt};
      const review={id:'delivery-review-'+configurationDigest(operationId).slice(0,32),...core,sha256:configurationDigest(core)};
      return review;
    });
  }
  async function exportDelivery(body){
    expectBody(body,['reviewId','reviewSha256','actor','operationId','expectedRevision']);const reviewer=actor(body.actor);
    await requireApproved();const current=await configuration.getState(),review=(current.deliveryReviews??[]).find(row=>row.id===body.reviewId);
    need(review&&review.sha256===body.reviewSha256&&review.profileSha256===selectedSha256,'PRESCIENT_EXACT_DELIVERY_REVIEW_REQUIRED');
    return recordOperation('PORTABLE_EXPORT',{reviewId:review.id,reviewSha256:review.sha256,actor:reviewer},body,async operationId=>{
      const source=await existingSelectedPath(review.sourceDirectory,deliveryRoots);
      const delivery=await StacDelivery.open(source,{signal:lifetime.signal});
      need(configurationDigest(sourceBinding(delivery))===configurationDigest(review.source),'PRESCIENT_CUSTOMER_DELIVERY_CHANGED');
      await checkDelivery(delivery,profile);
      const destination=join(exportRoot,operationId);await requireApproved();
      const portable=await exportPortableStacDelivery(delivery,destination,{signal:lifetime.signal,
        progress:value=>progress.set(operationId,{...clone(value),operationId})});
      const profileFile=portablePrescientProfile(profile);
      const core={schema:'starforge.prescient-receiving/v1',profile:profileFile,source:sourceBinding(delivery),
        sourceReviewSha256:review.sha256,profileSha256:selectedSha256,portableManifestSha256:portable.manifestFile.sha256,
        paths:{profile:'prescient-profile.json',portable:'scene-export.json'},summary:review.summary,
        approvedBy:reviewer,operationId};
      const manifest={...core,sha256:configurationDigest(core)};
      await stacRetain(join(destination,'prescient-profile.json'),Buffer.from(canonicalJson(profileFile)+'\n'));
      await stacRetain(join(destination,'prescient-receiving.json'),Buffer.from(canonicalJson(manifest)+'\n'));
      const result={id:operationId,kind:'PORTABLE_EXPORT',directory:destination,manifestSha256:manifest.sha256,
        profileSha256:selectedSha256,portableManifestSha256:portable.manifestFile.sha256,source:core.source,summary:core.summary};
      return result;
    });
  }
  async function openReceived(body){
    expectBody(body,['directory','manifestSha256','actor','operationId','expectedRevision']);const reviewer=actor(body.actor);
    await requireApproved();
    const source=await existingSelectedPath(body.directory,deliveryRoots);
    return recordOperation('PORTABLE_OPEN',{directory:source,manifestSha256:body.manifestSha256,actor:reviewer},body,async operationId=>{
      const manifest=await readJson(join(source,'prescient-receiving.json'),1024*1024),{sha256,...core}=manifest;
      need(manifest.schema==='starforge.prescient-receiving/v1'&&sha256===body.manifestSha256&&
        sha256===configurationDigest(core),'PRESCIENT_RECEIVING_MANIFEST_CHANGED');
      const received=receivePrescientProfile(manifest.profile,profile.bindingId);
      need(configurationDigest(portablePrescientProfile(received))===configurationDigest(portablePrescientProfile(profile)),
        'PRESCIENT_RECEIVER_PROFILE_REVIEW_REQUIRED');
      const profileFile=await readJson(join(source,'prescient-profile.json'),1024*1024);
      need(configurationDigest(profileFile)===configurationDigest(manifest.profile),'PRESCIENT_RECEIVING_PROFILE_CHANGED');
      const portable=await openPortableStacDelivery(source,{signal:lifetime.signal,
        expectedManifestSha256:manifest.portableManifestSha256,
        progress:value=>progress.set(operationId,{...clone(value),operationId})});
      need(configurationDigest(sourceBinding(portable.delivery))===configurationDigest(manifest.source),
        'PRESCIENT_RECEIVING_ORIGINAL_SOURCE_CHANGED');
      const summary=await checkDelivery(portable.delivery,profile);
      const result={id:operationId,kind:'PORTABLE_OPEN',directory:source,manifestSha256:sha256,
        portableManifestSha256:manifest.portableManifestSha256,source:manifest.source,summary,
        originalDeliveryVerified:true,providerRequests:0,credentialBindingImported:false};
      return result;
    });
  }
  const dispatch=owned(async({method,path,body={}}={})=>{
    if(method==='GET'&&path==='/state')return state();
    const exportProfile=method==='GET'&&path.match(/^\/profiles\/([a-f0-9]{64})\/export$/u);
    if(exportProfile){const selected=(await configuration.getState()).profiles.find(row=>row.sha256===exportProfile[1]);
      need(selected,'PRESCIENT_PROFILE_NOT_FOUND');return portablePrescientProfile(selected.profile);}
    need(method==='POST','PRESCIENT_ROUTE_NOT_FOUND');
    if(path==='/profiles'){
      expectBody(body,['profile','actor','operationId','expectedRevision']);
      const next=normalizePrescientProfile(body.profile);
      need(normalizeEndpoint(prescientCatalogEndpoint(next.endpoint))===normalizeEndpoint(prescientCatalogEndpoint(profile.endpoint)),
        'PRESCIENT_NEW_ENDPOINT_NEEDS_NEW_WORKSPACE');
      need(Object.hasOwn(deployment.bindings,next.bindingId),'PRESCIENT_LOCAL_BINDING_REQUIRED');
      return configuration.saveProfile({profile:next,actor:body.actor},body);
    }
    if(path==='/profiles/import'){
      expectBody(body,['profile','bindingId','actor','operationId','expectedRevision']);
      const next=receivePrescientProfile(body.profile,body.bindingId);
      need(normalizeEndpoint(prescientCatalogEndpoint(next.endpoint))===normalizeEndpoint(prescientCatalogEndpoint(profile.endpoint)),
        'PRESCIENT_NEW_ENDPOINT_NEEDS_NEW_WORKSPACE');
      need(Object.hasOwn(deployment.bindings,next.bindingId),'PRESCIENT_LOCAL_BINDING_REQUIRED');
      return configuration.saveProfile({profile:next,actor:body.actor},body);
    }
    if(path==='/profiles/review'){
      expectBody(body,['profileSha256','actor','operationId','expectedRevision']);return configuration.reviewProfile(body,body);
    }
    if(path==='/profiles/approve'){
      expectBody(body,['reviewId','reviewSha256','actor','operationId','expectedRevision']);return configuration.approveProfile(body,body);
    }
    if(path==='/connect'||path==='/session'){
      expectBody(body,['refresh','actor','operationId','expectedRevision']);
      const reviewer=actor(body.actor);need(body.refresh===undefined||typeof body.refresh==='boolean','PRESCIENT_REFRESH_FLAG_INVALID');
      return recordOperation(path==='/connect'?'CONNECT':'SESSION_REVIEW',
        {profileSha256:selectedSha256,actor:reviewer,refresh:body.refresh===true},body,async()=>{
          const runtime=await ensureNative({signal:lifetime.signal});
          if(path==='/session')lastSession=await runtime.sessionStatus({refresh:body.refresh===true,signal:lifetime.signal});
          return {profileSha256:selectedSha256,metadata:inspectPrescientRuntime(runtime,profile),session:lastSession};
        });
    }
    if(path==='/deliveries/review')return reviewDelivery(body);
    if(path==='/deliveries/export')return exportDelivery(body);
    if(path==='/deliveries/open')return openReceived(body);
    throw fail('PRESCIENT_ROUTE_NOT_FOUND');
  });
  const controller=Object.freeze({getState:owned(state),dispatch});
  return Object.freeze({directory,configuration,workspace,controller,profile:clone(profile),
    selectedProfileSha256:selectedSha256,close(){
      if(!closing){closed=true;lifetime.abort(fail('PRESCIENT_OPERATOR_CLOSED'));
        closing=(async()=>{
          await Promise.allSettled([original.close(),facade?.close(),native?.close(),nativeStarting]);
          await Promise.allSettled([...pending]);await release();
        })();}
      return closing;
    }});
}
