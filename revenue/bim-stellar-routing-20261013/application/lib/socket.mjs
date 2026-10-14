import {NETWORKS,need,object,copy,text,stellarPublicKey} from "./moneygram-core.mjs";
export const SOCKET_SOURCE=Object.freeze({schema:"bim.socket-source.v1",packet:"F0C90612V6D",sha256:"7c4718cfdd918bb9f401b23e13d035113c6086bcc063d98b2f2533a2639b42c0",edition:"Socket Swap V3",retrieved:"2026-10-13"});
const ORIGINS={prototype:"https://public-backend.socket.tech",production:"https://dedicated-backend.socket.tech"};
export const SOCKET_ACTIONS=[
 {id:"socket.chains",label:"Read complete supported chains",mode:"read",fields:[]},
 {id:"socket.providers",label:"Read original bridge and DEX providers",mode:"read",fields:[{name:"includeDepositRoutes",type:"true|false",required:false}]},
 {id:"socket.tokens.list",label:"Read original token catalogue",mode:"read",fields:[{name:"chainIds",type:"string",required:false},{name:"list",type:"full|trending",required:false},{name:"userAddress",type:"string",required:false}]},
 {id:"socket.tokens.search",label:"Search original tokens",mode:"read",fields:[{name:"q",type:"string",required:true},{name:"userAddress",type:"string",required:false}]},
 {id:"socket.quote",label:"Quote a Stellar / Base USDC deposit route",mode:"read",fields:[{name:"query",type:"json",required:true},{name:"chainsResultId",type:"evidence-id",required:true},{name:"tokensResultId",type:"evidence-id",required:true}]},
 {id:"socket.quote.activate",label:"Activate the original selected deposit quote",mode:"external-write",fields:[{name:"quoteResultId",type:"evidence-id",required:true},{name:"quoteId",type:"string",required:true}]},
 {id:"socket.status",label:"Read original route and refund status",mode:"read",fields:[{name:"quoteResultId",type:"evidence-id",required:true},{name:"quoteId",type:"string",required:true},{name:"includeQuoteDetails",type:"true|false",required:false}]}
].map(x=>({...x,origins:Object.values(ORIGINS),source:SOCKET_SOURCE}));
const QUOTE_FIELDS=new Set(["userOps","originChainId","destinationChainId","inputToken","outputToken","inputAmount","quoteType","receiverAddress","refundAddress","userAddress","slippage","feeBps","feeTakerAddress","includeProvider","excludeProvider","includeQuoteRejections"]);
const integer=(v,label)=>{need(typeof v==="string"&&/^(?:0|[1-9]\d*)$/.test(v)&&v.length<=128,label+" must remain an original integer string");return v;};
const identifier=v=>typeof v==="number"&&Number.isSafeInteger(v)?String(v):typeof v==="string"&&/^\d+$/.test(v)?v:null;
const stable=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?"["+v.map(stable).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}";
function booleanText(v,label){need(v==="true"||v==="false",label+" must be literal true or false text");return v;}
function address(v,chain,label){text(v,label,256);if(chain==="1110002")stellarPublicKey(v);else need(/^0x[0-9a-fA-F]{40}$/.test(v),"Require the original Base EVM address");return v;}
function tokenEqual(a,b,chain){return typeof a==="string"&&typeof b==="string"&&(chain==="8453"?a.toLowerCase()===b.toLowerCase():a===b);}
export function normalizeSocketQuote(input){
 need(object(input),"Require complete quote query");const q=copy(input);for(const k of Object.keys(q))need(QUOTE_FIELDS.has(k),"Unsupported selected Stellar deposit query field: "+k);
 need(q.userOps==="deposit","This original Stellar adapter selects deposit routes");integer(q.originChainId,"Origin chain");integer(q.destinationChainId,"Destination chain");
 need(q.originChainId!==q.destinationChainId&&[q.originChainId,q.destinationChainId].every(x=>["8453","1110002"].includes(x)),"Current source profile supports Base USDC and Stellar USDC in opposite directions");
 for(const k of ["inputToken","outputToken"])text(q[k],"Original "+k,1024);
 integer(q.inputAmount,"Original base-unit input amount");need(BigInt(q.inputAmount)>0n,"Quote input amount must be positive");
 q.quoteType=q.quoteType??"EXACT_INPUT";need(q.quoteType==="EXACT_INPUT","Deposit routes use exact input; output modes require another selected provider profile");
 address(q.receiverAddress,q.destinationChainId,"Original destination receiver");address(q.refundAddress,q.originChainId,"Original refund address");
 if(q.userAddress!==undefined)address(q.userAddress,q.originChainId,"Original sender");
 if(q.slippage!==undefined)need(typeof q.slippage==="string"&&/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(q.slippage)&&Number(q.slippage)<100,"Slippage is an original percentage below 100 with up to three places");
 need((q.feeBps!==undefined)===(q.feeTakerAddress!==undefined),"Affiliate basis points and taker address must be selected together");
 if(q.feeBps!==undefined){integer(q.feeBps,"Fee basis points");need(BigInt(q.feeBps)<10000n,"Affiliate fee must be below 100 percent");text(q.feeTakerAddress,"Original provider fee recipient",256);}
 for(const k of ["includeProvider","excludeProvider"])if(q[k]!==undefined)text(q[k],k,2048);
 if(q.includeQuoteRejections!==undefined)booleanText(q.includeQuoteRejections,"includeQuoteRejections");
 return q;
}
function extractResult(record){
 // The original backend returns its committed result. Never trust a supplied substitute.
 const result=record?.value??record?.result??record?.projection??record;
 need(object(result)&&result.schema==="bim.socket.exchange.v1"&&result.source?.sha256===SOCKET_SOURCE.sha256,"Select an original stored Socket V3 result");return result;
}
function routes(result){need(object(result.original?.result)&&Array.isArray(result.original.result.routes),"Original quote has no complete route list");return result.original.result.routes;}
function expiry(route){const v=route.expiresAt;need((typeof v==="number"&&Number.isSafeInteger(v))||(typeof v==="string"&&/^\d+$/.test(v)),"Original quote expiry must be Unix seconds");const ms=BigInt(v)*1000n;need(ms<=BigInt(Number.MAX_SAFE_INTEGER),"Original quote expiry is outside supported time");return Number(ms);}
function checkQuoteBinding(original,q){
 const r=original?.result;need(object(r)&&identifier(r.originChainId)===q.originChainId&&identifier(r.destinationChainId)===q.destinationChainId,"Quote response changed original chain selection");
 need(tokenEqual(r.input?.token?.address,q.inputToken,q.originChainId)&&identifier(r.input?.token?.chainId)===q.originChainId&&r.input?.amount===q.inputAmount,"Quote response changed original input asset or exact amount");
 need(typeof r.receiverAddress==="string"&&tokenEqual(r.receiverAddress,q.receiverAddress,q.destinationChainId),"Quote response changed original receiver");
 need(Array.isArray(r.routes),"Retain the complete original route list");
 for(const route of r.routes){need(object(route)&&route.userOp==="deposit","Provider returned another operation type");text(route.quoteId,"Original quote ID",256);expiry(route);need(tokenEqual(route.output?.token?.address,q.outputToken,q.destinationChainId)&&identifier(route.output?.token?.chainId)===q.destinationChainId,"Quote output asset differs from selection");integer(route.output?.amount,"Original output base units");if(route.output?.minAmountOut!==undefined)integer(route.output.minAmountOut,"Original minimum output base units");need(typeof route.activationRequired==="boolean","Deposit quote must explicitly declare activationRequired");}
}
function collectTokens(value,out=[]){if(Array.isArray(value)){for(const x of value)collectTokens(x,out);}else if(object(value)){if(typeof value.address==="string"&&identifier(value.chainId)!==null)out.push(value);else for(const v of Object.values(value))collectTokens(v,out);}return out;}
export function projectSocketStatus(original,quoteId){
 const r=original?.result;need(object(r),"Require the complete original Socket status result");const findings=[];
 if(r.quoteId!==quoteId)findings.push({code:"QUOTE_IDENTITY",status:"CONFLICT"});const state=typeof r.status==="string"?r.status:null;
 const terminal=["COMPLETED","FAILED","EXPIRED","REFUNDED"].includes(state),known=terminal||["PENDING","IN_PROGRESS","REFUNDING","REFUND_FAILED","MANUAL_REVIEW_REQUIRED","ASSIGNED","EXTRACTED","FULFILLED","SETTLED","CANCELLED"].includes(state);
 if(!known)findings.push({code:"UNKNOWN_STATUS",status:"UNKNOWN"});
 const usable=known&&!findings.some(x=>x.status==="CONFLICT");
 return {schema:"bim.socket.status.v1",quoteId,providerStatus:state,statusCode:r.statusCode??null,terminal:usable&&terminal,providerReportsDelivery:usable&&["COMPLETED","FULFILLED","SETTLED"].includes(state),providerReportsRefund:usable&&state==="REFUNDED",source:r.origin??null,destination:r.destination??null,refund:r.refund??null,findings,confirmation:"REQUIRES_INDEPENDENT_ORIGIN_DESTINATION_OR_REFUND_LEDGER_EVIDENCE",original:copy(r)};
}
export function createSocketAdapter(configuration){
 const cfg=copy(configuration??{}),access=cfg.access??"prototype";need(Object.hasOwn(ORIGINS,access),"Select prototype or production Socket API access");const origin=ORIGINS[access];
 async function retained(id,ctx,action){
  text(id,"Original result ID",256);need(typeof ctx.getResult==="function","Require original committed provider result lookup");
  const row=await ctx.getResult(id);need(row?.id===id&&row.actionId===action,"Selected original result identity/action differs");const r=extractResult(row);need(stable(r.providerConfiguration)===stable({access,credentialAlias:cfg.credentialAlias??null,affiliate:cfg.affiliate??null}),"Selected original provider configuration differs");need(r.providerOrigin===origin&&r.action===action,"Original result uses another source/action/API origin");return r;
 }
 async function selectedQuote(input,ctx){
  need(ctx.config?.network?.kind==="stellar"&&ctx.config.network.passphrase===NETWORKS.mainnet&&ctx.config.network.chainId==="1110002","Socket Stellar routes require the selected public Stellar network");const source=await retained(input.quoteResultId,ctx,"socket.quote"),q=source.input.query;normalizeSocketQuote(q);checkQuoteBinding(source.original,q);
  const choices=routes(source).filter(x=>x.quoteId===input.quoteId);need(choices.length===1,"Select one exact original quote ID");
  return {source,query:q,route:copy(choices[0]),quoteResultId:input.quoteResultId};
 }
 async function request(action,path,query,method,ctx,allowBareRoute=false){
  const url=new URL(origin+path);for(const [k,v] of Object.entries(query??{}))url.searchParams.set(k,v);
  const headers={};let credential;
  if(access==="production"){credential=text(cfg.credentialAlias,"Original server Socket credential alias",256);headers.affiliate=text(cfg.affiliate,"Original affiliate ID",256);}
  const e=await ctx.http({url:url.toString(),method,headers,...(credential?{credential}:{}),semantics:method==="GET"?"read":"write"});
  need(e.status>=200&&e.status<300&&!e.parseError,"Original Socket HTTP result failed or is incomplete");let value=e.parsed;if(value===undefined)value=JSON.parse(Buffer.from(e.bodyBase64,"base64").toString("utf8"));
  need(object(value)&&((value.success===true&&Object.hasOwn(value,"result"))||(allowBareRoute&&typeof value.quoteId==="string")||(action==="socket.providers"&&Array.isArray(value.bridges)&&Array.isArray(value.dexes))),"Socket did not return its original successful envelope, activated route or provider catalogue");
  if(action==="socket.providers"){const providers=value.success===true?value.result:value;need(object(providers)&&Array.isArray(providers.bridges)&&Array.isArray(providers.dexes),"Retain the complete original bridges and dexes provider arrays");}
  return {exchange:{exchangeId:e.exchangeId,status:e.status,bytes:e.bytes,sha256:e.sha256,observedAt:e.observedAt??null,requestId:e.headers?.["server-req-id"]??null},original:value,numberTokens:copy(e.numberTokens??{}),providerOrigin:origin,providerConfiguration:{access,credentialAlias:cfg.credentialAlias??null,affiliate:cfg.affiliate??null},source:SOCKET_SOURCE,action};
 }
 return {
  id:"socket",label:"Socket V3 Stellar bridge",origins:Object.values(ORIGINS),actions:SOCKET_ACTIONS.map(copy),
  async prepare(action,input,ctx){
   need(action==="socket.quote.activate","Only selected quote activation is an external mutation");const i=copy(input),s=await selectedQuote(i,ctx);need(s.route.activationRequired===true,"Original selected route is already active");
   const now=Date.parse(ctx.now);need(Number.isFinite(now),"Require original request time");need(expiry(s.route)>now,"Selected quote has expired");
   return {status:"PREPARED",unsignedPayload:{method:"POST",url:origin+"/v3/swap/quote/"+encodeURIComponent(i.quoteId)+"/activate",body:null},selection:{quoteResultId:i.quoteResultId,quoteId:i.quoteId,query:s.query,route:s.route,sourceExchange:s.source.exchange,providerOrigin:origin},expiresAt:new Date(expiry(s.route)).toISOString(),execute:{actionId:action,input:{quoteResultId:i.quoteResultId,quoteId:i.quoteId}},source:SOCKET_SOURCE};
  },
  async execute(action,input,ctx){
   const i=copy(input??{});let result,q={},path="";
   if(action==="socket.chains"){path="/v3/swap/supported-chains";}
   else if(action==="socket.providers"){path="/v3/swap/providers";if(i.includeDepositRoutes!==undefined)q.includeDepositRoutes=booleanText(i.includeDepositRoutes,"includeDepositRoutes");}
   else if(action==="socket.tokens.list"){path="/v3/swap/tokens/list";if(i.chainIds!==undefined){need(typeof i.chainIds==="string"&&/^\d+(?:,\d+)*$/.test(i.chainIds),"Use exact comma-separated chain IDs");q.chainIds=i.chainIds;}q.list=i.list??"full";need(["full","trending"].includes(q.list),"Select full or trending token list");if(i.userAddress!==undefined)q.userAddress=text(i.userAddress,"Original token user",256);}
   else if(action==="socket.tokens.search"){path="/v3/swap/tokens/search";q.q=text(i.q,"Original token query",512);if(i.userAddress!==undefined)q.userAddress=text(i.userAddress,"Original token user",256);}
   else if(action==="socket.quote"){
    need(ctx.config?.network?.kind==="stellar"&&ctx.config.network.passphrase===NETWORKS.mainnet&&ctx.config.network.chainId==="1110002","Socket Stellar routes require the selected public Stellar network");path="/v3/swap/quote";q=normalizeSocketQuote(i.query);
    const chains=await retained(i.chainsResultId,ctx,"socket.chains"),tokenRow=await ctx.getResult(i.tokensResultId),tokens=extractResult(tokenRow);
    need(tokenRow?.id===i.tokensResultId&&tokenRow.actionId===tokens.action&&stable(tokens.providerConfiguration)===stable({access,credentialAlias:cfg.credentialAlias??null,affiliate:cfg.affiliate??null}),"Selected token source/configuration differs");
    need(tokens.providerOrigin===origin&&["socket.tokens.list","socket.tokens.search"].includes(tokens.action),"Select original Socket token evidence");
    need(Array.isArray(chains.original.result),"Original supported chains are unavailable");
    const a=chains.original.result.filter(x=>identifier(x.chainId)===q.originChainId),b=chains.original.result.filter(x=>identifier(x.chainId)===q.destinationChainId);
    need(a.length===1&&b.length===1&&a[0].sendingEnabled===true&&b[0].receivingEnabled===true&&a[0].isDepositEnabled===true,"Selected current chains do not prove deposit sending/receiving support");
    const ts=collectTokens(tokens.original.result);
    for(const [chain,address] of [[q.originChainId,q.inputToken],[q.destinationChainId,q.outputToken]]){const m=ts.filter(t=>identifier(t.chainId)===chain&&tokenEqual(t.address,address,chain));need(m.length>=1&&m.every(t=>t.symbol==="USDC"&&identifier(t.decimals)!==null),"Selected source does not prove complete USDC token identity/decimals");need(m.every(t=>stable(t)===stable(m[0])),"Selected token evidence has conflicting original records");}
    result=await request(action,path,q,"GET",ctx);checkQuoteBinding(result.original,q);
    return {schema:"bim.socket.exchange.v1",...result,input:{...i,query:q},selection:{chainsResultId:i.chainsResultId,tokensResultId:i.tokensResultId},coverage:"COMPLETE_RETURNED_ROUTE_LIST",routes:copy(result.original.result.routes)};
   }else if(action==="socket.quote.activate"){
    const s=await selectedQuote(i,ctx);need(s.route.activationRequired===true,"Only original preview activation is supported");need(expiry(s.route)>Date.now(),"The selected original quote has expired before dispatch");
    result=await request(action,"/v3/swap/quote/"+encodeURIComponent(text(i.quoteId,"Original quote ID",256))+"/activate",{},"POST",ctx,true);
    const r=result.original.success===true?result.original.result:result.original;
    // The official activation page does not specify a separate schema: retain all
    // fields and require the documented same original route/ID before exposing it.
    const findings=[];if(!object(r)||r.quoteId!==i.quoteId)findings.push({code:"ACTIVATION_IDENTITY_UNPROVEN",status:"UNKNOWN"});
    if(!object(r)||r.activationRequired===true||(!object(r.txData)&&!object(r.depositData)))findings.push({code:"DEPOSIT_INSTRUCTIONS_UNAVAILABLE",status:"UNKNOWN"});
    return {schema:"bim.socket.exchange.v1",...result,input:i,selection:{quoteResultId:i.quoteResultId,quoteId:i.quoteId,query:s.query,originalPreview:s.route},findings,depositInstructions:findings.length?null:copy(r.depositData??null),txData:findings.length?null:copy(r.txData??null),execution:"REQUIRES_EXPLICIT_ORIGINAL_ASSET_AMOUNT_MEMO_AND_CHAIN_REVIEW"};
   }else if(action==="socket.status"){
    const s=await selectedQuote(i,ctx);path="/v3/swap/status";q.quoteId=s.route.quoteId;if(i.includeQuoteDetails!==undefined)q.includeQuoteDetails=booleanText(i.includeQuoteDetails,"includeQuoteDetails");
    result=await request(action,path,q,"GET",ctx);return {schema:"bim.socket.exchange.v1",...result,input:i,selection:{quoteResultId:i.quoteResultId,quoteId:s.route.quoteId,statusCheck:s.route.statusCheck??null},projection:projectSocketStatus(result.original,s.route.quoteId)};
   }else throw new Error("Unknown Socket V3 action "+action);
   result=await request(action,path,q,"GET",ctx);
   return {schema:"bim.socket.exchange.v1",...result,input:i,query:q,coverage:action==="socket.tokens.search"?"SEARCH_QUERY_ONLY":action==="socket.tokens.list"?(q.list==="full"?"FULL_RETURNED_SELECTED_TOKEN_LIST":"TRENDING_SUBSET"):"FULL_RETURNED_RESPONSE"};
  }
 };
}
