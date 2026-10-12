// MIT. Complete Documents and managed Pipelines on the original Research HTTP client.
import {basename,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {BuyerError,need,object} from '../node/store.mjs';
import {openResearchSource} from './workspace-files.mjs';

const pathId=value=>{
  need(typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f/\\]/.test(value),
    'RESEARCH_ID_INVALID');return encodeURIComponent(value);
};
const path=(id,family)=>'/api/dossiers/'+pathId(id)+'/'+family;
const query=value=>{
  const parameters=new URLSearchParams();
  for(const[key,item]of Object.entries(value??{}))if(item!==undefined&&item!==null)parameters.set(key,String(item));
  return parameters.size?'?'+parameters.toString():'';
};
const digest=value=>need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'RESEARCH_ORIGINAL_FILE_DIGEST_REQUIRED');
const text=(value,maximum)=>typeof value==='string'&&value.trim().length>0&&Buffer.byteLength(value)<=maximum&&
  !/[\u0000-\u001f\u007f]/.test(value);
const fields=(value,keys,code)=>{
  need(object(value)&&Object.keys(value).every(key=>keys.includes(key)),code);return value;
};
const select=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const operation=(id,operationId)=>{
  need(/^up_[a-f0-9]{64}$/.test(operationId??''),'PIPELINE_OPERATION_ID_INVALID');
  return path(id,'pipelines/operations/')+operationId;
};
const controls=['requestId','profileId','questionId','label','expectedRevision'];
const readonly={readOnly:true};

/** Uses the same retained purchase/edition readers as the Documents browser pane. */
export function createDocumentWorkspaceClient({request,downloadRequest}){
  return Object.freeze({
    list:(id,{after,limit,...options}={})=>request(path(id,'unstructured')+query({after,limit}),undefined,options),
    review:(id,selection,options={})=>request(path(id,'unstructured/review'),{selection},{...options,...readonly}),
    elements:(id,input,options={})=>request(path(id,'unstructured/elements'),input,{...options,...readonly}),
    receive:(id,input,options={})=>request(path(id,'unstructured/receive')+'?projection=metadata',input,options),
    download:(id,{selection,expectedEditionSha256,kind,file,...options}={})=>{
      need(['document','response','edition'].includes(kind),'UNSTRUCTURED_DOWNLOAD_SELECTION_INVALID');
      return downloadRequest(path(id,'unstructured/download'),file,
        {selection,expectedEditionSha256,file:kind},options);
    },
  });
}

/** Uses original saved operation IDs and native action request/revision contracts. */
export function createPipelineWorkspaceClient({request,download,downloadRequest,prepareFiles}){
  return Object.freeze({
    list:(id,{after,limit,...options}={})=>request(path(id,'pipelines')+query({after,limit}),undefined,options),
    operation:(id,operationId,options={})=>request(operation(id,operationId),undefined,options),
    prepareFiles:(id,input,options={})=>prepareFiles(id,input,options),
    submit:(id,operationId,input,options={})=>request(operation(id,operationId)+'/submit',input,options),
    refresh:(id,operationId,input,options={})=>request(operation(id,operationId)+'/refresh',input,options),
    cancel:(id,operationId,input,options={})=>request(operation(id,operationId)+'/cancel',input,options),
    providerJobs:(id,operationId,input={},options={})=>request(operation(id,operationId)+'/provider-jobs',input,{...options,...readonly}),
    reconcile:(id,operationId,input,options={})=>request(operation(id,operationId)+'/reconcile',input,options),
    retainOutput:(id,operationId,input,options={})=>request(operation(id,operationId)+'/retain',input,options),
    review:(id,selection,options={})=>request(path(id,'pipelines/review'),{selection},{...options,...readonly}),
    elements:(id,input,options={})=>request(path(id,'pipelines/elements'),input,{...options,...readonly}),
    receive:(id,input,options={})=>request(path(id,'pipelines/receive')+'?projection=metadata',input,options),
    downloadInput:(id,operationId,inputId,{file,...options}={})=>{
      need(/^in_[a-f0-9]{64}$/.test(inputId??''),'PIPELINE_INPUT_ID_INVALID');
      return download(operation(id,operationId)+'/inputs/'+inputId,file,options);
    },
    downloadOutput:(id,operationId,outputId,{file,...options}={})=>{
      need(/^out_[a-f0-9]{64}$/.test(outputId??''),'PIPELINE_OUTPUT_ID_INVALID');
      return download(operation(id,operationId)+'/outputs/'+outputId,file,options);
    },
    downloadReceived:(id,{selection,expectedEditionSha256,kind,file,...options}={})=>{
      need(['output','edition'].includes(kind),'PIPELINE_DOWNLOAD_SELECTION_INVALID');
      return downloadRequest(path(id,'pipelines/download'),file,
        {selection,expectedEditionSha256,file:kind},options);
    },
  });
}

/**
 * Verify all selected host files before sending. Stream canonical base64 from each
 * SAME verified descriptor into the existing JSON prepare route. The native file
 * reader checks its second complete digest and file stamp before the final JSON
 * suffix is emitted, so a changed source cannot become a complete prepare body.
 * The caller owns the original Research client pending-operation scope.
 */
