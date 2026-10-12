// MIT. Paid page handlers share the original OData parser and SF30 supplier runtime.
import { createUpstreamHandlers,closeUpstreamHandlers } from '../../upstream.mjs';
import { parsePage } from '../source.mjs';
import { prepareProduct,runtimeEnvironment } from './config.mjs';
import { buildQuery,cursorCodec,wireFromUrl,nextUrl,operationFor,plain,projectRows,validatePage,PAGE_SCHEMA,integer } from './contract.mjs';
const failure=(status,error)=>({status,headers:{'content-type':'application/json; charset=utf-8'},body:{error}});
export function createODataApplication(input,catalog,{cursorKey,env=process.env,allowLoopback=false,lookup}={}) {
  const prepared=prepareProduct(input,catalog,{allowLoopback}),{plan}=prepared;
  catalog=prepared.catalog;
  const codec=cursorCodec(cursorKey,prepared.sourceBinding,plan.limits.cursorLifetimeSeconds);
  const originals=createUpstreamHandlers(prepared.upstreams,{env:runtimeEnvironment(env),allowLoopback,...(lookup?{lookup}:{})});
  const handlers={},totals={supplierReads:0,deliveredPages:0,deliveredRows:0,rejectedResponses:0},active=new Set();
  let closed=false,closing;
  function request(id,context) {
    if (closed) throw new TypeError('OData merchant is closing');
    if (context?.method!=='POST'||!plain(context.body)||context.url?.search||Object.keys(context.query??{}).length)
      throw new TypeError('Send a JSON OData query object');
    if (Object.hasOwn(context.body,'cursor')) {
      if (Object.keys(context.body).length!==1) throw new TypeError('A continuation is the sole next-page input');
      const saved=codec.decode(context.body.cursor);
      if (saved.operation!==id||!plain(saved.query)||typeof saved.url!=='string') throw new TypeError('Continuation product mismatch');
      const selected=buildQuery(plan,catalog,id,saved.query),{operation}=operationFor(plan,catalog,id);
      integer(saved.seenRows,0,selected.query.top-1,'continuation delivered rows');
      wireFromUrl(catalog,operation,saved.url);
      return {...selected,url:saved.url,seenRows:saved.seenRows};
    }
    return buildQuery(plan,catalog,id,context.body);
  }
  const supplierContext=(operation,context,selected)=>{
    const wire=wireFromUrl(catalog,operation,selected.url),url=new URL(operation.path,plan.publicOrigin);
    for(const [name,value]of Object.entries(wire))url.searchParams.append(name,value);
    return {method:'GET',url,pathParams:{},query:wire,headers:{prefer:selected.compiled.prefer},signal:context.signal};
  };
  for (const operation of plan.operations) {
    const original=originals[operation.id];
    handlers['admit_'+operation.id]=async context=>{
      let selected;try{selected=request(operation.id,context);}catch{return failure(422,'ODATA_REQUEST_INVALID');}
      return typeof original.admit==='function'?original.admit(supplierContext(operation,context,selected)):true;
    };
    handlers['read_'+operation.id]=context=>{
      const promise=(async()=>{
        let selected;try{selected=request(operation.id,context);}catch{return failure(422,'ODATA_REQUEST_INVALID');}
        totals.supplierReads++;
        const response=await original(supplierContext(operation,context,selected));
        if(response.status!==200)return failure(response.status===429||response.status===503?response.status:502,'ODATA_SUPPLIER_REQUEST_FAILED');
        try {
          const contentType=(response.headers?.['content-type']??'').split(';')[0].trim().toLowerCase();
          if(contentType!=='application/json'&&!contentType.endsWith('+json'))throw new TypeError('OData JSON required');
          const native=parsePage({catalog,query:selected.compiled,raw:response.body,url:selected.url,headers:response.headers,status:response.status});
          const seenRows=selected.seenRows+native.rows.length;
          if(native.rows.length>operation.maxPageRows||seenRows>selected.query.top)throw new TypeError('Supplier exceeded the selected row ceiling');
          if(native.nextLink&&native.rows.length===0)throw new TypeError('Supplier continuation returned no rows');
          const completion=seenRows===selected.query.top?'limit':native.nextLink?'continue':'provider';
          const next=completion==='continue'?codec.encode({operation:operation.id,query:selected.query,seenRows,
            url:nextUrl(catalog,operation,native.nextLink,selected.url,selected.compiled.url,selected.query.top-seenRows)}):null;
          const page={schema:PAGE_SCHEMA,operation:operation.id,entitySet:operation.entitySet,metadataSha256:catalog.receipts.metadata.sha256,
            query:selected.query,queryFingerprint:selected.compiled.fingerprint,items:projectRows(native.rows,selected.query),
            count:native.count,seenRows,completion,next,supplierResponseSha256:native.source.sha256,
            receivedAt:native.source.receivedAt,etag:native.source.etag};
          validatePage(page,plan,catalog,operation.id);
          totals.deliveredPages++;totals.deliveredRows+=page.items.length;
          return {status:200,headers:{'content-type':'application/json; charset=utf-8'},body:page};
        }catch{totals.rejectedResponses++;return failure(502,'ODATA_SUPPLIER_RESPONSE_INVALID');}
      })();
      active.add(promise);promise.then(()=>active.delete(promise),()=>active.delete(promise));return promise;
    };
  }
  const close=()=>closing??=(async()=>{closed=true;await Promise.allSettled([...active]);await closeUpstreamHandlers(originals);})();
  return {...prepared,config:prepared.service,handlers:Object.freeze(handlers),close,
    snapshot:()=>({schema:'stellar-forge.odata-live-runtime.v1',closed,metadataSha256:catalog.receipts.metadata.sha256,
      operations:plan.operations.map(row=>row.id),...totals})};
}
