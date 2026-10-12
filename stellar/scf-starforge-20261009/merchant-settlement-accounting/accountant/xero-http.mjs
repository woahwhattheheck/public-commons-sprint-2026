// MIT. Native Xero Accounting API transport. Credentials remain in process memory.
import {xeroCheck,xeroId,xeroParse,xeroCreateRequest} from './xero.mjs';
export const XERO_API_BASE='https://api.xero.com/api.xro/2.0/';
export const XERO_ACCESS_TOKEN_ENV='STARFORGE_XERO_ACCESS_TOKEN';
export class XeroHttpClient{
  constructor({fetchImpl=globalThis.fetch,tokenEnv=XERO_ACCESS_TOKEN_ENV,tokenProvider,timeoutMs=30000}={}){
    xeroCheck(typeof fetchImpl==='function','XERO_FETCH_REQUIRED','Provide the native HTTP transport.');
    xeroCheck(/^[A-Z][A-Z0-9_]{0,127}$/.test(tokenEnv),'INVALID_XERO_TOKEN_ENV','Name the configured Xero access-token environment variable.');
    xeroCheck(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=120000,'INVALID_XERO_TIMEOUT','Use a native request timeout of 1 to 120 seconds.');
    xeroCheck(tokenProvider===undefined||typeof tokenProvider==='function','INVALID_XERO_TOKEN_PROVIDER','Use the maintained server-side token provider.');
    this.fetch=fetchImpl;this.tokenEnv=tokenEnv;this.tokenProvider=tokenProvider;this.timeoutMs=timeoutMs;
  }
  available(){return Boolean(this.tokenProvider||process.env[this.tokenEnv]?.trim());}
  info(){return {available:this.available(),tokenEnv:this.tokenProvider?null:this.tokenEnv};}
  async request(tenantId,path,{method='GET',body,idempotencyKey,signal}={}){
    xeroId(tenantId);xeroCheck(this.available(),'XERO_CONNECTION_REQUIRED','Configure the managed Xero connection or '+this.tokenEnv+' in the original accounting server process.');
    const url=new URL(path,XERO_API_BASE);
    xeroCheck(url.origin==='https://api.xero.com'&&/^\/api\.xro\/2\.0\/(?:Organisation|Accounts|ManualJournals(?:\/[0-9a-f-]{36})?)$/.test(url.pathname)&&['GET','PUT'].includes(method),'INVALID_XERO_ENDPOINT','Use the original native Xero accounting endpoint.');
    xeroCheck(method!=='PUT'||url.pathname.endsWith('/ManualJournals')&&typeof idempotencyKey==='string'&&idempotencyKey.length<=128,'XERO_REQUEST_ID_REQUIRED','The exact draft creation requires its retained idempotency key.');
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    combined.throwIfAborted();
    const token=this.tokenProvider?await this.tokenProvider({tenantId,signal:combined}):process.env[this.tokenEnv]?.trim();
    xeroCheck(typeof token==='string'&&token.length>0&&token.length<=8000&&/^[A-Za-z0-9._~+/-]+=*$/.test(token),'XERO_TOKEN_UNAVAILABLE','The selected native connection did not provide a usable bearer.');
    combined.throwIfAborted();
    const headers={Authorization:'Bearer '+token,'xero-tenant-id':tenantId,Accept:'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
    const response=await this.fetch(url,{method,headers,redirect:'error',cache:'no-store',signal:combined,...(body===undefined?{}:{body:JSON.stringify(body)})});
    const chunks=[];let length=0;
    if(response.body){for await(const chunk of response.body){length+=chunk.length;xeroCheck(length<=64_000_000,'XERO_RESPONSE_TOO_LARGE','The native response exceeded 64 MB.');chunks.push(Buffer.from(chunk));}}
    const retainedHeaders={};for(const key of ['xero-correlation-id','x-daylimit-remaining','x-minlimit-remaining','x-appminlimit-remaining','retry-after']){const value=response.headers.get(key);if(value!==null)retainedHeaders[key]=value;}
    return {status:response.status,ok:response.ok,bytes:Buffer.concat(chunks),headers:retainedHeaders,receivedAt:new Date().toISOString(),request:{method,url:url.href,tenantId,idempotencyKey:idempotencyKey??null}};
  }
  async context(tenantId,{signal}={}){const organization=await this.request(tenantId,'Organisation',{signal});if(!organization.ok)return {organization,accounts:null};const accounts=await this.request(tenantId,'Accounts',{signal});return {organization,accounts};}
  async createDraft(plan,index,{signal}={}){const request=xeroCreateRequest(plan,index);return this.request(request.tenantId,request.path,{method:request.method,body:request.body,idempotencyKey:request.idempotencyKey,signal});}
  async readJournal(plan,index,{journalId,signal}={}){
    const journal=plan.journals[index];xeroCheck(journal,'XERO_JOURNAL_NOT_FOUND','Choose a retained journal.',404);
    if(journalId)return [await this.request(plan.context.tenantId,'ManualJournals/'+xeroId(journalId),{signal})];
    const responses=[];
    for(let page=1;page<=100;page++){
      const query=new URLSearchParams({where:'Narration=='+JSON.stringify(journal.narration),page:String(page),pageSize:'100'});
      const response=await this.request(plan.context.tenantId,'ManualJournals?'+query,{signal});responses.push(response);if(!response.ok)return responses;
      const source=xeroParse(response.bytes,'Native journal search');
      xeroCheck(Array.isArray(source.ManualJournals)&&source.ManualJournals.every(row=>row.Narration===journal.narration),'XERO_SEARCH_CHANGED','The native search returned a journal outside the exact retained narration.');
      if(source.ManualJournals.length===0)return responses;
    }
    throw Object.assign(new Error('The exact narration search did not reach its empty terminal page within 100 pages.'),{code:'XERO_SEARCH_INCOMPLETE'});
  }
}
