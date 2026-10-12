// MIT. Original authenticated Research routes for reviewed RIS source editions.
import {need} from '../../node/store.mjs';
export const RIS_REQUEST_LIMIT=16*1024*1024;
export const RIS_PREPARE_LIMIT=24*1024*1024;
const numbers=new Set(['revision','offset','limit']);
function query(url,allowed){
  const result={};
  for(const[key,value]of url.searchParams){
    if(['projection','sourceProjection'].includes(key))continue;
    need(allowed.includes(key)&&!Object.hasOwn(result,key),'RIS_QUERY_INVALID');
    if(numbers.has(key)){need(/^(0|[1-9][0-9]{0,8})$/.test(value),'RIS_INTEGER_QUERY_INVALID');result[key]=Number(value);}
    else result[key]=value;
  }
  return result;
}
export async function handleRisRoute({store,dossierId,action,req,url,readBody,send,setHeader}){
  if(action!=='ris-sources'&&!action.startsWith('ris-sources/'))return false;
  const selected=action.slice('ris-sources'.length).replace(/^\//,'');
  let result;
  if(req.method==='GET'&&selected===''){
    result=await store.risSources(dossierId,query(url,['revision','editionId','requestId','offset','limit','recordId']));
  }else if(req.method==='GET'&&selected==='compare'){
    result=await store.compareRis(dossierId,query(url,['revision','before','after','section','offset','limit']));
  }else if(req.method==='GET'&&['export','compare/export'].includes(selected)){
    result=selected==='compare/export'?
      await store.exportRisComparison(dossierId,query(url,['revision','before','after','format'])):
      await store.exportRis(dossierId,query(url,['revision','editionId','format','documentId','recordId']));
    setHeader('X-Content-SHA256',result.sha256);
    setHeader('X-Research-Dossier-Revision',String(result.revision));
    setHeader('X-Research-Edition-Id',result.editionId);
    if(result.beforeEditionId)setHeader('X-Research-Previous-Edition-Id',result.beforeEditionId);
    setHeader('X-Research-Representation',result.representation);
    send(200,result.bytes,result.contentType,result.filename);return true;
  }else if(req.method==='POST'&&['prepare','preview','receive'].includes(selected)){
    query(url,[]);
    const body=await readBody(req,selected==='prepare'?RIS_PREPARE_LIMIT:RIS_REQUEST_LIMIT);
    result=await store[{prepare:'prepareRis',preview:'previewRis',receive:'receiveRis'}[selected]](dossierId,body);
  }else need(false,'RIS_ROUTE_NOT_FOUND');
  const revision=result.dossier?.revision??result.revision;
  if(Number.isSafeInteger(revision))setHeader('X-Research-Dossier-Revision',String(revision));
  send(200,result);return true;
}
