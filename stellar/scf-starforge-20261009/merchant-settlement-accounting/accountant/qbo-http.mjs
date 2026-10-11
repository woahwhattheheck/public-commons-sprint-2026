// MIT. Native QuickBooks Online transport for the maintained accountant workspace.
import {qboCheck as check,qboId,qboCanonical,validateQboPlan} from './qbo.mjs';
import {normalizeQboCompany} from './qbo-company.mjs';

export const QBO_API_BASES=Object.freeze({sandbox:'https://sandbox-quickbooks.api.intuit.com',production:'https://quickbooks.api.intuit.com'});
export const QBO_ACCESS_TOKEN_ENV='STARFORGE_QBO_ACCESS_TOKEN';
const MAX_BYTES=8*1024*1024;
const realm=value=>{check(typeof value==='string'&&/^[0-9]{1,64}$/.test(value),'QBO_CONNECTION_REALM','Configure the exact native QuickBooks company ID.');return value;};
const parse=bytes=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Object.assign(new Error('QuickBooks returned an invalid JSON response.'),{code:'QBO_NATIVE_JSON'});}};
export function qboRetryAt(response,at=Date.now()){
  if(response.status!==429)return null;
  const raw=response.headers?.['retry-after'],seconds=raw&&/^\d+$/.test(raw)?Number(raw)*1000:0,date=raw?Date.parse(raw):NaN;
  return new Date(Math.max(at+60_000,seconds?at+seconds:0,Number.isFinite(date)?date:0)).toISOString();
}
export class QboHttpClient{
  constructor({fetchImpl=globalThis.fetch,tokenEnv=QBO_ACCESS_TOKEN_ENV,tokenProvider,
    realmId=process.env.STARFORGE_QBO_REALM_ID??'',environment=process.env.STARFORGE_QBO_ENVIRONMENT??'sandbox',
    minorVersion=process.env.STARFORGE_QBO_MINOR_VERSION??null,timeoutMs=30_000}={}){
    check(typeof fetchImpl==='function','QBO_FETCH_REQUIRED','Provide the native HTTP transport.');
    check(/^[A-Z][A-Z0-9_]{0,127}$/.test(tokenEnv),'QBO_TOKEN_ENV','Name the configured access-token environment variable.');
    check(tokenProvider===undefined||typeof tokenProvider==='function','QBO_TOKEN_PROVIDER','Use the configured native OAuth token provider.');
    check(Object.hasOwn(QBO_API_BASES,environment),'QBO_CONNECTION_ENVIRONMENT','Choose the native sandbox or production connection.');
    check(realmId===''||/^[0-9]{1,64}$/.test(realmId),'QBO_CONNECTION_REALM','Configure the exact native QuickBooks company ID.');
    check(minorVersion===null||/^[1-9][0-9]{0,3}$/.test(String(minorVersion)),'QBO_MINOR_VERSION','Use a supported native minor-version number.');
    check(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=120000,'QBO_HTTP_TIMEOUT','Use a native request timeout of 1 to 120 seconds.');
    Object.assign(this,{fetch:fetchImpl,tokenEnv,tokenProvider,realmId,environment,minorVersion:minorVersion===null?null:String(minorVersion),timeoutMs});
  }
  available(){return Boolean(this.realmId&&(this.tokenProvider||process.env[this.tokenEnv]?.trim()));}
  info(){return {available:this.available(),realmId:this.realmId||null,environment:this.environment,tokenEnv:this.tokenEnv,minorVersion:this.minorVersion};}
  target(value={}){
    check(this.available(),'QBO_CONNECTION_REQUIRED','Configure '+this.tokenEnv+' and STARFORGE_QBO_REALM_ID in the original accounting server process.',409);
    realm(this.realmId);
    check((value.realmId??this.realmId)===this.realmId&&(value.environment??this.environment)===this.environment,
      'QBO_CONNECTION_CHANGED','The selected company and environment must match this server connection.',409);
    return this.info();
  }
  endpoint(path,{query,requestId}={}){
    realm(this.realmId);
    check(path==='query'||path==='preferences'||path==='companyinfo/'+this.realmId||/^journalentry(?:\/[0-9]{1,64})?$/.test(path),
      'QBO_NATIVE_ENDPOINT','Use the original QuickBooks accounting endpoint.');
    const url=new URL('/v3/company/'+this.realmId+'/'+path,QBO_API_BASES[this.environment]);
    if(this.minorVersion!==null)url.searchParams.set('minorversion',this.minorVersion);
    if(query!==undefined){check(path==='query'&&typeof query==='string','QBO_NATIVE_QUERY','Use the native accounting query endpoint.');url.searchParams.set('query',query);}
    if(requestId!==undefined){qboId(requestId);check(path==='journalentry','QBO_NATIVE_REQUEST_ID','Bind the request identity to its journal creation.');url.searchParams.set('requestid',requestId);}
    return url;
  }
  async request(path,{method='GET',body,requestId,query,signal}={}){
    this.target();check(method==='GET'||method==='POST'&&path==='journalentry'&&requestId,'QBO_NATIVE_METHOD','Use a retained native journal request.');
    const url=this.endpoint(path,{query,requestId});let token;
    try{token=this.tokenProvider?await this.tokenProvider({realmId:this.realmId,environment:this.environment,signal}):process.env[this.tokenEnv]?.trim();}
    catch{throw Object.assign(new Error('The configured OAuth provider could not supply a current access token.'),{code:'QBO_CONNECTION_REQUIRED'});}
    check(typeof token==='string'&&token.length>0&&token.length<=16384&&!/[\r\n]/.test(token),'QBO_CONNECTION_REQUIRED','The configured OAuth provider must return a current access token.',409);
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const headers={Authorization:'Bearer '+token,Accept:'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    let response;
    try{response=await this.fetch(url,{method,headers,signal:combined,redirect:'error',cache:'no-store',...(body===undefined?{}:{body:Buffer.from(body)})});}
    catch(error){throw Object.assign(new Error('The native request ended before a complete response was retained. Resume the original operation.'),{code:'QBO_NATIVE_RESPONSE_UNCERTAIN',cause:error});}
    const chunks=[];let length=0;
    try{if(response.body)for await(const chunk of response.body){length+=chunk.length;check(length<=MAX_BYTES,'QBO_NATIVE_RESPONSE_SIZE','The native response exceeds the supported 8 MiB source size.');chunks.push(Buffer.from(chunk));}}
    catch(error){throw Object.assign(new Error('The native response stream ended before its exact result was retained. Resume the original operation.'),{code:'QBO_NATIVE_RESPONSE_UNCERTAIN',cause:error});}
    const kept={};for(const key of ['intuit_tid','retry-after','date']){const value=response.headers.get(key);if(value!==null)kept[key]=value;}
    return {status:response.status,ok:response.ok,bytes:Buffer.concat(chunks),headers:kept,receivedAt:new Date().toISOString(),
      request:{method,url:url.href,realmId:this.realmId,environment:this.environment,requestId:requestId??null}};
  }
  async company(value={}, {signal}={}){
    this.target(value);const native=[];
    const get=async(path,query)=>{
      const response=await this.request(path,{query,signal});native.push(response);
      if(!response.ok){
        const retryAt=qboRetryAt(response);
        throw Object.assign(new Error(retryAt?'QuickBooks requested a pause until '+retryAt+'. Fetch the company again at or after that time.':'The native company request returned HTTP '+response.status+'.'),
          {code:'QBO_COMPANY_FETCH_FAILED',status:response.status===429?429:502,retryAt,nativeStatus:response.status});
      }
      const document=parse(response.bytes);check(!document.Fault,'QBO_COMPANY_FETCH_FAULT','QuickBooks returned a company-source fault.');return {response,document};
    };
    const companyInfo=await get('companyinfo/'+this.realmId),preferences=await get('preferences'),pages=[];
    const seen=new Set();let position=1,totalBytes=companyInfo.response.bytes.length+preferences.response.bytes.length;
    for(;;){
      const page=await get('query','SELECT * FROM Account WHERE Active IN (true, false) STARTPOSITION '+position+' MAXRESULTS 1000');
      totalBytes+=page.response.bytes.length;check(totalBytes<=MAX_BYTES,'QBO_COMPANY_SOURCE_SIZE','The complete native company sources exceed 8 MiB.');
      const query=page.document.QueryResponse;check(query&&typeof query==='object','QBO_COMPANY_PAGE','The native account query omitted QueryResponse.');
      const accounts=query.Account??[];check(Array.isArray(accounts)&&accounts.length<=1000,'QBO_COMPANY_PAGE','The native account page is invalid.');
      if(query.startPosition!==undefined)check(Number(query.startPosition)===position,'QBO_COMPANY_PAGE_CHANGED','The native account page has a different starting position.');
      for(const account of accounts){check(typeof account.Id==='string'&&!seen.has(account.Id),'QBO_COMPANY_PAGE_CHANGED','An account identity repeated while reading native pages. Refresh the company source.');seen.add(account.Id);}
      pages.push(page.response.bytes.toString('utf8'));if(accounts.length<1000)break;position+=accounts.length;
    }
    const company=normalizeQboCompany({realmId:this.realmId,companyInfo:companyInfo.response.bytes,preferences:preferences.response.bytes,accounts:'['+pages.join(',')+']'});
    return {company,connection:this.info(),capturedAt:new Date().toISOString(),sourceRequests:native.map(({bytes,...response})=>({...response,bytes:bytes.length}))};
  }
  async *searchJournal(plan,{signal}={}){
    validateQboPlan(plan);this.target(plan);
    const quoted="'"+plan.docNumber.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";
    const seen=new Set();let position=1,total=0;
    for(;;){
      const response=await this.request('query',{query:'SELECT * FROM JournalEntry WHERE DocNumber = '+quoted+' STARTPOSITION '+position+' MAXRESULTS 1000',signal});
      let rows=[],error=null;
      try{if(response.ok){
        const document=parse(response.bytes);check(!document.Fault,'QBO_JOURNAL_QUERY_FAULT','QuickBooks returned a fault while finding the original journal.');
        const query=document.QueryResponse;check(query&&typeof query==='object','QBO_JOURNAL_QUERY','The native journal query omitted QueryResponse.');
        rows=query.JournalEntry??[];check(Array.isArray(rows)&&rows.length<=1000,'QBO_JOURNAL_QUERY','The native journal page is invalid.');
        if(query.startPosition!==undefined)check(Number(query.startPosition)===position,'QBO_JOURNAL_QUERY_CHANGED','The journal query returned a different page.');
        for(const row of rows){check(row.DocNumber===plan.docNumber&&typeof row.Id==='string'&&!seen.has(row.Id),'QBO_JOURNAL_QUERY_CHANGED','The exact journal query changed while reading its pages.');seen.add(row.Id);}
      }
      total+=response.bytes.length;check(total<=MAX_BYTES,'QBO_JOURNAL_QUERY_SIZE','The exact journal search exceeds the supported 8 MiB source size.');
      }catch(failure){error={code:failure.code??'QBO_JOURNAL_QUERY',message:String(failure.message??failure).slice(0,1000)};rows=[];}
      yield {response,rows,error};
      if(error||!response.ok||rows.length<1000)break;position+=rows.length;
    }
  }
  async readJournal(plan,journalId,{signal}={}){validateQboPlan(plan);this.target(plan);realm(journalId);return this.request('journalentry/'+journalId,{signal});}
  async createJournal(plan,{requestId,bytes,signal}={}){
    validateQboPlan(plan);this.target(plan);qboId(requestId);
    const body=Buffer.from(bytes);check(body.length>0&&body.length<=MAX_BYTES,'QBO_NATIVE_REQUEST_SIZE','Use the retained journal request.');
    check(qboCanonical(parse(body))===qboCanonical(plan.journalEntry),'QBO_NATIVE_REQUEST_CHANGED','Send only the exact reviewed JournalEntry payload.');
    return this.request('journalentry',{method:'POST',body,requestId,signal});
  }
}
