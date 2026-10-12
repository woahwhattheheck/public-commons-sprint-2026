// MIT. Typed-shape client on the original Research session; no new credentials.
export function createTemplateExchangeClient({baseUrl,dossierId,fetch:fetcher=globalThis.fetch,headers={}}){
  const root=new URL(baseUrl);const path='/api/research/dossiers/'+encodeURIComponent(dossierId)+'/template-exchange';
  async function request(action='',{method='GET',query={},body,signal}={}){
    const url=new URL(path+(action?'/'+action:''),root);
    for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
    const response=await fetcher(url,{method,credentials:'same-origin',signal,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(!response.ok){
      let data;try{data=await response.json();}catch{}
      const code=(typeof data?.error==='string'?data.error:data?.error?.code)??data?.code??'TEMPLATE_HTTP_'+response.status;
      throw Object.assign(new Error(data?.error?.message??code),{code,status:response.status});
    }
    return action.startsWith('blobs/')?new Uint8Array(await response.arrayBuffer()):response.json();
  }
  return {page:(query={},options={})=>request('',{query,...options}),
    record:(query,options={})=>request('record',{query,...options}),
    publication:(query,options={})=>request('publication',{query,...options}),
    operation:(query,options={})=>request('operation',{query,...options}),
    stageTemplate:(body,options={})=>request('stage-template',{method:'POST',body,...options}),
    stageMapping:(body,options={})=>request('stage-mapping',{method:'POST',body,...options}),
    stageRelease:(body,options={})=>request('stage-release',{method:'POST',body,...options}),
    stageReturn:(body,options={})=>request('stage-return',{method:'POST',body,...options}),
    stageReturnReview:(body,options={})=>request('stage-return-review',{method:'POST',body,...options}),
    review:(body,options={})=>request('review',{method:'POST',body,...options}),
    prepareExtractionDraft:(body,options={})=>request('prepare-extraction-draft',{method:'POST',body,...options}),
    acceptExtractionDraft:(body,options={})=>request('accept-extraction-draft',{method:'POST',body,...options}),
    blob:(sha256,query={},options={})=>request('blobs/'+sha256,{query,...options})};
}
