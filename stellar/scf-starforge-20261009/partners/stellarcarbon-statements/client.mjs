// MIT. Browser and Node client for the complete local statements desk.
const query=value=>{const params=new URLSearchParams();for(const [key,item] of Object.entries(value||{}))if(item!==undefined&&item!==null&&item!=='')params.set(key,String(item));return params.size?'?'+params:'';};
export class StellarcarbonClient{
  constructor({baseUrl='/api',workspaceId,fetch:fetchImpl=globalThis.fetch}={}){this.baseUrl=baseUrl.replace(/\/$/,'');this.workspaceId=workspaceId;this.fetch=fetchImpl;}
  async request(path,{method='GET',body}={}){
    const response=await this.fetch(this.baseUrl+path,{method,headers:body?{'Content-Type':'application/json','X-Stellarcarbon-Workspace':this.workspaceId}:undefined,body:body?JSON.stringify(body):undefined});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(value.error?.message||'The workspace request failed.'),{code:value.error?.code,status:response.status});
    if(path.split('?')[0]==='/state'&&value.workspaceId)this.workspaceId=value.workspaceId;return value;
  }
  state(){return this.request('/state');}
  contributions(value){return this.request('/contributions'+query(value));}
  contribution(hash,value){return this.request('/contributions/'+encodeURIComponent(hash)+query(value));}
  retirements(value){return this.request('/retirements'+query(value));}
  retirement(certificate,value){return this.request('/retirements/'+encodeURIComponent(certificate)+query(value));}
  edition(id){return this.request('/editions/'+encodeURIComponent(id));}
  table(id,table,value){return this.request('/editions/'+encodeURIComponent(id)+'/tables/'+encodeURIComponent(table)+query(value));}
  apply(action,value,options){return this.request('/operations/'+encodeURIComponent(action),{method:'POST',body:{value,...options}});}
  import(files,metadata,label,options){return this.request('/import',{method:'POST',body:{files,metadata,label,...options}});}
  capture(value,label,options){return this.request('/capture',{method:'POST',body:{value,label,...options}});}
  captureStatus(){return this.request('/capture');}
  preview(value,options){return this.request('/preview',{method:'POST',body:{value,...options}});}
  statement(id,version){return this.request('/statements/'+encodeURIComponent(id)+query({version}));}
  compare(beforeId,afterId){return this.request('/compare'+query({beforeId,afterId}));}
  invoice(statementId,value,options){return this.request('/statements/'+encodeURIComponent(statementId)+'/invoice',{method:'POST',body:{value,...options}});}
  statementFileUrl(id,version,name){return this.baseUrl+'/statements/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(name)+query({version});}
  receive(directory,handover,options){return this.request('/receive',{method:'POST',body:{directory,handover,...options}});}
  handoverUrl(){return this.baseUrl+'/handover';}
}
