// MIT. Browser and tools operate one original authenticated webhook listener.
import {readWebhookFeedSession} from './connection.mjs';
import {need,decode} from './contracts.mjs';
const routes={state:['GET','status'],source_save:['POST','source'],feed_save:['POST','feed'],events:['GET','events'],event:['GET','event'],preview:['GET','preview'],plan_save:['POST','plan'],release:['POST','release'],snapshot:['POST','snapshot'],retention:['POST','retention']};
async function body(response,maximum){const parts=[];let size=0;for await(const part of response.body??[]){size+=part.length;need(size<=maximum,'WEBHOOK_OPERATIONS_RESPONSE_TOO_LARGE');parts.push(part);}return Buffer.concat(parts,size);}
export async function openWebhookFeedOperator(definition,{fetcher=fetch,signal}={}){
 const selected=await readWebhookFeedSession(definition);
 async function request(method,path,params={},maximum=16*1024*1024){
  const url=new URL('/api/'+path,selected.origin);if(method==='GET')for(const [key,value]of Object.entries(params))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  let response;
  try{response=await fetcher(url,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),headers:{authorization:'Bearer '+selected.token,origin:selected.origin,...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(params)}:{})});}
  catch(error){throw Object.assign(new Error('The configured original webhook listener is unavailable.'),{code:'WEBHOOK_OPERATIONS_TRANSPORT_FAILED',uncertain:method==='POST',cause:error.name});}
  let bytes;try{bytes=await body(response,maximum);}catch(error){throw Object.assign(new Error('The original webhook response ended before it could be read.'),{code:error.code??'WEBHOOK_OPERATIONS_TRANSPORT_FAILED',uncertain:method==='POST'});}let value;
  try{value=decode(bytes);}catch{throw Object.assign(new Error('The original listener returned an invalid JSON response.'),{code:'WEBHOOK_OPERATIONS_RESPONSE_INVALID',status:response.status,uncertain:method==='POST'});}
  if(!response.ok)throw Object.assign(new Error(value.error??'Webhook operation failed.'),{code:value.error??'WEBHOOK_OPERATIONS_HTTP_FAILED',status:response.status,details:value,uncertain:method==='POST'&&response.status>=500});
  return value;
 }
 const state=await request('GET','status');
 need(state.storeId===selected.session.storeId&&state.operation?.instanceId===selected.session.instanceId&&state.operation?.directory===definition.directory,'WEBHOOK_OPERATIONS_SESSION_CHANGED','The active listener changed. Reopen the configured original application.');
 return {storeId:selected.session.storeId,instanceId:selected.session.instanceId,endpoint:selected.origin,state,
  async call(action,args={}){const route=routes[action];need(route,'WEBHOOK_OPERATIONS_UNKNOWN_TOOL');if(action==='state')return state;return request(route[0],route[1],args);}
 };
}
