// MIT. The existing Research client retains connection identity, transport lifetime and exports.
import {resolve} from 'node:path';
import {need} from '../../node/store.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {RIS_LIMITS} from './constants.mjs';
const path=(id,suffix='')=>{
  need(typeof id==='string'&&/^d_[a-f0-9-]{36}$/.test(id),'RIS_DOSSIER_ID_INVALID');
  return '/api/dossiers/'+encodeURIComponent(id)+'/ris-sources'+suffix;
};
const parameters=input=>{
  const search=new URLSearchParams();
  for(const[key,value]of Object.entries(input??{}))if(value!==undefined&&value!==null)search.set(key,String(value));
  return search.size?'?'+search.toString():'';
};
export function createRisSourceClient({request,download}){
  const call=async(route,input,options={})=>{
    const maximum=route.includes('/prepare?')?24*1024*1024:16*1024*1024;
    need(input===undefined||Buffer.byteLength(JSON.stringify(input))<=maximum,'RIS_REQUEST_TOO_LARGE');
    try{return await request(route,input,options);}
    catch(error){
      if(error.outcomeUnknown&&input?.review?.requestId)Object.assign(error,{
        requestId:input.review.requestId,questionId:input.review.questionId,
        recovery:'Use risSources().sources(dossierId,{requestId}) or replay this same source/review/plan; do not allocate a new request.'});
      throw error;
    }
  };
  const prepare=(id,input,options={})=>call(path(id,'/prepare')+'?projection=metadata',input,options);
  const client={
    prepare,
    preview:(id,input,options={})=>call(path(id,'/preview')+'?projection=metadata',input,{...options,readOnly:true}),
    receive:(id,input,options={})=>call(path(id,'/receive')+'?projection=metadata',input,options),
    sources:(id,query={},options={})=>call(path(id)+parameters(query),undefined,options),
    compare:(id,query={},options={})=>call(path(id,'/compare')+parameters(query),undefined,options),
    export:(id,{file,editionId,format='edition',documentId,recordId,revision,...options}={})=>{
      need(typeof file==='string'&&file.length>0,'RIS_EXPORT_FILE_REQUIRED');
      return download(path(id,'/export')+parameters({editionId,format,documentId,recordId,revision}),resolve(file),options);
    },
    exportComparison:(id,{file,before,after,format='json',revision,...options}={})=>{
      need(typeof file==='string'&&file.length>0,'RIS_EXPORT_FILE_REQUIRED');
      return download(path(id,'/compare/export')+parameters({before,after,format,revision}),resolve(file),options);
    },
    async prepareFiles(id,{source,review,offset,limit,recordId},options={}){
      need(source&&Array.isArray(source.documents)&&source.documents.length<=RIS_LIMITS.documents,
        'RIS_DOCUMENT_COUNT_INVALID');
      let total=0;const documents=[];
      for(const document of source.documents){
        const {file,sha256,bytes:declared,...declaration}=document;
        need(typeof file==='string'&&file.length>0&&/^[a-f0-9]{64}$/.test(sha256),'RIS_ORIGINAL_FILE_AND_HASH_REQUIRED');
        const bytes=await readResearchHostFile(resolve(file),RIS_LIMITS.documentBytes,{sha256,signal:options.signal});
        total+=bytes.length;need(total<=RIS_LIMITS.totalDocumentBytes,'RIS_DOCUMENT_TOTAL_TOO_LARGE');
        need(declared===undefined||declared===bytes.length,'RIS_DOCUMENT_CHANGED');
        documents.push({...declaration,sha256,bytes:bytes.length,bodyBase64:bytes.toString('base64')});
      }
      return prepare(id,{source:{...source,documents},review,...(offset===undefined?{}:{offset}),
        ...(limit===undefined?{}:{limit}),...(recordId===undefined?{}:{recordId})},options);
    },
    async prepareSourceFile(id,{file,sha256,review,...page},options={}){
      need(typeof file==='string'&&/^[a-f0-9]{64}$/.test(sha256),'RIS_ORIGINAL_FILE_AND_HASH_REQUIRED');
      const bytes=await readResearchHostFile(resolve(file),RIS_LIMITS.sourceBytes,{sha256,signal:options.signal});
      // Preparing a declaration from an existing RIS source keeps its exact
      // file bytes through the original prepared-source endpoint below.
      return call(path(id,'/prepare')+'?projection=metadata',
        {sourceFile:{bodyBase64:bytes.toString('base64'),sha256,bytes:bytes.length},review,...page},options);
    },
  };
  return Object.freeze(client);
}
