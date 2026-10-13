// MIT. Standard Web Request/Response integration, usable from a Next Node route.
import {need,bytes,secretEqual,jsonInput} from './value.mjs';
import {errorRecord} from './protocol.mjs';
import {MAX_PACKET} from './workspace.mjs';
import {createSettlementService} from './settlement-service.mjs';
import {createStellarSettlementReader} from './settlement-stellar.mjs';
import * as sdk from '@stellar/stellar-sdk';
const statusFor=e=>e.code==='UNAUTHORIZED'?401:e.code==='FORBIDDEN_ORIGIN'?403:/NOT_FOUND$/.test(e.code??'')?404:/CONFLICT|UNRESOLVED|BUSY|OWNER_REQUIRED|INCOMPLETE|RETIRED|UNAVAILABLE/.test(e.code??'')?409:422;
const filename=v=>String(v).replace(/[\r\n"\\]/g,'_');
async function readBody(request){const max=MAX_PACKET+64*1024*1024,parts=[];let n=0;const reader=request.body?.getReader();if(!reader)return jsonInput('');try{for(;;){const part=await reader.read();if(part.done)break;n+=part.value.byteLength;need(n<=max,'COMMAND_TOO_LARGE');parts.push(Buffer.from(part.value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return jsonInput(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}
export function createRouteHandler({workspace,token,apiPrefix='/api',authorize=null,allowedOrigins=null,settlementReaders=null}){
 need(typeof token==='string'&&token.length>=24||typeof authorize==='function','OPERATOR_AUTHORIZATION_REQUIRED');need(/^\/[a-zA-Z0-9/_-]+$/.test(apiPrefix)&&!apiPrefix.endsWith('/'),'API_PREFIX');
 const settlement=createSettlementService({workspace,readers:settlementReaders??[createStellarSettlementReader({sdk})]});
 const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const response=(status,value,extra={})=>new Response(Buffer.isBuffer(value)?value:bytes(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
 return async function handle(request){
  try{
   const url=new URL(request.url),route=url.pathname.slice(apiPrefix.length);need(url.pathname.startsWith(apiPrefix+'/')&&!url.search,'ROUTE_NOT_FOUND');
   need(authorize?await authorize(request):secretEqual(request.headers.get('authorization')??'','Bearer '+token),'UNAUTHORIZED');
   const origin=request.headers.get('origin');if(origin)need((allowedOrigins??[url.origin]).includes(origin),'FORBIDDEN_ORIGIN');
   if(request.method==='POST')need(request.headers.get('x-bim-workspace-id')===workspace.read().workspace.id,'WORKSPACE_ID_CONFLICT');
   if(request.method==='GET'&&route==='/bootstrap')return response(200,workspace.bootstrap());
   if(request.method==='GET'&&route==='/state')return response(200,workspace.state());
   if(request.method==='GET'&&route.startsWith('/request/')){const row=workspace.request(decodeURIComponent(route.slice(9)));return row.status==='COMPLETE'?response(200,row.response):response(409,{error:{code:'ORIGINAL_REQUEST_'+row.status,message:'Inspect this exact original request; lookup does not dispatch it.',details:{request:row}}});}
   if(request.method==='GET'&&route==='/export')return response(200,await workspace.portable(),{'Content-Disposition':'attachment; filename="bim-workspace.json"'});
   if(request.method==='GET'&&route.startsWith('/files/')){const {descriptor,data}=workspace.object(decodeURIComponent(route.slice(7)));return response(200,data,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+filename(descriptor.name)+'"','X-Content-SHA256':descriptor.sha256});}
   if(request.method==='GET'&&route.startsWith('/wallet/'))return response(200,workspace.wallet(decodeURIComponent(route.slice(8))));
   if(request.method==='GET'&&route.startsWith('/session/'))return response(200,workspace.session(decodeURIComponent(route.slice(9))),{'Pragma':'no-cache'});
   if(request.method==='POST'&&route.startsWith('/settlement/')){
    need((request.headers.get('content-type')??'').split(';')[0]==='application/json','JSON_CONTENT_TYPE_REQUIRED');
    const action=route.slice('/settlement/'.length),input=await readBody(request);
    need(input&&typeof input==='object'&&!Array.isArray(input),'OBJECT_REQUIRED');
    if(action==='file'){const file=settlement.file(input);return response(200,file.bytes,{'Content-Type':file.type,'Content-Disposition':'attachment; filename="'+filename(file.name)+'"','X-Content-SHA256':file.sha256,'Content-Length':String(file.bytes.length)});}
    if(action==='build')return response(200,await settlement.build(input.selection??{}));
    if(action==='receive')return response(200,settlement.receive(input.packet));
    if(action==='source')return response(200,settlement.source(input));
    if(action==='reviews')return response(200,settlement.reviews(input));
    if(action==='review-prepare')return response(200,settlement.prepareReview(input));
    if(action==='review'){const accepted=await settlement.review(input.review,input.envelope);return response(200,accepted,{'X-BIM-Replayed':accepted.replayed?'true':'false'});}
    throw Object.assign(new Error('SETTLEMENT_ROUTE_NOT_FOUND'),{code:'SETTLEMENT_ROUTE_NOT_FOUND'});
   }
   if(request.method==='POST'&&route==='/command'){need((request.headers.get('content-type')??'').split(';')[0]==='application/json','JSON_CONTENT_TYPE_REQUIRED');const accepted=await workspace.commandWithMeta(await readBody(request));return response(200,accepted.response,{'X-BIM-Replayed':accepted.replayed?'true':'false'});}
   throw Object.assign(new Error('ROUTE_NOT_FOUND'),{code:'ROUTE_NOT_FOUND'});
  }catch(e){const safe=errorRecord(e,{exchangeIds:Array.isArray(e.details?.exchangeIds)?e.details.exchangeIds:[]});if(e.code==='REVISION_CONFLICT')safe.details=e.details??{};return response(statusFor(e),{error:safe});}
 };
}
