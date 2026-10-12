// MIT. Borrow the original Research HTTP workspace without taking its listener lifecycle.
import {isAbsolute,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {createClinicalTrialsClient} from './clinical-trials-client.mjs';
import {createDocumentWorkspaceClient,createPipelineWorkspaceClient,sendPipelineFiles} from './document-workspace-client.mjs';
import {BuyerError,need,object,parseJson,safeCode} from '../node/store.mjs';
import {writePortableFile,PORTABLE_LIMIT} from './portable.mjs';
import {readResearchHostFile,openResearchSource} from './workspace-files.mjs';
import {RESEARCH_WORKSPACE_API,RESEARCH_WORKSPACE_CONNECTION,RESEARCH_CONTROL_LIMIT,
  researchConnection,researchSummary,researchWorkspaceId} from './workspace-protocol.mjs';

const pathId=value=>{
  need(typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f/\\]/.test(value),
    'RESEARCH_ID_INVALID');return encodeURIComponent(value);
};
const parameters=value=>{
  const out=new URLSearchParams();
  for(const[key,item]of Object.entries(value??{}))if(item!==undefined&&item!==null)out.set(key,String(item));
  const text=out.toString();return text?'?'+text:'';
};
const dossierPath=id=>'/api/dossiers/'+pathId(id);
const operationPath=(id,operationId)=>dossierPath(id)+'/crossref/operations/'+pathId(operationId);
const sourcePath=(id,editionId,key)=>dossierPath(id)+'/retained-editions/'+pathId(editionId)+'/occurrences/'+pathId(key);

