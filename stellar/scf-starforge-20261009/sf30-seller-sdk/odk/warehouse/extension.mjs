// MIT. Warehouse workflow on the original authenticated Central HTTP listener.
import { fault } from '../../odata/state.mjs';
export const WAREHOUSE_ASSETS=new Map([
  ['/warehouse/',{url:new URL('./index.html',import.meta.url),type:'text/html; charset=utf-8'}],
  ['/warehouse/browser.mjs',{url:new URL('./browser.mjs',import.meta.url),type:'text/javascript; charset=utf-8'}],
  ['/warehouse/style.css',{url:new URL('./style.css',import.meta.url),type:'text/css; charset=utf-8'}],
]);
const actions=new Set(['prepare','connect','inspect','review','import','periodReport','operation','approval','resume']);
export function createWarehouseExtension({workspace,warehouse}={}) {
  if(!workspace?.directory||typeof warehouse?.state!=='function')
    throw fault('CENTRAL_WAREHOUSE_EXTENSION','Compose the held original Central Store and warehouse model.');
  return Object.freeze({name:'warehouse',assets:WAREHOUSE_ASSETS,
    async handle({request,response,address,body,json}) {
      if(request.method==='GET'&&address.pathname==='/api/warehouse/state'){
        json(response,200,warehouse.state());return true;
      }
      const match=/^\/api\/warehouse\/([A-Za-z]+)$/.exec(address.pathname);
      if(request.method!=='POST'||!match||!actions.has(match[1]))return false;
      const input=await body(request);
      if(!input||typeof input!=='object'||Array.isArray(input))
        throw fault('CENTRAL_WAREHOUSE_HTTP_INPUT','Use an original action object.');
      const result=await warehouse[match[1]](input);
      json(response,200,{ok:true,result,operationId:input.requestId??null});return true;
    }});
}
