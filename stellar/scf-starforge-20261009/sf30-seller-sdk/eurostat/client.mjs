// MIT. Installed local HTTP client for the original Eurostat project.
export class EurostatClientError extends Error {
  constructor(status,value){super(value?.message??value?.error??'Eurostat request failed');this.name='EurostatClientError';
    this.code=value?.error??'EUROSTAT_HTTP';this.status=status;this.result=value;}
}
export function createEurostatClient({origin,fetchImpl=fetch,signal}={}){
  const u=new URL(origin);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')
    throw new TypeError('Use the original local Eurostat listener origin.');
  const request=async(method,path,value)=>{
    const response=await fetchImpl(new URL(path,u),{method,signal,redirect:'error',
      ...(value===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(value)})});
    const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw new EurostatClientError(response.status,{error:'EUROSTAT_RESPONSE_INVALID'});}
    if(!response.ok)throw new EurostatClientError(response.status,result);return result;
  };
  const get=(path,input={})=>{const q=new URLSearchParams();for(const[k,v]of Object.entries(input))if(v!==undefined)q.set(k,typeof v==='object'?JSON.stringify(v):String(v));
    return request('GET',path+(q.size?'?'+q:''));};
  const post=(path,input)=>request('POST',path,input);
  const euro='/api/eurostat/';
  return Object.freeze({
    origin:u.origin,status:()=>get(euro+'status'),source:()=>get('/api/source'),
    capture:id=>get(euro+'capture',{id}),briefing:(id,query)=>get(euro+'briefing',{id,query}),cells:(id,options={})=>get(euro+'cells',{id,...options}),
    compare:(before,after,options={})=>get(euro+'compare',{before,after,...options}),
    acquire:input=>post(euro+'acquire',input),acquisition:id=>get(euro+'acquisition',{id}),
    importCapture:input=>post(euro+'import',input),saveQuery:input=>post(euro+'query',input),
    planTemplate:input=>post(euro+'plan-template',input),exportSources:()=>get(euro+'handover'),
    importSources:packet=>post(euro+'handover',packet),savePlan:input=>post('/api/plans',input),
    extract:plan=>post('/api/extract',{plan}),inspect:(id,query='')=>get('/api/run',{id,query}),
    cancel:id=>post('/api/cancel',{id}),review:(id,input)=>post('/api/review',{id,...input}),
    publish:(id,reviewId)=>post('/api/publish',{id,reviewId}),recover:id=>post('/api/recover',{id}),
    buyerOffer:(id,query='')=>get('/api/buyer',{id,query}),prepareBuyer:(id,input)=>post('/api/buyer',{id,...input}),
    prepareRelease:input=>post(euro+'release-prepare',input),stageRelease:input=>post(euro+'release-stage',input),
    activateRelease:input=>post(euro+'release-activate',input),
    async originalResponse(id){
      const response=await fetchImpl(new URL(euro+'response?'+new URLSearchParams({id}),u),{signal,redirect:'error'});
      const data=new Uint8Array(await response.arrayBuffer());if(!response.ok)throw new EurostatClientError(response.status,{error:'EUROSTAT_SOURCE_READ'});
      return data;
    }
  });
}
