// MIT. Original authenticated Research listener; the original store owns every revision.
import {need,object} from '../node/store.mjs';
export const STUDY_EXTRACTION_REVIEW_LIMIT=16*1024*1024;
export const STUDY_EXTRACTION_SOURCE_LIMIT=1024*1024;
const routes=new Set(['extraction','extraction/reviews','extraction/source-values','extraction/export',
  'extraction/publications','extraction/publications/reviews','extraction/publications/export']);
const integer=(value,name)=>{
  need(/^(0|[1-9][0-9]{0,8})$/.test(value),'EXTRACTION_QUERY_INTEGER_INVALID');
  const n=Number(value);need((name!=='revision'&&name!=='limit')||n>=1,'EXTRACTION_QUERY_INTEGER_INVALID');return n;
};
function query(url,allowed){
  const result={},seen=new Set();
  for(const [name,value]of url.searchParams){
    need(!seen.has(name),'EXTRACTION_QUERY_INVALID');seen.add(name);
    if(['projection','sourceProjection'].includes(name))continue;
    need(allowed.includes(name),'EXTRACTION_QUERY_INVALID');
    if(name==='currentOnly'){need(['true','false'].includes(value),'EXTRACTION_QUERY_INVALID');result[name]=value==='true';}
    else result[name]=['revision','offset','limit'].includes(name)?integer(value,name):value;
  }
  return result;
}
export async function handleStudyExtractionRoute({store,dossierId,action,req,url,projection='metadata',readBody,send,setHeader}){
  if(!routes.has(action))return false;
  const response=value=>{
    const revision=value.revision??value.dossier?.revision;
    need(Number.isSafeInteger(revision)&&revision>=1,'EXTRACTION_RESPONSE_REVISION_REQUIRED');
    setHeader('X-Research-Dossier-Revision',String(revision));return value;
  };
  if(req.method==='GET'&&action==='extraction'){
    send(200,response(await store.extraction(dossierId,query(url,['revision','section','formId','resultSetId','offset','limit']))));return true;
  }
  if(req.method==='GET'&&action==='extraction/publications'){
    send(200,response(await store.extractionPublications(dossierId,query(url,['revision','section','tableId','publicationId','offset','limit','currentOnly','fromPublicationId','toPublicationId','againstPublicationId','changeType']))));return true;
  }
  if(req.method==='POST'&&action==='extraction/source-values'){
    const options=query(url,['revision']),input=await readBody(req,STUDY_EXTRACTION_SOURCE_LIMIT);
    need(object(input)&&Object.keys(input).every(key=>['occurrenceId','pointers','fileName'].includes(key)),
      'EXTRACTION_SOURCE_FIELDS_INVALID');
    send(200,response(await store.extractionSourceValues(dossierId,{...input,...options})));return true;
  }
  if(req.method==='POST'&&['extraction/reviews','extraction/publications/reviews'].includes(action)){
    query(url,[]);
    const input=await readBody(req,STUDY_EXTRACTION_REVIEW_LIMIT);
    need(object(input)&&!Object.hasOwn(input,'projection'),'EXTRACTION_FIELDS_INVALID');
    const review=action==='extraction/reviews'?store.reviewExtraction:store.reviewExtractionPublication;
    const result=response(await review.call(store,dossierId,{...input,projection}));
    send(result.duplicate?200:201,result);return true;
  }
  if(req.method==='GET'&&['extraction/export','extraction/publications/export'].includes(action)){
    const publication=action==='extraction/publications/export';
    const options=query(url,publication?['revision','tableId','publicationId','format','againstPublicationId','fromPublicationId','toPublicationId','changeType','currentOnly']:
      ['revision','formId','resultSetId','format']);
    const result=response(await (publication?store.exportExtractionPublication(dossierId,options):store.exportExtraction(dossierId,options)));
    send(200,Buffer.from(result.body),result.contentType,result.filename);return true;
  }
  send(405,{error:'EXTRACTION_METHOD_NOT_ALLOWED'});return true;
}
