// MIT. Customer commerce records share the original Research private publisher.
import {readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {exists,jsonBytes,digest} from '../../node/store.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {customerDirectory,withCustomerOperation,readCustomerJson,retainCustomerJson,retainCustomerBytes}
 from '../customer-updates/files.mjs';
import {identifier,need,same,fingerprint,copy} from './contracts.mjs';
export {customerDirectory,withCustomerOperation,readCustomerJson,retainCustomerJson,retainCustomerBytes,exists,jsonBytes,digest};
export const stamp=()=>new Date().toISOString();
export function commercePath(root,kind,id){
 need(['publications','purchases'].includes(kind),'RESEARCH_COMMERCE_COLLECTION_INVALID');identifier(id);
 return join(root,kind,id);
}
export async function ensureCommerceRoot(directory){
 const root=await customerDirectory(directory);
 for(const kind of ['publications','purchases'])await customerDirectory(join(root,kind));
 return root;
}
export async function optionalJson(root,name,limit=64*1024*1024){
 const path=join(root,name);return await exists(path)?(await readCustomerJson(path,limit)).value:null;
}
export async function retainRequest(root,kind,input,extra={}){
 let value=await optionalJson(root,'request.json');
 if(value){
  need(value.schema==='sf88-research-commerce-request/v1'&&value.kind===kind&&
   value.requestSha256===fingerprint(value.request)&&same(value.request,input),
   'RESEARCH_COMMERCE_RETAINED_REQUEST_CHANGED');
  return value;
 }
 value={schema:'sf88-research-commerce-request/v1',kind,request:copy(input),requestSha256:fingerprint(input),...copy(extra),createdAt:stamp()};
 await retainCustomerJson(root,'request.json',value);return value;
}
export async function inspectCommerceRecord(root,kind){
 const request=await optionalJson(root,'request.json'),review=await optionalJson(root,'review.json'),result=await optionalJson(root,'result.json');
 need(request?.schema==='sf88-research-commerce-request/v1'&&request.kind===kind&&
  request.requestSha256===fingerprint(request.request),'RESEARCH_COMMERCE_RETAINED_REQUEST_CHANGED');
 if(review)need(review.schema==='sf88-research-commerce-review/v1'&&review.requestSha256===request.requestSha256&&
  review.reviewSha256===fingerprint(review.proof),'RESEARCH_COMMERCE_REVIEW_CHANGED');
 if(result)need(result.schema==='sf88-research-commerce-result/v1'&&result.requestSha256===request.requestSha256,
  'RESEARCH_COMMERCE_RETAINED_RESULT_CHANGED');
 return {request,review,result};
}
export async function commerceInventory(root,kind,{offset=0,limit=50,snapshot}={}){
 need(['publications','purchases'].includes(kind)&&Number.isSafeInteger(offset)&&offset>=0&&
  Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'RESEARCH_COMMERCE_PAGE_INVALID');
 const names=(await readdir(join(root,kind))).filter(name=>/^[a-f0-9-]{36}$/.test(name)).sort(),items=[],errors=[];
 need(names.length<=10000,'RESEARCH_COMMERCE_LIBRARY_LIMIT');
 for(const id of names)try{
  const directory=commercePath(root,kind,id),record=await inspectCommerceRecord(directory,kind),
   request=record.request.request,offer=kind==='purchases'?await optionalJson(directory,'publication.json'):null,
   prepared=kind==='purchases'?await optionalJson(directory,'prepared.json'):null,
   received=kind==='purchases'?await optionalJson(directory,'received.json'):null;
  items.push({id,kind,title:request.title??offer?.title??id,createdAt:record.request.createdAt,
   dossierId:request.dossierId??offer?.delivery.dossierId,deliveryId:request.deliveryId??offer?.delivery.deliveryId,
   ...(kind==='publications'?{merchant:request.merchant,status:record.result?'ENROLLED':record.review?'REVIEWED':'PREPARING',
    reviewSha256:record.review?.reviewSha256??null}:{buyer:request.buyer,
    status:received?'DOSSIER_RECEIVED':prepared?'BUYER_PREPARED':record.result?'OFFER_RECEIVED':'RECEIVING'}),
  });
 }catch(error){errors.push({id,code:error.code??'RESEARCH_COMMERCE_RECORD_UNAVAILABLE'});}
 items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 const current=fingerprint({items,errors});
 need(snapshot===undefined||snapshot===current,'RESEARCH_COMMERCE_INVENTORY_CHANGED');
 need(offset<=items.length,'RESEARCH_COMMERCE_PAGE_INVALID');
 const selected=items.slice(offset,offset+limit),next=offset+selected.length;
 return {kind,snapshot:current,items:selected,errors,offset,limit,total:items.length,nextOffset:next<items.length?next:null};
}
export async function retainedBytes(root,name,expected){
 const body=await readResearchHostFile(join(root,name),expected.bytes||1);
 need(body.length===expected.bytes&&digest(body)===expected.sha256,'RESEARCH_COMMERCE_RETAINED_FILE_CHANGED');return body;
}
export async function assertOriginalDirectory(path,identity){
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&String(info.dev)===identity.device&&String(info.ino)===identity.inode,
  'RESEARCH_COMMERCE_NATIVE_DIRECTORY_CHANGED');
}
