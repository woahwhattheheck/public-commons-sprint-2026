// MIT. Route family for the original authenticated Research server.
// The host invokes dispatch only AFTER its existing session/origin checks.
import {requireValue,workbookFilename,hashBytes} from './workbook.mjs';
const readOptions=query=>{
  const out={};
  for(const name of ['revision','offset','limit'])if(query[name]!==undefined&&query[name]!==''){
    requireValue(/^\d+$/u.test(String(query[name])),'TEMPLATE_QUERY_INTEGER_REQUIRED');out[name]=Number(query[name]);
  }
  for(const name of ['section','templateId','publicationId','kind','recordId','requestId'])if(query[name]!==undefined)out[name]=String(query[name]);
  return out;
};
const bodyFile=data=>{
  requireValue(data&&typeof data.bodyBase64==='string'&&data.bodyBase64.length<=44*1024*1024,'TEMPLATE_UPLOAD_REQUIRED',413);
  const body=Buffer.from(data.bodyBase64,'base64');
  requireValue(body.toString('base64')===data.bodyBase64,'TEMPLATE_UPLOAD_BASE64_INVALID');
  const {bodyBase64,...rest}=data;return {...rest,filename:workbookFilename(data.filename),body};
};
export const TEMPLATE_ROUTE_PREFIX='/api/research/dossiers/:dossierId/template-exchange';
export const TEMPLATE_POST_ACTIONS=Object.freeze(['stage-template','stage-mapping','stage-release','stage-return',
  'stage-return-review','review','prepare-extraction-draft','accept-extraction-draft']);
export function createTemplateExchangeDispatcher({templateExchange}){
  requireValue(templateExchange&&typeof templateExchange.review==='function','TEMPLATE_HOST_BINDING_REQUIRED');
  return async function dispatch({dossierId,method,action='',query={},body}){
    requireValue(typeof dossierId==='string','TEMPLATE_DOSSIER_REQUIRED');
    if(method==='GET'){
      const options=readOptions(query);
      if(action==='')return {kind:'json',body:await templateExchange.page(dossierId,options)};
      if(action==='record')return {kind:'json',body:await templateExchange.inspectRecord(dossierId,options)};
      if(action==='publication')return {kind:'json',body:await templateExchange.publication(dossierId,options)};
      if(action==='operation')return {kind:'json',body:await templateExchange.operation(dossierId,options)};
      if(action.startsWith('blobs/')){
        const sha256=action.slice(6);requireValue(/^[a-f0-9]{64}$/u.test(sha256),'TEMPLATE_BLOB_ID_INVALID');
        const value=await templateExchange.readBlob(dossierId,{revision:options.revision,sha256});
        const filename=query.filename?workbookFilename(String(query.filename)):sha256+'.bin';
        return {kind:'file',body:value.body,filename,contentType:filename.endsWith('.xlsx')?
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':/\.(csv|tsv)$/iu.test(filename)?'text/plain; charset=utf-8':'application/octet-stream',
          sha256:hashBytes(value.body),revision:value.revision};
      }
    }
    requireValue(method==='POST'&&TEMPLATE_POST_ACTIONS.includes(action),'TEMPLATE_ROUTE_NOT_FOUND',404);
    const result=action==='stage-template'?await templateExchange.stageWorkbook(bodyFile(body)):
      action==='stage-mapping'?await templateExchange.stageMapping(dossierId,body):
      action==='stage-release'?await templateExchange.stageRelease(dossierId,body):
      action==='stage-return'?await templateExchange.stageReturn(dossierId,bodyFile(body)):
      action==='stage-return-review'?await templateExchange.stageReturnReview(dossierId,body):
      action==='prepare-extraction-draft'?await templateExchange.prepareExtractionDraft(dossierId,body):
      action==='accept-extraction-draft'?await templateExchange.acceptExtractionDraft(dossierId,body):
      await templateExchange.review(dossierId,body);
    return {kind:'json',body:result};
  };
}