export async function readResearchConnectionFile(file){
  need(typeof file==='string'&&isAbsolute(file)&&resolve(file)===file,'RESEARCH_CONNECTION_ABSOLUTE_PATH_REQUIRED');
  const bytes=await readResearchHostFile(file,65536,{privateFile:true});
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();
  let value=text.startsWith('{')?parseJson(bytes):{url:text};
  if(value.schema==='stellar-forge.application-url.v1'){
    need(value.command==='research-workspace'&&value.source==='original-command-stdout'&&
      typeof value.applicationId==='string'&&value.applicationId&&typeof value.operationId==='string'&&value.operationId&&
      Number.isFinite(Date.parse(value.observedAt))&&typeof value.url==='string'&&
      (value.original===undefined||object(value.original)),'RESEARCH_CONNECTION_INVALID');
    value={...(value.original??{}),schema:RESEARCH_WORKSPACE_CONNECTION,url:value.url};
  }
  researchConnection(value);return value;
}
async function readResponse(response,maximum=RESEARCH_CONTROL_LIMIT){
  const chunks=[];let size=0;
  for await(const chunk of response.body??[]){
    size+=chunk.length;need(size<=maximum,'RESEARCH_RESPONSE_TOO_LARGE');chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}
function connectionDescriptor(options){
  need(object(options),'RESEARCH_CONNECTION_INVALID');
  need((options.connectionFile===undefined)!==(options.url===undefined),'RESEARCH_CONNECTION_REQUIRED');
  need(options.directory===undefined||typeof options.directory==='string'&&isAbsolute(options.directory)&&
    resolve(options.directory)===options.directory,'WORKSPACE_ABSOLUTE_PATH_REQUIRED');
  need(options.expectedWorkspaceId===undefined||/^research_[a-f0-9]{64}$/.test(options.expectedWorkspaceId),
    'RESEARCH_WORKSPACE_ID_INVALID');
  return {...options};
}
export class ResearchWorkspaceClient{
  #definition;#fetch;#pending=new Set();#closed=false;#closing;#workspaceId=null;
  constructor(options,{fetch=globalThis.fetch,timeoutMs=120000}={}){
    this.#definition=connectionDescriptor(options);need(typeof fetch==='function','RESEARCH_FETCH_REQUIRED');
    need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=900000,'RESEARCH_TIMEOUT_INVALID');
    this.#fetch=fetch;this.timeoutMs=timeoutMs;
  }
  static fromFile(file,options={}){return new ResearchWorkspaceClient({connectionFile:resolve(file),...options});}
  get workspaceId(){return this.#workspaceId;}
  async #connection(){
    const value=this.#definition.connectionFile?await readResearchConnectionFile(this.#definition.connectionFile):this.#definition;
    const connection=researchConnection(value);
    const expected=this.#definition.expectedWorkspaceId??(this.#definition.directory?researchWorkspaceId(this.#definition.directory):null);
    if(expected&&connection.workspaceId)need(connection.workspaceId===expected,'RESEARCH_WORKSPACE_CHANGED');
    if(this.#workspaceId&&connection.workspaceId)need(connection.workspaceId===this.#workspaceId,'RESEARCH_WORKSPACE_CHANGED');
    return {...connection,workspaceId:expected??this.#workspaceId??connection.workspaceId};
  }
  #run(work){
    need(!this.#closed,'RESEARCH_CLIENT_CLOSED');
    const pending=Promise.resolve().then(work);this.#pending.add(pending);
    return pending.finally(()=>this.#pending.delete(pending));
  }
  async #request(route,{body,method=body===undefined?'GET':'POST',headers={},signal,readOnly=false}={},consume=readResponse){
    const connection=await this.#connection();
    const target=new URL(route,connection.origin);
    need(route.startsWith('/api/')&&target.origin===connection.origin&&['GET','POST'].includes(method),'RESEARCH_ROUTE_INVALID');
    const lifetime=new AbortController(),timeout=AbortSignal.timeout(this.timeoutMs);
    const selectedSignal=AbortSignal.any([lifetime.signal,timeout,...(signal?[signal]:[])]);
    try{
      const response=await this.#fetch(target,{method,redirect:'error',signal:selectedSignal,
        headers:{...headers,Authorization:'Bearer '+connection.token,Origin:connection.origin,Accept:'application/json',
          ...(connection.workspaceId?{'X-Research-Workspace-Id':connection.workspaceId}:{}),
          ...(connection.instanceId?{'X-Research-Instance-Id':connection.instanceId}:{})},
        ...(body===undefined?{}:{body,...(typeof body==='string'||body instanceof Uint8Array?{}:{duplex:'half'})})});
      if(!response.ok){
        let detail={};try{detail=parseJson(await readResponse(response,65536));}catch{}
        throw new BuyerError(safeCode(detail.error,'RESEARCH_HTTP_REJECTED'),{status:response.status,
          ...(detail.openAlexImport?{openAlexImport:detail.openAlexImport}:{})});
      }
      return await consume(response);
    }catch(error){
      if(error instanceof BuyerError){
        if(!Number.isInteger(error.status))Object.assign(error,{outcomeUnknown:method==='POST'&&!readOnly,method,route,
          recovery:method==='POST'&&!readOnly?'Read the original dossier revision or saved source operation before another write.':null});
        throw error;
      }
      const code=safeCode(error.code,'RESEARCH_CONNECTION_INTERRUPTED');
      throw new BuyerError(code,{outcomeUnknown:method==='POST'&&!readOnly,method,route,
        recovery:method==='POST'&&!readOnly?'Read the original dossier revision or saved source operation before another write.':null});
    }finally{
      // A consumer can fail before reading the response (for example a full
      // destination volume). End this request's original transport in every case.
      lifetime.abort();
    }
  }
  #json(route,body,options={}){
    return this.#run(async()=>{
      const bytes=body===undefined?undefined:JSON.stringify(body);
      const maximum=/^\/api\/dossiers\/[^/]+\/source-bundles\/(?:preview|receive)(?:\?projection=metadata)?$/.test(route)
        ?128*1024*1024+65536:96*1024*1024+65536;
      need(bytes===undefined||Buffer.byteLength(bytes)<=maximum,'RESEARCH_REQUEST_TOO_LARGE');
      return this.#request(route,{...options,body:bytes,headers:{...(options.headers??{}),
        ...(bytes===undefined?{}:{'Content-Type':'application/json'})}},async response=>parseJson(await readResponse(response)));
    });
  }
  async status(options={}){
    const status=await this.#json('/api/status',undefined,options);
    need(status.api?.schema===RESEARCH_WORKSPACE_API&&/^research_[a-f0-9]{64}$/.test(status.workspaceId),
      'RESEARCH_WORKSPACE_API_REQUIRED');
    const expected=this.#definition.expectedWorkspaceId??(this.#definition.directory?researchWorkspaceId(this.#definition.directory):null);
    need((!expected||status.workspaceId===expected)&&(!this.#workspaceId||status.workspaceId===this.#workspaceId),
      'RESEARCH_WORKSPACE_CHANGED');
    this.#workspaceId=status.workspaceId;return status;
  }
  list(options={}){return this.#json('/api/dossiers'+parameters(options));}
  metadata(id,{revision}={}){return this.#json(dossierPath(id)+'/metadata'+parameters({revision}));}
  section(id,{section,...options}={}){
    need(typeof section==='string'&&/^[a-z]+$/.test(section),'RESEARCH_SECTION_INVALID');
    return this.#json(dossierPath(id)+'/sections/'+section+parameters(options));
  }
  source(id,{editionId,key,revision}={}){
    return this.#json(sourcePath(id,editionId,key)+parameters({revision}));
  }
  createDossier(input){return this.#json('/api/dossiers?projection=metadata',input);}
  updateDossier(id,input){return this.#json(dossierPath(id)+'?projection=metadata',input);}
  addQuestion(id,input){return this.#json(dossierPath(id)+'/questions?projection=metadata',input);}
  updateQuestion(id,questionId,input){return this.#json(dossierPath(id)+'/questions/'+pathId(questionId)+'?projection=metadata',input);}
  selectEvidence(id,input){return this.#json(dossierPath(id)+'/evidence?projection=metadata',input);}
  updateSelection(id,input){return this.#json(dossierPath(id)+'/selections?projection=metadata',input);}
  addFinding(id,input){return this.#json(dossierPath(id)+'/findings?projection=metadata',input);}
  updateFinding(id,findingId,input){return this.#json(dossierPath(id)+'/findings/'+pathId(findingId)+'?projection=metadata',input);}
  compare(id,{before,after,section='overview',offset,limit}={}){
    return this.#json(dossierPath(id)+'/compare'+parameters({before,after,section,offset,limit}));
  }
  receiveReference(id,input){return this.#json(dossierPath(id)+'/reference?projection=metadata',input);}
  receiveOpenAlex(id,input){return this.#json(dossierPath(id)+'/openalex?projection=metadata',input);}
  receiveResearchBytes(id,{bytes,...input}){
    need(bytes instanceof Uint8Array&&bytes.length<=64*1024*1024,'RESEARCH_RESPONSE_TOO_LARGE');
    const rawText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    return this.#json(dossierPath(id)+'/receive?projection=metadata',{...input,rawText});
  }
  async receiveResearchFile(id,{file,sha256,...input}){
    const bytes=await readResearchHostFile(resolve(file),64*1024*1024,{sha256});
    return this.receiveResearchBytes(id,{...input,bytes});
  }
  previewSourceBundleBytes(id,{bytes,...input}){
    need(bytes instanceof Uint8Array&&bytes.length<=64*1024*1024,'RESEARCH_RESPONSE_TOO_LARGE');
    const rawText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    return this.#json(dossierPath(id)+'/source-bundles/preview',{...input,rawText});
  }
  async previewSourceBundleFile(id,{file,sha256,...input}){
    const bytes=await readResearchHostFile(resolve(file),64*1024*1024,{sha256});
    return this.previewSourceBundleBytes(id,{...input,bytes});
  }
  receiveSourceBundleBytes(id,{bytes,...input}){
    need(bytes instanceof Uint8Array&&bytes.length<=64*1024*1024,'RESEARCH_RESPONSE_TOO_LARGE');
    const rawText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    return this.#json(dossierPath(id)+'/source-bundles/receive?projection=metadata',{...input,rawText});
  }
  async receiveSourceBundleFile(id,{file,sha256,...input}){
    const bytes=await readResearchHostFile(resolve(file),64*1024*1024,{sha256});
    return this.receiveSourceBundleBytes(id,{...input,bytes});
  }
  documents(){
    return createDocumentWorkspaceClient({
      request:(route,body,options)=>this.#json(route,body,options),
      downloadRequest:(route,file,body,options)=>this.#download(route,file,{...options,request:body}),
    });
  }
  pipelines(){
    return createPipelineWorkspaceClient({
      request:(route,body,options)=>this.#json(route,body,options),
      download:(route,file,options)=>this.#download(route,file,options),
      downloadRequest:(route,file,body,options)=>this.#download(route,file,{...options,request:body}),
      prepareFiles:(id,input,options)=>this.#run(()=>sendPipelineFiles({
        inspect:(route,requestOptions)=>this.#request(route,requestOptions,
          async response=>parseJson(await readResponse(response))),
        send:(route,requestOptions)=>this.#request(route,{...requestOptions,method:'POST'},
          async response=>parseJson(await readResponse(response))),
      },id,input,options)),
    });
  }
  clinicalTrials(){
    return createClinicalTrialsClient({
      request:(route,body,options)=>this.#json(route,body,options),
      download:(route,file,options)=>this.#download(route,file,options),
      upload:(route,{file,sha256,signal}={})=>this.#run(async()=>{
        need(typeof file==='string'&&typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256),'CLINICALTRIALS_ORIGINAL_PACKET_REQUIRED');
        const source=await openResearchSource(resolve(file),128*1024*1024,{sha256});
        try{return await this.#request(route+parameters({sha256:source.sha256,bytes:source.bytes}),
          {body:source.stream,method:'POST',signal,headers:{'Content-Type':'application/octet-stream'}},
          async response=>parseJson(await readResponse(response)));}
        finally{await source.close();}
      }),
    });
  }
  openAlexEditions(){return this.#json('/api/openalex/editions');}
  crossrefOperations(id,options={}){return this.#json(dossierPath(id)+'/crossref/operations'+parameters(options));}
  prepareCrossref(id,input){return this.#json(dossierPath(id)+'/crossref/prepare',input);}
  reviewCrossref(id,operationId,{section='overview',offset,limit}={}){return this.#json(operationPath(id,operationId)+parameters({section,offset,limit}));}
  startCrossref(id,operationId,{expectedPlanSha256}={}){return this.#json(operationPath(id,operationId)+'/start',{expectedPlanSha256});}
  stopCrossref(id,operationId){return this.#json(operationPath(id,operationId)+'/stop',{});}
  receiveCrossref(id,operationId,input){return this.#json(operationPath(id,operationId)+'/receive?projection=metadata',input);}

  objectInputs(id,{after,snapshot,limit,...options}={}){
    return this.#json(dossierPath(id)+'/pipelines/objects'+parameters({after,snapshot,limit}),undefined,options);
  }
  objectReviews(id,{after,limit,...options}={}){
    return this.#json(dossierPath(id)+'/pipelines/object-reviews'+parameters({after,limit}),undefined,options);
  }
  reviewObjectInput(id,input,options={}){
    return this.#json(dossierPath(id)+'/pipelines/objects/review',input,options);
  }
  prepareObjectPipeline(id,input,options={}){
    return this.#json(dossierPath(id)+'/pipelines/objects/prepare',input,options);
  }
  pipelineOperations(id,{after,limit,...options}={}){
    return this.#json(dossierPath(id)+'/pipelines'+parameters({after,limit}),undefined,options);
  }
  pipelineOperation(id,operationId,options={}){
    return this.#json(dossierPath(id)+'/pipelines/operations/'+pathId(operationId),undefined,options);
  }

  async #download(route,file,{signal,expectedSha256,request}={}){
    const body=request===undefined?undefined:JSON.stringify(request);
    need(body===undefined||Buffer.byteLength(body)<=RESEARCH_CONTROL_LIMIT,'RESEARCH_REQUEST_TOO_LARGE');
    return this.#run(()=>this.#request(route,{signal,readOnly:true,...(body===undefined?{}:{
      body,method:'POST',headers:{'Content-Type':'application/json'}
    })},async response=>{
      const disposition=response.headers.get('content-disposition')??'';
      const filename=disposition.match(/^attachment; filename="([A-Za-z0-9][A-Za-z0-9._-]{0,179})"$/)?.[1]??'research.json';
      const contentType=response.headers.get('content-type')??'application/octet-stream';
      const declared=response.headers.get('content-length');let count=0;
      if(declared!==null)need(/^[0-9]+$/.test(declared)&&Number(declared)<=PORTABLE_LIMIT,'RESEARCH_DOWNLOAD_SIZE_INVALID');
      const body=Readable.from((async function*(){
        for await(const chunk of response.body??[]){
          count+=chunk.length;need(count<=PORTABLE_LIMIT,'RESEARCH_DOWNLOAD_TOO_LARGE');yield chunk;
        }
        need(declared===null||Number(declared)===count,'RESEARCH_DOWNLOAD_INCOMPLETE');
      })());
      let result;
      try{result=await writePortableFile(resolve(file),{body,filename,contentType});}
      finally{
        body.destroy();
        if(typeof response.body?.cancel==='function'&&!response.body.locked)
          await response.body.cancel().catch(()=>{});
        else if(typeof response.body?.destroy==='function')response.body.destroy();
      }
      const revision=response.headers.get('x-research-dossier-revision');
      const editionId=response.headers.get('x-research-edition-id'),occurrenceId=response.headers.get('x-research-occurrence-id');
      const saved={...result,...(revision&&/^[0-9]+$/.test(revision)?{revision:Number(revision)}:{}),
        ...(editionId&&/^e_[a-f0-9]{64}$/.test(editionId)?{editionId}:{}),
        ...(occurrenceId&&/^o_[a-f0-9]{64}$/.test(occurrenceId)?{occurrenceId}:{})};
      // Preserve complete file and original source identity on a checksum error.
      if(expectedSha256!==undefined&&saved.sha256!==expectedSha256)
        throw new BuyerError('RESEARCH_EXPORTED_FILE_CHANGED',{file:saved,destinationPublished:true});
      return saved;
    }));
  }
  exportDossier(id,{format='json.gz',file,...options}={}){
    need(['json','json.gz','md','html'].includes(format),'EXPORT_FORMAT_INVALID');
    return this.#download(dossierPath(id)+'/export'+parameters({format}),file,options);
  }
  exportCrossrefEdition(id,operationId,{file,...options}={}){
    return this.#download(operationPath(id,operationId)+'/edition',file,options);
  }
  exportRetainedEdition(id,editionId,{file,revision,...options}={}){
    return this.#download(dossierPath(id)+'/retained-editions/'+pathId(editionId)+parameters({revision}),file,options);
  }
  exportSource(id,{editionId,key,revision,part='content',file,expectedSha256,...options}={}){
    need(['content','record'].includes(part),'RESEARCH_SOURCE_PART_INVALID');
    return this.#download(sourcePath(id,editionId,key)+'/'+part+parameters({revision,sha256:expectedSha256}),
      file,{...options,expectedSha256});
  }
  exportSourceFile(id,{editionId,key,revision,name,expectedSha256,file,...options}={}){
    need(typeof name==='string'&&name.length>0&&name.length<=1024&&
      typeof expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedSha256),'RESEARCH_SOURCE_FILE_SELECTION_REQUIRED');
    return this.#download(sourcePath(id,editionId,key)+'/file'+parameters({revision,name,sha256:expectedSha256}),
      file,{...options,expectedSha256});
  }
  exportComparison(id,{before,after,file,...options}={}){
    return this.#download(dossierPath(id)+'/compare'+parameters({before,after}),file,options);
  }
  reopenFile(file,{signal,expectedSha256}={}){
    return this.#run(async()=>{
      const source=await openResearchSource(resolve(file),PORTABLE_LIMIT,{sha256:expectedSha256});
      try{return await this.#request('/api/reopen-stream?projection=metadata',
        {body:source.stream,method:'POST',signal,headers:{'Content-Type':'application/octet-stream'}},
        async response=>({dossier:parseJson(await readResponse(response)),
          source:{bytes:source.bytes,sha256:source.sha256}}));}
      finally{await source.close();}
    });
  }
  close(){
    if(!this.#closing){
      this.#closed=true;
      this.#closing=Promise.allSettled([...this.#pending]).then(()=>({state:'DETACHED',workspaceId:this.#workspaceId}));
    }
    return this.#closing;
  }
}
export {researchSummary};
