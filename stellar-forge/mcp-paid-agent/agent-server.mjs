/**
 * SF-32 - MCP buyer-side discover/preview/approved paid call bridge.
 * MIT. MCP 2025-11-25 JSON-RPC Streamable HTTP (single-response subset) and
 * canonical x402 v2 HTTP payment challenge / signed retry.
 * No wallet, payer, approval or private key lives in this source.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export const MCP_VERSION='2025-11-25';
const plain = x => x!==null && typeof x==='object' && !Array.isArray(x);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code,message)=>{const e=new Error(message);e.code=code;throw e;};
const resourceOrigin = url => {const u=new URL(url);if(u.username||u.password||!['https:','http:'].includes(u.protocol)||u.hash)fail('INVALID_RESOURCE','Invalid resource URL');return u.origin;};
const maxText = (v,max=512)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const strictBytes = (v,max=256*1024)=>{
  if(typeof v!=='string'||v.length>max||!/^[A-Za-z0-9+/]*={0,2}$/.test(v)||v.length%4===1)fail('INVALID_ENCODING','Malformed canonical base64');
  try {return JSON.parse(Buffer.from(v,'base64').toString('utf8'));}catch {fail('INVALID_ENCODING','Bad JSON in base64 header');}
};
const sameTerms=(a,b)=>['scheme','network','asset','amount','payTo'].every(k=>a?.[k]===b?.[k]);
const sanitizedPrice=a=>({scheme:a.scheme,network:a.network,asset:a.asset,amount:a.amount,payTo:a.payTo});
const asBool=r=>r===true;
async function readData(response,max=64*1024){
  const reader=response.body?.getReader();if(!reader)return {body:'',contentType:null,truncated:false};
  const chunks=[];let size=0,truncated=false;
  try {for(;;){const {done,value}=await reader.read();if(done)break;
    if(size+value.byteLength>max){chunks.push(value.subarray(0,Math.max(0,max-size)));size=max;truncated=true;break;}
    chunks.push(value);size+=value.byteLength;
  }}finally{if(truncated)await reader.cancel().catch(()=>{});reader.releaseLock();}
  const body=Buffer.concat(chunks).toString('utf8');
  return {body,contentType:response.headers.get('content-type')??null,truncated};
}
const statOf=q=>({quoteId:q.quoteId,status:q.status,resource:q.resource,method:q.method,
  selected:sanitizedPrice(q.accepted),expiresAt:q.expiresAt,attempts:q.attempts,
  result:q.result??null,failure:q.failure??null});
const defaultFetch=(...args)=>fetch(...args);
const schemas={
  bazaar_search:{
    name:'bazaar_search',description:'Search the configured Bazaar discovery server. Read only. Does not charge.',
    inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:1024},cursor:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},network:{type:'string'},scheme:{type:'string'},asset:{type:'string'},maxAmount:{type:'string'}},required:['query'],additionalProperties:false}},
  bazaar_preview:{
    name:'bazaar_preview',description:'Validate one discovered HTTP tool and request; return price/recipient/approval quote. Makes no provider request.',
    inputSchema:{type:'object',properties:{handle:{type:'string'},acceptIndex:{type:'integer',minimum:0},input:{type:'object'}},required:['handle'],additionalProperties:false}},
  bazaar_execute_approved:{
    name:'bazaar_execute_approved',description:'Attempt the quoted call ONLY when operator approval callback authorizes it; default denies. Never retries a potentially settled signed request.',
    inputSchema:{type:'object',properties:{quoteId:{type:'string'}},required:['quoteId'],additionalProperties:false}},
  bazaar_status:{name:'bazaar_status',description:'Inspect the exact state of a prior quote; no network call.',inputSchema:{type:'object',properties:{quoteId:{type:'string'}},required:['quoteId'],additionalProperties:false}},
  bazaar_cancel:{name:'bazaar_cancel',description:'Cancel an unexecuted quote. Signed/unknown transactions require external reconciliation.',inputSchema:{type:'object',properties:{quoteId:{type:'string'}},required:['quoteId'],additionalProperties:false}},
};
const TOOLS=Object.values(schemas);

/**
 * Ownership of signPayment and approve stays with the embedding operator.
 * The configured discovery base + outbound origin allowlist are NEVER derived
 * from a model-supplied URL. Default approval=false, signer=null, origins=[].
 */
