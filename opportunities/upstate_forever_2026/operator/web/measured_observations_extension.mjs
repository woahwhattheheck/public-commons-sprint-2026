import {mountNativeObservations} from './measured_native_observations.mjs';
import {mountReturnedReviews} from './measured_returned_reviews.mjs';
import {mountMeasuredChemistry} from './measured_chemistry.mjs';
import {mountLargeFilePanel} from './measured_large_files.mjs';
import {mountCollectionPanel} from './measured_collections.mjs';
import {mountMeasurements} from './measured_observations.mjs';
/** Existing extension-host lifecycle, authenticated API and Workspace selection. */
export function createMeasuredObservations(capabilities){
  const {api,getWorkspace,getState}=capabilities,chemistryMemory=new Map(),returnedReviewMemory=new Map(),handbackMemory=new Map(),lateResults=new Map(),collectionMemory=new Map(),sedimentMemory=new Map(),benchmarkMemory=new Map(),observationEditionMemory=new Map(),chiquesMemory=new Map();
  const personIdentity=()=>JSON.stringify(getState?.()?.person??null);
  let person=personIdentity(),displayedPerson=null;
  let instance=null,collections=null,largeFiles=null,chemistry=null,returnedReviews=null,nativeObservations=null,root=null,key=null,generation=0;
  let paintCurrentNotice=()=>{};
  const benchmarkKey=(workspace,owner)=>JSON.stringify([workspace,owner]);
  const unsavedBenchmarks=()=>{const current=root&&displayedPerson!==null?benchmarkKey(key,displayedPerson):null;for(const [identity,state] of benchmarkMemory)if(identity!==current&&(state?.dirty||state?.pending))return true;for(const [identity,state] of sedimentMemory)if(identity!==current&&(state?.dirty||state?.pending||state?.auxPending))return true;for(const [identity,state] of chiquesMemory)if(identity!==current&&(state?.dirty||state?.pending))return true;return !!instance?.hasUnsavedBenchmarks?.()||!!instance?.hasUnsavedSediment?.()||!!instance?.hasUnsavedChiques?.();};
  const unsavedObservationEditions=()=>{const current=root&&displayedPerson!==null?benchmarkKey(key,displayedPerson):null;for(const [identity,state] of observationEditionMemory)if(identity!==current&&(state?.dirty||state?.pending_save||state?.retained_saves?.length))return true;return !!instance?.hasUnsavedObservationEditions?.();};
  const unsavedCollections=()=>{const current=root&&displayedPerson!==null?benchmarkKey(key,displayedPerson):null;for(const [identity,session] of collectionMemory)if(identity!==current&&(session.dirty||session.storageBlocked||session.state.pending))return true;return !!collections?.hasUnsaved?.();};
  const beforeUnload=event=>{if(unsavedBenchmarks()||unsavedObservationEditions()||unsavedCollections()){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  const stale=()=>{const error=new Error('This Measurements view was closed or its workspace changed. Reopen the original workspace to inspect any submitted operation.');error.name='AbortError';return error;};
  const writes=(path,method)=>method!=='GET'&&!['/preview','/collections/preview','/large/collections/preview','/chiques/preview','/provider-query','/handbacks/preview'].includes(path);
  function syncPerson(){const next=personIdentity();if(next===person)return false;person=next;lateResults.clear();handbackMemory.clear();observationEditionMemory.clear();return true;}
  function remember(workspace,owner,path,method,response,error){
    syncPerson();if(owner!==person)return;
    const identities={};let native=response;
    try{if(typeof response?.body==='string')native=JSON.parse(response.body);}catch{}
    for(const name of ['id','collectionId','editionId','sourceId','recordId','task_id','operation_id','revision','workspaceRevision']){
      const value=native?.[name];if(typeof value==='string'||typeof value==='number')identities[name]=value;
    }
    for(const name of ['record','collection','edition','source','task'])if(typeof native?.[name]?.id==='string')identities[name+'_id']=native[name].id;
    lateResults.delete(workspace);
    lateResults.set(workspace,{path,method,status:Number.isInteger(response?.status)?response.status:200,identities,unconfirmed:Boolean(error),completedAt:new Date().toISOString()});
    // Keep only status and native identities, never raw source/result bodies, for
    // at most eight workspaces. Native sources/history own durable recovery.
    while(lateResults.size>8)lateResults.delete(lateResults.keys().next().value);
    paintCurrentNotice();
  }
  function mount(host){
    syncPerson();
    if(root===host&&key===getWorkspace()&&displayedPerson===person&&instance)return;
    suspend();root=host;key=getWorkspace();displayedPerson=person;
    const boundWorkspace=key,mountedGeneration=generation,boundPerson=person;
    const active=()=>root===host&&key===boundWorkspace&&generation===mountedGeneration&&getWorkspace()===boundWorkspace&&personIdentity()===boundPerson;
    const requireActive=()=>{if(!active())throw stale();};
    const refresh=()=>active()?instance?.refresh():undefined;
    const outer=document.createElement('div');root.replaceChildren(outer);
    const notice=document.createElement('p');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.hidden=true;outer.append(notice);
    paintCurrentNotice=()=>{
      if(!active())return;
      const result=lateResults.get(boundWorkspace);notice.hidden=!result;
      if(!result)return;
      const label=result.path==='/domain'?'Native source binding':result.path==='/collections/receive'?'Collection receiving':result.path==='/receive'?'Measurement receiving':result.path==='/imports'?'Source import':result.path.endsWith('/review')?'Measurement review':result.path.endsWith('/mapping')?'Station assignment':result.path.endsWith('/publish')?'Study publication':'Measurement operation';
      const outcome=result.unconfirmed?'has an unconfirmed outcome':result.status>=400?'returned an error':'completed';
      notice.textContent=label+' '+outcome+' in this workspace after its view was closed. Use the saved sources, collections and original review history below to inspect the result. No request was repeated.';
    };
    async function send(route,path,method,payload){
      requireActive();
      let value;
      try{value=await api(route,{method:'POST',body:{...payload,workspace:boundWorkspace}});}
      catch(error){
        if(!active()){if(writes(path,method))remember(boundWorkspace,boundPerson,path,method,null,error);throw stale();}
        throw error;
      }
      let retained=false;
      const guard=()=>{
        if(active())return;
        if(writes(path,method)&&!retained){remember(boundWorkspace,boundPerson,path,method,value,null);retained=true;}
        throw stale();
      };
      guard();
      return {value,guard};
    }
    const request=async(path,method='GET',payload)=>{
      const {value,guard}=await send('/api/measurements/rpc',path,method,{path,method,payload});
      return {ok:value.status<400,status:value.status,type:value.content_type,text:async()=>{guard();return value.body;}};
    };
    const binding=document.createElement('details');binding.className='mw-domain-binding';
    binding.style.cssText='padding:18px;background:#f3f3f3;border:1px solid #cecece;font:14px system-ui';
    binding.innerHTML='<summary>Bind an original native reach or HUC source</summary><p>Read IDs from a retained Workspace JSON/GeoJSON source. This does not infer station drainage relationships.</p><form style="display:grid;gap:8px"><label>Original workspace-relative source file <input name="source_path" required style="width:100%"></label><label>List field path, e.g. features <input name="items_path" style="width:100%"></label><label>ID field path, e.g. properties.HUC12 <input name="id_path" style="width:100%"></label><label>Name field path, optional <input name="name_path" style="width:100%"></label><button>Read original identifiers</button></form><p role="status"></p>';
    outer.append(binding);
    const largeHost=document.createElement('section');outer.append(largeHost);
    largeFiles=mountLargeFilePanel(largeHost,{workspaceKey:boundWorkspace,request,refresh});
    const chemistryHost=document.createElement('section');outer.append(chemistryHost);
    chemistry=mountMeasuredChemistry(chemistryHost,capabilities,{memory:chemistryMemory});
    const nativeHost=document.createElement('section');outer.append(nativeHost);
    nativeObservations=mountNativeObservations(nativeHost,{request:async(action,payload={})=>{
      const {value,guard}=await send('/api/measurements/native-observations','/native-observations/'+action,action==='prepare'?'POST':'GET',{action,...payload});guard();return value;
    }});
    const collectionHost=document.createElement('section');outer.append(collectionHost);
    collections=mountCollectionPanel(collectionHost,{request,refresh,workspaceKey:benchmarkKey(boundWorkspace,boundPerson),initialSession:collectionMemory.get(benchmarkKey(boundWorkspace,boundPerson))||null});
    const returnedHost=document.createElement('section');outer.append(returnedHost);
    returnedReviews=mountReturnedReviews(returnedHost,capabilities,{memory:returnedReviewMemory,openLargeFiles(){
      if(!active())return;largeHost.scrollIntoView({behavior:'smooth',block:'start'});largeHost.querySelector('[data-file]')?.focus({preventScroll:true});
    }});
    const component=document.createElement('div');outer.append(component);
    binding.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();const status=binding.querySelector('[role=status]');
      try{
        const {value:result,guard}=await send('/api/measurements/domain','/domain','POST',Object.fromEntries(new FormData(event.target)));
        guard();status.textContent=`${result.count} original identifiers registered; source SHA-256 ${result.source_sha256}`;await refresh();
      }catch(error){if(active())status.textContent=error.message;}
    });
    instance=mountMeasurements(component,{transport:request,css:'/web/measured_observations.css',initialBenchmarkState:benchmarkMemory.get(benchmarkKey(boundWorkspace,boundPerson))||null,initialSedimentState:sedimentMemory.get(benchmarkKey(boundWorkspace,boundPerson))||null,initialChiquesState:chiquesMemory.get(benchmarkKey(boundWorkspace,boundPerson))||null,onChiquesState:value=>chiquesMemory.set(benchmarkKey(boundWorkspace,boundPerson),JSON.parse(JSON.stringify(value))),sedimentScope:boundPerson,onSedimentState:value=>sedimentMemory.set(benchmarkKey(boundWorkspace,boundPerson),JSON.parse(JSON.stringify(value))),observationEditionState:observationEditionMemory.get(benchmarkKey(boundWorkspace,boundPerson))||null,observationEditionCss:'/web/observation_editions.css',onObservationEditionState:value=>{if(personIdentity()===boundPerson)observationEditionMemory.set(benchmarkKey(boundWorkspace,boundPerson),JSON.parse(JSON.stringify(value)));},sourceHandbackCss:'/web/source_handback.css',sourceHandbackState:handbackMemory.get(boundWorkspace)||null,onSourceHandbackState:value=>{if(personIdentity()===boundPerson)handbackMemory.set(boundWorkspace,JSON.parse(JSON.stringify(value)));}});
    paintCurrentNotice();
  }
  function suspend(){
    if(collections&&key!==null&&displayedPerson!==null)collectionMemory.set(benchmarkKey(key,displayedPerson),collections.snapshot());
    // The original host detaches after selection changes. Retain the exact old
    // editor locally; never send an old-identity write through the new selection.
    if(instance&&displayedPerson!==null){const observation=personIdentity()===displayedPerson?instance.snapshotObservationEditions?.():null;if(observation)observationEditionMemory.set(benchmarkKey(key,displayedPerson),JSON.parse(JSON.stringify(observation)));const nutrient=instance.snapshotChiques?.();if(nutrient)chiquesMemory.set(benchmarkKey(key,displayedPerson),nutrient);const state=instance.snapshotBenchmarks?.();if(state)benchmarkMemory.set(benchmarkKey(key,displayedPerson),state);const sediment=instance.snapshotSediment?.();if(sediment)sedimentMemory.set(benchmarkKey(key,displayedPerson),sediment);}
    generation++;paintCurrentNotice=()=>{};displayedPerson=null;
    nativeObservations?.destroy();nativeObservations=null;returnedReviews?.destroy();returnedReviews=null;largeFiles?.destroy();largeFiles=null;chemistry?.destroy();chemistry=null;collections?.destroy();collections=null;instance?.destroy({retainedBenchmarkState:true,retainedSedimentState:true});instance=null;root=null;key=null;
  }
  return {mount,async prepareLeave(){if(instance)await instance.prepareLeave?.();},cancelLeave(){instance?.cancelLeave?.();},destroy(){suspend();window.removeEventListener('beforeunload',beforeUnload);},update(){const personChanged=syncPerson();if(root&&(personChanged||key!==getWorkspace()))mount(root);},suspend};
}
