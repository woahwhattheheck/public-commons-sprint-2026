// MIT. Appraisal routes and fixed static assets on the original Research listener.
import {readFile} from 'node:fs/promises';
import {need,object} from '../../node/store.mjs';
import {RISK_OF_BIAS_ACTIONS,RISK_OF_BIAS_SECTIONS} from './contracts.mjs';

export const RISK_OF_BIAS_REQUEST_LIMIT=16*1024*1024;
const assets=Object.freeze({
  '/risk-of-bias/browser.mjs':{file:new URL('./browser.mjs',import.meta.url),contentType:'text/javascript; charset=utf-8'},
  '/risk-of-bias/panel.html':{file:new URL('./panel.html',import.meta.url),contentType:'text/html; charset=utf-8'},
  '/risk-of-bias/browser.css':{file:new URL('./browser.css',import.meta.url),contentType:'text/css; charset=utf-8'},
  '/risk-of-bias/form-template.json':{file:new URL('./form-template.json',import.meta.url),contentType:'application/json; charset=utf-8'},
  '/risk-of-bias/method-references.json':{file:new URL('./method-references.json',import.meta.url),contentType:'application/json; charset=utf-8'},
});
export async function readRiskOfBiasAsset(path){
  if(!Object.hasOwn(assets,path))return null;
  const selected=assets[path];
  return {body:await readFile(selected.file),contentType:selected.contentType};
}
const integer=(value,{minimum=0,maximum=99999999}={})=>{
  need(typeof value==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(value),'RISK_OF_BIAS_PAGE_INVALID');
  const number=Number(value);
  need(Number.isSafeInteger(number)&&number>=minimum&&number<=maximum,'RISK_OF_BIAS_PAGE_INVALID');
  return number;
};
const one=(url,name)=>{
  const values=url.searchParams.getAll(name);
  need(values.length<=1,'RISK_OF_BIAS_QUERY_REPEATED');
  return values[0];
};
const identifier=(url,name)=>{
  const value=one(url,name);
  need(value===undefined||typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value),
    'RISK_OF_BIAS_SELECTION_INVALID');
  return value;
};
const compact=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined));
function queryOptions(url,{exporting=false}={}){
  const revision=one(url,'revision'),section=one(url,'section')??'overview';
  need(RISK_OF_BIAS_SECTIONS.includes(section),'RISK_OF_BIAS_SECTION_INVALID');
  return compact({
    ...(revision===undefined?{}:{revision:integer(revision,{minimum:1})}),
    reviewId:identifier(url,'reviewId'),assessmentId:identifier(url,'assessmentId'),
    assessmentEditionId:identifier(url,'assessmentEditionId'),actorId:identifier(url,'actorId'),section,
    ...(exporting?{}:{
      offset:integer(one(url,'offset')??'0'),
      limit:integer(one(url,'limit')??'30',{minimum:1,maximum:100}),
    }),
  });
}
function revisionHeader(result,setHeader){
  const revision=result.revision??result.dossier?.revision;
  need(Number.isSafeInteger(revision)&&revision>=1,'RISK_OF_BIAS_RESPONSE_INVALID');
  need(result.revision===undefined||result.dossier?.revision===undefined||result.revision===result.dossier.revision,
    'RISK_OF_BIAS_RESPONSE_INVALID');
  setHeader('X-Research-Dossier-Revision',String(revision));
}
export async function handleRiskOfBiasRoute({store,dossierId,action,req,url,projection,readBody,send,setHeader}){
  const matched=action.match(/^risk-of-bias(?:\/(reviews|export))?$/);
  if(!matched)return false;
  if(req.method==='GET'&&!matched[1]){
    const options=queryOptions(url);
    need(options.offset===0||options.revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const result=await store.riskOfBias(dossierId,options);
    revisionHeader(result,setHeader);send(200,result);return true;
  }
  if(req.method==='GET'&&matched[1]==='export'){
    const format=one(url,'format')??'json';
    need(['json','csv','md','html'].includes(format),'RISK_OF_BIAS_EXPORT_FORMAT_INVALID');
    const result=await store.exportRiskOfBias(dossierId,{...queryOptions(url,{exporting:true}),format});
    need(typeof result.body==='string'||result.body instanceof Uint8Array,'RISK_OF_BIAS_EXPORT_BODY_INVALID');
    revisionHeader(result,setHeader);
    send(200,Buffer.from(result.body),result.contentType,result.filename);return true;
  }
  if(req.method==='POST'&&matched[1]==='reviews'){
    const request=await readBody();
    need(object(request)&&RISK_OF_BIAS_ACTIONS.includes(request.action),'RISK_OF_BIAS_ACTION_INVALID');
    const result=await store.reviewRiskOfBias(dossierId,{...request,projection});
    revisionHeader(result,setHeader);send(result.duplicate?200:201,result);return true;
  }
  setHeader('Allow',matched[1]==='reviews'?'POST':'GET');
  send(405,{error:'METHOD_NOT_ALLOWED'});return true;
}