export class McpPaidToolBroker {
  #catalogUrl;#trustedOrigins;#approve;#sign;#fetch;#records=new Map();#quotes=new Map();
  #timeLimit;#quoteTTL;#maxRecords;
  constructor({discoveryUrl,allowedResourceOrigins=[],approve=()=>false,signPayment=null,
    fetchImpl=defaultFetch,timeoutMs=8000,quoteTTL=10*60*1000,maxRecords=500}={}){
    if(!discoveryUrl)throw new TypeError('Explicit configured discoveryUrl required');
    this.#catalogUrl=new URL(discoveryUrl);
    if(!['https:','http:'].includes(this.#catalogUrl.protocol)||this.#catalogUrl.username||this.#catalogUrl.password||
      this.#catalogUrl.search||this.#catalogUrl.hash)throw new TypeError('Invalid configured discoveryUrl');
    this.#trustedOrigins=new Set(allowedResourceOrigins.map(resourceOrigin));
    if(typeof approve!=='function'||typeof fetchImpl!=='function')throw new TypeError('Operator hooks required');
    if(signPayment!==null&&typeof signPayment!=='function')throw new TypeError('Invalid signer callback');
    this.#approve=approve;this.#sign=signPayment;this.#fetch=fetchImpl;
    this.#timeLimit=timeoutMs;this.#quoteTTL=quoteTTL;this.#maxRecords=maxRecords;
  }
  async #get(url){
    const resp=await this.#fetch(url,{method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(this.#timeLimit)});
    if(!resp.ok)fail('DISCOVERY_UNAVAILABLE','Bazaar returned HTTP '+resp.status);
    const data=await readData(resp,2*1024*1024);if(data.truncated)fail('DISCOVERY_TOO_LARGE','Bazaar response exceeds configured limit');
    let value;try{value=JSON.parse(data.body);}catch{fail('DISCOVERY_INVALID','Invalid Bazaar JSON');}
    if(!plain(value)||!Array.isArray(value.resources))fail('DISCOVERY_INVALID','Invalid Bazaar result');
    return value;
  }
  async search(args){
    if(!plain(args)||!maxText(args.query,1024)||!args.query.trim())fail('INVALID_PARAMS','Search query required');
    const u=new URL('/discovery/search',this.#catalogUrl);
    for(const k of ['query','cursor','limit','network','scheme','asset','maxAmount']){
      const v=args[k];if(v===undefined)continue;
      if(!['limit'].includes(k)&&!maxText(v,4096))fail('INVALID_PARAMS','Invalid '+k);
      if(k==='limit'&&(!Number.isSafeInteger(v)||v<1||v>100))fail('INVALID_PARAMS','Invalid limit');
      u.searchParams.set(k,String(v));
    }
    const body=await this.#get(u);
    const listed=[];
    for(const row of body.resources.slice(0,100)){
      const input=row?.extensions?.bazaar?.info?.input;
      const url=row?.resource?.url;
      if(typeof url!=='string'||!plain(input)||!['http','mcp'].includes(input.type)||!Array.isArray(row.accepts)||!row.accepts.length)continue;
      let origin;try{origin=resourceOrigin(url);}catch{continue;}
      const eligible=row.accepts.filter(a=>{
        if(args.asset!==undefined&&a?.asset!==args.asset)return false;
        if(args.network!==undefined&&a?.network!==args.network)return false;
        if(args.scheme!==undefined&&a?.scheme!==args.scheme)return false;
        if(args.maxAmount!==undefined){
          if(!/^(0|[1-9]\d*)$/.test(args.maxAmount))fail('INVALID_PARAMS','maxAmount requires nonnegative integer base units');
          if(!/^(0|[1-9]\d*)$/.test(a?.amount??''))return false;
          if(BigInt(a.amount)>BigInt(args.maxAmount))return false;
        }
        return true;
      });
      if(!eligible.length)continue;
      const info={resource:row.resource,input,accepts:eligible,origin,
        fingerprint:hash([url,input,eligible]),type:input.type};
      const handle=randomUUID();this.#records.set(handle,{...info,createdAt:Date.now()});
      listed.push({handle,resource:row.resource,resourceType:input.type,
        method:input.method??null,toolName:input.toolName??null,
        accepts:eligible.map(sanitizedPrice),allowedOrigin:this.#trustedOrigins.has(origin)});
    }
    while(this.#records.size>this.#maxRecords)this.#records.delete(this.#records.keys().next().value);
    return {resources:listed,partialResults:body.partialResults??false,pagination:body.pagination??null};
  }
  preview({handle,acceptIndex=0,input={}}={}){
    const row=this.#records.get(handle);
    if(!row||Date.now()-row.createdAt>this.#quoteTTL)fail('RESOURCE_STALE','Search this resource again');
    if(!this.#trustedOrigins.has(row.origin))fail('ORIGIN_UNAPPROVED','Operator has not approved this exact resource origin');
    if(row.type!=='http')fail('MCP_REMOTE_NOT_SUPPORTED','Discovered MCP tool is visible but executing remote MCP tools requires a separate approved transport adapter');
    if(!Number.isSafeInteger(acceptIndex)||acceptIndex<0||acceptIndex>=row.accepts.length)fail('INVALID_PARAMS','Invalid accepted payment option');
    const method=row.input.method;
    // Probing non-idempotent operations before payment could perform work twice.
    if(!['GET','HEAD'].includes(method))fail('UNSAFE_PROBE','Only safely probeable GET/HEAD paid routes can execute in this adapter');
    if(!plain(input))fail('INVALID_PARAMS','Input must be an object');
    const qs=input.query??{};if(!plain(qs)||Object.keys(input).some(k=>k!=='query'))fail('INVALID_PARAMS','Only query input supported for GET/HEAD');
    if(Object.keys(qs).length>30)fail('INVALID_PARAMS','Too many query parameters');
    const allowed=row.input.queryParams&&plain(row.input.queryParams)?Object.keys(row.input.queryParams):[];
    if(Object.keys(qs).some(k=>!allowed.includes(k)))fail('INPUT_NOT_ADVERTISED','Query keys must be advertised by the seller');
    const u=new URL(row.resource.url);
    for(const [k,v] of Object.entries(qs)){
      if(!maxText(k,100)||!maxText(v,1024))fail('INVALID_PARAMS','Invalid query value');
      u.searchParams.set(k,v);
    }
    const accepted=row.accepts[acceptIndex];
    if(!['exact','upto'].includes(accepted?.scheme)||!['stellar:testnet','stellar:pubnet'].includes(accepted?.network)||
      !/^(0|[1-9]\d*)$/.test(accepted?.amount??'')||
      ![accepted.payTo,accepted.asset].every(x=>typeof x==='string'&&x.length>0))fail('INVALID_PAYMENT_TERMS','Unsupported or invalid Stellar payment option');
    const quoteId=randomUUID();const q={quoteId,resource:row.resource.url,method,url:u.toString(),accepted:structuredClone(accepted),
      status:'PREVIEWED',fingerprint:row.fingerprint,expiresAt:Date.now()+this.#quoteTTL,attempts:0,
      signedRequestDispatched:false};
    this.#quotes.set(quoteId,q);
    while(this.#quotes.size>Math.max(500,this.#maxRecords*4))this.#quotes.delete(this.#quotes.keys().next().value);
    return {...statOf(q),warning:'No payment has been made. An independent operator approval and signer are required to execute.'};
  }
  status({quoteId}={}){const q=this.#quotes.get(quoteId);if(!q)fail('QUOTE_UNKNOWN','Unknown quote');return statOf(q);}
  cancel({quoteId}={}){
    const q=this.#quotes.get(quoteId);if(!q)fail('QUOTE_UNKNOWN','Unknown quote');
    if(q.status==='PREVIEWED'){q.status='CANCELLED';return statOf(q);}
    if(q.status==='EXECUTING'){
      q.status=q.signedRequestDispatched?'INDETERMINATE':'CANCEL_REQUESTED';
      q.failure=q.signedRequestDispatched?'Signed call may have reached merchant; reconcile before any reattempt':null;
      return statOf(q);
    }
    return statOf(q);
  }
  async execute({quoteId}={}){
    const q=this.#quotes.get(quoteId);if(!q)fail('QUOTE_UNKNOWN','Unknown quote');
    if(q.status!=='PREVIEWED')return statOf(q); // replay never dispatches a second request
    if(Date.now()>q.expiresAt){q.status='EXPIRED';return statOf(q);}
    if(!this.#sign)fail('SIGNER_NOT_CONNECTED','Operator has not connected an x402 v2 signer');
    // Approval is an out-of-model trusted callback; "approved":true tool args never count.
    const permission=await this.#approve(Object.freeze({quoteId:q.quoteId,resource:q.resource,requestUrl:q.url,method:q.method,accepted:structuredClone(q.accepted)}));
    if(!asBool(permission))fail('APPROVAL_REQUIRED','Operator independently denied or has not authorized payment');
    q.status='EXECUTING';q.attempts++;
    try {
      const first=await this.#fetch(q.url,{method:q.method,headers:{accept:'application/json'},signal:AbortSignal.timeout(this.#timeLimit)});
      if(q.status==='CANCEL_REQUESTED'){q.status='CANCELLED';return statOf(q);}
      if(first.status!==402){
        q.status=first.ok?'FREE_SUCCESS':'PROBE_REJECTED';
        q.result={httpStatus:first.status,paid:false,content:first.ok?await readData(first):null};return statOf(q);
      }
      const header=first.headers.get('payment-required');
      const required=strictBytes(header);
      if(required?.x402Version!==2||required?.resource?.url!==q.resource||!Array.isArray(required.accepts)||
        !required.accepts.some(a=>sameTerms(a,q.accepted)))fail('CHALLENGE_MISMATCH','402 payment terms differ from quoted catalog');
      if(q.status==='CANCEL_REQUESTED'){q.status='CANCELLED';return statOf(q);}
      const payload=await this.#sign(Object.freeze({quoteId,resource:structuredClone(required.resource),
        accepted:structuredClone(q.accepted),paymentRequired:structuredClone(required)}));
      if(payload?.x402Version!==2||payload?.resource?.url!==q.resource||!sameTerms(payload?.accepted,q.accepted)||
        !plain(payload?.payload))fail('SIGNER_INVALID','Signer returned mismatched x402 v2 payload');
      if(q.status==='CANCEL_REQUESTED'){q.status='CANCELLED';return statOf(q);}
      q.signedRequestDispatched=true;
      const second=await this.#fetch(q.url,{method:q.method,headers:{accept:'application/json','PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload)).toString('base64')},signal:AbortSignal.timeout(this.#timeLimit)});
      if(q.status==='INDETERMINATE')return statOf(q);
      const responseHeader=second.headers.get('payment-response');
      let receipt=null;if(responseHeader){try{receipt=strictBytes(responseHeader);}catch{receipt=null;}}
      q.result={httpStatus:second.status,paidAttempted:true,content:second.ok?await readData(second):null,paymentResponse:receipt?{
        success:receipt.success===true,network:receipt.network??null,transaction:receipt.transaction??null}:null};
      q.status=second.ok&&receipt?.success===true?'CONFIRMED_BY_SERVER':'INDETERMINATE';
      if(q.status==='INDETERMINATE')q.failure='Signed request dispatched; obtain provider reconciliation before any reattempt';
      return statOf(q);
    }catch(e){
      q.status=q.signedRequestDispatched?'INDETERMINATE':'REJECTED';
      q.failure=q.signedRequestDispatched?'Signed request outcome uncertain; do not retry automatically':String(e.code||'PROVIDER_ERROR');
      return statOf(q);
    }
  }
  async call(name,args={}){
    switch(name){
      case 'bazaar_search':return this.search(args);
      case 'bazaar_preview':return this.preview(args);
      case 'bazaar_execute_approved':return this.execute(args);
      case 'bazaar_status':return this.status(args);
      case 'bazaar_cancel':return this.cancel(args);
      default:fail('TOOL_NOT_FOUND','Unknown tool '+String(name));
    }
  }
}

const jsonErr=(code,message,id=null)=>({jsonrpc:'2.0',id,error:{code,message}});
const rpcReply=(id,result)=>({jsonrpc:'2.0',id,result});
const safeCompare=(a,b)=>{
  const A=Buffer.from(String(a??'')),B=Buffer.from(String(b??''));
  return A.length===B.length&&timingSafeEqual(A,B);
};
/**
 * The transport is meant for an operator-controlled 127.0.0.1 listener.
 * It offers JSON-only responses, no SSE stream, tasks, roots or server push.
 */
export function createMcpHttpHandler(broker,{bearerToken,allowedClientOrigins=[]}={}){
  if(!(broker instanceof McpPaidToolBroker))throw new TypeError('Broker required');
  if(typeof bearerToken!=='string'||bearerToken.length<24)throw new TypeError('Strong operator access token required');
  const allowedOrigins=new Set(allowedClientOrigins);
  return async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    const origin=req.headers.origin;
    if(origin&&!allowedOrigins.has(origin))return send(403,jsonErr(-32000,'Origin not allowed'));
    if(!safeCompare(req.headers.authorization,`Bearer ${bearerToken}`))return send(401,jsonErr(-32001,'Unauthorized'));
    if(req.method==='GET')return send(405,jsonErr(-32601,'SSE stream not supported'));
    if(req.method!=='POST')return send(405,jsonErr(-32601,'POST required'));
    if(!String(req.headers['content-type']??'').toLowerCase().startsWith('application/json'))return send(415,jsonErr(-32600,'Content type must be application/json'));
    const accept=String(req.headers.accept??'');
    if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return send(406,jsonErr(-32600,'Accept must include application/json and text/event-stream'));
    let raw='';try{
      for await(const c of req){raw+=c.toString('utf8');if(raw.length>128*1024)throw new Error('Too large');}
    }catch{return send(413,jsonErr(-32700,'Invalid or oversized body'));}
    let rpc;try{rpc=JSON.parse(raw);}catch{return send(400,jsonErr(-32700,'Parse error'));}
    const id=rpc?.id??null;
    if(!plain(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||Array.isArray(rpc))return send(400,jsonErr(-32600,'Invalid JSON-RPC request',id));
    if(rpc.method==='notifications/initialized'){
      res.writeHead(202);res.end();return;
    }
    if(rpc.method!=='initialize'&&req.headers['mcp-protocol-version']!==MCP_VERSION)return send(400,jsonErr(-32602,'Unsupported or missing MCP-Protocol-Version',id));
    if(id===null && rpc.method!=='notifications/initialized')return send(400,jsonErr(-32600,'Request ID required'));
    if(rpc.method==='initialize')return send(200,rpcReply(id,{protocolVersion:MCP_VERSION,
      capabilities:{tools:{listChanged:false}},serverInfo:{name:'stellar-bazaar-paid-bridge',version:'0.1.0'},
      instructions:'Search and preview are read-only. Calls need out-of-band operator approval and an external x402 signer.'}));
    if(rpc.method==='ping')return send(200,rpcReply(id,{}));
    if(rpc.method==='tools/list')return send(200,rpcReply(id,{tools:TOOLS}));
    if(rpc.method!=='tools/call')return send(200,jsonErr(-32601,'Method not found',id));
    const name=rpc.params?.name,args=rpc.params?.arguments??{};
    if(typeof name!=='string'||!plain(args))return send(200,jsonErr(-32602,'Invalid tool arguments',id));
    try{
      const data=await broker.call(name,args);
      return send(200,rpcReply(id,{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false}));
    }catch(e){
      const err={code:e.code??'TOOL_ERROR',reason:e.message??'Error'};
      return send(200,rpcReply(id,{content:[{type:'text',text:JSON.stringify(err)}],structuredContent:err,isError:true}));
    }
  };
}
