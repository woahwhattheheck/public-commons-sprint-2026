// SPDX-License-Identifier: MIT
import {SCHEMA,need,fail,fields} from './common.mjs';
import {ACTIONS} from './server.mjs';
export class ReportDeskClient{
  constructor({url,expectedDeskId,fetchImpl=fetch,signal}){
    const parsed=new URL(url);need((parsed.protocol==='https:'||parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1')&&!parsed.username&&!parsed.password&&parsed.hash.startsWith('#access='),
      'CONNECTION_REQUIRED','Use the original private report desk launch link.',422);
    this.origin=parsed.origin;this.token=parsed.hash.slice(8);this.expectedDeskId=expectedDeskId;this.fetch=fetchImpl;this.signal=signal;this.apiBase=null;
  }
  async open(){
    need(this.expectedDeskId,'DESK_IDENTITY','Configure the exact original report desk identity.',422);
    this.apiBase='/api/'+this.expectedDeskId;const state=await this.read('state');
    need(state.schema===SCHEMA&&state.desk.id===this.expectedDeskId,'DESK_CHANGED','The selected server opens another report desk.');
    return state;
  }
  async request(path,input){
    need(this.apiBase,'DESK_IDENTITY','Open the exact original report desk first.');
    const signal=this.signal?AbortSignal.any([this.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
    let response;try{response=await this.fetch(this.origin+this.apiBase+'/'+path,{method:input===undefined?'GET':'POST',redirect:'error',signal,
      headers:{authorization:'Bearer '+this.token,...(input===undefined?{}:{'content-type':'application/json',origin:this.origin})},
      ...(input===undefined?{}:{body:JSON.stringify(input)})});}
    catch{throw fail('RESPONSE_UNCERTAIN','Read this same original operation before continuing; no replacement request was sent.',503);}
    const reader=response.body?.getReader(),chunks=[];let size=0;
    if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>36*1024*1024){await reader.cancel();throw fail('RESPONSE_BOUND','The original response exceeded its declared bound.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
    const raw=Buffer.concat(chunks);let result;try{result=JSON.parse(raw);}catch{throw fail('RESPONSE_UNCERTAIN','The original response was incomplete. Read this same operation.',503);}
    if(!response.ok)throw fail(result.error?.code??'NATIVE_REJECTED',result.error?.message??'The original report desk rejected the action.',response.status,result.error?.detail);
    return result;
  }
  read(name,id){need(['state','reports','cases','report','case','operation','publication','receiving'].includes(name),'READ_UNKNOWN','Choose an original desk read.');return this.request(name+(id===undefined?'':'?id='+encodeURIComponent(id)));}
  action(action,input){need(ACTIONS.includes(action),'ACTION_UNKNOWN','Choose an original desk action.');return this.request('action',{action,input});}
}
