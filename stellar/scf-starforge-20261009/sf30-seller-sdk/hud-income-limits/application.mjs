// MIT. One retained HUD desk, original publisher, original versioned seller.
import { mkdir,readdir,lstat,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory,acquireWorkspace,readJson,readPrivate,createFile,atomicJson,bytes,identity,fault,stamp,absolute } from '../postgres/publisher/files.mjs';
import { openDatasetVersions,DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { startVersionedDatasetSeller,datasetControl } from '../dataset-refresh/service.mjs';
import { HASH,SCHEMA,selection,releaseMetadata } from './contract.mjs';
import { retainHudRelease,readHudRelease,inspectLocalities,compareHudReleases,publicSelection,hudSourcePacket } from './release.mjs';
import { openHudPublisher,defaultHudPlan } from './driver.mjs';
import { hudPublicationHandoff,prepareHudCustomer } from './delivery.mjs';

const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const releaseSummary=m=>({releaseId:m.releaseId,fiscalYear:m.fiscalYear,effectiveDate:m.effectiveDate,createdAt:m.createdAt,
  review:m.review,localities:m.projection.localityRows,counties:m.projection.countyCount,hudAreas:m.projection.hudAreaCount,
  workbookSha256:m.files.workbook.sha256,sourceDocuments:m.files,parserSha256:m.projection.parserSha256});
export async function openHudApplication({directory,create=false,python='python3',nativeFactory=null,environment=process.env}={}){
  absolute(directory);if(create&&await exists(join(directory,'workspace.json')))throw fault('HUD_WORKSPACE_EXISTS');
  await privateDirectory(directory,create);const releaseLock=await acquireWorkspace(directory);
  let publisher=null,seller=null,pilot=null,pilotMerchant=null,state,busy=null,closing=null,closed=false,reopenRequired=false;
  const releaseRoot=join(directory,'releases'),sourceFile=join(directory,'source.json'),publisherRoot=join(directory,'publisher'),target=join(directory,'dataset-versions');
  const cache=new Map();
  const retained=async id=>{
    if(!HASH.test(id??'')||!state.releases.includes(id))throw fault('HUD_RELEASE_NOT_FOUND');
    if(!cache.has(id))cache.set(id,await readHudRelease(join(releaseRoot,id,'release.json'),{expected:id}));
    return cache.get(id);
  };
  async function writeSelectedSource(){
    if(!state.selectedRelease)return;
    const config={schema:SCHEMA,release:join(releaseRoot,state.selectedRelease,'release.json'),
      releaseId:state.selectedRelease,selection:state.selection};
    await atomicJson(directory,'source.json',config);
  }
  async function commit(patch,{source=false}={}){
    const next={...state,...patch,revision:state.revision+1,updatedAt:stamp()};
    try{await atomicJson(directory,'workspace.json',next);state=next;if(source)await writeSelectedSource();}
    catch(e){reopenRequired=true;throw e;}
  }
  function ready(){
    if(closed)throw fault('HUD_APPLICATION_CLOSED');
    if(reopenRequired)throw fault('HUD_REOPEN_REQUIRED','Reopen this same workspace to finish the retained save.',409);
  }
  function revision(expected){if(expected!==state.revision)throw fault('HUD_REVIEW_CHANGED','Refresh this workspace before changing its displayed selection.',409);}
  async function mutate(kind,action){
    ready();if(busy)throw fault('HUD_APPLICATION_BUSY','The '+busy.kind+' operation is still running.',409);
    const operation={kind,startedAt:stamp(),progress:null,controller:new AbortController()};busy=operation;
    operation.promise=Promise.resolve().then(()=>action(operation));
    try{return await operation.promise;}finally{if(busy===operation)busy=null;}
  }
  async function getPublisher(){
    ready();if(!state.selectedRelease)throw fault('HUD_RELEASE_REQUIRED','Retain and select a complete published release first.');
    if(!publisher){
      publisher=await openHudPublisher({directory:publisherRoot,create:!await exists(join(publisherRoot,'workspace.json')),
        sourceFile,targetDirectory:target,environment,
        ...(seller||pilotMerchant?{seller:(seller??pilotMerchant).url,resource:state.merchant.resource}:{})});
    }
    return publisher;
  }
  function publisherIdle(){
    if(publisher?.status().active)throw fault('PUBLISHER_BUSY','Finish the original publisher operation before changing the workspace source.',409);
  }
  async function startSavedMerchant(port){
    publisherIdle();if(!state.merchant)throw fault('HUD_MERCHANT_CONFIG_REQUIRED');
    if(seller)return merchantStatus();if(pilotMerchant)throw fault('HUD_RELEASE_SELLER_ALREADY_RUNNING');
    const config=await readJson(join(directory,'seller.json'),65536),versions=await openDatasetVersions({directory:target});
    try{
      seller=await startVersionedDatasetSeller({versions,config,port:port??state.merchant.port,nativeFactory,controlTransport:'loopback'});
      await publisher?.close();publisher=null;await getPublisher();
      return merchantStatus();
    }catch(e){await seller?.close();seller=null;await versions.close().catch(()=>{});throw e;}
  }
  function merchantStatus(){
    return {configured:Boolean(state.merchant),running:Boolean(seller||pilotMerchant),resource:state.merchant?.resource??null,
      url:(seller??pilotMerchant)?.url??null,mode:(seller??pilotMerchant)?.mode??null,publicTerms:state.merchant?.publicTerms??null,port:state.merchant?.port??null};
  }
  try{
    if(create){
      await privateDirectory(releaseRoot,true);
      state={schema:'stellar-forge.hud-application-workspace.v1',revision:0,createdAt:stamp(),updatedAt:stamp(),
        releases:[],selectedRelease:null,selection:selection(),merchant:null};
      await createFile(join(directory,'workspace.json'),bytes(state));
    }else state=await readJson(join(directory,'workspace.json'),1048576);
    if(state.schema!=='stellar-forge.hud-application-workspace.v1'||!Array.isArray(state.releases)||state.releases.length>512||
      state.releases.some(id=>!HASH.test(id))||!Number.isSafeInteger(state.revision))throw fault('HUD_WORKSPACE_INVALID');
    state.selection=selection(state.selection);
    await privateDirectory(releaseRoot);
    // Complete source rename can precede the final desk save after process exit.
    // Adopt only original hash-verified releases; selection/publication stay explicit.
    const recovered=[];
    for(const id of await readdir(releaseRoot))if(HASH.test(id)&&!state.releases.includes(id)){
      await readHudRelease(join(releaseRoot,id,'release.json'),{expected:id,includeRows:false});recovered.push(id);
    }
    if(recovered.length)await commit({releases:[...state.releases,...recovered]});
    if(state.selectedRelease){await retained(state.selectedRelease);await writeSelectedSource();await getPublisher();}
    return {
      directory,sourceFile,targetDirectory:target,
      publisher:getPublisher,
      async status(options={}){
        ready();
        const releases=[];
        for(const id of state.releases){
          const m=cache.get(id)?.manifest??(await readHudRelease(join(releaseRoot,id,'release.json'),{expected:id,includeRows:false})).manifest;
          releases.push(releaseSummary(m));
        }
        const unfinished=(await readdir(releaseRoot)).filter(name=>/^\.import-[a-f0-9-]{36}$/.test(name));
        return {schema:state.schema,revision:state.revision,selectedRelease:state.selectedRelease,selection:state.selection,
          releases,busy:busy?{kind:busy.kind,startedAt:busy.startedAt,progress:busy.progress}:null,unfinishedImports:unfinished,
          publisher:publisher?.status(options)??null,target:publisher?await publisher.target():null,merchant:merchantStatus()};
      },
      async importRelease(metadata,options={}){
        return mutate('release intake',async operation=>{
          releaseMetadata(metadata);if(state.releases.length>=512)throw fault('HUD_RELEASE_CAPACITY');
          const result=await retainHudRelease(releaseRoot,metadata,{...options,python,signal:operation.controller.signal,
            onProgress:progress=>{operation.progress=progress;}});
          const ids=state.releases.includes(result.manifest.releaseId)?state.releases:[...state.releases,result.manifest.releaseId];
          const selectFirst=state.selectedRelease===null;
          await commit({releases:ids,...(selectFirst?{selectedRelease:result.manifest.releaseId}:{})},{source:selectFirst});
          if(selectFirst)await getPublisher();
          return {release:releaseSummary(result.manifest),reused:result.reused,revision:state.revision};
        });
      },
      async select(input){
        return mutate('source selection',async()=>{
          publisherIdle();revision(input.expectedRevision);await retained(input.releaseId);
          const chosen=selection(input.selection??state.selection);
          await commit({selectedRelease:input.releaseId,selection:chosen},{source:true});
          return {revision:state.revision,selectedRelease:state.selectedRelease,selection:state.selection};
        });
      },
      async localities(input={}){
        ready();return inspectLocalities(await retained(input.releaseId??state.selectedRelease),
          {...input,selection:input.selection??state.selection});
      },
      async comparison(input){
        ready();return compareHudReleases(await retained(input.before),await retained(input.after),input.selection??state.selection);
      },
      async exportSelection(input={}){
        ready();return publicSelection(await retained(input.releaseId??state.selectedRelease),input.selection??state.selection);
      },
      async sourcePacket(id=state.selectedRelease){ready();return hudSourcePacket(await retained(id));},
      async publicationHandoff(id){ready();return hudPublicationHandoff(await getPublisher(),id);},
      async releaseFile(id,role){
        ready();const value=await retained(id),item=value.manifest.files[role];
        if(!item)throw fault('HUD_SOURCE_ROLE_INVALID');
        // Recheck original bytes at download time rather than serving stale cache.
        const raw=await readPrivate(join(value.directory,item.name),item.bytes);
        const {digest}=await import('../postgres/publisher/files.mjs');
        if(digest(raw)!==item.sha256)throw fault('HUD_RELEASE_SOURCE_CHANGED');
        return {bytes:raw,type:item.type,name:item.name};
      },
      async savePlan(input={}){
        return mutate('saving publication plan',async()=>{
          publisherIdle();revision(input.expectedRevision);
          const plan=input.plan??await defaultHudPlan(sourceFile,{title:input.title,selection:state.selection,name:input.name});
          return (await getPublisher()).savePlan(plan);
        });
      },
      async extract(planId){ready();if(busy)throw fault('HUD_APPLICATION_BUSY');const p=await getPublisher();const run=p.startExtraction(planId);return {id:run.id,completion:run.completion};},
      async operate(action,input={}){
        return mutate('publisher '+action,async()=>{
          const p=await getPublisher();
          if(action==='review')return p.review(input.id,input);
          if(action==='publish')return p.publish(input.id,input.reviewId);
          if(action==='recover')return p.recover(input.id);
          if(action==='prepareBuyer')return prepareHudCustomer(p,input.id,input);
          throw fault('HUD_PUBLISHER_ACTION_INVALID');
        });
      },
      async configureMerchant(input){
        return mutate('merchant configuration',async()=>{
          publisherIdle();revision(input.expectedRevision);if(seller||pilotMerchant)throw fault('HUD_STOP_MERCHANT_FIRST');
          if(!Number.isInteger(input.port??8428)||(input.port??8428)<0||(input.port??8428)>65535)throw fault('HUD_MERCHANT_PORT_INVALID');
          const p=await getPublisher(),candidate=await p.candidate(input.runId);
          const config=await buildDatasetSellerConfig(candidate.dataset,{payment:input.payment,origin:input.origin,path:input.path??'/hud/income-limits'});
          const parameters=config.routes[0].definition.queryParameters;
          if(parameters.length>=32)throw fault('HUD_SNAPSHOT_PARAMETER_CAPACITY');
          parameters.push({...DATASET_SNAPSHOT_PARAMETER});
          await atomicJson(directory,'seller.json',config);
          const resource=config.publicOrigin+config.routes[0].path;
          await commit({merchant:{resource,publicTerms:structuredClone(input.payment),port:input.port??8428,configuredAt:stamp()}});
          return {config,resource,revision:state.revision};
        });
      },
      async startMerchant(input={}){return mutate('starting original seller',()=>startSavedMerchant(input.port));},
      async stopMerchant(){return mutate('stopping original seller',async()=>{
        publisherIdle();await publisher?.close();publisher=null;
        await seller?.close();seller=null;await pilot?.stop();pilotMerchant=null;await getPublisher();return merchantStatus();
      });},
      async releaseLifecycle(action,input={}){
        return mutate('seller release '+action,async()=>{
          publisherIdle();if(!state.merchant)throw fault('HUD_MERCHANT_CONFIG_REQUIRED');
          if(!pilot){
            const {openHudReleaseLifecycle}=await import('./sf82.mjs');
            pilot=await openHudReleaseLifecycle({directory,publisher:getPublisher,
              sellerConfig:()=>readJson(join(directory,'seller.json'),65536)});
          }
          if(action==='status')return pilot.status();
          if(action==='stage')return pilot.stage(input.runId,input);
          if(action==='activate')return pilot.activate(input.id,{expectedGeneration:input.expectedGeneration});
          if(action==='rollback')return pilot.rollback({to:input.to,expectedGeneration:input.expectedGeneration});
          if(action==='start'){
            if(seller||pilotMerchant)throw fault('HUD_SELLER_ALREADY_RUNNING');
            const started=await pilot.start(input);pilotMerchant=started;
            await publisher?.close();publisher=null;await getPublisher();return started;
          }
          if(action==='stop'){
            const result=await pilot.stop();pilotMerchant=null;
            await publisher?.close();publisher=null;await getPublisher();return result;
          }
          throw fault('HUD_RELEASE_ACTION_INVALID');
        });
      },
      async activate(input){return mutate('activating retained dataset version',async()=>{
        publisherIdle();return datasetControl(target,'activate',input);
      });},
      async discardIncomplete(name){
        return mutate('discarding incomplete source intake',async()=>{
          if(!/^\.import-[a-f0-9-]{36}$/.test(name))throw fault('HUD_IMPORT_ID_INVALID');
          await rm(join(releaseRoot,name),{recursive:true,force:true});return {removed:name};
        });
      },
      cancelImport(){if(busy?.kind!=='release intake')throw fault('HUD_IMPORT_NOT_ACTIVE');busy.controller.abort();return {cancelled:true};},
      async close(){
        if(closing)return closing;closed=true;busy?.controller.abort();
        closing=(async()=>{try{await busy?.promise.catch(()=>{});await publisher?.close();await seller?.close();await pilot?.close();}
          finally{await releaseLock();}})();return closing;
      }
    };
  }catch(error){await publisher?.close();await seller?.close();await pilot?.close();await releaseLock();throw error;}
}
