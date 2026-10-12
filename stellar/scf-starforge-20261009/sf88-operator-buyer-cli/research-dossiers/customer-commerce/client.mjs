// MIT. Paid Research operations borrow the original ResearchWorkspaceClient.
import {COMMERCE_SCHEMA,PUBLICATION_LIMIT,PAID_ARCHIVE_LIMIT,publicationRequest,publicPublication,
 fields,identifier,hash,alias,atomic,environmentName,copy,same,fingerprint,need} from './contracts.mjs';
const prefix='/api/customer-commerce';
const parameters=value=>{const query=new URLSearchParams();for(const [key,item]of Object.entries(value??{}))
 if(item!==undefined&&item!==null)query.set(key,String(item));return query.size?'?'+query.toString():'';};
const collection=value=>{need(['publications','purchases'].includes(value),'RESEARCH_COMMERCE_COLLECTION_INVALID');return value;};
const path=(kind,id)=>prefix+'/'+collection(kind)+(id===undefined?'':'/'+identifier(id));
function input(value){need(value&&typeof value==='object'&&!Array.isArray(value),'RESEARCH_COMMERCE_FIELDS_INVALID');return copy(value);}
function record(value,kind,id){
 need(value?.schema===COMMERCE_SCHEMA&&value.kind===kind&&value.id===id,'RESEARCH_COMMERCE_RESPONSE_CHANGED');return value;
}
function prepared(value){
 if(value.prepared){const {preparedSha256,...proof}=value.prepared;
  need(preparedSha256===fingerprint(proof)&&proof.schema==='sf88-research-paid-purchase-prepared/v1',
   'RESEARCH_COMMERCE_PREPARED_PURCHASE_CHANGED');}
 return value;
}
function selection(value){
 const selected=input(value);fields(selected,['id','requestId','preparedSha256']);
 identifier(selected.id);identifier(selected.requestId);hash(selected.preparedSha256);return selected;
}
/** Closing the owning ResearchWorkspaceClient drains these operations. */
export function createResearchCommerceClient({request,download}={}){
 need(typeof request==='function'&&typeof download==='function','RESEARCH_COMMERCE_ORIGINAL_CLIENT_REQUIRED');
 return Object.freeze({
  async configuration(options={}){
   const value=await request(prefix+'/configuration',undefined,options);
   need(value?.schema==='sf88-research-customer-commerce-host/v1'&&/^research_[a-f0-9]{64}$/.test(value.workspaceId)&&
    Array.isArray(value.merchants)&&Array.isArray(value.buyers)&&Array.isArray(value.errors),'RESEARCH_COMMERCE_CONFIGURATION_CHANGED');
   return value;
  },
  async list(kind,query={},options={}){
   const selected=input(query);fields(selected,['offset','limit','snapshot'],[]);
   const value=await request(path(kind)+parameters(selected),undefined,options);
   need(value?.schema===COMMERCE_SCHEMA&&value.kind===kind&&/^[a-f0-9]{64}$/.test(value.snapshot)&&
    Array.isArray(value.items)&&Array.isArray(value.errors)&&Number.isSafeInteger(value.offset)&&value.offset>=0&&
    Number.isSafeInteger(value.total)&&value.total>=value.offset+value.items.length&&
    (value.nextOffset===null||value.nextOffset===value.offset+value.items.length)&&
    (selected.snapshot===undefined||value.snapshot===selected.snapshot)&&
    (selected.offset===undefined||value.offset===selected.offset),'RESEARCH_COMMERCE_PAGE_CHANGED');
   for(const row of value.items){identifier(row.id);need(row.kind===kind,'RESEARCH_COMMERCE_PAGE_CHANGED');}
   return value;
  },
  async publication(id,options={}){
   return record(await request(path('publications',id),undefined,options),'publications',id);
  },
  async preparePublication(value,options={}){
   const selected=publicationRequest(value);
   const result=record(await request(path('publications')+'/prepare',selected,options),'publications',selected.requestId);
   need(result.review?.id===selected.requestId&&result.review.dossierId===selected.dossierId&&
    result.review.deliveryId===selected.deliveryId&&result.review.revision===selected.revision&&
    result.review.title===selected.title&&result.review.summary===selected.summary&&result.review.usage===selected.usage,
    'RESEARCH_COMMERCE_PUBLICATION_REVIEW_CHANGED');
   hash(result.review.reviewSha256);return result;
  },
  async enrollPublication(value,options={}){
   const selected=input(value);fields(selected,['id','reviewSha256']);identifier(selected.id);hash(selected.reviewSha256);
   const result=record(await request(path('publications')+'/enroll',selected,options),'publications',selected.id);
   need(result.status==='ENROLLED'&&result.review?.reviewSha256===selected.reviewSha256&&
    result.result?.publicationId===selected.id,'RESEARCH_COMMERCE_ENROLLED_PUBLICATION_CHANGED');
   publicPublication(result.result.publication);return result;
  },
  async receivePurchase(value,options={}){
   const selected=input(value);fields(selected,['requestId','buyer','filename','base64']);
   identifier(selected.requestId);alias(selected.buyer);
   need(typeof selected.base64==='string'&&selected.base64.length<=4*Math.ceil(PUBLICATION_LIMIT/3),
    'RESEARCH_COMMERCE_PUBLICATION_SIZE_INVALID');
   const bytes=Buffer.from(selected.base64,'base64');
   need(bytes.length>0&&bytes.length<=PUBLICATION_LIMIT&&bytes.toString('base64')===selected.base64,
    'RESEARCH_COMMERCE_PUBLICATION_ENCODING_INVALID');
   const publication=publicPublication(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
   const result=record(await request(path('purchases')+'/receive',selected,options),'purchases',selected.requestId);
   need(same(result.publication,publication)&&result.buyer?.id===selected.buyer,'RESEARCH_COMMERCE_RECEIVED_PUBLICATION_CHANGED');
   return result;
  },
  async purchase(id,{refresh=false}={},options={}){
   need(typeof refresh==='boolean','RESEARCH_COMMERCE_REFRESH_INVALID');
   return prepared(record(await request(path('purchases',id)+parameters({refresh}),undefined,options),'purchases',id));
  },
  async preparePurchase(value,options={}){
   const selected=input(value);fields(selected,['id','requestId','expectedRevision','totalAtomic','dailyAtomic','claimEnv']);
   identifier(selected.id);identifier(selected.requestId);atomic(selected.totalAtomic);atomic(selected.dailyAtomic);
   environmentName(selected.claimEnv);
   const result=prepared(record(await request(path('purchases')+'/prepare',selected,options),'purchases',selected.id));
   need(result.status==='BUYER_PREPARED'&&same(result.prepared?.input,selected),'RESEARCH_COMMERCE_PREPARED_PURCHASE_CHANGED');
   return result;
  },
  async action(kind,value,options={}){
   need(['execute','retrieve','recover','finalize','cancel'].includes(kind),'RESEARCH_COMMERCE_BUYER_ACTION_INVALID');
   const selected=kind==='cancel'?input(value):selection(value);
   if(kind==='cancel'){fields(selected,['id','requestId','preparedSha256','executionId']);
    identifier(selected.id);identifier(selected.requestId);hash(selected.preparedSha256);identifier(selected.executionId);}
   const result=record(await request(path('purchases')+'/'+kind,selected,options),'purchases',selected.id);
   need(result.action===kind&&result.requestId===selected.requestId,'RESEARCH_COMMERCE_NATIVE_ACTION_CHANGED');return result;
  },
  async reconcile(value,options={}){
   const selected=input(value);fields(selected,['id','requestId','nativeRequestId','nativeId'],['id','requestId','nativeRequestId']);
   identifier(selected.id);identifier(selected.requestId);identifier(selected.nativeRequestId);
   const result=record(await request(path('purchases')+'/reconcile',selected,options),'purchases',selected.id);
   need(result.action==='reconcile','RESEARCH_COMMERCE_NATIVE_ACTION_CHANGED');return result;
  },
  async receiveDossier(value,options={}){
   const selected=input(value);fields(selected,['id','requestId','preparedSha256','sourceActor'],['id','requestId','preparedSha256']);
   selection({id:selected.id,requestId:selected.requestId,preparedSha256:selected.preparedSha256});
   const result=record(await request(path('purchases')+'/receive-dossier',selected,options),'purchases',selected.id);
   need(result.status==='DOSSIER_RECEIVED'&&result.received?.schema==='sf88-research-paid-customer-received/v1'&&
    /^research_[a-f0-9]{64}$/.test(result.received.workspaceId)&&result.received.nativeReceiving,
    'RESEARCH_COMMERCE_NATIVE_RECEIVING_CHANGED');return result;
  },
  async file(kind,id,part,options={}){
   need(['publication','handoff','archive','received'].includes(part),'RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED');
   const value=await request(path(kind,id)+'/files/'+part+'?metadata=true',undefined,options),file=value?.descriptor;
   need(value?.schema==='sf88-research-commerce-file/v1'&&value.kind===kind&&value.id===id&&value.file===part&&
    /^research_[a-f0-9]{64}$/.test(value.workspaceId)&&file&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(file.name)&&
    Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=(part==='archive'?PAID_ARCHIVE_LIMIT:PUBLICATION_LIMIT)&&
    typeof file.contentType==='string','RESEARCH_COMMERCE_FILE_CHANGED');hash(file.sha256);return value;
  },
  async download(kind,id,part,{file,expectedSha256,expectedBytes,signal}={}){
   need(['publication','handoff','archive','received'].includes(part),'RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED');
   hash(expectedSha256);need(Number.isSafeInteger(expectedBytes)&&expectedBytes>=0&&
    expectedBytes<=(part==='archive'?PAID_ARCHIVE_LIMIT:PUBLICATION_LIMIT),'RESEARCH_COMMERCE_FILE_SIZE_INVALID');
   const result=await download(path(kind,id)+'/files/'+part,file,{expectedSha256,signal});
   if(result.sha256!==expectedSha256||result.bytes!==expectedBytes)
    throw Object.assign(new Error('RESEARCH_COMMERCE_DOWNLOADED_FILE_CHANGED'),
     {code:'RESEARCH_COMMERCE_DOWNLOADED_FILE_CHANGED',destinationPublished:true,file:result});
   return result;
  },
 });
}
