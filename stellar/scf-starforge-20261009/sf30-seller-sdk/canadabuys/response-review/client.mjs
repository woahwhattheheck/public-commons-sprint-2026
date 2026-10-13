// MIT. Same-origin response review client delegates transport to CanadaBuysClient.
import { CanadaBuysClient } from '../client.mjs';
export class CanadaBuysResponseReviewClient {
 constructor(origin,options){this.client=origin instanceof CanadaBuysClient?origin:new CanadaBuysClient(origin,options);}
 status(options){return this.client.request('/api/response-review/status',options);}
 record(id,{revision,...options}={}){return this.client.request('/api/response-review/records/'+encodeURIComponent(id)+(revision===undefined?'':'?revision='+revision),options);}
 prepare(input,options){return this.client.request('/api/response-review/prepare',{...options,method:'POST',body:input});}
 export(id,{revision,...options}={}){return this.client.request('/api/response-review/records/'+encodeURIComponent(id)+'/export'+(revision===undefined?'':'?revision='+revision),options);}
 editor(id,{revision,...options}={}){return this.client.request('/api/response-review/records/'+encodeURIComponent(id)+'/editor'+(revision===undefined?'':'?revision='+revision),{...options,raw:true});}
 markdown(id,{revision,...options}={}){return this.client.request('/api/response-review/records/'+encodeURIComponent(id)+'/markdown'+(revision===undefined?'':'?revision='+revision),{...options,raw:true});}
 compare(input,options){return this.client.request('/api/response-review/compare',{...options,method:'POST',body:input});}
 apply(input,options){return this.client.request('/api/response-review/apply',{...options,method:'POST',body:input});}
}
