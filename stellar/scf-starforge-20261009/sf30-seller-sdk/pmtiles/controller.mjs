// MIT. Joined authoring, native preview, selected release and complete workspace handover.
import {randomBytes} from 'node:crypto';
import {readJson} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {join} from 'node:path';
import {need,digest,clone,resolveStyle} from './model.mjs';
import {MAX_METADATA_BYTES} from './files.mjs';
import {readRuntime} from './native.mjs';
import {startMartin} from './martin.mjs';
import {browserUploads} from './uploads.mjs';
import {createOperationsPackage,readOperationsPackage} from './portable.mjs';

export async function createPMTilesController({workspace,runtime}){
  runtime=await readRuntime(runtime);const shutdown=new AbortController();const uploads=browserUploads(workspace),operations=new Map();
  let preview=null,previewToken=null,closed=false,previewQueue=Promise.resolve();
  function serial(work){const next=previewQueue.catch(()=>{}).then(work);previewQueue=next;return next;}
  async function stopPreview(){
    const previous=preview;preview=null;previewToken=null;
    if(previous)await previous.close();return previous?.releaseId??null;
  }
  async function openPreview(releaseId,options={}){
    if(preview?.alive&&preview.releaseId===releaseId)return previewStatus();
    await stopPreview();need(!closed,'PMTILES_CONTROLLER_CLOSED');
    preview=await startMartin({workspace,runtime,releaseId,...options});
    previewToken=randomBytes(32).toString('hex');return previewStatus();
  }
  function previewStatus(){
    return preview?{alive:preview.alive,releaseId:preview.releaseId,session:preview.session,
      manifestSha256:preview.manifestSha256,path:'/preview/'+previewToken+'/style.json',runtimeSha256:preview.runtimeSha256}:null;
  }
  async function perform(action,input,options={}){
    need(!closed,'PMTILES_CONTROLLER_CLOSED');
    switch(action){
      case 'import-local':return workspace.importLocal(input,options);
      case 'acquire':return workspace.acquire(input,options);
      case 'save-edition':return workspace.saveEdition(input);
      case 'inspect':return workspace.inspectEdition(input,runtime,options);
      case 'review':return workspace.review(input);
      case 'prepare-release':return workspace.prepareRelease(input,options);
      case 'preview':return serial(()=>openPreview(input.releaseId,options));
      case 'stop-preview':return serial(async()=>({stoppedReleaseId:await stopPreview()}));
      case 'publish':return serial(async()=>{
        await stopPreview();const publication=await workspace.publish(input,options);
        let view=null,previewError=null;
        try{view=await openPreview(publication.releaseId,options);}catch(error){previewError={code:error.code??'PMTILES_PREVIEW_FAILED',message:String(error.message)};}
        return {publication,preview:view,previewError};
      });
      case 'restore':return serial(async()=>{
        await stopPreview();const restoration=await workspace.restore(input,options);
        let view=null,previewError=null;
        if(restoration.restoredReleaseId)try{view=await openPreview(restoration.restoredReleaseId,options);}
          catch(error){previewError={code:error.code??'PMTILES_PREVIEW_FAILED',message:String(error.message)};}
        return {restoration,preview:view,previewError};
      });
      case 'package':return serial(async()=>{
        const prior=await stopPreview();let result;
        try{result=await createOperationsPackage({workspace,runtime,input,signal:options.signal});}
        finally{if(prior&&!closed)await openPreview(prior,options).catch(()=>{});}
        return result;
      });
      case 'export':return serial(async()=>{
        const prior=await stopPreview();let result;
        try{result=await workspace.exportWorkspace({...input,signal:options.signal});}
        finally{if(prior&&!closed)await openPreview(prior,options).catch(()=>{});}
        return result;
      });
      default:need(false,'PMTILES_ACTION_NOT_FOUND');
    }
  }
  function execute(action,input,options={}){
    need(input&&typeof input.requestId==='string','PMTILES_REQUEST_ID_REQUIRED');
    need(input.expectedWorkspaceId===workspace.state().id,'PMTILES_WORKSPACE_ID_CHANGED');
    const key=input.requestId,selected=digest({action,input}),old=operations.get(key);
    if(old){need(old.inputSha256===selected,'PMTILES_REQUEST_INPUT_CHANGED');return old.promise;}
    const row={inputSha256:selected,promise:null};
    row.promise=perform(action,clone(input),{...options,signal:options.signal?AbortSignal.any([options.signal,shutdown.signal]):shutdown.signal});operations.set(key,row);
    row.promise.catch(()=>{if(operations.get(key)===row)operations.delete(key);});
    return row.promise;
  }
  async function previewResource(token,path){
    need(preview&&preview.alive&&token===previewToken,'PMTILES_PREVIEW_EXPIRED');
    const selected=preview,release=workspace.getRelease(selected.releaseId),root=workspace.releaseDirectory(selected.releaseId);
    const review=await readJson(join(root,'review.json'),MAX_METADATA_BYTES),prepared=review.inspection.prepared;
    if(path==='style.json')return {kind:'json',value:resolveStyle(prepared,{tilesBase:'/preview/'+token+'/tiles',resourcesBase:'/preview/'+token+'/resources'})};
    if(path==='manifest.json')return {kind:'json',value:{release,rights:prepared.sources.map(row=>row.rights),layers:prepared.layerRows,
      glyphCoverage:prepared.glyphCoverage,sources:prepared.sources,edition:review.edition,
      review:{id:review.id,reviewSha256:review.reviewSha256,reviewer:review.reviewer,note:review.note,
        createdAt:review.createdAt,inspectionRequestId:review.inspectionRequestId,previousReleaseId:review.previousReleaseId}}};
    const tile=path.match(/^tiles\/([A-Za-z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)$/);
    if(tile){
      const row=prepared.sources.find(row=>row.nativeId===tile[1]);need(row,'PMTILES_PREVIEW_SOURCE_NOT_FOUND');
      const [z,x,y]=tile.slice(2).map(Number);need(Number.isInteger(z)&&z>=0&&z<=26&&x>=0&&x<2**z&&y>=0&&y<2**z,'PMTILES_TILE_COORDINATE_INVALID');
      const native=await selected.request('/'+tile.slice(1).join('/'));
      need(preview===selected&&previewToken===token&&selected.alive,'PMTILES_PREVIEW_EXPIRED');
      return {kind:'native',response:native};
    }
    let id=null,contentType='application/octet-stream';
    const sprite=path.match(/^resources\/sprite(@2x)?\.(json|png)$/);
    if(sprite){const binding=sprite[1]?review.edition.sprite?.retina:review.edition.sprite;
      need(binding,'PMTILES_PREVIEW_RESOURCE_NOT_FOUND');id=binding[sprite[2]];contentType=sprite[2]==='png'?'image/png':'application/json';}
    const glyph=path.match(/^resources\/glyphs\/([^/]+)\/(\d+-\d+)\.pbf$/);
    if(glyph){let fontstack;try{fontstack=decodeURIComponent(glyph[1]);}catch{need(false,'PMTILES_GLYPH_PATH_INVALID');}
      const row=review.edition.glyphs.find(g=>g.fontstack===fontstack&&g.range===glyph[2]);
      need(row,'PMTILES_PREVIEW_RESOURCE_NOT_FOUND');id=row.resourceId;contentType='application/x-protobuf';}
    need(id,'PMTILES_PREVIEW_RESOURCE_NOT_FOUND');
    return {kind:'file',file:workspace.resourceFile(id),contentType};
  }
  return Object.freeze({workspace,runtime,uploads,execute,previewResource,
    async packageFile(input){need(input.expectedWorkspaceId===workspace.state().id,'PMTILES_WORKSPACE_ID_CHANGED');return readOperationsPackage(input);},
    state:()=>({...workspace.state(),preview:previewStatus(),runtime:{sha256:runtime.runtimeSha256,packages:runtime.packages}}),
    async close(){closed=true;shutdown.abort(new Error('PMTILES_CONTROLLER_CLOSING'));await serial(stopPreview).catch(()=>{});await workspace.close();await Promise.allSettled([...operations.values()].map(row=>row.promise));}});
}
