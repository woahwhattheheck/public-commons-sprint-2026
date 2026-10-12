// MIT. Additive routes use the original Research host authentication and headers.
import {readFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {CONTROL_LIMIT,identifier,need} from './contracts.mjs';
const assets=new Map([
 ['/customer-commerce.html',[new URL('./public/index.html',import.meta.url),'text/html; charset=utf-8']],
 ['/customer-commerce/browser.mjs',[new URL('./public/browser.mjs',import.meta.url),'text/javascript; charset=utf-8']],
 ['/customer-commerce/style.css',[new URL('./public/style.css',import.meta.url),'text/css; charset=utf-8']],
]);
export async function readResearchCommerceAsset(path){
 const selected=assets.get(path);
 return selected?{body:await readFile(selected[0]),contentType:selected[1]}:null;
}
function query(url){
 const value={};
 for(const key of ['offset','limit']){
  const raw=url.searchParams.get(key);
  if(raw!==null){need(/^(0|[1-9][0-9]{0,8})$/.test(raw),'RESEARCH_COMMERCE_PAGE_INVALID');value[key]=Number(raw);}
 }
 const snapshot=url.searchParams.get('snapshot');if(snapshot!==null)value.snapshot=snapshot;
 need([...url.searchParams.keys()].every(key=>['offset','limit','snapshot'].includes(key)),
  'RESEARCH_COMMERCE_QUERY_INVALID');
 return value;
}
export async function handleResearchCommerceRoute({req,res,url,send,readJson,controller,headers={}}={}){
 const prefix='/api/customer-commerce',path=url.pathname;
 if(!path.startsWith(prefix+'/'))return false;
 let dispatched=false;
 try{
  need(controller,'RESEARCH_COMMERCE_ORIGINAL_WORKSPACE_REQUIRED');
  const relative=path.slice(prefix.length);
  if(req.method==='GET'&&relative==='/configuration'){send(200,await controller.configuration());return true;}
  const collection=relative.match(/^\/(publications|purchases)$/);
  if(req.method==='GET'&&collection){send(200,await controller.list(collection[1],query(url)));return true;}
  const item=relative.match(/^\/(publications|purchases)\/([a-f0-9-]{36})$/);
  if(req.method==='GET'&&item){
   identifier(item[2]);
   need([...url.searchParams.keys()].every(key=>key==='refresh')&&
    [null,'true','false'].includes(url.searchParams.get('refresh')),'RESEARCH_COMMERCE_QUERY_INVALID');
   send(200,item[1]==='publications'?await controller.publication(item[2]):
    await controller.purchase(item[2],{refresh:url.searchParams.get('refresh')==='true'}));return true;
  }
  const file=relative.match(/^\/(publications|purchases)\/([a-f0-9-]{36})\/files\/(publication|handoff|archive|received)$/);
  if(req.method==='GET'&&file){
   identifier(file[2]);need([...url.searchParams.keys()].every(key=>key==='metadata')&&
    [null,'true'].includes(url.searchParams.get('metadata')),'RESEARCH_COMMERCE_QUERY_INVALID');
   if(url.searchParams.get('metadata')==='true'){
    send(200,await controller.fileInfo({kind:file[1],id:file[2],file:file[3]}));return true;
   }
   await controller.streamFile({kind:file[1],id:file[2],file:file[3]},async source=>{
    const body=Readable.from(source.stream);
    res.writeHead(200,{...headers,'Content-Type':source.contentType,'Content-Length':source.bytes,
     'X-Content-SHA256':source.sha256,'Content-Disposition':'attachment; filename="'+source.name+'"'});
    try{await pipeline(body,res);}finally{body.destroy();}
   });return true;
  }
  if(req.method==='POST'){
   need(url.searchParams.size===0,'RESEARCH_COMMERCE_QUERY_INVALID');
   const actions={
    '/publications/prepare':body=>controller.preparePublication(body),
    '/publications/enroll':body=>controller.enrollPublication(body),
    '/purchases/receive':body=>controller.receivePurchase(body),
    '/purchases/prepare':body=>controller.preparePurchase(body),
    '/purchases/execute':body=>controller.purchaseAction('execute',body),
    '/purchases/retrieve':body=>controller.purchaseAction('retrieve',body),
    '/purchases/recover':body=>controller.purchaseAction('recover',body),
    '/purchases/finalize':body=>controller.purchaseAction('finalize',body),
    '/purchases/cancel':body=>controller.purchaseAction('cancel',body),
    '/purchases/reconcile':body=>controller.reconcilePurchase(body),
    '/purchases/receive-dossier':body=>controller.receiveDossier(body),
   };
   const action=actions[relative];need(action,'RESEARCH_COMMERCE_ROUTE_NOT_FOUND');
   const body=await readJson(req,CONTROL_LIMIT);dispatched=true;
   send(200,await action(body));return true;
  }
  send(404,{error:'RESEARCH_COMMERCE_ROUTE_NOT_FOUND'});return true;
 }catch(error){
  if(res.headersSent){res.destroy(error);return true;}
  const code=/^[A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'RESEARCH_COMMERCE_OPERATION_FAILED';
  const outcomeUnknown=typeof error.outcomeUnknown==='boolean'?error.outcomeUnknown:dispatched;
  const status=outcomeUnknown?503:/LIMIT|CAPACITY|TOO_LARGE/.test(code)?413:
   /CHANGED|CONFLICT|REUSED|ALREADY|UNCERTAIN|RECONCILIATION|BUSY/.test(code)?409:code==='ENOENT'?404:400;
  send(status,{error:code,...(req.method==='POST'?{outcomeUnknown}:{}),
   ...(error.researchCommerce?{researchCommerce:error.researchCommerce}:{}),
   ...(error.requestId?{requestId:error.requestId}:{}),
   ...(error.researchCommerceClose?{closeError:error.researchCommerceClose}:{})});
  return true;
 }
}
