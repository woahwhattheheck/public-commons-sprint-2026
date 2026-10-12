// MIT. The original workbook API through its Research session or owned client transport.
const required=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const queryString=query=>{
  const values=new URLSearchParams();
  for(const [name,value] of Object.entries(query??{}))if(value!==undefined&&value!==null)values.set(name,String(value));
  return values.size?'?'+values.toString():'';
};
const identifier=value=>{
  required(typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f/\\]/.test(value),'TEMPLATE_DOSSIER_REQUIRED');
  return encodeURIComponent(value);
};
const blobId=value=>{required(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'TEMPLATE_BLOB_ID_INVALID');return value;};
export function createTemplateExchangeClient({baseUrl,dossierId,fetch:fetcher=globalThis.fetch,headers={},
  request:transport,readBlob,download}={}){
  // The browser may show its missing-dossier message before making a request.
  const path=()=>'/api/research/dossiers/'+identifier(dossierId)+'/template-exchange';
  const root=transport?null:new URL(baseUrl);
  required(transport===undefined||typeof transport==='function','TEMPLATE_REQUEST_TRANSPORT_REQUIRED');
  required(transport||typeof fetcher==='function','TEMPLATE_FETCH_REQUIRED');
  const route=(action,query)=>path()+(action?'/'+action:'')+queryString(query);
  async function request(action='',{method='GET',query={},body,signal}={}){
    const target=route(action,query);
    if(transport){
      if(action.startsWith('blobs/')){
        required(typeof readBlob==='function','TEMPLATE_BLOB_TRANSPORT_REQUIRED');
        return readBlob(target,{signal});
      }
      return transport(target,body,{method,signal});
    }
    try{
      const response=await fetcher(new URL(target,root),{method,credentials:'same-origin',redirect:'error',signal,
        headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(!response.ok){
        let data;try{data=await response.json();}catch{}
        const candidate=typeof data?.error==='string'?data.error:data?.error?.code??data?.code;
        const code=typeof candidate==='string'&&/^[A-Z0-9_]{1,100}$/.test(candidate)?candidate:'TEMPLATE_HTTP_'+response.status;
        throw Object.assign(new Error(code),{code,status:response.status,
          outcomeUnknown:method==='POST'&&response.status>=500});
      }
      return action.startsWith('blobs/')?new Uint8Array(await response.arrayBuffer()):await response.json();
    }catch(cause){
      const error=cause instanceof Error?cause:new Error(String(cause));
      if(error.outcomeUnknown===undefined)error.outcomeUnknown=method==='POST';
      error.method=method;error.route=target;
      if(error.outcomeUnknown)error.recovery='Read the original saved operation and retry the same retained request before creating another request.';
      throw error;
    }
  }
  const get=(action,query,options={})=>request(action,{query,signal:options.signal});
  const post=(action,body,options={})=>request(action,{method:'POST',body,signal:options.signal});
  return {
    page:(query={},options={})=>get('',query,options),
    record:(query,options={})=>get('record',query,options),
    publication:(query,options={})=>get('publication',query,options),
    operation:(query,options={})=>get('operation',query,options),
    stageTemplate:(body,options={})=>post('stage-template',body,options),
    stageMapping:(body,options={})=>post('stage-mapping',body,options),
    stageRelease:(body,options={})=>post('stage-release',body,options),
    stageReturn:(body,options={})=>post('stage-return',body,options),
    stageReturnReview:(body,options={})=>post('stage-return-review',body,options),
    review:(body,options={})=>post('review',body,options),
    prepareExtractionDraft:(body,options={})=>post('prepare-extraction-draft',body,options),
    acceptExtractionDraft:(body,options={})=>post('accept-extraction-draft',body,options),
    blob:(sha256,query={},options={})=>get('blobs/'+blobId(sha256),query,options),
    download:(sha256,file,query={},options={})=>{
      required(typeof download==='function','TEMPLATE_FILE_TRANSPORT_REQUIRED');
      return download(route('blobs/'+blobId(sha256),query),file,{signal:options.signal,expectedSha256:sha256});
    },
  };
}
