// MIT. Complete original quote/pricing operations use the authenticated Research listener.
import {readFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {readBrowserAssets} from '../../../distribution/browser-assets.mjs';
import {QUOTE_REQUEST_LIMIT,id,alias,need} from './contracts.mjs';
const assets=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
export async function readResearchQuoteAsset(path){
 const selected=assets.get(path);return selected?{body:await readFile(selected.url),contentType:selected.type}:null;
}
function parameters(url,allowed,numeric=[]){
 const value={};
 for(const [key,raw]of url.searchParams){
  need(allowed.includes(key)&&!Object.hasOwn(value,key),'RESEARCH_QUOTE_QUERY_INVALID');
  if(numeric.includes(key)){
   need(/^(0|[1-9][0-9]{0,8})$/.test(raw),'RESEARCH_QUOTE_QUERY_INVALID');value[key]=Number(raw);
  }else value[key]=raw;
 }
 return value;
}
function metadata(url){
 const value=parameters(url,['metadata']);
 need(value.metadata===undefined||value.metadata==='true','RESEARCH_QUOTE_QUERY_INVALID');
 return value.metadata==='true';
}
async function output(res,source,headers){
 need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(source.name??''),'RESEARCH_QUOTE_FILE_NAME_INVALID');
 const body=Readable.from(source.stream);
 res.writeHead(200,{...headers,'Content-Type':source.contentType,'Content-Length':source.bytes,
  'X-Content-SHA256':source.sha256,'Content-Disposition':'attachment; filename="'+source.name+'"'});
 try{await pipeline(body,res);}finally{body.destroy();}
}
export async function handleResearchQuoteRoute({req,res,url,send,readJson,controller,headers={}}={}){
 const prefix='/api/customer-quotes',path=url.pathname;if(!path.startsWith(prefix+'/'))return false;
 let dispatched=false;
 try{
  need(controller,'RESEARCH_QUOTE_ORIGINAL_WORKSPACE_REQUIRED');
  const relative=path.slice(prefix.length);
  if(req.method==='GET'){
   if(relative==='/configuration'){
    parameters(url,[]);send(200,await controller.configuration());return true;
   }
   if(relative==='/cases'){
    send(200,await controller.listCases(parameters(url,['q','status','dueOn','offset','limit'],['offset','limit'])));return true;
   }
   const selected=relative.match(/^\/cases\/([a-f0-9-]{36})$/);
   if(selected){id(selected[1]);send(200,await controller.readCase(selected[1],parameters(url,['revision'])));return true;}
   if(relative==='/operations'){
    send(200,await controller.list(parameters(url,['offset','limit','snapshot','dossierId','kind'],['offset','limit'])));return true;
   }
   const operation=relative.match(/^\/operations\/([a-f0-9-]{36})(\/files)?$/);
   if(operation){
    id(operation[1]);parameters(url,[]);
    send(200,operation[2]?await controller.files(operation[1]):await controller.operation(operation[1]));return true;
   }
   const file=relative.match(/^\/operations\/([a-f0-9-]{36})\/files\/([A-Za-z0-9][A-Za-z0-9._-]{0,179})$/);
   if(file){
    id(file[1]);
    if(metadata(url))send(200,await controller.fileInfo(file[1],file[2]));
    else await controller.streamFile(file[1],file[2],source=>output(res,source,headers));
    return true;
   }
  }
  if(req.method==='POST'){
   const download=relative.match(/^\/cases\/([a-f0-9-]{36})\/(download|tariff-download)$/);
   if(download){
    id(download[1]);const info=metadata(url),body=await readJson(req,QUOTE_REQUEST_LIMIT),
     tariff=download[2]==='tariff-download';
    if(info)send(200,await controller[tariff?'tariffFileInfo':'caseFileInfo'](download[1],body));
    else await controller[tariff?'streamTariffFile':'streamCaseFile'](download[1],body,source=>output(res,source,headers));
    return true;
   }
   parameters(url,[]);
   const actions={
    '/cases/create':body=>controller.createCase(body),
    '/prepare':body=>controller.prepare(body),
    '/responses/prepare':body=>controller.prepareResponse(body),
    '/apply':body=>controller.apply(body),
    '/publications/prepare':body=>controller.preparePublication(body),
    '/publications/enroll':body=>controller.enrollPublication(body),
    '/reports/prepare':body=>controller.prepareReport(body),
   };
   let action=actions[relative];
   const selected=relative.match(/^\/cases\/([a-f0-9-]{36})\/([a-z][a-z-]{0,79})$/),
    pricing=relative.match(/^\/pricing\/([a-z0-9][a-z0-9_-]{0,63})\/([a-z][a-z-]{0,79})$/);
   if(selected){id(selected[1]);action=body=>controller.caseAction(selected[1],selected[2],body);}
   if(pricing){alias(pricing[1]);action=body=>controller.pricing(pricing[1],pricing[2],body);}
   need(action,'RESEARCH_QUOTE_ROUTE_NOT_FOUND',404);
   const body=await readJson(req,QUOTE_REQUEST_LIMIT);dispatched=true;
   send(200,await action(body));return true;
  }
  send(404,{error:'RESEARCH_QUOTE_ROUTE_NOT_FOUND'});return true;
 }catch(error){
  if(res.headersSent){res.destroy(error);return true;}
  const code=/^[A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'RESEARCH_QUOTE_OPERATION_FAILED',
   outcomeUnknown=typeof error.outcomeUnknown==='boolean'?error.outcomeUnknown:
    error.requestState==='REJECTED'?false:dispatched;
  const status=outcomeUnknown?503:Number.isInteger(error.status)?error.status:
   /LIMIT|CAPACITY|TOO_LARGE/.test(code)?413:/CHANGED|CONFLICT|REUSED|ALREADY|UNCERTAIN|BUSY/.test(code)?409:
    /NOT_FOUND|ENOENT/.test(code)?404:400;
  send(status,{error:code,...(req.method==='POST'?{outcomeUnknown}:{}),
   ...(error.requestState?{requestState:error.requestState}:{}),
   ...(error.requestId?{requestId:error.requestId}:{}),
   ...(error.researchQuoteClose?{closeError:error.researchQuoteClose}:{})});return true;
 }
}
