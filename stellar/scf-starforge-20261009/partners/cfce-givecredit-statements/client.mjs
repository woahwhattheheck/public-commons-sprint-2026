// MIT. Native HTTP client; a received workspace gets its own client identity.
export class GiveCreditClient{
  constructor(baseUrl,{fetchImpl=globalThis.fetch,workspaceId,actor='Local operator'}={}){
    this.baseUrl=new URL(baseUrl||globalThis.location?.origin);this.fetchImpl=fetchImpl;this.workspaceId=workspaceId;this.actor=actor;
  }
  url(path,query={}){
    const url=new URL('/api/'+path.replace(/^\/+/,''),this.baseUrl);
    for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));
    return url.href;
  }
  async request(path,{query,body,method=body===undefined?'GET':'POST'}={}){
    const headers={Accept:'application/json'};
    if(body!==undefined){headers['Content-Type']='application/json';if(this.workspaceId)headers['X-GiveCredit-Workspace']=this.workspaceId;}
    const response=await this.fetchImpl(this.url(path,query),{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    let value;try{value=await response.json();}catch{throw new Error('The native workspace returned an incomplete response.');}
    if(!response.ok){const error=new Error(value?.error?.message||'Workspace request failed.');error.code=value?.error?.code;error.status=response.status;throw error;}
    if(path==='state'&&value.workspaceId)this.workspaceId=value.workspaceId;
    return value;
  }
  options(value={}){return {requestId:value.requestId||globalThis.crypto.randomUUID(),actor:value.actor||this.actor,revision:value.revision};}
  state(){return this.request('state');}
  choices(query){return this.request('choices',{query});}
  donations(query){return this.request('donations',{query});}
  donation(id,query){return this.request('donations/'+encodeURIComponent(id),{query});}
  transfers(query){return this.request('transfers',{query});}
  transfer(key,query){return this.request('transfers/'+encodeURIComponent(key),{query});}
  pools(query){return this.request('pools',{query});}
  edition(id){return this.request('editions/'+encodeURIComponent(id));}
  table(id,table,query){return this.request('editions/'+encodeURIComponent(id)+'/tables/'+encodeURIComponent(table),{query});}
  preview(kind,value){return this.request('preview/'+kind,{body:{value}});}
  apply(action,value,options){return this.request('operations/'+action,{body:{value,...this.options(options)}});}
  import(value,options){return this.request('import',{body:{...value,...this.options(options)}});}
  receive(directory,handover){return this.request('receive',{body:{directory,handover}});}
  capture(kind,value,label,options){return this.request('capture/'+kind,{body:{value,label,...this.options(options)}});}
  stopCapture(kind){return this.request('capture/'+kind+'/stop',{body:{}});}
  captureStatus(kind){return this.request('capture/'+kind);}
  importCheckpoint(kind,source,options){return this.request('capture/'+kind+'/checkpoint',{body:{source,...this.options(options)}});}
  checkpointURL(kind){return this.url('capture/'+kind+'/checkpoint');}
  statement(id,version){return this.request('statements/'+encodeURIComponent(id),{query:{version}});}
  compare(beforeId,afterId){return this.request('compare',{query:{beforeId,afterId}});}
  statementFileURL(id,filename,version){return this.url('statements/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(filename),{version});}
  handoverURL(){return this.url('handover');}
  sourceURL(id){return this.url('editions/'+encodeURIComponent(id)+'/source');}
  sourceFileURL(id,index){return this.url('editions/'+encodeURIComponent(id)+'/files/'+index);}
}
