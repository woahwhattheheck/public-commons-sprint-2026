// MIT. Quote operations retain complete native inputs with the original private writer.
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {exists,digest} from '../../node/store.mjs';
import {readResearchHostFile,openResearchSource} from '../workspace-files.mjs';
import {customerDirectory,withCustomerOperation,readCustomerJson,retainCustomerBytes,retainCustomerJson}
 from '../customer-updates/files.mjs';
import {QUOTE_OPERATION_SCHEMA,QUOTE_FILE_LIMIT,id,need,copy,same,fingerprint,page} from './contracts.mjs';
export {customerDirectory,withCustomerOperation,readCustomerJson,retainCustomerBytes,retainCustomerJson,exists};
export const now=()=>new Date().toISOString();
export async function optional(root,name,limit=QUOTE_FILE_LIMIT){
 const path=join(root,name);return await exists(path)?(await readCustomerJson(path,limit)).value:null;
}
export function operationPath(root,requestId){id(requestId);return join(root,'operations',requestId);}
export async function quoteRoot(directory){
 const root=await customerDirectory(directory);await customerDirectory(join(root,'operations'));return root;
}
export async function retainQuoteRequest(root,{kind,input,workspaceId,casesWorkspaceId}){
 const old=await optional(root,'request.json');
 if(old){
  need(old.schema===QUOTE_OPERATION_SCHEMA&&old.kind===kind&&old.workspaceId===workspaceId&&
   old.casesWorkspaceId===casesWorkspaceId&&old.requestSha256===fingerprint(old.request)&&same(old.request,input),
   'RESEARCH_QUOTE_REQUEST_CHANGED',409);return old;
 }
 const record={schema:QUOTE_OPERATION_SCHEMA,kind,workspaceId,casesWorkspaceId,id:input.requestId,
  request:copy(input),requestSha256:fingerprint(input),createdAt:now()};
 await retainCustomerJson(root,'request.json',record);return record;
}
export async function readQuoteOperation(root){
 const request=await optional(root,'request.json'),review=await optional(root,'review.json'),result=await optional(root,'result.json');
 need(request?.schema===QUOTE_OPERATION_SCHEMA&&request.id===request.request?.requestId&&
  request.requestSha256===fingerprint(request.request),'RESEARCH_QUOTE_REQUEST_CHANGED');
 if(review)need(review.requestSha256===request.requestSha256&&review.reviewSha256===fingerprint(review.proof),
  'RESEARCH_QUOTE_REVIEW_CHANGED');
 if(result)need(result.requestSha256===request.requestSha256&&result.reviewSha256===(review?.reviewSha256??null)&&
  result.resultSha256===fingerprint(result.result),'RESEARCH_QUOTE_RESULT_CHANGED');
 return {request,review,result};
}
export function operationView(record){
 return {schema:QUOTE_OPERATION_SCHEMA,workspaceId:record.request.workspaceId,casesWorkspaceId:record.request.casesWorkspaceId,
  id:record.request.id,kind:record.request.kind,status:record.result?'COMPLETE':record.review?'REVIEWED':'PREPARING',
  request:copy(record.request.request),requestSha256:record.request.requestSha256,createdAt:record.request.createdAt,
  review:record.review?{reviewSha256:record.review.reviewSha256,...copy(record.review.proof)}:null,
  result:copy(record.result?.result??null)};
}
export async function saveQuoteReview(root,record,proof){
 const review={requestSha256:record.requestSha256,proof:copy(proof),reviewSha256:fingerprint(proof),createdAt:now()};
 await retainCustomerJson(root,'review.json',review);return review;
}
export async function saveQuoteResult(root,record,review,result){
 const envelope={requestSha256:record.requestSha256,reviewSha256:review?.reviewSha256??null,
  result:copy(result),resultSha256:fingerprint(result),completedAt:now()};
 await retainCustomerJson(root,'result.json',envelope);return envelope;
}
export async function verifyQuoteFiles(root,files){
 need(Array.isArray(files)&&files.length<=100,'RESEARCH_QUOTE_FILES_INVALID');
 const names=new Set();
 for(const file of files){
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(file.name??'')&&!names.has(file.name)&&
   Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=QUOTE_FILE_LIMIT&&/^[a-f0-9]{64}$/.test(file.sha256??''),
   'RESEARCH_QUOTE_FILE_INVALID');
  names.add(file.name);
  const body=await readResearchHostFile(join(root,file.name),file.bytes);
  need(body.length===file.bytes&&digest(body)===file.sha256,'RESEARCH_QUOTE_FILE_CHANGED');
 }
 return files;
}
export async function quoteInventory(root,query={}){
 const selected=page(query),items=[],errors=[],names=(await readdir(join(root,'operations'))).filter(name=>/^[a-f0-9-]{36}$/.test(name)).sort();
 need(names.length<=10000,'RESEARCH_QUOTE_OPERATION_LIMIT');
 for(const requestId of names)try{
  const directory=operationPath(root,requestId),request=await optional(directory,'request.json');
  if(!request)continue;
  need(request.schema===QUOTE_OPERATION_SCHEMA&&request.requestSha256===fingerprint(request.request),'RESEARCH_QUOTE_REQUEST_CHANGED');
  const result=await optional(directory,'result.json'),hasReview=await exists(join(directory,'review.json'));
  const dossierId=request.request.dossierId??result?.result?.dossierId??null;
  if(selected.dossierId&&selected.dossierId!==dossierId||selected.kind&&selected.kind!==request.kind)continue;
  items.push({id:requestId,kind:request.kind,createdAt:request.createdAt,dossierId,
   caseId:request.request.caseId??result?.result?.caseId??null,quoteId:request.request.quoteId??null,
   status:result?'COMPLETE':hasReview?'REVIEWED':'PREPARING',bindingId:request.request.bindingId??null});
 }catch(error){errors.push({id:requestId,code:error.code??'RESEARCH_QUOTE_OPERATION_UNAVAILABLE'});}
 items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 const snapshot=fingerprint({items,errors});
 need(selected.snapshot===undefined||selected.snapshot===snapshot,'RESEARCH_QUOTE_INVENTORY_CHANGED',409);
 need(selected.offset<=items.length,'RESEARCH_QUOTE_PAGE_INVALID');
 const part=items.slice(selected.offset,selected.offset+selected.limit),next=selected.offset+part.length;
 return {schema:QUOTE_OPERATION_SCHEMA,snapshot,items:part,errors,offset:selected.offset,limit:selected.limit,
  total:items.length,nextOffset:next<items.length?next:null};
}
export async function quoteOperationFiles(root){
 const record=await readQuoteOperation(root),expected=record.review?.proof?.files??[],files=[],names=new Set();
 need(Array.isArray(expected)&&expected.length<=100,'RESEARCH_QUOTE_FILES_INVALID');
 for(const file of expected){
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(file.name??'')&&!names.has(file.name)&&
   Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=QUOTE_FILE_LIMIT&&/^[a-f0-9]{64}$/.test(file.sha256??''),
   'RESEARCH_QUOTE_FILE_INVALID');
  names.add(file.name);files.push({...file,contentType:file.name.endsWith('.md')?'text/markdown; charset=utf-8':
   file.name.endsWith('.tar')?'application/x-tar':'application/json; charset=utf-8'});
 }
 for(const name of ['request.json',...(record.review?['review.json']:[]),...(record.result?['result.json']:[])]){
  need(!names.has(name),'RESEARCH_QUOTE_RESERVED_FILE_CHANGED');
  const original=await readCustomerJson(join(root,name),QUOTE_FILE_LIMIT);
  files.push({name,bytes:original.bytes,sha256:original.sha256,contentType:'application/json; charset=utf-8'});
 }
 return {record,files};
}
export async function openQuoteFile(root,name){
 const {files}=await quoteOperationFiles(root),file=files.find(row=>row.name===name);
 need(file,'RESEARCH_QUOTE_FILE_NOT_FOUND',404);
 const source=await openResearchSource(join(root,name),file.bytes,{sha256:file.sha256});
 return {...source,name:file.name,contentType:file.contentType};
}
