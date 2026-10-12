// MIT. Additive commissioning routes on the original authenticated Central listener.
import { fault } from '../../odata/state.mjs';
export const COMMISSIONING_ASSETS=new Map([
  ['/commissioning/',{url:new URL('./index.html',import.meta.url),type:'text/html; charset=utf-8'}],
  ['/commissioning/browser.mjs',{url:new URL('./browser.mjs',import.meta.url),type:'text/javascript; charset=utf-8'}],
  ['/commissioning/style.css',{url:new URL('./style.css',import.meta.url),type:'text/css; charset=utf-8'}],
  ['/commissioning/agreement.example.json',{url:new URL('./agreement.example.json',import.meta.url),type:'application/json; charset=utf-8'}],
]);
const actions=new Set(['recordHost','inspect','saveDraft','prepare','install','capturePeriod','resumeCapture','deliver','readiness']);
/**
 * Trusted-code extension ABI: the original server checks Host/Origin first,
 * serves fixed assets, then authenticates before invoking handle().
 * It retains its original JSON/error/download handling and workspace lease.
 */
export function createCommissioningExtension({workspace,commissioning}={}) {
  if(!workspace?.directory||typeof commissioning?.state!=='function')
    throw fault('CENTRAL_COMMISSIONING_EXTENSION','Compose the original workspace and commissioning model first.');
  return Object.freeze({name:'commissioning',assets:COMMISSIONING_ASSETS,
    async handle({request,response,address,body,json}) {
      if(request.method==='GET'&&address.pathname==='/api/commissioning/state'){
        json(response,200,commissioning.state());return true;
      }
      const match=/^\/api\/commissioning\/([A-Za-z]+)$/.exec(address.pathname);
      if(request.method!=='POST'||!match||!actions.has(match[1]))return false;
      const input=await body(request);
      if(!input||typeof input!=='object'||Array.isArray(input))throw fault('CENTRAL_COMMISSIONING_HTTP_INPUT','Use an action object.');
      const value=await commissioning[match[1]](input);
      json(response,match[1]==='capturePeriod'||match[1]==='resumeCapture'?202:200,
        {ok:true,result:value,operationId:input.requestId??input.id??input.captureId??null});
      return true;
    }});
}
