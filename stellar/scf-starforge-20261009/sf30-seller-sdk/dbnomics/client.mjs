// MIT. Typed local client for the original DBnomics workbench and native publisher.
export class DbnomicsClientError extends Error{
  constructor(status,value){super(value?.message??value?.error??'DBnomics request failed.');this.name='DbnomicsClientError';this.code=value?.error??'DBNOMICS_HTTP';this.status=status;this.result=value;}
}
export function createDbnomicsClient({origin,fetchImpl=fetch,signal}={}){
  const root=new URL(origin);
  if(root.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(root.hostname)||root.username||root.password||root.search||root.hash||root.pathname!=='/')
    throw new TypeError('Use the printed original local DBnomics listener origin.');
  async function request(method,path,value){
    const response=await fetchImpl(new URL(path,root),{method,signal,redirect:'error',
      ...(value===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(value)})});
    const body=await response.text();let result;try{result=JSON.parse(body);}catch{throw new DbnomicsClientError(response.status,{error:'DBNOMICS_RESPONSE_INVALID'});}
    if(!response.ok)throw new DbnomicsClientError(response.status,result);return result;
  }
  const get=(path,input={})=>{const query=new URLSearchParams();for(const[key,value]of Object.entries(input))if(value!==undefined&&value!==null)query.set(key,String(value));
    return request('GET',path+(query.size?'?'+query:''));};
  const post=(path,input)=>request('POST',path,input),prefix='/api/dbnomics/';
  async function file(route,input){
    const query=new URLSearchParams();for(const[key,value]of Object.entries(input))if(value!==undefined)query.set(key,String(value));
    const response=await fetchImpl(new URL(prefix+route+'?'+query,root),{signal,redirect:'error'}),bytes=new Uint8Array(await response.arrayBuffer());
    if(!response.ok){let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{value={error:'DBNOMICS_FILE_READ'};}throw new DbnomicsClientError(response.status,value);}
    return {bytes,mediaType:response.headers.get('content-type'),contentDisposition:response.headers.get('content-disposition')};
  }
  return Object.freeze({
    origin:root.origin,status:()=>get(prefix+'status'),operation:id=>get(prefix+'operation',{id}),source:()=>get('/api/source'),
    discover:input=>post(prefix+'discover',input),acquire:input=>post(prefix+'acquire',input),refresh:input=>post(prefix+'refresh',input),
    importExample:id=>post(prefix+'seed',{id}),importCapture:input=>post(prefix+'import',input),
    capture:id=>get(prefix+'capture',{id}),observations:(id,options={})=>get(prefix+'observations',{id,...options}),
    facets:(id,options={})=>get(prefix+'facets',{id,...options}),compare:(before,after,options={})=>get(prefix+'compare',{before,after,...options}),
    notes:(id,revision)=>get(prefix+'notes',{id,revision}),saveNotes:input=>post(prefix+'notes',input),
    report:(id,options={})=>get(prefix+'report',{id,...options}),saveReport:input=>post(prefix+'report',input),
    reportFile:(id,format='json')=>file('report-export',{id,format}),captureFile:id=>file('capture-export',{id}),
    originalResponse:(id,index=0)=>file('original',{id,index}),exportSources:()=>get(prefix+'source-export'),importSources:input=>post(prefix+'source-import',input),
    saveQuery:input=>post(prefix+'query',input),planTemplate:name=>post(prefix+'plan-template',{name}),
    savePublicationPlan:input=>post(prefix+'publication-plan',input),extract:input=>post(prefix+'extract',input),
    inspect:(id,query='')=>get('/api/run',{id,query}),cancel:id=>post('/api/cancel',{id}),review:(id,input)=>post('/api/review',{id,...input}),
    publish:(id,reviewId)=>post('/api/publish',{id,reviewId}),recover:id=>post('/api/recover',{id}),
    buyerOffer:(id,query='')=>get('/api/buyer',{id,query}),prepareBuyer:(id,input)=>post('/api/buyer',{id,...input}),
    prepareRelease:input=>post(prefix+'release-prepare',input),stageRelease:input=>post(prefix+'release-stage',input),
    activateRelease:input=>post(prefix+'release-activate',input)
  });
}