export async function sendPipelineFiles({inspect,send},id,input,{signal}={}){
  fields(input,[...controls,'files'],'PIPELINE_PREPARATION_FIELDS_INVALID');
  need(text(input.requestId,256)&&text(input.profileId,128)&&text(input.questionId,160)&&text(input.label,240),
    'PIPELINE_PREPARATION_SELECTION_REQUIRED');
  need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1,'EXPECTED_REVISION_REQUIRED');
  need(Array.isArray(input.files)&&input.files.length>0&&input.files.length<=32,'PIPELINE_INPUT_SELECTION_REQUIRED');
  const sourceView=await inspect(path(id,'pipelines')+'?limit=1',{signal}),limits=sourceView.source?.limits;
  need(sourceView.configured===true&&object(limits),'PIPELINE_SOURCE_NOT_CONFIGURED');
  for(const key of ['maxInputs','maxInputBytes','maxTotalInputBytes'])
    need(Number.isSafeInteger(limits[key])&&limits[key]>0,'PIPELINE_SOURCE_LIMITS_INVALID');
  need(Number.isSafeInteger(sourceView.uploadLimitBytes)&&sourceView.uploadLimitBytes>0&&
    input.files.length<=limits.maxInputs,'PIPELINE_INPUT_SELECTION_REQUIRED');
  const maximum=Math.min(sourceView.uploadLimitBytes,limits.maxTotalInputBytes);
  const originals=[];let body,result,failure;
  try{
    let total=0;
    for(const item of input.files){
      fields(item,['file','sha256','filename','contentType'],'PIPELINE_INPUT_FIELDS_INVALID');
      need(typeof item.file==='string'&&item.file.length>0,'RESEARCH_ORIGINAL_FILE_REQUIRED');digest(item.sha256);
      const filename=item.filename??basename(item.file),contentType=item.contentType??'application/octet-stream';
      need(text(filename,1024)&&!/[\\/]/.test(filename)&&text(contentType,256),'PIPELINE_INPUT_METADATA_INVALID');
      const source=await openResearchSource(resolve(item.file),Math.min(maximum,limits.maxInputBytes),{sha256:item.sha256});
      originals.push({filename,contentType,source});
      total+=source.bytes;need(total<=maximum,'PIPELINE_UPLOAD_TOO_LARGE');
    }
    const metadata=JSON.stringify(select(input,controls));
    const start=metadata.slice(0,-1)+',"inputs":[',end=']}';
    const prefixes=originals.map((item,index)=>(index?',':'')+
      JSON.stringify({filename:item.filename,contentType:item.contentType}).slice(0,-1)+',"base64":"');
    const close='"}';
    const contentLength=Buffer.byteLength(start)+Buffer.byteLength(end)+
      originals.reduce((size,item,index)=>size+Buffer.byteLength(prefixes[index])+Math.ceil(item.source.bytes/3)*4+close.length,0);
    const payload=(async function*(){
      yield Buffer.from(start);
      for(let index=0;index<originals.length;index++){
        yield Buffer.from(prefixes[index]);let carry=Buffer.alloc(0);
        for await(const chunk of originals[index].source.stream){
          const bytes=carry.length?Buffer.concat([carry,chunk]):chunk;
          const boundary=bytes.length-bytes.length%3;
          if(boundary)yield Buffer.from(bytes.subarray(0,boundary).toString('base64'));
          carry=boundary===bytes.length?Buffer.alloc(0):Buffer.from(bytes.subarray(boundary));
        }
        if(carry.length)yield Buffer.from(carry.toString('base64'));
        yield Buffer.from(close);
      }
      yield Buffer.from(end);
    })();
    body=Readable.from(payload);
    result=await send(path(id,'pipelines/prepare'),{
      body,signal,headers:{'Content-Type':'application/json','Content-Length':String(contentLength)},
    });
    const received=result?.plan?.payload?.inputs;
    if(result?.plan?.payload?.request?.requestId!==input.requestId||!Array.isArray(received)||
      received.length!==originals.length||originals.some((item,index)=>received[index]?.filename!==item.filename||
        received[index]?.contentType!==item.contentType||received[index]?.bytes!==item.source.bytes||
        received[index]?.sha256!==item.source.sha256)){
      throw new BuyerError('PIPELINE_PREPARATION_SOURCE_CHANGED',{outcomeUnknown:true,
        requestId:input.requestId,operationId:result?.plan?.id,
        recovery:'Inspect the original saved pipeline request before preparing another operation.'});
    }
  }catch(error){
    failure=error;
    if(error.outcomeUnknown&&error.requestId===undefined)error.requestId=input.requestId;
  }finally{
    body?.destroy();
    const closed=await Promise.allSettled(originals.map(item=>item.source.close()));
    if(closed.some(item=>item.status==='rejected')){
      if(failure)failure.sourceCleanupFailed=true;
      else result={...result,clientWarnings:[...(result.clientWarnings??[]),
        {code:'RESEARCH_SOURCE_CLOSE_FAILED',requestId:input.requestId,operationId:result.plan?.id}]};
    }
  }
  if(failure)throw failure;
  return result;
}
