// MIT. One paid map-output lifecycle on the original PMTiles and SF82 owners.
import {resolve,join,isAbsolute,sep} from 'node:path';
import {realpath} from 'node:fs/promises';
import {privateDirectory,readJson,exists} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {need,clone,digest,identifier,text} from '../model.mjs';
import {retainJson} from '../files.mjs';
import {withNativeLease} from '../native.mjs';
import {initReleaseStore,readReleaseState,stageRelease,inspectRelease,compareReleases,
  activateRelease,releaseStatus,runActiveRelease,normalizeReleaseRuntime} from '../../../sf82-seller-pilot/releases.mjs';
import {prepareOutputPackage,readOutputPackage,outputPackageView} from './package.mjs';
import {fields,outputHash,OUTPUT_METADATA_BYTES} from './model.mjs';

const OPERATION_SCHEMA='starforge.pmtiles-output-operation.v1';
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'),
  'PMTILES_OUTPUT_ABSOLUTE_PATH_REQUIRED');return resolve(value);}
function separate(left,right){need(left!==right&&!left.startsWith(right+sep)&&!right.startsWith(left+sep),
  'PMTILES_OUTPUT_SEPARATE_DIRECTORY_REQUIRED');}
function generation(value){need(Number.isSafeInteger(value)&&value>=0,'PMTILES_OUTPUT_GENERATION_REQUIRED');return value;}
function observedRuntime(value){
  return value?pick(value,['instanceId','releaseId','releaseDigest','selectionGeneration','listener','mode',
    'phase','startedAt','readyAt','endedAt','exitCode','exitSignal','failure']):null;
}
function runtimeView(status,owned){
  return {state:status.runtime.state,owned:Boolean(owned&&
    status.runtime.observed?.instanceId===owned.observation.instanceId),
    observed:observedRuntime(status.runtime.observed),
    ...pick(status.runtime,['managerAlive','childAlive','message'])};
}
function publicState(state){return {generation:state.generation,active:state.active,previous:state.previous};}
function selectedRuntime(value){
  fields(value,['port','facilitator','allowLocalFacilitator']);
  return normalizeReleaseRuntime(clone(value));
}
function runView(run){return {state:'RUNNING',owned:true,releaseId:run.release.id,releaseDigest:run.release.digest,
  instanceId:run.observation.instanceId,generation:run.observation.selectionGeneration,url:run.url,mode:run.mode};}

