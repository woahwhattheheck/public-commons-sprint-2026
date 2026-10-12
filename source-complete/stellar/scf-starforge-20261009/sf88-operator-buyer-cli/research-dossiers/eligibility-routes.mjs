// MIT. Eligibility operations on the original authenticated Research listener.
import {need} from '../node/store.mjs';
export const ELIGIBILITY_REVIEW_LIMIT = 16 * 1024 * 1024;
export const ELIGIBILITY_SECTIONS = Object.freeze(['overview','reviews','occurrences','queue','decisions','resolutions','studies','impact','operations']);
export const ELIGIBILITY_TABLES = Object.freeze(['occurrences','queue','decisions','resolutions','studies','impact','operations']);
export const ELIGIBILITY_ACTIONS = Object.freeze(['create-review','revise-protocol','create-workset','decide','resolve','study-link','apply-outcomes','review-impact']);
const integer=(value,{minimum=0}={})=>{
  need(typeof value==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(value),'ELIGIBILITY_PAGE_INVALID');
  const result=Number(value);need(Number.isSafeInteger(result)&&result>=minimum,'ELIGIBILITY_PAGE_INVALID');return result;
};
const query=(url,key)=>url.searchParams.has(key)?url.searchParams.get(key):undefined;
export async function handleEligibilityRoute({store,dossierId,action,req,url,projection,readBody,send,setHeader}){
  const match=action.match(/^eligibility(?:\/(reviews|export))?$/);
  if(!match)return false;
  if(req.method==='GET'&&!match[1]){
    const section=query(url,'section')??'overview';
    need(ELIGIBILITY_SECTIONS.includes(section),'ELIGIBILITY_SECTION_INVALID');
    const result=await store.eligibility(dossierId,{
      ...(url.searchParams.has('revision')?{revision:integer(query(url,'revision'),{minimum:1})}:{}),
      ...(url.searchParams.has('reviewId')?{reviewId:query(url,'reviewId')}:{}),
      ...(url.searchParams.has('workSetId')?{workSetId:query(url,'workSetId')}:{}),
      section,offset:integer(query(url,'offset')??'0'),limit:integer(query(url,'limit')??'30',{minimum:1}),
    });
    setHeader('X-Research-Dossier-Revision',String(result.dossier.revision));send(200,result);return true;
  }
  if(req.method==='GET'&&match[1]==='export'){
    const format=query(url,'format')??'json',section=query(url,'section')??'queue';
    need(['json','csv'].includes(format),'ELIGIBILITY_EXPORT_FORMAT_INVALID');
    need(ELIGIBILITY_TABLES.includes(section),'ELIGIBILITY_SECTION_INVALID');
    need(typeof query(url,'reviewId')==='string'&&query(url,'reviewId'),'ELIGIBILITY_REVIEW_REQUIRED');
    const result=await store.exportEligibility(dossierId,{
      ...(url.searchParams.has('revision')?{revision:integer(query(url,'revision'),{minimum:1})}:{}),
      reviewId:query(url,'reviewId'),...(url.searchParams.has('workSetId')?{workSetId:query(url,'workSetId')}:{}),
      format,section,
    });
    need(typeof result.body==='string'||result.body instanceof Uint8Array,'ELIGIBILITY_EXPORT_BODY_INVALID');
    setHeader('X-Research-Dossier-Revision',String(result.revision));
    send(200,Buffer.from(result.body),result.contentType,result.filename);return true;
  }
  if(req.method==='POST'&&match[1]==='reviews'){
    const data=await readBody();
    need(ELIGIBILITY_ACTIONS.includes(data.action),'ELIGIBILITY_ACTION_INVALID');
    const result=await store.reviewEligibility(dossierId,{...data,projection});
    setHeader('X-Research-Dossier-Revision',String(result.dossier.revision));
    send(result.duplicate?200:201,result);return true;
  }
  send(405,{error:'METHOD_NOT_ALLOWED'});return true;
}
