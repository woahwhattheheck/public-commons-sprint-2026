// MIT. Original ClinicalTrials receiving actions on the maintained Research transport.
import {need,object} from '../node/store.mjs';
const id=(value,pattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/)=>{
 need(typeof value==='string'&&pattern.test(value),'CLINICALTRIALS_CLIENT_ID_INVALID');return encodeURIComponent(value);
};
const query=values=>{const params=new URLSearchParams();for(const[key,value]of Object.entries(values??{}))if(value!==undefined&&value!==null)params.set(key,String(value));return params.size?'?'+params:'';};
const root=dossierId=>'/api/dossiers/'+id(dossierId,/^d_[a-f0-9-]{36}$/)+'/clinical-trials/';
const operation=(dossierId,operationId)=>root(dossierId)+'operations/'+id(operationId,/^ct_[a-f0-9]{64}$/);
const retained=(dossierId,editionId)=>root(dossierId)+'retained/'+id(editionId,/^e_[a-f0-9]{64}$/);
function paging(options={},maximum=200){
 need(object(options)&&Object.keys(options).every(key=>['offset','limit'].includes(key)),'CLINICALTRIALS_REVIEW_PAGE_INVALID');
 const{offset=0,limit=50}=options;need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=maximum,'CLINICALTRIALS_REVIEW_PAGE_INVALID');return{offset,limit};
}
function inventory(options={}){
 need(object(options)&&Object.keys(options).every(key=>['after','limit'].includes(key)),'CLINICALTRIALS_OPERATION_PAGE_INVALID');
 const{after,limit=30}=options;need(after===undefined||typeof after==='string','CLINICALTRIALS_OPERATION_PAGE_INVALID');
 need(Number.isSafeInteger(limit)&&limit>0&&limit<=100,'CLINICALTRIALS_OPERATION_PAGE_INVALID');return{after,limit};
}
function analysisOptions(options={}){
 need(object(options)&&Object.keys(options).every(key=>['criteria','offset','limit'].includes(key)),'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 const {criteria={},...page}=options;need(object(criteria),'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 const selected=JSON.stringify(criteria);need(selected.length<=16384,'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');return{...paging(page),criteria:selected};
}
function analysisExportOptions(options={}){
 need(object(options),'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 const{format='csv',criteria={},...file}=options;need(['csv','json','html','md'].includes(format),'CLINICALTRIALS_ANALYSIS_FORMAT_INVALID');
 return{format,criteria:analysisOptions({criteria}).criteria,file};
}
function index(value){need(Number.isSafeInteger(value)&&value>=0,'CLINICALTRIALS_STUDY_INDEX_INVALID');return value;}
export function createClinicalTrialsClient({request,download,upload}){
 need([request,download,upload].every(value=>typeof value==='function'),'ORIGINAL_RESEARCH_CLIENT_REQUIRED');
 const file=(route,{file,...options}={})=>{need(typeof file==='string'&&file.length>0,'RESEARCH_OUTPUT_FILE_REQUIRED');return download(route,file,options);};
 return Object.freeze({
  inputs:(dossierId,options={})=>request(root(dossierId)+'inputs'+query(inventory(options))),
  input:(dossierId,sourceId)=>request(root(dossierId)+'inputs/'+id(sourceId,/^ctsrc_[a-f0-9]{64}$/)),
  importPacket:(dossierId,options)=>upload(root(dossierId)+'inputs',options),
  prepare:(dossierId,input)=>request(root(dossierId)+'prepare',input),
  operations:(dossierId,options={})=>request(root(dossierId)+'operations'+query(inventory(options))),
  review:(dossierId,operationId,options={})=>request(operation(dossierId,operationId)+query(paging(options))),
  start:(dossierId,operationId,{expectedPlanSha256}={})=>request(operation(dossierId,operationId)+'/start',{expectedPlanSha256}),
  stop:(dossierId,operationId)=>request(operation(dossierId,operationId)+'/stop',{}),
  receive:(dossierId,operationId,input)=>request(operation(dossierId,operationId)+'/receive?projection=metadata',input),
  record:(dossierId,operationId,at)=>request(operation(dossierId,operationId)+'/record'+query({index:index(at)})),
  compare:(dossierId,operationId,beforeOperationId)=>request(operation(dossierId,operationId)+'/compare'+query({before:id(beforeOperationId,/^ct_[a-f0-9]{64}$/)})),
  retained:(dossierId)=>request(root(dossierId)+'retained'),
  retainedReview:(dossierId,editionId,options={})=>request(retained(dossierId,editionId)+query(paging(options))),
  retainedRecord:(dossierId,editionId,at)=>request(retained(dossierId,editionId)+'/record'+query({index:index(at)})),
  compareRetained:(dossierId,beforeEditionId,afterEditionId)=>request(root(dossierId)+'retained/compare'+query({before:id(beforeEditionId,/^e_[a-f0-9]{64}$/),after:id(afterEditionId,/^e_[a-f0-9]{64}$/)})),
  analysis:(dossierId,operationId,options={})=>request(operation(dossierId,operationId)+'/analysis'+query(analysisOptions(options))),
  retainedAnalysis:(dossierId,editionId,options={})=>request(retained(dossierId,editionId)+'/analysis'+query(analysisOptions(options))),
  exportAnalysis:(dossierId,operationId,options={})=>{const selected=analysisExportOptions(options);return file(operation(dossierId,operationId)+'/analysis/'+selected.format+query({criteria:selected.criteria}),selected.file);},
  exportRetainedAnalysis:(dossierId,editionId,options={})=>{const selected=analysisExportOptions(options);return file(retained(dossierId,editionId)+'/analysis/'+selected.format+query({criteria:selected.criteria}),selected.file);},
  exportEdition:(dossierId,operationId,options)=>file(operation(dossierId,operationId)+'/edition',options),
  exportInputPacket:(dossierId,sourceId,options)=>file(root(dossierId)+'inputs/'+id(sourceId,/^ctsrc_[a-f0-9]{64}$/)+'/packet',options),
  exportRetainedEdition:(dossierId,editionId,options)=>file(retained(dossierId,editionId)+'/edition',options),
  exportRetainedPacket:(dossierId,editionId,options)=>file(retained(dossierId,editionId)+'/packet',options),
 });
}