/** The workspace is borrowed. This controller owns only the seller process it starts. */
export class PMTilesOutputController{
  #workspace;#directory;#releaseStore;#runtimes;#ready;#tail=Promise.resolve();#pending=new Set();
  #closing=false;#closePromise;#abort=new AbortController();#run=null;#runRequest=null;
  constructor({workspace,directory,releaseStore,runtimes={}}){
    need(workspace&&typeof workspace.state==='function'&&typeof workspace.getRelease==='function',
      'PMTILES_ORIGINAL_WORKSPACE_REQUIRED');
    this.#workspace=workspace;this.#directory=absolute(directory);this.#releaseStore=absolute(releaseStore);
    separate(this.#directory,workspace.directory);separate(this.#directory,this.#releaseStore);
    fields(runtimes,Object.keys(runtimes));
    this.#runtimes=Object.fromEntries(Object.entries(clone(runtimes)).map(([name,value])=>{
      identifier(name);return [name,selectedRuntime(value)];
    }));
    need(Object.keys(this.#runtimes).length<=32,'PMTILES_OUTPUT_RUNTIME_PROFILE_LIMIT');
    this.#ready=(async()=>{
      await privateDirectory(this.#directory);need(await realpath(this.#directory)===this.#directory,
        'PMTILES_OUTPUT_CANONICAL_DIRECTORY_REQUIRED');
      await privateDirectory(join(this.#directory,'locks'));
      await privateDirectory(join(this.#directory,'packages'));
      await privateDirectory(join(this.#directory,'operations'));
      await initReleaseStore(this.#releaseStore,{resume:true});
      need(await realpath(this.#releaseStore)===this.#releaseStore,'PMTILES_OUTPUT_CANONICAL_RELEASE_STORE_REQUIRED');
    })();void this.#ready.catch(()=>{});
  }
  get directory(){return this.#directory;}
  get releaseStore(){return this.#releaseStore;}
  get workspaceId(){return this.#workspace.state().id;}
  get ownedRuntime(){return this.#run?runView(this.#run):null;}
  async wait(){const run=this.#run;if(run)await run.completion;return this.status();}
  packageDirectory(requestId){return join(this.#directory,'packages',identifier(requestId));}
  async package(requestId,expectedManifestSha256,{signal}={}){
    await this.#ready;
    const prepared=await readOutputPackage(this.packageDirectory(requestId),{expectedManifestSha256,signal});
    need(prepared.source.release.workspaceId===this.workspaceId,'PMTILES_OUTPUT_WORKSPACE_CHANGED');
    return prepared;
  }
  async #release(releaseId,releaseDigest){
    const selected=await inspectRelease(this.#releaseStore,identifier(releaseId));
    need(selected.pmtilesOutput?.release?.workspaceId===this.workspaceId,'PMTILES_OUTPUT_RELEASE_WORKSPACE_CHANGED');
    if(releaseDigest!==undefined)need(selected.digest===outputHash(releaseDigest),'PMTILES_OUTPUT_RELEASE_CHANGED');
    return selected;
  }
  async status(){
    await this.#ready;const status=await releaseStatus(this.#releaseStore);
    return {schema:'starforge.pmtiles-output-status.v1',workspaceId:this.workspaceId,closing:this.#closing,
      pending:this.#pending.size,runtimes:Object.entries(this.#runtimes).map(([name,runtime])=>({name,...runtime})),
      state:publicState(status.state),runtime:runtimeView(status,this.#run),
      releases:status.releases.filter(row=>row.pmtilesOutput?.release?.workspaceId===this.workspaceId),errors:status.errors};
  }
  async #operation(action,input,work){
    const directory=join(this.#directory,'operations',identifier(input.requestId));
    await privateDirectory(directory);
    const request={schema:OPERATION_SCHEMA,workspaceId:this.workspaceId,directory:this.#directory,
      releaseStore:this.#releaseStore,action,input:clone(input)};
    const requestSha256=digest(request);
    await retainJson(join(directory,'request.json'),request);
    const resultPath=join(directory,'complete.json');
    if(await exists(resultPath)){
      const saved=await readJson(resultPath,OUTPUT_METADATA_BYTES);
      need(saved.schema===OPERATION_SCHEMA&&saved.requestId===input.requestId&&saved.requestSha256===requestSha256,
        'PMTILES_OUTPUT_OPERATION_CHANGED');
      return {...saved,reused:true};
    }
    const result=await work({directory,request,requestSha256});
    const saved={schema:OPERATION_SCHEMA,requestId:input.requestId,requestSha256,result};
    await retainJson(resultPath,saved);return {...saved,reused:false};
  }
  async #stopOwned(){
    const run=this.#run;if(!run)return;
    await run.close();await run.completion;
    if(this.#run===run){this.#run=null;this.#runRequest=null;}
  }
  async #execute(action,input,signal){
    await this.#ready;signal?.throwIfAborted();need(!this.#closing,'PMTILES_OUTPUT_CLOSING');
    const workspaceId=this.workspaceId;
    need(input.expectedWorkspaceId===workspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
    const scope=['expectedWorkspaceId'];
    if(action==='status'){fields(input,scope,scope);return this.status();}
    if(action==='request'){
      fields(input,[...scope,'requestId'],[...scope,'requestId']);
      const directory=join(this.#directory,'operations',identifier(input.requestId));
      const request=await readJson(join(directory,'request.json'),OUTPUT_METADATA_BYTES);
      need(request.schema===OPERATION_SCHEMA&&request.workspaceId===workspaceId&&request.directory===this.#directory&&
        request.releaseStore===this.#releaseStore&&request.input.requestId===input.requestId,'PMTILES_OUTPUT_OPERATION_CHANGED');
      const resultPath=join(directory,'complete.json');
      const complete=await exists(resultPath)?await readJson(resultPath,OUTPUT_METADATA_BYTES):null;
      if(complete)need(complete.schema===OPERATION_SCHEMA&&complete.requestId===input.requestId&&
        complete.requestSha256===digest(request),'PMTILES_OUTPUT_OPERATION_CHANGED');
      return {request,complete};
    }
    if(action==='prepare')return prepareOutputPackage({workspace:this.#workspace,
      directory:this.packageDirectory(input.requestId),input,signal});
    if(action==='package'||action==='catalog'){
      fields(input,[...scope,'outputRequestId','manifestSha256'],[...scope,'outputRequestId','manifestSha256']);
      const prepared=await this.package(input.outputRequestId,outputHash(input.manifestSha256),{signal});
      return action==='package'?outputPackageView(prepared):{catalogSha256:prepared.manifest.catalogSha256,
        catalog:clone(prepared.documents.catalog),objectsSha256:prepared.manifest.files.find(row=>row.path==='objects.json').sha256,
        objects:clone(prepared.documents.description)};
    }
    if(action==='release'){
      fields(input,[...scope,'releaseId','releaseDigest'],[...scope,'releaseId','releaseDigest']);
      return this.#release(input.releaseId,input.releaseDigest);
    }
    if(action==='compare'){
      fields(input,[...scope,'beforeReleaseId','releaseId','releaseDigest'],[...scope,'beforeReleaseId','releaseId','releaseDigest']);
      await this.#release(input.releaseId,input.releaseDigest);
      if(input.beforeReleaseId!==null)await this.#release(input.beforeReleaseId);
      return {comparison:await compareReleases(this.#releaseStore,input.beforeReleaseId,input.releaseId),
        state:publicState(await readReleaseState(this.#releaseStore))};
    }
    if(action==='stage'){
      fields(input,[...scope,'requestId','outputRequestId','manifestSha256','releaseId','label','runtime'],
        [...scope,'requestId','outputRequestId','manifestSha256','releaseId','runtime']);
      const runtime=this.#runtimes[identifier(input.runtime)];
      need(runtime,'PMTILES_OUTPUT_RUNTIME_NOT_CONFIGURED');identifier(input.releaseId);
      const prepared=await this.package(input.outputRequestId,outputHash(input.manifestSha256),{signal});
      const selected={...input,runtime:clone(runtime),runtimeName:input.runtime,label:input.label??input.releaseId};
      text(selected.label,240);
      need(!/[\u0000-\u001f\u007f]/.test(selected.label),'PMTILES_OUTPUT_RELEASE_LABEL_INVALID');
      selected.label=selected.label.trim();
      return this.#operation(action,selected,async()=>{
        const present=await exists(join(this.#releaseStore,'releases',input.releaseId));
        if(!present)await stageRelease(this.#releaseStore,{id:input.releaseId,label:selected.label,
          runtime:clone(runtime),pmtilesPackage:prepared.directory,pmtilesManifestSha256:prepared.manifestSha256,signal});
        const result=await this.#release(input.releaseId);
        need(result.label===selected.label&&digest(result.runtime)===digest(runtime)&&
          result.pmtilesOutput.packageManifestSha256===prepared.manifestSha256,
          'PMTILES_OUTPUT_STAGED_RELEASE_CHANGED');
        return result;
      });
    }
    if(action==='activate'){
      fields(input,[...scope,'requestId','releaseId','releaseDigest','expectedGeneration','reason'],
        [...scope,'requestId','releaseId','releaseDigest','expectedGeneration','reason']);
      generation(input.expectedGeneration);text(input.reason,150);
      need(!/[\u0000-\u001f\u007f]/.test(input.reason),'PMTILES_OUTPUT_CHANGE_REASON_INVALID');
      await this.#release(input.releaseId,input.releaseDigest);
      return this.#operation(action,input,async({directory,requestSha256})=>{
        const planPath=join(directory,'selection.json');let plan;
        if(await exists(planPath))plan=await readJson(planPath,OUTPUT_METADATA_BYTES);
        else{
          const state=await readReleaseState(this.#releaseStore);
          need(state.generation===input.expectedGeneration,'PMTILES_OUTPUT_SELECTION_CONFLICT');
          plan={requestSha256,before:publicState(state),
            reason:input.reason.trim()+' [pmtiles-output:'+requestSha256+']'};
          await retainJson(planPath,plan);
        }
        need(plan.requestSha256===requestSha256&&plan.before.generation===input.expectedGeneration,
          'PMTILES_OUTPUT_SELECTION_CHANGED');
        let state=await readReleaseState(this.#releaseStore);
        if(plan.before.active===input.releaseId)return {changed:false,selection:clone(plan.before)};
        const find=()=>state.history.find(event=>event.generation===input.expectedGeneration+1&&
          event.operation==='activate'&&event.from===plan.before.active&&event.to===input.releaseId&&event.reason===plan.reason);
        let event=find();
        if(!event){
          need(state.generation===input.expectedGeneration,'PMTILES_OUTPUT_SELECTION_CONFLICT');
          await activateRelease(this.#releaseStore,input.releaseId,{expectedGeneration:input.expectedGeneration,reason:plan.reason});
          state=await readReleaseState(this.#releaseStore);event=find();
        }
        need(event,'PMTILES_OUTPUT_SELECTION_RESULT_UNAVAILABLE');
        return {changed:true,event:clone(event),selection:{generation:event.generation,active:event.to,previous:event.from}};
      });
    }
    if(action==='start'){
      fields(input,[...scope,'requestId','releaseId','releaseDigest','expectedGeneration'],
        [...scope,'requestId','releaseId','releaseDigest','expectedGeneration']);
      generation(input.expectedGeneration);await this.#release(input.releaseId,input.releaseDigest);
      return this.#operation(action,input,async({directory,requestSha256})=>{
        const current=await releaseStatus(this.#releaseStore),state=current.state;
        need(state.active===input.releaseId&&state.generation===input.expectedGeneration,
          'PMTILES_OUTPUT_ACTIVE_SELECTION_CHANGED');
        if(this.#run){
          need(this.#run.release.id===input.releaseId&&this.#run.release.digest===input.releaseDigest&&
            this.#run.observation.selectionGeneration===input.expectedGeneration,'PMTILES_OUTPUT_OWNED_SELLER_DIFFERS');
          return runView(this.#run);
        }
        if(['RUNNING','RESTART_REQUIRED'].includes(current.runtime.state)){
          need(current.runtime.observed?.releaseId===input.releaseId&&
            current.runtime.observed.releaseDigest===input.releaseDigest&&
            current.runtime.observed.selectionGeneration===input.expectedGeneration,
            'PMTILES_OUTPUT_ACTIVE_SELLER_DIFFERS');
          return {state:current.runtime.state,owned:false,observed:observedRuntime(current.runtime.observed)};
        }
        await retainJson(join(directory,'start-plan.json'),{requestSha256,releaseId:input.releaseId,
          releaseDigest:input.releaseDigest,generation:input.expectedGeneration});
        const run=await runActiveRelease(this.#releaseStore,{expectedGeneration:input.expectedGeneration,handleSignals:false});
        this.#run=run;this.#runRequest=input.requestId;
        run.completion.then(()=>{
          if(this.#run===run){this.#run=null;this.#runRequest=null;}
        },()=>{});
        if(this.#closing||signal?.aborted){await this.#stopOwned();signal?.throwIfAborted();need(false,'PMTILES_OUTPUT_CLOSING');}
        return runView(run);
      });
    }
    if(action==='stop'){
      fields(input,[...scope,'requestId','releaseId','releaseDigest','instanceId'],
        [...scope,'requestId','releaseId','releaseDigest','instanceId']);
      identifier(input.instanceId);await this.#release(input.releaseId,input.releaseDigest);
      return this.#operation(action,input,async()=>{
        if(this.#run){
          need(this.#run.observation.instanceId===input.instanceId&&this.#run.release.id===input.releaseId&&
            this.#run.release.digest===input.releaseDigest,'PMTILES_OUTPUT_SELLER_INSTANCE_CHANGED');
          await this.#stopOwned();return {state:'STOPPED',instanceId:input.instanceId};
        }
        const status=await releaseStatus(this.#releaseStore),observed=status.runtime.observed;
        need(status.runtime.state==='STOPPED'&&observed?.instanceId===input.instanceId&&
          observed.releaseId===input.releaseId&&observed.releaseDigest===input.releaseDigest,
          'PMTILES_OUTPUT_STOP_REQUIRES_OWNED_SELLER');
        return {state:'STOPPED',instanceId:input.instanceId,observed:observedRuntime(observed)};
      });
    }
    need(false,'PMTILES_OUTPUT_ACTION_INVALID');
  }
  execute(action,value,{signal}={}){
    if(this.#closing)return Promise.reject(Object.assign(new Error('PMTILES_OUTPUT_CLOSING'),{code:'PMTILES_OUTPUT_CLOSING'}));
    let input;
    try{input=clone(value);need(signal===undefined||signal instanceof AbortSignal,'PMTILES_ABORT_SIGNAL_INVALID');}
    catch(error){return Promise.reject(error);}
    const combined=signal?AbortSignal.any([signal,this.#abort.signal]):this.#abort.signal;
    const pending=this.#tail.catch(()=>{}).then(async()=>{
      await this.#ready;
      return withNativeLease(join(this.#directory,'locks'),'output-operator',()=>this.#execute(action,input,combined));
    });
    this.#tail=pending;this.#pending.add(pending);
    const done=()=>this.#pending.delete(pending);pending.then(done,done);return pending;
  }
  requestClose(){this.#closing=true;this.#abort.abort(new Error('PMTILES_OUTPUT_CLOSING'));}
  close(){
    if(this.#closePromise)return this.#closePromise;this.requestClose();
    this.#closePromise=(async()=>{await Promise.allSettled([...this.#pending]);await this.#stopOwned();})();
    return this.#closePromise;
  }
}
export const createPMTilesOutputController=options=>new PMTilesOutputController(options);
